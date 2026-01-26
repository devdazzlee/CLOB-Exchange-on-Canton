/**
 * OrderBook Controller
 * Handles OrderBook-related HTTP requests
 */

const orderBookService = require('../services/orderBookService');
const { success, error } = require('../utils/response');
const asyncHandler = require('../middleware/asyncHandler');
const { NotFoundError } = require('../utils/errors');

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

    try {
      const orderBook = await orderBookService.getOrderBook(decodedTradingPair);
      return success(res, { orderBook }, 'OrderBook retrieved successfully');
    } catch (err) {
      if (err instanceof NotFoundError) {
        return success(res, {
          orderBook: null,
          tradingPair: decodedTradingPair,
        }, 'OrderBook not found', 200);
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
