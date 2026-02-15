/**
 * Transfer Registry API Client
 * 
 * Handles ALL real token operations via the Transfer Registry API:
 * - Transfer: Move real tokens (CC/CBTC) between parties during settlement
 * - Lock: Lock funds when user places an order (prevents double-spending)
 * - Unlock: Release locked tokens when order is cancelled
 * - Balance: Query user's token balance (total, available, locked)
 * - Transaction Status: Check if a transfer completed
 * 
 * Base URL: Configured via TRANSFER_REGISTRY_URL env var
 * 
 * CRITICAL: This replaces ALL custom Holding contract creation/minting.
 * All token amounts must be sent as STRINGS (e.g., "10.5", not 10.5).
 * Instrument names are case-sensitive: "CBTC" and "CC" (not "cbtc" or "cc").
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const TRANSFER_REGISTRY_CONFIG = {
  BASE_URL: process.env.TRANSFER_REGISTRY_URL || 'http://65.108.40.104:8088',
  ENDPOINTS: {
    TRANSFER: '/api/v1/transfer',
    LOCK: '/api/v1/lock',
    UNLOCK: '/api/v1/unlock',      // + /{lockId}
    BALANCE: '/api/v1/balance',    // + /{partyId}/{instrument}
    TRANSACTION_STATUS: '/api/v1/transaction', // + /{txHash}
  },
  INSTRUMENTS: {
    CBTC: 'CBTC',
    CC: 'CC',
  },
  TIMEOUT: 30000,             // 30 seconds for write operations (transfer/lock/unlock)
  BALANCE_TIMEOUT: 5000,      // 5 seconds for balance queries (read-only, fail fast)
  RETRY_ATTEMPTS: 3,          // retries for write operations
  BALANCE_RETRY_ATTEMPTS: 1,  // NO retries for balance queries (fail fast)
};

// ─── Transfer Registry Client ────────────────────────────────────────────────

class TransferRegistryClient {
  constructor() {
    this.baseUrl = TRANSFER_REGISTRY_CONFIG.BASE_URL;
    this.timeout = TRANSFER_REGISTRY_CONFIG.TIMEOUT;
    this.balanceTimeout = TRANSFER_REGISTRY_CONFIG.BALANCE_TIMEOUT;
    this.retryAttempts = TRANSFER_REGISTRY_CONFIG.RETRY_ATTEMPTS;
    this.balanceRetryAttempts = TRANSFER_REGISTRY_CONFIG.BALANCE_RETRY_ATTEMPTS;
    this._healthChecked = false;
    this._apiAvailable = false;
    console.log(`[TransferRegistry] Initialized — Base URL: ${this.baseUrl}`);
  }

  // ─── HEALTH CHECK ──────────────────────────────────────────────────────────
  // One-time check on first call to verify the Transfer Registry API is reachable
  // and returns JSON (not an HTML SPA page).

  async _checkApiHealth() {
    if (this._healthChecked) return this._apiAvailable;
    this._healthChecked = true;

    const testUrl = `${this.baseUrl}${TRANSFER_REGISTRY_CONFIG.ENDPOINTS.BALANCE}/health-check/CBTC`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s max

      const response = await fetch(testUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/html')) {
        console.error(`[TransferRegistry] ⛔ API UNAVAILABLE — ${this.baseUrl} returns HTML (likely a web frontend, not a REST API)`);
        console.error(`[TransferRegistry] ⛔ Set TRANSFER_REGISTRY_URL env var to the correct API endpoint`);
        this._apiAvailable = false;
        return false;
      }

      this._apiAvailable = true;
      console.log(`[TransferRegistry] ✅ API reachable at ${this.baseUrl}`);
      return true;
    } catch (err) {
      console.error(`[TransferRegistry] ⛔ API UNREACHABLE at ${this.baseUrl}: ${err.message}`);
      this._apiAvailable = false;
      return false;
    }
  }

  // ─── TRANSFER TOKENS ────────────────────────────────────────────────────────
  // Main settlement API — transfers real tokens from one party to another.
  // Call this TWICE per match: once for the instrument, once for the payment.

  async transfer(params) {
    const { instrument, fromParty, toParty, amount, metadata } = params;

    console.log(`[TransferRegistry] 📤 Transfer ${amount} ${instrument}: ${fromParty.substring(0, 30)}... → ${toParty.substring(0, 30)}...`);

    const url = `${this.baseUrl}${TRANSFER_REGISTRY_CONFIG.ENDPOINTS.TRANSFER}`;

    try {
      const response = await this._fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          instrument,
          fromParty,
          toParty,
          amount: String(amount),   // CRITICAL: amount as string
          metadata: metadata || {},
        }),
      });

      await this._ensureJsonResponse(response, 'Transfer');

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: response.statusText }));
        const errMsg = errorBody.error || errorBody.message || `Transfer failed (HTTP ${response.status})`;
        console.error(`[TransferRegistry] ❌ Transfer failed:`, errMsg, errorBody.details || '');
        const err = new Error(errMsg);
        err.details = errorBody.details;
        err.statusCode = response.status;
        throw err;
      }

      const result = await response.json();

      console.log(`[TransferRegistry] ✅ Transfer completed:`, {
        transferId: result.transferId,
        txHash: result.transactionHash,
        amount: result.amount,
        instrument: result.instrument,
      });

      return result;
    } catch (error) {
      if (!error.statusCode) {
        console.error(`[TransferRegistry] ❌ Transfer network error:`, error.message);
      }
      throw error;
    }
  }

  // ─── LOCK FUNDS ──────────────────────────────────────────────────────────────
  // Call when a user places an order. Locks their tokens so they can't
  // double-spend while the order is pending.

  async lockFunds(params) {
    const { party, instrument, amount, reason, expirySeconds } = params;

    console.log(`[TransferRegistry] 🔒 Lock ${amount} ${instrument} for ${party.substring(0, 30)}... (reason: ${reason})`);

    const url = `${this.baseUrl}${TRANSFER_REGISTRY_CONFIG.ENDPOINTS.LOCK}`;

    try {
      const body = {
        party,
        instrument,
        amount: String(amount),   // CRITICAL: amount as string
        reason,
      };
      if (expirySeconds) {
        body.expirySeconds = expirySeconds;
      }

      const response = await this._fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
      });

      await this._ensureJsonResponse(response, 'Lock');

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: response.statusText }));
        const errMsg = errorBody.error || errorBody.message || `Lock failed (HTTP ${response.status})`;
        console.error(`[TransferRegistry] ❌ Lock failed:`, errMsg, errorBody.details || '');
        const err = new Error(errMsg);
        err.details = errorBody.details;
        err.statusCode = response.status;
        throw err;
      }

      const result = await response.json();

      console.log(`[TransferRegistry] ✅ Funds locked:`, {
        lockId: result.lockId,
        amount: result.amount,
        instrument: result.instrument,
        remaining: result.remainingBalance,
      });

      return result;
    } catch (error) {
      if (!error.statusCode) {
        console.error(`[TransferRegistry] ❌ Lock network error:`, error.message);
      }
      throw error;
    }
  }

  // ─── UNLOCK FUNDS ────────────────────────────────────────────────────────────
  // Call when an order is cancelled to release locked tokens.

  async unlockFunds(lockId) {
    if (!lockId) {
      console.warn(`[TransferRegistry] ⚠️ No lockId provided for unlock — skipping`);
      return null;
    }

    console.log(`[TransferRegistry] 🔓 Unlock ${lockId}`);

    const url = `${this.baseUrl}${TRANSFER_REGISTRY_CONFIG.ENDPOINTS.UNLOCK}/${encodeURIComponent(lockId)}`;

    try {
      const response = await this._fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
        },
      });

      await this._ensureJsonResponse(response, 'Unlock');

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: response.statusText }));
        const errMsg = errorBody.error || errorBody.message || `Unlock failed (HTTP ${response.status})`;
        console.error(`[TransferRegistry] ❌ Unlock failed:`, errMsg);
        const err = new Error(errMsg);
        err.statusCode = response.status;
        throw err;
      }

      const result = await response.json();

      console.log(`[TransferRegistry] ✅ Funds unlocked:`, {
        lockId: result.lockId,
        amount: result.amount,
        remaining: result.remainingBalance,
      });

      return result;
    } catch (error) {
      if (!error.statusCode) {
        console.error(`[TransferRegistry] ❌ Unlock network error:`, error.message);
      }
      throw error;
    }
  }

  // ─── GET BALANCE ─────────────────────────────────────────────────────────────
  // Query a user's token balance — total, available (free), and locked.
  // Uses short timeout and no retries to fail fast.

  async getBalance(partyId, instrument) {
    // Quick bail-out if we already know the API is unreachable
    const apiOk = await this._checkApiHealth();
    if (!apiOk) {
      throw new Error(`Transfer Registry API unavailable at ${this.baseUrl} (returns HTML, not JSON). Set TRANSFER_REGISTRY_URL to the correct API endpoint.`);
    }

    const url = `${this.baseUrl}${TRANSFER_REGISTRY_CONFIG.ENDPOINTS.BALANCE}/${encodeURIComponent(partyId)}/${encodeURIComponent(instrument)}`;

    try {
      const response = await this._doFetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      }, this.balanceTimeout);

      await this._ensureJsonResponse(response, `Balance(${instrument})`);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: response.statusText }));
        const errMsg = errorBody.error || `Balance query failed (HTTP ${response.status})`;
        throw new Error(errMsg);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error(`[TransferRegistry] ❌ Balance query failed for ${instrument}:`, error.message);
      throw error;
    }
  }

  // ─── GET ALL BALANCES ────────────────────────────────────────────────────────
  // Convenience: get CBTC + CC balances in parallel.
  // Fails fast and returns zeros for any failed instruments.

  async getAllBalances(partyId) {
    const instruments = Object.values(TRANSFER_REGISTRY_CONFIG.INSTRUMENTS);

    // Quick bail-out if API is unavailable (avoids 2 network calls)
    const apiOk = await this._checkApiHealth();
    if (!apiOk) {
      console.warn(`[TransferRegistry] ⚠️ API unavailable — returning zero balances for ${partyId.substring(0, 30)}...`);
      const zeros = {};
      for (const instr of instruments) {
        zeros[instr] = '0';
      }
      return { available: { ...zeros }, locked: { ...zeros }, total: { ...zeros } };
    }

    const results = await Promise.allSettled(
      instruments.map(instrument => this.getBalance(partyId, instrument))
    );

    const available = {};
    const locked = {};
    const total = {};

    for (let i = 0; i < instruments.length; i++) {
      const instr = instruments[i];
      if (results[i].status === 'fulfilled') {
        const data = results[i].value;
        const bal = data.balance || {};
        available[instr] = bal.available || '0';
        locked[instr] = bal.locked || '0';
        total[instr] = bal.total || '0';
      } else {
        // Default zeros on failure
        available[instr] = '0';
        locked[instr] = '0';
        total[instr] = '0';
      }
    }

    return { available, locked, total };
  }

  // ─── GET TRANSACTION STATUS ──────────────────────────────────────────────────

  async getTransactionStatus(txHash) {
    const url = `${this.baseUrl}${TRANSFER_REGISTRY_CONFIG.ENDPOINTS.TRANSACTION_STATUS}/${encodeURIComponent(txHash)}`;

    try {
      const response = await this._doFetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      await this._ensureJsonResponse(response, 'TransactionStatus');

      if (!response.ok) {
        throw new Error(`Transaction status query failed (HTTP ${response.status})`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[TransferRegistry] ❌ Transaction status query failed:`, error.message);
      throw error;
    }
  }

  // ─── INTERNAL: Response validation ─────────────────────────────────────────

  async _ensureJsonResponse(response, operation) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      // The server returned an HTML page (e.g., an SPA index.html) instead of JSON.
      // This means the API endpoint doesn't exist at this URL.
      this._apiAvailable = false; // Mark as unavailable for future calls
      throw new Error(
        `${operation}: Transfer Registry returned HTML instead of JSON. ` +
        `The API at ${this.baseUrl} appears to be a web frontend, not a REST API. ` +
        `Set TRANSFER_REGISTRY_URL env var to the correct API endpoint.`
      );
    }
  }

  // ─── INTERNAL: Fetch helpers ─────────────────────────────────────────────────

  async _doFetch(url, options, timeoutMs) {
    const effectiveTimeout = timeoutMs || this.timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${effectiveTimeout}ms`);
      }
      throw err;
    }
  }

  async _fetchWithRetry(url, options, attempt = 1) {
    try {
      return await this._doFetch(url, options);
    } catch (error) {
      if (attempt < this.retryAttempts) {
        const delay = 1000 * attempt;
        console.warn(`[TransferRegistry] ⚠️ Retry ${attempt}/${this.retryAttempts} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._fetchWithRetry(url, options, attempt + 1);
      }
      throw error;
    }
  }

  // ─── Reset health check (useful if API comes back online) ──────────────────

  resetHealthCheck() {
    this._healthChecked = false;
    this._apiAvailable = false;
    console.log(`[TransferRegistry] Health check reset — will re-check on next call`);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let instance = null;

function getTransferRegistry() {
  if (!instance) {
    instance = new TransferRegistryClient();
  }
  return instance;
}

module.exports = {
  TransferRegistryClient,
  getTransferRegistry,
  TRANSFER_REGISTRY_CONFIG,
};
