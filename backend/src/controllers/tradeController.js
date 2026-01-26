/**
 * Trade Controller
 * Provides in-memory trade history endpoints.
 */

const tradeStore = require('../services/trade-store');
const { success } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');

class TradeController {
  getAll = asyncHandler(async (req, res) => {
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 50;
    const trades = tradeStore.getTrades(null, limit);
    return success(res, { trades }, 'Trades retrieved successfully');
  });

  getForParty = asyncHandler(async (req, res) => {
    const { partyId } = req.params;
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 200;
    const trades = tradeStore.getTradesForParty(partyId, limit);
    return success(res, { partyId, trades }, 'Trades retrieved successfully');
  });
}

module.exports = new TradeController();
