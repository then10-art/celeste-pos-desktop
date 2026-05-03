function l(t){return`RD$${(typeof t=="string"?parseFloat(t):t).toFixed(2)}`}const $={cash_dop:"Efectivo RD$",cash_usd:"Efectivo US$",card:"Tarjeta",transfer:"Transferencia",check:"Cheque",coupon:"Cupón/Bono",store_credit:"Crédito Tienda"};function w(t,a,n){const s=n==="58"?"58mm":"80mm",d=n==="58"?"2mm":"4mm",c=n==="58"?"40mm":"50mm",o=n==="58"?"11px":"12px",u=typeof t.subtotal=="string"?parseFloat(t.subtotal):t.subtotal,m=typeof t.taxAmount=="string"?parseFloat(t.taxAmount):t.taxAmount,h=typeof t.total=="string"?parseFloat(t.total):t.total,y=t.change?typeof t.change=="string"?parseFloat(t.change):t.change:0,i=t.items.map(e=>{const p=typeof e.quantity=="string"?parseFloat(e.quantity):e.quantity,g=typeof e.unitPrice=="string"?parseFloat(e.unitPrice):e.unitPrice,f=typeof e.total=="string"?parseFloat(e.total):e.total;return`<tr>
      <td style="text-align:left">${e.isWeighed?`${p.toFixed(3)}kg`:`${p}`}</td>
      <td style="text-align:left">${e.name}</td>
      <td style="text-align:right">${l(g)}</td>
      <td style="text-align:right">${l(f)}</td>
    </tr>`}).join(""),r=t.payments.map(e=>{const p=$[e.method]||e.method,g=typeof e.amount=="string"?parseFloat(e.amount):e.amount;return`<tr><td colspan="3" style="text-align:right">${p}:</td><td style="text-align:right">${l(g)}</td></tr>`}).join("");return`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recibo ${t.ticketNumber}</title>
  <style>
    @page { margin: 0; size: ${s} auto; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      font-size: ${o};
      width: ${s};
      padding: ${d};
      color: #000;
    }
    .header { text-align: center; margin-bottom: 8px; }
    .header .logo { max-width: ${c}; max-height: 20mm; margin-bottom: 4px; display: block; margin-left: auto; margin-right: auto; }
    .header .store-name { font-size: 18px; font-weight: bold; }
    .header .store-info { font-size: 10px; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .divider-double { border-top: 2px solid #000; margin: 6px 0; }
    .ticket-info { margin-bottom: 4px; }
    .ticket-info .ticket-num { text-align: center; font-weight: bold; font-size: 14px; }
    .info-row { display: flex; justify-content: space-between; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { text-align: left; border-bottom: 1px solid #000; padding: 2px 0; }
    th:nth-child(3), th:nth-child(4) { text-align: right; }
    td { padding: 1px 0; vertical-align: top; }
    .totals td { font-size: 12px; }
    .total-row { font-weight: bold; font-size: 16px; }
    .payments { margin-top: 6px; }
    .footer { text-align: center; margin-top: 10px; font-size: 10px; }
    @media print {
      body { width: ${s}; }
    }
  </style>
</head>
<body>
  <div class="header">
    ${a?`<img src="${a}" class="logo" alt="Logo" crossorigin="anonymous" style="max-width:${c};max-height:20mm;display:block;margin:0 auto 4px;" onerror="this.style.display='none'" />`:""}
    <div class="store-name">${t.storeName}</div>
    <div class="store-info">
      ${t.storeAddress?`${t.storeAddress}<br>`:""}
      ${t.storePhone?`Tel: ${t.storePhone}<br>`:""}
      ${t.storeRnc?`RNC: ${t.storeRnc}`:""}
    </div>
  </div>

  <div class="divider-double"></div>

  ${t.ecf?`
  <div style="text-align:center; margin: 6px 0; padding: 6px 4px; border: 2px solid #000; font-weight: bold;">
    <div style="font-size: 12px; margin-bottom: 2px;">${t.ecf.documentType}</div>
    <div style="font-size: 14px; letter-spacing: 0.5px;">e-NCF: ${t.ecf.eNcf}</div>
  </div>
  `:t.ncfNumber?`
  <div style="text-align:center; margin: 6px 0; padding: 4px; border: 2px solid #000; font-weight: bold; font-size: 14px;">
    COMPROBANTE FISCAL
  </div>
  `:""}

  <div class="ticket-info">
    <div class="ticket-num" style="font-size:16px; padding:6px 0; border:2px solid #000; margin:4px 0; text-align:center; font-weight:bold; letter-spacing:1px;">RECIBO #${t.ticketNumber}</div>
    ${t.isReprint?'<div style="text-align:center; font-size:12px; font-weight:bold; color:#d32f2f; margin-top:4px; padding:2px 8px; border:1px dashed #d32f2f; display:inline-block;">*** REIMPRESIÓN ***</div>':""}
  </div>

  <div class="divider-double"></div>

  <div class="info-row"><span>Fecha:</span><span>${t.date}</span></div>
  <div class="info-row"><span>Cajero:</span><span>${t.cashierName}</span></div>
  ${t.ecf?`
  <div style="margin: 4px 0; padding: 4px; background: #f0f0f0;">
    <div class="info-row" style="font-weight:bold"><span>e-NCF:</span><span>${t.ecf.eNcf}</span></div>
    ${t.customerName?`<div class="info-row"><span>Cliente:</span><span>${t.customerName}</span></div>`:""}
    ${t.customerRnc?`<div class="info-row"><span>RNC/Cédula:</span><span>${t.customerRnc}</span></div>`:""}
  </div>
  `:t.ncfNumber?`
  <div style="margin: 4px 0; padding: 4px; background: #f0f0f0;">
    <div class="info-row" style="font-weight:bold"><span>NCF:</span><span>${t.ncfNumber}</span></div>
    ${t.customerName?`<div class="info-row"><span>Cliente:</span><span>${t.customerName}</span></div>`:""}
    ${t.customerRnc?`<div class="info-row"><span>RNC/Cédula:</span><span>${t.customerRnc}</span></div>`:""}
  </div>
  `:`
  ${t.customerName?`<div class="info-row"><span>Cliente:</span><span>${t.customerName}</span></div>`:""}
  ${t.customerRnc?`<div class="info-row"><span>RNC/Cédula:</span><span>${t.customerRnc}</span></div>`:""}
  `}

  <div class="divider"></div>

  <table>
    <thead>
      <tr><th>Cant</th><th>Descripción</th><th>Precio</th><th>Total</th></tr>
    </thead>
    <tbody>
      ${i}
    </tbody>
  </table>

  <div class="divider"></div>

  <table class="totals">
    <tr><td colspan="3" style="text-align:right">Subtotal:</td><td style="text-align:right">${l(u)}</td></tr>
    ${t.taxBreakdown?`
    ${t.taxBreakdown.exempt>0?`<tr><td colspan="3" style="text-align:right; font-size:10px; color:#555; padding-left:12px;">Exento:</td><td style="text-align:right; font-size:10px; color:#555;">${l(t.taxBreakdown.exempt)}</td></tr>`:""}
    ${t.taxBreakdown.itbis16>0?`<tr><td colspan="3" style="text-align:right; font-size:10px; color:#555; padding-left:12px;">ITBIS 16%:</td><td style="text-align:right; font-size:10px; color:#555;">${l(t.taxBreakdown.itbis16)}</td></tr>`:""}
    ${t.taxBreakdown.itbis18>0?`<tr><td colspan="3" style="text-align:right; font-size:10px; color:#555; padding-left:12px;">ITBIS 18%:</td><td style="text-align:right; font-size:10px; color:#555;">${l(t.taxBreakdown.itbis18)}</td></tr>`:""}
    <tr><td colspan="3" style="text-align:right; font-weight:bold;">Total ITBIS:</td><td style="text-align:right; font-weight:bold;">${l(m)}</td></tr>
    `:`
    <tr><td colspan="3" style="text-align:right">ITBIS:</td><td style="text-align:right">${l(m)}</td></tr>
    `}
    <tr class="total-row"><td colspan="3" style="text-align:right">TOTAL:</td><td style="text-align:right">${l(h)}</td></tr>
  </table>

  <div class="divider-double"></div>

  <table class="payments">
    ${r}
    ${y>0?`<tr style="font-weight:bold"><td colspan="3" style="text-align:right">CAMBIO:</td><td style="text-align:right">${l(y)}</td></tr>`:""}
  </table>

  <div class="divider"></div>

  ${t.socialMedia?`
  <div style="text-align:center; margin: 10px 0; font-size: 11px;">
    <div style="font-weight:bold; margin-bottom: 6px;">Redes Sociales y Contacto</div>
    ${t.socialMedia.whatsapp?`<div>📱 WhatsApp: ${t.socialMedia.whatsapp}</div>`:""}
    ${t.socialMedia.instagram?`<div>📷 Instagram: ${t.socialMedia.instagram}</div>`:""}
    ${t.socialMedia.facebook?`<div>👍 Facebook: ${t.socialMedia.facebook}</div>`:""}
    ${t.socialMedia.website?`<div>🌐 Web: ${t.socialMedia.website}</div>`:""}
  </div>
  `:""}

  ${t.googleReviewQr?`
  <div style="text-align:center; margin: 10px 0;">
    <div style="font-size: 10px; font-weight:bold; margin-bottom: 4px;">⭐ Déjanos una reseña</div>
    <img src="${t.googleReviewQr}" style="width: 60px; height: 60px; display: block; margin: 0 auto;" alt="Google Review QR" />
    <div style="font-size: 9px; margin-top: 2px;">Escanea para dejar tu reseña</div>
  </div>
  `:""}

  ${t.ecf?`
  <div style="text-align:center; margin: 10px 0; padding: 8px 4px; border-top: 1px dashed #000;">
    <div style="font-size: 10px; font-weight:bold; margin-bottom: 6px;">Verificación Fiscal DGII</div>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(t.ecf.verificationUrl)}" style="width: 80px; height: 80px; display: block; margin: 0 auto;" alt="QR Verificación DGII" />
    <div style="font-size: 9px; margin-top: 4px;">Código Seguridad: <strong>${t.ecf.securityCode}</strong></div>
    <div style="font-size: 9px;">Firma Digital: ${t.ecf.signatureDate}</div>
  </div>
  `:""}

  <div class="footer">
    <p>${t.footerMessage||"¡Gracias por su compra!"}</p>
    <p>Conserve este recibo para cualquier<br>reclamación o devolución.</p>
  </div>
</body>
</html>`}function v(t){const a=document.getElementById("root");a&&(a.style.display="none");const n=document.createElement("div");n.id="receipt-print-overlay",n.style.cssText="position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;background:#fff;overflow:auto;",n.innerHTML=t;const s=document.createElement("button");s.textContent="✕ Cerrar",s.className="no-print",s.style.cssText="position:fixed;top:10px;right:10px;z-index:100000;padding:12px 24px;background:#333;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;";const d=()=>{try{n.remove()}catch{}try{s.remove()}catch{}a&&(a.style.display="")};s.onclick=d,s.ontouchend=o=>{o.preventDefault(),d()},document.body.appendChild(n),document.body.appendChild(s);const c=document.createElement("style");c.id="receipt-overlay-print-style",c.textContent=`
    @media print {
      #root, .no-print { display: none !important; }
      #receipt-print-overlay { position: static !important; }
    }
  `,document.head.appendChild(c),setTimeout(()=>{window.print(),setTimeout(()=>{d();try{c.remove()}catch{}},500)},300)}function C(t,a){var y;const n=a==="58"?"58mm":"80mm",s=`
    <style>
      @page { margin: 0; size: ${n} auto; }
      @media print {
        html, body {
          width: ${n} !important;
          max-width: ${n} !important;
          margin: 0 !important;
          padding: ${a==="58"?"2mm":"4mm"} !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        /* Hide any browser-injected headers/footers */
        @page { margin: 0; }
      }
    </style>
  `,d=t.replace("</head>",s+"</head>"),c=window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===!0,o=window.open("","_blank","width=320,height=600");if(!o){const i=document.createElement("iframe");i.id="receipt-print-iframe",i.style.cssText="position:fixed;top:0;left:0;width:0;height:0;border:none;visibility:hidden;",document.body.appendChild(i);const r=i.contentDocument||((y=i.contentWindow)==null?void 0:y.document);if(r){r.open(),r.write(d),r.close();const e=r.querySelectorAll("img");let p=0;const g=()=>{setTimeout(()=>{var f,x;try{(f=i.contentWindow)==null||f.focus(),(x=i.contentWindow)==null||x.print()}catch{v(d)}setTimeout(()=>{try{i.remove()}catch{}},1e3)},300)};if(e.length>0){const f=()=>{p++,p>=e.length&&g()};e.forEach(x=>{x.complete?p++:(x.onload=f,x.onerror=f)}),p>=e.length&&g(),setTimeout(g,2e3)}else g()}else i.remove(),v(d);return}o.document.write(d),o.document.close();let u=!1;const m=()=>{u||(u=!0,setTimeout(()=>{o.focus(),o.print(),setTimeout(()=>{try{o.close()}catch{}},c?500:1e3),c&&setTimeout(()=>{try{o.closed||o.close()}catch{}},3e3)},400))};try{o.addEventListener("afterprint",()=>{setTimeout(()=>{try{o.close()}catch{}},200)})}catch{}const h=o.document.querySelectorAll("img");if(h.length>0){let i=0;const r=()=>{i++,i>=h.length&&m()};h.forEach(e=>{e.complete?i++:(e.onload=r,e.onerror=r)}),i>=h.length&&m(),setTimeout(m,2e3)}else m()}export{w as g,C as p};
