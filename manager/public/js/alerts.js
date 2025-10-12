// Alerts page JavaScript

function acknowledgeAlert(id) {
  fetch(`/api/alerts/${id}/acknowledge`, { method: 'PUT' })
    .then(r => r.json())
    .then(() => {
      window.location.reload();
    })
    .catch(err => alert('Failed to acknowledge alert: ' + err.message));
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
