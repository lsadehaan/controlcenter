// Workflows page JavaScript

let currentWorkflowId = null;
let selectedAgents = [];

// Add event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Edit workflow buttons
  const editBtns = document.querySelectorAll('.edit-workflow-btn');
  editBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const workflowId = this.getAttribute('data-workflow-id');
      editWorkflow(workflowId);
    });
  });

  // Deploy workflow buttons
  const deployBtns = document.querySelectorAll('.deploy-workflow-btn');
  deployBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const workflowId = this.getAttribute('data-workflow-id');
      deployWorkflow(workflowId);
    });
  });

  // Delete workflow buttons
  const deleteBtns = document.querySelectorAll('.delete-workflow-btn');
  deleteBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const workflowId = this.getAttribute('data-workflow-id');
      deleteWorkflow(workflowId);
    });
  });

  // Modal buttons
  const confirmDeployBtn = document.getElementById('confirm-deploy-btn');
  const closeDeployBtn = document.getElementById('close-deploy-btn');

  if (confirmDeployBtn) {
    confirmDeployBtn.addEventListener('click', confirmDeploy);
  }

  if (closeDeployBtn) {
    closeDeployBtn.addEventListener('click', closeDeploy);
  }

  // Event delegation for dynamically added agent checkboxes
  const agentList = document.getElementById('agent-list');
  if (agentList) {
    agentList.addEventListener('change', function(e) {
      if (e.target.type === 'checkbox') {
        toggleAgent(e.target.value);
      }
    });
  }
});

function editWorkflow(id) {
  window.location.href = `/workflow-editor?id=${id}`;
}

function deployWorkflow(id) {
  currentWorkflowId = id;

  fetch('/api/agents')
    .then(r => r.json())
    .then(agents => {
      const agentList = document.getElementById('agent-list');
      if (agents.length === 0) {
        agentList.innerHTML = '<p>No agents available for deployment</p>';
      } else {
        agentList.innerHTML = agents.map(agent => `
          <label class="checkbox-label">
            <input type="checkbox" value="${agent.id}">
            ${agent.hostname || agent.id} (${agent.status})
          </label>
        `).join('');
      }
      document.getElementById('deploy-modal').style.display = 'block';
    });
}

function toggleAgent(id) {
  const index = selectedAgents.indexOf(id);
  if (index > -1) {
    selectedAgents.splice(index, 1);
  } else {
    selectedAgents.push(id);
  }
}

async function confirmDeploy() {
  if (selectedAgents.length === 0) {
    await Modal.warning('Please select at least one agent');
    return;
  }

  fetch(`/api/workflows/${currentWorkflowId}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentIds: selectedAgents })
  })
  .then(r => r.json())
  .then(async data => {
    await Modal.success(`Workflow deployed to ${data.deployed} agents`);
    closeDeploy();
  })
  .catch(err => Modal.error('Failed to deploy workflow: ' + err.message));
}

function closeDeploy() {
  document.getElementById('deploy-modal').style.display = 'none';
  currentWorkflowId = null;
  selectedAgents = [];
}

async function deleteWorkflow(id) {
  const confirmed = await Modal.confirm('Are you sure you want to delete this workflow?', 'Delete Workflow');
  if (confirmed) {
    fetch(`/api/workflows/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => {
        window.location.reload();
      })
      .catch(err => Modal.error('Failed to delete workflow: ' + err.message));
  }
}
