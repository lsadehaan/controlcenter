# Control Center Nodes (Go)

The Nodes project contains the Go-based Agent that runs on each processor host.

## Responsibilities (from the Blueprint)
- Generate and manage its own SSH identity
- Register with the Manager and maintain heartbeats over WebSockets
- Sync configuration from the Manager's Git server
- Execute local workflows and manage state for crash safety
- Expose secure services (embedded SSH/SFTP) for distributed steps
- Send alerts and logs to the Manager

## Current status
Minimal scaffold with a basic HTTP health endpoint at `:8081/healthz`.

## Requirements
- Go 1.22+

## Getting started
```bash
go run ./...
```
Then visit `http://localhost:8081/healthz`.

## Planned structure
```
nodes/
  cmd/agent/           # main binaries (future)
  internal/            # agent modules (registration, heartbeat, executor, ssh)
  docs/                # library notes and architecture
  main.go              # scaffold main
  go.mod
```

## Docs
See `docs/` for details on libraries and architecture.
