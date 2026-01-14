package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
)

// ReconnectConfig holds configuration for reconnection behavior
type ReconnectConfig struct {
	InitialInterval time.Duration // Starting reconnect interval (default: 5s)
	MaxInterval     time.Duration // Maximum reconnect interval (default: 5min)
	Multiplier      float64       // Backoff multiplier (default: 2.0)
}

// DefaultReconnectConfig returns sensible defaults for reconnection
func DefaultReconnectConfig() ReconnectConfig {
	return ReconnectConfig{
		InitialInterval: 5 * time.Second,
		MaxInterval:     5 * time.Minute,
		Multiplier:      2.0,
	}
}

type Client struct {
	conn            *websocket.Conn
	url             string
	agentID         string
	logger          zerolog.Logger
	reconnectConfig ReconnectConfig
	pingInterval    time.Duration

	// Backoff state
	currentInterval time.Duration
	failureCount    int
	lastAttempt     time.Time
	mu              sync.RWMutex

	// Channel to trigger immediate reconnection
	reconnectNow chan struct{}

	onMessage    func(MessageType, json.RawMessage)
	onConnect    func()
	onDisconnect func()
}

type MessageType string

const (
	MessageTypeHeartbeat    MessageType = "heartbeat"
	MessageTypeCommand      MessageType = "command"
	MessageTypeConfig       MessageType = "config"
	MessageTypeRegistration MessageType = "registration"
	MessageTypeStatus       MessageType = "status"
	MessageTypeAlert        MessageType = "alert"
)

type Message struct {
	Type    MessageType     `json:"type"`
	AgentID string          `json:"agentId,omitempty"`
	Payload json.RawMessage `json:"payload"`
}

func NewClient(managerURL, agentID string, logger zerolog.Logger) *Client {
	return NewClientWithConfig(managerURL, agentID, logger, DefaultReconnectConfig())
}

func NewClientWithConfig(managerURL, agentID string, logger zerolog.Logger, reconnectConfig ReconnectConfig) *Client {
	u, _ := url.Parse(managerURL)
	if u.Scheme == "http" {
		u.Scheme = "ws"
	} else if u.Scheme == "https" {
		u.Scheme = "wss"
	}

	// Only add /ws if not already present
	if u.Path == "" || u.Path == "/" {
		u.Path = "/ws"
	}

	return &Client{
		url:             u.String(),
		agentID:         agentID,
		logger:          logger,
		reconnectConfig: reconnectConfig,
		currentInterval: reconnectConfig.InitialInterval,
		pingInterval:    30 * time.Second,
		reconnectNow:    make(chan struct{}, 1),
	}
}

func (c *Client) OnMessage(handler func(MessageType, json.RawMessage)) {
	c.onMessage = handler
}

func (c *Client) OnConnect(handler func()) {
	c.onConnect = handler
}

func (c *Client) OnDisconnect(handler func()) {
	c.onDisconnect = handler
}

// TriggerReconnect signals the client to attempt reconnection immediately
// This resets the backoff and triggers a reconnect attempt
func (c *Client) TriggerReconnect() {
	c.mu.Lock()
	c.currentInterval = c.reconnectConfig.InitialInterval
	c.failureCount = 0
	c.mu.Unlock()

	// Non-blocking send to trigger reconnect
	select {
	case c.reconnectNow <- struct{}{}:
		c.logger.Info().Msg("Reconnect triggered - will attempt immediately")
	default:
		// Channel already has a pending trigger
	}
}

// IsConnected returns whether the WebSocket is currently connected
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.conn != nil
}

// GetConnectionStatus returns detailed connection status
func (c *Client) GetConnectionStatus() map[string]interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()

	status := map[string]interface{}{
		"connected":       c.conn != nil,
		"url":             c.url,
		"failureCount":    c.failureCount,
		"currentInterval": c.currentInterval.String(),
		"maxInterval":     c.reconnectConfig.MaxInterval.String(),
	}

	if !c.lastAttempt.IsZero() {
		status["lastAttempt"] = c.lastAttempt.Format(time.RFC3339)
		status["timeSinceLastAttempt"] = time.Since(c.lastAttempt).String()
	}

	return status
}

func (c *Client) Start(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.reconnectNow:
			// Immediate reconnect triggered - skip the wait
			c.logger.Debug().Msg("Processing triggered reconnect")
		default:
		}

		c.mu.Lock()
		c.lastAttempt = time.Now()
		c.mu.Unlock()

		if err := c.connect(ctx); err != nil {
			c.mu.Lock()
			c.failureCount++
			failureCount := c.failureCount
			currentInterval := c.currentInterval

			// Log at WARN level instead of ERROR - this is expected when manager is down
			c.logger.Warn().
				Err(err).
				Int("failureCount", failureCount).
				Str("nextRetry", currentInterval.String()).
				Msg("WebSocket connection failed")

			// Calculate next interval with exponential backoff
			nextInterval := time.Duration(float64(c.currentInterval) * c.reconnectConfig.Multiplier)
			if nextInterval > c.reconnectConfig.MaxInterval {
				nextInterval = c.reconnectConfig.MaxInterval
			}
			c.currentInterval = nextInterval
			c.mu.Unlock()

			// Wait for either the backoff timer or a reconnect trigger
			select {
			case <-ctx.Done():
				return
			case <-c.reconnectNow:
				// Immediate reconnect triggered - reset backoff and continue
				c.mu.Lock()
				c.currentInterval = c.reconnectConfig.InitialInterval
				c.failureCount = 0
				c.mu.Unlock()
				c.logger.Info().Msg("Backoff reset - attempting immediate reconnect")
				continue
			case <-time.After(currentInterval):
				// Normal backoff wait completed
				continue
			}
		}

		// Connected successfully - reset backoff
		c.mu.Lock()
		c.currentInterval = c.reconnectConfig.InitialInterval
		c.failureCount = 0
		c.mu.Unlock()
	}
}

func (c *Client) connect(ctx context.Context) error {
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.Dial(c.url, nil)
	if err != nil {
		return fmt.Errorf("failed to dial: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		c.conn.Close()
		c.conn = nil
		c.mu.Unlock()
		if c.onDisconnect != nil {
			c.onDisconnect()
		}
	}()

	c.logger.Info().Str("url", c.url).Msg("WebSocket connected")

	if c.onConnect != nil {
		c.onConnect()
	}

	// Start heartbeat
	heartbeatTicker := time.NewTicker(c.pingInterval)
	defer heartbeatTicker.Stop()

	// Start read pump
	readChan := make(chan error, 1)
	go func() {
		for {
			var msg Message
			err := conn.ReadJSON(&msg)
			if err != nil {
				readChan <- err
				return
			}

			if c.onMessage != nil {
				c.onMessage(msg.Type, msg.Payload)
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case <-heartbeatTicker.C:
			if err := c.SendHeartbeat(); err != nil {
				return err
			}

		case err := <-readChan:
			return err
		}
	}
}

func (c *Client) SendHeartbeat() error {
	return c.SendMessage(MessageTypeHeartbeat, map[string]interface{}{
		"timestamp": time.Now().Unix(),
		"status":    "healthy",
	})
}

func (c *Client) SendRegistration(publicKey, token string) error {
	return c.SendMessage(MessageTypeRegistration, map[string]interface{}{
		"publicKey": publicKey,
		"token":     token,
		"hostname":  getHostname(),
		"platform":  getPlatform(),
	})
}

func (c *Client) SendReconnection(publicKey string) error {
	return c.SendMessage("reconnection", map[string]interface{}{
		"publicKey": publicKey,
		"hostname":  getHostname(),
		"platform":  getPlatform(),
	})
}

func (c *Client) SendStatus(status string, details map[string]interface{}) error {
	payload := map[string]interface{}{
		"status":    status,
		"timestamp": time.Now().Unix(),
	}
	for k, v := range details {
		payload[k] = v
	}
	return c.SendMessage(MessageTypeStatus, payload)
}

func (c *Client) SendMessage(msgType MessageType, payload interface{}) error {
	c.mu.RLock()
	conn := c.conn
	c.mu.RUnlock()

	if conn == nil {
		return fmt.Errorf("not connected")
	}

	payloadData, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	msg := Message{
		Type:    msgType,
		AgentID: c.agentID,
		Payload: payloadData,
	}

	return conn.WriteJSON(msg)
}

func getHostname() string {
	hostname, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return hostname
}

func getPlatform() string {
	return runtime.GOOS + "/" + runtime.GOARCH
}
