/**
 * Trade Controller
 * 
 * ALL DATA FROM CANTON API - NO IN-MEMORY CACHE
 * Queries Trade contracts directly from Canton ledger
 */

const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const config = require('../config');
const cantonService = require('../services/cantonService');
const tokenProvider = require('../services/tokenProvider');

class TradeController {
  /**
   * Query trades directly from Canton API
   */
  async queryTradesFromCanton(filterFn, limit = 50) {
    const token = await tokenProvider.getServiceToken();
    const packageId = config.canton.packageIds?.clobExchange;
    const operatorPartyId = config.canton.operatorPartyId;
    
    if (!packageId) {
      throw new Error('CLOB_EXCHANGE_PACKAGE_ID not configured');
    }

    // Query Trade contracts from Canton
    const contracts = await cantonService.queryActiveContracts({
      party: operatorPartyId,
      templateIds: [`${packageId}:Trade:Trade`],
      pageSize: Math.min(limit * 2, 500) // Query more to account for filtering
    }, token);

    const trades = (Array.isArray(contracts) ? contracts : [])
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
          buyOrderId: payload.buyOrderId,
          sellOrderId: payload.sellOrderId,
          timestamp: payload.timestamp
        };
      })
      .filter(filterFn || (() => true))
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      .slice(0, limit);

    return trades;
  }

  // GET /api/trades - Get all trades from Canton API
  getAll = asyncHandler(async (req, res) => {
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 50;
    
    console.log(`[TradeController] Querying ALL trades from Canton API`);
    
    const trades = await this.queryTradesFromCanton(null, limit);
    
    return success(res, { 
      trades, 
      count: trades.length,
      source: 'canton-api'
    }, 'Trades retrieved from Canton API');
  });

  // GET /api/trades/:pair - Get trades by trading pair from Canton API
  getByPair = asyncHandler(async (req, res) => {
    const { pair } = req.params;
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 50;
    
    const tradingPair = decodeURIComponent(pair);
    console.log(`[TradeController] Querying trades for ${tradingPair} from Canton API`);
    
    const trades = await this.queryTradesFromCanton(
      trade => trade.tradingPair === tradingPair,
      limit
    );
    
    return success(res, { 
      tradingPair, 
      trades,
      count: trades.length,
      source: 'canton-api'
    }, 'Trades retrieved from Canton API');
  });

  // GET /api/trades/party/:partyId - Get trades for a party from Canton API
  getForParty = asyncHandler(async (req, res) => {
    const { partyId } = req.params;
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 200;
    
    console.log(`[TradeController] Querying trades for party ${partyId.substring(0, 30)}... from Canton API`);
    
    const trades = await this.queryTradesFromCanton(
      trade => trade.buyer === partyId || trade.seller === partyId,
      limit
    );

    // Add role field for party-specific queries
    const tradesWithRole = trades.map(trade => ({
      ...trade,
      role: trade.buyer === partyId ? 'buyer' : 'seller'
    }));
    
    return success(res, { 
      partyId, 
      trades: tradesWithRole,
      count: tradesWithRole.length,
      source: 'canton-api'
    }, 'Trades retrieved from Canton API');
  });
}

module.exports = new TradeController();
