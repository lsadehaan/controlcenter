package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/your-org/controlcenter/nodes/internal/config"
	"github.com/your-org/controlcenter/nodes/internal/workflow"
)

// Server provides HTTP API for agent data
type Server struct {
	config      *config.Config
	executor    *workflow.Executor
	logger      zerolog.Logger
	logLevel    *zerolog.Level // Pointer to allow dynamic level changes
}

// NewServer creates a new API server
func NewServer(cfg *config.Config, executor *workflow.Executor, logger zerolog.Logger, logLevel *zerolog.Level) *Server {
	return &Server{
		config:   cfg,
		executor: executor,
		logger:   logger,
		logLevel: logLevel,
	}
}

// RegisterHandlers registers all API endpoints
func (s *Server) RegisterHandlers() {
	http.HandleFunc("/api/logs", s.handleLogs)
	http.HandleFunc("/api/logs/download", s.handleLogsDownload)
	http.HandleFunc("/api/workflows/executions", s.handleWorkflowExecutions)
	http.HandleFunc("/api/workflows/state", s.handleWorkflowState)
	http.HandleFunc("/api/metrics", s.handleMetrics)
	http.HandleFunc("/api/loglevel", s.handleLogLevel)
}

// LogEntry represents a single log line with metadata
type LogEntry struct {
	Timestamp string                 `json:"timestamp"`
	Level     string                 `json:"level"`
	Message   string                 `json:"message"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	LineNum   int                    `json:"lineNum"`
}

// LogsResponse represents paginated log response
type LogsResponse struct {
	Logs       []LogEntry `json:"logs"`
	TotalLines int        `json:"totalLines"`
	Page       int        `json:"page"`
	PageSize   int        `json:"pageSize"`
	TotalPages int        `json:"totalPages"`
	HasMore    bool       `json:"hasMore"`
}

// handleLogs returns paginated logs with filtering
// GET /api/logs?page=1&pageSize=100&level=error&search=workflow
func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Parse query parameters
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}

	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if pageSize < 1 || pageSize > 1000 {
		pageSize = 100
	}

	levelFilter := strings.ToLower(r.URL.Query().Get("level"))
	searchFilter := strings.ToLower(r.URL.Query().Get("search"))

	// Read log file
	logPath := s.config.LogFilePath
	if logPath == "" {
		logPath = filepath.Join(getDataDir(), "agent.log")
	}

	file, err := os.Open(logPath)
	if err != nil {
		if os.IsNotExist(err) {
			json.NewEncoder(w).Encode(LogsResponse{
				Logs:       []LogEntry{},
				TotalLines: 0,
				Page:       page,
				PageSize:   pageSize,
				TotalPages: 0,
				HasMore:    false,
			})
			return
		}
		http.Error(w, fmt.Sprintf("Failed to read logs: %v", err), http.StatusInternalServerError)
		return
	}
	defer file.Close()

	// Read and filter logs
	var allLogs []LogEntry
	scanner := bufio.NewScanner(file)
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

		// Skip empty lines
		if strings.TrimSpace(line) == "" {
			continue
		}

		// Parse JSON log line (zerolog format)
		var logData map[string]interface{}
		if err := json.Unmarshal([]byte(line), &logData); err != nil {
			// Not JSON - skip non-JSON log lines to avoid showing incorrect timestamps
			// Old logs that aren't in zerolog JSON format will be ignored
			continue
		}

		// Extract fields
		entry := LogEntry{
			LineNum:  lineNum,
			Metadata: make(map[string]interface{}),
		}

		if ts, ok := logData["time"].(float64); ok {
			entry.Timestamp = time.Unix(int64(ts), 0).Format(time.RFC3339)
		} else if ts, ok := logData["time"].(string); ok {
			entry.Timestamp = ts
		}

		if level, ok := logData["level"].(string); ok {
			entry.Level = level
		}

		if msg, ok := logData["message"].(string); ok {
			entry.Message = msg
		}

		// Collect metadata (everything except standard fields)
		for key, val := range logData {
			if key != "time" && key != "level" && key != "message" {
				entry.Metadata[key] = val
			}
		}

		// Apply filters
		if levelFilter != "" && entry.Level != levelFilter {
			continue
		}

		if searchFilter != "" {
			searchText := strings.ToLower(entry.Message + " " + fmt.Sprint(entry.Metadata))
			if !strings.Contains(searchText, searchFilter) {
				continue
			}
		}

		allLogs = append(allLogs, entry)
	}

	// Reverse to show newest first
	for i, j := 0, len(allLogs)-1; i < j; i, j = i+1, j-1 {
		allLogs[i], allLogs[j] = allLogs[j], allLogs[i]
	}

	// Paginate
	totalLines := len(allLogs)
	totalPages := (totalLines + pageSize - 1) / pageSize
	startIdx := (page - 1) * pageSize
	endIdx := startIdx + pageSize

	if startIdx >= totalLines {
		startIdx = totalLines
	}
	if endIdx > totalLines {
		endIdx = totalLines
	}

	paginatedLogs := []LogEntry{}
	if startIdx < totalLines {
		paginatedLogs = allLogs[startIdx:endIdx]
	}

	response := LogsResponse{
		Logs:       paginatedLogs,
		TotalLines: totalLines,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		HasMore:    page < totalPages,
	}

	json.NewEncoder(w).Encode(response)
}

// handleLogsDownload allows downloading logs as file
// GET /api/logs/download?level=error&search=workflow&limit=5000
func (s *Server) handleLogsDownload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Content-Disposition", "attachment; filename=agent-logs.txt")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	levelFilter := strings.ToLower(r.URL.Query().Get("level"))
	searchFilter := strings.ToLower(r.URL.Query().Get("search"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 50000 {
		limit = 10000 // Default 10k lines
	}

	logPath := s.config.LogFilePath
	if logPath == "" {
		logPath = filepath.Join(getDataDir(), "agent.log")
	}

	file, err := os.Open(logPath)
	if err != nil {
		http.Error(w, "Log file not found", http.StatusNotFound)
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	linesWritten := 0

	for scanner.Scan() && linesWritten < limit {
		line := scanner.Text()

		// Apply filters if specified
		if levelFilter != "" || searchFilter != "" {
			var logData map[string]interface{}
			if err := json.Unmarshal([]byte(line), &logData); err == nil {
				if level, ok := logData["level"].(string); ok && levelFilter != "" {
					if level != levelFilter {
						continue
					}
				}
				if searchFilter != "" {
					lineText := strings.ToLower(line)
					if !strings.Contains(lineText, searchFilter) {
						continue
					}
				}
			}
		}

		fmt.Fprintln(w, line)
		linesWritten++
	}
}

// WorkflowExecutionResponse represents workflow execution history
type WorkflowExecutionResponse struct {
	Executions []workflow.WorkflowState `json:"executions"`
	Count      int                      `json:"count"`
}

// handleWorkflowExecutions returns workflow execution history
// GET /api/workflows/executions?workflowId=wf-123
func (s *Server) handleWorkflowExecutions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Read state file
	stateFile := s.config.StateFilePath
	if stateFile == "" {
		stateFile = filepath.Join(getDataDir(), "state.json")
	}

	data, err := os.ReadFile(stateFile)
	if err != nil {
		if os.IsNotExist(err) {
			json.NewEncoder(w).Encode(WorkflowExecutionResponse{
				Executions: []workflow.WorkflowState{},
				Count:      0,
			})
			return
		}
		http.Error(w, fmt.Sprintf("Failed to read state: %v", err), http.StatusInternalServerError)
		return
	}

	var state map[string]*workflow.WorkflowState
	if err := json.Unmarshal(data, &state); err != nil {
		http.Error(w, fmt.Sprintf("Failed to parse state: %v", err), http.StatusInternalServerError)
		return
	}

	workflowFilter := r.URL.Query().Get("workflowId")

	var executions []workflow.WorkflowState
	for _, exec := range state {
		if workflowFilter == "" || exec.WorkflowID == workflowFilter {
			executions = append(executions, *exec)
		}
	}

	json.NewEncoder(w).Encode(WorkflowExecutionResponse{
		Executions: executions,
		Count:      len(executions),
	})
}

// handleWorkflowState returns current workflow state
// GET /api/workflows/state
func (s *Server) handleWorkflowState(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	workflows := s.executor.GetWorkflows()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"workflows": workflows,
		"count":     len(workflows),
	})
}

// MetricsResponse represents agent metrics
type MetricsResponse struct {
	AgentID          string                 `json:"agentId"`
	Hostname         string                 `json:"hostname"`
	Platform         string                 `json:"platform"`
	Uptime           string                 `json:"uptime"`
	WorkflowsLoaded  int                    `json:"workflowsLoaded"`
	LogFileSize      int64                  `json:"logFileSizeBytes"`
	StateFileSize    int64                  `json:"stateFileSizeBytes"`
	ConfigRepoStatus string                 `json:"configRepoStatus"`
	Extra            map[string]interface{} `json:"extra,omitempty"`
}

// handleMetrics returns agent metrics and health information
// GET /api/metrics
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Get file sizes
	logSize := int64(0)
	if info, err := os.Stat(s.config.LogFilePath); err == nil {
		logSize = info.Size()
	}

	stateSize := int64(0)
	if info, err := os.Stat(s.config.StateFilePath); err == nil {
		stateSize = info.Size()
	}

	hostname, _ := os.Hostname()

	metrics := MetricsResponse{
		AgentID:         s.config.AgentID,
		Hostname:        hostname,
		Platform:        getPlatform(),
		WorkflowsLoaded: len(s.executor.GetWorkflows()),
		LogFileSize:     logSize,
		StateFileSize:   stateSize,
		Extra:           make(map[string]interface{}),
	}

	json.NewEncoder(w).Encode(metrics)
}

func getDataDir() string {
	dir := os.Getenv("AGENT_DATA_DIR")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".controlcenter-agent")
	}
	return dir
}

func getPlatform() string {
	return runtime.GOOS + "/" + runtime.GOARCH
}

// LogLevelResponse represents log level status
type LogLevelResponse struct {
	CurrentLevel string   `json:"currentLevel"`
	AvailableLevels []string `json:"availableLevels"`
}

// LogLevelRequest represents log level change request
type LogLevelRequest struct {
	Level string `json:"level"`
}

// handleLogLevel gets or sets the current log level
// GET /api/loglevel - Get current level
// POST /api/loglevel - Set new level (body: {"level": "debug"})
func (s *Server) handleLogLevel(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	availableLevels := []string{"debug", "info", "warn", "error"}

	if r.Method == http.MethodGet {
		// Return current log level
		currentLevel := "info"
		if s.logLevel != nil {
			currentLevel = s.logLevel.String()
		}

		response := LogLevelResponse{
			CurrentLevel: currentLevel,
			AvailableLevels: availableLevels,
		}

		json.NewEncoder(w).Encode(response)
		return
	}

	if r.Method == http.MethodPost {
		// Parse request
		var req LogLevelRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
			return
		}

		// Validate level
		newLevel, err := zerolog.ParseLevel(req.Level)
		if err != nil {
			http.Error(w, fmt.Sprintf("Invalid log level: %s. Valid levels: debug, info, warn, error", req.Level), http.StatusBadRequest)
			return
		}

		// Update log level
		if s.logLevel != nil {
			*s.logLevel = newLevel
			s.logger.Info().
				Str("oldLevel", s.logLevel.String()).
				Str("newLevel", newLevel.String()).
				Msg("Log level changed via API")
		}

		// Update config if available
		if s.config != nil {
			s.config.LogSettings.Level = req.Level
			// Note: Config will be persisted on next save
		}

		response := LogLevelResponse{
			CurrentLevel: newLevel.String(),
			AvailableLevels: availableLevels,
		}

		json.NewEncoder(w).Encode(response)
		return
	}

	// Method not allowed
	http.Error(w, "Method not allowed. Use GET or POST", http.StatusMethodNotAllowed)
}
