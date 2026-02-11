/**
 * Matching Engine Bot
 * 
 * Core exchange functionality - matches buy/sell orders and settles trades.
 * 
 * Flow:
 * 1. Poll Canton for OPEN Order contracts every N seconds
 * 2. Separate into buys/sells per trading pair
 * 3. Sort by price-time priority (FIFO)
 * 4. Find crossing orders (buy price >= sell price)
 * 5. For each match:
 *    a. Create SettlementInstruction (references locked Holdings)
 *    b. Execute Settlement_Execute (atomic DvP swap)
 *    c. FillOrder on both Order contracts (update filled/status)
 * 6. Broadcast trades via WebSocket
 * 
 * Uses Canton JSON Ledger API v2:
 * - POST /v2/state/active-contracts - Query orders
 * - POST /v2/commands/submit-and-wait-for-transaction - Execute matches
 * 
 * Self-trade prevention: DISABLED per client request
 */

const cantonService = require('./cantonService');
const config = require('../config');
const { getSettlementService } = require('./settlementService');
const tokenProvider = require('./tokenProvider');
const { REGISTRY_BACKEND_API, SCAN_PROXY_API, VALIDATOR_SCAN_PROXY_API, TEMPLATE_IDS } = require('../config/constants');

class MatchingEngine {
  constructor() {
    this.isRunning = false;
    this.pollingInterval = parseInt(config.matchingEngine?.intervalMs) || 2000;
    this.matchingInProgress = false;
    this.matchingStartTime = 0; // Track start time for deadlock detection
    this.adminToken = null;
    this.tokenExpiry = null;
    this.tradingPairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'CC/CBTC'];
    // Track holding CIDs that are known to be archived/stale
    // Prevents retrying the same stale orders every cycle
    this.staleHoldings = new Set();
    this.staleHoldingsLastClear = Date.now();
    this.STALE_CACHE_TTL = 120000; // Clear stale cache every 2 minutes

    // ═══ CRITICAL: Recently matched orders guard ═══
    // Prevents catastrophic re-matching loop where:
    // 1. Orders match → tokens transfer → FillOrder fails silently
    // 2. Orders remain OPEN → next cycle matches them AGAIN → tokens transfer AGAIN
    // 3. Infinite loop: duplicate trades + repeated token transfers
    // 
    // Key: "buyContractId::sellContractId" → timestamp of last match attempt
    this.recentlyMatchedOrders = new Map();
    this.RECENTLY_MATCHED_TTL = 180000; // 3 minutes cooldown before retry
  }

  /**
   * Get admin token with caching (refreshes every 25 min)
   */
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
    console.log(`[MatchingEngine] Started (interval: ${this.pollingInterval}ms, pairs: ${this.tradingPairs.join(', ')})`);
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
      await new Promise(r => setTimeout(r, this.pollingInterval));
    }
    console.log('[MatchingEngine] Stopped');
  }

  /**
   * Run one matching cycle across all trading pairs
   */
  async runMatchingCycle() {
    if (this.matchingInProgress) {
      // CRITICAL: Deadlock prevention for Vercel serverless.
      // On Vercel, if a previous invocation timed out mid-cycle, matchingInProgress
      // stays true in the cached module state, blocking ALL subsequent matching
      // until the container recycles (up to 30+ minutes!).
      // Safety valve: force-reset after 25 seconds.
      if (Date.now() - this.matchingStartTime > 25000) {
        console.warn('[MatchingEngine] ⚠️ matchingInProgress stuck for >25s — force-resetting (Vercel deadlock fix)');
        this.matchingInProgress = false;
      } else {
        console.log('[MatchingEngine] Skipping: matching already in progress');
        return;
      }
    }

    try {
      this.matchingInProgress = true;
      this.matchingStartTime = Date.now();
      const token = await this.getAdminToken();

      for (const pair of this.tradingPairs) {
        await this.processOrdersForPair(pair, token);
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
   * Process orders for a single trading pair
   */
  async processOrdersForPair(tradingPair, token) {
      const packageId = config.canton.packageIds?.clobExchange;
      const operatorPartyId = config.canton.operatorPartyId;
      
    if (!packageId || !operatorPartyId) return;

    try {
      // Query Canton for active Order contracts from BOTH packages
      // New package (v2.1.0): supports FillOrder with newAllocationCid for partial fills
      // Legacy package: older orders without partial fill allocation tracking
      const legacyPackageId = config.canton.packageIds?.legacy;
      const templateIdsToQuery = [`${packageId}:Order:Order`];
      if (legacyPackageId && legacyPackageId !== packageId) {
        templateIdsToQuery.push(`${legacyPackageId}:Order:Order`);
      }

      const contracts = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: templateIdsToQuery,
        pageSize: 200
      }, token);
      
      if (!contracts || contracts.length === 0) return;
      
      // Parse and filter orders for this pair
      const buyOrders = [];
      const sellOrders = [];
      
      for (const c of contracts) {
        const payload = c.payload || c.createArgument || {};
        
        if (payload.tradingPair !== tradingPair || payload.status !== 'OPEN') continue;

        const rawPrice = payload.price;
        // Handle DAML Optional: could be { Some: "123" } or direct string or null
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
        // Round remaining to 10 decimals to avoid JS floating point artifacts
        // e.g., 1.0 - 0.8 = 0.19999999999999996 → 0.2
        const remaining = parseFloat((qty - filled).toFixed(10));

        if (remaining <= 0) continue;

        // Detect which package this contract belongs to
        const contractTemplateId = c.templateId || `${packageId}:Order:Order`;
        const isNewPackage = contractTemplateId.startsWith(packageId);
        
        const order = {
          contractId: c.contractId,
          orderId: payload.orderId,
          owner: payload.owner,
          orderType: payload.orderType,
          orderMode: payload.orderMode || 'LIMIT',
          price: parsedPrice,
          quantity: qty,
          filled: filled,
          remaining: remaining,
          timestamp: payload.timestamp,
          tradingPair: payload.tradingPair,
          // Locked Holding CID for DvP settlement
          // IMPORTANT: "FILL_ONLY", "NONE", and empty strings are markers, not real contract IDs.
          // Only treat as locked if it looks like an actual Canton contract ID (hex, 128+ chars).
          lockedHoldingCid: (() => {
            const cid = payload.allocationCid || '';
            if (!cid || cid === 'FILL_ONLY' || cid === 'NONE' || cid.length < 40) return null;
            return cid;
          })(),
          // Track which package/templateId this order was created with
          templateId: contractTemplateId,
          isNewPackage: isNewPackage,
        };
        
        if (payload.orderType === 'BUY') {
          buyOrders.push(order);
        } else if (payload.orderType === 'SELL') {
          sellOrders.push(order);
        }
      }
      
      if (buyOrders.length === 0 || sellOrders.length === 0) return;

      // Count orders with locked holdings (eligible for DvP matching)
      const lockedBuys = buyOrders.filter(o => o.lockedHoldingCid && o.lockedHoldingCid !== '').length;
      const lockedSells = sellOrders.filter(o => o.lockedHoldingCid && o.lockedHoldingCid !== '').length;

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

      console.log(`[MatchingEngine] ${tradingPair}: ${buyOrders.length} buys (${lockedBuys} locked), ${sellOrders.length} sells (${lockedSells} locked)`);

      // Find and execute ONE match per cycle (contract IDs become stale after match)
      await this.findAndExecuteOneMatch(tradingPair, buyOrders, sellOrders, token);
      
          } catch (error) {
      if (error.message?.includes('401') || error.message?.includes('security-sensitive')) {
        this.invalidateToken();
          }
      // Don't log every cycle if just no orders
      if (!error.message?.includes('No contracts found')) {
        console.error(`[MatchingEngine] Error for ${tradingPair}:`, error.message);
        }
    }
  }
  
  /**
   * Find ONE crossing match and execute it
   * Only one per cycle because contract IDs change after exercise
   * 
   * Matching modes:
   * 1. DvP mode: Both sides have locked Holdings → full DvP settlement with atomic token swap
   * 2. Fill-only mode: One or both sides lack locked Holdings (e.g., Splice/CC/CBTC tokens
   *    that can't use custom Holding_Lock) → exercise FillOrder on both orders without DvP.
   *    The operator ensures token settlement separately.
   */
  async findAndExecuteOneMatch(tradingPair, buyOrders, sellOrders, token) {
    // Periodically clear stale caches so retries happen after cooldown
    const now = Date.now();
    if (now - this.staleHoldingsLastClear > this.STALE_CACHE_TTL) {
      if (this.staleHoldings.size > 0) {
        console.log(`[MatchingEngine] 🗑️ Clearing ${this.staleHoldings.size} stale holding entries`);
      }
      this.staleHoldings.clear();
      this.staleHoldingsLastClear = now;
    }

    // Clear expired entries from recentlyMatchedOrders
    for (const [key, ts] of this.recentlyMatchedOrders) {
      if (now - ts > this.RECENTLY_MATCHED_TTL) {
        this.recentlyMatchedOrders.delete(key);
      }
    }
    
    for (const buyOrder of buyOrders) {
      for (const sellOrder of sellOrders) {
        if (buyOrder.remaining <= 0 || sellOrder.remaining <= 0) continue;

        // Self-trade prevention disabled per client request (comment at top of file)
        // Uncomment the following to prevent self-trades:
        // if (buyOrder.owner === sellOrder.owner) continue;

        // ═══ CRITICAL: Skip recently matched order pairs ═══
        // Prevents catastrophic re-matching when FillOrder fails
        const matchKey = `${buyOrder.contractId}::${sellOrder.contractId}`;
        if (this.recentlyMatchedOrders.has(matchKey)) {
          continue; // Already attempted — wait for cooldown
        }

        const buyHasLock = buyOrder.lockedHoldingCid && buyOrder.lockedHoldingCid !== '';
        const sellHasLock = sellOrder.lockedHoldingCid && sellOrder.lockedHoldingCid !== '';

        // Skip orders with known-stale holding CIDs (from previous failed settlements)
        if (buyHasLock && this.staleHoldings.has(buyOrder.lockedHoldingCid)) continue;
        if (sellHasLock && this.staleHoldings.has(sellOrder.lockedHoldingCid)) continue;
        
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

        const matchQty = Math.min(buyOrder.remaining, sellOrder.remaining);
        // Round to 10 decimal places (Canton Numeric 10 precision) to avoid floating point artifacts
        const roundedQty = parseFloat(matchQty.toFixed(10));

        // Determine settlement mode
        const useDvP = buyHasLock && sellHasLock;

        console.log(`[MatchingEngine] ✅ MATCH: BUY ${buyPrice !== null ? buyPrice : 'MARKET'} x ${buyOrder.remaining} ↔ SELL ${sellPrice !== null ? sellPrice : 'MARKET'} x ${sellOrder.remaining}`);
        console.log(`[MatchingEngine]    Fill: ${roundedQty} @ ${matchPrice}`);
        if (useDvP) {
          console.log(`[MatchingEngine]    Buyer Holding: ${buyOrder.lockedHoldingCid.substring(0, 30)}...`);
          console.log(`[MatchingEngine]    Seller Holding: ${sellOrder.lockedHoldingCid.substring(0, 30)}...`);
          console.log(`[MatchingEngine]    Mode: DvP Settlement (both sides locked)`);
    } else {
          console.log(`[MatchingEngine]    Mode: Fill-Only (buy locked: ${buyHasLock}, sell locked: ${sellHasLock})`);
        }

        // Mark pair in local cache (useful if this warm instance runs again)
        // NOTE: On Vercel serverless, this cache is reset per invocation, so the
        // REAL guard against duplicate matches is FillOrder-first-with-abort in executeMatch.
        this.recentlyMatchedOrders.set(matchKey, Date.now());

        try {
          await this.executeMatch(tradingPair, buyOrder, sellOrder, roundedQty, matchPrice, token, useDvP);
          console.log(`[MatchingEngine] ✅ Match executed successfully`);
          return; // One match per cycle - exit
        } catch (error) {
          console.error(`[MatchingEngine] ❌ Match execution failed:`, error.message);
          
          // If it was a "contract not found" error, the order was already processed
          // by another serverless invocation. This is expected on Vercel — not a bug.
          if (error.message?.includes('already filled') || 
              error.message?.includes('could not be found') ||
              error.message?.includes('CONTRACT_NOT_FOUND')) {
            console.log(`[MatchingEngine] ℹ️ Order already processed by another invocation — skipping`);
            continue; // Try next pair
          }
          
          // If DvP failed for other reasons, try Fill-Only as a fallback
          if (useDvP && (error.message?.includes('WRONGLY_TYPED_CONTRACT') ||
              error.message?.includes('DvP settlement failed'))) {
            console.log(`[MatchingEngine] 🔄 DvP failed — retrying as Fill-Only...`);
            try {
              await this.executeMatch(tradingPair, buyOrder, sellOrder, roundedQty, matchPrice, token, false);
              console.log(`[MatchingEngine] ✅ Fill-Only fallback succeeded`);
              return; // Match succeeded
            } catch (fallbackError) {
              console.error(`[MatchingEngine] ❌ Fill-Only fallback also failed: ${fallbackError.message}`);
              if (buyHasLock) this.staleHoldings.add(buyOrder.lockedHoldingCid);
              if (sellHasLock) this.staleHoldings.add(sellOrder.lockedHoldingCid);
              continue;
            }
          }
          return; // For other errors, stop matching this cycle
        }
      }
    }
  }
  
  /**
   * Execute a match: Settlement (DvP token swap) + FillOrder on both orders
   * 
   * Two modes:
   * - useDvP=true:  Full DvP settlement (requires locked holdings) + FillOrder
   * - useDvP=false: Fill-only (exercise FillOrder on both orders, no token swap)
   * 
   * For partial fills: after DvP settlement archives the original locked holding,
   * we must re-lock the remainder holding and update the order's allocationCid
   * so the order can continue being matched in subsequent cycles.
   */
  async executeMatch(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, token, useDvP = true) {
        const packageId = config.canton.packageIds?.clobExchange;
        const operatorPartyId = config.canton.operatorPartyId;
    const [baseSymbol, quoteSymbol] = tradingPair.split('/');
    // Use string-based multiplication to avoid JavaScript floating point errors
    // e.g., 0.1 * 0.05 = 0.005000000000000001 in JS, but we need exactly 0.005
    const quoteAmount = parseFloat((matchQty * matchPrice).toFixed(10));
    
    let tradeContractId = null;
    let createdHoldings = [];

    // ═══════════════════════════════════════════════════════════════
    // DvP MODE: Settlement first (atomic token swap), then FillOrder
    // ═══════════════════════════════════════════════════════════════
    if (useDvP) {
      console.log(`[MatchingEngine] 🔄 DvP Settlement: ${matchQty} ${baseSymbol} ↔ ${quoteAmount} ${quoteSymbol}`);
      try {
        const settlementService = getSettlementService();
        const result = await settlementService.settleMatch({
          buyOrder: { ...buyOrder, tradingPair },
          sellOrder: { ...sellOrder, tradingPair },
          fillQuantity: matchQty,
          fillPrice: matchPrice,
        }, token);

        tradeContractId = result.tradeContractId;
        createdHoldings = result.createdHoldings || [];
        console.log(`[MatchingEngine] ✅ DvP complete: Trade ${tradeContractId?.substring(0, 25)}...`);
      } catch (settleError) {
        console.error(`[MatchingEngine] ❌ DvP Settlement failed: ${settleError.message}`);
        throw new Error(`DvP settlement failed: ${settleError.message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // FILL-ONLY MODE: FillOrder FIRST, THEN transfer tokens
    //
    // CRITICAL ORDERING: We MUST FillOrder before transferring tokens.
    // Previous bug: Transfer tokens first → FillOrder fails → orders stay OPEN
    //   → next cycle matches same orders → transfers tokens AGAIN → infinite loop!
    // 
    // New order: FillOrder first → orders marked FILLED on Canton
    //   → even if token transfer fails, orders won't be re-matched.
    //   → token transfer can be retried or reconciled manually.
    // ═══════════════════════════════════════════════════════════════
    if (!useDvP) {
      console.log(`[MatchingEngine] 📋 Fill-only mode: ${matchQty} ${baseSymbol} @ ${matchPrice} ${quoteSymbol}`);
      
      // ── STEP A: FillOrder on BOTH orders FIRST ──
      // This closes orders on Canton, preventing re-matching.
      // CRITICAL: If EITHER FillOrder fails, we ABORT the entire match.
      // On serverless (Vercel), a failed FillOrder usually means the contract
      // was already archived by a concurrent invocation → this is a duplicate match.
      // We must NOT create a trade or transfer tokens in that case.
      console.log(`[MatchingEngine] 📝 Filling orders FIRST (before token transfer)...`);

      // Fill buy order — MUST succeed
      const buyFillArg = { fillQuantity: matchQty.toString() };
      if (buyOrder.isNewPackage) {
        buyFillArg.newAllocationCid = 'FILL_ONLY';
      }
      try {
        await cantonService.exerciseChoice({
          token,
          actAsParty: [operatorPartyId],
          templateId: buyOrder.templateId || `${packageId}:Order:Order`,
          contractId: buyOrder.contractId,
          choice: 'FillOrder',
          choiceArgument: buyFillArg,
          readAs: [operatorPartyId, buyOrder.owner],
        });
        console.log(`[MatchingEngine] ✅ Buy order filled: ${buyOrder.orderId}`);
      } catch (fillError) {
        console.error(`[MatchingEngine] ❌ Buy FillOrder failed — ABORTING match: ${fillError.message}`);
        throw new Error(`Buy FillOrder failed (likely already filled): ${fillError.message}`);
      }

      // Fill sell order — MUST succeed
      const sellFillArg = { fillQuantity: matchQty.toString() };
      if (sellOrder.isNewPackage) {
        sellFillArg.newAllocationCid = 'FILL_ONLY';
      }
      try {
        await cantonService.exerciseChoice({
          token,
          actAsParty: [operatorPartyId],
          templateId: sellOrder.templateId || `${packageId}:Order:Order`,
          contractId: sellOrder.contractId,
          choice: 'FillOrder',
          choiceArgument: sellFillArg,
          readAs: [operatorPartyId, sellOrder.owner],
        });
        console.log(`[MatchingEngine] ✅ Sell order filled: ${sellOrder.orderId}`);
      } catch (fillError) {
        // Buy was already filled above — we can't undo it. Log a warning.
        // The sell order may have been filled by another invocation concurrently.
        console.error(`[MatchingEngine] ❌ Sell FillOrder failed — ABORTING match: ${fillError.message}`);
        console.warn(`[MatchingEngine] ⚠️ Buy order was already filled — sell may need manual reconciliation`);
        throw new Error(`Sell FillOrder failed (likely already filled): ${fillError.message}`);
      }

      console.log(`[MatchingEngine] ✅ Both orders filled — proceeding with token transfer`);

      // ── STEP B: Transfer tokens via Splice TransferInstruction ──
      const isSpliceBase = ['CC', 'CBTC'].includes(baseSymbol);
      const isSpliceQuote = ['CC', 'CBTC'].includes(quoteSymbol);
      let baseTransferOk = false;
      let quoteTransferOk = false;

      // Transfer base asset: seller → buyer
      try {
        console.log(`[MatchingEngine] 💰 Transferring ${matchQty} ${baseSymbol}: seller → buyer...`);
        baseTransferOk = await this.attemptSpliceTransfer(
          sellOrder.owner, buyOrder.owner, baseSymbol, matchQty, token
        );
      } catch (e) {
        console.warn(`[MatchingEngine] Splice transfer (base) threw: ${e.message}`);
        baseTransferOk = false;
      }
      if (!baseTransferOk && !isSpliceBase) {
        // Non-Splice (custom) tokens: mint as fallback
        try {
          const { getHoldingService } = require('./holdingService');
          const holdingService = getHoldingService();
          await holdingService.initialize();
          console.log(`[MatchingEngine] 💰 Minting ${matchQty} ${baseSymbol} for buyer (custom token)`);
          await holdingService.mintDirect(buyOrder.owner, baseSymbol, matchQty, token);
          baseTransferOk = true;
        } catch (mintErr) {
          console.error(`[MatchingEngine] ❌ Buyer credit FAILED: ${mintErr.message}`);
        }
      }
      if (baseTransferOk) {
        console.log(`[MatchingEngine] ✅ Buyer credited: +${matchQty} ${baseSymbol}`);
      } else {
        console.error(`[MatchingEngine] ❌ Base token transfer FAILED — orders are filled but tokens not moved. Manual reconciliation needed.`);
      }

      // Transfer quote asset: buyer → seller
      try {
        console.log(`[MatchingEngine] 💰 Transferring ${quoteAmount} ${quoteSymbol}: buyer → seller...`);
        quoteTransferOk = await this.attemptSpliceTransfer(
          buyOrder.owner, sellOrder.owner, quoteSymbol, quoteAmount, token
        );
      } catch (e) {
        console.warn(`[MatchingEngine] Splice transfer (quote) threw: ${e.message}`);
        quoteTransferOk = false;
      }
      if (!quoteTransferOk && !isSpliceQuote) {
        try {
          const { getHoldingService } = require('./holdingService');
          const holdingService = getHoldingService();
          await holdingService.initialize();
          console.log(`[MatchingEngine] 💰 Minting ${quoteAmount} ${quoteSymbol} for seller (custom token)`);
          await holdingService.mintDirect(sellOrder.owner, quoteSymbol, quoteAmount, token);
          quoteTransferOk = true;
        } catch (mintErr) {
          console.error(`[MatchingEngine] ❌ Seller credit FAILED: ${mintErr.message}`);
        }
      }
      if (quoteTransferOk) {
        console.log(`[MatchingEngine] ✅ Seller credited: +${quoteAmount} ${quoteSymbol}`);
      } else {
        console.error(`[MatchingEngine] ❌ Quote token transfer FAILED — orders are filled but tokens not moved. Manual reconciliation needed.`);
      }

      // ── STEP C: Create Trade record on Canton ──
      try {
        const tradeId = `trade-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const tradeResult = await cantonService.createContract({
          token,
          templateId: `${packageId}:Settlement:Trade`,
          createArguments: {
            tradeId: tradeId,
            operator: operatorPartyId,
            buyer: buyOrder.owner,
            seller: sellOrder.owner,
            baseInstrumentId: {
              issuer: operatorPartyId,
              symbol: baseSymbol,
              version: '1.0',
            },
            quoteInstrumentId: {
              issuer: operatorPartyId,
              symbol: quoteSymbol,
              version: '1.0',
            },
            baseAmount: matchQty.toString(),
            quoteAmount: quoteAmount.toString(),
            price: matchPrice.toString(),
            buyOrderId: buyOrder.orderId,
            sellOrderId: sellOrder.orderId,
            timestamp: new Date().toISOString(),
          },
          actAsParty: [operatorPartyId],
          readAs: [operatorPartyId, buyOrder.owner, sellOrder.owner],
        });
        tradeContractId = tradeResult?.contractId || tradeId;
        console.log(`[MatchingEngine] ✅ Trade record created: ${tradeContractId?.substring(0, 25)}...`);
      } catch (tradeErr) {
        console.warn(`[MatchingEngine] ⚠️ Trade record creation failed (non-critical): ${tradeErr.message}`);
        tradeContractId = `trade-${Date.now()}`;
      }
    }

    // ═══════════════════════════════════════════════════
    // STEP 2: Handle partial fills - Re-lock remainder holdings (DvP only)
    // 
    // After DvP, the original locked holdings are archived. Settlement creates
    // UNLOCKED remainder holdings for any excess. For partial fills, we must:
    // 1. Find the remainder holding (same owner, same asset, unlocked)
    // 2. Lock it for the remaining order quantity
    // 3. Pass the new locked CID to FillOrder via newAllocationCid
    // ═══════════════════════════════════════════════════
    const buyIsPartial = buyOrder.remaining > matchQty;
    const sellIsPartial = sellOrder.remaining > matchQty;

    let buyNewAllocationCid = null;
    let sellNewAllocationCid = null;

    if (useDvP && (buyIsPartial || sellIsPartial)) {
      console.log(`[MatchingEngine] 🔄 Partial fill detected - re-locking remainder holdings...`);
      const holdingTemplateId = config.constants?.TEMPLATE_IDS?.holding ||
        `${packageId}:Holding:Holding`;
      
      // For buyer partial fill: remainder is in quoteSymbol (e.g., USDT change)
      if (buyIsPartial) {
        const buyRemainder = createdHoldings.find(h => 
          h.owner === buyOrder.owner && h.symbol === quoteSymbol && !h.locked);
        if (buyRemainder) {
          try {
            console.log(`[MatchingEngine]    Locking buyer remainder: ${buyRemainder.amount} ${quoteSymbol}`);
            const lockResult = await cantonService.exerciseChoice({
              token,
              templateId: holdingTemplateId,
              contractId: buyRemainder.contractId,
              choice: 'Holding_Lock',
              choiceArgument: {
                lockHolder: operatorPartyId,
                lockReason: `ORDER:${buyOrder.orderId}`,
                lockAmount: buyRemainder.amount.toString(),
              },
              actAsParty: [buyOrder.owner, operatorPartyId],
              readAs: [operatorPartyId],
            });
            // Extract new locked holding CID from transaction events
            const events = lockResult?.transaction?.events || [];
            for (const event of events) {
              const created = event.created || event.CreatedEvent;
              if (created?.contractId && created.createArgument?.lock) {
                buyNewAllocationCid = created.contractId;
                console.log(`[MatchingEngine]    ✅ Buyer remainder locked: ${buyNewAllocationCid.substring(0, 25)}...`);
                break;
              }
            }
          } catch (lockErr) {
            console.error(`[MatchingEngine]    ⚠️ Failed to re-lock buyer remainder: ${lockErr.message}`);
          }
        } else {
          console.log(`[MatchingEngine]    ⚠️ No buyer remainder holding found in settlement events`);
        }
      }

      // For seller partial fill: remainder is in baseSymbol (e.g., BTC change)
      if (sellIsPartial) {
        const sellRemainder = createdHoldings.find(h => 
          h.owner === sellOrder.owner && h.symbol === baseSymbol && !h.locked);
        if (sellRemainder) {
          try {
            console.log(`[MatchingEngine]    Locking seller remainder: ${sellRemainder.amount} ${baseSymbol}`);
            const lockResult = await cantonService.exerciseChoice({
              token,
              templateId: holdingTemplateId,
              contractId: sellRemainder.contractId,
              choice: 'Holding_Lock',
              choiceArgument: {
                lockHolder: operatorPartyId,
                lockReason: `ORDER:${sellOrder.orderId}`,
                lockAmount: sellRemainder.amount.toString(),
              },
              actAsParty: [sellOrder.owner, operatorPartyId],
              readAs: [operatorPartyId],
            });
            // Extract new locked holding CID
            const events = lockResult?.transaction?.events || [];
            for (const event of events) {
              const created = event.created || event.CreatedEvent;
              if (created?.contractId && created.createArgument?.lock) {
                sellNewAllocationCid = created.contractId;
                console.log(`[MatchingEngine]    ✅ Seller remainder locked: ${sellNewAllocationCid.substring(0, 25)}...`);
                break;
              }
            }
          } catch (lockErr) {
            console.error(`[MatchingEngine]    ⚠️ Failed to re-lock seller remainder: ${lockErr.message}`);
          }
        } else {
          console.log(`[MatchingEngine]    ⚠️ No seller remainder holding found in settlement events`);
        }
      }
    }

    // ═══════════════════════════════════════════════════
    // STEP 3: FillOrder on both Order contracts (DvP mode only)
    // Fill-Only mode already handled FillOrder in STEP A above.
    // For partial fills, pass newAllocationCid to update the order's reference.
    // ═══════════════════════════════════════════════════
    if (useDvP) {
      console.log(`[MatchingEngine] 📝 Filling orders (DvP mode)...`);

      // Fill buy order
      try {
        const buyFillArg = { fillQuantity: matchQty.toString() };
        if (buyOrder.isNewPackage) {
          buyFillArg.newAllocationCid = buyNewAllocationCid ? buyNewAllocationCid : null;
        }
        await cantonService.exerciseChoice({
          token,
          actAsParty: [operatorPartyId],
          templateId: buyOrder.templateId || `${packageId}:Order:Order`,
          contractId: buyOrder.contractId,
          choice: 'FillOrder',
          choiceArgument: buyFillArg,
          readAs: [operatorPartyId, buyOrder.owner],
        });
        console.log(`[MatchingEngine] ✅ Buy order filled: ${buyOrder.orderId}${buyIsPartial ? ' (partial)' : ' (complete)'}`);
      } catch (fillError) {
        console.error(`[MatchingEngine] ❌ Buy FillOrder failed: ${fillError.message}`);
      }

      // Fill sell order
      try {
        const sellFillArg = { fillQuantity: matchQty.toString() };
        if (sellOrder.isNewPackage) {
          sellFillArg.newAllocationCid = sellNewAllocationCid ? sellNewAllocationCid : null;
        }
        await cantonService.exerciseChoice({
          token,
          actAsParty: [operatorPartyId],
          templateId: sellOrder.templateId || `${packageId}:Order:Order`,
          contractId: sellOrder.contractId,
          choice: 'FillOrder',
          choiceArgument: sellFillArg,
          readAs: [operatorPartyId, sellOrder.owner],
        });
        console.log(`[MatchingEngine] ✅ Sell order filled: ${sellOrder.orderId}${sellIsPartial ? ' (partial)' : ' (complete)'}`);
      } catch (fillError) {
        console.error(`[MatchingEngine] ❌ Sell FillOrder failed: ${fillError.message}`);
      }
    }

    // ═══════════════════════════════════════════════════
    // STEP 4: Record trade and broadcast via WebSocket
    // ═══════════════════════════════════════════════════
    const tradeRecord = {
      tradeId: tradeContractId || `trade-${Date.now()}`,
      tradingPair,
      buyer: buyOrder.owner,
      seller: sellOrder.owner,
      price: matchPrice.toString(),
      quantity: matchQty.toString(),
      buyOrderId: buyOrder.orderId,
      sellOrderId: sellOrder.orderId,
      timestamp: new Date().toISOString(),
      settlementType: useDvP ? 'DvP' : 'FillOnly',
    };

    // Add to UpdateStream for persistence (so trades API can serve it)
    try {
      const { getUpdateStream } = require('./cantonUpdateStream');
      const updateStream = getUpdateStream();
      if (updateStream && typeof updateStream.addTrade === 'function') {
        updateStream.addTrade(tradeRecord);
      }
    } catch (e) {
      // Non-critical
    }

    // Broadcast via WebSocket for real-time UI updates
    if (global.broadcastWebSocket) {
      global.broadcastWebSocket(`trades:${tradingPair}`, { type: 'NEW_TRADE', ...tradeRecord });
      global.broadcastWebSocket('trades:all', { type: 'NEW_TRADE', ...tradeRecord });
      global.broadcastWebSocket(`orderbook:${tradingPair}`, {
        type: 'TRADE_EXECUTED',
        buyOrderId: buyOrder.orderId,
        sellOrderId: sellOrder.orderId,
        fillQuantity: matchQty,
        fillPrice: matchPrice,
      });

      // Also broadcast balance updates for both parties so UI refreshes immediately
      global.broadcastWebSocket(`balance:${buyOrder.owner}`, {
        type: 'BALANCE_UPDATE',
        partyId: buyOrder.owner,
        timestamp: Date.now()
      });
      global.broadcastWebSocket(`balance:${sellOrder.owner}`, {
        type: 'BALANCE_UPDATE',
        partyId: sellOrder.owner,
        timestamp: Date.now()
      });
    }

    console.log(`[MatchingEngine] ═══ Match complete: ${matchQty} ${baseSymbol} @ ${matchPrice} ${quoteSymbol} ═══`);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Splice Token Standard Transfer (CC + CBTC)
  //
  //  Flow:
  //  1. Find sender's Splice/Amulet holding for the given symbol
  //  2. If holding > amount → Split via Splice Fungible interface
  //  3. Transfer the (split) holding → creates TransferInstruction (visible on explorer)
  //  4. Accept the TransferInstruction → creates new Holding for receiver
  //
  //  Choice context sources:
  //  - CBTC: Registry Backend API (registrar = cbtc-network)
  //  - CC (Amulet): Validator Scan Proxy API + AmuletRules enrichment
  //
  //  Returns true on success, false if Splice transfer is not possible.
  //  NO mintDirect fallback — TransferInstruction is the ONLY mechanism.
  // ═══════════════════════════════════════════════════════════════════
  async attemptSpliceTransfer(senderPartyId, receiverPartyId, symbol, amount, token) {
    const registryApi = REGISTRY_BACKEND_API || 'https://api.utilities.digitalasset-dev.com/api/token-standard';
    const validatorScanProxyApi = VALIDATOR_SCAN_PROXY_API || 'https://wallet.validator.dev.canton.wolfedgelabs.com/api/validator';
    const scanProxyApi = SCAN_PROXY_API || 'http://65.108.40.104:8088';
    const holdingInterfaceId = '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';
    const tiInterfaceId = TEMPLATE_IDS.spliceTransferInstructionInterfaceId ||
      '55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281:Splice.Api.Token.TransferInstructionV1:TransferInstruction';
    const operatorPartyId = config.canton.operatorPartyId;
    const isCC = symbol === 'CC';

    try {
      // ── Step 1: Find sender's Splice holding for this symbol ──
      const { getHoldingService } = require('./holdingService');
      const holdingService = getHoldingService();
      await holdingService.initialize();

      const holdings = await holdingService.getAvailableHoldings(senderPartyId, symbol, token);
      const spliceHoldings = (holdings || []).filter(h => (h.isSplice || h.isSpliceHolding || h.isAmulet) && h.amount >= 0.000001);
      if (spliceHoldings.length === 0) {
        console.log(`[MatchingEngine] No Splice ${symbol} holdings for sender — cannot do Splice transfer`);
        return false;
      }

      // Pick the smallest holding that covers the amount (minimize splits)
      spliceHoldings.sort((a, b) => a.amount - b.amount);
      let srcHolding = spliceHoldings.find(h => h.amount >= amount);
      if (!srcHolding) {
        console.log(`[MatchingEngine] No single Splice ${symbol} holding >= ${amount} for sender`);
        return false;
      }

      const holdingCid = srcHolding.contractId;
      console.log(`[MatchingEngine] Found ${isCC ? 'Amulet' : 'Splice'} ${symbol} holding: ${holdingCid.substring(0, 25)}... (${srcHolding.amount})`);

      // ── Step 2: For CC, fetch AmuletRules (needed for choice context enrichment) ──
      let amuletRulesData = null;
      if (isCC) {
        console.log(`[MatchingEngine] Fetching AmuletRules for CC transfer...`);
        // Try BFT Scan Proxy first (no auth)
        try {
          const arUrl = `${scanProxyApi}/api/scan/v0/amulet-rules`;
          const arResp = await fetch(arUrl, { method: 'GET' });
          if (arResp.ok) {
            amuletRulesData = await arResp.json();
            console.log(`[MatchingEngine] ✅ AmuletRules from BFT Scan Proxy`);
          }
        } catch (e) { /* try next */ }
        // Fallback: Validator Scan Proxy (with auth)
        if (!amuletRulesData) {
          try {
            const arUrl = `${validatorScanProxyApi}/v0/scan-proxy/amulet-rules`;
            const arResp = await fetch(arUrl, {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
            });
            if (arResp.ok) {
              amuletRulesData = await arResp.json();
              console.log(`[MatchingEngine] ✅ AmuletRules from Validator Scan Proxy`);
            }
          } catch (e2) {
            console.warn(`[MatchingEngine] Failed to fetch AmuletRules: ${e2.message}`);
          }
        }
        if (!amuletRulesData) {
          console.error(`[MatchingEngine] ❌ Cannot fetch AmuletRules — CC transfer impossible`);
          return false;
        }
      }

      // ── Helper: Get choice context from appropriate API ──
      // entityType: 'holding' or 'transfer-instruction'
      const getChoiceCtx = async (entityType, cid, choiceName) => {
        if (isCC) {
          // CC: Validator Scan Proxy registry proxy (with auth)
          const url = `${validatorScanProxyApi}/v0/scan-proxy/registry/${entityType}/v1/${encodeURIComponent(cid)}/choice-contexts/${choiceName}`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json',
            },
            body: JSON.stringify({ meta: {}, excludeDebugFields: true }),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`CC ${entityType}/${choiceName} context failed: ${resp.status} - ${errText.substring(0, 200)}`);
          }
          const data = await resp.json();
          return this._enrichContextForCC(data, amuletRulesData);
        } else {
          // CBTC: Registry Backend API (no auth needed)
          const adminPartyId = 'cbtc-network::12202a83c6f4082217c175e29bc53da5f2703ba2675778ab99217a5a881a949203ff';
          const adminEncoded = encodeURIComponent(adminPartyId);
          const url = `${registryApi}/v0/registrars/${adminEncoded}/registry/${entityType}/v1/${encodeURIComponent(cid)}/choice-contexts/${choiceName}`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meta: {}, excludeDebugFields: true }),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`CBTC ${entityType}/${choiceName} context failed: ${resp.status} - ${errText.substring(0, 200)}`);
          }
          return resp.json();
        }
      };

      // ── Step 3: Split if holding > amount ──
      let transferCid = holdingCid;
      const needsSplit = srcHolding.amount > amount + 0.0000001;

      if (needsSplit) {
        console.log(`[MatchingEngine] Splitting ${symbol} holding: ${srcHolding.amount} → ${amount} + remainder`);
        const splitCtx = await getChoiceCtx('holding', holdingCid, 'split');
        const splitDisclosed = (splitCtx.disclosedContracts || []).map(dc => ({
          templateId: dc.templateId, contractId: dc.contractId,
          createdEventBlob: dc.createdEventBlob, synchronizerId: dc.synchronizerId || '',
        }));
        const splitChoiceCtx = splitCtx.choiceContextData || splitCtx.choiceContext?.choiceContextData || { values: {} };

        const splitResult = await cantonService.exerciseChoice({
          token,
          templateId: holdingInterfaceId,
          contractId: holdingCid,
          choice: 'Split',
          choiceArgument: {
            splitAmounts: [amount.toString()],
            extraArgs: { context: splitChoiceCtx, meta: { values: {} } },
          },
          actAsParty: [senderPartyId, operatorPartyId],
          disclosedContracts: splitDisclosed,
        });

        // Find the split piece with the exact transfer amount
        const splitEvents = splitResult?.transaction?.events || [];
        for (const ev of splitEvents) {
          const created = ev.created || ev.CreatedEvent;
          if (!created?.contractId) continue;
          const ca = created.createArgument || {};
          const evAmt = parseFloat(ca.amount?.initialAmount || ca.amount || '0');
          if (Math.abs(evAmt - amount) < 0.0000001) {
            transferCid = created.contractId;
            break;
          }
        }
        console.log(`[MatchingEngine] ✅ Split done → transfer piece: ${transferCid.substring(0, 25)}...`);
      }

      // ── Step 4: Transfer holding → creates TransferInstruction ──
      console.log(`[MatchingEngine] Creating ${symbol} TransferInstruction...`);
      const txCtx = await getChoiceCtx('holding', transferCid, 'transfer');
      const txDisclosed = (txCtx.disclosedContracts || []).map(dc => ({
        templateId: dc.templateId, contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob, synchronizerId: dc.synchronizerId || '',
      }));
      const txChoiceCtx = txCtx.choiceContextData || txCtx.choiceContext?.choiceContextData || { values: {} };

      const txResult = await cantonService.exerciseChoice({
        token,
        templateId: holdingInterfaceId,
        contractId: transferCid,
        choice: 'Transfer',
        choiceArgument: {
          receiverPartyId: receiverPartyId,
          extraArgs: { context: txChoiceCtx, meta: { values: {} } },
        },
        actAsParty: [senderPartyId, operatorPartyId],
        disclosedContracts: txDisclosed,
      });

      // Find the TransferInstruction CID from transaction events
      let tiCid = null;
      const txEvents = txResult?.transaction?.events || [];
      for (const ev of txEvents) {
        const created = ev.created || ev.CreatedEvent;
        if (!created?.contractId) continue;
        const tpl = typeof created.templateId === 'string' ? created.templateId
          : `${created.templateId?.packageId || ''}:${created.templateId?.moduleName || ''}:${created.templateId?.entityName || ''}`;
        if (tpl.toLowerCase().includes('transfer') && !tpl.toLowerCase().includes('holding')) {
          tiCid = created.contractId;
          break;
        }
      }

      if (!tiCid) {
        console.warn(`[MatchingEngine] Transfer exercised but could not find TransferInstruction CID`);
        // Transfer was initiated (visible on explorer as a pending TransferInstruction)
        return true;
      }
      console.log(`[MatchingEngine] ✅ TransferInstruction created: ${tiCid.substring(0, 25)}...`);

      // ── Step 5: Accept the TransferInstruction ──
      console.log(`[MatchingEngine] Accepting ${symbol} TransferInstruction for receiver...`);
      const accCtx = await getChoiceCtx('transfer-instruction', tiCid, 'accept');
      const accDisclosed = (accCtx.disclosedContracts || []).map(dc => ({
        templateId: dc.templateId, contractId: dc.contractId,
        createdEventBlob: dc.createdEventBlob, synchronizerId: dc.synchronizerId || '',
      }));
      const accChoiceCtx = accCtx.choiceContextData || accCtx.choiceContext?.choiceContextData || { values: {} };

      await cantonService.exerciseChoice({
        token,
        templateId: tiInterfaceId,
        contractId: tiCid,
        choice: 'TransferInstruction_Accept',
        choiceArgument: {
          extraArgs: { context: accChoiceCtx, meta: { values: {} } },
        },
        actAsParty: [receiverPartyId, operatorPartyId],
        disclosedContracts: accDisclosed,
      });

      console.log(`[MatchingEngine] ✅ Splice transfer complete: ${amount} ${symbol} ${senderPartyId.substring(0, 20)}… → ${receiverPartyId.substring(0, 20)}…`);
      return true;
    } catch (error) {
      console.error(`[MatchingEngine] Splice ${symbol} transfer failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Enrich choice context and disclosed contracts with AmuletRules for CC transfers.
   * AmuletRules is required by the DSO for all Amulet operations.
   */
  _enrichContextForCC(ctxData, amuletRulesData) {
    if (!amuletRulesData) return ctxData;

    const disclosed = [...(ctxData.disclosedContracts || [])];
    const choiceCtx = ctxData.choiceContextData || ctxData.choiceContext?.choiceContextData || { values: {} };

    // Add AmuletRules to disclosed contracts if not already present
    if (amuletRulesData.createdEventBlob && !disclosed.find(dc => dc.contractId === amuletRulesData.contractId)) {
      disclosed.push({
        templateId: amuletRulesData.templateId,
        contractId: amuletRulesData.contractId,
        createdEventBlob: amuletRulesData.createdEventBlob,
        synchronizerId: amuletRulesData.synchronizerId || '',
      });
    }

    // Add amulet-rules to choice context values
    if (!choiceCtx.values) choiceCtx.values = {};
    if (amuletRulesData.contractId && !choiceCtx.values['amulet-rules']) {
      choiceCtx.values['amulet-rules'] = {
        tag: 'AV_ContractId',
        value: amuletRulesData.contractId,
      };
    }

    return { ...ctxData, disclosedContracts: disclosed, choiceContextData: choiceCtx };
  }

  setPollingInterval(ms) {
    this.pollingInterval = ms;
    console.log(`[MatchingEngine] Polling interval: ${ms}ms`);
  }

  /**
   * Run a single matching cycle on-demand (for serverless / API trigger).
   * @param {string|null} targetPair - If provided, only match this pair (faster).
   *                                   If null, process all pairs.
   * 
   * CONCURRENCY GUARD: Uses matchingInProgress to prevent overlapping cycles.
   * On Vercel, multiple API calls can arrive simultaneously (e.g., order placement
   * + cron + order book poll all triggering matching at once). Without this guard,
   * they race on the same orders, causing duplicate fills or stale contract errors.
   */
  async triggerMatchingCycle(targetPair = null) {
    // Concurrency guard — shared with runMatchingCycle
    if (this.matchingInProgress) {
      const elapsed = Date.now() - this.matchingStartTime;
      if (elapsed > 25000) {
        console.warn(`[MatchingEngine] ⚠️ matchingInProgress stuck for ${elapsed}ms — force-resetting`);
        this.matchingInProgress = false;
      } else {
        console.log(`[MatchingEngine] ⚡ Skipping trigger — matching already in progress (${elapsed}ms)`);
        return { success: false, reason: 'matching_in_progress' };
      }
    }

    // Rate limit: Don't trigger more than once per 10 seconds (within same warm instance)
    const now = Date.now();
    if (this._lastTriggerTime && (now - this._lastTriggerTime) < 10000) {
      const wait = Math.ceil((10000 - (now - this._lastTriggerTime)) / 1000);
      console.log(`[MatchingEngine] ⚡ Rate limited — wait ${wait}s`);
      return { success: false, reason: `rate_limited_${wait}s` };
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
