/**
 * Celeste POS - Setup Preload Script
 * Exposes IPC calls for the 2-step setup wizard:
 *   Step 1: Tenant code validation
 *   Step 2: Printer selection, test print, and save
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('CelesteSetup', {
  // Step 1: validate and save tenant code
  validateAndSave: (code) => ipcRenderer.invoke('setup-validate-tenant', code),

  // Step 2: get list of installed printers
  getAvailablePrinters: () => ipcRenderer.invoke('setup-get-printers'),

  // Step 2: send a test print to the selected printer
  testPrint: (printerName, paperSize, printMode) =>
    ipcRenderer.invoke('setup-test-print', { printerName, paperSize, printMode }),

  // Step 2: save printer config and mark printer setup done
  savePrinterSetup: (config) => ipcRenderer.invoke('setup-save-printer', config),

  // Step 2: finish setup (close wizard, open main window)
  finishSetup: () => ipcRenderer.invoke('setup-finish'),
});

// Inject version after DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  const versionEl = document.getElementById('appVersion');
  if (versionEl && window.__CELESTE_VERSION__) {
    versionEl.textContent = window.__CELESTE_VERSION__;
  }
});
