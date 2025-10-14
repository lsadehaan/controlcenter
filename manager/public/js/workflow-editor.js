let editor;
let currentNodeId = null;
let nodeIdCounter = 1;
let currentWorkflowId = null;
let hasUnsavedChanges = false;

// Workflow data from server - read from data attribute
const workflowDataStr = document.body.dataset.workflow || 'null';
let workflowData = workflowDataStr === 'null' ? null : JSON.parse(workflowDataStr);

window.onload = function() {
  const container = document.getElementById('drawflow');

  // Clear any existing content to ensure clean initialization
  container.innerHTML = '';

  editor = new Drawflow(container);
  editor.reroute = true;
  editor.reroute_fix_curvature = true;
  editor.force_first_input = false;
  editor.line_path = 5;
  editor.zoom_max = 1.6;
  editor.zoom_min = 0.2;
  editor.zoom_value = 0.1;

  // Start editor
  editor.start();

  // Enable drag mode by default for panning
  editor.editor_mode = 'edit';

  // Add mouse navigation
  let isPanning = false;
  let startX = 0;
  let startY = 0;
  let initialX = 0;
  let initialY = 0;

  container.addEventListener('mousedown', (e) => {
    // Only pan with middle mouse button or left button + space/shift
    // Also check we're not clicking on a node (which would be for dragging)
    const clickedOnNode = e.target.closest('.drawflow-node');

    if (!clickedOnNode && (e.button === 1 || (e.button === 0 && e.shiftKey))) {
      isPanning = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = editor.canvas_x;
      initialY = editor.canvas_y;
      container.style.cursor = 'grabbing';
      e.preventDefault();
    }
  });

  container.addEventListener('mousemove', (e) => {
    if (isPanning) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      editor.canvas_x = initialX + dx;
      editor.canvas_y = initialY + dy;
      editor.updateConnectionNodes('node-1');
      e.preventDefault();
    }
  });

  container.addEventListener('mouseup', (e) => {
    if (isPanning) {
      isPanning = false;
      container.style.cursor = '';
    }
  });

  // Add keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      if (e.key === ' ') {
        container.style.cursor = 'grab';
        e.preventDefault();
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === ' ' && !isPanning) {
      container.style.cursor = '';
    }
  });

  // Mouse wheel zoom
  container.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      let newZoom = editor.zoom + delta;
      newZoom = Math.min(Math.max(newZoom, editor.zoom_min), editor.zoom_max);
      editor.zoom = newZoom;
      editor.zoom_refresh();
    }
  });

  // Force a reflow to ensure proper positioning
  container.offsetHeight;

  // Initialize splitter functionality
  initSplitter();

  // Handle drag and drop with fixed positioning
  const paletteItems = document.querySelectorAll('.palette-item');
  paletteItems.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('node-type', item.dataset.node);
    });
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData('node-type');
    if (nodeType) {
      // Get mouse position relative to the page
      const mouse_x = e.pageX;
      const mouse_y = e.pageY;

      // Get container position relative to the page (including scroll)
      const rect = container.getBoundingClientRect();
      const container_x = rect.left + window.pageXOffset;
      const container_y = rect.top + window.pageYOffset;

      // Calculate position relative to container
      let pos_x = mouse_x - container_x;
      let pos_y = mouse_y - container_y;

      // Adjust for zoom and pan
      pos_x = (pos_x - editor.canvas_x);
      pos_y = (pos_y - editor.canvas_y);

      addNode(nodeType, pos_x, pos_y);
    }
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  // Handle node selection
  editor.on('nodeSelected', (id) => {
    currentNodeId = id;
    showNodeProperties(id);
  });

  editor.on('nodeUnselected', () => {
    currentNodeId = null;
    document.getElementById('properties-content').innerHTML =
      '<p class="no-selection">Select a node to edit properties</p>';
  });

  // Track changes for unsaved warning
  editor.on('nodeCreated', () => { hasUnsavedChanges = true; updateSaveButtonState(); });
  editor.on('nodeRemoved', () => { hasUnsavedChanges = true; updateSaveButtonState(); });
  editor.on('nodeMoved', () => { hasUnsavedChanges = true; updateSaveButtonState(); });
  editor.on('connectionCreated', () => { hasUnsavedChanges = true; updateSaveButtonState(); });
  editor.on('connectionRemoved', () => { hasUnsavedChanges = true; updateSaveButtonState(); });

  // Load workflow if editing existing one
  if (workflowData) {
    currentWorkflowId = workflowData.id;
    const nameInput = document.getElementById('workflow-name');
    nameInput.value = workflowData.name || '';
    // Disable name editing when updating existing workflow
    nameInput.disabled = true;
    nameInput.title = 'Workflow name cannot be changed. Create a new workflow to use a different name.';

    // Load the drawflow data if it exists
    if (workflowData.config && workflowData.config.drawflow) {
      try {
        editor.import(workflowData.config.drawflow);
        console.log('Loaded workflow:', workflowData.name);

        // Update nodeIdCounter to avoid ID conflicts
        const nodes = workflowData.config.drawflow.drawflow?.Home?.data || {};
        const maxId = Math.max(...Object.keys(nodes).map(id => parseInt(id) || 0), 0);
        nodeIdCounter = maxId + 1;
      } catch (err) {
        console.error('Error loading workflow:', err);
        Modal.error('Error loading workflow data. Starting with empty canvas.');
      }
    }
  }

  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      return e.returnValue;
    }
  });

  // Attach event listeners to control buttons
  const saveBtn = document.getElementById('save-workflow-btn');
  const clearBtn = document.getElementById('clear-workflow-btn');
  const exportBtn = document.getElementById('export-workflow-btn');
  const importBtn = document.getElementById('import-workflow-btn');
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  const zoomResetBtn = document.getElementById('zoom-reset-btn');
  const zoomToFitBtn = document.getElementById('zoom-to-fit-btn');

  if (saveBtn) saveBtn.addEventListener('click', saveWorkflow);
  if (clearBtn) clearBtn.addEventListener('click', clearWorkflow);
  if (exportBtn) exportBtn.addEventListener('click', exportWorkflow);
  if (importBtn) importBtn.addEventListener('click', importWorkflow);
  if (zoomInBtn) zoomInBtn.addEventListener('click', zoomIn);
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);
  if (zoomResetBtn) zoomResetBtn.addEventListener('click', zoomReset);
  if (zoomToFitBtn) zoomToFitBtn.addEventListener('click', zoomToFit);

  // Event delegation for dynamically created copy buttons
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('copy-to-clipboard-btn')) {
      const textToCopy = e.target.getAttribute('data-copy-text');
      copyToClipboard(textToCopy, e);
    }
  });

  // Event delegation for copy button hover effects
  document.addEventListener('mouseover', function(e) {
    if (e.target.classList.contains('copy-to-clipboard-btn')) {
      if (e.target.classList.contains('output-copy-btn')) {
        e.target.style.background = '#218838';
      } else {
        e.target.style.background = '#0056b3';
      }
    }
  });

  document.addEventListener('mouseout', function(e) {
    if (e.target.classList.contains('copy-to-clipboard-btn')) {
      if (e.target.classList.contains('output-copy-btn')) {
        e.target.style.background = '#28a745';
      } else {
        e.target.style.background = '#007bff';
      }
    }
  });
};

// Update save button to show unsaved state
function updateSaveButtonState() {
  const saveBtn = document.getElementById('save-workflow-btn');
  if (saveBtn) {
    if (hasUnsavedChanges) {
      saveBtn.textContent = 'Save Workflow *';
      saveBtn.style.background = '#dc3545'; // Red to indicate unsaved
      saveBtn.style.borderColor = '#dc3545';
    } else {
      saveBtn.textContent = 'Save Workflow';
      saveBtn.style.background = '#007bff';
      saveBtn.style.borderColor = '#007bff';
    }
  }
}

function addNode(type, pos_x, pos_y) {
  const nodeConfigs = {
    'file-trigger': {
      name: 'File Trigger',
      class: 'node-trigger',
      inputs: 0,
      outputs: 1,
      data: { path: '', pattern: '*', events: ['create', 'modify'] }
    },
    'filewatcher-trigger': {
      name: 'File Watcher Trigger',
      class: 'node-trigger',
      inputs: 0,
      outputs: 1,
      data: { description: 'Triggered by file watcher rules' }
    },
    'schedule-trigger': {
      name: 'Schedule Trigger',
      class: 'node-trigger',
      inputs: 0,
      outputs: 1,
      data: { cron: '0 * * * *' }
    },
    'webhook-trigger': {
      name: 'Webhook Trigger',
      class: 'node-trigger',
      inputs: 0,
      outputs: 1,
      data: { path: '/webhook', method: 'POST' }
    },
    'move-file': {
      name: 'Move File',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { source: '', destination: '' }
    },
    'copy-file': {
      name: 'Copy File',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { source: '', destination: '' }
    },
    'delete-file': {
      name: 'Delete File',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { path: '' }
    },
    'run-command': {
      name: 'Run Command',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { command: '', args: [] }
    },
    'ssh-command': {
      name: 'SSH Command',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { host: '', command: '' }
    },
    'send-file': {
      name: 'Send File (SFTP)',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { source: '', destination: '', host: '' }
    },
    'http-request': {
      name: 'HTTP Request',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { url: '', method: 'GET', headers: {}, body: '' }
    },
    'condition': {
      name: 'Condition',
      class: 'node-condition',
      inputs: 1,
      outputs: 2,
      data: { expression: '', trueLabel: 'True', falseLabel: 'False' }
    },
    'loop': {
      name: 'For-Each Loop',
      class: 'node-condition',
      inputs: 1,
      outputs: 2,
      data: { items: '', itemVar: 'item' }
    },
    'alert': {
      name: 'Send Alert',
      class: 'node-output',
      inputs: 1,
      outputs: 0,
      data: { level: 'info', message: '' }
    },
    'javascript': {
      name: 'JavaScript',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { code: '// Your code here\\nreturn data;' }
    },
    'rename-file': {
      name: 'Rename File',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { source: '', newName: '' }
    },
    'archive-file': {
      name: 'Archive File',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { source: '', destination: '', format: 'zip' }
    },
    'extract-archive': {
      name: 'Extract Archive',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { source: '', destination: '' }
    },
    'run-script': {
      name: 'Run Script',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { script: '', interpreter: 'bash' }
    },
    'database-query': {
      name: 'Database Query',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { connection: '', query: '', params: [] }
    },
    'send-email': {
      name: 'Send Email',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { to: '', subject: '', body: '', attachments: [] }
    },
    'slack-message': {
      name: 'Slack Message',
      class: 'node-action',
      inputs: 1,
      outputs: 2,
      data: { webhook: '', channel: '', message: '' }
    }
  };

  const config = nodeConfigs[type];
  if (!config) return;

  const nodeId = (nodeIdCounter++);

  // Special handling for nodes with multiple outputs
  let nodeContent = `<small style="color: #666;">${type}</small>`;
  if (type === 'condition') {
    nodeContent = `
      <small style="color: #666;">Condition</small>
      <div style="margin-top: 5px; font-size: 10px;">
        <div>✓ ${config.data.trueLabel || 'True'}</div>
        <div>✗ ${config.data.falseLabel || 'False'}</div>
      </div>
    `;
  } else if (type === 'loop') {
    nodeContent = `
      <small style="color: #666;">Loop</small>
      <div style="margin-top: 5px; font-size: 10px;">
        <div>→ Each Item</div>
        <div>↓ Continue</div>
      </div>
    `;
  } else if (config.outputs === 2 && config.class === 'node-action') {
    // Action nodes with error handling
    nodeContent = `
      <small style="color: #666;">${type}</small>
      <div style="margin-top: 5px; font-size: 10px; color: #666;">
        <div style="color: #28a745;">✓ Success</div>
        <div style="color: #dc3545;">✗ Error</div>
      </div>
    `;
  }

  const html = `
    <div class="${config.class}">
      <div class="node-header">${config.name}</div>
      <div class="node-content">
        ${nodeContent}
      </div>
    </div>
  `;

  // Use type as the name but store the type in data for later reference
  // This allows multiple nodes of the same type
  const nodeData = {...config.data, nodeType: type};

  editor.addNode(
    type,  // This is the "name" parameter in Drawflow
    config.inputs,
    config.outputs,
    pos_x,
    pos_y,
    config.class,
    nodeData,
    html
  );
}

function showNodeProperties(id) {
  const nodeInfo = editor.getNodeFromId(id);
  const data = nodeInfo.data;
  const type = nodeInfo.name;

  // Create tabs for properties and inputs
  let propertiesHtml = `
    <div class="property-tabs" style="display: flex; gap: 10px; margin-bottom: 15px; border-bottom: 2px solid #dee2e6;">
      <button class="tab-button" data-tab="properties"
              style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px 4px 0 0; cursor: pointer;"
              id="properties-tab-btn">Properties</button>
      <button class="tab-button" data-tab="inputs"
              style="padding: 8px 16px; background: #e9ecef; color: #495057; border: none; border-radius: 4px 4px 0 0; cursor: pointer;"
              id="inputs-tab-btn">Available Inputs</button>
    </div>
    <div id="properties-tab-content" style="display: block;">
  `;

  // Generate property fields based on node type
  const fields = getNodeFields(type);
  fields.forEach(field => {
    const value = data[field.key] || field.default || '';
    propertiesHtml += `
      <div class="property-field">
        <label>${field.label}</label>
        ${generateFieldInput(field, value)}
      </div>
    `;
  });

  propertiesHtml += `
    <button id="update-node-properties-btn" class="btn btn-sm btn-primary">Update</button>
    </div>
    <div id="inputs-tab-content" style="display: none;">
      ${generateInputsTab(id)}
    </div>
  `;

  document.getElementById('properties-content').innerHTML = propertiesHtml;

  // Attach event listeners to dynamically created elements
  const propertiesTabBtn = document.getElementById('properties-tab-btn');
  const inputsTabBtn = document.getElementById('inputs-tab-btn');
  const updateBtn = document.getElementById('update-node-properties-btn');

  if (propertiesTabBtn) {
    propertiesTabBtn.addEventListener('click', () => showPropertiesTab('properties'));
  }
  if (inputsTabBtn) {
    inputsTabBtn.addEventListener('click', () => showPropertiesTab('inputs'));
  }
  if (updateBtn) {
    updateBtn.addEventListener('click', updateNodeProperties);
  }
}

// Show/hide property tabs
function showPropertiesTab(tab) {
  if (tab === 'properties') {
    document.getElementById('properties-tab-content').style.display = 'block';
    document.getElementById('inputs-tab-content').style.display = 'none';
    document.getElementById('properties-tab-btn').style.background = '#007bff';
    document.getElementById('properties-tab-btn').style.color = 'white';
    document.getElementById('inputs-tab-btn').style.background = '#e9ecef';
    document.getElementById('inputs-tab-btn').style.color = '#495057';
  } else {
    document.getElementById('properties-tab-content').style.display = 'none';
    document.getElementById('inputs-tab-content').style.display = 'block';
    document.getElementById('properties-tab-btn').style.background = '#e9ecef';
    document.getElementById('properties-tab-btn').style.color = '#495057';
    document.getElementById('inputs-tab-btn').style.background = '#007bff';
    document.getElementById('inputs-tab-btn').style.color = 'white';
  }
}

// Generate the inputs tab content
function generateInputsTab(nodeId) {
  const nodeInfo = editor.getNodeFromId(nodeId);
  const nodeType = nodeInfo.name;

  // Get all nodes connected to inputs of this node
  const inputs = getNodeInputs(nodeId);
  const outputs = getNodeOutputs(nodeType, nodeInfo.data);

  let html = '<div style="padding: 10px;">';
  html += '<h5>Available Input Variables</h5>';

  if (inputs.length === 0) {
    html += '<p style="color: #6c757d; font-style: italic;">No input variables available</p>';
  } else {
    html += `<table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="border-bottom: 2px solid #dee2e6;">
          <th style="text-align: left; padding: 8px;">Variable</th>
          <th style="text-align: left; padding: 8px;">Description</th>
          <th style="width: 60px; text-align: center; padding: 8px;">Copy</th>
        </tr>
      </thead>
      <tbody>`;
    inputs.forEach(variable => {
      const varString = `{{.${variable.name}}}`;
      html += `
        <tr style="border-bottom: 1px solid #e9ecef;">
          <td style="padding: 8px; font-family: monospace; font-weight: bold;">${varString}</td>
          <td style="padding: 8px; color: #6c757d;">${variable.description}</td>
          <td style="padding: 8px; text-align: center;">
            <button class="copy-to-clipboard-btn" data-copy-text="${varString}"
                    style="padding: 4px 8px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">
              📋
            </button>
          </td>
        </tr>`;
    });
    html += '</tbody></table>';
  }

  html += '<h5 style="margin-top: 20px;">This Node Outputs</h5>';
  if (outputs.length === 0) {
    html += '<p style="color: #6c757d; font-style: italic;">This node produces no additional outputs</p>';
  } else {
    html += `<table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="border-bottom: 2px solid #dee2e6;">
          <th style="text-align: left; padding: 8px;">Variable</th>
          <th style="text-align: left; padding: 8px;">Description</th>
          <th style="width: 60px; text-align: center; padding: 8px;">Copy</th>
        </tr>
      </thead>
      <tbody>`;
    outputs.forEach(variable => {
      const varString = `{{.${variable.name}}}`;
      html += `
        <tr style="border-bottom: 1px solid #e9ecef;">
          <td style="padding: 8px; font-family: monospace; font-weight: bold; color: #28a745;">${varString}</td>
          <td style="padding: 8px; color: #6c757d;">${variable.description}</td>
          <td style="padding: 8px; text-align: center;">
            <button class="copy-to-clipboard-btn output-copy-btn" data-copy-text="${varString}"
                    style="padding: 4px 8px; background: #28a745; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">
              📋
            </button>
          </td>
        </tr>`;
    });
    html += '</tbody></table>';
  }

  html += '</div>';
  return html;
}

// Copy text to clipboard
function copyToClipboard(text, event) {
  // Get the button element
  const btn = event ? event.target : document.activeElement;

  navigator.clipboard.writeText(text).then(() => {
    // Show brief feedback if we have a button reference
    if (btn && btn.tagName === 'BUTTON') {
      const originalText = btn.innerHTML;
      const originalBg = btn.style.background;
      btn.innerHTML = '✓';
      btn.style.background = '#28a745';
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.background = originalBg;
      }, 1000);
    }
  }).catch(err => {
    console.error('Failed to copy:', err);
    Modal.error('Failed to copy to clipboard');
  });
}

// Zoom controls
function zoomIn() {
  editor.zoom_in();
}

function zoomOut() {
  editor.zoom_out();
}

function zoomReset() {
  editor.zoom = 1;
  editor.zoom_refresh();
  editor.canvas_x = 0;
  editor.canvas_y = 0;
  editor.updateConnectionNodes('node-1');
}

function zoomToFit() {
  const nodes = editor.export().drawflow.Home.data;
  if (Object.keys(nodes).length === 0) return;

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  // Find bounds of all nodes
  for (const nodeId in nodes) {
    const node = nodes[nodeId];
    minX = Math.min(minX, node.pos_x);
    minY = Math.min(minY, node.pos_y);
    maxX = Math.max(maxX, node.pos_x + 250); // Approximate node width
    maxY = Math.max(maxY, node.pos_y + 100); // Approximate node height
  }

  // Calculate zoom and position to fit all nodes
  const container = document.getElementById('drawflow');
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  const nodesWidth = maxX - minX + 100; // Add padding
  const nodesHeight = maxY - minY + 100;

  const zoomX = containerWidth / nodesWidth;
  const zoomY = containerHeight / nodesHeight;
  const newZoom = Math.min(zoomX, zoomY, 1); // Don't zoom in beyond 100%

  editor.zoom = Math.max(editor.zoom_min, Math.min(editor.zoom_max, newZoom));
  editor.zoom_refresh();

  // Center the nodes
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  editor.canvas_x = (containerWidth / 2) - (centerX * editor.zoom);
  editor.canvas_y = (containerHeight / 2) - (centerY * editor.zoom);
  editor.updateConnectionNodes('node-1');
}

// Initialize splitter for resizing panels
function initSplitter() {
  const splitter = document.getElementById('splitter');
  const drawflow = document.getElementById('drawflow');
  const propertiesPanel = document.getElementById('properties-panel');
  const editorLayout = document.querySelector('.editor-layout');

  let isResizing = false;

  splitter.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const layoutRect = editorLayout.getBoundingClientRect();
    const newDrawflowWidth = e.clientX - layoutRect.left - 220 - 8; // Subtract palette width and splitter
    const newPanelWidth = layoutRect.width - newDrawflowWidth - 220 - 8;

    // Enforce minimum and maximum widths
    if (newPanelWidth >= 250 && newPanelWidth <= 600 && newDrawflowWidth >= 300) {
      drawflow.style.flex = `1 1 ${newDrawflowWidth}px`;
      propertiesPanel.style.width = `${newPanelWidth}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.cursor = '';
  });
}

// Get inputs available to a node by traversing connected nodes
function getNodeInputs(nodeId) {
  const nodeInfo = editor.getNodeFromId(nodeId);
  const connections = nodeInfo.inputs.input_1?.connections || [];

  let allInputs = [];
  const visited = new Set(); // Prevent infinite loops

  // If no connections, this node doesn't have any inputs yet
  if (connections.length === 0) {
    return [];
  }

  // Traverse all connected input nodes
  connections.forEach(conn => {
    const sourceNode = editor.getNodeFromId(conn.node);

    // Check if this is a trigger node
    if (sourceNode.name.endsWith('-trigger')) {
      // Get trigger-specific variables
      const triggerVars = getTriggerVariablesForType(sourceNode.name);
      triggerVars.forEach(variable => {
        if (!allInputs.find(v => v.name === variable.name)) {
          allInputs.push(variable);
        }
      });
    }

    // Get outputs from the connected node
    const sourceOutputs = getNodeOutputs(sourceNode.name, sourceNode.data);
    sourceOutputs.forEach(output => {
      if (!allInputs.find(v => v.name === output.name)) {
        allInputs.push(output);
      }
    });

    // Recursively get inputs from the source node (avoiding cycles)
    if (!visited.has(conn.node)) {
      visited.add(conn.node);
      const sourceInputs = getNodeInputsRecursive(conn.node, visited);
      sourceInputs.forEach(input => {
        if (!allInputs.find(v => v.name === input.name)) {
          allInputs.push(input);
        }
      });
    }
  });

  return allInputs;
}

// Recursive helper to traverse the node graph
function getNodeInputsRecursive(nodeId, visited) {
  const nodeInfo = editor.getNodeFromId(nodeId);
  const connections = nodeInfo.inputs.input_1?.connections || [];

  let allInputs = [];

  connections.forEach(conn => {
    if (!visited.has(conn.node)) {
      visited.add(conn.node);
      const sourceNode = editor.getNodeFromId(conn.node);

      // Check if this is a trigger node
      if (sourceNode.name.endsWith('-trigger')) {
        const triggerVars = getTriggerVariablesForType(sourceNode.name);
        triggerVars.forEach(variable => {
          if (!allInputs.find(v => v.name === variable.name)) {
            allInputs.push(variable);
          }
        });
      }

      // Get outputs from this node
      const sourceOutputs = getNodeOutputs(sourceNode.name, sourceNode.data);
      sourceOutputs.forEach(output => {
        if (!allInputs.find(v => v.name === output.name)) {
          allInputs.push(output);
        }
      });

      // Continue traversing
      const nestedInputs = getNodeInputsRecursive(conn.node, visited);
      nestedInputs.forEach(input => {
        if (!allInputs.find(v => v.name === input.name)) {
          allInputs.push(input);
        }
      });
    }
  });

  return allInputs;
}

// Get trigger variables for a specific trigger type
function getTriggerVariablesForType(triggerType) {
  if (triggerType === 'file-trigger' || triggerType === 'filewatcher-trigger') {
    return [
      { name: 'trigger', description: 'Trigger type (file or filewatcher)' },
      { name: 'file', description: 'Full path to the file' },
      { name: 'fileName', description: 'Just the filename without path' },
      { name: 'directory', description: 'Directory containing the file' },
      { name: 'event', description: 'Event type (CREATE, WRITE, etc.)' },
      { name: 'timestamp', description: 'When the trigger occurred' }
    ];
  } else if (triggerType === 'schedule-trigger') {
    return [
      { name: 'trigger', description: 'Trigger type (schedule)' },
      { name: 'timestamp', description: 'When the trigger occurred' },
      { name: 'scheduledTime', description: 'The scheduled execution time' }
    ];
  } else if (triggerType === 'webhook-trigger') {
    return [
      { name: 'trigger', description: 'Trigger type (webhook)' },
      { name: 'webhookData', description: 'Data received from webhook' },
      { name: 'webhookHeaders', description: 'Headers from webhook request' },
      { name: 'timestamp', description: 'When the trigger occurred' }
    ];
  } else {
    // No trigger or unknown trigger - for workflows meant to be called
    return [];
  }
}

// Legacy function for compatibility
function getTriggerVariables() {
  // Find all trigger nodes in the workflow
  const nodes = editor.export().drawflow.Home.data;
  const triggers = [];

  for (const nodeId in nodes) {
    const node = nodes[nodeId];
    if (node.name.endsWith('-trigger')) {
      triggers.push(node.name);
    }
  }

  // If there's exactly one trigger, return its variables
  if (triggers.length === 1) {
    return getTriggerVariablesForType(triggers[0]);
  }

  // Multiple or no triggers - return empty
  return [];
}

// Node type definitions with outputs
const NodeTypes = {
  // Triggers
  'file-trigger': {
    outputs: []  // Trigger outputs are handled separately
  },
  'filewatcher-trigger': {
    outputs: []  // Trigger outputs are handled separately
  },
  'schedule-trigger': {
    outputs: []  // Trigger outputs are handled separately
  },
  'webhook-trigger': {
    outputs: []  // Trigger outputs are handled separately
  },

  // File operations
  'copy-file': {
    outputs: [
      { name: 'destinationFile', description: 'Path to the copied file' },
      { name: 'success', description: 'Whether the copy was successful' }
    ]
  },
  'move-file': {
    outputs: [
      { name: 'destinationFile', description: 'Path to the moved file' },
      { name: 'success', description: 'Whether the move was successful' }
    ]
  },
  'delete-file': {
    outputs: [
      { name: 'success', description: 'Whether the deletion was successful' }
    ]
  },
  'rename-file': {
    outputs: [
      { name: 'newFile', description: 'Path to the renamed file' },
      { name: 'success', description: 'Whether the rename was successful' }
    ]
  },
  'archive-file': {
    outputs: [
      { name: 'archivePath', description: 'Path to the created archive' },
      { name: 'success', description: 'Whether the archive was created successfully' }
    ]
  },
  'extract-archive': {
    outputs: [
      { name: 'extractPath', description: 'Path where files were extracted' },
      { name: 'fileCount', description: 'Number of files extracted' },
      { name: 'success', description: 'Whether extraction was successful' }
    ]
  },

  // System actions
  'command': {
    outputs: [
      { name: 'output', description: 'Command output' },
      { name: 'exitCode', description: 'Command exit code' },
      { name: 'success', description: 'Whether command succeeded (exit code 0)' }
    ]
  },
  'run-command': {
    outputs: [
      { name: 'output', description: 'Command output' },
      { name: 'exitCode', description: 'Command exit code' },
      { name: 'success', description: 'Whether command succeeded' }
    ]
  },
  'run-script': {
    outputs: [
      { name: 'output', description: 'Script output' },
      { name: 'exitCode', description: 'Script exit code' },
      { name: 'success', description: 'Whether script succeeded' }
    ]
  },
  'ssh-command': {
    outputs: [
      { name: 'output', description: 'SSH command output' },
      { name: 'exitCode', description: 'Remote command exit code' },
      { name: 'success', description: 'Whether SSH command succeeded' }
    ]
  },
  'send-file': {
    outputs: [
      { name: 'remotePath', description: 'Path on remote server' },
      { name: 'bytesTransferred', description: 'Number of bytes transferred' },
      { name: 'success', description: 'Whether file transfer succeeded' }
    ]
  },

  // Integration
  'http-request': {
    outputs: [
      { name: 'response', description: 'HTTP response body' },
      { name: 'statusCode', description: 'HTTP status code' },
      { name: 'headers', description: 'Response headers' }
    ]
  },
  'database-query': {
    outputs: [
      { name: 'results', description: 'Query results' },
      { name: 'rowCount', description: 'Number of rows affected/returned' },
      { name: 'success', description: 'Whether query succeeded' }
    ]
  },
  'send-email': {
    outputs: [
      { name: 'messageId', description: 'Email message ID' },
      { name: 'success', description: 'Whether email was sent' }
    ]
  },
  'slack-message': {
    outputs: [
      { name: 'messageId', description: 'Slack message ID' },
      { name: 'channel', description: 'Channel where message was sent' },
      { name: 'success', description: 'Whether message was sent' }
    ]
  },

  // Logic
  'condition': {
    outputs: [
      { name: 'conditionResult', description: 'Result of the condition (true/false)' }
    ]
  },
  'loop': {
    outputs: [
      { name: 'currentItem', description: 'Current item being processed' },
      { name: 'currentIndex', description: 'Current loop index' },
      { name: 'totalItems', description: 'Total number of items' }
    ]
  },

  // Platform
  'alert': {
    outputs: []  // Alerts don't produce outputs
  },
  'log': {
    outputs: []  // Logs don't produce outputs
  },
  'wait': {
    outputs: []  // Wait doesn't produce outputs
  },
  'javascript': {
    outputs: [
      { name: 'result', description: 'JavaScript execution result' },
      { name: 'success', description: 'Whether execution succeeded' }
    ]
  }
};

// Get outputs produced by a node type
function getNodeOutputs(nodeType, nodeData) {
  const nodeDefinition = NodeTypes[nodeType];
  if (nodeDefinition && nodeDefinition.outputs) {
    return nodeDefinition.outputs;
  }
  return [];
}

function getNodeFields(type) {
  const fieldConfigs = {
    'file-trigger': [
      { key: 'path', label: 'Watch Path', type: 'text' },
      { key: 'pattern', label: 'File Pattern', type: 'text', default: '*' }
    ],
    'filewatcher-trigger': [
      { key: 'description', label: 'Description', type: 'text',
        placeholder: 'This workflow is designed to be called from file watchers' }
    ],
    'schedule-trigger': [
      { key: 'cron', label: 'Cron Expression', type: 'text', default: '0 * * * *' }
    ],
    'run-command': [
      { key: 'command', label: 'Command', type: 'text' },
      { key: 'args', label: 'Arguments', type: 'text' }
    ],
    'move-file': [
      { key: 'source', label: 'Source Path', type: 'text' },
      { key: 'destination', label: 'Destination Path', type: 'text' }
    ],
    'alert': [
      { key: 'level', label: 'Alert Level', type: 'select', options: ['info', 'warning', 'error', 'critical'] },
      { key: 'message', label: 'Message', type: 'textarea' }
    ],
    'javascript': [
      { key: 'code', label: 'JavaScript Code', type: 'textarea' }
    ],
    'copy-file': [
      { key: 'source', label: 'Source Path', type: 'text' },
      { key: 'destination', label: 'Destination Path', type: 'text' }
    ],
    'delete-file': [
      { key: 'path', label: 'File Path', type: 'text' }
    ],
    'rename-file': [
      { key: 'source', label: 'Source Path', type: 'text' },
      { key: 'newName', label: 'New Name', type: 'text' }
    ],
    'archive-file': [
      { key: 'source', label: 'Source Path', type: 'text' },
      { key: 'destination', label: 'Archive Path', type: 'text' },
      { key: 'format', label: 'Format', type: 'select', options: ['zip', 'tar', 'tar.gz', '7z'] }
    ],
    'extract-archive': [
      { key: 'source', label: 'Archive Path', type: 'text' },
      { key: 'destination', label: 'Extract To', type: 'text' }
    ],
    'run-script': [
      { key: 'script', label: 'Script Path', type: 'text' },
      { key: 'interpreter', label: 'Interpreter', type: 'select', options: ['bash', 'python', 'node', 'powershell'] }
    ],
    'ssh-command': [
      { key: 'host', label: 'Host/Agent ID', type: 'text' },
      { key: 'command', label: 'Command', type: 'text' }
    ],
    'send-file': [
      { key: 'source', label: 'Source Path', type: 'text' },
      { key: 'destination', label: 'Remote Path', type: 'text' },
      { key: 'host', label: 'Host/Agent ID', type: 'text' }
    ],
    'http-request': [
      { key: 'url', label: 'URL', type: 'text' },
      { key: 'method', label: 'Method', type: 'select', options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
      { key: 'headers', label: 'Headers (JSON)', type: 'textarea' },
      { key: 'body', label: 'Body', type: 'textarea' }
    ],
    'database-query': [
      { key: 'connection', label: 'Connection String', type: 'text' },
      { key: 'query', label: 'SQL Query', type: 'textarea' }
    ],
    'send-email': [
      { key: 'to', label: 'To', type: 'text' },
      { key: 'subject', label: 'Subject', type: 'text' },
      { key: 'body', label: 'Body', type: 'textarea' }
    ],
    'slack-message': [
      { key: 'webhook', label: 'Webhook URL', type: 'text' },
      { key: 'channel', label: 'Channel', type: 'text' },
      { key: 'message', label: 'Message', type: 'textarea' }
    ],
    'webhook-trigger': [
      { key: 'path', label: 'Webhook Path', type: 'text' },
      { key: 'method', label: 'HTTP Method', type: 'select', options: ['GET', 'POST', 'PUT'] }
    ],
    'condition': [
      { key: 'expression', label: 'JavaScript Expression', type: 'textarea' },
      { key: 'trueLabel', label: 'True Output Label', type: 'text', default: 'True' },
      { key: 'falseLabel', label: 'False Output Label', type: 'text', default: 'False' }
    ],
    'loop': [
      { key: 'items', label: 'Items Expression', type: 'text' },
      { key: 'itemVar', label: 'Item Variable', type: 'text', default: 'item' }
    ]
  };

  return fieldConfigs[type] || [];
}

function generateFieldInput(field, value) {
  if (field.type === 'textarea') {
    return `<textarea class="form-input" data-key="${field.key}">${value}</textarea>`;
  } else if (field.type === 'select') {
    const options = field.options.map(opt =>
      `<option value="${opt}" ${opt === value ? 'selected' : ''}>${opt}</option>`
    ).join('');
    return `<select class="form-input" data-key="${field.key}">${options}</select>`;
  } else {
    return `<input type="${field.type || 'text'}" class="form-input" data-key="${field.key}" value="${value}">`;
  }
}

function updateNodeProperties() {
  if (!currentNodeId) return;

  const inputs = document.querySelectorAll('#properties-content .form-input');
  const newData = {};

  inputs.forEach(input => {
    const key = input.dataset.key;
    newData[key] = input.value;
  });

  editor.updateNodeDataFromId(currentNodeId, newData);
  hasUnsavedChanges = true;
  updateSaveButtonState();
}

async function saveWorkflow() {
  const name = document.getElementById('workflow-name').value;
  if (!name) {
    await Modal.warning('Please enter a workflow name');
    return;
  }

  const drawflowData = editor.export();
  const workflowStructure = convertDrawflowToSteps(drawflowData);

  // For new workflows, generate a temporary ID. The server will replace it with a UUID.
  // For existing workflows, use the database ID to maintain consistency.
  const config = {
    id: currentWorkflowId || 'wf-' + Date.now(),
    name: name,
    enabled: true,
    drawflow: drawflowData,
    trigger: workflowStructure.trigger,
    steps: workflowStructure.steps
  };

  const url = currentWorkflowId ? `/api/workflows/${currentWorkflowId}` : '/api/workflows';
  const method = currentWorkflowId ? 'PUT' : 'POST';

  fetch(url, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name,
      description: currentWorkflowId ? 'Updated with visual editor' : 'Created with visual editor',
      config: config
    })
  })
  .then(r => r.json())
  .then(data => {
    hasUnsavedChanges = false;
    updateSaveButtonState();

    // If this is a new workflow, store the returned database ID
    if (!currentWorkflowId && data.id) {
      currentWorkflowId = data.id;
      // Update the config ID to match the database ID
      config.id = data.id;
    }

    // If this is an update to an existing workflow, ask about deploying to agents
    if (currentWorkflowId) {
      showDeploymentDialog(currentWorkflowId);
    } else {
      // New workflow - just show success and redirect
      Modal.success('Workflow created successfully!').then(() => {
        window.location.href = '/workflows';
      });
    }
  })
  .catch(err => Modal.error('Failed to save workflow: ' + err.message));
}

function showDeploymentDialog(workflowId) {
  // Fetch agents that have this workflow
  fetch(`/api/workflows/${workflowId}/agents`)
    .then(r => r.json())
    .then(async agents => {
      if (agents.length === 0) {
        const goToWorkflows = await Modal.confirm('Workflow updated successfully! This workflow is not deployed to any agents yet. Go to workflows page?', 'Workflow Updated');
        if (goToWorkflows) {
          window.location.href = '/workflows';
        }
        return;
      }

      // Create modal dialog
      const modal = document.createElement('div');
      modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;';

      const dialog = document.createElement('div');
      dialog.style.cssText = 'background: white; padding: 30px; border-radius: 8px; max-width: 600px; max-height: 80vh; overflow-y: auto;';

      let dialogHTML = `
        <h3 style="margin-top: 0;">Workflow Updated Successfully!</h3>
        <p>This workflow is currently deployed to the following agents. Select which agents to update:</p>
        <div style="margin: 20px 0;">
      `;

      agents.forEach((agent, index) => {
        dialogHTML += `
          <label style="display: block; margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">
            <input type="checkbox" name="agent-${agent.id}" value="${agent.id}" checked style="margin-right: 10px;">
            <strong>${agent.hostname || agent.id}</strong>
            <span style="color: #666; margin-left: 10px;">(${agent.status})</span>
          </label>
        `;
      });

      dialogHTML += `
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button id="close-deployment-dialog-btn" class="btn">Skip</button>
          <button id="deploy-to-selected-agents-btn" class="btn btn-primary" data-workflow-id="${workflowId}">Update Selected Agents</button>
        </div>
      `;

      dialog.innerHTML = dialogHTML;
      modal.appendChild(dialog);
      document.body.appendChild(modal);

      // Attach event listeners to dialog buttons
      const closeBtn = document.getElementById('close-deployment-dialog-btn');
      const deployBtn = document.getElementById('deploy-to-selected-agents-btn');

      if (closeBtn) {
        closeBtn.addEventListener('click', closeDeploymentDialog);
      }
      if (deployBtn) {
        deployBtn.addEventListener('click', function() {
          const wfId = this.getAttribute('data-workflow-id');
          deployToSelectedAgents(wfId);
        });
      }

      window.deploymentModal = modal;
    })
    .catch(async err => {
      console.error('Error fetching agents:', err);
      const goToWorkflows = await Modal.confirm('Workflow updated successfully! Go to workflows page?', 'Workflow Updated');
      if (goToWorkflows) {
        window.location.href = '/workflows';
      }
    });
}

function closeDeploymentDialog() {
  if (window.deploymentModal) {
    document.body.removeChild(window.deploymentModal);
    window.deploymentModal = null;
  }
  window.location.href = '/workflows';
}

async function deployToSelectedAgents(workflowId) {
  const checkboxes = document.querySelectorAll('[name^="agent-"]:checked');
  const agentIds = Array.from(checkboxes).map(cb => cb.value);

  if (agentIds.length === 0) {
    await Modal.warning('Please select at least one agent, or click Skip.');
    return;
  }

  // Deploy to selected agents
  fetch(`/api/workflows/${workflowId}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentIds })
  })
  .then(r => r.json())
  .then(async data => {
    await Modal.success(`Successfully deployed to ${data.deployed} agent(s)!`);
    closeDeploymentDialog();
  })
  .catch(async err => {
    await Modal.error('Error deploying workflow: ' + err.message);
  });
}

function convertDrawflowToSteps(drawflowData) {
  // Convert Drawflow format to workflow steps format
  const steps = [];
  let trigger = null;
  const nodes = drawflowData.drawflow?.Home?.data || {};

  for (const [id, node] of Object.entries(nodes)) {
    // Check if this is a trigger node (no inputs)
    if (node.name.includes('-trigger')) {
      trigger = {
        type: node.name.replace('-trigger', ''),
        config: node.data
      };
      // Get steps connected to this trigger
      if (node.outputs?.output_1?.connections) {
        trigger.startSteps = node.outputs.output_1.connections.map(c => 'step-' + c.node);
      }
    } else {
      // Regular step node
      steps.push({
        id: 'step-' + id,
        type: node.name,
        name: node.name,
        config: node.data,
        next: node.outputs?.output_1?.connections?.map(c => 'step-' + c.node) || [],
        onError: node.outputs?.output_2?.connections?.map(c => 'step-' + c.node) || []
      });
    }
  }

  return {
    trigger: trigger || { type: 'manual', config: {} },
    steps: steps
  };
}

async function clearWorkflow() {
  const confirmed = await Modal.confirm('Clear the current workflow?', 'Clear Workflow');
  if (confirmed) {
    editor.clear();
  }
}

function exportWorkflow() {
  const data = editor.export();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'workflow.json';
  a.click();
}

function importWorkflow() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target.result);
        editor.import(data);
      } catch (err) {
        await Modal.error('Invalid workflow file');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
