/**
 * Admin Routes
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const validate = require('../middleware/validator');
const { createOrderBookSchema, uploadDarSchema } = require('../validators/adminValidators');

// POST /api/admin/orderbooks/:tradingPair - Create OrderBook
router.post('/orderbooks/:tradingPair', validate(createOrderBookSchema), adminController.createOrderBook);

// POST /api/admin/upload-dar - Upload DAR file
router.post('/upload-dar', validate(uploadDarSchema), adminController.uploadDar);

module.exports = router;
