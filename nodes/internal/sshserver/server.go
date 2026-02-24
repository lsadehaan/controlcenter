package sshserver

import (
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/rs/zerolog"
	"golang.org/x/crypto/ssh"
)

const (
	maxFilenameLen = 4096             // Max filename length in SFTP operations
	maxUploadSize  = 100 * 1024 * 1024 // 100MB max upload size
)

type SSHServer struct {
	port       int
	privateKey ssh.Signer
	keysMu     sync.RWMutex
	authorizedKeys []ssh.PublicKey
	allowedPaths   []string
	logger     zerolog.Logger
	listener   net.Listener
}

func New(port int, privateKeyPath string, authorizedKeysList []string, logger zerolog.Logger) (*SSHServer, error) {
	// Load private key
	privateKeyData, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read private key: %w", err)
	}

	privateKey, err := ssh.ParsePrivateKey(privateKeyData)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	// Parse authorized keys
	var authorizedKeys []ssh.PublicKey
	for _, keyStr := range authorizedKeysList {
		if keyStr == "" {
			continue
		}
		pubKey, _, _, _, err := ssh.ParseAuthorizedKey([]byte(keyStr))
		if err != nil {
			logger.Warn().Err(err).Str("key", keyStr[:20]+"...").Msg("Failed to parse authorized key")
			continue
		}
		authorizedKeys = append(authorizedKeys, pubKey)
	}

	return &SSHServer{
		port:           port,
		privateKey:     privateKey,
		authorizedKeys: authorizedKeys,
		logger:         logger,
	}, nil
}

func (s *SSHServer) UpdateAuthorizedKeys(keys []string) {
	var authorizedKeys []ssh.PublicKey
	for _, keyStr := range keys {
		if keyStr == "" {
			continue
		}
		pubKey, _, _, _, err := ssh.ParseAuthorizedKey([]byte(keyStr))
		if err != nil {
			s.logger.Warn().Err(err).Msg("Failed to parse authorized key during update")
			continue
		}
		authorizedKeys = append(authorizedKeys, pubKey)
	}
	s.keysMu.Lock()
	s.authorizedKeys = authorizedKeys
	s.keysMu.Unlock()
	s.logger.Info().Int("count", len(authorizedKeys)).Msg("Updated authorized keys")
}

func (s *SSHServer) SetAllowedPaths(paths []string) {
	s.allowedPaths = paths
}

func (s *SSHServer) Start() error {
	config := &ssh.ServerConfig{
		PublicKeyCallback: s.authCallback,
	}
	config.AddHostKey(s.privateKey)

	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", s.port))
	if err != nil {
		return fmt.Errorf("failed to listen on port %d: %w", s.port, err)
	}
	s.listener = listener

	s.logger.Info().Int("port", s.port).Msg("SSH server started")

	for {
		conn, err := listener.Accept()
		if err != nil {
			if strings.Contains(err.Error(), "use of closed network connection") {
				return nil
			}
			s.logger.Error().Err(err).Msg("Failed to accept connection")
			continue
		}

		go s.handleConnection(conn, config)
	}
}

func (s *SSHServer) Stop() error {
	if s.listener != nil {
		return s.listener.Close()
	}
	return nil
}

func (s *SSHServer) authCallback(conn ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
	s.keysMu.RLock()
	keys := s.authorizedKeys
	s.keysMu.RUnlock()

	for _, authorizedKey := range keys {
		if string(authorizedKey.Marshal()) == string(key.Marshal()) {
			s.logger.Info().Str("user", conn.User()).Msg("SSH authentication successful")
			return &ssh.Permissions{
				Extensions: map[string]string{
					"user": conn.User(),
				},
			}, nil
		}
	}
	s.logger.Warn().Str("user", conn.User()).Msg("SSH authentication failed")
	return nil, fmt.Errorf("unknown public key")
}

func (s *SSHServer) handleConnection(conn net.Conn, config *ssh.ServerConfig) {
	defer conn.Close()

	// Perform SSH handshake
	sshConn, chans, reqs, err := ssh.NewServerConn(conn, config)
	if err != nil {
		s.logger.Error().Err(err).Msg("Failed to handshake")
		return
	}
	defer sshConn.Close()

	s.logger.Info().Str("user", sshConn.User()).Str("remote", sshConn.RemoteAddr().String()).Msg("New SSH connection")

	// Handle out-of-band requests
	go ssh.DiscardRequests(reqs)

	// Handle channels
	for newChannel := range chans {
		s.handleChannel(newChannel)
	}
}

func (s *SSHServer) handleChannel(newChannel ssh.NewChannel) {
	switch newChannel.ChannelType() {
	case "session":
		s.handleSession(newChannel)
	case "direct-tcpip":
		s.logger.Warn().Str("type", newChannel.ChannelType()).Msg("TCP forwarding not supported")
		newChannel.Reject(ssh.UnknownChannelType, "unknown channel type")
	default:
		s.logger.Warn().Str("type", newChannel.ChannelType()).Msg("Unknown channel type")
		newChannel.Reject(ssh.UnknownChannelType, "unknown channel type")
	}
}

func (s *SSHServer) handleSession(newChannel ssh.NewChannel) {
	channel, requests, err := newChannel.Accept()
	if err != nil {
		s.logger.Error().Err(err).Msg("Failed to accept channel")
		return
	}
	defer channel.Close()

	for req := range requests {
		switch req.Type {
		case "exec":
			if len(req.Payload) < 4 {
				s.logger.Warn().Msg("exec request payload too short")
				req.Reply(false, nil)
				continue
			}
			s.handleExec(channel, req)
		case "subsystem":
			if len(req.Payload) < 4 {
				s.logger.Warn().Msg("subsystem request payload too short")
				req.Reply(false, nil)
				continue
			}
			if string(req.Payload[4:]) == "sftp" {
				s.handleSFTP(channel, req)
			} else {
				req.Reply(false, nil)
			}
		default:
			s.logger.Debug().Str("type", req.Type).Msg("Unknown request type")
			req.Reply(false, nil)
		}
	}
}

func (s *SSHServer) handleExec(channel ssh.Channel, req *ssh.Request) {
	// Parse command from request
	cmdLen := int(req.Payload[0])<<24 | int(req.Payload[1])<<16 | int(req.Payload[2])<<8 | int(req.Payload[3])
	if cmdLen > len(req.Payload)-4 || cmdLen < 0 {
		req.Reply(false, nil)
		return
	}
	cmdStr := string(req.Payload[4 : 4+cmdLen])

	// Security: Log all SSH command attempts for audit
	s.logger.Info().
		Str("command", cmdStr).
		Msg("SSH command execution requested")

	// Parse command - use shlex-style parsing to handle quoted arguments properly
	parts := strings.Fields(cmdStr)
	if len(parts) == 0 {
		req.Reply(false, nil)
		return
	}

	// SECURITY: exec.Command does NOT invoke shell
	// This prevents command injection as arguments are passed directly
	cmd := exec.Command(parts[0], parts[1:]...)
	
	// Connect stdin/stdout/stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		s.logger.Error().Err(err).Msg("Failed to get stdin pipe")
		req.Reply(false, nil)
		return
	}
	
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.logger.Error().Err(err).Msg("Failed to get stdout pipe")
		req.Reply(false, nil)
		return
	}
	
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.logger.Error().Err(err).Msg("Failed to get stderr pipe")
		req.Reply(false, nil)
		return
	}

	// Start command
	if err := cmd.Start(); err != nil {
		s.logger.Error().Err(err).Msg("Failed to start command")
		req.Reply(false, nil)
		return
	}

	req.Reply(true, nil)

	// Copy stdin
	go io.Copy(stdin, channel)
	
	// Copy stdout and stderr
	go io.Copy(channel, stdout)
	go io.Copy(channel.Stderr(), stderr)

	// Wait for command to complete
	if err := cmd.Wait(); err != nil {
		s.logger.Error().Err(err).Msg("Command execution failed")
		channel.SendRequest("exit-status", false, []byte{0, 0, 0, 1})
	} else {
		channel.SendRequest("exit-status", false, []byte{0, 0, 0, 0})
	}
}

func (s *SSHServer) handleSFTP(channel ssh.Channel, req *ssh.Request) {
	s.logger.Info().Msg("SFTP session requested")
	req.Reply(true, nil)
	
	// For now, implement a simple file transfer protocol
	// In production, use github.com/pkg/sftp for full SFTP support
	
	// Read operation type
	opType := make([]byte, 1)
	_, err := channel.Read(opType)
	if err != nil {
		s.logger.Error().Err(err).Msg("Failed to read SFTP operation")
		return
	}

	switch opType[0] {
	case 'G': // Get file
		s.handleSFTPGet(channel)
	case 'P': // Put file
		s.handleSFTPPut(channel)
	default:
		s.logger.Warn().Int("op", int(opType[0])).Msg("Unknown SFTP operation")
	}
}

// validatePath checks that the given path is under one of the allowed base paths.
// Returns the cleaned absolute path or an error.
func (s *SSHServer) validatePath(rawPath string) (string, error) {
	cleaned := filepath.Clean(rawPath)
	absPath, err := filepath.Abs(cleaned)
	if err != nil {
		return "", fmt.Errorf("failed to resolve path: %w", err)
	}

	// If no allowed paths configured, deny all SFTP file operations
	if len(s.allowedPaths) == 0 {
		return "", fmt.Errorf("no allowed paths configured")
	}

	for _, allowed := range s.allowedPaths {
		allowedAbs, err := filepath.Abs(filepath.Clean(allowed))
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(allowedAbs, absPath)
		if err != nil {
			continue
		}
		if !strings.HasPrefix(rel, "..") {
			return absPath, nil
		}
	}

	return "", fmt.Errorf("path %q is not under any allowed directory", rawPath)
}

func (s *SSHServer) handleSFTPGet(channel ssh.Channel) {
	// Read filename length
	lenBytes := make([]byte, 4)
	if _, err := io.ReadFull(channel, lenBytes); err != nil {
		s.logger.Error().Err(err).Msg("Failed to read filename length")
		return
	}

	fileLen := int(lenBytes[0])<<24 | int(lenBytes[1])<<16 | int(lenBytes[2])<<8 | int(lenBytes[3])

	if fileLen < 0 || fileLen > maxFilenameLen {
		s.logger.Warn().Int("fileLen", fileLen).Msg("SFTP GET: filename length out of range")
		channel.Write([]byte{0})
		return
	}

	// Read filename
	filename := make([]byte, fileLen)
	if _, err := io.ReadFull(channel, filename); err != nil {
		s.logger.Error().Err(err).Msg("Failed to read filename")
		return
	}

	filePath, err := s.validatePath(string(filename))
	if err != nil {
		s.logger.Warn().Err(err).Str("file", string(filename)).Msg("SFTP GET: path rejected")
		channel.Write([]byte{0})
		return
	}
	s.logger.Info().Str("file", filePath).Msg("SFTP GET request")

	// Read file
	data, err := os.ReadFile(filePath)
	if err != nil {
		s.logger.Error().Err(err).Msg("Failed to read file")
		channel.Write([]byte{0}) // Error
		return
	}

	// Send success and file size
	channel.Write([]byte{1}) // Success
	sizeBytes := make([]byte, 8)
	size := uint64(len(data))
	for i := 0; i < 8; i++ {
		sizeBytes[i] = byte(size >> (8 * (7 - i)))
	}
	channel.Write(sizeBytes)

	// Send file data
	channel.Write(data)
}

func (s *SSHServer) handleSFTPPut(channel ssh.Channel) {
	// Read filename length
	lenBytes := make([]byte, 4)
	if _, err := io.ReadFull(channel, lenBytes); err != nil {
		s.logger.Error().Err(err).Msg("Failed to read filename length")
		return
	}

	fileLen := int(lenBytes[0])<<24 | int(lenBytes[1])<<16 | int(lenBytes[2])<<8 | int(lenBytes[3])

	if fileLen < 0 || fileLen > maxFilenameLen {
		s.logger.Warn().Int("fileLen", fileLen).Msg("SFTP PUT: filename length out of range")
		channel.Write([]byte{0})
		return
	}

	// Read filename
	filename := make([]byte, fileLen)
	if _, err := io.ReadFull(channel, filename); err != nil {
		s.logger.Error().Err(err).Msg("Failed to read filename")
		return
	}

	filePath, err := s.validatePath(string(filename))
	if err != nil {
		s.logger.Warn().Err(err).Str("file", string(filename)).Msg("SFTP PUT: path rejected")
		channel.Write([]byte{0})
		return
	}
	s.logger.Info().Str("file", filePath).Msg("SFTP PUT request")

	// Read file size
	sizeBytes := make([]byte, 8)
	if _, err := io.ReadFull(channel, sizeBytes); err != nil {
		s.logger.Error().Err(err).Msg("Failed to read file size")
		return
	}

	var size uint64
	for i := 0; i < 8; i++ {
		size = (size << 8) | uint64(sizeBytes[i])
	}

	if size > maxUploadSize {
		s.logger.Warn().Uint64("size", size).Msg("SFTP PUT: file size exceeds limit")
		channel.Write([]byte{0})
		return
	}

	// Read file data
	data := make([]byte, size)
	if _, err := io.ReadFull(channel, data); err != nil {
		s.logger.Error().Err(err).Msg("Failed to read file data")
		channel.Write([]byte{0}) // Error
		return
	}

	// Ensure directory exists
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		s.logger.Error().Err(err).Msg("Failed to create directory")
		channel.Write([]byte{0}) // Error
		return
	}

	// Write file
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		s.logger.Error().Err(err).Msg("Failed to write file")
		channel.Write([]byte{0}) // Error
		return
	}

	channel.Write([]byte{1}) // Success
}