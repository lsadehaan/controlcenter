# Control Center - Setup & Usage Guide

## Overview

The Control Center is a distributed automation platform with a centralized management server and distributed agents that execute workflows. It features:

- **Visual Workflow Editor**: Drag-and-drop interface for creating automation workflows
- **Distributed Architecture**: Central manager with lightweight agents on remote hosts
- **Real-time Monitoring**: WebSocket-based heartbeat and status updates
- **Git-based Configuration**: Version-controlled configuration management
- **Security**: SSH key-based authentication between components

## Quick Start

### Prerequisites

- Node.js 18+ (for Manager)
- Go 1.22+ (for Agents)
- Git

### 1. Start the Manager

```bash
cd manager
npm install
npm start
```

The Manager will be available at:
- Web UI: http://localhost:3000
- API: http://localhost:3000/api
- WebSocket: ws://localhost:3000/ws

### 2. Generate a Registration Token

1. Open the Manager UI at http://localhost:3000
2. Navigate to **Agents** page
3. Click **Generate Registration Token**
4. Copy the token (valid for 1 hour)

### 3. Start an Agent

```bash
cd nodes
go build -o agent
./agent -token YOUR_REGISTRATION_TOKEN
```

The agent will:
- Generate SSH keys on first run
- Register with the Manager using the token
- Start sending heartbeats
- Begin monitoring for workflow triggers

## Architecture Components

### Manager (Node.js/Express)

The central control plane that provides:

- **Web UI**: Dashboard, agent management, workflow editor
- **API Server**: RESTful API for all operations
- **WebSocket Server**: Real-time communication with agents
- **Database**: SQLite for storing agents, workflows, alerts, and logs
- **Git Server**: Configuration repository for agents

### Agents (Go)

Lightweight executors that:

- **Execute Workflows**: Run automation tasks locally
- **Monitor Triggers**: File system, schedule, webhook triggers
- **Report Status**: Send heartbeats and alerts to Manager
- **Sync Configuration**: Pull configs from Manager's Git repository

## Using the Workflow Editor

### Creating a Workflow

1. Navigate to **Workflow Editor** in the Manager UI
2. Drag trigger nodes from the palette (File, Schedule, Webhook)
3. Add action nodes (Move File, Run Command, etc.)
4. Connect nodes to define execution flow
5. Configure node properties in the right panel
6. Save the workflow with a descriptive name

### Available Nodes

**Triggers:**
- **File Trigger**: Monitors file system events
- **Schedule Trigger**: Runs on cron schedule
- **Webhook Trigger**: Triggered by HTTP requests

**Actions:**
- **File Operations**: Move, Copy, Delete files
- **Run Command**: Execute local shell commands
- **SSH Command**: Run commands on remote hosts
- **Send File (SFTP)**: Transfer files between agents
- **HTTP Request**: Make API calls
- **Send Alert**: Notify the Manager

**Logic:**
- **Condition**: If/else branching
- **For-Each Loop**: Iterate over items
- **JavaScript**: Custom logic execution

### Deploying Workflows

1. Go to **Workflows** page
2. Click **Deploy** on your workflow
3. Select target agents
4. Click **Deploy** to push configuration

## Agent Management

### Viewing Agent Status

The **Agents** page shows:
- Connection status (online/offline)
- Last heartbeat time
- Deployed workflows
- Platform information

### Agent Configuration

Each agent's configuration includes:
- Unique agent ID
- SSH keys for secure communication
- Assigned workflows
- Connection settings

### Monitoring

- **Dashboard**: Real-time overview of system status
- **Alerts**: Critical notifications from agents
- **Logs**: Detailed execution logs

## Security

### SSH Key Management

- Agents generate unique SSH key pairs on first run
- Public keys are registered with the Manager
- Manager distributes keys for agent-to-agent communication

### Registration Tokens

- One-time use tokens for agent registration
- Configurable expiration (default 1 hour)
- Generated through Manager UI or API

## API Reference

### Agent Endpoints

```
GET    /api/agents              # List all agents
GET    /api/agents/:id          # Get specific agent
POST   /api/agents/:id/command  # Send command to agent
PUT    /api/agents/:id/config   # Update agent configuration
```

### Workflow Endpoints

```
GET    /api/workflows           # List workflows
POST   /api/workflows           # Create workflow
PUT    /api/workflows/:id       # Update workflow
DELETE /api/workflows/:id       # Delete workflow
POST   /api/workflows/:id/deploy # Deploy to agents
```

### Token Management

```
POST   /api/tokens              # Generate registration token
```

### Monitoring

```
GET    /api/alerts              # Get alerts
PUT    /api/alerts/:id/acknowledge # Acknowledge alert
GET    /api/logs                # Get logs
```

## Configuration Files

### Manager Configuration

Location: `manager/data/`
- `control-center.db`: SQLite database
- `config-repo/`: Git repository for configurations

### Agent Configuration

Location: `~/.controlcenter-agent/` (or `AGENT_DATA_DIR`)
- `agent_key`: Private SSH key
- `agent_key.pub`: Public SSH key
- `config-repo/`: Cloned configuration repository
- `state.json`: Workflow execution state
- `agent.log`: Local logs

## Troubleshooting

### Agent Won't Connect

1. Check Manager is running: `http://localhost:3000`
2. Verify token is valid (not expired)
3. Check firewall allows WebSocket connections
4. Review agent logs for connection errors

### Workflow Not Executing

1. Verify workflow is deployed to agent
2. Check trigger configuration (paths, schedules)
3. Review agent logs for execution errors
4. Ensure required permissions for file operations

### Common Issues

**"Invalid or expired token"**
- Generate a new registration token
- Ensure token is used within expiration time

**"WebSocket connection failed"**
- Check Manager URL is correct
- Verify network connectivity
- Check for proxy/firewall blocking WebSocket

**"Failed to clone repository"**
- Ensure Git is installed
- Check repository permissions
- Verify network access to Git server

## Development

### Running in Development Mode

**Manager:**
```bash
cd manager
npm install
npm start
```

**Agent:**
```bash
cd nodes
go run . -log-level debug
```

### Building for Production

**Manager:**
```bash
cd manager
npm install --production
NODE_ENV=production npm start
```

**Agent:**
```bash
cd nodes
go build -o agent
./agent -manager https://manager.example.com
```

## Next Steps

### Phase 1 (Current Implementation)
✅ Agent registration and heartbeat
✅ WebSocket communication
✅ Visual workflow editor
✅ Basic workflow execution
✅ Git-based configuration

### Phase 2 (Planned)
- [ ] SSH/SFTP server in agents
- [ ] Remote command execution
- [ ] File transfer between agents
- [ ] Advanced scheduling (cron expressions)

### Phase 3 (Future)
- [ ] Distributed workflow orchestration
- [ ] Advanced monitoring and metrics
- [ ] Role-based access control
- [ ] High availability setup
- [ ] Cloud provider integrations

## Support

For issues, feature requests, or contributions:
- Review the Blueprint document for architectural details
- Check existing workflows in `manager/data/config-repo/workflows/`
- Examine agent logs in `~/.controlcenter-agent/agent.log`

## License

See LICENSE file in the repository root.