package workflow

import (
	stdcontext "context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/rs/zerolog"
)

// Step represents a workflow step that can be executed
type Step interface {
	Execute(config map[string]interface{}, context map[string]interface{}) error
	GetType() string
}

// BaseStep provides common functionality for all steps
type BaseStep struct {
	Type   string
	Logger zerolog.Logger
}

// GetType returns the step type
func (b *BaseStep) GetType() string {
	return b.Type
}

// getRequiredString extracts a required string parameter from config
func (b *BaseStep) getRequiredString(config map[string]interface{}, key string) (string, error) {
	value, ok := config[key].(string)
	if !ok || value == "" {
		return "", fmt.Errorf("%s step requires %s parameter", b.Type, key)
	}
	return value, nil
}

// getOptionalString extracts an optional string parameter from config
func (b *BaseStep) getOptionalString(config map[string]interface{}, key string, defaultValue string) string {
	if value, ok := config[key].(string); ok && value != "" {
		return value
	}
	return defaultValue
}

// MoveFileStep implements file moving
type MoveFileStep struct {
	BaseStep
}

func (s *MoveFileStep) Execute(config map[string]interface{}, context map[string]interface{}) error {
	source, err := s.getRequiredString(config, "source")
	if err != nil {
		return err
	}

	destination, err := s.getRequiredString(config, "destination")
	if err != nil {
		return err
	}

	// Ensure destination directory exists
	destDir := filepath.Dir(destination)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	if err := os.Rename(source, destination); err != nil {
		return fmt.Errorf("failed to move file: %w", err)
	}

	s.Logger.Info().
		Str("source", source).
		Str("destination", destination).
		Msg("✅ File moved successfully")

	return nil
}

// CopyFileStep implements file copying
type CopyFileStep struct {
	BaseStep
}

func (s *CopyFileStep) Execute(config map[string]interface{}, context map[string]interface{}) error {
	source, err := s.getRequiredString(config, "source")
	if err != nil {
		return err
	}

	destination, err := s.getRequiredString(config, "destination")
	if err != nil {
		return err
	}

	// Ensure destination directory exists
	destDir := filepath.Dir(destination)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	// Read source file
	data, err := os.ReadFile(source)
	if err != nil {
		return fmt.Errorf("failed to read source file: %w", err)
	}

	// Write to destination
	if err := os.WriteFile(destination, data, 0644); err != nil {
		return fmt.Errorf("failed to write destination file: %w", err)
	}

	s.Logger.Info().
		Str("source", source).
		Str("destination", destination).
		Msg("✅ File copied successfully")

	return nil
}

// DeleteFileStep implements file deletion
type DeleteFileStep struct {
	BaseStep
}

func (s *DeleteFileStep) Execute(config map[string]interface{}, context map[string]interface{}) error {
	path, err := s.getRequiredString(config, "path")
	if err != nil {
		return err
	}

	if err := os.Remove(path); err != nil {
		return fmt.Errorf("failed to delete file: %w", err)
	}

	s.Logger.Info().
		Str("path", path).
		Msg("✅ File deleted successfully")

	return nil
}

// CommandStep implements command execution
type CommandStep struct {
	BaseStep
}

func (s *CommandStep) Execute(config map[string]interface{}, context map[string]interface{}) error {
	// Log raw config for debugging
	s.Logger.Info().
		Interface("config", config).
		Interface("context", context).
		Msg("📋 Command step configuration")

	command, err := s.getRequiredString(config, "command")
	if err != nil {
		return err
	}

	// Get arguments if provided (try both "arguments" and "args" for compatibility)
	arguments := s.getOptionalString(config, "arguments", "")
	if arguments == "" {
		arguments = s.getOptionalString(config, "args", "")
	}

	// Combine command and arguments
	fullCommand := command
	if arguments != "" {
		fullCommand = command + " " + arguments
	}

	workDir := s.getOptionalString(config, "workingDir", "")

	s.Logger.Info().
		Str("command", command).
		Str("arguments", arguments).
		Str("fullCommand", fullCommand).
		Str("workDir", workDir).
		Msg("🔧 Executing command")

	// Use shell to execute for proper handling
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd", "/C", fullCommand)
	} else {
		cmd = exec.Command("sh", "-c", fullCommand)
	}

	if workDir != "" {
		cmd.Dir = workDir
	}

	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	// Always store command info in context for downstream steps
	context["command"] = fullCommand
	context["commandOutput"] = outputStr
	context["output"] = outputStr  // Short alias for convenience

	if err != nil {
		// Extract actual exit code from error
		exitCode := 1  // Default to 1 if we can't determine the actual code
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}

		s.Logger.Error().
			Str("fullCommand", fullCommand).
			Str("workDir", workDir).
			Str("output", outputStr).
			Int("exitCode", exitCode).
			Err(err).
			Msg("❌ Command execution failed")

		// Store error details in context for error handlers
		context["commandError"] = err.Error()
		context["commandExitCode"] = exitCode
		context["exitCode"] = exitCode  // Short alias for convenience

		return fmt.Errorf("command failed: %w, output: %s", err, output)
	}

	s.Logger.Info().
		Str("fullCommand", fullCommand).
		Str("output", outputStr).
		Msg("✅ Command executed successfully")

	context["commandExitCode"] = 0
	context["exitCode"] = 0  // Short alias for convenience

	return nil
}

// S3UploadStep implements S3 file upload
type S3UploadStep struct {
	BaseStep
}

func (s *S3UploadStep) Execute(config map[string]interface{}, context map[string]interface{}) error {
	// Get required parameters
	filePath, err := s.getRequiredString(config, "filePath")
	if err != nil {
		return err
	}

	bucket, err := s.getRequiredString(config, "bucket")
	if err != nil {
		return err
	}

	// Get AWS credentials
	accessKeyID, err := s.getRequiredString(config, "accessKeyId")
	if err != nil {
		return err
	}

	secretAccessKey, err := s.getRequiredString(config, "secretAccessKey")
	if err != nil {
		return err
	}

	region, err := s.getRequiredString(config, "region")
	if err != nil {
		return err
	}

	// Get optional S3 key (defaults to filename)
	s3Key := s.getOptionalString(config, "s3Key", filepath.Base(filePath))

	// Optional prefix/folder path
	s3Prefix := s.getOptionalString(config, "s3Prefix", "")
	if s3Prefix != "" {
		// Ensure prefix ends with / for proper S3 folder structure
		if s3Prefix[len(s3Prefix)-1] != '/' {
			s3Prefix += "/"
		}
		s3Key = s3Prefix + s3Key
	}

	s.Logger.Info().
		Str("filePath", filePath).
		Str("bucket", bucket).
		Str("s3Key", s3Key).
		Str("region", region).
		Msg("🌐 Starting S3 upload")

	// Check if file exists
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return fmt.Errorf("failed to access file: %w", err)
	}

	// Open file for reading
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	// Create AWS config with static credentials
	awsCfg := aws.Config{
		Region: region,
		Credentials: credentials.NewStaticCredentialsProvider(
			accessKeyID,
			secretAccessKey,
			"", // session token (empty for IAM user credentials)
		),
	}

	// Create S3 client
	s3Client := s3.NewFromConfig(awsCfg)

	// Upload file to S3
	awsCtx := stdcontext.Background()
	_, err = s3Client.PutObject(awsCtx, &s3.PutObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(s3Key),
		Body:   file,
	})

	if err != nil {
		s.Logger.Error().
			Err(err).
			Str("filePath", filePath).
			Str("bucket", bucket).
			Str("s3Key", s3Key).
			Msg("❌ S3 upload failed")
		return fmt.Errorf("failed to upload to S3: %w", err)
	}

	s.Logger.Info().
		Str("filePath", filePath).
		Str("bucket", bucket).
		Str("s3Key", s3Key).
		Int64("size", fileInfo.Size()).
		Msg("✅ File uploaded to S3 successfully")

	// Store S3 details in context for downstream steps
	context["s3Bucket"] = bucket
	context["s3Key"] = s3Key
	context["s3Region"] = region
	context["s3UploadedFile"] = filePath

	return nil
}

// AlertStep implements alert sending
type AlertStep struct {
	BaseStep
	AlertHandler func(level, message string, details map[string]interface{})
}

func (s *AlertStep) Execute(config map[string]interface{}, context map[string]interface{}) error {
	message, err := s.getRequiredString(config, "message")
	if err != nil {
		return err
	}

	level := s.getOptionalString(config, "level", "info")

	s.Logger.Info().
		Str("level", level).
		Str("message", message).
		Msg("🔔 Alert generated")

	// Send alert to manager via alert channel
	if s.AlertHandler != nil {
		s.AlertHandler(level, message, config)
	}

	return nil
}

// UnimplementedStep provides a placeholder for unimplemented step types
type UnimplementedStep struct {
	BaseStep
}

func (s *UnimplementedStep) Execute(config map[string]interface{}, context map[string]interface{}) error {
	// Log some details about what was attempted
	details := ""
	for key, value := range config {
		if str, ok := value.(string); ok && str != "" {
			details += fmt.Sprintf(" %s=%s", key, str)
		}
	}

	s.Logger.Warn().
		Str("type", s.Type).
		Str("details", details).
		Msg("⚠️ Step type not yet implemented")

	return fmt.Errorf("%s step not yet implemented", s.Type)
}

// StepRegistry manages available step types
type StepRegistry struct {
	steps        map[string]func() Step
	logger       zerolog.Logger
	alertHandler func(level, message string, details map[string]interface{})
}

// NewStepRegistry creates a new step registry
func NewStepRegistry(logger zerolog.Logger, alertHandler func(level, message string, details map[string]interface{})) *StepRegistry {
	registry := &StepRegistry{
		steps:        make(map[string]func() Step),
		logger:       logger,
		alertHandler: alertHandler,
	}

	// Register implemented steps
	registry.Register("move-file", func() Step {
		return &MoveFileStep{BaseStep: BaseStep{Type: "move-file", Logger: logger}}
	})
	registry.Register("copy-file", func() Step {
		return &CopyFileStep{BaseStep: BaseStep{Type: "copy-file", Logger: logger}}
	})
	registry.Register("delete-file", func() Step {
		return &DeleteFileStep{BaseStep: BaseStep{Type: "delete-file", Logger: logger}}
	})
	registry.Register("run-command", func() Step {
		return &CommandStep{BaseStep: BaseStep{Type: "run-command", Logger: logger}}
	})
	registry.Register("alert", func() Step {
		return &AlertStep{
			BaseStep:     BaseStep{Type: "alert", Logger: logger},
			AlertHandler: alertHandler,
		}
	})
	registry.Register("s3-upload", func() Step {
		return &S3UploadStep{BaseStep: BaseStep{Type: "s3-upload", Logger: logger}}
	})

	// Register unimplemented steps with proper names
	unimplementedTypes := []string{
		"rename-file", "archive-file", "extract-archive", "run-script",
		"ssh-command", "send-file", "http-request", "database-query",
		"send-email", "slack-message", "condition", "loop", "javascript",
	}

	for _, stepType := range unimplementedTypes {
		// Capture stepType in closure
		st := stepType
		registry.Register(st, func() Step {
			return &UnimplementedStep{BaseStep: BaseStep{Type: st, Logger: logger}}
		})
	}

	return registry
}

// Register adds a new step type to the registry
func (r *StepRegistry) Register(stepType string, factory func() Step) {
	r.steps[stepType] = factory
}

// Create creates a step instance by type
func (r *StepRegistry) Create(stepType string) (Step, error) {
	factory, exists := r.steps[stepType]
	if !exists {
		return nil, fmt.Errorf("unknown step type: %s", stepType)
	}
	return factory(), nil
}
