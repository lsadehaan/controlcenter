# Control Center Deployment Guide

## Quick Start - Ubuntu Deployment

### Prerequisites
- Ubuntu 20.04 LTS or newer
- Sudo access
- Internet connectivity
- Minimum 2GB RAM, 10GB disk space

### One-Line Installation

#### Option 1: Docker Deployment (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/lsadehaan/controlcenter/main/deploy/ubuntu-deploy.sh | bash -s -- v0.2.0 docker
```

#### Option 2: Native Deployment
```bash
curl -fsSL https://raw.githubusercontent.com/lsadehaan/controlcenter/main/deploy/ubuntu-deploy.sh | bash -s -- v0.2.0 native
```

### Manual Installation

#### 1. Download the deployment script
```bash
wget https://raw.githubusercontent.com/lsadehaan/controlcenter/main/deploy/ubuntu-deploy.sh
chmod +x ubuntu-deploy.sh
```

#### 2. Run the deployment
```bash
# Docker deployment (recommended)
./ubuntu-deploy.sh v0.2.0 docker

# OR Native deployment
./ubuntu-deploy.sh v0.2.0 native
```

## Docker Deployment Details

### Using Docker Compose

1. **Create docker-compose.yml**:
```yaml
version: '3.8'

services:
  manager:
    image: ghcr.io/lsadehaan/controlcenter-manager:latest
    container_name: controlcenter-manager
    restart: unless-stopped
    ports:
      - "3000:3000"  # Web UI
      - "9418:9418"  # Git server
    volumes:
      - ./manager-data:/app/data
    environment:
      - NODE_ENV=production

  node-agent:
    image: ghcr.io/lsadehaan/controlcenter-nodes:latest
    container_name: controlcenter-node
    restart: unless-stopped
    ports:
      - "8088:8088"  # Agent API
      - "2222:2222"  # SSH server
    volumes:
      - ./node-data:/home/agent/.controlcenter-agent
    environment:
      - MANAGER_URL=http://manager:3000
      - LOG_LEVEL=info
    depends_on:
      - manager
```

2. **Start the services**:
```bash
docker compose up -d
```

3. **View logs**:
```bash
docker compose logs -f
```

### Using Docker Run

```bash
# Create network
docker network create controlcenter

# Run Manager
docker run -d \
  --name controlcenter-manager \
  --network controlcenter \
  -p 3000:3000 \
  -p 9418:9418 \
  -v /opt/controlcenter/manager:/app/data \
  --restart unless-stopped \
  ghcr.io/lsadehaan/controlcenter-manager:latest

# Run Node Agent
docker run -d \
  --name controlcenter-node \
  --network controlcenter \
  -p 8088:8088 \
  -p 2222:2222 \
  -v /opt/controlcenter/node:/home/agent/.controlcenter-agent \
  -e MANAGER_URL=http://controlcenter-manager:3000 \
  --restart unless-stopped \
  ghcr.io/lsadehaan/controlcenter-nodes:latest
```

## Native Deployment Details

### Prerequisites Installation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Go 1.25.1
wget https://go.dev/dl/go1.25.1.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go1.25.1.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc

# Install other dependencies
sudo apt-get install -y git sqlite3 build-essential
```

### Manual Binary Installation

1. **Download release binaries**:
```bash
# Create directories
sudo mkdir -p /opt/controlcenter/{manager,nodes}

# Download and extract manager
wget https://github.com/lsadehaan/controlcenter/releases/download/v0.2.0/manager-v0.2.0.tar.gz
sudo tar -xzf manager-v0.2.0.tar.gz -C /opt/controlcenter/manager/

# Download and extract node agent
wget https://github.com/lsadehaan/controlcenter/releases/download/v0.2.0/agent-linux-v0.2.0.tar.gz
sudo tar -xzf agent-linux-v0.2.0.tar.gz -C /opt/controlcenter/nodes/
```

2. **Install Node.js dependencies**:
```bash
cd /opt/controlcenter/manager
sudo npm install --production
```

3. **Create systemd services**:

Manager service (`/etc/systemd/system/controlcenter-manager.service`):
```ini
[Unit]
Description=Control Center Manager
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/controlcenter/manager
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

Node service (`/etc/systemd/system/controlcenter-node.service`):
```ini
[Unit]
Description=Control Center Node Agent
After=network.target controlcenter-manager.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/controlcenter/nodes
ExecStart=/opt/controlcenter/nodes/agent
Restart=on-failure
Environment=MANAGER_URL=http://localhost:3000

[Install]
WantedBy=multi-user.target
```

4. **Start services**:
```bash
sudo systemctl daemon-reload
sudo systemctl enable controlcenter-manager controlcenter-node
sudo systemctl start controlcenter-manager controlcenter-node
```

## Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: controlcenter-manager
spec:
  replicas: 1
  selector:
    matchLabels:
      app: controlcenter-manager
  template:
    metadata:
      labels:
        app: controlcenter-manager
    spec:
      containers:
      - name: manager
        image: ghcr.io/lsadehaan/controlcenter-manager:latest
        ports:
        - containerPort: 3000
        - containerPort: 9418
        volumeMounts:
        - name: data
          mountPath: /app/data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: manager-data
---
apiVersion: v1
kind: Service
metadata:
  name: controlcenter-manager
spec:
  selector:
    app: controlcenter-manager
  ports:
  - name: web
    port: 3000
    targetPort: 3000
  - name: git
    port: 9418
    targetPort: 9418
  type: LoadBalancer
```

## Configuration

### Environment Variables

#### Manager
- `NODE_ENV`: Set to `production` for production deployments
- `PORT`: Web UI port (default: 3000)
- `GIT_PORT`: Git server port (default: 9418)
- `DATABASE_PATH`: SQLite database path (default: `./data/control-center.db`)
- `LOG_LEVEL`: Logging level (default: `info`)

#### Node Agent
- `MANAGER_URL`: Manager URL (e.g., `http://manager:3000`)
- `AGENT_CONFIG_DIR`: Configuration directory (default: `~/.controlcenter-agent`)
- `LOG_LEVEL`: Logging level (`debug`, `info`, `warn`, `error`)
- `API_PORT`: Agent API port (default: 8088)
- `SSH_PORT`: SSH server port (default: 2222)

### Networking Requirements

Open the following ports in your firewall:

```bash
# UFW (Ubuntu Firewall)
sudo ufw allow 3000/tcp  # Manager Web UI
sudo ufw allow 9418/tcp  # Git Server
sudo ufw allow 8088/tcp  # Agent API
sudo ufw allow 2222/tcp  # Agent SSH

# iptables
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9418 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 8088 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 2222 -j ACCEPT
```

## Post-Installation

### 1. Access the Web UI
Navigate to `http://your-server-ip:3000`

### 2. Initial Setup
1. Create an admin user (first user becomes admin)
2. Generate registration tokens for agents
3. Configure your first workflow

### 3. Register Additional Agents
On other machines, run:
```bash
# Docker
docker run -d \
  --name controlcenter-node \
  -p 8088:8088 -p 2222:2222 \
  -v ./node-data:/home/agent/.controlcenter-agent \
  ghcr.io/lsadehaan/controlcenter-nodes:latest \
  -token YOUR_REGISTRATION_TOKEN

# Native
./agent -token YOUR_REGISTRATION_TOKEN
```

## Monitoring

### Health Checks
- Manager: `http://localhost:3000/health`
- Agent: `http://localhost:8088/healthz`

### Logs

#### Docker
```bash
docker logs controlcenter-manager
docker logs controlcenter-node
```

#### Systemd
```bash
sudo journalctl -u controlcenter-manager -f
sudo journalctl -u controlcenter-node -f
```

## Updating

### Docker
```bash
docker compose pull
docker compose up -d
```

### Native
```bash
# Download new binaries
wget https://github.com/lsadehaan/controlcenter/releases/latest/download/agent-linux.tar.gz

# Stop services
sudo systemctl stop controlcenter-node

# Replace binary
sudo tar -xzf agent-linux.tar.gz -C /opt/controlcenter/nodes/

# Start services
sudo systemctl start controlcenter-node
```

## Backup

### Important Data
- Manager: `/opt/controlcenter/manager/data/`
  - `control-center.db` - SQLite database
  - `config-repo/` - Git repository of configurations
- Nodes: `/opt/controlcenter/nodes/.controlcenter-agent/`
  - `agent_key` - Agent SSH key
  - `config.json` - Agent configuration
  - `state.json` - Workflow state

### Backup Commands
```bash
# Backup
tar -czf controlcenter-backup-$(date +%Y%m%d).tar.gz \
  /opt/controlcenter/manager/data \
  /opt/controlcenter/nodes/.controlcenter-agent

# Restore
tar -xzf controlcenter-backup-20240101.tar.gz -C /
```

## Troubleshooting

### Common Issues

1. **Port already in use**:
```bash
# Check what's using the port
sudo lsof -i :3000
# Change port in docker-compose.yml or systemd service
```

2. **Agent can't connect to manager**:
```bash
# Check connectivity
curl http://manager-ip:3000/health
# Check firewall rules
sudo ufw status
```

3. **Permission errors**:
```bash
# Fix ownership
sudo chown -R www-data:www-data /opt/controlcenter
```

4. **Service won't start**:
```bash
# Check logs
sudo journalctl -xe
# Validate configuration
/opt/controlcenter/nodes/agent -validate-config
```

## Security Considerations

1. **Use HTTPS in production** - Set up a reverse proxy (nginx/traefik) with SSL
2. **Restrict network access** - Use firewall rules to limit access
3. **Regular updates** - Keep the system and Control Center updated
4. **Secure tokens** - Rotate registration tokens regularly
5. **Backup encryption** - Encrypt backup files containing sensitive data

## Support

- GitHub Issues: https://github.com/lsadehaan/controlcenter/issues
- Documentation: https://github.com/lsadehaan/controlcenter/wiki
- License: AGPL-3.0 (dual licensing available)