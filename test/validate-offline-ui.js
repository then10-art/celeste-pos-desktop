const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const port = Number(process.env.CELESTE_CDP_PORT || 9334);
const pin = process.env.CELESTE_TEST_PIN || '2468';
const screenshotPath = path.resolve(__dirname, '..', '..', 'offline-exe-validation', 'normal-offline-pos.png');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(description, check, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await check();
    if (lastValue) return lastValue;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${JSON.stringify(lastValue)}`);
}

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.url.includes('desktopOffline=1'));
  assert.ok(target, 'regular offline POS page was not found');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  let sequence = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(message.params?.exceptionDetails?.text || 'renderer exception');
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  };
  const bodyText = () => evaluate('document.body?.innerText || ""');

  await send('Runtime.enable');
  await send('Page.enable');
  await waitFor('React POS and desktop bridge', async () => evaluate(`Boolean(
    document.body?.innerText.includes('Modo local dentro del POS normal.') &&
    window.CelesteDesktop?.getOfflineBootstrap
  )`), 20000);

  const initial = await evaluate(`(async () => ({
    title: document.title,
    url: location.href,
    bootstrap: await window.CelesteDesktop.getOfflineBootstrap(),
    passwordInputs: document.querySelectorAll('input[type="password"]').length,
    oldEmergencyPagePresent: Boolean(document.querySelector('#offlineApp'))
  }))()`);
  assert.equal(initial.oldEmergencyPagePresent, false, 'old emergency interface loaded instead of regular POS');
  assert.equal(initial.bootstrap.isOnline, false, 'unreachable cloud was incorrectly treated as online');
  assert.ok(initial.bootstrap.products.count >= 1, 'cached product catalog was not available');

  await evaluate(`(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="password"]'));
    const setValue = (element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const input of inputs) setValue(input, ${JSON.stringify(pin)});
    const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('Continuar'));
    if (!button) throw new Error('PIN continue button missing');
    button.click();
    return inputs.length;
  })()`);
  await waitFor('local PIN unlock', async () => evaluate(`!Array.from(document.querySelectorAll('[role="dialog"]')).some(
    item => item.textContent?.includes('Celeste POS Local')
  )`));

  const before = await evaluate('window.CelesteDesktop.getQueueStats()');
  await evaluate(`(() => {
    window.CelesteDesktop.printReceipt = async () => ({ success: true, testOnly: true });
    window.CelesteDesktop.openCashDrawer = async () => ({ success: true, testOnly: true });
    const input = Array.from(document.querySelectorAll('input')).find(item => item.placeholder?.includes('Escanear código'));
    if (!input) throw new Error('regular POS scanner input missing');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '746000000101');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  })()`);
  await waitFor('cached product in regular cart', async () => evaluate(`
    document.body.innerText.includes('Arroz Selecto') &&
    Array.from(document.querySelectorAll('input')).some(item => item.placeholder?.includes('Escanear código') && item.value === '')
  `));

  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', code: 'F4', bubbles: true }))`);
  await waitFor('normal payment dialog', async () => (await bodyText()).includes('Procesar Pago'));
  await waitFor('enabled complete sale button', async () => evaluate(`Array.from(document.querySelectorAll('button')).some(
    item => item.textContent?.includes('Completar Venta') && !item.disabled
  )`));
  await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('Completar Venta'));
    if (!button || button.disabled) throw new Error('complete sale button unavailable');
    button.click();
  })()`);
  await waitFor('durable local receipt confirmation', async () => (await bodyText()).includes('Venta local guardada'), 15000);

  const afterCheckout = await evaluate(`(async () => ({
    queue: await window.CelesteDesktop.getQueueStats(),
    draft: await window.CelesteDesktop.getOfflineDraft(),
    receiptVisible: document.body.innerText.includes('Venta local guardada'),
    gatedFunctions: Array.from(document.querySelectorAll('button:disabled')).map(item => item.textContent.trim()).filter(Boolean)
  }))()`);
  assert.equal(afterCheckout.queue.pending, before.pending + 1, 'checkout did not add exactly one durable pending sale');
  assert.equal(afterCheckout.receiptVisible, true, 'local receipt confirmation did not render');

  await send('Page.reload', { ignoreCache: true });
  await waitFor('regular offline POS after reload', async () => evaluate(`Boolean(
    document.body?.innerText.includes('Modo local dentro del POS normal.') &&
    window.CelesteDesktop?.getOfflineBootstrap
  )`), 20000);
  await evaluate(`(() => {
    const input = document.querySelector('input[type="password"]');
    if (!input) throw new Error('PIN input missing after reload');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(pin)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('Continuar'))?.click();
  })()`);
  await waitFor('PIN unlock after restart simulation', async () => evaluate(`!Array.from(document.querySelectorAll('[role="dialog"]')).some(
    item => item.textContent?.includes('Celeste POS Local')
  )`));

  const afterReload = await evaluate(`(async () => ({
    bootstrap: await window.CelesteDesktop.getOfflineBootstrap(),
    draft: await window.CelesteDesktop.getOfflineDraft(),
    normalActionsPresent: ['Nueva', 'Cliente', 'Espera', 'Buscar', 'Precio', 'COBRAR'].every(label => document.body.innerText.includes(label)),
    integratedBannerPresent: document.body.innerText.includes('Modo local dentro del POS normal.'),
    legacyInjectedBannerPresent: Boolean(document.querySelector('#celeste-offline-banner'))
  }))()`);
  assert.equal(afterReload.bootstrap.queue.pending, afterCheckout.queue.pending, 'pending queue did not survive page reload');
  assert.equal(afterReload.normalActionsPresent, true, 'regular cashier actions were missing after reload');
  assert.equal(afterReload.integratedBannerPresent, true, 'integrated local status strip was missing');
  assert.equal(afterReload.legacyInjectedBannerPresent, false, 'legacy banner overlapped the regular local interface');
  assert.equal(runtimeErrors.length, 0, `renderer exceptions: ${runtimeErrors.join('; ')}`);

  console.log(JSON.stringify({
    passed: true,
    page: { title: initial.title, url: initial.url },
    productsCached: initial.bootstrap.products.count,
    queueBefore: before,
    queueAfterCheckout: afterCheckout.queue,
    queueAfterReload: afterReload.bootstrap.queue,
    normalActionsPresent: afterReload.normalActionsPresent,
    gatedFunctions: afterCheckout.gatedFunctions,
    screenshotPath,
  }, null, 2));
  socket.close();
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
