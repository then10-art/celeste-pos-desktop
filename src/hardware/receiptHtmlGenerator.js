/**
 * Celeste POS - Receipt HTML Generator (Electron-side)
 * 
 * Generates the same rich HTML receipt as the web app preview,
 * optimized for bitmap rendering and thermal printing.
 * 
 * This is a port of client/src/lib/escpos.ts generateReceiptHTML()
 * with enhancements for thermal print clarity.
 */

const PAYMENT_LABELS = {
  cash_dop: 'Efectivo RD$',
  cash_usd: 'Efectivo US$',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  check: 'Cheque',
  coupon: 'Cupón/Bono',
  store_credit: 'Crédito Tienda',
};

function formatMoney(amount) {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount || 0);
  return `RD$${num.toFixed(2)}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate full receipt HTML with logo, formatting, icons — identical to web app preview.
 * Enhanced with bolder fonts and higher contrast for thermal bitmap printing.
 * 
 * @param {object} data - ReceiptData object from the web app
 * @param {string} paperSize - '80' or '58'
 * @returns {string} - Full HTML document
 */
function generateReceiptHTMLForBitmap(data, paperSize = '80') {
  const pw = paperSize === '58' ? '48mm' : '72mm'; // printable area (not paper width)
  const pd = paperSize === '58' ? '1mm' : '2mm';
  const maxLogo = paperSize === '58' ? '35mm' : '45mm';
  const fontSize = paperSize === '58' ? '11px' : '13px';

  const subtotal = typeof data.subtotal === 'string' ? parseFloat(data.subtotal) : (data.subtotal || 0);
  const tax = typeof data.taxAmount === 'string' ? parseFloat(data.taxAmount) : (data.taxAmount || 0);
  const total = typeof data.total === 'string' ? parseFloat(data.total) : (data.total || 0);
  const change = data.change ? (typeof data.change === 'string' ? parseFloat(data.change) : data.change) : 0;

  const logoUrl = data.logoUrl || '';

  const itemsHTML = (data.items || []).map(item => {
    const qty = typeof item.quantity === 'string' ? parseFloat(item.quantity) : (item.quantity || 1);
    const price = typeof item.unitPrice === 'string' ? parseFloat(item.unitPrice) : (item.unitPrice || 0);
    const lineTotal = typeof item.total === 'string' ? parseFloat(item.total) : (item.total || 0);
    const qtyStr = item.isWeighed ? `${qty.toFixed(3)}kg` : `${qty}`;
    return `<tr>
      <td style="text-align:left">${escapeHtml(qtyStr)}</td>
      <td style="text-align:left">${escapeHtml(item.name)}</td>
      <td style="text-align:right">${formatMoney(price)}</td>
      <td style="text-align:right">${formatMoney(lineTotal)}</td>
    </tr>`;
  }).join('');

  const paymentsHTML = (data.payments || []).map(p => {
    const label = PAYMENT_LABELS[p.method] || p.method;
    const amt = typeof p.amount === 'string' ? parseFloat(p.amount) : (p.amount || 0);
    return `<tr><td colspan="3" style="text-align:right">${escapeHtml(label)}:</td><td style="text-align:right">${formatMoney(amt)}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recibo ${escapeHtml(data.ticketNumber)}</title>
  <style>
    @page { margin: 0; size: ${pw} auto; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      font-size: ${fontSize};
      width: ${pw};
      padding: ${pd};
      color: #000;
      background: #fff;
      font-weight: bold;
      -webkit-font-smoothing: none;
    }
    .header { text-align: center; margin-bottom: 8px; }
    .header .logo { max-width: ${maxLogo}; max-height: 18mm; margin-bottom: 4px; display: block; margin-left: auto; margin-right: auto; }
    .header .store-name { font-size: 20px; font-weight: 900; letter-spacing: 0.5px; }
    .header .store-info { font-size: 11px; font-weight: bold; }
    .divider { border-top: 2px dashed #000; margin: 6px 0; }
    .divider-double { border-top: 3px solid #000; margin: 6px 0; }
    .ticket-info { margin-bottom: 4px; }
    .ticket-info .ticket-num { text-align: center; font-weight: 900; font-size: 15px; }
    .info-row { display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; border-bottom: 2px solid #000; padding: 2px 0; font-weight: 900; }
    th:nth-child(3), th:nth-child(4) { text-align: right; }
    td { padding: 2px 0; vertical-align: top; font-weight: bold; }
    .totals td { font-size: 13px; font-weight: bold; }
    .total-row { font-weight: 900; font-size: 18px; }
    .payments { margin-top: 6px; }
    .footer { text-align: center; margin-top: 10px; font-size: 11px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="header">
    ${logoUrl ? `<img src="${logoUrl}" class="logo" alt="Logo" crossorigin="anonymous" onerror="this.style.display='none'" />` : ''}
    <div class="store-name">${escapeHtml(data.storeName)}</div>
    <div class="store-info">
      ${data.storeAddress ? `${escapeHtml(data.storeAddress)}<br>` : ''}
      ${data.storePhone ? `Tel: ${escapeHtml(data.storePhone)}<br>` : ''}
      ${data.storeRnc ? `RNC: ${escapeHtml(data.storeRnc)}` : ''}
    </div>
  </div>
  <div class="divider-double"></div>
  ${data.ecf ? `
  <div style="text-align:center; margin: 6px 0; padding: 6px 4px; border: 3px solid #000; font-weight: 900;">
    <div style="font-size: 13px; margin-bottom: 2px;">${escapeHtml(data.ecf.documentType)}</div>
    <div style="font-size: 15px; letter-spacing: 0.5px;">e-NCF: ${escapeHtml(data.ecf.eNcf)}</div>
  </div>
  ` : data.ncfNumber ? `
  <div style="text-align:center; margin: 6px 0; padding: 4px; border: 3px solid #000; font-weight: 900; font-size: 15px;">
    COMPROBANTE FISCAL
  </div>
  ` : ''}
  <div class="ticket-info">
    <div class="ticket-num" style="font-size:17px; padding:6px 0; border:3px solid #000; margin:4px 0; text-align:center; font-weight:900; letter-spacing:1px;">RECIBO #${escapeHtml(data.ticketNumber)}</div>
    ${data.isReprint ? '<div style="text-align:center; font-size:13px; font-weight:900; margin-top:4px; padding:2px 8px; border:2px dashed #000;">*** REIMPRESIÓN ***</div>' : ''}
  </div>
  <div class="divider-double"></div>
  <div class="info-row"><span>Fecha:</span><span>${escapeHtml(data.date)}</span></div>
  <div class="info-row"><span>Cajero:</span><span>${escapeHtml(data.cashierName)}</span></div>
  ${data.ecf ? `
  <div style="margin: 4px 0; padding: 4px; border: 1px solid #000;">
    <div class="info-row" style="font-weight:900"><span>e-NCF:</span><span>${escapeHtml(data.ecf.eNcf)}</span></div>
    ${data.customerName ? `<div class="info-row"><span>Cliente:</span><span>${escapeHtml(data.customerName)}</span></div>` : ''}
    ${data.customerRnc ? `<div class="info-row"><span>RNC/Cédula:</span><span>${escapeHtml(data.customerRnc)}</span></div>` : ''}
  </div>
  ` : data.ncfNumber ? `
  <div style="margin: 4px 0; padding: 4px; border: 1px solid #000;">
    <div class="info-row" style="font-weight:900"><span>NCF:</span><span>${escapeHtml(data.ncfNumber)}</span></div>
    ${data.customerName ? `<div class="info-row"><span>Cliente:</span><span>${escapeHtml(data.customerName)}</span></div>` : ''}
    ${data.customerRnc ? `<div class="info-row"><span>RNC/Cédula:</span><span>${escapeHtml(data.customerRnc)}</span></div>` : ''}
  </div>
  ` : `
  ${data.customerName ? `<div class="info-row"><span>Cliente:</span><span>${escapeHtml(data.customerName)}</span></div>` : ''}
  ${data.customerRnc ? `<div class="info-row"><span>RNC/Cédula:</span><span>${escapeHtml(data.customerRnc)}</span></div>` : ''}
  `}
  <div class="divider"></div>
  <table>
    <thead>
      <tr><th>Cant</th><th>Descripción</th><th>Precio</th><th>Total</th></tr>
    </thead>
    <tbody>
      ${itemsHTML}
    </tbody>
  </table>
  <div class="divider"></div>
  <table class="totals">
    <tr><td colspan="3" style="text-align:right">Subtotal:</td><td style="text-align:right">${formatMoney(subtotal)}</td></tr>
    ${data.taxBreakdown ? `
    ${data.taxBreakdown.exempt > 0 ? `<tr><td colspan="3" style="text-align:right; font-size:11px; padding-left:12px;">Exento:</td><td style="text-align:right; font-size:11px;">${formatMoney(data.taxBreakdown.exempt)}</td></tr>` : ''}
    ${data.taxBreakdown.itbis16 > 0 ? `<tr><td colspan="3" style="text-align:right; font-size:11px; padding-left:12px;">ITBIS 16%:</td><td style="text-align:right; font-size:11px;">${formatMoney(data.taxBreakdown.itbis16)}</td></tr>` : ''}
    ${data.taxBreakdown.itbis18 > 0 ? `<tr><td colspan="3" style="text-align:right; font-size:11px; padding-left:12px;">ITBIS 18%:</td><td style="text-align:right; font-size:11px;">${formatMoney(data.taxBreakdown.itbis18)}</td></tr>` : ''}
    <tr><td colspan="3" style="text-align:right; font-weight:900;">Total ITBIS:</td><td style="text-align:right; font-weight:900;">${formatMoney(tax)}</td></tr>
    ` : `
    <tr><td colspan="3" style="text-align:right">ITBIS:</td><td style="text-align:right">${formatMoney(tax)}</td></tr>
    `}
    <tr class="total-row"><td colspan="3" style="text-align:right">TOTAL:</td><td style="text-align:right">${formatMoney(total)}</td></tr>
  </table>
  <div class="divider-double"></div>
  <table class="payments">
    ${paymentsHTML}
    ${change > 0 ? `<tr style="font-weight:900"><td colspan="3" style="text-align:right">CAMBIO:</td><td style="text-align:right">${formatMoney(change)}</td></tr>` : ''}
  </table>
  <div class="divider"></div>
  ${data.socialMedia ? `
  <div style="text-align:center; margin: 10px 0; font-size: 12px;">
    <div style="font-weight:900; margin-bottom: 6px;">Redes Sociales y Contacto</div>
    ${data.socialMedia.whatsapp ? `<div>WhatsApp: ${escapeHtml(data.socialMedia.whatsapp)}</div>` : ''}
    ${data.socialMedia.instagram ? `<div>Instagram: ${escapeHtml(data.socialMedia.instagram)}</div>` : ''}
    ${data.socialMedia.facebook ? `<div>Facebook: ${escapeHtml(data.socialMedia.facebook)}</div>` : ''}
    ${data.socialMedia.website ? `<div>Web: ${escapeHtml(data.socialMedia.website)}</div>` : ''}
  </div>
  ` : ''}
  ${data.googleReviewQr ? `
  <div style="text-align:center; margin: 10px 0;">
    <div style="font-size: 11px; font-weight:900; margin-bottom: 4px;">Déjanos una reseña</div>
    <img src="${data.googleReviewQr}" style="width: 70px; height: 70px; display: block; margin: 0 auto;" alt="Google Review QR" />
    <div style="font-size: 10px; margin-top: 2px;">Escanea para dejar tu reseña</div>
  </div>
  ` : ''}
  ${data.ecf ? `
  <div style="text-align:center; margin: 10px 0; padding: 8px 4px; border-top: 2px dashed #000;">
    <div style="font-size: 11px; font-weight:900; margin-bottom: 6px;">Verificación Fiscal DGII</div>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(data.ecf.verificationUrl)}" style="width: 90px; height: 90px; display: block; margin: 0 auto;" alt="QR Verificación DGII" />
    <div style="font-size: 10px; margin-top: 4px;">Código Seguridad: <strong>${escapeHtml(data.ecf.securityCode)}</strong></div>
    <div style="font-size: 10px;">Firma Digital: ${escapeHtml(data.ecf.signatureDate)}</div>
  </div>
  ` : ''}
  <div class="footer">
    <p>${escapeHtml(data.footerMessage || '¡Gracias por su compra!')}</p>
    <p>Conserve este recibo para cualquier<br>reclamación o devolución.</p>
  </div>
</body>
</html>`;
}

module.exports = { generateReceiptHTMLForBitmap };
