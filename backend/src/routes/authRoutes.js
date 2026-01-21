/**
 * Auth Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/token-exchange - Exchange Keycloak token
router.post('/', authController.exchangeToken);

module.exports = router;
