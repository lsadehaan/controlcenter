# Release Notes

This file contains release notes for Control Center. When a new tag is pushed, the CI/CD pipeline will automatically create a GitHub release using the notes for that version.

## Format

Each release should have a section with the version number as a heading level 2 (`##`). The content under that heading will be used as the release notes.

---

## v0.14.0

### Improvements

- **Branch merge**: Merged feature/auth branch into main, bringing all v0.13.0 authentication features to the main branch
- **Repository cleanup**: Added database and config-repo to .gitignore to prevent tracking runtime data
- **Conflict resolution**: Resolved merge conflicts in .gitignore and websocket server

### Technical Changes

- `.gitignore`: Added `data/control-center.db` and `data/config-repo/` to prevent tracking runtime files
- `websocket/server.js`: Removed duplicate node-fetch require statement
- Deleted `.claude/settings.local.json` (local-only file)

### Impact

- Main branch now includes all authentication and security features from v0.13.0
- Runtime data no longer tracked in git, preventing unnecessary merge conflicts
- Clean repository structure with proper .gitignore rules

### Upgrading from v0.13.0

No changes required - v0.14.0 is v0.13.0 merged into main with minor cleanup. If you're on v0.13.0 from the feature/auth branch, v0.14.0 is functionally identical.

---

## v0.13.0

### Security Enhancements

- **Enterprise-grade authentication system** with JWT-based security for both web UI and API access
- **Password requirements**: Enforced 8+ character minimum with uppercase, lowercase, and number requirements
- **Rate limiting**: Protection against brute force attacks (5 attempts per 15 minutes per IP/username)
- **CSRF protection**: Cookie-based CSRF tokens on all authentication forms
- **Security headers**: Helmet.js integration adds production-ready security headers
  - Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, etc.
- **Auth event logging**: Comprehensive audit trail for all authentication events (login success/failure, bootstrap, logout)
- **Secure cookies**: HttpOnly, SameSite=lax cookies with configurable secure flag for production
- **Bootstrap protection**: First-run setup only accessible when no users exist
- **Complete route protection**: All UI and API routes require authentication

### New Features

- **Bootstrap flow**: First-run setup creates initial admin user via `/auth/bootstrap`
- **Dual authentication modes**: Cookie-based for UI, Bearer token for API
- **JWT_SECRET validation**: Startup warning if using default insecure secret
- **Password manager integration**: Proper autocomplete attributes for password managers
- **Error preservation**: Username preserved in login form after failed attempts
- **Session management**: Database schema includes sessions table for future token blacklisting/revocation

### Code Quality & Architecture Improvements

- **Centralized configuration**: All environment variables managed in single `src/config.js` module
- **Agent proxy timeouts**: 10-second timeout on all agent HTTP requests prevents hanging (configurable via AGENT_PROXY_TIMEOUT)
- **Centralized error handling**: Unified Express error handler with JSON for API, rendered page for UI
- **Request logging middleware**: Optional HTTP request logging (enable with LOG_REQUESTS=true)
- **Lint scripts**: Added `npm run lint` and `npm run lint:fix` for code quality
- **CSS/JS extraction**: Separated inline styles/scripts into dedicated files for better maintainability
- **Improved 403 handling**: Authorization middleware now uses centralized error handler for consistent responses
- **Repository cleanup**: Removed 20 obsolete test files, SWAP data, and outdated documentation

### Configuration

**Required environment variables for production:**
```bash
export JWT_SECRET="$(openssl rand -base64 32)"  # Required
export NODE_ENV="production"                     # Enables secure cookies (HTTPS)
export COOKIE_SECURE="true"                      # Force secure cookies
```

**Optional configuration:**
```bash
export PORT=3000                                 # Server port
export GIT_SSH_PORT=2223                        # Git SSH server port
export AGENT_DEFAULT_PORT=8088                  # Agent default port
export AGENT_PROXY_TIMEOUT=10000               # Agent request timeout (ms)
export LOG_REQUESTS=true                        # Enable request logging
export AUTH_RATE_LIMIT_MAX=5                   # Max login attempts
export API_RATE_LIMIT_MAX=100                  # Max API requests per window
```

### API Changes

- **New endpoints**:
  - `GET /auth/login` - Login page
  - `POST /auth/login` - UI login form handler
  - `POST /auth/api/login` - API login (returns JWT token)
  - `GET /auth/bootstrap` - First-run admin setup page
  - `POST /auth/bootstrap` - Create first admin user
  - `POST /auth/logout` - Logout and clear session

- **Protected endpoints**: All `/api/*` and UI routes now require authentication
- **Health endpoints**: `/health` and `/api/health` remain publicly accessible

### Security Features

- **Bcrypt password hashing**: 10 salt rounds for secure password storage
- **JWT token expiration**: 7-day token lifetime
- **Rate limiting headers**: RateLimit-* headers per RFC 6585
- **Comprehensive logging**: All auth events logged with timestamp, username, IP, and event type
- **CSRF token rotation**: New token on every form render

### Breaking Changes

- **Authentication required**: All existing API integrations must now authenticate
  - Use `POST /auth/api/login` to obtain JWT token
  - Pass token as `Authorization: Bearer <token>` header
  - Or use cookie-based authentication for browser access
- **Database migration**: Adds `users` and `sessions` tables (automatic on startup)
- **No anonymous access**: All UI pages redirect to login if unauthenticated

### Upgrading from v0.12.x

1. **Backup database** before upgrading
2. **Update Manager** to v0.13.0
3. **Set JWT_SECRET** environment variable (required for production)
4. **First login**: Visit manager URL, will redirect to bootstrap to create admin user
5. **Update API integrations**: Add authentication to all API calls
6. **Test authentication**: Verify login/logout and API access work correctly

### Database Schema Changes

**New tables:**
- `users` table: Stores admin users with bcrypt-hashed passwords
- `sessions` table: Reserved for future session management features

### Deployment Notes

- JWT_SECRET warning appears on startup if using default value
- Bootstrap page only accessible when no users exist in database
- All authentication events logged to stdout in JSON format for audit trails
- Rate limiting state is in-memory (resets on restart; use Redis for persistence in production)

### Documentation Updates

- Added comprehensive Security & Authentication section to CLAUDE.md
- Documented environment variables and security features
- Added sessions table usage documentation
- Updated development commands with production environment variables

---

## v0.12.2

### Critical Architectural Fix

- **Separated Local and Managed Configuration**: Agent configuration now properly distinguishes between local machine-specific settings and Git-managed settings
  - Local settings (agentId, managerUrl, paths, etc.) saved to `agent-config.json`
  - Managed settings (workflows, fileBrowserSettings, SSH settings, etc.) loaded from Git repository only
  - Prevents configuration drift where settings duplicated in both local config and Git

### Changes

- **Modified `config.Save()`**: Now only persists local machine-specific settings
  - Saves: agentId, managerUrl, registrationToken, registered, SSH key paths, config repo path, state file path, log file path
  - Excludes: workflows, fileBrowserSettings, fileWatcherSettings, logSettings, sshServerPort, authorizedSSHKeys

- **Removed inappropriate `Save()` calls**: Eliminated 4 Save() calls that were incorrectly persisting managed settings
  - Line 718: After removing workflow (workflows are Git-managed)
  - Line 808: After git-pull updates config
  - Line 928: After WebSocket config update
  - Line 1036: After reload-config from Git

### Backwards Compatibility

- **Automatic migration**: Agents with old-style configs (containing managed settings) are automatically cleaned on first Save()
- Existing configurations work seamlessly - old managed settings are simply ignored and not re-saved
- No manual migration required

### Impact

- **Eliminates config drift**: Settings no longer duplicated between local config and Git repository
- **Single source of truth**: Git repository is definitive source for all managed settings
- **Cleaner configuration files**: Local configs stay lean with only machine-specific data
- **Better separation of concerns**: Clear distinction between local and managed configuration

### Testing

Verified scenarios:
- ✅ Old-style config with managed settings automatically cleaned
- ✅ agent-config.json stays clean through multiple operations (start/stop, Git sync, reloads)
- ✅ Managed settings (fileBrowserSettings, workflows) load correctly from Git
- ✅ No managed settings leak into local config file

### Deployment

1. Update Agent to v0.12.2
2. On first start with new code, agent-config.json will be automatically cleaned (if it contains managed settings)
3. No manager changes required
4. No manual migration needed - fully backwards compatible

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
