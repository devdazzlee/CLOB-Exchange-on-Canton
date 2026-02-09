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

class MatchingEngine {
  constructor() {
    this.isRunning = false;
    this.pollingInterval = parseInt(config.matchingEngine?.intervalMs) || 2000;
    this.matchingInProgress = false;
    this.adminToken = null;
    this.tokenExpiry = null;
    this.tradingPairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'CC/CBTC'];
    // Track holding CIDs that are known to be archived/stale
    // Prevents retrying the same stale orders every cycle
    this.staleHoldings = new Set();
    this.staleHoldingsLastClear = Date.now();
    this.STALE_CACHE_TTL = 120000; // Clear stale cache every 2 minutes
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
    if (this.matchingInProgress) return;

    try {
      this.matchingInProgress = true;
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
        const remaining = qty - filled;

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
          lockedHoldingCid: payload.allocationCid || null,
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
   * CRITICAL: Only matches orders where BOTH sides have locked Holdings.
   * Orders without locked Holdings (allocationCid) are skipped.
   * This ensures every match triggers real DvP settlement with token transfer.
   */
  async findAndExecuteOneMatch(tradingPair, buyOrders, sellOrders, token) {
    // Periodically clear stale holding cache so re-placed orders get retried
    if (Date.now() - this.staleHoldingsLastClear > this.STALE_CACHE_TTL) {
      if (this.staleHoldings.size > 0) {
        console.log(`[MatchingEngine] 🗑️ Clearing ${this.staleHoldings.size} stale holding entries`);
      }
      this.staleHoldings.clear();
      this.staleHoldingsLastClear = Date.now();
    }

    for (const buyOrder of buyOrders) {
      for (const sellOrder of sellOrders) {
        if (buyOrder.remaining <= 0 || sellOrder.remaining <= 0) continue;

        // REQUIREMENT: Both sides must have locked Holdings for DvP settlement
        const buyHasLock = buyOrder.lockedHoldingCid && buyOrder.lockedHoldingCid !== '';
        const sellHasLock = sellOrder.lockedHoldingCid && sellOrder.lockedHoldingCid !== '';

        if (!buyHasLock || !sellHasLock) continue;

        // Skip orders with known-stale holding CIDs (from previous failed settlements)
        if (this.staleHoldings.has(buyOrder.lockedHoldingCid) ||
            this.staleHoldings.has(sellOrder.lockedHoldingCid)) {
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

        const matchQty = Math.min(buyOrder.remaining, sellOrder.remaining);
        const roundedQty = Math.round(matchQty * 100000000) / 100000000;

        console.log(`[MatchingEngine] ✅ MATCH: BUY ${buyPrice !== null ? buyPrice : 'MARKET'} x ${buyOrder.remaining} ↔ SELL ${sellPrice !== null ? sellPrice : 'MARKET'} x ${sellOrder.remaining}`);
        console.log(`[MatchingEngine]    Fill: ${roundedQty} @ ${matchPrice}`);
        console.log(`[MatchingEngine]    Buyer Holding: ${buyOrder.lockedHoldingCid.substring(0, 30)}...`);
        console.log(`[MatchingEngine]    Seller Holding: ${sellOrder.lockedHoldingCid.substring(0, 30)}...`);
        console.log(`[MatchingEngine]    DvP Settlement REQUIRED (both sides locked)`);

        try {
          await this.executeMatch(tradingPair, buyOrder, sellOrder, roundedQty, matchPrice, token);
          return; // One match per cycle - exit
        } catch (error) {
          console.error(`[MatchingEngine] ❌ Match execution failed:`, error.message);
          
          // If DvP failed because a holding was not found (archived/stale),
          // remember the specific stale holding CID so we don't retry it
          if (error.message?.includes('could not be found') || 
              error.message?.includes('CONTRACT_NOT_FOUND') ||
              error.message?.includes('WRONGLY_TYPED_CONTRACT')) {
            // Try to identify WHICH holding was stale from the error message
            const errMsg = error.message || '';
            let markedAny = false;
            if (buyOrder.lockedHoldingCid && errMsg.includes(buyOrder.lockedHoldingCid.substring(0, 30))) {
              this.staleHoldings.add(buyOrder.lockedHoldingCid);
              console.log(`[MatchingEngine] ⏭️ Buyer holding stale: ${buyOrder.lockedHoldingCid.substring(0, 25)}... (order: ${buyOrder.orderId})`);
              markedAny = true;
            }
            if (sellOrder.lockedHoldingCid && errMsg.includes(sellOrder.lockedHoldingCid.substring(0, 30))) {
              this.staleHoldings.add(sellOrder.lockedHoldingCid);
              console.log(`[MatchingEngine] ⏭️ Seller holding stale: ${sellOrder.lockedHoldingCid.substring(0, 25)}... (order: ${sellOrder.orderId})`);
              markedAny = true;
            }
            if (!markedAny) {
              // Couldn't identify which — mark both to be safe
              this.staleHoldings.add(buyOrder.lockedHoldingCid);
              this.staleHoldings.add(sellOrder.lockedHoldingCid);
              console.log(`[MatchingEngine] ⏭️ Unknown stale holding, marked both (cache: ${this.staleHoldings.size})`);
            }
            console.log(`[MatchingEngine] Stale cache size: ${this.staleHoldings.size}`);
            continue;
          }
          return; // For other errors, stop matching this cycle
        }
      }
    }
  }

  /**
   * Execute a match: Settlement (DvP token swap) + FillOrder on both orders
   * 
   * For partial fills: after DvP settlement archives the original locked holding,
   * we must re-lock the remainder holding and update the order's allocationCid
   * so the order can continue being matched in subsequent cycles.
   */
  async executeMatch(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, token) {
    const packageId = config.canton.packageIds?.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;
    const [baseSymbol, quoteSymbol] = tradingPair.split('/');
    const quoteAmount = matchQty * matchPrice;

    // ═══════════════════════════════════════════════════
    // STEP 1: DvP Settlement (atomic token swap) - REQUIRED
    // ═══════════════════════════════════════════════════
    let tradeContractId = null;
    let createdHoldings = [];

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

    // ═══════════════════════════════════════════════════
    // STEP 2: Handle partial fills - Re-lock remainder holdings
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

    if (buyIsPartial || sellIsPartial) {
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
    // STEP 3: FillOrder on both Order contracts
    // For partial fills, pass newAllocationCid to update the order's reference
    // ═══════════════════════════════════════════════════
    console.log(`[MatchingEngine] 📝 Filling orders...`);

    // Fill buy order
    try {
      const buyFillArg = { fillQuantity: matchQty.toString() };
      if (buyOrder.isNewPackage) {
        // Pass the new locked holding CID if partial fill, or null (None) for full fill
        buyFillArg.newAllocationCid = buyNewAllocationCid ? buyNewAllocationCid : null;
      }
      await cantonService.exerciseChoice({
        token,
        actAsParty: operatorPartyId,
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
        actAsParty: operatorPartyId,
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

    // ═══════════════════════════════════════════════════
    // STEP 4: Broadcast trade via WebSocket
    // ═══════════════════════════════════════════════════
    if (global.broadcastWebSocket) {
      const tradeData = {
        type: 'NEW_TRADE',
        tradeId: tradeContractId || `trade-${Date.now()}`,
        tradingPair,
        buyer: buyOrder.owner,
        seller: sellOrder.owner,
        price: matchPrice.toString(),
        quantity: matchQty.toString(),
        buyOrderId: buyOrder.orderId,
        sellOrderId: sellOrder.orderId,
        timestamp: new Date().toISOString(),
        settlementType: 'DvP',
      };
      global.broadcastWebSocket(`trades:${tradingPair}`, tradeData);
      global.broadcastWebSocket('trades:all', tradeData);
      global.broadcastWebSocket(`orderbook:${tradingPair}`, {
        type: 'TRADE_EXECUTED',
        buyOrderId: buyOrder.orderId,
        sellOrderId: sellOrder.orderId,
        fillQuantity: matchQty,
        fillPrice: matchPrice,
      });
    }

    console.log(`[MatchingEngine] ═══ Match complete: ${matchQty} ${baseSymbol} @ ${matchPrice} ${quoteSymbol} ═══`);
  }

  setPollingInterval(ms) {
    this.pollingInterval = ms;
    console.log(`[MatchingEngine] Polling interval: ${ms}ms`);
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
