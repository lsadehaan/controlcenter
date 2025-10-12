// Agent file watcher configuration page JavaScript
// Read agent data from data attributes
const agent = JSON.parse(document.body.dataset.agentConfig || '{}');
const fileWatcherRules = JSON.parse(document.body.dataset.filewatcherRules || '[]');

// Initialize agent workflows from config
const agentWorkflows = (agent && agent.config && agent.config.workflows) ? agent.config.workflows : [];

// Initialize file watcher configuration
let rules = fileWatcherRules || [];
let currentRuleIndex = -1;

// Initialize global settings with proper fallback
let globalSettings = {};
try {
  globalSettings = (agent && agent.fileWatcherSettings) ? agent.fileWatcherSettings : {};
} catch(e) {
  console.error('Failed to parse global settings:', e);
  globalSettings = {};
}

// Populate workflow dropdowns
function populateWorkflowDropdowns() {
  const dropdowns = ['exec-before-select', 'exec-after-select', 'exec-error-select'];
  dropdowns.forEach(id => {
    const select = document.getElementById(id);
    if (select) {
      // Clear existing options except the first one
      while (select.options.length > 1) {
        select.remove(1);
      }
      // Add workflows that are suitable for file watchers
      if (agentWorkflows && agentWorkflows.length > 0) {
        agentWorkflows.forEach(workflow => {
          // Check if workflow has a suitable trigger
          const config = workflow.config || workflow;
          let isSuitable = false;

          if (config.trigger) {
            // Has a trigger - only show if it's filewatcher-trigger
            isSuitable = config.trigger.type === 'filewatcher';
          } else {
            // No trigger - can be called directly
            isSuitable = true;
          }

          if (isSuitable) {
            const option = document.createElement('option');
            option.value = workflow.name || workflow.id;
            option.textContent = workflow.name || workflow.id;
            select.appendChild(option);
          }
        });
      }
    }
  });
}

// Toggle between command input and workflow dropdown
function toggleWorkflowMode(fieldPrefix) {
  const checkbox = document.getElementById(fieldPrefix + '-workflow');
  const textInput = document.getElementById(fieldPrefix);
  const selectInput = document.getElementById(fieldPrefix + '-select');

  if (checkbox.checked) {
    textInput.style.display = 'none';
    selectInput.style.display = 'block';
  } else {
    textInput.style.display = 'block';
    selectInput.style.display = 'none';
  }
}

// Initialize dropdowns on page load
document.addEventListener('DOMContentLoaded', function() {
  populateWorkflowDropdowns();

  // Attach event listeners for buttons
  const saveGlobalBtn = document.getElementById('save-global-settings-btn');
  if (saveGlobalBtn) {
    saveGlobalBtn.addEventListener('click', saveGlobalSettings);
  }

  const importIniBtn = document.getElementById('import-ini-btn');
  if (importIniBtn) {
    importIniBtn.addEventListener('click', function() {
      document.getElementById('import-file').click();
    });
  }

  const createRuleBtn = document.getElementById('create-rule-btn');
  if (createRuleBtn) {
    createRuleBtn.addEventListener('click', createRule);
  }

  const exportRulesBtn = document.getElementById('export-rules-btn');
  if (exportRulesBtn) {
    exportRulesBtn.addEventListener('click', exportRules);
  }

  const closeModalHeaderBtn = document.getElementById('close-modal-header-btn');
  if (closeModalHeaderBtn) {
    closeModalHeaderBtn.addEventListener('click', closeModal);
  }

  const closeModalFooterBtn = document.getElementById('close-modal-footer-btn');
  if (closeModalFooterBtn) {
    closeModalFooterBtn.addEventListener('click', closeModal);
  }

  const saveRuleBtn = document.getElementById('save-rule-btn');
  if (saveRuleBtn) {
    saveRuleBtn.addEventListener('click', saveRule);
  }

  // Tab buttons
  const formTabs = document.querySelectorAll('.form-tab');
  formTabs.forEach(btn => {
    btn.addEventListener('click', function() {
      const tabName = this.getAttribute('data-tab');
      switchTab(tabName, this);
    });
  });

  // Watch mode dropdown
  const watchModeSelect = document.getElementById('watch-mode');
  if (watchModeSelect) {
    watchModeSelect.addEventListener('change', updateWatchModeUI);
  }

  // Workflow checkboxes
  const execBeforeCheckbox = document.getElementById('exec-before-workflow');
  const execAfterCheckbox = document.getElementById('exec-after-workflow');
  const execErrorCheckbox = document.getElementById('exec-error-workflow');

  if (execBeforeCheckbox) {
    execBeforeCheckbox.addEventListener('change', function() {
      toggleWorkflowMode(this.getAttribute('data-field-prefix'));
    });
  }
  if (execAfterCheckbox) {
    execAfterCheckbox.addEventListener('change', function() {
      toggleWorkflowMode(this.getAttribute('data-field-prefix'));
    });
  }
  if (execErrorCheckbox) {
    execErrorCheckbox.addEventListener('change', function() {
      toggleWorkflowMode(this.getAttribute('data-field-prefix'));
    });
  }

  // Event delegation for dynamically created rule buttons
  const rulesList = document.getElementById('rules-list');
  if (rulesList) {
    rulesList.addEventListener('click', function(e) {
      if (e.target.classList.contains('edit-rule-btn')) {
        const index = parseInt(e.target.getAttribute('data-index'));
        editRule(index);
      } else if (e.target.classList.contains('toggle-rule-btn')) {
        const index = parseInt(e.target.getAttribute('data-index'));
        toggleRule(index);
      } else if (e.target.classList.contains('delete-rule-btn')) {
        const index = parseInt(e.target.getAttribute('data-index'));
        deleteRule(index);
      }
    });
  }
});

// Helper function to set external program field value
function handleExternalProgramField(fieldPrefix, value) {
  const checkbox = document.getElementById(fieldPrefix + '-workflow');
  const textInput = document.getElementById(fieldPrefix);
  const selectInput = document.getElementById(fieldPrefix + '-select');

  if (value && value.startsWith('WF:')) {
    // It's a workflow reference
    checkbox.checked = true;
    textInput.style.display = 'none';
    selectInput.style.display = 'block';
    selectInput.value = value.substring(3); // Remove 'WF:' prefix
  } else {
    // It's a regular command
    checkbox.checked = false;
    textInput.style.display = 'block';
    selectInput.style.display = 'none';
    textInput.value = value;
  }
}

// Helper function to get external program value
function getExternalProgramValue(fieldPrefix) {
  const checkbox = document.getElementById(fieldPrefix + '-workflow');
  if (checkbox.checked) {
    const selectInput = document.getElementById(fieldPrefix + '-select');
    return selectInput.value ? 'WF:' + selectInput.value : '';
  } else {
    const textInput = document.getElementById(fieldPrefix);
    return textInput.value;
  }
}

function loadGlobalSettings() {
  // Load global settings into the UI
  document.getElementById('global-scan-dir').value = globalSettings.scanDir || '';
  document.getElementById('global-scan-subdir').checked = globalSettings.scanSubDir || false;
}

function saveGlobalSettings() {
  globalSettings = {
    scanDir: document.getElementById('global-scan-dir').value,
    scanSubDir: document.getElementById('global-scan-subdir').checked
  };

  // Save to server
  fetch(`/api/agents/${agent.id}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileWatcherSettings: globalSettings })
  })
  .then(r => r.json())
  .then(data => {
    alert('Global settings saved successfully');
  })
  .catch(err => alert('Failed to save global settings: ' + err.message));
}

function updateWatchModeUI() {
  const watchMode = document.getElementById('watch-mode').value;
  const dirRegexLabel = document.getElementById('dir-regex-label');
  const dirRegexHelper = document.getElementById('dir-regex-helper');
  const dirRegexInput = document.getElementById('dir-regex');

  if (watchMode === 'pattern') {
    dirRegexLabel.textContent = 'Directory Pattern';
    dirRegexHelper.textContent = 'Regex pattern to match subdirectories under ' + (globalSettings.scanDir || 'ScanDir');
    dirRegexInput.placeholder = 'e.g., (?i)\\\\Invoices\\\\Input$';
  } else {
    dirRegexLabel.textContent = 'Directory Path';
    dirRegexHelper.textContent = 'Full path to the directory to watch';
    dirRegexInput.placeholder = 'e.g., C:\\\\Watch or \\\\\\\\server\\\\share\\\\folder';
  }
}

function loadRules() {
  const listEl = document.getElementById('rules-list');
  const countEl = document.getElementById('rule-count');

  if (rules.length === 0) {
    listEl.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">No file watcher rules configured</div>';
    countEl.textContent = '0 rules';
    return;
  }

  countEl.textContent = rules.length + ' rule' + (rules.length !== 1 ? 's' : '');

  listEl.innerHTML = rules.map((rule, index) => `
    <div class="rule-item">
      <div class="rule-status">
        <span class="status-indicator ${rule.enabled ? 'enabled' : ''}"></span>
      </div>
      <div class="rule-info">
        <div class="rule-name">${escapeHtml(rule.name)}</div>
        <div class="rule-details">
          <div class="rule-detail">
            <span class="rule-detail-icon">📁</span>
            ${rule.watchMode === 'pattern' ? '<span title="Pattern Mode">🔍</span> ' : ''}${escapeHtml(rule.dirRegex || 'Any directory')}
          </div>
          <div class="rule-detail">
            <span class="rule-detail-icon">📄</span>
            ${escapeHtml(rule.fileRegex || 'Any file')}
          </div>
          ${rule.operations.copyToDir ? `
            <div class="rule-detail">
              <span class="rule-detail-icon">➡️</span>
              ${escapeHtml(rule.operations.copyToDir)}
            </div>
          ` : ''}
        </div>
      </div>
      <div class="rule-actions">
        <button class="btn btn-sm edit-rule-btn" data-index="${index}">Edit</button>
        <button class="btn btn-sm toggle-rule-btn" data-index="${index}">${rule.enabled ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-sm btn-danger delete-rule-btn" data-index="${index}">Delete</button>
      </div>
    </div>
  `).join('');
}

function createRule() {
  currentRuleIndex = -1;
  document.getElementById('modal-title').textContent = 'New File Watcher Rule';
  clearForm();
  document.getElementById('rule-modal').style.display = 'block';
}

function editRule(index) {
  currentRuleIndex = index;
  const rule = rules[index];
  document.getElementById('modal-title').textContent = 'Edit File Watcher Rule';

  // Load rule data into form
  document.getElementById('rule-name').value = rule.name || '';
  document.getElementById('rule-description').value = rule.description || '';
  document.getElementById('rule-enabled').checked = rule.enabled !== false;
  document.getElementById('watch-mode').value = rule.watchMode || 'absolute';
  updateWatchModeUI();
  document.getElementById('dir-regex').value = rule.dirRegex || '';
  document.getElementById('file-regex').value = rule.fileRegex || '';
  document.getElementById('content-regex').value = rule.contentRegex || '';

  // Operations
  const ops = rule.operations || {};
  document.getElementById('copy-to-dir').value = ops.copyToDir || '';
  document.getElementById('copy-option').value = ops.copyFileOption || '21';
  document.getElementById('rename-to').value = ops.renameFileTo || '';
  document.getElementById('insert-timestamp').checked = ops.insertTimestamp || false;
  document.getElementById('backup-dir').value = ops.backupToDir || '';
  document.getElementById('temp-ext').value = ops.copyTempExtension || '';
  document.getElementById('remove-after').checked = ops.removeAfterCopy !== false;
  document.getElementById('overwrite').checked = ops.overwrite !== false;

  // Handle external programs (check for workflow format)
  handleExternalProgramField('exec-before', ops.execProgBefore || '');
  handleExternalProgramField('exec-after', ops.execProg || '');
  handleExternalProgramField('exec-error', ops.execProgError || '');

  // Timing
  const time = rule.timeRestrictions || {};
  document.getElementById('start-hour').value = time.startHour || 0;
  document.getElementById('start-minute').value = time.startMinute || 0;
  document.getElementById('end-hour').value = time.endHour || 23;
  document.getElementById('end-minute').value = time.endMinute || 59;
  document.getElementById('process-after').value = time.processAfterSecs || 0;

  // Weekdays
  const weekday = time.weekDayInterval || 127;
  document.querySelectorAll('.weekday').forEach(cb => {
    cb.checked = (weekday & parseInt(cb.value)) > 0;
  });

  // Advanced
  const proc = rule.processingOptions || {};
  document.getElementById('check-in-use').checked = proc.checkFileInUse !== false;
  // scanSubDir is now a global setting, no need to load it here
  document.getElementById('max-retries').value = proc.maxRetries || 5;
  document.getElementById('retry-delay').value = proc.delayRetry || 1000;
  document.getElementById('delay-next').value = proc.delayNextFile || 0;

  document.getElementById('rule-modal').style.display = 'block';
}

function saveRule() {
  const rule = {
    id: currentRuleIndex >= 0 ? rules[currentRuleIndex].id : 'rule_' + Date.now(),
    name: document.getElementById('rule-name').value,
    description: document.getElementById('rule-description').value,
    enabled: document.getElementById('rule-enabled').checked,
    watchMode: document.getElementById('watch-mode').value,
    dirRegex: document.getElementById('dir-regex').value,
    fileRegex: document.getElementById('file-regex').value,
    contentRegex: document.getElementById('content-regex').value,
    operations: {
      copyToDir: document.getElementById('copy-to-dir').value,
      copyFileOption: parseInt(document.getElementById('copy-option').value),
      renameFileTo: document.getElementById('rename-to').value,
      insertTimestamp: document.getElementById('insert-timestamp').checked,
      backupToDir: document.getElementById('backup-dir').value,
      copyTempExtension: document.getElementById('temp-ext').value,
      removeAfterCopy: document.getElementById('remove-after').checked,
      overwrite: document.getElementById('overwrite').checked,
      execProgBefore: getExternalProgramValue('exec-before'),
      execProg: getExternalProgramValue('exec-after'),
      execProgError: getExternalProgramValue('exec-error')
    },
    timeRestrictions: {
      startHour: parseInt(document.getElementById('start-hour').value),
      startMinute: parseInt(document.getElementById('start-minute').value),
      endHour: parseInt(document.getElementById('end-hour').value),
      endMinute: parseInt(document.getElementById('end-minute').value),
      processAfterSecs: parseInt(document.getElementById('process-after').value),
      weekDayInterval: Array.from(document.querySelectorAll('.weekday:checked'))
        .reduce((sum, cb) => sum + parseInt(cb.value), 0)
    },
    processingOptions: {
      checkFileInUse: document.getElementById('check-in-use').checked,
      // scanSubDir is now a global setting
      maxRetries: parseInt(document.getElementById('max-retries').value),
      delayRetry: parseInt(document.getElementById('retry-delay').value),
      delayNextFile: parseInt(document.getElementById('delay-next').value)
    }
  };

  if (!rule.name) {
    alert('Please enter a rule name');
    return;
  }

  if (currentRuleIndex >= 0) {
    rules[currentRuleIndex] = rule;
  } else {
    rules.push(rule);
  }

  saveToServer();
  closeModal();
  loadRules();
}

function deleteRule(index) {
  if (confirm('Are you sure you want to delete this rule?')) {
    rules.splice(index, 1);
    saveToServer();
    loadRules();
  }
}

function toggleRule(index) {
  rules[index].enabled = !rules[index].enabled;
  saveToServer();
  loadRules();
}

function saveToServer() {
  // Save file watcher rules to agent config
  fetch(`/api/agents/${agent.id}/filewatcher`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules })
  })
  .then(r => r.json())
  .then(data => {
    console.log('File watcher rules saved');
  })
  .catch(err => alert('Failed to save rules: ' + err.message));
}

function closeModal() {
  document.getElementById('rule-modal').style.display = 'none';
}

function clearForm() {
  document.getElementById('rule-name').value = '';
  document.getElementById('rule-description').value = '';
  document.getElementById('rule-enabled').checked = true;
  document.getElementById('watch-mode').value = 'absolute';
  updateWatchModeUI();
  document.getElementById('dir-regex').value = '';
  document.getElementById('file-regex').value = '';
  document.getElementById('content-regex').value = '';
  // ... clear other fields
}

function switchTab(tabName, buttonElement) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.form-tab').forEach(tab => {
    tab.classList.remove('active');
  });

  // Show selected tab
  document.getElementById(tabName + '-tab').classList.add('active');
  if (buttonElement) {
    buttonElement.classList.add('active');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Import INI file
document.getElementById('import-file').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    const content = event.target.result;

    fetch(`/api/agents/${agent.id}/filewatcher/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content: content })
    })
    .then(r => r.json())
    .then(data => {
      if (data.rules) {
        rules = data.rules;
        loadRules();
        // Save the imported rules
        saveRules();

        // Show success message
        const message = `✅ Successfully imported ${data.rules.length} rules from INI file`;
        console.log(message);

        // Create a temporary success banner
        const banner = document.createElement('div');
        banner.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #4CAF50; color: white; padding: 15px 20px; border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); z-index: 10000; font-weight: bold;';
        banner.textContent = message;
        document.body.appendChild(banner);

        // Remove banner after 5 seconds
        setTimeout(() => {
          banner.remove();
        }, 5000);
      }
    })
    .catch(err => {
      console.error('Import failed:', err);
      const message = `❌ Failed to import: ${err.message}`;

      // Create error banner
      const banner = document.createElement('div');
      banner.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #f44336; color: white; padding: 15px 20px; border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); z-index: 10000; font-weight: bold;';
      banner.textContent = message;
      document.body.appendChild(banner);

      setTimeout(() => {
        banner.remove();
      }, 5000);
    });
  };

  reader.readAsText(file);
});

function exportRules() {
  window.location.href = `/api/agents/${agent.id}/filewatcher/export`;
}

// Load rules and global settings on page load
loadRules();
loadGlobalSettings();
