/**
 * Celeste POS - Local SQLite Database
 * Handles offline transaction queuing and local data caching
 */

const path = require('path');
const electron = require('electron');

let db = null;

// ─── Initialize Database ──────────────────────────────────────────────────────
async function initDatabase() {
  try {
    const Database = require('better-sqlite3');
    const userDataPath = process.env.CELESTE_LOCAL_DATA_DIR || electron.app?.getPath('userData');
    if (!userDataPath) throw new Error('Celeste local data directory is unavailable');
    const dbPath = path.join(userDataPath, 'celeste-local.db');

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
        dedupe_key  TEXT,
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
        tax_included INTEGER NOT NULL DEFAULT 1,
        sell_by     TEXT,
        active      INTEGER NOT NULL DEFAULT 1,
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

    // Forward-compatible migrations for databases created by older desktop
    // releases. SQLite does not support ADD COLUMN IF NOT EXISTS.
    const queueColumns = new Set(db.prepare('PRAGMA table_info(offline_queue)').all().map(column => column.name));
    if (!queueColumns.has('dedupe_key')) {
      db.exec('ALTER TABLE offline_queue ADD COLUMN dedupe_key TEXT');
    }

    const productColumns = new Set(db.prepare('PRAGMA table_info(products_cache)').all().map(column => column.name));
    if (!productColumns.has('tax_included')) {
      db.exec('ALTER TABLE products_cache ADD COLUMN tax_included INTEGER NOT NULL DEFAULT 1');
    }
    if (!productColumns.has('sell_by')) {
      db.exec('ALTER TABLE products_cache ADD COLUMN sell_by TEXT');
    }
    if (!productColumns.has('active')) {
      db.exec('ALTER TABLE products_cache ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
    }

    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_queue_dedupe ON offline_queue(dedupe_key)');

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
    if (!transaction || typeof transaction !== 'object') return false;
    const transactionType = transaction.type || 'sale';
    const dedupeKey = transaction.tempId || transaction.payload?.tempId || null;
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO offline_queue (type, payload, dedupe_key, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(transactionType, JSON.stringify(transaction), dedupeKey, Date.now());
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
  if (!db) return 0;
  try {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO products_cache
        (id, tenant_id, barcode, name, price, cost, stock, unit, itbis_rate, tax_included, sell_by, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((products) => {
      db.prepare('DELETE FROM products_cache WHERE tenant_id = ?').run(tenantId);
      for (const p of products) {
        const taxRate = p.taxRate != null
          ? Number(p.taxRate)
          : p.itbisRate != null
            ? Number(p.itbisRate)
            : p.taxType === 'itbis_18'
              ? 0.18
              : p.taxType === 'itbis_16'
                ? 0.16
                : 0;
        upsert.run(
          Number(p.id),
          Number(tenantId),
          p.barcode || '',
          p.name || 'Producto',
          Number(p.price) || 0,
          Number(p.cost) || 0,
          Number(p.stock) || 0,
          p.unit || p.sellBy || 'unit',
          taxRate > 1 ? taxRate / 100 : taxRate,
          p.taxIncluded === false ? 0 : 1,
          p.sellBy || p.unit || 'unit',
          p.active === false ? 0 : 1,
          Date.now()
        );
      }
    });

    insertMany(products);
    console.log(`[DB] Cached ${products.length} products for tenant ${tenantId}`);
    return products.length;
  } catch (err) {
    console.error('[DB] Failed to cache products:', err);
    return 0;
  }
}

function closeDatabase() {
  if (!db) return;
  db.close();
  db = null;
}

function normalizeCachedProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    barcode: row.barcode || '',
    name: row.name,
    price: Number(row.price) || 0,
    cost: Number(row.cost) || 0,
    stock: Number(row.stock) || 0,
    unit: row.unit || 'unit',
    taxRate: Number(row.itbis_rate) || 0,
    taxIncluded: row.tax_included !== 0,
    sellBy: row.sell_by || row.unit || 'unit',
    active: row.active !== 0,
    updatedAt: row.updated_at,
  };
}

function lookupProductByBarcode(tenantId, barcode) {
  if (!db) return null;
  try {
    return normalizeCachedProduct(db.prepare(`
      SELECT * FROM products_cache
      WHERE tenant_id = ? AND barcode = ? AND active = 1
      LIMIT 1
    `).get(tenantId, barcode));
  } catch (err) {
    console.error('[DB] Failed to lookup product:', err);
    return null;
  }
}

function searchCachedProducts(tenantId, query, limit = 30) {
  if (!db) return [];
  try {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return [];
    const like = `%${normalizedQuery.replace(/[\\%_]/g, '\\$&')}%`;
    return db.prepare(`
      SELECT * FROM products_cache
      WHERE tenant_id = ?
        AND active = 1
        AND (barcode = ? OR name LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\')
      ORDER BY CASE WHEN barcode = ? THEN 0 ELSE 1 END, name ASC
      LIMIT ?
    `).all(tenantId, normalizedQuery, like, like, normalizedQuery, Math.max(1, Math.min(Number(limit) || 30, 100)))
      .map(normalizeCachedProduct);
  } catch (err) {
    console.error('[DB] Failed to search cached products:', err);
    return [];
  }
}

function getProductCacheStats(tenantId) {
  if (!db) return { count: 0, updatedAt: null };
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at
      FROM products_cache
      WHERE tenant_id = ? AND active = 1
    `).get(tenantId);
    return { count: Number(row?.count) || 0, updatedAt: row?.updated_at || null };
  } catch (err) {
    console.error('[DB] Failed to read product cache stats:', err);
    return { count: 0, updatedAt: null };
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
  closeDatabase,
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
  searchCachedProducts,
  getProductCacheStats,
  cacheCustomers,
  lookupCustomerByCedula,
  getSyncMeta,
  setSyncMeta,
};
