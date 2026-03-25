/**
 * Celeste POS - Hardware Integration Module
 * Supports:
 *   - ESC/POS receipt printers (USB, Network, Serial)
 *   - USB barcode scanners (HID - plug and play, keyboard emulation)
 *   - Cash drawers (via printer port RJ11)
 */

let printerConfig = { type: 'usb', address: '' };

// ─── Setup ────────────────────────────────────────────────────────────────────
async function setupHardware(config = {}) {
  printerConfig = { ...printerConfig, ...config };
  console.log('[Hardware] Initialized with config:', printerConfig);
}

// ─── Discover Connected Devices ───────────────────────────────────────────────
async function getConnectedDevices() {
  const devices = [];

  // USB printers via node-hid (vendor ID detection)
  try {
    const HID = require('node-hid');
    const hidDevices = HID.devices();
    const printerVendors = [0x04b8, 0x0519, 0x154f, 0x0dd4]; // Epson, Star, SNBC, Custom
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
      if (p.manufacturer?.toLowerCase().includes('epson') ||
          p.manufacturer?.toLowerCase().includes('star')) {
        devices.push({ type: 'printer', name: `Serial Printer (${p.path})`, path: p.path });
      }
    }
  } catch { /* serialport optional */ }

  // Network printer (if configured)
  if (printerConfig.type === 'network' && printerConfig.address) {
    devices.push({ type: 'printer', name: `Network Printer (${printerConfig.address})`, address: printerConfig.address });
  }

  // Barcode scanners (HID keyboard emulation — most USB scanners)
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
async function printReceipt(receiptData) {
  if (printerConfig.type === 'network') return printNetwork(receiptData);
  if (printerConfig.type === 'serial')  return printSerial(receiptData);
  return printUsb(receiptData);
}

// ─── USB Printing ─────────────────────────────────────────────────────────────
async function printUsb(receiptData) {
  const { Printer } = require('@node-escpos/core');
  const USB = require('@node-escpos/usb-adapter');

  return new Promise((resolve, reject) => {
    const device = new USB.default();
    device.open(async (err) => {
      if (err) return reject(new Error(`USB printer error: ${err.message}`));
      const printer = new Printer(device, { encoding: 'ISO-8859-1' });
      await buildReceipt(printer, receiptData);
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
      await buildReceipt(printer, receiptData);
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
      await buildReceipt(printer, receiptData);
      printer.close(() => resolve({ success: true }));
    });
  });
}

// ─── ESC/POS Receipt Builder ──────────────────────────────────────────────────
async function buildReceipt(printer, receiptData) {
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

module.exports = { setupHardware, printReceipt, openCashDrawer, getConnectedDevices };
