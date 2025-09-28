# Control Center

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Release](https://img.shields.io/github/v/release/lsadehaan/controlcenter)](https://github.com/lsadehaan/controlcenter/releases)

Distributed automation platform with hub-and-spoke architecture for enterprise-grade workflow automation.

## 🚀 Quick Deployment (Ubuntu)

### Deploy Manager (Choose One)

**Docker (Recommended):**
```bash
# Download and run deployment script
wget https://raw.githubusercontent.com/lsadehaan/controlcenter/main/deploy/deploy-manager.sh
chmod +x deploy-manager.sh
./deploy-manager.sh docker
```

**Native Installation:**
```bash
# Download and run deployment script
wget https://raw.githubusercontent.com/lsadehaan/controlcenter/main/deploy/deploy-manager.sh
chmod +x deploy-manager.sh
./deploy-manager.sh native
```

### Deploy Agent (Always Native)

After deploying the manager, get a registration token from the Web UI (http://your-server:3000), then:

```bash
# Download and run agent installer
wget https://raw.githubusercontent.com/lsadehaan/controlcenter/main/deploy/deploy-agent.sh
chmod +x deploy-agent.sh
sudo ./deploy-agent.sh YOUR_REGISTRATION_TOKEN http://manager-ip:3000
```

## 🏗️ Architecture

- **Manager** (`manager/`): Node.js/Express web UI and API server
  - Can run in Docker or natively
  - Provides web interface, API, and git-based configuration
  - SQLite database for persistence

- **Agent** (`nodes/`): Lightweight Go binary
  - Always runs natively for direct system access
  - Zero dependencies - single executable
  - Watches files, executes workflows, manages SSH connections

## 💻 Development Setup

### Manager Development
```bash
cd manager
npm install
npm start
# Visit http://localhost:3000
```

### Agent Development
```bash
cd nodes
go run . -token YOUR_TOKEN
# Health check: http://localhost:8088/healthz
```

## 📦 Docker Images

Publicly available on GitHub Container Registry:
- `ghcr.io/lsadehaan/controlcenter-manager:latest` - Manager web UI
- `ghcr.io/lsadehaan/controlcenter-nodes:latest` - Agent (Kubernetes only)

## 🌐 Kubernetes Deployment

```bash
# Deploy full stack to Kubernetes
kubectl apply -f https://raw.githubusercontent.com/lsadehaan/controlcenter/main/deploy/kubernetes/controlcenter-k8s.yaml

# Set agent registration token
kubectl create secret generic agent-registration \
  --from-literal=token=YOUR_TOKEN \
  -n controlcenter
```

## 📚 Documentation

- [Deployment Guide](DEPLOYMENT.md) - Detailed deployment instructions
- [System Overview](SYSTEM_OVERVIEW.md) - Architecture and components
- [Testing Guide](TESTING.md) - Testing workflows and examples
- [Setup Guide](SETUP.md) - Development environment setup
- [Claude AI Instructions](CLAUDE.md) - AI assistant configuration

## 🔧 Key Features

- **Visual Workflow Editor**: Drag-and-drop workflow creation with Drawflow.js
- **File Triggers**: Monitor directories and trigger workflows on file events
- **Remote Execution**: SSH-based remote command execution
- **Git-based Configuration**: Version-controlled configuration management
- **Real-time Monitoring**: WebSocket-based agent heartbeat and status
- **Standalone Mode**: Agents can operate independently when disconnected

## 🛡️ Security

- AGPL-3.0 licensed with dual licensing available
- SSH key-based authentication between components
- Secure command execution with no shell injection
- Path traversal protection in file operations

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

## 📄 License

This project is licensed under the GNU Affero General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

For commercial use cases requiring proprietary modifications, contact for dual licensing options.

## 🔗 Links

- [Releases](https://github.com/lsadehaan/controlcenter/releases)
- [Issues](https://github.com/lsadehaan/controlcenter/issues)
- [Discussions](https://github.com/lsadehaan/controlcenter/discussions)
