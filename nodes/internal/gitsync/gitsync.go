package gitsync

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

type GitSync struct {
	repoPath   string
	remoteURL  string
	agentID    string
	logger     zerolog.Logger
}

func New(repoPath, remoteURL, agentID string, logger zerolog.Logger) *GitSync {
	return &GitSync{
		repoPath:  repoPath,
		remoteURL: remoteURL,
		agentID:   agentID,
		logger:    logger.With().Str("component", "gitsync").Logger(),
	}
}

// Initialize clones the repository if it doesn't exist
func (g *GitSync) Initialize() error {
	// Check if repo already exists
	if _, err := os.Stat(filepath.Join(g.repoPath, ".git")); err == nil {
		g.logger.Info().Msg("Git repository already exists")
		return nil
	}

	// Create repo directory if it doesn't exist
	if err := os.MkdirAll(g.repoPath, 0755); err != nil {
		return fmt.Errorf("failed to create repo directory: %w", err)
	}

	// Clone the repository
	g.logger.Info().Str("url", g.remoteURL).Str("path", g.repoPath).Msg("Cloning repository")
	cmd := exec.Command("git", "clone", g.remoteURL, g.repoPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git clone failed: %w - output: %s", err, string(output))
	}

	g.logger.Info().Msg("Repository cloned successfully")
	return nil
}

// Pull fetches and merges latest changes from remote
func (g *GitSync) Pull() error {
	// First, ensure we're in the repo directory
	if _, err := os.Stat(filepath.Join(g.repoPath, ".git")); err != nil {
		// Repository doesn't exist, initialize it
		if err := g.Initialize(); err != nil {
			return fmt.Errorf("failed to initialize repository: %w", err)
		}
	}

	// Check for local changes and back them up if present
	if hasChanges, _ := g.HasLocalChanges(); hasChanges {
		if err := g.BackupLocalChanges(); err != nil {
			g.logger.Warn().Err(err).Msg("Failed to backup local changes, proceeding with caution")
		}
	}

	// Fetch latest changes
	g.logger.Info().Msg("Fetching latest changes")
	cmd := exec.Command("git", "-C", g.repoPath, "fetch", "origin")
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git fetch failed: %w - output: %s", err, string(output))
	}

	// Reset to origin/main (or master)
	branch := "main"
	cmd = exec.Command("git", "-C", g.repoPath, "reset", "--hard", fmt.Sprintf("origin/%s", branch))
	if _, err := cmd.CombinedOutput(); err != nil {
		// Try master branch if main doesn't exist
		branch = "master"
		cmd = exec.Command("git", "-C", g.repoPath, "reset", "--hard", fmt.Sprintf("origin/%s", branch))
		if output2, err2 := cmd.CombinedOutput(); err2 != nil {
			return fmt.Errorf("git reset failed: %w - output: %s", err2, string(output2))
		}
	}

	g.logger.Info().Str("branch", branch).Msg("Repository updated successfully")
	return nil
}

// GetAgentConfigPath returns the path to this agent's config file in the repo
func (g *GitSync) GetAgentConfigPath() string {
	return filepath.Join(g.repoPath, "agents", fmt.Sprintf("%s.json", g.agentID))
}

// GetWorkflowsPath returns the path to the workflows directory
func (g *GitSync) GetWorkflowsPath() string {
	return filepath.Join(g.repoPath, "workflows")
}

// LoadAgentConfig loads the agent's configuration from the git repository
func (g *GitSync) LoadAgentConfig() (map[string]interface{}, error) {
	configPath := g.GetAgentConfigPath()
	
	// Check if config file exists
	if _, err := os.Stat(configPath); err != nil {
		if os.IsNotExist(err) {
			g.logger.Warn().Str("path", configPath).Msg("Agent config not found in repository")
			return nil, nil
		}
		return nil, fmt.Errorf("failed to check config file: %w", err)
	}

	// Read the config file
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	// Parse JSON
	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config JSON: %w", err)
	}

	g.logger.Info().Str("path", configPath).Msg("Loaded agent config from repository")
	return config, nil
}

// GetLastCommit returns the last commit hash and message
func (g *GitSync) GetLastCommit() (string, string, error) {
	cmd := exec.Command("git", "-C", g.repoPath, "log", "-1", "--pretty=format:%H|%s")
	output, err := cmd.Output()
	if err != nil {
		return "", "", fmt.Errorf("failed to get last commit: %w", err)
	}

	parts := strings.Split(string(output), "|")
	if len(parts) != 2 {
		return "", "", fmt.Errorf("unexpected git log output format")
	}

	return parts[0], parts[1], nil
}

// GetStatus returns the current git status
func (g *GitSync) GetStatus() (string, error) {
	cmd := exec.Command("git", "-C", g.repoPath, "status", "--short")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get git status: %w", err)
	}
	return string(output), nil
}

// SetupGitConfig configures git settings for the repository
func (g *GitSync) SetupGitConfig() error {
	// Set up basic git config
	configs := map[string]string{
		"user.name":  fmt.Sprintf("Agent-%s", g.agentID),
		"user.email": fmt.Sprintf("%s@controlcenter.local", g.agentID),
		// Disable SSL verification for local testing
		"http.sslVerify": "false",
	}

	for key, value := range configs {
		cmd := exec.Command("git", "-C", g.repoPath, "config", key, value)
		if err := cmd.Run(); err != nil {
			g.logger.Warn().Str("key", key).Err(err).Msg("Failed to set git config")
		}
	}

	return nil
}

// HasLocalChanges checks if there are uncommitted changes in the repository
func (g *GitSync) HasLocalChanges() (bool, error) {
	cmd := exec.Command("git", "-C", g.repoPath, "status", "--porcelain")
	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("failed to check git status: %w", err)
	}

	// If output is empty, there are no changes
	return len(strings.TrimSpace(string(output))) > 0, nil
}

// HasDiverged checks if local and remote have diverged
func (g *GitSync) HasDiverged() (bool, error) {
	// Fetch latest from remote without merging
	cmd := exec.Command("git", "-C", g.repoPath, "fetch", "origin")
	if err := cmd.Run(); err != nil {
		return false, fmt.Errorf("failed to fetch: %w", err)
	}

	// Check if we're behind or ahead
	cmd = exec.Command("git", "-C", g.repoPath, "status", "-sb")
	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("failed to check status: %w", err)
	}

	status := string(output)
	// Check for divergence indicators
	hasDiverged := strings.Contains(status, "ahead") && strings.Contains(status, "behind")

	return hasDiverged, nil
}

// GetDiff returns the diff of uncommitted changes
func (g *GitSync) GetDiff() (string, error) {
	cmd := exec.Command("git", "-C", g.repoPath, "diff")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get diff: %w", err)
	}
	return string(output), nil
}

// CommitLocalChanges commits all local changes
func (g *GitSync) CommitLocalChanges(message string) error {
	// Add all changes
	cmd := exec.Command("git", "-C", g.repoPath, "add", "-A")
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git add failed: %w - output: %s", err, string(output))
	}

	// Commit changes
	cmd = exec.Command("git", "-C", g.repoPath, "commit", "-m", message)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Check if it's just "nothing to commit"
		if strings.Contains(string(output), "nothing to commit") {
			g.logger.Info().Msg("No changes to commit")
			return nil
		}
		return fmt.Errorf("git commit failed: %w - output: %s", err, string(output))
	}

	g.logger.Info().Msg("Local changes committed successfully")
	return nil
}

// Push pushes local commits to remote repository
func (g *GitSync) Push() error {
	cmd := exec.Command("git", "-C", g.repoPath, "push", "origin", "HEAD")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git push failed: %w - output: %s", err, string(output))
	}

	g.logger.Info().Msg("Changes pushed to remote successfully")
	return nil
}

// BackupLocalChanges creates a backup of local changes using git stash or branch
func (g *GitSync) BackupLocalChanges() error {
	// First try git stash with a descriptive message
	timestamp := time.Now().Format("20060102-150405")
	stashMsg := fmt.Sprintf("Agent-%s-backup-%s", g.agentID, timestamp)

	// Add all changes to staging
	cmd := exec.Command("git", "-C", g.repoPath, "add", "-A")
	if output, err := cmd.CombinedOutput(); err != nil {
		g.logger.Warn().Err(err).Str("output", string(output)).Msg("Failed to stage changes for backup")
	}

	// Try to stash changes
	cmd = exec.Command("git", "-C", g.repoPath, "stash", "push", "-m", stashMsg)
	_, err := cmd.CombinedOutput()
	if err != nil {
		// If stash fails, try creating a backup branch
		branchName := fmt.Sprintf("backup/%s/%s", g.agentID, timestamp)
		g.logger.Info().Str("branch", branchName).Msg("Creating backup branch for local changes")

		// Create and checkout new branch
		cmd = exec.Command("git", "-C", g.repoPath, "checkout", "-b", branchName)
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("failed to create backup branch: %w - output: %s", err, string(output))
		}

		// Commit changes to backup branch
		cmd = exec.Command("git", "-C", g.repoPath, "commit", "-m", fmt.Sprintf("Backup of local changes - %s", timestamp))
		if output, err := cmd.CombinedOutput(); err != nil {
			// Ignore "nothing to commit" errors
			if !strings.Contains(string(output), "nothing to commit") {
				return fmt.Errorf("failed to commit backup: %w - output: %s", err, string(output))
			}
		}

		// Switch back to main/master
		cmd = exec.Command("git", "-C", g.repoPath, "checkout", "main")
		if _, err := cmd.CombinedOutput(); err != nil {
			cmd = exec.Command("git", "-C", g.repoPath, "checkout", "master")
			if output2, err2 := cmd.CombinedOutput(); err2 != nil {
				return fmt.Errorf("failed to switch back to main branch: %w - output: %s", err2, string(output2))
			}
		}

		g.logger.Info().Str("branch", branchName).Msg("Local changes backed up to branch")
		g.logger.Info().Msg("To recover: git checkout " + branchName)
	} else {
		g.logger.Info().Str("stash", stashMsg).Msg("Local changes stashed successfully")
		g.logger.Info().Msg("To recover: git stash pop")

		// Show stash list for reference
		cmd = exec.Command("git", "-C", g.repoPath, "stash", "list", "--oneline", "-n", "5")
		if output, err := cmd.Output(); err == nil && len(output) > 0 {
			g.logger.Info().Str("recent_stashes", string(output)).Msg("Recent stashes available")
		}
	}

	return nil
}

// ListBackups lists available backups (stashes and backup branches)
func (g *GitSync) ListBackups() ([]string, error) {
	var backups []string

	// List all stashes (show which ones belong to this agent)
	cmd := exec.Command("git", "-C", g.repoPath, "stash", "list", "--format=%gd: %s")
	if output, err := cmd.Output(); err == nil && len(output) > 0 {
		stashes := strings.Split(strings.TrimSpace(string(output)), "\n")
		for _, stash := range stashes {
			if strings.Contains(stash, g.agentID) {
				backups = append(backups, fmt.Sprintf("STASH (this agent): %s", stash))
			} else {
				// Show all stashes for recovery purposes
				backups = append(backups, fmt.Sprintf("STASH: %s", stash))
			}
		}
	}

	// List backup branches
	cmd = exec.Command("git", "-C", g.repoPath, "branch", "-a")
	if output, err := cmd.Output(); err == nil {
		branches := strings.Split(string(output), "\n")
		for _, branch := range branches {
			branch = strings.TrimSpace(branch)
			if strings.Contains(branch, "backup/") {
				if strings.Contains(branch, g.agentID) {
					backups = append(backups, fmt.Sprintf("BRANCH (this agent): %s", branch))
				} else {
					backups = append(backups, fmt.Sprintf("BRANCH: %s", branch))
				}
			}
		}
	}

	return backups, nil
}

// RecoverBackup recovers changes from a specific backup
func (g *GitSync) RecoverBackup(backupID string) error {
	// If backupID is empty or "latest", recover the most recent backup
	if backupID == "" || backupID == "latest" {
		// Try to recover the most recent stash for this agent
		cmd := exec.Command("git", "-C", g.repoPath, "stash", "list", "--format=%gd %s")
		if output, err := cmd.Output(); err == nil && len(output) > 0 {
			stashes := strings.Split(strings.TrimSpace(string(output)), "\n")
			for _, stash := range stashes {
				if strings.Contains(stash, g.agentID) {
					// Extract stash ID (e.g., "stash@{0}")
					parts := strings.Fields(stash)
					if len(parts) > 0 {
						backupID = parts[0]
						g.logger.Info().Str("stash", backupID).Msg("Recovering most recent agent backup")
						break
					}
				}
			}
		}

		// If no agent-specific stash, try any recent stash
		if backupID == "" || backupID == "latest" {
			backupID = "stash@{0}"
			g.logger.Info().Msg("Recovering most recent stash")
		}
	}

	if strings.HasPrefix(backupID, "stash@{") {
		// Recover from stash
		cmd := exec.Command("git", "-C", g.repoPath, "stash", "pop", backupID)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("failed to recover from stash: %w - output: %s", err, string(output))
		}
		g.logger.Info().Str("stash", backupID).Msg("Recovered from stash")
	} else if strings.Contains(backupID, "backup/") {
		// Recover from branch
		cmd := exec.Command("git", "-C", g.repoPath, "checkout", backupID)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("failed to checkout backup branch: %w - output: %s", err, string(output))
		}
		g.logger.Info().Str("branch", backupID).Msg("Switched to backup branch")
	}

	return nil
}

// GetMergeInstructions returns instructions for merging local and remote changes
func (g *GitSync) GetMergeInstructions() string {
	return fmt.Sprintf(`
=== MERGE INSTRUCTIONS FOR DIVERGED CONFIGURATIONS ===

Your local configuration has diverged from the manager. Here's how to merge:

1. AUTOMATIC BACKUP CREATED
   Your local changes have been saved to a git stash or backup branch.
   Run: ./agent.exe -list-backups

2. TO MERGE LOCAL + REMOTE CHANGES:
   a) Let the agent sync with manager (pulls remote changes)
   b) Recover your local changes: ./agent.exe -recover-backup latest
   c) Review the merge conflicts (if any)
   d) Resolve conflicts in the config files
   e) Push merged config: ./agent.exe -push-config

3. MANUAL GIT MERGE (Advanced):
   cd %s
   git stash pop                    # Apply your changes
   git diff                         # Review differences
   git add -A                       # Stage resolved files
   git commit -m "Merge local and remote configs"
   git push origin HEAD

4. TO KEEP LOCAL ONLY:
   ./agent.exe -standalone          # Run without manager sync

5. TO DISCARD LOCAL:
   # Already done - your changes are in backup if needed

Use -list-backups anytime to see available backups.
`, g.repoPath)
}

// SaveAgentConfig saves the agent configuration back to the git repository
func (g *GitSync) SaveAgentConfig(config map[string]interface{}) error {
	configPath := g.GetAgentConfigPath()

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	// Marshal config to JSON
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	// Write to file
	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write config: %w", err)
	}

	g.logger.Info().Str("path", configPath).Msg("Agent config saved to repository")
	return nil
}

// WatchForChanges monitors the repository for changes at regular intervals
func (g *GitSync) WatchForChanges(interval time.Duration, onChange func()) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	var lastCommit string

	for range ticker.C {
		// Get current commit
		commit, _, err := g.GetLastCommit()
		if err != nil {
			g.logger.Error().Err(err).Msg("Failed to get last commit")
			continue
		}

		// Check if commit changed
		if lastCommit != "" && lastCommit != commit {
			g.logger.Info().Str("commit", commit).Msg("Repository changed, triggering update")
			onChange()
		}

		lastCommit = commit
	}
}