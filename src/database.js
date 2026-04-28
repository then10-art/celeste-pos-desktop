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
        error       TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_retry  INTEGER,
        next_retry  INTEGER,
        status      TEXT NOT NULL DEFAULT 'pending'
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
    db.prepare(`UPDATE offline_queue SET synced = 1, status = 'synced' WHERE id IN (${placeholders})`).run(...syncedIds);
  } catch (err) {
    console.error('[DB] Failed to clear synced items:', err);
  }
}

/**
 * Record a failed sync attempt with exponential backoff scheduling
 * Base delay: 5s, max delay: 5 minutes, max retries: 10
 */
function recordSyncFailure(itemId, errorMessage) {
  if (!db) return;
  try {
    const item = db.prepare('SELECT retry_count FROM offline_queue WHERE id = ?').get(itemId);
    if (!item) return;

    const retryCount = (item.retry_count || 0) + 1;
    const MAX_RETRIES = 10;
    const BASE_DELAY = 5000; // 5 seconds
    const MAX_DELAY = 300000; // 5 minutes

    if (retryCount >= MAX_RETRIES) {
      // Mark as permanently failed
      db.prepare(`
        UPDATE offline_queue
        SET retry_count = ?, error = ?, status = 'failed', last_retry = ?
        WHERE id = ?
      `).run(retryCount, errorMessage, Date.now(), itemId);
      console.warn(`[DB] Item ${itemId} permanently failed after ${MAX_RETRIES} retries: ${errorMessage}`);
    } else {
      // Schedule next retry with exponential backoff + jitter
      const delay = Math.min(BASE_DELAY * Math.pow(2, retryCount - 1), MAX_DELAY);
      const jitter = Math.random() * delay * 0.3; // 30% jitter
      const nextRetry = Date.now() + delay + jitter;

      db.prepare(`
        UPDATE offline_queue
        SET retry_count = ?, error = ?, last_retry = ?, next_retry = ?, status = 'retrying'
        WHERE id = ?
      `).run(retryCount, errorMessage, Date.now(), Math.round(nextRetry), itemId);
      console.log(`[DB] Item ${itemId} retry ${retryCount}/${MAX_RETRIES}, next in ${Math.round((delay + jitter) / 1000)}s`);
    }
  } catch (err) {
    console.error('[DB] Failed to record sync failure:', err);
  }
}

/**
 * Get items that are ready for retry (next_retry time has passed)
 */
function getRetryableItems() {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT * FROM offline_queue
      WHERE synced = 0
        AND status IN ('pending', 'retrying')
        AND (next_retry IS NULL OR next_retry <= ?)
      ORDER BY created_at ASC
      LIMIT 50
    `).all(Date.now()).map(row => ({
      ...row,
      payload: JSON.parse(row.payload)
    }));
  } catch (err) {
    console.error('[DB] Failed to get retryable items:', err);
    return [];
  }
}

/**
 * Get queue statistics for UI display
 */
function getQueueStats() {
  if (!db) return { pending: 0, retrying: 0, failed: 0, synced: 0, total: 0, oldestPending: null };
  try {
    const stats = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending' AND synced = 0 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'retrying' AND synced = 0 THEN 1 ELSE 0 END) as retrying,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN synced = 1 THEN 1 ELSE 0 END) as synced,
        COUNT(*) as total
      FROM offline_queue
    `).get();

    const oldest = db.prepare(`
      SELECT MIN(created_at) as oldest
      FROM offline_queue
      WHERE synced = 0 AND status IN ('pending', 'retrying')
    `).get();

    return {
      pending: stats.pending || 0,
      retrying: stats.retrying || 0,
      failed: stats.failed || 0,
      synced: stats.synced || 0,
      total: stats.total || 0,
      oldestPending: oldest?.oldest || null,
    };
  } catch (err) {
    console.error('[DB] Failed to get queue stats:', err);
    return { pending: 0, retrying: 0, failed: 0, synced: 0, total: 0, oldestPending: null };
  }
}

/**
 * Retry permanently failed items (admin action)
 */
function retryFailedItems() {
  if (!db) return 0;
  try {
    const result = db.prepare(`
      UPDATE offline_queue
      SET status = 'pending', retry_count = 0, error = NULL, next_retry = NULL
      WHERE status = 'failed'
    `).run();
    return result.changes;
  } catch (err) {
    console.error('[DB] Failed to retry failed items:', err);
    return 0;
  }
}

/**
 * Purge old synced items (keep last 7 days)
 */
function purgeOldSyncedItems() {
  if (!db) return 0;
  try {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const result = db.prepare(`
      DELETE FROM offline_queue
      WHERE synced = 1 AND created_at < ?
    `).run(cutoff);
    if (result.changes > 0) {
      console.log(`[DB] Purged ${result.changes} old synced items`);
    }
    return result.changes;
  } catch (err) {
    console.error('[DB] Failed to purge old items:', err);
    return 0;
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
  recordSyncFailure,
  getRetryableItems,
  getQueueStats,
  retryFailedItems,
  purgeOldSyncedItems,
  cacheProducts,
  lookupProductByBarcode,
  cacheCustomers,
  lookupCustomerByCedula,
  getSyncMeta,
  setSyncMeta,
};
