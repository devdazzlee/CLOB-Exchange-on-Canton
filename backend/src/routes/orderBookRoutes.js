/**
 * OrderBook Routes
 */

const express = require('express');
const router = express.Router();
const orderBookController = require('../controllers/orderBookController');

// GET /api/orderbooks - Get all OrderBooks
router.get('/', orderBookController.getAll);

// GET /api/orderbooks/:tradingPair - Get OrderBook by trading pair
router.get('/:tradingPair', orderBookController.getByTradingPair);

// GET /api/orderbooks/:tradingPair/orders - Get orders for trading pair
router.get('/:tradingPair/orders', orderBookController.getOrders);

// GET /api/orderbooks/:tradingPair/trades - Get trades for trading pair
router.get('/:tradingPair/trades', orderBookController.getTrades);

module.exports = router;
