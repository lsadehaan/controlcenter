# Testing the Control Center System

## Current Implementation Status

### ✅ Completed Features
- **Agent Registration**: Agents can register with manager using tokens
- **WebSocket Communication**: Real-time heartbeat and commands
- **Workflow Executor**: Integrated into agent, ready to run workflows
- **SSH/SFTP Server**: Each agent runs SSH server on port 2222
- **Git Configuration Sync**: Agents can pull configs from manager
- **Alert Forwarding**: Workflows can send alerts to manager
- **Visual Workflow Editor**: Drag-and-drop workflow creation in UI

### ⚠️ Partially Implemented
- **File Triggers**: Code exists but needs testing
- **Scheduled Triggers**: Basic interval support, no cron yet
- **Remote Commands**: SSH server ready but workflow steps need testing
- **Git Server**: Manager has git capabilities but endpoint not exposed

### ❌ Not Yet Implemented
- **JavaScript Execution**: Goja integration pending
- **Webhook Triggers**: Not implemented
- **Full SFTP Protocol**: Basic file transfer only

## How to Test the System

### 1. Start the Manager
```bash
cd manager
npm start
```
Access at http://localhost:3000

### 2. Generate Registration Token
- Navigate to http://localhost:3000/agents
- Click "Generate Registration Token"
- Copy the token

### 3. Start an Agent
```bash
cd nodes
go build -o agent.exe .
./agent.exe -token YOUR_TOKEN
```

The agent will:
- Register with the manager
- Start SSH server on port 2222
- Start health endpoint on port 8088
- Begin sending heartbeats

### 4. Create a Test Workflow

#### Option A: Use the Visual Editor
1. Go to http://localhost:3000/workflow-editor
2. Drag a "File Trigger" from the palette
3. Add action nodes (Copy File, Alert, etc.)
4. Connect the nodes
5. Configure properties in the right panel
6. Save the workflow

#### Option B: Use the API
```bash
# Create a workflow
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d @test-workflow.json

# Deploy to an agent
curl -X POST http://localhost:3000/api/workflows/WORKFLOW_ID/deploy \
  -H "Content-Type: application/json" \
  -d '{"agentIds": ["AGENT_ID"]}'
```

### 5. Test Workflow Execution

For file trigger workflows:
1. Create test directories:
   ```bash
   mkdir -p C:\temp\watch
   mkdir -p C:\temp\backup
   mkdir -p C:\temp\processed
   ```

2. Create a test file:
   ```bash
   echo "test content" > C:\temp\watch\test.txt
   ```

3. Watch the agent logs for workflow execution

### 6. Monitor System

- **Agent Status**: http://localhost:3000/agents
- **Alerts**: http://localhost:3000/alerts  
- **Logs**: http://localhost:3000/logs
- **Agent Health**: http://localhost:8088/healthz
- **Agent Info**: http://localhost:8088/info

## Testing Scenarios

### Scenario 1: Basic File Processing
1. Deploy the test-workflow.json to an agent
2. Create a .txt file in C:\temp\watch
3. Verify:
   - File is copied to C:\temp\backup
   - Alert appears in manager
   - File is moved to C:\temp\processed

### Scenario 2: Configuration Update
1. Modify agent config in manager
2. Send reload command:
   ```bash
   curl -X POST http://localhost:3000/api/agents/AGENT_ID/command \
     -H "Content-Type: application/json" \
     -d '{"command": "reload-config"}'
   ```
3. Verify agent reloads workflows

### Scenario 3: SSH Connectivity (Future)
1. Deploy workflow with SSH command step
2. Ensure agents have each other's public keys
3. Test remote command execution

## Troubleshooting

### Agent Won't Connect
- Check manager is running on port 3000
- Verify token is valid and not expired
- Check firewall settings

### Workflows Not Executing
- Verify workflow is deployed to agent
- Check agent logs for errors
- Ensure trigger paths exist
- Verify workflow is enabled

### SSH Server Issues
- Default port is 2222 (may conflict)
- Check authorized keys are configured
- Verify private key exists

## API Quick Reference

### Agents
```bash
GET  /api/agents              # List all agents
POST /api/agents/:id/command  # Send command to agent
```

### Workflows
```bash
GET  /api/workflows           # List workflows
POST /api/workflows           # Create workflow
POST /api/workflows/:id/deploy # Deploy to agents
```

### Tokens
```bash
POST /api/tokens              # Generate registration token
```

### Monitoring
```bash
GET /api/alerts               # Get alerts
GET /api/logs                 # Get logs
```

## Next Steps for Full Implementation

1. **Complete Trigger Types**
   - Implement cron scheduling
   - Add webhook triggers
   - Test file system watchers

2. **Enhance Workflow Steps**
   - Add HTTP request step
   - Implement conditional logic
   - Add loop support

3. **Distributed Features**
   - Test SSH command execution
   - Implement SFTP file transfers
   - Add agent-to-agent communication

4. **Observability**
   - Enhance log aggregation
   - Add metrics collection
   - Implement alert notifications

5. **Security**
   - Add authentication to Manager UI
   - Implement role-based access control
   - Add audit logging