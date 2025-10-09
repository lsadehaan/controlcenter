# Release Notes

This file contains release notes for Control Center. When a new tag is pushed, the CI/CD pipeline will automatically create a GitHub release using the notes for that version.

## Format

Each release should have a section with the version number as a heading level 2 (`##`). The content under that heading will be used as the release notes.

---

## v0.12.1

### UX Improvements

- **File Browser Configuration UI**: Added dedicated File Browser Settings section to the agent configuration page
  - Enable/disable toggle with clear description
  - Allowed paths management with add/remove buttons
  - Max upload size configuration with helpful default hint
  - Max list items configuration with description
  - Visual path list with individual remove buttons
  - User-friendly interface eliminates need to edit JSON directly

### Changes

- Enhanced `agent-configure.ejs` with File Browser Settings section
- Added JavaScript functions for managing allowed paths (add, remove, refresh)
- Updated save configuration to include file browser settings
- All file browser settings now configurable through the UI

### Impact

- Users can now easily enable/disable file browser without editing config files
- Path management is more intuitive with visual add/remove interface
- Clear descriptions help users understand each setting
- Reduced errors from manual JSON editing

### Deployment

1. Update Manager to v0.12.1 (UI changes only in `agent-configure.ejs`)
2. No agent changes required
3. No database schema changes
4. Existing configurations remain compatible

---

## v0.12.0

### New Features

- **File Browser**: Complete file management interface for browsing, downloading, and uploading files on agents through the manager UI
  - Browse directories with breadcrumb navigation
  - Download files from agent to browser
  - Upload files from browser to agent with progress indicator
  - Create new directories
  - Delete files and folders
  - File/folder icons based on type
  - File size and modification date display

### Security Model

- **Disabled by default**: File browser must be explicitly enabled in agent configuration
- **Path whitelist**: Only configured paths are accessible (defaults to agent data directory only)
- **Path traversal protection**: Prevents `..` attacks and validates all paths
- **Upload size limits**: Configurable maximum upload size (default: 100MB)
- **Directory list limits**: Configurable maximum items per directory (default: 1000)

### Configuration

Add to agent configuration to enable:
```json
{
  "fileBrowserSettings": {
    "enabled": true,
    "allowedPaths": [
      "C:\\Projects\\myproject",
      "/home/user/data",
      "~/documents"
    ],
    "maxUploadSize": 104857600,
    "maxListItems": 1000
  }
}
```

### API Endpoints

All endpoints are proxied through the manager:
- `GET /api/agents/:id/files/browse?path=...` - Browse directory
- `GET /api/agents/:id/files/download?path=...` - Download file
- `POST /api/agents/:id/files/upload` - Upload file (multipart/form-data)
- `POST /api/agents/:id/files/mkdir?path=...` - Create directory
- `DELETE /api/agents/:id/files/delete?path=...` - Delete file/folder

### Implementation Details

**Agent Side (Go)**:
- New package: `nodes/internal/filebrowser/filebrowser.go`
- 5 HTTP endpoints for file operations
- Complete path validation and security checks
- Added `FileBrowserSettings` to agent configuration

**Manager Side (Node.js)**:
- Proxy routes in `manager/src/routes/api.js`
- Multipart form data support for uploads (using multer)
- Stream-based file downloads
- Error handling and agent status validation

**UI (EJS/JavaScript)**:
- New "Files" tab in agent details page (`manager/views/agent-details.ejs`)
- Interactive file browser with modern UI
- Upload/download dialogs with progress tracking
- Breadcrumb navigation and file type icons

### Impact

- Remote file management without SSH/SFTP access
- Centralized file operations through manager UI
- Secure by default with granular path control
- Useful for log collection, config file editing, and data transfers

### Deployment

1. Update Manager to v0.12.0 (includes new UI and API routes)
2. Update Agent to v0.12.0 (includes file browser endpoints)
3. Configure `fileBrowserSettings` in agent config to enable feature
4. No database schema changes

---

## v0.11.12

### UX Improvements

- **Workflow Executions UI Overhaul**: Complete redesign of the workflow executions page with modern, professional interface
- **Fixed "undefined" workflow name bug**: Now displays actual workflow names instead of "undefined"
- **Advanced filtering system**: Filter by workflow, status, date range, and search through errors/context
- **Real-time statistics dashboard**: Total executions, success rate, average duration, and breakdown by status
- **Auto-refresh capability**: Automatic updates every 5s/10s/30s/60s with toggle control
- **Expandable execution details**: Click any execution to view context, completed steps, and error details
- **Flexible pagination**: 10/25/50/100 executions per page with smart navigation
- **Multiple sorting options**: Sort by newest/oldest, longest/shortest duration
- **Compact and detailed view modes**: Switch between concise and comprehensive displays
- **Visual enhancements**: Status badges, trigger icons, relative timestamps, hover effects

### New Features

- **Workflow name lookup**: Fetches workflow configurations to display friendly names
- **Trigger type icons**: Visual indicators (📁 file, 📅 schedule, 🔗 webhook, 👤 manual)
- **Time ago display**: Shows "2m ago", "5h ago" with full timestamp on hover
- **Step-by-step execution view**: See exactly which steps completed with their names and IDs
- **Context viewer**: JSON-formatted display of workflow trigger context
- **Error detail formatting**: Monospace code blocks for easy error reading
- **Smart empty states**: Clear messaging when no executions match filters

### Technical Improvements

- **Client-side filtering**: Fast, responsive filtering without server calls
- **Efficient rendering**: Only renders visible page items for better performance
- **Memory management**: Auto-refresh automatically stops when leaving page
- **Graceful degradation**: Handles offline agents and missing data properly
- **Responsive design**: Flexbox layout adapts to different screen sizes
- **Modular code structure**: Clean separation of rendering, filtering, and statistics logic

### Impact

- Users can now easily track workflow execution history
- Quick identification of failed executions with detailed error information
- Better understanding of workflow performance with statistics
- Improved troubleshooting with detailed step-by-step execution logs
- Professional, modern UI that scales with large execution histories

### Deployment

1. Update Manager to v0.11.12 (UI changes only in `agent-details.ejs`)
2. No agent changes required
3. No database schema changes

---

## v0.11.11

### Fixes

- **Fix CI/CD workflow asset filenames**: Release assets now include version in filename (e.g., `agent-linux-v0.11.11.tar.gz` instead of `agent-linux-.tar.gz`)
- Changed workflow to extract version from git ref instead of using empty `github.event.release.tag_name`

### Impact

- Proper asset filenames make it clear which version is being downloaded
- Fixes issue where all versioned assets had empty version strings

### Deployment

1. This is a CI/CD fix only - no code changes
2. No manager or agent updates required

---

## v0.11.10

### UX Improvements

- **Workflow Editor: Unsaved changes tracking**: Save button turns red with asterisk (*) when there are unsaved changes
- **Workflow Editor: Navigation warning**: Browser warns before leaving page with unsaved changes
- **Workflow Editor: Smart deployment dialog**: After saving existing workflows, shows dialog with agents that have the workflow deployed
- **Workflow Editor: Selective agent updates**: Choose which agents to update with checkboxes (all selected by default)
- **API: Get workflow agents**: New endpoint `GET /api/workflows/:id/agents` to list agents using a workflow

### Improvements

- Track all workflow changes: node creation/deletion/movement, connections, and property updates
- Prevent accidental loss of work with browser beforeunload warning
- Streamlined workflow update process with immediate deployment option
- Better visibility into which agents are using workflows

### Impact

- Users won't accidentally lose workflow edits
- Clear indication when changes need to be saved
- Faster workflow deployment with selective agent targeting
- Eliminates confusion about whether changes were saved

### Technical Details

- Added change tracking for all Drawflow events (nodeCreated, nodeRemoved, nodeMoved, connectionCreated, connectionRemoved)
- Property updates via "Update" button now mark workflow as changed
- After saving existing workflow, fetches agents with that workflow and displays modal dialog
- All agents pre-selected in dialog with option to uncheck specific agents
- Skip option available if user doesn't want to deploy immediately

### Deployment

1. Update Manager to v0.11.10 (workflow editor changes only)
2. No agent changes required

---

## v0.11.9

### Critical Fixes

- **Fix UI not showing agent config after Git push**: Manager now automatically syncs database from Git repository after agents push configuration changes
- Database is updated immediately after successful `git-receive-pack` completes

### Improvements

- Added `syncDatabaseAfterPush()` method to GitSSHServer that reads config from Git and updates database
- Added `updateAgentConfig()` method to Database class for targeted config updates
- Automatic sync ensures UI always reflects latest agent configuration

### Impact

- UI now displays current agent configuration immediately after agent pushes changes
- No manual intervention required to sync database with Git repository
- Resolves discrepancy between Git repository (source of truth) and database (UI state)

### Technical Details

When an agent pushes configuration via Git SSH:
1. `git-receive-pack` completes successfully
2. Git repository is updated with new configuration
3. Manager reads the updated config file from Git
4. Manager updates the agent's config column in database
5. UI immediately reflects the changes on next page load/refresh

### Deployment

1. Update Manager to v0.11.9 and restart
2. Agents do not require changes for this fix

---

## v0.11.4

### Improvements

- **Enhanced Git SSH server logging**: Comprehensive error logging for all stream and process errors
- **Real-time stderr logging**: Git errors logged immediately as they occur
- **Stream error handling**: Added error handlers for all pipe connections
- **Better debugging**: Logs when streams close and processes are killed

### Changes

- Manager: Log all git stderr output in real-time
- Manager: Add error handlers for stdin/stdout pipes
- Manager: Log SSH stream closure events
- Manager: Track and log all git process lifecycle events

### Purpose

This release adds extensive logging to help diagnose Git SSH push/pull issues. No functional changes, only improved observability.

---

## v0.11.5

### Critical Fixes

- Fix Git-over-SSH push hang: Use stateful SSH protocol (no `--stateless-rpc`) and correct bidirectional piping
- Send SSH exit-status properly and avoid premature channel close; client now receives exit code 0 on success
- Forward git stderr to SSH channel for proper client-side progress/errors

### Improvements

- Hardened stream handling: prevent auto-ending SSH channel by using `{ end: false }` on stdout/stderr pipes
- More robust lifecycle logging for git child process and SSH channel

### Impact

- Agents and developers can push to `ssh://<manager>:2223/config-repo` reliably without hangs
- No schema changes; Manager restart required

### Upgrading

1. Update Manager to v0.11.5 and restart
2. Agents do not require changes for this fix

---

## v0.11.8

### Improvements

- **Enhanced backup notifications when pulling config**: Agent now clearly warns when local changes are detected and backed up during pull
- **Clear recovery instructions**: Shows exact commands to recover backed up changes (`./agent -recover-backup latest`)
- **Abort on backup failure**: Pull now aborts if backup fails, preventing accidental data loss
- **Better logging**: Uses warning level (yellow) for backup notifications to ensure visibility

### Changes

- Pull() now logs prominent warnings when backing up local changes
- BackupLocalChanges() provides clear recovery instructions for both stash and branch backups
- Failed backups now abort the pull operation instead of proceeding with caution

### Impact

- Users will no longer miss when their local changes are being backed up
- Clearer path to recovery when changes diverge
- Prevents data loss from failed backups

### Deployment

1. Update Agent to v0.11.8
2. No manager changes required

---

## v0.11.7

### Critical Fixes

- **Fix "Working directory has unstaged changes" push rejection**: Manager now auto-commits any pending changes in config-repo on startup to ensure clean working directory
- This allows agents to push successfully when using `receive.denyCurrentBranch=updateInstead`

### Improvements

- Added `autoCommitPendingChanges()` method to GitServer that runs on startup for existing repositories
- Automatically stages and commits all changes with timestamped message

### Impact

- Agents can now reliably push configurations without "Working directory has unstaged changes" errors
- Manager working directory stays clean automatically
- No manual intervention required after manager updates

### Deployment

1. Update Manager to v0.11.7 and restart
2. Agents do not require changes

---

## v0.11.6

### Improvements

- Manager automatically configures the config-repo to accept pushes to the checked-out branch by setting `receive.denyCurrentBranch=updateInstead` during startup (and ensures it for existing repos).

### Impact

- Eliminates manual server-side configuration after install/upgrade when agents push configs via SSH.

### Deployment

- Restart the Manager service after upgrade; no agent changes required.

---

## v0.11.3

### Critical Fixes

- **Fixed Git SSH server hanging**: Manager now correctly uses `.git` directory for git-upload-pack, resolving infinite hang on git operations
- **Fixed push-config not detecting committed changes**: Agent now properly detects local commits ahead of remote, not just uncommitted files
- **Fixed agent hanging on git fetch**: Added 10-second timeout to prevent indefinite hangs when manager is unreachable
- **Auto-update git remote URL on startup**: Agents automatically update from HTTP to SSH URLs when needed

### Improvements

- **Better error logging**: Manager logs detailed git process errors, exit codes, and stderr output
- **Improved push error reporting**: Agent shows clear error messages with proper exit codes
- **Better change detection**: Separate warnings for uncommitted changes vs committed changes ahead of remote
- **Cross-platform compatibility**: All git operations work correctly on both Windows and Linux
- **Automated release tagging**: Releases now automatically marked as "latest" for deploy scripts

### Changes

- Manager: Use `.git` directory path for git commands in non-bare repositories
- Manager: Remove `shell: true` from spawn to fix deprecation warning
- Agent: Added `HasCommitsAhead()` function to detect local commits that need pushing
- Agent: Push operation now works with both uncommitted and already-committed changes
- Agent: Remote URL automatically updated during git config setup
- Agent: Git fetch operations timeout after 10 seconds instead of hanging forever
- CI/CD: Releases automatically tagged as latest

### Upgrading from v0.11.0, v0.11.1, or v0.11.2

This release fixes critical issues discovered in v0.11.x:
1. **Manager upgrade required**: The git-upload-pack hanging issue is fixed
2. **Agent upgrade required**: Agents will handle network issues gracefully with timeouts
3. Agents with existing HTTP URLs will automatically switch to SSH
4. Push operations will properly detect and push all local changes

---

## v0.11.2

### Critical Fixes

- **Fixed Git SSH server hanging**: Manager now correctly uses `.git` directory for git-upload-pack, resolving infinite hang on git operations
- **Fixed push-config not detecting committed changes**: Agent now properly detects local commits ahead of remote, not just uncommitted files
- **Fixed agent hanging on git fetch**: Added 10-second timeout to prevent indefinite hangs when manager is unreachable
- **Auto-update git remote URL on startup**: Agents automatically update from HTTP to SSH URLs when needed

### Improvements

- **Better error logging**: Manager logs detailed git process errors, exit codes, and stderr output
- **Improved push error reporting**: Agent shows clear error messages with proper exit codes
- **Better change detection**: Separate warnings for uncommitted changes vs committed changes ahead of remote
- **Cross-platform compatibility**: All git operations work correctly on both Windows and Linux

### Changes

- Manager: Use `.git` directory path for git commands in non-bare repositories
- Manager: Remove `shell: true` from spawn to fix deprecation warning
- Agent: Added `HasCommitsAhead()` function to detect local commits that need pushing
- Agent: Push operation now works with both uncommitted and already-committed changes
- Agent: Remote URL automatically updated during git config setup
- Agent: Git fetch operations timeout after 10 seconds instead of hanging forever

### Upgrading from v0.11.0 or v0.11.1

This release fixes critical issues discovered in v0.11.0/v0.11.1:
1. **Manager upgrade required**: The git-upload-pack hanging issue is fixed
2. **Agent upgrade required**: Agents will handle network issues gracefully with timeouts
3. Agents with existing HTTP URLs will automatically switch to SSH
4. Push operations will properly detect and push all local changes

---

## v0.11.1

### Fixes

- **Fixed misleading push-config success message**: Agent now properly reports when push fails with HTTP 403 or other errors
- **Auto-update git remote URL**: Agents upgrading from HTTP to SSH will automatically update their remote URL
- **Proper exit codes**: `-push-config` now exits with code 1 on failure for script detection
- **Better error messages**: Clear indication when push fails with actionable error details

### Upgrading from v0.11.0

If you upgraded to v0.11.0 and are seeing HTTP 403 errors when pushing:
1. Upgrade agent to v0.11.1
2. Agent will automatically update the git remote URL from HTTP to SSH
3. Push will work correctly

### Related Issues
- Agents with existing HTTP remote URLs couldn't push after v0.11.0 upgrade
- Push failures were silently reported as success

---

## v0.11.0

### New Features

- **Git-over-SSH for Configuration Sync**: Manager now runs Git SSH server on port 2223
- **SSH-based Authentication**: Agents authenticate using their SSH keys for config pulls
- **Automatic Config Preservation**: Agent configuration preserved during re-registration

### Changes

- Git SSH port changed from 9418 to 2223
- Agents now use SSH protocol instead of Git protocol for config sync
- Docker configuration updated to expose Git SSH port

### Breaking Changes

Manager and agents must both be upgraded to v0.11.0 for Git sync to work properly.

### Deployment Notes

- Update firewall rules to allow port 2223 for Git SSH
- Docker deployments automatically configured with correct ports
- Native deployments may need manual firewall configuration

---

## Template for New Releases

Copy this template when creating a new release:

```markdown
## vX.Y.Z

### New Features
- Feature description

### Fixes
- Bug fix description

### Changes
- Change description

### Breaking Changes
- Breaking change description

### Upgrading
- Upgrade instructions if needed

### Known Issues
- Any known issues
```
