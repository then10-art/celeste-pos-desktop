/**
 * Celeste POS - Setup Preload Script
 * Minimal preload for the one-time tenant code setup screen.
 * Exposes only the validate-and-save IPC call.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('CelesteSetup', {
  validateAndSave: (code) => ipcRenderer.invoke('setup-validate-tenant', code),
});

// Inject version after DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  const versionEl = document.getElementById('appVersion');
  if (versionEl && window.__CELESTE_VERSION__) {
    versionEl.textContent = window.__CELESTE_VERSION__;
  }
});
