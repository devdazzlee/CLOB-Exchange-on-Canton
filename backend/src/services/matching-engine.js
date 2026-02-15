/**
 * Matching Engine Bot
 * 
 * Core exchange functionality — matches buy/sell orders and settles trades
 * exclusively via the Transfer Registry API.
 * 
 * Flow:
 * 1. Poll Canton for OPEN Order contracts every N seconds
 * 2. Separate into buys/sells per trading pair
 * 3. Sort by price-time priority (FIFO)
 * 4. Find crossing orders (buy price >= sell price)
 * 5. For each match:
 *    a. FillOrder on both Canton contracts (prevents re-matching loop)
 *    b. Transfer instrument (seller→buyer) via Transfer Registry
 *    c. Transfer payment (buyer→seller) via Transfer Registry
 *    d. Unlock remaining locked funds for fully-filled orders
 *    e. Create Trade record on Canton for history
 *    f. Broadcast via WebSocket
 * 
 * ALL token movements go through Transfer Registry — NO custom minting,
 * NO DvP settlement, NO Fill-Only mode. Transfers are visible on Canton Explorer.
 * 
 * Uses Canton JSON Ledger API v2:
 * - POST /v2/state/active-contracts — Query orders
 * - POST /v2/commands/submit-and-wait-for-transaction — Execute matches
 */

const Decimal = require('decimal.js');
const cantonService = require('./cantonService');
const config = require('../config');
const tokenProvider = require('./tokenProvider');
const { getTransferRegistry } = require('./transferRegistryClient');

// Configure decimal.js for financial precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

class MatchingEngine {
  constructor() {
    this.isRunning = false;
    this.pollingInterval = parseInt(config.matchingEngine?.intervalMs) || 2000;
    this.matchingInProgress = false;
    this.matchingStartTime = 0; // Track start time for deadlock detection
    this.adminToken = null;
    this.tokenExpiry = null;
    this.tradingPairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'CC/CBTC'];

    // ═══ CRITICAL: Recently matched orders guard ═══
    // Prevents catastrophic re-matching loop where:
    // 1. Orders match → tokens transfer → FillOrder fails silently
    // 2. Orders remain OPEN → next cycle matches them AGAIN → tokens transfer AGAIN
    // 3. Infinite loop: duplicate trades + repeated token transfers
    // 
    // Key: "buyContractId::sellContractId" → timestamp of last match attempt
    this.recentlyMatchedOrders = new Map();
    this.RECENTLY_MATCHED_TTL = 30000; // 30 seconds cooldown

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
      // Deadlock prevention for Vercel serverless.
      if (Date.now() - this.matchingStartTime > 25000) {
        console.warn('[MatchingEngine] ⚠️ matchingInProgress stuck for >25s — force-resetting');
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
        const remaining = new Decimal(qty).minus(new Decimal(filled));

        if (remaining.lte(0)) continue;

        // Detect which package this contract belongs to
        const contractTemplateId = c.templateId || `${packageId}:Order:Order`;
        const isNewPackage = contractTemplateId.startsWith(packageId);

        // Extract lockId from allocationCid (Transfer Registry lock reference)
        const rawLockId = payload.allocationCid || '';
        const lockId = (rawLockId && rawLockId !== 'FILL_ONLY' && rawLockId !== 'NONE' && rawLockId.length >= 10)
          ? rawLockId
          : null;
        
        const order = {
          contractId: c.contractId,
          orderId: payload.orderId,
          owner: payload.owner,
          orderType: payload.orderType,
          orderMode: payload.orderMode || 'LIMIT',
          price: parsedPrice,
          quantity: qty,
          filled: filled,
          remaining: remaining.toNumber(),
          remainingDecimal: remaining,   // Keep Decimal for precise matching
          timestamp: payload.timestamp,
          tradingPair: payload.tradingPair,
          lockId: lockId,                // Transfer Registry lockId (was allocationCid)
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

      console.log(`[MatchingEngine] ${tradingPair}: ${buyOrders.length} buys, ${sellOrders.length} sells`);

      // Find and execute ONE match per cycle (contract IDs become stale after match)
      await this.findAndExecuteOneMatch(tradingPair, buyOrders, sellOrders, token);
      
    } catch (error) {
      if (error.message?.includes('401') || error.message?.includes('security-sensitive')) {
        this.invalidateToken();
      }
      if (!error.message?.includes('No contracts found')) {
        console.error(`[MatchingEngine] Error for ${tradingPair}:`, error.message);
      }
    }
  }
  
  /**
   * Find ONE crossing match and execute it.
   * Only one per cycle because contract IDs change after exercise.
   * 
   * Settlement uses Transfer Registry API exclusively:
   * Two transfer() calls per match — instrument (seller→buyer) + payment (buyer→seller).
   * Fully-filled orders have their locked funds released via unlockFunds().
   */
  async findAndExecuteOneMatch(tradingPair, buyOrders, sellOrders, token) {
    const now = Date.now();

    // Clear expired entries from recentlyMatchedOrders
    for (const [key, ts] of this.recentlyMatchedOrders) {
      if (now - ts > this.RECENTLY_MATCHED_TTL) {
        this.recentlyMatchedOrders.delete(key);
      }
    }
    
    for (const buyOrder of buyOrders) {
      for (const sellOrder of sellOrders) {
        if (buyOrder.remaining <= 0 || sellOrder.remaining <= 0) continue;

        // ═══════════════════════════════════════════════════════════
        // CRITICAL: Self-Trade Prevention
        // A party must NEVER trade with itself — regulatory requirement.
        // ═══════════════════════════════════════════════════════════
        if (buyOrder.owner === sellOrder.owner) {
          console.log(`[MatchingEngine] ⚠️ BLOCKED: Self-trade attempt by ${buyOrder.owner.substring(0, 30)}...`);
          continue;
        }

        // Skip recently matched order pairs (prevents re-matching loop)
        const matchKey = `${buyOrder.contractId}::${sellOrder.contractId}`;
        if (this.recentlyMatchedOrders.has(matchKey)) {
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

        // Precise quantity calculation with Decimal
        const matchQty = Decimal.min(buyOrder.remainingDecimal, sellOrder.remainingDecimal);
        const matchQtyStr = matchQty.toFixed(10);  // String for API calls
        const matchQtyNum = matchQty.toNumber();    // Number for comparisons

        console.log(`[MatchingEngine] ✅ MATCH FOUND: BUY ${buyPrice !== null ? buyPrice : 'MARKET'} x ${buyOrder.remaining} ↔ SELL ${sellPrice !== null ? sellPrice : 'MARKET'} x ${sellOrder.remaining}`);
        console.log(`[MatchingEngine]    Fill: ${matchQtyStr} @ ${matchPrice} | Settlement: Transfer Registry`);

        this.recentlyMatchedOrders.set(matchKey, Date.now());

        try {
          await this.executeMatch(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, token);
          console.log(`[MatchingEngine] ✅ Match executed successfully via Transfer Registry`);
          return; // One match per cycle
        } catch (error) {
          console.error(`[MatchingEngine] ❌ Match execution failed:`, error.message);
          
          if (error.message?.includes('already filled') || 
              error.message?.includes('could not be found') ||
              error.message?.includes('CONTRACT_NOT_FOUND')) {
            console.log(`[MatchingEngine] ℹ️ Order already processed — skipping`);
            continue;
          }
          
          return; // Stop matching this cycle on unexpected error
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
   * Execute a match using Transfer Registry API for REAL token transfers.
   * 
   * Settlement flow:
   * 1. FillOrder on BOTH Canton order contracts FIRST (prevents re-matching loop)
   * 2. Transfer instrument (e.g., CBTC) from seller → buyer via Transfer Registry
   * 3. Transfer payment (e.g., CC) from buyer → seller via Transfer Registry
   * 4. Unlock remaining locked funds for fully-filled orders
   * 5. Create Trade record on Canton for history
   * 6. Broadcast via WebSocket
   * 
   * ALL token movements are via Transfer Registry API — NO custom minting.
   * Transfers are visible on Canton Explorer.
   * 
   * @param {string} tradingPair
   * @param {object} buyOrder
   * @param {object} sellOrder
   * @param {Decimal} matchQty - precise Decimal quantity
   * @param {number} matchPrice
   * @param {string} token - admin auth token
   */
  async executeMatch(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, token) {
    const packageId = config.canton.packageIds?.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;
    const synchronizerId = config.canton.synchronizerId;
    const [baseSymbol, quoteSymbol] = tradingPair.split('/');

    // Precise arithmetic with Decimal
    const quoteAmount = matchQty.times(new Decimal(matchPrice));
    const matchQtyStr = matchQty.toFixed(10);
    const quoteAmountStr = quoteAmount.toFixed(10);
    const matchQtyNum = matchQty.toNumber();
    
    let tradeContractId = null;
    const buyIsPartial = new Decimal(buyOrder.remaining).gt(matchQty);
    const sellIsPartial = new Decimal(sellOrder.remaining).gt(matchQty);
    
    const transferRegistry = getTransferRegistry();

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: FillOrder on BOTH Canton orders FIRST
    // This prevents the re-matching loop: once filled, the matching
    // engine won't pick them up again even if transfers take time.
    // ═══════════════════════════════════════════════════════════════════
    console.log(`[MatchingEngine] 🔄 Settlement: ${matchQtyStr} ${baseSymbol} @ ${matchPrice} ${quoteSymbol}`);
    console.log(`[MatchingEngine] 📝 Step 1: Filling orders on-chain (prevents re-matching)...`);

    try {
      const buyFillArg = { fillQuantity: matchQtyStr };
      if (buyOrder.isNewPackage) buyFillArg.newAllocationCid = null;
      await cantonService.exerciseChoice({
        token, actAsParty: [operatorPartyId],
        templateId: buyOrder.templateId || `${packageId}:Order:Order`,
        contractId: buyOrder.contractId, choice: 'FillOrder',
        choiceArgument: buyFillArg,
        readAs: [operatorPartyId, buyOrder.owner],
      });
      console.log(`[MatchingEngine] ✅ Buy order filled: ${buyOrder.orderId}${buyIsPartial ? ' (partial)' : ' (complete)'}`);
    } catch (fillError) {
      console.error(`[MatchingEngine] ❌ Buy FillOrder FAILED: ${fillError.message}`);
      if (fillError.message?.includes('already filled') || fillError.message?.includes('CONTRACT_NOT_FOUND')) {
        throw fillError;
      }
      throw new Error(`Buy FillOrder failed: ${fillError.message}`);
    }

    try {
      const sellFillArg = { fillQuantity: matchQtyStr };
      if (sellOrder.isNewPackage) sellFillArg.newAllocationCid = null;
      await cantonService.exerciseChoice({
        token, actAsParty: [operatorPartyId],
        templateId: sellOrder.templateId || `${packageId}:Order:Order`,
        contractId: sellOrder.contractId, choice: 'FillOrder',
        choiceArgument: sellFillArg,
        readAs: [operatorPartyId, sellOrder.owner],
      });
      console.log(`[MatchingEngine] ✅ Sell order filled: ${sellOrder.orderId}${sellIsPartial ? ' (partial)' : ' (complete)'}`);
    } catch (fillError) {
      console.error(`[MatchingEngine] ❌ Sell FillOrder FAILED: ${fillError.message}`);
      if (!fillError.message?.includes('already filled') && !fillError.message?.includes('CONTRACT_NOT_FOUND')) {
        console.warn(`[MatchingEngine] ⚠️ Sell FillOrder failed but buy succeeded — will still attempt transfers`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Transfer REAL tokens via Transfer Registry API
    // Two transfers per settlement:
    //   a) Instrument (e.g., CBTC) from seller → buyer
    //   b) Payment (e.g., CC) from buyer → seller
    // These are REAL transfers visible on Canton Explorer.
    //
    // ATOMIC SAFETY: If transfer A succeeds but B fails, we log both
    // transaction hashes for manual resolution. Orders are already filled
    // on-chain so no re-matching loop occurs.
    // ═══════════════════════════════════════════════════════════════════
    console.log(`[MatchingEngine] 💰 Step 2: Transferring REAL tokens via Transfer Registry...`);
    
    let instrumentTransferResult = null;
    let paymentTransferResult = null;

    // Transfer A: Instrument (base) from seller → buyer
    try {
      console.log(`[MatchingEngine]    📤 Transfer ${matchQtyStr} ${baseSymbol}: seller → buyer`);
      instrumentTransferResult = await transferRegistry.transfer({
        instrument: baseSymbol,
        fromParty: sellOrder.owner,
        toParty: buyOrder.owner,
        amount: matchQtyStr,
        metadata: {
          buyOrderId: buyOrder.orderId,
          sellOrderId: sellOrder.orderId,
          type: 'instrument_settlement',
          tradingPair,
          price: matchPrice.toString(),
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`[MatchingEngine]    ✅ Instrument transfer completed — txHash: ${instrumentTransferResult.transactionHash || 'N/A'}`);
    } catch (transferError) {
      console.error(`[MatchingEngine]    ❌ Instrument transfer FAILED: ${transferError.message}`);
      console.error(`[MatchingEngine]    ⚠️ Orders are filled but tokens not yet transferred — manual resolution needed`);
    }

    // Transfer B: Payment (quote) from buyer → seller
    try {
      console.log(`[MatchingEngine]    📤 Transfer ${quoteAmountStr} ${quoteSymbol}: buyer → seller`);
      paymentTransferResult = await transferRegistry.transfer({
        instrument: quoteSymbol,
        fromParty: buyOrder.owner,
        toParty: sellOrder.owner,
        amount: quoteAmountStr,
        metadata: {
          buyOrderId: buyOrder.orderId,
          sellOrderId: sellOrder.orderId,
          type: 'payment_settlement',
          tradingPair,
          price: matchPrice.toString(),
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`[MatchingEngine]    ✅ Payment transfer completed — txHash: ${paymentTransferResult.transactionHash || 'N/A'}`);
    } catch (transferError) {
      console.error(`[MatchingEngine]    ❌ Payment transfer FAILED: ${transferError.message}`);
      // Log both hashes for manual resolution if instrument succeeded but payment failed
      if (instrumentTransferResult) {
        console.error(`[MatchingEngine]    🚨 CRITICAL: Instrument transferred (txHash: ${instrumentTransferResult.transactionHash}) but payment FAILED`);
        console.error(`[MatchingEngine]    🚨 Manual intervention required: reverse instrument transfer or retry payment`);
        console.error(`[MatchingEngine]    🚨 Buyer: ${buyOrder.owner.substring(0, 40)}, Seller: ${sellOrder.owner.substring(0, 40)}`);
        console.error(`[MatchingEngine]    🚨 Instrument: ${matchQtyStr} ${baseSymbol}, Payment: ${quoteAmountStr} ${quoteSymbol}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Unlock remaining locked funds for fully-filled orders
    // If the order is fully filled, release the Transfer Registry lock.
    // For partial fills, the remaining amount stays locked for the next match.
    // ═══════════════════════════════════════════════════════════════════
    console.log(`[MatchingEngine] 🔓 Step 3: Unlocking completed order locks...`);

    // Unlock buyer's lock if fully filled
    if (!buyIsPartial && buyOrder.lockId) {
      try {
        await transferRegistry.unlockFunds(buyOrder.lockId);
        console.log(`[MatchingEngine]    ✅ Buyer lock released: ${buyOrder.lockId.substring(0, 25)}...`);
      } catch (unlockErr) {
        console.warn(`[MatchingEngine]    ⚠️ Buyer unlock failed (non-critical): ${unlockErr.message}`);
      }
    }

    // Unlock seller's lock if fully filled
    if (!sellIsPartial && sellOrder.lockId) {
      try {
        await transferRegistry.unlockFunds(sellOrder.lockId);
        console.log(`[MatchingEngine]    ✅ Seller lock released: ${sellOrder.lockId.substring(0, 25)}...`);
      } catch (unlockErr) {
        console.warn(`[MatchingEngine]    ⚠️ Seller unlock failed (non-critical): ${unlockErr.message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: Create Trade record on Canton for history
    // ═══════════════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════
    // FINAL: Record trade and broadcast via WebSocket
    // ═══════════════════════════════════════════════════
    const tradeRecord = {
      tradeId: tradeContractId || `trade-${Date.now()}`,
      tradingPair,
      buyer: buyOrder.owner,
      seller: sellOrder.owner,
      price: matchPrice.toString(),
      quantity: matchQtyStr,
      buyOrderId: buyOrder.orderId,
      sellOrderId: sellOrder.orderId,
      timestamp: new Date().toISOString(),
      settlementType: 'TransferRegistry',
      instrumentTxHash: instrumentTransferResult?.transactionHash || null,
      paymentTxHash: paymentTransferResult?.transactionHash || null,
      explorerUrl: instrumentTransferResult?.explorerUrl || null,
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
        fillQuantity: matchQtyStr,
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

    console.log(`[MatchingEngine] ═══ Match complete: ${matchQtyStr} ${baseSymbol} @ ${matchPrice} ${quoteSymbol} (TransferRegistry) ═══`);
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
   */
  async triggerMatchingCycle(targetPair = null) {
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

    // Rate limit: Don't trigger more than once per 2 seconds
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
