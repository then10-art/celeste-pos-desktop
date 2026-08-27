const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celeste-offline-test-'));
process.env.CELESTE_LOCAL_DATA_DIR = testDataDir;
const database = require('../src/database');
const databaseReady = database.initDatabase();

process.once('exit', () => {
  database?.closeDatabase();
  fs.rmSync(testDataDir, { recursive: true, force: true });
  delete process.env.CELESTE_LOCAL_DATA_DIR;
});

test('queues each offline sale exactly once by tempId', async () => {
  assert.equal(await databaseReady, true);
  const sale = {
    type: 'sale',
    tempId: 'offline-test-001',
    items: [{ productId: 1 }],
  };
  assert.equal(database.queueTransaction(sale), true);
  assert.equal(database.queueTransaction(sale), true);
  const queued = database.getOfflineQueue();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].payload.tempId, sale.tempId);
});

test('caches and searches normalized offline products', async () => {
  assert.equal(await databaseReady, true);
  const count = database.cacheProducts(7, [
    {
      id: 101,
      name: 'Arroz Selecto',
      barcode: '746000000101',
      price: '125.50',
      cost: '90.00',
      stock: '18',
      taxType: 'itbis_18',
      taxIncluded: true,
      sellBy: 'unit',
      active: true,
    },
  ]);
  assert.equal(count, 1);
  assert.equal(database.getProductCacheStats(7).count, 1);
  const exact = database.lookupProductByBarcode(7, '746000000101');
  assert.equal(exact.name, 'Arroz Selecto');
  assert.equal(exact.taxRate, 0.18);
  assert.equal(database.searchCachedProducts(7, 'selecto').length, 1);
});

test('health check rejects HTML billing pages and accepts only Celeste JSON health', async () => {
  assert.equal(await databaseReady, true);
  let mode = 'billing';
  let capturedSync = null;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/trpc/system.health')) {
      if (mode === 'billing') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<h1>Site unavailable due to unpaid billing</h1>');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ result: { data: { json: { ok: true } } } }));
      }
      return;
    }
    if (req.url === '/api/trpc/sales.syncOffline' && req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        capturedSync = {
          cookie: req.headers.cookie,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ result: { data: { json: { success: true } } } }));
      });
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  process.env.CELESTE_CLOUD_URL = `http://127.0.0.1:${address.port}`;
  delete require.cache[require.resolve('../src/sync')];
  const sync = require('../src/sync');

  try {
    assert.equal(await sync.checkCloudHealth(2000), false);
    mode = 'healthy';
    assert.equal(await sync.checkCloudHealth(2000), true);

    const result = await sync.syncWithCloud([
      {
        id: 9,
        payload: {
          type: 'sale',
          tempId: 'offline-test-sync',
          items: [],
          payments: [],
          subtotal: 0,
          taxAmount: 0,
          discountAmount: 0,
          total: 0,
          createdAt: new Date().toISOString(),
        },
      },
    ], { authCookie: 'session=test-cookie' });

    assert.deepEqual(result.synced, [9]);
    assert.equal(capturedSync.cookie, 'session=test-cookie');
    assert.equal(capturedSync.body.json.tempId, 'offline-test-sync');
    assert.equal(capturedSync.body.json.type, undefined);
  } finally {
    await new Promise(resolve => server.close(resolve));
    delete process.env.CELESTE_CLOUD_URL;
  }
});
