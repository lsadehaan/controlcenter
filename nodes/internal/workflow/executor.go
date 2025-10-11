package workflow

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
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
	stepRegistry *StepRegistry
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
		workflows:    make(map[string]*WorkflowInstance),
		state:        state,
		logger:       logger,
		stopChan:     make(chan struct{}),
		stepRegistry: NewStepRegistry(logger, nil),
	}, nil
}

func (e *Executor) SetAlertHandler(handler func(level, message string, details map[string]interface{})) {
	e.alertHandler = handler
	// Update registry with alert handler
	e.stepRegistry = NewStepRegistry(e.logger, handler)
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
	// Register HTTP handler based on trigger config
	path, _ := config["path"].(string)
	if path == "" {
		path = "/api/webhooks/" + workflowID
	}

	method, _ := config["method"].(string)
	if method == "" {
		method = http.MethodPost
	}

	// Register handler once per workflowID
	http.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			w.WriteHeader(http.StatusMethodNotAllowed)
			fmt.Fprintf(w, "method not allowed")
			return
		}

		// Parse payload (support JSON and form)
		payload := make(map[string]interface{})
		if strings.Contains(r.Header.Get("Content-Type"), "application/json") {
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err == nil {
				for k, v := range body { payload[k] = v }
			}
		} else {
			r.ParseForm()
			for k, v := range r.Form { if len(v) > 0 { payload[k] = v[0] } }
		}

		// Include headers and query params for context
		headers := make(map[string]string)
		for k, v := range r.Header { if len(v) > 0 { headers[k] = v[0] } }
		query := make(map[string]string)
		for k := range r.URL.Query() { query[k] = r.URL.Query().Get(k) }

		ctx := map[string]interface{}{
			"trigger":          "webhook",
			"webhookData":      payload,
			"webhookHeaders":   headers,
			"webhookQuery":     query,
			"timestamp":        time.Now().Unix(),
		}

		// Execute workflow asynchronously
		go e.executeWorkflow(workflowID, instance, ctx)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":   "queued",
			"workflow": workflowID,
		})
	})

	e.logger.Info().
		Str("workflow", workflowID).
		Str("path", path).
		Str("method", method).
		Msg("Webhook trigger registered")
}

func (e *Executor) executeWorkflow(workflowID string, instance *WorkflowInstance, context map[string]interface{}) {
	e.mu.Lock()
	instance.Status = "running"
	instance.LastRun = time.Now()
	e.mu.Unlock()

	e.logger.Info().
		Str("workflow", workflowID).
		Str("name", instance.Workflow.Name).
		Interface("context", context).
		Msg("🚀 Starting workflow execution")

	// Save state
	e.state.StartWorkflow(workflowID, context)

	// Build step map for quick lookup
	stepMap := make(map[string]config.Step)
	for _, step := range instance.Workflow.Steps {
		stepMap[step.ID] = step
	}

	// Get starting steps from trigger
	startSteps := instance.Workflow.Trigger.StartSteps
	if len(startSteps) == 0 {
		// Fallback: if no startSteps defined, execute all steps sequentially
		e.logger.Warn().
			Str("workflow", workflowID).
			Msg("⚠️ No trigger.startSteps defined, falling back to sequential execution")
		for _, step := range instance.Workflow.Steps {
			startSteps = append(startSteps, step.ID)
		}
	}

	e.logger.Info().
		Str("workflow", workflowID).
		Strs("startSteps", startSteps).
		Msg("📍 Starting from trigger-defined steps")

	// Execute step chains starting from trigger
	visited := make(map[string]bool)
	if err := e.executeStepChain(startSteps, stepMap, context, workflowID, visited); err != nil {
		e.logger.Error().
			Err(err).
			Str("workflow", workflowID).
			Msg("❌ Workflow execution failed")

		e.mu.Lock()
		instance.Status = "failed"
		instance.Error = err.Error()
		e.mu.Unlock()

		e.state.FailWorkflow(workflowID, err.Error())
		return
	}

	e.mu.Lock()
	instance.Status = "completed"
	instance.Error = ""
	e.mu.Unlock()

	e.state.CompleteWorkflow(workflowID)

	e.logger.Info().
		Str("workflow", workflowID).
		Msg("✅ Workflow completed successfully")
}

func (e *Executor) executeStepChain(stepIDs []string, stepMap map[string]config.Step, context map[string]interface{}, workflowID string, visited map[string]bool) error {
	for _, stepID := range stepIDs {
		// Check for cycles
		if visited[stepID] {
			e.logger.Warn().
				Str("step", stepID).
				Msg("🔄 Step already visited, skipping to prevent cycle")
			continue
		}
		visited[stepID] = true

		step, exists := stepMap[stepID]
		if !exists {
			e.logger.Error().
				Str("step", stepID).
				Msg("❌ Step not found in workflow")
			return fmt.Errorf("step %s not found", stepID)
		}

		// Execute the step
		if err := e.executeStep(step, context, workflowID); err != nil {
			// Step failed - check if there are error handlers
			if len(step.OnError) > 0 {
				e.logger.Info().
					Str("step", stepID).
					Strs("onError", step.OnError).
					Str("error", err.Error()).
					Msg("⚠️ Step failed, executing error handlers")

				// Add error information to context for error handlers
				errorContext := make(map[string]interface{})
				for k, v := range context {
					errorContext[k] = v
				}
				errorContext["error"] = err.Error()
				errorContext["errorStep"] = step.ID
				errorContext["errorStepName"] = step.Name

				// Execute error handler chain
				if err := e.executeStepChain(step.OnError, stepMap, errorContext, workflowID, visited); err != nil {
					e.logger.Error().
						Err(err).
						Str("step", stepID).
						Msg("Error handler chain also failed")
					return err
				}

				// Error was handled - continue with next iteration (don't follow normal 'next' path)
				e.logger.Info().
					Str("step", stepID).
					Msg("✅ Error handlers completed successfully")
				continue
			} else {
				// No error handlers defined - propagate error up
				e.logger.Error().
					Err(err).
					Str("step", stepID).
					Msg("❌ Step failed with no error handlers")
				return err
			}
		}

		// Step succeeded - follow normal next connections
		if len(step.Next) > 0 {
			e.logger.Debug().
				Str("step", stepID).
				Strs("next", step.Next).
				Msg("➡️ Following connections to next steps")
			if err := e.executeStepChain(step.Next, stepMap, context, workflowID, visited); err != nil {
				return err
			}
		} else {
			e.logger.Debug().
				Str("step", stepID).
				Msg("🏁 Step has no next steps (end of branch)")
		}
	}
	return nil
}

func (e *Executor) executeStep(step config.Step, context map[string]interface{}, workflowID string) error {
	e.logger.Info().
		Str("step", step.ID).
		Str("type", step.Type).
		Str("name", step.Name).
		Msg("▶️ Executing step")

	// Process config values with recursive template substitution
	processedConfig := e.processConfigWithTemplate(step.Config, context)

	e.logger.Debug().
		Str("step", step.ID).
		Interface("processedConfig", processedConfig).
		Msg("🔄 Step config processed with templates")

	// Create step instance from registry
	stepImpl, err := e.stepRegistry.Create(step.Type)
	if err != nil {
		return fmt.Errorf("failed to create step %s: %w", step.Type, err)
	}

	// Execute the step
	if err := stepImpl.Execute(processedConfig, context); err != nil {
		e.logger.Error().
			Err(err).
			Str("step", step.ID).
			Str("type", step.Type).
			Msg("❌ Step execution failed")
		return err
	}

	e.logger.Info().
		Str("step", step.ID).
		Str("type", step.Type).
		Msg("✅ Step completed successfully")

	// Mark step as completed in state
	e.state.CompleteStep(workflowID, step.ID)

	return nil
}

// processConfigWithTemplate recursively processes config values with template substitution
func (e *Executor) processConfigWithTemplate(config map[string]interface{}, context map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{})
	for key, value := range config {
		result[key] = e.processValueWithTemplate(value, context)
	}
	return result
}

// processValueWithTemplate recursively processes a value with template substitution
func (e *Executor) processValueWithTemplate(value interface{}, context map[string]interface{}) interface{} {
	switch v := value.(type) {
	case string:
		return e.processTemplate(v, context)
	case map[string]interface{}:
		result := make(map[string]interface{})
		for key, val := range v {
			result[key] = e.processValueWithTemplate(val, context)
		}
		return result
	case []interface{}:
		result := make([]interface{}, len(v))
		for i, val := range v {
			result[i] = e.processValueWithTemplate(val, context)
		}
		return result
	default:
		return value
	}
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

// ExecuteWorkflow executes a workflow by ID with an external trigger (async)
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

	// Execute the workflow asynchronously
	go e.executeWorkflow(workflowID, instance, context)
	return nil
}

// ExecuteWorkflowSync executes a workflow by ID with an external trigger and waits for completion
func (e *Executor) ExecuteWorkflowSync(workflowID string, trigger TriggerEvent) error {
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

	// Execute the workflow synchronously (wait for completion)
	e.executeWorkflow(workflowID, instance, context)
	return nil
}