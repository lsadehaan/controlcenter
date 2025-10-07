package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type Config struct {
	mu sync.RWMutex

	AgentID          string   `json:"agentId"`
	ManagerURL       string   `json:"managerUrl"`
	RegistrationToken string   `json:"registrationToken,omitempty"`
	Registered       bool     `json:"registered"`
	SSHPrivateKeyPath string   `json:"sshPrivateKeyPath"`
	SSHPublicKeyPath  string   `json:"sshPublicKeyPath"`
	ConfigRepoPath   string   `json:"configRepoPath"`
	StateFilePath    string   `json:"stateFilePath"`
	LogFilePath      string   `json:"logFilePath"`
	SSHServerPort    int      `json:"sshServerPort"`
	AuthorizedSSHKeys []string `json:"authorizedSshKeys"`
	Workflows        []Workflow `json:"workflows"`

	// File Watcher Global Settings
	FileWatcherSettings FileWatcherSettings `json:"fileWatcherSettings,omitempty"`

	// Log Management Settings
	LogSettings LogSettings `json:"logSettings,omitempty"`

	Extra            map[string]interface{} `json:"extra,omitempty"`
}

type LogSettings struct {
	Level        string `json:"level"`        // Log level: debug, info, warn, error (default: info)
	MaxSizeMB    int    `json:"maxSizeMB"`    // Max size before rotation (default: 100MB)
	MaxAgeDays   int    `json:"maxAgeDays"`   // Max days to retain logs (default: 30)
	MaxBackups   int    `json:"maxBackups"`   // Max number of old log files (default: 5)
	Compress     bool   `json:"compress"`     // Compress rotated logs (default: true)
}

type FileWatcherSettings struct {
	ScanDir    string `json:"scanDir"`    // Root directory for pattern-based watching
	ScanSubDir bool   `json:"scanSubDir"` // Whether to recursively watch matched directories
}

type Workflow struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Enabled     bool        `json:"enabled"`
	Trigger     Trigger     `json:"trigger"`
	Steps       []Step      `json:"steps"`
}

type Trigger struct {
	Type       string                 `json:"type"`
	Config     map[string]interface{} `json:"config"`
	StartSteps []string               `json:"startSteps,omitempty"`
}

type Step struct {
	ID      string                 `json:"id"`
	Type    string                 `json:"type"`
	Name    string                 `json:"name"`
	Config  map[string]interface{} `json:"config"`
	Next    []string               `json:"next,omitempty"`
	OnError []string               `json:"onError,omitempty"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		ManagerURL:       "http://localhost:3000",
		SSHPrivateKeyPath: filepath.Join(getDataDir(), "agent_key"),
		SSHPublicKeyPath:  filepath.Join(getDataDir(), "agent_key.pub"),
		ConfigRepoPath:   filepath.Join(getDataDir(), "config-repo"),
		StateFilePath:    filepath.Join(getDataDir(), "state.json"),
		LogFilePath:      filepath.Join(getDataDir(), "agent.log"),
		SSHServerPort:    2222,
	}

	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			if !os.IsNotExist(err) {
				return nil, err
			}
		} else {
			if err := json.Unmarshal(data, cfg); err != nil {
				return nil, err
			}
		}
	}

	return cfg, nil
}

func (c *Config) Save(path string) error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Create a copy without the mutex for marshaling
	toSave := struct {
		AgentID             string                 `json:"agentId"`
		ManagerURL          string                 `json:"managerUrl"`
		RegistrationToken   string                 `json:"registrationToken,omitempty"`
		Registered          bool                   `json:"registered"`
		SSHPrivateKeyPath   string                 `json:"sshPrivateKeyPath"`
		SSHPublicKeyPath    string                 `json:"sshPublicKeyPath"`
		ConfigRepoPath      string                 `json:"configRepoPath"`
		StateFilePath       string                 `json:"stateFilePath"`
		LogFilePath         string                 `json:"logFilePath"`
		SSHServerPort       int                    `json:"sshServerPort"`
		AuthorizedSSHKeys   []string               `json:"authorizedSshKeys"`
		Workflows           []Workflow             `json:"workflows"`
		FileWatcherSettings FileWatcherSettings    `json:"fileWatcherSettings,omitempty"`
		Extra               map[string]interface{} `json:"extra,omitempty"`
	}{
		AgentID:             c.AgentID,
		ManagerURL:          c.ManagerURL,
		RegistrationToken:   c.RegistrationToken,
		Registered:          c.Registered,
		SSHPrivateKeyPath:   c.SSHPrivateKeyPath,
		SSHPublicKeyPath:    c.SSHPublicKeyPath,
		ConfigRepoPath:      c.ConfigRepoPath,
		StateFilePath:       c.StateFilePath,
		LogFilePath:         c.LogFilePath,
		SSHServerPort:       c.SSHServerPort,
		AuthorizedSSHKeys:   c.AuthorizedSSHKeys,
		Workflows:           c.Workflows,
		FileWatcherSettings: c.FileWatcherSettings,
		Extra:               c.Extra,
	}

	data, err := json.MarshalIndent(toSave, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}

func (c *Config) Reload(path string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Read the file directly instead of using Load to avoid mutex issues
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	// Create a temporary config to unmarshal into
	var tempCfg Config
	if err := json.Unmarshal(data, &tempCfg); err != nil {
		return err
	}

	// Copy only the fields, not the mutex
	c.AgentID = tempCfg.AgentID
	c.ManagerURL = tempCfg.ManagerURL
	c.RegistrationToken = tempCfg.RegistrationToken
	c.Registered = tempCfg.Registered
	c.SSHPrivateKeyPath = tempCfg.SSHPrivateKeyPath
	c.SSHPublicKeyPath = tempCfg.SSHPublicKeyPath
	c.ConfigRepoPath = tempCfg.ConfigRepoPath
	c.StateFilePath = tempCfg.StateFilePath
	c.LogFilePath = tempCfg.LogFilePath
	c.SSHServerPort = tempCfg.SSHServerPort
	c.AuthorizedSSHKeys = tempCfg.AuthorizedSSHKeys
	c.Workflows = tempCfg.Workflows
	c.FileWatcherSettings = tempCfg.FileWatcherSettings
	c.Extra = tempCfg.Extra
	
	return nil
}

func getDataDir() string {
	dir := os.Getenv("AGENT_DATA_DIR")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".controlcenter-agent")
	}
	os.MkdirAll(dir, 0700)
	return dir
}