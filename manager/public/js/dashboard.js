// Dashboard page JavaScript

// Auto-refresh dashboard stats
function updateDashboard() {
  fetch('/api/agents')
    .then(r => r.json())
    .then(agents => {
      document.getElementById('agent-count').textContent = agents.length;
      document.getElementById('online-count').textContent =
        agents.filter(a => a.status === 'online').length;

      const recentList = document.getElementById('recent-agents-list');
      if (agents.length > 0) {
        recentList.innerHTML = agents.slice(0, 5).map(agent => `
          <div class="activity-item">
            <span class="status-indicator ${agent.status}"></span>
            <span>${agent.hostname || agent.id}</span>
            <span class="timestamp">${new Date(agent.last_heartbeat).toLocaleString()}</span>
          </div>
        `).join('');
      }
    })
    .catch(err => console.error('Failed to fetch agents:', err));

  fetch('/api/workflows')
    .then(r => r.json())
    .then(workflows => {
      document.getElementById('workflow-count').textContent = workflows.length;
    })
    .catch(err => console.error('Failed to fetch workflows:', err));

  fetch('/api/alerts?limit=5')
    .then(r => r.json())
    .then(alerts => {
      document.getElementById('alert-count').textContent =
        alerts.filter(a => !a.acknowledged).length;

      const alertsList = document.getElementById('recent-alerts-list');
      if (alerts.length > 0) {
        alertsList.innerHTML = alerts.slice(0, 5).map(alert => `
          <div class="activity-item alert-${alert.level}">
            <span class="alert-level">${alert.level}</span>
            <span>${alert.message}</span>
            <span class="timestamp">${new Date(alert.created_at).toLocaleString()}</span>
          </div>
        `).join('');
      }
    })
    .catch(err => console.error('Failed to fetch alerts:', err));
}

updateDashboard();
setInterval(updateDashboard, 5000);
