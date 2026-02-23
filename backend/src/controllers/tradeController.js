/**
 * Trade Controller
 * 
 * ALL DATA FROM WebSocket-backed StreamingReadModel.
 * 
 * The StreamingReadModel bootstraps ALL trade contracts via WebSocket
 * (ws://.../v2/state/active-contracts) and receives live updates via
 * WebSocket (ws://.../v2/updates/flats). No file cache, no REST polling,
 * no 200-element limit workarounds.
 * 
 * Trade template is Settlement:Trade with fields:
 *   tradeId, operator, buyer, seller, baseInstrumentId, quoteInstrumentId,
 *   baseAmount, quoteAmount, price, buyOrderId, sellOrderId, timestamp
 * Signatory: operator. Observer: buyer, seller.
 */

const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { getReadModelService } = require('../services/readModelService');

class TradeController {

  // GET /api/trades - Get all trades from WebSocket read model
  getAll = asyncHandler(async (req, res) => {
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 50;
    
    const readModel = getReadModelService();
    const trades = readModel ? readModel.getRecentTrades(null, limit) : [];
    
    return success(res, { 
      trades, 
      count: trades.length,
      source: 'websocket-streaming'
    }, 'Trades retrieved');
  });

  // GET /api/trades/:pair - Get trades by trading pair
  getByPair = asyncHandler(async (req, res) => {
    const { pair } = req.params;
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 50;
    
    const tradingPair = decodeURIComponent(pair);
    
    const readModel = getReadModelService();
    const trades = readModel ? readModel.getRecentTrades(tradingPair, limit) : [];
    
    return success(res, { 
      tradingPair, 
      trades,
      count: trades.length,
      source: 'websocket-streaming'
    }, 'Trades retrieved');
  });

  // GET /api/trades/party/:partyId - Get trades for a party
  getForParty = asyncHandler(async (req, res) => {
    const { partyId } = req.params;
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 200;
    
    const readModel = getReadModelService();
    let trades = [];
    if (readModel) {
      const allTrades = readModel.getRecentTrades(null, 500);
      trades = allTrades
        .filter(t => t.buyer === partyId || t.seller === partyId)
        .slice(0, limit);
    }

    // Add role field for party-specific queries
    const tradesWithRole = trades.map(trade => ({
      ...trade,
      role: trade.buyer === partyId ? 'buyer' : 'seller'
    }));
    
    return success(res, { 
      partyId, 
      trades: tradesWithRole,
      count: tradesWithRole.length,
      source: 'websocket-streaming'
    }, 'Trades retrieved');
  });
}

module.exports = new TradeController();
