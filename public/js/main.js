// BH Manager - UI System
document.addEventListener('DOMContentLoaded', () => {
  // Highlight active sidebar link
  const currentPath = window.location.pathname;
  document.querySelectorAll('.sidebar-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href && currentPath.startsWith(href) && href !== '/logout') {
      link.classList.add('active');
    }
  });
});

// ==========================================
// Toast Notification System
// ==========================================
function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = { success: '&#10003;', error: '&#10007;', warning: '&#9888;', info: '&#8505;' };
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add('toast-show'), 10);
  setTimeout(() => { toast.classList.remove('toast-show'); setTimeout(() => toast.remove(), 300); }, duration);
}

function createToastContainer() {
  const c = document.createElement('div');
  c.id = 'toast-container';
  document.body.appendChild(c);
  return c;
}

// ==========================================
// Confirmation Modal System
// ==========================================
function confirmAction(options) {
  return new Promise((resolve) => {
    const { title, message, confirmText, cancelText, type } = {
      title: 'Confirm Action',
      message: 'Are you sure you want to proceed?',
      confirmText: 'Confirm',
      cancelText: 'Cancel',
      type: 'warning', // warning, danger, info
      ...options
    };

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-icon modal-icon-${type}">
          ${type === 'danger' ? '&#9888;' : type === 'warning' ? '&#63;' : '&#8505;'}
        </div>
        <h3 class="modal-title">${title}</h3>
        <p class="modal-message">${message}</p>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel">${cancelText}</button>
          <button class="modal-btn modal-btn-confirm modal-btn-${type}">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('modal-show'), 10);

    const close = (result) => {
      overlay.classList.remove('modal-show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };

    overlay.querySelector('.modal-btn-cancel').onclick = () => close(false);
    overlay.querySelector('.modal-btn-confirm').onclick = () => close(true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  });
}

// ==========================================
// Replace all confirm() calls with custom modals
// ==========================================
document.addEventListener('submit', async function(e) {
  const form = e.target;

  // Delete actions
  if (form.action && (form.action.includes('/delete') || form.action.includes('/remove'))) {
    e.preventDefault();
    const confirmed = await confirmAction({
      title: 'Delete Item',
      message: 'This action cannot be undone. Are you sure you want to delete this?',
      confirmText: 'Delete',
      type: 'danger'
    });
    if (confirmed) {
      showToast('Item deleted successfully', 'success');
      setTimeout(() => form.submit(), 300);
    }
    return;
  }

  // Toggle payment status
  if (form.action && form.action.includes('/toggle-status')) {
    e.preventDefault();
    const confirmed = await confirmAction({
      title: 'Change Payment Status',
      message: 'Toggle the payment status for this billing?',
      confirmText: 'Update',
      type: 'warning'
    });
    if (confirmed) {
      showToast('Status updated', 'success');
      setTimeout(() => form.submit(), 300);
    }
    return;
  }

  // Toggle tenant payment
  if (form.action && form.action.includes('/toggle-pay')) {
    // No confirmation needed for quick toggle - just show toast
    showToast('Payment status updated', 'success');
    return;
  }

  // Toggle fixed expense paid
  if (form.action && form.action.includes('/toggle-paid')) {
    // Quick action - no modal needed
    showToast('Payment recorded', 'success');
    return;
  }

  // Save/Add actions - show success toast
  if (form.action && (form.action.includes('/save') || form.action.includes('/add'))) {
    showToast('Saved successfully', 'success');
    return;
  }
}, true);

// Remove old onsubmit confirm handlers
document.querySelectorAll('[onsubmit]').forEach(form => {
  form.removeAttribute('onsubmit');
});
