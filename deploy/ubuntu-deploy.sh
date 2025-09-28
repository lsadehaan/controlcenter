#!/bin/bash
# Control Center Deployment Script for Ubuntu
# Supports both Docker and native installation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
RELEASE_VERSION="${1:-v0.2.0}"
INSTALL_TYPE="${2:-docker}"  # docker or native
MANAGER_PORT="${MANAGER_PORT:-3000}"
GIT_PORT="${GIT_PORT:-9418}"
AGENT_API_PORT="${AGENT_API_PORT:-8088}"
AGENT_SSH_PORT="${AGENT_SSH_PORT:-2222}"

echo -e "${GREEN}Control Center Deployment Script${NC}"
echo "Version: $RELEASE_VERSION"
echo "Type: $INSTALL_TYPE"
echo "================================="

# Function to check if running on Ubuntu
check_ubuntu() {
    if [ ! -f /etc/os-release ]; then
        echo -e "${RED}This script is designed for Ubuntu systems${NC}"
        exit 1
    fi
    . /etc/os-release
    if [ "$ID" != "ubuntu" ]; then
        echo -e "${RED}This script is designed for Ubuntu systems${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Ubuntu $VERSION_ID detected${NC}"
}

# Function to install Docker
install_docker() {
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}✓ Docker is already installed${NC}"
        return
    fi

    echo -e "${YELLOW}Installing Docker...${NC}"
    sudo apt-get update
    sudo apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release

    # Add Docker's official GPG key
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

    # Set up the repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker Engine
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    # Add current user to docker group
    sudo usermod -aG docker $USER

    echo -e "${GREEN}✓ Docker installed successfully${NC}"
    echo -e "${YELLOW}Note: You may need to log out and back in for docker group changes to take effect${NC}"
}

# Function to install native dependencies
install_native_deps() {
    echo -e "${YELLOW}Installing native dependencies...${NC}"

    # Update system
    sudo apt-get update
    sudo apt-get upgrade -y

    # Install Node.js 20 (LTS)
    if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
    echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"

    # Install Go 1.25.1
    if ! command -v go &> /dev/null || [ "$(go version | cut -d' ' -f3 | cut -d'.' -f2)" -lt 25 ]; then
        wget https://go.dev/dl/go1.25.1.linux-amd64.tar.gz
        sudo rm -rf /usr/local/go
        sudo tar -C /usr/local -xzf go1.25.1.linux-amd64.tar.gz
        rm go1.25.1.linux-amd64.tar.gz
        export PATH=$PATH:/usr/local/go/bin
        echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
    fi
    echo -e "${GREEN}✓ Go $(go version) installed${NC}"

    # Install other dependencies
    sudo apt-get install -y git sqlite3 build-essential

    echo -e "${GREEN}✓ All dependencies installed${NC}"
}

# Function to deploy with Docker
deploy_docker() {
    echo -e "${YELLOW}Deploying with Docker...${NC}"

    # Create directories
    sudo mkdir -p /opt/controlcenter/manager/data
    sudo mkdir -p /opt/controlcenter/nodes/data

    # Create docker-compose.yml
    cat > /tmp/docker-compose.yml << EOF
version: '3.8'

services:
  manager:
    image: ghcr.io/lsadehaan/controlcenter-manager:latest
    container_name: controlcenter-manager
    restart: unless-stopped
    ports:
      - "${MANAGER_PORT}:3000"
      - "${GIT_PORT}:9418"
    volumes:
      - /opt/controlcenter/manager/data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=3000
    networks:
      - controlcenter
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 3s
      retries: 3

  node-agent:
    image: ghcr.io/lsadehaan/controlcenter-nodes:latest
    container_name: controlcenter-node
    restart: unless-stopped
    ports:
      - "${AGENT_API_PORT}:8088"
      - "${AGENT_SSH_PORT}:2222"
    volumes:
      - /opt/controlcenter/nodes/data:/home/agent/.controlcenter-agent
    environment:
      - MANAGER_URL=http://manager:3000
      - LOG_LEVEL=info
    networks:
      - controlcenter
    depends_on:
      - manager
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8088/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3

networks:
  controlcenter:
    driver: bridge
EOF

    sudo mv /tmp/docker-compose.yml /opt/controlcenter/docker-compose.yml

    # Pull and start containers
    cd /opt/controlcenter
    sudo docker compose pull
    sudo docker compose up -d

    echo -e "${GREEN}✓ Docker deployment complete${NC}"
}

# Function to deploy native
deploy_native() {
    echo -e "${YELLOW}Deploying native installation...${NC}"

    # Create directories
    sudo mkdir -p /opt/controlcenter/{manager,nodes,logs}

    # Download release binaries
    cd /tmp

    # Download manager
    echo -e "${YELLOW}Downloading manager...${NC}"
    wget -q "https://github.com/lsadehaan/controlcenter/releases/download/${RELEASE_VERSION}/manager-${RELEASE_VERSION}.tar.gz" || {
        echo -e "${YELLOW}Release artifacts not found, cloning from source...${NC}"
        git clone https://github.com/lsadehaan/controlcenter.git
        cd controlcenter/manager
        npm install
        sudo cp -r . /opt/controlcenter/manager/
        cd ../..
    }

    if [ -f "manager-${RELEASE_VERSION}.tar.gz" ]; then
        sudo tar -xzf "manager-${RELEASE_VERSION}.tar.gz" -C /opt/controlcenter/manager/
        cd /opt/controlcenter/manager
        sudo npm install --production
    fi

    # Download node agent
    echo -e "${YELLOW}Downloading node agent...${NC}"
    cd /tmp
    wget -q "https://github.com/lsadehaan/controlcenter/releases/download/${RELEASE_VERSION}/agent-linux-${RELEASE_VERSION}.tar.gz" || {
        echo -e "${YELLOW}Building node agent from source...${NC}"
        if [ ! -d "controlcenter" ]; then
            git clone https://github.com/lsadehaan/controlcenter.git
        fi
        cd controlcenter/nodes
        go build -o agent .
        sudo mv agent /opt/controlcenter/nodes/
        cd ../..
    }

    if [ -f "agent-linux-${RELEASE_VERSION}.tar.gz" ]; then
        sudo tar -xzf "agent-linux-${RELEASE_VERSION}.tar.gz" -C /opt/controlcenter/nodes/
        sudo chmod +x /opt/controlcenter/nodes/agent
    fi

    # Create systemd services
    echo -e "${YELLOW}Creating systemd services...${NC}"

    # Manager service
    sudo tee /etc/systemd/system/controlcenter-manager.service > /dev/null << EOF
[Unit]
Description=Control Center Manager
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/controlcenter/manager
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=${MANAGER_PORT}

[Install]
WantedBy=multi-user.target
EOF

    # Node agent service
    sudo tee /etc/systemd/system/controlcenter-node.service > /dev/null << EOF
[Unit]
Description=Control Center Node Agent
After=network.target controlcenter-manager.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/controlcenter/nodes
ExecStart=/opt/controlcenter/nodes/agent
Restart=on-failure
RestartSec=10
Environment=MANAGER_URL=http://localhost:${MANAGER_PORT}
Environment=LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
EOF

    # Set permissions
    sudo chown -R www-data:www-data /opt/controlcenter

    # Enable and start services
    sudo systemctl daemon-reload
    sudo systemctl enable controlcenter-manager controlcenter-node
    sudo systemctl start controlcenter-manager
    sleep 5
    sudo systemctl start controlcenter-node

    echo -e "${GREEN}✓ Native deployment complete${NC}"
}

# Function to setup firewall
setup_firewall() {
    echo -e "${YELLOW}Setting up firewall rules...${NC}"

    if command -v ufw &> /dev/null; then
        sudo ufw allow ${MANAGER_PORT}/tcp comment 'Control Center Manager'
        sudo ufw allow ${GIT_PORT}/tcp comment 'Control Center Git'
        sudo ufw allow ${AGENT_API_PORT}/tcp comment 'Control Center Agent API'
        sudo ufw allow ${AGENT_SSH_PORT}/tcp comment 'Control Center Agent SSH'
        echo -e "${GREEN}✓ Firewall rules added${NC}"
    else
        echo -e "${YELLOW}UFW not found, skipping firewall setup${NC}"
    fi
}

# Function to show status
show_status() {
    echo ""
    echo -e "${GREEN}=================================${NC}"
    echo -e "${GREEN}Control Center Deployment Summary${NC}"
    echo -e "${GREEN}=================================${NC}"

    if [ "$INSTALL_TYPE" == "docker" ]; then
        echo -e "\nDocker containers:"
        sudo docker compose -f /opt/controlcenter/docker-compose.yml ps
    else
        echo -e "\nSystemd services:"
        sudo systemctl status controlcenter-manager --no-pager | head -n 5
        sudo systemctl status controlcenter-node --no-pager | head -n 5
    fi

    echo -e "\n${GREEN}Access URLs:${NC}"
    echo -e "  Manager Web UI: ${GREEN}http://$(hostname -I | cut -d' ' -f1):${MANAGER_PORT}${NC}"
    echo -e "  Agent API:      ${GREEN}http://$(hostname -I | cut -d' ' -f1):${AGENT_API_PORT}/healthz${NC}"

    echo -e "\n${GREEN}Next Steps:${NC}"
    echo "1. Access the Manager Web UI at the URL above"
    echo "2. Generate a registration token for additional agents"
    echo "3. Configure your workflows"

    echo -e "\n${YELLOW}Commands:${NC}"
    if [ "$INSTALL_TYPE" == "docker" ]; then
        echo "  View logs:    sudo docker compose -f /opt/controlcenter/docker-compose.yml logs -f"
        echo "  Stop:         sudo docker compose -f /opt/controlcenter/docker-compose.yml down"
        echo "  Start:        sudo docker compose -f /opt/controlcenter/docker-compose.yml up -d"
        echo "  Update:       sudo docker compose -f /opt/controlcenter/docker-compose.yml pull && sudo docker compose -f /opt/controlcenter/docker-compose.yml up -d"
    else
        echo "  View logs:    sudo journalctl -u controlcenter-manager -f"
        echo "  Stop:         sudo systemctl stop controlcenter-manager controlcenter-node"
        echo "  Start:        sudo systemctl start controlcenter-manager controlcenter-node"
        echo "  Status:       sudo systemctl status controlcenter-manager controlcenter-node"
    fi
}

# Main execution
main() {
    check_ubuntu

    if [ "$INSTALL_TYPE" == "docker" ]; then
        install_docker
        deploy_docker
    elif [ "$INSTALL_TYPE" == "native" ]; then
        install_native_deps
        deploy_native
    else
        echo -e "${RED}Invalid install type. Use 'docker' or 'native'${NC}"
        exit 1
    fi

    setup_firewall
    show_status
}

# Run main function
main