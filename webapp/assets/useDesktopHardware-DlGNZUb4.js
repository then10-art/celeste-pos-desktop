import{r as p}from"./index-BfnZSO7V.js";function f(e){return`RD$${(typeof e=="string"?parseFloat(e):e).toFixed(2)}`}const R={cash_dop:"Efectivo RD$",cash_usd:"Efectivo US$",card:"Tarjeta",transfer:"Transferencia",check:"Cheque",coupon:"Cupón/Bono",store_credit:"Crédito Tienda"};function T(e,t,o){const n=o==="58"?"58mm":"80mm",l=o==="58"?"2mm":"4mm",c=o==="58"?"45mm":"60mm",d=typeof e.subtotal=="string"?parseFloat(e.subtotal):e.subtotal,m=typeof e.taxAmount=="string"?parseFloat(e.taxAmount):e.taxAmount,u=typeof e.total=="string"?parseFloat(e.total):e.total,h=e.change?typeof e.change=="string"?parseFloat(e.change):e.change:0,x=e.items.map(a=>{const w=typeof a.quantity=="string"?parseFloat(a.quantity):a.quantity,y=typeof a.unitPrice=="string"?parseFloat(a.unitPrice):a.unitPrice,b=typeof a.total=="string"?parseFloat(a.total):a.total;return`<tr>
      <td style="text-align:left">${a.isWeighed?`${w.toFixed(3)}kg`:`${w}`}</td>
      <td style="text-align:left">${a.name}</td>
      <td style="text-align:right">${f(y)}</td>
      <td style="text-align:right">${f(b)}</td>
    </tr>`}).join(""),v=e.payments.map(a=>{const w=R[a.method]||a.method,y=typeof a.amount=="string"?parseFloat(a.amount):a.amount;return`<tr><td colspan="3" style="text-align:right">${w}:</td><td style="text-align:right">${f(y)}</td></tr>`}).join("");return`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recibo ${e.ticketNumber}</title>
  <style>
    @page { margin: 0; size: ${n} auto; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', 'Lucida Console', monospace;
      font-size: ${o==="58"?"12px":"13px"};
      font-weight: 600;
      width: ${n};
      max-width: ${n};
      padding: ${l};
      color: #000;
      margin: 0 auto;
      line-height: 1.3;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header { text-align: center; margin-bottom: 8px; }
    .header .logo { max-width: ${c}; max-height: 28mm; margin-bottom: 6px; display: block; margin-left: auto; margin-right: auto; }
    .header .store-name { font-size: 20px; font-weight: 900; letter-spacing: 0.5px; }
    .header .store-info { font-size: 11px; line-height: 1.4; font-weight: 600; }
    .divider { border-top: 1.5px dashed #000; margin: 6px 0; }
    .divider-double { border-top: 2.5px solid #000; margin: 6px 0; }
    .ticket-info { margin-bottom: 4px; }
    .ticket-info .ticket-num { text-align: center; font-weight: 900; font-size: 15px; }
    .info-row { display: flex; justify-content: space-between; font-size: 12px; word-break: break-word; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; font-weight: 600; }
    th { text-align: left; border-bottom: 1.5px solid #000; padding: 2px 0; font-weight: 900; }
    th:nth-child(3), th:nth-child(4) { text-align: right; }
    td { padding: 2px 0; vertical-align: top; word-break: break-word; }
    .totals td { font-size: 13px; font-weight: 700; }
    .total-row { font-weight: 900; font-size: 17px; }
    .payments { margin-top: 6px; }
    .footer { text-align: center; margin-top: 10px; font-size: 11px; font-weight: 600; }
    @media print {
      body { width: ${n}; margin: 0; padding: ${l}; -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff !important; }
      @page { margin: 0; size: ${n} auto; }
      * { color: #000 !important; background-color: transparent !important; border-color: #000 !important; }
      img { filter: grayscale(100%) contrast(1.2); }
    }
  </style>
</head>
<body>
  <div class="header" style="width: 100%; text-align: center;">
    ${t?`<img src="${t}" class="logo" alt="Logo" crossorigin="anonymous" style="max-width:${c};max-height:28mm;display:block;margin:0 auto 6px;" onerror="this.style.display='none'" />`:""}
    <div class="store-name" style="text-align: center;">${e.storeName}</div>
    <div class="store-info" style="text-align: center;">
      ${e.storeAddress?`${e.storeAddress}<br>`:""}
      ${e.storePhone?`Tel: ${e.storePhone}<br>`:""}
      ${e.storeRnc?`RNC: ${e.storeRnc}`:""}
    </div>
  </div>

  <div class="divider-double"></div>

  ${e.ecf?`
  <div style="text-align:center; margin: 6px 0; padding: 6px 4px; border: 2px solid #000; font-weight: bold;">
    <div style="font-size: 12px; margin-bottom: 2px;">${e.ecf.documentType}</div>
    <div style="font-size: 14px; letter-spacing: 0.5px;">e-NCF: ${e.ecf.eNcf}</div>
  </div>
  `:e.ncfNumber?`
  <div style="text-align:center; margin: 6px 0; padding: 4px; border: 2px solid #000; font-weight: bold; font-size: 14px;">
    COMPROBANTE FISCAL
  </div>
  `:""}

  <div class="ticket-info">
    <div class="ticket-num" style="font-size:16px; padding:6px 0; border:2px solid #000; margin:4px 0; text-align:center; font-weight:bold; letter-spacing:1px;">RECIBO #${e.ticketNumber}</div>
    ${e.isReprint?'<div style="text-align:center; font-size:12px; font-weight:bold; color:#000; margin-top:4px; padding:2px 8px; border:1px dashed #000; display:inline-block;">*** REIMPRESIÓN ***</div>':""}
  </div>

  ${e.isVoided?`<div style="text-align:center; margin:8px 0; padding:8px 4px; border:3px solid #000; font-weight:900; font-size:20px; letter-spacing:3px;">*** ANULADA ***</div>${e.voidReason?`<div style="text-align:center; font-size:11px; margin-bottom:4px;">Razón: ${e.voidReason}</div>`:""}`:""}
  ${e.isPending?'<div style="text-align:center; margin:8px 0; padding:6px 4px; border:2px dashed #000; font-weight:900; font-size:16px; letter-spacing:2px;">*** PENDIENTE / EN ESPERA ***</div>':""}

  <div class="divider-double"></div>

  <div class="info-row"><span>Fecha:</span><span>${e.date}</span></div>
  <div class="info-row"><span>Cajero:</span><span>${e.cashierName}</span></div>
  ${e.ecf?`
  <div style="margin: 4px 0; padding: 4px; border: 1px solid #000;">
    <div class="info-row" style="font-weight:bold"><span>e-NCF:</span><span>${e.ecf.eNcf}</span></div>
    ${e.customerName?`<div class="info-row"><span>Cliente:</span><span>${e.customerName}</span></div>`:""}
    ${e.customerRnc?`<div class="info-row"><span>RNC/Cédula:</span><span>${e.customerRnc}</span></div>`:""}
  </div>
  `:e.ncfNumber?`
  <div style="margin: 4px 0; padding: 4px; border: 1px solid #000;">
    <div class="info-row" style="font-weight:bold"><span>NCF:</span><span>${e.ncfNumber}</span></div>
    ${e.customerName?`<div class="info-row"><span>Cliente:</span><span>${e.customerName}</span></div>`:""}
    ${e.customerRnc?`<div class="info-row"><span>RNC/Cédula:</span><span>${e.customerRnc}</span></div>`:""}
  </div>
  `:`
  ${e.customerName?`<div class="info-row"><span>Cliente:</span><span>${e.customerName}</span></div>`:""}
  ${e.customerRnc?`<div class="info-row"><span>RNC/Cédula:</span><span>${e.customerRnc}</span></div>`:""}
  `}

  <div class="divider"></div>

  <table>
    <thead>
      <tr><th>Cant</th><th>Descripción</th><th>Precio</th><th>Total</th></tr>
    </thead>
    <tbody>
      ${x}
    </tbody>
  </table>

  <div class="divider"></div>

  <table class="totals">
    <tr><td colspan="3" style="text-align:right">Subtotal:</td><td style="text-align:right">${f(d)}</td></tr>
    ${e.taxBreakdown?`
    ${e.taxBreakdown.exempt>0?`<tr><td colspan="3" style="text-align:right; font-size:11px; color:#000; padding-left:12px;">Exento:</td><td style="text-align:right; font-size:11px; color:#000;">${f(e.taxBreakdown.exempt)}</td></tr>`:""}
    ${e.taxBreakdown.itbis16>0?`<tr><td colspan="3" style="text-align:right; font-size:11px; color:#000; padding-left:12px;">ITBIS 16%:</td><td style="text-align:right; font-size:11px; color:#000;">${f(e.taxBreakdown.itbis16)}</td></tr>`:""}
    ${e.taxBreakdown.itbis18>0?`<tr><td colspan="3" style="text-align:right; font-size:11px; color:#000; padding-left:12px;">ITBIS 18%:</td><td style="text-align:right; font-size:11px; color:#000;">${f(e.taxBreakdown.itbis18)}</td></tr>`:""}
    <tr><td colspan="3" style="text-align:right; font-weight:bold;">Total ITBIS:</td><td style="text-align:right; font-weight:bold;">${f(m)}</td></tr>
    `:`
    <tr><td colspan="3" style="text-align:right">ITBIS:</td><td style="text-align:right">${f(m)}</td></tr>
    `}
    <tr class="total-row"><td colspan="3" style="text-align:right">TOTAL:</td><td style="text-align:right">${f(u)}</td></tr>
  </table>

  <div class="divider-double"></div>

  <table class="payments">
    ${v}
    ${h>0?`<tr style="font-weight:bold"><td colspan="3" style="text-align:right">CAMBIO:</td><td style="text-align:right">${f(h)}</td></tr>`:""}
  </table>

  <div class="divider"></div>

  ${e.socialMedia?`
  <div style="text-align:center; margin: 10px 0; font-size: 11px;">
    <div style="font-weight:bold; margin-bottom: 6px;">Redes Sociales y Contacto</div>
    ${e.socialMedia.whatsapp?`<div>WhatsApp: ${e.socialMedia.whatsapp}</div>`:""}
    ${e.socialMedia.instagram?`<div>Instagram: ${e.socialMedia.instagram}</div>`:""}
    ${e.socialMedia.facebook?`<div>Facebook: ${e.socialMedia.facebook}</div>`:""}
    ${e.socialMedia.website?`<div>Web: ${e.socialMedia.website}</div>`:""}
  </div>
  `:""}

  ${e.googleReviewQr?`
  <div style="text-align:center; margin: 10px 0;">
    <div style="font-size: 10px; font-weight:bold; margin-bottom: 4px;">Dejanos una resena</div>
    <img src="${e.googleReviewQr}" style="width: 60px; height: 60px; display: block; margin: 0 auto;" alt="Google Review QR" />
    <div style="font-size: 9px; margin-top: 2px;">Escanea para dejar tu reseña</div>
  </div>
  `:""}

  ${e.ecf?`
  <div style="text-align:center; margin: 10px 0; padding: 8px 4px; border-top: 1px dashed #000;">
    <div style="font-size: 10px; font-weight:bold; margin-bottom: 6px;">Verificación Fiscal DGII</div>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(e.ecf.verificationUrl)}" style="width: 80px; height: 80px; display: block; margin: 0 auto;" alt="QR Verificación DGII" />
    <div style="font-size: 9px; margin-top: 4px;">Código Seguridad: <strong>${e.ecf.securityCode}</strong></div>
    <div style="font-size: 9px;">Firma Digital: ${e.ecf.signatureDate}</div>
  </div>
  `:""}

  <div class="footer">
    <p>${e.footerMessage||"¡Gracias por su compra!"}</p>
    <p>Conserve este recibo para cualquier<br>reclamación o devolución.</p>
  </div>
</body>
</html>`}function D(e){const t=document.getElementById("root");t&&(t.style.display="none");const o=document.createElement("div");o.id="receipt-print-overlay",o.style.cssText="position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;background:#fff;overflow:auto;",o.innerHTML=e;const n=document.createElement("button");n.textContent="✕ Cerrar",n.className="no-print",n.style.cssText="position:fixed;top:10px;right:10px;z-index:100000;padding:12px 24px;background:#333;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;";const l=()=>{try{o.remove()}catch{}try{n.remove()}catch{}t&&(t.style.display="")};n.onclick=l,n.ontouchend=d=>{d.preventDefault(),l()},document.body.appendChild(o),document.body.appendChild(n);const c=document.createElement("style");c.id="receipt-overlay-print-style",c.textContent=`
    @media print {
      #root, .no-print { display: none !important; }
      #receipt-print-overlay { position: static !important; }
    }
  `,document.head.appendChild(c),setTimeout(()=>{window.print(),setTimeout(()=>{l();try{c.remove()}catch{}},500)},300)}function N(e){var t;try{const o=document.createElement("iframe");o.id="receipt-print-iframe-"+Date.now(),o.style.cssText="position:fixed;top:0;left:0;width:0;height:0;border:none;visibility:hidden;",document.body.appendChild(o);const n=o.contentDocument||((t=o.contentWindow)==null?void 0:t.document);if(!n)return o.remove(),!1;n.open(),n.write(e),n.close();const l=()=>{setTimeout(()=>{var d,m;try{(d=o.contentWindow)==null||d.focus(),(m=o.contentWindow)==null||m.print()}catch{D(e)}setTimeout(()=>{try{o.remove()}catch{}},1500)},350)},c=n.querySelectorAll("img");if(c.length>0){let d=0;const m=()=>{d++,d>=c.length&&l()};c.forEach(u=>{u.complete?d++:(u.onload=m,u.onerror=m)}),d>=c.length&&l(),setTimeout(l,2e3)}else l();return!0}catch{return!1}}function z(e,t){const o=t==="58"?"58mm":"80mm",n=`
    <style>
      @page { margin: 0; size: ${o} auto; }
      @media print {
        html, body {
          width: ${o} !important;
          max-width: ${o} !important;
          margin: 0 !important;
          padding: ${t==="58"?"2mm":"4mm"} !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          font-weight: 600 !important;
        }
        * { color: #000 !important; }
        @page { margin: 0; size: ${o} auto; }
      }
    </style>
  `,l=e.replace("</head>",n+"</head>");N(l)||D(l)}function S(){var k;const e=typeof window<"u"&&!!((k=window.CelesteDesktop)!=null&&k.isDesktop),[t,o]=p.useState(e),n=p.useRef(e);p.useEffect(()=>{n.current=t},[t]),p.useEffect(()=>{if(t)return;let i=0;const s=20,g=setInterval(()=>{var r;i++,typeof window<"u"&&((r=window.CelesteDesktop)!=null&&r.isDesktop)?(o(!0),clearInterval(g),console.log(`[Desktop] CelesteDesktop bridge detected after ${i*200}ms`)):i>=s&&(clearInterval(g),typeof window<"u"&&window.__CELESTE_DESKTOP__&&console.log("[Desktop] __CELESTE_DESKTOP__ flag found but CelesteDesktop bridge missing"))},200);return()=>clearInterval(g)},[]);const[l,c]=p.useState(!1),[d,m]=p.useState(null),[u,h]=p.useState(0),x=p.useCallback(async()=>{var i,s;if(t)try{const g=await((s=(i=window.CelesteDesktop)==null?void 0:i.getPrinterStatus)==null?void 0:s.call(i));g&&(c(g.connected),m(g.name??null))}catch{c(!1)}},[t]);p.useEffect(()=>{var g;if(!t)return;const i=async()=>{var r,C;try{const E=await((C=(r=window.CelesteDesktop)==null?void 0:r.getQueuedCount)==null?void 0:C.call(r))??0;h(E)}catch{h(0)}};x(),i();const s=setInterval(()=>{x(),i()},3e4);return(g=window.CelesteDesktop)!=null&&g.onSyncComplete&&window.CelesteDesktop.onSyncComplete(r=>{r.synced>0&&h(Math.max(0,r.queued-r.synced))}),()=>clearInterval(s)},[t,x]);const v=p.useCallback(async(i,s="80")=>{if(n.current&&!!window.CelesteDesktop&&window.CelesteDesktop)try{const r=await window.CelesteDesktop.printReceipt(i,s);if(!r.success)throw console.error("[Desktop] Printer error:",r.error),new Error(r.error||"Error de impresora")}catch(r){throw console.error("[Desktop] printReceipt failed:",r),new Error((r==null?void 0:r.message)||"No se pudo imprimir. Verifique la impresora.")}else{const r=T(i,void 0,s);z(r,s)}},[]),a=p.useCallback(async()=>{if(t&&window.CelesteDesktop)try{const i=await window.CelesteDesktop.openCashDrawer();i.success||console.warn("[Desktop] Cash drawer error:",i.error)}catch(i){console.warn("[Desktop] openCashDrawer IPC failed:",i)}else console.info("[Browser] Cash drawer not available in browser mode.")},[t]),w=p.useCallback(async()=>{var i;if(!t||!((i=window.CelesteDesktop)!=null&&i.getAvailablePrinters))return[];try{return await window.CelesteDesktop.getAvailablePrinters()}catch(s){return console.warn("[Desktop] getAvailablePrinters failed:",s),[]}},[t]),y=p.useCallback(async i=>{var s;if(!t||!((s=window.CelesteDesktop)!=null&&s.savePrinterConfig))return!1;try{return await window.CelesteDesktop.savePrinterConfig(i),await x(),!0}catch(g){return console.warn("[Desktop] savePrinterConfig failed:",g),!1}},[t,x]),b=p.useCallback(async()=>{var i;if(!t||!((i=window.CelesteDesktop)!=null&&i.getLabelPrinter))return"";try{return await window.CelesteDesktop.getLabelPrinter()}catch(s){return console.warn("[Desktop] getLabelPrinter failed:",s),""}},[t]),$=p.useCallback(async i=>{var s;if(!t||!((s=window.CelesteDesktop)!=null&&s.saveLabelPrinter))return!1;try{return await window.CelesteDesktop.saveLabelPrinter(i)}catch(g){return console.warn("[Desktop] saveLabelPrinter failed:",g),!1}},[t]),P=p.useCallback(async()=>{await x()},[x]);return{isDesktop:t,printerConnected:l,printerName:d,offlineQueueCount:u,printReceipt:v,openCashDrawer:a,getAvailablePrinters:w,savePrinterConfig:y,getLabelPrinter:b,saveLabelPrinter:$,refreshPrinterStatus:P}}export{T as g,S as u};
