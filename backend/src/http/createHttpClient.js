/**
 * HTTP Client Factory — Production-grade Axios wrapper
 *
 * Creates Axios instances with:
 *   - Per-instance timeout (no per-call boilerplate)
 *   - Automatic retry with exponential backoff (axios-retry)
 *   - Request/response logging
 *   - Error normalization
 *
 * Usage:
 *   const client = createHttpClient({ name: 'CantonAPI', baseURL, timeout: 25000 });
 *   const { data } = await client.post('/v2/commands/submit-and-wait-for-transaction', body);
 *
 * Every service gets its own instance with appropriate config.
 * No per-call timeout/retry/logging needed — it's all inherited.
 */

const axios = require('axios');
const axiosRetry = require('axios-retry').default || require('axios-retry');

/**
 * @typedef {Object} HttpClientConfig
 * @property {string}  name              - Human-readable name for logging (e.g. 'CantonAPI')
 * @property {string}  [baseURL]         - Base URL (optional — can pass full URLs per-call)
 * @property {number}  [timeout=15000]   - Request timeout in ms
 * @property {number}  [retries=2]       - Max retry count (0 = no retry)
 * @property {number}  [retryDelay=1500] - Base delay between retries in ms
 * @property {Object}  [headers]         - Default headers
 * @property {boolean} [logBody=false]   - Log request body (verbose — use in dev only)
 * @property {(error: import('axios').AxiosError) => boolean} [retryCondition] - Custom retry condition
 */

/**
 * Creates a configured Axios instance.
 *
 * @param {HttpClientConfig} config
 * @returns {import('axios').AxiosInstance}
 */
function createHttpClient({
  name,
  baseURL,
  timeout = 15_000,
  retries = 2,
  retryDelay = 1500,
  headers = {},
  logBody = false,
  retryCondition,
} = {}) {
  const client = axios.create({
    baseURL,
    timeout,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    // Return raw response text when needed (for Canton error parsing)
    // Callers get `response.data` as parsed JSON by default.
    // If response is not JSON, Axios returns the raw string.
    transformResponse: [(data) => {
      if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return data; }
      }
      return data;
    }],
  });

  // ── Retry ──────────────────────────────────────────────────────────────
  if (retries > 0) {
    axiosRetry(client, {
      retries,
      retryDelay: (retryCount) => retryDelay * retryCount,
      retryCondition: retryCondition || ((error) => {
        if (axiosRetry.isNetworkOrIdempotentRequestError(error)) return true;
        const status = error.response?.status;
        if (status === 503 || status === 429) return true;
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return true;
        return false;
      }),
      onRetry: (retryCount, error) => {
        const status = error.response?.status || error.code || 'network';
        console.warn(`[${name}] Retry ${retryCount}/${retries} (${status}): ${(error.message || '').substring(0, 100)}`);
      },
    });
  }

  // ── Request Logging ────────────────────────────────────────────────────
  client.interceptors.request.use((reqConfig) => {
    const method = (reqConfig.method || 'get').toUpperCase();
    const url = reqConfig.baseURL
      ? `${reqConfig.baseURL}${reqConfig.url || ''}`
      : reqConfig.url || '';
    console.log(`[${name}] ${method} ${url.substring(0, 140)}`);
    if (logBody && reqConfig.data) {
      console.log(`[${name}] Body:`, JSON.stringify(reqConfig.data, null, 2));
    }
    return reqConfig;
  });

  // ── Response Logging ───────────────────────────────────────────────────
  client.interceptors.response.use(
    (response) => {
      return response;
    },
    (error) => {
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        console.error(`[${name}] TIMEOUT after ${timeout}ms: ${error.config?.url?.substring(0, 100) || 'unknown'}`);
      } else if (error.response) {
        const body = typeof error.response.data === 'string'
          ? error.response.data.substring(0, 200)
          : JSON.stringify(error.response.data || {}).substring(0, 200);
        console.error(`[${name}] HTTP ${error.response.status}: ${body}`);
      } else {
        console.error(`[${name}] Network error: ${(error.message || '').substring(0, 150)}`);
      }
      return Promise.reject(error);
    }
  );

  // Attach metadata for debugging
  client._clientName = name;
  client._clientTimeout = timeout;

  return client;
}

module.exports = { createHttpClient };
