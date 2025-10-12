// Logs page JavaScript

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
