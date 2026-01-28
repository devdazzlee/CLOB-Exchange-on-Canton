/**
 * Order Controller
 * Handles order-related HTTP requests
 */

const OrderService = require('../services/order-service');
const orderBookService = require('../services/orderBookService');
const { success } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('../utils/errors');

class OrderController {
  constructor() {
    this.orderService = new OrderService();
  }

  /**
   * Place an order
   */
  place = asyncHandler(async (req, res) => {
    const {
      tradingPair,
      orderType,
      orderMode,
      price,
      quantity,
      partyId,
      orderBookContractId,
      userAccountContractId,
      allocationCid
    } = req.body;

    if (!tradingPair || !orderType || !orderMode || !quantity || !partyId) {
      throw new ValidationError('Missing required fields: tradingPair, orderType, orderMode, quantity, partyId');
    }

    if (orderMode === 'LIMIT' && !price) {
      throw new ValidationError('Price is required for LIMIT orders');
    }

    const decodedTradingPair = decodeURIComponent(tradingPair);

    let resolvedOrderBookContractId = orderBookContractId;
    if (!resolvedOrderBookContractId) {
      console.log(`[OrderController] Getting OrderBook contract ID for ${decodedTradingPair}`);
      resolvedOrderBookContractId = await orderBookService.getOrderBookContractId(decodedTradingPair);
    }
    if (!resolvedOrderBookContractId) {
      console.log(`[OrderController] OrderBook not found, creating new one for ${decodedTradingPair}`);
      const created = await orderBookService.createOrderBook(decodedTradingPair);
      // Handle both old and new response structures
      resolvedOrderBookContractId = created.contractId || created.data?.contractId;
      console.log(`[OrderController] OrderBook created with ID: ${resolvedOrderBookContractId?.substring(0, 30)}...`);
    } else {
      console.log(`[OrderController] Using existing OrderBook: ${resolvedOrderBookContractId.substring(0, 30)}...`);
    }

    let result;
    if (allocationCid) {
      result = await this.orderService.placeOrderWithAllocation(
        partyId,
        decodedTradingPair,
        orderType,
        orderMode,
        quantity,
        price,
        resolvedOrderBookContractId,
        allocationCid
      );
    } else {
      result = await this.orderService.placeOrderWithUTXOHandling(
        partyId,
        decodedTradingPair,
        orderType,
        orderMode,
        quantity,
        price,
        resolvedOrderBookContractId,
        userAccountContractId
      );
    }

    return success(res, result, 'Order placed successfully', 201);
  });

  /**
   * Cancel an order
   */
  cancel = asyncHandler(async (req, res) => {
    const {
      orderContractId,
      partyId,
      tradingPair,
      orderType,
      orderBookContractId,
      userAccountContractId
    } = req.body;

    if (!orderContractId || !partyId || !tradingPair || !orderType) {
      throw new ValidationError('Missing required fields: orderContractId, partyId, tradingPair, orderType');
    }

    const decodedTradingPair = decodeURIComponent(tradingPair);
    const result = await this.orderService.cancelOrderWithUTXOHandling(
      partyId,
      decodedTradingPair,
      orderType,
      orderContractId,
      orderBookContractId,
      userAccountContractId
    );

    return success(res, result, 'Order cancelled successfully');
  });

  /**
   * Get user's active orders
   */
  getUserOrders = asyncHandler(async (req, res) => {
    const { partyId } = req.params;

    if (!partyId) {
      throw new ValidationError('Missing required param: partyId');
    }

    // TODO: implement lookup when order storage is available
    return success(res, [], 'User orders fetched successfully');
  });

  /**
   * Cancel order by ID
   */
  cancelOrderById = asyncHandler(async (req, res) => {
    const { orderId } = req.params;

    if (!orderId) {
      throw new ValidationError('Missing required param: orderId');
    }

    // TODO: implement cancel by contract ID when order storage is available
    return success(res, { orderId, cancelled: false }, 'Cancel by ID not implemented');
  });
}

module.exports = new OrderController();
