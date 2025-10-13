# Air-Gapped Deployment Guide

This guide covers deploying Control Center in environments without internet access.

## Overview

Control Center can run fully air-gapped with proper preparation. The system consists of:
- **Manager**: Node.js application with bundled dependencies
- **Agents**: Self-contained Go binaries
- **Git**: Required for configuration sync between manager and agents

## Prerequisites

### On Internet-Connected Machine

1. Docker (for pulling manager image)
2. `wget` or `curl` (for downloading agent binaries)
3. Access to Docker Hub and GitHub releases

**Note**: No Node.js or Go required if using pre-built Docker image and agent binaries

### On Air-Gapped Target Machines

**Manager Host:**
- Docker runtime (for container deployment)
  - OR Node.js runtime (v16+) for non-Docker deployment
- Git command-line tool (required for manager's Git SSH server)
- Linux, Windows, or macOS

**Agent Hosts:**
- Git command-line tool
- Linux, Windows, or macOS
- No Node.js or Go required (agents are pre-compiled)

## Deployment Methods

### Method 1: GitHub Release Artifacts (Simplest)

#### Step 1: Download Release on Internet-Connected Machine

```bash
# Download latest release artifacts
VERSION=v0.14.1
wget https://github.com/lsadehaan/controlcenter/releases/download/${VERSION}/manager-${VERSION}.tar.gz
wget https://github.com/lsadehaan/controlcenter/releases/download/${VERSION}/agent-linux-${VERSION}.tar.gz
wget https://github.com/lsadehaan/controlcenter/releases/download/${VERSION}/agent-windows-${VERSION}.zip
```

Or use GitHub CLI:
```bash
gh release download v0.14.1 --pattern "manager-*.tar.gz"
gh release download v0.14.1 --pattern "agent-*.tar.gz"
gh release download v0.14.1 --pattern "agent-*.zip"
```

#### Step 2: Transfer to Air-Gapped Environment

Transfer files via:
- USB drive
- Secure file transfer system
- Physical media

#### Step 3: Extract and Install

**Manager (Linux example):**
```bash
# Extract
tar -xzf manager-v0.14.1.tar.gz
cd manager

# Install (npm dependencies already bundled)
# No npm install needed - node_modules included

# Configure
export JWT_SECRET="$(openssl rand -base64 32)"
export NODE_ENV=production
export PORT=3000

# Run
node src/server.js
```

**Agents:**
```bash
# Linux
tar -xzf agent-linux-v0.14.1.tar.gz
chmod +x agent
./agent -token YOUR_TOKEN

# Windows
unzip agent-windows-v0.14.1.zip
agent.exe -token YOUR_TOKEN
```

---

### Method 2: Docker Images (Recommended for Manager)

This method is ideal for deploying the **manager as a Docker container** with **agents as native binaries**.

#### Option A: Using Docker Compose (Simplest)

**Step 1: Create docker-compose.yml**

For **production/air-gapped** (pinned version):
```yaml
version: '3.8'

services:
  manager:
    image: lsadehaan/controlcenter-manager:v0.14.1
    container_name: controlcenter-manager
    ports:
      - "3000:3000"
      - "2223:2223"
    volumes:
      - ./data:/app/data
    environment:
      - JWT_SECRET=${JWT_SECRET}
      - NODE_ENV=production
    restart: unless-stopped
```

For **local development** (always latest):
```yaml
version: '3.8'

services:
  manager:
    image: lsadehaan/controlcenter-manager:latest
    # Or omit :latest entirely - Docker defaults to latest
    # image: lsadehaan/controlcenter-manager
    container_name: controlcenter-manager
    ports:
      - "3000:3000"
      - "2223:2223"
    volumes:
      - ./data:/app/data
    environment:
      - JWT_SECRET=${JWT_SECRET}
      - NODE_ENV=production
    restart: unless-stopped
```

**Step 2a: For Local Development (Internet-Connected)**

```bash
# Pull and run latest version
docker compose pull
docker compose up -d

# Pull latest version anytime
docker compose pull  # Pulls latest if using :latest tag
docker compose up -d --force-recreate
```

**Step 2b: For Air-Gapped Deployment (Internet-Connected)**

```bash
# Pull image defined in docker-compose.yml
docker compose pull

# Save image to tar file (use specific version from docker-compose.yml)
docker save lsadehaan/controlcenter-manager:v0.14.1 -o manager.tar
gzip manager.tar

# Transfer: manager.tar.gz + docker-compose.yml
```

**Step 3: Load and Run (Air-Gapped)**

```bash
# Load image
docker load -i manager.tar.gz

# Generate JWT secret
export JWT_SECRET="$(openssl rand -base64 32)"
echo "JWT_SECRET=${JWT_SECRET}" > .env

# Start manager
docker compose up -d

# Verify
docker compose ps
curl http://localhost:3000/api/health
```

#### Option B: Manual Docker Commands

**Step 1: Pull and Export (Internet-Connected)**

```bash
# Pull latest manager image from Docker Hub
VERSION=v0.14.1
docker pull lsadehaan/controlcenter-manager:${VERSION}

# Save image to tar file
docker save lsadehaan/controlcenter-manager:${VERSION} -o manager.tar

# Compress for transfer
gzip manager.tar

# Result: manager.tar.gz (ready for transfer)
```

**Note**: Agents are typically deployed as native binaries (see Method 1) rather than containers, since they need direct filesystem access for file watching and local command execution.

#### Step 2: Transfer to Air-Gapped Environment

Transfer `manager.tar.gz` via:
- USB drive
- Secure file transfer system
- Physical media

#### Step 3: Load and Run (Air-Gapped)

```bash
# Load image into Docker
docker load -i manager.tar.gz

# Verify image loaded
docker images | grep controlcenter-manager

# Run manager with persistent data volume
docker run -d \
  --name controlcenter-manager \
  -p 3000:3000 \
  -p 2223:2223 \
  -v /data/control-center:/app/data \
  -e JWT_SECRET="$(openssl rand -base64 32)" \
  -e NODE_ENV=production \
  controlcenter-manager:v0.14.1

# Check manager is running
docker ps | grep controlcenter-manager
curl http://localhost:3000/api/health
```

**Important Volume Mount**: The `-v /data/control-center:/app/data` preserves:
- SQLite database: `control-center.db`
- Git config repository: `config-repo/`
- SSH host key: `ssh_host_key`

#### Step 4: Deploy Agents (Native Binaries)

On each agent host, download agent binaries from GitHub releases (Method 1) and run:

```bash
# Linux
./agent -token YOUR_TOKEN

# Windows
agent.exe -token YOUR_TOKEN
```

Agents will connect to the Docker manager on ports 3000 (WebSocket/API) and 2223 (Git SSH).

---

## Git Configuration for Air-Gapped

### Manager: Git SSH Server

The manager runs a Git SSH server on port 2223. This is **internal** - no internet required.

**Firewall rules needed:**
```bash
# Allow agents to connect to manager's Git SSH server
# Port 2223: Git-over-SSH
# Port 3000: Manager API/WebSocket
```

### Agent: Git Client

Agents use git command to sync with manager. Ensure git is installed:

```bash
# Check git availability
git --version

# If missing on Linux
yum install git        # RHEL/CentOS
apt-get install git    # Debian/Ubuntu

# If missing on Windows
# Deploy PortableGit (no installation needed)
```

---

## Verification

### Test Manager

```bash
# Health check
curl http://localhost:3000/api/health

# Should return: {"status":"ok"}
```

### Test Agent Registration

```bash
# Generate token in manager UI
# Start agent with token
./agent -token YOUR_TOKEN

# Agent should connect and show in manager UI
```

### Test Git Sync

```bash
# Update agent config in manager UI
# Agent should receive update via Git SSH (port 2223)
# Check agent logs for "Repository updated successfully"
```

---

## Network Architecture

```
┌─────────────────────────────────────────────┐
│         Air-Gapped Network                  │
│                                             │
│  ┌─────────────┐           ┌────────────┐  │
│  │   Manager   │◄─────────►│   Agent    │  │
│  │             │  Git SSH  │            │  │
│  │  Port 3000  │ (Port     │            │  │
│  │  Port 2223  │  2223)    │            │  │
│  └─────────────┘           └────────────┘  │
│        ▲                                    │
│        │ HTTPS/HTTP                         │
│        ▼                                    │
│  ┌─────────────┐                           │
│  │   Browser   │                           │
│  │   (Admin)   │                           │
│  └─────────────┘                           │
│                                             │
└─────────────────────────────────────────────┘
        No Internet Connection
```

**Required Connectivity:**
- Agents → Manager (ports 3000, 2223)
- Admin Browser → Manager (port 3000)
- No external internet required

---

## Security Considerations

### Certificates (HTTPS)

For production, use reverse proxy with internal CA certificates:

```bash
# Example with nginx
upstream controlcenter {
    server localhost:3000;
}

server {
    listen 443 ssl;
    server_name controlcenter.internal;

    ssl_certificate /path/to/internal-ca-cert.pem;
    ssl_certificate_key /path/to/internal-ca-key.pem;

    location / {
        proxy_pass http://controlcenter;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### SSH Keys

Agent SSH keys are **automatically generated** on first run. No manual setup needed.

Keys stored in: `~/.controlcenter-agent/agent_key`

### Secrets Management

```bash
# Set JWT_SECRET securely
export JWT_SECRET="$(openssl rand -base64 32)"

# For production, use secrets management:
# - HashiCorp Vault
# - Kubernetes Secrets
# - Environment files with restricted permissions
```

---

## Troubleshooting

### Manager Won't Start

```bash
# Check Node.js version
node --version  # Should be v16+

# Check dependencies
ls manager/node_modules  # Should exist and be populated

# Check ports
netstat -tulpn | grep -E '3000|2223'  # Should be available
```

### Agent Can't Connect

```bash
# Test manager reachability
curl http://manager-host:3000/api/health

# Test Git SSH port
telnet manager-host 2223

# Check agent logs
tail -f ~/.controlcenter-agent/agent.log
```

### Git Sync Failing

```bash
# Check git installation
git --version

# Check SSH key exists
ls -la ~/.controlcenter-agent/agent_key

# Check manager Git SSH server
# Manager logs should show: "Git SSH server listening on port 2223"
```

### No node_modules After Transfer

If node_modules is missing after transfer:

```bash
# You need to bundle npm dependencies BEFORE transfer
# On internet-connected machine:
cd manager
npm ci --production
tar -czf manager-bundle.tar.gz ../manager
# Transfer manager-bundle.tar.gz
```

---

## Updates in Air-Gapped Environment

### Process

1. Download new release on internet-connected machine
2. Test on staging environment (if available)
3. Transfer to air-gapped production
4. Stop services
5. Backup database: `cp data/control-center.db data/control-center.db.backup`
6. Extract new version over old (preserves data/ directory)
7. Start services
8. Verify in UI

### Database Migrations

Database migrations run **automatically** on manager startup. No manual intervention needed.

---

## Checklist

**Before Going Air-Gapped:**

- [ ] Pull and save manager Docker image (or download from GitHub releases for non-Docker deployment)
- [ ] Download agent binaries for all target platforms
- [ ] Download Git portable for Windows (if needed)
- [ ] Test full deployment in isolated environment
- [ ] Document internal network addresses and Docker host IPs
- [ ] Generate and securely store JWT_SECRET
- [ ] Prepare internal CA certificates (for HTTPS)
- [ ] Test all workflows (registration, config sync, file browser)
- [ ] Backup deployment package to multiple locations

**After Air-Gap Deployment:**

- [ ] Manager accessible at http(s)://manager-host:3000
- [ ] Manager Git SSH server listening on port 2223
- [ ] Agents can register with tokens
- [ ] Agents successfully sync configuration via Git
- [ ] Web UI accessible and functional
- [ ] Database backups automated
- [ ] Monitoring/alerting configured

---

## File Checklist for Transfer

Minimum files needed for air-gapped deployment:

```
deployment-package/
├── manager.tar.gz                  # Docker image (recommended)
│   OR manager-v0.14.1.tar.gz       # Manager tarball (non-Docker deployment)
├── agent-linux-v0.14.1.tar.gz      # Linux agent binary
├── agent-windows-v0.14.1.zip       # Windows agent binary
├── agent-macos-v0.14.1.tar.gz      # macOS agent binary (optional)
├── PortableGit-*.7z.exe            # Git for Windows (if needed)
├── AIRGAP-DEPLOYMENT.md            # This guide
└── deployment-config/
    ├── .env.example                # Environment variables template
    └── nginx.conf.example          # Reverse proxy example
```

**Recommended deployment**: Docker manager (`manager.tar.gz`) + native agent binaries

---

## Support

For issues with air-gapped deployment:

1. Check this guide's troubleshooting section
2. Review manager logs: `manager/logs/` or console output
3. Review agent logs: `~/.controlcenter-agent/agent.log`
4. Verify network connectivity between components
5. Ensure all prerequisites are met on target systems
