/**
 * Matching Engine Bot
 * Continuously monitors the order book and executes matches when buy/sell orders overlap
 *
 * This is the critical off-chain automation that makes the exchange work:
 * - FIFO Execution: Price-time priority
 * - Partial Fills: Handles mismatched sizes
 * - Self-Trade Prevention: Checks owner before matching
 * 
 * Uses Canton JSON Ledger API v2:
 * - POST /v2/state/active-contracts - Query orders
 * - POST /v2/commands/submit-and-wait-for-transaction - Execute matches
 */

const CantonAdmin = require('./canton-admin');
const cantonService = require('./cantonService');
const config = require('../config');
const { getUpdateStream } = require('./cantonUpdateStream');
const { extractTradesFromEvents } = require('./trade-utils');
const { getSettlementService } = require('./settlementService');

// Feature flag - set to true when deploying new token standard DAR
const USE_DvP_SETTLEMENT = process.env.USE_DVP_SETTLEMENT === 'true' || false;

// NO IN-MEMORY CACHE - All trades are stored on Canton ledger as Trade contracts
function recordTradesFromResult(result) {
  const trades = extractTradesFromEvents(result?.events);
  if (trades.length === 0) return [];

  trades.forEach((trade) => {
    // Broadcast via WebSocket for real-time UI updates
    if (global.broadcastWebSocket) {
      global.broadcastWebSocket(`trades:${trade.tradingPair}`, {
        type: 'NEW_TRADE',
        ...trade,
      });
      global.broadcastWebSocket('trades:all', {
        type: 'NEW_TRADE',
        ...trade,
      });
    }
  });

  return trades;
}

class MatchingEngine {
  constructor() {
    this.cantonAdmin = new CantonAdmin();
    this.isRunning = false;
    this.pollingInterval = 2000; // Poll every 2 seconds
    this.matchingInProgress = false;
    this.lastProcessedOrders = new Set();
    this.adminToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get admin token with caching
   */
  async getAdminToken() {
    if (this.adminToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.adminToken;
    }

    console.log('[MatchingEngine] Refreshing admin token...');
    this.adminToken = await this.cantonAdmin.getAdminToken();
    this.tokenExpiry = Date.now() + (25 * 60 * 1000); // 25 minutes (token expires in 30)
    console.log('[MatchingEngine] Admin token refreshed successfully');
    return this.adminToken;
  }

  /**
   * Invalidate cached token (call on 401 errors)
   */
  invalidateToken() {
    console.log('[MatchingEngine] Invalidating cached token due to auth error');
    this.adminToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Start the matching engine
   */
  async start() {
    if (this.isRunning) {
      console.log('[MatchingEngine] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[MatchingEngine] Starting matching engine...');
    console.log('[MatchingEngine] Polling interval:', this.pollingInterval, 'ms');

    // Start the matching loop
    this.matchLoop();
  }

  /**
   * Stop the matching engine
   */
  stop() {
    console.log('[MatchingEngine] Stopping matching engine...');
    this.isRunning = false;
  }

  /**
   * Main matching loop
   */
  async matchLoop() {
    while (this.isRunning) {
      try {
        await this.runMatchingCycle();
      } catch (error) {
        console.error('[MatchingEngine] Error in matching cycle:', error.message);
      }

      // Wait before next cycle
      await this.sleep(this.pollingInterval);
    }

    console.log('[MatchingEngine] Stopped');
  }

  /**
   * Run one matching cycle - DIRECTLY queries Canton API
   */
  async runMatchingCycle() {
    if (this.matchingInProgress) {
      return; // Skip if already processing
    }

    try {
      this.matchingInProgress = true;

      // Get admin token
      const adminToken = await this.getAdminToken();

      // Query Canton DIRECTLY for Order contracts (no cache)
      const tradingPairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
      
      for (const pair of tradingPairs) {
        await this.processOrderBookFromCanton(pair, adminToken);
      }
    } catch (error) {
      console.error('[MatchingEngine] Error in matching cycle:', error.message);
      // Invalidate token on 401 errors so it gets refreshed next cycle
      if (error.message?.includes('401') || error.message?.includes('security-sensitive') || error.message?.includes('Unauthorized')) {
        this.invalidateToken();
      }
    } finally {
      this.matchingInProgress = false;
    }
  }
  
  /**
   * Process order book by querying Canton DIRECTLY
   */
  async processOrderBookFromCanton(tradingPair, adminToken) {
    try {
      const packageId = config.canton.packageIds?.clobExchange;
      const operatorPartyId = config.canton.operatorPartyId;
      
      if (!packageId || !operatorPartyId) {
        return;
      }
      
      // Query Canton for Order contracts
      const contracts = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [`${packageId}:Order:Order`],
        pageSize: 200
      }, adminToken);
      
      if (!contracts || contracts.length === 0) {
        return;
      }
      
      // Filter by trading pair and OPEN status
      const buyOrders = [];
      const sellOrders = [];
      
      for (const c of contracts) {
        const payload = c.payload || c.createArgument || {};
        
        if (payload.tradingPair !== tradingPair || payload.status !== 'OPEN') {
          continue;
        }
        
        // Handle price: null for MARKET orders, keep as null to distinguish from 0
        const rawPrice = payload.price;
        const parsedPrice = rawPrice !== null && rawPrice !== undefined && rawPrice !== '' 
          ? parseFloat(rawPrice) 
          : null;
        
        const order = {
          contractId: c.contractId,
          orderId: payload.orderId,
          owner: payload.owner,
          orderType: payload.orderType,
          orderMode: payload.orderMode || 'LIMIT',
          price: parsedPrice,  // null for MARKET orders
          quantity: parseFloat(payload.quantity) || 0,
          filled: parseFloat(payload.filled) || 0,
          remaining: (parseFloat(payload.quantity) || 0) - (parseFloat(payload.filled) || 0),
          timestamp: payload.timestamp
        };
        
        if (payload.orderType === 'BUY') {
          buyOrders.push(order);
        } else if (payload.orderType === 'SELL') {
          sellOrders.push(order);
        }
      }
      
      if (buyOrders.length === 0 || sellOrders.length === 0) {
        return; // No matches possible
      }
      
      console.log(`[MatchingEngine] ${tradingPair}: ${buyOrders.length} buys, ${sellOrders.length} sells`);
      
      // Sort orders: buys by price (highest first, MARKET first), sells by price (lowest first, MARKET first)
      const sortedBuys = buyOrders.sort((a, b) => {
        // MARKET orders (null price) have highest priority
        if (a.price === null && b.price !== null) return -1;
        if (a.price !== null && b.price === null) return 1;
        if (a.price === null && b.price === null) return new Date(a.timestamp) - new Date(b.timestamp);
        // For LIMIT orders: higher price first
        if (b.price !== a.price) return b.price - a.price;
        // Same price: earlier timestamp wins
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
      
      const sortedSells = sellOrders.sort((a, b) => {
        // MARKET orders (null price) have highest priority
        if (a.price === null && b.price !== null) return -1;
        if (a.price !== null && b.price === null) return 1;
        if (a.price === null && b.price === null) return new Date(a.timestamp) - new Date(b.timestamp);
        // For LIMIT orders: lower price first
        if (a.price !== b.price) return a.price - b.price;
        // Same price: earlier timestamp wins
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
      
      // Log best bid/ask for debugging
      if (sortedBuys.length > 0 && sortedSells.length > 0) {
        const bestBuy = sortedBuys[0];
        const bestSell = sortedSells[0];
        const buyPriceDisplay = bestBuy.price !== null ? bestBuy.price : 'MARKET';
        const sellPriceDisplay = bestSell.price !== null ? bestSell.price : 'MARKET';
        
        console.log(`[MatchingEngine] Best BUY: ${buyPriceDisplay} qty=${bestBuy.remaining} owner=${bestBuy.owner.substring(0, 25)}...`);
        console.log(`[MatchingEngine] Best SELL: ${sellPriceDisplay} qty=${bestSell.remaining} owner=${bestSell.owner.substring(0, 25)}...`);
        
        // Check why they might not match
        const canCross = (bestBuy.price === null) || (bestSell.price === null) || (bestBuy.price >= bestSell.price);
        if (canCross) {
          console.log(`[MatchingEngine] 📊 Prices can match (buy=${buyPriceDisplay}, sell=${sellPriceDisplay})`);
          if (bestBuy.owner === bestSell.owner) {
            console.log(`[MatchingEngine] ⚠️ Same owner - self-trade (now allowed)`);
          }
        } else {
          const spread = bestSell.price - bestBuy.price;
          console.log(`[MatchingEngine] No spread cross: ${buyPriceDisplay} < ${sellPriceDisplay} (spread: ${spread.toFixed(2)})`);
        }
      }
      
      // Find and execute matches
      await this.findAndExecuteMatches(tradingPair, sortedBuys, sortedSells, adminToken);
      
    } catch (error) {
      console.error(`[MatchingEngine] Error processing ${tradingPair}:`, error.message);
      // Invalidate token on 401 errors so it gets refreshed next cycle
      if (error.message?.includes('401') || error.message?.includes('security-sensitive') || error.message?.includes('Unauthorized')) {
        this.invalidateToken();
      }
    }
  }
  
  /**
   * Find and execute matching orders
   */
  async findAndExecuteMatches(tradingPair, buyOrders, sellOrders, adminToken) {
    let matchCount = 0;
    
    outerLoop:
    for (const buyOrder of buyOrders) {
      for (const sellOrder of sellOrders) {
        // Skip if already filled (or processed this cycle)
        if (buyOrder.remaining <= 0 || sellOrder.remaining <= 0) {
          continue;
        }
        
        // Self-trade prevention DISABLED per client request
        // Market will handle it naturally
        
        // Check if orders match
        // Handle MARKET orders (price is null) - they match at the counterparty's price
        const buyPrice = buyOrder.price;
        const sellPrice = sellOrder.price;
        
        // Determine if orders can match:
        // - LIMIT vs LIMIT: buyPrice >= sellPrice
        // - MARKET BUY vs LIMIT SELL: always matches at sellPrice
        // - LIMIT BUY vs MARKET SELL: always matches at buyPrice
        // - MARKET vs MARKET: match at 0 (edge case, shouldn't happen normally)
        let canMatch = false;
        let matchPrice = 0;
        
        if (buyPrice !== null && sellPrice !== null) {
          // Both are LIMIT orders
          if (buyPrice >= sellPrice) {
            canMatch = true;
            matchPrice = sellPrice; // Use sell price (maker-taker model)
          }
        } else if (buyPrice === null && sellPrice !== null) {
          // MARKET BUY vs LIMIT SELL - always matches at sell price
          canMatch = true;
          matchPrice = sellPrice;
        } else if (buyPrice !== null && sellPrice === null) {
          // LIMIT BUY vs MARKET SELL - always matches at buy price
          canMatch = true;
          matchPrice = buyPrice;
        } else {
          // Both MARKET orders - skip (shouldn't match MARKET vs MARKET)
          canMatch = false;
        }
        
        if (canMatch && matchPrice > 0) {
          const matchQty = Math.min(buyOrder.remaining, sellOrder.remaining);
          
          console.log(`[MatchingEngine] ✅ MATCH FOUND:`);
          console.log(`  Buy: ${buyOrder.contractId.substring(0, 20)}... @${buyPrice !== null ? buyPrice : 'MARKET'} qty=${buyOrder.remaining}`);
          console.log(`  Sell: ${sellOrder.contractId.substring(0, 20)}... @${sellPrice !== null ? sellPrice : 'MARKET'} qty=${sellOrder.remaining}`);
          console.log(`  Match: ${matchQty} @${matchPrice}`);
          console.log(`  Settlement mode: ${USE_DvP_SETTLEMENT ? 'DvP (Token Standard)' : 'Legacy (FillOrder + Balance Update)'}`);
          
          try {
            // Execute the match
            if (USE_DvP_SETTLEMENT) {
              // NEW: Use atomic DvP settlement with real token Holdings
              await this.executeDvPSettlement(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, adminToken);
            } else {
              // LEGACY: Fill orders and update UserAccount balances
              await this.executeFillOrders(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, adminToken);
            }
            matchCount++;
            
            // IMPORTANT: After FillOrder, the contract IDs change (DAML archives old, creates new)
            // Mark these orders as "processed this cycle" to avoid CONTRACT_NOT_FOUND errors
            // Next cycle will fetch fresh contract IDs from Canton
            buyOrder.remaining = 0;  // Mark as fully processed this cycle
            sellOrder.remaining = 0;
            
            // Break out of both loops - contract IDs are now stale
            // Next cycle will fetch fresh contract IDs from Canton
            break outerLoop;
          } catch (error) {
            console.error(`[MatchingEngine] Failed to execute match:`, error.message);
            // Mark orders as processed to avoid retrying with stale contract IDs
            buyOrder.remaining = 0;
            break outerLoop;
          }
        }
      }
    }
    
    if (matchCount > 0) {
      console.log(`[MatchingEngine] ✅ Executed ${matchCount} matches for ${tradingPair}`);
    }
  }
  
  /**
   * Round quantity to avoid floating point precision issues
   * Canton Decimal(10) supports max 10 decimal places
   */
  roundQuantity(qty) {
    // Round to 8 decimal places to avoid precision issues
    return Math.round(qty * 100000000) / 100000000;
  }
  
  /**
   * Execute match by filling both orders using FillOrder choice
   */
  async executeFillOrders(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, adminToken) {
    const packageId = config.canton.packageIds?.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;
    
    // Round quantity to avoid floating point precision errors
    matchQty = this.roundQuantity(matchQty);
    
    if (!packageId || !operatorPartyId) {
      throw new Error('Missing package ID or operator party ID');
    }
    
    // Fill the buy order
    console.log(`[MatchingEngine] Filling buy order: ${matchQty}`);
    await cantonService.exerciseChoice({
      token: adminToken,
      actAsParty: operatorPartyId,
      templateId: `${packageId}:Order:Order`,
      contractId: buyOrder.contractId,
      choice: 'FillOrder',
      choiceArgument: { fillQuantity: matchQty.toFixed(8) },
      readAs: [operatorPartyId, buyOrder.owner]
    });
    
    // Fill the sell order
    console.log(`[MatchingEngine] Filling sell order: ${matchQty.toFixed(8)}`);
    await cantonService.exerciseChoice({
      token: adminToken,
      actAsParty: operatorPartyId,
      templateId: `${packageId}:Order:Order`,
      contractId: sellOrder.contractId,
      choice: 'FillOrder',
      choiceArgument: { fillQuantity: matchQty.toFixed(8) },
      readAs: [operatorPartyId, sellOrder.owner]
    });
    
    // Record trade (off-chain since Trade template needs both signatories)
    const tradeRecord = {
      tradeId: `trade-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      buyer: buyOrder.owner,
      seller: sellOrder.owner,
      tradingPair,
      price: matchPrice.toString(),
      quantity: matchQty.toString(),
      buyOrderId: buyOrder.orderId,
      sellOrderId: sellOrder.orderId,
      timestamp: new Date().toISOString()
    };
    
    // Create Trade contract on Canton ledger (NO IN-MEMORY CACHE)
    try {
      const packageId = config.canton.packageIds?.clobExchange;
      const operatorPartyId = config.canton.operatorPartyId;
      
      await cantonService.createContractWithTransaction({
        token: adminToken,
        actAsParty: [operatorPartyId, buyOrder.owner, sellOrder.owner],
        templateId: `${packageId}:Trade:Trade`,
        createArguments: {
          tradeId: tradeRecord.tradeId,
          buyer: buyOrder.owner,
          seller: sellOrder.owner,
          tradingPair: tradingPair,
          price: matchPrice.toString(),
          quantity: matchQty.toString(),
          buyOrderId: buyOrder.orderId,
          sellOrderId: sellOrder.orderId,
          timestamp: tradeRecord.timestamp
        },
        readAs: [operatorPartyId, buyOrder.owner, sellOrder.owner]
      });
      console.log(`[MatchingEngine] Trade contract created on Canton: ${tradeRecord.tradeId}`);
    } catch (tradeContractError) {
      console.error(`[MatchingEngine] Failed to create Trade contract:`, tradeContractError.message);
      // Continue - trade data will still be broadcast via WebSocket
    }
    
    // ========= UPDATE BALANCES AFTER TRADE =========
    // Buyer: receives baseToken (e.g., BTC), already paid quoteToken
    // Seller: receives quoteToken (e.g., USDT), already gave baseToken
    try {
      await this.updateBalancesAfterTrade(
        adminToken,
        tradingPair,
        buyOrder.owner,
        sellOrder.owner,
        matchQty,
        matchPrice
      );
      console.log(`[MatchingEngine] Balances updated for trade`);
    } catch (balanceError) {
      console.error(`[MatchingEngine] Balance update failed:`, balanceError.message);
      // Continue anyway - the trade already happened on the orders
    }
    
    // Broadcast via WebSocket
    if (global.broadcastWebSocket) {
      global.broadcastWebSocket(`trades:${tradingPair}`, {
        type: 'NEW_TRADE',
        ...tradeRecord
      });
      global.broadcastWebSocket('trades:all', {
        type: 'NEW_TRADE',
        ...tradeRecord
      });
    }
    
    // Also broadcast order updates
    if (global.broadcastWebSocket) {
      global.broadcastWebSocket(`orderbook:${tradingPair}`, {
        type: 'ORDER_FILLED',
        buyOrderId: buyOrder.orderId,
        sellOrderId: sellOrder.orderId,
        fillQuantity: matchQty
      });
    }
  }

  /**
   * Execute match using DvP (Delivery vs Payment) atomic settlement
   * 
   * This uses the new token standard with Holdings:
   * - Both parties' locked Holdings are swapped atomically
   * - Either both succeed or both rollback
   * - No partial state possible
   * 
   * Requirements:
   * - OrderV3 contracts (with lockedHoldingCid field)
   * - Holding contracts (locked for each order)
   * - SettlementInstruction template
   */
  async executeDvPSettlement(tradingPair, buyOrder, sellOrder, matchQty, matchPrice, adminToken) {
    const settlementService = getSettlementService();
    const [baseSymbol, quoteSymbol] = tradingPair.split('/');
    const quoteAmount = matchQty * matchPrice;
    
    console.log(`[MatchingEngine] 🔄 Executing DvP settlement...`);
    console.log(`  Base: ${matchQty} ${baseSymbol}`);
    console.log(`  Quote: ${quoteAmount} ${quoteSymbol}`);
    console.log(`  Buyer: ${buyOrder.owner.substring(0, 30)}...`);
    console.log(`  Seller: ${sellOrder.owner.substring(0, 30)}...`);
    
    try {
      // Execute atomic settlement via SettlementService
      const result = await settlementService.settleMatch({
        buyOrder: {
          ...buyOrder,
          tradingPair,
          lockedHoldingCid: buyOrder.lockedHoldingCid || buyOrder.holdingCid,
        },
        sellOrder: {
          ...sellOrder,
          tradingPair,
          lockedHoldingCid: sellOrder.lockedHoldingCid || sellOrder.holdingCid,
        },
        fillQuantity: matchQty,
        fillPrice: matchPrice,
      }, adminToken);
      
      console.log(`[MatchingEngine] ✅ DvP Settlement complete: Trade ${result.tradeContractId}`);
      
      // Broadcast trade
      const tradeRecord = {
        tradeId: result.tradeContractId,
        buyer: buyOrder.owner,
        seller: sellOrder.owner,
        tradingPair,
        price: matchPrice.toString(),
        quantity: matchQty.toString(),
        buyOrderId: buyOrder.orderId,
        sellOrderId: sellOrder.orderId,
        timestamp: new Date().toISOString(),
        settlementType: 'DvP',
      };
      
      if (global.broadcastWebSocket) {
        global.broadcastWebSocket(`trades:${tradingPair}`, {
          type: 'NEW_TRADE',
          ...tradeRecord
        });
        global.broadcastWebSocket('trades:all', {
          type: 'NEW_TRADE',
          ...tradeRecord
        });
        global.broadcastWebSocket(`orderbook:${tradingPair}`, {
          type: 'DVP_SETTLEMENT',
          buyOrderId: buyOrder.orderId,
          sellOrderId: sellOrder.orderId,
          fillQuantity: matchQty,
          fillPrice: matchPrice,
        });
      }
      
      return result;
    } catch (error) {
      console.error(`[MatchingEngine] ❌ DvP Settlement failed:`, error.message);
      
      // If DvP fails, try to cancel the settlement and return locked funds
      // This is automatic in the Settlement contract - on failure, nothing changes
      console.log(`[MatchingEngine] Holdings remain locked - manual unlock may be required`);
      
      throw error;
    }
  }
  
  /**
   * Update UserAccount balances after a trade
   * 
   * Buyer: receives base token (+matchQty BTC), already withdrew quote (-quoteAmount USDT when order placed)
   * Seller: receives quote token (+quoteAmount USDT), gives base token (-matchQty BTC)
   * 
   * Uses UpdateAfterTrade choice which is controlled by OPERATOR (not party like Deposit)
   * 
   * IMPORTANT: Re-query for each account IMMEDIATELY before exercising choice
   * because DAML contracts are immutable - each choice creates a new contract with new ID
   */
  async updateBalancesAfterTrade(adminToken, tradingPair, buyerPartyId, sellerPartyId, matchQty, matchPrice) {
    const packageId = config.canton.packageIds?.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;
    
    if (!packageId || !operatorPartyId) return;
    
    const [baseToken, quoteToken] = tradingPair.split('/');
    const quoteAmount = matchQty * matchPrice;
    
    // Helper to find fresh UserAccount contract for a party
    const findFreshAccount = async (partyId) => {
      const contracts = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [`${packageId}:UserAccount:UserAccount`],
        pageSize: 200
      }, adminToken);
      return contracts.find(c => (c.payload?.party || c.createArgument?.party) === partyId);
    };
    
    // ========== UPDATE BUYER BALANCE ==========
    // Buyer receives base token (BTC), quote token was already deducted when order was placed
    const buyerAccount = await findFreshAccount(buyerPartyId);
    if (buyerAccount) {
      try {
        await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: operatorPartyId,  // UpdateAfterTrade is controlled by operator
          templateId: `${packageId}:UserAccount:UserAccount`,
          contractId: buyerAccount.contractId,
          choice: 'UpdateAfterTrade',
          choiceArgument: {
            baseToken: baseToken,
            quoteToken: quoteToken,
            baseAmount: matchQty.toFixed(8),   // +BTC (buyer receives)
            quoteAmount: '0.00000000'          // Already deducted when order placed
          },
          readAs: [operatorPartyId]
        });
        console.log(`[MatchingEngine] ✅ Credited ${matchQty.toFixed(8)} ${baseToken} to buyer`);
      } catch (e) {
        console.error(`[MatchingEngine] ❌ Failed to update buyer balance:`, e.message);
      }
    } else {
      console.warn(`[MatchingEngine] ⚠️ No UserAccount found for buyer: ${buyerPartyId.substring(0, 30)}...`);
    }
    
    // ========== UPDATE SELLER BALANCE ==========
    // Seller receives quote token (USDT)
    // BTC was ALREADY deducted when they placed the SELL order (withdrawForOrder)
    // Query FRESH contract immediately before exercising (buyer update created new contracts)
    const sellerAccount = await findFreshAccount(sellerPartyId);
    if (sellerAccount) {
      try {
        await cantonService.exerciseChoice({
          token: adminToken,
          actAsParty: operatorPartyId,  // UpdateAfterTrade is controlled by operator
          templateId: `${packageId}:UserAccount:UserAccount`,
          contractId: sellerAccount.contractId,
          choice: 'UpdateAfterTrade',
          choiceArgument: {
            baseToken: baseToken,
            quoteToken: quoteToken,
            baseAmount: '0.00000000',              // BTC already deducted when sell order placed
            quoteAmount: quoteAmount.toFixed(8)     // +USDT (seller receives payment)
          },
          readAs: [operatorPartyId]
        });
        console.log(`[MatchingEngine] ✅ Credited ${quoteAmount.toFixed(8)} ${quoteToken} to seller`);
      } catch (e) {
        console.error(`[MatchingEngine] ❌ Failed to update seller balance:`, e.message);
      }
    } else {
      console.warn(`[MatchingEngine] ⚠️ No UserAccount found for seller: ${sellerPartyId.substring(0, 30)}...`);
    }
  }
  
  /**
   * Process order book from UpdateStream (persistent storage)
   */
  async processOrderBookFromUpdateStream(tradingPair, buyOrders, sellOrders, adminToken) {
    try {
      if (buyOrders.length === 0 || sellOrders.length === 0) {
        return; // No matches possible
      }
      
      // Sort orders by price-time priority
      const sortedBuys = this.sortBuyOrders(buyOrders.map(o => ({
        contractId: o.contractId,
        orderId: o.orderId,
        owner: o.owner,
        orderType: 'BUY',
        orderMode: o.orderMode || 'LIMIT',
        price: o.price,
        quantity: parseFloat(o.quantity) || 0,
        filled: parseFloat(o.filled) || 0,
        status: o.status || 'OPEN',
        timestamp: o.timestamp
      })));
      
      const sortedSells = this.sortSellOrders(sellOrders.map(o => ({
        contractId: o.contractId,
        orderId: o.orderId,
        owner: o.owner,
        orderType: 'SELL',
        orderMode: o.orderMode || 'LIMIT',
        price: o.price,
        quantity: parseFloat(o.quantity) || 0,
        filled: parseFloat(o.filled) || 0,
        status: o.status || 'OPEN',
        timestamp: o.timestamp
      })));
      
      // Find matches
      const matches = this.findMatches(sortedBuys, sortedSells);
      
      if (matches.length === 0) {
        return;
      }
      
      console.log(`[MatchingEngine] Found ${matches.length} potential matches for ${tradingPair}`);
      
      // Execute each match
      for (const match of matches) {
        await this.executeMatchDirect(match, tradingPair, adminToken);
      }
    } catch (error) {
      console.error(`[MatchingEngine] Error processing UpdateStream order book:`, error.message);
    }
  }

  /**
   * Process order book from ReadModel cache
   */
  async processOrderBookFromCache(cachedBook, adminToken) {
    try {
      const tradingPair = cachedBook.pair;
      const buyOrders = cachedBook.bids || [];
      const sellOrders = cachedBook.asks || [];
      
      if (buyOrders.length === 0 || sellOrders.length === 0) {
        return; // No matches possible
      }
      
      console.log(`[MatchingEngine] Processing cached order book: ${tradingPair} (${buyOrders.length} buys, ${sellOrders.length} sells)`);
      
      // Sort orders by price-time priority
      const sortedBuys = this.sortBuyOrders(buyOrders.map(o => ({
        contractId: o.contractId,
        owner: o.owner,
        orderType: 'BUY',
        orderMode: o.orderMode || 'LIMIT',
        price: o.price,
        quantity: o.quantity,
        filled: o.filled || 0,
        status: 'OPEN',
        timestamp: o.timestamp
      })));
      
      const sortedSells = this.sortSellOrders(sellOrders.map(o => ({
        contractId: o.contractId,
        owner: o.owner,
        orderType: 'SELL',
        orderMode: o.orderMode || 'LIMIT',
        price: o.price,
        quantity: o.quantity,
        filled: o.filled || 0,
        status: 'OPEN',
        timestamp: o.timestamp
      })));
      
      // Find matches
      const matches = this.findMatches(sortedBuys, sortedSells);
      
      if (matches.length === 0) {
        return;
      }
      
      console.log(`[MatchingEngine] Found ${matches.length} potential matches for ${tradingPair}`);
      
      // Execute matches via direct order choice (not MasterOrderBook)
      for (const match of matches) {
        await this.executeMatchDirect(match, tradingPair, adminToken);
      }
    } catch (error) {
      console.error('[MatchingEngine] Error processing cached order book:', error.message);
    }
  }
  
  /**
   * Execute a match directly using Order contracts
   */
  async executeMatchDirect(match, tradingPair, adminToken) {
    try {
      const { buyOrder, sellOrder } = match;
      
      // Self-trade prevention DISABLED per client request
      // Market will handle it naturally
      
      // Calculate match quantity (minimum of remaining quantities)
      const buyRemaining = (parseFloat(buyOrder.quantity) || 0) - (parseFloat(buyOrder.filled) || 0);
      const sellRemaining = (parseFloat(sellOrder.quantity) || 0) - (parseFloat(sellOrder.filled) || 0);
      const matchQuantity = Math.min(buyRemaining, sellRemaining);
      
      // Match price (use sell price for maker-taker model)
      const matchPrice = parseFloat(sellOrder.price) || parseFloat(buyOrder.price) || 0;
      
      if (matchQuantity <= 0 || matchPrice <= 0) {
        console.log(`[MatchingEngine] Invalid match: qty=${matchQuantity}, price=${matchPrice}`);
        return;
      }
      
      console.log(`[MatchingEngine] Executing match: BUY ${buyOrder.contractId?.substring(0, 15)}... @ ${matchPrice} x ${matchQuantity}`);
      
      // Update orders in ReadModel cache
      const { getReadModelService } = require('./readModelService');
      const readModel = getReadModelService();
      
      // Add trade to UpdateStream for persistence AND in-memory store
      const tradeId = `trade-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const tradeData = {
        tradeId,
        tradingPair,
        buyer: buyOrder.owner,
        seller: sellOrder.owner,
        price: matchPrice.toString(),
        quantity: matchQuantity.toString(),
        buyOrderId: buyOrder.orderId || buyOrder.contractId,
        sellOrderId: sellOrder.orderId || sellOrder.contractId,
        timestamp: new Date().toISOString()
      };
      
      // Create Trade contract on Canton (NO IN-MEMORY CACHE)
      try {
        const packageId = config.canton.packageIds?.clobExchange;
        const operatorPartyId = config.canton.operatorPartyId;
        const adminToken = await this.getAdminToken();
        
        await cantonService.createContractWithTransaction({
          token: adminToken,
          actAsParty: [operatorPartyId, buyOrder.owner, sellOrder.owner],
          templateId: `${packageId}:Trade:Trade`,
          createArguments: tradeData,
          readAs: [operatorPartyId, buyOrder.owner, sellOrder.owner]
        });
        console.log(`[MatchingEngine] ✅ Trade contract created on Canton: ${tradeId}`);
      } catch (tradeContractError) {
        console.error(`[MatchingEngine] Failed to create Trade contract:`, tradeContractError.message);
      }
      
      // Broadcast trade via WebSocket for real-time UI updates
      if (global.broadcastWebSocket) {
        const tradeData = {
          type: 'NEW_TRADE',
          tradeId,
          tradingPair,
          buyer: buyOrder.owner,
          seller: sellOrder.owner,
          price: matchPrice.toString(),
          quantity: matchQuantity.toString(),
          buyOrderId: buyOrder.orderId || buyOrder.contractId,
          sellOrderId: sellOrder.orderId || sellOrder.contractId,
          timestamp: new Date().toISOString()
        };
        
        global.broadcastWebSocket(`trades:${tradingPair}`, tradeData);
        global.broadcastWebSocket('trades:all', tradeData);
        console.log(`[MatchingEngine] 📡 Trade broadcasted via WebSocket`);
      }
      
      // Update ReadModel cache
      if (readModel) {
        // Mark orders as filled/partially filled in cache
        const buyFilled = (parseFloat(buyOrder.filled) || 0) + matchQuantity;
        const sellFilled = (parseFloat(sellOrder.filled) || 0) + matchQuantity;
        
        if (buyFilled >= parseFloat(buyOrder.quantity)) {
          readModel.removeOrder(buyOrder.contractId);
        }
        if (sellFilled >= parseFloat(sellOrder.quantity)) {
          readModel.removeOrder(sellOrder.contractId);
        }
      }
      
    } catch (error) {
      console.error(`[MatchingEngine] Error executing match:`, error.message);
    }
  }

  /**
   * Process a single order book
   */
  async processOrderBook(orderBook, adminToken) {
    try {
      const contractId = orderBook.contractId;
      const payload = orderBook.payload;
      const operator = payload.operator;
      const tradingPair = payload.tradingPair;

      console.log(`[MatchingEngine] Processing order book: ${tradingPair}`);

      // Get all orders for this order book
      const buyOrderCids = payload.buyOrders || [];
      const sellOrderCids = payload.sellOrders || [];

      if (buyOrderCids.length === 0 || sellOrderCids.length === 0) {
        return; // No matches possible
      }

      // Fetch full order details
      const buyOrders = await this.fetchOrders(buyOrderCids, adminToken);
      const sellOrders = await this.fetchOrders(sellOrderCids, adminToken);

      // Sort orders by price-time priority
      const sortedBuys = this.sortBuyOrders(buyOrders);
      const sortedSells = this.sortSellOrders(sellOrders);

      // Find matches
      const matches = this.findMatches(sortedBuys, sortedSells);

      if (matches.length === 0) {
        return;
      }

      console.log(`[MatchingEngine] Found ${matches.length} potential matches for ${tradingPair}`);

      // Execute matches
      for (const match of matches) {
        await this.executeMatch(contractId, match, operator, adminToken);
      }
    } catch (error) {
      console.error('[MatchingEngine] Error processing order book:', error.message);
    }
  }

  /**
   * Get ledger end offset
   */
  async getLedgerEndOffset(adminToken) {
    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/ledger-end`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get ledger end: ${response.status}`);
    }

    const data = await response.json();
    return data.offset || data.ledgerEnd || '0';
  }

  /**
   * Query active contracts by template using Canton JSON API v2 format
   * POST /v2/state/active-contracts
   * https://docs.digitalasset.com/build/3.5/reference/json-api/openapi.html
   */
  async queryContracts(templateId, adminToken, limit = 100) {
    // Get current ledger end
    const activeAtOffset = await this.getLedgerEndOffset(adminToken);

    // Use actual operator party ID from config
    const operatorPartyId = config.canton.operatorPartyId;

    // Canton JSON API v2 filter format - use templateFilters (NOT inclusive/templateIds)
    const response = await fetch(`${config.canton.jsonApiBase}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        filter: {
          filtersByParty: {
            [operatorPartyId]: {
              // Canton JSON API v2 uses templateFilters array
              templateFilters: [{
                templateId: templateId,
                includeCreatedEventBlob: false
              }]
            }
          }
        },
        verbose: false,
        activeAtOffset: activeAtOffset,
        pageSize: limit
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // Handle 200 element limit gracefully
      if (errorText.includes('JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED')) {
        console.log('[MatchingEngine] ℹ️ 200+ contracts found, using smaller page size');
        return []; // Return empty - let caller handle
      }
      
      console.error('[MatchingEngine] Query error details:', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText.substring(0, 200),
        templateId: templateId,
        operatorPartyId: operatorPartyId
      });
      throw new Error(`Failed to query contracts: ${response.status}`);
    }

    const data = await response.json();
    const contracts = data.activeContracts || [];

    console.log(`[MatchingEngine] Found ${contracts.length} contracts for template`);

    return contracts.map(c => ({
      contractId: c.contractId || c.contract_id,
      payload: c.payload || c.argument || c.createArgument,
    }));
  }

  getMasterOrderBookTemplateId() {
    const packageId = config.canton.packageIds?.clobExchange || config.canton.packageIds?.masterOrderBook;
    if (!packageId) {
      throw new Error('Missing package ID for MasterOrderBook template');
    }
    return {
      packageId,
      moduleName: 'MasterOrderBook',
      entityName: 'MasterOrderBook',
    };
  }

  /**
   * Fetch order contracts
   */
  async fetchOrders(orderCids, adminToken) {
    const orders = [];

    for (const cid of orderCids) {
      try {
        const order = await this.fetchContract(cid, adminToken);
        if (order) {
          orders.push({
            contractId: cid,
            ...order.payload,
          });
        }
      } catch (error) {
        console.warn('[MatchingEngine] Failed to fetch order:', cid, error.message);
      }
    }

    return orders;
  }

  /**
   * Fetch single contract using correct endpoint
   */
  async fetchContract(contractId, adminToken) {
    // Use centralized config - NO HARDCODED FALLBACKS
    const cantonApiBase = config.canton.jsonApiBase;
    if (!cantonApiBase) {
      throw new Error('CANTON_JSON_LEDGER_API_BASE is required');
    }

    const response = await fetch(`${cantonApiBase}/v2/contracts/lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        contractId: contractId,
      }),
    });

    if (!response.ok) {
      console.warn('[MatchingEngine] Failed to fetch contract:', contractId, response.status);
      return null;
    }

    const data = await response.json();
    return {
      contractId: data.contractId || contractId,
      payload: data.payload || data.argument,
    };
  }

  /**
   * Sort buy orders (highest price first, then earliest timestamp)
   */
  sortBuyOrders(orders) {
    return orders.sort((a, b) => {
      // Market orders (no price) have highest priority
      if (!a.price && b.price) return -1;
      if (a.price && !b.price) return 1;
      if (!a.price && !b.price) {
        return new Date(a.timestamp) - new Date(b.timestamp);
      }

      // Higher price has priority
      const priceA = parseFloat(a.price);
      const priceB = parseFloat(b.price);

      if (priceA > priceB) return -1;
      if (priceA < priceB) return 1;

      // Same price: earlier timestamp wins
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
  }

  /**
   * Sort sell orders (lowest price first, then earliest timestamp)
   */
  sortSellOrders(orders) {
    return orders.sort((a, b) => {
      // Market orders (no price) have highest priority
      if (!a.price && b.price) return -1;
      if (a.price && !b.price) return 1;
      if (!a.price && !b.price) {
        return new Date(a.timestamp) - new Date(b.timestamp);
      }

      // Lower price has priority
      const priceA = parseFloat(a.price);
      const priceB = parseFloat(b.price);

      if (priceA < priceB) return -1;
      if (priceA > priceB) return 1;

      // Same price: earlier timestamp wins
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
  }

  /**
   * Find matching orders
   * NOTE: Self-trade prevention DISABLED per client request - market handles it naturally
   */
  findMatches(buyOrders, sellOrders) {
    const matches = [];

    for (const buyOrder of buyOrders) {
      for (const sellOrder of sellOrders) {
        // Self-trade prevention DISABLED per client request
        // Market will handle it naturally

        // Check if orders can match
        if (this.canOrdersMatch(buyOrder, sellOrder)) {
          matches.push({
            buyOrderCid: buyOrder.contractId,
            sellOrderCid: sellOrder.contractId,
            buyOrder,
            sellOrder,
          });

          // For now, only match one pair per cycle to avoid conflicts
          // In production, you might want to batch multiple non-conflicting matches
          break;
        }
      }

      if (matches.length > 0) break;
    }

    return matches;
  }

  /**
   * Check if two orders can match
   */
  canOrdersMatch(buyOrder, sellOrder) {
    // Both must have remaining quantity
    const buyRemaining = parseFloat(buyOrder.quantity) - parseFloat(buyOrder.filled || 0);
    const sellRemaining = parseFloat(sellOrder.quantity) - parseFloat(sellOrder.filled || 0);

    if (buyRemaining <= 0 || sellRemaining <= 0) {
      return false;
    }

    // Check price overlap
    if (buyOrder.price && sellOrder.price) {
      const buyPrice = parseFloat(buyOrder.price);
      const sellPrice = parseFloat(sellOrder.price);
      return buyPrice >= sellPrice;
    }

    // Market orders always match
    return true;
  }

  /**
   * Execute a match
   */
  async executeMatch(orderBookCid, match, operator, adminToken) {
    try {
      console.log('[MatchingEngine] Executing match:');
      console.log('  Buy Order:', match.buyOrderCid.substring(0, 20) + '...');
      console.log('  Sell Order:', match.sellOrderCid.substring(0, 20) + '...');

      // Call MatchOrders choice on OrderBook using proper exerciseChoice
      const result = await cantonService.exerciseChoice({
        token: adminToken,
        actAsParty: operator,
        templateId: this.getMasterOrderBookTemplateId(),
        contractId: orderBookCid,
        choice: 'MatchOrders',
        choiceArgument: {
          buyCid: match.buyOrderCid,
          sellCid: match.sellOrderCid,
        },
        readAs: [operator],
      });

      console.log('[MatchingEngine] ✓ Match executed successfully');

      recordTradesFromResult(result);

      // Emit WebSocket event for real-time updates
      this.emitMatchEvent(match, result);

      // Mark as processed
      this.lastProcessedOrders.add(match.buyOrderCid);
      this.lastProcessedOrders.add(match.sellOrderCid);

      // Clean up old entries (keep last 1000)
      if (this.lastProcessedOrders.size > 1000) {
        const arr = Array.from(this.lastProcessedOrders);
        this.lastProcessedOrders = new Set(arr.slice(-1000));
      }
    } catch (error) {
      console.error('[MatchingEngine] Error executing match:', error.message);
    }
  }

  /**
   * Emit match event via WebSocket
   */
  emitMatchEvent(match, result) {
    try {
      // Use global broadcast function if available
      if (global.broadcastWebSocket) {
        const tradingPair = match.buyOrder.tradingPair || 'UNKNOWN';

        // Broadcast to orderbook channel
        global.broadcastWebSocket(`orderbook:${tradingPair}`, {
          type: 'MATCH',
          buyOrderCid: match.buyOrderCid,
          sellOrderCid: match.sellOrderCid,
          timestamp: new Date().toISOString(),
        });

        // Broadcast to trades channel
        global.broadcastWebSocket(`trades:${tradingPair}`, {
          type: 'NEW_TRADE',
          tradingPair: tradingPair,
          timestamp: new Date().toISOString(),
        });

        console.log('[MatchingEngine] ✓ WebSocket events emitted');
      }
    } catch (error) {
      console.error('[MatchingEngine] Error emitting WebSocket event:', error.message);
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update polling interval
   */
  setPollingInterval(ms) {
    this.pollingInterval = ms;
    console.log('[MatchingEngine] Polling interval updated to:', ms, 'ms');
  }
}

// Singleton instance
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
