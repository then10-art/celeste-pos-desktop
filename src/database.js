/**
 * Celeste POS - Local SQLite Database
 * Handles offline transaction queuing and local data caching
 */

const path = require('path');
const { app } = require('electron');

let db = null;

// ─── Initialize Database ──────────────────────────────────────────────────────
async function initDatabase() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(app.getPath('userData'), 'celeste-local.db');

    db = new Database(dbPath);

    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create tables
    db.exec(`
      -- Offline transaction queue
      CREATE TABLE IF NOT EXISTS offline_queue (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        type        TEXT NOT NULL,
        payload     TEXT NOT NULL,
        created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        synced      INTEGER NOT NULL DEFAULT 0,
        error       TEXT
      );

      -- Local cache for products (for offline barcode lookup)
      CREATE TABLE IF NOT EXISTS products_cache (
        id          INTEGER NOT NULL,
        tenant_id   INTEGER NOT NULL,
        barcode     TEXT,
        name        TEXT NOT NULL,
        price       REAL NOT NULL,
        cost        REAL,
        stock       REAL,
        unit        TEXT,
        itbis_rate  REAL DEFAULT 0.18,
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (id, tenant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products_cache(barcode, tenant_id);

      -- Local cache for customers
      CREATE TABLE IF NOT EXISTS customers_cache (
        id          INTEGER NOT NULL,
        tenant_id   INTEGER NOT NULL,
        name        TEXT NOT NULL,
        cedula      TEXT,
        phone       TEXT,
        credit_limit REAL DEFAULT 0,
        balance     REAL DEFAULT 0,
        points      INTEGER DEFAULT 0,
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (id, tenant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_customers_cedula ON customers_cache(cedula, tenant_id);

      -- Sync metadata
      CREATE TABLE IF NOT EXISTS sync_meta (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);

    console.log('[DB] Local database initialized at:', dbPath);
    return true;
  } catch (err) {
    console.error('[DB] Failed to initialize database:', err);
    return false;
  }
}

// ─── Offline Queue ────────────────────────────────────────────────────────────
function queueTransaction(transaction) {
  if (!db) return false;
  try {
    const stmt = db.prepare(`
      INSERT INTO offline_queue (type, payload, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(transaction.type, JSON.stringify(transaction), Date.now());
    return true;
  } catch (err) {
    console.error('[DB] Failed to queue transaction:', err);
    return false;
  }
}

function getOfflineQueue() {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT * FROM offline_queue
      WHERE synced = 0
      ORDER BY created_at ASC
      LIMIT 100
    `).all().map(row => ({
      ...row,
      payload: JSON.parse(row.payload)
    }));
  } catch (err) {
    console.error('[DB] Failed to get offline queue:', err);
    return [];
  }
}

function clearSyncedItems(syncedIds) {
  if (!db || !syncedIds.length) return;
  try {
    const placeholders = syncedIds.map(() => '?').join(',');
    db.prepare(`UPDATE offline_queue SET synced = 1 WHERE id IN (${placeholders})`).run(...syncedIds);
  } catch (err) {
    console.error('[DB] Failed to clear synced items:', err);
  }
}

// ─── Products Cache ───────────────────────────────────────────────────────────
function cacheProducts(tenantId, products) {
  if (!db) return;
  try {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO products_cache
        (id, tenant_id, barcode, name, price, cost, stock, unit, itbis_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((products) => {
      for (const p of products) {
        upsert.run(p.id, tenantId, p.barcode, p.name, p.price, p.cost, p.stock, p.unit, p.itbisRate ?? 0.18, Date.now());
      }
    });

    insertMany(products);
    console.log(`[DB] Cached ${products.length} products for tenant ${tenantId}`);
  } catch (err) {
    console.error('[DB] Failed to cache products:', err);
  }
}

function lookupProductByBarcode(tenantId, barcode) {
  if (!db) return null;
  try {
    return db.prepare(`
      SELECT * FROM products_cache
      WHERE tenant_id = ? AND barcode = ?
      LIMIT 1
    `).get(tenantId, barcode) || null;
  } catch (err) {
    console.error('[DB] Failed to lookup product:', err);
    return null;
  }
}

// ─── Customers Cache ──────────────────────────────────────────────────────────
function cacheCustomers(tenantId, customers) {
  if (!db) return;
  try {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO customers_cache
        (id, tenant_id, name, cedula, phone, credit_limit, balance, points, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((customers) => {
      for (const c of customers) {
        upsert.run(c.id, tenantId, c.name, c.cedula, c.phone, c.creditLimit ?? 0, c.balance ?? 0, c.points ?? 0, Date.now());
      }
    });

    insertMany(customers);
  } catch (err) {
    console.error('[DB] Failed to cache customers:', err);
  }
}

function lookupCustomerByCedula(tenantId, cedula) {
  if (!db) return null;
  try {
    return db.prepare(`
      SELECT * FROM customers_cache
      WHERE tenant_id = ? AND cedula = ?
      LIMIT 1
    `).get(tenantId, cedula) || null;
  } catch (err) {
    console.error('[DB] Failed to lookup customer:', err);
    return null;
  }
}

// ─── Sync Metadata ────────────────────────────────────────────────────────────
function getSyncMeta(key) {
  if (!db) return null;
  try {
    const row = db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch {
    return null;
  }
}

function setSyncMeta(key, value) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT OR REPLACE INTO sync_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(key, value, Date.now());
  } catch (err) {
    console.error('[DB] Failed to set sync meta:', err);
  }
}

module.exports = {
  initDatabase,
  queueTransaction,
  getOfflineQueue,
  clearSyncedItems,
  cacheProducts,
  lookupProductByBarcode,
  cacheCustomers,
  lookupCustomerByCedula,
  getSyncMeta,
  setSyncMeta,
};
