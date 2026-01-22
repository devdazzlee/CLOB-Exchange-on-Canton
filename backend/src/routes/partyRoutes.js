/**
 * Party Routes
 */

const express = require('express');
const router = express.Router();
const partyController = require('../controllers/partyController');

// Debug middleware for all requests to this router
router.use((req, res, next) => {
  console.log(`[PartyRoutes] ${req.method} ${req.path} - Original URL: ${req.originalUrl}`);
  console.log(`[PartyRoutes] Base URL: ${req.baseUrl}`);
  console.log(`[PartyRoutes] Full URL: ${req.url}`);
  next();
});

// POST /api/create-party - Create a party
router.post('/', (req, res, next) => {
  console.log('[PartyRoutes] POST /create-party handler called!');
  console.log('[PartyRoutes] Request body:', req.body);
  next();
}, partyController.create);

// Debug route to verify router is working
router.get('/', (req, res) => {
  console.log('[PartyRoutes] GET /create-party hit (test route)');
  res.json({ message: 'Party routes are working', method: 'GET', path: req.path, originalUrl: req.originalUrl });
});

module.exports = router;
