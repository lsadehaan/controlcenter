# Control Center Manager (Node.js / Express / EJS)

The Manager is the central brain of the Distributed Control Center. It provides the web UI and API, manages agent registration and security, and serves as the configuration and observability hub per the Blueprint.

See the project blueprint: `Blueprint - Control Center.md`.

## What this scaffold includes
- Express server with EJS views
- Static assets served from `public/`
- Minimal home page
- NPM script for local run

## Getting started
1. Install Node.js 18+.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the server:
   ```bash
   npm start
   ```
4. Visit `http://localhost:3000`.

## Roadmap alignment (from the Blueprint)
- Agent Registry and heartbeat WebSocket hub
- Public Key Registry and Git-backed configuration service
- Alerting and Log ingestion endpoints
- Notification gateways (Email/Slack)
- EJS-based admin UI with Drawflow.js visual workflow builder

## Directory structure
```
manager/
  src/            # Express app
  views/          # EJS templates
  public/         # Static assets
  docs/           # Architecture and library docs
  package.json
  README.md
```

## Docs
See `docs/` for details on frameworks and libraries we will use.


