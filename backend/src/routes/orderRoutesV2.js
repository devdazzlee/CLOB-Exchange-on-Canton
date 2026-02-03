/**
 * Order Routes V2 - Token Standard Version
 * 
 * Uses proper token standard:
 * - Holdings instead of text balances
 * - OrderV3 contracts with locked holdings
 * - DvP settlement
 */

const express = require('express');
const router = express.Router();
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('../utils/errors');
const tokenProvider = require('../services/tokenProvider');
const { getOrderServiceV2 } = require('../services/order-service-v2');

/**
 * POST /api/orders/v2
 * Place an order using Token Standard (Holdings + OrderV3)
 */
router.post('/', asyncHandler(async (req, res) => {
  const { partyId, tradingPair, side, type, price, quantity } = req.body;

  // Validation
  if (!partyId) {
    throw new ValidationError('partyId is required');
  }
  if (!tradingPair || !tradingPair.includes('/')) {
    throw new ValidationError('tradingPair is required (format: BTC/USDT)');
  }
  if (!side || !['BUY', 'SELL', 'buy', 'sell'].includes(side)) {
    throw new ValidationError('side must be BUY or SELL');
  }
  if (!type || !['LIMIT', 'MARKET', 'limit', 'market'].includes(type)) {
    throw new ValidationError('type must be LIMIT or MARKET');
  }
  if (type.toUpperCase() === 'LIMIT' && !price) {
    throw new ValidationError('price is required for LIMIT orders');
  }
  if (!quantity || parseFloat(quantity) <= 0) {
    throw new ValidationError('quantity must be positive');
  }

  console.log(`[OrderV2] Placing ${side} ${type} order: ${quantity} ${tradingPair} @ ${price || 'MARKET'}`);

  const adminToken = await tokenProvider.getServiceToken();
  const orderService = getOrderServiceV2();
  await orderService.initialize();

  const result = await orderService.placeOrder({
    partyId,
    tradingPair,
    side: side.toUpperCase(),
    type: type.toUpperCase(),
    price: price ? parseFloat(price) : null,
    quantity: parseFloat(quantity),
  }, adminToken);

  return success(res, result, 'Order placed using Token Standard', 201);
}));

/**
 * GET /api/orders/v2
 * Get orders for a party
 */
router.get('/', asyncHandler(async (req, res) => {
  const partyId = req.query.partyId || req.headers['x-party-id'];
  const status = req.query.status;

  if (!partyId) {
    throw new ValidationError('partyId is required (query param or x-party-id header)');
  }

  console.log(`[OrderV2] Getting orders for ${partyId.substring(0, 30)}... status=${status || 'all'}`);

  const adminToken = await tokenProvider.getServiceToken();
  const orderService = getOrderServiceV2();
  await orderService.initialize();

  const orders = await orderService.getOrders(partyId, status, adminToken);

  return success(res, {
    partyId,
    orders,
    count: orders.length,
    tokenStandard: true,
  }, 'Orders retrieved');
}));

/**
 * DELETE /api/orders/v2/:orderContractId
 * Cancel an order
 */
router.delete('/:orderContractId', asyncHandler(async (req, res) => {
  const { orderContractId } = req.params;
  const partyId = req.query.partyId || req.headers['x-party-id'];

  if (!orderContractId) {
    throw new ValidationError('orderContractId is required');
  }
  if (!partyId) {
    throw new ValidationError('partyId is required (query param or x-party-id header)');
  }

  console.log(`[OrderV2] Cancelling order ${orderContractId.substring(0, 30)}...`);

  const adminToken = await tokenProvider.getServiceToken();
  const orderService = getOrderServiceV2();
  await orderService.initialize();

  const result = await orderService.cancelOrder(orderContractId, partyId, adminToken);

  return success(res, result, 'Order cancelled, funds unlocked');
}));

/**
 * GET /api/orders/v2/orderbook/:tradingPair
 * Get orderbook for a trading pair
 */
router.get('/orderbook/:tradingPair', asyncHandler(async (req, res) => {
  const tradingPair = decodeURIComponent(req.params.tradingPair);

  if (!tradingPair || !tradingPair.includes('/')) {
    throw new ValidationError('Valid trading pair required (format: BTC/USDT)');
  }

  console.log(`[OrderV2] Getting orderbook for ${tradingPair}`);

  const adminToken = await tokenProvider.getServiceToken();
  const orderService = getOrderServiceV2();
  await orderService.initialize();

  const orderbook = await orderService.getOrderBook(tradingPair, adminToken);

  return success(res, orderbook, 'Orderbook retrieved');
}));

module.exports = router;
