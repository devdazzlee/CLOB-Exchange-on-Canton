/**
 * Party Routes
 */

const express = require('express');
const router = express.Router();
const partyController = require('../controllers/partyController');

// POST /api/create-party - Create a party
router.post('/', partyController.create);

module.exports = router;
