/**
 * Celeste POS - Cloud Sync Module
 * Handles syncing offline transactions to the cloud with resilience
 */

const axios = require('axios');

const CLOUD_URL = (process.env.CELESTE_CLOUD_URL || 'https://celestepos.live').replace(/\/$/, '');

function isJsonResponse(response) {
  return String(response?.headers?.['content-type'] || '').includes('application/json');
}

function readJson(response) {
  if (typeof response.data === 'string') return JSON.parse(response.data);
  return response.data;
}

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
      const payload = item.payload?.payload || item.payload || {};
      const sale = { ...payload };
      delete sale.type;

      const headers = {
        'Content-Type': 'application/json',
        'X-Celeste-Desktop': '1',
      };
      if (options.authCookie) headers.Cookie = options.authCookie;

      const response = await axios.post(`${CLOUD_URL}/api/trpc/sales.syncOffline`, { json: sale }, {
        headers,
        timeout: 15000,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) {
        if (!isJsonResponse(response)) {
          throw new Error(`Unexpected response type: ${response.headers?.['content-type'] || 'unknown'}`);
        }
        const responseBody = readJson(response);
        if (responseBody?.error) {
          throw new Error(responseBody.error?.json?.message || responseBody.error?.message || 'Cloud rejected offline sale');
        }
        synced.push(item.id);
        options.onItemSynced?.(item.id);
      } else {
        const errorText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || '');
        const errorMsg = `HTTP ${response.status}: ${errorText.substring(0, 200)}`;
        failed.push({ id: item.id, error: errorMsg });
        options.onItemFailed?.(item.id, errorMsg);

        // If server returns 400 (bad request), don't retry — data is malformed
        if (response.status === 400) {
          console.warn(`[Sync] Item ${item.id} rejected by server (400), marking as permanently failed`);
        }
      }
    } catch (err) {
      const isTimeout = err.code === 'ECONNABORTED' || err.name === 'AbortError';
      const errorMsg = isTimeout
        ? 'Request timed out (15s)'
        : `Network error: ${err.message}`;
      failed.push({ id: item.id, error: errorMsg });
      options.onItemFailed?.(item.id, errorMsg);

      // If it's a network error, stop trying remaining items (server likely unreachable)
      if (!isTimeout && !err.response) {
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
    const input = encodeURIComponent(JSON.stringify({ json: { timestamp: Date.now() } }));
    const response = await axios.get(`${CLOUD_URL}/api/trpc/system.health?input=${input}`, {
      headers: { 'Accept': 'application/json', 'X-Celeste-Desktop': '1' },
      timeout: timeoutMs,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300 || !isJsonResponse(response)) return false;
    const body = readJson(response);
    return body?.result?.data?.json?.ok === true;
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
    const products = [];
    let page = 1;
    let total = Infinity;
    while (products.length < total) {
      const response = await axios.post(`${CLOUD_URL}/api/trpc/products.listPaginated`, { json: { page, perPage: 500 } }, {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authToken,
          'X-Celeste-Desktop': '1',
        },
        timeout: 30000,
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      if (!isJsonResponse(response)) throw new Error(`Unexpected response type: ${response.headers?.['content-type'] || 'unknown'}`);
      const data = readJson(response);
      const pageData = data?.result?.data?.json ?? data?.result?.data;
      const batch = pageData?.products || [];
      if (!batch.length) break;
      products.push(...batch);
      total = Number(pageData?.total) || products.length;
      page += 1;
    }
    return products;
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
    const response = await axios.get(
      `${CLOUD_URL}/api/trpc/customers.listForCache?input=${encodeURIComponent(JSON.stringify({ json: { tenantId } }))}`,
      {
        headers: {
          'Cookie': authToken,
          'X-Celeste-Desktop': '1',
        },
        timeout: 30000,
        validateStatus: () => true,
      }
    );

    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
    if (!isJsonResponse(response)) throw new Error(`Unexpected response type: ${response.headers?.['content-type'] || 'unknown'}`);
    const data = readJson(response);
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
