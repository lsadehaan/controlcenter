// Settings page JavaScript

function generateToken() {
  fetch('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600000 }) // 1 hour
  })
  .then(r => r.json())
  .then(data => {
    document.getElementById('token-display').style.display = 'block';
    document.getElementById('token-value').textContent = data.token;
    document.getElementById('token-expiry').textContent = '1 hour (expires at ' + new Date(data.expiresAt).toLocaleString() + ')';

    // Show the agent command
    const command = `./agent -token="${data.token}" -manager="ws://localhost:3000/ws"`;
    document.getElementById('agent-command').textContent = command;
  })
  .catch(err => alert('Failed to generate token: ' + err.message));
}

function copyCommand() {
  const command = document.getElementById('agent-command').textContent;
  navigator.clipboard.writeText(command).then(() => {
    alert('Command copied to clipboard!');
  }).catch(err => {
    alert('Failed to copy: ' + err.message);
  });
}

document.getElementById('notification-settings').addEventListener('submit', (e) => {
  e.preventDefault();
  alert('Notification settings saved (not yet implemented in backend)');
});

function clearOldLogs() {
  if (confirm('Clear logs older than 30 days?')) {
    alert('Log cleanup not yet implemented');
  }
}

function exportDatabase() {
  alert('Database export not yet implemented');
}

function resetSystem() {
  if (confirm('This will remove all agents, workflows, and logs. Are you sure?')) {
    if (confirm('This action cannot be undone. Please confirm again.')) {
      alert('System reset not yet implemented');
    }
  }
}
