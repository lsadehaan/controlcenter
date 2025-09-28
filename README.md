# Control Center Monorepo

This repository contains the projects for the Distributed Control Center described in `Blueprint - Control Center.md`.

## Projects
- `manager/` — Node.js/Express/EJS Manager (web UI, API, configuration and observability hub)
- `nodes/` — Go Agent that runs on processor hosts

## Getting started
- Manager:
  ```bash
  cd manager
  npm install
  npm start
  # visit http://localhost:3000
  ```
- Nodes:
  ```bash
  cd nodes
  go run ./...
  # visit http://localhost:8081/healthz
  ```

## Repository structure
```
controlcenter/
  manager/        # Manager app (Node.js/Express/EJS)
  nodes/          # Go Agent
  Blueprint - Control Center.md
  LICENSE
  README.md
```

## Roadmap (from the Blueprint)
- Phase 1: Agent foundation (Go) and Manager core (Node.js), WebSockets
- Phase 2: Local workflows & UI (Drawflow), file triggers
- Phase 3: Distributed features (SSH/SFTP, key distribution)
- Phase 4: Observability (alerts/logs), polish

## Contributing
PRs welcome once the initial scaffolds stabilize. Standard lint/format coming soon.
