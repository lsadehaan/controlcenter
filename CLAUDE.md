# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Control Center is a distributed automation platform with hub-and-spoke architecture for enterprise-grade workflow automation. Two main components:

- **Manager** (`manager/`): Node.js/Express web UI and API server for configuration and monitoring
- **Nodes** (`nodes/`): Go agents that execute workflows on processor hosts

## Development Commands

### Manager (Node.js)
```bash
cd manager
npm install         # Install dependencies
npm start          # Start server on http://localhost:3000
```

### Nodes (Go Agent)
```bash
cd nodes
go build -o agent.exe .    # Build binary (Windows)
go build -o agent .        # Build binary (Linux/Mac)
go run . -token YOUR_TOKEN # Run with registration token
go run . -log-level debug  # Run with debug logging
go run . -standalone       # Run without manager connection
go run . -check-changes    # Check for local config changes
go run . -push-config      # Push local changes to manager
go run . -list-backups     # List automatic config backups
go run . -recover-backup   # Recover from backup (stash or branch)

# Agent endpoints:
# Health check: http://localhost:8088/healthz
# Agent info: http://localhost:8088/info
# SSH server: port 2222
```

## Creating Releases

### ⚠️ IMPORTANT: Always Use Automated Release Process

**NEVER manually create releases or upload binaries.** The CI/CD pipeline automatically creates releases and properly cross-compiles binaries for all platforms.

### Automated Release Process

1. **Update RELEASE_NOTES.md** with your version's notes:
   ```markdown
   ## v0.12.0

   ### New Features
   - Feature description

   ### Fixes
   - Bug fix description
   ```

2. **Commit and push** the changes:
   ```bash
   git add RELEASE_NOTES.md
   git commit -m "Prepare release v0.12.0"
   git push
   ```

3. **Create and push a tag**:
   ```bash
   git tag v0.12.0
   git push origin v0.12.0
   ```

4. **CI/CD automatically**:
   - Extracts release notes from RELEASE_NOTES.md
   - Creates the GitHub release with those notes
   - Cross-compiles all binaries (Linux, Windows, macOS)
   - Uploads all artifacts to the release
   - Builds and pushes Docker images

5. **Monitor the build**:
   ```bash
   gh run watch
   ```

6. **Verify the release**:
   ```bash
   gh release view v0.12.0
   ```

### What CI/CD Does Automatically

When you push a tag matching `v*.*.*`:
- ✅ Extracts release notes from RELEASE_NOTES.md for that version
- ✅ Creates GitHub release with proper title and notes
- ✅ Cross-compiles agent binary for Linux (amd64, arm64)
- ✅ Cross-compiles agent binary for Windows (amd64)
- ✅ Cross-compiles agent binary for macOS (amd64, arm64)
- ✅ Packages manager (tar.gz)
- ✅ Builds and pushes Docker images for manager
- ✅ Uploads all binaries to the GitHub release

### Common Mistakes to Avoid

❌ **DO NOT** manually create releases:
```bash
# WRONG - Skip the manual creation step
gh release create v1.0.0 --title "Release" --notes "Changes"
```

❌ **DO NOT** upload local binaries:
```bash
# WRONG - This uploads Windows binaries as Linux binaries
go build -o agent-linux-amd64 .
gh release create v1.0.0 --attach agent-linux-amd64
```

❌ **DO NOT** forget to update RELEASE_NOTES.md:
```bash
# WRONG - Tag without release notes will cause CI to fail
git tag v1.0.0
git push origin v1.0.0
# Error: No release notes found for version v1.0.0 in RELEASE_NOTES.md
```

✅ **CORRECT** - Update RELEASE_NOTES.md, commit, then push tag:
```bash
# 1. Update RELEASE_NOTES.md with version notes
# 2. Commit the file
git add RELEASE_NOTES.md
git commit -m "Prepare release v1.0.0"
git push

# 3. Create and push tag
git tag v1.0.0
git push origin v1.0.0

# 4. CI/CD does the rest automatically
```

## Testing Workflows

### Quick Test Setup
```bash
# 1. Start Manager
cd manager && npm start

# 2. Generate token at http://localhost:3000/agents

# 3. Start Agent
cd nodes && go run . -token YOUR_TOKEN

# 4. Deploy test workflow
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d @test-workflow.json
```

Test directories for file triggers:
```bash
mkdir -p C:\temp\watch C:\temp\backup C:\temp\processed
```

## Architecture & Key Components

### Manager Architecture
- **Core Server** (`src/server.js`): Express app orchestrating all services
- **WebSocket Server** (`src/websocket/server.js`): Real-time agent communication and heartbeats
- **Git Server** (`src/git/server.js`): Configuration repository management with simple-git
- **Git SSH Server** (`src/git/ssh-server.js`): SSH server for Git-over-SSH (port 2223)
- **Database** (`src/db/database.js`): SQLite for agents, workflows, alerts, logs
- **API Routes** (`src/routes/api.js`): RESTful endpoints for all operations
- **Web UI** (`views/`): EJS templates with Drawflow.js visual workflow editor
- **Authentication** (`src/auth/`): JWT token management for agents
- **Services** (`src/services/`): Business logic for workflows and agents

### Nodes Architecture
- **Main Entry** (`main.go`): Agent lifecycle management
- **Identity** (`internal/identity/`): SSH key generation and management
- **WebSocket Client** (`internal/websocket/`): Manager connection and heartbeat
- **Workflow Executor** (`internal/workflow/`): Step execution engine
- **SSH Server** (`internal/sshserver/`): Embedded SSH/SFTP server on port 2222
- **Git Sync** (`internal/gitsync/`): Configuration repository cloning and push/pull via SSH
- **File Watcher** (`internal/filewatcher/`): File system trigger monitoring
- **Configuration** (`internal/config/`): JSON-based configuration management
- **Alert System** (`internal/alert/`): Alert forwarding to manager

### Communication Flow
1. **Agent Registration**: Agent generates SSH keys → registers with token → receives agent ID → public key stored in manager database
2. **Heartbeat**: WebSocket connection maintains 30-second heartbeat intervals
3. **Configuration Sync**:
   - **Pull**: Manager commits to git → sends reload command → agent pulls config via Git-over-SSH (port 2223)
   - **Push**: Agent makes local config changes → commits → pushes to manager via Git-over-SSH
4. **Workflow Execution**: Triggers fire → executor runs steps → alerts sent to manager via WebSocket

### Security Model
- **Agent Identity**: Agents generate unique SSH key pairs on first run (RSA 2048-bit)
- **Registration**: Public keys registered with manager during registration via WebSocket
- **Git Authentication**: Git SSH server authenticates agents by matching public keys in database
- **SSH Commands**: Only git-upload-pack and git-receive-pack allowed; only config-repo accessible
- **Token Expiry**: Registration tokens expire after 1 hour
- **WebSocket Auth**: WebSocket connections authenticated via agent ID
- **Host Keys**: Manager generates SSH host key on first run for Git SSH server
- **Agent-to-Agent**: SSH server on port 2222 for future agent-to-agent communication

### Git-over-SSH Technical Details

The Git SSH server (port 2223) implements the Git protocol over SSH for secure configuration synchronization:

**SSH Server Implementation** (`manager/src/git/ssh-server.js`):
- Uses `ssh2` npm library for SSH server functionality
- Authenticates agents by comparing incoming public key with database records
- Accepts `git-upload-pack` (fetch/pull) and `git-receive-pack` (push) commands
- Repository access restricted to `config-repo` only

**Stream Piping** (Critical for preventing hangs):
- **Stateful protocol**: Uses git commands without `--stateless-rpc` flag
- **Bidirectional piping**:
  - stdin: SSH stream → git process
  - stdout: git process → SSH stream (with `{ end: false }`)
  - stderr: git process → SSH stderr channel (with `{ end: false }`)
- **Lifecycle management**: Send exit status before closing SSH channel on `process.nextTick()`

**Agent Git Configuration** (`nodes/internal/gitsync/gitsync.go`):
- SSH command: `ssh -i <key> -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes`
- `BatchMode=yes` prevents interactive prompts on Windows
- Graceful clone failure on first run (public key not yet in database)
- Auto-retry after registration completes and public key is stored

**Repository Configuration**:
- Manager sets `receive.denyCurrentBranch=updateInstead` to allow pushing to checked-out branch
- Non-bare repository with working directory for easy inspection
- Automatic structure initialization (agents/, workflows/ directories)

## Implementation Status

### ✅ Completed
- **Core Infrastructure** (v0.5.3+)
  - Agent registration and token validation
  - WebSocket heartbeat system with reconnection
  - Git configuration sync with automatic backups
  - SSH server in agents (port 2222)
  - SQLite database with full schema
  - Alert forwarding to manager with WebSocket

- **Git-over-SSH** (v0.11.5)
  - Manager Git SSH server on port 2223 using ssh2 library
  - Public key authentication using agent SSH keys
  - Bidirectional git-upload-pack (clone/fetch/pull) and git-receive-pack (push)
  - Stateful SSH protocol with proper stream piping (`{ end: false }`)
  - Proper exit status handling and SSH channel lifecycle
  - Git stderr forwarded to SSH client for progress visibility
  - Repository configured with `receive.denyCurrentBranch=updateInstead`
  - Agent SSH configuration with BatchMode=yes to prevent interactive prompts
  - Graceful clone failure on first registration (retries after public key is registered)

- **File Watcher System**
  - Pattern-based file watching (ScanDir + regex patterns)
  - Absolute path file watching (backward compatible)
  - File processing guards (30-second cooldown)
  - External program execution
  - Workflow triggering from file events
  - Duplicate event prevention (fixed in v0.5.3)

- **Workflow System**
  - Visual workflow editor (Drawflow.js) with drag-and-drop
  - Canvas navigation (pan/zoom)
  - Template variable substitution ({{.fileName}}, etc.)
  - Filewatcher trigger type support
  - Available inputs tab showing context variables
  - Node connection traversal for variable propagation

- **Workflow Step Types (Implemented)**
  - File operations: move-file, copy-file, delete-file
  - Command execution: run-command
  - Alerts: alert (with template support)
  - All steps support template variable substitution

### ⚠️ Partially Implemented
- **Workflow Steps (UI exists, backend stub)**
  - rename-file, archive-file, extract-archive
  - run-script, ssh-command, send-file (SFTP)
  - http-request, database-query
  - send-email, slack-message
  - condition, loop, javascript

- **Triggers**
  - Scheduled triggers (basic intervals work, no cron)
  - File triggers (standalone - not via file watcher)
  - Webhook triggers (UI only)

### ❌ Not Implemented
- JavaScript execution step (requires goja integration)
- Full cron scheduling syntax
- Agent-to-agent key distribution
- Log shipping integration
- Workflow step implementations for UI-defined types (see above)

## API Reference

### Core Endpoints
```bash
# Agents
GET    /api/agents                    # List all agents
GET    /api/agents/:id                # Get specific agent
POST   /api/agents/:id/command        # Send command (reload-config, etc.)
PUT    /api/agents/:id/config         # Update configuration
DELETE /api/agents/:id                # Remove agent

# Workflows
GET    /api/workflows                 # List workflows
POST   /api/workflows                 # Create workflow
PUT    /api/workflows/:id             # Update workflow
DELETE /api/workflows/:id             # Delete workflow
POST   /api/workflows/:id/deploy      # Deploy to agents
GET    /api/workflows/:id/status      # Get workflow status

# Monitoring
GET    /api/alerts                    # Get alerts
PUT    /api/alerts/:id/acknowledge    # Acknowledge alert
DELETE /api/alerts/:id                # Delete alert
GET    /api/logs                      # Get logs
GET    /api/health                    # Manager health check

# Registration
POST   /api/tokens                    # Generate registration token
GET    /api/tokens                    # List active tokens
```

## Workflow Configuration

### Workflow Structure (JSON)
```json
{
  "trigger": {
    "type": "file|schedule|webhook",
    "config": { /* trigger-specific */ }
  },
  "steps": [
    {
      "id": "unique-id",
      "type": "copy-file|move-file|alert|command|...",
      "config": { /* step-specific */ },
      "next": ["next-step-id"]
    }
  ]
}
```

### Trigger Examples
```json
// File Trigger
{
  "type": "file",
  "config": {
    "path": "C:\\temp\\watch",
    "pattern": "*.csv",
    "recursive": true
  }
}

// Schedule Trigger
{
  "type": "schedule",
  "config": {
    "interval": 300  // seconds
  }
}
```

### Implemented Step Types
- **File Operations**: `copy-file`, `move-file`, `delete-file`
- **Execution**: `run-command` (local shell command)
- **Platform**: `alert` (send to manager with template support)

### Step Types Defined in UI (Not Yet Implemented)
- **File Operations**: `rename-file`, `archive-file`, `extract-archive`
- **Execution**: `run-script`, `ssh-command` (remote)
- **Network**: `send-file` (SFTP), `http-request`, `database-query`
- **Communication**: `send-email`, `slack-message`
- **Logic**: `condition`, `loop`, `javascript`

## Key Files & Locations

### Manager
- Database: `manager/data/control-center.db`
- Config repo: `manager/data/config-repo/`
- Agent configs: `manager/data/config-repo/agents/*.json`
- Workflows: `manager/data/config-repo/workflows/*.json`

### Agent
- Config directory: `~/.controlcenter-agent/` or `AGENT_CONFIG_DIR`
- SSH keys: `agent_key` and `agent_key.pub`
- State file: `state.json` (workflow execution state)
- Local logs: `agent.log`
- Cloned config: `config-repo/`

## Troubleshooting Common Issues

### Agent Registration Fails
- Token expired (1 hour validity)
- Manager not running on port 3000
- Network/firewall blocking connection

### Workflow Not Executing
- Check agent has workflow in config
- Verify trigger paths exist
- Review agent logs for errors
- Ensure file permissions are correct

### SSH Connection Issues (Agent Port 2222)
- Port 2222 may conflict with existing services
- Check authorized_keys configuration
- Verify agent private key exists

### Git-over-SSH Issues (Manager Port 2223)

**Clone/Pull Failures**:
- **"Permission denied"**: Agent's public key not in manager database. Check agent is registered successfully.
- **"Authentication failed"**: Public key mismatch. Verify agent is using correct SSH key (`~/.controlcenter-agent/agent_key`).
- **Interactive prompt on Windows**: Ensure agent has BatchMode=yes in SSH command (fixed in v0.11.5).
- **First clone fails**: Normal on first registration - agent retries after public key is stored (fixed in v0.11.5).

**Push Failures**:
- **Hangs indefinitely**: Fixed in v0.11.5. Update manager to latest version.
- **"denyCurrentBranch" error**: Fixed in v0.11.5. Manager sets `receive.denyCurrentBranch=updateInstead`.
- **"fatal: the remote end hung up unexpectedly"**: Check manager logs for git process errors.

**Debugging**:
- Check manager logs: `docker logs control-center-manager-1` or console output
- Check agent logs: `~/.controlcenter-agent/agent.log`
- Test SSH connection manually: `ssh -p 2223 -i ~/.controlcenter-agent/agent_key git@<manager-host>`
- Verify port 2223 is open: `netstat -an | grep 2223` or `telnet <manager-host> 2223`

## WebSocket Communication

### Command Types (Manager → Agent)
```javascript
{command: "reload-config"}        // Reload configuration from git
{command: "remove-workflow", id: "workflow-id"}  // Remove specific workflow
{command: "reload-filewatcher"}   // Update file watcher rules
{command: "git-pull"}             // Pull latest from git repository
```

### Message Types (Agent → Manager)
```javascript
{type: "heartbeat"}               // Liveness signal (30s intervals)
{type: "status", data: {...}}    // Status update
{type: "alert", level: "info|warning|error", message: "...", details: {...}}
{type: "registration", publicKey: "...", hostname: "...", platform: "..."}
```

## Database Schema

### Core Tables
- **agents**: id, hostname, platform, public_key, status, config, last_heartbeat
- **registration_tokens**: token, created_at, expires_at, used_by, used_at
- **workflows**: id, name, description, config, created_at, updated_at
- **alerts**: id, agent_id, level, message, details, created_at, acknowledged
- **logs**: id, agent_id, level, message, metadata, timestamp

## Dependencies

### Manager (package.json)
- **express**: Web framework
- **ws**: WebSocket server for real-time communication
- **sqlite3**: Database
- **simple-git**: Git operations
- **drawflow**: Visual workflow editor
- **uuid**: ID generation
- **jsonwebtoken**: Token management

### Nodes (go.mod)
- **github.com/go-git/go-git/v5**: Git operations
- **github.com/gorilla/websocket**: WebSocket client
- **github.com/rs/zerolog**: Structured logging
- **github.com/fsnotify/fsnotify**: File system monitoring
- **golang.org/x/crypto**: SSH implementation

## Recent Fixes & Improvements

### v0.11.5 (Latest)
- **Fixed Git-over-SSH push hang**: Removed `--stateless-rpc`, using stateful SSH protocol with proper bidirectional piping
- **Fixed SSH exit status**: Properly send exit status and close channel on `process.nextTick()` to ensure flush
- **Fixed stream lifecycle**: Use `{ end: false }` on stdout/stderr pipes to prevent premature SSH channel closure
- **Added stderr forwarding**: Git stderr now forwarded to SSH client for progress/error visibility
- **Set receive.denyCurrentBranch**: Manager configures `updateInstead` to allow pushing to checked-out branch
- **Added BatchMode SSH option**: Prevents interactive prompts on Windows during git operations
- **Graceful clone failure**: Agent doesn't fail on first clone attempt (public key not yet registered)

### v0.11.4
- **Enhanced Git SSH server logging**: Comprehensive error logging for all stream and process errors
- **Real-time stderr logging**: Git errors logged immediately as they occur

### v0.11.3
- **Fixed git-upload-pack hanging**: Use `.git` directory for non-bare repos
- **Added remote URL auto-update**: Agents automatically update from HTTP to SSH URLs
- **Added git fetch timeout**: 10-second timeout prevents indefinite hangs
- **Fixed push-config exit codes**: Proper error reporting and exit status

### v0.5.3
- **Fixed duplicate file processing**: Files were being processed twice due to multiple watchers
- **Fixed workflow trigger recognition**: Added support for 'filewatcher' trigger type
- **Fixed variable substitution**: Template variables like {{.fileName}} now work in all workflow steps
- **Improved watcher lifecycle**: Proper start/stop management prevents duplicate event handlers

## Known Issues & Limitations

### Current Limitations
1. **Template substitution**: Only processes top-level string values (nested objects/arrays in config need recursive processing)
2. **Code duplication**: Workflow executor has significant repeated code (refactoring to interface-based design recommended)
3. **Step implementations**: Many step types defined in UI have no backend implementation (return "not implemented" errors)
4. **Error handling**: File watcher errors can cause workflows to fail silently
5. **Workflow editor**: Node drop positioning has minor inconsistencies with canvas transform

### Workarounds
- For nested config values needing templates, use top-level strings or external programs
- Use `run-command` step for unimplemented functionality
- Check agent logs for file watcher errors
- Use zoom reset before dropping nodes for consistent positioning

## Future Roadmap

### Immediate Priorities
1. **Refactor workflow executor**: Move to interface-based step design to eliminate code duplication
2. **Implement missing step types**: Start with ssh-command, http-request, condition
3. **Improve template processing**: Add recursive template substitution for nested configs
4. **Add cron syntax**: Support full cron expressions for scheduled triggers

### Phase 2: Local workflows & UI enhancements
- Workflow debugging and testing tools
- Better error reporting and logging
- Workflow templates and examples

### Phase 3: Full distributed features
- Agent-to-agent SSH communication
- SFTP file transfers between agents
- Distributed workflow orchestration

### Phase 4: Observability, metrics, and polish
- Metrics collection and dashboards
- Log aggregation and search
- Performance optimization