# Control Center – In-Depth Review and Progress

Updated: 2025-10-11

## Scope
- Full-code review across `manager/` (Node.js), `nodes/` (Go agent), deployment assets, views/assets, and configuration repo.
- Identify architecture, what's implemented and where, current gaps, and prioritized improvements.

## Repository Inventory (at a glance)
- `manager/`: Express app, WebSocket server, Git services (SSH + HTTP), SQLite DB, REST API, EJS views, public assets.
- `nodes/`: Go agent with WebSocket client, Git sync, file watcher, SSH server, workflow engine, HTTP API.
- `deploy/`: Shell scripts and Kubernetes manifest.
- `manager/data/config-repo`: Git-backed configuration repository (agents/, workflows/).
- Docs: `README.md`, `SYSTEM_OVERVIEW.md`, deployment/testing/setup notes, feature blueprints.

---

## High-Level Architecture
- Hub-and-spoke model: Manager (Node.js) coordinates and stores state; Agents (Go) execute workflows and report.
- Communication:
  - HTTP/WebSocket on manager port 3000.
  - Git over SSH on port 2223 for agent config repo (`ssh://git@manager:2223/config-repo`).
  - Agent health/API on port 8088 (local to each agent).
- Persistence: SQLite on manager; Git repo for configuration source of truth.
- UI: EJS views served by manager; Drawflow-based workflow editor in browser.

---

[More detailed per-file/module findings will be appended below as the review continues.]

## Manager (Node.js)

- Entrypoint: `manager/src/server.js`
  - Initializes: `Database`, `WebSocketServer` (`/ws`), `GitServer` (working repo under `manager/data/config-repo`), `GitHttpServer` (read-only Smart HTTP under `/git`), `GitSSHServer` (push/pull over SSH on port 2223).
  - Middleware: JSON, URL-encoded, static `public/`; EJS views in `views/`.
  - Routes:
    - Web UI: `/`, `/agents`, `/agents/:id`, `/agents/:id/filewatcher`, `/agents/:id/configure`, `/workflows`, `/workflow-editor`, `/workflow-editor-simple`, `/alerts`, `/logs`, `/settings`.
    - API: mounted `/api` from `manager/src/routes/api.js`.

- WebSocket server: `manager/src/websocket/server.js`
  - Message types: `registration`, `reconnection`, `heartbeat`, `status`, `alert`, `log`.
  - Registration flow validates token, stores agent record, ensures initial Git config, tracks `connectionIp` and optional `apiAddress` (from token metadata).
  - Heartbeats keep status updated; stale detection marks offline.
  - Alerts are persisted via `db.createAlert` (notifications TODO).
  - Logs accepted via `handleLog` to DB, but agent does not currently send `log` messages (gap).

- Git services:
  - `manager/src/git/server.js` (working repo, not bare)
    - Initializes repo, sets `receive.denyCurrentBranch=updateInstead`, auto-commits pending changes to keep working dir synchronised.
    - Saves/reads `agents/<agentId>.json` and `workflows/<workflowId>.json`.
  - `manager/src/git/ssh-server.js` (port 2223)
    - Auth via agent SSH public keys stored in DB; allows `git-upload-pack`/`git-receive-pack` against working tree (`.git` if present).
    - After push, syncs DB with updated agent config (source of truth is Git repo).
  - `manager/src/git/http-server.js`
    - Smart HTTP read-only endpoints under `/git`; denies pushes.

- Database: `manager/src/db/database.js` (SQLite)
  - Tables: `agents`, `registration_tokens`, `workflows`, `alerts`, `logs`, `users`.
  - No migrations beyond CREATE IF NOT EXISTS; `users` table is unused (no auth paths implemented).

- API: `manager/src/routes/api.js`
  - Agents: list/get, update config, delete; file watcher rules; set `api-address`; send `command` to agent over WS; proxy agent APIs (`/logs`, `/metrics`, and file browser endpoints) using `apiAddress` or connection IP.
  - Tokens: generate registration tokens with optional `apiAddress` metadata.
  - Workflows: CRUD, deploy to selected agents by saving workflow + per-agent config to Git then issuing `git-pull` command over WS.
  - Alerts/Logs: list and acknowledge alerts; list logs from DB.
  - NOTE: Duplicate route definitions for `PUT /agents/:id/config` exist; the earlier one updates DB + sends WS `config` notification, while the later one merges config, saves to Git, and triggers agent `git-pull`. The first handler will short-circuit responses, making the Git-backed path unreachable. This is a correctness bug; remove/merge to use Git-as-source-of-truth path only.

- Views and assets
  - Dashboard: `views/index.ejs` (fetches API stats). Agents/grid + token generation: `views/agents.ejs`.
  - Agent details (tabs: overview, logs, workflows, metrics, files): `views/agent-details.ejs` with rich JS to proxy logs/metrics/files through manager.
  - File watcher UI: `views/agent-filewatcher.ejs` (rules CRUD, INI import/export, global settings `scanDir`/`scanSubDir`).
  - Agent configure: `views/agent-configure.ejs` (SSH, workflows list, file browser settings, advanced settings) saves via `PUT /api/agents/:id/config`.
  - Workflow list/editor: `views/workflows.ejs`, `views/workflow-editor.ejs` (full-featured Drawflow), `views/workflow-editor-simple.ejs` (lightweight). Public script `public/js/workflow-editor.js` appears unused by current views (likely vestigial).
  - CSS: `public/css/style.css` (global theme).

- Manager gaps/bugs
  - Missing health route: Dockerfile and K8s expect `/health`, docs mention `/api/health`; neither exists. Add `/health` and `/api/health` 200 OK endpoints.
  - Duplicate `PUT /agents/:id/config` (see above) breaks Git-as-source-of-truth flow.
  - Auth/RBAC: No login/authz on API/views despite `users` table; add auth (session/JWT) and role checks.
  - Notifications: WS `alert` persisted, but no outbound notifications (email/webhook/Slack) implemented.
  - Logs ingestion: Manager supports `log` WS messages and DB storage, but agents never send them; UI relies on agent local logs via proxy.
  - Validation/hardening: Several endpoints accept free-form JSON; add validation, schema checks, and rate-limiting. Consider CSRF/CORS policies for UI/API.

## Agent (Go)

- Entry: `nodes/main.go`
  - Flags: `-config`, `-manager`, `-token`, `-log-level`, `-standalone`, git ops (`-push-config`, `-check-changes`, `-list-backups`, `-recover-backup`, `-merge-config`).
  - Logging: zerolog to console + rotating file writer (`internal/logrotation`), defaults 100MB/30d/5 backups, compression.
  - Config: `internal/config/config.go` with local-only save (managed settings come from Git). Ensures `AgentID` and SSH identity (`internal/identity`).
  - Git sync: `internal/gitsync/gitsync.go`, remote `ssh://git@<manager-host>:2223/config-repo`; initializes repo, configures `core.sshCommand` when key path provided, backup/merge flows, pull/push helpers, diff/hasLocalChanges/hasDiverged.
  - WS client: `internal/websocket/client.go` connects to `<manager>/ws`, sends heartbeat, handles messages; main sets handlers for registration/reconnection/commands/config updates.
  - Commands handled: `reload-config`, `remove-workflow`, `reload-filewatcher`, `git-pull`, `set-log-level`.
  - File watcher: `internal/filewatcher/watcher.go` with robust pattern/absolute modes, global `scanDir`/`scanSubDir`, debounce/cooldown, in-use checks, delays, pre/post/error external programs, ability to invoke workflows synchronously via `WF:<name>`.
  - Workflow executor: `internal/workflow/executor.go` + `steps.go` and state manager; supports triggers: `file`, `schedule` (simplified interval), `manual`, `filewatcher`; `webhook` noted TODO.
  - Steps implemented: `move-file`, `copy-file`, `delete-file`, `run-command`, `alert` (sends alert via WS). Many UI-advertised steps are not implemented yet and are routed to `UnimplementedStep` with warnings: `rename-file`, `archive-file`, `extract-archive`, `run-script`, `ssh-command`, `send-file`, `http-request`, `database-query`, `send-email`, `slack-message`, `condition`, `loop`, `javascript`.
  - SSH/SFTP server: `internal/sshserver/server.go` (port from config), public key auth using authorized keys; non-shell `exec` without injection; barebones SFTP-like GET/PUT.
  - Agent API: `internal/api/api.go` on :8088 – logs (paginated and download from local file), workflow executions/state (reads state.json), metrics, log level get/set, and file browser endpoints (with strict allowed paths and traversal protections).

- Agent gaps/risks
  - WS `log` sending: not implemented; only alerts are forwarded to manager. Consider streaming key logs/events to manager.
  - Webhook trigger: not implemented in executor.
  - Many step types are placeholders; UI lists them, but runtime will log "not yet implemented". Align editor palette with implemented steps or implement missing ones.
  - Agent API CORS is `*`; restrict to manager domain or require an auth token for proxied calls.
  - Security: file browser defaults to agent data dir if no `allowedPaths`, which is sane; still ensure paths are minimal and UI discloses enabled/disabled state.

## Config repository (Git)

- Location: `manager/data/config-repo` (working repo). Structure created by `GitServer`:
  - `agents/<agentId>.json` for agent-managed settings (workflows, fileWatcher settings/rules, file browser, SSH server settings).
  - `workflows/<workflowId>.json` for workflow definitions.
  - `templates/` and repo `README.md`.
- Manager writes here; agents pull via SSH (2223). Pushes from agents sync DB via Git SSH server.

## Deployment & Packaging

- Manager Dockerfile: `manager/Dockerfile`
  - EXPOSE 3000, 2223. HEALTHCHECK hits `/health` on 3000 (route missing currently).
  - Runs as non-root (uid 1001). Installs git + openssh-client.

- Scripts: `deploy/deploy-manager.sh`, `deploy/deploy-agent.sh`
  - Manager: supports Docker or native; creates compose file mapping 3000 and 2223; expects `/health`.
  - Agent: native systemd service, downloads binary from GitHub Releases, sets env, registers if token provided, sets up default workflow directories.

- Kubernetes: `deploy/kubernetes/controlcenter-k8s.yaml`
  - Manager service exposes ports 3000 and 9418 (git). Mismatch: solution uses Git SSH on 2223 and HTTP under `/git` on 3000; port 9418 is unused. Should expose 2223 instead of 9418, or add a dedicated service for 2223.
  - Agent DaemonSet uses `ghcr.io/lsadehaan/controlcenter-nodes:latest` with privileged mode and host mounts; health probe on 8088 `/healthz` aligns with agent API.

## Documentation vs Implementation

- README and SYSTEM_OVERVIEW generally align on architecture and ports, except:
  - Docs list Manager health at `/api/health`; code has none. Docker/K8s expect `/health`. Add both endpoints.
  - SYSTEM_OVERVIEW shows agent registration via HTTP POST; implementation uses WebSocket `registration` message.
  - Git over SSH port 2223 is correct in code; K8s exposes 9418 which is unused here.

## Key Gaps and Improvements (prioritized)

1) Correctness fixes (high priority)
- Add `/health` and `/api/health` routes in manager.
- Remove/merge duplicate `PUT /api/agents/:id/config` to the Git-backed path only.
- Fix K8s service ports: expose 2223 (Git SSH), remove 9418 unless adding native git protocol.

2) Security & auth
- Implement admin auth (session/JWT) for UI/API; leverage existing `users` table; add password hashing (bcrypt already listed in deps) and role-based views.
- Add CSRF protection for form POST/PUT/DELETE, CORS restrictions, and input validation.
- Limit brute force with rate limiting on sensitive endpoints.

3) Feature completeness
- Implement missing step types or hide them in the workflow editor until available (e.g., `ssh-command`, `http-request`, `condition`, `loop`, etc.).
- Implement webhook trigger in agent executor.
- Implement manager notifications for alerts (email/webhook/Slack) and UI toggles.
- Add manager-side log aggregation (agent -> manager WS `log` or ship structured events), and optional real-time streaming.

4) Observability
- Add structured request logging and metrics for manager (HTTP latencies, WS connections); expose `/metrics` (Prometheus) in both manager and agent.
- Add indexes/retention jobs for `alerts` and `logs` tables.

5) UX & docs
- Align editor palette with implemented runtime steps; tooltips indicating availability.
- Document Git flows (SSH vs HTTP), push-from-agent behavior, and repo structure.
- Add "About/Status" page with versions, ports, config repo status, and WS connections.

## Notable File-level Findings

- Duplicate route: `manager/src/routes/api.js` defines `router.put('/agents/:id/config', ...)` twice; the first returns immediately, shadowing the Git path below.
- Missing health route: expected by `manager/Dockerfile` and K8s; add in `server.js`.
- K8s ports: Manager service exposes 9418 (`git`), but solution uses SSH on 2223; adjust.
- Unused asset: `manager/public/js/workflow-editor.js` appears unused by current views.
- Agent does not send `log` over WS; manager `handleLog` unused in practice.

---

## Status
- Completed: repo inventory; high-level architecture; manager structure (server, WS, Git, DB, API); views/assets overview; agent components (WS, Git, watcher, executor, steps, SSH, API); deployment assets; docs comparison.
- Next: if desired, I can draft concrete edits for health endpoint, route dedupe, and K8s port correction, and propose an auth scaffold.
