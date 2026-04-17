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
  updaterAvailable = true;
} catch (e) {
  console.log('[Updater] electron-updater not available:', e.message);
}

// ─── App Configuration ───────────────────────────────────────────────────────
const isDev = process.argv.includes('--dev');
const CLOUD_URL = 'https://celestepos.live';
const UPDATE_SERVER = 'https://celestepos.live/updates/';

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
// Track whether the user manually triggered the update check (for error dialog)
let userTriggeredUpdateCheck = false;

// ─── Sync & Offline Modules ───────────────────────────────────────────────────
const { initDatabase, getOfflineQueue, clearSyncedItems } = require('./database');
const { syncWithCloud } = require('./sync');
const { setupHardware, printReceipt, openCashDrawer, getConnectedDevices, getPrinterStatus, getAvailablePrinters } = require('./hardware');

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
      const req = https.get(`${CLOUD_URL}/api/trpc/tenants.resolveSlug?input=${encodeURIComponent(JSON.stringify({ slug }))}`, {
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

  // Load the web app — always go directly to the tenant URL (no business selection)
  const tenantSlug = store.get('tenantSlug');
  const url = `${CLOUD_URL}/t/${tenantSlug}`;

  console.log(`[App] Loading tenant: ${tenantSlug} → ${url}`);
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

  // Handle navigation - stay within celestepos.live
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(CLOUD_URL) && !url.startsWith('https://celestepos.live')) {
      e.preventDefault();
      shell.openExternal(url);
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
        mainWindow.loadURL(`${CLOUD_URL}/t/${store.get('tenantSlug')}/settings`);
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
      \`;
      banner.innerHTML = '⚠️ Sin conexión a internet — Las transacciones se guardarán localmente y se sincronizarán cuando se restaure la conexión.';
      document.body.prepend(banner);

      // Listen for offline status from main process
      window.addEventListener('celeste-offline', () => {
        banner.style.display = 'block';
        document.body.style.paddingTop = '34px';
      });
      window.addEventListener('celeste-online', () => {
        banner.style.display = 'none';
        document.body.style.paddingTop = '';
      });
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
    console.log('[Celeste POS Desktop] Running in desktop mode v${app.getVersion()} — Tenant: ${tenantSlug}');
  `;
  mainWindow.webContents.executeJavaScript(script).catch(() => {});
}

// ─── Connectivity Monitoring ──────────────────────────────────────────────────
function startConnectivityMonitor() {
  const checkInterval = 10000; // 10 seconds

  setInterval(async () => {
    try {
      const response = await fetch(`${CLOUD_URL}/api/health`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      const wasOffline = !isOnline;
      isOnline = response.ok;

      if (wasOffline && isOnline) {
        // Just came back online - trigger sync
        mainWindow?.webContents.executeJavaScript(
          "window.dispatchEvent(new Event('celeste-online'));"
        ).catch(() => {});
        syncOfflineQueue();
      }
    } catch {
      if (isOnline) {
        isOnline = false;
        mainWindow?.webContents.executeJavaScript(
          "window.dispatchEvent(new Event('celeste-offline'));"
        ).catch(() => {});
      }
    }
  }, checkInterval);
}

// ─── Offline Queue Sync ───────────────────────────────────────────────────────
async function syncOfflineQueue() {
  try {
    const queue = getOfflineQueue();
    if (queue.length === 0) return;

    console.log(`[Sync] Syncing ${queue.length} offline transactions...`);
    const synced = await syncWithCloud(queue);
    clearSyncedItems(synced);
    console.log(`[Sync] Successfully synced ${synced.length} items`);

    // Notify the renderer about sync completion via IPC
    const remaining = getOfflineQueue().length;
    mainWindow?.webContents.send('sync-complete', {
      queued: remaining,
      synced: synced.length,
    });

    mainWindow?.webContents.executeJavaScript(`
      if (window.__celesteShowToast) {
        window.__celesteShowToast('${synced.length} transacciones sincronizadas con la nube', 'success');
      }
    `).catch(() => {});
  } catch (err) {
    console.error('[Sync] Error syncing offline queue:', err);
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
    if (userTriggeredUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Error de Actualización',
        message: `No se pudo verificar actualizaciones.\n\nAsegúrese de tener conexión a internet e intente de nuevo más tarde.`,
        detail: err.message,
      });
      userTriggeredUpdateCheck = false;
    }
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
  return await printReceipt(receiptData, paperSize);
});

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
  return { isOnline, queueLength: getOfflineQueue().length };
});

ipcMain.handle('get-queued-count', () => {
  return getOfflineQueue().length;
});

ipcMain.handle('queue-offline-transaction', (event, transaction) => {
  const { queueTransaction } = require('./database');
  queueTransaction(transaction);
  return true;
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
