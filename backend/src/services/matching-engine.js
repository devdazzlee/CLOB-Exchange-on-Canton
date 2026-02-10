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

        // Self-trade prevention disabled per client request (comment at top of file)
        // Uncomment the following to prevent self-trades:
        // if (buyOrder.owner === sellOrder.owner) continue;

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

        try {
          await this.executeMatch(tradingPair, buyOrder, sellOrder, roundedQty, matchPrice, token, useDvP);
          return; // One match per cycle - exit
        } catch (error) {
          console.error(`[MatchingEngine] ❌ Match execution failed:`, error.message);
          
          // If DvP failed, try Fill-Only as a fallback
          // This handles Splice holdings (CC/CBTC) that can't be locked on-chain
          if (useDvP && (error.message?.includes('could not be found') || 
              error.message?.includes('CONTRACT_NOT_FOUND') ||
              error.message?.includes('WRONGLY_TYPED_CONTRACT') ||
              error.message?.includes('DvP settlement failed'))) {
            console.log(`[MatchingEngine] 🔄 DvP failed — retrying as Fill-Only...`);
            try {
              await this.executeMatch(tradingPair, buyOrder, sellOrder, roundedQty, matchPrice, token, false);
              console.log(`[MatchingEngine] ✅ Fill-Only fallback succeeded`);
              return; // Match succeeded
            } catch (fallbackError) {
              console.error(`[MatchingEngine] ❌ Fill-Only fallback also failed: ${fallbackError.message}`);
              // Mark holdings as stale so we don't retry DvP on them
              if (buyHasLock) this.staleHoldings.add(buyOrder.lockedHoldingCid);
              if (sellHasLock) this.staleHoldings.add(sellOrder.lockedHoldingCid);
              console.log(`[MatchingEngine] Stale cache size: ${this.staleHoldings.size}`);
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
    
    // ═══════════════════════════════════════════════════
    // STEP 1: DvP Settlement (atomic token swap) — only if both sides locked
    // ═══════════════════════════════════════════════════
    let tradeContractId = null;
    let createdHoldings = [];

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
    } else {
      console.log(`[MatchingEngine] 📋 Fill-only mode: ${matchQty} ${baseSymbol} @ ${matchPrice} ${quoteSymbol} (no DvP)`);
      
      // Create Trade contract on Canton for record keeping (even without DvP settlement)
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
    // STEP 1b: Credit recipients with actual token holdings (Fill-Only only)
    // 
    // DvP atomically swaps Holdings, but Fill-Only mode doesn't move tokens.
    // We mint new custom Holdings so balances actually change:
    //   - Buyer receives baseAmount of base asset (e.g., CC they bought)
    //   - Seller receives quoteAmount of quote asset (e.g., CBTC they received)
    // The "debit" side is handled by balance calc deducting filled order amounts.
    // ═══════════════════════════════════════════════════
    if (!useDvP) {
      try {
        const { getHoldingService } = require('./holdingService');
        const holdingService = getHoldingService();
        await holdingService.initialize();

        // Credit buyer with base asset (what they bought)
        console.log(`[MatchingEngine] 💰 Crediting buyer with ${matchQty} ${baseSymbol}...`);
        await holdingService.mintDirect(buyOrder.owner, baseSymbol, matchQty, token);
        console.log(`[MatchingEngine] ✅ Buyer credited: +${matchQty} ${baseSymbol}`);

        // Credit seller with quote asset (payment received)
        console.log(`[MatchingEngine] 💰 Crediting seller with ${quoteAmount} ${quoteSymbol}...`);
        await holdingService.mintDirect(sellOrder.owner, quoteSymbol, quoteAmount, token);
        console.log(`[MatchingEngine] ✅ Seller credited: +${quoteAmount} ${quoteSymbol}`);
      } catch (mintErr) {
        console.error(`[MatchingEngine] ⚠️ Token credit failed (non-critical): ${mintErr.message}`);
        // Trade record + order fills still succeeded - balance reconciled on next cycle
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
    // STEP 3: FillOrder on both Order contracts
    // For partial fills, pass newAllocationCid to update the order's reference
    // ═══════════════════════════════════════════════════
    console.log(`[MatchingEngine] 📝 Filling orders...`);

    // Fill buy order
    try {
      const buyFillArg = { fillQuantity: matchQty.toString() };
      if (buyOrder.isNewPackage) {
        if (useDvP) {
          // DvP: Pass the new locked holding CID if partial fill, or null (None) for full fill
          buyFillArg.newAllocationCid = buyNewAllocationCid ? buyNewAllocationCid : null;
        } else {
          // Fill-Only: Tag the order so balance service knows tokens were exchanged
          buyFillArg.newAllocationCid = 'FILL_ONLY';
        }
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
        if (useDvP) {
          sellFillArg.newAllocationCid = sellNewAllocationCid ? sellNewAllocationCid : null;
        } else {
          sellFillArg.newAllocationCid = 'FILL_ONLY';
        }
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
