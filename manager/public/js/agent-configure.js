// Agent configure page JavaScript
// Read agent data from data attributes
const agent = JSON.parse(document.body.dataset.agentConfig || '{}');

// Initialize data from server
let sshKeys = [];
let workflows = [];
let allowedPaths = [];

try {
  sshKeys = agent.config.authorizedSSHKeys || [];
  workflows = agent.config.workflows || [];
  allowedPaths = agent.config.fileBrowserSettings?.allowedPaths || [];
} catch (e) {
  console.error('Failed to parse config data:', e);
  sshKeys = [];
  workflows = [];
  allowedPaths = [];
}

// Add event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Form submit
  const configForm = document.getElementById('config-form');
  if (configForm) {
    configForm.addEventListener('submit', saveConfig);
  }

  // Add SSH key button
  const addSshKeyBtn = document.getElementById('add-ssh-key-btn');
  if (addSshKeyBtn) {
    addSshKeyBtn.addEventListener('click', addSSHKey);
  }

  // Remove SSH key buttons (event delegation)
  const sshKeysList = document.getElementById('ssh-keys');
  if (sshKeysList) {
    sshKeysList.addEventListener('click', function(e) {
      if (e.target.classList.contains('remove-ssh-key-btn')) {
        const index = parseInt(e.target.getAttribute('data-index'));
        removeSSHKey(index);
      }
    });
  }

  // Remove workflow buttons (event delegation)
  const workflowList = document.querySelector('.workflow-list');
  if (workflowList) {
    workflowList.addEventListener('click', function(e) {
      if (e.target.classList.contains('remove-workflow-btn')) {
        const workflowId = e.target.getAttribute('data-workflow-id');
        removeWorkflow(workflowId);
      }
    });
  }

  // Add path button
  const addPathBtn = document.getElementById('add-path-btn');
  if (addPathBtn) {
    addPathBtn.addEventListener('click', addAllowedPath);
  }

  // Remove path buttons (event delegation)
  const allowedPathsList = document.getElementById('allowed-paths');
  if (allowedPathsList) {
    allowedPathsList.addEventListener('click', function(e) {
      if (e.target.classList.contains('remove-path-btn')) {
        const index = parseInt(e.target.getAttribute('data-path-index'));
        removeAllowedPath(index);
      }
    });
  }
});

function removeWorkflow(workflowId) {
  console.log('Removing workflow:', workflowId);
  console.log('Current workflows:', workflows);

  // Remove from workflows array
  workflows = workflows.filter(w => w.id !== workflowId);
  console.log('Updated workflows:', workflows);

  // Find and remove the UI element
  const workflowItems = document.querySelectorAll('.workflow-item');
  workflowItems.forEach(item => {
    if (item.innerHTML.includes(workflowId)) {
      item.remove();
    }
  });

  // Check if list is now empty
  const workflowList = document.querySelector('.workflow-list');
  if (workflowList && workflowList.children.length === 0) {
    const section = workflowList.closest('.form-section');
    const contentDiv = section.querySelector('ul').parentElement;
    contentDiv.innerHTML = '<p style="color: #999;">No workflows deployed to this agent</p>';
  }

  Modal.info('Workflow marked for removal. Click "Save Configuration" to apply changes.');
}

function addSSHKey() {
  const keyList = document.getElementById('ssh-keys');
  const newIndex = sshKeys.length;
  const div = document.createElement('div');
  div.className = 'ssh-key-item';
  div.innerHTML = `
    <input type="text" class="form-input" placeholder="ssh-rsa AAAA..." data-index="${newIndex}">
    <button type="button" class="btn btn-sm btn-danger remove-ssh-key-btn" data-index="${newIndex}">Remove</button>
  `;
  keyList.appendChild(div);
  sshKeys.push('');
}

function removeSSHKey(index) {
  sshKeys.splice(index, 1);
  refreshSSHKeys();
}

function refreshSSHKeys() {
  const keyList = document.getElementById('ssh-keys');
  if (sshKeys.length === 0) {
    keyList.innerHTML = '<p style="color: #999;">No authorized keys configured</p>';
  } else {
    keyList.innerHTML = '';
    sshKeys.forEach((key, index) => {
      const div = document.createElement('div');
      div.className = 'ssh-key-item';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'form-input';
      input.value = key;
      input.setAttribute('data-index', index);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm btn-danger remove-ssh-key-btn';
      button.textContent = 'Remove';
      button.setAttribute('data-index', index);

      div.appendChild(input);
      div.appendChild(button);
      keyList.appendChild(div);
    });
  }
}

function addAllowedPath() {
  const pathList = document.getElementById('allowed-paths');
  const newIndex = allowedPaths.length;
  const div = document.createElement('div');
  div.className = 'ssh-key-item';
  div.innerHTML = `
    <input type="text" class="form-input" placeholder="C:\\path\\to\\folder or /path/to/folder" data-path-index="${newIndex}">
    <button type="button" class="btn btn-sm btn-danger remove-path-btn" data-path-index="${newIndex}">Remove</button>
  `;

  // Remove "no paths" message if it exists
  const noPathsMsg = pathList.querySelector('p');
  if (noPathsMsg) {
    noPathsMsg.remove();
  }

  pathList.appendChild(div);
  allowedPaths.push('');
}

function removeAllowedPath(index) {
  allowedPaths.splice(index, 1);
  refreshAllowedPaths();
}

function refreshAllowedPaths() {
  const pathList = document.getElementById('allowed-paths');
  if (allowedPaths.length === 0) {
    pathList.innerHTML = '<p style="color: #999;">No paths configured (agent data directory only)</p>';
  } else {
    pathList.innerHTML = '';
    allowedPaths.forEach((path, index) => {
      const div = document.createElement('div');
      div.className = 'ssh-key-item';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'form-input';
      input.value = path;
      input.setAttribute('data-path-index', index);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm btn-danger remove-path-btn';
      button.textContent = 'Remove';
      button.setAttribute('data-path-index', index);

      div.appendChild(input);
      div.appendChild(button);
      pathList.appendChild(div);
    });
  }
}


async function saveConfig(event) {
  event.preventDefault();

  // Collect SSH keys from inputs
  const keyInputs = document.querySelectorAll('#ssh-keys input[type="text"]');
  const authorizedSSHKeys = Array.from(keyInputs)
    .map(input => input.value.trim())
    .filter(key => key.length > 0);

  // Collect allowed paths from inputs
  const pathInputs = document.querySelectorAll('#allowed-paths input[type="text"]');
  const allowedPathsArray = Array.from(pathInputs)
    .map(input => input.value.trim())
    .filter(path => path.length > 0);

  // Parse custom config
  let customConfig = {};
  try {
    const customConfigText = document.getElementById('customConfig').value.trim();
    if (customConfigText) {
      customConfig = JSON.parse(customConfigText);
    }
  } catch (err) {
    await Modal.error('Invalid JSON in custom configuration');
    return;
  }

  const config = {
    sshServerPort: parseInt(document.getElementById('sshServerPort').value),
    configRepoPath: document.getElementById('configRepoPath').value,
    authorizedSSHKeys: authorizedSSHKeys,
    workflows: workflows,
    fileBrowserSettings: {
      enabled: document.getElementById('fileBrowserEnabled').checked,
      allowedPaths: allowedPathsArray,
      maxUploadSize: parseInt(document.getElementById('maxUploadSize').value),
      maxListItems: parseInt(document.getElementById('maxListItems').value)
    },
    custom: customConfig
  };

  try {
    const response = await fetch(`/api/agents/${agent.id}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to save configuration');
    }

    const data = await response.json();

    // Ask user if they want to reload agent configuration
    const shouldReload = await Modal.confirm(
      'Configuration saved successfully. Reload agent configuration now?',
      'Reload Configuration'
    );

    if (shouldReload) {
      await reloadAgentConfiguration();
    } else {
      window.location.href = `/agents/${agent.id}`;
    }
  } catch (err) {
    await Modal.error('Failed to save configuration: ' + err.message);
  }
}

async function reloadAgentConfiguration() {
  try {
    // Send reload-config command
    const reloadResponse = await fetch(`/api/agents/${agent.id}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'reload-config' })
    });

    if (!reloadResponse.ok) {
      throw new Error('Reload configuration command failed');
    }

    await Modal.success('Agent configuration reloaded successfully!');
    window.location.href = `/agents/${agent.id}`;

  } catch (error) {
    await Modal.error('Failed to reload configuration: ' + error.message);
    window.location.href = `/agents/${agent.id}`;
  }
}
