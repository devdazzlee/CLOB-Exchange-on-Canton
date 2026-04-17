/**
 * Matching Engine Bot — Server-Side Auto-Settlement
 *
 * Core exchange functionality — matches buy/sell orders and settles trades
 * instantly using provider/operator submission.
 *
 * Settlement Flow (provider-signed settlement):
 * 1. Poll Canton for OPEN Order contracts via WebSocket streaming read model
 * 2. Separate into buys/sells per trading pair
 * 3. Sort by price-time priority (FIFO)
 * 4. Find crossing orders (buy price >= sell price)
 * 5. For each match:
 *    a. Resolve seller/buyer ExchangeAllocation contracts
 *    b. Exercise Execute_DvP on seller EA (counterparty = buyer EA)
 *    c. FillOrder on both Canton contracts
 *    d. Create Trade record, trigger stop-loss, broadcast via WebSocket
 *
 * Order placement: self-allocation (sender=receiver=user)
 * Settlement: provider/operator signs server-side using its own party only
 * Token flow: user-to-user ONLY — operator NEVER holds tokens
 *
 * @see backend/docs/clientchat.txt
 * @see https://docs.sync.global/app_dev/api/splice-api-token-allocation-v1/
 */

const Decimal = require('decimal.js');
const cantonService = require('./cantonService');
const config = require('../config');
const tokenProvider = require('./tokenProvider');
const { getCantonSDKClient } = require('./canton-sdk-client');
const { getTokenSystemType } = require('../config/canton-sdk.config');

// Configure decimal.js for financial precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

/** Delay so registry / ACS can index new allocations before Allocation_ExecuteTransfer (client: both legs must execute). */
function settlementSettleDelayMs() {
  const n = parseInt(process.env.SETTLEMENT_REGISTRY_SETTLE_MS || '4500', 10);
  return Number.isFinite(n) && n >= 0 ? n : 4500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MatchingEngine {
  constructor() {
    this.isRunning = false;
    this.basePollingInterval = parseInt(config.matchingEngine?.intervalMs) || 2000;
    this.pollingInterval = this.basePollingInterval;
    this.matchingInProgress = false;
    this.matchingStartTime = 0;
    this.adminToken = null;
    this.tokenExpiry = null;
    this.tradingPairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'CC/CBTC'];

    // ═══ Log throttling ═══
    this._lastLogState = {};
    this._cyclesSinceLastLog = 0;
    this._LOG_THROTTLE_CYCLES = 30;

    // ═══ CRITICAL: Recently matched orders guard ═══
    this.recentlyMatchedOrders = new Map();
    this.RECENTLY_MATCHED_TTL = 30000; // 30 seconds cooldown

    // ═══ In-flight match lock — prevents SUBMISSION_ALREADY_IN_FLIGHT from concurrent settlement ═══
    this._inFlightMatchKeys = new Set();

    // ═══ Pending pairs queue ═══
    this.pendingPairs = new Set();
    this.invalidSettlementContracts = new Map();
    this.INVALID_SETTLEMENT_TTL = 7 * 24 * 60 * 60 * 1000; // permanent for practical purposes

    // ═══ Adaptive polling ═══
    this._consecutiveIdleCycles = 0;
    this._IDLE_THRESHOLD_MEDIUM = 5;
    this._IDLE_THRESHOLD_SLOW = 20;
    this._MEDIUM_INTERVAL = 10000;
    this._SLOW_INTERVAL = 30000;
    this._lastMatchTime = 0;

    // ═══ CIRCUIT BREAKER — prevents flooding participant node ═══
    // If we hit too many consecutive settlement failures, PAUSE the engine.
    // This protects the Canton participant from CONTRACT_NOT_FOUND spam.
    this._consecutiveSettlementFailures = 0;
    this._CIRCUIT_BREAKER_THRESHOLD = 5;  // After 5 consecutive failures → pause
    this._CIRCUIT_BREAKER_PAUSE_MS = 120000; // 2 minutes pause
    this._circuitBreakerUntil = 0;
    this._totalFailuresSinceStart = 0;

    // ═══ Global CONTRACT_NOT_FOUND blacklist ═══
    // Track allocation CIDs that returned CONTRACT_NOT_FOUND — never retry them.
    this._archivedAllocationCids = new Set();

    // ═══ In-flight forwarding guard ═══
    // Prevents SUBMISSION_ALREADY_IN_FLIGHT when forwarding (TX2) is concurrently
    // or redundantly triggered for the same tradeId (commandIds are deterministic).
    this._inFlightForwardingIds = new Set();

    // ═══ Settled order IDs — prevents post-settlement re-match race ═══
    // After FillOrder, Canton archives the old contract and creates a new one with a
    // different contractId. The streaming model may briefly show the new contract as
    // an OPEN order. The matchKey guard (which uses contractId) won't catch it because
    // the contractId changed. This set tracks orderIds that have been successfully
    // settled, so they are excluded from matching even if the streaming model still
    // shows them.  Entries expire after 60s (more than enough for Canton to propagate).
    this._settledOrderIds = new Map(); // orderId → timestamp
    this._SETTLED_ORDER_TTL = 60000;
  }

  async getAdminToken() {
    if (this.adminToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.adminToken;
    }
    console.log('[MatchingEngine] Refreshing admin token...');
    this.adminToken = await tokenProvider.getServiceToken();
    this.tokenExpiry = Date.now() + (25 * 60 * 1000);
    return this.adminToken;
  }

  invalidateToken() {
    this.adminToken = null;
    this.tokenExpiry = null;
  }

  async start() {
    if (this.isRunning) {
      console.log('[MatchingEngine] Already running');
      return;
    }
    this.isRunning = true;
    console.log(`[MatchingEngine] Started (interval: ${this.pollingInterval}ms, pairs: ${this.tradingPairs.join(', ')}) [Allocation-based settlement]`);

    // ── Strategy 1: Active Invalidation Watchdog ──────────────────────────
    // When StreamingReadModel detects an allocation is archived on Canton,
    // immediately evict any order in memory whose allocationCid matches.
    // This kills zombie orders before the matching engine ever tries to settle them.
    const streaming = this._getStreamingModel();
    if (streaming) {
      streaming.on('allocationArchived', (archivedCid) => {
        this._archivedAllocationCids.add(archivedCid);
        // Scan all in-memory orders for this CID and evict them instantly
        let evicted = 0;
        for (const order of streaming.orders.values()) {
          if (order.allocationCid === archivedCid || order.allocationContractId === archivedCid) {
            streaming.evictOrder(order.contractId);
            this.invalidSettlementContracts.set(order.contractId, { at: Date.now(), reason: 'Allocation archived (watchdog)' });
            evicted++;
          }
        }
        if (evicted > 0) {
          console.warn(`[MatchingEngine] 🐕 Watchdog: allocation ${archivedCid.substring(0, 24)}... archived → evicted ${evicted} linked order(s)`);
        }
      });
    }

    // ── Strategy 4: Periodic Zombie Reconciliation ───────────────────────
    // Every 5 minutes: scan all OPEN orders. If an order's allocationCid no
    // longer exists in streaming.allocations (and streaming has had 60s+ to
    // bootstrap all live contracts), that order is a zombie — purge it.
    this._reconciliationInterval = setInterval(() => {
      this._reconcileZombieOrders();
    }, 5 * 60 * 1000); // 5 minutes

    this.matchLoop();
  }

  stop() {
    console.log('[MatchingEngine] Stopping...');
    this.isRunning = false;
    if (this._reconciliationInterval) {
      clearInterval(this._reconciliationInterval);
      this._reconciliationInterval = null;
    }
  }

  /**
   * Strategy 4 — Periodic Zombie Reconciliation.
   * Compares in-memory OPEN orders against streaming.allocations.
   * Any order whose allocation no longer exists in the live ACS (via WebSocket)
   * is a zombie — evict it so the engine never attempts to settle it.
   */
  _reconcileZombieOrders() {
    const streaming = this._getStreamingModel();
    if (!streaming || !streaming.isReady()) return;
    // Only run if streaming has been up long enough to have received all ACS events
    if (streaming.allocations.size === 0) return;

    let purged = 0;
    for (const order of streaming.orders.values()) {
      if (order.status !== 'OPEN') continue;
      const allocCid = order.allocationCid || order.allocationContractId;
      if (!allocCid) continue;
      // If the allocation CID is not in the live streaming model and is not a
      // recently created one (give 90s grace for Canton to propagate), it's stale.
      if (!streaming.allocations.has(allocCid) && !this._recentlyCreatedAllocs?.has(allocCid)) {
        this._archivedAllocationCids.add(allocCid);
        streaming.evictOrder(order.contractId);
        this.invalidSettlementContracts.set(order.contractId, { at: Date.now(), reason: 'Zombie: allocation not in live ACS' });
        purged++;
      }
    }
    if (purged > 0) {
      console.warn(`[MatchingEngine] 🧹 Reconciliation: purged ${purged} zombie order(s) whose allocations are no longer in live ACS`);
    }
  }

  async matchLoop() {
    while (this.isRunning) {
      try {
        await this.runMatchingCycle();
      } catch (error) {
        console.error('[MatchingEngine] Cycle error:', error.message);
        if (error.message?.includes('401') || error.message?.includes('security-sensitive')) {
          this.invalidateToken();
      }
    }

      // Process any pairs queued by order placement triggers
      if (this.pendingPairs.size > 0) {
        this._resetToFastPolling();
        const pending = [...this.pendingPairs];
        this.pendingPairs.clear();
        console.log(`[MatchingEngine] ⚡ Processing ${pending.length} queued pair(s): ${pending.join(', ')}`);
        try {
          this.matchingInProgress = true;
          this.matchingStartTime = Date.now();
          const token = await this.getAdminToken();
          for (const pair of pending) {
            try {
              await this.processOrdersForPair(pair, token);
            } catch (pairErr) {
              if (!pairErr.message?.includes('No contracts found')) {
                console.error(`[MatchingEngine] Queued pair ${pair} error:`, pairErr.message);
              }
            }
          }
        } catch (queueErr) {
          console.error('[MatchingEngine] Queued pairs error:', queueErr.message);
        } finally {
          this.matchingInProgress = false;
        }
      }

      await new Promise(r => setTimeout(r, this.pollingInterval));
    }
    console.log('[MatchingEngine] Stopped');
  }

  _onMatchExecuted() {
    this._consecutiveIdleCycles = 0;
    this._lastMatchTime = Date.now();
    if (this.pollingInterval !== this.basePollingInterval) {
      console.log(`[MatchingEngine] ⚡ Match found — resetting polling to ${this.basePollingInterval}ms`);
      this.pollingInterval = this.basePollingInterval;
    }
  }

  _onIdleCycle() {
    this._consecutiveIdleCycles++;
    const oldInterval = this.pollingInterval;

    if (this._consecutiveIdleCycles >= this._IDLE_THRESHOLD_SLOW) {
      this.pollingInterval = this._SLOW_INTERVAL;
    } else if (this._consecutiveIdleCycles >= this._IDLE_THRESHOLD_MEDIUM) {
      this.pollingInterval = this._MEDIUM_INTERVAL;
    }

    if (this.pollingInterval !== oldInterval) {
      console.log(`[MatchingEngine] 😴 No matches for ${this._consecutiveIdleCycles} cycles — polling interval now ${this.pollingInterval}ms`);
    }
  }

  _resetToFastPolling() {
    this._consecutiveIdleCycles = 0;
    if (this.pollingInterval !== this.basePollingInterval) {
      console.log(`[MatchingEngine] ⚡ New order detected — resetting polling to ${this.basePollingInterval}ms`);
      this.pollingInterval = this.basePollingInterval;
    }
  }

  _markInvalidSettlementOrder(order, reason) {
    if (!order?.contractId) return;
    this.invalidSettlementContracts.set(order.contractId, { at: Date.now(), reason: String(reason || 'unknown') });
    console.warn(`[MatchingEngine] 🚫 Quarantined order ${order.orderId || order.contractId.substring(0, 24)} for settlement: ${reason}`);

    // Evict from streaming read model so it never appears again this session
    const streaming = this._getStreamingModel();
    if (streaming) streaming.evictOrder(order.contractId);
  }

  async _tryCancelStaleOrder(order, token) {
    // ═══ DISABLED: Do NOT submit cancel commands to participant ═══
    // Participant node can be flooded with
    // CONTRACT_NOT_FOUND errors causing congestion. Cancel attempts on
    // stale orders just generate MORE failed commands.
    // Instead, just evict from local read model silently.
    if (!order?.contractId) return;
    const orderId = order.orderId || order.contractId.substring(0, 24);
    console.warn(`[MatchingEngine] 🚫 Skipping CancelOrder for ${orderId} — evicting from read model only (protecting participant from spam)`);
    const streaming = this._getStreamingModel();
    if (streaming) streaming.evictOrder(order.contractId);
    if (order.allocationContractId) this._archivedAllocationCids.add(order.allocationContractId);
    return;

    /* ORIGINAL CODE - DISABLED TO PREVENT PARTICIPANT SPAM
    const packageId = config.canton.packageIds?.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;
    if (!packageId || !operatorPartyId) return;

    const templateId = order.templateId || `${packageId}:Order:Order`;

    // CancelOrder usually requires both operator + owner authorizers.
    // Try that first, then fall back to operator-only for edge cases.
    const strategyActAs = [];
    const fullAuth = [operatorPartyId, order.owner].filter(Boolean);
    if (fullAuth.length > 0) strategyActAs.push(fullAuth);
    strategyActAs.push([operatorPartyId]);

    try {
      let cancelled = false;
      const synchronizerId = await cantonService.resolveSubmissionSynchronizerId(
        token,
        config.canton.synchronizerId
      );

      for (const actAsParties of strategyActAs) {
        try {
          await cantonService.exerciseChoice({
            token,
            actAsParty: actAsParties,
            templateId,
            contractId: order.contractId,
            choice: 'CancelOrder',
            choiceArgument: {},
            readAs: [operatorPartyId, order.owner].filter(Boolean),
            synchronizerId,
          });
          cancelled = true;
          break;
        } catch (attemptErr) {
          const msg = String(attemptErr?.message || attemptErr || '');
          if (msg.includes('CONTRACT_NOT_FOUND') || msg.includes('could not be found') ||
              msg.includes('Contract could not be found')) {
            throw attemptErr;
          }
          const isAuthorizerError =
            msg.includes('DAML_AUTHORIZATION_ERROR') || msg.includes('requires authorizers');
          const isNoSynchronizerError =
            msg.includes('NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT') ||
            msg.includes('Not connected to a synchronizer') ||
            msg.includes('cannot submit as the given submitter on any connected synchronizer');
          if (isAuthorizerError || isNoSynchronizerError) {
            continue;
          }
          throw attemptErr;
        }
      }

      if (!cancelled) {
        throw new Error('CancelOrder attempts exhausted');
      }
      console.warn(`[MatchingEngine] 🧹 Auto-cancelled stale order ${orderId}`);
    } catch (cancelErr) {
      const msg = cancelErr.message || '';
      if (msg.includes('CONTRACT_NOT_FOUND') || msg.includes('could not be found') || msg.includes('already')) {
        const streaming = this._getStreamingModel();
        if (streaming) streaming.evictOrder(order.contractId);
        return;
      }
      // Any other error: don't retry — the order is already quarantined/evicted
      if (!msg.includes('NO_SYNCHRONIZER') && !msg.includes('Not connected')) {
        console.warn(`[MatchingEngine] ⚠️ CancelOrder failed for ${orderId}: ${msg.substring(0, 120)}`);
      }
    }
    END OF DISABLED CODE */
  }

  async runMatchingCycle() {
    // ═══ CIRCUIT BREAKER — protect participant from spam ═══
    if (Date.now() < this._circuitBreakerUntil) {
      // Silently skip — don't even log (to avoid log spam too)
      return;
    }

    if (this.matchingInProgress) {
      if (Date.now() - this.matchingStartTime > 25000) {
        console.warn('[MatchingEngine] ⚠️ matchingInProgress stuck for >25s — force-resetting');
        this.matchingInProgress = false;
      } else {
        return;
      }
    }

    try {
      this.matchingInProgress = true;
      this.matchingStartTime = Date.now();
      const token = await this.getAdminToken();

      // ── PRE-FLIGHT: Verify synchronizer connectivity BEFORE doing anything ──
      // If the participant is disconnected, skip the ENTIRE cycle to avoid
      // flooding the Canton participant with commands that will all fail.
      // This is CRITICAL — participant logs can be filled with
      // submit commands from our partyId, which may be causing instability.
      try {
        const syncResult = await cantonService.resolveSubmissionSynchronizerId(
          token, config.canton.synchronizerId
        );
        if (!syncResult) {
          // Synchronizer is down — increase polling interval to reduce load
          this._consecutiveSyncFailures = (this._consecutiveSyncFailures || 0) + 1;
          const backoffMs = Math.min(60000, 5000 * this._consecutiveSyncFailures);
          if (this._consecutiveSyncFailures <= 3 || this._consecutiveSyncFailures % 10 === 0) {
            console.warn(`[MatchingEngine] ⏳ Synchronizer disconnected (${this._consecutiveSyncFailures}x) — skipping entire cycle, next attempt in ${backoffMs / 1000}s`);
          }
          this.pollingInterval = backoffMs;
          return;
        }
        // Synchronizer is back — reset failure counter and polling
        if (this._consecutiveSyncFailures > 0) {
          console.log(`[MatchingEngine] ✅ Synchronizer reconnected after ${this._consecutiveSyncFailures} failures — resuming normal operation`);
          this._consecutiveSyncFailures = 0;
          this.pollingInterval = this.basePollingInterval;
        }
      } catch (syncErr) {
        this._consecutiveSyncFailures = (this._consecutiveSyncFailures || 0) + 1;
        const backoffMs = Math.min(60000, 5000 * this._consecutiveSyncFailures);
        if (this._consecutiveSyncFailures <= 3 || this._consecutiveSyncFailures % 10 === 0) {
          console.warn(`[MatchingEngine] ⏳ Synchronizer health check failed (${this._consecutiveSyncFailures}x): ${syncErr.message?.substring(0, 80)} — skipping cycle`);
        }
        this.pollingInterval = backoffMs;
        return;
      }

      let matchFoundThisCycle = false;

      for (const pair of this.tradingPairs) {
        const hadMatch = await this.processOrdersForPair(pair, token);
        if (hadMatch) matchFoundThisCycle = true;
      }

      if (matchFoundThisCycle) {
        this._onMatchExecuted();
      } else {
        this._onIdleCycle();
      }
    } catch (error) {
      if (error.message?.includes('401') || error.message?.includes('security-sensitive')) {
        this.invalidateToken();
      }
      throw error;
    } finally {
      this.matchingInProgress = false;
    }
  }
  
  /**
   * Get the streaming read model (lazy init)
   */
  _getStreamingModel() {
    if (!this._streamingModel) {
      try {
        const { getStreamingReadModel } = require('./streamingReadModel');
        this._streamingModel = getStreamingReadModel();
      } catch (_) { /* streaming not available */ }
    }
    return this._streamingModel?.isReady() ? this._streamingModel : null;
  }

  /**
   * @returns {boolean} true if a match was found and executed
   */
  async processOrdersForPair(tradingPair, token) {
      const packageId = config.canton.packageIds?.clobExchange;
      const operatorPartyId = config.canton.operatorPartyId;
      
    if (!packageId || !operatorPartyId) return false;

    try {
      // WebSocket streaming read model is the only source of order data.
      const streaming = this._getStreamingModel();
      let rawOrders = null;
      
      if (streaming) {
        // Instant lookup from WebSocket-synced read model.
        rawOrders = streaming.getOpenOrdersForPair(tradingPair);
      }

      // No fallback to REST/patched registries.
      // If streaming is unavailable or not bootstrapped yet, skip this cycle.
      if (!streaming || !streaming.isReady()) return false;
      
      if (!rawOrders || rawOrders.length === 0) return false;

      const buyOrders = [];
      const sellOrders = [];

      const now = Date.now();
      const MAX_UTILITY_ALLOCATION_AGE_MS = 24 * 60 * 60 * 1000;
      const MAX_SPLICE_ALLOCATION_AGE_MS = 15 * 60 * 1000;

      for (const payload of rawOrders) {
        if (payload.status !== 'OPEN') continue;
        if (this.invalidSettlementContracts.has(payload.contractId)) continue;

        // Pre-filter: evict orders whose allocations are guaranteed to be expired.
        // BUY locks quote asset; SELL locks base asset.
        const [baseAsset, quoteAsset] = String(payload.tradingPair || tradingPair || '').split('/');
        const side = String(payload.orderType || '').toUpperCase();
        const lockedAsset = side === 'BUY' ? quoteAsset : baseAsset;
        const lockedAssetType = lockedAsset ? getTokenSystemType(lockedAsset) : null;
        const maxAllocationAgeMs = lockedAssetType === 'splice'
          ? MAX_SPLICE_ALLOCATION_AGE_MS
          : MAX_UTILITY_ALLOCATION_AGE_MS;

        const orderAge = payload.timestamp ? (now - new Date(payload.timestamp).getTime()) : Infinity;
        if (orderAge > maxAllocationAgeMs) {
          this._markInvalidSettlementOrder(
            { contractId: payload.contractId, orderId: payload.orderId, owner: payload.owner },
            `Allocation expired for ${lockedAsset || 'unknown'} (${Math.round(orderAge / 60000)}m)`
          );
          continue;
        }

        const rawPrice = payload.price;
        let parsedPrice = null;
        if (rawPrice !== null && rawPrice !== undefined && rawPrice !== '') {
          if (typeof rawPrice === 'object' && rawPrice.Some !== undefined) {
            parsedPrice = parseFloat(rawPrice.Some);
          } else {
            parsedPrice = parseFloat(rawPrice);
          }
          if (isNaN(parsedPrice)) parsedPrice = null;
        }

        const qty = parseFloat(payload.quantity) || 0;
        const filled = parseFloat(payload.filled) || 0;
        const remaining = new Decimal(qty).minus(new Decimal(filled));

        if (remaining.lte(0)) continue;

        const contractTemplateId = payload.templateId || `${packageId}:Order:Order`;
        const isNewPackage = contractTemplateId.startsWith(packageId);

        // Skip orders from old/incompatible packages.
        if (!isNewPackage) {
          continue;
        }

        // Extract allocationCid (Token Standard allocation contract ID).
        // '#0' is a relative reference from single-sign tx — NOT a real contract ID.
        // Canton contract IDs always contain '::' (e.g. "00d4...::1220...").
        // The Order DAML field is a Text placeholder (orderId like "order-123-abc"),
        // so we require '::' to distinguish real CIDs from placeholder strings.
        // Always prefer the DB-stored real CID (set at step-1 execution time).
        let allocationCid = null;
        if (payload.orderId) {
          try {
            const { getAllocationContractIdForOrder } = require('./order-service');
            allocationCid = await getAllocationContractIdForOrder(payload.orderId);
          } catch (_) { /* best effort */ }
        }
        if (!allocationCid) {
          const rawAllocationCid = payload.allocationCid || '';
          const isValidCid = rawAllocationCid
            && rawAllocationCid !== 'FILL_ONLY'
            && rawAllocationCid !== 'NONE'
            && !rawAllocationCid.startsWith('#')
            && rawAllocationCid.includes('::')  // Canton CIDs always have '::' separator
            && rawAllocationCid.length >= 10;
          if (isValidCid) allocationCid = rawAllocationCid;
        }
        if (!allocationCid) continue;

        let allocationType = 'SpliceAllocation';
        if (payload.orderId) {
          try {
            const { getAllocationTypeForOrder } = require('./order-service');
            allocationType = await getAllocationTypeForOrder(payload.orderId);
          } catch (_) { /* default */ }
        }
        
        const order = {
          contractId: payload.contractId,
          orderId: payload.orderId,
          owner: payload.owner,
          orderType: payload.orderType,
          orderMode: payload.orderMode || 'LIMIT',
          price: parsedPrice,
          quantity: qty,
          filled: filled,
          remaining: remaining.toNumber(),
          remainingDecimal: remaining,
          timestamp: payload.timestamp,
          tradingPair: payload.tradingPair,
          allocationContractId: allocationCid,
          allocationType,
          templateId: contractTemplateId,
          isNewPackage: isNewPackage,
        };
        
        if (payload.orderType === 'BUY') {
          buyOrders.push(order);
        } else if (payload.orderType === 'SELL') {
          sellOrders.push(order);
        }
      }
      
      if (buyOrders.length === 0 || sellOrders.length === 0) return false;

      // Throttled logging
      const stateKey = `${tradingPair}:${buyOrders.length}b:${sellOrders.length}s`;
      this._cyclesSinceLastLog++;
      const shouldLogStatus = (this._lastLogState[tradingPair] !== stateKey) || (this._cyclesSinceLastLog >= this._LOG_THROTTLE_CYCLES);
      if (shouldLogStatus) {
        console.log(`[MatchingEngine] ${tradingPair}: ${buyOrders.length} buys, ${sellOrders.length} sells`);
        this._lastLogState[tradingPair] = stateKey;
        this._cyclesSinceLastLog = 0;
      }

      // Sort: buys by highest price first (MARKET first), sells by lowest price first (MARKET first)
      buyOrders.sort((a, b) => {
        if (a.price === null && b.price !== null) return -1;
        if (a.price !== null && b.price === null) return 1;
        if (a.price === null && b.price === null) return new Date(a.timestamp) - new Date(b.timestamp);
        if (b.price !== a.price) return b.price - a.price;
        return new Date(a.timestamp) - new Date(b.timestamp);
      });

      sellOrders.sort((a, b) => {
        if (a.price === null && b.price !== null) return -1;
        if (a.price !== null && b.price === null) return 1;
        if (a.price === null && b.price === null) return new Date(a.timestamp) - new Date(b.timestamp);
        if (a.price !== b.price) return a.price - b.price;
        return new Date(a.timestamp) - new Date(b.timestamp);
      });

      // ═══ BATCH EXECUTION: Execute multiple crossing matches per cycle ═══
      // Instead of returning after a single match, continue matching until no
      // more crossing orders exist or MAX_BATCH_SIZE is reached. This reduces
      // settlement latency when multiple orders cross simultaneously.
      const MAX_BATCH_SIZE = parseInt(process.env.MATCH_BATCH_SIZE || '5', 10);
      let batchCount = 0;
      let anyMatched = false;

      for (let i = 0; i < MAX_BATCH_SIZE; i++) {
        const matched = await this.findAndExecuteOneMatch(tradingPair, buyOrders, sellOrders, token);
        if (!matched) break;
        anyMatched = true;
        batchCount++;
        // After each match, remaining quantities are updated in-place by
        // findAndExecuteOneMatch, so re-sorting is not needed — price-time
        // priority is preserved and exhausted orders have remaining <= 0.
      }
      if (batchCount > 1) {
        console.log(`[MatchingEngine] ═══ Batch complete: ${batchCount} matches executed for ${tradingPair} ═══`);
      }
      return anyMatched;
      
          } catch (error) {
      if (error.message?.includes('401') || error.message?.includes('security-sensitive')) {
        this.invalidateToken();
          }
      if (!error.message?.includes('No contracts found')) {
        console.error(`[MatchingEngine] Error for ${tradingPair}:`, error.message);
        }
      return false;
    }
  }
  
  /**
   * Find ONE crossing match and execute it.
   * Only one per cycle because contract IDs change after exercise.
   * 
   * Settlement uses Allocation API:
   * - Execute buyer's Allocation (exchange is executor — sends quote to seller)
   * - Execute seller's Allocation (exchange is executor — sends base to buyer)
   * - Both legs settled atomically by the exchange's own key
   */
  async findAndExecuteOneMatch(tradingPair, buyOrders, sellOrders, token) {
    const now = Date.now();

    // Clear expired entries from recentlyMatchedOrders
    for (const [key, ts] of this.recentlyMatchedOrders) {
      if (now - ts > this.RECENTLY_MATCHED_TTL) {
        this.recentlyMatchedOrders.delete(key);
      }
    }
    // Clear expired entries from settledOrderIds
    for (const [oid, ts] of this._settledOrderIds) {
      if (now - ts > this._SETTLED_ORDER_TTL) {
        this._settledOrderIds.delete(oid);
      }
    }

    for (const buyOrder of buyOrders) {
      for (const sellOrder of sellOrders) {
        if (buyOrder.remaining <= 0 || sellOrder.remaining <= 0) continue;

        // Self-trade: allowed — market handles it
        // No blocking — same-owner orders can match normally

        // Skip orders that were already settled (prevents post-FillOrder re-match race)
        if (this._settledOrderIds.has(buyOrder.orderId) || this._settledOrderIds.has(sellOrder.orderId)) {
          continue;
        }

        // Skip recently matched order pairs
        const matchKey = `${buyOrder.contractId}::${sellOrder.contractId}`;
        if (this.recentlyMatchedOrders.has(matchKey)) {
          continue;
        }
        // Skip if another cycle is already settling this match (prevents SUBMISSION_ALREADY_IN_FLIGHT)
        if (this._inFlightMatchKeys.has(matchKey)) {
          continue;
        }
        
        // Check if orders cross
        const buyPrice = buyOrder.price;
        const sellPrice = sellOrder.price;
        let canMatch = false;
        let matchPrice = 0;

        if (buyPrice !== null && sellPrice !== null) {
          if (buyPrice >= sellPrice) {
            canMatch = true;
            matchPrice = sellPrice; // Maker-taker: use sell (maker) price
          }
        } else if (buyPrice === null && sellPrice !== null) {
          canMatch = true;
          matchPrice = sellPrice;
        } else if (buyPrice !== null && sellPrice === null) {
          canMatch = true;
          matchPrice = buyPrice;
        }

        if (!canMatch || matchPrice <= 0) continue;

        const matchQty = Decimal.min(buyOrder.remainingDecimal, sellOrder.remainingDecimal);
        const matchQtyStr = matchQty.toFixed(10);
        const matchQtyNum = matchQty.toNumber();

        console.log(`[MatchingEngine] ✅ MATCH FOUND: BUY ${buyPrice !== null ? buyPrice : 'MARKET'} x ${buyOrder.remaining} ↔ SELL ${sellPrice !== null ? sellPrice : 'MARKET'} x ${sellOrder.remaining}`);
        console.log(`[MatchingEngine]    Fill: ${matchQtyStr} @ ${matchPrice} | Settlement: Allocation API (exchange as executor)`);

        this.recentlyMatchedOrders.set(matchKey, Date.now());
        this._inFlightMatchKeys.add(matchKey);

        // ═══ Pre-flight: Skip if either order's allocation is already known-archived ═══
        if (buyOrder.allocationContractId && this._archivedAllocationCids.has(buyOrder.allocationContractId)) {
          this._markInvalidSettlementOrder(buyOrder, 'Allocation archived (blacklisted)');
          continue;
        }
        if (sellOrder.allocationContractId && this._archivedAllocationCids.has(sellOrder.allocationContractId)) {
          this._markInvalidSettlementOrder(sellOrder, 'Allocation archived (blacklisted)');
          continue;
        }

        // ═══ Strategy 3: Sanity Check — verify allocations still exist in live ACS ═══
        // StreamingReadModel.allocations is populated via WebSocket from Canton.
        // If an allocation CID is no longer in the live set, it was archived/consumed.
        // This check fires BEFORE any registry API call, preventing 404 errors entirely.
        {
          const streamSnap = this._getStreamingModel();
          if (streamSnap && streamSnap.allocations.size > 0) {
            const buyAllocCid = buyOrder.allocationContractId;
            const sellAllocCid = sellOrder.allocationContractId;
            if (buyAllocCid && !streamSnap.allocations.has(buyAllocCid)) {
              console.warn(`[MatchingEngine] 🔍 Pre-flight: BUY order allocation not in live ACS — likely archived. Quarantining.`);
              this._archivedAllocationCids.add(buyAllocCid);
              this._markInvalidSettlementOrder(buyOrder, 'Pre-flight: allocation not in live ACS');
              this.recentlyMatchedOrders.delete(matchKey);
              continue;
            }
            if (sellAllocCid && !streamSnap.allocations.has(sellAllocCid)) {
              console.warn(`[MatchingEngine] 🔍 Pre-flight: SELL order allocation not in live ACS — likely archived. Quarantining.`);
              this._archivedAllocationCids.add(sellAllocCid);
              this._markInvalidSettlementOrder(sellOrder, 'Pre-flight: allocation not in live ACS');
              this.recentlyMatchedOrders.delete(matchKey);
              continue;
            }
          }
        }

        try {
          const buyRemainingAfter = buyOrder.remainingDecimal.minus(matchQty);
          const sellRemainingAfter = sellOrder.remainingDecimal.minus(matchQty);
          const buyFullySettled = buyRemainingAfter.lte(0);
          const sellFullySettled = sellRemainingAfter.lte(0);

          await this.executeMatch(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, token);
          console.log(`[MatchingEngine] ✅ Match executed successfully via Allocation API`);
          // Only quarantine a side when it is fully filled.
          // Partial fills must remain matchable in subsequent cycles.
          if (buyFullySettled) {
            this._settledOrderIds.set(buyOrder.orderId, Date.now());
            if (buyOrder.allocationContractId) this._archivedAllocationCids.add(buyOrder.allocationContractId);
          }
          if (sellFullySettled) {
            this._settledOrderIds.set(sellOrder.orderId, Date.now());
            if (sellOrder.allocationContractId) this._archivedAllocationCids.add(sellOrder.allocationContractId);
          }
          // Reset circuit breaker on success
          this._consecutiveSettlementFailures = 0;
          // Update remaining quantities in-place for batch execution.
          // After a match, reduce both orders' remaining so the batch loop
          // can find the next crossing pair without re-querying Canton.
          buyOrder.remaining = buyRemainingAfter.toNumber();
          buyOrder.remainingDecimal = buyRemainingAfter;
          sellOrder.remaining = sellRemainingAfter.toNumber();
          sellOrder.remainingDecimal = sellRemainingAfter;
          return true;
        } catch (error) {
          const fullErrBody = error.response?.data ? JSON.stringify(error.response.data).substring(0, 1500) : '';

          // ═══ ALLOCATION NOT FOUND (HTTP 404) — PERMANENT, do NOT trip circuit breaker ═══
          // `fetchAllocationExtraArgs` returns 404 when the allocation was already archived.
          // This is a stale data issue (order's allocationContractId points to an old CID).
          // Quarantine both orders, blacklist CIDs, and continue — never retry a 404.
          const isAllocationNotFound =
            error.response?.status === 404 ||
            (fullErrBody?.includes('not found') && fullErrBody?.includes('Allocation'));
          if (isAllocationNotFound) {
            console.warn(`[MatchingEngine] ⚠️ Allocation not found (HTTP 404) — stale allocationContractId. Quarantining orders and blacklisting CIDs.`);
            if (fullErrBody) console.warn(`[MatchingEngine]    Registry response: ${fullErrBody}`);
            if (buyOrder.allocationContractId) this._archivedAllocationCids.add(buyOrder.allocationContractId);
            if (sellOrder.allocationContractId) this._archivedAllocationCids.add(sellOrder.allocationContractId);
            this._markInvalidSettlementOrder(buyOrder, 'Allocation not found (archived)');
            this._markInvalidSettlementOrder(sellOrder, 'Allocation not found (archived)');
            const streaming = this._getStreamingModel();
            if (streaming) {
              streaming.evictOrder(buyOrder.contractId);
              streaming.evictOrder(sellOrder.contractId);
            }
            this.recentlyMatchedOrders.delete(matchKey);
            // Do NOT increment failure counter — this is stale data, not a Canton failure
            continue;
          }

          this._consecutiveSettlementFailures++;
          this._totalFailuresSinceStart++;
          console.error(`[MatchingEngine] ❌ Match execution failed (${this._consecutiveSettlementFailures}/${this._CIRCUIT_BREAKER_THRESHOLD}):`, error.message?.substring(0, 200));
          if (fullErrBody) console.error(`[MatchingEngine] ❌ Full error response: ${fullErrBody}`);

          // ═══ CIRCUIT BREAKER: Too many consecutive failures → pause engine ═══
          if (this._consecutiveSettlementFailures >= this._CIRCUIT_BREAKER_THRESHOLD) {
            this._circuitBreakerUntil = Date.now() + this._CIRCUIT_BREAKER_PAUSE_MS;
            console.error(`[MatchingEngine] 🛑 CIRCUIT BREAKER TRIPPED — ${this._consecutiveSettlementFailures} consecutive failures. Pausing for ${this._CIRCUIT_BREAKER_PAUSE_MS / 1000}s to protect participant node.`);
            return false;
          }

          // If auth/token expired, refresh immediately and allow instant retry
          // instead of waiting for the 30s recentlyMatched cooldown.
          if (error.message?.includes('401') || error.message?.includes('security-sensitive')) {
            this.invalidateToken();
            this.recentlyMatchedOrders.delete(matchKey);
            console.warn('[MatchingEngine] 🔄 Invalidated admin token after auth failure; retrying on next cycle');
          }
          
          // ═══ IMPORTANT: Check SPECIFIC allocation failures FIRST ═══
          // Errors like BUYER_ALLOCATION_FAILED: STALE_ALLOCATION_LOCK_MISSING: CONTRACT_NOT_FOUND
          // contain "CONTRACT_NOT_FOUND" in the message but should ONLY quarantine
          // the affected order (buyer or seller), NOT both.
          // The general CONTRACT_NOT_FOUND handler below quarantines BOTH orders,
          // so these specific checks MUST come first.
          const isBuyerAllocFailed = error.message?.includes('BUYER_ALLOCATION_FAILED');
          const isSellerAllocFailed = error.message?.includes('SELLER_ALLOCATION_FAILED');
          const isSpecificAllocFailure = isBuyerAllocFailed || isSellerAllocFailed;
          const isStaleOrPermanent = error.message?.includes('STALE_ALLOCATION_LOCK_MISSING') ||
              error.message?.includes('STALE_ALLOCATION_EXPIRED') ||
              error.message?.includes('CANTON_EXTERNAL_PARTY_LIMITATION');

          if (isSpecificAllocFailure || isStaleOrPermanent) {
            if (isSellerAllocFailed) {
              console.warn(`[MatchingEngine] 🚫 Seller allocation failed — quarantining SELL order only`);
              this._markInvalidSettlementOrder(sellOrder, error.message?.substring(0, 120));
              if (sellOrder.allocationContractId) this._archivedAllocationCids.add(sellOrder.allocationContractId);
            } else if (isBuyerAllocFailed) {
              console.warn(`[MatchingEngine] 🚫 Buyer allocation failed — quarantining BUY order only`);
              this._markInvalidSettlementOrder(buyOrder, error.message?.substring(0, 120));
              if (buyOrder.allocationContractId) this._archivedAllocationCids.add(buyOrder.allocationContractId);
            } else {
              // Generic STALE error without BUYER/SELLER prefix — quarantine both
              console.warn(`[MatchingEngine] 🚫 Stale allocation — quarantining both orders`);
              this._markInvalidSettlementOrder(buyOrder, error.message?.substring(0, 120));
              this._markInvalidSettlementOrder(sellOrder, error.message?.substring(0, 120));
              if (buyOrder.allocationContractId) this._archivedAllocationCids.add(buyOrder.allocationContractId);
              if (sellOrder.allocationContractId) this._archivedAllocationCids.add(sellOrder.allocationContractId);
            }
            this.recentlyMatchedOrders.delete(matchKey);
            continue;
          }

          // ═══ General CONTRACT_NOT_FOUND / already filled ═══
          // This catches FillOrder failures and other contract-not-found errors
          // that are NOT wrapped in BUYER/SELLER_ALLOCATION_FAILED.
          if (error.message?.includes('already filled') || 
              error.message?.includes('could not be found') ||
              error.message?.includes('CONTRACT_NOT_FOUND') ||
              error.message?.includes('INACTIVE_CONTRACTS') ||
              error.message?.includes('LOCKED_CONTRACTS')) {
            // Contract is archived on the ledger — evict from read model permanently
            // AND blacklist the allocation CID to prevent future commands
            const streaming = this._getStreamingModel();
            if (streaming) {
              streaming.evictOrder(buyOrder.contractId);
              streaming.evictOrder(sellOrder.contractId);
            }
            // Blacklist allocation CIDs permanently
            if (buyOrder.allocationContractId) this._archivedAllocationCids.add(buyOrder.allocationContractId);
            if (sellOrder.allocationContractId) this._archivedAllocationCids.add(sellOrder.allocationContractId);
            this._markInvalidSettlementOrder(buyOrder, 'CONTRACT_NOT_FOUND — allocation archived');
            this._markInvalidSettlementOrder(sellOrder, 'CONTRACT_NOT_FOUND — allocation archived');
            this.recentlyMatchedOrders.delete(matchKey);
            if (error.message?.includes('FillOrder failed')) {
              break;
            }
            continue;
          }

          // ═══ Transient synchronizer errors ═══
          // Quarantine the SPECIFIC order whose allocation failed (if identifiable),
          // otherwise quarantine both to stop spam.
          const isTransient = error.message?.includes('TRANSIENT_SYNCHRONIZER_ERROR') ||
              error.message?.includes('NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT') ||
              error.message?.includes('Not connected to a synchronizer') ||
              error.message?.includes('cannot submit as the given submitter on any connected synchronizer');
          if (isTransient) {
            console.warn(`[MatchingEngine] ⏳ Transient synchronizer error — quarantining affected order(s)`);
            this.recentlyMatchedOrders.delete(matchKey);
            // Quarantine BOTH orders' allocations to prevent immediate re-submission
            this._markInvalidSettlementOrder(buyOrder, 'Synchronizer error — quarantined');
            this._markInvalidSettlementOrder(sellOrder, 'Synchronizer error — quarantined');
            continue;
          }

          // No token holdings found — token transfer may still be pending acceptance
          // (e.g. faucet transfer not yet accepted). Do NOT quarantine the order —
          // holdings will appear once the AutoAccept service processes the transfer.
          if (error.message?.includes('holdings found') || error.message?.includes('No ') && error.message?.includes('holdings')) {
            console.warn(`[MatchingEngine] ⚠️ No token holdings for party — transfer may still be pending. Skipping match, will retry next cycle.`);
            this.recentlyMatchedOrders.delete(matchKey);
            continue;
          }

          // FAILED_TO_EXECUTE_TRANSACTION — Canton limitation with external parties.
          // This is a PERMANENT protocol error (not transient). Quarantine both orders
          // and DO NOT retry — it will never succeed with current architecture.
          if (error.message?.includes('FAILED_TO_EXECUTE_TRANSACTION') ||
              error.message?.includes('did not provide an external signature')) {
            console.error(`[MatchingEngine] 🚫 Canton external party protocol limitation — quarantining orders (requires Propose-Accept redesign)`);
            this._markInvalidSettlementOrder(buyOrder, 'Canton external party limitation');
            this._markInvalidSettlementOrder(sellOrder, 'Canton external party limitation');
            this.recentlyMatchedOrders.delete(matchKey);
            continue;
          }

          // DAML_AUTHORIZATION_ERROR — permanent, quarantine
          if (error.message?.includes('DAML_AUTHORIZATION_ERROR') || error.message?.includes('requires authorizers')) {
            console.error(`[MatchingEngine] 🚫 DAML authorization error — quarantining orders`);
            this._markInvalidSettlementOrder(buyOrder, 'DAML authorization error');
            this._markInvalidSettlementOrder(sellOrder, 'DAML authorization error');
            this.recentlyMatchedOrders.delete(matchKey);
            continue;
          }
          
          return false;
        } finally {
          this._inFlightMatchKeys.delete(matchKey);
        }
      }
    }

    // Diagnostic: Log why no match was found (throttled)
    const bestBuy = buyOrders.find(o => o.remaining > 0 && o.price !== null);
    const bestSell = sellOrders.find(o => o.remaining > 0 && o.price !== null);
    if (bestBuy && bestSell) {
      const spread = bestSell.price - bestBuy.price;
      if (spread <= 0) {
        const skippedByCache = [];
        for (const b of buyOrders) {
          for (const s of sellOrders) {
            if (b.remaining > 0 && s.remaining > 0 && b.price !== null && s.price !== null && b.price >= s.price) {
              const key = `${b.contractId}::${s.contractId}`;
              if (this.recentlyMatchedOrders.has(key)) skippedByCache.push(`B@${b.price}↔S@${s.price}`);
            }
          }
        }
        if (skippedByCache.length > 0) {
          console.warn(`[MatchingEngine] ⚠️ ${tradingPair}: Crossing orders blocked by recentlyMatched cache: ${skippedByCache.join(', ')}`);
        }
      } else {
        const spreadKey = `spread:${tradingPair}:${bestBuy.price}:${bestSell.price}`;
        if (this._lastLogState[`spread:${tradingPair}`] !== spreadKey) {
          console.log(`[MatchingEngine] ${tradingPair}: No crossing (bid=${bestBuy.price} < ask=${bestSell.price}, spread=${spread.toFixed(4)})`);
          this._lastLogState[`spread:${tradingPair}`] = spreadKey;
        }
      }
    }
    return false;
  }
  
  /**
   * Execute a match using ATOMIC DvP settlement via ExchangeAllocation::Execute_DvP.
   *
   * 2-TX ORDER LIFECYCLE (client requirement):
   *   TX 1 (order placement): Splice self-alloc + Order Create + ExchangeAllocation (user signs once)
   *   TX 2 (settlement): ExchangeAllocation::Execute_DvP — EVERYTHING in ONE Canton TX:
   *     Operator regular submission (actAs=[operator] only, no external signatures):
   *     1. Execute_DvP on seller's EA → DAML auth {executor, seller}
   *        → Withdraw seller's CC self-allocation (controller=seller via carry-forward)
   *        → Execute_Settlement_WithTransfers on buyer's EA → {executor, seller, buyer}
   *           → Withdraw buyer's CBTC self-allocation (controller=buyer via carry-forward)
   *           → AllocationFactory_Allocate CC seller→buyer (controller=seller ✓)
   *           → AllocationFactory_Allocate CBTC buyer→seller (controller=buyer ✓)
   *           → Allocation_ExecuteTransfer CC [executor,seller,buyer] ✓
   *           → Allocation_ExecuteTransfer CBTC [executor,buyer,seller] ✓
   *     2. FillOrder on buy Order (controller=operator ✓)
   *     3. FillOrder on sell Order (controller=operator ✓)
   *     4. Create Trade record (signatory=operator ✓)
   *
   * After the DAML TX completes:
   *     7. Record trade in PostgreSQL (off-chain)
   *     8. Release balance reservations
   *     9. Trigger stop-loss checks
   *    10. Broadcast via WebSocket
   *
   * Both transfers are REAL Canton token movements in ONE transaction.
   * The exchange settles with its OWN key — users sign only at order placement.
   */
  async executeMatch(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, token) {
    const packageId = config.canton.packageIds?.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;
    const synchronizerId = config.canton.synchronizerId;
    const [baseSymbol, quoteSymbol] = tradingPair.split('/');

    try {
      const syncResult = await cantonService.resolveSubmissionSynchronizerId(token, synchronizerId);
      if (!syncResult) {
        throw new Error('TRANSIENT_SYNCHRONIZER_ERROR: Participant has no connected synchronizer — settlement postponed');
      }
    } catch (syncCheckErr) {
      if (syncCheckErr.message?.includes('TRANSIENT_SYNCHRONIZER_ERROR')) throw syncCheckErr;
      console.warn(`[MatchingEngine] ⚠️ Synchronizer health check failed: ${syncCheckErr.message} — proceeding anyway`);
    }

    const quoteAmount = matchQty.times(new Decimal(matchPrice));
    const matchQtyStr = matchQty.toFixed(10);
    const quoteAmountStr = quoteAmount.toFixed(10);

    const buyIsPartial = new Decimal(buyOrder.remaining).gt(matchQty);
    const sellIsPartial = new Decimal(sellOrder.remaining).gt(matchQty);

    // ═══════════════════════════════════════════════════════════════════
    // ATOMIC DvP SETTLEMENT — Multi-Command Batch (Single Canton TX)
    //
    // Architecture: Self-allocations at order placement (sender=receiver=user).
    // At match time, SERVER settles ATOMICALLY using provider submission:
    //   Step 1-2: Withdraw both self-allocations (server signs)
    //   Step 3: Create directional Splice allocations (both legs)
    //   Step 4: Fetch extraArgs from registries
    //   Step 5: Two Allocation_ExecuteTransfer commands in ONE submission
    //           → submitAndWaitForTransaction with commands[] array
    //           → DSO disclosed contracts authorize both at submission level
    //   Step 6: FillOrder on Canton + record trade
    //
    // Tokens flow user-to-user ONLY. Operator NEVER holds tokens.
    // User signs ONCE at order placement. Server reuses stored key for settlement.
    // CRITICAL: Both Allocation_ExecuteTransfer happen in SAME transaction.
    // ═══════════════════════════════════════════════════════════════════
    console.log(`[MatchingEngine] ═══ Settlement (server-side auto-settle — user-to-user) ═══`);
    console.log(`[MatchingEngine]    Trade: ${matchQtyStr} ${baseSymbol} @ ${matchPrice} ${quoteSymbol}`);
    console.log(`[MatchingEngine]    Seller: ${sellOrder.owner.substring(0, 30)}... alloc: ${sellOrder.allocationContractId?.substring(0, 24) || 'MISSING'}...`);
    console.log(`[MatchingEngine]    Buyer:  ${buyOrder.owner.substring(0, 30)}... alloc: ${buyOrder.allocationContractId?.substring(0, 24) || 'MISSING'}...`);

    if (!sellOrder.allocationContractId || !buyOrder.allocationContractId) {
      throw new Error('Settlement aborted: missing allocation on one or both orders');
    }

    const tradeId = `trade-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    const sdkClient = getCantonSDKClient();

    // Settlement uses REGULAR submission — operator signs alone.
    // ExchangeAllocation DAML carry-forward provides {executor, seller, buyer} auth.
    // No stored private keys are needed at settlement time.
    const adminToken = await tokenProvider.getServiceToken();
    const updateIds = [];

    // ─── Step 1: Find ExchangeAllocation CIDs for seller and buyer ───────────
    // ExchangeAllocations created at TX1 embed user consent on-chain.
    // We match by orderId (unique) to avoid any ambiguity.
    const eaTemplateId = `${packageId}:Settlement:ExchangeAllocation`;
    const allEAContracts = await cantonService.queryActiveContracts(
      { party: operatorPartyId, templateIds: [eaTemplateId] }, adminToken
    );
    const findEAByOrderId = (contracts, targetOrderId) => {
      const list = Array.isArray(contracts) ? contracts
        : (contracts?.activeContracts || contracts?.contracts || []);
      for (const c of list) {
        const ev = c.createdEvent || c;
        const p = ev?.createArguments || ev?.createArgument || ev?.payload || {};
        if (p.orderId === targetOrderId && p.status === 'PENDING') {
          const cid = c.contractId || ev?.contractId;
          if (cid) {
            console.log(`[MatchingEngine]    EA found for orderId ${targetOrderId}: cid=${cid.substring(0, 24)}... owner=${String(p.owner).substring(0, 30)}...`);
            return cid;
          }
        }
      }
      return null;
    };
    const eaList = Array.isArray(allEAContracts) ? allEAContracts
      : (allEAContracts?.activeContracts || allEAContracts?.contracts || []);
    console.log(`[MatchingEngine]    Searching ${eaList.length} ExchangeAllocation(s) for seller orderId=${sellOrder.orderId} buyer orderId=${buyOrder.orderId}`);
    const sellerEACid = findEAByOrderId(allEAContracts, sellOrder.orderId);
    const buyerEACid  = findEAByOrderId(allEAContracts, buyOrder.orderId);

    if (!sellerEACid) throw new Error(`EXCHANGE_ALLOCATION_MISSING: No PENDING ExchangeAllocation for seller orderId=${sellOrder.orderId}`);
    if (!buyerEACid)  throw new Error(`EXCHANGE_ALLOCATION_MISSING: No PENDING ExchangeAllocation for buyer orderId=${buyOrder.orderId}`);
    console.log(`[MatchingEngine]    Seller EA: ${sellerEACid.substring(0, 24)}...`);
    console.log(`[MatchingEngine]    Buyer  EA: ${buyerEACid.substring(0, 24)}...`);

    // ─── Step 2: Fetch execution extraArgs for both allocation legs ──────────
    const [ccExtraData, cbtcExtraData] = await Promise.all([
      sdkClient.fetchAllocationExtraArgs(sellOrder.allocationContractId, baseSymbol),
      sdkClient.fetchAllocationExtraArgs(buyOrder.allocationContractId, quoteSymbol),
    ]);

    // Collect all disclosed contracts (deduped)
    const disclosedByContractId = new Map();
    for (const dc of [
      ...(ccExtraData.disclosedContracts || []),
      ...(cbtcExtraData.disclosedContracts || []),
    ]) {
      if (dc?.contractId) disclosedByContractId.set(dc.contractId, dc);
    }
    const disclosedContracts = Array.from(disclosedByContractId.values());

    // ─── Step 3: Build settlement commands — REGULAR SUBMISSION (operator-only) ─
    //
    // ROOT CAUSE FIX for DAML_AUTHORIZATION_ERROR:
    //   Execute_DvP used a nested DAML sub-choice chain:
    //     Execute_DvP (seller's EA) → Execute_Settlement_WithTransfers (buyer's EA)
    //     → Allocation_ExecuteTransfer (seller's Splice alloc)
    //   In Canton 3.x, auth does NOT carry forward across nested cross-contract
    //   sub-choices. Seller's auth from Execute_DvP on seller's EA was NOT
    //   available inside Allocation_ExecuteTransfer on the Splice alloc.
    //
    // FIX: Execute_LegSettlement — one ROOT command per party.
    //   Command 1 (root): Execute_LegSettlement on SELLER's EA
    //     Auth in body = actAs ∪ signatories(seller's EA) = {operator, seller}
    //     → Allocation_ExecuteTransfer on seller's Splice alloc needs {executor, seller} ✓
    //   Command 2 (root): Execute_LegSettlement on BUYER's EA
    //     Auth in body = actAs ∪ signatories(buyer's EA) = {operator, buyer}
    //     → Allocation_ExecuteTransfer on buyer's Splice alloc needs {executor, buyer} ✓
    //
    // Both root commands are submitted in ONE atomic Canton transaction.
    // actAs = [operator] only. No user keys at settlement time. ✓
    const eaTemplateIdStr = eaTemplateId;
    const orderTemplateId = `${packageId}:Order:Order`;
    const tradeTemplateId = `${packageId}:Settlement:Trade`;

    const settlementCommands = [
      // Command 1: Execute_LegSettlement on SELLER's EA
      // auth = {operator, seller} → Allocation_ExecuteTransfer on seller's Splice alloc ✓
      {
        ExerciseCommand: {
          templateId: eaTemplateIdStr,
          contractId: sellerEACid,
          choice: 'Execute_LegSettlement',
          choiceArgument: {
            legAllocCid: sellOrder.allocationContractId,
            legExtraArgs: ccExtraData.extraArgs,
            matchPrice: matchPrice.toString(),
            matchQuantity: matchQtyStr,
            tradeId,
          },
        },
      },
      // Command 2: Execute_LegSettlement on BUYER's EA
      // auth = {operator, buyer} → Allocation_ExecuteTransfer on buyer's Splice alloc ✓
      {
        ExerciseCommand: {
          templateId: eaTemplateIdStr,
          contractId: buyerEACid,
          choice: 'Execute_LegSettlement',
          choiceArgument: {
            legAllocCid: buyOrder.allocationContractId,
            legExtraArgs: cbtcExtraData.extraArgs,
            matchPrice: matchPrice.toString(),
            matchQuantity: matchQtyStr,
            tradeId,
          },
        },
      },
      // Command 3: FillOrder on buy order (controller=operator ✓)
      {
        ExerciseCommand: {
          templateId: orderTemplateId,
          contractId: buyOrder.contractId,
          choice: 'FillOrder',
          choiceArgument: { fillQuantity: matchQtyStr, newAllocationCid: null },
        },
      },
      // Command 4: FillOrder on sell order (controller=operator ✓)
      {
        ExerciseCommand: {
          templateId: orderTemplateId,
          contractId: sellOrder.contractId,
          choice: 'FillOrder',
          choiceArgument: { fillQuantity: matchQtyStr, newAllocationCid: null },
        },
      },
      // Command 5: Create Trade record (signatory=operator ✓)
      {
        CreateCommand: {
          templateId: tradeTemplateId,
          createArguments: {
            tradeId,
            operator: operatorPartyId,
            buyer:    buyOrder.owner,
            seller:   sellOrder.owner,
            baseInstrumentId:  { issuer: operatorPartyId, symbol: baseSymbol,  version: '1.0' },
            quoteInstrumentId: { issuer: operatorPartyId, symbol: quoteSymbol, version: '1.0' },
            baseAmount:  matchQtyStr,
            quoteAmount: quoteAmountStr,
            price:       matchPrice.toString(),
            buyOrderId:  buyOrder.orderId,
            sellOrderId: sellOrder.orderId,
            timestamp:   new Date().toISOString(),
          },
        },
      },
    ];

    if (!operatorPartyId || operatorPartyId.startsWith('ext-')) {
      throw new Error('Settlement invariant violated: provider/operator partyId must be a hosted provider party.');
    }
    if (settlementCommands.length === 0) {
      throw new Error('Settlement invariant violated: no settlement commands prepared.');
    }

    // Settlement TX: app provider (hosted operator party) is the only actAs — matches client requirement.
    // Users already locked funds at placement; they do not sign this ledger submission.
    console.log(`[MatchingEngine]    Submitting settlement: actAs=[app provider / operator ${operatorPartyId.substring(0, 24)}...] — hosted keys only (users never sign settlement)`);
    const settleResult = await cantonService.submitAndWaitForTransaction(adminToken, {
      commands: {
        commandId:   `settle-${tradeId}`,
        actAs:       [operatorPartyId],
        readAs:      [operatorPartyId, sellOrder.owner, buyOrder.owner],
        domainId:    synchronizerId,
        commands:    settlementCommands,
        ...(disclosedContracts.length > 0 && { disclosedContracts }),
      },
    });

    const settleUpdateId = settleResult?.transaction?.updateId || settleResult?.updateId;
    if (settleUpdateId) updateIds.push({ step: 'settle-dvp-fill-trade', updateId: settleUpdateId });
    console.log(`[MatchingEngine]    ✅ Execute_LegSettlement(x2) + FillOrder + Trade ALL in ONE TX — actAs=[operator] only (updateId: ${settleUpdateId || 'N/A'})`);

    // ─── Forwarding: operator → counterparties ──────────────────────────────
    //
    // Execute_LegSettlement transferred both legs to the operator:
    //   - seller's CC (base)  → operator
    //   - buyer's CBTC (quote) → operator
    //
    // Now the operator forwards the matched amounts to the correct counterparties,
    // and returns any partial-fill remainders to the original parties.
    //
    // This is the operator-as-receiver DvP pattern:
    //   TX1 (above): lock legs execute → user→operator
    //   TX2 (below): operator→buyer (base) + operator→seller (quote) [+ remainders]
    // ────────────────────────────────────────────────────────────────────────
    console.log(`[MatchingEngine]    ⟶ Forwarding: operator→counterparties (TX2 legs)...`);
    if (this._inFlightForwardingIds.has(tradeId)) {
      console.warn(`[MatchingEngine]    ⚠️ Forwarding already in-flight for ${tradeId} — skipping duplicate submission`);
    } else {
    this._inFlightForwardingIds.add(tradeId);
    try {
      // Splice (CC) uses LockedAmulet with expiry — use a short settle window for operator legs
      // so the new lock expires well before the LockedAmulet from the original order.
      const operatorLegSettleMs = Number(process.env.OPERATOR_LEG_SETTLE_WINDOW_MS || 120000) || 120000;
      const baseIsSplice = baseSymbol === 'CC';  // Only CC is Splice/Amulet; others are Utility

      // Forward base (CC) to buyer ─────────────────────────────────────────
      console.log(`[MatchingEngine]    ⟶ operator → buyer: ${matchQtyStr} ${baseSymbol}`);
      const ccFwdAlloc = await sdkClient.createAllocation(
        operatorPartyId, buyOrder.owner, matchQtyStr, baseSymbol,
        operatorPartyId, `${tradeId}-fwd-base`,
        baseIsSplice ? { settleWindowMsOverride: operatorLegSettleMs } : {}
      );
      if (ccFwdAlloc?.allocationContractId) {
        await sdkClient.tryRealAllocationExecution(
          ccFwdAlloc.allocationContractId, operatorPartyId, baseSymbol,
          operatorPartyId, buyOrder.owner
        );
        console.log(`[MatchingEngine]    ✅ ${baseSymbol} forwarded to buyer`);
      } else {
        throw new Error(`Forward ${baseSymbol}→buyer: createAllocation returned no CID`);
      }

      // Forward quote (CBTC) to seller ─────────────────────────────────────
      console.log(`[MatchingEngine]    ⟶ operator → seller: ${quoteAmountStr} ${quoteSymbol}`);
      const cbtcFwdAlloc = await sdkClient.createAllocation(
        operatorPartyId, sellOrder.owner, quoteAmountStr, quoteSymbol,
        operatorPartyId, `${tradeId}-fwd-quote`
      );
      if (cbtcFwdAlloc?.allocationContractId) {
        await sdkClient.tryRealAllocationExecution(
          cbtcFwdAlloc.allocationContractId, operatorPartyId, quoteSymbol,
          operatorPartyId, sellOrder.owner
        );
        console.log(`[MatchingEngine]    ✅ ${quoteSymbol} forwarded to seller`);
      } else {
        throw new Error(`Forward ${quoteSymbol}→seller: createAllocation returned no CID`);
      }

      // Partial fill remainders ─────────────────────────────────────────────
      // The full Splice allocation was consumed by Execute_LegSettlement.
      // Any unmatched portion must be returned from the operator back to the user.
      if (sellIsPartial) {
        const remainderBase = new Decimal(sellOrder.remaining).minus(matchQty).toFixed(10);
        if (new Decimal(remainderBase).gt(0)) {
          console.log(`[MatchingEngine]    ⟶ returning ${remainderBase} ${baseSymbol} remainder to seller`);
          const remBaseAlloc = await sdkClient.createAllocation(
            operatorPartyId, sellOrder.owner, remainderBase, baseSymbol,
            operatorPartyId, `${tradeId}-rem-base`,
            baseIsSplice ? { settleWindowMsOverride: operatorLegSettleMs } : {}
          );
          if (remBaseAlloc?.allocationContractId) {
            await sdkClient.tryRealAllocationExecution(
              remBaseAlloc.allocationContractId, operatorPartyId, baseSymbol,
              operatorPartyId, sellOrder.owner
            );
            console.log(`[MatchingEngine]    ✅ ${baseSymbol} remainder returned to seller`);
          }
        }
      }
      if (buyIsPartial) {
        const remainderQuote = new Decimal(buyOrder.remaining).times(new Decimal(matchPrice)).minus(quoteAmount).toFixed(10);
        if (new Decimal(remainderQuote).gt(0)) {
          console.log(`[MatchingEngine]    ⟶ returning ${remainderQuote} ${quoteSymbol} remainder to buyer`);
          const remQuoteAlloc = await sdkClient.createAllocation(
            operatorPartyId, buyOrder.owner, remainderQuote, quoteSymbol,
            operatorPartyId, `${tradeId}-rem-quote`
          );
          if (remQuoteAlloc?.allocationContractId) {
            await sdkClient.tryRealAllocationExecution(
              remQuoteAlloc.allocationContractId, operatorPartyId, quoteSymbol,
              operatorPartyId, buyOrder.owner
            );
            console.log(`[MatchingEngine]    ✅ ${quoteSymbol} remainder returned to buyer`);
          }
        }
      }

      console.log(`[MatchingEngine]    ✅ TX2 forwarding complete — tokens delivered to counterparties`);
    } catch (fwdErr) {
      const fwdMsg = fwdErr?.message || String(fwdErr);
      if (fwdMsg.includes('SUBMISSION_ALREADY_IN_FLIGHT')) {
        // Command was already submitted to Canton — it will complete on its own.
        // This is NOT a fatal error; TX2 is idempotent by commandId.
        console.warn(`[MatchingEngine] ⚠️ Forwarding for ${tradeId} already in-flight on Canton — will complete without retry`);
      } else {
        // Forwarding failure is serious but TX1 already committed. Log clearly so
        // the operator can manually reconcile. Don't crash the engine loop.
        console.error(`[MatchingEngine] ❌ FORWARDING FAILED for trade ${tradeId}: ${fwdMsg}`);
        console.error(`[MatchingEngine]    TX1 (Execute_LegSettlement) already committed. Operator holds tokens.`);
        console.error(`[MatchingEngine]    Manual intervention required to forward tokens to counterparties.`);
      }
    } finally {
      this._inFlightForwardingIds.delete(tradeId);
    }
    } // end else (!_inFlightForwardingIds.has(tradeId))

    // Extract Trade contract ID + any partially-filled Order contracts from settlement events
    let tradeContractId = null;
    const streaming = this._getStreamingModel();
    const newPartialOrders = []; // Track new Order contracts from partial fills
    if (settleResult?.transaction?.events) {
      for (const event of settleResult.transaction.events) {
        const created = event.created || event.CreatedEvent;
        if (!created?.contractId) continue;
        const tplId = typeof created.templateId === 'string'
          ? created.templateId
          : `${created.templateId?.packageId || ''}:${created.templateId?.moduleName || ''}:${created.templateId?.entityName || ''}`;
        if (tplId.includes(':Settlement:Trade')) {
          tradeContractId = created.contractId;
          continue;
        }
        // FillOrder creates a new Order contract (consuming choice archives old, creates new).
        // For partial fills the new Order has status=OPEN. Capture it so we can immediately
        // re-add it to the streaming model — this prevents a visibility gap where the order
        // disappears from the book until the WebSocket delivers the event.
        if (tplId.includes(':Order:Order')) {
          const payload = created.createArgument || created.createArguments || created.payload || {};
          newPartialOrders.push({ contractId: created.contractId, templateId: tplId, payload });
        }
      }
    }
    if (!tradeContractId) tradeContractId = tradeId;

    // Evict old Order contracts and immediately re-add partial fills.
    // Fully-filled orders (status=FILLED) are NOT re-added.
    if (streaming) {
      streaming.evictOrder(buyOrder.contractId);
      streaming.evictOrder(sellOrder.contractId);
      for (const { contractId, templateId, payload } of newPartialOrders) {
        if (payload.status === 'OPEN' && payload.orderId) {
          streaming._addOrder(contractId, templateId, payload);
          console.log(`[MatchingEngine]    ♻️ Partial fill re-added to order book: ${payload.orderId} remaining=${payload.quantity - payload.filled}`);
        }
      }
    }
    console.log(`[MatchingEngine]    ✅ Settlement complete: Tokens transferred + Orders filled + Trade recorded in ONE TX`);

    console.log(`[MatchingEngine] ✅ Settlement complete — ALL steps in SINGLE Canton TX (2-TX lifecycle achieved)`);
    if (updateIds.length > 0) {
      console.log(`[MatchingEngine]    All updateIds for Canton Explorer verification:`);
      for (const u of updateIds) {
        console.log(`[MatchingEngine]      ${u.step}: ${u.updateId}`);
      }
    }

    // Record trade in PostgreSQL (off-chain persistence)
    try {
      const { recordTradeSettlement, isTradeRecorded } = require('./tradeSettlementService');
      const alreadyRecorded = await isTradeRecorded(tradeId);
      if (!alreadyRecorded) {
        await recordTradeSettlement({
          tradeId,
          buyer: buyOrder.owner,
          seller: sellOrder.owner,
          baseSymbol,
          quoteSymbol,
          baseAmount: matchQtyStr,
          quoteAmount: quoteAmountStr,
          price: matchPrice,
          tradingPair,
          buyOrderId: buyOrder.orderId,
          sellOrderId: sellOrder.orderId,
          sellerUsedRealTransfer: true,
          buyerUsedRealTransfer: true,
        });
      }
    } catch (tsErr) {
      console.warn(`[MatchingEngine] ⚠️ TradeSettlement recording failed (non-critical): ${tsErr.message}`);
    }

    // Release balance reservations
    try {
      const { releasePartialReservation } = require('./order-service');
      await releasePartialReservation(sellOrder.orderId, matchQtyStr);
      await releasePartialReservation(buyOrder.orderId, quoteAmountStr);
    } catch (_) { /* non-critical */ }

    // ═══ STEP 7: Trigger stop-loss checks at the new trade price ═══
    try {
      const { getStopLossService } = require('./stopLossService');
      const stopLossService = getStopLossService();
      await stopLossService.checkTriggers(tradingPair, matchPrice);
    } catch (slErr) {
      console.warn(`[MatchingEngine] ⚠️ Stop-loss trigger check failed (non-critical): ${slErr.message}`);
    }

    // ═══ FINAL: Broadcast completed trade via WebSocket ═══
    const tradeRecord = {
      tradeId: tradeContractId || tradeId,
      tradingPair,
      buyer: buyOrder.owner,
      seller: sellOrder.owner,
      price: matchPrice.toString(),
      quantity: matchQtyStr,
      buyOrderId: buyOrder.orderId,
      sellOrderId: sellOrder.orderId,
      timestamp: new Date().toISOString(),
      settlementType: 'ServerAutoSettle',
      instrumentAllocationId: sellOrder.allocationContractId || null,
      paymentAllocationId: buyOrder.allocationContractId || null,
      updateIds: updateIds.map(u => u.updateId),
    };

    if (global.broadcastWebSocket) {
      global.broadcastWebSocket(`trades:${tradingPair}`, { type: 'NEW_TRADE', ...tradeRecord });
      global.broadcastWebSocket('trades:all', { type: 'NEW_TRADE', ...tradeRecord });
      global.broadcastWebSocket(`orderbook:${tradingPair}`, {
        type: 'TRADE_EXECUTED',
        buyOrderId: buyOrder.orderId,
        sellOrderId: sellOrder.orderId,
        fillQuantity: matchQtyStr,
        fillPrice: matchPrice,
      });
      global.broadcastWebSocket(`balance:${buyOrder.owner}`, { type: 'BALANCE_UPDATE', partyId: buyOrder.owner, timestamp: Date.now() });
      global.broadcastWebSocket(`balance:${sellOrder.owner}`, { type: 'BALANCE_UPDATE', partyId: sellOrder.owner, timestamp: Date.now() });
    }

    console.log(`[MatchingEngine] ═══ Trade complete: ${matchQtyStr} ${baseSymbol} @ ${matchPrice} ${quoteSymbol} (user-to-user, server-signed, 2-TX lifecycle) ═══`);
  }

  /**
   * Extract allocation CID from an executeInteractiveSubmission result.
   * The Canton v2 execute endpoint may or may not return transaction events.
   */
  _extractAllocCidFromResult(result) {
    if (!result) return null;
    // Try standard event paths
    const events = result?.transaction?.events || result?.events || [];
    for (const event of events) {
      const created = event.created || event.CreatedEvent?.value || event.CreatedEvent;
      if (created?.contractId) {
        const tpl = created.templateId || '';
        if (tpl.includes('Allocation') && !tpl.includes('AllocationFactory')) {
          return created.contractId;
        }
      }
    }
    // Try deep search (Canton may nest events differently)
    const stack = [result];
    const visited = new Set();
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (visited.has(current)) continue;
      visited.add(current);
      // Look for allocationCid or allocationContractId fields
      if (typeof current.allocationCid === 'string' && current.allocationCid.length > 20) return current.allocationCid;
      if (typeof current.allocationContractId === 'string' && current.allocationContractId.length > 20) return current.allocationContractId;
      if (Array.isArray(current)) {
        for (const item of current) stack.push(item);
      } else {
        for (const key of Object.keys(current)) stack.push(current[key]);
      }
    }
    return null;
  }

  /**
   * Extract disclosed contracts (with createdEventBlob) from an allocation creation
   * transaction result. The LockedAmulet backing contract is created during
   * AllocationFactory_Allocate but the operator is NOT a stakeholder on it.
   * By extracting it here (from the creation tx response), we can pass it directly
   * to the execute-transfer step — eliminating the Scan Proxy registry indexing lag
   * that caused LockedAmulet 404 errors.
   *
   * @param {object} result - Transaction result from executeInteractiveSubmission
   * @param {string} synchronizerId - Default synchronizer ID
   * @returns {Array<{contractId: string, templateId: string, createdEventBlob: string, synchronizerId: string}>}
   */
  _extractDisclosedContractsFromResult(result, synchronizerId) {
    if (!result) return [];
    const disclosed = [];
    const events = result?.transaction?.events || result?.events || [];
    for (const event of events) {
      const created = event.created || event.CreatedEvent?.value || event.CreatedEvent;
      if (!created?.contractId || !created?.createdEventBlob) continue;

      // Normalize templateId to string
      let tpl;
      if (typeof created.templateId === 'string') {
        tpl = created.templateId;
      } else if (created.templateId) {
        const t = created.templateId;
        tpl = `${t.packageId || ''}:${t.moduleName || ''}:${t.entityName || ''}`;
      } else {
        tpl = '';
      }

      disclosed.push({
        contractId: created.contractId,
        templateId: tpl || created.templateId,
        createdEventBlob: created.createdEventBlob,
        synchronizerId: synchronizerId,
      });
    }

    if (disclosed.length > 0) {
      console.log(`[MatchingEngine]    Extracted ${disclosed.length} disclosed contract(s) from creation tx:`);
      for (const dc of disclosed) {
        const tplShort = typeof dc.templateId === 'string'
          ? (dc.templateId.split(':').pop() || dc.templateId.substring(0, 40))
          : 'unknown';
        console.log(`[MatchingEngine]      - ${dc.contractId.substring(0, 24)}... (${tplShort})`);
      }
    } else {
      console.warn(`[MatchingEngine]    ⚠️ No createdEventBlob in creation tx events — will query sender ACS`);
    }
    return disclosed;
  }

  /**
   * Merge two arrays of disclosed contracts, de-duplicating by contractId.
   * Used to combine sender's ACS holdings (LockedAmulet) with the allocation
   * creation step's disclosed contracts (global Splice infra: AmuletRules,
   * OpenMiningRound, etc.). Both sets are needed for Allocation_ExecuteTransfer.
   */
  _mergeDisclosedContracts(acsDisclosed, creationDisclosed) {
    const seen = new Set();
    const merged = [];
    for (const dc of (acsDisclosed || [])) {
      if (!dc?.contractId || !dc?.createdEventBlob) continue;
      if (seen.has(dc.contractId)) continue;
      seen.add(dc.contractId);
      merged.push(dc);
    }
    for (const dc of (creationDisclosed || [])) {
      if (!dc?.contractId || !dc?.createdEventBlob) continue;
      if (seen.has(dc.contractId)) continue;
      seen.add(dc.contractId);
      merged.push(dc);
    }
    return merged;
  }

  /**
   * Query the SENDER's ACS for holdings with createdEventBlob.
   *
   * The operator is NOT a stakeholder on the LockedAmulet backing contract,
   * but the sender IS. By querying the sender's ACS using the Holding interface
   * (which includes includeCreatedEventBlob: true), we get the LockedAmulet
   * with its opaque blob — ready to pass as a disclosed contract to the
   * execute-transfer step. This eliminates the Scan Proxy registry dependency.
   *
   * @param {string} senderPartyId - The sender party (stakeholder on LockedAmulet)
   * @param {string} symbol - Token symbol (CC, CBTC) for filtering
   * @param {string} adminToken - Admin bearer token
   * @param {string} synchronizerId - Default synchronizer ID
   * @returns {Promise<Array<{contractId, templateId, createdEventBlob, synchronizerId}>>}
   */
  async _fetchSenderHoldingsAsDisclosed(senderPartyId, symbol, adminToken, synchronizerId) {
    const cantonService = require('./cantonService');
    const HOLDING_INTERFACE = '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';

    try {
      // Query sender's holdings using the Holding interface.
      // InterfaceFilter with includeCreatedEventBlob: true returns the blob we need.
      const holdings = await cantonService.queryActiveContracts({
        party: senderPartyId,
        templateIds: [HOLDING_INTERFACE],
      }, adminToken);

      const disclosed = [];
      for (const h of (holdings || [])) {
        if (!h.contractId || !h.createdEventBlob) continue;

        // Normalize templateId to string
        const tpl = typeof h.templateId === 'string'
          ? h.templateId
          : (h.templateId ? `${h.templateId.packageId || ''}:${h.templateId.moduleName || ''}:${h.templateId.entityName || ''}` : '');

        disclosed.push({
          contractId: h.contractId,
          templateId: tpl || h.templateId,
          createdEventBlob: h.createdEventBlob,
          synchronizerId: h.synchronizerId || synchronizerId,
        });
      }

      if (disclosed.length > 0) {
        console.log(`[MatchingEngine]    ✅ Fetched ${disclosed.length} holding(s) with createdEventBlob from sender ACS:`);
        for (const dc of disclosed) {
          const tplShort = typeof dc.templateId === 'string'
            ? (dc.templateId.split(':').pop() || dc.templateId.substring(0, 40))
            : 'unknown';
          console.log(`[MatchingEngine]      - ${dc.contractId.substring(0, 24)}... (${tplShort})`);
        }
      } else {
        console.warn(`[MatchingEngine]    ⚠️ No holdings with createdEventBlob found in sender ACS`);
      }
      return disclosed;
    } catch (err) {
      console.warn(`[MatchingEngine]    ⚠️ Failed to fetch sender holdings: ${err.message?.substring(0, 100)}`);
      return [];
    }
  }

  /**
   * Snapshot all current allocation CIDs visible to the operator.
   * Uses the WebSocket StreamingReadModel (no REST polling, no 200-element limit).
   * Client requirement: "we need to use ledger-api or web sockets to get stream of data" (clientchat.txt)
   *
   * @param {string} operatorPartyId - The operator party
   * @param {string} adminToken - Admin bearer token (unused — kept for API compatibility)
   * @returns {Promise<Set<string>>} Set of existing allocation contract IDs
   */
  async _snapshotAllocationCids(operatorPartyId, adminToken) {
    const cids = new Set();

    // Primary: WebSocket streaming model — zero REST calls, no 200-element limit
    try {
      const streaming = this._getStreamingModel();
      if (streaming?.isReady()) {
        for (const [cid, alloc] of streaming.allocations) {
          if (alloc.sender === operatorPartyId || alloc.executor === operatorPartyId) {
            cids.add(cid);
          }
        }
        if (cids.size > 0) return cids;
      }
    } catch (_) { /* ignore — snapshot is best-effort */ }

    return cids;
  }

  /**
   * Find a recently created Allocation contract.
   * Client requirement: use WebSocket streaming (not REST polling) — clientchat.txt line 294.
   *
   * Strategy:
   * 1. WebSocket StreamingReadModel.allocations (zero REST calls, no 200-element limit)
   * 2. ACS REST query as fallback (only if streaming model is not ready)
   *
   * @param {string} executorPartyId - The operator party (executor of the allocation)
   * @param {string} senderPartyId - Sender of the allocation
   * @param {string} receiverPartyId - Receiver of the allocation
   * @param {string} adminToken - Admin bearer token
   * @param {Set<string>} [excludeCids] - CIDs to exclude (already found for other legs)
   * @returns {Promise<string|null>} Allocation contract ID or null
   */
  async _findAllocationByACS(executorPartyId, senderPartyId, receiverPartyId, adminToken, excludeCids = null) {
    // ── Strategy 1: WebSocket streaming model (primary — no REST, no 200-element limit) ──
    try {
      const streaming = this._getStreamingModel();
      if (streaming?.isReady()) {
        for (const [cid, alloc] of streaming.allocations) {
          if (excludeCids?.has(cid)) continue;
          const matchesSender = alloc.sender === senderPartyId || alloc.executor === senderPartyId;
          const matchesReceiver = !receiverPartyId || alloc.receiver === receiverPartyId;
          if (matchesSender && matchesReceiver) {
            console.log(`[MatchingEngine]    ✅ Found allocation via WebSocket streaming model: ${cid.substring(0, 24)}...`);
            return cid;
          }
        }
        // Fallback within streaming: return any non-excluded allocation visible to sender
        for (const [cid, alloc] of streaming.allocations) {
          if (excludeCids?.has(cid)) continue;
          if (alloc.sender === senderPartyId || alloc.executor === senderPartyId || alloc.executor === executorPartyId) {
            console.log(`[MatchingEngine]    ✅ Found allocation via WebSocket streaming model (executor match): ${cid.substring(0, 24)}...`);
            return cid;
          }
        }
      }
    } catch (err) {
      console.warn(`[MatchingEngine]    ⚠️ Streaming model allocation lookup failed: ${err.message?.substring(0, 100)}`);
    }

    // ── Strategy 2: ACS REST query (fallback — only if streaming not ready) ──
    try {
      const cantonService = require('./cantonService');
      const ALLOCATION_INTERFACE = '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation';
      const result = await cantonService.queryActiveContracts({
        party: executorPartyId,
        interfaceIds: [ALLOCATION_INTERFACE],
        verbose: true,
        pageSize: 50,
      }, adminToken);

      const contracts = result?.activeContracts || result?.contracts || result || [];
      for (const contract of contracts) {
        const created = contract.createdEvent || contract;
        const cid = created?.contractId;
        if (!cid || excludeCids?.has(cid)) continue;
        const view = created?.interfaceViews?.[0]?.viewValue || created?.interfaceViewValue || {};
        const payload = created?.createArguments || created?.createArgument || created?.payload || {};
        const jsonStr = JSON.stringify({ ...payload, ...view });
        if (jsonStr.includes(senderPartyId) && jsonStr.includes(receiverPartyId)) {
          console.log(`[MatchingEngine]    ✅ Found allocation via ACS fallback: ${cid.substring(0, 24)}...`);
          return cid;
        }
      }

      for (let i = contracts.length - 1; i >= 0; i--) {
        const cid = contracts[i]?.createdEvent?.contractId || contracts[i]?.contractId;
        if (cid && !excludeCids?.has(cid)) {
          console.log(`[MatchingEngine]    ✅ Found allocation via ACS fallback (latest): ${cid.substring(0, 24)}...`);
          return cid;
        }
      }
    } catch (err) {
      console.error(`[MatchingEngine]    ❌ ACS allocation fallback failed: ${err.message?.substring(0, 150)}`);
    }

    return null;
  }

  /**
   * Find an ExchangeAllocation contract by querying the operator's ACS.
   * Used when interactive execute doesn't return the CID in its response.
   *
   * @param {string} operatorPartyId - The operator (observer on the EA)
   * @param {string} ownerPartyId - The owner/signatory of the EA
   * @param {string} tradeId - Trade ID embedded in allocationId
   * @param {string} side - "SELL" or "BUY"
   * @param {string} adminToken - Admin bearer token
   * @returns {Promise<string|null>} ExchangeAllocation contract ID or null
   */
  async _findExchangeAllocationByACS(operatorPartyId, ownerPartyId, tradeId, side, adminToken) {
    try {
      const packageId = config.canton.packageIds.clobExchange;
      const templateId = `${packageId}:Settlement:ExchangeAllocation`;
      const result = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [templateId],
        pageSize: 50,
      }, adminToken);
      const contracts = result?.activeContracts || result?.contracts || result || [];
      for (const contract of contracts) {
        const created = contract.createdEvent || contract;
        const payload = created?.createArguments || created?.payload || {};
        if (payload.owner === ownerPartyId && payload.side === side && payload.status === 'PENDING') {
          const allocId = payload.allocationId || '';
          if (allocId.includes(tradeId)) {
            const cid = created?.contractId;
            if (cid) return cid;
          }
        }
      }
    } catch (err) {
      console.warn(`[MatchingEngine]    EA ACS query failed: ${err.message?.substring(0, 100)}`);
    }
    return null;
  }

  setPollingInterval(ms) {
    this.pollingInterval = ms;
    console.log(`[MatchingEngine] Polling interval: ${ms}ms`);
  }

  /**
   * Run a single matching cycle on-demand (for serverless / API trigger).
   */
  async triggerMatchingCycle(targetPair = null) {
    this._resetToFastPolling();

    if (this.matchingInProgress) {
      const elapsed = Date.now() - this.matchingStartTime;
      if (elapsed > 25000) {
        console.warn(`[MatchingEngine] ⚠️ matchingInProgress stuck for ${elapsed}ms — force-resetting`);
        this.matchingInProgress = false;
      } else {
        if (targetPair) {
          this.pendingPairs.add(targetPair);
          console.log(`[MatchingEngine] ⏳ Queued ${targetPair} for matching after current cycle (${elapsed}ms in progress)`);
          return { success: false, reason: 'queued_for_next_cycle' };
        }
        console.log(`[MatchingEngine] ⚡ Skipping trigger — matching already in progress (${elapsed}ms)`);
        return { success: false, reason: 'matching_in_progress' };
      }
    }

    const now = Date.now();
    if (this._lastTriggerTime && (now - this._lastTriggerTime) < 2000) {
      if (targetPair) {
        this.pendingPairs.add(targetPair);
        return { success: false, reason: 'rate_limited_queued' };
      }
      return { success: false, reason: 'rate_limited' };
    }
    this._lastTriggerTime = now;

    const pairsToProcess = targetPair ? [targetPair] : this.tradingPairs;
    console.log(`[MatchingEngine] ⚡ On-demand cycle triggered for: ${pairsToProcess.join(', ')}`);
    const startTime = Date.now();

    try {
      this.matchingInProgress = true;
      this.matchingStartTime = startTime;

      const token = await this.getAdminToken();

      for (const tradingPair of pairsToProcess) {
        try {
          await this.processOrdersForPair(tradingPair, token);
        } catch (error) {
          if (!error.message?.includes('No contracts found')) {
            console.error(`[MatchingEngine] Trigger error for ${tradingPair}:`, error.message);
          }
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(`[MatchingEngine] ⚡ On-demand cycle complete in ${elapsed}ms`);

      return { success: true, elapsed, tradingPairs: pairsToProcess };
    } catch (error) {
      console.error(`[MatchingEngine] ⚡ On-demand cycle failed:`, error.message);
      if (error.message?.includes('401') || error.message?.includes('security-sensitive')) {
        this.invalidateToken();
      }
      return { success: false, error: error.message };
    } finally {
      this.matchingInProgress = false;
    }
  }

}

// Singleton
let matchingEngineInstance = null;

function getMatchingEngine() {
  if (!matchingEngineInstance) {
    matchingEngineInstance = new MatchingEngine();
  }
  return matchingEngineInstance;
}

module.exports = {
  MatchingEngine,
  getMatchingEngine,
};
