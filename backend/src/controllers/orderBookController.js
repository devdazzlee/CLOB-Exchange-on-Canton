/**
 * OrderBook Controller
 * Handles OrderBook-related HTTP requests
 */

const { getOrderBookService } = require('../services/orderBookService');
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { NotFoundError } = require('../utils/errors');
const { formatOrderBook } = require('../utils/orderBookAggregator');

// Get singleton instance
const orderBookService = getOrderBookService();

// ═══ SERVERLESS MATCHING ENGINE TRIGGER ═══
// On Vercel serverless, the matching engine can't run as a background loop.
// We trigger it opportunistically on order book polls (every 3s from frontend).
// Rate-limited to once per 3 seconds to avoid overload.
let _lastMatchTriggerTime = 0;
const MATCH_TRIGGER_COOLDOWN_MS = 3000;

function triggerMatchingIfNeeded(tradingPair) {
  const now = Date.now();
  if (now - _lastMatchTriggerTime < MATCH_TRIGGER_COOLDOWN_MS) return;
  _lastMatchTriggerTime = now;

  // Fire-and-forget — don't block the API response
  try {
    const { getMatchingEngine } = require('../services/matching-engine');
    const engine = getMatchingEngine();
    engine.triggerMatchingCycle(tradingPair || null).catch(err => {
      if (!err.message?.includes('401') && !err.message?.includes('No contracts')) {
        console.warn('[OrderBookController] Background match trigger error:', err.message);
      }
    });
  } catch (e) {
    // Non-critical — matching engine may not be initialized
  }
}

class OrderBookController {
  /**
   * Get all OrderBooks
   */
  getAll = asyncHandler(async (req, res) => {
    const orderBooks = await orderBookService.getAllOrderBooks();
    return success(res, { orderBooks }, 'OrderBooks retrieved successfully');
  });

  /**
   * Get OrderBook by trading pair
   */
  getByTradingPair = asyncHandler(async (req, res) => {
    const { tradingPair } = req.params;
    const decodedTradingPair = decodeURIComponent(tradingPair);
    const { aggregate = 'true', precision = '2', depth = '50' } = req.query;

    // Opportunistically trigger matching engine (serverless: doesn't run in background)
    triggerMatchingIfNeeded(decodedTradingPair);

    try {
      // getOrderBook is now async - queries Canton directly
      const orderBook = await orderBookService.getOrderBook(decodedTradingPair);
      
      // Milestone 3: Aggregate price levels for professional UI
      const aggregated = formatOrderBook(orderBook, {
        aggregate: aggregate === 'true',
        precision: parseInt(precision),
        depth: parseInt(depth)
      });

      return success(res, { 
        orderBook: aggregated,
        raw: orderBook // Include raw data for backward compatibility
      }, 'OrderBook retrieved successfully');
    } catch (err) {
      if (err instanceof NotFoundError) {
        // Auto-create the order book when missing to unblock UX
        try {
          const created = await orderBookService.createOrderBook(decodedTradingPair);
          // Try to fetch it immediately (may still be pending; return what we have)
          let orderBook = null;
          try {
            // Wait a bit for contract to be available
            await new Promise(resolve => setTimeout(resolve, 500));
            orderBook = await orderBookService.getOrderBook(decodedTradingPair);
          } catch (_) {
            // ignore; return minimal info
          }
          return success(res, {
            orderBook: orderBook || {
              contractId: created.contractId,
              tradingPair: decodedTradingPair,
              buyOrders: [],
              sellOrders: [],
              lastPrice: null,
              operator: null,
            },
            created: true,
          }, 'OrderBook created on-demand');
        } catch (createErr) {
          return success(res, {
            orderBook: null,
            tradingPair: decodedTradingPair,
            error: createErr.message,
          }, 'OrderBook not found and creation failed', 200);
        }
      }
      throw err;
    }
  });

  /**
   * Create OrderBook (Admin)
   */
  create = asyncHandler(async (req, res) => {
    const { tradingPair } = req.params;
    const decodedTradingPair = decodeURIComponent(tradingPair);

    const result = await orderBookService.createOrderBook(decodedTradingPair);

    if (result.alreadyExists) {
      return success(
        res,
        {
          contractId: result.contractId,
          tradingPair: decodedTradingPair,
        },
        'OrderBook already exists',
        200
      );
    }

    return success(
      res,
      {
        contractId: result.contractId,
        masterOrderBookContractId: result.masterOrderBookContractId,
        tradingPair: decodedTradingPair,
      },
      'OrderBook created successfully',
      201
    );
  });

  /**
   * Get all recent trades across all trading pairs
   */
  getAllTrades = asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;

    // Use in-memory service if available
    if (orderBookService.useInMemory) {
      const allTrades = [];
      
      // Collect trades from all trading pairs
      for (const [tradingPair, trades] of orderBookService.inMemoryService.trades) {
        trades.forEach(trade => {
          allTrades.push({
            ...trade,
            tradingPair
          });
        });
      }

      // Sort by timestamp (most recent first) and limit
      const sortedTrades = allTrades
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);

      return success(res, { trades: sortedTrades }, 'Trades retrieved successfully');
    }

    // Original DAML code (commented out for now)
    /*
    const trades = await orderBookService.getAllTrades(limit);
    return success(res, { trades }, 'Trades retrieved successfully');
    */
    return success(res, { trades: [] }, 'Trades retrieved successfully');
  });

  /**
   * Get orders for a trading pair
   */
  getOrders = asyncHandler(async (req, res) => {
    const { tradingPair } = req.params;
    const decodedTradingPair = decodeURIComponent(tradingPair);

    // This will be implemented in OrderService
    // For now, return empty array
    return success(res, {
      tradingPair: decodedTradingPair,
      buyOrders: [],
      sellOrders: [],
    }, 'Orders retrieved successfully');
  });

  /**
   * Get trades for a trading pair using proper templateId objects
   */
  getTrades = asyncHandler(async (req, res) => {
    const { tradingPair } = req.params;
    const decodedTradingPair = decodeURIComponent(tradingPair);
    const limitInput = req.query?.limit;
    const limit = Number.isFinite(Number(limitInput)) ? Number(limitInput) : 100;

    try {
      const trades = await orderBookService.getTrades(decodedTradingPair, limit);
      return success(res, {
        tradingPair: decodedTradingPair,
        trades,
      }, 'Trades retrieved successfully');
    } catch (error) {
      console.error('[OrderBookController] Error fetching trades:', error);
      // Return empty array on error to prevent frontend crashes
      return success(res, {
        tradingPair: decodedTradingPair,
        trades: [],
      }, 'Trades retrieved successfully');
    }
  });
}

module.exports = new OrderBookController();
