/**
 * Celeste POS - Preload Script
 * Exposes safe IPC bridge to the renderer (web app)
 * This runs in a privileged context before the web page loads
 */

const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Machine Identity ────────────────────────────────────────────────────────
// Generate a stable machine ID persisted in %APPDATA%/CelestePOS/machine-id.txt
function getMachineId() {
  try {
    const appDataDir = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'CelestePOS'
    );
    const idFile = path.join(appDataDir, 'machine-id.txt');

    if (fs.existsSync(idFile)) {
      return fs.readFileSync(idFile, 'utf-8').trim();
    }

    // Generate new ID based on hostname + random suffix
    const id = `${os.hostname()}-${crypto.randomBytes(4).toString('hex')}`;
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.writeFileSync(idFile, id, 'utf-8');
    return id;
  } catch {
    // Fallback to hostname only
    return os.hostname();
  }
}

const machineId = getMachineId();
const machineName = os.hostname();

// ─── Sync event listeners ────────────────────────────────────────────────────
const syncListeners = [];

ipcRenderer.on('sync-complete', (_event, result) => {
  for (const cb of syncListeners) {
    try { cb(result); } catch { /* ignore listener errors */ }
  }
});

// ─── Expose Desktop API to Web App ───────────────────────────────────────────
contextBridge.exposeInMainWorld('CelesteDesktop', {
  // ── Identity ──────────────────────────────────────────────────────────────
  isDesktop: true,
  version: process.versions.electron,
  machineId,
  machineName,

  // ── Hardware: Receipt Printer ─────────────────────────────────────────────
  printReceipt: (receiptData, paperSize) =>
    ipcRenderer.invoke('print-receipt', receiptData, paperSize),

  getPrinterStatus: () =>
    ipcRenderer.invoke('get-printer-status'),

  // ── Hardware: Cash Drawer ─────────────────────────────────────────────────
  openCashDrawer: () =>
    ipcRenderer.invoke('open-cash-drawer'),

  // ── Hardware: Device Discovery ────────────────────────────────────────────
  getConnectedDevices: () =>
    ipcRenderer.invoke('get-devices'),

  // ── Printer Configuration ─────────────────────────────────────────────────
  getAvailablePrinters: () =>
    ipcRenderer.invoke('get-available-printers'),

  savePrinterConfig: (config) =>
    ipcRenderer.invoke('save-printer-config', config),

  // ── Diagnostic Test Prints ──────────────────────────────────────────────────
  testPrintMinimal: () =>
    ipcRenderer.invoke('test-print-minimal'),

  testPrintGDI: () =>
    ipcRenderer.invoke('test-print-gdi'),

  // ── Label Printer ───────────────────────────────────────────────────────────────
  printLabel: (html, printerName, widthMm, heightMm) =>
    ipcRenderer.invoke('print-label', { html, printerName, widthMm, heightMm }),

  saveLabelPrinter: (printerName) =>
    ipcRenderer.invoke('save-label-printer', printerName),

  getLabelPrinter: () =>
    ipcRenderer.invoke('get-label-printer'),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: () =>
    ipcRenderer.invoke('get-settings'),

  saveSettings: (settings) =>
    ipcRenderer.invoke('save-settings', settings),

  // ── Offline / Sync ────────────────────────────────────────────────────────
  getOfflineStatus: () =>
    ipcRenderer.invoke('get-offline-status'),

  getQueuedCount: () =>
    ipcRenderer.invoke('get-queued-count'),

  getQueueStats: () =>
    ipcRenderer.invoke('get-queue-stats'),

  queueOfflineTransaction: (transaction) =>
    ipcRenderer.invoke('queue-offline-transaction', transaction),

  retryFailedItems: () =>
    ipcRenderer.invoke('retry-failed-items'),

  forceSync: () =>
    ipcRenderer.invoke('force-sync'),

  onSyncComplete: (callback) => {
    syncListeners.push(callback);
    // Return cleanup function
    return () => {
      const idx = syncListeners.indexOf(callback);
      if (idx !== -1) syncListeners.splice(idx, 1);
    };
  },

  // ── File System ───────────────────────────────────────────────────────────
  showSaveDialog: (options) =>
    ipcRenderer.invoke('show-save-dialog', options),

  showOpenDialog: (options) =>
    ipcRenderer.invoke('show-open-dialog', options),

   // ── Tenant Info ───────────────────────────────────────────────────────
  getTenantInfo: () =>
    ipcRenderer.invoke('get-tenant-info'),

  // ── Event Listeners ───────────────────────────────────────────────────
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
