#!/bin/bash
# Control Center Agent Deployment Script for Ubuntu
# Deploys the agent as a native systemd service

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
REGISTRATION_TOKEN="${1}"
MANAGER_URL="${2:-http://localhost:3000}"
AGENT_DIR="${AGENT_DIR:-/opt/controlcenter/agent}"
AGENT_USER="${AGENT_USER:-controlcenter-agent}"
API_PORT="${API_PORT:-8088}"
SSH_PORT="${SSH_PORT:-2222}"
LOG_LEVEL="${LOG_LEVEL:-info}"
RELEASE_VERSION="${RELEASE_VERSION:-latest}"

echo -e "${GREEN}Control Center Agent Deployment${NC}"
echo "Manager URL: $MANAGER_URL"
echo "Agent Directory: $AGENT_DIR"
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

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${YELLOW}This script needs sudo privileges. Re-running with sudo...${NC}"
        exec sudo "$0" "$@"
    fi
}

# Install dependencies
install_dependencies() {
    echo -e "${YELLOW}Installing dependencies...${NC}"

    apt-get update
    apt-get install -y \
        curl \
        wget \
        git \
        openssh-client \
        ca-certificates

    echo -e "${GREEN}✓ Dependencies installed${NC}"
}

# Create agent user
create_user() {
    if id "$AGENT_USER" &>/dev/null; then
        echo -e "${GREEN}✓ User $AGENT_USER already exists${NC}"
    else
        echo -e "${YELLOW}Creating user $AGENT_USER...${NC}"
        useradd -r -s /bin/bash -d $AGENT_DIR -m $AGENT_USER
        echo -e "${GREEN}✓ User $AGENT_USER created${NC}"
    fi
}

# Download agent binary
download_agent() {
    echo -e "${YELLOW}Downloading agent binary...${NC}"

    # Create directories
    mkdir -p $AGENT_DIR
    cd $AGENT_DIR

    # Determine download URL
    if [ "$RELEASE_VERSION" == "latest" ]; then
        DOWNLOAD_URL="https://github.com/lsadehaan/controlcenter/releases/latest/download/agent-linux-amd64"
    else
        DOWNLOAD_URL="https://github.com/lsadehaan/controlcenter/releases/download/${RELEASE_VERSION}/agent-linux-amd64"
    fi

    # Try to download release binary
    if wget -q -O agent "$DOWNLOAD_URL" 2>/dev/null; then
        chmod +x agent
        echo -e "${GREEN}✓ Agent binary downloaded from release${NC}"
    else
        echo -e "${RED}Error: No release binary found for version ${RELEASE_VERSION}${NC}"
        echo -e "${RED}The release binaries have not been built yet.${NC}"
        echo ""
        echo "Please either:"
        echo "  1. Wait for the CI/CD pipeline to build the binaries"
        echo "  2. Check https://github.com/lsadehaan/controlcenter/releases for available versions"
        echo "  3. Build from source manually:"
        echo ""
        echo "     git clone https://github.com/lsadehaan/controlcenter.git"
        echo "     cd controlcenter/nodes"
        echo "     go build -o agent ."
        echo "     sudo mv agent /opt/controlcenter/agent/"
        echo ""
        exit 1
    fi
}

# Configure agent
configure_agent() {
    echo -e "${YELLOW}Configuring agent...${NC}"

    # Create config directory
    mkdir -p $AGENT_DIR/.controlcenter-agent

    # Set environment file
    cat > $AGENT_DIR/.env << EOF
# Control Center Agent Configuration
MANAGER_URL=$MANAGER_URL
LOG_LEVEL=$LOG_LEVEL
API_PORT=$API_PORT
SSH_PORT=$SSH_PORT
AGENT_CONFIG_DIR=$AGENT_DIR/.controlcenter-agent
EOF

    # Set ownership
    chown -R $AGENT_USER:$AGENT_USER $AGENT_DIR

    echo -e "${GREEN}✓ Agent configured${NC}"
}

# Create systemd service
create_service() {
    echo -e "${YELLOW}Creating systemd service...${NC}"

    cat > /etc/systemd/system/controlcenter-agent.service << EOF
[Unit]
Description=Control Center Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$AGENT_USER
Group=$AGENT_USER
WorkingDirectory=$AGENT_DIR
ExecStart=$AGENT_DIR/agent
Restart=always
RestartSec=10

# Environment
Environment="MANAGER_URL=$MANAGER_URL"
Environment="LOG_LEVEL=$LOG_LEVEL"
Environment="API_PORT=$API_PORT"
Environment="SSH_PORT=$SSH_PORT"
Environment="AGENT_CONFIG_DIR=$AGENT_DIR/.controlcenter-agent"

# Security
NoNewPrivileges=true
PrivateTmp=false
ProtectSystem=strict
ProtectHome=false
ReadWritePaths=$AGENT_DIR /tmp /var/tmp
ReadOnlyPaths=/etc /usr

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=controlcenter-agent

# Resource limits
LimitNOFILE=65536
TasksMax=4096

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    echo -e "${GREEN}✓ Systemd service created${NC}"
}

# Register agent if token provided
register_agent() {
    if [ -z "$REGISTRATION_TOKEN" ]; then
        echo -e "${YELLOW}No registration token provided. You can register the agent later by running:${NC}"
        echo -e "${GREEN}sudo -u $AGENT_USER $AGENT_DIR/agent -token YOUR_TOKEN${NC}"
        return
    fi

    echo -e "${YELLOW}Registering agent with manager...${NC}"

    # Run registration as the agent user with environment
    if sudo -u $AGENT_USER \
        AGENT_CONFIG_DIR="$AGENT_DIR/.controlcenter-agent" \
        MANAGER_URL="$MANAGER_URL" \
        $AGENT_DIR/agent -token "$REGISTRATION_TOKEN" -manager-url "$MANAGER_URL" -register-only; then
        echo -e "${GREEN}✓ Agent registered successfully${NC}"
    else
        echo -e "${RED}Failed to register agent. Please check the token and manager URL.${NC}"
        echo -e "${YELLOW}You can try registering manually later with:${NC}"
        echo -e "${GREEN}sudo -u $AGENT_USER $AGENT_DIR/agent -token YOUR_TOKEN${NC}"
    fi
}

# Setup directories for workflows
setup_workflow_dirs() {
    echo -e "${YELLOW}Setting up workflow directories...${NC}"

    # Create common workflow directories
    mkdir -p /var/controlcenter/{incoming,processing,output,scripts,logs}

    # Set permissions - agent user owns the directories
    chown -R $AGENT_USER:$AGENT_USER /var/controlcenter
    chmod -R 755 /var/controlcenter

    # Create example workflow script
    cat > /var/controlcenter/scripts/example-processor.sh << 'EOF'
#!/bin/bash
# Example workflow processor script
# Usage: example-processor.sh <input-file>

INPUT_FILE="$1"
OUTPUT_FILE="${INPUT_FILE}.processed"

echo "Processing file: $INPUT_FILE"
echo "Processed at $(date)" > "$OUTPUT_FILE"
cat "$INPUT_FILE" >> "$OUTPUT_FILE"
echo "Output saved to: $OUTPUT_FILE"
EOF

    chmod +x /var/controlcenter/scripts/example-processor.sh
    chown $AGENT_USER:$AGENT_USER /var/controlcenter/scripts/example-processor.sh

    echo -e "${GREEN}✓ Workflow directories created:${NC}"
    echo "  - /var/controlcenter/incoming  (file watch directory)"
    echo "  - /var/controlcenter/processing (working directory)"
    echo "  - /var/controlcenter/output     (output directory)"
    echo "  - /var/controlcenter/scripts    (workflow scripts)"
    echo "  - /var/controlcenter/logs       (log files)"
}

# Setup firewall
setup_firewall() {
    echo -e "${YELLOW}Setting up firewall rules...${NC}"

    if command -v ufw &> /dev/null; then
        ufw allow ${API_PORT}/tcp comment 'Control Center Agent API'
        ufw allow ${SSH_PORT}/tcp comment 'Control Center Agent SSH'
        echo -e "${GREEN}✓ Firewall rules added${NC}"
    else
        echo -e "${YELLOW}UFW not found, skipping firewall setup${NC}"
    fi
}

# Start service
start_service() {
    echo -e "${YELLOW}Starting agent service...${NC}"

    systemctl enable controlcenter-agent
    systemctl start controlcenter-agent

    sleep 3

    if systemctl is-active --quiet controlcenter-agent; then
        echo -e "${GREEN}✓ Agent service started successfully${NC}"
    else
        echo -e "${RED}Failed to start agent service${NC}"
        echo -e "${YELLOW}Check logs with: journalctl -u controlcenter-agent -n 50${NC}"
        exit 1
    fi
}

# Show status
show_status() {
    echo ""
    echo -e "${GREEN}=====================================${NC}"
    echo -e "${GREEN}Control Center Agent Status${NC}"
    echo -e "${GREEN}=====================================${NC}"

    systemctl status controlcenter-agent --no-pager | head -n 10

    local IP=$(hostname -I | cut -d' ' -f1)

    echo -e "\n${GREEN}Agent Information:${NC}"
    echo -e "  Hostname:    $(hostname)"
    echo -e "  IP Address:  $IP"
    echo -e "  Agent Dir:   $AGENT_DIR"
    echo -e "  Config Dir:  $AGENT_DIR/.controlcenter-agent"
    echo -e "  User:        $AGENT_USER"

    echo -e "\n${GREEN}Network Endpoints:${NC}"
    echo -e "  API Health:  ${GREEN}http://$IP:${API_PORT}/healthz${NC}"
    echo -e "  API Info:    ${GREEN}http://$IP:${API_PORT}/info${NC}"
    echo -e "  SSH Server:  ${GREEN}ssh -p ${SSH_PORT} $IP${NC}"

    echo -e "\n${GREEN}Workflow Directories:${NC}"
    echo -e "  Watch:       /var/controlcenter/incoming"
    echo -e "  Processing:  /var/controlcenter/processing"
    echo -e "  Output:      /var/controlcenter/output"
    echo -e "  Scripts:     /var/controlcenter/scripts"

    echo -e "\n${YELLOW}Useful Commands:${NC}"
    echo "  View logs:        journalctl -u controlcenter-agent -f"
    echo "  Restart service:  systemctl restart controlcenter-agent"
    echo "  Stop service:     systemctl stop controlcenter-agent"
    echo "  Check status:     systemctl status controlcenter-agent"
    echo "  Test health:      curl http://localhost:${API_PORT}/healthz"

    if [ -z "$REGISTRATION_TOKEN" ]; then
        echo -e "\n${YELLOW}⚠️  Agent not registered yet!${NC}"
        echo "To register this agent:"
        echo "1. Get a registration token from the Manager UI"
        echo "2. Run: sudo -u $AGENT_USER $AGENT_DIR/agent -token YOUR_TOKEN"
    else
        echo -e "\n${GREEN}✓ Agent registered and running${NC}"
    fi
}

# Uninstall function
uninstall() {
    echo -e "${RED}Uninstalling Control Center Agent...${NC}"

    systemctl stop controlcenter-agent 2>/dev/null || true
    systemctl disable controlcenter-agent 2>/dev/null || true
    rm -f /etc/systemd/system/controlcenter-agent.service
    systemctl daemon-reload

    echo -e "${YELLOW}Remove agent directory and user? (y/n)${NC}"
    read -r response
    if [[ "$response" == "y" ]]; then
        userdel -r $AGENT_USER 2>/dev/null || true
        rm -rf $AGENT_DIR
        rm -rf /var/controlcenter
        echo -e "${GREEN}✓ Agent completely removed${NC}"
    else
        echo -e "${YELLOW}Agent service removed, but data preserved in $AGENT_DIR${NC}"
    fi
}

# Main execution
main() {
    if [ "$1" == "--uninstall" ]; then
        uninstall
        exit 0
    fi

    check_ubuntu
    check_root
    install_dependencies
    create_user
    download_agent
    configure_agent
    setup_workflow_dirs
    create_service
    register_agent
    setup_firewall
    start_service
    show_status
}

# Run main function
main "$@"