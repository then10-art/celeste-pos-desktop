/**
 * Celeste POS - Hardware Integration Module
 * Supports:
 *   - ESC/POS receipt printers (USB, Network, Serial)
 *   - USB barcode scanners (HID - plug and play, keyboard emulation)
 *   - Cash drawers (via printer port RJ11)
 *   - Windows printer detection via Electron webContents.getPrinters()
 * 
 * Optimized for: AOKIA AK-3080 (80mm, USB, 250mm/s, ESC/POS)
 */

let printerConfig = { type: 'usb', address: '', printerName: '' };
let mainWindowRef = null;

// ─── Known receipt printer name patterns ─────────────────────────────────────
// First-tier: dedicated receipt/POS printers
const RECEIPT_PRINTER_PATTERNS = [
  /80mm/i,
  /58mm/i,
  /receipt/i,
  /thermal/i,
  /pos[\s-]?printer/i,
  /epson\s*tm/i,
  /star\s*tsp/i,
  /star\s*sm/i,
  /bixolon/i,
  /citizen/i,
  /sewoo/i,
  /xprinter/i,
  /rongta/i,
  /munbyn/i,
  /disashop/i,
  /4barcode/i,
  /barcode/i,
  /escpos/i,
  /esc[\s\/]pos/i,
  /aokia/i,
  /ak[\s-]?3080/i,
];

// Second-tier: Epson inkjet/all-in-one printers that can be used for receipts
const EPSON_INKJET_PATTERNS = [
  /epson\s*et[\s-]?\d/i,
  /epson\s*l[\s-]?\d/i,
  /epson\s*wf[\s-]?\d/i,
  /epson\s*xp[\s-]?\d/i,
  /epson\s*\d{4,}/i,
  /epson/i,
];

// Printer names to exclude (regular document printers, fax, etc.)
const EXCLUDED_PATTERNS = [
  /microsoft/i,
  /xps/i,
  /pdf/i,
  /onenote/i,
  /fax/i,
  /snagit/i,
  /adobe/i,
  /foxit/i,
  /cute/i,
  /virtual/i,
  /remote/i,
];

// ─── Setup ────────────────────────────────────────────────────────────────────
async function setupHardware(config = {}, win = null) {
  printerConfig = { ...printerConfig, ...config };
  mainWindowRef = win;
  console.log('[Hardware] Initialized with config:', printerConfig);
}

// ─── Get Printer Status ──────────────────────────────────────────────────────
async function getPrinterStatus() {
  if (printerConfig.printerName && mainWindowRef) {
    try {
      const printers = mainWindowRef.webContents.getPrinters();
      const configured = printers.find(p => p.name === printerConfig.printerName);
      if (configured) {
        return {
          connected: configured.status === 0,
          name: configured.name,
          type: printerConfig.type || 'usb',
        };
      }
    } catch { /* fall through */ }
  }

  if (mainWindowRef) {
    try {
      const printers = mainWindowRef.webContents.getPrinters();
      const receiptPrinter = findReceiptPrinter(printers);
      if (receiptPrinter) {
        return {
          connected: receiptPrinter.status === 0,
          name: receiptPrinter.name,
          type: 'usb',
        };
      }
    } catch { /* fall through */ }
  }

  try {
    const HID = require('node-hid');
    const hidDevices = HID.devices();
    const printerVendors = [0x04b8, 0x0519, 0x154f, 0x0dd4, 0x0416, 0x0493];
    for (const d of hidDevices) {
      if (printerVendors.includes(d.vendorId)) {
        return {
          connected: true,
          name: d.product || `USB Printer (VID:${d.vendorId.toString(16)})`,
          type: 'usb',
        };
      }
    }
  } catch { /* node-hid optional */ }

  return { connected: false, name: null, type: null };
}

// ─── Find Receipt Printer from System Printers ──────────────────────────────
function findReceiptPrinter(printers) {
  for (const p of printers) {
    if (EXCLUDED_PATTERNS.some(rx => rx.test(p.name))) continue;
    if (RECEIPT_PRINTER_PATTERNS.some(rx => rx.test(p.name))) {
      return p;
    }
  }

  for (const p of printers) {
    if (p.name.toLowerCase().includes('usb') && !EXCLUDED_PATTERNS.some(rx => rx.test(p.name))) {
      return p;
    }
  }

  for (const p of printers) {
    if (EXCLUDED_PATTERNS.some(rx => rx.test(p.name))) continue;
    if (EPSON_INKJET_PATTERNS.some(rx => rx.test(p.name))) {
      return p;
    }
  }

  return null;
}

// ─── Get Available Printers (for config dialog) ─────────────────────────────
async function getAvailablePrinters() {
  const result = [];

  if (mainWindowRef) {
    try {
      const printers = mainWindowRef.webContents.getPrinters();
      for (const p of printers) {
        const isExcluded = EXCLUDED_PATTERNS.some(rx => rx.test(p.name));
        const isReceiptDedicated = RECEIPT_PRINTER_PATTERNS.some(rx => rx.test(p.name));
        const isEpsonInkjet = EPSON_INKJET_PATTERNS.some(rx => rx.test(p.name));
        result.push({
          name: p.name,
          displayName: p.displayName || p.name,
          status: p.status === 0 ? 'ready' : 'offline',
          isDefault: p.isDefault,
          isReceipt: !isExcluded && (isReceiptDedicated || isEpsonInkjet),
          isInkjet: isEpsonInkjet && !isReceiptDedicated,
          type: 'system',
        });
      }
    } catch { /* ignore */ }
  }

  return result;
}

// ─── Discover Connected Devices ──────────────────────────────────────────────
async function getConnectedDevices() {
  const devices = [];

  if (mainWindowRef) {
    try {
      const printers = mainWindowRef.webContents.getPrinters();
      for (const p of printers) {
        if (!EXCLUDED_PATTERNS.some(rx => rx.test(p.name))) {
          devices.push({
            type: 'printer',
            name: p.name,
            status: p.status === 0 ? 'Listo' : 'Sin conexión',
          });
        }
      }
    } catch { /* ignore */ }
  }

  try {
    const HID = require('node-hid');
    const hidDevices = HID.devices();
    const printerVendors = [0x04b8, 0x0519, 0x154f, 0x0dd4, 0x0416, 0x0493];
    for (const d of hidDevices) {
      if (printerVendors.includes(d.vendorId)) {
        devices.push({ type: 'printer', name: `USB Printer (VID:${d.vendorId.toString(16)})`, vendorId: d.vendorId });
      }
    }
  } catch { /* node-hid optional */ }

  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    for (const p of ports) {
      if (p.manufacturer) {
        devices.push({ type: 'serial', name: `${p.manufacturer} (${p.path})`, path: p.path });
      }
    }
  } catch { /* serialport optional */ }

  try {
    const HID = require('node-hid');
    const hidDevices = HID.devices();
    for (const d of hidDevices) {
      if (d.usagePage === 0x0001 && d.usage === 0x0006 &&
          d.manufacturer && !['microsoft', 'apple', 'logitech'].some(v => d.manufacturer.toLowerCase().includes(v))) {
        devices.push({ type: 'scanner', name: `${d.manufacturer} Barcode Scanner`, vendorId: d.vendorId });
      }
    }
  } catch { /* optional */ }

  return devices;
}

// ─── Print Receipt ────────────────────────────────────────────────────────────
// STRATEGY: For ESC/POS thermal printers (like AOKIA AK-3080), raw ESC/POS
// commands are the ONLY reliable method. Electron's webContents.print() produces
// blank pages on most USB thermal printers because the Windows GDI driver doesn't
// properly render HTML content for these devices.
async function printReceipt(receiptData, paperSize) {
  if (printerConfig.type === 'network') return printNetwork(receiptData);
  if (printerConfig.type === 'serial')  return printSerial(receiptData);

  const printerName = printerConfig.printerName || await getAutoDetectedPrinterName();
  console.log('[Hardware] printReceipt called, printerName:', printerName, 'type:', printerConfig.type, 'paperSize:', paperSize);

  // PRIMARY METHOD: Raw ESC/POS binary commands
  // This is the most reliable method for USB thermal receipt printers.
  // It bypasses the Windows GDI rendering pipeline entirely and sends
  // raw binary commands directly to the printer hardware.
  if (printerName && process.platform === 'win32') {
    try {
      console.log('[Hardware] PRIMARY: Raw ESC/POS to:', printerName);
      const result = await printRawEscPos(receiptData, printerName, paperSize);
      return { ...result, method: 'raw-escpos', printerName };
    } catch (err) {
      console.warn('[Hardware] Raw ESC/POS failed:', err.message, '- trying HTML system print');
    }
  }

  // FALLBACK 1: Electron HTML print via webContents.print()
  // Only used if raw ESC/POS fails (e.g., for inkjet printers that need HTML rendering)
  if (printerName && mainWindowRef) {
    try {
      console.log('[Hardware] FALLBACK: Electron HTML print to:', printerName);
      const result = await printViaSystem(receiptData, paperSize);
      return { ...result, method: 'html-system', printerName };
    } catch (err) {
      console.warn('[Hardware] Electron HTML print failed:', err.message);
    }
  }

  // FALLBACK 2: direct USB ESC/POS via node-escpos
  try {
    return await printUsb(receiptData);
  } catch (err) {
    console.warn('[Hardware] USB print failed:', err.message);
  }

  throw new Error(`No se pudo imprimir. Impresora: ${printerName || 'no detectada'}. Verifique la conexión.`);
}

// ─── Raw ESC/POS via Windows Spooler ─────────────────────────────────────────
// Builds ESC/POS binary commands and sends them directly to the printer
// via Windows print spooler. This is the ONLY reliable method for thermal
// printers like AOKIA AK-3080.
async function printRawEscPos(receiptData, printerName, paperSize) {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const { execSync } = require('child_process');

  // Convert receipt data to lines format
  const normalized = convertReceiptDataToLines(receiptData);
  const lines = normalized.lines || [];
  console.log('[Hardware] Converting receipt to ESC/POS, lines:', lines.length);

  // Determine column width based on paper size (80mm = 42 chars, 58mm = 32 chars)
  const maxCols = (paperSize === '58') ? 32 : 42;

  // Build ESC/POS binary commands
  const ESC = 0x1B;
  const GS = 0x1D;
  const LF = 0x0A;
  const buffers = [];

  // Initialize printer - CRITICAL: must send init command first
  buffers.push(Buffer.from([ESC, 0x40])); // ESC @ - Initialize/Reset printer
  // NOTE: Do NOT send null bytes after init - some printers interpret them as data
  // Use PC437 code page (0) which is universally supported by all ESC/POS printers
  buffers.push(Buffer.from([ESC, 0x74, 0x00])); // ESC t 0 - Set code page to PC437 (default, universal)

  for (const line of lines) {
    switch (line.type) {
      case 'title':
        buffers.push(Buffer.from([ESC, 0x61, 0x01])); // Center align
        buffers.push(Buffer.from([ESC, 0x45, 0x01])); // Bold on
        buffers.push(Buffer.from([GS, 0x21, 0x11])); // Double width+height
        buffers.push(Buffer.from(encodeText(line.text)));
        buffers.push(Buffer.from([LF]));
        buffers.push(Buffer.from([GS, 0x21, 0x00])); // Normal size
        buffers.push(Buffer.from([ESC, 0x45, 0x00])); // Bold off
        break;
      case 'subtitle':
        buffers.push(Buffer.from([ESC, 0x61, 0x01])); // Center
        buffers.push(Buffer.from([ESC, 0x45, 0x01])); // Bold on
        buffers.push(Buffer.from(encodeText(line.text)));
        buffers.push(Buffer.from([LF]));
        buffers.push(Buffer.from([ESC, 0x45, 0x00])); // Bold off
        break;
      case 'text': {
        const align = line.align === 'right' ? 0x02 : line.align === 'center' ? 0x01 : 0x00;
        buffers.push(Buffer.from([ESC, 0x61, align]));
        buffers.push(Buffer.from(encodeText(line.text)));
        buffers.push(Buffer.from([LF]));
        break;
      }
      case 'row': {
        buffers.push(Buffer.from([ESC, 0x61, 0x00])); // Left align
        const labelMaxLen = Math.floor(maxCols * 0.55);
        const valueMaxLen = maxCols - labelMaxLen;
        const label = (line.label || '').substring(0, labelMaxLen).padEnd(labelMaxLen);
        const value = (line.value || '').substring(0, valueMaxLen).padStart(valueMaxLen);
        buffers.push(Buffer.from(encodeText(label + value)));
        buffers.push(Buffer.from([LF]));
        break;
      }
      case 'bold-row': {
        buffers.push(Buffer.from([ESC, 0x61, 0x00])); // Left align
        buffers.push(Buffer.from([ESC, 0x45, 0x01])); // Bold on
        const labelMaxLen = Math.floor(maxCols * 0.55);
        const valueMaxLen = maxCols - labelMaxLen;
        const label = (line.label || '').substring(0, labelMaxLen).padEnd(labelMaxLen);
        const value = (line.value || '').substring(0, valueMaxLen).padStart(valueMaxLen);
        buffers.push(Buffer.from(encodeText(label + value)));
        buffers.push(Buffer.from([LF]));
        buffers.push(Buffer.from([ESC, 0x45, 0x00])); // Bold off
        break;
      }
      case 'divider':
        buffers.push(Buffer.from([ESC, 0x61, 0x00])); // Left align
        buffers.push(Buffer.from(encodeText('-'.repeat(maxCols))));
        buffers.push(Buffer.from([LF]));
        break;
      case 'spacer':
        buffers.push(Buffer.from([LF]));
        break;
    }
  }

  // Feed paper and cut
  buffers.push(Buffer.from([LF, LF, LF, LF])); // Feed 4 lines for clearance
  buffers.push(Buffer.from([GS, 0x56, 0x41, 0x03])); // GS V A 3 - Partial cut with 3 lines feed

  // Combine all buffers
  const rawData = Buffer.concat(buffers);
  console.log('[Hardware] Built ESC/POS data:', rawData.length, 'bytes for', lines.length, 'lines');

  // Send raw data to printer via Windows spooler
  return await sendRawToPrinter(rawData, printerName);
}

// ─── Send Raw Bytes to Printer (shared by print and cash drawer) ─────────────
// Tries multiple Windows methods to send raw binary data to the printer.
// This is used by both printRawEscPos() and openCashDrawer().
async function sendRawToPrinter(rawData, printerName) {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const { execSync } = require('child_process');

  // Write to temp file
  const tmpFile = path.join(os.tmpdir(), `celeste-raw-${Date.now()}.bin`);
  fs.writeFileSync(tmpFile, rawData);

  const errors = [];
  // Escape for PowerShell single-quoted strings (single quotes only)
  const psPrinterName = printerName.replace(/'/g, "''");
  // For PowerShell file path: use the raw Windows path (backslashes as-is)
  const psTmpFile = tmpFile; // PowerShell handles Windows paths natively

  // Method 0: PowerShell RawPrinter P/Invoke (Win32 API - works on Win7/8/10/11)
  // Uses winspool.drv directly - most reliable for USB printers with proper drivers
  try {
    console.log('[Hardware] Method 0: PowerShell RawPrinter P/Invoke');
    const psScript = `
$ErrorActionPreference = 'Stop'
$printerName = '${psPrinterName}'
$filePath = '${psTmpFile}'
$bytes = [System.IO.File]::ReadAllBytes($filePath)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential)] public struct DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDatatype; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)] public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOA di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr hPrinter);
  public static bool SendRaw(string printer, byte[] data) {
    IntPtr hPrinter; int written;
    if (!OpenPrinter(printer, out hPrinter, IntPtr.Zero)) return false;
    var di = new DOCINFOA() { pDocName = "CelestePOS Receipt", pOutputFile = null, pDatatype = "RAW" };
    try {
      if (!StartDocPrinter(hPrinter, 1, ref di)) { ClosePrinter(hPrinter); return false; }
      if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return false; }
      bool ok = WritePrinter(hPrinter, data, data.Length, out written);
      EndPagePrinter(hPrinter);
      EndDocPrinter(hPrinter);
      return ok && written == data.Length;
    } finally { ClosePrinter(hPrinter); }
  }
}
"@
$ok = [RawPrinterHelper]::SendRaw($printerName, $bytes)
if ($ok) { Write-Output 'OK' } else { throw 'WritePrinter failed - check printer name and connection' }
`;
    const psFile = path.join(os.tmpdir(), `celeste-print-${Date.now()}.ps1`);
    // Write PS1 as UTF-8 with BOM so PowerShell reads it correctly on all locales
    fs.writeFileSync(psFile, '\uFEFF' + psScript, 'utf-8');
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, {
      timeout: 15000, encoding: 'utf-8', windowsHide: true,
    });
    console.log('[Hardware] Raw print via PowerShell P/Invoke succeeded:', result.trim());
    try { fs.unlinkSync(psFile); } catch { }
    try { fs.unlinkSync(tmpFile); } catch { }
    return { success: true, method: 'ps-pinvoke' };
  } catch (err) {
    errors.push(`PowerShell P/Invoke: ${err.message.substring(0, 200)}`);
    console.warn('[Hardware] Method 0 failed:', err.message.substring(0, 300));
  }

  // Method 1: BAT file with SET variables - handles spaces in printer names on Windows 7
  // Uses environment variables to avoid CMD quoting issues with UNC paths containing spaces
  try {
    console.log('[Hardware] Method 1: BAT file NET USE + COPY /B (Windows 7 compatible)');
    const batFile = path.join(os.tmpdir(), `celeste-print-${Date.now()}.bat`);
    const batScript = `@echo off
SET SRCFILE=${tmpFile}
SET PRINTER=${printerName}
net use LPT4: /delete /y >nul 2>&1
net use LPT4: "\\\\localhost\\%PRINTER%" /persistent:no
if errorlevel 1 goto copyshare
copy /b "%SRCFILE%" LPT4:
net use LPT4: /delete /y >nul 2>&1
goto done
:copyshare
copy /b "%SRCFILE%" "\\\\localhost\\%PRINTER%"
:done
`;
    fs.writeFileSync(batFile, batScript, 'ascii');
    execSync(`"${batFile}"`, { timeout: 15000, shell: 'cmd.exe', windowsHide: true });
    try { fs.unlinkSync(batFile); } catch { }
    console.log('[Hardware] Raw print via BAT NET USE + COPY succeeded');
    try { fs.unlinkSync(tmpFile); } catch { }
    return { success: true, method: 'bat-net-use-copy' };
  } catch (err) {
    errors.push(`BAT NET USE: ${err.message.substring(0, 200)}`);
    console.warn('[Hardware] Method 1 failed:', err.message.substring(0, 300));
    try { execSync('net use LPT4: /delete /y >nul 2>&1', { shell: 'cmd.exe', windowsHide: true, timeout: 5000 }); } catch { /* ignore */ }
  }

  // Method 2: PowerShell copy to UNC share (handles spaces via PS string handling)
  try {
    console.log('[Hardware] Method 2: PowerShell Copy-Item to UNC share');
    const psShare = `Copy-Item -Path '${psTmpFile}' -Destination '\\\\localhost\\${psPrinterName}' -Force`;
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psShare}"`, {
      timeout: 12000, encoding: 'utf-8', windowsHide: true,
    });
    console.log('[Hardware] Raw print via PowerShell Copy-Item succeeded');
    try { fs.unlinkSync(tmpFile); } catch { }
    return { success: true, method: 'ps-copy-share' };
  } catch (err) {
    errors.push(`PS Copy-Item: ${err.message.substring(0, 200)}`);
    console.warn('[Hardware] Method 2 failed:', err.message.substring(0, 300));
  }

  // Method 3: print /d: command (works when printer name has no spaces)
  try {
    console.log('[Hardware] Method 3: print /d: command');
    execSync(`print /d:"${printerName}" "${tmpFile}"`, {
      timeout: 10000, encoding: 'utf-8', shell: 'cmd.exe', windowsHide: true,
    });
    console.log('[Hardware] Raw print via print /d: succeeded');
    try { fs.unlinkSync(tmpFile); } catch { }
    return { success: true, method: 'print-d' };
  } catch (err) {
    errors.push(`print /d: ${err.message.substring(0, 200)}`);
    console.warn('[Hardware] Method 3 failed:', err.message.substring(0, 300));
  }

  // Method 4: lpr command (available with LPR feature enabled)
  try {
    console.log('[Hardware] Method 4: lpr command');
    execSync(`lpr -S localhost -P "${printerName}" -o l "${tmpFile}"`, {
      timeout: 10000, encoding: 'utf-8', windowsHide: true,
    });
    console.log('[Hardware] Raw print via lpr succeeded');
    try { fs.unlinkSync(tmpFile); } catch { }
    return { success: true, method: 'lpr' };
  } catch (err) {
    errors.push(`lpr: ${err.message.substring(0, 200)}`);
    console.warn('[Hardware] Method 4 failed:', err.message.substring(0, 300));
  }

  // All methods failed
  try { fs.unlinkSync(tmpFile); } catch { }
  const errMsg = `All raw print methods failed: ${errors.join(' | ')}`;
  console.error('[Hardware]', errMsg);
  throw new Error(errMsg);
}

// Encode text to PC437 compatible bytes (handles Spanish characters)
// PC437 is the default code page for ESC/POS printers and is universally supported
function encodeText(text) {
  const result = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      result.push(code);
    } else {
      // PC437 encoding map for Spanish characters
      const map = {
        0xe1: 0xa0, // á
        0xe9: 0x82, // é
        0xed: 0xa1, // í
        0xf3: 0xa2, // ó
        0xfa: 0xa3, // ú
        0xf1: 0xa4, // ñ
        0xc1: 0x41, // Á → A (no uppercase accented in PC437)
        0xc9: 0x45, // É → E
        0xcd: 0x49, // Í → I
        0xd3: 0x4f, // Ó → O
        0xda: 0x55, // Ú → U
        0xd1: 0xa5, // Ñ
        0xfc: 0x81, // ü
        0xdc: 0x9a, // Ü
        0xbf: 0xa8, // ¿
        0xa1: 0xad, // ¡
        0x2014: 0x2d, // — → -
        0x2013: 0x2d, // – → -
        0x2026: 0x2e, // … → .
        0x20: 0x20, // space
      };
      result.push(map[code] || 0x3f); // Use '?' for unmapped chars
    }
  }
  return Buffer.from(result);
}

// ─── System Printer (Windows GDI) - FALLBACK ─────────────────────────────────
// Uses Electron's webContents.print() - kept as fallback for inkjet printers
async function printViaSystem(receiptData, paperSize = '80') {
  if (!mainWindowRef) throw new Error('No window reference');

  const printerName = printerConfig.printerName || await getAutoDetectedPrinterName();
  if (!printerName) throw new Error('No receipt printer found');

  console.log('[Hardware] Receipt data received:', JSON.stringify({
    storeName: receiptData.storeName,
    itemCount: (receiptData.items || []).length,
    total: receiptData.total,
    hasLines: !!receiptData.lines,
    paperSize,
  }));
  const html = buildReceiptHTML(receiptData, paperSize);
  console.log('[Hardware] Printing receipt to:', printerName, 'paperSize:', paperSize, 'htmlLength:', html.length);

  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const tmpFile = path.join(os.tmpdir(), `celeste-receipt-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, 'utf-8');
  console.log('[Hardware] Wrote receipt HTML to:', tmpFile);

  return new Promise((resolve, reject) => {
    const { BrowserWindow } = require('electron');
    const printWin = new BrowserWindow({
      show: false,
      width: paperSize === '58' ? 220 : 302,
      height: 2000,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    printWin.loadFile(tmpFile);

    printWin.webContents.on('did-finish-load', () => {
      const waitForImages = `
        new Promise((resolve) => {
          const imgs = document.querySelectorAll('img');
          if (imgs.length === 0) return resolve();
          let loaded = 0;
          const check = () => { loaded++; if (loaded >= imgs.length) resolve(); };
          imgs.forEach(img => {
            if (img.complete) check();
            else { img.onload = check; img.onerror = check; }
          });
          setTimeout(resolve, 3000);
        })
      `;

      printWin.webContents.executeJavaScript(waitForImages).then(() => {
        setTimeout(() => {
          const widthMicrons = paperSize === '58' ? 58000 : 80000;
          const heightMicrons = 300000;

          console.log('[Hardware] Sending to printer:', printerName, 'pageSize:', widthMicrons, 'x', heightMicrons);

          printWin.webContents.print(
            {
              silent: true,
              printBackground: true,
              deviceName: printerName,
              margins: { marginType: 'none' },
              pageSize: { width: widthMicrons, height: heightMicrons },
            },
            (success, failureReason) => {
              printWin.close();
              try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
              if (success) {
                console.log('[Hardware] Receipt printed successfully');
                resolve({ success: true });
              } else {
                console.error('[Hardware] Print failed:', failureReason);
                reject(new Error(failureReason || 'Print failed'));
              }
            }
          );
        }, 800);
      }).catch(() => {
        setTimeout(() => {
          const widthMicrons = paperSize === '58' ? 58000 : 80000;
          const heightMicrons = 300000;
          printWin.webContents.print(
            {
              silent: true,
              printBackground: true,
              deviceName: printerName,
              margins: { marginType: 'none' },
              pageSize: { width: widthMicrons, height: heightMicrons },
            },
            (success, failureReason) => {
              printWin.close();
              try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
              if (success) resolve({ success: true });
              else reject(new Error(failureReason || 'Print failed'));
            }
          );
        }, 1500);
      });
    });

    setTimeout(() => {
      try { printWin.close(); } catch { /* ignore */ }
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      reject(new Error('Print timeout'));
    }, 15000);
  });
}

// ─── Auto-detect printer name ────────────────────────────────────────────────
async function getAutoDetectedPrinterName() {
  if (!mainWindowRef) return null;
  try {
    const printers = mainWindowRef.webContents.getPrinters();
    const receipt = findReceiptPrinter(printers);
    return receipt?.name || null;
  } catch {
    return null;
  }
}

// ─── Convert ReceiptData to lines format ─────────────────────────────────────
function convertReceiptDataToLines(data) {
  if (data.lines) return data;
  if (!data.storeName && !data.items) return data;

  const lines = [];
  // Header
  lines.push({ type: 'title', text: data.storeName || 'Supermercado' });
  if (data.storeAddress) lines.push({ type: 'text', text: data.storeAddress, align: 'center' });
  if (data.storePhone) lines.push({ type: 'text', text: `Tel: ${data.storePhone}`, align: 'center' });
  if (data.storeRnc) lines.push({ type: 'text', text: `RNC: ${data.storeRnc}`, align: 'center' });
  lines.push({ type: 'divider' });

  // NCF / Comprobante Fiscal
  if (data.ncfNumber) {
    lines.push({ type: 'subtitle', text: 'COMPROBANTE FISCAL' });
    lines.push({ type: 'row', label: 'NCF:', value: data.ncfNumber });
  }

  // Ticket info
  const ticketNum = data.ticketNumber || data.receiptNumber || '';
  const cashier = data.cashierName || data.cashier || '';
  lines.push({ type: 'subtitle', text: `RECIBO #${ticketNum}` });
  lines.push({ type: 'row', label: 'Fecha:', value: data.date || '' });
  lines.push({ type: 'row', label: 'Cajero:', value: cashier });
  if (data.customerName) lines.push({ type: 'row', label: 'Cliente:', value: data.customerName });
  if (data.customerRnc) lines.push({ type: 'row', label: 'RNC/Cédula:', value: data.customerRnc });
  lines.push({ type: 'divider' });

  // Items
  for (const item of (data.items || [])) {
    const rawQty = item.quantity || item.qty || 1;
    const rawPrice = item.unitPrice || item.price || 0;
    const qty = item.isWeighed ? `${parseFloat(String(rawQty)).toFixed(3)}kg` : `${rawQty}`;
    const price = parseFloat(String(rawPrice)).toFixed(2);
    const total = parseFloat(String(item.total || 0)).toFixed(2);
    lines.push({ type: 'text', text: `${qty} x ${item.name}` });
    lines.push({ type: 'row', label: `  @${price}`, value: total });
  }
  lines.push({ type: 'divider' });

  // Totals
  const subtotal = parseFloat(data.subtotal || 0).toFixed(2);
  const tax = parseFloat(data.taxAmount || data.tax || 0).toFixed(2);
  const total = parseFloat(data.total || 0).toFixed(2);
  lines.push({ type: 'row', label: 'Subtotal:', value: `RD$ ${subtotal}` });
  if (data.taxBreakdown) {
    if (data.taxBreakdown.itbis18 > 0) lines.push({ type: 'row', label: '  ITBIS 18%:', value: `RD$ ${data.taxBreakdown.itbis18.toFixed(2)}` });
    if (data.taxBreakdown.itbis16 > 0) lines.push({ type: 'row', label: '  ITBIS 16%:', value: `RD$ ${data.taxBreakdown.itbis16.toFixed(2)}` });
  }
  lines.push({ type: 'row', label: 'ITBIS:', value: `RD$ ${tax}` });
  lines.push({ type: 'bold-row', label: 'TOTAL:', value: `RD$ ${total}` });
  lines.push({ type: 'divider' });

  // Payments
  const PAYMENT_LABELS = {
    cash_dop: 'Efectivo RD$', cash_usd: 'Efectivo US$', card: 'Tarjeta',
    transfer: 'Transferencia', check: 'Cheque', coupon: 'Cupón/Bono', store_credit: 'Crédito Tienda',
  };
  for (const p of (data.payments || [])) {
    const label = PAYMENT_LABELS[p.method] || p.method;
    lines.push({ type: 'row', label: `${label}:`, value: `RD$ ${parseFloat(p.amount || 0).toFixed(2)}` });
  }
  if (data.change && parseFloat(data.change) > 0) {
    lines.push({ type: 'bold-row', label: 'CAMBIO:', value: `RD$ ${parseFloat(data.change).toFixed(2)}` });
  }
  lines.push({ type: 'divider' });

  // Footer
  if (data.footerMessage) lines.push({ type: 'text', text: data.footerMessage, align: 'center' });
  lines.push({ type: 'text', text: 'Conserve este recibo para cualquier', align: 'center' });
  lines.push({ type: 'text', text: 'reclamación o devolución.', align: 'center' });

  return { ...data, lines };
}

// ─── Build Receipt HTML ──────────────────────────────────────────────────────
function buildReceiptHTML(receiptData, paperSize = '80') {
  const widthMM = paperSize === '58' ? '58mm' : '80mm';
  const paddingMM = paperSize === '58' ? '1mm' : '2mm';
  const maxLogo = paperSize === '58' ? '35mm' : '45mm';
  let body = '';

  const logoUrl = receiptData.logoUrl || receiptData.logo;
  if (logoUrl) {
    body += `<p style="text-align:center;margin:0 0 2mm 0"><img src="${escapeHtml(logoUrl)}" style="max-width:${maxLogo};max-height:18mm;display:inline-block" onerror="this.style.display='none'" /></p>`;
  }

  const normalized = convertReceiptDataToLines(receiptData);
  for (const line of (normalized.lines || [])) {
    switch (line.type) {
      case 'title':
        body += `<p style="text-align:center;font-weight:bold;font-size:14pt;margin:2mm 0;line-height:1.2">${escapeHtml(line.text)}</p>`;
        break;
      case 'subtitle':
        body += `<p style="text-align:center;font-weight:bold;font-size:10pt;margin:1mm 0;line-height:1.2">${escapeHtml(line.text)}</p>`;
        break;
      case 'text': {
        const align = line.align === 'right' ? 'right' : line.align === 'center' ? 'center' : 'left';
        body += `<p style="text-align:${align};font-size:9pt;margin:0.3mm 0;line-height:1.3">${escapeHtml(line.text)}</p>`;
        break;
      }
      case 'row':
        body += `<table style="width:100%;font-size:9pt;margin:0.3mm 0;border-collapse:collapse"><tr><td style="text-align:left;padding:0">${escapeHtml(line.label || '')}</td><td style="text-align:right;padding:0">${escapeHtml(line.value || '')}</td></tr></table>`;
        break;
      case 'bold-row':
        body += `<table style="width:100%;font-size:10pt;font-weight:bold;margin:0.5mm 0;border-collapse:collapse"><tr><td style="text-align:left;padding:0">${escapeHtml(line.label || '')}</td><td style="text-align:right;padding:0">${escapeHtml(line.value || '')}</td></tr></table>`;
        break;
      case 'divider':
        body += `<hr style="border:none;border-top:1px dashed #000;margin:1.5mm 0">`;
        break;
      case 'barcode':
        body += `<p style="text-align:center;font-family:monospace;font-size:12pt;margin:2mm 0">*${escapeHtml(line.value || '')}*</p>`;
        break;
      case 'spacer':
        body += `<p style="margin:2mm 0">&nbsp;</p>`;
        break;
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@page {
  margin: 0;
  padding: 0;
  size: ${widthMM} auto;
}
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
html, body {
  width: ${widthMM};
  max-width: ${widthMM};
  margin: 0;
  padding: ${paddingMM};
  font-family: 'Courier New', 'Lucida Console', monospace;
  font-size: 9pt;
  line-height: 1.3;
  color: #000;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td {
  padding: 0;
  vertical-align: top;
}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── USB Printing (ESC/POS direct via node-escpos) ───────────────────────────
async function printUsb(receiptData) {
  const { Printer } = require('@node-escpos/core');
  const USB = require('@node-escpos/usb-adapter');

  return new Promise((resolve, reject) => {
    const device = new USB.default();
    device.open(async (err) => {
      if (err) return reject(new Error(`USB printer error: ${err.message}`));
      const printer = new Printer(device, { encoding: 'ISO-8859-1' });
      await buildEscPosReceipt(printer, receiptData);
      printer.close(() => resolve({ success: true }));
    });
  });
}

// ─── Network Printing ─────────────────────────────────────────────────────────
async function printNetwork(receiptData) {
  const { Printer } = require('@node-escpos/core');
  const Network = require('@node-escpos/network-adapter');

  const [host, portStr] = (printerConfig.address || '192.168.1.100:9100').split(':');
  const port = parseInt(portStr) || 9100;

  return new Promise((resolve, reject) => {
    const device = new Network.default(host, port);
    device.open(async (err) => {
      if (err) return reject(new Error(`Network printer error: ${err.message}`));
      const printer = new Printer(device, { encoding: 'ISO-8859-1' });
      await buildEscPosReceipt(printer, receiptData);
      printer.close(() => resolve({ success: true }));
    });
  });
}

// ─── Serial Printing ──────────────────────────────────────────────────────────
async function printSerial(receiptData) {
  const { Printer } = require('@node-escpos/core');
  const Serial = require('@node-escpos/serialport-adapter');

  return new Promise((resolve, reject) => {
    const device = new Serial.default(printerConfig.address, { baudRate: 9600 });
    device.open(async (err) => {
      if (err) return reject(new Error(`Serial printer error: ${err.message}`));
      const printer = new Printer(device, { encoding: 'ISO-8859-1' });
      await buildEscPosReceipt(printer, receiptData);
      printer.close(() => resolve({ success: true }));
    });
  });
}

// ─── ESC/POS Receipt Builder (for node-escpos library) ───────────────────────
async function buildEscPosReceipt(printer, receiptData) {
  const normalized = convertReceiptDataToLines(receiptData);
  for (const line of (normalized.lines || [])) {
    switch (line.type) {
      case 'title':
        printer.align('ct').style('bu').size(1, 1).text(line.text);
        break;
      case 'subtitle':
        printer.align('ct').style('b').size(0, 0).text(line.text);
        break;
      case 'text':
        printer.align(line.align === 'right' ? 'rt' : line.align === 'center' ? 'ct' : 'lt')
               .style('normal').size(0, 0).text(line.text);
        break;
      case 'row': {
        const label = (line.label || '').padEnd(24);
        const value = (line.value || '').padStart(16);
        printer.align('lt').style('normal').text(label + value);
        break;
      }
      case 'bold-row': {
        const label = (line.label || '').padEnd(24);
        const value = (line.value || '').padStart(16);
        printer.align('lt').style('b').text(label + value);
        break;
      }
      case 'divider':
        printer.align('lt').text('-'.repeat(40));
        break;
      case 'barcode':
        printer.align('ct').barcode(line.value, 'CODE39', { width: 2, height: 80 });
        break;
      case 'spacer':
        printer.text('');
        break;
    }
  }
  printer.cut().flush();
}

// ─── Open Cash Drawer ─────────────────────────────────────────────────────────
// Standard ESC/POS cash drawer kick command: ESC p m t1 t2
// Pin 2 (m=0): ESC p 0 25 250 — pulse pin 2 for 50ms on, 500ms off
// Pin 5 (m=1): ESC p 1 25 250 — pulse pin 5 for 50ms on, 500ms off
// The AOKIA AK-3080 has a standard RJ11 cash drawer port.
// We send BOTH pin commands to ensure compatibility with all cash drawers.
async function openCashDrawer() {
  const printerName = printerConfig.printerName || await getAutoDetectedPrinterName();
  console.log('[Hardware] openCashDrawer called, printerName:', printerName);

  // Build cash drawer kick commands
  // ESC p 0 25 250 - Kick pin 2 (most common)
  // ESC p 1 25 250 - Kick pin 5 (backup)
  const drawerCmd = Buffer.from([
    0x1B, 0x70, 0x00, 0x19, 0xFA,  // ESC p 0 25 250 (pin 2, 50ms on, 500ms off)
    0x1B, 0x70, 0x01, 0x19, 0xFA,  // ESC p 1 25 250 (pin 5, 50ms on, 500ms off)
  ]);

  // For network printers, send directly via TCP
  if (printerConfig.type === 'network') {
    const net = require('net');
    const [host, portStr] = (printerConfig.address || '').split(':');
    const port = parseInt(portStr) || 9100;
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(port, host, () => {
        socket.write(drawerCmd, () => { socket.destroy(); resolve({ success: true }); });
      });
      socket.on('error', (err) => reject(new Error(`Cash drawer network error: ${err.message}`)));
      setTimeout(() => { socket.destroy(); reject(new Error('Timeout')); }, 3000);
    });
  }

  // For USB printers on Windows: send raw command through the printer spooler
  // This is the SAME method used for printing - it goes through the Windows
  // print spooler which has exclusive access to the USB device.
  if (printerName && process.platform === 'win32') {
    try {
      console.log('[Hardware] Sending cash drawer command via Windows spooler to:', printerName);
      const result = await sendRawToPrinter(drawerCmd, printerName);
      return { success: true, ...result };
    } catch (err) {
      console.warn('[Hardware] Cash drawer via spooler failed:', err.message, '- trying direct USB');
    }
  }

  // Fallback: direct USB via node-escpos
  try {
    const USB = require('@node-escpos/usb-adapter');
    return new Promise((resolve, reject) => {
      const device = new USB.default();
      device.open((err) => {
        if (err) return reject(new Error(`Cash drawer USB error: ${err.message}`));
        device.write(drawerCmd, (err) => {
          device.close();
          if (err) return reject(new Error(`Cash drawer write error: ${err.message}`));
          resolve({ success: true });
        });
      });
    });
  } catch (err) {
    throw new Error(`Cash drawer error: ${err.message}. Impresora: ${printerName || 'no detectada'}`);
  }
}

module.exports = { setupHardware, printReceipt, openCashDrawer, getConnectedDevices, getPrinterStatus, getAvailablePrinters, sendRawToPrinter, getAutoDetectedPrinterName };
