package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad(t *testing.T) {
	// Create a temporary config file
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "test-config.json")

	// Test loading non-existent config (should create new)
	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("Failed to load new config: %v", err)
	}

	if cfg.AgentID == "" {
		t.Error("Expected AgentID to be generated")
	}

	// Test saving and loading
	testToken := "test-token-123"
	cfg.RegistrationToken = testToken
	err = cfg.Save(configPath)
	if err != nil {
		t.Fatalf("Failed to save config: %v", err)
	}

	// Verify file exists
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		t.Error("Config file was not created")
	}

	// Load saved config
	cfg2, err := Load(configPath)
	if err != nil {
		t.Fatalf("Failed to load saved config: %v", err)
	}

	if cfg2.RegistrationToken != testToken {
		t.Errorf("Expected token %s, got %s", testToken, cfg2.RegistrationToken)
	}

	if cfg2.AgentID != cfg.AgentID {
		t.Error("AgentID changed after save/load")
	}
}

func TestConfigDefaults(t *testing.T) {
	cfg, _ := Load("")

	// Test default values
	if cfg.SSHServerPort != 2222 {
		t.Errorf("Expected default SSH port 2222, got %d", cfg.SSHServerPort)
	}

	if cfg.ManagerURL == "" {
		t.Error("Expected default manager URL")
	}
}