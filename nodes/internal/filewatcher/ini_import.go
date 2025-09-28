package filewatcher

import (
	"fmt"
	"strconv"
	"strings"

	"gopkg.in/ini.v1"
)

// ImportINI imports file watcher rules from an INI file
func ImportINI(filePath string) ([]Rule, error) {
	cfg, err := ini.Load(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to load INI file: %w", err)
	}
	
	rules := []Rule{}
	
	// Get general settings
	generalSection := cfg.Section("General")
	scanDir := generalSection.Key("ScanDir").String()
	scanSubDir := generalSection.Key("ScanSubDir").MustBool(false)
	checkFileInUse := generalSection.Key("ScanCheckFileInUse").MustBool(true)
	maxRetries := generalSection.Key("MaxRetries").MustInt(5)
	delayRetry := generalSection.Key("DelayRetry").MustInt(1000)
	
	// Get file matching rules
	fileMatchSection := cfg.Section("FileMatching")
	
	// Process each rule
	for i := 0; ; i++ {
		ruleKey := fmt.Sprintf("Rule%d", i)
		ruleName := fileMatchSection.Key(ruleKey).String()
		
		if ruleName == "" {
			break
		}
		
		// Get rule section
		ruleSection := cfg.Section(ruleName)
		if ruleSection == nil {
			continue
		}
		
		// Parse rule configuration
		rule := Rule{
			ID:          fmt.Sprintf("imported_%d", i),
			Name:        ruleName,
			Enabled:     !ruleSection.Key("Locked").MustBool(false),
			Description: ruleSection.Key("Description").String(),
			
			// Matching criteria
			DirRegEx:    ruleSection.Key("DirRegEx").String(),
			FileRegEx:   ruleSection.Key("FileRegEx").String(),
			ContentRegEx: ruleSection.Key("ContentRegEx").String(),
			
			// File operations
			Operations: FileOperations{
				CopyToDir:         ruleSection.Key("CopyToDir").String(),
				CopyFileOption:    ruleSection.Key("CopyFileOption").MustInt(21),
				CopyTempExtension: ruleSection.Key("CopyTempExtension").String(),
				RenameFileTo:      ruleSection.Key("RenameFileTo").String(),
				InsertTimestamp:   ruleSection.Key("InsertTimestamp").MustBool(false),
				BackupToDir:       ruleSection.Key("BkpToDir").String(),
				BackupFileOption:  ruleSection.Key("BkpFileOption").MustInt(21),
				RemoveAfterCopy:   ruleSection.Key("RemoveAfterCopy").MustBool(true),
				RemoveAfterHours:  ruleSection.Key("RemoveAfterHours").MustInt(0),
				Overwrite:         ruleSection.Key("Overwrite").MustBool(true),
				ExecProgBefore:    ruleSection.Key("ExecProgBefore").String(),
				ExecProg:          ruleSection.Key("ExecProg").String(),
				ExecProgError:     ruleSection.Key("ExecProgError").String(),
			},
			
			// Time restrictions
			TimeRestrictions: TimeRestrictions{
				StartHour:        ruleSection.Key("StartDateHour").MustInt(0),
				StartMinute:      ruleSection.Key("StartDateMinute").MustInt(0),
				EndHour:          ruleSection.Key("EndDateHour").MustInt(23),
				EndMinute:        ruleSection.Key("EndDateMinute").MustInt(59),
				WeekDayInterval:  ruleSection.Key("WeekDayInterval").MustInt(127),
				ProcessAfterSecs: ruleSection.Key("ProcessAfterSeconds").MustInt(0),
			},
			
			// Processing options
			ProcessingOptions: ProcessingOptions{
				CheckFileInUse: checkFileInUse,
				MaxRetries:     maxRetries,
				DelayRetry:     delayRetry,
				DelayNextFile:  ruleSection.Key("DelayNextFileProcess").MustInt(0),
				ScanSubDir:     scanSubDir,
			},
		}
		
		// If no DirRegEx specified, use the scan directory
		if rule.DirRegEx == "" && scanDir != "" {
			rule.DirRegEx = escapeRegex(scanDir)
		}
		
		rules = append(rules, rule)
	}
	
	return rules, nil
}

// ExportINI exports file watcher rules to INI format
func ExportINI(rules []Rule, filePath string) error {
	cfg := ini.Empty()
	
	// Add general section
	generalSection, _ := cfg.NewSection("General")
	generalSection.NewKey("ScanDir", "C:\\FileWatch")
	generalSection.NewKey("ScanSubDir", "0")
	generalSection.NewKey("ScanCheckFileInUse", "1")
	generalSection.NewKey("MaxRetries", "5")
	generalSection.NewKey("DelayRetry", "1000")
	
	// Add file matching section
	fileMatchSection, _ := cfg.NewSection("FileMatching")
	
	// Add each rule
	for i, rule := range rules {
		ruleKey := fmt.Sprintf("Rule%d", i)
		fileMatchSection.NewKey(ruleKey, rule.Name)
		
		// Create rule section
		ruleSection, _ := cfg.NewSection(rule.Name)
		
		// Set rule properties
		ruleSection.NewKey("Locked", strconv.Itoa(boolToInt(!rule.Enabled)))
		ruleSection.NewKey("DirRegEx", rule.DirRegEx)
		ruleSection.NewKey("FileRegEx", rule.FileRegEx)
		ruleSection.NewKey("ContentRegEx", rule.ContentRegEx)
		ruleSection.NewKey("Description", rule.Description)
		
		// File operations
		ruleSection.NewKey("CopyToDir", rule.Operations.CopyToDir)
		ruleSection.NewKey("CopyFileOption", strconv.Itoa(rule.Operations.CopyFileOption))
		ruleSection.NewKey("CopyTempExtension", rule.Operations.CopyTempExtension)
		ruleSection.NewKey("RenameFileTo", rule.Operations.RenameFileTo)
		ruleSection.NewKey("InsertTimestamp", strconv.Itoa(boolToInt(rule.Operations.InsertTimestamp)))
		ruleSection.NewKey("BkpToDir", rule.Operations.BackupToDir)
		ruleSection.NewKey("BkpFileOption", strconv.Itoa(rule.Operations.BackupFileOption))
		ruleSection.NewKey("RemoveAfterCopy", strconv.Itoa(boolToInt(rule.Operations.RemoveAfterCopy)))
		ruleSection.NewKey("RemoveAfterHours", strconv.Itoa(rule.Operations.RemoveAfterHours))
		ruleSection.NewKey("Overwrite", strconv.Itoa(boolToInt(rule.Operations.Overwrite)))
		ruleSection.NewKey("ExecProgBefore", rule.Operations.ExecProgBefore)
		ruleSection.NewKey("ExecProg", rule.Operations.ExecProg)
		ruleSection.NewKey("ExecProgError", rule.Operations.ExecProgError)
		
		// Time restrictions
		ruleSection.NewKey("StartDateHour", strconv.Itoa(rule.TimeRestrictions.StartHour))
		ruleSection.NewKey("StartDateMinute", strconv.Itoa(rule.TimeRestrictions.StartMinute))
		ruleSection.NewKey("EndDateHour", strconv.Itoa(rule.TimeRestrictions.EndHour))
		ruleSection.NewKey("EndDateMinute", strconv.Itoa(rule.TimeRestrictions.EndMinute))
		ruleSection.NewKey("WeekDayInterval", strconv.Itoa(rule.TimeRestrictions.WeekDayInterval))
		ruleSection.NewKey("ProcessAfterSeconds", strconv.Itoa(rule.TimeRestrictions.ProcessAfterSecs))
		
		// Processing options
		ruleSection.NewKey("DelayNextFileProcess", strconv.Itoa(rule.ProcessingOptions.DelayNextFile))
	}
	
	return cfg.SaveTo(filePath)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func escapeRegex(s string) string {
	// Escape special regex characters
	special := []string{".", "^", "$", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|", "\\"}
	result := s
	for _, char := range special {
		result = strings.ReplaceAll(result, char, "\\"+char)
	}
	return result
}