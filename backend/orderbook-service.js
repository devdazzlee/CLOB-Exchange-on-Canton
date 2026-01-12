/**
 * Professional OrderBook Management Service
 * Automatically creates OrderBooks when needed (like professional trading platforms)
 * Uses user's OAuth token with actAs/readAs claims (Huzefa's approach)
 */

const CANTON_JSON_API_BASE = process.env.CANTON_JSON_API_BASE || 'http://95.216.34.215:31539';
const API_VERSION = 'v2';

// Default trading pairs that should always exist
const DEFAULT_TRADING_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

// Default operator party ID (used if user doesn't have actAs for specific operator)
const DEFAULT_OPERATOR = '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';

class OrderBookService {
  /**
   * Extract actAs parties from user token (Huzefa approach)
   * User's token already has actAs/readAs claims - we use those
   */
  extractActAsParties(userToken) {
    try {
      const parts = userToken.split('.');
      if (parts.length !== 3) {
        return [DEFAULT_OPERATOR];
      }
      
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      
      // Extract actAs from token claims (Huzefa approach)
      // Token already has actAs claims set by Keycloak
      const ledgerApiClaim = payload['https://daml.com/ledgerapi'] || payload.daml_ledger_api;
      const actAs = ledgerApiClaim?.actAs || payload.actAs || [];
      
      if (Array.isArray(actAs) && actAs.length > 0) {
        console.log('[OrderBookService] Found actAs parties in token:', actAs);
        // Use first actAs party as operator (or use DEFAULT_OPERATOR if it's in the list)
        const operatorParty = actAs.includes(DEFAULT_OPERATOR) ? DEFAULT_OPERATOR : actAs[0];
        return [operatorParty, ...actAs];
      }
      
      // Fallback: Use user's party from sub claim if available
      const userParty = payload.sub;
      if (userParty) {
        console.log('[OrderBookService] Using user party from token sub:', userParty);
        // Reconstruct full party ID if needed (user may have stored it)
        return [userParty, DEFAULT_OPERATOR];
      }
      
      // Final fallback: Use default operator
      console.log('[OrderBookService] Using default operator party');
      return [DEFAULT_OPERATOR];
    } catch (error) {
      console.error('[OrderBookService] Error extracting actAs parties:', error);
      return [DEFAULT_OPERATOR];
    }
  }

  /**
   * Get operator party ID from user token
   * Uses first actAs party or default operator
   */
  getOperatorPartyId(userToken) {
    const actAsParties = this.extractActAsParties(userToken);
    // Prefer DEFAULT_OPERATOR if available, otherwise use first actAs party
    return actAsParties.includes(DEFAULT_OPERATOR) ? DEFAULT_OPERATOR : actAsParties[0];
  }

  /**
   * Check if OrderBook exists for trading pair
   * Uses user's token to query (Huzefa approach)
   */
  async checkOrderBookExists(tradingPair, userToken, partyId) {
    try {
      const requestBody = {
        readAs: [partyId],
        activeAtOffset: "0",
        verbose: false,
        filter: {
          filtersByParty: {
            [partyId]: {
              inclusive: {
                templateIds: ["OrderBook:OrderBook"]
              }
            }
          }
        }
      };

      const response = await fetch(`${CANTON_JSON_API_BASE}/${API_VERSION}/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        console.warn('[OrderBookService] Failed to query OrderBooks:', response.status);
        return false;
      }

      const result = await response.json();
      const contracts = result.result || result.contracts || [];
      
      // Check if OrderBook exists for this trading pair
      const orderBook = contracts.find(contract => {
        const contractData = contract.created || contract;
        return contractData?.arguments?.tradingPair === tradingPair || 
               contractData?.payload?.tradingPair === tradingPair;
      });

      return !!orderBook;
    } catch (error) {
      console.error('[OrderBookService] Error checking OrderBook existence:', error);
      return false;
    }
  }

  /**
   * Create OrderBook automatically (Professional approach - like Hyperliquid, Lighter)
   * Uses user's token with actAs claims (Huzefa approach)
   */
  async createOrderBookAutomatically(tradingPair, userToken, userPartyId) {
    try {
      console.log(`[OrderBookService] 🔄 Automatically creating OrderBook for ${tradingPair}...`);
      
      // Get operator party from user's token actAs claims (Huzefa approach)
      const operatorPartyId = this.getOperatorPartyId(userToken);
      console.log(`[OrderBookService] Using operator party: ${operatorPartyId}`);

      // Qualify template ID (might need package ID)
      let qualifiedTemplateId = 'OrderBook:OrderBook';
      
      // Try to get package ID first (if needed)
      try {
        const packagesResponse = await fetch(`${CANTON_JSON_API_BASE}/${API_VERSION}/packages`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${userToken}`
          }
        });
        
        if (packagesResponse.ok) {
          const packages = await packagesResponse.json();
          if (packages && packages.length > 0) {
            const packageId = packages[0] || packages[packages.length - 1];
            qualifiedTemplateId = `${packageId}:OrderBook:OrderBook`;
            console.log('[OrderBookService] Using qualified template ID:', qualifiedTemplateId);
          }
        }
      } catch (e) {
        console.warn('[OrderBookService] Could not get package ID, using unqualified template ID');
      }

      const payload = {
        tradingPair: tradingPair,
        buyOrders: [],
        sellOrders: [],
        lastPrice: null,
        operator: operatorPartyId,
        activeUsers: [],
        userAccounts: {}
      };

      const commandId = `create-orderbook-${tradingPair}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const requestBody = {
        commands: [
          {
            CreateCommand: {
              templateId: qualifiedTemplateId,
              createArguments: payload
            }
          }
        ],
        commandId: commandId,
        actAs: [operatorPartyId] // Use actAs party from token (Huzefa approach)
      };

      console.log('[OrderBookService] Creating OrderBook with payload:', JSON.stringify(payload, null, 2));

      const response = await fetch(`${CANTON_JSON_API_BASE}/${API_VERSION}/commands/submit-and-wait`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let error;
        try {
          error = JSON.parse(errorText);
        } catch {
          error = { message: errorText || `Failed to create OrderBook: ${response.statusText}` };
        }
        
        console.error('[OrderBookService] Failed to create OrderBook:', error);
        
        // If creation fails due to permissions, that's okay - it might already exist or user doesn't have permissions
        // Return null to indicate creation wasn't successful, but don't throw
        if (response.status === 403 || response.status === 401) {
          console.warn('[OrderBookService] Permission denied - user may not have actAs for operator party');
          return null;
        }
        
        throw new Error(error.message || error.cause || error.errors?.join(', ') || `Failed to create OrderBook: ${response.statusText}`);
      }

      const result = await response.json();
      
      // Extract contract ID from response
      let contractId = null;
      if (result.events && result.events.length > 0) {
        const createdEvent = result.events.find(e => e.created);
        if (createdEvent && createdEvent.created) {
          contractId = createdEvent.created.contractId;
        }
      }

      if (contractId) {
        console.log(`[OrderBookService] ✅ Successfully created OrderBook for ${tradingPair}`);
        console.log(`[OrderBookService] Contract ID: ${contractId}`);
        return {
          success: true,
          contractId: contractId,
          tradingPair: tradingPair,
          operator: operatorPartyId
        };
      } else {
        console.warn('[OrderBookService] ⚠️ OrderBook created but contract ID not found in response');
        console.warn('[OrderBookService] Full response:', JSON.stringify(result, null, 2));
        return {
          success: true, // Assume success even if we can't extract contract ID
          contractId: null,
          tradingPair: tradingPair,
          operator: operatorPartyId
        };
      }
    } catch (error) {
      console.error(`[OrderBookService] ❌ Error creating OrderBook for ${tradingPair}:`, error.message);
      return {
        success: false,
        error: error.message,
        tradingPair: tradingPair
      };
    }
  }

  /**
   * Ensure OrderBook exists - create if not (Professional approach)
   * Automatically called when needed (like professional trading platforms)
   */
  async ensureOrderBookExists(tradingPair, userToken, userPartyId) {
    try {
      // First check if OrderBook already exists
      const exists = await this.checkOrderBookExists(tradingPair, userToken, userPartyId);
      
      if (exists) {
        console.log(`[OrderBookService] ✅ OrderBook for ${tradingPair} already exists`);
        return { exists: true, created: false };
      }

      // OrderBook doesn't exist - create it automatically (Professional approach)
      console.log(`[OrderBookService] 🔄 OrderBook for ${tradingPair} not found - creating automatically...`);
      const result = await this.createOrderBookAutomatically(tradingPair, userToken, userPartyId);
      
      if (result && result.success) {
        console.log(`[OrderBookService] ✅ OrderBook for ${tradingPair} created successfully`);
        return { exists: true, created: true, contractId: result.contractId };
      } else {
        console.warn(`[OrderBookService] ⚠️ Could not create OrderBook for ${tradingPair}`);
        return { exists: false, created: false, error: result?.error };
      }
    } catch (error) {
      console.error(`[OrderBookService] Error ensuring OrderBook exists for ${tradingPair}:`, error);
      return { exists: false, created: false, error: error.message };
    }
  }

  /**
   * Initialize default OrderBooks on startup (Professional approach)
   * Automatically ensures all default trading pairs have OrderBooks
   */
  async initializeDefaultOrderBooks(userToken, userPartyId) {
    console.log('[OrderBookService] 🌱 Initializing default OrderBooks (Professional approach)...');
    const results = [];
    
    for (const pair of DEFAULT_TRADING_PAIRS) {
      try {
        const result = await this.ensureOrderBookExists(pair, userToken, userPartyId);
        results.push({ pair, ...result });
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`[OrderBookService] Error initializing OrderBook for ${pair}:`, error);
        results.push({ pair, exists: false, created: false, error: error.message });
      }
    }

    const created = results.filter(r => r.created).length;
    const existing = results.filter(r => r.exists && !r.created).length;
    
    console.log(`[OrderBookService] ✅ OrderBook initialization complete:`);
    console.log(`[OrderBookService]   - Created: ${created}`);
    console.log(`[OrderBookService]   - Already existed: ${existing}`);
    console.log(`[OrderBookService]   - Failed: ${results.length - created - existing}`);
    
    return results;
  }
}

module.exports = OrderBookService;

