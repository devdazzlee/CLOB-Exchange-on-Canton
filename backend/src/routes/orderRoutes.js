/**
 * Order Routes
 */

const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const validate = require('../middleware/validator');
const { placeOrderSchema, cancelOrderSchema } = require('../validators/orderValidators');

// POST /api/orders/place - Place an order
router.post('/place', validate(placeOrderSchema), orderController.place);

// POST /api/orders/cancel - Cancel an order
router.post('/cancel', validate(cancelOrderSchema), orderController.cancel);

// GET /api/orders/user/:partyId - Get user's active orders
router.get('/user/:partyId', orderController.getUserOrders);

// POST /api/orders/:orderId/cancel - Cancel specific order
router.post('/:orderId/cancel', orderController.cancelOrderById);

module.exports = router;
