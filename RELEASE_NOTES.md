# Release Notes

This file contains release notes for Control Center. When a new tag is pushed, the CI/CD pipeline will automatically create a GitHub release using the notes for that version.

## Format

Each release should have a section with the version number as a heading level 2 (`##`). The content under that heading will be used as the release notes.

---

## v0.14.10

### Critical Fixes

- **Fixed workflow synchronization issue**: Agent's runtime state and manager database can now be synchronized when out of sync
  - Root cause: GET operation fetched workflows from agent (source of truth), but DELETE operation checked manager database (tracking layer)
  - This caused "Workflow not found on this agent" errors when trying to delete workflows visible in the UI
  - Users were unable to delete workflows that existed on the agent but not in the database

- **Fixed JSON.parse bug in workflow loading**: Manager UI now correctly handles agent configuration
  - Root cause: API returns `config` as an object, but code tried to `JSON.parse()` it
  - Error: `"[object Object]" is not valid JSON`
  - Solution: Removed unnecessary `JSON.parse()` call in `loadDeployedWorkflows()`

### New Features

- **Workflow Sync Detection Modal**: Automatically detects when agent and manager are out of sync
  - Shows clear list of workflows on agent vs database
  - Displays when loading the Workflows tab on agent details page
  - Two sync options:
    - **Agent → Manager**: Updates database to match agent's actual state (agent is source of truth)
    - **Manager → Agent**: Sends reload command to agent to pull latest from git

- **Visual Sync Indicators**: Green banner shows sync status
  - "✓ Agent and Manager are in sync (N workflows)" when synchronized
  - Updates dynamically after delete operations

- **Improved Delete Operation**: Delete workflow now works even when workflow not in database
  - Always updates database and git repository
  - Always sends reload command to agent
  - Returns helpful messages indicating what was done
  - No more "Workflow not found" errors

### Architecture Changes

- **Agent state as source of truth**: Agent's runtime workflow state is the authoritative source
- **Database as tracking layer**: Database tracks which agents have which workflows, not as source of truth
- **Automatic conflict resolution**: System detects mismatches and prompts user to resolve
- **Graceful operation**: Operations continue even when database and agent are out of sync

### Changes

**Manager**:
- Updated `public/js/agent-details.js`:
  - Fixed line 334: Removed `JSON.parse()` on already-parsed config object
  - Added `compareWorkflows()` function (lines 1346-1362) for sync detection
  - Added `showSyncWarning()` function (lines 1364-1396) for conflict resolution UI
  - Added `syncAgentToManager()` function (lines 1398-1418) to update database
  - Added `syncManagerToAgent()` function (lines 1420-1441) to send reload command
  - Modified `loadDeployedWorkflows()` to detect and handle sync mismatches
- Updated `src/routes/api.js`:
  - Modified DELETE `/agents/:agentId/workflows/:workflowId` (lines 333-375)
  - Now handles workflows that exist on agent but not in database
  - Always updates git and sends reload command
  - Returns descriptive success messages
- Updated `package.json` - Version bumped to 0.14.10

### Impact

- **Fixed critical workflow deletion bug**: Users can now delete workflows that are on the agent
- **Prevents data loss**: Sync detection prevents accidental workflow removal
- **Better visibility**: Users always know if agent and manager are in sync
- **Improved UX**: Clear sync indicators and helpful conflict resolution
- **Database integrity**: Database automatically stays in sync with agent state

### Technical Details

**Sync Detection Flow:**
1. User navigates to Workflows tab on agent details page
2. System fetches workflows from both agent state and database
3. Compares the two lists by workflow ID
4. If mismatch detected, shows modal with sync options
5. User chooses sync direction
6. System performs sync and reloads page to show result

**Delete Operation Flow:**
1. User clicks delete on a workflow
2. System removes from database (if present)
3. System updates git repository
4. System sends git-pull command to agent
5. Returns success message indicating what was done

**Sync Modal Options:**
- **Agent → Manager**: Calls PUT `/api/agents/:id/config` with workflow list from agent
- **Manager → Agent**: Calls POST `/api/agents/:id/command` with `reload-config` command

### Testing Performed

- ✅ Sync detection when database has workflows, agent doesn't
- ✅ "Agent → Manager" sync (clearing database to match empty agent)
- ✅ Green sync indicator when in sync
- ✅ Delete workflow operation when synced
- ✅ Automatic deployment and sync when workflows deployed
- ✅ Database and agent state verification

### Deployment

**Manager Only** (No agent changes):

**Docker**:
```bash
docker compose down
docker compose pull
docker compose up -d
```

**Native**:
```bash
cd manager
git pull
npm install --production
systemctl restart controlcenter-manager
```

### Upgrading from v0.14.9

No breaking changes. Simply update the manager and restart:
- Workflow synchronization will work automatically
- Existing workflows remain intact
- UI will show sync status when viewing agent workflows
- Delete operations will work correctly even when database is out of sync

**What was broken in v0.14.9:**
- Could not delete workflows that existed on agent but not in database
- Error: "Delete workflow failed: Workflow not found on this agent"
- No visibility into sync status between agent and manager
- JSON parse errors when loading workflows in some cases

**After upgrading to v0.14.10:**
- Workflow delete works in all cases
- Sync detection automatically identifies mismatches
- Clear visual indicators show sync status
- User controls sync resolution when conflicts occur
- No more JSON parse errors

---

## v0.14.9

### Critical Fixes

- **Fixed Agent About tab not loading**: JavaScript function collision prevented About tab from displaying agent information
  - Root cause: `agent-filewatcher.js` declared `function switchTab()` which overrode the correct version from `agent-details.js`
  - This caused About tab to show "Loading agent information..." indefinitely
  - The `switchTab` function in `agent-filewatcher.js` was missing the logic to call `loadAgentInfo()` for the About tab
  - Solution: Renamed function to `switchFileWatcherTab()` to prevent collision
  - Agent About tab now correctly displays agent version, platform, hostname, SSH port, and workflow count

### Changes

**Manager**:
- Updated `public/js/agent-filewatcher.js` - Renamed `switchTab` to `switchFileWatcherTab` (function declaration and call site)
- Updated `package.json` - Version bumped to 0.14.9

### Impact

- About tab now loads automatically when clicked
- Users can see agent version and system information
- No more JavaScript function name collisions on agent details page
- This was a critical bug introduced in v0.14.8 that broke the About tab feature

### Technical Details

**The Bug:**
Three JavaScript files loaded on the agent details page:
- `agent-details.js` (line 790) - Contains `switchTab()` with About tab loading logic
- `agent-filewatcher.js` (line 791) - Declared its own `switchTab()` without About tab logic
- `agent-configure.js` (line 792) - No `switchTab()` function

Since files load in order, `agent-filewatcher.js` loaded after `agent-details.js` and overwrote the correct `switchTab` function with a simpler version that didn't handle the About tab.

**The Fix:**
- Renamed `switchTab` to `switchFileWatcherTab` in `agent-filewatcher.js`
- This function is only used for the file watcher rule editor modal tabs, not main page tabs
- Now both functions coexist without conflicts
- `agent-details.js` switchTab() handles main page tabs including About tab

### Deployment

**Manager Only** (No agent changes):

**Docker**:
```bash
docker compose down
docker compose pull
docker compose up -d
```

**Native**:
```bash
cd manager
git pull
npm install --production
systemctl restart controlcenter-manager
```

### Upgrading from v0.14.8

This is a critical hotfix for the broken About tab in v0.14.8. All v0.14.8 deployments should upgrade immediately.

**What was broken in v0.14.8:**
- Agent About tab showed "Loading agent information..." indefinitely
- No API requests were made when clicking the About tab
- JavaScript function collision prevented proper tab switching logic

**After upgrading to v0.14.9:**
- About tab loads agent information automatically
- Displays agent version, platform, hostname, SSH port, and workflows
- All agent detail page features work as expected

---

## v0.14.8

### New Features

- **Footer version display**: Manager now displays version number in the footer of every page
  - Positioned in the bottom-left corner with small, subtle styling
  - Version is globally available via `app.locals.version` to all EJS templates
  - CSS positioned with absolute positioning for consistent placement
  - Improves visibility of current version across the entire UI

### Changes

**Manager**:
- Updated `src/server.js` line 114 - Added `app.locals.version = packageJson.version;` to make version globally available
- Updated `views/partials/footer.ejs` - Added version span element displaying `v<%= version %>`
- Updated `public/css/style.css` - Added `.footer-version` styling with absolute positioning, small font, and reduced opacity
- Updated `package.json` - Version bumped to 0.14.8

### Impact

- Users can quickly see the manager version on any page without navigating to Settings
- Helpful for support and troubleshooting
- Consistent with standard web application patterns
- No database schema changes

### Technical Details

The footer version display uses:
- **Global template variable**: `app.locals.version` makes version available to all EJS views without passing it individually
- **Absolute positioning**: Places version in bottom-left corner of footer
- **Subtle styling**: Small font size (0.75rem) with 60% opacity for non-intrusive display
- **Responsive design**: Works with existing footer flexbox layout

### Deployment

**Manager Only** (No agent changes):

**Docker**:
```bash
docker compose down
docker compose pull
docker compose up -d
```

**Native**:
```bash
cd manager
git pull
npm install --production
systemctl restart controlcenter-manager
```

### Upgrading from v0.14.7

No breaking changes. Simply update the manager and restart. After reloading the page, you'll see the version number in the bottom-left corner of every page.

---

## v0.14.7

### Critical Fixes

- **Fixed JavaScript variable name collision in agent details page**: Agent About tab now loads correctly
  - Root cause: Both `agent-configure.js` and `agent-filewatcher.js` declared `const agent` in global scope
  - This caused `Identifier 'agent' has already been declared` syntax error that blocked ALL JavaScript execution
  - Result: About tab showed "Loading agent information..." indefinitely, and many other features broke
  - Solution: Renamed variables to be more specific (`configPageAgent` and `fileWatcherAgent`)
  - All three scripts (`agent-details.js`, `agent-configure.js`, `agent-filewatcher.js`) now work together without conflicts

### Improvements

- **Agent version now logged during startup**: Agent logs include version information for easier troubleshooting
  - Startup message now includes: `version=0.14.7`
  - Visible in both standalone and connected modes
  - Makes it easy to verify which version is running

### Changes

**Manager (JavaScript)**:
- Updated `public/js/agent-configure.js` - Renamed `agent` to `configPageAgent` (7 references)
- Updated `public/js/agent-filewatcher.js` - Renamed `agent` to `fileWatcherAgent` (8 references)

**Agent**:
- Updated `nodes/main.go` - Added version to startup log messages (lines 508, 516)
- Version set to 0.14.7

**Manager**:
- Updated `package.json` - Version bumped to 0.14.7

### Impact

- **About tab works**: Users can now see agent version, platform, hostname, and system info
- **All tabs work**: Configure and File Watcher tabs continue to function correctly
- **Better logging**: Agent version visible in logs for support and troubleshooting
- This was a critical bug introduced in v0.14.6 that broke the user interface

### Technical Details

**The Bug:**
When multiple JavaScript files are loaded on the same page and each declares a variable with the same name in global scope using `const`, JavaScript throws a syntax error. This error blocks execution of ALL JavaScript on the page, not just the conflicting files.

**Files affected:**
- `agent-details.ejs` loads three scripts: `agent-details.js`, `agent-filewatcher.js`, `agent-configure.js`
- `agent-filewatcher.js` declared `const agent` (line 3)
- `agent-configure.js` declared `const agent` (line 3)
- Error: `Uncaught SyntaxError: Identifier 'agent' has already been declared`

**The Fix:**
Renamed the conflicting variables to be more specific to their purpose:
- `agent-configure.js`: `agent` → `configPageAgent`
- `agent-filewatcher.js`: `agent` → `fileWatcherAgent`

This allows all three scripts to coexist without conflicts.

### Deployment

**Manager Only** (Agent can be updated optionally for version logging):

**Docker**:
```bash
docker compose down
docker compose pull
docker compose up -d
```

**Native**:
```bash
# Manager
cd manager
git pull
npm install --production
systemctl restart controlcenter-manager

# Agent (optional - for version logging improvement)
# Download new agent binary from release assets
# Stop old agent, replace binary, restart
```

### Upgrading from v0.14.6

This is a critical hotfix that fixes broken UI features introduced in v0.14.6. All v0.14.6 deployments should upgrade immediately.

**What was broken in v0.14.6:**
- Agent About tab showed "Loading agent information..." indefinitely
- JavaScript errors in browser console blocked page functionality
- Configure and File Watcher tabs may have had issues due to JavaScript execution being blocked

**After upgrading to v0.14.7:**
- About tab loads and displays agent information correctly
- No JavaScript errors in console
- All agent detail page features work as expected
- Agent logs show version during startup

---

## v0.14.6

### New Features

- **Version Display in UI**: Added version information to both Manager and Agent interfaces
  - Manager About section in Settings page shows Manager version, license, and GitHub link
  - Agent About tab in agent details page displays agent version, platform, hostname, and system info
  - New API endpoint: GET `/agents/:id/info` returns agent version and platform information
  - Version information accessible from web UI for easy reference and support

### Changes

**Manager (UI)**:
- Updated `views/settings.ejs` - Added About section with Manager version display
- Updated `views/agent-details.ejs` - Added About tab for agent information
- Updated `public/js/agent-details.js` - Added loadAgentInfo() function and tab integration
- Updated `package.json` - Version bumped to 0.14.6

**Manager (Backend)**:
- Updated `src/server.js` - Pass packageJson.version to settings view
- Updated `src/routes/api.js` - Added `/agents/:id/info` proxy endpoint

**Agent**:
- Updated `nodes/main.go` - Added AgentVersion constant and updated /info endpoint
- Version set to 0.14.6

### Impact

- Users can now easily see version numbers for both Manager and Agent in the UI
- Simplifies support and troubleshooting by making version information readily available
- Platform and system information helps identify agent capabilities and compatibility
- No database schema changes

### Deployment

**Manager and Agent** (Both require updates to see version info):

**Docker**:
```bash
docker compose down
docker compose pull
docker compose up -d
```

**Native**:
```bash
# Manager
cd manager
git pull
npm install --production
systemctl restart controlcenter-manager

# Agent (replace with actual binary path)
# Download new agent binary from release assets
# Stop old agent, replace binary, restart
```

### Upgrading from v0.14.5

No breaking changes. Simply update manager and agents to v0.14.6:
- Manager will display version in Settings → About section
- Agents will display version in agent details → About tab
- All agents should be upgraded to display correct version information

---

## v0.14.5

### Critical Fixes

- **Fixed user management "validatePassword is not a function" error**: User creation now works correctly
  - Root cause: `validatePassword` function export was being overwritten by the router export
  - The `module.exports = ...` on line 45 was overwriting the `module.exports.validatePassword = ...` from line 26
  - Fixed by moving the validatePassword export to AFTER the router function export
  - This allows the function to be properly imported in api.js

### Changes

- **Manager**: Fixed `src/routes/auth.js` - moved validatePassword export to end of file (line 194)

### Impact

- User management system now fully functional
- Users can create, delete, and reset passwords for admin accounts
- No workaround was available in v0.14.4

### Deployment

**Manager Only** (No agent changes required):

**Docker**:
```bash
docker compose down
docker compose pull
docker compose up -d
```

**Native**:
```bash
cd manager
git pull
systemctl restart controlcenter-manager
```

### Upgrading from v0.14.4

This is a critical hotfix that fixes broken user management. All v0.14.4 deployments should upgrade immediately.

**Note**: This issue only affected v0.14.4. If you're on v0.14.3 or earlier, you should upgrade directly to v0.14.5 to get all the features from v0.14.4 plus this fix.

---

## v0.14.4

### New Features

- **Modern Modal Dialog System**: Replaced all JavaScript alert(), confirm(), and prompt() calls with a beautiful, consistent modal system
  - New Modal.js utility with methods: info(), success(), error(), warning(), confirm(), custom()
  - Promise-based API for async/await compatibility
  - Keyboard support (Escape to cancel, Enter to confirm)
  - Click outside modal to close
  - XSS protection with automatic HTML escaping
  - Smooth animations and modern styling

- **User Management System**: Complete user administration interface in Settings page
  - Add new users with username, password, and role
  - Reset user passwords with validation
  - Delete users (with protection against deleting last user)
  - User list table showing username, role, creation date, and last login
  - Full API endpoints: GET/POST/PUT/DELETE `/api/users`
  - Database methods for user CRUD operations

- **Workflows Tab Redesign**: Agent details page now shows deployed workflows instead of just execution history
  - Table view with workflow name, ID, trigger type, and status
  - Trigger type icons: 📁 file, 📅 schedule, 🔗 webhook, 👤 manual
  - Enabled/Disabled status badges
  - Delete workflow button per workflow
  - Auto-loads when switching to workflows tab
  - New API endpoint: GET `/agents/:id/workflows/state` fetches workflows from agent

- **Auto-Reload Configuration**: Agent configure page now prompts to reload agent configuration after saving
  - Modal confirmation dialog after successful save
  - One-click reload configuration command
  - Automatically redirects to agent details after reload

### UX Improvements

- **Agent Configure Page**: Replaced all alert() with Modal dialogs, better async error handling
- **Alerts Page**: Modal dialogs, improved event listeners, better filtering
- **Logs Page**: Event listeners for filters and refresh, improved event delegation
- **Settings Page**:
  - Modal dialogs for all operations
  - Event listeners instead of inline onclick handlers
  - Copy to clipboard with success feedback
  - Double confirmation for destructive operations (reset system)
  - User management section with table

- **Global Modal Integration**: Modal.css and modal.js loaded on all pages via head.ejs for consistent experience

### Fixes

- **Fixed multiple tabs staying highlighted simultaneously**: Agent details page now correctly shows only the selected tab as active
  - Root cause: Duplicate `switchTab()` function in `agent-filewatcher.js` was overriding the corrected version from `agent-details.js`
  - The file loading order meant agent-filewatcher.js (loaded last) was replacing the fixed function with one using wrong CSS selector (`.form-tab` instead of `.tab-btn`)
  - Fixed line 599 in agent-filewatcher.js to use correct `.tab-btn` selector
  - Added cache-busting timestamps to script tags to force browser reload of updated JavaScript files

### Changes

**Manager (JavaScript)**:
- Added `public/js/modal.js` - New modal dialog utility
- Added `public/css/modal.css` - Modal styling
- Updated `public/js/agent-configure.js` - Modal integration, auto-reload functionality
- Updated `public/js/agent-details.js` - Workflows tab redesign, modal integration
- Updated `public/js/agent-filewatcher.js` - Fixed switchTab selector bug
- Updated `public/js/alerts.js` - Modal integration, event listeners
- Updated `public/js/logs.js` - Event listeners
- Updated `public/js/settings.js` - User management UI, modal integration, event listeners

**Manager (Backend)**:
- Updated `src/routes/api.js` - User management endpoints (GET/POST/PUT/DELETE /api/users), workflows/state endpoint
- Updated `src/db/database.js` - User management methods (getAllUsers, getUserById, deleteUser, updateUserPassword, countUsers)

**Manager (Views)**:
- Updated `views/partials/head.ejs` - Added modal.css and modal.js globally
- Updated `views/agent-details.ejs` - Workflows tab UI redesign, cache-busting
- Updated `views/settings.ejs` - User management UI section
- Updated `views/alerts.ejs` - Event listeners
- Updated `views/logs.ejs` - Event listeners

### Impact

- **Better UX**: Modern, consistent modal dialogs across entire application
- **User Administration**: Easy user management without database access
- **Workflow Management**: Clear visibility of deployed workflows per agent with delete capability
- **Configuration Management**: Streamlined config save + reload workflow
- **Bug Fixes**: Tab navigation works correctly
- **Code Quality**: Event listeners instead of inline handlers, better error handling

### Technical Details

**Modal System Architecture:**
- Promise-based API allows async/await usage throughout codebase
- XSS protection via HTML escaping on all user input
- Keyboard navigation and accessibility support
- Click-outside-to-close UX pattern
- Customizable buttons and HTML content

**User Management Security:**
- Password validation (8+ chars, uppercase, lowercase, number)
- Bcrypt password hashing (10 salt rounds)
- Protection against deleting last user
- Duplicate username prevention

**Tab Switching Bug:**
JavaScript files loaded in order: agent-details.js, then agent-filewatcher.js, then agent-configure.js. When two scripts define a function with the same name, the later-loaded script's function replaces the earlier one. The agent-filewatcher.js version used `.form-tab` selector which doesn't match the actual tab buttons (which use `.tab-btn` class).

### Deployment

**Manager Only** (No agent changes required):

**Docker**:
```bash
docker compose down
docker compose pull
docker compose up -d
```

**Native**:
```bash
cd manager
git pull
npm install --production
systemctl restart controlcenter-manager
```

### Upgrading from v0.14.3

No breaking changes. Simply update the manager and restart. Key improvements:
- Users will see modern modal dialogs instead of browser alerts
- Settings page gains user management capabilities
- Agent details Workflows tab shows deployed workflows instead of execution history
- Configuration workflow is streamlined with auto-reload prompt
- Tab switching bug is resolved

**Note**: Users may need to hard refresh browsers (Ctrl+F5) to clear cached JavaScript files.

---

## v0.14.3

### Critical Fixes

- **Fixed COOKIE_SECURE environment variable being ignored in production mode**: Login now works correctly with HTTP when `COOKIE_SECURE=false` is explicitly set
  - Root cause: Boolean logic bug using `||` operator caused `NODE_ENV=production` to always override `COOKIE_SECURE=false`
  - Symptom: Users could create accounts and server showed `login_success`, but browser rejected cookies, causing redirect loop back to login
  - Solution: Changed to ternary operator that allows explicit `COOKIE_SECURE=false` to override production default
  - Fixes authentication loop in HTTP-only deployments even when COOKIE_SECURE is explicitly disabled

### Changes

- **Manager**: Fixed config.js line 24 to properly handle `COOKIE_SECURE=false` environment variable
  - **Before**: `COOKIE_SECURE: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production'`
  - **After**: `COOKIE_SECURE: process.env.COOKIE_SECURE === 'false' ? false : (process.env.NODE_ENV === 'production')`

### Technical Details

**The Bug:**
The original logic used an `||` (OR) operator which evaluated as:
1. Check if `COOKIE_SECURE === 'true'` (false when set to "false")
2. OR check if `NODE_ENV === 'production'` (true)
3. Result: Always returned `true` in production, ignoring the explicit `COOKIE_SECURE=false` setting

**The Fix:**
New logic checks for explicit false first:
1. If `COOKIE_SECURE === 'false'`, return `false` (explicit override)
2. Otherwise, default to `true` when `NODE_ENV === 'production'`
3. Allows HTTP deployments with `COOKIE_SECURE=false` to work correctly

### Impact

- HTTP-only deployments with `COOKIE_SECURE=false` now work correctly
- Cookies are properly set without `Secure` flag when explicitly disabled
- Login authentication persists across requests
- Maintains secure defaults: still requires HTTPS in production unless explicitly overridden

### Deployment

**Docker (Recommended)**:
```bash
cd /opt/controlcenter/manager  # Or your DATA_DIR
docker compose down
docker compose pull
docker compose up -d
```

**Verification**:
1. Access manager via HTTP: `http://your-server-ip:3000`
2. Create/login with user credentials
3. Should successfully authenticate and stay logged in (no redirect loop)
4. Check browser console - should see successful requests, no 429 rate limit errors

### Related Issues Fixed

- Login succeeding on server but browser rejecting cookies
- Infinite redirect loop from main page → /auth/login → main page → /auth/login
- Rate limiter triggering (429 Too Many Requests) after multiple failed login attempts
- Authentication working in logs (`login_success`) but not persisting in browser

### Upgrading from v0.14.2

If you're experiencing login failures even with `COOKIE_SECURE=false` set:
1. Update Manager to v0.14.3
2. Restart container/service
3. Try logging in again - authentication should persist correctly

**Important**: Both v0.14.2 and v0.14.3 require `COOKIE_SECURE=false` environment variable for HTTP deployments. The deploy script (v0.14.2+) automatically sets this.

---

## v0.14.2

### Critical Fixes

- **Fixed CSS/styling not loading in Docker deployments**: Browsers were auto-upgrading HTTP resources to HTTPS due to Content Security Policy, causing `ERR_SSL_PROTOCOL_ERROR`
  - Root cause: Helmet's `upgrade-insecure-requests` CSP directive was forcing HTTPS upgrades
  - Solution: Disabled `upgrade-insecure-requests` to allow HTTP for internal deployments
  - Fixes bootstrap page and all other pages showing broken formatting when accessed via HTTP

### Changes

- **Manager**: Modified CSP configuration in `src/server.js` to set `upgrade-insecure-requests: null`
- **Documentation**: Added HTTP vs HTTPS deployment section to CLAUDE.md

### Impact

- HTTP deployments now work correctly without SSL/reverse proxy
- Bootstrap page displays with proper CSS styling
- All web UI pages load correctly when accessed via `http://server-ip:3000`
- HTTPS deployments still fully supported via nginx reverse proxy

### Deployment Options

**HTTP (Internal/Testing)**:
- Works out of the box with v0.14.2
- Suitable for internal networks behind firewall
- No additional configuration needed

**HTTPS (Production)**:
- Use nginx or similar reverse proxy with SSL certificates
- See CLAUDE.md for complete nginx configuration example
- Manager listens on HTTP internally, nginx handles SSL termination

### Upgrading from v0.14.1 or earlier

If you're experiencing CSS loading errors (`ERR_SSL_PROTOCOL_ERROR`) when accessing via HTTP:
1. Update Manager to v0.14.2
2. Restart container/service
3. CSS and styling will load correctly

**Docker**:
```bash
docker pull ghcr.io/lsadehaan/controlcenter-manager:latest
docker compose down && docker compose up -d
```

**Native**:
```bash
cd manager
git pull
npm install --production
sudo systemctl restart controlcenter-manager
```

### Related Issues Fixed

- Bootstrap page showing no styling when accessed via IP address
- Browser console errors: `GET https://IP:3000/css/style.css net::ERR_SSL_PROTOCOL_ERROR`
- CSS files not loading on any web UI page in HTTP-only deployments

---

## v0.14.1

### Critical Fixes

- **Fixed Git SSH authentication failure in Go exec.Command**: Git operations now work reliably when executed from Go
  - Root cause: Go's `exec.Command` doesn't read git config's `core.sshCommand` setting properly
  - Solution: Created `setupGitCommand()` helper that sets `GIT_SSH_COMMAND` as environment variable on each git command
  - Fixes "Permission denied ()" errors during git fetch/pull/push operations

### Changes

- **Agent**: Added `setupGitCommand()` helper method in `gitsync.go` that automatically configures SSH for all network git operations
- **Agent**: Updated `Pull()` to use `setupGitCommand()` for fetch operations
- **Agent**: Updated `Push()` to use `setupGitCommand()` for push operations
- **Agent**: Updated `Initialize()` to use `setupGitCommand()` for clone operations
- **Agent**: Updated `HasCommitsAhead()` to use `setupGitCommand()` for fetch operations
- **Agent**: Updated `HasDiverged()` to use `setupGitCommand()` for fetch operations
- **Agent**: Removed unused `context` import from gitsync.go

### Technical Details

**Before**: Git commands relied on `git config core.sshCommand` which Go's exec.Command couldn't read properly in certain execution contexts.

**After**: Every network git operation explicitly sets `GIT_SSH_COMMAND` environment variable:
```go
cmd := exec.Command("git", args...)
if g.sshKeyPath != "" {
    sshCmd := fmt.Sprintf("ssh -i \"%s\" -o StrictHostKeyChecking=no -o BatchMode=yes", g.sshKeyPath)
    cmd.Env = append(os.Environ(), fmt.Sprintf("GIT_SSH_COMMAND=%s", sshCmd))
}
```

### Cross-Platform Compatibility

- ✅ **Windows**: Tested and working with Git Bash SSH
- ✅ **Linux**: Compatible with system OpenSSH
- ✅ **Auto-configuration**: No manual setup required on first run

### Impact

- Agents can now reliably sync configuration with manager on all platforms
- Git pull operations succeed consistently after reboot or manager restart
- Git push operations (from `-push-config` flag) work without authentication errors
- Eliminates "Agent not connected" errors caused by failed git sync during startup

### Deployment

1. **Update Agent** to v0.14.1 (critical for agents experiencing git authentication issues)
2. **No manager changes** required
3. **No configuration changes** needed - existing agents will automatically use the new method

### Upgrading from v0.14.0

If agents are showing "Permission denied" errors during git operations:
1. Update agent binary to v0.14.1
2. Restart agent
3. Git operations will work immediately

### Related Issues Fixed

- Git fetch failing with "Permission denied ()" on agent startup
- Configuration updates not syncing from manager to agent
- Agent showing as offline due to git sync failures during initialization

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
