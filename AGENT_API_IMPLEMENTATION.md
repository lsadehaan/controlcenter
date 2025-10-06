# Agent API Implementation

## Overview

Agents now expose a comprehensive HTTP API on port **8088** for querying logs, metrics, and workflow execution data. The Manager UI can query these APIs on-demand to view agent-specific information without requiring continuous data streaming.

## Agent API Endpoints

### Base URL
```
http://localhost:8088
```

### Health & Info
- **GET /healthz** - Health check endpoint
  ```json
  {
    "status": "ok",
    "agentId": "agent-123",
    "time": 1234567890
  }
  ```

- **GET /info** - Agent information
  ```json
  {
    "agentId": "agent-123",
    "publicKey": "ssh-rsa ...",
    "workflows": 5,
    "sshPort": 2222
  }
  ```

### Logs API
- **GET /api/logs** - Paginated logs with filtering
  - Query Parameters:
    - `page` (default: 1) - Page number
    - `pageSize` (default: 100, max: 1000) - Lines per page
    - `level` (optional) - Filter by level: debug, info, warn, error
    - `search` (optional) - Search logs by text

  - Response:
    ```json
    {
      "logs": [
        {
          "timestamp": "2025-01-15T10:30:45Z",
          "level": "info",
          "message": "Workflow executed successfully",
          "metadata": { "workflow": "wf-123" },
          "lineNum": 1234
        }
      ],
      "totalLines": 5000,
      "page": 1,
      "pageSize": 100,
      "totalPages": 50,
      "hasMore": true
    }
    ```

- **GET /api/logs/download** - Download logs as file
  - Query Parameters:
    - `level` (optional) - Filter by level
    - `search` (optional) - Filter by text
    - `limit` (default: 10000, max: 50000) - Maximum lines

  - Response: Plain text file (Content-Disposition: attachment)

### Workflow Execution API
- **GET /api/workflows/executions** - Workflow execution history
  - Query Parameters:
    - `workflowId` (optional) - Filter by workflow ID

  - Response:
    ```json
    {
      "executions": [
        {
          "workflowID": "wf-123",
          "status": "completed",
          "startTime": "2025-01-15T10:30:00Z",
          "endTime": "2025-01-15T10:30:45Z",
          "context": { "fileName": "test.csv" },
          "completedSteps": ["step-1", "step-2"],
          "error": ""
        }
      ],
      "count": 10
    }
    ```

- **GET /api/workflows/state** - Current loaded workflows
  ```json
  {
    "workflows": [
      {
        "id": "wf-123",
        "name": "File Processor",
        "enabled": true,
        "trigger": { ... },
        "steps": [ ... ]
      }
    ],
    "count": 5
  }
  ```

### Metrics API
- **GET /api/metrics** - Agent metrics and health
  ```json
  {
    "agentId": "agent-123",
    "hostname": "server01",
    "platform": "windows/amd64",
    "workflowsLoaded": 5,
    "logFileSizeBytes": 1048576,
    "stateFileSizeBytes": 8192,
    "extra": {}
  }
  ```

## Manager UI Integration

### Agent Details Page
URL: `/agents/:id`

Features:
- **Overview Tab**: Agent information, status, registration details
- **Logs Tab**:
  - Paginated log viewer with syntax highlighting
  - Filter by level (debug, info, warn, error)
  - Search logs by text
  - Download logs to file
  - Configurable page size (50, 100, 200, 500 lines)

- **Workflows Tab**:
  - View workflow execution history
  - Shows: status, start/end times, duration, completed steps, errors

- **Metrics Tab**:
  - Agent metrics (workflows loaded, file sizes, platform info)
  - Refresh on demand

### Architecture

```
┌─────────────┐                    ┌──────────────┐
│   Manager   │                    │  Agent Node  │
│     UI      │                    │              │
└──────┬──────┘                    └───────┬──────┘
       │                                   │
       │  1. User clicks "View Agent"     │
       │                                   │
       │  2. GET /agents/:id              │
       │     (Manager serves UI page)      │
       │                                   │
       │  3. User clicks "Refresh Logs"   │
       │                                   │
       │  4. Browser directly queries:    │
       │     GET http://agent:8088/api/logs
       │                                   │
       │ ◄─────────────────────────────────┤
       │           JSON response           │
       │                                   │
```

**Key Design Principles:**
1. **Agent Autonomy**: Each agent maintains its own data
2. **On-Demand Queries**: Manager queries agent APIs only when user requests
3. **No Streaming**: No continuous WebSocket log forwarding
4. **Direct API Access**: Browser queries agent API directly (CORS enabled)

## Data Storage

### On Agent
- **Log File**: `~/.controlcenter-agent/agent.log`
  - Zerolog JSON format
  - All agent activity (205+ log statements)
  - Retained locally, not forwarded

- **State File**: `~/.controlcenter-agent/state.json`
  - Workflow execution history
  - Completed steps per execution
  - Error details

### On Manager
- **Alerts**: Stored in manager SQLite `alerts` table (sent via WebSocket)
- **Agent Metadata**: Stored in `agents` table
- **Logs Table**: Empty (agents don't forward logs, they expose via API)

## Implementation Files

### Agent Side (Go)
- **`nodes/internal/api/api.go`** (new, 400+ lines)
  - HTTP handlers for all API endpoints
  - Log parsing and pagination
  - Workflow execution history
  - Metrics collection

- **`nodes/main.go`** (modified)
  - Registers API handlers on startup
  - Logs available endpoints

### Manager Side (Node.js)
- **`manager/views/agent-details.ejs`** (new, 450+ lines)
  - Tabbed UI for agent details
  - Log viewer with filtering and pagination
  - Workflow execution history viewer
  - Metrics dashboard
  - Download functionality

- **`manager/src/server.js`** (modified)
  - Route for `/agents/:id` serves agent-details page

## Usage Examples

### View Agent Logs from Manager UI
1. Navigate to http://localhost:3000/agents
2. Click "View" on any online agent
3. Click "Logs" tab
4. Click "Refresh" to load logs
5. Use filters: level (error, warn, info, debug), search text
6. Click "Download" to save logs to file

### Query Agent API Directly
```bash
# Get recent logs
curl "http://localhost:8088/api/logs?page=1&pageSize=100&level=error"

# Download logs
curl "http://localhost:8088/api/logs/download?limit=5000" > agent-logs.txt

# Get workflow executions
curl "http://localhost:8088/api/workflows/executions"

# Get metrics
curl "http://localhost:8088/api/metrics"
```

### Filter and Search Logs
```javascript
// From Manager UI
GET /api/logs?level=error&search=workflow&page=1&pageSize=100

// Returns only ERROR level logs containing "workflow"
```

## Future Enhancements

1. **Agent Discovery**: Store agent API endpoints in database
2. **Log Aggregation**: Optional log shipping for centralized storage
3. **Real-Time Streaming**: WebSocket log tailing for live monitoring
4. **Log Retention**: Automatic log rotation and cleanup
5. **Advanced Filtering**: Date ranges, multiple levels, regex search
6. **Metrics Visualization**: Charts and graphs for trends
7. **Alerting**: Automatic alerts on error patterns
8. **Export Formats**: CSV, JSON export options

## Security Considerations

1. **CORS**: Currently `Access-Control-Allow-Origin: *` for development
   - Production should restrict to manager origin
2. **Authentication**: No authentication currently implemented
   - Consider adding API keys or JWT tokens
3. **Rate Limiting**: No rate limiting on API endpoints
   - Should implement to prevent abuse
4. **File Access**: API can read entire log files
   - Consider implementing access controls

## Performance

- **Pagination**: Efficient for large log files (tested with 50k+ lines)
- **Filtering**: Done in-memory, suitable for log files up to ~100MB
- **No Database**: Zero database queries on agent side
- **Caching**: No caching implemented (always reads fresh data)

## Troubleshooting

**Agent logs not loading:**
- Check agent is online (status badge)
- Verify agent API is running on port 8088
- Check browser console for CORS errors
- Ensure log file exists at `~/.controlcenter-agent/agent.log`

**"Agent is offline" error:**
- Agent must be status "online" in manager database
- Agent heartbeat must be recent (< 60 seconds)
- For development, update `getAgentApiUrl()` in agent-details.ejs

**Logs showing "No logs found":**
- Agent may not have written logs yet
- Check filters (level, search) aren't too restrictive
- Verify log file has content: `cat ~/.controlcenter-agent/agent.log`
