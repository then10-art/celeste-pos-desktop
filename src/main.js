/**
 * Celeste POS - Desktop Application
 * Main Electron process
 * Compatible with Windows 7/8/8.1/10/11 (Electron 22)
 */

const { app, BrowserWindow, Menu, Tray, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
// Use electron-updater for generic provider (latest.yml) support
// electron-updater reads publish config from package.json automatically
let autoUpdater = null;
let updaterAvailable = false;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false; // Ask user before downloading
  autoUpdater.logger = null; // Suppress verbose logs in production
  // Use user's temp directory to avoid EPERM on non-admin accounts
  const os = require('os');
  const pathModule = require('path');
  const userTempDir = pathModule.join(os.tmpdir(), 'celeste-pos-updates');
  try {
    require('fs').mkdirSync(userTempDir, { recursive: true });
    // electron-updater uses app.getPath('temp') internally, but we can set
    // the download cache path to avoid permission issues
    if (autoUpdater.downloadedUpdateHelper) {
      autoUpdater.downloadedUpdateHelper._cacheDir = userTempDir;
    }
  } catch (dirErr) {
    console.log('[Updater] Could not create temp dir:', dirErr.message);
  }
  updaterAvailable = true;
} catch (e) {
  console.log('[Updater] electron-updater not available:', e.message);
}

// ─── App Configuration ───────────────────────────────────────────────────────
const isDev = process.argv.includes('--dev');
const CLOUD_URL = 'https://celestepos.live';
const UPDATE_SERVER = 'https://celestepos.live/api/updates/';

// ─── Persistent Settings Store ───────────────────────────────────────────────
const store = new Store({
  defaults: {
    tenantSlug: '',
    tenantName: '',
    setupComplete: false,
    windowBounds: { width: 1280, height: 800 },
    isMaximized: false,
    autoLaunch: false,
    offlineMode: false,
    printerConfig: { type: 'usb', address: '', printerName: '' },
    cashDrawerConfig: { type: 'printer' },
  }
});

// ─── Global State ─────────────────────────────────────────────────────────────
let mainWindow = null;
let setupWindow = null;
let tray = null;
let isOnline = true;
let syncInterval = null;
let isSyncing = false; // Prevent concurrent sync runs
let consecutiveFailures = 0; // Track consecutive connectivity failures for adaptive polling
let retryTimerId = null; // Timer for scheduled retries
// Track whether the user manually triggered the update check (for error dialog)
let userTriggeredUpdateCheck = false;

// ─── Sync & Offline Modules ───────────────────────────────────────────────────
const { initDatabase, getOfflineQueue, clearSyncedItems, recordSyncFailure, getRetryableItems, getQueueStats, retryFailedItems, purgeOldSyncedItems } = require('./database');
const { syncWithCloud, checkCloudHealth } = require('./sync');
const { setupHardware, printReceipt, openCashDrawer, getConnectedDevices, getPrinterStatus, getAvailablePrinters, sendRawToPrinter, getAutoDetectedPrinterName } = require('./hardware');
const { printReceiptGDI, printLabelGDI, printLabelsGDI } = require('./hardware/offlinePrinter');
const { startLocalServer } = require('./local-server');

// ─── Local Server State ──────────────────────────────────────────────────────
let localServerPort = null;
let localServerInstance = null;

// ─── Tenant Setup (First Launch) ─────────────────────────────────────────────
function needsSetup() {
  return !store.get('setupComplete') || !store.get('tenantSlug');
}

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 500,
    height: 620,
    resizable: false,
    maximizable: false,
    minimizable: false,
    title: 'Celeste POS — Configuración Inicial',
    icon: path.join(__dirname, '../assets/icon.ico'),
    backgroundColor: '#f8f9fa',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'setup-preload.js'),
      webSecurity: true,
      enableRemoteModule: false,
    },
  });

  // No menu for setup window
  setupWindow.setMenuBarVisibility(false);

  // Load the local setup page
  setupWindow.loadFile(path.join(__dirname, 'setup.html'));

  // Inject version after load
  setupWindow.webContents.on('did-finish-load', () => {
    setupWindow.webContents.executeJavaScript(
      `window.__CELESTE_VERSION__ = '${app.getVersion()}';
       const vEl = document.getElementById('appVersion');
       if (vEl) vEl.textContent = '${app.getVersion()}';`
    ).catch(() => {});
  });

  setupWindow.once('ready-to-show', () => {
    setupWindow.show();
    setupWindow.focus();
  });

  setupWindow.on('closed', () => {
    setupWindow = null;
    // If setup wasn't completed, quit the app
    if (needsSetup()) {
      app.isQuitting = true;
      app.quit();
    }
  });

  return setupWindow;
}

// ─── IPC: Tenant Setup Validation ────────────────────────────────────────────
ipcMain.handle('setup-validate-tenant', async (event, code) => {
  const slug = code.trim().toLowerCase();

  // Basic validation
  if (!slug || slug.length < 2) {
    return { success: false, error: 'El código debe tener al menos 2 caracteres.' };
  }
  if (!/^[a-z0-9_-]+$/.test(slug)) {
    return { success: false, error: 'El código solo puede contener letras, números, guiones y guiones bajos.' };
  }

  // Validate against the server — check if the tenant exists
  try {
    const fetch = require('electron').net ? require('electron').net.fetch : global.fetch;
    // Try to reach the tenant page to verify it exists
    const response = await new Promise((resolve, reject) => {
      const https = require('https');
      const req = https.get(`${CLOUD_URL}/api/trpc/tenants.resolveSlug?input=${encodeURIComponent(JSON.stringify({ json: { slug } }))}`, {
        timeout: 10000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });

    if (response.status === 200) {
      // Parse the tRPC response — resolveSlug returns null for non-existent tenants
      let tenantData = null;
      try {
        const parsed = JSON.parse(response.data);
        tenantData = parsed.result?.data?.json || parsed.result?.data;
      } catch { /* parse error */ }

      // If tenant is null or inactive, the code doesn't exist
      if (!tenantData || !tenantData.name) {
        return { success: false, error: 'Código no encontrado. Verifique e intente de nuevo.' };
      }

      const tenantName = tenantData.name;

      // Save the tenant code and mark setup as complete
      store.set('tenantSlug', slug);
      store.set('tenantName', tenantName);
      store.set('setupComplete', true);

      console.log(`[Setup] Tenant configured: ${slug} (${tenantName})`);

      // Close setup window and launch main app
      if (setupWindow) {
        setupWindow.close();
      }
      launchMainApp();

      return { success: true, tenantName };
    } else {
      return { success: false, error: 'Error del servidor. Intente de nuevo más tarde.' };
    }
  } catch (err) {
    console.error('[Setup] Validation error:', err.message);

    // If offline, allow saving the code without validation (trust the user)
    const { response: offlineResponse } = await dialog.showMessageBox(setupWindow, {
      type: 'warning',
      title: 'Sin Conexión',
      message: 'No se pudo verificar el código porque no hay conexión a internet.\n\n¿Desea guardar el código de todas formas?',
      detail: `Código ingresado: ${slug.toUpperCase()}\n\nSi el código es incorrecto, podrá cambiarlo después.`,
      buttons: ['Guardar de Todas Formas', 'Cancelar'],
      defaultId: 0,
    });

    if (offlineResponse === 0) {
      store.set('tenantSlug', slug);
      store.set('tenantName', slug.toUpperCase());
      store.set('setupComplete', true);

      console.log(`[Setup] Tenant configured (offline): ${slug}`);

      if (setupWindow) {
        setupWindow.close();
      }
      launchMainApp();

      return { success: true, tenantName: slug.toUpperCase() };
    }

    return { success: false, error: 'Operación cancelada.' };
  }
});

// ─── Main App Launch ─────────────────────────────────────────────────────────
async function launchMainApp() {
  // Start local server for bundled frontend
  try {
    const result = await startLocalServer();
    if (result) {
      localServerPort = result.port;
      localServerInstance = result.server;
      console.log(`[App] Local server started on port ${localServerPort}`);
    } else {
      console.log('[App] No local webapp found — using cloud URL');
    }
  } catch (err) {
    console.error('[App] Failed to start local server:', err.message);
  }

  // Create main window
  createWindow();

  // Setup hardware with mainWindow reference for system printer access
  await setupHardware(store.get('printerConfig'), mainWindow);

  // Create system tray
  createTray();

  // Start connectivity monitoring
  startConnectivityMonitor();

  // Setup auto-updater event listeners
  setupAutoUpdater();

  // Check for updates on startup (after 10 seconds, silent)
  if (!isDev) {
    setTimeout(() => checkForUpdates(false), 10000);
  }
}

// ─── Window Creation ──────────────────────────────────────────────────────────
function createWindow() {
  const { width, height } = store.get('windowBounds');
  const isMaximized = store.get('isMaximized');

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    title: 'Celeste POS',
    icon: path.join(__dirname, '../assets/icon.ico'),
    backgroundColor: '#ffffff',
    show: false, // Show after ready-to-show
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Required for older Windows compatibility
      enableRemoteModule: false,
    },
  });

  // Remove default menu bar
  Menu.setApplicationMenu(buildAppMenu());

  // Load the web app — use local server if available, otherwise cloud
  const tenantSlug = store.get('tenantSlug');
  let url;
  if (localServerPort) {
    url = `http://127.0.0.1:${localServerPort}/t/${tenantSlug}`;
    console.log(`[App] Loading tenant locally: ${tenantSlug} → ${url}`);
  } else {
    url = `${CLOUD_URL}/t/${tenantSlug}`;
    console.log(`[App] Loading tenant from cloud: ${tenantSlug} → ${url}`);
  }
  mainWindow.loadURL(url);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    if (isMaximized) {
      mainWindow.maximize();
    } else {
      mainWindow.show();
    }
    mainWindow.focus();
  });

  // Save window state on close
  mainWindow.on('close', (e) => {
    const bounds = mainWindow.getBounds();
    store.set('windowBounds', { width: bounds.width, height: bounds.height });
    store.set('isMaximized', mainWindow.isMaximized());

    // Minimize to tray instead of closing
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Handle navigation - stay within celestepos.live or local server
  mainWindow.webContents.on('will-navigate', (e, navUrl) => {
    const isLocal = localServerPort && navUrl.startsWith(`http://127.0.0.1:${localServerPort}`);
    const isCloud = navUrl.startsWith(CLOUD_URL) || navUrl.startsWith('https://celestepos.live');
    if (!isLocal && !isCloud) {
      e.preventDefault();
      shell.openExternal(navUrl);
    }
  });

  // Handle new windows (open in browser)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Inject offline indicator when connectivity changes
  mainWindow.webContents.on('did-finish-load', () => {
    injectOfflineIndicator();
    injectDesktopBridge();
  });

  return mainWindow;
}

// ─── System Tray ─────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '../assets/tray-icon.ico');
  tray = new Tray(iconPath);

  const tenantName = store.get('tenantName') || store.get('tenantSlug') || 'Celeste POS';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Abrir ${tenantName}`,
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    { type: 'separator' },
    {
      label: isOnline ? '🟢 En línea' : '🔴 Sin conexión',
      enabled: false,
    },
    {
      label: `Negocio: ${store.get('tenantSlug', '').toUpperCase()}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Configuración',
      click: () => {
        mainWindow.show();
        const base = localServerPort ? `http://127.0.0.1:${localServerPort}` : CLOUD_URL;
        mainWindow.loadURL(`${base}/t/${store.get('tenantSlug')}/settings`);
      }
    },
    {
      label: 'Cambiar Negocio',
      click: () => resetTenantSetup()
    },
    {
      label: 'Verificar Actualizaciones',
      click: () => checkForUpdates(true)
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip(`Celeste POS — ${tenantName}`);
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

// ─── Reset Tenant (Change Business) ──────────────────────────────────────────
async function resetTenantSetup() {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Cambiar Negocio',
    message: '¿Está seguro que desea desvincular esta terminal del negocio actual?',
    detail: `Negocio actual: ${store.get('tenantName') || store.get('tenantSlug')}\n\nLa aplicación se reiniciará y deberá ingresar un nuevo código de negocio.`,
    buttons: ['Cambiar Negocio', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
  });

  if (response === 0) {
    store.set('tenantSlug', '');
    store.set('tenantName', '');
    store.set('setupComplete', false);

    // Relaunch the app
    app.relaunch();
    app.isQuitting = true;
    app.quit();
  }
}

// ─── App Menu ─────────────────────────────────────────────────────────────────
function buildAppMenu() {
  const tenantSlug = store.get('tenantSlug') || '';
  return Menu.buildFromTemplate([
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Recargar',
          accelerator: 'F5',
          click: () => mainWindow.reload()
        },
        {
          label: 'Pantalla Completa',
          accelerator: 'F11',
          click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen())
        },
        { type: 'separator' },
        {
          label: 'Cambiar Negocio',
          click: () => resetTenantSetup()
        },
        { type: 'separator' },
        {
          label: 'Salir',
          accelerator: 'Alt+F4',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Hardware',
      submenu: [
        {
          label: 'Configurar Impresora',
          click: () => openPrinterConfig()
        },
        {
          label: 'Probar Impresora',
          click: () => testPrinter()
        },
        {
          label: 'Abrir Gaveta',
          click: () => openCashDrawer()
        },
        { type: 'separator' },
        {
          label: 'Test: Raw ESC/POS Mínimo',
          click: () => testPrintMinimal()
        },
        {
          label: 'Test: GDI (como Eleventa)',
          click: () => testPrintGDI()
        },
        {
          label: 'Test: Etiqueta/Sticker',
          click: () => testPrintLabel()
        },
        { type: 'separator' },
        {
          label: 'Dispositivos Conectados',
          click: () => showConnectedDevices()
        }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Verificar Actualizaciones',
          click: () => checkForUpdates(true)
        },
        {
          label: 'Acerca de Celeste POS',
          click: () => showAbout()
        }
      ]
    }
  ]);
}

// ─── Offline Indicator Injection ─────────────────────────────────────────────
function injectOfflineIndicator() {
  const script = `
    (function() {
      // Create offline banner
      const banner = document.createElement('div');
      banner.id = 'celeste-offline-banner';
      banner.style.cssText = \`
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 99999;
        background: #ef4444;
        color: white;
        text-align: center;
        padding: 6px 12px;
        font-size: 13px;
        font-family: system-ui, sans-serif;
        font-weight: 500;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        transition: background-color 0.3s ease;
      \`;
      banner.innerHTML = '\u26a0\ufe0f Sin conexi\u00f3n a internet \u2014 Las transacciones se guardar\u00e1n localmente y se sincronizar\u00e1n cuando se restaure la conexi\u00f3n.';
      document.body.prepend(banner);

      // Create syncing banner (green, shows during active sync)
      const syncBanner = document.createElement('div');
      syncBanner.id = 'celeste-sync-banner';
      syncBanner.style.cssText = \`
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 99998;
        background: #22c55e;
        color: white;
        text-align: center;
        padding: 6px 12px;
        font-size: 13px;
        font-family: system-ui, sans-serif;
        font-weight: 500;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        transition: opacity 0.5s ease;
      \`;
      document.body.prepend(syncBanner);

      // Listen for offline status from main process
      window.addEventListener('celeste-offline', () => {
        banner.style.display = 'block';
        document.body.style.paddingTop = '34px';
      });
      window.addEventListener('celeste-online', () => {
        banner.style.display = 'none';
        document.body.style.paddingTop = syncBanner.style.display === 'block' ? '34px' : '';
      });

      // Listen for sync events
      window.addEventListener('celeste-sync-start', () => {
        syncBanner.innerHTML = '\ud83d\udd04 Sincronizando transacciones pendientes...';
        syncBanner.style.display = 'block';
        if (banner.style.display !== 'block') {
          document.body.style.paddingTop = '34px';
        }
      });
      window.addEventListener('celeste-sync-complete', (e) => {
        const detail = e.detail || {};
        if (detail.synced > 0) {
          syncBanner.innerHTML = '\u2705 ' + detail.synced + ' transaccion' + (detail.synced === 1 ? '' : 'es') + ' sincronizada' + (detail.synced === 1 ? '' : 's');
          syncBanner.style.background = '#22c55e';
        } else {
          syncBanner.style.display = 'none';
          if (banner.style.display !== 'block') document.body.style.paddingTop = '';
          return;
        }
        // Auto-hide after 3 seconds
        setTimeout(() => {
          syncBanner.style.display = 'none';
          if (banner.style.display !== 'block') document.body.style.paddingTop = '';
        }, 3000);
      });

      // Toast helper for sync notifications
      window.__celesteShowToast = window.__celesteShowToast || function(msg, type) {
        const toast = document.createElement('div');
        toast.style.cssText = \`
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 99999;
          padding: 12px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-family: system-ui, sans-serif;
          font-weight: 500;
          color: white;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          opacity: 0;
          transition: opacity 0.3s ease;
          max-width: 400px;
        \`;
        toast.style.background = type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6';
        toast.textContent = msg;
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = '1'; });
        setTimeout(() => {
          toast.style.opacity = '0';
          setTimeout(() => toast.remove(), 300);
        }, 4000);
      };
    })();
  `;
  mainWindow.webContents.executeJavaScript(script).catch(() => {});
}

// ─── Desktop Bridge Injection ─────────────────────────────────────────────────
function injectDesktopBridge() {
  // Inject a flag so the web app knows it's running in desktop mode
  const tenantSlug = store.get('tenantSlug') || '';
  const tenantName = store.get('tenantName') || '';
  const script = `
    window.__CELESTE_DESKTOP__ = true;
    window.__CELESTE_VERSION__ = '${app.getVersion()}';
    window.__CELESTE_TENANT__ = '${tenantSlug}';
    window.__CELESTE_TENANT_NAME__ = '${tenantName}';
    // Ensure CelesteDesktop bridge is visible (fallback if preload didn't run)
    if (!window.CelesteDesktop) {
      console.warn('[Celeste POS Desktop] CelesteDesktop bridge not found from preload, injecting minimal fallback');
      window.CelesteDesktop = { isDesktop: true, version: '${app.getVersion()}', _fallback: true };
    } else {
      console.log('[Celeste POS Desktop] CelesteDesktop bridge detected from preload');
    }
    console.log('[Celeste POS Desktop] Running in desktop mode v${app.getVersion()} — Tenant: ${tenantSlug}');
  `;
  mainWindow.webContents.executeJavaScript(script).catch(() => {});
}

// ─── Connectivity Monitoring (Adaptive Polling) ─────────────────────────────
function startConnectivityMonitor() {
  const BASE_INTERVAL = 10000;  // 10 seconds when online
  const MAX_INTERVAL = 120000;  // 2 minutes max when offline

  async function checkConnectivity() {
    try {
      const healthy = await checkCloudHealth(5000);
      const wasOffline = !isOnline;
      isOnline = healthy;

      if (healthy) {
        consecutiveFailures = 0;

        if (wasOffline) {
          console.log('[Connectivity] Connection restored!');
          mainWindow?.webContents.executeJavaScript(
            "window.dispatchEvent(new Event('celeste-online'));"
          ).catch(() => {});
          updateOfflineBanner();
          // Trigger sync immediately when coming back online
          syncOfflineQueue();
        }
      }
    } catch {
      consecutiveFailures++;
      if (isOnline) {
        isOnline = false;
        console.log('[Connectivity] Connection lost');
        mainWindow?.webContents.executeJavaScript(
          "window.dispatchEvent(new Event('celeste-offline'));"
        ).catch(() => {});
        updateOfflineBanner();
      }
    }

    // Adaptive polling: back off when offline, speed up when online
    const nextInterval = isOnline
      ? BASE_INTERVAL
      : Math.min(BASE_INTERVAL * Math.pow(1.5, consecutiveFailures), MAX_INTERVAL);

    setTimeout(checkConnectivity, nextInterval);
  }

  // Start the first check
  setTimeout(checkConnectivity, BASE_INTERVAL);

  // Also start the retry timer for queued items
  startRetryTimer();

  // Purge old synced items on startup
  purgeOldSyncedItems();
}

/**
 * Periodically check for items ready to retry (based on their next_retry time)
 */
function startRetryTimer() {
  retryTimerId = setInterval(() => {
    if (isOnline && !isSyncing) {
      const retryable = getRetryableItems();
      if (retryable.length > 0) {
        console.log(`[Retry] Found ${retryable.length} items ready for retry`);
        syncOfflineQueue();
      }
    }
  }, 15000); // Check every 15 seconds
}

/**
 * Update the offline banner with pending sync count
 */
function updateOfflineBanner() {
  const stats = getQueueStats();
  const pendingCount = stats.pending + stats.retrying;

  if (!isOnline && pendingCount > 0) {
    mainWindow?.webContents.executeJavaScript(`
      (function() {
        const banner = document.getElementById('celeste-offline-banner');
        if (banner) {
          banner.innerHTML = '⚠️ Sin conexión — ${pendingCount} transaccion${pendingCount === 1 ? '' : 'es'} pendiente${pendingCount === 1 ? '' : 's'} de sincronizar';
          banner.style.display = 'block';
          document.body.style.paddingTop = '34px';
        }
      })();
    `).catch(() => {});
  } else if (!isOnline) {
    mainWindow?.webContents.executeJavaScript(`
      (function() {
        const banner = document.getElementById('celeste-offline-banner');
        if (banner) {
          banner.innerHTML = '⚠️ Sin conexión a internet — Las transacciones se guardarán localmente y se sincronizarán cuando se restaure la conexión.';
          banner.style.display = 'block';
          document.body.style.paddingTop = '34px';
        }
      })();
    `).catch(() => {});
  }
}

// ─── Offline Queue Sync (Resilient) ──────────────────────────────────────────
async function syncOfflineQueue() {
  // Prevent concurrent sync runs
  if (isSyncing) {
    console.log('[Sync] Already syncing, skipping...');
    return;
  }

  isSyncing = true;
  try {
    // Use getRetryableItems which respects backoff timers
    const queue = getRetryableItems();
    if (queue.length === 0) {
      isSyncing = false;
      return;
    }

    console.log(`[Sync] Syncing ${queue.length} offline transactions...`);

    // Notify renderer that sync is starting
    mainWindow?.webContents.executeJavaScript(
      `window.dispatchEvent(new Event('celeste-sync-start'));`
    ).catch(() => {});

    const result = await syncWithCloud(queue, {
      onItemSynced: (id) => {
        console.log(`[Sync] Item ${id} synced successfully`);
      },
      onItemFailed: (id, error) => {
        console.warn(`[Sync] Item ${id} failed: ${error}`);
        recordSyncFailure(id, error);
      },
    });

    // Clear successfully synced items
    if (result.synced.length > 0) {
      clearSyncedItems(result.synced);
    }

    const stats = getQueueStats();
    console.log(`[Sync] Result: ${result.synced.length} synced, ${result.failed.length} failed | Queue: ${stats.pending} pending, ${stats.retrying} retrying, ${stats.failed} permanently failed`);

    // Notify the renderer about sync completion
    mainWindow?.webContents.send('sync-complete', {
      synced: result.synced.length,
      failed: result.failed.length,
      queued: stats.pending + stats.retrying,
      permanentlyFailed: stats.failed,
    });

    // Show toast notifications
    if (result.synced.length > 0) {
      mainWindow?.webContents.executeJavaScript(`
        if (window.__celesteShowToast) {
          window.__celesteShowToast('${result.synced.length} transaccion${result.synced.length === 1 ? '' : 'es'} sincronizada${result.synced.length === 1 ? '' : 's'} con la nube', 'success');
        }
      `).catch(() => {});
    }

    if (result.failed.length > 0 && stats.failed > 0) {
      mainWindow?.webContents.executeJavaScript(`
        if (window.__celesteShowToast) {
          window.__celesteShowToast('${stats.failed} transaccion${stats.failed === 1 ? '' : 'es'} no se pudieron sincronizar despu\u00e9s de m\u00faltiples intentos', 'error');
        }
      `).catch(() => {});
    }

    // Notify renderer that sync is complete
    mainWindow?.webContents.executeJavaScript(`
      window.dispatchEvent(new CustomEvent('celeste-sync-complete', { detail: { synced: ${result.synced.length}, failed: ${result.failed.length} } }));
    `).catch(() => {});

    // Update the offline banner with current count
    updateOfflineBanner();
  } catch (err) {
    console.error('[Sync] Error syncing offline queue:', err);
  } finally {
    isSyncing = false;
  }
}

// ─── Auto Updater ─────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (!updaterAvailable || !autoUpdater) return;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    const notes = info.releaseNotes
      ? (typeof info.releaseNotes === 'string' ? info.releaseNotes : info.releaseNotes.map(n => n.note || n).join('\n'))
      : '';
    const detailText = notes
      ? `\n\nNovedades:\n${notes.replace(/<[^>]*>/g, '').substring(0, 500)}`
      : '';
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Actualización Disponible',
      message: `Hay una nueva versión de Celeste POS disponible (v${info.version}). ¿Desea descargarla ahora?`,
      detail: detailText || undefined,
      buttons: ['Descargar', 'Más Tarde'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] No updates available.');
    if (userTriggeredUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Sin Actualizaciones',
        message: `Celeste POS v${app.getVersion()} está actualizado.`,
      });
      userTriggeredUpdateCheck = false;
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
    // Clear taskbar progress on error
    if (mainWindow) mainWindow.setProgressBar(-1);

    const isPermError = err.message && (err.message.includes('EPERM') || err.message.includes('EACCES') || err.message.includes('operation not permitted'));
    
    if (isPermError) {
      // EPERM: the app doesn't have write permission to the temp folder
      // Offer manual download instead of confusing the user
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Permisos Insuficientes',
        message: 'No se pudo descargar la actualización por falta de permisos.\n\nSoluciones:\n1. Cierre la aplicación, haga clic derecho y seleccione "Ejecutar como Administrador"\n2. O descargue la actualización manualmente desde el sitio web',
        detail: err.message,
        buttons: ['Descargar Manual', 'Cerrar'],
        defaultId: 0
      }).then(({ response }) => {
        if (response === 0) {
          const { shell } = require('electron');
          shell.openExternal('https://celestepos.live/download');
        }
      });
    } else if (userTriggeredUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Error de Actualización',
        message: `No se pudo verificar actualizaciones.\n\nAsegúrese de tener conexión a internet e intente de nuevo más tarde.`,
        detail: err.message,
        buttons: ['Descargar Manual', 'Cerrar'],
        defaultId: 1
      }).then(({ response }) => {
        if (response === 0) {
          const { shell } = require('electron');
          shell.openExternal('https://celestepos.live/download');
        }
      });
    }
    userTriggeredUpdateCheck = false;
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    console.log(`[Updater] Download progress: ${pct}%`);
    // Update taskbar progress on Windows
    if (mainWindow) {
      mainWindow.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    // Clear taskbar progress
    if (mainWindow) mainWindow.setProgressBar(-1);

    const notes = info.releaseNotes
      ? (typeof info.releaseNotes === 'string' ? info.releaseNotes : info.releaseNotes.map(n => n.note || n).join('\n'))
      : '';
    const detailText = notes
      ? `\nNovedades:\n${notes.replace(/<[^>]*>/g, '').substring(0, 500)}`
      : '';
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Actualización Lista',
      message: `La versión ${info.version} está lista para instalar. ¿Desea reiniciar ahora?`,
      detail: detailText || undefined,
      buttons: ['Reiniciar Ahora', 'Más Tarde'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });
}

function checkForUpdates(showNoUpdateDialog = false) {
  if (isDev) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Actualizaciones',
      message: 'Las actualizaciones automáticas no están disponibles en modo desarrollo.',
    });
    return;
  }

  if (!updaterAvailable || !autoUpdater) {
    if (showNoUpdateDialog) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Actualizaciones',
        message: 'El módulo de actualizaciones no está disponible. Visite celestepos.live para descargar la última versión.',
      });
    }
    return;
  }

  userTriggeredUpdateCheck = showNoUpdateDialog;

  // electron-updater reads the publish config from package.json automatically
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[Updater] checkForUpdates error:', err.message);
    if (showNoUpdateDialog) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Error de Actualización',
        message: 'No se pudo verificar actualizaciones.\n\nAsegúrese de tener conexión a internet e intente de nuevo más tarde.',
        detail: err.message,
      });
    }
    userTriggeredUpdateCheck = false;
  });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('print-receipt', async (event, receiptData, paperSize) => {
  // Handle label printing (pre-built HTML with custom page size)
  if (paperSize === 'label' && receiptData.html) {
    return await printLabelHTML(receiptData.html, store.get('labelPrinterName') || store.get('printerConfig.printerName'), receiptData.widthMm, receiptData.heightMm);
  }

  // Determine print mode: 'gdi' (Windows Driver, like Eleventa) or 'raw' (ESC/POS)
  const printMode = store.get('printMode') || 'gdi';
  const printerName = store.get('printerConfig.printerName') || await getAutoDetectedPrinterName();
  console.log('[IPC] print-receipt mode:', printMode, 'printer:', printerName, 'paperSize:', paperSize);

  if (printMode === 'gdi') {
    // PRIMARY: GDI mode (Windows Driver) - most compatible, like Eleventa
    try {
      const result = await printReceiptGDI(receiptData, printerName, paperSize);
      console.log('[IPC] print-receipt GDI result:', JSON.stringify(result));
      return result;
    } catch (err) {
      console.warn('[IPC] GDI print failed:', err.message, '- trying raw ESC/POS fallback');
      // Fallback to raw ESC/POS
      try {
        const result = await printReceipt(receiptData, paperSize);
        return result;
      } catch (err2) {
        console.error('[IPC] Both GDI and ESC/POS failed:', err2.message);
        return { success: false, error: `GDI: ${err.message} | ESC/POS: ${err2.message}` };
      }
    }
  } else {
    // RAW mode: ESC/POS direct (original behavior)
    try {
      const result = await printReceipt(receiptData, paperSize);
      console.log('[IPC] print-receipt RAW result:', JSON.stringify(result));
      return result;
    } catch (err) {
      console.warn('[IPC] RAW ESC/POS failed:', err.message, '- trying GDI fallback');
      // Fallback to GDI
      try {
        const result = await printReceiptGDI(receiptData, printerName, paperSize);
        return result;
      } catch (err2) {
        console.error('[IPC] Both ESC/POS and GDI failed:', err2.message);
        return { success: false, error: `ESC/POS: ${err.message} | GDI: ${err2.message}` };
      }
    }
  }
});

// ─── Label Printing (HTML with @page size) ──────────────────────────────────
ipcMain.handle('print-label', async (event, { html, printerName, widthMm, heightMm }) => {
  const name = printerName || store.get('labelPrinterName') || store.get('printerConfig.printerName');
  return await printLabelHTML(html, name, widthMm, heightMm);
});

// ─── Offline Label Printing (structured data, no HTML from web app) ─────────
ipcMain.handle('print-labels-offline', async (event, { labels, printerName, widthMm, heightMm }) => {
  const name = printerName || store.get('labelPrinterName') || store.get('printerConfig.printerName');
  console.log('[IPC] print-labels-offline:', labels.length, 'labels to:', name);
  try {
    const result = await printLabelsGDI(labels, name, widthMm || 37.3, heightMm || 28.6);
    return result;
  } catch (err) {
    console.error('[IPC] print-labels-offline error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('print-label-offline', async (event, { labelData, printerName, widthMm, heightMm }) => {
  const name = printerName || store.get('labelPrinterName') || store.get('printerConfig.printerName');
  console.log('[IPC] print-label-offline:', labelData.productName, 'to:', name);
  try {
    const result = await printLabelGDI(labelData, name, widthMm || 37.3, heightMm || 28.6);
    return result;
  } catch (err) {
    console.error('[IPC] print-label-offline error:', err.message);
    return { success: false, error: err.message };
  }
});

// ─── Print Mode Setting ─────────────────────────────────────────────────────
ipcMain.handle('set-print-mode', (event, mode) => {
  // mode: 'gdi' (Windows Driver, like Eleventa) or 'raw' (ESC/POS)
  store.set('printMode', mode);
  console.log('[IPC] Print mode set to:', mode);
  return true;
});

ipcMain.handle('get-print-mode', () => {
  return store.get('printMode') || 'gdi';
});

ipcMain.handle('save-label-printer', (event, printerName) => {
  store.set('labelPrinterName', printerName);
  return true;
});

ipcMain.handle('get-label-printer', () => {
  return store.get('labelPrinterName') || '';
});

async function printLabelHTML(html, printerName, widthMm, heightMm) {
  if (!mainWindow) throw new Error('No window reference');
  if (!printerName) {
    // Auto-detect: prefer 4BARCODE, then any non-system printer
    const printers = mainWindow.webContents.getPrinters();
    const barcodePrinter = printers.find(p => p.name.includes('4BARCODE') || p.name.includes('4B-'));
    if (barcodePrinter) {
      printerName = barcodePrinter.name;
    } else {
      const filtered = printers.filter(p => !['Microsoft XPS Document Writer', 'Fax', 'Microsoft Print to PDF', 'EPSON ET-2550 Series'].includes(p.name));
      if (filtered.length > 0) printerName = filtered[0].name;
      else throw new Error('No printer found');
    }
  }

  // Convert mm to microns (1mm = 1000 microns)
  // Default to 37.3x28.6mm to match 4BARCODE 4B-2074B sticker size
  const wMicrons = Math.round((widthMm || 37.3) * 1000);
  const hMicrons = Math.round((heightMm || 28.6) * 1000);

  console.log(`[Label Print] Printer: ${printerName}, Size: ${wMicrons}x${hMicrons} microns (${widthMm || 37.3}x${heightMm || 28.6}mm)`);

  return new Promise((resolve, reject) => {
    const { BrowserWindow: BW } = require('electron');
    const printWin = new BW({
      show: false,
      width: 800,
      height: 600,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    printWin.webContents.on('did-finish-load', () => {
      // Wait a moment for images/barcodes to render
      setTimeout(() => {
        printWin.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName: printerName,
            margins: { marginType: 'none' },
            pageSize: { width: wMicrons, height: hMicrons },
            // Don't set scaleFactor — let the system auto-scale to fit the label
          },
          (success, failureReason) => {
            printWin.close();
            if (success) {
              console.log('[Label Print] Success');
              resolve({ success: true });
            } else {
              console.error('[Label Print] Failed:', failureReason);
              reject(new Error(failureReason || 'Label print failed'));
            }
          }
        );
      }, 1200); // Wait longer for images/barcodes to render
    });

    printWin.webContents.on('did-fail-load', (event, errorCode, errorDesc) => {
      console.error('[Label Print] Failed to load HTML:', errorDesc);
      try { printWin.close(); } catch { /* ignore */ }
      reject(new Error(`Failed to load label HTML: ${errorDesc}`));
    });

    setTimeout(() => {
      try { printWin.close(); } catch { /* ignore */ }
      reject(new Error('Label print timeout'));
    }, 15000);
  });
}

ipcMain.handle('open-cash-drawer', async () => {
  return await openCashDrawer();
});

ipcMain.handle('get-devices', async () => {
  return await getConnectedDevices();
});

ipcMain.handle('get-printer-status', async () => {
  return await getPrinterStatus();
});

ipcMain.handle('get-available-printers', async () => {
  return await getAvailablePrinters();
});

ipcMain.handle('save-printer-config', (event, config) => {
  store.set('printerConfig', config);
  // Re-initialize hardware with new config, passing mainWindow for system printer access
  setupHardware(config, mainWindow);
  return true;
});

// ─── Diagnostic Test Prints ─────────────────────────────────────────────────
// Minimal raw ESC/POS test - sends absolute minimum data to isolate issues
ipcMain.handle('test-print-minimal', async () => {
  const printerName = store.get('printerConfig.printerName') || await getAutoDetectedPrinterName();
  if (!printerName) return { success: false, error: 'No printer configured' };

  try {
    // Test 1: Absolute minimum - just ESC @ init + plain ASCII text + line feeds + cut
    // NO code page commands, NO formatting - just raw ASCII
    const ESC = 0x1B, GS = 0x1D, LF = 0x0A;
    const text = 'HELLO WORLD - CELESTE POS TEST';
    const textBytes = Buffer.from(text, 'ascii');
    const rawData = Buffer.concat([
      Buffer.from([ESC, 0x40]),           // ESC @ - Initialize printer
      textBytes,                           // Plain ASCII text
      Buffer.from([LF, LF]),              // Line feeds
      Buffer.from('Fecha: ' + new Date().toLocaleString('es-DO'), 'ascii'),
      Buffer.from([LF, LF, LF, LF]),     // Feed paper
      Buffer.from([GS, 0x56, 0x41, 0x03]) // GS V A 3 - Partial cut
    ]);
    console.log('[Test] Sending minimal raw ESC/POS:', rawData.length, 'bytes to:', printerName);
    const result = await sendRawToPrinter(rawData, printerName);
    return { success: true, method: 'raw-minimal', ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// GDI text test - prints via Windows driver like Eleventa does (Courier New, plain text)
ipcMain.handle('test-print-gdi', async () => {
  const printerName = store.get('printerConfig.printerName') || await getAutoDetectedPrinterName();
  if (!printerName) return { success: false, error: 'No printer configured' };

  try {
    const { BrowserWindow: BW } = require('electron');
    const os = require('os');
    const path = require('path');
    const fs = require('fs');

    // Build a simple text-based receipt like Eleventa does
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
@page { margin: 0; size: 80mm auto; }
body { font-family: 'Courier New', monospace; font-size: 12pt; width: 80mm; margin: 0; padding: 2mm; }
</style></head><body>
<pre>
========================================
        SUPERMERCADO CELESTE
        PRUEBA DE IMPRESION
========================================
Fecha: ${new Date().toLocaleString('es-DO')}

Este es un test de impresion GDI.
Si puede ver este texto, la impresora
funciona con el metodo Windows GDI.

Columnas: 42 caracteres (80mm)
========================================
123456789012345678901234567890123456789012
========================================



</pre>
</body></html>`;

    const tmpFile = path.join(os.tmpdir(), `celeste-gdi-test-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html, 'utf-8');

    return new Promise((resolve, reject) => {
      const printWin = new BW({
        show: false, width: 302, height: 2000,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });
      printWin.loadFile(tmpFile);
      printWin.webContents.on('did-finish-load', () => {
        setTimeout(() => {
          printWin.webContents.print({
            silent: true, printBackground: true, deviceName: printerName,
            margins: { marginType: 'none' },
            pageSize: { width: 80000, height: 300000 }
          }, (success, failureReason) => {
            printWin.close();
            try { fs.unlinkSync(tmpFile); } catch {}
            if (success) resolve({ success: true, method: 'gdi-text' });
            else resolve({ success: false, error: failureReason || 'GDI print failed' });
          });
        }, 1000);
      });
      setTimeout(() => {
        try { printWin.close(); } catch {}
        try { fs.unlinkSync(tmpFile); } catch {}
        resolve({ success: false, error: 'GDI print timeout' });
      }, 15000);
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-settings', () => {
  return store.store;
});

ipcMain.handle('save-settings', (event, settings) => {
  Object.entries(settings).forEach(([key, value]) => {
    store.set(key, value);
  });
  return true;
});

ipcMain.handle('get-offline-status', () => {
  const stats = getQueueStats();
  return {
    isOnline,
    isSyncing,
    queueLength: stats.pending + stats.retrying,
    stats,
  };
});

ipcMain.handle('get-queued-count', () => {
  const stats = getQueueStats();
  return stats.pending + stats.retrying;
});

ipcMain.handle('get-queue-stats', () => {
  return getQueueStats();
});

ipcMain.handle('queue-offline-transaction', (event, transaction) => {
  const { queueTransaction } = require('./database');
  const result = queueTransaction(transaction);
  // Update the banner immediately to reflect the new item
  updateOfflineBanner();
  return result;
});

ipcMain.handle('retry-failed-items', () => {
  const count = retryFailedItems();
  if (count > 0) {
    console.log(`[Sync] Reset ${count} failed items for retry`);
    syncOfflineQueue(); // Trigger immediate sync
  }
  return count;
});

ipcMain.handle('force-sync', async () => {
  if (!isOnline) return { success: false, reason: 'offline' };
  if (isSyncing) return { success: false, reason: 'already_syncing' };
  await syncOfflineQueue();
  return { success: true, stats: getQueueStats() };
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  return await dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  return await dialog.showOpenDialog(mainWindow, options);
});

// ─── IPC: Get tenant info ────────────────────────────────────────────────────
ipcMain.handle('get-tenant-info', () => {
  return {
    slug: store.get('tenantSlug'),
    name: store.get('tenantName'),
    setupComplete: store.get('setupComplete'),
  };
});

// ─── Helper Dialogs ───────────────────────────────────────────────────────────
async function openPrinterConfig() {
  mainWindow.show();

  // Get available printers and show a native dialog for selection
  try {
    const printers = await getAvailablePrinters();
    const receiptPrinters = printers.filter(p => !['Microsoft XPS Document Writer', 'Fax', 'Microsoft Print to PDF'].includes(p.name));

    if (receiptPrinters.length === 0) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Configurar Impresora',
        message: 'No se encontraron impresoras instaladas.\n\nAsegúrese de que la impresora esté conectada y tenga los drivers instalados.',
      });
      return;
    }

    const currentPrinter = store.get('printerConfig.printerName') || '(ninguna)';
    const printerNames = receiptPrinters.map(p => {
      const status = p.status === 'ready' ? '✓' : '✗';
      const receipt = p.isReceipt ? ' [Recibo]' : '';
      return `${status} ${p.name}${receipt}`;
    });

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Configurar Impresora',
      message: `Impresora actual: ${currentPrinter}\n\nSeleccione la impresora de recibos:`,
      buttons: [...printerNames, 'Cancelar'],
      defaultId: 0,
      cancelId: printerNames.length,
    });

    if (response < receiptPrinters.length) {
      const selected = receiptPrinters[response];
      const newConfig = {
        type: selected.type === 'network' ? 'network' : 'usb',
        address: store.get('printerConfig.address') || '',
        printerName: selected.name,
      };
      store.set('printerConfig', newConfig);
      setupHardware(newConfig, mainWindow);

      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Impresora Configurada',
        message: `Impresora seleccionada: ${selected.name}\n\nUse "Probar Impresora" para verificar que funciona correctamente.`,
      });
    }
  } catch (err) {
    dialog.showErrorBox('Error', `No se pudo obtener la lista de impresoras: ${err.message}`);
  }
}

async function testPrinter() {
  try {
    await printReceipt({
      type: 'test',
      lines: [
        { type: 'title', text: 'CELESTE POS' },
        { type: 'text', text: 'Prueba de Impresora' },
        { type: 'divider' },
        { type: 'text', text: new Date().toLocaleString('es-DO') },
        { type: 'divider' },
        { type: 'text', text: 'Impresora funcionando correctamente.' },
      ]
    });
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Prueba de Impresora',
      message: 'Impresora funcionando correctamente.',
    });
  } catch (err) {
    dialog.showErrorBox('Error de Impresora', `No se pudo imprimir: ${err.message}`);
  }
}

async function testPrintMinimal() {
  const printerName = store.get('printerConfig.printerName') || await getAutoDetectedPrinterName();
  if (!printerName) {
    dialog.showErrorBox('Error', 'No hay impresora configurada.');
    return;
  }
  try {
    const ESC = 0x1B, GS = 0x1D, LF = 0x0A;
    const text = 'HELLO WORLD - CELESTE POS TEST';
    const textBytes = Buffer.from(text, 'ascii');
    const rawData = Buffer.concat([
      Buffer.from([ESC, 0x40]),
      textBytes,
      Buffer.from([LF, LF]),
      Buffer.from('Fecha: ' + new Date().toLocaleString('es-DO'), 'ascii'),
      Buffer.from([LF, LF, LF, LF]),
      Buffer.from([GS, 0x56, 0x41, 0x03])
    ]);
    await sendRawToPrinter(rawData, printerName);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Test Raw ESC/POS',
      message: `Enviado ${rawData.length} bytes a "${printerName}".\nSi sale en blanco, el problema es ESC/POS.\nPruebe el test GDI.`,
    });
  } catch (err) {
    dialog.showErrorBox('Error Raw ESC/POS', `Fallo: ${err.message}`);
  }
}

async function testPrintGDI() {
  const printerName = store.get('printerConfig.printerName') || await getAutoDetectedPrinterName();
  if (!printerName) {
    dialog.showErrorBox('Error', 'No hay impresora configurada.');
    return;
  }
  try {
    const os = require('os');
    const pathMod = require('path');
    const fs = require('fs');
    const { BrowserWindow: BW } = require('electron');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
@page { margin: 0; size: 80mm auto; }
body { font-family: 'Courier New', monospace; font-size: 12pt; width: 80mm; margin: 0; padding: 2mm; }
</style></head><body>
<pre>
========================================
        SUPERMERCADO CELESTE
        PRUEBA DE IMPRESION GDI
========================================
Fecha: ${new Date().toLocaleString('es-DO')}

Este es un test GDI (Windows driver).
Si puede ver este texto, use GDI
como metodo principal de impresion.

========================================
123456789012345678901234567890123456789012
========================================



</pre>
</body></html>`;

    const tmpFile = pathMod.join(os.tmpdir(), `celeste-gdi-test-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html, 'utf-8');

    const printWin = new BW({
      show: false, width: 800, height: 600,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    printWin.loadFile(tmpFile);
    printWin.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        printWin.webContents.print({
          silent: true, printBackground: true, deviceName: printerName,
          margins: { marginType: 'none' },
          pageSize: { width: 80000, height: 300000 }
        }, (success, failureReason) => {
          printWin.close();
          try { fs.unlinkSync(tmpFile); } catch {}
          if (success) {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Test GDI',
              message: `Impresion GDI enviada a "${printerName}".\nSi imprime texto, cambiaremos a metodo GDI.`,
            });
          } else {
            dialog.showErrorBox('Error GDI', `Fallo: ${failureReason}`);
          }
        });
      }, 1000);
    });
  } catch (err) {
    dialog.showErrorBox('Error GDI', `Fallo: ${err.message}`);
  }
}

async function testPrintLabel() {
  // Get label printer name - try labelPrinterName first, then receipt printer
  const labelPrinter = store.get('labelPrinterName');
  const receiptPrinter = store.get('printerConfig.printerName');
  
  if (!labelPrinter && !receiptPrinter) {
    // Try to auto-detect
    const printers = mainWindow?.webContents.getPrinters() || [];
    const barcodePrinter = printers.find(p => p.name.includes('4BARCODE') || p.name.includes('4B-') || p.name.toLowerCase().includes('label'));
    if (!barcodePrinter) {
      dialog.showErrorBox('Error', 'No hay impresora de etiquetas configurada.\nConfigure una en la sección de Etiquetas del sistema.');
      return;
    }
  }

  const printerName = labelPrinter || receiptPrinter;
  
  // Show printer selection if multiple printers available
  const printers = mainWindow?.webContents.getPrinters() || [];
  const printerList = printers.map(p => p.name).join('\n');
  
  try {
    const testLabel = {
      productName: 'PRODUCTO PRUEBA',
      price: 99.99,
      barcode: '7501234567890',
      storeName: store.get('tenantName') || 'SUPERMERCADO CELESTE',
      date: new Date().toLocaleDateString('es-DO'),
    };

    console.log(`[Test Label] Printing to: ${printerName}`);
    console.log(`[Test Label] Available printers: ${printerList}`);

    const result = await printLabelGDI(testLabel, printerName, 37.3, 28.6);
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Test Etiqueta',
      message: `Etiqueta de prueba enviada a "${printerName}".\n\nSi la etiqueta sale en blanco, pruebe:\n1. Verificar que el papel esté del lado correcto\n2. Usar otra impresora de la lista:\n${printerList}`,
    });
  } catch (err) {
    dialog.showErrorBox('Error Etiqueta', `Fallo al imprimir etiqueta: ${err.message}\n\nImpresoras disponibles:\n${printerList}`);
  }
}

async function showConnectedDevices() {
  const devices = await getConnectedDevices();
  const list = devices.length > 0
    ? devices.map(d => `• ${d.name} (${d.type})${d.status ? ' — ' + d.status : ''}`).join('\n')
    : 'No se encontraron dispositivos conectados.';

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Dispositivos Conectados',
    message: `Dispositivos detectados:\n\n${list}`,
  });
}

function showAbout() {
  const tenantInfo = store.get('tenantSlug')
    ? `\nNegocio: ${store.get('tenantName') || store.get('tenantSlug')}`
    : '';
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Acerca de Celeste POS',
    message: 'Celeste POS',
    detail: `Versión: ${app.getVersion()}\nPlataforma: ${process.platform} ${process.arch}\nElectron: ${process.versions.electron}\nNode.js: ${process.versions.node}${tenantInfo}\n\n© 2024 Celeste POS. Todos los derechos reservados.`,
    icon: path.join(__dirname, '../assets/icon.ico'),
  });
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Initialize local database
  await initDatabase();

  if (needsSetup()) {
    // First launch — show tenant setup screen
    console.log('[App] First launch detected — showing setup screen');
    createSetupWindow();
  } else {
    // Normal launch — go directly to the tenant app
    console.log(`[App] Launching for tenant: ${store.get('tenantSlug')}`);
    await launchMainApp();
  }
});

app.on('window-all-closed', () => {
  // On Windows, keep app running in tray
  // Don't quit unless explicitly requested
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

// Handle single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else if (setupWindow) {
      setupWindow.show();
      setupWindow.focus();
    }
  });
}
