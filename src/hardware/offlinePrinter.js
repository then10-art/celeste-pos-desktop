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
async function printReceiptGDI(receiptData, printerName, paperSize = '80') {
  if (!printerName) throw new Error('No printer configured');
  const widthMm = (paperSize === '58') ? 58 : 80;

  // Use the RICH HTML template (same as bitmap mode) for professional look
  // This gives us logo, social media, QR code, formatted items - everything
  const { generateReceiptHTMLForBitmap } = require('./receiptHtmlGenerator');
  const html = generateReceiptHTMLForBitmap(receiptData, paperSize);

  console.log(`[ReceiptGDI] Using rich HTML template, printer: ${printerName}, paper: ${paperSize}mm`);
  // Pass null for height so it uses the tall window (receipt length varies)
  return await printHTMLDocument(html, printerName, widthMm, null);
}

// ─── GDI Label Printing (Windows Driver) ────────────────────────────────────
// Prints a product label using the Windows printer driver.
// Uses pixel-based sizing for the BrowserWindow and mm-based for the print output.
async function printLabelGDI(labelData, printerName, widthMm = 51, heightMm = 25) {
  if (!printerName) throw new Error('No label printer configured');

  const { productName, price, barcode, storeName, date, weight, unit } = labelData;

  // Build label HTML - simple text layout optimized for small stickers
  const displayPrice = typeof price === 'number' ? `RD$${price.toFixed(2)}` : (price || '');
  const displayName = (productName || '').substring(0, 22); // Truncate for small labels
  const displayBarcode = barcode || '';
  const displayStore = (storeName || '').substring(0, 20);
  const displayDate = date || new Date().toLocaleDateString('es-DO');
  const displayWeight = weight ? `${weight}${unit || 'kg'}` : '';

  // Use a larger virtual page with explicit print-size CSS
  // The key insight: the BrowserWindow renders at screen DPI (~96dpi)
  // but the printer prints at its native DPI (usually 203dpi for thermal)
  // We need the HTML to look correct at screen resolution, then
  // the print system scales it to the label size.
  
  // Calculate pixel dimensions at 96 DPI for the label
  const pxWidth = Math.round(widthMm * 96 / 25.4);  // ~192px for 51mm (2")
  const pxHeight = Math.round(heightMm * 96 / 25.4); // ~94px for 25mm (1")

  const labelPxW = Math.floor(widthMm * 96 / 25.4);
  const labelPxH = Math.floor(heightMm * 96 / 25.4);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
@page {
  margin: 0 !important;
  size: ${widthMm}mm ${heightMm}mm;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  width: ${labelPxW}px;
  height: ${labelPxH}px;
  max-height: ${labelPxH}px;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  color: #000;
  background: #fff;
  font-size: 0;
  line-height: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.label {
  width: ${labelPxW}px;
  height: ${labelPxH}px;
  max-height: ${labelPxH}px;
  padding: 1mm;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-family: Arial, Helvetica, sans-serif;
  overflow: hidden;
  font-size: initial;
  line-height: normal;
  page-break-after: avoid;
  break-after: avoid;
}
.store {
  font-size: 6pt;
  text-align: center;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.name {
  font-size: 7pt;
  text-align: center;
  font-weight: bold;
  margin-top: 0.5mm;
  line-height: 1.1;
  max-height: 4mm;
  overflow: hidden;
}
.price {
  font-size: 16pt;
  text-align: center;
  font-weight: 900;
  margin-top: 0.5mm;
  line-height: 1;
}
.weight {
  font-size: 6pt;
  text-align: center;
}
.barcode-text {
  font-size: 6pt;
  text-align: center;
  font-family: 'Courier New', monospace;
  margin-top: 0.5mm;
  letter-spacing: 1px;
}
.date {
  font-size: 5pt;
  text-align: center;
  color: #333;
}
</style></head><body>
<div class="label">
  <div class="store">${escapeHtml(displayStore)}</div>
  <div class="name">${escapeHtml(displayName)}</div>
  <div class="price">${escapeHtml(displayPrice)}</div>
  ${displayWeight ? `<div class="weight">${escapeHtml(displayWeight)}</div>` : ''}
  <div class="barcode-text">${escapeHtml(displayBarcode)}</div>
  <div class="date">${escapeHtml(displayDate)}</div>
</div>
</body></html>`;

  console.log(`[LabelGDI] Printing: "${displayName}" @ ${displayPrice} to ${printerName} (${widthMm}x${heightMm}mm)`);

  return await printHTMLDocument(html, printerName, widthMm, heightMm);
}

// ─── Batch Label Printing ───────────────────────────────────────────────────
async function printLabelsGDI(labels, printerName, widthMm = 51, heightMm = 25) {
  if (!printerName) throw new Error('No label printer configured');
  if (!labels || labels.length === 0) throw new Error('No labels to print');

  console.log(`[LabelGDI] Batch printing ${labels.length} label types to ${printerName}`);

  const results = [];
  for (const label of labels) {
    const copies = label.copies || 1;
    for (let i = 0; i < copies; i++) {
      try {
        const result = await printLabelGDI(label, printerName, widthMm, heightMm);
        results.push({ success: true, product: label.productName });
        console.log(`[LabelGDI] Printed: ${label.productName} (copy ${i + 1}/${copies})`);
      } catch (err) {
        results.push({ success: false, product: label.productName, error: err.message });
        console.error(`[LabelGDI] Failed: ${label.productName}: ${err.message}`);
      }
      // Small delay between labels to avoid overwhelming the printer
      if (i < copies - 1 || labels.indexOf(label) < labels.length - 1) {
        await new Promise(r => setTimeout(r, 200));
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

    // BrowserWindow width MUST match the paper width in pixels (at 96dpi).
    // If the window is wider than the paper, Chromium scales content down and
    // the text becomes invisible (too small to print). Match width exactly.
    const pxWidth = Math.max(200, Math.round(widthMm * 96 / 25.4));
    // For receipts (no heightMm), use a tall window to fit all content without clipping
    const pxHeight = heightMm ? Math.round(heightMm * 96 / 25.4) : 2000;
    const printWin = new BrowserWindow({
      show: false,
      width: pxWidth,
      height: pxHeight,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    // Set content size to exact label dimensions to prevent blank second page
    if (heightMm) {
      printWin.setContentSize(pxWidth, pxHeight);
    }

    printWin.loadFile(tmpFile);

    printWin.webContents.on('did-finish-load', () => {
      // Inject CSS to prevent blank second page on label printers
      if (heightMm) {
        printWin.webContents.insertCSS(`
          html, body { width: ${pxWidth}px !important; height: ${pxHeight}px !important; max-height: ${pxHeight}px !important; overflow: hidden !important; margin: 0 !important; padding: 0 !important; }
          .label { width: ${pxWidth}px !important; height: ${pxHeight}px !important; max-height: ${pxHeight}px !important; overflow: hidden !important; }
          @page { size: ${widthMm}mm ${heightMm}mm; margin: 0 !important; }
        `).catch(() => {});
      }

      // Wait for fonts and content to fully render
      setTimeout(() => {
        const wMicrons = Math.round(widthMm * 1000);
        const hMicrons = heightMm ? Math.round(heightMm * 1000) : 300000;

        console.log(`[GDI Print] Sending to ${printerName}: ${wMicrons}x${hMicrons} microns`);

        printWin.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: printerName,
          margins: { marginType: 'none' },
          pageSize: { width: wMicrons, height: hMicrons },
          scaleFactor: 100,
          pageRanges: heightMm ? [{ from: 0, to: 0 }] : undefined,
        }, (success, failureReason) => {
          printWin.close();
          try { fs.unlinkSync(tmpFile); } catch {}
          if (success) {
            console.log('[GDI Print] Success');
            resolve({ success: true, method: 'gdi' });
          } else {
            console.error('[GDI Print] Failed:', failureReason);
            reject(new Error(failureReason || 'GDI print failed'));
          }
        });
      }, 1000); // Wait 1s for content/fonts to fully render before printing
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
      reject(new Error('Print timeout (20s)'));
    }, 20000);
  });
}

// ─── Build Receipt Text (plain text, like Eleventa) ─────────────────────────
// Produces a professional, well-formatted text receipt with proper columns
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
  const rightAlign = (text) => {
    return text.padStart(maxCols);
  };
  const divider = () => '='.repeat(maxCols);
  const dashes = () => '-'.repeat(maxCols);

  // Header
  lines.push(divider());
  lines.push(center((data.storeName || 'SUPERMERCADO').toUpperCase()));
  if (data.storeAddress) lines.push(center(data.storeAddress));
  if (data.storePhone) lines.push(center(`Tel: ${data.storePhone}`));
  if (data.storeRnc) lines.push(center(`RNC: ${data.storeRnc}`));
  lines.push(divider());

  // NCF / Comprobante Fiscal
  if (data.ecf) {
    lines.push(center(data.ecf.documentType || 'FACTURA ELECTRONICA'));
    lines.push(center(`e-NCF: ${data.ecf.eNcf}`));
    lines.push(dashes());
  } else if (data.ncfNumber) {
    lines.push(center('COMPROBANTE FISCAL'));
    lines.push(leftRight('NCF:', data.ncfNumber));
    lines.push(dashes());
  }

  // Ticket info
  const ticketNum = data.ticketNumber || data.receiptNumber || '';
  lines.push('');
  lines.push(center(`*** RECIBO #${ticketNum} ***`));
  if (data.isReprint) lines.push(center('*** REIMPRESION ***'));
  lines.push('');
  if (data.date) lines.push(leftRight('Fecha:', data.date));
  if (data.cashierName || data.cashier) lines.push(leftRight('Cajero:', data.cashierName || data.cashier));
  if (data.customerName) lines.push(leftRight('Cliente:', data.customerName));
  if (data.customerRnc) lines.push(leftRight('RNC/Cedula:', data.customerRnc));
  lines.push(dashes());

  // Column headers for items
  // Format: Cant  Descripcion          Precio   Total
  const colCant = 5;   // "99x  " or "1.234kg"
  const colTotal = 10; // "$99,999.99"
  const colPrice = 10; // "$99,999.99"
  const colDesc = maxCols - colCant - colTotal - colPrice - 2; // remaining space

  // Header row
  const hdrCant = 'Cant'.padEnd(colCant);
  const hdrDesc = 'Descripcion'.padEnd(colDesc);
  const hdrPrice = 'Precio'.padStart(colPrice);
  const hdrTotal = 'Total'.padStart(colTotal);
  lines.push(`${hdrCant} ${hdrDesc}${hdrPrice}${hdrTotal}`);
  lines.push(dashes());

  // Items with proper columns
  for (const item of (data.items || [])) {
    const rawQty = item.quantity || item.qty || 1;
    const rawPrice = item.unitPrice || item.price || 0;
    const qty = item.isWeighed ? `${parseFloat(String(rawQty)).toFixed(2)}k` : `${rawQty}x`;
    const unitPrice = parseFloat(String(rawPrice)).toFixed(2);
    const lineTotal = parseFloat(String(item.total || (rawQty * rawPrice))).toFixed(2);
    const name = (item.name || '').substring(0, colDesc - 1);

    const fmtQty = qty.padEnd(colCant);
    const fmtName = name.padEnd(colDesc);
    const fmtPrice = unitPrice.padStart(colPrice);
    const fmtTotal = lineTotal.padStart(colTotal);
    lines.push(`${fmtQty} ${fmtName}${fmtPrice}${fmtTotal}`);
  }
  lines.push(dashes());

  // Item count
  const itemCount = (data.items || []).reduce((sum, item) => {
    const qty = item.quantity || item.qty || 1;
    return sum + (typeof qty === 'number' ? qty : parseFloat(String(qty)) || 1);
  }, 0);
  const uniqueItems = (data.items || []).length;
  lines.push(center(`${uniqueItems} articulo(s) | ${itemCount} unidad(es)`));
  lines.push('');

  // Totals
  const subtotal = parseFloat(data.subtotal || 0).toFixed(2);
  const tax = parseFloat(data.taxAmount || data.tax || 0).toFixed(2);
  const total = parseFloat(data.total || 0).toFixed(2);

  lines.push(leftRight('Subtotal:', `$${subtotal}`));
  if (data.taxBreakdown) {
    if (data.taxBreakdown.exempt > 0) lines.push(leftRight('  Exento:', `$${data.taxBreakdown.exempt.toFixed(2)}`));
    if (data.taxBreakdown.itbis16 > 0) lines.push(leftRight('  ITBIS 16%:', `$${data.taxBreakdown.itbis16.toFixed(2)}`));
    if (data.taxBreakdown.itbis18 > 0) lines.push(leftRight('  ITBIS 18%:', `$${data.taxBreakdown.itbis18.toFixed(2)}`));
  }
  if (parseFloat(tax) > 0) lines.push(leftRight('Total ITBIS:', `$${tax}`));
  lines.push(divider());
  lines.push(leftRight('*** TOTAL:', `$${total} ***`));
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

  // e-NCF verification info
  if (data.ecf) {
    lines.push('');
    lines.push(center('VERIFICACION FISCAL DGII'));
    lines.push(leftRight('e-NCF:', data.ecf.eNcf));
    if (data.ecf.securityCode) lines.push(leftRight('Cod. Seguridad:', data.ecf.securityCode));
    if (data.ecf.signatureDate) lines.push(leftRight('Firma Digital:', data.ecf.signatureDate));
    lines.push(dashes());
  }

  // Social media / contact info
  if (data.socialMedia) {
    lines.push('');
    lines.push(center('--- Contacto ---'));
    if (data.socialMedia.whatsapp) lines.push(center(`WhatsApp: ${data.socialMedia.whatsapp}`));
    if (data.socialMedia.instagram) lines.push(center(`IG: ${data.socialMedia.instagram}`));
    if (data.socialMedia.facebook) lines.push(center(`FB: ${data.socialMedia.facebook}`));
    if (data.socialMedia.website) lines.push(center(`Web: ${data.socialMedia.website}`));
    lines.push('');
  }

  // Footer
  lines.push('');
  if (data.footerMessage) lines.push(center(data.footerMessage));
  lines.push(center('Gracias por su compra!'));
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
