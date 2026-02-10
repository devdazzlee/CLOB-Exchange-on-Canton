/**
 * Trade Controller
 * 
 * ALL DATA FROM CANTON API - NO IN-MEMORY CACHE
 * Queries Trade contracts directly from Canton ledger
 * 
 * Trade template is Settlement:Trade with fields:
 *   tradeId, operator, buyer, seller, baseInstrumentId, quoteInstrumentId,
 *   baseAmount, quoteAmount, price, buyOrderId, sellOrderId, timestamp
 * Signatory: operator. Observer: buyer, seller.
 */

const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const config = require('../config');
const cantonService = require('../services/cantonService');
const tokenProvider = require('../services/tokenProvider');

class TradeController {
  /**
   * Query trades directly from Canton API
   * 
   * Trade contracts are signed by operator, so we query as operator.
   * Template: Settlement:Trade (in the clobExchange package)
   */
  async queryTradesFromCanton(filterFn, limit = 50) {
    const token = await tokenProvider.getServiceToken();
    const packageId = config.canton.packageIds?.clobExchange;
    const legacyPackageId = config.canton.packageIds?.legacy;
    const operatorPartyId = config.canton.operatorPartyId;
    
    if (!packageId) {
      throw new Error('CLOB_EXCHANGE_PACKAGE_ID not configured');
    }

    // Query Trade contracts as operator (signatory on Trade template)
    // Settlement:Trade exists ONLY in the current package (TOKEN_STANDARD_PACKAGE_ID)
    // Trade:Trade exists ONLY in the legacy package (LEGACY_PACKAGE_ID)
    // Canton API rejects the entire query if ANY template ID is invalid,
    // so we must query each package's templates separately and merge results.
    let contracts = [];

    // 1. Query current package for Settlement:Trade
    try {
      const currentPkgContracts = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [`${packageId}:Settlement:Trade`],
        pageSize: Math.min(limit * 2, 200)
      }, token);
      if (Array.isArray(currentPkgContracts)) {
        contracts = contracts.concat(currentPkgContracts);
      }
    } catch (e) {
      console.warn(`[TradeController] Settlement:Trade query failed: ${e.message}`);
    }

    // 2. Query legacy package for Trade:Trade (if different package)
    if (legacyPackageId && legacyPackageId !== packageId) {
      try {
        const legacyContracts = await cantonService.queryActiveContracts({
          party: operatorPartyId,
          templateIds: [`${legacyPackageId}:Trade:Trade`],
          pageSize: Math.min(limit * 2, 200)
        }, token);
        if (Array.isArray(legacyContracts)) {
          contracts = contracts.concat(legacyContracts);
        }
      } catch (e) {
        console.warn(`[TradeController] Legacy Trade:Trade query failed: ${e.message}`);
      }
    }

    const allTrades = [];
    for (const c of (Array.isArray(contracts) ? contracts : [])) {
      const payload = c.payload || c.createArgument || {};
      
      // Derive tradingPair from instrument IDs
      const baseSymbol = payload.baseInstrumentId?.symbol || '';
      const quoteSymbol = payload.quoteInstrumentId?.symbol || '';
      const tradingPair = (baseSymbol && quoteSymbol) 
        ? `${baseSymbol}/${quoteSymbol}` 
        : (payload.tradingPair || 'UNKNOWN');

      allTrades.push({
        contractId: c.contractId,
        tradeId: payload.tradeId,
        tradingPair,
        buyer: payload.buyer,
        seller: payload.seller,
        price: payload.price,
        quantity: payload.baseAmount || payload.quantity,
        quoteAmount: payload.quoteAmount,
        buyOrderId: payload.buyOrderId,
        sellOrderId: payload.sellOrderId,
        timestamp: payload.timestamp,
      });
    }

    // Apply filter, sort by timestamp (newest first), and limit
    return allTrades
      .filter(filterFn || (() => true))
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      .slice(0, limit);
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
