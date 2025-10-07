#!/bin/bash
# Control Center Manager Deployment Script for Ubuntu
# Supports Docker and native installation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
INSTALL_TYPE="${1:-docker}"  # docker or native
MANAGER_PORT="${MANAGER_PORT:-3000}"
GIT_SSH_PORT="${GIT_SSH_PORT:-2223}"
DATA_DIR="${DATA_DIR:-/opt/controlcenter/manager}"

echo -e "${GREEN}Control Center Manager Deployment${NC}"
echo "Type: $INSTALL_TYPE"
echo "Port: $MANAGER_PORT"
echo "Data: $DATA_DIR"
echo "================================="

# Check Ubuntu
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

# Install Docker
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

# Deploy with Docker
deploy_docker() {
    echo -e "${YELLOW}Deploying Manager with Docker...${NC}"

    # Create directories
    sudo mkdir -p $DATA_DIR/data

    # Fix permissions for Docker container (runs as UID 1001)
    echo -e "${YELLOW}Setting proper permissions for data directory...${NC}"
    sudo chown -R 1001:1001 $DATA_DIR/data
    sudo chmod -R 755 $DATA_DIR/data
    echo -e "${GREEN}✓ Permissions set for container user${NC}"

    # Stop existing container if any
    docker stop controlcenter-manager 2>/dev/null || true
    docker rm controlcenter-manager 2>/dev/null || true

    # Create docker-compose.yml (without deprecated version field)
    cat > /tmp/docker-compose.yml << EOF

services:
  manager:
    image: ghcr.io/lsadehaan/controlcenter-manager:latest
    container_name: controlcenter-manager
    restart: unless-stopped
    ports:
      - "${MANAGER_PORT}:3000"
      - "${GIT_SSH_PORT}:2223"
    volumes:
      - ${DATA_DIR}/data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=3000
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 3s
      retries: 3
    networks:
      - controlcenter

networks:
  controlcenter:
    external: true
EOF

    sudo mv /tmp/docker-compose.yml $DATA_DIR/docker-compose.yml

    # Create network if not exists
    docker network create controlcenter 2>/dev/null || true

    # Pull and start container
    cd $DATA_DIR
    docker compose pull
    docker compose up -d

    echo -e "${GREEN}✓ Manager Docker deployment complete${NC}"
}

# Deploy native
deploy_native() {
    echo -e "${YELLOW}Deploying Manager natively...${NC}"

    # Install Node.js 20 LTS
    if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
    echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"

    # Install dependencies
    sudo apt-get install -y git sqlite3 build-essential

    # Create directories
    sudo mkdir -p $DATA_DIR

    # Clone repository
    cd /tmp
    if [ -d "controlcenter" ]; then
        cd controlcenter && git pull
    else
        git clone https://github.com/lsadehaan/controlcenter.git
        cd controlcenter
    fi

    # Copy manager files
    sudo cp -r manager/* $DATA_DIR/
    cd $DATA_DIR
    sudo npm install --production

    # Create systemd service
    sudo tee /etc/systemd/system/controlcenter-manager.service > /dev/null << EOF
[Unit]
Description=Control Center Manager
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$DATA_DIR
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=${MANAGER_PORT}
StandardOutput=append:/var/log/controlcenter/manager.log
StandardError=append:/var/log/controlcenter/manager.err

[Install]
WantedBy=multi-user.target
EOF

    # Create log directory
    sudo mkdir -p /var/log/controlcenter
    sudo chown www-data:www-data /var/log/controlcenter

    # Set permissions
    sudo chown -R www-data:www-data $DATA_DIR

    # Enable and start service
    sudo systemctl daemon-reload
    sudo systemctl enable controlcenter-manager
    sudo systemctl start controlcenter-manager

    echo -e "${GREEN}✓ Manager native deployment complete${NC}"
}

# Setup firewall
setup_firewall() {
    echo -e "${YELLOW}Setting up firewall rules...${NC}"

    if command -v ufw &> /dev/null; then
        sudo ufw allow ${MANAGER_PORT}/tcp comment 'Control Center Manager'
        sudo ufw allow ${GIT_SSH_PORT}/tcp comment 'Control Center Git SSH'
        echo -e "${GREEN}✓ Firewall rules added${NC}"
    else
        echo -e "${YELLOW}UFW not found, skipping firewall setup${NC}"
    fi
}

# Setup nginx reverse proxy (optional)
setup_nginx() {
    echo -e "${YELLOW}Would you like to setup Nginx reverse proxy with SSL? (y/n)${NC}"
    read -r response
    if [[ "$response" != "y" ]]; then
        return
    fi

    sudo apt-get install -y nginx certbot python3-certbot-nginx

    echo -e "${YELLOW}Enter your domain name (e.g., controlcenter.example.com):${NC}"
    read -r DOMAIN

    # Create nginx config
    sudo tee /etc/nginx/sites-available/controlcenter-manager > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://localhost:${MANAGER_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

    sudo ln -sf /etc/nginx/sites-available/controlcenter-manager /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl reload nginx

    echo -e "${YELLOW}Would you like to setup SSL with Let's Encrypt? (y/n)${NC}"
    read -r ssl_response
    if [[ "$ssl_response" == "y" ]]; then
        sudo certbot --nginx -d $DOMAIN
    fi

    echo -e "${GREEN}✓ Nginx reverse proxy configured${NC}"
}

# Show status
show_status() {
    echo ""
    echo -e "${GREEN}=====================================${NC}"
    echo -e "${GREEN}Control Center Manager Status${NC}"
    echo -e "${GREEN}=====================================${NC}"

    if [ "$INSTALL_TYPE" == "docker" ]; then
        echo -e "\nDocker status:"
        docker ps --filter name=controlcenter-manager --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        echo -e "\nLogs: ${YELLOW}docker logs -f controlcenter-manager${NC}"
    else
        echo -e "\nService status:"
        sudo systemctl status controlcenter-manager --no-pager | head -n 10
        echo -e "\nLogs: ${YELLOW}sudo journalctl -u controlcenter-manager -f${NC}"
    fi

    local IP=$(hostname -I | cut -d' ' -f1)
    echo -e "\n${GREEN}Access URLs:${NC}"
    echo -e "  Web UI:      ${GREEN}http://$IP:${MANAGER_PORT}${NC}"
    echo -e "  Health:      ${GREEN}http://$IP:${MANAGER_PORT}/health${NC}"
    echo -e "  Git SSH:     ${GREEN}ssh://git@$IP:${GIT_SSH_PORT}${NC}"

    echo -e "\n${GREEN}Next Steps:${NC}"
    echo "1. Access the Manager Web UI"
    echo "2. Create your first user (becomes admin)"
    echo "3. Generate registration tokens for agents"
    echo "4. Deploy agents using deploy-agent.sh"

    echo -e "\n${YELLOW}Agent Registration:${NC}"
    echo "After getting a token from the Manager UI, deploy agents with:"
    echo -e "${GREEN}curl -fsSL https://raw.githubusercontent.com/lsadehaan/controlcenter/main/deploy/deploy-agent.sh | bash -s -- YOUR_TOKEN${NC}"
}

# Upgrade existing installation
upgrade() {
    echo -e "${YELLOW}Upgrading Control Center Manager...${NC}"

    # Detect installation type
    if docker ps -a --format '{{.Names}}' | grep -q controlcenter-manager; then
        echo -e "${GREEN}Detected Docker installation${NC}"
        INSTALL_TYPE="docker"

        # Find data directory from container volume
        DATA_DIR=$(docker inspect controlcenter-manager 2>/dev/null | grep -oP '(?<="Source": ")[^"]*(?=/data")' | head -1)
        if [ -z "$DATA_DIR" ]; then
            DATA_DIR="/opt/controlcenter/manager"
        fi

        echo -e "${YELLOW}Stopping container...${NC}"
        docker stop controlcenter-manager 2>/dev/null || true
        docker rm controlcenter-manager 2>/dev/null || true

        echo -e "${YELLOW}Pulling latest image...${NC}"
        docker pull ghcr.io/lsadehaan/controlcenter-manager:latest

        echo -e "${YELLOW}Starting container...${NC}"
        cd "$DATA_DIR"
        docker compose up -d

        echo -e "${GREEN}✓ Docker upgrade complete${NC}"

    elif systemctl is-active --quiet controlcenter-manager 2>/dev/null; then
        echo -e "${GREEN}Detected native installation${NC}"
        INSTALL_TYPE="native"
        DATA_DIR=$(systemctl show -p WorkingDirectory controlcenter-manager | cut -d= -f2)

        echo -e "${YELLOW}Stopping service...${NC}"
        sudo systemctl stop controlcenter-manager

        echo -e "${YELLOW}Pulling latest code...${NC}"
        cd /tmp
        if [ -d "controlcenter" ]; then
            cd controlcenter && git pull
        else
            git clone https://github.com/lsadehaan/controlcenter.git
            cd controlcenter
        fi

        echo -e "${YELLOW}Updating files...${NC}"
        sudo cp -r manager/* "$DATA_DIR/"
        cd "$DATA_DIR"
        sudo npm install --production

        echo -e "${YELLOW}Starting service...${NC}"
        sudo systemctl start controlcenter-manager

        echo -e "${GREEN}✓ Native upgrade complete${NC}"
    else
        echo -e "${RED}No existing installation found${NC}"
        echo "Use: bash $0 docker    (for new Docker installation)"
        echo "     bash $0 native   (for new native installation)"
        exit 1
    fi

    show_status
}

# Main execution
main() {
    # Check for upgrade flag
    if [ "$1" == "--upgrade" ]; then
        upgrade
        exit 0
    fi

    check_ubuntu

    if [ "$INSTALL_TYPE" == "docker" ]; then
        install_docker
        deploy_docker
    elif [ "$INSTALL_TYPE" == "native" ]; then
        deploy_native
    else
        echo -e "${RED}Invalid install type. Use 'docker' or 'native'${NC}"
        exit 1
    fi

    setup_firewall
    setup_nginx
    show_status
}

# Run main function
main "$@"