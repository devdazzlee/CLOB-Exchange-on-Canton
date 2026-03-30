/**
 * Matching Engine Bot — Server-Side Auto-Settlement
 *
 * Core exchange functionality — matches buy/sell orders and settles trades
 * instantly using stored signing keys (same pattern as autoAcceptService).
 *
 * Settlement Flow (User-to-User, Server-Signed):
 * 1. Poll Canton for OPEN Order contracts via WebSocket streaming read model
 * 2. Separate into buys/sells per trading pair
 * 3. Sort by price-time priority (FIFO)
 * 4. Find crossing orders (buy price >= sell price)
 * 5. For each match:
 *    a. Retrieve stored signing keys for both parties
 *    b. Withdraw seller's self-allocation (server signs as seller)
 *    c. Withdraw buyer's self-allocation (server signs as buyer)
 *    d. Create 2-leg Splice allocation: seller→buyer (base), buyer→seller (quote)
 *    e. Create ExchangeAllocation for both parties (embed consent on-chain)
 *    f. ATOMIC: Exercise Execute_DvP on seller's EA — ONE Canton TX
 *       DAML auth carry-forward gives {executor, seller, buyer} authority
 *       Both Allocation_ExecuteTransfer run inside that single transaction
 *    g. FillOrder on both Canton contracts
 *    h. Create Trade record, trigger stop-loss, broadcast via WebSocket
 *
 * Order placement: self-allocation (sender=receiver=user)
 * Settlement: server signs using stored keys — instant, no manual interaction
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
    this.matchLoop();
  }

  stop() {
    console.log('[MatchingEngine] Stopping...');
    this.isRunning = false;
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

        // Extract allocationCid (Token Standard allocation contract ID)
        // '#0' is a relative reference from single-sign tx — NOT a real contract ID.
        const rawAllocationCid = payload.allocationCid || '';
        const isValidCid = rawAllocationCid
          && rawAllocationCid !== 'FILL_ONLY'
          && rawAllocationCid !== 'NONE'
          && !rawAllocationCid.startsWith('#')
          && rawAllocationCid.length >= 10;
        let allocationCid = isValidCid ? rawAllocationCid : null;
        if (!allocationCid && payload.orderId) {
          try {
            const { getAllocationContractIdForOrder } = require('./order-service');
            allocationCid = await getAllocationContractIdForOrder(payload.orderId);
          } catch (_) { /* best effort */ }
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

        try {
          await this.executeMatch(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, token);
          console.log(`[MatchingEngine] ✅ Match executed successfully via Allocation API`);
          // Mark both order IDs as settled — prevents re-match even if streaming
          // model briefly shows them with a new contractId after FillOrder.
          this._settledOrderIds.set(buyOrder.orderId, Date.now());
          this._settledOrderIds.set(sellOrder.orderId, Date.now());
          // Also blacklist their allocation CIDs
          if (buyOrder.allocationContractId) this._archivedAllocationCids.add(buyOrder.allocationContractId);
          if (sellOrder.allocationContractId) this._archivedAllocationCids.add(sellOrder.allocationContractId);
          // Reset circuit breaker on success
          this._consecutiveSettlementFailures = 0;
          // Update remaining quantities in-place for batch execution.
          // After a match, reduce both orders' remaining so the batch loop
          // can find the next crossing pair without re-querying Canton.
          buyOrder.remaining = buyOrder.remainingDecimal.minus(matchQty).toNumber();
          buyOrder.remainingDecimal = buyOrder.remainingDecimal.minus(matchQty);
          sellOrder.remaining = sellOrder.remainingDecimal.minus(matchQty).toNumber();
          sellOrder.remainingDecimal = sellOrder.remainingDecimal.minus(matchQty);
          return true;
        } catch (error) {
          this._consecutiveSettlementFailures++;
          this._totalFailuresSinceStart++;
          const fullErrBody = error.response?.data ? JSON.stringify(error.response.data).substring(0, 1500) : '';
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

          // Signing key missing — the external party hasn't stored their key yet.
          // Don't quarantine — the key may arrive when they re-login or place an order.
          if (error.message?.includes('SIGNING_KEY_MISSING')) {
            console.warn(`[MatchingEngine] ⚠️ Signing key not available for external party — skipping match (will retry when key is stored)`);
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
   * Execute a match using ATOMIC DvP settlement via Execute_DvP.
   *
   * Settlement flow:
   * 1. Withdraw seller's self-allocation (server signs with seller's stored key)
   * 2. Withdraw buyer's self-allocation (server signs with buyer's stored key)
   * 3. Create directional Splice allocations (seller→buyer base, buyer→seller quote)
   * 4. ATOMIC DvP via ExchangeAllocation (Settlement.daml):
   *    a. Create ExchangeAllocation for seller + buyer (embed consent on-chain)
   *    b. Fetch ExtraArgs from registries for both Splice allocations
   *    c. Exercise Execute_DvP on seller's EA — SINGLE non-interactive TX:
   *       - Operator alone in actAs, Canton auto-signs
   *       - DAML auth carry-forward: seller EA signatory + buyer EA signatory
   *         = {executor, seller, buyer} — satisfies allocationControllers
   *       - Both Allocation_ExecuteTransfer run inside one transaction
   * 5. FillOrder on both Canton order contracts
   * 6. Trigger stop-loss + broadcast via WebSocket
   *
   * Both transfers are REAL Canton token movements in ONE transaction.
   * The exchange settles with its OWN key — users sign only at order placement.
   *
   * @see Settlement.daml — ExchangeAllocation, Execute_DvP, Execute_Settlement_WithTransfers
   * @see https://docs.digitalasset.com/build/3.4/sdlc-howtos/smart-contracts/develop/patterns/propose-accept.html
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
    // At match time, SERVER settles ATOMICALLY using stored signing keys:
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
    const userRegistry = require('../state/userRegistry');
    const { signHash } = require('./serverSigner');

    // ═══ Step 0: Retrieve stored signing keys for both parties ═══
    const sellerKey = await userRegistry.getSigningKey(sellOrder.owner);
    const buyerKey = await userRegistry.getSigningKey(buyOrder.owner);
    if (!sellerKey?.keyBase64 || !sellerKey?.fingerprint) {
      throw new Error(`SIGNING_KEY_MISSING: No stored signing key for seller ${sellOrder.owner.substring(0, 30)}...`);
    }
    if (!buyerKey?.keyBase64 || !buyerKey?.fingerprint) {
      throw new Error(`SIGNING_KEY_MISSING: No stored signing key for buyer ${buyOrder.owner.substring(0, 30)}...`);
    }
    console.log(`[MatchingEngine]    ✅ Signing keys retrieved for both parties`);

    const adminToken = await tokenProvider.getServiceToken();
    const updateIds = [];

    // ═══ SETTLEMENT: Single CreateAndExercise TX (TradeSettlement::DoSettle) ═══
    // All settlement steps happen in ONE Canton transaction (single updateId).
    // TX 1 (order placement): AllocationFactory_Allocate self-alloc — already done per party.
    // TX 2 (settlement): CreateAndExercise TradeSettlement → DoSettle.
    //   Inside DoSettle (DAML): withdraw both self-allocs, create directional allocs,
    //   execute both Allocation_ExecuteTransfer legs atomically.
    console.log(`[MatchingEngine]    Building settlement: CreateAndExercise TradeSettlement::DoSettle`);

    // Fetch locked holding CIDs from self-allocations first.
    // At settlement time the holdings are locked inside the self-allocs, so
    // listHoldingUtxos(false) returns empty. We use listHoldingUtxos(true) to
    // get the locked CIDs and pass them as overrideHoldingCids to the factory API.
    const [sellerHoldingCids, buyerHoldingCids] = await Promise.all([
      sdkClient.getHoldingCidsForSettlement(sellOrder.owner, baseSymbol),
      sdkClient.getHoldingCidsForSettlement(buyOrder.owner, quoteSymbol),
    ]);
    console.log(`[MatchingEngine]    Seller locked holdings (${baseSymbol}): ${sellerHoldingCids.length}`);
    console.log(`[MatchingEngine]    Buyer locked holdings (${quoteSymbol}): ${buyerHoldingCids.length}`);

    if (sellerHoldingCids.length === 0) {
      throw new Error(`SELLER_HOLDINGS_MISSING: No locked ${baseSymbol} holdings found for seller — self-allocation may be expired or missing`);
    }
    if (buyerHoldingCids.length === 0) {
      throw new Error(`BUYER_HOLDINGS_MISSING: No locked ${quoteSymbol} holdings found for buyer — self-allocation may be expired or missing`);
    }

    // Fetch allocation commands AND withdrawal ExtraArgs in parallel.
    // Withdrawal ExtraArgs: Allocation_Withdraw on a CC (Amulet) self-alloc
    // requires the "expire-lock" AmuletRules context. Without it, DAML throws:
    //   "Missing context entry for: expire-lock"
    // We fetch these upfront using the known self-alloc CIDs.
    // Factory ExtraArgs are reused for both Allocate and ExecuteTransfer steps.
    const [ccBuild, cbtcBuild, ccWithdrawData, cbtcWithdrawData] = await Promise.all([
      sdkClient.buildAllocationInteractiveCommand(
        sellOrder.owner, buyOrder.owner, matchQtyStr, baseSymbol, operatorPartyId, `${tradeId}-leg-base`, sellerHoldingCids
      ),
      sdkClient.buildAllocationInteractiveCommand(
        buyOrder.owner, sellOrder.owner, quoteAmountStr, quoteSymbol, operatorPartyId, `${tradeId}-leg-quote`, buyerHoldingCids
      ),
      sdkClient.fetchAllocationWithdrawArgs(sellOrder.allocationContractId, baseSymbol),
      sdkClient.fetchAllocationWithdrawArgs(buyOrder.allocationContractId, quoteSymbol),
    ]);

    if (!ccBuild?.command) throw new Error('Failed to build CC allocation command for settlement');
    if (!cbtcBuild?.command) throw new Error('Failed to build CBTC allocation command for settlement');

    const ccFactoryId = ccBuild.command.ExerciseCommand.contractId;
    const ccChoiceArg = ccBuild.command.ExerciseCommand.choiceArgument;
    const ccAllocSpec = ccChoiceArg.allocation;
    const ccAllocExtraArgs = ccChoiceArg.extraArgs;   // used for both Allocate and ExecuteTransfer
    const ccExpectedAdmin = ccChoiceArg.expectedAdmin;

    const cbtcFactoryId = cbtcBuild.command.ExerciseCommand.contractId;
    const cbtcChoiceArg = cbtcBuild.command.ExerciseCommand.choiceArgument;
    const cbtcAllocSpec = cbtcChoiceArg.allocation;
    const cbtcAllocExtraArgs = cbtcChoiceArg.extraArgs;  // used for both Allocate and ExecuteTransfer
    const cbtcExpectedAdmin = cbtcChoiceArg.expectedAdmin;

    console.log(`[MatchingEngine]    CC factory:   ${ccFactoryId?.substring(0, 24)}...`);
    console.log(`[MatchingEngine]    CBTC factory: ${cbtcFactoryId?.substring(0, 24)}...`);
    console.log(`[MatchingEngine]    CC withdraw disclosed: ${ccWithdrawData.disclosedContracts?.length || 0}`);
    console.log(`[MatchingEngine]    CBTC withdraw disclosed: ${cbtcWithdrawData.disclosedContracts?.length || 0}`);

    // Collect all disclosed contracts needed for the TX (deduped by CID)
    const disclosedByContractId = new Map();
    for (const dc of [
      ...(ccBuild.disclosedContracts || []),
      ...(cbtcBuild.disclosedContracts || []),
      ...(ccWithdrawData.disclosedContracts || []),
      ...(cbtcWithdrawData.disclosedContracts || []),
    ]) {
      if (dc?.contractId) disclosedByContractId.set(dc.contractId, dc);
    }
    const disclosedContracts = Array.from(disclosedByContractId.values());

    const tradeSettlementTemplateId = `${packageId}:Settlement:TradeSettlement`;

    // Single CreateAndExercise command — creates TradeSettlement AND exercises DoSettle atomically.
    // This satisfies Canton's "1 interactive command per prepare" requirement.
    // DoSettle internally: withdraw both self-allocs → create 2 directional allocs → execute both.
    const createAndExerciseCmd = {
      CreateAndExerciseCommand: {
        templateId: tradeSettlementTemplateId,
        createArguments: {
          tradeId,
          seller: sellOrder.owner,
          buyer: buyOrder.owner,
          executor: operatorPartyId,
          sellerSelfAllocCid: sellOrder.allocationContractId,
          buyerSelfAllocCid: buyOrder.allocationContractId,
          tradingPair,
          createdAt: new Date().toISOString(),
        },
        choice: 'DoSettle',
        choiceArgument: {
          ccFactory: ccFactoryId,
          cbtcFactory: cbtcFactoryId,
          // Real AmuletRules "expire-lock" context fetched from registry
          ccWithdrawArgs: ccWithdrawData.extraArgs,
          cbtcWithdrawArgs: cbtcWithdrawData.extraArgs,
          ccAllocSpec,
          cbtcAllocSpec,
          // Reuse factory ExtraArgs for Allocate and ExecuteTransfer (same AmuletRules context)
          ccAllocArgs: ccAllocExtraArgs,
          cbtcAllocArgs: cbtcAllocExtraArgs,
          ccExpectedAdmin,
          cbtcExpectedAdmin,
          ccExecuteArgs: ccAllocExtraArgs,    // same context as alloc — valid for same-TX execute
          cbtcExecuteArgs: cbtcAllocExtraArgs, // same context as alloc — valid for same-TX execute
        },
      },
    };

    // Interactive submission: actAs=[seller, buyer, operator].
    // seller + buyer sign hash; operator is local and auto-signs on execute.
    const settlePrepared = await cantonService.prepareInteractiveSubmission({
      token: adminToken,
      actAsParty: [sellOrder.owner, buyOrder.owner, operatorPartyId],
      commands: [createAndExerciseCmd],
      readAs: [operatorPartyId, sellOrder.owner, buyOrder.owner],
      synchronizerId,
      disclosedContracts: disclosedContracts.length > 0 ? disclosedContracts : null,
    });

    const settleHash = settlePrepared.preparedTransactionHash;
    console.log(`[MatchingEngine]    Settlement TX hash: ${settleHash?.substring(0, 16)}...`);

    const [sellerSettleSig, buyerSettleSig] = await Promise.all([
      signHash(sellerKey.keyBase64, settleHash),
      signHash(buyerKey.keyBase64, settleHash),
    ]);

    const settleResult = await cantonService.executeInteractiveSubmission({
      preparedTransaction: settlePrepared.preparedTransaction,
      partySignatures: {
        signatures: [
          {
            party: sellOrder.owner,
            signatures: [{
              format: 'SIGNATURE_FORMAT_RAW',
              signature: sellerSettleSig,
              signedBy: sellerKey.fingerprint,
              signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
            }],
          },
          {
            party: buyOrder.owner,
            signatures: [{
              format: 'SIGNATURE_FORMAT_RAW',
              signature: buyerSettleSig,
              signedBy: buyerKey.fingerprint,
              signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
            }],
          },
        ],
      },
      hashingSchemeVersion: settlePrepared.hashingSchemeVersion || 'HASHING_SCHEME_VERSION_V2',
    }, adminToken);

    const settleUpdateId = settleResult?.transaction?.updateId || settleResult?.updateId;
    if (settleUpdateId) updateIds.push({ step: 'trade-settlement-do-settle', updateId: settleUpdateId });
    console.log(`[MatchingEngine]    ✅ TradeSettlement::DoSettle executed (updateId: ${settleUpdateId || 'N/A'})`);

    console.log(`[MatchingEngine] ✅ Settlement complete — all steps in single Canton TX`);
    if (updateIds.length > 0) {
      console.log(`[MatchingEngine]    All updateIds for Canton Explorer verification:`);
      for (const u of updateIds) {
        console.log(`[MatchingEngine]      ${u.step}: ${u.updateId}`);
      }
    }

    // ═══ Step 6: FillOrder on Canton + record trade ═══
    const streaming = this._getStreamingModel();

    // FillOrder on both orders
    console.log(`[MatchingEngine]    Step 6: Filling orders on-chain...`);
    const fillOrder = async (order, side) => {
      try {
        await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: [operatorPartyId],
          templateId: order.templateId || `${packageId}:Order:Order`,
          contractId: order.contractId,
          choice: 'FillOrder',
          choiceArgument: {
            fillQuantity: matchQtyStr,
            newAllocationCid: null,
          },
          readAs: [operatorPartyId, order.owner],
        });
        console.log(`[MatchingEngine]    ✅ ${side} order filled: ${order.orderId}`);
        if (streaming) streaming.evictOrder(order.contractId);
      } catch (fillErr) {
        const msg = fillErr.message || '';
        if (msg.includes('CONTRACT_NOT_FOUND') || msg.includes('already filled') || msg.includes('INACTIVE_CONTRACTS')) {
          console.warn(`[MatchingEngine]    ${side} FillOrder skipped (contract finalized): ${msg.substring(0, 80)}`);
          if (streaming) streaming.evictOrder(order.contractId);
        } else {
          console.warn(`[MatchingEngine]    ⚠️ ${side} FillOrder failed (non-critical): ${msg.substring(0, 100)}`);
        }
      }
    };
    await fillOrder(buyOrder, 'Buy');
    await fillOrder(sellOrder, 'Sell');

    // Record trade in PostgreSQL
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

    // Create Trade record on Canton
    let tradeContractId = null;
    try {
      const tradeTemplateId = `${packageId}:Settlement:Trade`;
      const tradeResult = await cantonService.createContractWithTransaction({
        token: adminToken,
        actAsParty: operatorPartyId,
        templateId: tradeTemplateId,
        createArguments: {
          tradeId,
          operator: operatorPartyId,
          buyer: buyOrder.owner,
          seller: sellOrder.owner,
          baseInstrumentId: { issuer: operatorPartyId, symbol: baseSymbol, version: '1.0' },
          quoteInstrumentId: { issuer: operatorPartyId, symbol: quoteSymbol, version: '1.0' },
          baseAmount: matchQtyStr,
          quoteAmount: quoteAmountStr,
          price: matchPrice.toString(),
          buyOrderId: buyOrder.orderId,
          sellOrderId: sellOrder.orderId,
          timestamp: new Date().toISOString(),
        },
        readAs: [operatorPartyId, buyOrder.owner, sellOrder.owner],
        synchronizerId,
      });
      const events = tradeResult?.transaction?.events || [];
      for (const event of events) {
        const created = event.created || event.CreatedEvent;
        if (created?.contractId) { tradeContractId = created.contractId; break; }
      }
      console.log(`[MatchingEngine]    ✅ Trade record: ${tradeContractId?.substring(0, 25)}...`);
    } catch (tradeErr) {
      console.warn(`[MatchingEngine]    ⚠️ Trade record creation failed (non-critical): ${tradeErr.message}`);
      tradeContractId = tradeId;
    }

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

    console.log(`[MatchingEngine] ═══ Trade complete: ${matchQtyStr} ${baseSymbol} @ ${matchPrice} ${quoteSymbol} (user-to-user, server-signed) ═══`);
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
   * Used before creating new allocations so that _findAllocationByACS can
   * distinguish newly created allocations from stale ones left by previous
   * failed settlement attempts.
   *
   * @param {string} operatorPartyId - The operator party
   * @param {string} adminToken - Admin bearer token
   * @returns {Promise<Set<string>>} Set of existing allocation contract IDs
   */
  async _snapshotAllocationCids(operatorPartyId, adminToken) {
    const cids = new Set();
    try {
      const { getCantonSDKClient } = require('./canton-sdk-client');
      const sdkClient = getCantonSDKClient();
      // Use SDK pending allocations (fastest path)
      const pending = await sdkClient.fetchPendingAllocations(operatorPartyId);
      for (const row of (pending || [])) {
        const cid = row?.contractId || row?.activeContract?.createdEvent?.contractId;
        if (cid) cids.add(cid);
      }
    } catch (_) { /* ignore — snapshot is best-effort */ }

    // Also query ACS for allocations as fallback
    try {
      const cantonService = require('./cantonService');
      const ALLOCATION_INTERFACE = '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation';
      const result = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [ALLOCATION_INTERFACE],
      }, adminToken);
      for (const contract of (result || [])) {
        const cid = contract?.contractId || contract?.createdEvent?.contractId;
        if (cid) cids.add(cid);
      }
    } catch (_) { /* ignore */ }

    return cids;
  }

  /**
   * Find a recently created Allocation contract by querying Canton.
   * Used when executeInteractiveSubmission doesn't return the CID in its response.
   *
   * Strategy:
   * 1. SDK fetchPendingAllocations (uses proper allocation view, most reliable)
   * 2. ACS query with Allocation interface as fallback
   *
   * @param {string} executorPartyId - The operator party (executor of the allocation)
   * @param {string} senderPartyId - Sender of the allocation
   * @param {string} receiverPartyId - Receiver of the allocation
   * @param {string} adminToken - Admin bearer token
   * @param {Set<string>} [excludeCids] - CIDs to exclude (already found for other legs)
   * @returns {Promise<string|null>} Allocation contract ID or null
   */
  async _findAllocationByACS(executorPartyId, senderPartyId, receiverPartyId, adminToken, excludeCids = null) {
    const { getCantonSDKClient } = require('./canton-sdk-client');
    const sdkClient = getCantonSDKClient();

    // ── Strategy 1: SDK pending allocations for sender ──
    try {
      const pending = await sdkClient.fetchPendingAllocations(senderPartyId);
      if (pending?.length > 0) {
        for (const row of pending) {
          const cid = row?.contractId || row?.activeContract?.createdEvent?.contractId;
          if (!cid) continue;
          if (excludeCids?.has(cid)) continue;
          console.log(`[MatchingEngine]    ✅ Found allocation via SDK pending view: ${cid.substring(0, 24)}...`);
          return cid;
        }
      }
    } catch (err) {
      console.warn(`[MatchingEngine]    SDK pending allocations failed: ${err.message?.substring(0, 100)}`);
    }

    // ── Strategy 2: ACS query with Allocation interface ──
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
      // Search through contracts — try to match sender/receiver from payload or interface view
      for (const contract of contracts) {
        const created = contract.createdEvent || contract;
        const cid = created?.contractId;
        if (!cid || excludeCids?.has(cid)) continue;
        // Check interface view and create arguments for sender/receiver hints
        const view = created?.interfaceViews?.[0]?.viewValue || created?.interfaceViewValue || {};
        const payload = created?.createArguments || created?.createArgument || created?.payload || {};
        const jsonStr = JSON.stringify({ ...payload, ...view });
        if (jsonStr.includes(senderPartyId) && jsonStr.includes(receiverPartyId)) {
          console.log(`[MatchingEngine]    ✅ Found allocation via ACS query: ${cid.substring(0, 24)}...`);
          return cid;
        }
      }

      // Fallback: return most recent allocation that isn't excluded
      for (let i = contracts.length - 1; i >= 0; i--) {
        const cid = contracts[i]?.createdEvent?.contractId || contracts[i]?.contractId;
        if (cid && !excludeCids?.has(cid)) {
          console.log(`[MatchingEngine]    ✅ Found allocation via ACS (latest): ${cid.substring(0, 24)}...`);
          return cid;
        }
      }

      console.warn(`[MatchingEngine]    ⚠️ ACS query returned ${contracts.length} allocations but none matched`);
    } catch (err) {
      console.error(`[MatchingEngine]    ❌ ACS allocation query failed: ${err.message?.substring(0, 150)}`);
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
