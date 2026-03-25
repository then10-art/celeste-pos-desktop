# Celeste POS — Desktop Application

A Windows desktop wrapper for the Celeste POS web application, built with Electron 22 for compatibility with Windows 7, 8, 8.1, 10, and 11.

---

## Architecture Overview

```
celestepos.live (Cloud)
       ↕  sync every 10s
Celeste POS Desktop (Electron 22)
  ├── WebView → loads celestepos.live
  ├── Local SQLite DB → offline cache + transaction queue
  ├── Hardware Layer → ESC/POS printer, cash drawer, scanner
  └── Auto-Updater → checks celestepos.live/updates/
```

The desktop app is a **thin shell** around the web app. All business logic, data, and UI live in the cloud. The desktop layer adds:
- Native Windows integration (system tray, notifications, startup)
- Hardware access (printers, cash drawers)
- Offline transaction queuing
- Local product/customer cache for offline barcode lookup

---

## Windows Compatibility

| Windows Version | Supported | Notes |
|---|---|---|
| Windows 7 SP1 | ✅ | Electron 22 (last version supporting Win 7) |
| Windows 8 / 8.1 | ✅ | Electron 22 |
| Windows 10 | ✅ | Full support |
| Windows 11 | ✅ | Full support |
| Windows XP / Vista | ❌ | Not supported |

> **Important:** Electron 22 is pinned specifically for Windows 7/8 compatibility. Do NOT upgrade to Electron 23+ as it drops Windows 7/8 support.

---

## Supported Hardware

### Receipt Printers (ESC/POS)
- **USB**: Epson TM-T20, TM-T88, Star TSP100, TSP650, and most ESC/POS compatible printers
- **Network**: Any ESC/POS printer with Ethernet/WiFi (configure IP:port in settings)
- **Serial**: RS-232 connected printers

### Cash Drawers
- Triggered via printer port (standard RJ11 connection)
- Works with any cash drawer connected to a supported printer

### Barcode Scanners
- USB HID scanners (plug-and-play, no driver needed)
- Works as keyboard input — no special configuration required
- Supports Code 39, Code 128, EAN-13, QR codes

### Label Printers
- ZPL-compatible printers (Zebra, etc.) — future support

---

## Development Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build Windows installer (requires Windows or Wine)
npm run build
```

### Prerequisites
- **Node.js 18, 20, 22, or 24** — Download from [nodejs.org](https://nodejs.org) (choose LTS)
- **Visual Studio Build Tools** (included automatically with modern Node.js — no separate install needed)

> ⚠️ Do NOT run `npm install --global windows-build-tools` — that package is deprecated and broken on modern Node.js.

### Step-by-Step Build Instructions

1. **Extract** the ZIP to a folder, e.g. `C:\CelestePos\`
2. **Open Command Prompt inside that folder:**
   - Open File Explorer → navigate to `C:\CelestePos\celeste-pos-desktop-final`
   - Click the address bar → type `cmd` → press Enter
   - You should see: `C:\CelestePos\celeste-pos-desktop-final>`
3. **Install dependencies:**
   ```
   npm install --legacy-peer-deps
   ```
4. **Build the installer:**
   ```
   npm run build
   ```
5. Find the `.exe` in the `dist\` folder

---

## Building the Installer

```bash
# Build for both x64 and x86 (recommended)
npm run build

# Build x64 only
npm run build:x64

# Build x86 only (for older 32-bit Windows 7 systems)
npm run build:x86
```

Output files will be in `dist/`:
- `Celeste POS Setup 1.0.0.exe` — NSIS installer
- `Celeste POS 1.0.0.exe` — Portable version (no install needed)

---

## Auto-Update Setup

The app checks for updates at `https://celestepos.live/updates/`. To publish an update:

1. Bump version in `package.json`
2. Build the new installer
3. Upload to `https://celestepos.live/updates/`:
   - `RELEASES` (Squirrel format)
   - `Celeste-POS-Setup-X.X.X.exe`
   - `latest.yml`

---

## Offline Mode

When internet is unavailable:
1. A red banner appears at the top of the screen
2. Sales are queued in local SQLite database
3. Product lookups use local cache (synced when online)
4. When connection restores, queued transactions sync automatically

---

## File Structure

```
src/
  main.js          ← Electron main process
  preload.js       ← IPC bridge (exposes CelesteDesktop API to web app)
  database.js      ← Local SQLite (offline queue + cache)
  sync.js          ← Cloud sync logic
  hardware/
    index.js       ← Printer, cash drawer, scanner integration
assets/
  icon.ico         ← App icon (256x256 recommended)
  tray-icon.ico    ← System tray icon (16x16 or 32x32)
installer.nsh      ← Custom NSIS installer hooks
```

---

## Web App Integration

The desktop app injects `window.CelesteDesktop` into the web app. The web app can detect desktop mode and use hardware features:

```javascript
// Check if running in desktop mode
if (window.CelesteDesktop?.isDesktop) {
  // Use native printer instead of browser print dialog
  await window.CelesteDesktop.printReceipt(receiptData);

  // Open cash drawer
  await window.CelesteDesktop.openCashDrawer();

  // Check offline status
  const { isOnline, queueLength } = await window.CelesteDesktop.getOfflineStatus();
}
```

---

## Security Notes

- The app only loads URLs from `celestepos.live` — external links open in the default browser
- `nodeIntegration` is disabled in the renderer process
- All IPC communication goes through the preload script's `contextBridge`
- Local database is stored in `%APPDATA%\CelestePos\` (user-specific, not system-wide)
