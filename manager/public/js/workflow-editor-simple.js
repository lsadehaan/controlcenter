let editor;
let nodeId = 1;
let pos_x = 100;
let pos_y = 100;

// Add event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Initialize Drawflow
  const id = document.getElementById("drawflow");
  editor = new Drawflow(id);
  editor.start();

  // Attach button event listeners
  const saveBtn = document.getElementById('save-workflow-btn');
  const clearBtn = document.getElementById('clear-editor-btn');
  const addTriggerBtn = document.getElementById('add-trigger-btn');
  const addActionBtn = document.getElementById('add-action-btn');

  if (saveBtn) {
    saveBtn.addEventListener('click', saveWorkflow);
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', clearEditor);
  }

  if (addTriggerBtn) {
    addTriggerBtn.addEventListener('click', addTriggerNode);
  }

  if (addActionBtn) {
    addActionBtn.addEventListener('click', addActionNode);
  }
});

function addTriggerNode() {
  const html = `
    <div>
      <div class="node-header">File Trigger</div>
      <div>Path: <input type="text" df-path placeholder="/watch/folder"></div>
      <div>Pattern: <input type="text" df-pattern value="*.txt"></div>
    </div>
  `;

  editor.addNode('file-trigger', 0, 1, pos_x, pos_y, 'trigger-node',
    { path: '/watch/folder', pattern: '*.txt' }, html);

  pos_x += 50;
  pos_y += 50;
  nodeId++;
}

function addActionNode() {
  const actionType = prompt('Enter action type:\n1. copy-file\n2. move-file\n3. alert\n4. run-command', '1');

  let html = '';
  let data = {};
  let nodeName = '';

  switch(actionType) {
    case '1':
      nodeName = 'copy-file';
      html = `
        <div>
          <div class="node-header">Copy File</div>
          <div>From: <input type="text" df-source></div>
          <div>To: <input type="text" df-destination></div>
        </div>
      `;
      data = { source: '', destination: '' };
      break;

    case '2':
      nodeName = 'move-file';
      html = `
        <div>
          <div class="node-header">Move File</div>
          <div>From: <input type="text" df-source></div>
          <div>To: <input type="text" df-destination></div>
        </div>
      `;
      data = { source: '', destination: '' };
      break;

    case '3':
      nodeName = 'alert';
      html = `
        <div>
          <div class="node-header">Send Alert</div>
          <div>Level:
            <select df-level>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div>Message: <input type="text" df-message></div>
        </div>
      `;
      data = { level: 'info', message: '' };
      break;

    case '4':
      nodeName = 'run-command';
      html = `
        <div>
          <div class="node-header">Run Command</div>
          <div>Command: <input type="text" df-command></div>
          <div>Args: <input type="text" df-args></div>
        </div>
      `;
      data = { command: '', args: '' };
      break;

    default:
      return;
  }

  editor.addNode(nodeName, 1, 1, pos_x, pos_y, 'action-node', data, html);
  pos_x += 50;
  pos_y += 50;
  nodeId++;
}

function clearEditor() {
  if (confirm('Clear all nodes?')) {
    editor.clear();
    pos_x = 100;
    pos_y = 100;
    nodeId = 1;
  }
}

function saveWorkflow() {
  const name = document.getElementById('workflow-name').value;
  if (!name) {
    alert('Please enter a workflow name');
    return;
  }

  const exportData = editor.export();
  const nodes = exportData.drawflow.Home.data;

  // Find trigger and build workflow structure
  let trigger = null;
  const steps = [];

  for (const [id, node] of Object.entries(nodes)) {
    if (node.name.includes('trigger')) {
      trigger = {
        type: node.name.replace('-trigger', ''),
        config: node.data
      };
    } else {
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

      steps.push(step);
    }
  }

  if (!trigger) {
    alert('Please add a trigger node first');
    return;
  }

  const workflow = {
    id: 'wf-' + Date.now(),
    name: name,
    enabled: true,
    trigger: trigger,
    steps: steps
  };

  // Save via API
  fetch('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name,
      description: 'Created with visual editor',
      config: workflow
    })
  })
  .then(r => r.json())
  .then(data => {
    alert('Workflow saved! ID: ' + data.id);
    window.location.href = '/workflows';
  })
  .catch(err => {
    alert('Error saving workflow: ' + err.message);
  });
}
