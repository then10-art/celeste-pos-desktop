/**
 * Celeste POS - Cloud Sync Module
 * Handles syncing offline transactions to the cloud with resilience
 */

const CLOUD_URL = 'https://celestepos.live';

/**
 * Sync offline queue items to the cloud with per-item error tracking
 * @param {Array} queue - Array of offline queue items
 * @param {Object} options - Sync options
 * @param {Function} options.onItemSynced - Callback when an item syncs successfully
 * @param {Function} options.onItemFailed - Callback when an item fails (id, errorMessage)
 * @returns {{ synced: number[], failed: { id: number, error: string }[] }}
 */
async function syncWithCloud(queue, options = {}) {
  const synced = [];
  const failed = [];

  for (const item of queue) {
    try {
      const response = await fetch(`${CLOUD_URL}/api/trpc/offline.sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Celeste-Desktop': '1',
        },
        body: JSON.stringify({ json: {
          type: item.type || item.payload?.type,
          payload: item.payload,
          queuedAt: item.created_at,
        } }),
        signal: AbortSignal.timeout(15000), // 15s per item
      });

      if (response.ok) {
        synced.push(item.id);
        options.onItemSynced?.(item.id);
      } else {
        const errorText = await response.text().catch(() => '');
        const errorMsg = `HTTP ${response.status}: ${errorText.substring(0, 200)}`;
        failed.push({ id: item.id, error: errorMsg });
        options.onItemFailed?.(item.id, errorMsg);

        // If server returns 400 (bad request), don't retry — data is malformed
        if (response.status === 400) {
          console.warn(`[Sync] Item ${item.id} rejected by server (400), marking as permanently failed`);
        }
      }
    } catch (err) {
      const errorMsg = err.name === 'AbortError'
        ? 'Request timed out (15s)'
        : `Network error: ${err.message}`;
      failed.push({ id: item.id, error: errorMsg });
      options.onItemFailed?.(item.id, errorMsg);

      // If it's a network error, stop trying remaining items (server likely unreachable)
      if (err.name !== 'AbortError' && err.message?.includes('fetch failed')) {
        console.warn('[Sync] Network appears down, stopping batch sync');
        // Mark remaining items as not attempted
        break;
      }
    }
  }

  return { synced, failed };
}

/**
 * Verify connectivity to the cloud server
 * Uses a lightweight health check with progressive timeout
 * @param {number} timeoutMs - Timeout in milliseconds (default 5000)
 * @returns {boolean}
 */
async function checkCloudHealth(timeoutMs = 5000) {
  try {
    const response = await fetch(`${CLOUD_URL}/api/health`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch and cache products for offline use
 * @param {number} tenantId
 * @param {string} authToken - Session cookie or auth token
 */
async function fetchProductsForCache(tenantId, authToken) {
  try {
    const response = await fetch(
      `${CLOUD_URL}/api/trpc/products.listForCache?input=${encodeURIComponent(JSON.stringify({ json: { tenantId } }))}`,
      {
        headers: {
          'Cookie': authToken,
          'X-Celeste-Desktop': '1',
        },
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data?.result?.data?.json ?? data?.result?.data ?? [];
  } catch (err) {
    console.error('[Sync] Failed to fetch products for cache:', err.message);
    return [];
  }
}

/**
 * Fetch and cache customers for offline use
 * @param {number} tenantId
 * @param {string} authToken
 */
async function fetchCustomersForCache(tenantId, authToken) {
  try {
    const response = await fetch(
      `${CLOUD_URL}/api/trpc/customers.listForCache?input=${encodeURIComponent(JSON.stringify({ json: { tenantId } }))}`,
      {
        headers: {
          'Cookie': authToken,
          'X-Celeste-Desktop': '1',
        },
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data?.result?.data?.json ?? data?.result?.data ?? [];
  } catch (err) {
    console.error('[Sync] Failed to fetch customers for cache:', err.message);
    return [];
  }
}

module.exports = {
  syncWithCloud,
  checkCloudHealth,
  fetchProductsForCache,
  fetchCustomersForCache,
};
