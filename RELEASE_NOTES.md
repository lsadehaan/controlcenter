# Release Notes

This file contains release notes for Control Center. When a new tag is pushed, the CI/CD pipeline will automatically create a GitHub release using the notes for that version.

## Format

Each release should have a section with the version number as a heading level 2 (`##`). The content under that heading will be used as the release notes.

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
