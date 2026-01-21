/**
 * Main Router
 * Combines all route modules
 */

const express = require('express');
const router = express.Router();

// Import route modules
const orderBookRoutes = require('./orderBookRoutes');
const orderRoutes = require('./orderRoutes');
const adminRoutes = require('./adminRoutes');
const partyRoutes = require('./partyRoutes');
const quotaRoutes = require('./quotaRoutes');
const authRoutes = require('./authRoutes');
const authController = require('../controllers/authController');
const healthRoutes = require('./healthRoutes');
const ledgerRoutes = require('./ledgerRoutes');

// Mount routes (matching existing API structure)
router.use('/orderbooks', orderBookRoutes);
router.use('/orders', orderRoutes);
router.use('/admin', adminRoutes);
router.use('/create-party', partyRoutes); // POST /api/create-party
router.use('/quota-status', quotaRoutes); // GET /api/quota-status
router.use('/token-exchange', authRoutes); // POST /api/token-exchange
router.post('/inspect-token', authController.inspectToken); // POST /api/inspect-token
router.use('/ws/status', healthRoutes); // GET /api/ws/status
router.use('/ledger', ledgerRoutes);

module.exports = router;
