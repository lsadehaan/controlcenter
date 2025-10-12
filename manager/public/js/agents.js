// Add event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Token dialog buttons
  const showTokenBtn = document.getElementById('show-token-dialog-btn');
  const generateTokenBtn = document.getElementById('generate-token-btn');
  const hideTokenBtn = document.getElementById('hide-token-dialog-btn');

  if (showTokenBtn) {
    showTokenBtn.addEventListener('click', showTokenDialog);
  }

  if (generateTokenBtn) {
    generateTokenBtn.addEventListener('click', generateToken);
  }

  if (hideTokenBtn) {
    hideTokenBtn.addEventListener('click', hideTokenDialog);
  }

  // View agent buttons
  const viewAgentBtns = document.querySelectorAll('.view-agent-btn');
  viewAgentBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const agentId = this.getAttribute('data-agent-id');
      viewAgent(agentId);
    });
  });

  // Remove agent buttons
  const removeAgentBtns = document.querySelectorAll('.remove-agent-btn');
  removeAgentBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const agentId = this.getAttribute('data-agent-id');
      removeAgent(agentId);
    });
  });
});

function showTokenDialog() {
  console.log('showTokenDialog called');
  try {
    const dialog = document.getElementById('token-dialog');
    console.log('Dialog element:', dialog);
    dialog.style.display = 'flex';
    document.getElementById('api-address').value = '';
  } catch (err) {
    console.error('Error showing dialog:', err);
    alert('Error showing dialog: ' + err.message);
  }
}

function hideTokenDialog() {
  document.getElementById('token-dialog').style.display = 'none';
}

function generateToken() {
  let apiAddress = document.getElementById('api-address').value.trim();

  // Strip http:// or https:// prefix if present
  apiAddress = apiAddress.replace(/^https?:\/\//, '');

  fetch('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expiresIn: 3600000,
      apiAddress: apiAddress || undefined
    })
  })
  .then(r => r.json())
  .then(data => {
    hideTokenDialog();
    document.getElementById('token-display').style.display = 'block';
    document.getElementById('token-value').textContent = data.token;
    document.getElementById('token-cmd').textContent = data.token;

    if (apiAddress) {
      document.getElementById('api-address-info').style.display = 'block';
      document.getElementById('api-address-value').textContent = apiAddress;
    } else {
      document.getElementById('api-address-info').style.display = 'none';
    }
  })
  .catch(err => alert('Failed to generate token: ' + err.message));
}

function viewAgent(id) {
  window.location.href = `/agents/${id}`;
}

function configureAgent(id) {
  window.location.href = `/agents/${id}/configure`;
}

function removeAgent(id) {
  if (confirm('Are you sure you want to remove this agent?')) {
    fetch(`/api/agents/${id}`, {
      method: 'DELETE'
    })
    .then(r => r.json())
    .then(data => {
      alert('Agent removed successfully');
      window.location.reload();
    })
    .catch(err => alert('Failed to remove agent: ' + err.message));
  }
}
