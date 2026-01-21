/**
 * Health Routes
 */

const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');

// GET /api/health - Health check
router.get('/', healthController.check);

// GET /api/health/ws - WebSocket status
router.get('/ws', healthController.wsStatus);

module.exports = router;
