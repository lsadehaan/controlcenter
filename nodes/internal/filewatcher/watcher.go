package filewatcher

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/rs/zerolog"
)

// Rule represents a file watching rule
type Rule struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	Enabled           bool              `json:"enabled"`
	Description       string            `json:"description"`

	// Watch Mode Configuration
	WatchMode         string            `json:"watchMode"`         // "absolute" or "pattern" (default: "absolute" for backward compat)

	// Matching criteria
	// In pattern mode: DirRegEx is used to find directories under agent's ScanDir
	// In absolute mode: DirRegEx is the direct path to watch (backward compatible)
	DirRegEx          string            `json:"dirRegex"`          // Regex for directory path or pattern
	FileRegEx         string            `json:"fileRegex"`         // Regex for filename
	ContentRegEx      string            `json:"contentRegex"`      // Regex for file content
	
	// File operations
	Operations        FileOperations    `json:"operations"`
	
	// Time restrictions
	TimeRestrictions  TimeRestrictions  `json:"timeRestrictions"`
	
	// Processing options
	ProcessingOptions ProcessingOptions `json:"processingOptions"`
}

type FileOperations struct {
	// Copy operations
	CopyToDir         string `json:"copyToDir"`
	CopyFileOption    int    `json:"copyFileOption"`    // 21 = move, 22 = copy
	CopyTempExtension string `json:"copyTempExtension"`
	
	// Rename operations
	RenameFileTo      string `json:"renameFileTo"`
	InsertTimestamp   bool   `json:"insertTimestamp"`
	
	// Backup operations
	BackupToDir       string `json:"backupToDir"`
	BackupFileOption  int    `json:"backupFileOption"`
	
	// Post-processing
	RemoveAfterCopy   bool   `json:"removeAfterCopy"`
	RemoveAfterHours  int    `json:"removeAfterHours"`
	Overwrite         bool   `json:"overwrite"`
	
	// External programs
	ExecProgBefore    string `json:"execProgBefore"`
	ExecProg          string `json:"execProg"`
	ExecProgError     string `json:"execProgError"`
}

type TimeRestrictions struct {
	StartHour         int    `json:"startHour"`
	StartMinute       int    `json:"startMinute"`
	EndHour           int    `json:"endHour"`
	EndMinute         int    `json:"endMinute"`
	WeekDayInterval   int    `json:"weekDayInterval"`  // Bitmask for days
	ProcessAfterSecs  int    `json:"processAfterSecs"`
}

type ProcessingOptions struct {
	CheckFileInUse    bool   `json:"checkFileInUse"`
	MaxRetries        int    `json:"maxRetries"`
	DelayRetry        int    `json:"delayRetry"`        // Milliseconds
	DelayNextFile     int    `json:"delayNextFile"`     // Milliseconds
	ScanSubDir        bool   `json:"scanSubDir"`
}

// ProcessingFile tracks a file being processed
type ProcessingFile struct {
	path      string
	startTime time.Time
	endTime   time.Time
}

// fileJob represents a file processing job for the worker pool
type fileJob struct {
	filePath string
	rule     Rule
}

// Watcher manages file watching rules
type Watcher struct {
	mu               sync.Mutex
	rules            []Rule
	watchers         map[string]*fsnotify.Watcher
	logger           zerolog.Logger
	stopChan         chan struct{}
	stopped          bool
	workflowExecutor WorkflowExecutor
	scanDir          string  // Global root directory for pattern mode
	scanSubDir       bool    // Global recursive flag for pattern mode
	processingFiles  sync.Map // map[string]*ProcessingFile - thread-safe map of files being processed
	maxConcurrent    int          // Max concurrent file processing workers (default: 3)
	workChan         chan fileJob // Channel for worker pool jobs
	wg               sync.WaitGroup // WaitGroup for worker pool shutdown
}

// WorkflowExecutor interface for executing workflows
type WorkflowExecutor interface {
	ExecuteWorkflow(workflowName string, context map[string]interface{}) error
	ExecuteWorkflowSync(workflowName string, context map[string]interface{}) error
}

// NewWatcher creates a new file watcher
func NewWatcher(logger zerolog.Logger, executor WorkflowExecutor) *Watcher {
	w := &Watcher{
		rules:            []Rule{},
		watchers:         make(map[string]*fsnotify.Watcher),
		logger:           logger.With().Str("component", "filewatcher").Logger(),
		stopChan:         make(chan struct{}),
		stopped:          true, // Start in stopped state so first Start() works cleanly
		workflowExecutor: executor,
		maxConcurrent:    3, // Default: 3 concurrent file processing workers
	}

	return w
}

// SetMaxConcurrent sets the maximum number of concurrent file processing workers
func (w *Watcher) SetMaxConcurrent(n int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if n < 1 {
		n = 1
	}
	w.maxConcurrent = n
}

// SetGlobalSettings updates the global file watcher settings
func (w *Watcher) SetGlobalSettings(scanDir string, scanSubDir bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.scanDir = scanDir
	w.scanSubDir = scanSubDir
	w.logger.Info().
		Str("scanDir", scanDir).
		Bool("scanSubDir", scanSubDir).
		Msg("Updated global file watcher settings")
}

// LoadRules loads file watching rules
func (w *Watcher) LoadRules(rules []Rule) error {
	w.rules = rules
	w.logger.Info().Int("count", len(rules)).Msg("Loaded file watching rules")
	return nil
}

// UpdateRules updates the file watching rules and restarts watching
func (w *Watcher) UpdateRules(rules []Rule) {
	w.mu.Lock()
	w.rules = rules
	// Reset the stop channel if it was closed
	if w.stopped {
		w.stopChan = make(chan struct{})
		w.stopped = false
	}
	w.mu.Unlock()
	w.logger.Info().Int("count", len(rules)).Msg("Updated file watching rules")
}

// Start begins watching based on configured rules
func (w *Watcher) Start() error {
	w.mu.Lock()
	// Check if we're already running
	if !w.stopped {
		w.mu.Unlock()
		w.logger.Warn().Msg("File watcher is already running, stopping first")
		w.Stop()
		w.mu.Lock()
	}
	// Reset the stopped flag and create new stop channel
	w.stopped = false
	w.stopChan = make(chan struct{})

	// Create worker pool channel and start workers
	w.workChan = make(chan fileJob, w.maxConcurrent*2)
	for i := 0; i < w.maxConcurrent; i++ {
		w.wg.Add(1)
		go w.fileWorker(i)
	}

	// Start cleanup goroutine for processed files
	w.wg.Add(1)
	go w.cleanupProcessedFiles()

	w.mu.Unlock()

	for _, rule := range w.rules {
		if !rule.Enabled {
			w.logger.Debug().Str("rule", rule.Name).Msg("Skipping disabled rule")
			continue
		}

		if err := w.startWatchingRule(rule); err != nil {
			w.logger.Error().Err(err).Str("rule", rule.Name).Msg("Failed to start watching rule")
			continue
		}
	}

	return nil
}

// fileWorker processes file jobs from the work channel
func (w *Watcher) fileWorker(id int) {
	defer w.wg.Done()
	for {
		select {
		case job, ok := <-w.workChan:
			if !ok {
				return
			}
			w.processFile(job.filePath, job.rule)
		case <-w.stopChan:
			return
		}
	}
}

// Stop stops all file watchers
func (w *Watcher) Stop() {
	w.mu.Lock()

	if w.stopped {
		w.mu.Unlock()
		w.logger.Debug().Msg("File watchers already stopped")
		return
	}

	w.stopped = true
	close(w.stopChan)

	for _, watcher := range w.watchers {
		watcher.Close()
	}
	w.watchers = make(map[string]*fsnotify.Watcher)

	w.mu.Unlock()

	// Wait for all goroutines (workers, event handlers, cleanup) to finish
	w.wg.Wait()

	w.logger.Info().Msg("File watchers stopped")
}

func (w *Watcher) startWatchingRule(rule Rule) error {
	// Compile regex patterns
	var dirRegex, fileRegex *regexp.Regexp
	var err error

	// Default to absolute mode for backward compatibility
	if rule.WatchMode == "" {
		rule.WatchMode = "absolute"
	}

	if rule.FileRegEx != "" {
		fileRegex, err = regexp.Compile(rule.FileRegEx)
		if err != nil {
			return fmt.Errorf("invalid file regex: %w", err)
		}
	}

	var dirsToWatch []string

	switch rule.WatchMode {
	case "pattern":
		// Pattern mode: scan agent's ScanDir for directories matching DirRegEx
		if w.scanDir == "" {
			w.logger.Error().Str("rule", rule.Name).Msg("Pattern mode requires agent ScanDir to be set")
			return fmt.Errorf("pattern mode requires agent ScanDir to be configured")
		}

		if rule.DirRegEx != "" {
			dirRegex, err = regexp.Compile(rule.DirRegEx)
			if err != nil {
				return fmt.Errorf("invalid directory regex: %w", err)
			}
		}

		// Find directories under agent's ScanDir that match DirRegEx
		dirsToWatch = w.findMatchingDirectories(w.scanDir, dirRegex)

	case "absolute":
		fallthrough
	default:
		// Absolute mode (backward compatible): use DirRegEx as direct path
		dirsToWatch = w.findDirectoriesToWatch(rule.DirRegEx)
		// In absolute mode, we still compile dirRegex for path validation in handleEvents
		if rule.DirRegEx != "" {
			// Normalize the path for regex matching:
			// If it looks like a literal path (not a regex), make trailing slash optional
			normalizedRegex := rule.DirRegEx
			if !strings.Contains(normalizedRegex, "(") && !strings.Contains(normalizedRegex, "[") {
				// This looks like a literal path, not a regex pattern
				// Remove trailing slash if present and make it optional
				normalizedRegex = strings.TrimSuffix(normalizedRegex, "/")
				normalizedRegex = strings.TrimSuffix(normalizedRegex, "\\")
				// Escape special regex characters for literal matching
				normalizedRegex = regexp.QuoteMeta(normalizedRegex)
				// Make trailing slash optional
				normalizedRegex = normalizedRegex + "/?$"
			}
			// Try to compile as regex
			dirRegex, err = regexp.Compile(normalizedRegex)
			if err != nil {
				w.logger.Warn().
					Err(err).
					Str("rule", rule.Name).
					Str("dirRegex", rule.DirRegEx).
					Str("normalizedRegex", normalizedRegex).
					Msg("Failed to compile directory regex, skipping directory validation")
				dirRegex = nil
			}
		}
	}

	if len(dirsToWatch) == 0 {
		w.logger.Warn().
			Str("rule", rule.Name).
			Str("mode", rule.WatchMode).
			Str("dirRegEx", rule.DirRegEx).
			Str("scanDir", w.scanDir).
			Msg("No directories found to watch - check permissions and pattern")
		return nil
	}

	w.logger.Info().
		Str("rule", rule.Name).
		Int("dirsFound", len(dirsToWatch)).
		Strs("directories", dirsToWatch).
		Msg("Found directories to watch")

	for _, dir := range dirsToWatch {
		// Check if we already have a watcher for this directory+rule combo
		watcherKey := rule.ID + ":" + dir
		w.mu.Lock()
		if _, exists := w.watchers[watcherKey]; exists {
			w.mu.Unlock()
			w.logger.Debug().Str("dir", dir).Msg("Watcher already exists for directory, skipping")
			continue
		}
		w.mu.Unlock()

		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			return fmt.Errorf("failed to create watcher: %w", err)
		}

		// Add the directory to watch
		err = watcher.Add(dir)
		if err != nil {
			watcher.Close()
			return fmt.Errorf("failed to watch directory %s: %w", dir, err)
		}

		// If agent's ScanSubDir is true in pattern mode, add all subdirectories recursively
		if rule.WatchMode == "pattern" && w.scanSubDir {
			err = w.addSubdirsRecursive(watcher, dir)
			if err != nil {
				w.logger.Warn().Err(err).Str("dir", dir).Msg("Failed to add some subdirectories")
			}
		}

		w.watchers[watcherKey] = watcher

		// Start goroutine to handle events for this watcher
		w.wg.Add(1)
		go func() {
			defer w.wg.Done()
			w.handleEvents(watcher, rule, dirRegex, fileRegex)
		}()

		w.logger.Info().
			Str("rule", rule.Name).
			Str("mode", rule.WatchMode).
			Str("dir", dir).
			Str("dirRegex", rule.DirRegEx).
			Str("fileRegex", rule.FileRegEx).
			Bool("recursive", w.scanSubDir).
			Msg("Started watching directory")
	}

	return nil
}

func (w *Watcher) handleEvents(watcher *fsnotify.Watcher, rule Rule, dirRegex, fileRegex *regexp.Regexp) {
	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}

			// Log ALL file events at INFO level for troubleshooting
			w.logger.Info().
				Str("file", event.Name).
				Str("event", event.Op.String()).
				Str("rule", rule.Name).
				Msg("📂 File event detected")

			// Check if file matches criteria
			if !w.matchesFile(event.Name, rule, dirRegex, fileRegex) {
				w.logger.Info().
					Str("file", event.Name).
					Str("rule", rule.Name).
					Str("fileRegex", rule.FileRegEx).
					Str("dirRegex", rule.DirRegEx).
					Msg("❌ File did not match criteria")
				continue
			}

			w.logger.Info().
				Str("file", event.Name).
				Str("rule", rule.Name).
				Msg("✅ File matched criteria")

			// Check time restrictions
			if !w.checkTimeRestrictions(rule.TimeRestrictions) {
				w.logger.Info().
					Str("file", event.Name).
					Msg("⏰ File matched but outside time window")
				continue
			}

			// Process file
			if event.Op&fsnotify.Create == fsnotify.Create || event.Op&fsnotify.Write == fsnotify.Write {
				// Check if file is already being processed or was recently processed
				if w.isFileBeingProcessed(event.Name) {
					w.logger.Info().
						Str("file", event.Name).
						Str("rule", rule.Name).
						Msg("⏸️ File is being processed or in cooldown period, skipping")
					continue
				}

				w.logger.Info().
					Str("rule", rule.Name).
					Str("file", event.Name).
					Str("event", event.Op.String()).
					Str("dirRegex", rule.DirRegEx).
					Str("fileRegex", rule.FileRegEx).
					Msg("✅ File matched all criteria! Starting processing")

				// Wait if configured
				if rule.TimeRestrictions.ProcessAfterSecs > 0 {
					w.logger.Info().
						Str("file", event.Name).
						Int("delaySecs", rule.TimeRestrictions.ProcessAfterSecs).
						Msg("⏳ Waiting before processing file")
					time.Sleep(time.Duration(rule.TimeRestrictions.ProcessAfterSecs) * time.Second)
				}

				// Mark file as being processed
				w.markFileProcessing(event.Name)

				// Send to worker pool for processing
				select {
				case w.workChan <- fileJob{filePath: event.Name, rule: rule}:
				case <-w.stopChan:
					return
				}
			}
			
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			w.logger.Error().Err(err).Str("rule", rule.Name).Msg("Watcher error")
			
		case <-w.stopChan:
			return
		}
	}
}

func (w *Watcher) processFile(filePath string, rule Rule) {
	// Ensure we mark the file as done processing when this function exits
	defer w.markFileProcessed(filePath)

	// Wait for file to become stable/unlocked in worker context to avoid
	// blocking the fsnotify event loop.
	if rule.ProcessingOptions.CheckFileInUse {
		maxRetries := rule.ProcessingOptions.MaxRetries
		if maxRetries <= 0 {
			maxRetries = 5
		}
		retryDelay := time.Duration(rule.ProcessingOptions.DelayRetry) * time.Millisecond
		if retryDelay <= 0 {
			retryDelay = 1000 * time.Millisecond
		}

		if !w.waitForFileReady(filePath, maxRetries, retryDelay) {
			w.logger.Warn().
				Str("file", filePath).
				Int("retries", maxRetries).
				Msg("🔒 File still in use/unstable after retries, skipping")
			return
		}
	}

	w.logger.Info().
		Str("file", filePath).
		Str("rule", rule.Name).
		Msg("🚀 Starting file processing")

	ops := rule.Operations

	// Execute pre-processing program
	if ops.ExecProgBefore != "" {
		w.logger.Info().
			Str("file", filePath).
			Str("program", ops.ExecProgBefore).
			Msg("⚙️ Executing pre-processing program")
		w.executeProgram(ops.ExecProgBefore, filePath)
	}

	// Prepare destination path
	destPath := filePath
	if ops.CopyToDir != "" {
		fileName := filepath.Base(filePath)

		// Apply rename if configured
		if ops.RenameFileTo != "" {
			oldName := fileName
			fileName = w.applyRename(fileName, ops.RenameFileTo, ops.InsertTimestamp)
			w.logger.Info().
				Str("oldName", oldName).
				Str("newName", fileName).
				Msg("📝 Applying rename")
		}

		destPath = filepath.Join(ops.CopyToDir, fileName)
		w.logger.Info().
			Str("destPath", destPath).
			Msg("📍 Prepared destination path")
	}
	
	// Backup file if configured
	if ops.BackupToDir != "" {
		backupPath := filepath.Join(ops.BackupToDir, filepath.Base(filePath))
		w.logger.Info().
			Str("file", filePath).
			Str("backupPath", backupPath).
			Msg("💾 Creating backup")
		if err := w.copyFile(filePath, backupPath); err != nil {
			w.logger.Error().Err(err).Str("file", filePath).Msg("❌ Failed to backup file")
		} else {
			w.logger.Info().Str("file", filePath).Str("backup", backupPath).Msg("✅ File backed up successfully")
		}
	}

	// Copy or move file
	if ops.CopyToDir != "" {
		var err error

		// Check if destination exists and overwrite setting
		if !ops.Overwrite && w.fileExists(destPath) {
			w.logger.Info().
				Str("file", filePath).
				Str("dest", destPath).
				Msg("⚠️ Destination exists and overwrite is disabled, skipping")
			return
		}

		// Use temp extension if configured
		tempPath := destPath
		if ops.CopyTempExtension != "" {
			tempPath = destPath + ops.CopyTempExtension
			w.logger.Info().
				Str("tempPath", tempPath).
				Msg("📝 Using temporary extension during copy")
		}

		if ops.CopyFileOption == 21 { // Move
			w.logger.Info().
				Str("source", filePath).
				Str("dest", tempPath).
				Msg("📦 Moving file")
			err = os.Rename(filePath, tempPath)
		} else { // Copy
			w.logger.Info().
				Str("source", filePath).
				Str("dest", tempPath).
				Msg("📋 Copying file")
			err = w.copyFile(filePath, tempPath)
		}

		if err != nil {
			w.logger.Error().
				Err(err).
				Str("file", filePath).
				Str("dest", tempPath).
				Msg("❌ Failed to process file")
			if ops.ExecProgError != "" {
				w.logger.Info().
					Str("program", ops.ExecProgError).
					Msg("⚙️ Executing error handler program")
				w.executeProgram(ops.ExecProgError, filePath)
			}
			return
		}

		// Rename temp file to final name
		if ops.CopyTempExtension != "" {
			w.logger.Info().
				Str("tempPath", tempPath).
				Str("finalPath", destPath).
				Msg("📝 Renaming temporary file to final name")
			os.Rename(tempPath, destPath)
		}

		// Remove source if configured (and not already moved)
		if ops.RemoveAfterCopy && ops.CopyFileOption != 21 {
			w.logger.Info().
				Str("file", filePath).
				Msg("🗑️ Removing source file after copy")
			os.Remove(filePath)
		}

		w.logger.Info().
			Str("source", filePath).
			Str("dest", destPath).
			Msg("✅ File processed successfully")
	}

	// Execute post-processing program
	if ops.ExecProg != "" {
		w.logger.Info().
			Str("file", destPath).
			Str("program", ops.ExecProg).
			Msg("⚙️ Executing post-processing program")
		w.executeProgram(ops.ExecProg, destPath)
	}
	
	// Delay before next file if configured
	if rule.ProcessingOptions.DelayNextFile > 0 {
		time.Sleep(time.Duration(rule.ProcessingOptions.DelayNextFile) * time.Millisecond)
	}
}

func (w *Watcher) matchesFile(filePath string, rule Rule, dirRegex, fileRegex *regexp.Regexp) bool {
	dir := filepath.Dir(filePath)
	fileName := filepath.Base(filePath)

	// Check directory regex
	if dirRegex != nil {
		matched := dirRegex.MatchString(dir)
		w.logger.Debug().
			Str("dir", dir).
			Str("dirRegex", dirRegex.String()).
			Bool("matched", matched).
			Msg("Directory regex check")
		if !matched {
			return false
		}
	}

	// Check file regex
	if fileRegex != nil {
		matched := fileRegex.MatchString(fileName)
		w.logger.Debug().
			Str("fileName", fileName).
			Str("fileRegex", fileRegex.String()).
			Bool("matched", matched).
			Msg("File regex check")
		if !matched {
			return false
		}
	}
	
	// Check content regex if configured
	if rule.ContentRegEx != "" {
		content, err := os.ReadFile(filePath)
		if err != nil {
			return false
		}
		
		contentRegex, err := regexp.Compile(rule.ContentRegEx)
		if err != nil {
			return false
		}
		
		if !contentRegex.Match(content) {
			return false
		}
	}
	
	return true
}

func (w *Watcher) checkTimeRestrictions(restrictions TimeRestrictions) bool {
	// Zero values mean "no restrictions" — allow all times
	if restrictions.StartHour == 0 && restrictions.StartMinute == 0 &&
		restrictions.EndHour == 0 && restrictions.EndMinute == 0 &&
		restrictions.WeekDayInterval == 0 {
		return true
	}

	now := time.Now()

	// Check day of week
	if restrictions.WeekDayInterval > 0 {
		dayMask := 1 << uint(now.Weekday())
		if restrictions.WeekDayInterval&dayMask == 0 {
			return false
		}
	}

	// Check time of day
	currentMinutes := now.Hour()*60 + now.Minute()
	startMinutes := restrictions.StartHour*60 + restrictions.StartMinute
	endMinutes := restrictions.EndHour*60 + restrictions.EndMinute

	if currentMinutes < startMinutes || currentMinutes > endMinutes {
		return false
	}

	return true
}

func (w *Watcher) waitForFileReady(filePath string, maxRetries int, retryDelay time.Duration) bool {
	if retryDelay <= 0 {
		retryDelay = 1000 * time.Millisecond
	}

	// Probe window for stability checks (size/mtime should stop changing).
	stabilityWindow := 500 * time.Millisecond

	for attempt := 0; attempt < maxRetries; attempt++ {
		if !w.isFileInUse(filePath, stabilityWindow) {
			w.logger.Info().
				Str("file", filePath).
				Int("attempt", attempt+1).
				Msg("✅ File is stable and ready")
			return true
		}

		w.logger.Info().
			Str("file", filePath).
			Int("attempt", attempt+1).
			Int("maxRetries", maxRetries).
			Msg("🔒 File is still in use/unstable, waiting to retry...")

		select {
		case <-time.After(retryDelay):
		case <-w.stopChan:
			return false
		}
	}

	return false
}

func (w *Watcher) isFileInUse(filePath string, stabilityWindow time.Duration) bool {
	// Missing file is treated as "in use/not ready" for this cycle.
	info1, err := os.Stat(filePath)
	if err != nil {
		return true
	}

	// Lock probe:
	// - Try read/write open first (detects many active write locks)
	// - If permission denied, fallback to read-only open so permission alone
	//   doesn't look like a write lock.
	if f, err := os.OpenFile(filePath, os.O_RDWR, 0); err == nil {
		f.Close()
	} else if os.IsPermission(err) {
		rf, rerr := os.Open(filePath)
		if rerr != nil {
			return true
		}
		rf.Close()
	} else {
		return true
	}

	if stabilityWindow <= 0 {
		stabilityWindow = 500 * time.Millisecond
	}
	select {
	case <-time.After(stabilityWindow):
	case <-w.stopChan:
		return true
	}

	info2, err := os.Stat(filePath)
	if err != nil {
		return true
	}

	// If metadata keeps changing, writer is likely still active.
	return info1.Size() != info2.Size() || info1.ModTime() != info2.ModTime()
}

func (w *Watcher) copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()
	
	// Create destination directory if it doesn't exist
	destDir := filepath.Dir(dst)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return err
	}
	
	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()
	
	_, err = io.Copy(destFile, sourceFile)
	return err
}

func (w *Watcher) fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func (w *Watcher) applyRename(fileName, renameTo string, insertTimestamp bool) string {
	result := renameTo
	
	// Replace variables
	result = strings.ReplaceAll(result, "{filename}", fileName)
	result = strings.ReplaceAll(result, "{name}", strings.TrimSuffix(fileName, filepath.Ext(fileName)))
	result = strings.ReplaceAll(result, "{ext}", filepath.Ext(fileName))
	
	// Insert timestamp if configured
	if insertTimestamp {
		timestamp := time.Now().Format("20060102_150405")
		result = strings.ReplaceAll(result, "{timestamp}", timestamp)
		
		// If no placeholder, append timestamp
		if !strings.Contains(renameTo, "{timestamp}") {
			ext := filepath.Ext(result)
			name := strings.TrimSuffix(result, ext)
			result = fmt.Sprintf("%s_%s%s", name, timestamp, ext)
		}
	}
	
	return result
}

func (w *Watcher) executeProgram(program, filePath string) {
	// Replace {file} placeholder with actual file path
	program = strings.ReplaceAll(program, "{file}", filePath)
	
	// Check if this is a workflow execution request
	if strings.HasPrefix(program, "WF:") {
		workflowName := strings.TrimPrefix(program, "WF:")
		w.logger.Info().Str("workflow", workflowName).Str("file", filePath).Msg("Executing workflow (synchronous - will wait for completion)")

		if w.workflowExecutor != nil {
			context := map[string]interface{}{
				"trigger":   "filewatcher",
				"file":      filePath,
				"fileName":  filepath.Base(filePath),
				"directory": filepath.Dir(filePath),
			}

			// Use synchronous execution to wait for workflow completion
			// This prevents file operations from happening while workflow is still running
			if err := w.workflowExecutor.ExecuteWorkflowSync(workflowName, context); err != nil {
				w.logger.Error().Err(err).Str("workflow", workflowName).Msg("❌ Failed to execute workflow")
			} else {
				w.logger.Info().Str("workflow", workflowName).Msg("✅ Workflow completed successfully")
			}
		} else {
			w.logger.Warn().Msg("Workflow executor not available")
		}
		return
	}
	
	// Execute external program
	w.logger.Info().Str("program", program).Str("file", filePath).Msg("Executing external program")

	// Use shell to execute the command for proper handling of pipes, redirects, etc.
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd", "/C", program)
	} else {
		// On Unix, use sh -c to execute the command
		cmd = exec.Command("sh", "-c", program)
	}
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("FILE=%s", filePath),
		fmt.Sprintf("FILE_PATH=%s", filePath),  // Keep for backward compatibility
		fmt.Sprintf("FILE_NAME=%s", filepath.Base(filePath)),
		fmt.Sprintf("FILE_DIR=%s", filepath.Dir(filePath)))
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		w.logger.Error().
			Err(err).
			Str("program", program).
			Str("output", string(output)).
			Msg("Program execution failed")
	} else {
		w.logger.Info().
			Str("program", program).
			Str("output", string(output)).
			Msg("Program executed successfully")
	}
}

func (w *Watcher) findDirectoriesToWatch(dirRegEx string) []string {
	if dirRegEx == "" {
		return []string{}
	}
	
	var dirs []string
	
	// First, try to interpret as a literal Windows path
	// Remove any regex flags and anchors
	testPath := dirRegEx
	testPath = strings.TrimPrefix(testPath, "(?i)")
	testPath = strings.TrimPrefix(testPath, "^")
	testPath = strings.TrimSuffix(testPath, "$")
	
	// Check if this looks like a Windows path (contains backslashes)
	if strings.Contains(testPath, "\\") {
		// This appears to be a Windows path, not a regex
		// Unescape any double backslashes
		testPath = strings.ReplaceAll(testPath, "\\\\", "\\")
		
		// Check if directory exists
		if info, err := os.Stat(testPath); err == nil && info.IsDir() {
			w.logger.Debug().Str("dir", testPath).Msg("Using direct directory path")
			return []string{testPath}
		} else {
			// Directory doesn't exist, but it's clearly meant to be a path, not a regex
			w.logger.Warn().
				Str("path", testPath).
				Msg("Directory does not exist, skipping")
			return []string{}
		}
	}
	
	// Check if this looks like a direct path (not a regex pattern)
	// If it doesn't contain regex special characters, treat as literal
	if !strings.Contains(dirRegEx, "*") && !strings.Contains(dirRegEx, "?") && 
	   !strings.Contains(dirRegEx, "[") && !strings.Contains(dirRegEx, "(") {
		
		// Try as direct path
		if info, err := os.Stat(testPath); err == nil && info.IsDir() {
			w.logger.Debug().Str("dir", testPath).Msg("Using direct directory path")
			return []string{testPath}
		}
	}
	
	// If it's a regex pattern, compile it
	regex, err := regexp.Compile(dirRegEx)
	if err != nil {
		w.logger.Error().Err(err).Str("regex", dirRegEx).Msg("Invalid directory regex")
		return []string{}
	}
	
	// Define root paths to scan (configurable in future)
	// For Windows, scan all drive letters; for Unix, start from root
	var rootPaths []string
	if runtime.GOOS == "windows" {
		// Scan common drives
		for _, drive := range []string{"C:", "D:", "E:", "F:"} {
			if _, err := os.Stat(drive + "\\"); err == nil {
				rootPaths = append(rootPaths, drive+"\\")
			}
		}
	} else {
		rootPaths = []string{"/"}
	}
	
	// Scan for matching directories (with depth limit for performance)
	maxDepth := 5 // Configurable depth limit
	for _, root := range rootPaths {
		w.scanForDirectories(root, regex, &dirs, 0, maxDepth)
	}
	
	w.logger.Info().
		Str("regex", dirRegEx).
		Int("found", len(dirs)).
		Msg("Found directories matching pattern")
	
	return dirs
}

func (w *Watcher) scanForDirectories(path string, regex *regexp.Regexp, dirs *[]string, depth, maxDepth int) {
	if depth > maxDepth {
		return
	}
	
	// Check if this directory matches
	if regex.MatchString(path) {
		*dirs = append(*dirs, path)
	}
	
	// Read directory contents
	entries, err := os.ReadDir(path)
	if err != nil {
		// Skip directories we can't read
		return
	}
	
	for _, entry := range entries {
		if entry.IsDir() {
			subPath := filepath.Join(path, entry.Name())
			// Skip system directories to avoid permission issues
			if strings.Contains(subPath, "$Recycle.Bin") || 
			   strings.Contains(subPath, "System Volume Information") ||
			   strings.Contains(subPath, "Windows\\WinSxS") {
				continue
			}
			w.scanForDirectories(subPath, regex, dirs, depth+1, maxDepth)
		}
	}
}

// findMatchingDirectories finds directories under rootPath that match the given regex
func (w *Watcher) findMatchingDirectories(rootPath string, regex *regexp.Regexp) []string {
	if regex == nil {
		// If no regex specified, return the root path itself
		w.logger.Info().Str("rootPath", rootPath).Msg("No regex specified, watching root path only")
		return []string{rootPath}
	}

	w.logger.Info().
		Str("rootPath", rootPath).
		Str("regex", regex.String()).
		Msg("Scanning for directories matching pattern")

	var matchedDirs []string
	maxDepth := 10 // Reasonable depth limit to prevent excessive scanning

	// Walk the directory tree starting from rootPath
	err := w.walkDirectory(rootPath, func(path string, info os.FileInfo) error {
		if !info.IsDir() {
			return nil
		}

		// Skip the root path itself in matching
		if path == rootPath {
			return nil
		}

		// Get relative path from root for matching
		relPath, err := filepath.Rel(rootPath, path)
		if err != nil {
			return nil
		}

		// Also try matching just the directory name
		dirName := filepath.Base(path)

		// Convert to forward slashes for consistent matching
		relPath = filepath.ToSlash(relPath)

		w.logger.Debug().
			Str("path", path).
			Str("relPath", relPath).
			Str("dirName", dirName).
			Str("regex", regex.String()).
			Msg("Checking directory against pattern")

		// Check if this relative path or directory name matches the regex
		if regex.MatchString(relPath) ||
		   regex.MatchString(dirName) ||
		   regex.MatchString("/" + relPath) ||
		   regex.MatchString("\\\\" + strings.ReplaceAll(relPath, "/", "\\\\")) {
			matchedDirs = append(matchedDirs, path)
			w.logger.Info().
				Str("path", path).
				Str("relPath", relPath).
				Str("dirName", dirName).
				Msg("Directory MATCHED pattern")
		}

		return nil
	}, maxDepth)

	if err != nil {
		w.logger.Warn().Err(err).Str("rootPath", rootPath).Msg("Error scanning directories")
	}

	w.logger.Info().
		Str("rootPath", rootPath).
		Int("matchedCount", len(matchedDirs)).
		Msg("Found matching directories")

	return matchedDirs
}

// walkDirectory walks a directory tree up to maxDepth
func (w *Watcher) walkDirectory(root string, fn func(string, os.FileInfo) error, maxDepth int) error {
	return w.walkDirectoryRecursive(root, fn, 0, maxDepth)
}

func (w *Watcher) walkDirectoryRecursive(path string, fn func(string, os.FileInfo) error, currentDepth, maxDepth int) error {
	if currentDepth > maxDepth {
		return nil
	}

	info, err := os.Stat(path)
	if err != nil {
		// Log permission errors but continue scanning
		w.logger.Warn().Err(err).Str("path", path).Msg("Cannot access path, skipping")
		return nil  // Don't propagate error, just skip this path
	}

	// Call the function for this path
	if err := fn(path, info); err != nil {
		return err
	}

	if !info.IsDir() {
		return nil
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		// Log but continue - don't stop the entire scan
		w.logger.Warn().Err(err).Str("path", path).Msg("Cannot read directory contents, skipping")
		return nil
	}

	for _, entry := range entries {
		subPath := filepath.Join(path, entry.Name())

		// Skip system directories
		if strings.Contains(subPath, "$Recycle.Bin") ||
		   strings.Contains(subPath, "System Volume Information") ||
		   strings.Contains(subPath, "Windows\\WinSxS") ||
		   strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		if entry.IsDir() {
			// Continue even if subdirectory fails
			w.walkDirectoryRecursive(subPath, fn, currentDepth+1, maxDepth)
		}
	}

	return nil
}

// addSubdirsRecursive adds all subdirectories of a path to the watcher
func (w *Watcher) addSubdirsRecursive(watcher *fsnotify.Watcher, root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip paths with errors
		}

		if info.IsDir() && path != root {
			if err := watcher.Add(path); err != nil {
				w.logger.Warn().
					Err(err).
					Str("path", path).
					Msg("Failed to add subdirectory to watcher")
			} else {
				w.logger.Debug().
					Str("path", path).
					Msg("Added subdirectory to watcher")
			}
		}
		return nil
	})
}

// isFileBeingProcessed checks if a file is currently being processed or in cooldown
func (w *Watcher) isFileBeingProcessed(filePath string) bool {
	if val, exists := w.processingFiles.Load(filePath); exists {
		pf := val.(*ProcessingFile)
		// If still processing (endTime is zero) or in cooldown period
		if pf.endTime.IsZero() || time.Since(pf.endTime) < 30*time.Second {
			return true
		}
	}
	return false
}

// markFileProcessing marks a file as currently being processed
func (w *Watcher) markFileProcessing(filePath string) {
	w.processingFiles.Store(filePath, &ProcessingFile{
		path:      filePath,
		startTime: time.Now(),
	})
	w.logger.Debug().Str("file", filePath).Msg("Marked file as processing")
}

// markFileProcessed marks a file as done processing
func (w *Watcher) markFileProcessed(filePath string) {
	if val, exists := w.processingFiles.Load(filePath); exists {
		pf := val.(*ProcessingFile)
		pf.endTime = time.Now()
		w.processingFiles.Store(filePath, pf)
		w.logger.Debug().
			Str("file", filePath).
			Dur("duration", pf.endTime.Sub(pf.startTime)).
			Msg("Marked file as processed")
	}
}

// cleanupProcessedFiles periodically removes old processed files from the map
func (w *Watcher) cleanupProcessedFiles() {
	defer w.wg.Done()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			count := 0
			w.processingFiles.Range(func(key, value interface{}) bool {
				pf := value.(*ProcessingFile)
				// Remove files that have been processed and are past the cooldown period
				if !pf.endTime.IsZero() && time.Since(pf.endTime) > 30*time.Second {
					w.processingFiles.Delete(key)
					count++
				}
				return true
			})
			if count > 0 {
				w.logger.Debug().Int("count", count).Msg("Cleaned up processed files from tracking")
			}
		case <-w.stopChan:
			return
		}
	}
}
