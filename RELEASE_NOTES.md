# Release Notes

This file contains release notes for Control Center. When a new tag is pushed, the CI/CD pipeline will automatically create a GitHub release using the notes for that version.

## Format

Each release should have a section with the version number as a heading level 2 (`##`). The content under that heading will be used as the release notes.

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
