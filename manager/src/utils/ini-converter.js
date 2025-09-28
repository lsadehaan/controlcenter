const ini = require('ini');

// Helper to preserve Windows paths including UNC paths
function preserveWindowsPaths(path) {
  if (!path) return '';
  
  // Check if it's a UNC path (starts with single backslash followed by alphanumeric)
  // INI parser converts \\ to \ so UNC paths like \\server become \server
  // We need to restore the double backslash for UNC paths
  if (path[0] === '\\' && path[1] && path[1] !== '\\') {
    // UNC path that needs double backslash restored
    return '\\' + path;
  }
  
  // Leave other paths as-is (regular paths like C:\folder are fine)
  return path;
}

// Convert INI configuration to file watcher rules
function importFromINI(iniContent) {
  const parsed = ini.parse(iniContent);
  const rules = [];
  
  for (const [key, value] of Object.entries(parsed)) {
    // Skip GENERAL section or sections without directory info
    if (key === 'GENERAL' || (!value.DirName && !value.DirRegEx)) continue;
    
    const rule = {
      id: key.replace(/\s+/g, '_').toLowerCase(),
      name: key,
      enabled: value.EventType !== '0',
      description: value.Description || '',
      
      // Matching criteria
      dirRegex: preserveWindowsPaths(value.DirRegEx || value.DirName || ''),
      fileRegex: value.FileRegEx || value.FileName || '',
      contentRegex: value.ContentRegEx || '',
      
      // File operations
      operations: {
        // Preserve UNC paths and ensure backslashes are maintained
        copyToDir: preserveWindowsPaths(value.CopyToDir || ''),
        copyFileOption: parseInt(value.CopyFileOption) || 0,
        copyTempExtension: value.CopyTempExtension || '',
        renameFileTo: value.RenameFileTo || '',
        insertTimestamp: value.InsertTimestamp === '1',
        backupToDir: preserveWindowsPaths(value.BackupToDir || ''),
        backupFileOption: parseInt(value.BackupFileOption) || 0,
        removeAfterCopy: value.RemoveAfterCopy === '1',
        removeAfterHours: parseInt(value.RemoveAfterHours) || 0,
        overwrite: value.Overwrite === '1',
        execProgBefore: value.ExecProgBefore || '',
        execProg: value.ExecProg || '',
        execProgError: value.ExecProgError || ''
      },
      
      // Time restrictions
      timeRestrictions: {
        startHour: parseInt(value.StartHour) || 0,
        startMinute: parseInt(value.StartMinute) || 0,
        endHour: parseInt(value.EndHour) || 23,
        endMinute: parseInt(value.EndMinute) || 59,
        weekDayInterval: parseInt(value.WeekDayInterval) || 127,
        processAfterSecs: parseInt(value.ProcessAfterSecs) || 0
      },
      
      // Processing options
      processingOptions: {
        checkFileInUse: value.CheckFileInUse === '1',
        maxRetries: parseInt(value.MaxRetries) || 3,
        delayRetry: parseInt(value.DelayRetry) || 1000,
        delayNextFile: parseInt(value.DelayNextFile) || 0,
        scanSubDir: value.ScanSubDir === '1'
      }
    };
    
    rules.push(rule);
  }
  
  return rules;
}

// Convert file watcher rules to INI format
function exportToINI(rules) {
  const iniObject = {};
  
  for (const rule of rules) {
    const section = {};
    
    // Basic settings
    section.EventType = rule.enabled ? '1' : '0';
    section.Description = rule.description || '';
    
    // Matching criteria
    if (rule.dirRegex) section.DirRegEx = rule.dirRegex;
    if (rule.fileRegex) section.FileRegEx = rule.fileRegex;
    if (rule.contentRegex) section.ContentRegEx = rule.contentRegex;
    
    // File operations
    const ops = rule.operations || {};
    if (ops.copyToDir) section.CopyToDir = ops.copyToDir;
    if (ops.copyFileOption) section.CopyFileOption = ops.copyFileOption.toString();
    if (ops.copyTempExtension) section.CopyTempExtension = ops.copyTempExtension;
    if (ops.renameFileTo) section.RenameFileTo = ops.renameFileTo;
    if (ops.insertTimestamp) section.InsertTimestamp = '1';
    if (ops.backupToDir) section.BackupToDir = ops.backupToDir;
    if (ops.backupFileOption) section.BackupFileOption = ops.backupFileOption.toString();
    if (ops.removeAfterCopy) section.RemoveAfterCopy = '1';
    if (ops.removeAfterHours) section.RemoveAfterHours = ops.removeAfterHours.toString();
    if (ops.overwrite) section.Overwrite = '1';
    if (ops.execProgBefore) section.ExecProgBefore = ops.execProgBefore;
    if (ops.execProg) section.ExecProg = ops.execProg;
    if (ops.execProgError) section.ExecProgError = ops.execProgError;
    
    // Time restrictions
    const time = rule.timeRestrictions || {};
    if (time.startHour !== undefined) section.StartHour = time.startHour.toString();
    if (time.startMinute !== undefined) section.StartMinute = time.startMinute.toString();
    if (time.endHour !== undefined) section.EndHour = time.endHour.toString();
    if (time.endMinute !== undefined) section.EndMinute = time.endMinute.toString();
    if (time.weekDayInterval !== undefined) section.WeekDayInterval = time.weekDayInterval.toString();
    if (time.processAfterSecs) section.ProcessAfterSecs = time.processAfterSecs.toString();
    
    // Processing options
    const proc = rule.processingOptions || {};
    if (proc.checkFileInUse) section.CheckFileInUse = '1';
    if (proc.maxRetries) section.MaxRetries = proc.maxRetries.toString();
    if (proc.delayRetry) section.DelayRetry = proc.delayRetry.toString();
    if (proc.delayNextFile) section.DelayNextFile = proc.delayNextFile.toString();
    if (proc.scanSubDir) section.ScanSubDir = '1';
    
    iniObject[rule.name || rule.id] = section;
  }
  
  return ini.stringify(iniObject);
}

module.exports = {
  importFromINI,
  exportToINI
};