(function () {
  'use strict';

  const money = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
  const state = {
    desktop: null,
    bootstrap: null,
    cart: [],
    lastReceipt: null,
  };

  const $ = (id) => document.getElementById(id);
  const round = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

  async function waitForBridge() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (window.CelesteDesktop?.getOfflineBootstrap) return window.CelesteDesktop;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('No se pudo iniciar el motor local de Celeste POS.');
  }

  function showError(element, message) {
    element.textContent = message || '';
  }

  function showToast(message) {
    const toast = $('successToast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.hidden = true; }, 5000);
  }

  function lineValues(item) {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.product.price) || 0;
    const rate = Number(item.product.taxRate) || 0;
    const base = round(unitPrice * quantity);
    let taxAmount = 0;
    let lineTotal = base;
    if (rate > 0 && item.product.taxIncluded !== false) {
      taxAmount = round(base - (base / (1 + rate)));
    } else if (rate > 0) {
      taxAmount = round(base * rate);
      lineTotal = round(base + taxAmount);
    }
    return { unitPrice, taxAmount, lineTotal, subtotal: round(lineTotal - taxAmount) };
  }

  function totals() {
    return state.cart.reduce((result, item) => {
      const line = lineValues(item);
      result.subtotal += line.subtotal;
      result.tax += line.taxAmount;
      result.total += line.lineTotal;
      return result;
    }, { subtotal: 0, tax: 0, total: 0 });
  }

  function renderTotals() {
    const current = totals();
    $('subtotalValue').textContent = money.format(round(current.subtotal));
    $('taxValue').textContent = money.format(round(current.tax));
    $('totalValue').textContent = money.format(round(current.total));
    if (!$('amountTendered').value && current.total > 0) {
      $('amountTendered').value = round(current.total).toFixed(2);
    }
    const tendered = Number($('amountTendered').value) || 0;
    $('changeValue').textContent = money.format(Math.max(0, round(tendered - current.total)));
  }

  function renderCart() {
    const container = $('cartItems');
    container.replaceChildren();
    $('cartEmpty').hidden = state.cart.length > 0;
    for (const item of state.cart) {
      const line = lineValues(item);
      const row = document.createElement('div');
      row.className = 'cart-row';

      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'product-name';
      name.textContent = item.product.name;
      const meta = document.createElement('div');
      meta.className = 'product-meta';
      meta.textContent = `${money.format(line.unitPrice)} · ${money.format(line.lineTotal)}`;
      info.append(name, meta);

      const actions = document.createElement('div');
      actions.className = 'cart-actions';
      const minus = document.createElement('button');
      minus.className = 'qty-button';
      minus.type = 'button';
      minus.textContent = '−';
      minus.addEventListener('click', () => changeQuantity(item.product.id, -1));
      const qty = document.createElement('span');
      qty.className = 'qty';
      qty.textContent = String(item.quantity);
      const plus = document.createElement('button');
      plus.className = 'qty-button';
      plus.type = 'button';
      plus.textContent = '+';
      plus.addEventListener('click', () => changeQuantity(item.product.id, 1));
      const remove = document.createElement('button');
      remove.className = 'remove-button';
      remove.type = 'button';
      remove.title = 'Eliminar';
      remove.textContent = '×';
      remove.addEventListener('click', () => removeProduct(item.product.id));
      actions.append(minus, qty, plus, remove);
      row.append(info, actions);
      container.append(row);
    }
    renderTotals();
  }

  function addProduct(product) {
    const existing = state.cart.find(item => item.product.id === product.id);
    if (existing) existing.quantity = round(existing.quantity + 1);
    else state.cart.push({ product, quantity: 1 });
    renderCart();
    $('searchInput').select();
  }

  function changeQuantity(productId, delta) {
    const item = state.cart.find(entry => entry.product.id === productId);
    if (!item) return;
    item.quantity = round(item.quantity + delta);
    if (item.quantity <= 0) removeProduct(productId);
    else renderCart();
  }

  function removeProduct(productId) {
    state.cart = state.cart.filter(item => item.product.id !== productId);
    renderCart();
  }

  function renderProducts(products) {
    const container = $('searchResults');
    container.replaceChildren();
    $('catalogMessage').hidden = products.length > 0;
    if (!products.length) $('catalogMessage').textContent = 'No se encontraron productos en la caché local.';

    for (const product of products) {
      const row = document.createElement('div');
      row.className = 'product-row';
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'product-name';
      name.textContent = product.name;
      const meta = document.createElement('div');
      meta.className = 'product-meta';
      meta.textContent = `${product.barcode || 'Sin código'} · Existencia al sincronizar: ${product.stock}`;
      info.append(name, meta);
      const price = document.createElement('div');
      price.className = 'price';
      price.textContent = money.format(product.price);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'add-button';
      add.textContent = '+';
      add.title = 'Agregar';
      add.addEventListener('click', () => addProduct(product));
      row.addEventListener('dblclick', () => addProduct(product));
      row.append(info, price, add);
      container.append(row);
    }
  }

  async function searchProducts(query) {
    const normalized = String(query || '').trim();
    if (!normalized) return;
    $('catalogMessage').hidden = false;
    $('catalogMessage').textContent = 'Buscando…';
    const exact = await state.desktop.lookupOfflineProduct(normalized);
    if (exact) {
      addProduct(exact);
      renderProducts([exact]);
      return;
    }
    const products = await state.desktop.searchOfflineProducts(normalized, 40);
    renderProducts(Array.isArray(products) ? products : []);
  }

  function makeTempId() {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `offline-${state.bootstrap.machineId}-${random}`;
  }

  function makeOfflineTicket() {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const machine = String(state.bootstrap.machineId || 'local').replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase();
    return `OFF-${machine}-${stamp}`;
  }

  async function completeSale() {
    showError($('saleError'), '');
    const cashierName = $('cashierName').value.trim();
    if (!cashierName) return showError($('saleError'), 'Ingrese el nombre del cajero.');
    if (!state.cart.length) return showError($('saleError'), 'Agregue al menos un producto.');

    const current = totals();
    const amount = Number($('amountTendered').value) || 0;
    if (amount + 0.009 < current.total) return showError($('saleError'), 'El monto recibido es menor que el total.');

    const method = $('paymentMethod').value;
    const change = method === 'cash_dop' ? Math.max(0, round(amount - current.total)) : 0;
    const tempId = makeTempId();
    const offlineTicket = makeOfflineTicket();
    const createdAt = new Date().toISOString();
    const items = state.cart.map(item => {
      const line = lineValues(item);
      return {
        productId: item.product.id,
        productName: item.product.name,
        barcode: item.product.barcode || '',
        quantity: item.quantity,
        unitPrice: line.unitPrice,
        originalPrice: line.unitPrice,
        discount: 0,
        taxRate: item.product.taxRate || 0,
        taxAmount: line.taxAmount,
        taxIncluded: item.product.taxIncluded !== false,
        lineTotal: line.lineTotal,
        isWeighed: item.product.sellBy === 'weight',
      };
    });

    const result = await state.desktop.queueOfflineSale({
      tempId,
      offlineTicket,
      cashierName,
      items,
      payments: [{
        method,
        amount,
        change,
        reference: $('paymentReference').value.trim() || undefined,
      }],
      subtotal: round(current.subtotal),
      taxAmount: round(current.tax),
      discountAmount: 0,
      total: round(current.total),
      createdAt,
    });

    if (!result?.success) {
      return showError($('saleError'), `No se pudo guardar la venta local: ${result?.error || 'error desconocido'}`);
    }

    localStorage.setItem('celesteOfflineCashier', cashierName);
    const receipt = {
      storeName: state.bootstrap.tenantName,
      ticketNumber: offlineTicket,
      date: new Date(createdAt).toLocaleString('es-DO'),
      cashierName,
      items: items.map(item => ({
        name: item.productName,
        quantity: String(item.quantity),
        unitPrice: item.unitPrice.toFixed(2),
        total: item.lineTotal.toFixed(2),
        isWeighed: item.isWeighed,
      })),
      subtotal: round(current.subtotal).toFixed(2),
      taxAmount: round(current.tax).toFixed(2),
      total: round(current.total).toFixed(2),
      payments: [{ method, amount: amount.toFixed(2) }],
      change: change.toFixed(2),
      footerMessage: 'VENTA LOCAL — pendiente de sincronización',
    };

    state.lastReceipt = receipt;
    localStorage.setItem('celesteOfflineLastReceipt', JSON.stringify(receipt));
    $('reprintButton').hidden = false;
    try { await state.desktop.printReceipt(receipt, '80'); }
    catch (error) { showError($('saleError'), `Venta guardada, pero no se pudo imprimir: ${error.message || error}`); }
    if (method === 'cash_dop') {
      try { await state.desktop.openCashDrawer(); } catch { /* sale is already durable */ }
    }

    state.cart = [];
    $('amountTendered').value = '';
    $('paymentReference').value = '';
    renderCart();
    state.bootstrap = await state.desktop.getOfflineBootstrap();
    updateStatus();
    showToast(`Venta ${offlineTicket} guardada localmente. Pendientes: ${state.bootstrap.queue.pending + state.bootstrap.queue.retrying}`);
  }

  function updateStatus() {
    const pending = Number(state.bootstrap.queue?.pending || 0) + Number(state.bootstrap.queue?.retrying || 0);
    $('queueStatus').textContent = `${pending} pendiente${pending === 1 ? '' : 's'}`;
    $('networkStatus').textContent = state.bootstrap.isOnline ? 'Servidor disponible' : 'Servidor no disponible';
    $('networkStatus').className = `pill ${state.bootstrap.isOnline ? 'online' : 'offline'}`;
    const productCount = Number(state.bootstrap.products?.count || 0);
    const updatedAt = state.bootstrap.products?.updatedAt
      ? new Date(state.bootstrap.products.updatedAt).toLocaleString('es-DO')
      : 'nunca';
    $('cacheStatus').textContent = `${productCount.toLocaleString('es-DO')} productos · actualización: ${updatedAt}`;
    if (!productCount) {
      $('catalogMessage').hidden = false;
      $('catalogMessage').textContent = 'No hay productos guardados en esta computadora. Conéctese al sistema y actualice la caché offline antes de depender del modo local.';
      $('searchInput').disabled = true;
      $('completeSaleButton').disabled = true;
    }
  }

  function bindAppEvents() {
    $('searchForm').addEventListener('submit', async event => {
      event.preventDefault();
      await searchProducts($('searchInput').value);
      $('searchInput').select();
    });
    $('amountTendered').addEventListener('input', renderTotals);
    $('paymentMethod').addEventListener('change', () => {
      if ($('paymentMethod').value !== 'cash_dop') $('changeValue').textContent = money.format(0);
      else renderTotals();
    });
    $('clearCartButton').addEventListener('click', () => { state.cart = []; renderCart(); });
    $('completeSaleButton').addEventListener('click', completeSale);
    $('reprintButton').addEventListener('click', async () => {
      if (state.lastReceipt) await state.desktop.printReceipt(state.lastReceipt, '80');
    });
    $('onlineButton').addEventListener('click', async () => {
      const result = await state.desktop.openOnlinePos();
      if (!result?.success) showToast('El servidor todavía no está disponible. Continúe usando el POS local.');
    });
  }

  async function unlock(pin) {
    const result = await state.desktop.verifyOfflinePin(pin);
    if (!result?.success) {
      showError($('pinError'), 'PIN incorrecto.');
      return;
    }
    $('lockScreen').hidden = true;
    $('app').hidden = false;
    $('searchInput').focus();
  }

  async function initialize() {
    try {
      state.desktop = await waitForBridge();
      state.bootstrap = await state.desktop.getOfflineBootstrap();
      $('tenantName').textContent = state.bootstrap.tenantName || 'Celeste POS';
      $('cashierName').value = localStorage.getItem('celesteOfflineCashier') || '';
      try {
        state.lastReceipt = JSON.parse(localStorage.getItem('celesteOfflineLastReceipt') || 'null');
        $('reprintButton').hidden = !state.lastReceipt;
      } catch { state.lastReceipt = null; }
      updateStatus();
      renderCart();
      bindAppEvents();

      const configuring = !state.bootstrap.offlinePinConfigured;
      if (configuring) {
        $('pinInstructions').textContent = 'Configure un PIN de 4 a 12 dígitos para proteger las ventas locales en esta computadora.';
        $('confirmPinLabel').hidden = false;
        $('confirmPinInput').hidden = false;
      }

      let pinBusy = false;
      $('pinForm').addEventListener('submit', async event => {
        event.preventDefault();
        if (pinBusy) return;
        showError($('pinError'), '');
        const pin = $('pinInput').value.trim();
        if (!/^\d{4,12}$/.test(pin)) return showError($('pinError'), 'Use de 4 a 12 dígitos.');
        if (configuring && pin !== $('confirmPinInput').value.trim()) {
          return showError($('pinError'), 'Los PIN no coinciden.');
        }
        pinBusy = true;
        const submitButton = $('pinForm').querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;
        try {
          if (configuring) {
            const configured = await state.desktop.configureOfflinePin(pin);
            if (!configured?.success) return showError($('pinError'), 'No se pudo configurar el PIN local.');
          }
          await unlock(pin);
        } finally {
          pinBusy = false;
          if (submitButton) submitButton.disabled = false;
        }
      });
      $('pinInput').focus();
    } catch (error) {
      showError($('pinError'), error.message || String(error));
    }
  }

  initialize();
})();
