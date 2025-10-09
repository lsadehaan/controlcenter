package filebrowser

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/your-org/controlcenter/nodes/internal/config"
	"github.com/rs/zerolog"
)

// FileBrowser handles file browsing operations
type FileBrowser struct {
	config *config.Config
	logger zerolog.Logger
}

// FileInfo represents a file or directory
type FileInfo struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	IsDir   bool      `json:"isDir"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

// BrowseResponse represents the response from a browse request
type BrowseResponse struct {
	Path    string     `json:"path"`
	Files   []FileInfo `json:"files"`
	Parent  string     `json:"parent,omitempty"`
	Error   string     `json:"error,omitempty"`
	Enabled bool       `json:"enabled"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Enabled bool   `json:"enabled"`
}

// New creates a new FileBrowser instance
func New(cfg *config.Config, logger zerolog.Logger) *FileBrowser {
	return &FileBrowser{
		config: cfg,
		logger: logger.With().Str("component", "filebrowser").Logger(),
	}
}

// RegisterHandlers registers all file browser HTTP handlers
func (fb *FileBrowser) RegisterHandlers() {
	http.HandleFunc("/api/files/browse", fb.handleBrowse)
	http.HandleFunc("/api/files/download", fb.handleDownload)
	http.HandleFunc("/api/files/upload", fb.handleUpload)
	http.HandleFunc("/api/files/mkdir", fb.handleMkdir)
	http.HandleFunc("/api/files/delete", fb.handleDelete)
}

// isEnabled checks if file browser is enabled
func (fb *FileBrowser) isEnabled() bool {
	settings := fb.config.GetFileBrowserSettings()
	return settings.Enabled
}

// getSettings returns a copy of the file browser settings
func (fb *FileBrowser) getSettings() config.FileBrowserSettings {
	return fb.config.GetFileBrowserSettings()
}

// validatePath validates that a path is allowed and safe
func (fb *FileBrowser) validatePath(requestedPath string) (string, error) {
	if !fb.isEnabled() {
		return "", fmt.Errorf("file browser is disabled")
	}

	settings := fb.getSettings()

	// Clean the path to remove any .. or other funny business
	cleanPath := filepath.Clean(requestedPath)

	// Convert to absolute path
	absPath, err := filepath.Abs(cleanPath)
	if err != nil {
		return "", fmt.Errorf("invalid path: %w", err)
	}

	// Check for path traversal attempts
	if strings.Contains(absPath, "..") {
		return "", fmt.Errorf("path traversal attempt detected")
	}

	// If no allowed paths configured, only allow agent data directory
	allowedPaths := settings.AllowedPaths
	if len(allowedPaths) == 0 {
		// Default to agent data directory
		home, _ := os.UserHomeDir()
		dataDir := filepath.Join(home, ".controlcenter-agent")
		allowedPaths = []string{dataDir}
	}

	// Expand ~ in allowed paths
	expandedAllowed := make([]string, 0, len(allowedPaths))
	for _, allowed := range allowedPaths {
		if strings.HasPrefix(allowed, "~") {
			home, _ := os.UserHomeDir()
			allowed = filepath.Join(home, allowed[1:])
		}
		expandedAllowed = append(expandedAllowed, filepath.Clean(allowed))
	}

	// Check if the path is within allowed paths
	allowed := false
	for _, allowedPath := range expandedAllowed {
		absAllowed, err := filepath.Abs(allowedPath)
		if err != nil {
			continue
		}

		// Check if absPath is within or equal to absAllowed
		rel, err := filepath.Rel(absAllowed, absPath)
		if err == nil && !strings.HasPrefix(rel, "..") {
			allowed = true
			break
		}
	}

	if !allowed {
		return "", fmt.Errorf("access denied: path not in allowed list")
	}

	return absPath, nil
}

// handleBrowse handles directory browsing requests
// GET /api/files/browse?path=/some/path
func (fb *FileBrowser) handleBrowse(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "method not allowed", Enabled: fb.isEnabled()})
		return
	}

	if !fb.isEnabled() {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "file browser is disabled", Enabled: false})
		return
	}

	requestedPath := r.URL.Query().Get("path")
	if requestedPath == "" {
		// Default to agent data directory
		home, _ := os.UserHomeDir()
		requestedPath = filepath.Join(home, ".controlcenter-agent")
	}

	validPath, err := fb.validatePath(requestedPath)
	if err != nil {
		fb.logger.Warn().Err(err).Str("path", requestedPath).Msg("Path validation failed")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(ErrorResponse{Error: err.Error(), Enabled: true})
		return
	}

	// Check if path exists
	info, err := os.Stat(validPath)
	if err != nil {
		fb.logger.Warn().Err(err).Str("path", validPath).Msg("Failed to stat path")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "path not found", Enabled: true})
		return
	}

	// If it's a file, return error (should browse directory)
	if !info.IsDir() {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "path is not a directory", Enabled: true})
		return
	}

	// Read directory contents
	entries, err := os.ReadDir(validPath)
	if err != nil {
		fb.logger.Error().Err(err).Str("path", validPath).Msg("Failed to read directory")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "failed to read directory", Enabled: true})
		return
	}

	// Apply max items limit
	settings := fb.getSettings()
	maxItems := settings.MaxListItems
	if maxItems == 0 {
		maxItems = 1000 // Default
	}

	files := make([]FileInfo, 0, len(entries))
	for i, entry := range entries {
		if i >= maxItems {
			break
		}

		entryInfo, err := entry.Info()
		if err != nil {
			continue
		}

		files = append(files, FileInfo{
			Name:    entry.Name(),
			Path:    filepath.Join(validPath, entry.Name()),
			IsDir:   entry.IsDir(),
			Size:    entryInfo.Size(),
			ModTime: entryInfo.ModTime(),
		})
	}

	// Get parent directory
	parent := filepath.Dir(validPath)
	if parent == validPath {
		parent = "" // Root directory
	} else {
		// Validate parent is also allowed
		_, err := fb.validatePath(parent)
		if err != nil {
			parent = "" // Parent not allowed
		}
	}

	response := BrowseResponse{
		Path:    validPath,
		Files:   files,
		Parent:  parent,
		Enabled: true,
	}

	fb.logger.Info().Str("path", validPath).Int("fileCount", len(files)).Msg("Browse request")
	json.NewEncoder(w).Encode(response)
}

// handleDownload handles file download requests
// GET /api/files/download?path=/some/file.txt
func (fb *FileBrowser) handleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		w.Write([]byte("method not allowed"))
		return
	}

	if !fb.isEnabled() {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("file browser is disabled"))
		return
	}

	requestedPath := r.URL.Query().Get("path")
	if requestedPath == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("path parameter required"))
		return
	}

	validPath, err := fb.validatePath(requestedPath)
	if err != nil {
		fb.logger.Warn().Err(err).Str("path", requestedPath).Msg("Path validation failed")
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(err.Error()))
		return
	}

	// Check if file exists and is not a directory
	info, err := os.Stat(validPath)
	if err != nil {
		fb.logger.Warn().Err(err).Str("path", validPath).Msg("File not found")
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("file not found"))
		return
	}

	if info.IsDir() {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("cannot download directory"))
		return
	}

	// Open file
	file, err := os.Open(validPath)
	if err != nil {
		fb.logger.Error().Err(err).Str("path", validPath).Msg("Failed to open file")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("failed to open file"))
		return
	}
	defer file.Close()

	// Set headers for download
	filename := filepath.Base(validPath)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))

	// Stream file to response
	fb.logger.Info().Str("path", validPath).Int64("size", info.Size()).Msg("Download request")
	io.Copy(w, file)
}

// handleUpload handles file upload requests
// POST /api/files/upload?path=/some/directory
func (fb *FileBrowser) handleUpload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "method not allowed", Enabled: fb.isEnabled()})
		return
	}

	if !fb.isEnabled() {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "file browser is disabled", Enabled: false})
		return
	}

	settings := fb.getSettings()
	maxUploadSize := settings.MaxUploadSize
	if maxUploadSize == 0 {
		maxUploadSize = 100 * 1024 * 1024 // 100 MB default
	}

	// Limit request body size
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

	// Parse multipart form
	err := r.ParseMultipartForm(maxUploadSize)
	if err != nil {
		fb.logger.Warn().Err(err).Msg("Failed to parse multipart form")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "failed to parse upload: " + err.Error(), Enabled: true})
		return
	}

	// Get target directory
	targetDir := r.FormValue("path")
	if targetDir == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "path parameter required", Enabled: true})
		return
	}

	validDir, err := fb.validatePath(targetDir)
	if err != nil {
		fb.logger.Warn().Err(err).Str("path", targetDir).Msg("Path validation failed")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(ErrorResponse{Error: err.Error(), Enabled: true})
		return
	}

	// Check if target is a directory
	info, err := os.Stat(validDir)
	if err != nil || !info.IsDir() {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "target path is not a directory", Enabled: true})
		return
	}

	// Get uploaded file
	file, handler, err := r.FormFile("file")
	if err != nil {
		fb.logger.Warn().Err(err).Msg("Failed to get uploaded file")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "failed to get file from request", Enabled: true})
		return
	}
	defer file.Close()

	// Create destination file
	destPath := filepath.Join(validDir, filepath.Base(handler.Filename))

	// Validate destination path
	_, err = fb.validatePath(destPath)
	if err != nil {
		fb.logger.Warn().Err(err).Str("path", destPath).Msg("Destination path validation failed")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "invalid destination path", Enabled: true})
		return
	}

	destFile, err := os.Create(destPath)
	if err != nil {
		fb.logger.Error().Err(err).Str("path", destPath).Msg("Failed to create destination file")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "failed to create file", Enabled: true})
		return
	}
	defer destFile.Close()

	// Copy file contents
	written, err := io.Copy(destFile, file)
	if err != nil {
		fb.logger.Error().Err(err).Str("path", destPath).Msg("Failed to write file")
		os.Remove(destPath) // Clean up partial file
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "failed to write file", Enabled: true})
		return
	}

	fb.logger.Info().Str("path", destPath).Int64("size", written).Msg("File uploaded successfully")

	response := map[string]interface{}{
		"success":  true,
		"filename": handler.Filename,
		"path":     destPath,
		"size":     written,
	}
	json.NewEncoder(w).Encode(response)
}

// handleMkdir handles directory creation requests
// POST /api/files/mkdir?path=/some/new/directory
func (fb *FileBrowser) handleMkdir(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "method not allowed", Enabled: fb.isEnabled()})
		return
	}

	if !fb.isEnabled() {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "file browser is disabled", Enabled: false})
		return
	}

	requestedPath := r.URL.Query().Get("path")
	if requestedPath == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "path parameter required", Enabled: true})
		return
	}

	validPath, err := fb.validatePath(requestedPath)
	if err != nil {
		fb.logger.Warn().Err(err).Str("path", requestedPath).Msg("Path validation failed")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(ErrorResponse{Error: err.Error(), Enabled: true})
		return
	}

	// Create directory
	err = os.MkdirAll(validPath, 0755)
	if err != nil {
		fb.logger.Error().Err(err).Str("path", validPath).Msg("Failed to create directory")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "failed to create directory", Enabled: true})
		return
	}

	fb.logger.Info().Str("path", validPath).Msg("Directory created")

	response := map[string]interface{}{
		"success": true,
		"path":    validPath,
	}
	json.NewEncoder(w).Encode(response)
}

// handleDelete handles file/directory deletion requests
// DELETE /api/files/delete?path=/some/file/or/directory
func (fb *FileBrowser) handleDelete(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "method not allowed", Enabled: fb.isEnabled()})
		return
	}

	if !fb.isEnabled() {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "file browser is disabled", Enabled: false})
		return
	}

	requestedPath := r.URL.Query().Get("path")
	if requestedPath == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "path parameter required", Enabled: true})
		return
	}

	validPath, err := fb.validatePath(requestedPath)
	if err != nil {
		fb.logger.Warn().Err(err).Str("path", requestedPath).Msg("Path validation failed")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(ErrorResponse{Error: err.Error(), Enabled: true})
		return
	}

	// Check if path exists
	info, err := os.Stat(validPath)
	if err != nil {
		fb.logger.Warn().Err(err).Str("path", validPath).Msg("Path not found")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "path not found", Enabled: true})
		return
	}

	// Delete file or directory
	if info.IsDir() {
		err = os.RemoveAll(validPath)
	} else {
		err = os.Remove(validPath)
	}

	if err != nil {
		fb.logger.Error().Err(err).Str("path", validPath).Msg("Failed to delete")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "failed to delete", Enabled: true})
		return
	}

	fb.logger.Info().Str("path", validPath).Bool("isDir", info.IsDir()).Msg("Deleted successfully")

	response := map[string]interface{}{
		"success": true,
		"path":    validPath,
	}
	json.NewEncoder(w).Encode(response)
}
