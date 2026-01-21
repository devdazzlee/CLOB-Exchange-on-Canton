/**
 * Order Controller
 * Handles order-related HTTP requests
 */

const OrderService = require('../services/order-service');
const { success, error } = require('../utils/response');
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
    const { tradingPair } = req.params;
    const { side, orderType, price, quantity, partyId } = req.body;

    if (!side || !orderType || !quantity || !partyId) {
      throw new ValidationError('Missing required fields: side, orderType, quantity, partyId');
    }

    if (orderType === 'LIMIT' && !price) {
      throw new ValidationError('Price is required for LIMIT orders');
    }

    const decodedTradingPair = decodeURIComponent(tradingPair);
    const result = await this.orderService.placeOrder({
      tradingPair: decodedTradingPair,
      side,
      orderType,
      price,
      quantity,
      partyId,
    });

    return success(res, result, 'Order placed successfully', 201);
  });

  /**
   * Cancel an order
   */
  cancel = asyncHandler(async (req, res) => {
    const { orderContractId, partyId, tradingPair } = req.body;

    if (!orderContractId || !partyId || !tradingPair) {
      throw new ValidationError('Missing required fields: orderContractId, partyId, tradingPair');
    }

    const result = await this.orderService.cancelOrder({
      orderContractId,
      partyId,
      tradingPair,
    });

    return success(res, result, 'Order cancelled successfully');
  });
}

module.exports = new OrderController();
