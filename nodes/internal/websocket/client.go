package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"runtime"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
)

type Client struct {
	conn       *websocket.Conn
	url        string
	agentID    string
	logger     zerolog.Logger
	reconnectInterval time.Duration
	pingInterval     time.Duration
	
	onMessage  func(MessageType, json.RawMessage)
	onConnect  func()
	onDisconnect func()
}

type MessageType string

const (
	MessageTypeHeartbeat   MessageType = "heartbeat"
	MessageTypeCommand     MessageType = "command"
	MessageTypeConfig      MessageType = "config"
	MessageTypeRegistration MessageType = "registration"
	MessageTypeStatus      MessageType = "status"
	MessageTypeAlert       MessageType = "alert"
)

type Message struct {
	Type    MessageType     `json:"type"`
	AgentID string          `json:"agentId,omitempty"`
	Payload json.RawMessage `json:"payload"`
}

func NewClient(managerURL, agentID string, logger zerolog.Logger) *Client {
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
		url:               u.String(),
		agentID:           agentID,
		logger:            logger,
		reconnectInterval: 5 * time.Second,
		pingInterval:      30 * time.Second,
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

func (c *Client) Start(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			if err := c.connect(ctx); err != nil {
				c.logger.Error().Err(err).Msg("WebSocket connection failed")
				time.Sleep(c.reconnectInterval)
				continue
			}
		}
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
	c.conn = conn
	defer func() {
		c.conn.Close()
		c.conn = nil
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
			err := c.conn.ReadJSON(&msg)
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
	if c.conn == nil {
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

	return c.conn.WriteJSON(msg)
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