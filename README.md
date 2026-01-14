# Control Center

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Release](https://img.shields.io/github/v/release/lsadehaan/controlcenter)](https://github.com/lsadehaan/controlcenter/releases)

A distributed automation platform with hub-and-spoke architecture for workflow automation across multiple hosts.

## Overview

Control Center enables you to automate file processing, command execution, and multi-step workflows across distributed systems. A central **Manager** coordinates lightweight **Agents** running on any number of hosts.

**Use cases:**
- Automated file processing pipelines (watch directories, process files, archive)
- Scheduled task execution across multiple servers
- Centralized monitoring and alerting
- Configuration management with Git-based version control

## Quick Start

### 1. Start the Manager

```bash
cd manager
npm install
npm start
```
Visit `http://localhost:3000` to set up your admin account.

### 2. Generate a Registration Token

In the web UI: **Agents** > **Generate Token** (valid for 1 hour)

### 3. Start an Agent

Download from [Releases](../../releases) or build from source:

```bash
cd nodes
go build -o agent .
./agent -token YOUR_TOKEN
```

The agent will register, sync configuration, and begin executing workflows.

## Architecture

```
              ┌──────────────────────────────────┐
              │           MANAGER                 │
              │  • Web UI (Drawflow editor)      │
              │  • REST API                      │
              │  • WebSocket (real-time)         │
              │  • Git SSH Server (port 2223)    │
              │  • SQLite database               │
              └───────────────┬──────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
   ┌───────────┐        ┌───────────┐       ┌───────────┐
   │   AGENT   │        │   AGENT   │       │   AGENT   │
   │ • Workflows│        │ • Workflows│       │ • Workflows│
   │ • File Watch│       │ • File Watch│      │ • File Watch│
   │ • SSH Server│       │ • SSH Server│      │ • SSH Server│
   │ • File Browse│      │ • File Browse│     │ • File Browse│
   └───────────┘        └───────────┘       └───────────┘
```

## Key Features

| Feature | Description |
|---------|-------------|
| **Visual Workflow Editor** | Drag-and-drop workflow builder with Drawflow.js |
| **File Triggers** | Watch directories for new/modified files |
| **Scheduled Tasks** | Run workflows on intervals |
| **Command Execution** | Execute shell commands with output capture |
| **File Browser** | Browse, upload, download files on agents |
| **Real-time Monitoring** | WebSocket heartbeats and live status |
| **Git-based Config** | Version-controlled configuration sync |
| **Secure Communication** | SSH key authentication for all traffic |

## Example Workflow

Watch for CSV files, back them up, and send an alert:

```json
{
  "trigger": {
    "type": "file",
    "config": { "path": "/data/incoming", "pattern": "*.csv" }
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
      "config": { "level": "info", "message": "Processed: {{.fileName}}" }
    }
  ]
}
```

## Deployment Options

### Docker (Recommended for Manager)

```bash
wget https://raw.githubusercontent.com/lsadehaan/controlcenter/main/deploy/deploy-manager.sh
chmod +x deploy-manager.sh
./deploy-manager.sh docker
```

### Native Installation

```bash
./deploy-manager.sh native
```

### Agent Deployment

```bash
wget https://raw.githubusercontent.com/lsadehaan/controlcenter/main/deploy/deploy-agent.sh
chmod +x deploy-agent.sh
sudo ./deploy-agent.sh YOUR_TOKEN http://manager-ip:3000
```

### Kubernetes

```bash
kubectl apply -f https://raw.githubusercontent.com/lsadehaan/controlcenter/main/deploy/kubernetes/controlcenter-k8s.yaml
```

## Docker Images

- `ghcr.io/lsadehaan/controlcenter-manager:latest` - Manager
- `ghcr.io/lsadehaan/controlcenter-nodes:latest` - Agent (Kubernetes)

## Network Ports

| Port | Component | Purpose |
|------|-----------|---------|
| 3000 | Manager | Web UI and API |
| 2223 | Manager | Git SSH (config sync) |
| 8088 | Agent | Health endpoint |
| 2222 | Agent | SSH server |

## Documentation

| Document | Description |
|----------|-------------|
| [Why Control Center?](docs/WhyControlCenter.md) | Comparison with N8N, when to use |
| [System Overview](SYSTEM_OVERVIEW.md) | Architecture, features, workflows |
| [Deployment Guide](DEPLOYMENT.md) | Production deployment instructions |
| [Setup Guide](SETUP.md) | Development environment setup |
| [Testing Guide](TESTING.md) | Testing workflows and scenarios |
| [Technical Reference](CLAUDE.md) | API, configuration, troubleshooting |

## Development

### Manager
```bash
cd manager
npm install
npm run dev          # Passwordless auth for testing
```

### Agent
```bash
cd nodes
go run . -token TOKEN -log-level debug
```

## Security

- JWT authentication for web UI and API
- SSH key pairs generated per agent (RSA 2048-bit)
- Public key authentication for Git operations
- Time-limited registration tokens (1 hour)
- File browser disabled by default with path whitelist

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes and test
4. Submit a pull request

## License

GNU Affero General Public License v3.0 - see [LICENSE](LICENSE).

Commercial licensing available for proprietary use cases.

## Links

- [Releases](https://github.com/lsadehaan/controlcenter/releases)
- [Issues](https://github.com/lsadehaan/controlcenter/issues)
- [Discussions](https://github.com/lsadehaan/controlcenter/discussions)
