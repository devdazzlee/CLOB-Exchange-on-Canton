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

    // For external parties: return requiresSignature so frontend can sign
    if (result.requiresSignature) {
      console.log(`[OrderController] External party — returning prepared transaction for signing`);
      return success(res, {
        requiresSignature: true,
        orderId: result.orderId,
        preparedTransaction: result.preparedTransaction,
        preparedTransactionHash: result.preparedTransactionHash,
        hashingSchemeVersion: result.hashingSchemeVersion,
        partyId: result.partyId,
        tradingPair: result.tradingPair,
        orderType: result.orderType,
        orderMode: result.orderMode,
        price: result.price,
        quantity: result.quantity,
        stopPrice: result.stopPrice,
        lockInfo: result.lockInfo,
      }, 'Transaction prepared. Sign the hash and call /execute-place.');
    }

    console.log(`[OrderController] ✅ Order placed: ${result.orderId}`);

    // Register stop-loss with StopLossService if applicable
    if (orderMode.toUpperCase() === 'STOP_LOSS' && result.contractId) {
      try {
        const { getStopLossService } = require('../services/stopLossService');
        const stopLossService = getStopLossService();
        await stopLossService.registerStopLoss({
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

    // For external parties: return requiresSignature so frontend can sign
    if (result.requiresSignature) {
      console.log(`[OrderController] External party — returning prepared CancelOrder for signing`);
      return success(res, result, 'Transaction prepared. Sign the hash and call /execute-cancel.');
    }

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
   * Execute a prepared order placement with user's signature
   * POST /api/orders/execute-place
   * 
   * Body: { preparedTransaction, partyId, signatureBase64, signedBy, hashingSchemeVersion, orderMeta }
   */
  executePlace = asyncHandler(async (req, res) => {
    const { preparedTransaction, partyId, signatureBase64, signedBy, hashingSchemeVersion, orderMeta, signingKeyBase64 } = req.body;

    if (!preparedTransaction || !partyId || !signatureBase64 || !signedBy) {
      throw new ValidationError('preparedTransaction, partyId, signatureBase64, and signedBy are required');
    }

    console.log(`[OrderController] EXECUTE place for ${partyId.substring(0, 30)}... signedBy: ${signedBy.substring(0, 20)}...`);

    // Store signing key for server-side settlement (if provided)
    if (signingKeyBase64 && typeof signingKeyBase64 === 'string' && signingKeyBase64.trim()) {
      const userRegistry = require('../state/userRegistry');
      await userRegistry.storeSigningKey(partyId, signingKeyBase64.trim(), signedBy);
      console.log(`[OrderController] 🔑 Signing key stored for interactive settlement`);
    }

    const result = await this.orderService.executeOrderPlacement(
      preparedTransaction, partyId, signatureBase64, signedBy, hashingSchemeVersion, orderMeta || {}
    );

    if (result?.requiresSignature) {
      console.log(`[OrderController] External party — returning next prepared step for signing (${result.step})`);
      return success(res, result, 'Step prepared. Sign the next hash and call /execute-place again.');
    }

    console.log(`[OrderController] ✅ Order placed via interactive submission: ${result.orderId}`);

    // Fire-and-forget matching
    if (result.tradingPair && result.status === 'OPEN') {
      setTimeout(async () => {
        try {
          const { getMatchingEngine } = require('../services/matching-engine');
          const engine = getMatchingEngine();
          await engine.triggerMatchingCycle(result.tradingPair);
        } catch (matchErr) {
          console.warn(`[OrderController] ⚠️ Auto-match failed:`, matchErr.message);
        }
      }, 1500);
    }

    return success(res, { ...result, matchTriggered: true }, 'Order placed via interactive submission', 201);
  });

  /**
   * Execute a prepared order cancellation with user's signature
   * POST /api/orders/execute-cancel
   * 
   * Body: { preparedTransaction, partyId, signatureBase64, signedBy, hashingSchemeVersion, cancelMeta }
   */
  executeCancel = asyncHandler(async (req, res) => {
    const { preparedTransaction, partyId, signatureBase64, signedBy, hashingSchemeVersion, cancelMeta } = req.body;

    if (!preparedTransaction || !partyId || !signatureBase64 || !signedBy) {
      throw new ValidationError('preparedTransaction, partyId, signatureBase64, and signedBy are required');
    }

    console.log(`[OrderController] EXECUTE cancel for ${partyId.substring(0, 30)}... signedBy: ${signedBy.substring(0, 20)}...`);

    const result = await this.orderService.executeOrderCancel(
      preparedTransaction, partyId, signatureBase64, signedBy, hashingSchemeVersion, cancelMeta || {}
    );

    console.log(`[OrderController] ✅ Order cancelled via interactive submission`);

    return success(res, result, 'Order cancelled via interactive submission');
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

    // For external parties: return requiresSignature so frontend can sign
    if (result.requiresSignature) {
      return success(res, result, 'Transaction prepared. Sign the hash and call /execute-cancel.');
    }

    return success(res, result, 'Order cancelled successfully');
  });
}

module.exports = new OrderController();
