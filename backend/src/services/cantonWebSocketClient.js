/**
 * Canton WebSocket Client
 * 
 * Uses Canton JSON Ledger API WebSocket endpoints for streaming active contracts.
 * This bypasses the 200 element HTTP REST limit.
 * 
 * Documentation: https://docs.digitalasset.com/build/3.4/reference/json-api/asyncapi.html
 * 
 * WebSocket Endpoints:
 * - /v2/state/active-contracts - Stream active contracts
 * - /v2/updates - Stream updates (transactions, reassignments)
 */

const WebSocket = require('ws');
const config = require('../config');
const tokenProvider = require('./tokenProvider');

class CantonWebSocketClient {
  constructor() {
    const httpBase = config.canton.jsonApiBase || 'http://65.108.40.104:31539';
    this.wsBase = httpBase.replace('http://', 'ws://').replace('https://', 'wss://');
    this.connections = new Map(); // track active connections
    console.log('[CantonWS] Initialized with base:', this.wsBase);
  }

  /**
   * Connect to WebSocket endpoint with JWT auth
   * According to AsyncAPI docs:
   *   httpApiKeyAuth: name: Sec-WebSocket-Protocol, in: header
   * 
   * The token should be the WebSocket subprotocol
   */
  async connect(endpoint, token) {
    const url = `${this.wsBase}${endpoint}`;
    console.log(`[CantonWS] Connecting to ${url}`);

    return new Promise((resolve, reject) => {
      // Canton WebSocket uses the JWT as a subprotocol
      // Pass token directly as subprotocol (may need to encode)
      const ws = new WebSocket(url, [token]);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log(`[CantonWS] Connected to ${endpoint}`);
        resolve(ws);
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error(`[CantonWS] Connection error:`, error.message);
        reject(error);
      });
    });
  }

  /**
   * Stream active contracts via WebSocket
   * This bypasses the 200 element REST limit
   * 
   * @param {string} party - Party to query for
   * @param {string[]} templateIds - Template IDs to filter (e.g., ["packageId:Module:Template"])
   * @param {number} offset - Ledger offset to query at
   * @returns {Promise<Array>} Array of contracts
   */
  async streamActiveContracts(party, templateIds = [], offset = null) {
    const token = await tokenProvider.getServiceToken();
    
    // Get ledger end if no offset provided
    if (offset === null) {
      const cantonService = require('./cantonService');
      offset = await cantonService.getLedgerEndOffset(token);
    }

    const ws = await this.connect('/v2/state/active-contracts', token);
    const contracts = [];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        console.log(`[CantonWS] Timeout - collected ${contracts.length} contracts`);
        resolve(contracts);
      }, 30000); // 30 second timeout

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          // Check for error
          if (message.code || message.cause) {
            console.error('[CantonWS] Error:', message);
            return;
          }

          // Process contract entry
          if (message.contractEntry) {
            const activeContract = message.contractEntry.JsActiveContract;
            if (activeContract) {
              contracts.push({
                workflowId: message.workflowId,
                contractEntry: message.contractEntry,
                createdEvent: activeContract.createdEvent,
                synchronizerId: activeContract.synchronizerId
              });
            }
          }

          // Check for empty/end signal
          if (message.contractEntry?.JsEmpty) {
            clearTimeout(timeout);
            console.log(`[CantonWS] Stream complete - ${contracts.length} contracts`);
            ws.close();
            resolve(contracts);
          }
        } catch (e) {
          console.error('[CantonWS] Parse error:', e.message);
        }
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        console.log(`[CantonWS] Connection closed - ${contracts.length} contracts collected`);
        resolve(contracts);
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error('[CantonWS] Error:', error.message);
        reject(error);
      });

      // Send the request
      // Build filter - DO NOT use wildcard in production
      const filter = {
        filtersByParty: {
          [party]: templateIds.length > 0 ? {
            templateFilters: templateIds.map(tid => ({
              templateId: tid,
              includeCreatedEventBlob: false
            }))
          } : {
            // If no templates specified, use wildcard (not recommended for production)
            cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }]
          }
        }
      };

      const request = {
        filter: filter,
        verbose: false,
        activeAtOffset: offset
      };

      console.log(`[CantonWS] Sending request for party: ${party.substring(0, 30)}..., templates: ${templateIds.join(', ') || 'all'}`);
      ws.send(JSON.stringify(request));
    });
  }

  /**
   * Stream updates (transactions) via WebSocket
   * Use this for real-time order book updates
   */
  async streamUpdates(party, templateIds = [], beginOffset = 0, onUpdate) {
    const token = await tokenProvider.getServiceToken();
    const ws = await this.connect('/v2/updates', token);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.code || message.cause) {
          console.error('[CantonWS] Update error:', message);
          return;
        }

        if (message.update) {
          onUpdate(message.update);
        }
      } catch (e) {
        console.error('[CantonWS] Parse error:', e.message);
      }
    });

    ws.on('error', (error) => {
      console.error('[CantonWS] Update stream error:', error.message);
    });

    // Send request
    const filter = {
      filtersByParty: {
        [party]: templateIds.length > 0 ? {
          templateFilters: templateIds.map(tid => ({
            templateId: tid,
            includeCreatedEventBlob: false
          }))
        } : {}
      }
    };

    const request = {
      beginExclusive: beginOffset,
      filter: filter,
      verbose: false
    };

    console.log(`[CantonWS] Starting updates stream from offset ${beginOffset}`);
    ws.send(JSON.stringify(request));

    return ws; // Return WebSocket for caller to manage
  }

  /**
   * Get all Order contracts for the global order book using WebSocket streaming
   */
  async getOrdersForOrderBook(operatorPartyId) {
    const packageId = config.canton.packageIds?.clobExchange;
    if (!packageId) {
      throw new Error('CLOB_EXCHANGE_PACKAGE_ID not configured');
    }

    const templateId = `${packageId}:Order:Order`;
    
    console.log(`[CantonWS] Fetching Order contracts for order book...`);
    
    const contracts = await this.streamActiveContracts(
      operatorPartyId,
      [templateId]
    );

    // Parse contracts
    const orders = contracts
      .filter(c => c.createdEvent?.templateId?.includes(':Order:Order'))
      .map(c => {
        const payload = c.createdEvent?.createArgument || {};
        return {
          contractId: c.createdEvent?.contractId,
          orderId: payload.orderId,
          owner: payload.owner,
          tradingPair: payload.tradingPair,
          orderType: payload.orderType,
          orderMode: payload.orderMode,
          price: payload.price?.Some || payload.price,
          quantity: payload.quantity,
          filled: payload.filled || '0',
          status: payload.status,
          timestamp: payload.timestamp
        };
      })
      .filter(o => o.status === 'OPEN');

    console.log(`[CantonWS] Found ${orders.length} open orders`);
    return orders;
  }
}

// Singleton
let instance = null;
function getCantonWebSocketClient() {
  if (!instance) {
    instance = new CantonWebSocketClient();
  }
  return instance;
}

module.exports = { CantonWebSocketClient, getCantonWebSocketClient };
