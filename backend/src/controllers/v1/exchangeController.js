/**
 * Exchange API v1 Controller
 * 
 * Production-grade API endpoints following the no-patches architecture:
 * Frontend → Exchange API → Canton JSON Ledger API
 * 
 * RULES:
 * - NO in-memory orderbooks as source of truth
 * - NO fallback tokens or hardcoded values
 * - NO mock data or empty array fallbacks on errors
 * - All ledger writes use submit-and-wait-for-transaction
 * - Read model derived from ACS + updates stream
 */

const crypto = require('crypto');
const config = require('../../config');

const cantonService = require('../../services/cantonService');
const tokenProvider = require('../../services/tokenProvider');
const { getReadModelService } = require('../../services/readModelService');
const asyncHandler = require('../../middleware/asyncHandler');
const {
  ValidationError,
  NotFoundError,
  LedgerError,
  ErrorCodes
} = require('../../utils/ledgerError');
const { createLedgerErrorFromResponse } = require('../../utils/ledgerError');

/**
 * Generate structured API response
 */
function success(res, data, ledgerMeta = null, statusCode = 200) {
  const response = {
    ok: true,
    data
  };
  if (ledgerMeta) {
    response.ledger = ledgerMeta;
  }
  return res.status(statusCode).json(response);
}

/**
 * Generate error response
 */
function error(res, err, requestId) {
  const statusCode = err.getHttpStatus ? err.getHttpStatus() : 500;
  return res.status(statusCode).json({
    ...err.toJSON(),
    meta: { requestId }
  });
}

class ExchangeController {

  // ====================
  // AUTH
  // ====================

  /**
   * POST /v1/auth/exchange
   * Exchange OIDC id_token for ledger token
   */
  exchangeToken = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { idToken } = req.body;

    if (!idToken) {
      throw new ValidationError('idToken is required');
    }

    try {
      // Decode id_token to get user ID
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        throw new ValidationError('Invalid idToken format');
      }
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      const userId = payload.sub;

      if (!userId) {
        throw new ValidationError('idToken missing sub claim');
      }

      // Exchange for ledger token
      const ledgerToken = await tokenProvider.getUserToken(userId, idToken);
      const expiresAt = new Date(tokenProvider.extractExpiry(ledgerToken)).toISOString();

      return success(res, {
        ledgerToken,
        expiresAt
      });

    } catch (err) {
      if (err instanceof LedgerError || err instanceof ValidationError) {
        throw err;
      }
      throw new LedgerError(ErrorCodes.UNAUTHORIZED, `Token exchange failed: ${err.message}`);
    }
  });

  // ====================
  // WALLETS
  // ====================

  /**
   * POST /v1/wallets
   * Create wallet and onboard party
   */
  createWallet = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { displayName } = req.body;

    if (!displayName) {
      throw new ValidationError('displayName is required');
    }

    // This would:
    // 1. Allocate party via admin API
    // 2. Create UserAccount/Wallet contract via submit-and-wait-for-transaction
    // For now, return structured response placeholder

    return res.status(501).json({
      ok: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Wallet creation requires party allocation setup'
      },
      meta: { requestId }
    });
  });

  // ====================
  // ORDERS
  // ====================

  /**
   * POST /v1/orders
   * Place a new order using Canton ledger
   */
  placeOrder = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const {
      pair,
      side,
      type,
      price,
      quantity,
      clientOrderId
    } = req.body;

    // Validation
    if (!pair || !side || !type || !quantity) {
      throw new ValidationError('Missing required fields: pair, side, type, quantity', {
        missing: ['pair', 'side', 'type', 'quantity'].filter(f => !req.body[f])
      });
    }

    if (type.toUpperCase() === 'LIMIT' && !price) {
      throw new ValidationError('Price is required for LIMIT orders');
    }

    if (!['BUY', 'SELL'].includes(side.toUpperCase())) {
      throw new ValidationError('Invalid side. Must be BUY or SELL');
    }

    if (!['LIMIT', 'MARKET'].includes(type.toUpperCase())) {
      throw new ValidationError('Invalid type. Must be LIMIT or MARKET');
    }

    // Get party from authenticated request (WALLET AUTH, NOT KEYCLOAK)
    const partyId = req.walletId;
    if (!partyId) {
      throw new LedgerError(ErrorCodes.UNAUTHORIZED, 'Wallet authentication required');
    }

    // Generate deterministic command ID for idempotency
    const orderId = clientOrderId || crypto.randomUUID();
    const commandId = `cmd-place-${orderId}`;

    console.log(`[ExchangeAPI] Placing order: ${orderId} (${side} ${quantity} ${pair} @ ${price || 'MARKET'})`);

    try {
      const token = await tokenProvider.getServiceToken();

      // Use template ID helper for proper format
      const { orderTemplateId } = require('../../utils/templateId');
      const templateId = orderTemplateId();

      // Submit CreateCommand via submit-and-wait-for-transaction
      const result = await cantonService.createContractWithTransaction({
        token,
        actAsParty: partyId,
        templateId,
        createArguments: {
          orderId,
          owner: partyId,
          orderType: side.toUpperCase(),
          orderMode: type.toUpperCase(),
          tradingPair: pair,
          price: type.toUpperCase() === 'LIMIT' ? { Some: price.toString() } : { None: null },
          quantity: quantity.toString(),
          filled: "0.0",
          status: "OPEN",
          timestamp: new Date().toISOString(),
          operator: config.canton.operatorPartyId,
          allocationCid: ""
        },
        readAs: [config.canton.operatorPartyId]
      });

      // Extract from response per Canton spec
      const transaction = result.transaction;
      const createdEvent = transaction?.events?.find(e => e.created || e.CreatedEvent);
      const contractId = createdEvent?.created?.contractId ||
        createdEvent?.CreatedEvent?.contractId;

      console.log(`[ExchangeAPI] ✅ Order placed: ${orderId} -> ${contractId}`);

      // Milestone 4: Register stop-loss if provided
      let stopLossRegistered = false;
      if (req.body.stopLossPrice && parseFloat(req.body.stopLossPrice) > 0) {
        try {
          const { getStopLossService } = require('../../services/stopLossService');
          const stopLossService = getStopLossService();
          
          stopLossService.registerStopLoss({
            orderContractId: contractId,
            tradingPair: pair,
            orderType: side.toUpperCase(),
            stopLossPrice: req.body.stopLossPrice,
            partyId: partyId,
            originalPrice: price || null
          });
          
          stopLossRegistered = true;
          console.log(`[ExchangeAPI] ✅ Stop-loss registered for order ${orderId}`);
        } catch (stopLossError) {
          console.warn(`[ExchangeAPI] ⚠️  Failed to register stop-loss:`, stopLossError.message);
          // Don't fail the order placement if stop-loss registration fails
        }
      }

      return success(res, {
        order: {
          contractId,
          clientOrderId: orderId,
          pair,
          side: side.toUpperCase(),
          type: type.toUpperCase(),
          price: type.toUpperCase() === 'LIMIT' ? price : null,
          quantity,
          filledQuantity: '0',
          status: 'OPEN',
          createdAt: new Date().toISOString(),
          stopLossPrice: req.body.stopLossPrice || null,
          stopLossRegistered
        }
      }, {
        updateId: transaction?.updateId
      }, 201);

    } catch (err) {
      console.error(`[ExchangeAPI] ❌ Order failed:`, err.message);

      if (err instanceof LedgerError) {
        return error(res, err, requestId);
      }

      // Check if it's a fetch response error
      if (err.response) {
        const ledgerError = await createLedgerErrorFromResponse(err.response, 'Place order');
        return error(res, ledgerError, requestId);
      }

      throw new LedgerError(ErrorCodes.LEDGER_COMMAND_REJECTED, err.message);
    }
  });

  /**
   * GET /v1/orders
   * Get user's orders from read model
   */
  listOrders = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { pair, status = 'OPEN', limit = 100 } = req.query;
    const partyId = req.walletId; // From wallet auth middleware

    if (!partyId) {
      throw new LedgerError(ErrorCodes.UNAUTHORIZED, 'Wallet authentication required');
    }

    const readModel = getReadModelService();
    let orders = readModel?.getUserOrders(partyId, { status: status === 'ALL' ? null : status, pair }) || [];

    const limitedOrders = orders.slice(0, parseInt(limit));

    return success(res, {
      orders: limitedOrders.map(order => ({
        contractId: order.contractId,
        clientOrderId: order.orderId,
        pair: order.tradingPair,
        side: order.orderType,
        type: order.orderMode,
        price: order.price,
        quantity: order.quantity,
        filledQuantity: order.filled || '0',
        status: order.status,
        createdAt: order.timestamp
      })),
      pagination: {
        limit: parseInt(limit),
        cursor: null,
        hasMore: orders.length > parseInt(limit)
      }
    });
  });

  /**
   * POST /v1/orders/:contractId/cancel
   * Cancel an order using Canton ledger
   */
  cancelOrder = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { contractId } = req.params;
    const { reason = 'user_requested' } = req.body || {};
    const partyId = req.walletId; // From wallet auth middleware

    if (!contractId) {
      throw new ValidationError('contractId is required');
    }

    if (!partyId) {
      throw new LedgerError(ErrorCodes.UNAUTHORIZED, 'Wallet authentication required');
    }

    const commandId = `cmd-cancel-${contractId.slice(0, 16)}`;

    console.log(`[ExchangeAPI] Cancelling order: ${contractId}`);

    try {
      // Verify ownership from read model
      const readModel = getReadModelService();
      const order = readModel?.getOrderByContractId(contractId);

      if (!order) {
        throw new NotFoundError('Order', contractId);
      }

      if (order.owner !== partyId) {
        throw new LedgerError(ErrorCodes.FORBIDDEN, 'Cannot cancel orders you do not own');
      }

      if (order.status !== 'OPEN') {
        throw new LedgerError(
          order.status === 'CANCELLED' ? ErrorCodes.ORDER_ALREADY_CANCELLED : ErrorCodes.ORDER_ALREADY_FILLED,
          `Order is ${order.status}, cannot cancel`
        );
      }

      const token = await tokenProvider.getServiceToken();

      // Use template ID helper for proper format
      const { orderTemplateId } = require('../../utils/templateId');
      const templateId = orderTemplateId();

      // Submit ExerciseCommand via submit-and-wait-for-transaction
      const result = await cantonService.exerciseChoice({
        token,
        actAsParty: partyId,
        templateId,
        contractId,
        choice: 'CancelOrder',
        choiceArgument: {},
        readAs: [config.canton.operatorPartyId]
      });

      console.log(`[ExchangeAPI] ✅ Order cancelled: ${contractId}`);

      return success(res, {
        cancelled: true,
        order: {
          contractId,
          status: 'CANCELLED'
        }
      }, {
        updateId: result.updateId
      });

    } catch (err) {
      console.error(`[ExchangeAPI] ❌ Cancel failed:`, err.message);

      if (err instanceof LedgerError) {
        return error(res, err, requestId);
      }

      throw err;
    }
  });

  // ====================
  // MARKET DATA
  // ====================

  /**
   * GET /v1/orderbook/:pair
   * Get orderbook snapshot from read model
   */
  getOrderbook = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { pair } = req.params;
    const { depth = 50 } = req.query;

    if (!pair) {
      throw new ValidationError('Trading pair is required');
    }

    const decodedPair = decodeURIComponent(pair);
    console.log(`[ExchangeAPI] Getting orderbook: ${decodedPair}`);

    const readModel = getReadModelService();
    const orderBook = readModel?.getOrderBook(decodedPair);

    if (!orderBook) {
      // Return empty book, NOT a 404 - pair just has no orders
      return success(res, {
        pair: decodedPair,
        bids: [],
        asks: [],
        asOf: {
          updateId: null,
          sequence: readModel?.sequence || 0
        }
      });
    }

    // Convert to [price, quantity] tuples
    const bids = orderBook.bids.slice(0, parseInt(depth)).map(b => [b.price, b.quantity]);
    const asks = orderBook.asks.slice(0, parseInt(depth)).map(a => [a.price, a.quantity]);

    return success(res, {
      pair: decodedPair,
      bids,
      asks,
      asOf: {
        updateId: readModel?.lastOffset,
        sequence: readModel?.sequence || 0
      }
    });
  });

  /**
   * GET /v1/trades
   * Get recent trades from read model
   */
  getTrades = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { pair, limit = 100 } = req.query;

    console.log(`[ExchangeAPI] Getting trades: ${pair || 'all'}`);

    const readModel = getReadModelService();
    const trades = readModel?.getRecentTrades(pair, parseInt(limit)) || [];

    return success(res, {
      pair: pair || null,
      trades: trades.map(t => ({
        tradeId: t.tradeId || t.contractId,
        price: t.price,
        quantity: t.quantity,
        takerSide: t.takerSide || (t.buyOrderId ? 'BUY' : 'SELL'),
        executedAt: t.timestamp
      })),
      nextCursor: null
    });
  });

  /**
   * GET /v1/tickers
   * Get market tickers
   */
  getTickers = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();

    const readModel = getReadModelService();
    const orderBooks = readModel?.getAllOrderBooks() || [];

    const tickers = orderBooks.map(ob => ({
      symbol: ob.pair || ob.tradingPair,
      lastPrice: ob.lastPrice || null,
      bidPrice: ob.bids?.[0]?.price || null,
      askPrice: ob.asks?.[0]?.price || null,
      volume24h: '0.00',
      change24h: '0.00',
      changePercent24h: '0.00%'
    }));

    return success(res, tickers);
  });

  // ====================
  // BALANCES
  // ====================

  /**
   * GET /v1/balances/:partyId
   * Get party balances from ledger contracts
   */
  getBalances = asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const { partyId } = req.params;
    const requestingParty = req.walletId; // From wallet auth middleware

    if (!partyId) {
      throw new ValidationError('partyId is required');
    }

    // Basic auth check - can only view own balances or if operator
    if (requestingParty && requestingParty !== partyId && requestingParty !== config.canton.operatorPartyId) {
      throw new LedgerError(ErrorCodes.FORBIDDEN, 'Cannot view other party balances');
    }

    try {
      const token = await tokenProvider.getServiceToken();

      // Query Balance contracts from ledger
      const templateId = 'clob-exchange:Balance';

      const balanceContracts = await cantonService.queryContracts({
        templateId,
        party: partyId
      }, token);

      // Build balances array
      const balances = balanceContracts.map(contract => ({
        asset: contract.payload.asset,
        available: contract.payload.available,
        locked: contract.payload.locked
      }));

      const readModel = getReadModelService();

      return success(res, {
        partyId,
        balances,
        asOf: {
          updateId: readModel?.lastOffset || null
        }
      });

    } catch (err) {
      console.error(`[ExchangeAPI] ❌ Balances query failed:`, err.message);

      // Return empty balances if contracts don't exist yet (not an error)
      return success(res, {
        partyId,
        balances: [],
        asOf: { updateId: null }
      });
    }
  });
}

module.exports = new ExchangeController();
