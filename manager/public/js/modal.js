/**
 * Modal Dialog Utility
 * Provides a clean alternative to JavaScript alert(), confirm(), and prompt()
 */

const Modal = {
  /**
   * Show an information modal
   * @param {string} message - The message to display
   * @param {string} title - Optional title (default: "Information")
   */
  info(message, title = 'Information') {
    return this._showModal(message, title, 'info', ['OK']);
  },

  /**
   * Show a success modal
   * @param {string} message - The message to display
   * @param {string} title - Optional title (default: "Success")
   */
  success(message, title = 'Success') {
    return this._showModal(message, title, 'success', ['OK']);
  },

  /**
   * Show an error modal
   * @param {string} message - The message to display
   * @param {string} title - Optional title (default: "Error")
   */
  error(message, title = 'Error') {
    return this._showModal(message, title, 'error', ['OK']);
  },

  /**
   * Show a warning modal
   * @param {string} message - The message to display
   * @param {string} title - Optional title (default: "Warning")
   */
  warning(message, title = 'Warning') {
    return this._showModal(message, title, 'warning', ['OK']);
  },

  /**
   * Show a confirmation dialog
   * @param {string} message - The message to display
   * @param {string} title - Optional title (default: "Confirm")
   * @returns {Promise<boolean>} - True if confirmed, false if cancelled
   */
  confirm(message, title = 'Confirm') {
    return this._showModal(message, title, 'confirm', ['Cancel', 'Confirm']);
  },

  /**
   * Show a custom modal with HTML content
   * @param {string} title - The modal title
   * @param {string} htmlContent - The HTML content to display
   * @param {string} confirmButton - Text for confirm button (default: "OK")
   * @param {string} cancelButton - Text for cancel button (default: "Cancel")
   * @returns {Promise<boolean>} - True if confirmed, false if cancelled
   */
  custom(title, htmlContent, confirmButton = 'OK', cancelButton = 'Cancel') {
    return new Promise((resolve) => {
      // Create modal HTML
      const modal = document.createElement('div');
      modal.className = 'cc-modal-overlay';
      modal.innerHTML = `
        <div class="cc-modal cc-modal-custom">
          <div class="cc-modal-header">
            <h3>${this._escapeHtml(title)}</h3>
          </div>
          <div class="cc-modal-body">
            ${htmlContent}
          </div>
          <div class="cc-modal-footer">
            <button class="cc-modal-btn cc-modal-btn-secondary" data-action="0">
              ${cancelButton}
            </button>
            <button class="cc-modal-btn cc-modal-btn-primary" data-action="1">
              ${confirmButton}
            </button>
          </div>
        </div>
      `;

      // Add to DOM
      document.body.appendChild(modal);

      // Focus first input or button
      setTimeout(() => {
        const firstInput = modal.querySelector('input, textarea, select');
        if (firstInput) {
          firstInput.focus();
        } else {
          const firstBtn = modal.querySelector('.cc-modal-btn');
          if (firstBtn) firstBtn.focus();
        }
      }, 100);

      // Handle button clicks
      modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('cc-modal-btn')) {
          const action = parseInt(e.target.dataset.action);
          const result = (action === 1);
          this._closeModal(modal);
          resolve(result);
        } else if (e.target === modal) {
          // Click outside modal
          this._closeModal(modal);
          resolve(false);
        }
      });

      // Handle keyboard
      modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this._closeModal(modal);
          resolve(false);
        }
      });
    });
  },

  /**
   * Internal method to show modal
   * @private
   */
  _showModal(message, title, type, buttons) {
    return new Promise((resolve) => {
      // Create modal HTML
      const modal = document.createElement('div');
      modal.className = 'cc-modal-overlay';
      modal.innerHTML = `
        <div class="cc-modal cc-modal-${type}">
          <div class="cc-modal-header">
            <h3>${this._escapeHtml(title)}</h3>
          </div>
          <div class="cc-modal-body">
            <p>${this._escapeHtml(message)}</p>
          </div>
          <div class="cc-modal-footer">
            ${buttons.map((btn, idx) => `
              <button class="cc-modal-btn ${idx === buttons.length - 1 ? 'cc-modal-btn-primary' : 'cc-modal-btn-secondary'}" data-action="${idx}">
                ${btn}
              </button>
            `).join('')}
          </div>
        </div>
      `;

      // Add to DOM
      document.body.appendChild(modal);

      // Focus first button
      setTimeout(() => {
        const firstBtn = modal.querySelector('.cc-modal-btn');
        if (firstBtn) firstBtn.focus();
      }, 100);

      // Handle button clicks
      modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('cc-modal-btn')) {
          const action = parseInt(e.target.dataset.action);
          const result = type === 'confirm' ? (action === 1) : true;
          this._closeModal(modal);
          resolve(result);
        } else if (e.target === modal) {
          // Click outside modal
          const result = type === 'confirm' ? false : true;
          this._closeModal(modal);
          resolve(result);
        }
      });

      // Handle keyboard
      modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const result = type === 'confirm' ? false : true;
          this._closeModal(modal);
          resolve(result);
        } else if (e.key === 'Enter' && type !== 'confirm') {
          this._closeModal(modal);
          resolve(true);
        }
      });
    });
  },

  /**
   * Close and remove modal
   * @private
   */
  _closeModal(modal) {
    modal.classList.add('cc-modal-closing');
    setTimeout(() => {
      modal.remove();
    }, 200);
  },

  /**
   * Escape HTML to prevent XSS
   * @private
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Make globally available
window.Modal = Modal;
