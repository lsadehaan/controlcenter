package logrotation

import (
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// RotatingWriter implements log rotation based on size and age
type RotatingWriter struct {
	filename   string
	maxSize    int64 // Max size in bytes before rotation
	maxAge     int   // Max days to retain logs
	maxBackups int   // Max number of old log files to keep
	compress   bool  // Whether to compress rotated logs

	mu   sync.Mutex
	file *os.File
	size int64
}

// NewRotatingWriter creates a new rotating log writer
func NewRotatingWriter(filename string, maxSizeMB, maxAgeDays, maxBackups int, compress bool) (*RotatingWriter, error) {
	// Set defaults
	if maxSizeMB <= 0 {
		maxSizeMB = 100
	}
	if maxAgeDays <= 0 {
		maxAgeDays = 30
	}
	if maxBackups <= 0 {
		maxBackups = 5
	}

	rw := &RotatingWriter{
		filename:   filename,
		maxSize:    int64(maxSizeMB) * 1024 * 1024,
		maxAge:     maxAgeDays,
		maxBackups: maxBackups,
		compress:   compress,
	}

	// Open or create log file
	if err := rw.openExistingOrNew(len("")); err != nil {
		return nil, err
	}

	return rw, nil
}

// Write implements io.Writer
func (rw *RotatingWriter) Write(p []byte) (n int, err error) {
	rw.mu.Lock()
	defer rw.mu.Unlock()

	writeLen := int64(len(p))
	if rw.size+writeLen > rw.maxSize {
		if err := rw.rotate(); err != nil {
			return 0, err
		}
	}

	n, err = rw.file.Write(p)
	rw.size += int64(n)

	return n, err
}

// Close closes the log file
func (rw *RotatingWriter) Close() error {
	rw.mu.Lock()
	defer rw.mu.Unlock()

	if rw.file != nil {
		return rw.file.Close()
	}
	return nil
}

// openExistingOrNew opens the log file or creates it
func (rw *RotatingWriter) openExistingOrNew(writeLen int) error {
	info, err := os.Stat(rw.filename)
	if err != nil {
		// File doesn't exist, create it
		return rw.openNew()
	}

	// File exists, check if we need to rotate
	if info.Size()+int64(writeLen) >= rw.maxSize {
		return rw.rotate()
	}

	// Open existing file for append
	file, err := os.OpenFile(rw.filename, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}

	rw.file = file
	rw.size = info.Size()
	return nil
}

// openNew creates a new log file
func (rw *RotatingWriter) openNew() error {
	err := os.MkdirAll(filepath.Dir(rw.filename), 0755)
	if err != nil {
		return err
	}

	file, err := os.OpenFile(rw.filename, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}

	rw.file = file
	rw.size = 0
	return nil
}

// rotate closes current file and opens a new one
func (rw *RotatingWriter) rotate() error {
	if err := rw.close(); err != nil {
		return err
	}

	// Generate backup filename with timestamp
	timestamp := time.Now().Format("20060102-150405")
	backupName := fmt.Sprintf("%s.%s", rw.filename, timestamp)

	// Rename current file to backup
	if err := os.Rename(rw.filename, backupName); err != nil {
		return err
	}

	// Compress if enabled
	if rw.compress {
		go rw.compressFile(backupName)
	}

	// Cleanup old backups
	go rw.cleanup()

	// Open new file
	return rw.openNew()
}

// close closes the current log file
func (rw *RotatingWriter) close() error {
	if rw.file == nil {
		return nil
	}
	err := rw.file.Close()
	rw.file = nil
	rw.size = 0
	return err
}

// compressFile compresses a log file using gzip
func (rw *RotatingWriter) compressFile(filename string) error {
	// Open source file
	src, err := os.Open(filename)
	if err != nil {
		return err
	}
	defer src.Close()

	// Create compressed file
	dst, err := os.Create(filename + ".gz")
	if err != nil {
		return err
	}
	defer dst.Close()

	// Compress
	gzWriter := gzip.NewWriter(dst)
	defer gzWriter.Close()

	if _, err := io.Copy(gzWriter, src); err != nil {
		return err
	}

	// Remove original file after successful compression
	return os.Remove(filename)
}

// cleanup removes old log files based on maxBackups and maxAge
func (rw *RotatingWriter) cleanup() error {
	dir := filepath.Dir(rw.filename)
	baseName := filepath.Base(rw.filename)

	// Find all backup files
	var backups []os.FileInfo
	files, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	for _, f := range files {
		if strings.HasPrefix(f.Name(), baseName+".") {
			info, err := f.Info()
			if err != nil {
				continue
			}
			backups = append(backups, info)
		}
	}

	// Sort by modification time (oldest first)
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].ModTime().Before(backups[j].ModTime())
	})

	// Remove by age
	cutoff := time.Now().AddDate(0, 0, -rw.maxAge)
	for _, info := range backups {
		if info.ModTime().Before(cutoff) {
			fullPath := filepath.Join(dir, info.Name())
			os.Remove(fullPath)
		}
	}

	// Refresh backup list after age-based cleanup
	backups = []os.FileInfo{}
	files, _ = os.ReadDir(dir)
	for _, f := range files {
		if strings.HasPrefix(f.Name(), baseName+".") {
			info, err := f.Info()
			if err != nil {
				continue
			}
			backups = append(backups, info)
		}
	}

	// Sort again by modification time
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].ModTime().Before(backups[j].ModTime())
	})

	// Remove by count (keep only maxBackups)
	if len(backups) > rw.maxBackups {
		toRemove := len(backups) - rw.maxBackups
		for i := 0; i < toRemove; i++ {
			fullPath := filepath.Join(dir, backups[i].Name())
			os.Remove(fullPath)
		}
	}

	return nil
}
