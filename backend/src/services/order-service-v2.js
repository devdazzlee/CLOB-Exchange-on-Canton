/**
 * Order Service V2 - Token Standard Version
 * 
 * Uses proper token standard:
 * - Holdings instead of text balances
 * - OrderV3 contracts with locked holdings
 * - DvP settlement via SettlementService
 * 
 * Flow:
 * 1. User has Holdings (from minting)
 * 2. Place order: Find holding, lock it, create OrderV3
 * 3. Match: Create SettlementInstruction with both locked holdings
 * 4. Execute: DvP atomic swap
 * 5. Cancel: Unlock holding, archive order
 */

const cantonService = require('./cantonService');
const { getHoldingService } = require('./holdingService');
const { getSettlementService } = require('./settlementService');
const { getInstrumentService } = require('./instrumentService');
const config = require('../config');
const { getTokenStandardTemplateIds, TEMPLATE_IDS } = require('../config/constants');
const tokenProvider = require('./tokenProvider');
const crypto = require('crypto');

// Helper to get canton service instance
const getCantonService = () => cantonService;

// Template IDs - Use centralized constants (single source of truth)
const getTemplateIds = () => getTokenStandardTemplateIds();

class OrderServiceV2 {
  constructor() {
    this.cantonService = null;
    this.holdingService = null;
    this.settlementService = null;
    this.instrumentService = null;
  }

  async initialize() {
    this.cantonService = getCantonService();
    this.holdingService = getHoldingService();
    this.settlementService = getSettlementService();
    this.instrumentService = getInstrumentService();
    console.log('[OrderServiceV2] Initialized with Token Standard support');
  }

  /**
   * Place an order using Token Standard
   * 
   * @param {Object} params
   * @param {string} params.partyId - Party placing the order
   * @param {string} params.tradingPair - e.g., "BTC/USDT"
   * @param {string} params.side - "BUY" or "SELL"
   * @param {string} params.type - "LIMIT" or "MARKET"
   * @param {number} params.price - Price (null for market)
   * @param {number} params.quantity - Order quantity
   * @param {string} params.adminToken - Admin OAuth token
   */
  async placeOrder(params, adminToken) {
    const { partyId, tradingPair, side, type, price, quantity } = params;
    const cantonService = getCantonService();
    const holdingService = getHoldingService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.canton?.operatorPartyId || process.env.OPERATOR_PARTY_ID;
    const synchronizerId = config.canton?.defaultSynchronizerId || process.env.DEFAULT_SYNCHRONIZER_ID;

    const [baseSymbol, quoteSymbol] = tradingPair.split('/');
    const orderId = `order-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    console.log(`[OrderServiceV2] Placing ${side} ${type} order: ${quantity} ${baseSymbol} @ ${price || 'MARKET'}`);

    try {
      // 1. Determine which asset to lock
      // BUY: Lock quote currency (USDT)
      // SELL: Lock base currency (BTC)
      const lockSymbol = side.toUpperCase() === 'BUY' ? quoteSymbol : baseSymbol;
      const lockAmount = side.toUpperCase() === 'BUY' 
        ? (price ? parseFloat(price) * parseFloat(quantity) : null) 
        : parseFloat(quantity);

      if (lockAmount === null && type.toUpperCase() === 'LIMIT') {
        throw new Error('Price required for limit orders');
      }

      // 2. Find available Holdings to cover the required amount
      const holdings = await holdingService.getAvailableHoldings(partyId, lockSymbol, adminToken);
      
      if (!holdings || holdings.length === 0) {
        throw new Error(`No available ${lockSymbol} holdings. Please mint tokens first using /api/balance/v2/mint`);
      }

      // Find sufficient holdings
      let totalAvailable = holdings.reduce((sum, h) => sum + h.amount, 0);
      
      // For market orders, use all available
      const requiredAmount = lockAmount || totalAvailable;
      
      if (totalAvailable < requiredAmount) {
        throw new Error(`Insufficient ${lockSymbol} balance. Required: ${requiredAmount}, Available: ${totalAvailable}`);
      }

      // Use the largest holding (or combine if needed)
      const holdingToLock = holdings[0]; // Already sorted by amount descending

      // Check if this is a Splice holding (CBTC, Amulet, etc.)
      // Splice holdings use different templates and cannot be locked with our custom Lock choice
      const isSpliceHolding = holdingToLock.isSplice || 
        holdingToLock.templateId?.includes('Splice') || 
        holdingToLock.templateId?.includes('Registry');
      
      let lockedHoldingCid = null;

      if (isSpliceHolding) {
        // For Splice holdings (CBTC, CC), skip locking - use trust-based orders for now
        // In production, this would use the DvP Settlement flow from Splice Token Standard
        console.log(`[OrderServiceV2] Splice holding detected - skipping lock (trust-based order)`);
        console.log(`[OrderServiceV2] Reference holding: ${holdingToLock.contractId.substring(0, 30)}...`);
        lockedHoldingCid = holdingToLock.contractId; // Reference the unlocked holding
      } else {
        // 3. Lock the holding for this order (custom holdings only)
        console.log(`[OrderServiceV2] Locking ${requiredAmount} ${lockSymbol} for order ${orderId}`);
        
        const lockResult = await holdingService.lockHolding(
          holdingToLock.contractId,
          operatorPartyId, // Lock holder is the exchange operator
          `order-${orderId}`,
          requiredAmount,
          partyId,
          adminToken
        );

        // holdingService.lockHolding returns { result, newLockedHoldingCid }
        lockedHoldingCid = lockResult.newLockedHoldingCid;

        // Fallback: try to extract from raw transaction events if not returned directly
        if (!lockedHoldingCid) {
          const rawResult = lockResult.result || lockResult;
          const events = rawResult?.transaction?.events || rawResult?.events || [];
          lockedHoldingCid = events.find(e => 
            e.created?.templateId?.includes('Holding') || 
            e.CreatedEvent?.templateId?.includes('Holding')
          )?.created?.contractId || 
          events.find(e => e.CreatedEvent)?.CreatedEvent?.contractId;
        }

        if (!lockedHoldingCid) {
          console.error('[OrderServiceV2] Lock result:', JSON.stringify(lockResult, null, 2));
          throw new Error('Failed to lock holding for order - no contract ID in response');
        }

        console.log(`[OrderServiceV2] Holding locked: ${lockedHoldingCid.substring(0, 30)}...`);
      }

      // 4. Create the OrderV3 contract
      const instrumentService = getInstrumentService();
      const baseInstrumentId = instrumentService.getInstrumentId(baseSymbol);
      const quoteInstrumentId = instrumentService.getInstrumentId(quoteSymbol);

     // Order template arguments
     // Uses simple strings instead of variants
      const orderArgs = {
        orderId,
        owner: partyId,
        operator: operatorPartyId,
        orderType: side.toUpperCase(), // "BUY" or "SELL" - side in template
        orderMode: type.toUpperCase(), // "LIMIT" or "MARKET"
        tradingPair,
        price: price ? price.toString() : null, // Optional Decimal
        quantity: quantity.toString(),
        filled: '0',
        status: 'OPEN',
        timestamp: new Date().toISOString(),
        allocationCid: lockedHoldingCid || '', // Reference to locked holding (placeholder)
      };

      // Use the new Order template (v2.1.0 with Optional newAllocationCid in FillOrder)
      const orderTemplateId = TEMPLATE_IDS.orderNew || TEMPLATE_IDS.order;
      console.log(`[OrderServiceV2] Using Order template: ${orderTemplateId.substring(0, 40)}...`);
      
      // The Order template has `signatory owner`, so we need the user party to authorize
      // We submit as both operator (admin token) AND user party
      const orderResult = await cantonService.createContractWithTransaction({
        token: adminToken,
        actAsParty: [operatorPartyId, partyId], // Both operator and user need to authorize
        templateId: orderTemplateId,
        createArguments: orderArgs,
        readAs: [partyId, operatorPartyId],
        synchronizerId,
      });

      const orderEvents = orderResult.transaction?.events || orderResult.events || [];
      const orderContractId = orderEvents.find(e =>
        e.created?.templateId?.includes('OrderV3:Order') ||
        e.created?.templateId?.includes('Order')
      )?.created?.contractId ||
      orderEvents.find(e => e.CreatedEvent)?.CreatedEvent?.contractId;

      console.log(`[OrderServiceV2] Order created: ${orderContractId?.substring(0, 30)}...`);

      return {
        success: true,
        order: {
          orderId,
          contractId: orderContractId,
          owner: partyId,
          tradingPair,
          side: side.toUpperCase(),
          type: type.toUpperCase(),
          price: price || null,
          quantity,
          filledQuantity: 0,
          status: 'OPEN',
          lockedHoldingCid,
          lockedAmount: requiredAmount,
          createdAt: new Date().toISOString(),
        },
        tokenStandard: true,
      };
    } catch (error) {
      console.error('[OrderServiceV2] Order placement failed:', error.message);
      throw error;
    }
  }

  /**
   * Cancel an order - unlock the holding
   */
  async cancelOrder(orderContractId, partyId, adminToken) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.canton?.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    console.log(`[OrderServiceV2] Cancelling order: ${orderContractId.substring(0, 30)}...`);

    try {
      // First, fetch the order to get its allocationCid (locked holding) BEFORE cancellation
      let orderAllocationCid = null;
      try {
        const templateIdsToQuery = [templateIds.order];
        if (TEMPLATE_IDS.order && TEMPLATE_IDS.order !== templateIds.order) {
          templateIdsToQuery.push(TEMPLATE_IDS.order);
        }
        const allOrders = await cantonService.queryActiveContracts({
          party: operatorPartyId,
          templateIds: templateIdsToQuery,
        }, adminToken);
        const orderContract = allOrders.find(c => c.contractId === orderContractId);
        if (orderContract) {
          orderAllocationCid = orderContract.payload?.allocationCid;
          console.log(`[OrderServiceV2] Order has allocationCid: ${orderAllocationCid?.substring(0, 30)}...`);
        }
      } catch (fetchErr) {
        console.warn(`[OrderServiceV2] Could not fetch order before cancel: ${fetchErr.message.substring(0, 60)}`);
      }

      // Exercise the CancelOrder choice - try new template first, fallback to legacy
      let result;
      try {
        result = await cantonService.exerciseChoice({
          token: adminToken,
          templateId: templateIds.order,
          contractId: orderContractId,
          choice: 'CancelOrder',
          choiceArgument: {},
          actAsParty: [operatorPartyId, partyId],
          readAs: [operatorPartyId, partyId],
        });
      } catch (newErr) {
        console.log(`[OrderServiceV2] Cancel with new template failed, trying legacy: ${newErr.message.substring(0, 60)}`);
        result = await cantonService.exerciseChoice({
          token: adminToken,
          templateId: TEMPLATE_IDS.order,
          contractId: orderContractId,
          choice: 'CancelOrder',
          choiceArgument: {},
          actAsParty: [operatorPartyId, partyId],
          readAs: [operatorPartyId, partyId],
        });
      }

      // CancelOrder archives the old order and creates a new one with status=CANCELLED
      // Now we need to unlock the holding that was locked for this order
      const lockedHoldingCid = orderAllocationCid;

      let unlockedHoldingCid = null;
      // Only unlock if allocationCid is a real contract ID (not a marker like "FILL_ONLY", "NONE")
      const isRealLock = lockedHoldingCid && lockedHoldingCid !== '' && 
        lockedHoldingCid !== 'FILL_ONLY' && lockedHoldingCid !== 'NONE' && lockedHoldingCid.length >= 40;
      if (isRealLock) {
        try {
          console.log(`[OrderServiceV2] Unlocking holding: ${lockedHoldingCid.substring(0, 30)}...`);
          const unlockResult = await cantonService.exerciseChoice({
            token: adminToken,
            templateId: templateIds.holding || TEMPLATE_IDS.holding,
            contractId: lockedHoldingCid,
            choice: 'Holding_Unlock',
            choiceArgument: {},
            actAsParty: [partyId, operatorPartyId],
            readAs: [operatorPartyId, partyId],
          });
          const unlockEvents = unlockResult?.transaction?.events || unlockResult?.events || [];
          for (const ev of unlockEvents) {
            const created = ev.created || ev.CreatedEvent || ev;
            const tplId = typeof created?.templateId === 'string' ? created.templateId : '';
            if (tplId.includes('Holding') && created?.contractId) {
              unlockedHoldingCid = created.contractId;
              break;
            }
          }
          console.log(`[OrderServiceV2] ✅ Holding unlocked: ${unlockedHoldingCid?.substring(0, 30)}...`);
        } catch (unlockErr) {
          console.warn(`[OrderServiceV2] ⚠️ Holding unlock failed (may already be archived): ${unlockErr.message.substring(0, 80)}`);
        }
      } else {
        console.log('[OrderServiceV2] No allocationCid found on order - skipping unlock');
      }

      console.log(`[OrderServiceV2] Order cancelled successfully`);

      return {
        success: true,
        cancelledOrderId: orderContractId,
        unlockedHoldingCid,
        tokenStandard: true,
      };
    } catch (error) {
      console.error('[OrderServiceV2] Order cancellation failed:', error.message);
      throw error;
    }
  }

  /**
   * Get all orders for a party
   */
  async getOrders(partyId, status, adminToken) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.canton?.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    try {
      // Query BOTH new and legacy Order templates for backward compatibility
      const templateIdsToQuery = [templateIds.order];
      if (TEMPLATE_IDS.order && TEMPLATE_IDS.order !== templateIds.order) {
        templateIdsToQuery.push(TEMPLATE_IDS.order); // Add legacy
      }
      const contracts = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: templateIdsToQuery,
      }, adminToken);

      // Filter by owner
      let orders = contracts.filter(c => c.payload?.owner === partyId);

      // Filter by status if specified
      if (status) {
        const statusTag = status.toUpperCase();
        orders = orders.filter(c => {
          const orderStatus = c.payload?.status?.tag || c.payload?.status;
          return orderStatus?.toUpperCase() === statusTag;
        });
      }

      return orders.map(c => ({
        contractId: c.contractId,
        orderId: c.payload.orderId,
        owner: c.payload.owner,
        tradingPair: c.payload.tradingPair || `${c.payload.baseInstrumentId?.symbol}/${c.payload.quoteInstrumentId?.symbol}`,
        side: c.payload.orderType?.tag || c.payload.orderType || c.payload.side?.tag || c.payload.side,
        type: c.payload.orderMode?.tag || c.payload.orderMode || c.payload.orderType?.tag || c.payload.type,
        price: c.payload.price?.Some || c.payload.price,
        quantity: c.payload.quantity,
        filledQuantity: c.payload.filled || c.payload.filledQuantity || '0',
        remaining: (parseFloat(c.payload.quantity) - parseFloat(c.payload.filled || c.payload.filledQuantity || 0)).toString(),
        status: c.payload.status?.tag || c.payload.status,
        allocationCid: c.payload.allocationCid,
        lockedHoldingCid: c.payload.lockedHoldingCid || c.payload.allocationCid,
        createdAt: c.payload.createdAt || c.payload.timestamp,
        tokenStandard: true,
      }));
    } catch (error) {
      console.error('[OrderServiceV2] Failed to get orders:', error.message);
      throw error;
    }
  }

  /**
   * Get open orders for the orderbook
   */
  async getOpenOrders(tradingPair, adminToken) {
    const cantonService = getCantonService();
    const templateIds = getTemplateIds();
    const operatorPartyId = config.canton?.operatorPartyId || process.env.OPERATOR_PARTY_ID;

    try {
      // Query BOTH new and legacy Order templates for backward compatibility
      const templateIdsToQuery = [templateIds.order];
      if (TEMPLATE_IDS.order && TEMPLATE_IDS.order !== templateIds.order) {
        templateIdsToQuery.push(TEMPLATE_IDS.order); // Add legacy
      }
      const contracts = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: templateIdsToQuery,
      }, adminToken);

      // Filter by trading pair and open status
      const [baseSymbol, quoteSymbol] = tradingPair.split('/');
      
      return contracts
        .filter(c => {
          const payload = c.payload;
          const isMatchingPair = payload.baseInstrumentId?.symbol === baseSymbol &&
                                 payload.quoteInstrumentId?.symbol === quoteSymbol;
          const isOpen = ['Open', 'PartiallyFilled'].includes(
            payload.status?.tag || payload.status
          );
          return isMatchingPair && isOpen;
        })
        .map(c => ({
          contractId: c.contractId,
          orderId: c.payload.orderId,
          owner: c.payload.owner,
          side: c.payload.side?.tag || c.payload.side,
          type: c.payload.orderType?.tag || c.payload.orderType,
          price: parseFloat(c.payload.price?.Some || c.payload.price || 0),
          quantity: parseFloat(c.payload.quantity),
          filledQuantity: parseFloat(c.payload.filledQuantity || 0),
          remaining: parseFloat(c.payload.quantity) - parseFloat(c.payload.filledQuantity || 0),
          lockedHoldingCid: c.payload.lockedHoldingCid,
          createdAt: c.payload.createdAt,
          tokenStandard: true,
        }));
    } catch (error) {
      console.error('[OrderServiceV2] Failed to get open orders:', error.message);
      throw error;
    }
  }

  /**
   * Build orderbook from open orders
   */
  async getOrderBook(tradingPair, adminToken) {
    const orders = await this.getOpenOrders(tradingPair, adminToken);

    // Separate buys and sells
    const bids = orders
      .filter(o => o.side === 'Buy')
      .sort((a, b) => b.price - a.price); // Highest first

    const asks = orders
      .filter(o => o.side === 'Sell')
      .sort((a, b) => a.price - b.price); // Lowest first

    // Aggregate by price
    const aggregateBids = this.aggregateOrders(bids);
    const aggregateAsks = this.aggregateOrders(asks);

    return {
      tradingPair,
      bids: aggregateBids,
      asks: aggregateAsks,
      spread: aggregateAsks.length > 0 && aggregateBids.length > 0
        ? aggregateAsks[0].price - aggregateBids[0].price
        : null,
      lastPrice: null, // Would come from trades
      tokenStandard: true,
    };
  }

  /**
   * Aggregate orders by price level
   */
  aggregateOrders(orders) {
    const priceMap = new Map();

    for (const order of orders) {
      const price = order.price;
      if (!priceMap.has(price)) {
        priceMap.set(price, {
          price,
          quantity: 0,
          count: 0,
          orders: [],
        });
      }
      const level = priceMap.get(price);
      level.quantity += order.remaining;
      level.count += 1;
      level.orders.push(order);
    }

    return Array.from(priceMap.values())
      .map(level => ({
        price: level.price.toFixed(2),
        quantity: level.quantity.toFixed(8),
        remaining: level.quantity.toFixed(8),
        count: level.count,
        _orders: level.orders,
      }));
  }
}

// Singleton
let orderServiceV2Instance = null;

function getOrderServiceV2() {
  if (!orderServiceV2Instance) {
    orderServiceV2Instance = new OrderServiceV2();
  }
  return orderServiceV2Instance;
}

module.exports = {
  OrderServiceV2,
  getOrderServiceV2,
};
