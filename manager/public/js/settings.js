// Settings page JavaScript

// Initialize event listeners when page loads
document.addEventListener('DOMContentLoaded', function() {
  // Generate token button
  const generateTokenBtn = document.getElementById('generate-token-btn');
  if (generateTokenBtn) {
    generateTokenBtn.addEventListener('click', generateToken);
  }

  // Copy command button
  const copyCommandBtn = document.getElementById('copy-command-btn');
  if (copyCommandBtn) {
    copyCommandBtn.addEventListener('click', copyCommand);
  }

  // Maintenance buttons
  const clearLogsBtn = document.getElementById('clear-logs-btn');
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', clearOldLogs);
  }

  const exportDbBtn = document.getElementById('export-db-btn');
  if (exportDbBtn) {
    exportDbBtn.addEventListener('click', exportDatabase);
  }

  const resetSystemBtn = document.getElementById('reset-system-btn');
  if (resetSystemBtn) {
    resetSystemBtn.addEventListener('click', resetSystem);
  }

  // Notification settings form
  const notificationForm = document.getElementById('notification-settings');
  if (notificationForm) {
    notificationForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await Modal.info('Notification settings saved (not yet implemented in backend)');
    });
  }

  // User management
  const addUserBtn = document.getElementById('add-user-btn');
  if (addUserBtn) {
    addUserBtn.addEventListener('click', addUser);
  }

  // Load users on page load
  loadUsers();
});

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
  .catch(err => Modal.error('Failed to generate token: ' + err.message));
}

async function copyCommand() {
  const command = document.getElementById('agent-command').textContent;
  navigator.clipboard.writeText(command).then(async () => {
    await Modal.success('Command copied to clipboard!');
  }).catch(async err => {
    await Modal.error('Failed to copy: ' + err.message);
  });
}

async function clearOldLogs() {
  const confirmed = await Modal.confirm('Clear logs older than 30 days?', 'Clear Old Logs');
  if (confirmed) {
    await Modal.info('Log cleanup not yet implemented');
  }
}

async function exportDatabase() {
  await Modal.info('Database export not yet implemented');
}

async function resetSystem() {
  const confirmed1 = await Modal.confirm('This will remove all agents, workflows, and logs. Are you sure?', 'Reset System');
  if (confirmed1) {
    const confirmed2 = await Modal.confirm('This action cannot be undone. Please confirm again.', 'Confirm Reset');
    if (confirmed2) {
      await Modal.info('System reset not yet implemented');
    }
  }
}

// User Management Functions

function loadUsers() {
  fetch('/api/users', {
    credentials: 'include'
  })
  .then(r => r.json())
  .then(users => {
    const tbody = document.getElementById('users-list');

    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No users found</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(user => `
      <tr>
        <td>${escapeHtml(user.username)}</td>
        <td>${escapeHtml(user.role)}</td>
        <td>${formatDate(user.created_at)}</td>
        <td>${user.last_login ? formatDate(user.last_login) : 'Never'}</td>
        <td>
          <button class="btn btn-sm" onclick="resetUserPassword('${user.id}', '${escapeHtml(user.username)}')">Reset Password</button>
          <button class="btn btn-sm btn-danger" onclick="deleteUser('${user.id}', '${escapeHtml(user.username)}')">Delete</button>
        </td>
      </tr>
    `).join('');
  })
  .catch(err => {
    const tbody = document.getElementById('users-list');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: red;">Error loading users: ' + escapeHtml(err.message) + '</td></tr>';
  });
}

async function addUser() {
  // Create a custom modal with form fields
  const modalHtml = `
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px; font-weight: bold;">Username</label>
      <input type="text" id="new-username" class="form-input" placeholder="Enter username" style="width: 100%;">
    </div>
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px; font-weight: bold;">Password</label>
      <input type="password" id="new-password" class="form-input" placeholder="Enter password" style="width: 100%;" autocomplete="new-password">
      <small style="display: block; margin-top: 5px; color: #666;">Min 8 characters, must include uppercase, lowercase, and number</small>
    </div>
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px; font-weight: bold;">Confirm Password</label>
      <input type="password" id="confirm-password" class="form-input" placeholder="Confirm password" style="width: 100%;" autocomplete="new-password">
    </div>
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px; font-weight: bold;">Role</label>
      <select id="new-role" class="form-input" style="width: 100%;">
        <option value="admin">Admin</option>
      </select>
    </div>
  `;

  const confirmed = await Modal.custom('Add New User', modalHtml, 'Create', 'Cancel');

  if (confirmed) {
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const role = document.getElementById('new-role').value;

    // Validation
    if (!username) {
      await Modal.error('Username is required');
      return;
    }

    if (!password) {
      await Modal.error('Password is required');
      return;
    }

    if (password !== confirmPassword) {
      await Modal.error('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      await Modal.error('Password must be at least 8 characters');
      return;
    }

    if (!/[A-Z]/.test(password)) {
      await Modal.error('Password must contain at least one uppercase letter');
      return;
    }

    if (!/[a-z]/.test(password)) {
      await Modal.error('Password must contain at least one lowercase letter');
      return;
    }

    if (!/[0-9]/.test(password)) {
      await Modal.error('Password must contain at least one number');
      return;
    }

    // Create user
    fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, role })
    })
    .then(r => {
      if (!r.ok) {
        return r.json().then(err => {
          throw new Error(err.error || 'Failed to create user');
        });
      }
      return r.json();
    })
    .then(async data => {
      await Modal.success('User created successfully!');
      loadUsers();
    })
    .catch(async err => {
      await Modal.error('Failed to create user: ' + err.message);
    });
  }
}

async function resetUserPassword(userId, username) {
  const modalHtml = `
    <p>Reset password for user: <strong>${username}</strong></p>
    <div style="margin-bottom: 15px; margin-top: 15px;">
      <label style="display: block; margin-bottom: 5px; font-weight: bold;">New Password</label>
      <input type="password" id="reset-password" class="form-input" placeholder="Enter new password" style="width: 100%;" autocomplete="new-password">
      <small style="display: block; margin-top: 5px; color: #666;">Min 8 characters, must include uppercase, lowercase, and number</small>
    </div>
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px; font-weight: bold;">Confirm Password</label>
      <input type="password" id="reset-confirm-password" class="form-input" placeholder="Confirm new password" style="width: 100%;" autocomplete="new-password">
    </div>
  `;

  const confirmed = await Modal.custom('Reset Password', modalHtml, 'Reset', 'Cancel');

  if (confirmed) {
    const password = document.getElementById('reset-password').value;
    const confirmPassword = document.getElementById('reset-confirm-password').value;

    // Validation
    if (!password) {
      await Modal.error('Password is required');
      return;
    }

    if (password !== confirmPassword) {
      await Modal.error('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      await Modal.error('Password must be at least 8 characters');
      return;
    }

    if (!/[A-Z]/.test(password)) {
      await Modal.error('Password must contain at least one uppercase letter');
      return;
    }

    if (!/[a-z]/.test(password)) {
      await Modal.error('Password must contain at least one lowercase letter');
      return;
    }

    if (!/[0-9]/.test(password)) {
      await Modal.error('Password must contain at least one number');
      return;
    }

    // Reset password
    fetch(`/api/users/${userId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password })
    })
    .then(r => {
      if (!r.ok) {
        return r.json().then(err => {
          throw new Error(err.error || 'Failed to reset password');
        });
      }
      return r.json();
    })
    .then(async data => {
      await Modal.success('Password reset successfully!');
    })
    .catch(async err => {
      await Modal.error('Failed to reset password: ' + err.message);
    });
  }
}

async function deleteUser(userId, username) {
  const confirmed = await Modal.confirm(
    `Are you sure you want to delete user "${username}"? This action cannot be undone.`,
    'Delete User'
  );

  if (confirmed) {
    fetch(`/api/users/${userId}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    .then(r => {
      if (!r.ok) {
        return r.json().then(err => {
          throw new Error(err.error || 'Failed to delete user');
        });
      }
      return r.json();
    })
    .then(async data => {
      await Modal.success('User deleted successfully!');
      loadUsers();
    })
    .catch(async err => {
      await Modal.error('Failed to delete user: ' + err.message);
    });
  }
}

// Helper function to format timestamps
function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp);
  return date.toLocaleString();
}

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
