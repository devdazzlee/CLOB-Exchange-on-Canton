/**
 * Order Routes
 */

const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const validate = require('../middleware/validator');
const { placeOrderSchema, cancelOrderSchema } = require('../validators/orderValidators');

// POST /api/orders/place - Place an order
// For external parties: returns { requiresSignature: true, preparedTransaction, ... }
// Frontend signs the hash, then calls POST /api/orders/execute-place
router.post('/place', validate(placeOrderSchema), orderController.place);

// POST /api/orders/execute-place - Execute prepared order placement with user's signature
router.post('/execute-place', orderController.executePlace);

// POST /api/orders/cancel - Cancel an order
// For external parties: returns { requiresSignature: true, preparedTransaction, ... }
// Frontend signs the hash, then calls POST /api/orders/execute-cancel
router.post('/cancel', validate(cancelOrderSchema), orderController.cancel);

// POST /api/orders/execute-cancel - Execute prepared order cancellation with user's signature
router.post('/execute-cancel', orderController.executeCancel);

// GET /api/orders/user/:partyId - Get user's active orders
router.get('/user/:partyId', orderController.getUserOrders);

// POST /api/orders/:orderId/cancel - Cancel specific order
router.post('/:orderId/cancel', orderController.cancelOrderById);

module.exports = router;
