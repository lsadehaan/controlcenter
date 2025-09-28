# Standalone Agent Deployment

The Control Center agent can run independently without a manager connection, making it ideal for edge deployments, air-gapped environments, or simple automation tasks.

## Quick Start

1. **Build the agent:**
```bash
cd nodes
go build -o agent.exe .  # Windows
go build -o agent .      # Linux/Mac
```

2. **Create a configuration file:**
Use `standalone-config-example.json` as a template and customize for your needs.

3. **Run in standalone mode:**
```bash
./agent.exe -standalone -config standalone-config.json
```

## Standalone Mode Features

### ✅ What Works
- **File triggers**: Monitor directories for file changes
- **Scheduled triggers**: Run workflows at intervals
- **All workflow steps**: File operations, commands, alerts
- **SSH server**: Accept incoming SSH/SFTP connections (port 2222)
- **State persistence**: Survives restarts, maintains workflow state
- **Local alerts**: Saved to `~/.controlcenter-agent/alerts.json`
- **Health endpoint**: HTTP endpoint at port 8088

### ❌ What's Disabled
- Manager registration and communication
- Git configuration sync
- Remote configuration updates
- Alert forwarding to manager
- Centralized monitoring

## Configuration Structure

```json
{
  "agent_id": "unique-agent-id",
  "registered": true,
  "manager_url": "",
  "ssh_server_port": 2222,
  "workflows": [
    {
      "id": "workflow-id",
      "name": "Workflow Name",
      "trigger": {
        "type": "file|schedule",
        "config": {}
      },
      "steps": []
    }
  ]
}
```

## File Locations

- **Config directory**: `~/.controlcenter-agent/` or `AGENT_CONFIG_DIR`
- **State file**: `~/.controlcenter-agent/state.json`
- **Alerts**: `~/.controlcenter-agent/alerts.json`
- **SSH keys**: `~/.controlcenter-agent/agent_key[.pub]`
- **Logs**: Console output (redirect to file if needed)

## Example Use Cases

### 1. File Processing Pipeline
Monitor a directory and process files as they arrive:
```json
{
  "trigger": {
    "type": "file",
    "config": {
      "path": "/data/incoming",
      "pattern": "*.csv"
    }
  }
}
```

### 2. Scheduled Maintenance
Run cleanup tasks periodically:
```json
{
  "trigger": {
    "type": "schedule",
    "config": {
      "interval": 3600
    }
  }
}
```

### 3. Local Command Automation
Execute local scripts and commands:
```json
{
  "type": "command",
  "config": {
    "command": "/usr/local/bin/backup.sh",
    "args": ["--daily"]
  }
}
```

## Monitoring in Standalone Mode

### Health Check
```bash
curl http://localhost:8088/healthz
```

### View Local Alerts
```bash
cat ~/.controlcenter-agent/alerts.json | jq .
```

### Agent Info
```bash
curl http://localhost:8088/info
```

## Migration Path

### From Standalone to Managed
1. Stop the standalone agent
2. Start a manager instance
3. Generate a registration token
4. Restart agent without `-standalone` flag and with `-token`
5. Existing workflows will be preserved

### From Managed to Standalone
1. Ensure agent has latest configuration
2. Stop the agent
3. Restart with `-standalone` flag
4. Agent will use cached configuration

## Troubleshooting

### Agent won't start
- Check config file is valid JSON
- Ensure agent_id is unique
- Verify SSH port 2222 is available

### Workflows not executing
- Check trigger configuration
- Verify paths exist and have permissions
- Review console logs for errors

### Alerts not visible
- Check `~/.controlcenter-agent/alerts.json`
- Ensure write permissions on config directory
- Alerts are limited to last 1000 entries

## Security Considerations

- SSH keys are auto-generated if not present
- Config file should be protected (chmod 600)
- Consider firewall rules for ports 2222 and 8088
- Run as non-root user when possible

## Command Line Options

```bash
./agent -h

Options:
  -config string      Path to configuration file
  -standalone         Run in standalone mode without manager
  -push-config        Push local configuration changes to manager
  -check-changes      Check for local configuration changes
  -list-backups       List available configuration backups
  -recover-backup     Recover from backup (use 'latest' for most recent)
  -merge-config       Interactive merge of local and remote configurations
  -log-level string   Log level (debug, info, warn, error)
  -manager string     Manager URL (ignored in standalone mode)
  -token string       Registration token (ignored in standalone mode)
```

## Configuration Synchronization

### Check for Local Changes
Before syncing with manager, check if you have local changes:
```bash
./agent.exe -check-changes
```

### Push Local Changes to Manager
Save your local configuration back to the manager:
```bash
./agent.exe -push-config
```
This will:
1. Save your local config to the git repository
2. Commit changes with agent ID
3. Push to the manager's git server
4. Exit (does not start the agent)

### Warning System
The agent now warns you when:
- Local changes are detected during startup
- Git pull command would overwrite local changes
- Configuration is out of sync after operations

### Safe Migration Workflow

#### Standalone → Managed (with local changes)
```bash
# 1. Check what changes you have
./agent.exe -check-changes

# 2. Push your changes to manager
./agent.exe -push-config

# 3. Start in managed mode
./agent.exe
```

#### Managed → Standalone
```bash
# 1. Ensure you have latest config from manager
./agent.exe  # Let it sync, then Ctrl+C

# 2. Start in standalone mode
./agent.exe -standalone
```

### Handling Configuration Divergence

When both local and remote have changes:

#### Automatic Merge (Recommended)
```bash
./agent.exe -merge-config
```
This will:
1. Backup your local changes automatically
2. Pull remote changes from manager
3. Attempt to merge your changes on top
4. Guide you through conflict resolution if needed

#### Manual Merge (Advanced)
```bash
# 1. Let agent sync (creates automatic backup)
./agent.exe

# 2. Recover your changes
./agent.exe -recover-backup latest

# 3. Resolve conflicts if any
cd ~/.controlcenter-agent/config-repo
git status                          # See conflicted files
# Edit files to resolve conflicts
git add -A
git commit -m "Merged configurations"

# 4. Push merged config
./agent.exe -push-config
```

### Backup Recovery

The system automatically backs up your changes before any destructive operation:

```bash
# See all available backups
./agent.exe -list-backups

# Recover the most recent backup
./agent.exe -recover-backup latest

# Recover a specific backup
./agent.exe -recover-backup "stash@{0}"
./agent.exe -recover-backup "backup/agent-id/20240928-143022"
```

Backups are created automatically when:
- Git pull would overwrite local changes
- Manual merge workflow is initiated
- Configuration divergence is detected