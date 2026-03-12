/**
 * Quota Routes
 */

const express = require('express');
const router = express.Router();
const partyController = require('../controllers/partyController');

// GET /api/quota-status - Get quota status
router.get('/', partyController.getQuotaStatus);

module.exports = router;
