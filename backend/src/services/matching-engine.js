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
const { getHoldingService } = require('./holdingService');
const tokenProvider = require('./tokenProvider');
const { TEMPLATE_IDS } = require('../config/constants');

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
    this.RECENTLY_MATCHED_TTL = 30000; // 30 seconds cooldown (was 180s — too aggressive)

    // ═══ Pending pairs queue ═══
    // When a matching trigger arrives while a cycle is already running,
    // queue the pair so it's processed immediately after the current cycle.
    this.pendingPairs = new Set();
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

      // ═══ Process any pairs queued by order placement triggers ═══
      // These were queued because matchingInProgress was true during the trigger.
      // Process them IMMEDIATELY (no polling delay) so orders match fast.
      if (this.pendingPairs.size > 0) {
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
   * TWO MODES:
   * 1. ATOMIC DvP — Both sides have locked custom Holdings → Settlement_Execute
   * 2. FILL-ONLY — One or both sides lack locked holdings → FillOrder + mintDirect
   *
   * Fill-Only is required for Splice tokens (CC/CBTC) whose holdings can't be locked.
   * mintDirect creates new custom holdings for the counterparties to reflect the trade.
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

        // ═══ CRITICAL: Skip recently matched order pairs ═══
        const matchKey = `${buyOrder.contractId}::${sellOrder.contractId}`;
        if (this.recentlyMatchedOrders.has(matchKey)) {
          continue;
        }
        
        const buyHasLock = buyOrder.lockedHoldingCid && buyOrder.lockedHoldingCid !== '';
        const sellHasLock = sellOrder.lockedHoldingCid && sellOrder.lockedHoldingCid !== '';

        // Skip orders with known-stale holding CIDs (from previous failed settlements)
        if (buyHasLock && this.staleHoldings.has(buyOrder.lockedHoldingCid)) continue;
        if (sellHasLock && this.staleHoldings.has(sellOrder.lockedHoldingCid)) continue;
        
        // Determine settlement mode
        const useDvP = buyHasLock && sellHasLock;

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
        const roundedQty = parseFloat(matchQty.toFixed(10));

        const mode = useDvP ? 'ATOMIC DvP' : 'FILL-ONLY (mintDirect)';
        console.log(`[MatchingEngine] ✅ MATCH FOUND: BUY ${buyPrice !== null ? buyPrice : 'MARKET'} x ${buyOrder.remaining} ↔ SELL ${sellPrice !== null ? sellPrice : 'MARKET'} x ${sellOrder.remaining}`);
        console.log(`[MatchingEngine]    Fill: ${roundedQty} @ ${matchPrice} | Mode: ${mode}`);
        if (buyHasLock) console.log(`[MatchingEngine]    Buyer Holding: ${buyOrder.lockedHoldingCid.substring(0, 30)}...`);
        if (sellHasLock) console.log(`[MatchingEngine]    Seller Holding: ${sellOrder.lockedHoldingCid.substring(0, 30)}...`);

        this.recentlyMatchedOrders.set(matchKey, Date.now());

        try {
          await this.executeMatch(tradingPair, buyOrder, sellOrder, roundedQty, matchPrice, token, useDvP);
          console.log(`[MatchingEngine] ✅ Match executed successfully via ${mode}`);
          return; // One match per cycle
        } catch (error) {
          console.error(`[MatchingEngine] ❌ Match execution failed:`, error.message);
          
          if (error.message?.includes('already filled') || 
              error.message?.includes('could not be found') ||
              error.message?.includes('CONTRACT_NOT_FOUND')) {
            console.log(`[MatchingEngine] ℹ️ Order already processed — skipping`);
            if (buyHasLock) this.staleHoldings.add(buyOrder.lockedHoldingCid);
            if (sellHasLock) this.staleHoldings.add(sellOrder.lockedHoldingCid);
            continue;
          }
          
          // Mark holdings as stale on failure
          if (buyHasLock) this.staleHoldings.add(buyOrder.lockedHoldingCid);
          if (sellHasLock) this.staleHoldings.add(sellOrder.lockedHoldingCid);
          return; // Stop matching this cycle
        }
      }
    }

    // ═══ DIAGNOSTIC: Log why no match was found ═══
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
        console.log(`[MatchingEngine] ${tradingPair}: No crossing orders (bestBid=${bestBuy.price} < bestAsk=${bestSell.price}, spread=${spread.toFixed(8)})`);
      }
    } else if (!bestBuy) {
      console.log(`[MatchingEngine] ${tradingPair}: No active buy orders with price`);
    } else if (!bestSell) {
      console.log(`[MatchingEngine] ${tradingPair}: No active sell orders with price`);
    }
  }
  
  /**
   * Execute a match with the appropriate settlement mode.
   * 
   * TWO MODES:
   * ─────────
   * 1. ATOMIC DvP (useDvP=true): Both sides have locked custom Holdings
   *    → SettlementInstruction + Settlement_Execute (single atomic DAML transaction)
   *    → Then FillOrder on both orders
   *    → Re-lock change holdings for partial fills
   *
   * 2. FILL-ONLY (useDvP=false): One or both sides lack locked holdings (Splice tokens)
   *    → FillOrder on BOTH orders FIRST (prevents re-matching loop)
   *    → Then mintDirect to create custom Holdings for the counterparties
   *    → This reflects the trade in on-chain balances
   *
   * WHY Fill-Only is needed:
   * Splice tokens (CC/CBTC) use the Splice Token Standard. Their holdings can't be locked
   * with our custom Holding_Lock choice. So DvP settlement is impossible for Splice-only users.
   * mintDirect creates custom exchange holdings that DO show up in balances, reflecting the trade.
   */
  async executeMatch(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, token, useDvP = false) {
    const packageId = config.canton.packageIds?.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;
    const synchronizerId = config.canton.synchronizerId;
    const [baseSymbol, quoteSymbol] = tradingPair.split('/');
    const quoteAmount = parseFloat((matchQty * matchPrice).toFixed(10));
    
    let tradeContractId = null;
    let createdHoldings = [];
    const buyIsPartial = buyOrder.remaining > matchQty;
    const sellIsPartial = sellOrder.remaining > matchQty;

    if (useDvP) {
      // ═══════════════════════════════════════════════════════════════
      // MODE 1: ATOMIC DvP Settlement via Settlement_Execute
      // ═══════════════════════════════════════════════════════════════
      console.log(`[MatchingEngine] 🔄 ATOMIC DvP Settlement: ${matchQty} ${baseSymbol} ↔ ${quoteAmount} ${quoteSymbol}`);
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
        console.log(`[MatchingEngine] ✅ DvP complete — Trade: ${tradeContractId?.substring(0, 25)}...`);
      } catch (settleError) {
        console.error(`[MatchingEngine] ❌ DvP Settlement FAILED: ${settleError.message}`);
        throw new Error(`DvP settlement failed: ${settleError.message}`);
      }

      // Re-lock change holdings for partial fills (DvP only)
      let buyNewAllocationCid = null;
      let sellNewAllocationCid = null;

      if (buyIsPartial || sellIsPartial) {
        console.log(`[MatchingEngine] 🔄 Partial fill — re-locking change holdings...`);
        const holdingTemplateId = `${packageId}:Holding:Holding`;
        
        if (buyIsPartial) {
          const buyRemainder = createdHoldings.find(h => 
            h.owner === buyOrder.owner && h.symbol === quoteSymbol && !h.locked);
          if (buyRemainder) {
            try {
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
              const events = lockResult?.transaction?.events || [];
              for (const event of events) {
                const created = event.created || event.CreatedEvent;
                if (created?.contractId && created.createArgument?.lock) {
                  buyNewAllocationCid = created.contractId;
                  break;
                }
              }
            } catch (lockErr) {
              console.error(`[MatchingEngine]    ⚠️ Re-lock failed: ${lockErr.message}`);
            }
          }
        }

        if (sellIsPartial) {
          const sellRemainder = createdHoldings.find(h => 
            h.owner === sellOrder.owner && h.symbol === baseSymbol && !h.locked);
          if (sellRemainder) {
            try {
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
              const events = lockResult?.transaction?.events || [];
              for (const event of events) {
                const created = event.created || event.CreatedEvent;
                if (created?.contractId && created.createArgument?.lock) {
                  sellNewAllocationCid = created.contractId;
                  break;
                }
              }
            } catch (lockErr) {
              console.error(`[MatchingEngine]    ⚠️ Re-lock failed: ${lockErr.message}`);
            }
          }
        }
      }

      // FillOrder on both sides (DvP already succeeded so these are non-critical)
      console.log(`[MatchingEngine] 📝 Filling orders on-chain...`);
      try {
        const buyFillArg = { fillQuantity: matchQty.toString() };
        if (buyOrder.isNewPackage) buyFillArg.newAllocationCid = buyNewAllocationCid || null;
        await cantonService.exerciseChoice({
          token, actAsParty: [operatorPartyId],
          templateId: buyOrder.templateId || `${packageId}:Order:Order`,
          contractId: buyOrder.contractId, choice: 'FillOrder',
          choiceArgument: buyFillArg,
          readAs: [operatorPartyId, buyOrder.owner],
        });
        console.log(`[MatchingEngine] ✅ Buy order filled: ${buyOrder.orderId}${buyIsPartial ? ' (partial)' : ' (complete)'}`);
      } catch (fillError) {
        console.error(`[MatchingEngine] ⚠️ Buy FillOrder failed (DvP already settled): ${fillError.message}`);
      }

      try {
        const sellFillArg = { fillQuantity: matchQty.toString() };
        if (sellOrder.isNewPackage) sellFillArg.newAllocationCid = sellNewAllocationCid || null;
        await cantonService.exerciseChoice({
          token, actAsParty: [operatorPartyId],
          templateId: sellOrder.templateId || `${packageId}:Order:Order`,
          contractId: sellOrder.contractId, choice: 'FillOrder',
          choiceArgument: sellFillArg,
          readAs: [operatorPartyId, sellOrder.owner],
        });
        console.log(`[MatchingEngine] ✅ Sell order filled: ${sellOrder.orderId}${sellIsPartial ? ' (partial)' : ' (complete)'}`);
      } catch (fillError) {
        console.error(`[MatchingEngine] ⚠️ Sell FillOrder failed (DvP already settled): ${fillError.message}`);
      }

    } else {
      // ═══════════════════════════════════════════════════════════════
      // MODE 2: FILL-ONLY Settlement (FillOrder + mintDirect)
      //
      // CRITICAL: FillOrder FIRST to prevent re-matching loop.
      // If FillOrder succeeds, the order status changes to FILLED/PARTIAL
      // and the matching engine won't pick it up again.
      // ═══════════════════════════════════════════════════════════════
      console.log(`[MatchingEngine] 🔄 FILL-ONLY Settlement: ${matchQty} ${baseSymbol} ↔ ${quoteAmount} ${quoteSymbol}`);

      // STEP A: FillOrder on BOTH orders FIRST
      console.log(`[MatchingEngine] 📝 Step A: Filling orders on-chain (FIRST to prevent re-matching)...`);
      let buyFillOk = false;
      let sellFillOk = false;

      try {
        const buyFillArg = { fillQuantity: matchQty.toString() };
        if (buyOrder.isNewPackage) buyFillArg.newAllocationCid = null;
        await cantonService.exerciseChoice({
          token, actAsParty: [operatorPartyId],
          templateId: buyOrder.templateId || `${packageId}:Order:Order`,
          contractId: buyOrder.contractId, choice: 'FillOrder',
          choiceArgument: buyFillArg,
          readAs: [operatorPartyId, buyOrder.owner],
        });
        buyFillOk = true;
        console.log(`[MatchingEngine] ✅ Buy order filled: ${buyOrder.orderId}${buyIsPartial ? ' (partial)' : ' (complete)'}`);
      } catch (fillError) {
        console.error(`[MatchingEngine] ❌ Buy FillOrder FAILED: ${fillError.message}`);
        // If the buy fill fails, the order might already be filled → skip
        if (fillError.message?.includes('already filled') || fillError.message?.includes('CONTRACT_NOT_FOUND')) {
          throw fillError; // Rethrow to skip this pair
        }
        throw new Error(`Fill-Only: Buy FillOrder failed: ${fillError.message}`);
      }

      try {
        const sellFillArg = { fillQuantity: matchQty.toString() };
        if (sellOrder.isNewPackage) sellFillArg.newAllocationCid = null;
        await cantonService.exerciseChoice({
          token, actAsParty: [operatorPartyId],
          templateId: sellOrder.templateId || `${packageId}:Order:Order`,
          contractId: sellOrder.contractId, choice: 'FillOrder',
          choiceArgument: sellFillArg,
          readAs: [operatorPartyId, sellOrder.owner],
        });
        sellFillOk = true;
        console.log(`[MatchingEngine] ✅ Sell order filled: ${sellOrder.orderId}${sellIsPartial ? ' (partial)' : ' (complete)'}`);
      } catch (fillError) {
        console.error(`[MatchingEngine] ❌ Sell FillOrder FAILED: ${fillError.message}`);
        // Buy was already filled — still continue with token transfer attempt
        if (!fillError.message?.includes('already filled') && !fillError.message?.includes('CONTRACT_NOT_FOUND')) {
          console.warn(`[MatchingEngine] ⚠️ Sell FillOrder failed but buy succeeded — tokens may still be minted`);
        }
      }

      // STEP B: Mint custom Holdings to reflect the trade
      // Buyer receives baseSymbol (e.g., CC), Seller receives quoteSymbol (e.g., CBTC)
      console.log(`[MatchingEngine] 💰 Step B: Minting holdings to reflect trade...`);
      try {
        const holdingService = getHoldingService();
        await holdingService.initialize();

        // Mint base token for buyer (e.g., buyer gets CC)
        console.log(`[MatchingEngine]    Minting ${matchQty} ${baseSymbol} → buyer: ${buyOrder.owner.substring(0, 30)}...`);
        await holdingService.mintDirect(buyOrder.owner, baseSymbol, matchQty, token);
        console.log(`[MatchingEngine]    ✅ Buyer received ${matchQty} ${baseSymbol}`);

        // Mint quote token for seller (e.g., seller gets CBTC)
        console.log(`[MatchingEngine]    Minting ${quoteAmount} ${quoteSymbol} → seller: ${sellOrder.owner.substring(0, 30)}...`);
        await holdingService.mintDirect(sellOrder.owner, quoteSymbol, quoteAmount, token);
        console.log(`[MatchingEngine]    ✅ Seller received ${quoteAmount} ${quoteSymbol}`);
      } catch (mintError) {
        // Non-fatal: FillOrder already succeeded so orders are marked as filled.
        // Balance update will be delayed but no re-matching loop.
        console.error(`[MatchingEngine] ⚠️ mintDirect failed (orders already filled): ${mintError.message}`);
      }

      // Create a Trade record on-chain for history
      try {
        const tradeTemplateId = `${packageId}:Settlement:Trade`;
        const tradeId = `trade-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        const tradeResult = await cantonService.createContractWithTransaction({
          token,
          actAsParty: operatorPartyId,
          templateId: tradeTemplateId,
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
          readAs: [operatorPartyId, buyOrder.owner, sellOrder.owner],
          synchronizerId,
        });
        const events = tradeResult?.transaction?.events || [];
        for (const event of events) {
          const created = event.created || event.CreatedEvent;
          if (created?.contractId) {
            tradeContractId = created.contractId;
            break;
          }
        }
        console.log(`[MatchingEngine] ✅ Trade record created: ${tradeContractId?.substring(0, 25)}...`);
      } catch (tradeErr) {
        console.warn(`[MatchingEngine] ⚠️ Trade record creation failed (non-critical): ${tradeErr.message}`);
        tradeContractId = `trade-${Date.now()}`;
      }
    }

    // ═══════════════════════════════════════════════════
    // FINAL: Record trade and broadcast via WebSocket
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

      // Broadcast balance updates for both parties so UI refreshes immediately
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

    console.log(`[MatchingEngine] ═══ Match complete: ${matchQty} ${baseSymbol} @ ${matchPrice} ${quoteSymbol} (${useDvP ? 'DvP' : 'FillOnly'}) ═══`);
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
        // ═══ FIX: Queue the pair instead of dropping it ═══
        // Previously this just returned, meaning orders placed during a cycle
        // had to wait for the NEXT full cycle (potentially 10-20+ seconds).
        // Now we queue the pair so matchLoop processes it immediately after.
        if (targetPair) {
          this.pendingPairs.add(targetPair);
          console.log(`[MatchingEngine] ⏳ Queued ${targetPair} for matching after current cycle (${elapsed}ms in progress)`);
          return { success: false, reason: 'queued_for_next_cycle' };
        }
        console.log(`[MatchingEngine] ⚡ Skipping trigger — matching already in progress (${elapsed}ms)`);
        return { success: false, reason: 'matching_in_progress' };
      }
    }

    // Rate limit: Don't trigger more than once per 2 seconds (was 10s — too slow for exchange)
    const now = Date.now();
    if (this._lastTriggerTime && (now - this._lastTriggerTime) < 2000) {
      // Still queue the pair even if rate-limited
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
