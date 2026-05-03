/**
 * Celeste POS - Offline Printer Module
 * 
 * Handles ALL printing locally without any web app dependency.
 * Two modes:
 *   - GDI (Windows Driver): Prints via Windows print system using Courier New text
 *     This is how Eleventa and most traditional POS software works.
 *     Most reliable for printers that have Windows drivers installed.
 *   - RAW (ESC/POS): Sends raw binary commands directly to the printer.
 *     Faster, but requires the printer to support ESC/POS protocol.
 * 
 * Default: GDI mode (most compatible, works with any Windows-installed printer)
 */

const { BrowserWindow } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ─── GDI Receipt Printing (Windows Driver - like Eleventa) ──────────────────
// This creates a simple monospace text document and prints it through
// the Windows printer driver. Works with ANY printer that has a driver installed.
async function printReceiptGDI(receiptData, printerName, paperSize = '80') {
  if (!printerName) throw new Error('No printer configured');

  const maxCols = (paperSize === '58') ? 32 : 42;
  const widthMm = (paperSize === '58') ? 58 : 80;
  const fontSize = (paperSize === '58') ? '10pt' : '12pt';

  // Build plain text receipt
  const textLines = buildReceiptText(receiptData, maxCols);
  const textContent = textLines.join('\n');

  // Wrap in minimal HTML with Courier New (like Eleventa uses)
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
@page { margin: 0; size: ${widthMm}mm auto; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Courier New', 'Lucida Console', monospace;
  font-size: ${fontSize};
  width: ${widthMm}mm;
  margin: 0;
  padding: 2mm;
  line-height: 1.3;
  color: #000;
  background: #fff;
  -webkit-print-color-adjust: exact;
}
pre {
  font-family: inherit;
  font-size: inherit;
  white-space: pre-wrap;
  word-wrap: break-word;
  margin: 0;
}
</style></head><body>
<pre>${escapeHtml(textContent)}</pre>
</body></html>`;

  return await printHTMLDocument(html, printerName, widthMm);
}

// ─── GDI Label Printing (Windows Driver) ────────────────────────────────────
// Prints a product label using the Windows printer driver.
// Simple text-based layout for maximum compatibility.
async function printLabelGDI(labelData, printerName, widthMm = 37.3, heightMm = 28.6) {
  if (!printerName) throw new Error('No label printer configured');

  const { productName, price, barcode, storeName, date, weight, unit } = labelData;

  // Build label HTML - simple text layout optimized for small stickers
  const displayPrice = typeof price === 'number' ? `RD$${price.toFixed(2)}` : (price || '');
  const displayName = (productName || '').substring(0, 20); // Truncate for small labels
  const displayBarcode = barcode || '';
  const displayStore = (storeName || '').substring(0, 18);
  const displayDate = date || new Date().toLocaleDateString('es-DO');
  const displayWeight = weight ? `${weight}${unit || 'kg'}` : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
@page { margin: 0; size: ${widthMm}mm ${heightMm}mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Courier New', monospace;
  width: ${widthMm}mm;
  height: ${heightMm}mm;
  padding: 1mm;
  overflow: hidden;
  color: #000;
  background: #fff;
  -webkit-print-color-adjust: exact;
}
.store { font-size: 6pt; text-align: center; font-weight: bold; }
.name { font-size: 8pt; text-align: center; font-weight: bold; margin-top: 0.5mm; }
.price { font-size: 14pt; text-align: center; font-weight: bold; margin-top: 1mm; }
.weight { font-size: 7pt; text-align: center; }
.barcode { font-size: 7pt; text-align: center; margin-top: 0.5mm; font-family: 'Free 3 of 9', 'Code 39', monospace; }
.barcode-text { font-size: 6pt; text-align: center; }
.date { font-size: 5pt; text-align: center; margin-top: 0.5mm; }
</style></head><body>
<div class="store">${escapeHtml(displayStore)}</div>
<div class="name">${escapeHtml(displayName)}</div>
<div class="price">${escapeHtml(displayPrice)}</div>
${displayWeight ? `<div class="weight">${escapeHtml(displayWeight)}</div>` : ''}
<div class="barcode-text">${escapeHtml(displayBarcode)}</div>
<div class="date">${escapeHtml(displayDate)}</div>
</body></html>`;

  return await printHTMLDocument(html, printerName, widthMm, heightMm);
}

// ─── Batch Label Printing ───────────────────────────────────────────────────
async function printLabelsGDI(labels, printerName, widthMm = 37.3, heightMm = 28.6) {
  if (!printerName) throw new Error('No label printer configured');
  if (!labels || labels.length === 0) throw new Error('No labels to print');

  const results = [];
  for (const label of labels) {
    const copies = label.copies || 1;
    for (let i = 0; i < copies; i++) {
      try {
        const result = await printLabelGDI(label, printerName, widthMm, heightMm);
        results.push({ success: true, product: label.productName });
      } catch (err) {
        results.push({ success: false, product: label.productName, error: err.message });
      }
      // Small delay between labels to avoid overwhelming the printer
      if (i < copies - 1 || labels.indexOf(label) < labels.length - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }
  return { success: results.every(r => r.success), results, total: results.length };
}

// ─── Print HTML Document via Windows GDI ────────────────────────────────────
function printHTMLDocument(html, printerName, widthMm, heightMm) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `celeste-print-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html, 'utf-8');

    const printWin = new BrowserWindow({
      show: false,
      width: Math.round(widthMm * 3.78) + 50, // mm to px approx
      height: heightMm ? Math.round(heightMm * 3.78) + 50 : 2000,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    printWin.loadFile(tmpFile);

    printWin.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        const wMicrons = Math.round(widthMm * 1000);
        const hMicrons = heightMm ? Math.round(heightMm * 1000) : 300000;

        printWin.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: printerName,
          margins: { marginType: 'none' },
          pageSize: { width: wMicrons, height: hMicrons },
          scaleFactor: 100,
        }, (success, failureReason) => {
          printWin.close();
          try { fs.unlinkSync(tmpFile); } catch {}
          if (success) {
            resolve({ success: true, method: 'gdi' });
          } else {
            reject(new Error(failureReason || 'GDI print failed'));
          }
        });
      }, 800); // Wait for content to render
    });

    printWin.webContents.on('did-fail-load', (_event, _code, desc) => {
      try { printWin.close(); } catch {}
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error(`Failed to load print document: ${desc}`));
    });

    // Timeout safety
    setTimeout(() => {
      try { printWin.close(); } catch {}
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error('Print timeout (15s)'));
    }, 15000);
  });
}

// ─── Build Receipt Text (plain text, like Eleventa) ─────────────────────────
function buildReceiptText(data, maxCols = 42) {
  const lines = [];
  const center = (text) => {
    const trimmed = text.substring(0, maxCols);
    const pad = Math.max(0, Math.floor((maxCols - trimmed.length) / 2));
    return ' '.repeat(pad) + trimmed;
  };
  const leftRight = (left, right) => {
    const maxLeft = maxCols - right.length - 1;
    const l = left.substring(0, maxLeft).padEnd(maxLeft);
    return l + ' ' + right;
  };
  const divider = () => '='.repeat(maxCols);
  const dashes = () => '-'.repeat(maxCols);

  // Header
  lines.push(divider());
  lines.push(center(data.storeName || 'SUPERMERCADO'));
  if (data.storeAddress) lines.push(center(data.storeAddress));
  if (data.storePhone) lines.push(center(`Tel: ${data.storePhone}`));
  if (data.storeRnc) lines.push(center(`RNC: ${data.storeRnc}`));
  if (data.storeWhatsapp) lines.push(center(`WhatsApp: ${data.storeWhatsapp}`));
  lines.push(divider());

  // NCF / Comprobante Fiscal
  if (data.ncfNumber) {
    lines.push(center('COMPROBANTE FISCAL'));
    lines.push(leftRight('NCF:', data.ncfNumber));
    lines.push(dashes());
  }

  // Ticket info
  const ticketNum = data.ticketNumber || data.receiptNumber || '';
  lines.push(center(`RECIBO #${ticketNum}`));
  if (data.date) lines.push(leftRight('Fecha:', data.date));
  if (data.cashierName || data.cashier) lines.push(leftRight('Cajero:', data.cashierName || data.cashier));
  if (data.customerName) lines.push(leftRight('Cliente:', data.customerName));
  if (data.customerRnc) lines.push(leftRight('RNC/Cedula:', data.customerRnc));
  lines.push(dashes());

  // Column headers
  lines.push(leftRight('Cant. Descripcion', 'Importe'));
  lines.push(dashes());

  // Items
  for (const item of (data.items || [])) {
    const rawQty = item.quantity || item.qty || 1;
    const rawPrice = item.unitPrice || item.price || 0;
    const qty = item.isWeighed ? `${parseFloat(String(rawQty)).toFixed(3)}kg` : `${rawQty}`;
    const total = parseFloat(String(item.total || (rawQty * rawPrice))).toFixed(2);
    const name = (item.name || '').substring(0, maxCols - 15);
    lines.push(leftRight(`${qty}  ${name}`, `$${total}`));
  }
  lines.push(dashes());

  // Totals
  const itemCount = (data.items || []).length;
  lines.push(center(`No. de Articulos: ${itemCount}`));
  lines.push('');

  const subtotal = parseFloat(data.subtotal || 0).toFixed(2);
  const tax = parseFloat(data.taxAmount || data.tax || 0).toFixed(2);
  const total = parseFloat(data.total || 0).toFixed(2);

  lines.push(leftRight('Subtotal:', `$${subtotal}`));
  if (data.taxBreakdown) {
    if (data.taxBreakdown.itbis18 > 0) lines.push(leftRight('  ITBIS 18%:', `$${data.taxBreakdown.itbis18.toFixed(2)}`));
    if (data.taxBreakdown.itbis16 > 0) lines.push(leftRight('  ITBIS 16%:', `$${data.taxBreakdown.itbis16.toFixed(2)}`));
  }
  if (parseFloat(tax) > 0) lines.push(leftRight('ITBIS:', `$${tax}`));
  lines.push(divider());
  lines.push(leftRight('TOTAL:', `$${total}`));
  lines.push(divider());

  // Payments
  const PAYMENT_LABELS = {
    cash_dop: 'Efectivo RD$', cash_usd: 'Efectivo US$', card: 'Tarjeta',
    transfer: 'Transferencia', check: 'Cheque', coupon: 'Cupon/Bono', store_credit: 'Credito Tienda',
  };
  for (const p of (data.payments || [])) {
    const label = PAYMENT_LABELS[p.method] || p.method;
    lines.push(leftRight(`${label}:`, `$${parseFloat(p.amount || 0).toFixed(2)}`));
  }
  if (data.change && parseFloat(data.change) > 0) {
    lines.push(leftRight('CAMBIO:', `$${parseFloat(data.change).toFixed(2)}`));
  }
  lines.push(dashes());

  // Footer
  if (data.footerMessage) lines.push(center(data.footerMessage));
  lines.push(center('Gracias por su compra'));
  lines.push(center('Conserve este recibo para'));
  lines.push(center('cualquier reclamacion.'));
  lines.push('');
  lines.push('');
  lines.push('');
  lines.push(''); // Extra blank lines for paper feed before cut

  return lines;
}

// ─── Utility ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  printReceiptGDI,
  printLabelGDI,
  printLabelsGDI,
  buildReceiptText,
  printHTMLDocument,
};
