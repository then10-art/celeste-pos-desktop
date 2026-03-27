# Celeste POS Desktop — TODO

## Phase 1 — Electron Shell (Windows 7/8/10/11)
- [x] Scaffold Electron 22 project (Windows 7+ compatible)
- [x] Main process (main.js) — window, tray, menu, single-instance lock
- [x] Preload script (preload.js) — secure IPC bridge via contextBridge
- [x] App icon & tray icon placeholders in assets/
- [x] Auto-updater wired to celestepos.live/updates/
- [x] NSIS installer script (installer.nsh)
- [x] electron-builder config (package.json) — x64 + ia32 targets

## Phase 2 — Local SQLite Database & Sync
- [x] Local SQLite schema (offline_queue, products_cache, customers_cache, sync_meta)
- [x] Offline transaction queue (queueTransaction, getOfflineQueue, clearSyncedItems)
- [x] Products & customers local cache helpers
- [x] Cloud sync module (syncWithCloud)
- [x] Connectivity monitor (10s interval, online/offline events)
- [x] Offline banner injected into web app

## Phase 3 — Hardware Integration
- [x] ESC/POS printer support — USB, Network, Serial
- [x] Cash drawer kick command (ESC p via printer port)
- [x] Barcode scanner detection (HID)
- [x] IPC handlers: print-receipt, open-cash-drawer, get-devices
- [x] System printer detection via Electron webContents.getPrinters()
- [x] Auto-detect receipt printers by name pattern (80mm, thermal, receipt, etc.)
- [x] Configurar Impresora dialog — native printer selection from system printers
- [ ] Test with real Epson TM-T20 / Star TSP100 (requires Windows hardware)
- [ ] ZPL label printer support (future)

## Phase 4 — Windows Installer
- [x] NSIS installer config in electron-builder
- [x] Auto-start registry entry (optional, user-toggleable)
- [x] URL protocol handler (celestepos://)
- [ ] Code signing certificate (required for Windows SmartScreen bypass)
- [x] Auto-updater error handling — no crash on missing update server
- [x] User-triggered update shows "up to date" or friendly error message
- [x] Download progress bar in Windows taskbar
- [ ] Upload installer to celestepos.live/updates/ for auto-update

## Phase 5 — Web App Integration
- [x] preload.js: getPrinterStatus, getQueuedCount, onSyncComplete exposed
- [x] preload.js: machineId and machineName for PC-to-register locking
- [x] preload.js: getAvailablePrinters and savePrinterConfig for config dialog
- [x] main.js: sync-complete IPC event sent to renderer after offline sync
- [x] main.js: get-printer-status, get-available-printers, save-printer-config IPC handlers
- [x] main.js: get-queued-count IPC handler
- [x] hardware: printViaSystem using Windows GDI for generic receipt printers
- [ ] Add CelesteDesktop.printReceipt() call in POS receipt flow
- [ ] Add CelesteDesktop.openCashDrawer() call after successful payment
- [ ] Add desktop detection banner/badge in web app UI
- [ ] Add printer settings page in web app (accessible from desktop menu)

## Phase 6 — Offline Mode (Nice-to-Have)
- [ ] Offline product lookup by barcode (from local cache)
- [ ] Offline customer lookup by cédula
- [ ] Queue sale transactions when offline
- [ ] Sync queue on reconnect with toast notification
- [ ] Show queue count badge in tray icon

## Notes
- Electron 22 is pinned — DO NOT upgrade to 23+ (drops Windows 7/8 support)
- Native modules (better-sqlite3, node-hid) must be rebuilt for Electron via electron-rebuild
- Build must be done on Windows or via Wine/cross-compilation for .exe output
