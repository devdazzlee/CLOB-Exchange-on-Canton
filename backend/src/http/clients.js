/**
 * Pre-configured HTTP Client Instances
 *
 * Three clients for three distinct external services:
 *
 *   cantonApi    — Canton JSON Ledger API (our own participant node)
 *                  Higher timeout (25s) because submit-and-wait blocks until sequenced.
 *                  Retries on 503 / 429 / network errors.
 *                  NEVER retries CONTRACT_NOT_FOUND (contract is gone, retrying is pointless).
 *
 *   registryApi  — Scan Proxy, Token Standard, Registry APIs (external infrastructure)
 *                  Moderate timeout (12s) because these are lookups, not writes.
 *                  Retries on 503 / timeout.
 *
 *   authApi      — Keycloak / OAuth token endpoints
 *                  Short timeout (10s), minimal retry.
 *
 * Each client has timeout, retry, logging, and error handling built in.
 * Service code just calls `.post()` / `.get()` — no boilerplate.
 */

const { createHttpClient } = require('./createHttpClient');
const config = require('../config');

// ─── Canton JSON Ledger API ─────────────────────────────────────────────────
// Talks to our own Canton participant (e.g. https://participant.dev.canton.network)
// Used by: cantonService.js
let _cantonApi = null;
function getCantonApi() {
  if (!_cantonApi) {
    _cantonApi = createHttpClient({
      name: 'CantonAPI',
      baseURL: config.canton.jsonApiBase,
      timeout: 25_000,
      retries: 3,
      retryDelay: 2000,
      retryCondition: (error) => {
        const status = error.response?.status;
        const data = error.response?.data;
        const msg = typeof data === 'string' ? data : JSON.stringify(data || {});

        // NEVER retry archived/consumed contracts
        if (msg.includes('CONTRACT_NOT_FOUND') || msg.includes('could not be found')) return false;

        if (status === 503 || status === 429) return true;

        // Transient synchronizer issues
        if (msg.includes('NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT')) return true;

        // Network / timeout
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return true;
        if (!error.response) return true;

        return false;
      },
    });
  }
  return _cantonApi;
}

// ─── External Registry / Scan / Token Standard APIs ─────────────────────────
// Talks to Canton devnet Scan, Utilities Backend, Token Standard
// These are the ones that cause 503 timeouts.
// Used by: canton-sdk-client.js, transferOfferService.js, scanService.js
let _registryApi = null;
function getRegistryApi() {
  if (!_registryApi) {
    _registryApi = createHttpClient({
      name: 'RegistryAPI',
      timeout: 12_000,
      retries: 2,
      retryDelay: 1500,
    });
  }
  return _registryApi;
}

// ─── Auth / Keycloak ────────────────────────────────────────────────────────
// Token exchange, service credentials
// Used by: tokenProvider.js, onboarding-service.js
let _authApi = null;
function getAuthApi() {
  if (!_authApi) {
    _authApi = createHttpClient({
      name: 'AuthAPI',
      timeout: 10_000,
      retries: 1,
      retryDelay: 1000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }
  return _authApi;
}

// Reset all clients (useful for testing)
function resetClients() {
  _cantonApi = null;
  _registryApi = null;
  _authApi = null;
}

module.exports = {
  getCantonApi,
  getRegistryApi,
  getAuthApi,
  resetClients,
};
