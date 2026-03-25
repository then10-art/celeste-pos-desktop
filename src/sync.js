/**
 * Celeste POS - Cloud Sync Module
 * Handles syncing offline transactions to the cloud
 */

const CLOUD_URL = 'https://celestepos.live';

/**
 * Sync offline queue items to the cloud
 * @param {Array} queue - Array of offline queue items
 * @returns {Array} - IDs of successfully synced items
 */
async function syncWithCloud(queue) {
  const synced = [];

  for (const item of queue) {
    try {
      const response = await fetch(`${CLOUD_URL}/api/trpc/offline.sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Celeste-Desktop': '1',
        },
        body: JSON.stringify({
          type: item.type,
          payload: item.payload,
          queuedAt: item.created_at,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        synced.push(item.id);
      } else {
        console.warn(`[Sync] Failed to sync item ${item.id}: HTTP ${response.status}`);
      }
    } catch (err) {
      console.error(`[Sync] Error syncing item ${item.id}:`, err.message);
    }
  }

  return synced;
}

/**
 * Fetch and cache products for offline use
 * @param {number} tenantId
 * @param {string} authToken - Session cookie or auth token
 */
async function fetchProductsForCache(tenantId, authToken) {
  try {
    const response = await fetch(
      `${CLOUD_URL}/api/trpc/products.listForCache?input=${encodeURIComponent(JSON.stringify({ tenantId }))}`,
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
    return data?.result?.data ?? [];
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
      `${CLOUD_URL}/api/trpc/customers.listForCache?input=${encodeURIComponent(JSON.stringify({ tenantId }))}`,
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
    return data?.result?.data ?? [];
  } catch (err) {
    console.error('[Sync] Failed to fetch customers for cache:', err.message);
    return [];
  }
}

module.exports = {
  syncWithCloud,
  fetchProductsForCache,
  fetchCustomersForCache,
};
