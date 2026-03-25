/**
 * Celeste POS - Preload Script
 * Exposes safe IPC bridge to the renderer (web app)
 * This runs in a privileged context before the web page loads
 */

const { contextBridge, ipcRenderer } = require('electron');

// ─── Expose Desktop API to Web App ───────────────────────────────────────────
contextBridge.exposeInMainWorld('CelesteDesktop', {
  // ── Identity ──────────────────────────────────────────────────────────────
  isDesktop: true,
  version: process.versions.electron,

  // ── Hardware: Receipt Printer ─────────────────────────────────────────────
  printReceipt: (receiptData) =>
    ipcRenderer.invoke('print-receipt', receiptData),

  // ── Hardware: Cash Drawer ─────────────────────────────────────────────────
  openCashDrawer: () =>
    ipcRenderer.invoke('open-cash-drawer'),

  // ── Hardware: Device Discovery ────────────────────────────────────────────
  getConnectedDevices: () =>
    ipcRenderer.invoke('get-devices'),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: () =>
    ipcRenderer.invoke('get-settings'),

  saveSettings: (settings) =>
    ipcRenderer.invoke('save-settings', settings),

  // ── Offline / Sync ────────────────────────────────────────────────────────
  getOfflineStatus: () =>
    ipcRenderer.invoke('get-offline-status'),

  queueOfflineTransaction: (transaction) =>
    ipcRenderer.invoke('queue-offline-transaction', transaction),

  // ── File System ───────────────────────────────────────────────────────────
  showSaveDialog: (options) =>
    ipcRenderer.invoke('show-save-dialog', options),

  showOpenDialog: (options) =>
    ipcRenderer.invoke('show-open-dialog', options),

  // ── Event Listeners ───────────────────────────────────────────────────────
  onOnline: (callback) => {
    window.addEventListener('celeste-online', callback);
    return () => window.removeEventListener('celeste-online', callback);
  },

  onOffline: (callback) => {
    window.addEventListener('celeste-offline', callback);
    return () => window.removeEventListener('celeste-offline', callback);
  },

  onOpenPrinterConfig: (callback) => {
    window.addEventListener('celeste-open-printer-config', callback);
    return () => window.removeEventListener('celeste-open-printer-config', callback);
  },
});
