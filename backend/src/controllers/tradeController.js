/**
 * Trade Controller - DIRECT CANTON API QUERIES
 * 
 * NO CACHE - All trades come directly from Canton API
 */

const { getOrderBookService } = require('../services/orderBookService');
const { success } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');

class TradeController {
  // GET /api/trades - Get all trades DIRECTLY from Canton
  getAll = asyncHandler(async (req, res) => {
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 50;
    
    const orderBookService = getOrderBookService();
    const trades = await orderBookService.getTrades('BTC/USDT', limit);
    
    return success(res, { 
      trades, 
      source: 'canton-api-direct' 
    }, 'Trades retrieved from Canton API');
  });

  // GET /api/trades/:pair - Get trades by trading pair DIRECTLY from Canton
  getByPair = asyncHandler(async (req, res) => {
    const { pair } = req.params;
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 50;
    
    const tradingPair = decodeURIComponent(pair);
    console.log(`[TradeController] Querying Canton DIRECTLY for trades: ${tradingPair}`);
    
    const orderBookService = getOrderBookService();
    const trades = await orderBookService.getTrades(tradingPair, limit);
    
    return success(res, { 
      tradingPair, 
      trades,
      count: trades.length,
      source: 'canton-api-direct'
    }, 'Trades retrieved from Canton API');
  });

  // GET /api/trades/party/:partyId - Get trades for a party DIRECTLY from Canton
  getForParty = asyncHandler(async (req, res) => {
    const { partyId } = req.params;
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 200;
    
    console.log(`[TradeController] Querying Canton DIRECTLY for party trades: ${partyId.substring(0, 30)}...`);
    
    // Query Canton directly for trades involving this party
    const config = require('../config');
    const cantonService = require('../services/cantonService');
    const tokenProvider = require('../services/tokenProvider');
    
    const token = await tokenProvider.getServiceToken();
    const packageId = config.canton.packageIds?.clobExchange;
    
    if (!packageId) {
      return success(res, { partyId, trades: [] }, 'No trades found');
    }

    try {
      const contracts = await cantonService.queryActiveContracts({
        party: partyId,  // Query as the user to see their trades
        templateIds: [`${packageId}:Trade:Trade`],
        pageSize: limit
      }, token);

      const trades = (Array.isArray(contracts) ? contracts : [])
        .filter(c => {
          const payload = c.payload || c.createArgument || {};
          return payload.buyer === partyId || payload.seller === partyId;
        })
        .map(c => {
          const payload = c.payload || c.createArgument || {};
          return {
            contractId: c.contractId,
            tradeId: payload.tradeId,
            tradingPair: payload.tradingPair,
            buyer: payload.buyer,
            seller: payload.seller,
            price: payload.price,
            quantity: payload.quantity,
            timestamp: payload.timestamp,
            role: payload.buyer === partyId ? 'buyer' : 'seller'
          };
        })
        .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
        .slice(0, limit);

      return success(res, { 
        partyId, 
        trades,
        source: 'canton-api-direct'
      }, 'Trades retrieved from Canton API');
    } catch (error) {
      console.error(`[TradeController] Canton query failed: ${error.message}`);
      return success(res, { partyId, trades: [] }, 'No trades found');
    }
  });
}

module.exports = new TradeController();
