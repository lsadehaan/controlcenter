// Logs page JavaScript

// Initialize event listeners when page loads
document.addEventListener('DOMContentLoaded', function() {
  // Search filter
  const searchFilter = document.getElementById('search-filter');
  if (searchFilter) {
    searchFilter.addEventListener('keyup', filterLogs);
  }

  // Level filter
  const levelFilter = document.getElementById('level-filter');
  if (levelFilter) {
    levelFilter.addEventListener('change', filterLogs);
  }

  // Refresh button
  const refreshBtn = document.getElementById('refresh-logs-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshLogs);
  }

  // Expand metadata buttons (event delegation)
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('btn-expand')) {
      toggleMetadata(e.target);
    }
  });
});

function filterLogs() {
  const searchTerm = document.getElementById('search-filter').value.toLowerCase();
  const levelFilter = document.getElementById('level-filter').value;

  const entries = document.querySelectorAll('.log-entry');
  entries.forEach(entry => {
    const text = entry.textContent.toLowerCase();
    const level = entry.dataset.level;

    let show = true;

    if (searchTerm && !text.includes(searchTerm)) {
      show = false;
    }

    if (levelFilter && level !== levelFilter) {
      show = false;
    }

    entry.style.display = show ? 'flex' : 'none';
  });
}

function toggleMetadata(button) {
  const metadata = button.nextElementSibling;
  if (metadata.style.display === 'none') {
    metadata.style.display = 'block';
    button.textContent = '-';
  } else {
    metadata.style.display = 'none';
    button.textContent = '+';
  }
}

function refreshLogs() {
  window.location.reload();
}

// Auto-refresh logs every 10 seconds
setInterval(() => {
  refreshLogs();
}, 10000);
