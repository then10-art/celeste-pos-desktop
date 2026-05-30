/**
 * Celeste POS - Receipt HTML Generator (Electron-side)
 * 
 * Generates the same rich HTML receipt as the web app preview,
 * optimized for bitmap rendering and thermal printing at 203 DPI.
 * 
 * IMPORTANT: Font sizes are in CSS pixels but the bitmap is rendered
 * at screen resolution (96 DPI) then printed at 203 DPI on 72mm paper.
 * The BrowserWindow is 576px wide (72mm * 203/25.4).
 * So 1mm on paper = 8px in CSS. To get readable 9pt text (~3.2mm),
 * we need ~25px CSS font-size. All sizes are calibrated accordingly.
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
 * Generate full receipt HTML with logo, formatting — optimized for bitmap thermal printing.
 * Font sizes are calibrated for 203 DPI thermal printers (576px = 72mm).
 * 
 * @param {object} data - ReceiptData object from the web app
 * @param {string} paperSize - '80' or '58'
 * @returns {string} - Full HTML document
 */
function generateReceiptHTMLForBitmap(data, paperSize = '80') {
  // Use pixel widths matching the bitmap renderer (not mm)
  // 80mm paper: 72mm printable = 576px at 203 DPI
  // 58mm paper: 48mm printable = 384px at 203 DPI
  const pw = paperSize === '58' ? '384px' : '576px';
  const pd = paperSize === '58' ? '8px' : '16px';
  const maxLogo = paperSize === '58' ? '200px' : '280px';

  // Font sizes calibrated for 203 DPI thermal print on 72mm paper
  // 576px width / 72mm = 8px per mm
  // Target: body text ~9pt (3.2mm) = 25px, headers larger
  const bodyFontSize = paperSize === '58' ? '22px' : '25px';
  const storeNameSize = paperSize === '58' ? '36px' : '42px';
  const storeInfoSize = paperSize === '58' ? '20px' : '22px';
  const ticketNumSize = paperSize === '58' ? '28px' : '32px';
  const infoRowSize = paperSize === '58' ? '22px' : '24px';
  const tableSize = paperSize === '58' ? '20px' : '23px';
  const totalsSize = paperSize === '58' ? '24px' : '26px';
  const totalBigSize = paperSize === '58' ? '32px' : '36px';
  const footerSize = paperSize === '58' ? '20px' : '22px';
  const smallSize = paperSize === '58' ? '18px' : '20px';

  const subtotal = typeof data.subtotal === 'string' ? parseFloat(data.subtotal) : (data.subtotal || 0);
  const tax = typeof data.taxAmount === 'string' ? parseFloat(data.taxAmount) : (data.taxAmount || 0);
  const total = typeof data.total === 'string' ? parseFloat(data.total) : (data.total || 0);
  const change = data.change ? (typeof data.change === 'string' ? parseFloat(data.change) : data.change) : 0;

  const logoUrl = data.logoUrl || '';

  // Log items for debugging
  console.log(`[ReceiptHTML] Building receipt: items=${(data.items || []).length}, storeName=${data.storeName}, ticket=${data.ticketNumber}`);
  if (data.items && data.items.length > 0) {
    console.log(`[ReceiptHTML] First item: ${JSON.stringify(data.items[0])}`);
  } else {
    console.warn(`[ReceiptHTML] WARNING: No items in receipt data! Keys: ${Object.keys(data).join(', ')}`);
  }

  const itemsHTML = (data.items || []).map(item => {
    const qty = typeof item.quantity === 'string' ? parseFloat(item.quantity) : (item.quantity || 1);
    const price = typeof item.unitPrice === 'string' ? parseFloat(item.unitPrice) : (item.unitPrice || 0);
    const lineTotal = typeof item.total === 'string' ? parseFloat(item.total) : (item.total || 0);
    const qtyStr = item.isWeighed ? `${qty.toFixed(3)}kg` : `${qty}`;
    // Use two-row layout for items: name on first row, qty x price = total on second
    return `<tr>
      <td colspan="4" style="text-align:left; padding-top:6px; font-weight:bold;">${escapeHtml(item.name || item.productName || 'Producto')}</td>
    </tr>
    <tr>
      <td style="text-align:left; padding-left:8px; padding-bottom:4px;">${escapeHtml(qtyStr)}</td>
      <td style="text-align:left; padding-bottom:4px;">x ${formatMoney(price)}</td>
      <td colspan="2" style="text-align:right; padding-bottom:4px; font-weight:bold;">${formatMoney(lineTotal)}</td>
    </tr>`;
  }).join('');

  // If no items, show a warning row
  const noItemsWarning = (!data.items || data.items.length === 0)
    ? `<tr><td colspan="4" style="text-align:center; padding:12px 0; font-style:italic;">-- Sin artículos --</td></tr>`
    : '';

  const paymentsHTML = (data.payments || []).map(p => {
    const label = PAYMENT_LABELS[p.method] || p.method;
    const amt = typeof p.amount === 'string' ? parseFloat(p.amount) : (p.amount || 0);
    return `<tr><td colspan="3" style="text-align:right; padding:3px 0;">${escapeHtml(label)}:</td><td style="text-align:right; padding:3px 0;">${formatMoney(amt)}</td></tr>`;
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
      font-weight: bold;
      -webkit-font-smoothing: none;
      line-height: 1.3;
    }
    .header { text-align: center; margin-bottom: 16px; }
    .header .logo { max-width: ${maxLogo}; max-height: 120px; margin-bottom: 8px; display: block; margin-left: auto; margin-right: auto; }
    .header .store-name { font-size: ${storeNameSize}; font-weight: 900; letter-spacing: 1px; margin-bottom: 4px; }
    .header .store-info { font-size: ${storeInfoSize}; font-weight: bold; line-height: 1.4; }
    .divider { border-top: 3px dashed #000; margin: 12px 0; }
    .divider-double { border-top: 4px solid #000; margin: 12px 0; }
    .ticket-info { margin-bottom: 8px; }
    .info-row { display: flex; justify-content: space-between; font-size: ${infoRowSize}; font-weight: bold; padding: 3px 0; }
    table { width: 100%; border-collapse: collapse; font-size: ${tableSize}; }
    th { text-align: left; border-bottom: 3px solid #000; padding: 6px 0; font-weight: 900; font-size: ${tableSize}; }
    th:nth-child(3), th:nth-child(4) { text-align: right; }
    td { padding: 3px 0; vertical-align: top; font-weight: bold; }
    .totals td { font-size: ${totalsSize}; font-weight: bold; padding: 4px 0; }
    .total-row { font-weight: 900; }
    .total-row td { font-size: ${totalBigSize} !important; padding: 8px 0; }
    .payments { margin-top: 12px; font-size: ${totalsSize}; }
    .footer { text-align: center; margin-top: 20px; font-size: ${footerSize}; font-weight: bold; line-height: 1.4; }
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
  <div style="text-align:center; margin: 12px 0; padding: 10px 8px; border: 4px solid #000; font-weight: 900;">
    <div style="font-size: ${infoRowSize}; margin-bottom: 4px;">${escapeHtml(data.ecf.documentType)}</div>
    <div style="font-size: ${ticketNumSize}; letter-spacing: 1px;">e-NCF: ${escapeHtml(data.ecf.eNcf)}</div>
  </div>
  ` : data.ncfNumber ? `
  <div style="text-align:center; margin: 12px 0; padding: 8px; border: 4px solid #000; font-weight: 900; font-size: ${ticketNumSize};">
    COMPROBANTE FISCAL
  </div>
  ` : ''}
  <div class="ticket-info">
    <div style="font-size:${ticketNumSize}; padding:10px 0; border:4px solid #000; margin:8px 0; text-align:center; font-weight:900; letter-spacing:1px;">RECIBO #${escapeHtml(data.ticketNumber)}</div>
    ${data.isReprint ? `<div style="text-align:center; font-size:${infoRowSize}; font-weight:900; margin-top:8px; padding:4px 12px; border:3px dashed #000;">*** REIMPRESIÓN ***</div>` : ''}
  </div>
  <div class="divider-double"></div>
  <div class="info-row"><span>Fecha:</span><span>${escapeHtml(data.date)}</span></div>
  <div class="info-row"><span>Cajero:</span><span>${escapeHtml(data.cashierName)}</span></div>
  ${data.ecf ? `
  <div style="margin: 8px 0; padding: 8px; border: 2px solid #000;">
    <div class="info-row" style="font-weight:900"><span>e-NCF:</span><span>${escapeHtml(data.ecf.eNcf)}</span></div>
    ${data.customerName ? `<div class="info-row"><span>Cliente:</span><span>${escapeHtml(data.customerName)}</span></div>` : ''}
    ${data.customerRnc ? `<div class="info-row"><span>RNC/Cédula:</span><span>${escapeHtml(data.customerRnc)}</span></div>` : ''}
  </div>
  ` : data.ncfNumber ? `
  <div style="margin: 8px 0; padding: 8px; border: 2px solid #000;">
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
      ${noItemsWarning}
    </tbody>
  </table>
  <div class="divider"></div>
  <table class="totals">
    <tr><td colspan="3" style="text-align:right">Subtotal:</td><td style="text-align:right">${formatMoney(subtotal)}</td></tr>
    ${data.taxBreakdown ? `
    ${data.taxBreakdown.exempt > 0 ? `<tr><td colspan="3" style="text-align:right; font-size:${smallSize}; padding-left:16px;">Exento:</td><td style="text-align:right; font-size:${smallSize};">${formatMoney(data.taxBreakdown.exempt)}</td></tr>` : ''}
    ${data.taxBreakdown.itbis16 > 0 ? `<tr><td colspan="3" style="text-align:right; font-size:${smallSize}; padding-left:16px;">ITBIS 16%:</td><td style="text-align:right; font-size:${smallSize};">${formatMoney(data.taxBreakdown.itbis16)}</td></tr>` : ''}
    ${data.taxBreakdown.itbis18 > 0 ? `<tr><td colspan="3" style="text-align:right; font-size:${smallSize}; padding-left:16px;">ITBIS 18%:</td><td style="text-align:right; font-size:${smallSize};">${formatMoney(data.taxBreakdown.itbis18)}</td></tr>` : ''}
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
  <div style="text-align:center; margin: 20px 0; font-size: ${footerSize};">
    <div style="font-weight:900; margin-bottom: 10px;">Redes Sociales y Contacto</div>
    ${data.socialMedia.whatsapp ? `<div style="padding:2px 0;">WhatsApp: ${escapeHtml(data.socialMedia.whatsapp)}</div>` : ''}
    ${data.socialMedia.instagram ? `<div style="padding:2px 0;">Instagram: ${escapeHtml(data.socialMedia.instagram)}</div>` : ''}
    ${data.socialMedia.facebook ? `<div style="padding:2px 0;">Facebook: ${escapeHtml(data.socialMedia.facebook)}</div>` : ''}
    ${data.socialMedia.website ? `<div style="padding:2px 0;">Web: ${escapeHtml(data.socialMedia.website)}</div>` : ''}
  </div>
  ` : ''}
  ${data.googleReviewQr ? `
  <div style="text-align:center; margin: 20px 0;">
    <div style="font-size: ${footerSize}; font-weight:900; margin-bottom: 8px;">Déjanos una reseña</div>
    <img src="${data.googleReviewQr}" style="width: 140px; height: 140px; display: block; margin: 0 auto;" alt="Google Review QR" />
    <div style="font-size: ${smallSize}; margin-top: 4px;">Escanea para dejar tu reseña</div>
  </div>
  ` : ''}
  ${data.ecf ? `
  <div style="text-align:center; margin: 20px 0; padding: 12px 8px; border-top: 3px dashed #000;">
    <div style="font-size: ${footerSize}; font-weight:900; margin-bottom: 10px;">Verificación Fiscal DGII</div>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.ecf.verificationUrl)}" style="width: 160px; height: 160px; display: block; margin: 0 auto;" alt="QR Verificación DGII" />
    <div style="font-size: ${smallSize}; margin-top: 6px;">Código Seguridad: <strong>${escapeHtml(data.ecf.securityCode)}</strong></div>
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
