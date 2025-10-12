// Workflows page JavaScript

let currentWorkflowId = null;
let selectedAgents = [];

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
            <input type="checkbox" value="${agent.id}" onchange="toggleAgent('${agent.id}')">
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

function confirmDeploy() {
  if (selectedAgents.length === 0) {
    alert('Please select at least one agent');
    return;
  }

  fetch(`/api/workflows/${currentWorkflowId}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentIds: selectedAgents })
  })
  .then(r => r.json())
  .then(data => {
    alert(`Workflow deployed to ${data.deployed} agents`);
    closeDeploy();
  })
  .catch(err => alert('Failed to deploy workflow: ' + err.message));
}

function closeDeploy() {
  document.getElementById('deploy-modal').style.display = 'none';
  currentWorkflowId = null;
  selectedAgents = [];
}

function deleteWorkflow(id) {
  if (confirm('Are you sure you want to delete this workflow?')) {
    fetch(`/api/workflows/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => {
        window.location.reload();
      })
      .catch(err => alert('Failed to delete workflow: ' + err.message));
  }
}
