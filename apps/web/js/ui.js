/**
 * Shared Studio UI helpers: HTML escaping, toasts, and unified-diff rendering.
 */

const TOAST_TYPES = new Set(['info', 'success', 'error', 'warning']);

export function escapeHtml(str) {
  if (typeof str !== 'string') return String(str || '');
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toastColors(type) {
  if (type === 'success') return { border: '#10B981', icon: 'success' };
  if (type === 'error') return { border: '#EF4444', icon: 'error' };
  if (type === 'warning') return { border: '#F59E0B', icon: 'info' };
  return { border: '#38BDF8', icon: 'info' };
}

function renderStructuredToast(container, title, message, type) {
  const toast = document.createElement('div');
  const typeClass = type === 'success' ? 'toast-success' : (type === 'error' ? 'toast-error' : '');
  const iconSvg = type === 'success'
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
    : (type === 'error'
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38BDF8" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>');

  toast.className = `toast ${typeClass}`;
  toast.innerHTML = `
    <div class="toast-icon">${iconSvg}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px) scale(0.95)';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function renderCyberToast(message, type) {
  let toastContainer = document.getElementById('cyber-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'cyber-toast-container';
    toastContainer.style.position = 'fixed';
    toastContainer.style.bottom = '20px';
    toastContainer.style.right = '20px';
    toastContainer.style.display = 'flex';
    toastContainer.style.flexDirection = 'column';
    toastContainer.style.gap = '8px';
    toastContainer.style.zIndex = '99999';
    toastContainer.style.pointerEvents = 'none';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  const borderColor = toastColors(type).border;
  toast.style.background = 'rgba(8, 14, 28, 0.95)';
  toast.style.border = `1px solid ${borderColor}`;
  toast.style.color = '#F8FAFC';
  toast.style.padding = '8px 14px';
  toast.style.borderRadius = '6px';
  toast.style.fontSize = '11px';
  toast.style.fontWeight = '600';
  toast.style.boxShadow = `0 6px 24px rgba(0, 0, 0, 0.6), 0 0 12px ${borderColor}44`;
  toast.style.backdropFilter = 'blur(12px)';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '8px';
  toast.style.pointerEvents = 'auto';
  toast.style.transition = 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
  toast.style.transform = 'translateY(12px)';
  toast.style.opacity = '0';

  const dot = document.createElement('span');
  dot.style.width = '6px';
  dot.style.height = '6px';
  dot.style.borderRadius = '50%';
  dot.style.background = borderColor;
  dot.style.boxShadow = `0 0 8px ${borderColor}`;

  toast.appendChild(dot);
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  toastContainer.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => toast.remove(), 250);
  }, 2600);
}

export function showToast(titleOrMessage, messageOrType = 'info', type) {
  let title = String(titleOrMessage || '');
  let message = '';
  let kind = 'info';

  if (typeof type === 'string') {
    message = String(messageOrType || '');
    kind = type;
  } else if (TOAST_TYPES.has(String(messageOrType))) {
    kind = String(messageOrType);
  } else if (typeof messageOrType === 'string') {
    message = messageOrType;
  }

  const container = typeof document !== 'undefined' ? document.getElementById('toast-container') : null;
  if (container) {
    renderStructuredToast(container, title, message, kind);
    return;
  }
  if (typeof document !== 'undefined') {
    renderCyberToast(message || title, kind);
  }
}

export function formatUnifiedDiffHtml(diffText) {
  const lines = (diffText || '').split('\n');
  const rendered = lines.map(line => {
    const esc = escapeHtml(line);
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
      return `<div class="diff-header-bar">${esc}</div>`;
    }
    if (line.startsWith('@@')) {
      return `<div class="diff-line-info">${esc}</div>`;
    }
    if (line.startsWith('+')) {
      return `<div class="diff-line-add">${esc}</div>`;
    }
    if (line.startsWith('-')) {
      return `<div class="diff-line-del">${esc}</div>`;
    }
    return `<div class="diff-line-same">${esc}</div>`;
  }).join('');
  return `<div class="diff-block">${rendered}</div>`;
}
