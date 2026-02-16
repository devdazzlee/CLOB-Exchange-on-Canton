/**
 * Trade Controller
 * 
 * ALL DATA FROM CANTON API + FILE-BACKED IN-MEMORY CACHE
 * 
 * Queries Trade contracts directly from Canton ledger.
 * When Settlement:Trade exceeds Canton's 200-element node limit,
 * transparently falls back to the file-backed in-memory cache
 * populated by the matching engine after each match.
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
const { getUpdateStream } = require('../services/cantonUpdateStream');

class TradeController {
  /**
   * Query trades from Canton API + file-backed cache (merged, deduplicated).
   * 
   * Canton's node has a 200-element limit per query. When Settlement:Trade
   * contracts exceed 200, the Canton query returns 0. The file-backed cache
   * (populated by the matching engine after each match, persisted to disk)
   * acts as fallback so recent trades are always visible in the UI.
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

    // ═══ STEP 1: Check file-backed in-memory cache FIRST ═══
    // The cache is populated by the matching engine after each match and
    // persisted to disk, so it survives server restarts.
    const tradeMap = new Map(); // keyed by tradeId for dedup
    let cacheCount = 0;

    try {
      const updateStream = getUpdateStream();
      const cachedTrades = updateStream.getAllTrades(limit * 4);
      for (const ct of cachedTrades) {
        const tid = ct.tradeId;
        if (tid && !tradeMap.has(tid)) {
          tradeMap.set(tid, {
            ...ct,
            source: 'cache',
          });
          cacheCount++;
        }
      }
    } catch (e) {
      // Non-critical — cache is best-effort
      console.warn(`[TradeController] Cache read failed: ${e.message}`);
    }

    // ═══ STEP 2: Query Canton API for on-ledger trade contracts ═══
    // This may return 0 for Settlement:Trade if there are 200+ active contracts.
    let cantonCount = 0;

    // 2a. Query current package for Settlement:Trade
    try {
      const currentPkgContracts = await cantonService.queryActiveContracts({
        party: operatorPartyId,
        templateIds: [`${packageId}:Settlement:Trade`],
        pageSize: Math.min(limit * 2, 100)
      }, token);
      if (Array.isArray(currentPkgContracts) && currentPkgContracts.length > 0) {
        for (const c of currentPkgContracts) {
          const payload = c.payload || c.createArgument || {};
          const baseSymbol = payload.baseInstrumentId?.symbol || '';
          const quoteSymbol = payload.quoteInstrumentId?.symbol || '';
          const tradingPair = (baseSymbol && quoteSymbol) 
            ? `${baseSymbol}/${quoteSymbol}` 
            : (payload.tradingPair || 'UNKNOWN');
          const tradeId = payload.tradeId || c.contractId;
          
          // Canton is authoritative — overwrite cache entry if exists
          tradeMap.set(tradeId, {
            contractId: c.contractId,
            tradeId,
            tradingPair,
            buyer: payload.buyer,
            seller: payload.seller,
            price: payload.price,
            quantity: payload.baseAmount || payload.quantity,
            quoteAmount: payload.quoteAmount,
            buyOrderId: payload.buyOrderId,
            sellOrderId: payload.sellOrderId,
            timestamp: payload.timestamp,
            source: 'canton',
          });
          cantonCount++;
        }
      } else {
        // Settlement:Trade returned 0 — likely hit the 200+ node limit
        if (cacheCount > 0) {
          console.log(`[TradeController] ℹ️ Settlement:Trade returned 0 (200+ limit), using ${cacheCount} cached trades`);
        } else {
          console.log(`[TradeController] ℹ️ Settlement:Trade returned 0 (200+ limit) and cache is empty`);
        }
      }
    } catch (e) {
      console.warn(`[TradeController] Settlement:Trade query failed: ${e.message}`);
    }

    // 2b. Query legacy package for Trade:Trade (if different package)
    if (legacyPackageId && legacyPackageId !== packageId) {
      try {
        const legacyContracts = await cantonService.queryActiveContracts({
          party: operatorPartyId,
          templateIds: [`${legacyPackageId}:Trade:Trade`],
          pageSize: Math.min(limit * 2, 100)
        }, token);
        if (Array.isArray(legacyContracts)) {
          for (const c of legacyContracts) {
            const payload = c.payload || c.createArgument || {};
            const baseSymbol = payload.baseInstrumentId?.symbol || '';
            const quoteSymbol = payload.quoteInstrumentId?.symbol || '';
            const tradingPair = (baseSymbol && quoteSymbol) 
              ? `${baseSymbol}/${quoteSymbol}` 
              : (payload.tradingPair || 'UNKNOWN');
            const tradeId = payload.tradeId || c.contractId;
            
            if (!tradeMap.has(tradeId)) {
              tradeMap.set(tradeId, {
                contractId: c.contractId,
                tradeId,
                tradingPair,
                buyer: payload.buyer,
                seller: payload.seller,
                price: payload.price,
                quantity: payload.baseAmount || payload.quantity,
                quoteAmount: payload.quoteAmount,
                buyOrderId: payload.buyOrderId,
                sellOrderId: payload.sellOrderId,
                timestamp: payload.timestamp,
                source: 'canton-legacy',
              });
              cantonCount++;
            }
          }
        }
      } catch (e) {
        console.warn(`[TradeController] Legacy Trade:Trade query failed: ${e.message}`);
      }
    }

    const totalSources = `${cantonCount} from Canton, ${cacheCount} from cache`;
    const allTrades = [...tradeMap.values()];

    // Apply filter, sort by timestamp (newest first), and limit
    const result = allTrades
      .filter(filterFn || (() => true))
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      .slice(0, limit);

    if (result.length > 0) {
      console.log(`[TradeController] Returning ${result.length} trades (${totalSources})`);
    }

    return result;
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
      source: 'canton-api+cache'
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
      source: 'canton-api+cache'
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
      source: 'canton-api+cache'
    }, 'Trades retrieved from Canton API');
  });
}

module.exports = new TradeController();
