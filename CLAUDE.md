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
- **Git Server** (`src/git/server.js`): Configuration repository management
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
- **Git Sync** (`internal/gitsync/`): Configuration repository cloning
- **File Watcher** (`internal/filewatcher/`): File system trigger monitoring
- **Configuration** (`internal/config/`): JSON-based configuration management
- **Alert System** (`internal/alert/`): Alert forwarding to manager

### Communication Flow
1. **Agent Registration**: Agent generates SSH keys → registers with token → receives agent ID
2. **Heartbeat**: WebSocket connection maintains 30-second heartbeat intervals
3. **Configuration**: Manager commits to git → sends reload command → agent pulls config
4. **Workflow Execution**: Triggers fire → executor runs steps → alerts sent to manager

### Security Model
- Agents generate unique SSH key pairs on first run
- Public keys registered with manager during registration
- Manager distributes keys for agent-to-agent communication
- All inter-agent communication uses SSH authentication
- Registration tokens expire after 1 hour
- WebSocket connections authenticated via agent ID

## Implementation Status

### ✅ Completed
- Agent registration and token validation
- WebSocket heartbeat system
- Visual workflow editor (Drawflow.js)
- Basic workflow executor with step types
- SSH server in agents (port 2222)
- Git configuration sync
- Alert forwarding to manager
- SQLite database with full schema

### ⚠️ Partially Implemented
- File triggers (code exists, needs testing)
- Scheduled triggers (basic intervals work, no cron)
- Remote SSH commands (server ready, workflow integration pending)
- SFTP file transfers (basic support only)

### ❌ Not Implemented
- JavaScript execution step (goja integration)
- Webhook triggers
- Full cron scheduling
- Agent-to-agent key distribution
- Log shipping integration

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

### Available Step Types
- **File Operations**: `copy-file`, `move-file`, `delete-file`
- **Execution**: `command` (local), `ssh-command` (remote)
- **Network**: `sftp-send`, `http-request`
- **Platform**: `alert` (send to manager)
- **Logic**: `condition`, `for-each`

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

### SSH Connection Issues
- Port 2222 may conflict with existing services
- Check authorized_keys configuration
- Verify agent private key exists

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

## Future Roadmap (from Blueprint)

**Phase 2**: Local workflows & UI enhancements
**Phase 3**: Full distributed features (SSH/SFTP between agents)
**Phase 4**: Observability, metrics, and polish