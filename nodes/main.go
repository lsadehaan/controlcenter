/*
 * Control Center Node Agent
 * Copyright (C) 2025 Your Organization
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/your-org/controlcenter/nodes/internal/api"
	"github.com/your-org/controlcenter/nodes/internal/config"
	"github.com/your-org/controlcenter/nodes/internal/filebrowser"
	"github.com/your-org/controlcenter/nodes/internal/filewatcher"
	"github.com/your-org/controlcenter/nodes/internal/gitsync"
	"github.com/your-org/controlcenter/nodes/internal/identity"
	"github.com/your-org/controlcenter/nodes/internal/logrotation"
	"github.com/your-org/controlcenter/nodes/internal/sshserver"
	"github.com/your-org/controlcenter/nodes/internal/websocket"
	"github.com/your-org/controlcenter/nodes/internal/workflow"
)

type Agent struct {
	config       *config.Config
	identity     *identity.Identity
	wsClient     *websocket.Client
	wsConnected  bool  // Track WebSocket connection state
	gitSync      *gitsync.GitSync
	executor     *workflow.Executor
	sshServer    *sshserver.SSHServer
	fileWatcher  *filewatcher.Watcher
	logger       zerolog.Logger
	logLevel     *zerolog.Level
	configPath   string
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func getDefaultConfigDir() string {
	dir := os.Getenv("AGENT_CONFIG_DIR")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".controlcenter-agent")
	}
	os.MkdirAll(dir, 0700)
	return dir
}

func main() {
	var (
		configPath     = flag.String("config", "", "Path to configuration file")
		managerURL     = flag.String("manager", "http://localhost:3000", "Manager URL")
		token          = flag.String("token", "", "Registration token")
		logLevel       = flag.String("log-level", "info", "Log level (debug, info, warn, error)")
		standalone     = flag.Bool("standalone", false, "Run in standalone mode without manager connection")
		pushConfig     = flag.Bool("push-config", false, "Push local configuration changes to manager")
		checkChanges   = flag.Bool("check-changes", false, "Check for local configuration changes")
		listBackups    = flag.Bool("list-backups", false, "List available configuration backups")
		recoverBackup  = flag.String("recover-backup", "", "Recover from a specific backup (stash or branch ID, or 'latest')")
		mergeConfig    = flag.Bool("merge-config", false, "Interactive merge of local and remote configurations")
	)
	flag.Parse()

	// Setup logger with both console and rotating file output
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix

	// Start with command-line log level or default
	currentLevel := zerolog.InfoLevel
	if *logLevel != "" {
		if lvl, err := zerolog.ParseLevel(*logLevel); err == nil {
			currentLevel = lvl
		}
	}

	// Create rotating log file writer with defaults
	// These will be overridden by config once loaded
	logFilePath := filepath.Join(getDefaultConfigDir(), "agent.log")
	rotatingWriter, err := logrotation.NewRotatingWriter(
		logFilePath,
		100,  // 100MB max size
		30,   // 30 days retention
		5,    // 5 backup files
		true, // compress old logs
	)
	if err != nil {
		fmt.Printf("Failed to create rotating log writer: %v\n", err)
		os.Exit(1)
	}
	defer rotatingWriter.Close()

	// Create multi-writer for both console and rotating file
	consoleWriter := zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339}
	multiWriter := zerolog.MultiLevelWriter(consoleWriter, rotatingWriter)

	logger := zerolog.New(multiWriter).With().Timestamp().Logger().Level(currentLevel)
	logger.Info().
		Str("logFile", logFilePath).
		Str("logLevel", currentLevel.String()).
		Int("maxSizeMB", 100).
		Int("maxAgeDays", 30).
		Int("maxBackups", 5).
		Msg("Logging to both console and rotating file")

	// Determine config path
	actualConfigPath := *configPath
	if actualConfigPath == "" {
		// Check for default config file
		defaultPath := filepath.Join(getDefaultConfigDir(), "agent-config.json")
		logger.Debug().Str("path", defaultPath).Msg("Checking for saved config file")
		if fileExists(defaultPath) {
			actualConfigPath = defaultPath
			logger.Info().Str("path", defaultPath).Msg("Using saved config file")
		} else {
			logger.Debug().Str("path", defaultPath).Msg("No saved config file found")
		}
	}
	
	// Load or create configuration
	logger.Debug().Str("actualConfigPath", actualConfigPath).Msg("Loading config from path")
	cfg, err := config.Load(actualConfigPath)
	if err != nil {
		logger.Fatal().Err(err).Msg("Failed to load configuration")
	}
	
	// Update the configPath pointer to the actual path used
	*configPath = actualConfigPath
	
	logger.Debug().
		Str("agentId", cfg.AgentID).
		Bool("registered", cfg.Registered).
		Msg("Config loaded")

	// Override with command line flags only if they differ from defaults
	if *managerURL != "http://localhost:3000" && *managerURL != cfg.ManagerURL {
		cfg.ManagerURL = *managerURL
	}
	if *token != "" {
		cfg.RegistrationToken = *token
	}

	// Ensure we have an agent ID
	if cfg.AgentID == "" {
		cfg.AgentID = uuid.New().String()
	}
	
	// Save config if we have a path or create a default one
	if *configPath == "" && cfg.Registered {
		// Use default config path for registered agents
		*configPath = filepath.Join(getDefaultConfigDir(), "agent-config.json")
	}
	if *configPath != "" {
		if err := cfg.Save(*configPath); err != nil {
			logger.Warn().Err(err).Msg("Failed to save config")
		} else {
			logger.Info().Str("path", *configPath).Msg("Config saved")
		}
	}

	// Ensure identity (SSH keys)
	identity, err := identity.EnsureIdentity(cfg.SSHPrivateKeyPath, cfg.SSHPublicKeyPath, cfg.AgentID)
	if err != nil {
		logger.Fatal().Err(err).Msg("Failed to ensure identity")
	}
	identity.AgentID = cfg.AgentID

	// Create agent
	agent := &Agent{
		config:     cfg,
		identity:   identity,
		logger:     logger,
		logLevel:   &currentLevel,
		configPath: *configPath,
	}

	// Initialize Git sync only if not in standalone mode
	if !*standalone {
		// Construct Git SSH URL from manager URL
		// Extract host from manager URL (e.g., ws://localhost:3000 -> localhost)
		var gitURL string
		managerURL := cfg.ManagerURL
		managerURL = strings.Replace(managerURL, "ws://", "", 1)
		managerURL = strings.Replace(managerURL, "wss://", "", 1)
		managerURL = strings.Replace(managerURL, "http://", "", 1)
		managerURL = strings.Replace(managerURL, "https://", "", 1)

		// Remove port if present (we'll use SSH port 2223)
		host := strings.Split(managerURL, ":")[0]
		gitURL = fmt.Sprintf("ssh://git@%s:2223/config-repo", host)

		// Set default config repo path if not specified
		if cfg.ConfigRepoPath == "" {
			cfg.ConfigRepoPath = filepath.Join(getDefaultConfigDir(), "config-repo")
		}

		agent.gitSync = gitsync.New(cfg.ConfigRepoPath, gitURL, cfg.AgentID, cfg.SSHPrivateKeyPath, logger)

		// Initialize the git repository
		if err := agent.gitSync.Initialize(); err != nil {
			logger.Error().Err(err).Msg("Failed to initialize git repository")
			// Continue without git sync
			agent.gitSync = nil
		} else {
			// Setup git config
			agent.gitSync.SetupGitConfig()

			// Handle merge workflow
			if *mergeConfig {
				logger.Info().Msg("Starting interactive configuration merge...")

				// Check current state
				hasLocal, _ := agent.gitSync.HasLocalChanges()
				hasDiverged, _ := agent.gitSync.HasDiverged()

				if !hasLocal && !hasDiverged {
					logger.Info().Msg("No changes to merge - configurations are in sync")
					return
				}

				logger.Info().Msg("STEP 1: Backing up local changes...")
				if hasLocal {
					if err := agent.gitSync.BackupLocalChanges(); err != nil {
						logger.Error().Err(err).Msg("Failed to backup local changes")
						return
					}
				}

				logger.Info().Msg("STEP 2: Pulling remote changes...")
				if err := agent.gitSync.Pull(); err != nil {
					logger.Error().Err(err).Msg("Failed to pull remote changes")
					logger.Info().Msg("Your changes are safe in backup. Use -list-backups to see them")
					return
				}

				if hasLocal {
					logger.Info().Msg("STEP 3: Applying your local changes on top...")
					if err := agent.gitSync.RecoverBackup("latest"); err != nil {
						logger.Warn().Err(err).Msg("Automatic merge failed - manual resolution needed")
						logger.Info().Msg("Your changes are in stash. Manual steps:")
						logger.Info().Msg("  1. cd " + agent.config.ConfigRepoPath)
						logger.Info().Msg("  2. git stash pop")
						logger.Info().Msg("  3. Resolve any conflicts")
						logger.Info().Msg("  4. git add -A && git commit -m 'Merged configs'")
						logger.Info().Msg("  5. Use -push-config to save to manager")
					} else {
						logger.Info().Msg("✅ Changes merged successfully!")
						logger.Info().Msg("Review the merged configuration and use -push-config to save to manager")
					}
				} else {
					logger.Info().Msg("✅ Remote changes pulled successfully")
				}

				return
			}

			// Handle backup operations
			if *listBackups {
				logger.Info().Msg("Listing available configuration backups...")
				if backups, err := agent.gitSync.ListBackups(); err == nil {
					if len(backups) == 0 {
						logger.Info().Msg("No backups found")
					} else {
						logger.Info().Msg("Available backups:")
						for _, backup := range backups {
							fmt.Println("  " + backup)
						}
						logger.Info().Msg("Use -recover-backup <ID> to restore a backup")
					}
				} else {
					logger.Error().Err(err).Msg("Failed to list backups")
				}
				return
			}

			if *recoverBackup != "" {
				backupToRecover := *recoverBackup
				// If just the flag is provided without value, use "latest"
				if backupToRecover == "true" {
					backupToRecover = "latest"
				}
				logger.Info().Str("backup", backupToRecover).Msg("Recovering from backup...")
				if err := agent.gitSync.RecoverBackup(backupToRecover); err != nil {
					logger.Error().Err(err).Msg("Failed to recover backup")
					logger.Info().Msg("Try -list-backups to see available backups")
				} else {
					logger.Info().Msg("✅ Backup recovered successfully")
					logger.Info().Msg("Review changes and use -push-config to save to manager if desired")
				}
				return
			}

			// Check for local changes if requested
			if *checkChanges || *pushConfig {
				hasUncommittedChanges, _ := agent.gitSync.HasLocalChanges()
				hasCommitsAhead, _ := agent.gitSync.HasCommitsAhead()

				if hasUncommittedChanges {
					logger.Warn().Msg("⚠️  UNCOMMITTED CONFIGURATION CHANGES DETECTED")
					logger.Warn().Msg("Changes will be automatically backed up before sync")
					logger.Warn().Msg("Use -push-config to save to manager, or -list-backups to see backups")

					if diff, err := agent.gitSync.GetDiff(); err == nil && diff != "" {
						logger.Info().Msg("Local changes:")
						fmt.Println(diff)
					}
				}

				if hasCommitsAhead {
					logger.Warn().Msg("⚠️  LOCAL COMMITS AHEAD OF REMOTE")
					logger.Warn().Msg("Use -push-config to push to manager")
				}

				if *pushConfig {
					if hasUncommittedChanges || hasCommitsAhead {
						logger.Info().Msg("Pushing local changes to manager...")

						// Track if push was successful
						pushSuccessful := false

						// Save current config to git repo if there are uncommitted changes
						if hasUncommittedChanges {
							configData := make(map[string]interface{})
							if configJSON, err := json.Marshal(cfg); err == nil {
								json.Unmarshal(configJSON, &configData)
								if err := agent.gitSync.SaveAgentConfig(configData); err != nil {
									logger.Error().Err(err).Msg("Failed to save config to repository")
								}
							}

							// Commit changes
							commitMsg := fmt.Sprintf("Agent %s: Push local configuration changes", cfg.AgentID)
							if err := agent.gitSync.CommitLocalChanges(commitMsg); err != nil {
								logger.Error().Err(err).Msg("❌ Failed to commit changes")
								logger.Error().Msg("Push failed. Please review the errors above and try again.")
								os.Exit(1)
							}
						}

						// Push to remote
						if err := agent.gitSync.Push(); err != nil {
							logger.Error().Err(err).Msg("❌ Failed to push changes to manager")
							logger.Error().Msg("Push failed. Please review the errors above and try again.")
							os.Exit(1)
						} else {
							logger.Info().Msg("✅ Configuration successfully pushed to manager")
							pushSuccessful = true
						}

						// Exit with appropriate status
						if pushSuccessful {
							return
						}
					} else {
						logger.Info().Msg("No local changes to push.")
						return
					}
				} else if *checkChanges {
					if !hasUncommittedChanges && !hasCommitsAhead {
						logger.Info().Msg("No local configuration changes detected")
					}
				}

				// Exit if we were just checking
				if *checkChanges && !*pushConfig {
					return
				}
			}

			// Check for divergence before pulling
			if diverged, _ := agent.gitSync.HasDiverged(); diverged {
				logger.Warn().Msg("⚠️  CONFIGURATION DIVERGENCE DETECTED")
				logger.Warn().Msg("Both local and remote have changes - merge may be needed")
				fmt.Println(agent.gitSync.GetMergeInstructions())
			}

			// Pull latest config (this may overwrite local changes)
			if err := agent.gitSync.Pull(); err != nil {
				logger.Error().Err(err).Msg("Failed to pull from git repository")
			}

			// Load configuration from git repository (regardless of pull success/failure)
			gitConfig, err := agent.gitSync.LoadAgentConfig()
			if err == nil && gitConfig != nil {
				// Update fileBrowserSettings from git config
				if fbs, ok := gitConfig["fileBrowserSettings"].(map[string]interface{}); ok {
					if fbsData, err := json.Marshal(fbs); err == nil {
						var fileBrowserSettings config.FileBrowserSettings
						if err := json.Unmarshal(fbsData, &fileBrowserSettings); err == nil {
							agent.config.FileBrowserSettings = fileBrowserSettings
							logger.Info().Int("allowedPaths", len(fileBrowserSettings.AllowedPaths)).Bool("enabled", fileBrowserSettings.Enabled).Msg("Loaded fileBrowserSettings from git")
						}
					}
				}

				// Load other git-managed settings here if needed...
			}
		}
	} else {
		logger.Info().Msg("Running in standalone mode - Git sync disabled")
	}
	
	// Initialize workflow executor
	executor, err := workflow.NewExecutor(cfg.StateFilePath, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("Failed to create workflow executor")
	}
	agent.executor = executor
	
	// Set alert handler to forward alerts to manager
	executor.SetAlertHandler(func(level, message string, details map[string]interface{}) {
		agent.sendAlert(level, message, details)
	})
	
	// Initialize file watcher with workflow executor adapter
	workflowAdapter := &workflowExecutorAdapter{
		executor: executor,
		logger:   logger,
	}
	agent.fileWatcher = filewatcher.NewWatcher(logger, workflowAdapter)
	
	// Load file watcher rules from config if any exist
	agent.loadFileWatcherRules()

	// Initialize SSH server
	sshServer, err := sshserver.New(cfg.SSHServerPort, cfg.SSHPrivateKeyPath, cfg.AuthorizedSSHKeys, logger)
	if err != nil {
		logger.Error().Err(err).Msg("Failed to create SSH server")
	} else {
		agent.sshServer = sshServer
		go func() {
			if err := sshServer.Start(); err != nil {
				logger.Error().Err(err).Msg("SSH server stopped")
			}
		}()
		logger.Info().Int("port", cfg.SSHServerPort).Msg("SSH server started")
	}

	// Start health endpoint
	go agent.startHealthEndpoint()

	// Start WebSocket client only if not in standalone mode
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if !*standalone {
		agent.wsClient = websocket.NewClient(cfg.ManagerURL, cfg.AgentID, logger)

		// Set up message handlers
		agent.wsClient.OnMessage(agent.handleMessage)
		agent.wsClient.OnConnect(agent.handleConnect)
		agent.wsClient.OnDisconnect(agent.handleDisconnect)

		// Start WebSocket connection in background
		go agent.wsClient.Start(ctx)

		logger.Info().
			Str("agentId", cfg.AgentID).
			Str("managerUrl", cfg.ManagerURL).
			Msg("Agent connected to manager")
	} else {
		logger.Info().Msg("Running in standalone mode - Manager connection disabled")
	}

	// Load workflows from config if any exist
	if len(cfg.Workflows) > 0 {
		agent.executor.LoadWorkflows(cfg.Workflows)
		go agent.executor.Start()
		logger.Info().Int("count", len(cfg.Workflows)).Msg("Loaded workflows from configuration")
	}

	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	if *standalone {
		logger.Info().
			Str("agentId", cfg.AgentID).
			Bool("standalone", true).
			Str("configPath", *configPath).
			Int("workflows", len(cfg.Workflows)).
			Msg("Agent started in STANDALONE mode")
	} else {
		logger.Info().
			Str("agentId", cfg.AgentID).
			Str("managerUrl", cfg.ManagerURL).
			Msg("Agent started")
	}

	<-sigChan
	logger.Info().Msg("Shutting down agent")
	
	// Stop file watcher if running
	if agent.fileWatcher != nil {
		agent.fileWatcher.Stop()
	}
	
	cancel()
}

func (a *Agent) startHealthEndpoint() {
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "ok",
			"agentId": a.config.AgentID,
			"time":    time.Now().Unix(),
		})
	})

	http.HandleFunc("/info", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"agentId":   a.config.AgentID,
			"publicKey": a.identity.PublicKey,
			"workflows": len(a.config.Workflows),
			"sshPort":   a.config.SSHServerPort,
		})
	})

	// Register API endpoints for logs, metrics, and workflow data
	apiServer := api.NewServer(a.config, a.executor, a.logger, a.logLevel)
	apiServer.RegisterHandlers()

	// Register file browser endpoints (if enabled)
	fileBrowser := filebrowser.New(a.config, a.logger)
	fileBrowser.RegisterHandlers()

	a.logger.Info().Msg("Agent API listening on :8088")
	a.logger.Info().Msg("  GET /healthz - Health check")
	a.logger.Info().Msg("  GET /info - Agent information")
	a.logger.Info().Msg("  GET /api/logs?page=1&pageSize=100&level=error&search=query - Paginated logs")
	a.logger.Info().Msg("  GET /api/logs/download?level=error&limit=5000 - Download logs")
	a.logger.Info().Msg("  GET /api/workflows/executions - Workflow execution history")
	a.logger.Info().Msg("  GET /api/workflows/state - Current workflow state")
	a.logger.Info().Msg("  GET /api/metrics - Agent metrics")
	a.logger.Info().Msg("  GET /api/loglevel - Get current log level")
	a.logger.Info().Msg("  POST /api/loglevel {\"level\":\"debug\"} - Change log level")

	// Log file browser status
	if a.config.FileBrowserSettings.Enabled {
		a.logger.Info().Msg("  📁 File Browser: ENABLED")
		a.logger.Info().Msg("    GET /api/files/browse?path=/path - Browse directory")
		a.logger.Info().Msg("    GET /api/files/download?path=/file - Download file")
		a.logger.Info().Msg("    POST /api/files/upload - Upload file")
		a.logger.Info().Msg("    POST /api/files/mkdir?path=/path - Create directory")
		a.logger.Info().Msg("    DELETE /api/files/delete?path=/path - Delete file/folder")
	} else {
		a.logger.Info().Msg("  📁 File Browser: DISABLED (set fileBrowserSettings.enabled=true to enable)")
	}

	if err := http.ListenAndServe(":8088", nil); err != nil {
		a.logger.Error().Err(err).Msg("Agent API server failed")
	}
}

func (a *Agent) handleConnect() {
	a.wsConnected = true
	a.logger.Info().Msg("Connected to manager")

	if a.config.Registered {
		// Already registered, just send a reconnection message with our ID and public key
		if err := a.wsClient.SendReconnection(a.identity.PublicKey); err != nil {
			a.logger.Error().Err(err).Msg("Failed to send reconnection")
		} else {
			a.logger.Info().Msg("Reconnection sent for registered agent")
		}
	} else if a.config.RegistrationToken != "" {
		// New agent with token - send registration
		if err := a.wsClient.SendRegistration(a.identity.PublicKey, a.config.RegistrationToken); err != nil {
			a.logger.Error().Err(err).Msg("Failed to send registration")
		} else {
			a.logger.Info().Msg("Registration sent")
		}
	} else {
		a.logger.Warn().Msg("Not registered and no token provided - agent will not be authenticated")
	}
}

func (a *Agent) handleDisconnect() {
	a.wsConnected = false
	a.logger.Warn().Msg("Disconnected from manager - will attempt reconnection")
}

func (a *Agent) handleMessage(msgType websocket.MessageType, payload json.RawMessage) {
	a.logger.Debug().
		Str("type", string(msgType)).
		RawJSON("payload", payload).
		Msg("Received message")

	switch msgType {
	case websocket.MessageTypeCommand:
		a.handleCommand(payload)
	case websocket.MessageTypeConfig:
		a.handleConfigUpdate(payload)
	case websocket.MessageTypeRegistration:
		// Registration response
		var resp struct {
			Success bool   `json:"success"`
			Error   string `json:"error,omitempty"`
			AgentID string `json:"agentId,omitempty"`
		}
		if err := json.Unmarshal(payload, &resp); err == nil {
			if resp.Success {
				a.logger.Info().Str("agentId", resp.AgentID).Msg("Registration confirmed")
				// Clear the token after successful registration
				a.config.RegistrationToken = ""
				a.config.Registered = true
				// Save the config to persist registration state
				savePath := a.configPath
				if savePath == "" {
					// Use default config path if not specified
					savePath = filepath.Join(getDefaultConfigDir(), "agent-config.json")
					a.configPath = savePath
				}
				if err := a.config.Save(savePath); err != nil {
					a.logger.Error().Err(err).Msg("Failed to save registration state")
				} else {
					a.logger.Info().Str("path", savePath).Msg("Registration state saved")
				}
			} else {
				a.logger.Error().Str("error", resp.Error).Msg("Registration failed")
			}
		}
	case "reconnection":
		// Reconnection response
		var resp struct {
			Success bool   `json:"success"`
			Error   string `json:"error,omitempty"`
			AgentID string `json:"agentId,omitempty"`
		}
		if err := json.Unmarshal(payload, &resp); err == nil {
			if resp.Success {
				a.logger.Info().Str("agentId", resp.AgentID).Msg("Reconnection confirmed")
			} else {
				a.logger.Error().Str("error", resp.Error).Msg("Reconnection failed")
				// If reconnection fails, we might need to re-register
				if resp.Error == "Agent not found - registration required" {
					a.config.Registered = false
					a.logger.Warn().Msg("Agent needs to re-register - please provide a new token")
				}
			}
		}
	case "heartbeat_ack":
		// Heartbeat acknowledgment - just log at debug level
		a.logger.Debug().Msg("Heartbeat acknowledged")
	default:
		a.logger.Warn().Str("type", string(msgType)).Msg("Unknown message type")
	}
}

func (a *Agent) handleCommand(payload json.RawMessage) {
	var cmd struct {
		Command string                 `json:"command"`
		Args    map[string]interface{} `json:"args"`
	}
	
	if err := json.Unmarshal(payload, &cmd); err != nil {
		a.logger.Error().Err(err).Msg("Failed to parse command")
		return
	}

	a.logger.Info().Str("command", cmd.Command).Msg("Executing command")

	switch cmd.Command {
	case "reload-config":
		if err := a.reloadConfig(); err != nil {
			a.logger.Error().Err(err).Msg("Failed to reload config")
			a.wsClient.SendStatus("error", map[string]interface{}{
				"error": err.Error(),
			})
		} else {
			// Reload workflows after config reload
			a.reloadWorkflows()
			a.wsClient.SendStatus("config-reloaded", nil)
		}
	case "remove-workflow":
		// Handle workflow removal
		workflowId, ok := cmd.Args["workflowId"].(string)
		if !ok {
			a.logger.Error().Msg("Invalid workflowId in remove-workflow command")
			return
		}
		
		a.logger.Info().Str("workflowId", workflowId).Msg("Removing workflow")
		
		// Remove workflow from config
		newWorkflows := []config.Workflow{}
		removed := false
		for _, w := range a.config.Workflows {
			if w.ID != workflowId {
				newWorkflows = append(newWorkflows, w)
			} else {
				removed = true
			}
		}
		
		if removed {
			a.config.Workflows = newWorkflows

			// Reload workflows
			// Note: Workflows are Git-managed, not saved to local config
			a.reloadWorkflows()
			a.wsClient.SendStatus("workflow-removed", map[string]interface{}{
				"workflowId": workflowId,
			})
		} else {
			a.logger.Warn().Str("workflowId", workflowId).Msg("Workflow not found for removal")
		}
	case "reload-filewatcher":
		a.logger.Info().Msg("Reloading file watcher rules")
		a.loadFileWatcherRules()
		a.wsClient.SendStatus("filewatcher-reloaded", nil)
	case "git-pull":
		a.logger.Info().Msg("Pulling configuration from Git")
		if a.gitSync != nil {
			// Check for local changes before pulling
			if hasChanges, err := a.gitSync.HasLocalChanges(); err == nil && hasChanges {
				a.logger.Warn().Msg("⚠️  LOCAL CHANGES DETECTED - Will be backed up automatically")
				a.logger.Info().Msg("Changes will be saved to git stash or backup branch")
				a.logger.Info().Msg("Use -list-backups to see backups, -recover-backup to restore")
			}

			if err := a.gitSync.Pull(); err != nil {
				a.logger.Error().Err(err).Msg("Git pull failed")
				a.wsClient.SendStatus("error", map[string]interface{}{
					"command": "git-pull",
					"error": err.Error(),
				})
			} else {
				a.logger.Info().Msg("Git pull successful, reloading configuration")
				
				// Load config from git repository
				gitConfig, err := a.gitSync.LoadAgentConfig()
				if err != nil {
					a.logger.Error().Err(err).Msg("Failed to load config from git")
					a.wsClient.SendStatus("error", map[string]interface{}{
						"command": "git-pull",
						"error": "Failed to load config from git",
					})
				} else if gitConfig != nil {
					updated := false

					// Update workflows from git config
					if workflows, ok := gitConfig["workflows"].([]interface{}); ok {
						a.config.Workflows = []config.Workflow{}
						for _, w := range workflows {
							if workflowData, err := json.Marshal(w); err == nil {
								var workflow config.Workflow
								if err := json.Unmarshal(workflowData, &workflow); err == nil {
									a.config.Workflows = append(a.config.Workflows, workflow)
								}
							}
						}
						updated = true
					}

					// Update fileWatcherSettings from git config
					if fwSettings, ok := gitConfig["fileWatcherSettings"].(map[string]interface{}); ok {
						if settingsData, err := json.Marshal(fwSettings); err == nil {
							var settings config.FileWatcherSettings
							if err := json.Unmarshal(settingsData, &settings); err == nil {
								a.config.FileWatcherSettings = settings
								a.logger.Info().
									Str("scanDir", settings.ScanDir).
									Bool("scanSubDir", settings.ScanSubDir).
									Msg("Updated file watcher settings from git")
								updated = true

								// Update file watcher with new settings
								if a.fileWatcher != nil {
									a.fileWatcher.SetGlobalSettings(settings.ScanDir, settings.ScanSubDir)
								}
							}
						}
					}

					// Update fileWatcherRules from git config
					if fwRules, ok := gitConfig["fileWatcherRules"].([]interface{}); ok {
						a.loadFileWatcherRulesFromGit(fwRules)
						updated = true
					}

					if updated {
						// Reload workflows
						// Note: Managed settings are not saved to local config
						a.reloadWorkflows()

						a.logger.Info().
							Int("workflows", len(a.config.Workflows)).
							Msg("Loaded configuration from git")
						a.wsClient.SendStatus("git-pulled", map[string]interface{}{
							"workflows": len(a.config.Workflows),
							"fileWatcherSettings": a.config.FileWatcherSettings,
						})
					} else {
						a.logger.Info().Msg("No updates found in git config")
						a.wsClient.SendStatus("git-pulled", map[string]interface{}{
							"message": "No updates",
						})
					}
				} else {
					a.logger.Warn().Msg("No agent config found in git repository")
					a.wsClient.SendStatus("git-pulled", map[string]interface{}{
						"workflows": 0,
						"message": "No config found in repository",
					})
				}
			}
		} else {
			a.logger.Warn().Msg("Git sync not initialized")
			a.wsClient.SendStatus("error", map[string]interface{}{
				"command": "git-pull",
				"error": "Git sync not initialized",
			})
		}
	case "set-log-level":
		// Get level from command payload (could be in Args or directly in command)
		var level string
		if cmd.Args != nil {
			if levelVal, ok := cmd.Args["level"].(string); ok {
				level = levelVal
			}
		}
		// Also check if level was passed directly in the command struct
		if level == "" {
			// Parse the full payload to check for level field
			var fullCmd struct {
				Command string `json:"command"`
				Level   string `json:"level"`
			}
			if err := json.Unmarshal(payload, &fullCmd); err == nil && fullCmd.Level != "" {
				level = fullCmd.Level
			}
		}

		if level == "" {
			a.logger.Error().Msg("No log level specified in set-log-level command")
			a.wsClient.SendStatus("error", map[string]interface{}{
				"command": "set-log-level",
				"error": "No log level specified",
			})
			return
		}

		// Parse and set the log level
		var newLevel zerolog.Level
		switch strings.ToLower(level) {
		case "debug":
			newLevel = zerolog.DebugLevel
		case "info":
			newLevel = zerolog.InfoLevel
		case "warn", "warning":
			newLevel = zerolog.WarnLevel
		case "error":
			newLevel = zerolog.ErrorLevel
		default:
			a.logger.Error().Str("level", level).Msg("Invalid log level")
			a.wsClient.SendStatus("error", map[string]interface{}{
				"command": "set-log-level",
				"error": fmt.Sprintf("Invalid log level: %s", level),
			})
			return
		}

		// Update the log level
		*a.logLevel = newLevel
		a.logger = a.logger.Level(newLevel)

		a.logger.Info().Str("level", level).Msg("🔧 Log level changed")
		a.wsClient.SendStatus("log-level-set", map[string]interface{}{
			"level": level,
		})
	default:
		a.logger.Warn().Str("command", cmd.Command).Msg("Unknown command")
	}
}

func (a *Agent) handleConfigUpdate(payload json.RawMessage) {
	var update struct {
		Config *config.Config `json:"config"`
		ConfigPath string `json:"configPath"`
	}
	
	if err := json.Unmarshal(payload, &update); err != nil {
		a.logger.Error().Err(err).Msg("Failed to parse config update")
		return
	}

	a.logger.Info().Msg("Config update received")
	
	// If full config provided, update it
	if update.Config != nil {
		// Update workflows
		a.config.Workflows = update.Config.Workflows
		a.config.SSHServerPort = update.Config.SSHServerPort
		a.config.AuthorizedSSHKeys = update.Config.AuthorizedSSHKeys
		a.config.ConfigRepoPath = update.Config.ConfigRepoPath

		// Note: Managed settings (workflows, SSH settings) should come from Git only
		// This WebSocket update path may need to be restricted to local settings only

		// Reload workflows
		a.reloadWorkflows()

		a.wsClient.SendStatus("config-updated", nil)
	} else if update.ConfigPath != "" {
		// Legacy path-based update
		a.logger.Info().Str("path", update.ConfigPath).Msg("Config path update")
		if err := a.reloadConfig(); err != nil {
			a.logger.Error().Err(err).Msg("Failed to reload config")
		}
	}
}

func (a *Agent) reloadConfig() error {
	// First pull from git if available
	if a.gitSync != nil {
		a.logger.Info().Msg("Pulling latest config from git")
		if err := a.gitSync.Pull(); err != nil {
			a.logger.Error().Err(err).Msg("Failed to pull from git")
			// Continue with local config
		}

		// Load config from git repository (regardless of pull success/failure)
		gitConfig, err := a.gitSync.LoadAgentConfig()
		if err != nil {
			a.logger.Error().Err(err).Msg("Failed to load config from git")
		} else if gitConfig != nil {
			updated := false

			// Update workflows from git config
			if workflows, ok := gitConfig["workflows"].([]interface{}); ok {
				a.config.Workflows = []config.Workflow{}
				for _, w := range workflows {
					if workflowData, err := json.Marshal(w); err == nil {
						var workflow config.Workflow
						if err := json.Unmarshal(workflowData, &workflow); err == nil {
							a.config.Workflows = append(a.config.Workflows, workflow)
						}
					}
				}
				updated = true
				a.logger.Info().Int("count", len(a.config.Workflows)).Msg("Loaded workflows from git")
			}

			// Update fileBrowserSettings from git config
			if fbs, ok := gitConfig["fileBrowserSettings"].(map[string]interface{}); ok {
				if fbsData, err := json.Marshal(fbs); err == nil {
					var fileBrowserSettings config.FileBrowserSettings
					if err := json.Unmarshal(fbsData, &fileBrowserSettings); err == nil {
						a.config.FileBrowserSettings = fileBrowserSettings
						updated = true
						a.logger.Info().Int("allowedPaths", len(fileBrowserSettings.AllowedPaths)).Msg("Loaded fileBrowserSettings from git")
					}
				}
			}

			// Update logSettings from git config
			if ls, ok := gitConfig["logSettings"].(map[string]interface{}); ok {
				if lsData, err := json.Marshal(ls); err == nil {
					var logSettings config.LogSettings
					if err := json.Unmarshal(lsData, &logSettings); err == nil {
						a.config.LogSettings = logSettings
						updated = true
						a.logger.Info().Msg("Loaded logSettings from git")
					}
				}
			}

			// Update fileWatcherSettings from git config
			if fws, ok := gitConfig["fileWatcherSettings"].(map[string]interface{}); ok {
				if fwsData, err := json.Marshal(fws); err == nil {
					var fileWatcherSettings config.FileWatcherSettings
					if err := json.Unmarshal(fwsData, &fileWatcherSettings); err == nil {
						a.config.FileWatcherSettings = fileWatcherSettings
						updated = true
						a.logger.Info().Msg("Loaded fileWatcherSettings from git")
					}
				}
			}

			// Update sshServerPort from git config
			if port, ok := gitConfig["sshServerPort"].(float64); ok {
				a.config.SSHServerPort = int(port)
				updated = true
				a.logger.Info().Int("port", int(port)).Msg("Loaded sshServerPort from git")
			}

			// Update authorizedSSHKeys from git config
			if keys, ok := gitConfig["authorizedSSHKeys"].([]interface{}); ok {
				a.config.AuthorizedSSHKeys = []string{}
				for _, k := range keys {
					if key, ok := k.(string); ok {
						a.config.AuthorizedSSHKeys = append(a.config.AuthorizedSSHKeys, key)
					}
				}
				updated = true
				a.logger.Info().Int("count", len(a.config.AuthorizedSSHKeys)).Msg("Loaded authorizedSSHKeys from git")
			}

			if updated {
				// Note: Managed settings are not saved to local config
				return nil
			}
		}
	}

	// Fallback to local config
	configPath := a.configPath
	if configPath == "" {
		if a.config.ConfigRepoPath != "" {
			configPath = filepath.Join(a.config.ConfigRepoPath, "agent.json")
		} else {
			// No config file path available, nothing to reload
			a.logger.Warn().Msg("No config file path available for reload")
			return nil
		}
	}
	
	// Check if the file exists before trying to reload
	if !fileExists(configPath) {
		a.logger.Warn().Str("path", configPath).Msg("Config file does not exist, skipping reload")
		return nil
	}
	
	return a.config.Reload(configPath)
}

func (a *Agent) reloadWorkflows() {
	if a.executor != nil && a.config != nil {
		a.logger.Info().Int("count", len(a.config.Workflows)).Msg("Reloading workflows")
		
		// Stop existing executor
		a.executor.Stop()
		
		// Load new workflows
		if len(a.config.Workflows) > 0 {
			a.executor.LoadWorkflows(a.config.Workflows)
			go a.executor.Start()
		}
	}
	
	// Also update SSH authorized keys
	if a.sshServer != nil && a.config != nil {
		a.sshServer.UpdateAuthorizedKeys(a.config.AuthorizedSSHKeys)
	}
}

func (a *Agent) sendAlert(level, message string, details map[string]interface{}) {
	alertPayload := map[string]interface{}{
		"level":     level,
		"message":   message,
		"details":   details,
		"timestamp": time.Now().Format(time.RFC3339),
		"agent_id":  a.config.AgentID,
	}

	if a.wsClient == nil || !a.wsConnected {
		// In standalone mode or disconnected - save alerts locally
		a.logger.Warn().
			Str("level", level).
			Str("message", message).
			Interface("details", details).
			Msg("Alert (local only - no manager connection)")

		// Save alert to local file for later retrieval
		a.saveLocalAlert(alertPayload)
		return
	}

	if err := a.wsClient.SendMessage("alert", alertPayload); err != nil {
		a.logger.Error().Err(err).Msg("Failed to send alert to manager")
		// Also save locally on failure
		a.saveLocalAlert(alertPayload)
	} else {
		a.logger.Info().
			Str("level", level).
			Str("message", message).
			Msg("Alert sent to manager")
	}
}

func (a *Agent) saveLocalAlert(alert map[string]interface{}) {
	alertsPath := filepath.Join(getDefaultConfigDir(), "alerts.json")

	// Read existing alerts
	var alerts []map[string]interface{}
	if data, err := os.ReadFile(alertsPath); err == nil {
		json.Unmarshal(data, &alerts)
	}

	// Append new alert
	alerts = append(alerts, alert)

	// Keep only last 1000 alerts
	if len(alerts) > 1000 {
		alerts = alerts[len(alerts)-1000:]
	}

	// Save back to file
	if data, err := json.MarshalIndent(alerts, "", "  "); err == nil {
		os.WriteFile(alertsPath, data, 0600)
	}
}

func (a *Agent) loadFileWatcherRulesFromGit(rulesInterface []interface{}) {
	if a.fileWatcher == nil {
		return
	}

	var rules []filewatcher.Rule
	for _, r := range rulesInterface {
		if ruleData, err := json.Marshal(r); err == nil {
			var rule filewatcher.Rule
			if err := json.Unmarshal(ruleData, &rule); err == nil {
				rules = append(rules, rule)
			}
		}
	}

	if len(rules) > 0 {
		a.logger.Info().Int("count", len(rules)).Msg("Loading file watcher rules from git")
		a.fileWatcher.UpdateRules(rules)
		go a.fileWatcher.Start()
	}
}

func (a *Agent) loadFileWatcherRules() {
	if a.fileWatcher == nil {
		return
	}

	// Set global settings if available
	if a.config.FileWatcherSettings.ScanDir != "" {
		a.fileWatcher.SetGlobalSettings(
			a.config.FileWatcherSettings.ScanDir,
			a.config.FileWatcherSettings.ScanSubDir,
		)
	}

	// Stop existing watcher
	a.fileWatcher.Stop()

	// Load rules from git config if available
	var rules []filewatcher.Rule

	if a.gitSync != nil {
		gitConfig, err := a.gitSync.LoadAgentConfig()
		if err == nil && gitConfig != nil {
			if fileWatcherRules, ok := gitConfig["fileWatcherRules"].([]interface{}); ok {
				for _, r := range fileWatcherRules {
					if ruleData, err := json.Marshal(r); err == nil {
						var rule filewatcher.Rule
						if err := json.Unmarshal(ruleData, &rule); err == nil {
							rules = append(rules, rule)
						}
					}
				}
			}
		}
	}
	
	// Fallback to local config
	if len(rules) == 0 && a.config != nil {
		if configData, ok := a.config.Extra["fileWatcherRules"].([]interface{}); ok {
			for _, r := range configData {
				if ruleData, err := json.Marshal(r); err == nil {
					var rule filewatcher.Rule
					if err := json.Unmarshal(ruleData, &rule); err == nil {
						rules = append(rules, rule)
					}
				}
			}
		}
	}
	
	if len(rules) > 0 {
		a.logger.Info().Int("count", len(rules)).Msg("Loading file watcher rules")
		a.fileWatcher.UpdateRules(rules)
		go a.fileWatcher.Start()
	} else {
		a.logger.Debug().Msg("No file watcher rules configured")
	}
}

// workflowExecutorAdapter adapts the workflow executor for use by the file watcher
type workflowExecutorAdapter struct {
	executor *workflow.Executor
	logger   zerolog.Logger
}

func (w *workflowExecutorAdapter) ExecuteWorkflow(name string, context map[string]interface{}) error {
	w.logger.Info().
		Str("workflow", name).
		Interface("context", context).
		Msg("Executing workflow from file watcher")

	// Find the workflow by name
	for _, wf := range w.executor.GetWorkflows() {
		if wf.Name == name {
			// Create a trigger event for the workflow
			trigger := workflow.TriggerEvent{
				Type: "filewatcher",
				Data: context,
			}

			// Execute the workflow
			return w.executor.ExecuteWorkflow(wf.ID, trigger)
		}
	}

	return fmt.Errorf("workflow '%s' not found", name)
}

func (w *workflowExecutorAdapter) ExecuteWorkflowSync(name string, context map[string]interface{}) error {
	w.logger.Info().
		Str("workflow", name).
		Interface("context", context).
		Msg("Executing workflow synchronously from file watcher")

	// Find the workflow by name
	for _, wf := range w.executor.GetWorkflows() {
		if wf.Name == name {
			// Create a trigger event for the workflow
			trigger := workflow.TriggerEvent{
				Type: "filewatcher",
				Data: context,
			}

			// Execute the workflow synchronously (waits for completion)
			return w.executor.ExecuteWorkflowSync(wf.ID, trigger)
		}
	}

	return fmt.Errorf("workflow '%s' not found", name)
}