// Agent details page JavaScript
// Read agent data from data attributes
const agentId = document.body.dataset.agentId;
const agentConfig = JSON.parse(document.body.dataset.agentConfig || '{}');

let currentPage = 1;
let totalPages = 1;

// Workflow execution state
let allExecutions = [];
let filteredExecutions = [];
let workflowsMap = {};
let currentExecutionPage = 1;
let executionsPerPage = 10;
let viewMode = 'compact';
let autoRefreshInterval = null;

// Add event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Tab buttons
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const tabName = this.getAttribute('data-tab');
      switchTab(tabName, this);
    });
  });

  // Command buttons
  const commandBtns = document.querySelectorAll('.command-btn');
  commandBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const command = this.getAttribute('data-command');
      sendCommand(command);
    });
  });

  // Log level button
  const setLogLevelBtn = document.getElementById('set-log-level-btn');
  if (setLogLevelBtn) {
    setLogLevelBtn.addEventListener('click', setLogLevel);
  }

  // API address buttons
  const updateApiBtn = document.getElementById('update-api-address-btn');
  const clearApiBtn = document.getElementById('clear-api-address-btn');
  if (updateApiBtn) {
    updateApiBtn.addEventListener('click', updateApiAddress);
  }
  if (clearApiBtn) {
    clearApiBtn.addEventListener('click', clearApiAddress);
  }

  // Logs buttons
  const loadLogsBtn = document.getElementById('load-logs-btn');
  const downloadLogsBtn = document.getElementById('download-logs-btn');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  if (loadLogsBtn) {
    loadLogsBtn.addEventListener('click', () => loadLogs(1));
  }
  if (downloadLogsBtn) {
    downloadLogsBtn.addEventListener('click', downloadLogs);
  }
  if (prevBtn) {
    prevBtn.addEventListener('click', prevPage);
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', nextPage);
  }

  // Workflow buttons
  const loadDeployedWorkflowsBtn = document.getElementById('load-deployed-workflows-btn');
  if (loadDeployedWorkflowsBtn) {
    loadDeployedWorkflowsBtn.addEventListener('click', loadDeployedWorkflows);
  }

  const loadWorkflowExecutionsBtn = document.getElementById('load-workflow-executions-btn');
  if (loadWorkflowExecutionsBtn) {
    loadWorkflowExecutionsBtn.addEventListener('click', loadWorkflowExecutions);
  }

  const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
  if (autoRefreshToggle) {
    autoRefreshToggle.addEventListener('change', toggleAutoRefresh);
  }

  const viewModeBtns = document.querySelectorAll('.view-mode-btn');
  viewModeBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const mode = this.getAttribute('data-view-mode');
      setViewMode(mode, this);
    });
  });

  // Filters
  const filterWorkflow = document.getElementById('filter-workflow');
  const filterStatus = document.getElementById('filter-status');
  const filterDate = document.getElementById('filter-date');
  const filterSearch = document.getElementById('filter-search');
  const sortBy = document.getElementById('sort-by');

  if (filterWorkflow) filterWorkflow.addEventListener('change', applyFilters);
  if (filterStatus) filterStatus.addEventListener('change', applyFilters);
  if (filterDate) filterDate.addEventListener('change', applyFilters);
  if (filterSearch) filterSearch.addEventListener('keyup', applyFilters);
  if (sortBy) sortBy.addEventListener('change', applyFilters);

  // Execution pagination
  const execPrevBtn = document.getElementById('exec-prev-btn');
  const execNextBtn = document.getElementById('exec-next-btn');
  const execPageSize = document.getElementById('exec-page-size');

  if (execPrevBtn) execPrevBtn.addEventListener('click', prevExecutionPage);
  if (execNextBtn) execNextBtn.addEventListener('click', nextExecutionPage);
  if (execPageSize) execPageSize.addEventListener('change', changePageSize);

  // Metrics button
  const loadMetricsBtn = document.getElementById('load-metrics-btn');
  if (loadMetricsBtn) {
    loadMetricsBtn.addEventListener('click', loadMetrics);
  }

  // File browser buttons
  const pathSelector = document.getElementById('path-selector');
  const refreshPathBtn = document.getElementById('refresh-current-path-btn');
  const showUploadBtn = document.getElementById('show-upload-dialog-btn');
  const showCreateFolderBtn = document.getElementById('show-create-folder-dialog-btn');
  const hideUploadBtn = document.getElementById('hide-upload-dialog-btn');
  const performUploadBtn = document.getElementById('perform-upload-btn');
  const hideCreateFolderBtn = document.getElementById('hide-create-folder-dialog-btn');
  const performCreateFolderBtn = document.getElementById('perform-create-folder-btn');

  if (pathSelector) pathSelector.addEventListener('change', onPathSelected);
  if (refreshPathBtn) refreshPathBtn.addEventListener('click', refreshCurrentPath);
  if (showUploadBtn) showUploadBtn.addEventListener('click', showUploadDialog);
  if (showCreateFolderBtn) showCreateFolderBtn.addEventListener('click', showCreateFolderDialog);
  if (hideUploadBtn) hideUploadBtn.addEventListener('click', hideUploadDialog);
  if (performUploadBtn) performUploadBtn.addEventListener('click', performUpload);
  if (hideCreateFolderBtn) hideCreateFolderBtn.addEventListener('click', hideCreateFolderDialog);
  if (performCreateFolderBtn) performCreateFolderBtn.addEventListener('click', performCreateFolder);

  // Initialize path selector
  initializePathSelector();

  // Event delegation for dynamically generated file browser elements
  const fileBrowserContent = document.getElementById('file-browser-content');
  if (fileBrowserContent) {
    fileBrowserContent.addEventListener('click', function(e) {
      // Handle folder navigation
      if (e.target.classList.contains('file-name') && e.target.dataset.path && e.target.dataset.isDir === 'true') {
        loadFileBrowser(e.target.dataset.path);
      }

      // Handle download button
      if (e.target.classList.contains('file-action-btn') && e.target.dataset.action === 'download') {
        downloadFile(e.target.dataset.path, e.target.dataset.filename);
      }

      // Handle delete button
      if (e.target.classList.contains('file-action-btn') && e.target.dataset.action === 'delete') {
        deleteFileOrFolder(e.target.dataset.path, e.target.dataset.isDir === 'true');
      }
    });
  }

  // Event delegation for workflow delete buttons
  const deployedWorkflowsContent = document.getElementById('deployed-workflows-content');
  if (deployedWorkflowsContent) {
    deployedWorkflowsContent.addEventListener('click', function(e) {
      if (e.target.classList.contains('workflow-delete-btn')) {
        const workflowId = e.target.dataset.workflowId;
        const workflowName = e.target.dataset.workflowName;
        deleteWorkflowFromAgent(workflowId, workflowName);
      }
    });
  }

  // Event delegation for breadcrumb navigation
  const breadcrumbPath = document.getElementById('breadcrumb-path');
  if (breadcrumbPath) {
    breadcrumbPath.addEventListener('click', function(e) {
      if (e.target.classList.contains('breadcrumb-link')) {
        const path = e.target.dataset.path;
        loadFileBrowser(path);
      }
    });
  }

  // Event delegation for workflow execution cards
  const workflowExecutions = document.getElementById('workflow-executions');
  if (workflowExecutions) {
    workflowExecutions.addEventListener('click', function(e) {
      // Find the workflow-execution div if we clicked inside it
      const executionCard = e.target.closest('.workflow-execution');
      if (executionCard && executionCard.dataset.executionIndex) {
        const index = parseInt(executionCard.dataset.executionIndex);
        toggleExecutionDetails(index);
      }
    });
  }
});

function switchTab(tabName, buttonElement) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.classList.remove('active');
  });

  // Show selected tab
  document.getElementById(tabName + '-tab').classList.add('active');
  if (buttonElement) {
    buttonElement.classList.add('active');
  }

  // Auto-load content for specific tabs
  if (tabName === 'workflows') {
    loadDeployedWorkflows();
  } else if (tabName === 'about') {
    loadAgentInfo();
  }
}

async function loadLogs(page = 1) {
  const search = document.getElementById('log-search').value;
  const level = document.getElementById('log-level').value;
  const pageSize = document.getElementById('log-page-size').value;

  // Use Manager proxy to fetch logs from agent
  const url = `/api/agents/${agentId}/logs?page=${page}&pageSize=${pageSize}&level=${level}&search=${encodeURIComponent(search)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // Check if response contains an error
    if (data.error) {
      document.getElementById('log-viewer').innerHTML =
        `<div style="color: #f44336;">Error: ${data.error}</div>`;
      return;
    }

    // Check if data structure is valid
    if (!data.logs) {
      document.getElementById('log-viewer').innerHTML =
        '<div style="color: #f44336;">Invalid response from server</div>';
      return;
    }

    currentPage = data.page;
    totalPages = data.totalPages;

    if (data.logs.length === 0) {
      document.getElementById('log-viewer').innerHTML =
        '<div style="color: #858585;">No logs found</div>';
      document.getElementById('log-pagination').style.display = 'none';
      return;
    }

    // Render logs
    let html = '';
    data.logs.forEach(log => {
      const metadata = log.metadata && Object.keys(log.metadata).length > 0
        ? `<div class="log-metadata">${JSON.stringify(log.metadata)}</div>`
        : '';

      html += `
        <div class="log-entry ${log.level}">
          <span class="log-timestamp">${log.timestamp}</span>
          <span class="log-level ${log.level}">${log.level.toUpperCase()}</span>
          <span class="log-message">${escapeHtml(log.message)}</span>
          ${metadata}
        </div>
      `;
    });

    document.getElementById('log-viewer').innerHTML = html;

    // Update pagination
    document.getElementById('page-info').textContent =
      `Page ${data.page} of ${data.totalPages} (${data.totalLines} total lines)`;
    document.getElementById('prev-btn').disabled = data.page === 1;
    document.getElementById('next-btn').disabled = !data.hasMore;
    document.getElementById('log-pagination').style.display = 'flex';

  } catch (error) {
    document.getElementById('log-viewer').innerHTML =
      `<div style="color: #f44336;">Error loading logs: ${error.message}</div>`;
  }
}

async function downloadLogs() {
  const level = document.getElementById('log-level').value;
  const search = document.getElementById('log-search').value;

  // Use Manager proxy to download logs from agent
  const url = `/api/agents/${agentId}/logs/download?level=${level}&search=${encodeURIComponent(search)}&limit=50000`;
  window.open(url, '_blank');
}

function prevPage() {
  if (currentPage > 1) {
    loadLogs(currentPage - 1);
  }
}

function nextPage() {
  if (currentPage < totalPages) {
    loadLogs(currentPage + 1);
  }
}

async function loadDeployedWorkflows() {
  const contentDiv = document.getElementById('deployed-workflows-content');

  try {
    contentDiv.innerHTML = '<p style="color: #666;">Loading workflows from agent...</p>';

    // Fetch deployed workflows from agent
    const response = await fetch(`/api/agents/${agentId}/workflows/state`);
    const data = await response.json();

    if (data.error) {
      contentDiv.innerHTML = `<div style="color: #dc3545;">Error: ${data.error}</div>`;
      return;
    }

    if (!data.workflows || data.workflows.length === 0) {
      contentDiv.innerHTML = '<p style="color: #666;">No workflows deployed to this agent</p>';
      return;
    }

    // Render workflows as a table
    let html = `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 2px solid #dee2e6; text-align: left;">
            <th style="padding: 10px;">Name</th>
            <th style="padding: 10px;">ID</th>
            <th style="padding: 10px;">Trigger</th>
            <th style="padding: 10px;">Status</th>
            <th style="padding: 10px;">Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.workflows.forEach(wf => {
      const triggerType = wf.trigger?.type || 'manual';
      const triggerIcon = {
        'file': '📁',
        'filewatcher': '📁',
        'schedule': '📅',
        'webhook': '🔗',
        'manual': '👤'
      }[triggerType] || '❓';

      const enabledBadge = wf.enabled ?
        '<span class="status-badge online">Enabled</span>' :
        '<span class="status-badge offline">Disabled</span>';

      html += `
        <tr style="border-bottom: 1px solid #e9ecef;">
          <td style="padding: 10px;">
            <strong>${escapeHtml(wf.name || 'Unnamed Workflow')}</strong>
          </td>
          <td style="padding: 10px; font-family: monospace; font-size: 12px; color: #666;">
            ${escapeHtml(wf.id)}
          </td>
          <td style="padding: 10px;">
            <span style="background: #e9ecef; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
              ${triggerIcon} ${triggerType}
            </span>
          </td>
          <td style="padding: 10px;">
            ${enabledBadge}
          </td>
          <td style="padding: 10px;">
            <button class="file-action-btn delete workflow-delete-btn" data-workflow-id="${escapeHtml(wf.id)}" data-workflow-name="${escapeHtml(wf.name || 'Unnamed Workflow')}">🗑️ Delete</button>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    contentDiv.innerHTML = html;

    // Also update the workflowsMap for use in executions
    data.workflows.forEach(wf => {
      workflowsMap[wf.id] = wf;
    });

  } catch (error) {
    contentDiv.innerHTML = `<div style="color: #dc3545;">Error loading workflows: ${error.message}</div>`;
  }
}

async function deleteWorkflowFromAgent(workflowId, workflowName) {
  const confirmed = await Modal.confirm(
    `Are you sure you want to remove this workflow from the agent?\n\nWorkflow: ${workflowName}\nID: ${workflowId}\n\nThis will remove the workflow from the agent's configuration.`,
    'Delete Workflow'
  );

  if (!confirmed) {
    return;
  }

  try {
    const url = `/api/agents/${agentId}/workflows/${workflowId}`;
    const response = await fetch(url, { method: 'DELETE' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Delete failed');
    }

    await Modal.success(`Workflow "${workflowName}" removed from agent successfully`);
    loadDeployedWorkflows();

  } catch (error) {
    await Modal.error('Delete workflow failed: ' + error.message);
  }
}

async function loadWorkflowExecutions() {
  try {
    // Fetch deployed workflows from agent (these have the actual names)
    const workflowStateResponse = await fetch(`/api/agents/${agentId}/workflows/state`);
    if (workflowStateResponse.ok) {
      const workflowStateData = await workflowStateResponse.json();
      workflowsMap = {};
      if (workflowStateData.workflows) {
        workflowStateData.workflows.forEach(wf => {
          workflowsMap[wf.id] = wf;
        });
      }
    }

    // Populate workflow filter dropdown
    const filterWorkflow = document.getElementById('filter-workflow');
    filterWorkflow.innerHTML = '<option value="">All Workflows</option>';
    Object.values(workflowsMap).forEach(wf => {
      filterWorkflow.innerHTML += `<option value="${wf.id}">${wf.name || wf.id}</option>`;
    });

    // Fetch executions from agent
    const response = await fetch(`/api/agents/${agentId}/workflows/executions`);
    const data = await response.json();

    if (!data.executions || data.executions.length === 0) {
      document.getElementById('workflow-executions').innerHTML =
        '<p style="color: #666;">No workflow executions found</p>';
      document.getElementById('execution-stats').style.display = 'none';
      document.getElementById('execution-pagination').style.display = 'none';
      return;
    }

    allExecutions = data.executions;
    applyFilters();

  } catch (error) {
    document.getElementById('workflow-executions').innerHTML =
      `<div style="color: #f44336;">Error: ${error.message}</div>`;
  }
}

function applyFilters() {
  const workflowFilter = document.getElementById('filter-workflow').value;
  const statusFilter = document.getElementById('filter-status').value;
  const dateFilter = document.getElementById('filter-date').value;
  const searchQuery = document.getElementById('filter-search').value.toLowerCase();
  const sortBy = document.getElementById('sort-by').value;

  // Apply filters
  filteredExecutions = allExecutions.filter(exec => {
    // Workflow filter
    if (workflowFilter && exec.workflowId !== workflowFilter) return false;

    // Status filter
    if (statusFilter && exec.status !== statusFilter) return false;

    // Date filter
    if (dateFilter !== 'all') {
      const execTime = new Date(exec.startTime).getTime();
      const now = Date.now();
      const cutoff = {
        '1h': now - (60 * 60 * 1000),
        '24h': now - (24 * 60 * 60 * 1000),
        '7d': now - (7 * 24 * 60 * 60 * 1000),
        '30d': now - (30 * 24 * 60 * 60 * 1000)
      }[dateFilter];
      if (execTime < cutoff) return false;
    }

    // Search filter
    if (searchQuery) {
      const searchableText = [
        exec.error || '',
        JSON.stringify(exec.context || {}),
        exec.workflowId,
        workflowsMap[exec.workflowId]?.name || ''
      ].join(' ').toLowerCase();
      if (!searchableText.includes(searchQuery)) return false;
    }

    return true;
  });

  // Apply sorting
  filteredExecutions.sort((a, b) => {
    const aTime = new Date(a.startTime).getTime();
    const bTime = new Date(b.startTime).getTime();
    const aDuration = a.endTime ? (new Date(a.endTime) - new Date(a.startTime)) / 1000 : 0;
    const bDuration = b.endTime ? (new Date(b.endTime) - new Date(b.startTime)) / 1000 : 0;

    switch (sortBy) {
      case 'newest': return bTime - aTime;
      case 'oldest': return aTime - bTime;
      case 'duration-desc': return bDuration - aDuration;
      case 'duration-asc': return aDuration - bDuration;
      default: return bTime - aTime;
    }
  });

  // Update statistics
  updateStatistics();

  // Reset to page 1 and render
  currentExecutionPage = 1;
  renderExecutions();
}

function updateStatistics() {
  const total = filteredExecutions.length;
  const success = filteredExecutions.filter(e => e.status === 'completed').length;
  const failed = filteredExecutions.filter(e => e.status === 'failed').length;

  const durations = filteredExecutions
    .filter(e => e.endTime)
    .map(e => (new Date(e.endTime) - new Date(e.startTime)) / 1000);
  const avgDuration = durations.length > 0
    ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)
    : 0;

  const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : 0;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-success').textContent = success;
  document.getElementById('stat-failed').textContent = failed;
  document.getElementById('stat-avg-duration').textContent = avgDuration + 's';
  document.getElementById('stat-success-rate').textContent = successRate + '%';
  document.getElementById('execution-stats').style.display = total > 0 ? 'flex' : 'none';
}

function renderExecutions() {
  const start = (currentExecutionPage - 1) * executionsPerPage;
  const end = start + executionsPerPage;
  const pageExecutions = filteredExecutions.slice(start, end);

  if (pageExecutions.length === 0) {
    document.getElementById('workflow-executions').innerHTML =
      '<p style="color: #666;">No executions match the current filters</p>';
    document.getElementById('execution-pagination').style.display = 'none';
    return;
  }

  let html = '';
  pageExecutions.forEach((exec, idx) => {
    html += renderExecutionCard(exec, start + idx);
  });

  document.getElementById('workflow-executions').innerHTML = html;

  // Update pagination
  const totalPages = Math.ceil(filteredExecutions.length / executionsPerPage);
  document.getElementById('exec-page-info').textContent =
    `Page ${currentExecutionPage} of ${totalPages} (${filteredExecutions.length} total)`;
  document.getElementById('exec-prev-btn').disabled = currentExecutionPage === 1;
  document.getElementById('exec-next-btn').disabled = currentExecutionPage >= totalPages;
  document.getElementById('execution-pagination').style.display = 'flex';
}

function renderExecutionCard(exec, index) {
  const workflow = workflowsMap[exec.workflowId] || {};
  const workflowName = workflow.name || exec.workflowId;
  const duration = exec.endTime ?
    ((new Date(exec.endTime) - new Date(exec.startTime)) / 1000).toFixed(2) + 's' :
    'Running...';
  const triggerIcon = {
    'file': '📁',
    'filewatcher': '📁',
    'schedule': '📅',
    'webhook': '🔗',
    'manual': '👤'
  }[exec.context?.trigger || 'manual'] || '❓';

  const triggerType = exec.context?.trigger || 'manual';
  const startTime = new Date(exec.startTime);
  const timeAgo = getTimeAgo(startTime);

  let detailsHtml = '';
  if (viewMode === 'detailed' || exec.error) {
    detailsHtml = `
      <div class="workflow-details expanded">
        ${renderExecutionDetails(exec)}
      </div>
    `;
  }

  return `
    <div class="workflow-execution ${exec.status}" data-execution-index="${index}">
      <div class="workflow-header">
        <div class="workflow-title">
          <h4>${escapeHtml(workflowName)}</h4>
          <span class="workflow-id" title="${exec.workflowId}">${exec.workflowId.substring(0, 8)}...</span>
          <span class="status-badge ${exec.status}">${exec.status}</span>
        </div>
      </div>
      <div class="workflow-meta">
        <div class="workflow-meta-item">
          <span class="trigger-badge">${triggerIcon} ${triggerType}</span>
        </div>
        <div class="workflow-meta-item">
          ⏱️ ${duration}
        </div>
        <div class="workflow-meta-item">
          🕒 ${timeAgo}
        </div>
        <div class="workflow-meta-item">
          ✓ ${exec.completedSteps ? exec.completedSteps.length : 0} steps
        </div>
      </div>
      ${detailsHtml}
    </div>
  `;
}

function renderExecutionDetails(exec) {
  const workflow = workflowsMap[exec.workflowId] || {};
  let html = '';

  // Context information
  if (exec.context && Object.keys(exec.context).length > 0) {
    html += `
      <div style="margin-bottom: 10px;">
        <strong style="font-size: 13px;">Context:</strong>
        <div class="context-viewer">${JSON.stringify(exec.context, null, 2)}</div>
      </div>
    `;
  }

  // Steps
  if (exec.completedSteps && exec.completedSteps.length > 0) {
    html += `
      <div style="margin-bottom: 10px;">
        <strong style="font-size: 13px;">Completed Steps:</strong>
        <ul class="step-list">
    `;
    exec.completedSteps.forEach(stepId => {
      const step = workflow.config?.steps?.find(s => s.id === stepId);
      const stepName = step?.name || stepId;
      html += `<li class="step-item">✓ ${escapeHtml(stepName)} <span style="color: #6c757d; font-family: monospace; font-size: 11px;">(${stepId})</span></li>`;
    });
    html += '</ul></div>';
  }

  // Error details
  if (exec.error) {
    html += `
      <div>
        <strong style="font-size: 13px; color: #dc3545;">Error:</strong>
        <div class="error-details">${escapeHtml(exec.error)}</div>
      </div>
    `;
  }

  // Timing
  html += `
    <div style="margin-top: 10px; font-size: 12px; color: #6c757d;">
      <div><strong>Started:</strong> ${new Date(exec.startTime).toLocaleString()}</div>
      ${exec.endTime ? `<div><strong>Ended:</strong> ${new Date(exec.endTime).toLocaleString()}</div>` : ''}
    </div>
  `;

  return html;
}

function toggleExecutionDetails(index) {
  // Prevent default if we're clicking on the card itself
  if (viewMode === 'detailed') return; // Already showing details

  const start = (currentExecutionPage - 1) * executionsPerPage;
  const exec = filteredExecutions[start + index];

  // Re-render just this execution with details toggled
  const cards = document.querySelectorAll('.workflow-execution');
  const card = cards[index];
  const details = card.querySelector('.workflow-details');

  if (details) {
    details.remove();
  } else {
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'workflow-details expanded';
    detailsDiv.innerHTML = renderExecutionDetails(exec);
    card.appendChild(detailsDiv);
  }
}

function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function prevExecutionPage() {
  if (currentExecutionPage > 1) {
    currentExecutionPage--;
    renderExecutions();
  }
}

function nextExecutionPage() {
  const totalPages = Math.ceil(filteredExecutions.length / executionsPerPage);
  if (currentExecutionPage < totalPages) {
    currentExecutionPage++;
    renderExecutions();
  }
}

function changePageSize() {
  executionsPerPage = parseInt(document.getElementById('exec-page-size').value);
  currentExecutionPage = 1;
  renderExecutions();
}

function setViewMode(mode, buttonElement) {
  viewMode = mode;
  document.querySelectorAll('.view-toggle button').forEach(btn => {
    btn.classList.remove('active');
  });
  if (buttonElement) {
    buttonElement.classList.add('active');
  }
  renderExecutions();
}

function toggleAutoRefresh() {
  const checkbox = document.getElementById('auto-refresh-toggle');
  const intervalSelect = document.getElementById('auto-refresh-interval');

  if (checkbox.checked) {
    intervalSelect.disabled = false;
    const interval = parseInt(intervalSelect.value);
    autoRefreshInterval = setInterval(loadWorkflowExecutions, interval);
  } else {
    intervalSelect.disabled = true;
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }
}

// Stop auto-refresh when leaving the page
window.addEventListener('beforeunload', () => {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
});

async function loadMetrics() {
  try {
    // Use Manager proxy to fetch metrics from agent
    const response = await fetch(`/api/agents/${agentId}/metrics`);
    const metrics = await response.json();

    const html = `
      <div class="metric-card">
        <h4>Agent Metrics</h4>
        <div class="metric-row">
          <span>Workflows Loaded:</span>
          <strong>${metrics.workflowsLoaded}</strong>
        </div>
        <div class="metric-row">
          <span>Log File Size:</span>
          <strong>${formatBytes(metrics.logFileSizeBytes)}</strong>
        </div>
        <div class="metric-row">
          <span>State File Size:</span>
          <strong>${formatBytes(metrics.stateFileSizeBytes)}</strong>
        </div>
        <div class="metric-row">
          <span>Platform:</span>
          <strong>${metrics.platform}</strong>
        </div>
        <div class="metric-row">
          <span>Hostname:</span>
          <strong>${metrics.hostname}</strong>
        </div>
      </div>
    `;

    document.getElementById('metrics-content').innerHTML = html;

  } catch (error) {
    document.getElementById('metrics-content').innerHTML =
      `<div style="color: #f44336;">Error: ${error.message}</div>`;
  }
}

async function loadAgentInfo() {
  try {
    // Use Manager proxy to fetch agent info
    const response = await fetch(`/api/agents/${agentId}/info`);
    const info = await response.json();

    if (info.error) {
      document.getElementById('agent-about-content').innerHTML =
        `<div style="color: #f44336;">Error: ${info.error}</div>`;
      return;
    }

    const html = `
      <div class="metric-row">
        <span>Agent Version:</span>
        <strong>${escapeHtml(info.version || 'Unknown')}</strong>
      </div>
      <div class="metric-row">
        <span>Platform:</span>
        <strong>${escapeHtml(info.platform || 'Unknown')}</strong>
      </div>
      <div class="metric-row">
        <span>Hostname:</span>
        <strong>${escapeHtml(info.hostname || 'Unknown')}</strong>
      </div>
      <div class="metric-row">
        <span>Agent ID:</span>
        <strong style="font-family: monospace; font-size: 12px;">${escapeHtml(info.agentId || 'Unknown')}</strong>
      </div>
      <div class="metric-row">
        <span>SSH Port:</span>
        <strong>${info.sshPort || 'N/A'}</strong>
      </div>
      <div class="metric-row">
        <span>Workflows:</span>
        <strong>${info.workflows || 0}</strong>
      </div>
    `;

    document.getElementById('agent-about-content').innerHTML = html;

  } catch (error) {
    document.getElementById('agent-about-content').innerHTML =
      `<div style="color: #f44336;">Error: ${error.message}</div>`;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function sendCommand(command, payload = {}) {
  const resultDiv = document.getElementById('command-result');
  resultDiv.style.display = 'block';
  resultDiv.style.background = '#fff3cd';
  resultDiv.style.color = '#856404';
  resultDiv.textContent = `Sending ${command} command...`;

  try {
    const response = await fetch(`/api/agents/${agentId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, ...payload })
    });

    const data = await response.json();

    if (response.ok) {
      resultDiv.style.background = '#d4edda';
      resultDiv.style.color = '#155724';
      resultDiv.textContent = `✓ Command ${command} sent successfully`;
      setTimeout(() => resultDiv.style.display = 'none', 5000);
    } else {
      resultDiv.style.background = '#f8d7da';
      resultDiv.style.color = '#721c24';
      resultDiv.textContent = `✗ Failed: ${data.error || 'Unknown error'}`;
    }
  } catch (error) {
    resultDiv.style.background = '#f8d7da';
    resultDiv.style.color = '#721c24';
    resultDiv.textContent = `✗ Error: ${error.message}`;
  }
}

async function setLogLevel() {
  const select = document.getElementById('log-level-select');
  const level = select.value;
  await sendCommand('set-log-level', { level });
}

async function updateApiAddress() {
  let apiAddress = document.getElementById('new-api-address').value.trim();

  if (!apiAddress) {
    await Modal.warning('Please enter an API address or click "Clear" to use auto-detect');
    return;
  }

  // Strip http:// or https:// prefix if present
  apiAddress = apiAddress.replace(/^https?:\/\//, '');

  const resultDiv = document.getElementById('api-update-result');
  resultDiv.style.display = 'block';
  resultDiv.style.background = '#fff3cd';
  resultDiv.style.color = '#856404';
  resultDiv.textContent = 'Updating API address...';

  try {
    const response = await fetch(`/api/agents/${agentId}/api-address`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiAddress })
    });

    const data = await response.json();

    if (response.ok) {
      resultDiv.style.background = '#d4edda';
      resultDiv.style.color = '#155724';
      resultDiv.textContent = '✓ API address updated successfully';
      document.getElementById('current-api-address').textContent = apiAddress;
      document.getElementById('new-api-address').value = '';
      setTimeout(() => resultDiv.style.display = 'none', 5000);
    } else {
      resultDiv.style.background = '#f8d7da';
      resultDiv.style.color = '#721c24';
      resultDiv.textContent = `✗ Failed: ${data.error || 'Unknown error'}`;
    }
  } catch (error) {
    resultDiv.style.background = '#f8d7da';
    resultDiv.style.color = '#721c24';
    resultDiv.textContent = `✗ Error: ${error.message}`;
  }
}

async function clearApiAddress() {
  const resultDiv = document.getElementById('api-update-result');
  resultDiv.style.display = 'block';
  resultDiv.style.background = '#fff3cd';
  resultDiv.style.color = '#856404';
  resultDiv.textContent = 'Clearing API address...';

  try {
    const response = await fetch(`/api/agents/${agentId}/api-address`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiAddress: null })
    });

    const data = await response.json();

    if (response.ok) {
      resultDiv.style.background = '#d4edda';
      resultDiv.style.color = '#155724';
      resultDiv.textContent = '✓ API address cleared - now using auto-detect';
      document.getElementById('current-api-address').textContent = 'Auto-detect from connection IP';
      document.getElementById('new-api-address').value = '';
      setTimeout(() => resultDiv.style.display = 'none', 5000);
    } else {
      resultDiv.style.background = '#f8d7da';
      resultDiv.style.color = '#721c24';
      resultDiv.textContent = `✗ Failed: ${data.error || 'Unknown error'}`;
    }
  } catch (error) {
    resultDiv.style.background = '#f8d7da';
    resultDiv.style.color = '#721c24';
    resultDiv.textContent = `✗ Error: ${error.message}`;
  }
}

// File Browser State
let currentPath = '';

// Populate path selector on page load
function initializePathSelector() {
  const selector = document.getElementById('path-selector');
  const fileBrowserSettings = agentConfig.config?.fileBrowserSettings;

  if (!fileBrowserSettings || !fileBrowserSettings.allowedPaths || fileBrowserSettings.allowedPaths.length === 0) {
    selector.innerHTML = '<option value="">No allowed paths configured</option>';
    selector.disabled = true;
    return;
  }

  selector.innerHTML = '<option value="">Select a path to browse...</option>';
  fileBrowserSettings.allowedPaths.forEach(path => {
    selector.innerHTML += `<option value="${path}">${path}</option>`;
  });

  // Auto-select and load the first path
  if (fileBrowserSettings.allowedPaths.length > 0) {
    selector.selectedIndex = 1; // Skip the "Select a path..." option
    loadFileBrowser(fileBrowserSettings.allowedPaths[0]);
  }
}

// Called when dropdown selection changes
function onPathSelected() {
  const selector = document.getElementById('path-selector');
  const selectedPath = selector.value;
  if (selectedPath) {
    loadFileBrowser(selectedPath);
  }
}

// Refresh the current path
async function refreshCurrentPath() {
  const selector = document.getElementById('path-selector');
  const selectedPath = selector.value;

  if (!selectedPath) {
    await Modal.warning('Please select a path first');
    return;
  }

  loadFileBrowser(selectedPath);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initializePathSelector();
});

async function loadFileBrowser(path = '') {
  currentPath = path;
  const statusDiv = document.getElementById('file-browser-status');
  const contentDiv = document.getElementById('file-browser-content');

  statusDiv.textContent = 'Loading...';
  statusDiv.style.color = '#666';

  try {
    const url = `/api/agents/${agentId}/files/browse?path=${encodeURIComponent(path)}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to browse directory');
    }

    renderFileBrowser(data);
    statusDiv.textContent = `${data.files?.length || 0} items`;
    statusDiv.style.color = '#28a745';

  } catch (error) {
    contentDiv.innerHTML = `<div style="color: #dc3545; padding: 20px; text-align: center;">❌ Error: ${escapeHtml(error.message)}</div>`;
    statusDiv.textContent = 'Error';
    statusDiv.style.color = '#dc3545';
  }
}

function renderFileBrowser(data) {
  const contentDiv = document.getElementById('file-browser-content');
  const breadcrumbDiv = document.getElementById('breadcrumb');
  const breadcrumbPath = document.getElementById('breadcrumb-path');

  // Update breadcrumb
  if (data.path) {
    breadcrumbDiv.style.display = 'block';
    breadcrumbPath.innerHTML = renderBreadcrumb(data.path);
  } else {
    breadcrumbDiv.style.display = 'none';
  }

  if (!data.files || data.files.length === 0) {
    contentDiv.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">📁 Empty directory</div>';
    return;
  }

  // Sort: directories first, then files
  const sorted = data.files.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  let html = '<ul class="file-list">';

  sorted.forEach(item => {
    const icon = item.isDir ? '📁' : getFileIcon(item.name);
    const sizeText = item.isDir ? '' : formatBytes(item.size);
    const dateText = item.modTime ? new Date(item.modTime).toLocaleString() : '';
    const itemPath = data.path ? `${data.path}/${item.name}` : item.name;

    html += `
      <li class="file-item ${item.isDir ? 'directory' : 'file'}">
        <span class="file-icon">${icon}</span>
        <span class="file-name ${item.isDir ? 'clickable' : ''}" data-path="${escapeHtml(itemPath)}" data-is-dir="${item.isDir}" style="${item.isDir ? 'cursor: pointer;' : ''}">
          ${escapeHtml(item.name)}
        </span>
        <span class="file-size">${sizeText}</span>
        <span class="file-date">${dateText}</span>
        <div class="file-actions">
          ${!item.isDir ? `<button class="file-action-btn" data-action="download" data-path="${escapeHtml(itemPath)}" data-filename="${escapeHtml(item.name)}">⬇️ Download</button>` : ''}
          <button class="file-action-btn delete" data-action="delete" data-path="${escapeHtml(itemPath)}" data-is-dir="${item.isDir}">🗑️ Delete</button>
        </div>
      </li>
    `;
  });

  html += '</ul>';
  contentDiv.innerHTML = html;
}

function renderBreadcrumb(path) {
  if (!path) return '<a class="breadcrumb-link" data-path="">Home</a>';

  const parts = path.split('/').filter(p => p);
  let html = '<a class="breadcrumb-link" data-path="">Home</a>';
  let accumulated = '';

  parts.forEach((part, idx) => {
    accumulated += (accumulated ? '/' : '') + part;
    const isLast = idx === parts.length - 1;
    if (isLast) {
      html += ` / <span style="color: #212529;">${escapeHtml(part)}</span>`;
    } else {
      html += ` / <a class="breadcrumb-link" data-path="${escapeHtml(accumulated)}">${escapeHtml(part)}</a>`;
    }
  });

  return html;
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    'txt': '📄', 'md': '📄', 'log': '📄',
    'js': '📜', 'json': '📜', 'ts': '📜', 'go': '📜', 'py': '📜',
    'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️',
    'zip': '📦', 'tar': '📦', 'gz': '📦',
    'exe': '⚙️', 'dll': '⚙️', 'so': '⚙️',
    'pdf': '📕', 'doc': '📘', 'docx': '📘'
  };
  return icons[ext] || '📄';
}

async function downloadFile(path, filename) {
  try {
    const url = `/api/agents/${agentId}/files/download?path=${encodeURIComponent(path)}`;
    const response = await fetch(url);

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Download failed');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);

  } catch (error) {
    await Modal.error('Download failed: ' + error.message);
  }
}

async function deleteFileOrFolder(path, isDir) {
  const itemType = isDir ? 'folder' : 'file';
  const confirmed = await Modal.confirm(
    `Are you sure you want to delete this ${itemType}?\n\n${path}`,
    `Delete ${itemType.charAt(0).toUpperCase() + itemType.slice(1)}`
  );

  if (!confirmed) {
    return;
  }

  try {
    const url = `/api/agents/${agentId}/files/delete?path=${encodeURIComponent(path)}`;
    const response = await fetch(url, { method: 'DELETE' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Delete failed');
    }

    await Modal.success(`${itemType.charAt(0).toUpperCase() + itemType.slice(1)} deleted successfully`);
    loadFileBrowser(currentPath);

  } catch (error) {
    await Modal.error('Delete failed: ' + error.message);
  }
}

function showUploadDialog() {
  document.getElementById('upload-path').value = currentPath || '/';
  document.getElementById('upload-file-input').value = '';
  document.getElementById('upload-dialog').style.display = 'flex';
  document.getElementById('upload-progress').style.display = 'none';
}

function hideUploadDialog() {
  document.getElementById('upload-dialog').style.display = 'none';
}

async function performUpload() {
  const fileInput = document.getElementById('upload-file-input');
  const file = fileInput.files[0];

  if (!file) {
    await Modal.warning('Please select a file to upload');
    return;
  }

  const progressDiv = document.getElementById('upload-progress');
  const progressBar = document.getElementById('upload-progress-bar');
  progressDiv.style.display = 'block';
  progressBar.style.width = '0%';
  progressBar.textContent = '0%';

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', currentPath);

    const url = `/api/agents/${agentId}/files/upload`;

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = percent + '%';
        progressBar.textContent = percent + '%';
      }
    });

    xhr.addEventListener('load', async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        await Modal.success('File uploaded successfully');
        hideUploadDialog();
        loadFileBrowser(currentPath);
      } else {
        const data = JSON.parse(xhr.responseText);
        await Modal.error('Upload failed: ' + (data.error || 'Unknown error'));
        progressDiv.style.display = 'none';
      }
    });

    xhr.addEventListener('error', async () => {
      await Modal.error('Upload failed: Network error');
      progressDiv.style.display = 'none';
    });

    xhr.open('POST', url);
    xhr.send(formData);

  } catch (error) {
    await Modal.error('Upload failed: ' + error.message);
    progressDiv.style.display = 'none';
  }
}

function showCreateFolderDialog() {
  document.getElementById('create-folder-parent').value = currentPath || '/';
  document.getElementById('create-folder-name').value = '';
  document.getElementById('create-folder-dialog').style.display = 'flex';
}

function hideCreateFolderDialog() {
  document.getElementById('create-folder-dialog').style.display = 'none';
}

async function performCreateFolder() {
  const folderName = document.getElementById('create-folder-name').value.trim();

  if (!folderName) {
    await Modal.warning('Please enter a folder name');
    return;
  }

  const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;

  try {
    const url = `/api/agents/${agentId}/files/mkdir?path=${encodeURIComponent(newPath)}`;
    const response = await fetch(url, { method: 'POST' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Create folder failed');
    }

    await Modal.success('Folder created successfully');
    hideCreateFolderDialog();
    loadFileBrowser(currentPath);

  } catch (error) {
    await Modal.error('Create folder failed: ' + error.message);
  }
}

function escapeJsString(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}
