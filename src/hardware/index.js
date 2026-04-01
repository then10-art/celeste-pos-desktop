/**
 * Celeste POS - Hardware Integration Module
 * Supports:
 *   - ESC/POS receipt printers (USB, Network, Serial)
 *   - USB barcode scanners (HID - plug and play, keyboard emulation)
 *   - Cash drawers (via printer port RJ11)
 *   - Windows printer detection via Electron webContents.getPrinters()
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
  /escpos/i,
  /esc[\s\/]pos/i,
];

// Second-tier: Epson inkjet/all-in-one printers that can be used for receipts
// (e.g., Epson ET-4550, EPSON88489C, Epson L-series, etc.)
const EPSON_INKJET_PATTERNS = [
  /epson\s*et[\s-]?\d/i,       // Epson ET-4550, ET-2720, etc.
  /epson\s*l[\s-]?\d/i,        // Epson L3150, L4160, etc.
  /epson\s*wf[\s-]?\d/i,       // Epson WF-2830, WF-7710, etc.
  /epson\s*xp[\s-]?\d/i,       // Epson XP-4100, etc.
  /epson\s*\d{4,}/i,           // EPSON88489C and similar model codes
  /epson/i,                     // Any Epson printer as last resort
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
  // If a specific printer is configured by name, check if it's in the system list
  if (printerConfig.printerName && mainWindowRef) {
    try {
      const printers = mainWindowRef.webContents.getPrinters();
      const configured = printers.find(p => p.name === printerConfig.printerName);
      if (configured) {
        return {
          connected: configured.status === 0, // 0 = ready
          name: configured.name,
          type: printerConfig.type || 'usb',
        };
      }
    } catch { /* fall through */ }
  }

  // Auto-detect: find the first receipt printer in the system
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

  // Fallback: try USB device detection via node-hid
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
  // First pass: look for known receipt/thermal/POS printer patterns
  for (const p of printers) {
    if (EXCLUDED_PATTERNS.some(rx => rx.test(p.name))) continue;
    if (RECEIPT_PRINTER_PATTERNS.some(rx => rx.test(p.name))) {
      return p;
    }
  }

  // Second pass: look for USB Receipt Printer (generic name)
  for (const p of printers) {
    if (p.name.toLowerCase().includes('usb') && !EXCLUDED_PATTERNS.some(rx => rx.test(p.name))) {
      return p;
    }
  }

  // Third pass: look for Epson inkjet/all-in-one printers (ET-4550, L-series, etc.)
  // These can print receipts via the system printer dialog (not ESC/POS)
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

  // System printers via Electron API
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

  // System printers via Electron
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

  // USB HID devices
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

  // Serial ports
  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    for (const p of ports) {
      if (p.manufacturer) {
        devices.push({ type: 'serial', name: `${p.manufacturer} (${p.path})`, path: p.path });
      }
    }
  } catch { /* serialport optional */ }

  // Barcode scanners (HID keyboard emulation)
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
async function printReceipt(receiptData, paperSize) {
  if (printerConfig.type === 'network') return printNetwork(receiptData);
  if (printerConfig.type === 'serial')  return printSerial(receiptData);

  // Try Windows system printer first (works with "80mm Series Printer" and similar)
  if (printerConfig.printerName || mainWindowRef) {
    try {
      return await printViaSystem(receiptData, paperSize);
    } catch (err) {
      console.warn('[Hardware] System print failed, trying USB direct:', err.message);
    }
  }

  return printUsb(receiptData);
}

// ─── System Printer (Windows GDI) ────────────────────────────────────────────
// Uses Electron's webContents.print() to send to a named Windows printer
async function printViaSystem(receiptData, paperSize = '80') {
  if (!mainWindowRef) throw new Error('No window reference');

  const printerName = printerConfig.printerName || await getAutoDetectedPrinterName();
  if (!printerName) throw new Error('No receipt printer found');

  // Build simple HTML receipt for system printing
  const html = buildReceiptHTML(receiptData, paperSize);

  return new Promise((resolve, reject) => {
    // Create a hidden window for printing
    const { BrowserWindow } = require('electron');
    const printWin = new BrowserWindow({
      show: false,
      width: paperSize === '58' ? 220 : 302,
      height: 900,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    printWin.webContents.on('did-finish-load', () => {
      printWin.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: printerName,
          margins: { marginType: 'none' },
        },
        (success, failureReason) => {
          printWin.close();
          if (success) {
            resolve({ success: true });
          } else {
            reject(new Error(failureReason || 'Print failed'));
          }
        }
      );
    });

    // Timeout safety
    setTimeout(() => {
      try { printWin.close(); } catch { /* ignore */ }
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

// ─── Build Receipt HTML ──────────────────────────────────────────────────────
function buildReceiptHTML(receiptData, paperSize = '80') {
  const width = paperSize === '58' ? '48mm' : '72mm';
  let body = '';

  for (const line of (receiptData.lines || [])) {
    switch (line.type) {
      case 'title':
        body += `<div style="text-align:center;font-weight:bold;font-size:16px;text-decoration:underline;margin:4px 0">${escapeHtml(line.text)}</div>`;
        break;
      case 'subtitle':
        body += `<div style="text-align:center;font-weight:bold;font-size:12px;margin:2px 0">${escapeHtml(line.text)}</div>`;
        break;
      case 'text': {
        const align = line.align === 'right' ? 'right' : line.align === 'center' ? 'center' : 'left';
        body += `<div style="text-align:${align};font-size:11px;margin:1px 0">${escapeHtml(line.text)}</div>`;
        break;
      }
      case 'row':
        body += `<div style="display:flex;justify-content:space-between;font-size:11px;margin:1px 0"><span>${escapeHtml(line.label || '')}</span><span>${escapeHtml(line.value || '')}</span></div>`;
        break;
      case 'bold-row':
        body += `<div style="display:flex;justify-content:space-between;font-size:11px;font-weight:bold;margin:1px 0"><span>${escapeHtml(line.label || '')}</span><span>${escapeHtml(line.value || '')}</span></div>`;
        break;
      case 'divider':
        body += `<div style="border-top:1px dashed #000;margin:4px 0"></div>`;
        break;
      case 'barcode':
        body += `<div style="text-align:center;font-family:monospace;font-size:14px;margin:4px 0">*${escapeHtml(line.value || '')}*</div>`;
        break;
      case 'spacer':
        body += `<div style="height:8px"></div>`;
        break;
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: ${width} auto; margin: 0; }
    body { font-family: 'Courier New', monospace; width: ${width}; margin: 0; padding: 2mm; }
  </style></head><body>${body}</body></html>`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── USB Printing (ESC/POS direct) ───────────────────────────────────────────
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

// ─── ESC/POS Receipt Builder ──────────────────────────────────────────────────
async function buildEscPosReceipt(printer, receiptData) {
  for (const line of (receiptData.lines || [])) {
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
// Standard ESC/POS cash drawer kick: ESC p m t1 t2
const CASH_DRAWER_CMD = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0x19]);

async function openCashDrawer() {
  if (printerConfig.type === 'network') {
    const net = require('net');
    const [host, portStr] = (printerConfig.address || '').split(':');
    const port = parseInt(portStr) || 9100;
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(port, host, () => {
        socket.write(CASH_DRAWER_CMD, () => { socket.destroy(); resolve({ success: true }); });
      });
      socket.on('error', reject);
      setTimeout(() => { socket.destroy(); reject(new Error('Timeout')); }, 3000);
    });
  }

  // USB fallback
  try {
    const USB = require('@node-escpos/usb-adapter');
    return new Promise((resolve, reject) => {
      const device = new USB.default();
      device.open((err) => {
        if (err) return reject(err);
        device.write(CASH_DRAWER_CMD, (err) => {
          device.close();
          if (err) return reject(err);
          resolve({ success: true });
        });
      });
    });
  } catch (err) {
    throw new Error(`Cash drawer error: ${err.message}`);
  }
}

module.exports = { setupHardware, printReceipt, openCashDrawer, getConnectedDevices, getPrinterStatus, getAvailablePrinters };
