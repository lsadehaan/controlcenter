package workflow

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"text/template"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/rs/zerolog"
	"github.com/your-org/controlcenter/nodes/internal/config"
)

type Executor struct {
	mu           sync.RWMutex
	workflows    map[string]*WorkflowInstance
	state        *StateManager
	logger       zerolog.Logger
	watcher      *fsnotify.Watcher
	stopChan     chan struct{}
	stopped      bool
	alertHandler func(level, message string, details map[string]interface{})
}

type WorkflowInstance struct {
	Workflow *config.Workflow
	Status   string
	LastRun  time.Time
	NextRun  time.Time
	Error    string
}

func NewExecutor(stateFile string, logger zerolog.Logger) (*Executor, error) {
	state, err := NewStateManager(stateFile)
	if err != nil {
		return nil, err
	}

	return &Executor{
		workflows: make(map[string]*WorkflowInstance),
		state:     state,
		logger:    logger,
		stopChan:  make(chan struct{}),
	}, nil
}

func (e *Executor) SetAlertHandler(handler func(level, message string, details map[string]interface{})) {
	e.alertHandler = handler
}

func (e *Executor) LoadWorkflows(workflows []config.Workflow) {
	e.mu.Lock()
	defer e.mu.Unlock()

	// Clear existing workflows
	e.workflows = make(map[string]*WorkflowInstance)

	// Load new workflows
	for _, wf := range workflows {
		if wf.Enabled {
			e.workflows[wf.ID] = &WorkflowInstance{
				Workflow: &wf,
				Status:   "idle",
			}
			e.logger.Info().
				Str("id", wf.ID).
				Str("name", wf.Name).
				Msg("Loaded workflow")
		}
	}
}

func (e *Executor) Start() error {
	e.mu.Lock()
	if e.stopped {
		// Reinitialize if previously stopped
		e.stopChan = make(chan struct{})
		e.stopped = false
	}
	e.mu.Unlock()
	
	e.logger.Info().Msg("Starting workflow executor")

	// Start trigger handlers
	for id, instance := range e.workflows {
		go e.handleTrigger(id, instance)
	}

	// Keep running until stopped
	<-e.stopChan
	return nil
}

func (e *Executor) Stop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	if e.stopped {
		e.logger.Debug().Msg("Workflow executor already stopped")
		return
	}
	
	e.logger.Info().Msg("Stopping workflow executor")
	e.stopped = true
	close(e.stopChan)
	
	if e.watcher != nil {
		e.watcher.Close()
		e.watcher = nil
	}
}

func (e *Executor) handleTrigger(workflowID string, instance *WorkflowInstance) {
	trigger := instance.Workflow.Trigger
	
	e.logger.Debug().
		Str("type", trigger.Type).
		Interface("config", trigger.Config).
		Str("workflow", workflowID).
		Msg("Setting up trigger")
	
	switch trigger.Type {
	case "file":
		e.handleFileTrigger(workflowID, instance, trigger.Config)
	case "schedule":
		e.handleScheduleTrigger(workflowID, instance, trigger.Config)
	case "webhook":
		e.handleWebhookTrigger(workflowID, instance, trigger.Config)
	case "manual":
		e.logger.Info().
			Str("workflow", workflowID).
			Msg("Manual trigger - workflow will only run when triggered manually")
	case "filewatcher":
		// File watcher trigger - workflows are invoked by the file watcher component
		e.logger.Info().
			Str("workflow", workflowID).
			Msg("File watcher trigger - workflow will be triggered by file watcher rules")
	case "":
		e.logger.Warn().
			Str("workflow", workflowID).
			Msg("Empty trigger type - workflow cannot be triggered automatically")
	default:
		e.logger.Warn().
			Str("type", trigger.Type).
			Str("workflow", workflowID).
			Msg("Unknown trigger type")
	}
}

func (e *Executor) handleFileTrigger(workflowID string, instance *WorkflowInstance, config map[string]interface{}) {
	path, _ := config["path"].(string)
	pattern, _ := config["pattern"].(string)
	
	if path == "" {
		e.logger.Error().Str("workflow", workflowID).Msg("File trigger missing path")
		return
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		e.logger.Error().Err(err).Msg("Failed to create file watcher")
		return
	}

	err = watcher.Add(path)
	if err != nil {
		e.logger.Error().Err(err).Str("path", path).Msg("Failed to watch path")
		return
	}

	e.logger.Info().
		Str("workflow", workflowID).
		Str("path", path).
		Str("pattern", pattern).
		Msg("Watching for file changes")

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			
			// Check if file matches pattern
			if pattern != "" && !matchPattern(event.Name, pattern) {
				continue
			}
			
			if event.Op&fsnotify.Create == fsnotify.Create || event.Op&fsnotify.Write == fsnotify.Write {
				e.logger.Info().
					Str("workflow", workflowID).
					Str("file", event.Name).
					Msg("File trigger activated")
				
				e.executeWorkflow(workflowID, instance, map[string]interface{}{
					"trigger":   "file",
					"file":      event.Name,
					"fileName":  filepath.Base(event.Name),
					"directory": filepath.Dir(event.Name),
					"event":     event.Op.String(),
					"timestamp": time.Now().Unix(),
				})
			}
			
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			e.logger.Error().Err(err).Msg("File watcher error")
			
		case <-e.stopChan:
			watcher.Close()
			return
		}
	}
}

func (e *Executor) handleScheduleTrigger(workflowID string, instance *WorkflowInstance, config map[string]interface{}) {
	// Parse cron expression for simple interval calculation
	// TODO: Use proper cron library for full cron support
	interval := 60 * time.Second // Default 1 minute
	
	if cronExpr, ok := config["cron"].(string); ok {
		// Simple parsing - if it starts with "* * * * *" it's every minute
		// If it starts with "0 * * * *" or similar, it's every hour
		parts := strings.Fields(cronExpr)
		if len(parts) >= 5 {
			if parts[0] == "*" {
				interval = 1 * time.Minute
			} else if parts[1] == "*" && parts[0] != "*" {
				interval = 1 * time.Hour
			} else if parts[2] == "*" && parts[1] != "*" {
				interval = 24 * time.Hour
			}
		}
		e.logger.Info().
			Str("workflow", workflowID).
			Str("cron", cronExpr).
			Dur("interval", interval).
			Msg("Scheduled trigger set (using simplified interval)")
	} else if intervalStr, ok := config["interval"].(string); ok {
		if d, err := time.ParseDuration(intervalStr); err == nil {
			interval = d
		}
		e.logger.Info().
			Str("workflow", workflowID).
			Dur("interval", interval).
			Msg("Scheduled trigger set")
	} else {
		e.logger.Info().
			Str("workflow", workflowID).
			Dur("interval", interval).
			Msg("Scheduled trigger set (default interval)")
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			e.executeWorkflow(workflowID, instance, map[string]interface{}{
				"trigger": "schedule",
				"time":    time.Now().Unix(),
			})
			
		case <-e.stopChan:
			return
		}
	}
}

func (e *Executor) handleWebhookTrigger(workflowID string, instance *WorkflowInstance, config map[string]interface{}) {
	// TODO: Implement webhook server
	e.logger.Warn().
		Str("workflow", workflowID).
		Msg("Webhook triggers not yet implemented")
}

func (e *Executor) executeWorkflow(workflowID string, instance *WorkflowInstance, context map[string]interface{}) {
	e.mu.Lock()
	instance.Status = "running"
	instance.LastRun = time.Now()
	e.mu.Unlock()

	e.logger.Info().
		Str("workflow", workflowID).
		Str("name", instance.Workflow.Name).
		Msg("Executing workflow")

	// Save state
	e.state.StartWorkflow(workflowID, context)

	// Execute steps
	for _, step := range instance.Workflow.Steps {
		if err := e.executeStep(step, context); err != nil {
			e.logger.Error().
				Err(err).
				Str("workflow", workflowID).
				Str("step", step.ID).
				Msg("Step execution failed")
			
			e.mu.Lock()
			instance.Status = "failed"
			instance.Error = err.Error()
			e.mu.Unlock()
			
			e.state.FailWorkflow(workflowID, err.Error())
			return
		}
		
		e.state.CompleteStep(workflowID, step.ID)
	}

	e.mu.Lock()
	instance.Status = "completed"
	instance.Error = ""
	e.mu.Unlock()

	e.state.CompleteWorkflow(workflowID)

	e.logger.Info().
		Str("workflow", workflowID).
		Msg("Workflow completed successfully")
}

func (e *Executor) executeStep(step config.Step, context map[string]interface{}) error {
	e.logger.Debug().
		Str("step", step.ID).
		Str("type", step.Type).
		Msg("Executing step")

	// Process config values with template substitution
	processedConfig := make(map[string]interface{})
	for key, value := range step.Config {
		if strValue, ok := value.(string); ok {
			processedConfig[key] = e.processTemplate(strValue, context)
		} else {
			processedConfig[key] = value
		}
	}

	switch step.Type {
	case "move-file":
		return e.executeMoveFile(processedConfig)
	case "copy-file":
		return e.executeCopyFile(processedConfig)
	case "delete-file":
		return e.executeDeleteFile(processedConfig)
	case "run-command":
		return e.executeCommand(processedConfig)
	case "alert":
		return e.executeAlert(processedConfig)
	default:
		return fmt.Errorf("unknown step type: %s", step.Type)
	}
}

func (e *Executor) executeMoveFile(config map[string]interface{}) error {
	source, _ := config["source"].(string)
	destination, _ := config["destination"].(string)
	
	if source == "" || destination == "" {
		return fmt.Errorf("move-file requires source and destination")
	}
	
	// Ensure destination directory exists
	destDir := filepath.Dir(destination)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}
	
	return os.Rename(source, destination)
}

func (e *Executor) executeCopyFile(config map[string]interface{}) error {
	source, _ := config["source"].(string)
	destination, _ := config["destination"].(string)
	
	if source == "" || destination == "" {
		return fmt.Errorf("copy-file requires source and destination")
	}
	
	// Read source file
	data, err := os.ReadFile(source)
	if err != nil {
		return fmt.Errorf("failed to read source file: %w", err)
	}
	
	// Ensure destination directory exists
	destDir := filepath.Dir(destination)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}
	
	// Write to destination
	return os.WriteFile(destination, data, 0644)
}

func (e *Executor) executeDeleteFile(config map[string]interface{}) error {
	path, _ := config["path"].(string)
	
	if path == "" {
		return fmt.Errorf("delete-file requires path")
	}
	
	return os.Remove(path)
}

func (e *Executor) executeCommand(config map[string]interface{}) error {
	command, _ := config["command"].(string)
	args, _ := config["args"].([]interface{})
	workingDir, _ := config["working_directory"].(string)
	timeoutSecs, _ := config["timeout"].(float64)

	if command == "" {
		return fmt.Errorf("run-command requires command")
	}

	// Convert args to strings - these are safe as exec.Command doesn't invoke shell
	argStrings := make([]string, 0, len(args))
	for _, arg := range args {
		if arg != nil {
			argStrings = append(argStrings, fmt.Sprint(arg))
		}
	}

	// Set timeout (default 30 seconds, configurable)
	timeout := 30 * time.Second
	if timeoutSecs > 0 {
		timeout = time.Duration(timeoutSecs) * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// SECURITY: exec.CommandContext does NOT invoke shell, preventing injection
	// Arguments are passed directly to the program, not interpreted by shell
	cmd := exec.CommandContext(ctx, command, argStrings...)

	// Set working directory if specified
	if workingDir != "" {
		// Resolve to absolute path to prevent ambiguity
		absPath, err := filepath.Abs(workingDir)
		if err != nil {
			return fmt.Errorf("invalid working directory: %w", err)
		}
		cmd.Dir = absPath
	}

	// Security: Log command execution for audit
	e.logger.Info().
		Str("command", command).
		Strs("args", argStrings).
		Str("workingDir", workingDir).
		Float64("timeout", timeoutSecs).
		Msg("Executing command")

	output, err := cmd.CombinedOutput()

	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("command timed out after %v", timeout)
		}
		// Log failed commands for security audit
		e.logger.Error().
			Str("command", command).
			Err(err).
			Str("output", string(output)).
			Msg("Command failed")
		return fmt.Errorf("command failed: %w\nOutput: %s", err, output)
	}

	e.logger.Debug().
		Str("command", command).
		Int("outputLen", len(output)).
		Msg("Command executed successfully")

	return nil
}

func (e *Executor) executeAlert(config map[string]interface{}) error {
	level, _ := config["level"].(string)
	message, _ := config["message"].(string)

	if message == "" {
		return fmt.Errorf("alert requires message")
	}

	e.logger.Info().
		Str("level", level).
		Str("message", message).
		Msg("Alert generated")

	// Send alert to manager via alert channel
	if e.alertHandler != nil {
		e.alertHandler(level, message, config)
	}

	return nil
}

// processTemplate applies template substitution to a string using context variables
func (e *Executor) processTemplate(text string, context map[string]interface{}) string {
	// Create template
	tmpl, err := template.New("text").Parse(text)
	if err != nil {
		e.logger.Warn().Err(err).Str("text", text).Msg("Failed to parse template")
		return text
	}

	// Execute template
	var buf bytes.Buffer
	err = tmpl.Execute(&buf, context)
	if err != nil {
		e.logger.Warn().Err(err).Str("text", text).Msg("Failed to execute template")
		return text
	}

	return buf.String()
}

func matchPattern(name, pattern string) bool {
	if pattern == "" || pattern == "*" {
		return true
	}
	
	// Simple pattern matching
	if strings.Contains(pattern, "*") {
		pattern = strings.ReplaceAll(pattern, "*", "")
		return strings.Contains(name, pattern)
	}
	
	return strings.HasSuffix(name, pattern)
}

// StateManager handles workflow state persistence
type StateManager struct {
	mu       sync.RWMutex
	filepath string
	state    map[string]*WorkflowState
}

type WorkflowState struct {
	WorkflowID   string                 `json:"workflowId"`
	Status       string                 `json:"status"`
	StartTime    time.Time              `json:"startTime"`
	EndTime      time.Time              `json:"endTime,omitempty"`
	Context      map[string]interface{} `json:"context"`
	CompletedSteps []string             `json:"completedSteps"`
	Error        string                 `json:"error,omitempty"`
}

func NewStateManager(filepath string) (*StateManager, error) {
	sm := &StateManager{
		filepath: filepath,
		state:    make(map[string]*WorkflowState),
	}
	
	// Load existing state
	if err := sm.load(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	
	return sm, nil
}

func (sm *StateManager) load() error {
	data, err := os.ReadFile(sm.filepath)
	if err != nil {
		return err
	}
	
	return json.Unmarshal(data, &sm.state)
}

func (sm *StateManager) save() error {
	data, err := json.MarshalIndent(sm.state, "", "  ")
	if err != nil {
		return err
	}
	
	return os.WriteFile(sm.filepath, data, 0644)
}

func (sm *StateManager) StartWorkflow(workflowID string, context map[string]interface{}) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	
	sm.state[workflowID] = &WorkflowState{
		WorkflowID:     workflowID,
		Status:         "running",
		StartTime:      time.Now(),
		Context:        context,
		CompletedSteps: []string{},
	}
	
	sm.save()
}

func (sm *StateManager) CompleteStep(workflowID, stepID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	
	if state, ok := sm.state[workflowID]; ok {
		state.CompletedSteps = append(state.CompletedSteps, stepID)
		sm.save()
	}
}

func (sm *StateManager) CompleteWorkflow(workflowID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	
	if state, ok := sm.state[workflowID]; ok {
		state.Status = "completed"
		state.EndTime = time.Now()
		sm.save()
	}
}

func (sm *StateManager) FailWorkflow(workflowID, error string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	
	if state, ok := sm.state[workflowID]; ok {
		state.Status = "failed"
		state.EndTime = time.Now()
		state.Error = error
		sm.save()
	}
}

// TriggerEvent represents an external trigger for a workflow
type TriggerEvent struct {
	Type string                 `json:"type"`
	Data map[string]interface{} `json:"data"`
}

// GetWorkflows returns all loaded workflows
func (e *Executor) GetWorkflows() []config.Workflow {
	e.mu.RLock()
	defer e.mu.RUnlock()
	
	var workflows []config.Workflow
	for _, instance := range e.workflows {
		if instance.Workflow != nil {
			workflows = append(workflows, *instance.Workflow)
		}
	}
	return workflows
}

// ExecuteWorkflow executes a workflow by ID with an external trigger
func (e *Executor) ExecuteWorkflow(workflowID string, trigger TriggerEvent) error {
	e.mu.RLock()
	instance, exists := e.workflows[workflowID]
	e.mu.RUnlock()
	
	if !exists {
		return fmt.Errorf("workflow %s not found", workflowID)
	}
	
	// Create context with trigger data
	context := make(map[string]interface{})
	for k, v := range trigger.Data {
		context[k] = v
	}
	context["triggerType"] = trigger.Type
	
	// Execute the workflow
	go e.executeWorkflow(workflowID, instance, context)
	return nil
}