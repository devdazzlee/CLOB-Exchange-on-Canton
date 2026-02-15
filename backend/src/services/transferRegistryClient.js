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
 * Base URL: http://65.108.40.104:8088
 * 
 * CRITICAL: This replaces ALL custom Holding contract creation/minting.
 * All token amounts must be sent as STRINGS (e.g., "10.5", not 10.5).
 * Instrument names are case-sensitive: "CBTC" and "CC" (not "cbtc" or "cc").
 */

// Node.js v18+ has built-in fetch — no external package needed
const fetch = globalThis.fetch;

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
  TIMEOUT: 30000,       // 30 seconds
  RETRY_ATTEMPTS: 3,
};

// ─── Transfer Registry Client ────────────────────────────────────────────────

class TransferRegistryClient {
  constructor() {
    this.baseUrl = TRANSFER_REGISTRY_CONFIG.BASE_URL;
    this.timeout = TRANSFER_REGISTRY_CONFIG.TIMEOUT;
    this.retryAttempts = TRANSFER_REGISTRY_CONFIG.RETRY_ATTEMPTS;
    console.log(`[TransferRegistry] Initialized — Base URL: ${this.baseUrl}`);
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

  async getBalance(partyId, instrument) {
    const url = `${this.baseUrl}${TRANSFER_REGISTRY_CONFIG.ENDPOINTS.BALANCE}/${encodeURIComponent(partyId)}/${encodeURIComponent(instrument)}`;

    try {
      const response = await this._doFetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

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

  async getAllBalances(partyId) {
    const instruments = Object.values(TRANSFER_REGISTRY_CONFIG.INSTRUMENTS);

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

      if (!response.ok) {
        throw new Error(`Transaction status query failed (HTTP ${response.status})`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[TransferRegistry] ❌ Transaction status query failed:`, error.message);
      throw error;
    }
  }

  // ─── INTERNAL: Fetch helpers ─────────────────────────────────────────────────

  async _doFetch(url, options) {
    const AbortController = globalThis.AbortController || require('abort-controller');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const fetchFn = globalThis.fetch || require('node-fetch');
      const response = await fetchFn(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
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

