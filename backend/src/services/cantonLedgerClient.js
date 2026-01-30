/**
 * Canton JSON Ledger API v2 Client
 * 
 * This service provides a clean, typed interface to Canton's official JSON Ledger API
 * following Digital Asset's recommended patterns.
 * 
 * Key principles:
 * 1. Use submit-and-wait-for-transaction for all writes
 * 2. Use /v2/updates WebSocket for real-time state
 * 3. Use /v2/state/active-contracts only for bootstrap
 * 4. Generate clients from OpenAPI spec (no hand-rolled JSON)
 */

const config = require('../config');
const EventEmitter = require('events');

class CantonLedgerClient extends EventEmitter {
  constructor() {
    super();
    this.cantonApiBase = config.canton.jsonApiBase;
    this.wsConnection = null;
    this.currentOffset = null;
    this.isConnected = false;
  }

  /**
   * Get JWT token for Canton API access
   */
  async getToken() {
    const tokenUrl = config.canton.oauthTokenUrl;
    const clientId = config.canton.oauthClientId;
    const clientSecret = config.canton.oauthClientSecret;

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'openid profile email daml_ledger_api',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!response.ok) {
      throw new Error(`Token fetch failed: ${response.status}`);
    }

    const data = await response.json();
    return data.access_token;
  }

  /**
   * Submit command and wait for transaction - PRIMARY WRITE PATH
   * This is the ONLY endpoint that should be used for ledger writes
   */
  async submitAndWaitForTransaction({ command, actAs, readAs = [], workflowId = null }) {
    const token = await this.getToken();
    
    const requestBody = {
      commands: [command],
      actAs: Array.isArray(actAs) ? actAs : [actAs],
      readAs: Array.isArray(readAs) ? readAs : [],
      ...(workflowId && { workflowId }),
    };

    console.log('[CantonClient] Submitting command:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${this.cantonApiBase}/v2/commands/submit-and-wait-for-transaction`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Command submission failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('[CantonClient] Command successful:', result);
    
    // Update offset from transaction
    if (result.transaction?.offset) {
      this.currentOffset = result.transaction.offset;
    }

    return result;
  }

  /**
   * Get active contracts snapshot - BOOTSTRAP ONLY
   * Use sparingly for initial state, then switch to streaming
   */
  async getActiveContracts({ parties, templateIds = [], activeAtOffset = null }) {
    const token = await this.getToken();
    
    // Get ledger end if no offset provided
    let offset = activeAtOffset;
    if (offset === null || offset === undefined) {
      try {
        offset = await this.getLedgerEnd();
      } catch (e) {
        offset = 0;
      }
    }
    
    // Build the correct v2 filter structure - SIMPLIFIED
    // Canton v2 API uses simpler filter format
    const filter = {};
    
    if (parties && parties.length > 0) {
      filter.filtersByParty = {};
      parties.forEach(party => {
        // Empty object = all templates (wildcard)
        // Or use templateFilters array for specific templates
        if (templateIds && templateIds.length > 0) {
          filter.filtersByParty[party] = {
            templateFilters: templateIds.map(tid => ({
              templateId: typeof tid === 'string' ? tid : `${tid.packageId}:${tid.moduleName}:${tid.entityName}`,
              includeCreatedEventBlob: false
            }))
          };
        } else {
          // Wildcard - get all contracts for party
          filter.filtersByParty[party] = {};
        }
      });
    } else {
      // If no parties specified, use filtersForAnyParty
      if (templateIds && templateIds.length > 0) {
        filter.filtersForAnyParty = {
          templateFilters: templateIds.map(tid => ({
            templateId: typeof tid === 'string' ? tid : `${tid.packageId}:${tid.moduleName}:${tid.entityName}`,
            includeCreatedEventBlob: false
          }))
        };
      } else {
        filter.filtersForAnyParty = {};
      }
    }
    
    const requestBody = {
      filter: filter,
      verbose: false,
      activeAtOffset: offset,
    };

    console.log('[CantonClient] Request body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${this.cantonApiBase}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[CantonClient] Active contracts query failed:', errorText);
      throw new Error(`Active contracts query failed: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Get current ledger end offset
   */
  async getLedgerEnd() {
    const token = await this.getToken();
    
    const response = await fetch(`${this.cantonApiBase}/v2/state/ledger-end`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Ledger end query failed: ${response.status}`);
    }

    const result = await response.json();
    this.currentOffset = result.offset;
    return result.offset;
  }

  /**
   * Connect to WebSocket updates stream - PRIMARY REAL-TIME PATH
   * This replaces all in-memory state management
   */
  async connectUpdatesStream({ parties, templateIds = [] }) {
    if (this.wsConnection) {
      this.wsConnection.close();
    }

    const token = await this.getToken();
    const wsUrl = this.cantonApiBase.replace('http://', 'ws://').replace('https://', 'wss://');
    
    // Build filter for WebSocket - SIMPLIFIED FORMAT (v2 API)
    const filter = {
      filtersByParty: parties.reduce((acc, party) => {
        acc[party] = templateIds.length > 0 ? {
          templateFilters: templateIds.map(tid => ({
            templateId: tid,
            includeCreatedEventBlob: false
          }))
        } : {}; // Empty = wildcard
        return acc;
      }, {})
    };

    // Fix: Use correct subprotocol format for JSON API v2 WebSocket auth
    // Format: jwt.token.<JWT_TOKEN>
    const wsProtocol = `jwt.token.${token}`;
    const ws = new WebSocket(`${wsUrl}/v2/updates`, [wsProtocol]);

    this.wsConnection = ws;

    ws.onopen = () => {
      console.log('[CantonClient] WebSocket connected');
      this.isConnected = true;
      
      // Send subscription request
      ws.send(JSON.stringify({
        beginExclusive: this.currentOffset || 0,
        verbose: false,
        updateFormat: {
          includeTransactions: {
            eventFormat: filter,
            transactionShape: 'TRANSACTION_SHAPE_ACS_DELTA'
          }
        }
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.update?.Transaction) {
          // Handle transaction updates
          const transaction = data.update.Transaction;
          this.currentOffset = transaction.offset;
          
          console.log('[CantonClient] Transaction update:', {
            updateId: transaction.updateId,
            offset: transaction.offset,
            eventCount: transaction.events?.length || 0
          });

          // Emit events for different contract types
          transaction.events?.forEach(event => {
            if (event.CreatedEvent) {
              this.emit('contractCreated', {
                contractId: event.CreatedEvent.contractId,
                templateId: event.CreatedEvent.templateId,
                payload: event.CreatedEvent.createdEventBlob,
                offset: transaction.offset
              });
            } else if (event.ArchivedEvent) {
              this.emit('contractArchived', {
                contractId: event.ArchivedEvent.contractId,
                templateId: event.ArchivedEvent.templateId,
                offset: transaction.offset
              });
            }
          });

          this.emit('transaction', transaction);
        } else if (data.update?.OffsetCheckpoint) {
          // Handle offset checkpoint
          this.currentOffset = data.update.OffsetCheckpoint.value.offset;
          this.emit('offsetCheckpoint', this.currentOffset);
        }
      } catch (error) {
        console.error('[CantonClient] WebSocket message error:', error);
      }
    };

    ws.onclose = () => {
      console.log('[CantonClient] WebSocket disconnected');
      this.isConnected = false;
      this.emit('disconnected');
    };

    ws.onerror = (error) => {
      console.error('[CantonClient] WebSocket error:', error);
      this.emit('error', error);
    };

    return ws;
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    this.isConnected = false;
  }

  /**
   * Get OpenAPI spec for client generation
   */
  async getOpenAPISpec() {
    const response = await fetch(`${this.cantonApiBase}/docs/openapi`);
    if (!response.ok) {
      throw new Error(`OpenAPI spec fetch failed: ${response.status}`);
    }
    return await response.json();
  }

  /**
   * Get AsyncAPI spec for WebSocket client generation
   */
  async getAsyncAPISpec() {
    const response = await fetch(`${this.cantonApiBase}/docs/asyncapi`);
    if (!response.ok) {
      throw new Error(`AsyncAPI spec fetch failed: ${response.status}`);
    }
    return await response.json();
  }
}

module.exports = CantonLedgerClient;
