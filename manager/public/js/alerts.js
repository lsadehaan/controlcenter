// Alerts page JavaScript

// Initialize event listeners when page loads
document.addEventListener('DOMContentLoaded', function() {
  // Filter controls
  const levelFilter = document.getElementById('level-filter');
  const statusFilter = document.getElementById('status-filter');

  if (levelFilter) {
    levelFilter.addEventListener('change', filterAlerts);
  }

  if (statusFilter) {
    statusFilter.addEventListener('change', filterAlerts);
  }

  // Acknowledge buttons
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('acknowledge-btn')) {
      const alertId = e.target.dataset.alertId;
      acknowledgeAlert(alertId);
    }
  });
});

function acknowledgeAlert(id) {
  fetch(`/api/alerts/${id}/acknowledge`, {
    method: 'PUT',
    credentials: 'include'
  })
    .then(r => r.json())
    .then(() => {
      window.location.reload();
    })
    .catch(err => Modal.error('Failed to acknowledge alert: ' + err.message));
}

function filterAlerts() {
  const levelFilter = document.getElementById('level-filter').value;
  const statusFilter = document.getElementById('status-filter').value;

  const alerts = document.querySelectorAll('.alert-item');
  alerts.forEach(alert => {
    const level = alert.dataset.level;
    const acknowledged = alert.dataset.acknowledged === 'true';

    let show = true;

    if (levelFilter && level !== levelFilter) {
      show = false;
    }

    if (statusFilter === 'acknowledged' && !acknowledged) {
      show = false;
    } else if (statusFilter === 'unacknowledged' && acknowledged) {
      show = false;
    }

    alert.style.display = show ? 'block' : 'none';
  });
}
