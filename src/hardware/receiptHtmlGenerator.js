/**
 * Celeste POS - Receipt HTML Generator (Electron-side)
 * 
 * Generates rich HTML receipt optimized for GDI printing on 80mm thermal paper.
 * 
 * KEY INSIGHT: The BrowserWindow is created at 80mm * 96dpi / 25.4 = 302px wide.
 * Content MUST be designed for exactly 302px to render 1:1 without scaling.
 * If content is wider than the window, Chromium scales it down causing blur.
 * 
 * Font sizes: At 96dpi on 302px, use 12-14px for body text, 16-18px for headers.
 * This gives crisp, legible text on thermal paper without anti-aliasing blur.
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
 * Generate full receipt HTML — designed for 302px BrowserWindow (80mm at 96dpi).
 * All content fits within 302px without scaling for crisp 1:1 rendering.
 * 
 * @param {object} data - ReceiptData object from the web app
 * @param {string} paperSize - '80' or '58'
 * @returns {string} - Full HTML document
 */
function generateReceiptHTMLForBitmap(data, paperSize = '80') {
  // Body width matches BrowserWindow exactly: 80mm=302px, 58mm=219px at 96dpi
  const pw = paperSize === '58' ? '219px' : '302px';
  const pd = paperSize === '58' ? '4px 6px' : '4px 10px';
  const maxLogo = paperSize === '58' ? '100px' : '140px';

  // Font sizes for 302px width — crisp at 96dpi, no scaling needed
  const bodyFontSize = paperSize === '58' ? '10px' : '12px';
  const storeNameSize = paperSize === '58' ? '15px' : '18px';
  const storeInfoSize = paperSize === '58' ? '9px' : '10px';
  const ticketNumSize = paperSize === '58' ? '13px' : '15px';
  const infoRowSize = paperSize === '58' ? '10px' : '11px';
  const tableSize = paperSize === '58' ? '10px' : '11px';
  const totalsSize = paperSize === '58' ? '11px' : '12px';
  const totalBigSize = paperSize === '58' ? '14px' : '16px';
  const footerSize = paperSize === '58' ? '9px' : '10px';
  const smallSize = paperSize === '58' ? '8px' : '9px';

  const subtotal = typeof data.subtotal === 'string' ? parseFloat(data.subtotal) : (data.subtotal || 0);
  const tax = typeof data.taxAmount === 'string' ? parseFloat(data.taxAmount) : (data.taxAmount || 0);
  const total = typeof data.total === 'string' ? parseFloat(data.total) : (data.total || 0);
  const change = data.change ? (typeof data.change === 'string' ? parseFloat(data.change) : data.change) : 0;

  const logoUrl = data.logoUrl || '';

  console.log(`[ReceiptHTML] Building receipt: items=${(data.items || []).length}, storeName=${data.storeName}, ticket=${data.ticketNumber}`);

  const itemsHTML = (data.items || []).map(item => {
    const qty = typeof item.quantity === 'string' ? parseFloat(item.quantity) : (item.quantity || 1);
    const price = typeof item.unitPrice === 'string' ? parseFloat(item.unitPrice) : (item.unitPrice || 0);
    const lineTotal = typeof item.total === 'string' ? parseFloat(item.total) : (item.total || 0);
    const qtyStr = item.isWeighed ? `${qty.toFixed(3)}kg` : `${qty}`;
    const name = escapeHtml(item.name || item.productName || 'Producto');
    // Two-row layout: name on first row, qty x price = total on second
    return `<tr>
      <td colspan="3" style="text-align:left; padding-top:4px; font-weight:bold;">${name}</td>
    </tr>
    <tr>
      <td style="text-align:left; padding-left:6px; padding-bottom:3px;">${escapeHtml(qtyStr)}</td>
      <td style="text-align:center; padding-bottom:3px;">x ${formatMoney(price)}</td>
      <td style="text-align:right; padding-bottom:3px; font-weight:bold;">${formatMoney(lineTotal)}</td>
    </tr>`;
  }).join('');

  const noItemsWarning = (!data.items || data.items.length === 0)
    ? `<tr><td colspan="3" style="text-align:center; padding:8px 0; font-style:italic;">-- Sin artículos --</td></tr>`
    : '';

  const paymentsHTML = (data.payments || []).map(p => {
    const label = PAYMENT_LABELS[p.method] || p.method;
    const amt = typeof p.amount === 'string' ? parseFloat(p.amount) : (p.amount || 0);
    return `<tr><td colspan="2" style="text-align:right; padding:2px 0;">${escapeHtml(label)}:</td><td style="text-align:right; padding:2px 0;">${formatMoney(amt)}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recibo ${escapeHtml(data.ticketNumber)}</title>
  <style>
    @page { margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      font-size: ${bodyFontSize};
      width: ${pw};
      padding: ${pd};
      color: #000;
      background: #fff;
      -webkit-font-smoothing: none;
      line-height: 1.3;
    }
    .header { text-align: center; margin-bottom: 8px; }
    .header .logo { max-width: ${maxLogo}; max-height: 60px; margin-bottom: 4px; display: block; margin-left: auto; margin-right: auto; }
    .header .store-name { font-size: ${storeNameSize}; font-weight: 900; margin-bottom: 2px; }
    .header .store-info { font-size: ${storeInfoSize}; line-height: 1.4; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .divider-double { border-top: 2px solid #000; margin: 6px 0; }
    .ticket-box { font-size: ${ticketNumSize}; padding: 5px 0; border: 2px solid #000; margin: 4px 0; text-align: center; font-weight: 900; }
    .info-row { display: flex; justify-content: space-between; font-size: ${infoRowSize}; padding: 1px 0; }
    table { width: 100%; border-collapse: collapse; font-size: ${tableSize}; }
    th { text-align: left; border-bottom: 2px solid #000; padding: 3px 0; font-weight: 900; }
    th:last-child { text-align: right; }
    td { padding: 1px 0; vertical-align: top; }
    .totals td { font-size: ${totalsSize}; padding: 2px 0; }
    .total-row td { font-size: ${totalBigSize} !important; font-weight: 900; padding: 4px 0; }
    .payments { margin-top: 6px; font-size: ${totalsSize}; }
    .footer { text-align: center; margin-top: 10px; font-size: ${footerSize}; line-height: 1.4; }
    .reprint-badge { text-align: center; font-size: ${infoRowSize}; font-weight: 900; margin: 4px 0; padding: 2px 8px; border: 1px dashed #000; display: inline-block; }
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
  <div style="text-align:center; margin: 6px 0; padding: 5px 4px; border: 2px solid #000; font-weight: 900;">
    <div style="font-size: ${infoRowSize}; margin-bottom: 2px;">${escapeHtml(data.ecf.documentType)}</div>
    <div style="font-size: ${ticketNumSize};">e-NCF: ${escapeHtml(data.ecf.eNcf)}</div>
  </div>
  ` : data.ncfNumber ? `
  <div style="text-align:center; margin: 6px 0; padding: 4px; border: 2px solid #000; font-weight: 900; font-size: ${ticketNumSize};">
    COMPROBANTE FISCAL
  </div>
  ` : ''}
  <div class="ticket-box">RECIBO #${escapeHtml(data.ticketNumber)}</div>
  ${data.isReprint ? `<div style="text-align:center;"><span class="reprint-badge">*** REIMPRESIÓN ***</span></div>` : ''}
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
      <tr><th>Cant</th><th>Descripción</th><th>Total</th></tr>
    </thead>
    <tbody>
      ${itemsHTML}
      ${noItemsWarning}
    </tbody>
  </table>
  <div class="divider"></div>
  <table class="totals">
    <tr><td colspan="2" style="text-align:right">Subtotal:</td><td style="text-align:right">${formatMoney(subtotal)}</td></tr>
    ${data.taxBreakdown ? `
    ${data.taxBreakdown.exempt > 0 ? `<tr><td colspan="2" style="text-align:right; font-size:${smallSize};">Exento:</td><td style="text-align:right; font-size:${smallSize};">${formatMoney(data.taxBreakdown.exempt)}</td></tr>` : ''}
    ${data.taxBreakdown.itbis16 > 0 ? `<tr><td colspan="2" style="text-align:right; font-size:${smallSize};">ITBIS 16%:</td><td style="text-align:right; font-size:${smallSize};">${formatMoney(data.taxBreakdown.itbis16)}</td></tr>` : ''}
    ${data.taxBreakdown.itbis18 > 0 ? `<tr><td colspan="2" style="text-align:right; font-size:${smallSize};">ITBIS 18%:</td><td style="text-align:right; font-size:${smallSize};">${formatMoney(data.taxBreakdown.itbis18)}</td></tr>` : ''}
    <tr><td colspan="2" style="text-align:right; font-weight:900;">Total ITBIS:</td><td style="text-align:right; font-weight:900;">${formatMoney(tax)}</td></tr>
    ` : `
    <tr><td colspan="2" style="text-align:right">ITBIS:</td><td style="text-align:right">${formatMoney(tax)}</td></tr>
    `}
    <tr class="total-row"><td colspan="2" style="text-align:right">TOTAL:</td><td style="text-align:right">${formatMoney(total)}</td></tr>
  </table>
  <div class="divider-double"></div>
  <table class="payments">
    ${paymentsHTML}
    ${change > 0 ? `<tr style="font-weight:900"><td colspan="2" style="text-align:right">CAMBIO:</td><td style="text-align:right">${formatMoney(change)}</td></tr>` : ''}
  </table>
  <div class="divider"></div>
  ${data.socialMedia ? `
  <div style="text-align:center; margin: 10px 0; font-size: ${footerSize};">
    <div style="font-weight:900; margin-bottom: 4px;">Redes Sociales y Contacto</div>
    ${data.socialMedia.whatsapp ? `<div style="padding:1px 0;">WhatsApp: ${escapeHtml(data.socialMedia.whatsapp)}</div>` : ''}
    ${data.socialMedia.instagram ? `<div style="padding:1px 0;">Instagram: ${escapeHtml(data.socialMedia.instagram)}</div>` : ''}
    ${data.socialMedia.facebook ? `<div style="padding:1px 0;">Facebook: ${escapeHtml(data.socialMedia.facebook)}</div>` : ''}
    ${data.socialMedia.website ? `<div style="padding:1px 0;">Web: ${escapeHtml(data.socialMedia.website)}</div>` : ''}
  </div>
  ` : ''}
  ${data.googleReviewQr ? `
  <div style="text-align:center; margin: 10px 0;">
    <div style="font-size: ${footerSize}; font-weight:900; margin-bottom: 4px;">Déjanos una reseña</div>
    <img src="${data.googleReviewQr}" style="width: 80px; height: 80px; display: block; margin: 0 auto;" alt="Google Review QR" />
    <div style="font-size: ${smallSize}; margin-top: 2px;">Escanea para dejar tu reseña</div>
  </div>
  ` : ''}
  ${data.ecf ? `
  <div style="text-align:center; margin: 10px 0; padding: 6px 4px; border-top: 1px dashed #000;">
    <div style="font-size: ${footerSize}; font-weight:900; margin-bottom: 4px;">Verificación Fiscal DGII</div>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(data.ecf.verificationUrl)}" style="width: 80px; height: 80px; display: block; margin: 0 auto;" alt="QR Verificación DGII" />
    <div style="font-size: ${smallSize}; margin-top: 3px;">Código Seguridad: <strong>${escapeHtml(data.ecf.securityCode)}</strong></div>
    <div style="font-size: ${smallSize};">Firma Digital: ${escapeHtml(data.ecf.signatureDate)}</div>
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
