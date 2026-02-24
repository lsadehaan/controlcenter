# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Distributed automation platform with hub-and-spoke architecture. Two components:

- **Manager** (`manager/`): Node.js/Express web UI and API server for configuration and monitoring
- **Nodes** (`nodes/`): Go agents that execute workflows on processor hosts

## Development Commands

### Manager (Node.js)
```bash
cd manager
npm install              # Install dependencies
npm start                # Start server on http://localhost:3000
npm run dev              # Start with passwordless auth (DEV_PASSWORDLESS=true)
npm run dev:restart      # Kill dev ports and restart in dev mode
npm run kill:dev         # Kill ports 3000, 8088, 2223
npm run lint             # ESLint check (npx eslint src/**/*.js)
npm run lint:fix         # ESLint auto-fix
```

Production env vars: `JWT_SECRET` (required), `NODE_ENV=production`, `COOKIE_SECURE=true`

### Nodes (Go 1.24+)
```bash
cd nodes
go build -o agent.exe .         # Build (Windows)
go build -o agent .             # Build (Linux/Mac)
go run . -token YOUR_TOKEN      # Run with registration token
go run . -log-level debug       # Debug logging
go run . -standalone            # Run without manager connection
go test ./...                   # Run all tests
go test ./internal/config/...   # Run config tests (only test file currently)
```

Agent endpoints: health check `:8088/healthz`, info `:8088/info`, SSH server `:2222`

### Quick Test Setup
```bash
# Terminal 1: Start manager
cd manager && npm run dev

# Terminal 2: Generate token at http://localhost:3000/agents, then:
cd nodes && go run . -token YOUR_TOKEN
```

## Architecture

### Communication Flow
1. **Registration**: Agent generates SSH keys → registers with token via WebSocket → receives agent ID → public key stored in manager DB
2. **Heartbeat**: WebSocket maintains 30-second heartbeat intervals
3. **Config Sync (Pull)**: Manager commits to git → sends reload command → agent pulls via Git-over-SSH (port 2223)
4. **Config Sync (Push)**: Agent commits locally → pushes to manager via Git-over-SSH
5. **Workflow Execution**: Triggers fire → executor runs steps → alerts sent to manager via WebSocket

### Manager Architecture
- **Server** (`src/server.js`): Express app entry point, orchestrates all services
- **WebSocket** (`src/websocket/server.js`): Real-time agent communication
- **Git Server** (`src/git/server.js`): Config repo management with simple-git
- **Git SSH Server** (`src/git/ssh-server.js`): SSH server for Git-over-SSH (port 2223, ssh2 library)
- **Database** (`src/db/database.js`): SQLite via sqlite3
- **API Routes** (`src/routes/api.js`): RESTful endpoints
- **Auth** (`src/auth/`): JWT + bcrypt authentication, rate limiting
- **Services** (`src/services/`): Business logic for workflows and agents
- **Views** (`views/`): EJS templates with Drawflow.js visual workflow editor

### Nodes Architecture
- **Entry** (`main.go`): Agent lifecycle management
- **Identity** (`internal/identity/`): SSH key generation (RSA 2048-bit)
- **WebSocket** (`internal/websocket/`): Manager connection and heartbeat
- **Workflow** (`internal/workflow/`): Step execution engine with template variable substitution
- **Git Sync** (`internal/gitsync/`): Config repo clone/push/pull via SSH
- **File Watcher** (`internal/filewatcher/`): File system trigger monitoring
- **File Browser** (`internal/filebrowser/`): HTTP API for filesystem access (disabled by default)
- **SSH Server** (`internal/sshserver/`): Embedded SSH/SFTP server (port 2222)
- **Config** (`internal/config/`): JSON-based config management
- **Alert** (`internal/alert/`): Alert forwarding to manager

### Key Data Locations
- Manager DB: `manager/data/control-center.db`
- Config repo: `manager/data/config-repo/` (agents/*.json, workflows/*.json)
- Agent config: `~/.controlcenter-agent/` (SSH keys, state.json, agent.log, config-repo/)

## Git-over-SSH Details

Critical implementation details for the SSH transport (port 2223):

- **Stateful protocol**: Uses git commands without `--stateless-rpc`
- **Bidirectional piping**: stdin SSH→git, stdout/stderr git→SSH with `{ end: false }` to prevent premature channel closure
- **Lifecycle**: Send exit status before closing SSH channel via `process.nextTick()`
- **Agent SSH config**: Uses `BatchMode=yes` to prevent interactive prompts on Windows
- **Repo config**: Manager sets `receive.denyCurrentBranch=updateInstead` for non-bare repo
- **First-run behavior**: Clone fails gracefully before public key is registered; retries after registration

## API Endpoints

```
# Agents
GET/DELETE /api/agents/:id          POST /api/agents/:id/command
PUT /api/agents/:id/config

# Workflows
GET/POST /api/workflows             PUT/DELETE /api/workflows/:id
POST /api/workflows/:id/deploy      GET /api/workflows/:id/status

# Monitoring
GET /api/alerts                     PUT /api/alerts/:id/acknowledge
GET /api/logs                       GET /api/health

# Registration
GET/POST /api/tokens

# File Browser (proxied manager→agent)
GET /api/agents/:id/files/browse?path=    GET /api/agents/:id/files/download?path=
POST /api/agents/:id/files/upload         POST /api/agents/:id/files/mkdir?path=
DELETE /api/agents/:id/files/delete?path=
```

## Workflow System

### Implemented Step Types
- `copy-file`, `move-file`, `delete-file`, `run-command`, `alert`
- All support template variable substitution: `{{.fileName}}`, etc.

### Stub-only (UI exists, backend returns "not implemented")
- `rename-file`, `archive-file`, `extract-archive`, `run-script`, `ssh-command`
- `send-file`, `http-request`, `database-query`, `send-email`, `slack-message`
- `condition`, `loop`, `javascript`

### Trigger Types
- `file` / `filewatcher`: Pattern-based file watching (working)
- `schedule`: Basic interval (working, no cron syntax)
- `webhook`: UI only, not implemented

### Template Limitation
Template substitution only processes top-level string values. Nested objects/arrays in step config are not recursively processed.

## Creating Releases

**NEVER manually create releases.** CI/CD handles everything:

1. Update `RELEASE_NOTES.md` with version notes
2. Commit and push
3. `git tag v0.X.Y && git push origin v0.X.Y`
4. CI extracts notes, creates release, cross-compiles all binaries, builds Docker images

## Testing Requirements

**ALWAYS test new features through UI and API before tagging a release.** Start with `npm run dev`, test all new features end-to-end, check browser console for errors.

### Meta-Instruction for Learning from Mistakes

**Whenever I do something silly that is pointed out to me by the human, add a note to my CLAUDE.md file to remember not to do it again.**

### Lessons Learned

#### Release Testing (v0.14.4 - v0.14.5)
- Released v0.14.4 with broken user management (`validatePassword is not a function`)
- Root cause: did not test through UI before release
- Lesson: ALWAYS test new features functionally before creating a release. No exceptions.

## Known Limitations

1. Template substitution doesn't recurse into nested config objects
2. Workflow executor has significant code duplication (needs interface-based refactor)
3. Many UI-defined step types have no backend implementation
4. File watcher errors can cause workflows to fail silently
5. No ESLint config exists; lint scripts use npx eslint directly
6. Only one test file in codebase: `nodes/internal/config/config_test.go`
