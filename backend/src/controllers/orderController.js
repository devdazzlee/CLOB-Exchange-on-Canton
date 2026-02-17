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
      partyId,
      stopPrice,
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

    if (orderMode.toUpperCase() === 'STOP_LOSS' && !stopPrice) {
      throw new ValidationError('stopPrice is required for STOP_LOSS orders');
    }

    const decodedTradingPair = decodeURIComponent(tradingPair);

    console.log(`[OrderController] Placing order:`, {
      tradingPair: decodedTradingPair,
      orderType,
      orderMode,
      price,
      quantity,
      stopPrice: stopPrice || null,
      partyId: effectivePartyId.substring(0, 30) + '...'
    });

    // Place order directly using OrderService
    const result = await this.orderService.placeOrder({
      partyId: effectivePartyId,
      tradingPair: decodedTradingPair,
      orderType: orderType.toUpperCase(),
      orderMode: orderMode.toUpperCase(),
      price,
      quantity,
      stopPrice: stopPrice || null,
    });

    console.log(`[OrderController] ✅ Order placed: ${result.orderId}`);

    // Register stop-loss with StopLossService if applicable
    if (orderMode.toUpperCase() === 'STOP_LOSS' && result.contractId) {
      try {
        const { getStopLossService } = require('../services/stopLossService');
        const stopLossService = getStopLossService();
        stopLossService.registerStopLoss({
          orderContractId: result.contractId,
          orderId: result.orderId,
          tradingPair: decodedTradingPair,
          orderType: orderType.toUpperCase(),
          stopPrice: stopPrice,
          partyId: effectivePartyId,
          quantity: quantity?.toString() || '0',
          allocationContractId: result.allocationContractId || null,
        });
        console.log(`[OrderController] ✅ Stop-loss registered for ${result.orderId} (triggers at ${stopPrice})`);
      } catch (slErr) {
        console.warn(`[OrderController] ⚠️ Failed to register stop-loss:`, slErr.message);
      }
    }

    // ═══ AUTO-TRIGGER MATCHING ENGINE (FIRE-AND-FORGET) ═══
    // On serverless (Vercel), matching can't run in the background.
    // We trigger it ASYNCHRONOUSLY after responding to the client.
    // This prevents the order placement response from being blocked by matching
    // (which can take 5-15s with Splice transfers).
    //
    // The client gets an instant response, and matching happens in the background.
    // The frontend polls every 3s for order book updates, which also triggers matching.

    // Return response immediately — don't wait for matching
    const response = success(res, { ...result, matchTriggered: true }, 'Order placed successfully', 201);

    // Fire-and-forget: trigger matching after a short delay for Canton propagation
    setTimeout(async () => {
      try {
        const { getMatchingEngine } = require('../services/matching-engine');
        const engine = getMatchingEngine();
        console.log(`[OrderController] ⚡ Auto-triggering matching for ${decodedTradingPair}...`);
        const matchResult = await engine.triggerMatchingCycle(decodedTradingPair);
        console.log(`[OrderController] ⚡ Matching cycle complete:`, matchResult?.success ? 'success' : matchResult?.reason || 'no matches');
      } catch (matchErr) {
        console.warn(`[OrderController] ⚠️ Auto-match trigger failed (non-critical):`, matchErr.message);
      }
    }, 1500);

    return response;
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
