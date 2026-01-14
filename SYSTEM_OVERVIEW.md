# Control Center - System Overview

A distributed automation platform with hub-and-spoke architecture for workflow automation across multiple hosts.

## What is Control Center?

Control Center enables you to automate file processing, command execution, and multi-step workflows across distributed systems. It consists of:

- A central **Manager** that provides a web UI, API, and coordinates all agents
- Lightweight **Agents** (single Go binary) that run on any host and execute workflows

**Common use cases:**
- Automated file processing pipelines (watch directories, process files, archive results)
- Scheduled task execution across multiple servers
- Centralized monitoring and alerting for distributed systems
- Configuration management with Git-based version control
- File transfers and synchronization between hosts

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │            MANAGER                   │
                    │  (Node.js/Express - Port 3000)      │
                    │                                      │
                    │  ┌──────────┐  ┌──────────────────┐ │
                    │  │  Web UI  │  │  REST API        │ │
                    │  │(Drawflow)│  │  /api/*          │ │
                    │  └──────────┘  └──────────────────┘ │
                    │  ┌──────────┐  ┌──────────────────┐ │
                    │  │ WebSocket│  │  Git SSH Server  │ │
                    │  │  Server  │  │  (Port 2223)     │ │
                    │  └──────────┘  └──────────────────┘ │
                    │  ┌─────────────────────────────────┐│
                    │  │  SQLite DB + Git Config Repo   ││
                    │  └─────────────────────────────────┘│
                    └──────────────┬──────────────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
    ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
    │    AGENT      │      │    AGENT      │      │    AGENT      │
    │   (Go binary) │      │   (Go binary) │      │   (Go binary) │
    │               │      │               │      │               │
    │ • File Watch  │      │ • File Watch  │      │ • File Watch  │
    │ • Workflows   │      │ • Workflows   │      │ • Workflows   │
    │ • SSH Server  │      │ • SSH Server  │      │ • SSH Server  │
    │ • File Browse │      │ • File Browse │      │ • File Browse │
    └───────────────┘      └───────────────┘      └───────────────┘
       Windows/Linux          Linux/macOS            Any Platform
```

## Core Components

### Manager (Node.js/Express)

The central control plane providing:

| Component | Description |
|-----------|-------------|
| **Web UI** | Dashboard, agent management, visual workflow editor (Drawflow.js) |
| **REST API** | Complete API for agents, workflows, alerts, logs, tokens |
| **WebSocket Server** | Real-time bidirectional communication with agents |
| **Git SSH Server** | SSH-based Git server (port 2223) for secure config sync |
| **Database** | SQLite storing agents, workflows, alerts, logs, tokens |
| **Config Repository** | Git repo storing all agent and workflow configurations |

### Agents (Go)

Lightweight executors that:

| Feature | Description |
|---------|-------------|
| **Workflow Execution** | Runs multi-step automation workflows locally |
| **File Watching** | Monitors directories for new/changed files (triggers) |
| **Configuration Sync** | Pulls/pushes configs via Git-over-SSH |
| **SSH Server** | Embedded SSH server (port 2222) for remote access |
| **File Browser** | HTTP API for browsing/uploading/downloading files |
| **Alerting** | Sends alerts to manager via WebSocket |
| **Health Endpoint** | HTTP health check on port 8088 |

## Key Features

### Visual Workflow Editor

Build automation workflows using a drag-and-drop interface:

- **Trigger nodes**: File events, schedules, webhooks
- **Action nodes**: File operations, commands, alerts, HTTP requests
- **Logic nodes**: Conditions, loops, JavaScript
- **Template variables**: Use `{{.fileName}}`, `{{.filePath}}`, etc. in any step

### Real-time Monitoring

- WebSocket-based heartbeats (30-second intervals)
- Live agent status in web UI
- Alert dashboard with severity levels
- Centralized log viewing

### Git-backed Configuration

- All configurations stored in version-controlled Git repository
- Agents sync via secure Git-over-SSH protocol
- Automatic backups before config changes
- Push/pull changes between agents and manager

### File Browser

Securely access agent filesystems through the web UI:

- Browse directories
- Upload/download files
- Create directories
- Delete files
- Path whitelist security model

### Security

| Feature | Implementation |
|---------|----------------|
| Agent identity | RSA 2048-bit SSH key pairs generated on first run |
| Registration | Time-limited tokens (1 hour) for agent registration |
| Git auth | Public key authentication for all Git operations |
| Web auth | JWT tokens with bcrypt password hashing |
| API auth | Bearer tokens for API access |
| File browser | Disabled by default, requires explicit path whitelist |

## Communication Flow

### Agent Registration

```
1. Agent generates SSH key pair on first run
2. Agent connects to manager WebSocket with registration token
3. Manager validates token, stores agent info + public key
4. Agent receives its unique ID
5. Agent clones config repository via Git SSH
```

### Configuration Sync

```
Manager → Agent (Pull):
1. User modifies config in web UI
2. Manager commits change to Git repo
3. Manager sends "reload-config" via WebSocket
4. Agent pulls latest via Git SSH (port 2223)
5. Agent applies new configuration

Agent → Manager (Push):
1. Agent makes local config changes
2. Agent commits to local Git repo
3. Agent pushes to manager via Git SSH
4. Manager receives and applies changes
```

### Workflow Execution

```
1. Trigger fires (file event, schedule, etc.)
2. Executor processes workflow steps in order
3. Template variables substituted ({{.fileName}}, etc.)
4. Each step executes (file ops, commands, etc.)
5. Alerts sent to manager via WebSocket
6. Results logged locally and forwarded to manager
```

## Workflow Capabilities

### Trigger Types

| Type | Description | Status |
|------|-------------|--------|
| **File** | Watch directories for file events | Implemented |
| **Schedule** | Run on intervals | Implemented (basic) |
| **Webhook** | Triggered by HTTP requests | UI only |

### Step Types

| Category | Steps | Status |
|----------|-------|--------|
| **File Operations** | copy-file, move-file, delete-file | Implemented |
| **Execution** | run-command | Implemented |
| **Alerting** | alert | Implemented |
| **File Operations** | rename-file, archive-file, extract-archive | Stub |
| **Remote** | ssh-command, send-file (SFTP) | Stub |
| **Network** | http-request, database-query | Stub |
| **Communication** | send-email, slack-message | Stub |
| **Logic** | condition, loop, javascript | Stub |

### Template Variables

Available in workflow steps when triggered by file events:

| Variable | Description |
|----------|-------------|
| `{{.fileName}}` | Name of the file (e.g., `data.csv`) |
| `{{.filePath}}` | Full path to the file |
| `{{.fileDir}}` | Directory containing the file |
| `{{.fileExt}}` | File extension (e.g., `.csv`) |
| `{{.timestamp}}` | Event timestamp |

## Network Ports

| Port | Component | Purpose |
|------|-----------|---------|
| 3000 | Manager | Web UI and REST API |
| 2223 | Manager | Git SSH server for config sync |
| 8088 | Agent | Health check endpoint |
| 2222 | Agent | SSH server (future agent-to-agent) |

## Data Storage

### Manager

| Location | Content |
|----------|---------|
| `manager/data/control-center.db` | SQLite database (agents, workflows, alerts, logs) |
| `manager/data/config-repo/` | Git repository for configurations |
| `manager/data/config-repo/agents/*.json` | Agent configuration files |
| `manager/data/config-repo/workflows/*.json` | Workflow definition files |

### Agent

| Location | Content |
|----------|---------|
| `~/.controlcenter-agent/` | Agent data directory |
| `~/.controlcenter-agent/agent_key` | Private SSH key |
| `~/.controlcenter-agent/agent_key.pub` | Public SSH key |
| `~/.controlcenter-agent/config-repo/` | Cloned configuration repository |
| `~/.controlcenter-agent/state.json` | Workflow execution state |
| `~/.controlcenter-agent/agent.log` | Local log file |

## Example Workflow

Watch for CSV files, back them up, and send an alert:

```json
{
  "name": "CSV File Processor",
  "trigger": {
    "type": "file",
    "config": {
      "path": "/data/incoming",
      "pattern": "*.csv"
    }
  },
  "steps": [
    {
      "id": "backup",
      "type": "copy-file",
      "config": {
        "source": "{{.filePath}}",
        "destination": "/data/backup/{{.fileName}}"
      },
      "next": ["notify"]
    },
    {
      "id": "notify",
      "type": "alert",
      "config": {
        "level": "info",
        "message": "Backed up: {{.fileName}}"
      },
      "next": ["archive"]
    },
    {
      "id": "archive",
      "type": "move-file",
      "config": {
        "source": "{{.filePath}}",
        "destination": "/data/processed/{{.fileName}}"
      }
    }
  ]
}
```

## Platform Support

### Manager
- Any platform with Node.js 18+
- Recommended: Docker or Linux for production

### Agent
Pre-built binaries available for:
- Linux (amd64, arm64)
- Windows (amd64)
- macOS (amd64, arm64)

## Next Steps

- [SETUP.md](SETUP.md) - Development environment setup
- [DEPLOYMENT.md](DEPLOYMENT.md) - Production deployment guide
- [TESTING.md](TESTING.md) - Testing workflows and scenarios
- [CLAUDE.md](CLAUDE.md) - Detailed technical reference (API, configuration, troubleshooting)
