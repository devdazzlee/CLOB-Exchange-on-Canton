/**
 * Admin Routes
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const validate = require('../middleware/validator');
const { createOrderBookSchema, uploadDarSchema } = require('../validators/adminValidators');
const { getInstrumentService } = require('../services/instrumentService');
const tokenProvider = require('../services/tokenProvider');
const { success, error } = require('../utils/response');

// GET /api/admin/orderbooks - List all order books
router.get('/orderbooks', adminController.getOrderBooks);

// POST /api/admin/orderbooks/:tradingPair - Create OrderBook
router.post('/orderbooks/:tradingPair', validate(createOrderBookSchema), adminController.createOrderBook);

// POST /api/admin/upload-dar - Upload DAR file
router.post('/upload-dar', validate(uploadDarSchema), adminController.uploadDar);

// POST /api/admin/bootstrap-instruments - Create standard instruments and trading pairs
router.post('/bootstrap-instruments', async (req, res) => {
  try {
    console.log('[Admin] Bootstrapping standard instruments and trading pairs...');
    
    const adminToken = await tokenProvider.getServiceToken();
    const instrumentService = getInstrumentService();
    await instrumentService.initialize();
    await instrumentService.bootstrapStandard(adminToken);
    
    // Get created instruments
    const instruments = await instrumentService.getInstruments(adminToken);
    const pairs = await instrumentService.getTradingPairs(adminToken);
    
    return success(res, {
      instruments: instruments,
      tradingPairs: pairs,
      status: 'bootstrapped'
    }, 'Standard instruments and trading pairs created');
  } catch (err) {
    console.error('[Admin] Bootstrap failed:', err.message);
    return error(res, err.message, 500);
  }
});

// GET /api/admin/instruments - List all instruments
router.get('/instruments', async (req, res) => {
  try {
    const adminToken = await tokenProvider.getServiceToken();
    const instrumentService = getInstrumentService();
    await instrumentService.initialize();
    const instruments = await instrumentService.getInstruments(adminToken);
    
    return success(res, { instruments }, 'Instruments retrieved');
  } catch (err) {
    console.error('[Admin] Failed to get instruments:', err.message);
    return error(res, err.message, 500);
  }
});

// GET /api/admin/trading-pairs - List all trading pairs
router.get('/trading-pairs', async (req, res) => {
  try {
    const adminToken = await tokenProvider.getServiceToken();
    const instrumentService = getInstrumentService();
    await instrumentService.initialize();
    const pairs = await instrumentService.getTradingPairs(adminToken);
    
    return success(res, { tradingPairs: pairs }, 'Trading pairs retrieved');
  } catch (err) {
    console.error('[Admin] Failed to get trading pairs:', err.message);
    return error(res, err.message, 500);
  }
});

module.exports = router;
