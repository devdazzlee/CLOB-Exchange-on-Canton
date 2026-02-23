/**
 * Streaming Read Model — WebSocket-based (Client Requirement)
 * 
 * Uses Canton JSON Ledger API v2 WebSocket endpoints:
 * 
 *   1. BOOTSTRAP: ws://host/v2/state/active-contracts
 *      Streams ALL active contracts (bypasses the 200-element REST limit entirely).
 *      Each message is a single contract. Connection closes when all are sent.
 * 
 *   2. LIVE UPDATES: ws://host/v2/updates/flats
 *      Persistent WebSocket connection for real-time create/archive events.
 *      Streams every new transaction as it happens — true push, no polling.
 * 
 * Authentication: 
 *   - Subprotocol: ['daml.ws.auth']
 *   - Header: Authorization: Bearer <token>
 *   - NOTE: jwt.token.<token> subprotocol does NOT work on this Canton instance
 * 
 * @see https://docs.digitalasset.com/build/3.3/reference/json-api/asyncapi.html
 * @see https://docs.digitalasset.com/build/3.5/tutorials/json-api/canton_and_the_json_ledger_api_ts_websocket.html
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const config = require('../config');
const { TOKEN_STANDARD_PACKAGE_ID, LEGACY_PACKAGE_ID } = require('../config/constants');
const tokenProvider = require('./tokenProvider');

// ─── Constants ────────────────────────────────────────────────────────────────
const WS_RECONNECT_DELAY_MS = 3000;
const MAX_BOOTSTRAP_RETRIES = 5;
const BOOTSTRAP_RETRY_DELAY_MS = 8000;
const TOKEN_REFRESH_INTERVAL_MS = 4 * 60 * 1000; // Refresh token every 4 min

class StreamingReadModel extends EventEmitter {
  constructor() {
    super();

    // ─── In-memory state ──────────────────────────────────────────────
    this.orders = new Map();       // Map<contractId, orderData>
    this.trades = new Map();       // Map<contractId, tradeData>
    this.allocations = new Map();  // Map<contractId, allocationData>

    // ─── Indices ──────────────────────────────────────────────────────
    this.ordersByPair = new Map();   // Map<tradingPair, Set<contractId>>
    this.ordersByOwner = new Map();  // Map<ownerPartyId, Set<contractId>>
    this.tradesByPair = new Map();   // Map<tradingPair, Set<contractId>>

    // ─── Connection state ─────────────────────────────────────────────
    this.bootstrapComplete = false;
    this.lastOffset = null;
    this.updatesWs = null;           // Live WebSocket connection
    this.reconnectTimer = null;
    this.tokenRefreshTimer = null;
    this._stopped = false;

    // ─── Config ───────────────────────────────────────────────────────
    const httpBase = config.canton.jsonApiBase || 'http://localhost:31539';
    this.wsBase = httpBase.replace(/^http/, 'ws'); // http → ws, https → wss
    this.operatorPartyId = config.canton.operatorPartyId;
    this.packageId = config.canton.packageIds?.clobExchange;
    this.legacyPackageId = LEGACY_PACKAGE_ID;

    // Template IDs to subscribe to
    this.templateIds = [];

    console.log('[StreamingReadModel] Initialized (WebSocket mode)');
    console.log(`[StreamingReadModel]   WS base: ${this.wsBase}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  async initialize() {
    if (!this.packageId || !this.operatorPartyId) {
      console.warn('[StreamingReadModel] Missing packageId or operatorPartyId — skipping');
      return;
    }

    // Build template ID list
    this.templateIds = [
      `${this.packageId}:Order:Order`,
      `${this.packageId}:Settlement:Trade`,
      `${this.packageId}:Settlement:AllocationRecord`,
    ];
    if (this.legacyPackageId && this.legacyPackageId !== this.packageId) {
      this.templateIds.push(`${this.legacyPackageId}:Order:Order`);
      this.templateIds.push(`${this.legacyPackageId}:Trade:Trade`);
    }

    console.log('[StreamingReadModel] 🔌 Starting WebSocket-based streaming...');
    console.log(`[StreamingReadModel]   Templates: ${this.templateIds.length}`);
    this.templateIds.forEach(t => console.log(`[StreamingReadModel]     - ${t}`));

    // STEP 1: Get current ledger end offset (REST — single call)
    let retries = 0;
    while (retries < MAX_BOOTSTRAP_RETRIES) {
      try {
        await this._bootstrapViaWebSocket();
        console.log(`[StreamingReadModel] ✅ WebSocket bootstrap complete:`);
        console.log(`[StreamingReadModel]   Orders:      ${this.orders.size}`);
        console.log(`[StreamingReadModel]   Trades:      ${this.trades.size}`);
        console.log(`[StreamingReadModel]   Allocations: ${this.allocations.size}`);
        console.log(`[StreamingReadModel]   Last offset: ${this.lastOffset}`);

        // STEP 2: Connect to live updates WebSocket
        await this._connectUpdatesWebSocket();
        return;
      } catch (error) {
        retries++;
        console.error(`[StreamingReadModel] ❌ Bootstrap attempt ${retries}/${MAX_BOOTSTRAP_RETRIES}: ${error.message}`);
        if (retries < MAX_BOOTSTRAP_RETRIES) {
          console.log(`[StreamingReadModel]   Retrying in ${BOOTSTRAP_RETRY_DELAY_MS / 1000}s...`);
          await new Promise(r => setTimeout(r, BOOTSTRAP_RETRY_DELAY_MS));
        }
      }
    }

    console.error('[StreamingReadModel] ❌ All bootstrap attempts failed — services will use REST fallback');
  }

  stop() {
    this._stopped = true;
    if (this.updatesWs) {
      this.updatesWs.close();
      this.updatesWs = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
    console.log('[StreamingReadModel] Stopped');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: BOOTSTRAP — WebSocket /v2/state/active-contracts
  // Streams ALL active contracts, bypassing the 200-element REST limit.
  // ═══════════════════════════════════════════════════════════════════════════

  async _bootstrapViaWebSocket() {
    const token = await tokenProvider.getServiceToken();

    // First, get ledger end offset (REST — one call, always works)
    const endRes = await fetch(`${config.canton.jsonApiBase}/v2/state/ledger-end`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!endRes.ok) throw new Error(`Failed to get ledger-end: ${endRes.status}`);
    const endData = await endRes.json();
    this.lastOffset = endData.offset;
    console.log(`[StreamingReadModel] Ledger offset: ${this.lastOffset}`);

    // Bootstrap each template group via WebSocket
    const templateGroups = this.templateIds;
    let totalContracts = 0;

    for (const templateId of templateGroups) {
      const count = await this._bootstrapTemplate(templateId, this.lastOffset, token);
      totalContracts += count;
    }

    console.log(`[StreamingReadModel] 📦 Bootstrapped ${totalContracts} total contracts`);

    // Diagnostic: count orders by status
    const statusCounts = {};
    for (const order of this.orders.values()) {
      statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;
    }
    if (Object.keys(statusCounts).length > 0) {
      console.log(`[StreamingReadModel]   Order statuses: ${JSON.stringify(statusCounts)}`);
    }
    const pairCounts = {};
    for (const [pair, ids] of this.ordersByPair) {
      pairCounts[pair] = ids.size;
    }
    if (Object.keys(pairCounts).length > 0) {
      console.log(`[StreamingReadModel]   Orders by pair: ${JSON.stringify(pairCounts)}`);
    }

    this.bootstrapComplete = true;
  }

  /**
   * Bootstrap a single template via WebSocket.
   * Each message from Canton is a single contract.
   * Connection closes automatically when all contracts are sent.
   */
  async _bootstrapTemplate(templateId, offset, token) {
    return new Promise((resolve, reject) => {
      const url = `${this.wsBase}/v2/state/active-contracts`;
      const ws = new WebSocket(url, ['daml.ws.auth'], {
        handshakeTimeout: 15000,
        headers: { 'Authorization': `Bearer ${token}` }
      });

      let count = 0;
      const timeout = setTimeout(() => {
        console.warn(`[StreamingReadModel] ⏱️ Bootstrap timeout for ${templateId.split(':').slice(-2).join(':')}`);
        ws.close();
        resolve(count);
      }, 60000); // 60s timeout per template

      ws.on('open', () => {
        // Send the ACS query filter
        const filter = {
          filter: {
            filtersByParty: {
              [this.operatorPartyId]: {
                cumulative: [{
                  identifierFilter: {
                    TemplateFilter: {
                      value: {
                        templateId: templateId,
                        includeCreatedEventBlob: false
                      }
                    }
                  }
                }]
              }
            }
          },
          verbose: false,
          activeAtOffset: offset
        };
        ws.send(JSON.stringify(filter));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Check for error response
          if (msg.code && msg.cause) {
            console.warn(`[StreamingReadModel] ⚠️ ACS error for ${templateId.split(':').pop()}: ${msg.cause.substring(0, 100)}`);
            return;
          }

          // Normalize and process contract
          const contract = this._normalizeContract(msg);
          if (contract && contract.contractId) {
            this._processContract(contract);
            count++;
          } else if (count === 0 && !msg.offset) {
            // Log first unrecognized message for diagnostics
            const keys = Object.keys(msg).join(', ');
            console.warn(`[StreamingReadModel] ⚠️ Unrecognized message format (keys: ${keys})`);
          }
        } catch (e) {
          // Ignore parse errors on individual messages
        }
      });

      ws.on('close', (code) => {
        clearTimeout(timeout);
        const shortName = templateId.split(':').slice(-2).join(':');
        if (count > 0) {
          console.log(`[StreamingReadModel] 📦 ${shortName}: ${count} contracts (WS closed: ${code})`);
        }
        resolve(count);
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`[StreamingReadModel] ❌ ACS WS error for ${templateId}: ${err.message}`);
        // Resolve with 0 instead of rejecting so other templates can still bootstrap
        resolve(count);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: LIVE UPDATES — WebSocket /v2/updates/flats
  // Persistent connection that streams all contract creates/archives.
  // ═══════════════════════════════════════════════════════════════════════════

  async _connectUpdatesWebSocket() {
    if (this._stopped) return;

    const token = await tokenProvider.getServiceToken();
    const url = `${this.wsBase}/v2/updates/flats`;

    console.log(`[StreamingReadModel] 🔌 Connecting live updates WebSocket: ${url}`);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, ['daml.ws.auth'], {
        handshakeTimeout: 15000,
        headers: { 'Authorization': `Bearer ${token}` }
      });

      ws.on('open', () => {
        console.log('[StreamingReadModel] ✅ Live updates WebSocket CONNECTED');

        // Send subscription filter
        const filter = {
          verbose: false,
          beginExclusive: this.lastOffset,
          filter: {
            filtersByParty: {
              [this.operatorPartyId]: {
                cumulative: this.templateIds.map(tid => ({
                  identifierFilter: {
                    TemplateFilter: {
                      value: {
                        templateId: tid,
                        includeCreatedEventBlob: false
                      }
                    }
                  }
                }))
              }
            }
          }
        };
        ws.send(JSON.stringify(filter));
        console.log(`[StreamingReadModel] 📡 Subscribed from offset ${this.lastOffset} (${this.templateIds.length} templates)`);

        this.updatesWs = ws;

        // Set up token refresh (Canton tokens expire)
        this._startTokenRefresh();

        resolve();
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleUpdateMessage(msg);
        } catch (e) {
          // Ignore parse errors
        }
      });

      ws.on('close', (code, reason) => {
        console.warn(`[StreamingReadModel] ⚠️ Updates WebSocket closed: ${code} ${reason?.toString() || ''}`);
        this.updatesWs = null;

        // Auto-reconnect unless stopped
        if (!this._stopped) {
          console.log(`[StreamingReadModel] 🔄 Reconnecting in ${WS_RECONNECT_DELAY_MS / 1000}s...`);
          this.reconnectTimer = setTimeout(() => {
            this._connectUpdatesWebSocket().catch(err => {
              console.error('[StreamingReadModel] Reconnect failed:', err.message);
            });
          }, WS_RECONNECT_DELAY_MS);
        }
      });

      ws.on('error', (err) => {
        console.error('[StreamingReadModel] ❌ Updates WS error:', err.message);
        // close event will trigger reconnect
      });
    });
  }

  /**
   * Handle a single update message from /v2/updates/flats
   */
  _handleUpdateMessage(msg) {
    const update = msg.update;
    if (!update) return;

    // Offset checkpoint — track position
    if (update.OffsetCheckpoint?.value?.offset != null) {
      this.lastOffset = update.OffsetCheckpoint.value.offset;
      return;
    }

    // Transaction update — process events
    const tx = update.Transaction?.value;
    if (!tx) return;

    const events = tx.events || [];
    let newEvents = 0;

    for (const event of events) {
      // Created event
      const created = event.CreatedEvent || event.created || event.createdEvent;
      if (created) {
        const contract = this._normalizeContract({ createdEvent: created });
        if (contract && contract.contractId) {
          this._processContract(contract);
          newEvents++;
        }
      }

      // Archived event
      const archived = event.ArchivedEvent || event.archived || event.archivedEvent;
      if (archived) {
        this._processArchivedEvent(archived);
        newEvents++;
      }
    }

    // Track offset
    if (tx.offset != null) {
      this.lastOffset = tx.offset;
    }

    if (newEvents > 0) {
      // Log significant updates (orders/trades, not just offsets)
      if (newEvents <= 10) {
        console.log(`[StreamingReadModel] 📡 ${newEvents} event(s) at offset ${this.lastOffset} — orders: ${this.orders.size}, trades: ${this.trades.size}`);
      }
      this.emit('update', { type: 'websocket', events: newEvents, offset: this.lastOffset });
    }
  }

  /**
   * Periodically refresh the auth token and reconnect.
   * Canton JWT tokens expire, so we need to reconnect with a fresh token.
   */
  _startTokenRefresh() {
    if (this.tokenRefreshTimer) clearInterval(this.tokenRefreshTimer);

    this.tokenRefreshTimer = setInterval(async () => {
      if (this._stopped) return;
      try {
        // Force reconnect with fresh token
        console.log('[StreamingReadModel] 🔄 Token refresh — reconnecting updates WebSocket...');
        if (this.updatesWs) {
          this.updatesWs.close();
          // close handler will trigger reconnect
        }
      } catch (e) {
        console.warn('[StreamingReadModel] Token refresh error:', e.message);
      }
    }, TOKEN_REFRESH_INTERVAL_MS);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTRACT NORMALIZATION & PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════

  _normalizeContract(item) {
    let createdEvent;

    if (item.contractEntry?.JsActiveContract) {
      createdEvent = item.contractEntry.JsActiveContract.createdEvent || {};
    } else if (item.createdEvent) {
      createdEvent = item.createdEvent;
    } else if (item.contractId) {
      return {
        contractId: item.contractId,
        templateId: item.templateId || '',
        payload: item.payload || item.createArgument || {},
      };
    } else {
      return null;
    }

    return {
      contractId: createdEvent.contractId || createdEvent.contract_id,
      templateId: createdEvent.templateId || createdEvent.template_id || '',
      payload: createdEvent.createArgument || createdEvent.create_argument || createdEvent.payload || {},
    };
  }

  _processContract(contract) {
    const { contractId, templateId, payload } = contract;
    if (!contractId) return;

    if (this._isOrderTemplate(templateId)) {
      this._addOrder(contractId, templateId, payload);
    } else if (this._isTradeTemplate(templateId)) {
      this._addTrade(contractId, templateId, payload);
    } else if (this._isAllocationTemplate(templateId)) {
      this._addAllocation(contractId, templateId, payload);
    }
  }

  _processArchivedEvent(event) {
    const contractId = event.contractId || event.contract_id;
    if (!contractId) return;

    if (this.orders.has(contractId)) {
      this._removeOrder(contractId);
    } else if (this.trades.has(contractId)) {
      this._removeTrade(contractId);
    } else if (this.allocations.has(contractId)) {
      this.allocations.delete(contractId);
    }
  }

  // ─── Template matching ─────────────────────────────────────────────────

  _isOrderTemplate(templateId) {
    const tid = typeof templateId === 'string' ? templateId : JSON.stringify(templateId);
    return tid.includes('Order:Order');
  }

  _isTradeTemplate(templateId) {
    const tid = typeof templateId === 'string' ? templateId : JSON.stringify(templateId);
    return tid.includes('Settlement:Trade') || tid.includes('Trade:Trade');
  }

  _isAllocationTemplate(templateId) {
    const tid = typeof templateId === 'string' ? templateId : JSON.stringify(templateId);
    return tid.includes('AllocationRecord');
  }

  // ─── Order management ─────────────────────────────────────────────────

  _addOrder(contractId, templateId, payload) {
    let rawPrice = payload.price;
    if (rawPrice && typeof rawPrice === 'object' && rawPrice.Some !== undefined) {
      rawPrice = rawPrice.Some;
    }

    const order = {
      contractId,
      templateId,
      orderId: payload.orderId,
      owner: payload.owner,
      orderType: payload.orderType,
      orderMode: payload.orderMode || 'LIMIT',
      tradingPair: payload.tradingPair,
      price: rawPrice,
      quantity: payload.quantity,
      filled: payload.filled || '0',
      status: payload.status,
      timestamp: payload.timestamp,
      allocationCid: payload.allocationCid,
      stopPrice: payload.stopPrice,
    };

    this.orders.set(contractId, order);

    // Index by trading pair
    if (order.tradingPair) {
      if (!this.ordersByPair.has(order.tradingPair)) {
        this.ordersByPair.set(order.tradingPair, new Set());
      }
      this.ordersByPair.get(order.tradingPair).add(contractId);
    }

    // Index by owner
    if (order.owner) {
      if (!this.ordersByOwner.has(order.owner)) {
        this.ordersByOwner.set(order.owner, new Set());
      }
      this.ordersByOwner.get(order.owner).add(contractId);
    }

    this.emit('orderCreated', order);
  }

  _removeOrder(contractId) {
    const order = this.orders.get(contractId);
    if (!order) return;

    if (order.tradingPair) {
      const pairSet = this.ordersByPair.get(order.tradingPair);
      if (pairSet) pairSet.delete(contractId);
    }
    if (order.owner) {
      const ownerSet = this.ordersByOwner.get(order.owner);
      if (ownerSet) ownerSet.delete(contractId);
    }

    this.orders.delete(contractId);
    this.emit('orderArchived', order);
  }

  // ─── Trade management ─────────────────────────────────────────────────

  _addTrade(contractId, templateId, payload) {
    const baseSymbol = payload.baseInstrumentId?.symbol || '';
    const quoteSymbol = payload.quoteInstrumentId?.symbol || '';
    const tradingPair = (baseSymbol && quoteSymbol)
      ? `${baseSymbol}/${quoteSymbol}`
      : (payload.tradingPair || '');

    const trade = {
      contractId,
      templateId,
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
    };

    this.trades.set(contractId, trade);

    if (tradingPair) {
      if (!this.tradesByPair.has(tradingPair)) {
        this.tradesByPair.set(tradingPair, new Set());
      }
      this.tradesByPair.get(tradingPair).add(contractId);
    }

    this.emit('tradeCreated', trade);
  }

  _removeTrade(contractId) {
    const trade = this.trades.get(contractId);
    if (!trade) return;

    if (trade.tradingPair) {
      const pairSet = this.tradesByPair.get(trade.tradingPair);
      if (pairSet) pairSet.delete(contractId);
    }

    this.trades.delete(contractId);
  }

  // ─── Allocation management ────────────────────────────────────────────

  _addAllocation(contractId, templateId, payload) {
    this.allocations.set(contractId, {
      contractId,
      templateId,
      allocationId: payload.allocationId,
      orderId: payload.orderId,
      sender: payload.sender,
      receiver: payload.receiver,
      executor: payload.executor,
      amount: payload.amount,
      instrument: payload.instrument,
      status: payload.status,
      createdAt: payload.createdAt,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY METHODS — Used by matching engine, order book, etc.
  // ═══════════════════════════════════════════════════════════════════════════

  isReady() {
    return this.bootstrapComplete;
  }

  getOpenOrdersForPair(tradingPair) {
    const contractIds = this.ordersByPair.get(tradingPair);
    if (!contractIds) return [];

    const result = [];
    for (const cid of contractIds) {
      const order = this.orders.get(cid);
      if (order && order.status === 'OPEN') {
        result.push({ ...order });
      }
    }
    return result;
  }

  getAllOpenOrders() {
    const result = [];
    for (const order of this.orders.values()) {
      if (order.status === 'OPEN') {
        result.push({ ...order });
      }
    }
    return result;
  }

  getOrdersForParty(partyId) {
    const contractIds = this.ordersByOwner.get(partyId);
    if (!contractIds) return [];

    const result = [];
    for (const cid of contractIds) {
      const order = this.orders.get(cid);
      if (order) result.push({ ...order });
    }
    return result;
  }

  getOrderBook(tradingPair) {
    const openOrders = this.getOpenOrdersForPair(tradingPair);

    const buyOrders = openOrders
      .filter(o => o.orderType === 'BUY')
      .map(o => ({
        ...o,
        remaining: parseFloat(o.quantity || 0) - parseFloat(o.filled || 0),
      }))
      .filter(o => o.remaining > 0.0000001) // Filter fully-filled orders still marked OPEN
      .sort((a, b) => parseFloat(b.price || 0) - parseFloat(a.price || 0));

    const sellOrders = openOrders
      .filter(o => o.orderType === 'SELL')
      .map(o => ({
        ...o,
        remaining: parseFloat(o.quantity || 0) - parseFloat(o.filled || 0),
      }))
      .filter(o => o.remaining > 0.0000001) // Filter fully-filled orders still marked OPEN
      .sort((a, b) => parseFloat(a.price || Infinity) - parseFloat(b.price || Infinity));

    return {
      tradingPair,
      buyOrders,
      sellOrders,
      lastPrice: null,
      timestamp: new Date().toISOString(),
      source: 'websocket-stream',
    };
  }

  getTradesForPair(tradingPair, limit = 50) {
    const contractIds = this.tradesByPair.get(tradingPair);
    if (!contractIds) return [];

    const result = [];
    for (const cid of contractIds) {
      const trade = this.trades.get(cid);
      if (trade) result.push({ ...trade });
    }

    return result
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      .slice(0, limit);
  }

  getAllTrades(limit = 100) {
    const result = [];
    for (const trade of this.trades.values()) {
      result.push({ ...trade });
    }
    return result
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      .slice(0, limit);
  }

  getTradesForParty(partyId, limit = 100) {
    const result = [];
    for (const trade of this.trades.values()) {
      if (trade.buyer === partyId || trade.seller === partyId) {
        result.push({ ...trade });
      }
    }
    return result
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      .slice(0, limit);
  }

  getArchivableContracts() {
    const archivable = {
      filledOrders: [],
      cancelledOrders: [],
      oldTrades: [],
      executedAllocations: [],
      cancelledAllocations: [],
    };

    for (const order of this.orders.values()) {
      if (order.status === 'FILLED') archivable.filledOrders.push(order);
      if (order.status === 'CANCELLED') archivable.cancelledOrders.push(order);
    }

    for (const alloc of this.allocations.values()) {
      if (alloc.status === 'EXECUTED') archivable.executedAllocations.push(alloc);
      if (alloc.status === 'CANCELLED') archivable.cancelledAllocations.push(alloc);
    }

    return archivable;
  }

  getStats() {
    const ordersByStatus = {};
    for (const order of this.orders.values()) {
      ordersByStatus[order.status] = (ordersByStatus[order.status] || 0) + 1;
    }

    return {
      ready: this.bootstrapComplete,
      mode: 'websocket',
      wsConnected: this.updatesWs?.readyState === WebSocket.OPEN,
      offset: this.lastOffset,
      orders: this.orders.size,
      ordersByStatus,
      trades: this.trades.size,
      allocations: this.allocations.size,
      pairs: [...this.ordersByPair.keys()],
    };
  }

  /**
   * Force re-bootstrap (useful when new contracts are deployed)
   */
  async rebootstrap() {
    console.log('[StreamingReadModel] Force re-bootstrap requested...');
    this.orders.clear();
    this.trades.clear();
    this.allocations.clear();
    this.ordersByPair.clear();
    this.ordersByOwner.clear();
    this.tradesByPair.clear();
    this.bootstrapComplete = false;

    await this._bootstrapViaWebSocket();
    console.log(`[StreamingReadModel] ✅ Re-bootstrap: ${this.orders.size} orders, ${this.trades.size} trades`);
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────
let instance = null;

function getStreamingReadModel() {
  if (!instance) {
    instance = new StreamingReadModel();
  }
  return instance;
}

module.exports = { StreamingReadModel, getStreamingReadModel };
