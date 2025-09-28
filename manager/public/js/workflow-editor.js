// Workflow Editor JavaScript
let editor;
let currentNodeId = null;
let nodeIdCounter = 1;

function initializeEditor() {
  const container = document.getElementById('drawflow');
  if (!container) {
    console.error('Drawflow container not found');
    return;
  }

  // Initialize Drawflow
  editor = new Drawflow(container);
  editor.reroute = true;
  editor.reroute_fix_curvature = true;
  editor.force_first_input = false;
  editor.line_path = 5;
  editor.editor_mode = 'edit';
  
  editor.start();
  
  console.log('Drawflow editor initialized');
  
  // Setup drag and drop
  setupDragAndDrop();
  
  // Setup event handlers
  setupEventHandlers();
}

function setupDragAndDrop() {
  // Make palette items draggable
  const paletteItems = document.querySelectorAll('.palette-item');
  paletteItems.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('node-type', item.dataset.node);
    });
  });
  
  // Handle drop on canvas
  const container = document.getElementById('drawflow');
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData('node-type');
    if (nodeType) {
      // Calculate position relative to the Drawflow canvas
      const pos_x = e.clientX * (editor.precanvas.clientWidth / (editor.precanvas.clientWidth * editor.zoom)) - 
                    (editor.precanvas.getBoundingClientRect().x * (editor.precanvas.clientWidth / (editor.precanvas.clientWidth * editor.zoom)));
      const pos_y = e.clientY * (editor.precanvas.clientHeight / (editor.precanvas.clientHeight * editor.zoom)) - 
                    (editor.precanvas.getBoundingClientRect().y * (editor.precanvas.clientHeight / (editor.precanvas.clientHeight * editor.zoom)));
      
      addNode(nodeType, pos_x, pos_y);
    }
  });
  
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
}

function setupEventHandlers() {
  editor.on('nodeSelected', (id) => {
    currentNodeId = id;
    showNodeProperties(id);
  });
  
  editor.on('nodeUnselected', () => {
    currentNodeId = null;
    document.getElementById('properties-content').innerHTML = 
      '<p class="no-selection">Select a node to edit properties</p>';
  });
  
  editor.on('nodeRemoved', (id) => {
    if (currentNodeId === id) {
      currentNodeId = null;
      document.getElementById('properties-content').innerHTML = 
        '<p class="no-selection">Select a node to edit properties</p>';
    }
  });
}

function addNode(type, x, y) {
  const nodeConfigs = {
    'file-trigger': {
      name: 'File Trigger',
      class: 'node-trigger',
      inputs: 0,
      outputs: 1,
      data: { path: '', pattern: '*', events: ['create', 'modify'] }
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
      outputs: 1,
      data: { source: '', destination: '' }
    },
    'copy-file': {
      name: 'Copy File',
      class: 'node-action',
      inputs: 1,
      outputs: 1,
      data: { source: '', destination: '' }
    },
    'delete-file': {
      name: 'Delete File',
      class: 'node-action',
      inputs: 1,
      outputs: 1,
      data: { path: '' }
    },
    'run-command': {
      name: 'Run Command',
      class: 'node-action',
      inputs: 1,
      outputs: 1,
      data: { command: '', args: [] }
    },
    'ssh-command': {
      name: 'SSH Command',
      class: 'node-action',
      inputs: 1,
      outputs: 1,
      data: { host: '', command: '' }
    },
    'send-file': {
      name: 'Send File (SFTP)',
      class: 'node-action',
      inputs: 1,
      outputs: 1,
      data: { source: '', destination: '', host: '' }
    },
    'http-request': {
      name: 'HTTP Request',
      class: 'node-action',
      inputs: 1,
      outputs: 1,
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
      outputs: 1,
      data: { code: '// Your code here\nreturn data;' }
    }
  };
  
  const config = nodeConfigs[type];
  if (!config) {
    console.error('Unknown node type:', type);
    return;
  }
  
  const nodeId = nodeIdCounter++;
  const html = `
    <div class="${config.class}">
      <div class="node-header">${config.name}</div>
      <div class="node-content">
        <small>${type}</small>
      </div>
    </div>
  `;
  
  editor.addNode(
    type,
    config.inputs,
    config.outputs,
    x,
    y,
    config.class,
    config.data,
    html
  );
  
  console.log('Added node:', type, 'at', x, y);
}

function showNodeProperties(id) {
  const nodeInfo = editor.getNodeFromId(id);
  if (!nodeInfo) return;
  
  const data = nodeInfo.data;
  const type = nodeInfo.name;
  
  let propertiesHtml = `<h4>${type}</h4>`;
  
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
    <button class="btn btn-sm btn-primary" onclick="updateNodeProperties()">Update</button>
    <button class="btn btn-sm btn-danger" onclick="deleteCurrentNode()">Delete Node</button>
  `;
  
  document.getElementById('properties-content').innerHTML = propertiesHtml;
}

function getNodeFields(type) {
  const fieldConfigs = {
    'file-trigger': [
      { key: 'path', label: 'Watch Path', type: 'text' },
      { key: 'pattern', label: 'File Pattern', type: 'text', default: '*' }
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
    'copy-file': [
      { key: 'source', label: 'Source Path', type: 'text' },
      { key: 'destination', label: 'Destination Path', type: 'text' }
    ],
    'delete-file': [
      { key: 'path', label: 'File Path', type: 'text' }
    ],
    'alert': [
      { key: 'level', label: 'Alert Level', type: 'select', options: ['info', 'warning', 'error', 'critical'] },
      { key: 'message', label: 'Message', type: 'textarea' }
    ],
    'javascript': [
      { key: 'code', label: 'JavaScript Code', type: 'textarea' }
    ],
    'ssh-command': [
      { key: 'host', label: 'Host/Agent ID', type: 'text' },
      { key: 'command', label: 'Command', type: 'text' }
    ],
    'http-request': [
      { key: 'url', label: 'URL', type: 'text' },
      { key: 'method', label: 'Method', type: 'select', options: ['GET', 'POST', 'PUT', 'DELETE'] }
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
  console.log('Updated node', currentNodeId, 'with data:', newData);
}

function deleteCurrentNode() {
  if (currentNodeId) {
    editor.removeNodeId('node-' + currentNodeId);
    currentNodeId = null;
  }
}

function saveWorkflow() {
  const name = document.getElementById('workflow-name').value;
  if (!name) {
    alert('Please enter a workflow name');
    return;
  }
  
  const workflowData = editor.export();
  const config = {
    id: 'wf-' + Date.now(),
    name: name,
    enabled: true,
    drawflow: workflowData,
    steps: convertDrawflowToSteps(workflowData)
  };
  
  fetch('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name,
      description: 'Created with visual editor',
      config: config
    })
  })
  .then(r => r.json())
  .then(data => {
    alert('Workflow saved successfully!');
    window.location.href = '/workflows';
  })
  .catch(err => alert('Failed to save workflow: ' + err.message));
}

function convertDrawflowToSteps(drawflowData) {
  const steps = [];
  const nodes = drawflowData.drawflow?.Home?.data || {};
  
  // Find trigger node (node with no inputs)
  let triggerNode = null;
  
  for (const [id, node] of Object.entries(nodes)) {
    const step = {
      id: 'step-' + id,
      type: node.name,
      name: node.name,
      config: node.data,
      next: []
    };
    
    // Get connected nodes
    if (node.outputs && node.outputs.output_1) {
      const connections = node.outputs.output_1.connections || [];
      step.next = connections.map(c => 'step-' + c.node);
    }
    
    // Check if this is a trigger (no inputs)
    if (Object.keys(node.inputs).length === 0) {
      triggerNode = {
        type: node.name.replace('-trigger', ''),
        config: node.data
      };
    } else {
      steps.push(step);
    }
  }
  
  // Return workflow structure
  return {
    trigger: triggerNode || { type: 'manual', config: {} },
    steps: steps
  };
}

function clearWorkflow() {
  if (confirm('Clear the current workflow?')) {
    editor.clear();
    nodeIdCounter = 1;
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
  URL.revokeObjectURL(url);
}

function importWorkflow() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        editor.import(data);
        alert('Workflow imported successfully');
      } catch (err) {
        alert('Invalid workflow file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initializeEditor);