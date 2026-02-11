/**
 * Order Controller
 * Handles order-related HTTP requests
 * 
 * Uses Canton JSON Ledger API v2:
 * - POST /v2/commands/submit-and-wait-for-transaction - Place/Cancel orders
 * - POST /v2/state/active-contracts - Query orders
 */

const OrderService = require('../services/order-service');
const { success } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('../utils/errors');

class OrderController {
  constructor() {
    this.orderService = new OrderService();
  }

  /**
   * Place an order
   * POST /api/orders/place
   * 
   * Creates an Order contract on Canton ledger
   */
  place = asyncHandler(async (req, res) => {
    const {
      tradingPair,
      orderType,
      orderMode,
      price,
      quantity,
      partyId
    } = req.body;

    // Get partyId from request body or header
    const effectivePartyId = partyId || req.headers['x-user-id'] || req.headers['x-party-id'];

    if (!tradingPair || !orderType || !orderMode || !quantity) {
      throw new ValidationError('Missing required fields: tradingPair, orderType, orderMode, quantity');
    }

    if (!effectivePartyId) {
      throw new ValidationError('Missing partyId. Provide in request body or x-user-id header');
    }

    if (orderMode.toUpperCase() === 'LIMIT' && !price) {
      throw new ValidationError('Price is required for LIMIT orders');
    }

    const decodedTradingPair = decodeURIComponent(tradingPair);

    console.log(`[OrderController] Placing order:`, {
      tradingPair: decodedTradingPair,
      orderType,
      orderMode,
      price,
      quantity,
      partyId: effectivePartyId.substring(0, 30) + '...'
    });

    // Place order directly using OrderService
    const result = await this.orderService.placeOrder({
      partyId: effectivePartyId,
      tradingPair: decodedTradingPair,
      orderType: orderType.toUpperCase(),
      orderMode: orderMode.toUpperCase(),
      price,
      quantity
    });

    console.log(`[OrderController] ✅ Order placed: ${result.orderId}`);

    // ═══ AUTO-TRIGGER MATCHING ENGINE ═══
    // On serverless (Vercel), the matching engine doesn't run as a background process.
    // Trigger a matching cycle synchronously within the request to ensure instant matching.
    // This adds ~1-2s to order placement but guarantees matching happens.
    let matchResult = null;
    try {
      const { getMatchingEngine } = require('../services/matching-engine');
      const engine = getMatchingEngine();
      console.log(`[OrderController] ⚡ Auto-triggering matching engine after order placement...`);
      matchResult = await engine.triggerMatchingCycle();
      console.log(`[OrderController] ⚡ Matching cycle complete:`, matchResult?.success ? 'success' : 'no matches');
    } catch (matchErr) {
      console.warn(`[OrderController] ⚠️ Auto-match trigger failed (non-critical):`, matchErr.message);
    }

    return success(res, { ...result, matchTriggered: true, matchResult }, 'Order placed successfully', 201);
  });

  /**
   * Cancel an order
   * POST /api/orders/cancel
   * 
   * Exercises CancelOrder choice on Order contract
   */
  cancel = asyncHandler(async (req, res) => {
    const {
      orderContractId,
      partyId,
      tradingPair
    } = req.body;

    // Get partyId from request body or header
    const effectivePartyId = partyId || req.headers['x-user-id'] || req.headers['x-party-id'];

    if (!orderContractId) {
      throw new ValidationError('Missing required field: orderContractId');
    }

    if (!effectivePartyId) {
      throw new ValidationError('Missing partyId. Provide in request body or x-user-id header');
    }

    console.log(`[OrderController] Cancelling order: ${orderContractId.substring(0, 30)}...`);

    const result = await this.orderService.cancelOrder(
      orderContractId,
      effectivePartyId,
      tradingPair
    );

    console.log(`[OrderController] ✅ Order cancelled`);

    return success(res, result, 'Order cancelled successfully');
  });

  /**
   * Get user's active orders
   * GET /api/orders/user/:partyId
   */
  getUserOrders = asyncHandler(async (req, res) => {
    const { partyId } = req.params;
    const { status = 'OPEN', limit = 100 } = req.query;

    if (!partyId) {
      throw new ValidationError('Missing required param: partyId');
    }

    console.log(`[OrderController] Getting orders for party: ${partyId.substring(0, 30)}...`);

    const orders = await this.orderService.getUserOrders(partyId, status, parseInt(limit));

    console.log(`[OrderController] Found ${orders.length} orders`);

    return success(res, { orders }, 'User orders fetched successfully');
  });

  /**
   * Cancel order by ID
   * POST /api/orders/:orderId/cancel
   */
  cancelOrderById = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const partyId = req.headers['x-user-id'] || req.headers['x-party-id'] || req.body?.partyId;

    if (!orderId) {
      throw new ValidationError('Missing required param: orderId');
    }

    if (!partyId) {
      throw new ValidationError('Missing partyId. Provide x-user-id header or partyId in body');
    }

    console.log(`[OrderController] Cancelling order by ID: ${orderId}`);

    // orderId might be a contract ID or order ID - try both
    const result = await this.orderService.cancelOrder(orderId, partyId);

    return success(res, result, 'Order cancelled successfully');
  });
}

module.exports = new OrderController();
