/**
 * Matchmaker Bot - Automated Order Matching
 * 
 * This bot continuously scans the MasterOrderBook for matching orders
 * and executes trades using the Splice Allocation execution model.
 * 
 * The bot runs as the Operator (Venue), giving it permission to execute
 * Allocations that were created with the Operator as the provider.
 * 
 * IMPORTANT: Configuration values should be set via environment variables
 * and match backend/src/config/constants.js
 */

import fetch from 'node-fetch';

// Configuration - MUST match backend/src/config/constants.js
// TypeScript module - uses process.env with fallbacks
// Set these env vars or update the constants.js file
const OPERATOR_PARTY_ID = process.env.OPERATOR_PARTY_ID || 
  '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';

const CANTON_JSON_API_BASE = process.env.CANTON_JSON_LEDGER_API_BASE || 
  process.env.CANTON_JSON_API_BASE || 
  'http://65.108.40.104:31539';

const MATCHING_INTERVAL_MS = 5000; // Check every 5 seconds
const MAX_MATCHES_PER_CYCLE = 10; // Limit matches per cycle to avoid overload

// Get admin token (assumes you have a way to get it)
// This should use your existing CantonAdmin service
async function getAdminToken(): Promise<string> {
  const CantonAdmin = require('./canton-admin');
  const cantonAdmin = new CantonAdmin();
  return await cantonAdmin.getAdminToken();
}

/**
 * Get active at offset for queries
 */
async function getActiveAtOffset(adminToken: string, offset?: number): Promise<string> {
  if (offset !== undefined) {
    return offset.toString();
  }
  // Get current ledger end
  try {
    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        activeAtOffset: '0',
        verbose: false,
        filter: {
          filtersForAnyParty: {
            inclusive: {
              templateIds: []
            }
          }
        }
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      // Extract offset from response if available
      return '0'; // Default to current ledger end
    }
  } catch (err) {
    console.warn('[Matchmaker] Error getting active at offset:', err);
  }
  return '0';
}

/**
 * Query MasterOrderBook contracts
 */
async function queryMasterOrderBooks(adminToken: string): Promise<Array<any>> {
  try {
    const activeAtOffset = await getActiveAtOffset(adminToken);
    
    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        activeAtOffset: activeAtOffset,
        verbose: true,
        filter: {
          filtersByParty: {
            [OPERATOR_PARTY_ID]: {
              inclusive: {
                templateIds: ['MasterOrderBook:MasterOrderBook']
              }
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Matchmaker] Error querying MasterOrderBooks:', response.status, errorText);
      return [];
    }

    const data = await response.json();
    const contracts = Array.isArray(data) ? data : (data.activeContracts || []);
    
    // Parse contract data
    const orderBooks = contracts.map((contract: any) => {
      const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                          contract.createdEvent || 
                          contract;
      const createArgs = contractData.createArgument || contractData.argument || {};
      
      return {
        contractId: contractData.contractId,
        templateId: contractData.templateId,
        tradingPair: createArgs.tradingPair,
        buyOrders: createArgs.buyOrders || [],
        sellOrders: createArgs.sellOrders || [],
        operator: createArgs.operator || OPERATOR_PARTY_ID,
        lastPrice: createArgs.lastPrice
      };
    });

    return orderBooks;
  } catch (error: any) {
    console.error('[Matchmaker] Error querying MasterOrderBooks:', error);
    return [];
  }
}

/**
 * Check if two orders can match
 */
function canOrdersMatch(buyOrder: any, sellOrder: any): boolean {
  // Both orders must be OPEN
  if (buyOrder.status !== 'OPEN' || sellOrder.status !== 'OPEN') {
    return false;
  }
  
  // Check price compatibility
  const buyPrice = buyOrder.price;
  const sellPrice = sellOrder.price;
  
  // Market orders can match with anything
  if (!buyPrice || !sellPrice) {
    return true;
  }
  
  // Limit orders: buy price must be >= sell price
  return parseFloat(buyPrice) >= parseFloat(sellPrice);
}

/**
 * Execute MatchOrders choice on MasterOrderBook
 */
async function executeMatchOrders(
  adminToken: string,
  masterOrderBookContractId: string,
  buyOrderCid: string,
  sellOrderCid: string
): Promise<boolean> {
  try {
    const commandId = `match-orders-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/commands/submit-and-wait`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        commandId: commandId,
        commands: [{
          ExerciseCommand: {
            templateId: 'MasterOrderBook:MasterOrderBook',
            contractId: masterOrderBookContractId,
            choice: 'MatchOrders',
            choiceArgument: {
              buyOrderCid: buyOrderCid,
              sellOrderCid: sellOrderCid
            }
          }
        }],
        actAs: [OPERATOR_PARTY_ID]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Matchmaker] Error executing MatchOrders:', response.status, errorText);
      return false;
    }

    const result = await response.json();
    console.log('[Matchmaker] ✅ MatchOrders executed successfully:', {
      updateId: result.updateId,
      completionOffset: result.completionOffset
    });

    // Check if trades were created
    if (result.events && Array.isArray(result.events)) {
      const tradesCreated = result.events.filter((e: any) => 
        e.created?.templateId?.includes('Trade')
      ).length;
      
      if (tradesCreated > 0) {
        console.log(`[Matchmaker] ✅ ${tradesCreated} trade(s) created from match`);
      }
    }

    return true;
  } catch (error: any) {
    console.error('[Matchmaker] Error executing MatchOrders:', error);
    return false;
  }
}

/**
 * Query orders from MasterOrderBook
 */
async function queryOrders(
  adminToken: string,
  orderCids: string[]
): Promise<Array<any>> {
  if (orderCids.length === 0) {
    return [];
  }

  try {
    const activeAtOffset = await getActiveAtOffset(adminToken);
    
    const response = await fetch(`${CANTON_JSON_API_BASE}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        activeAtOffset: activeAtOffset,
        verbose: true,
        filter: {
          filtersForAnyParty: {
            inclusive: {
              contractIds: orderCids
            }
          }
        }
      })
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const contracts = Array.isArray(data) ? data : (data.activeContracts || []);
    
    return contracts.map((contract: any) => {
      const contractData = contract.contractEntry?.JsActiveContract?.createdEvent || 
                          contract.createdEvent || 
                          contract;
      const createArgs = contractData.createArgument || contractData.argument || {};
      
      return {
        contractId: contractData.contractId,
        orderId: createArgs.orderId,
        owner: createArgs.owner,
        orderType: createArgs.orderType,
        orderMode: createArgs.orderMode,
        tradingPair: createArgs.tradingPair,
        price: createArgs.price,
        quantity: createArgs.quantity,
        filled: createArgs.filled || 0,
        status: createArgs.status,
        allocationCid: createArgs.allocationCid
      };
    });
  } catch (error: any) {
    console.error('[Matchmaker] Error querying orders:', error);
    return [];
  }
}

/**
 * Main matching loop
 */
async function matchOrders(): Promise<void> {
  try {
    const adminToken = await getAdminToken();
    
    // Query all MasterOrderBooks
    const orderBooks = await queryMasterOrderBooks(adminToken);
    
    if (orderBooks.length === 0) {
      console.log('[Matchmaker] No MasterOrderBooks found');
      return;
    }

    let totalMatches = 0;

    // Process each order book
    for (const orderBook of orderBooks) {
      if (totalMatches >= MAX_MATCHES_PER_CYCLE) {
        break;
      }

      const { contractId, tradingPair, buyOrders, sellOrders } = orderBook;

      if (buyOrders.length === 0 || sellOrders.length === 0) {
        continue; // No orders to match
      }

      console.log(`[Matchmaker] Processing ${tradingPair}: ${buyOrders.length} buys, ${sellOrders.length} sells`);

      // Query buy and sell orders
      const buyOrderData = await queryOrders(adminToken, buyOrders);
      const sellOrderData = await queryOrders(adminToken, sellOrders);

      // Filter to only OPEN orders
      const activeBuys = buyOrderData.filter((o: any) => o.status === 'OPEN');
      const activeSells = sellOrderData.filter((o: any) => o.status === 'OPEN');

      // Sort by price-time priority
      // Buy orders: highest price first, then earliest timestamp
      activeBuys.sort((a: any, b: any) => {
        const priceA = a.price ? parseFloat(a.price) : Infinity;
        const priceB = b.price ? parseFloat(b.price) : Infinity;
        if (priceA !== priceB) {
          return priceB - priceA; // Higher price first
        }
        return a.timestamp - b.timestamp; // Earlier timestamp first
      });

      // Sell orders: lowest price first, then earliest timestamp
      activeSells.sort((a: any, b: any) => {
        const priceA = a.price ? parseFloat(a.price) : 0;
        const priceB = b.price ? parseFloat(b.price) : 0;
        if (priceA !== priceB) {
          return priceA - priceB; // Lower price first
        }
        return a.timestamp - b.timestamp; // Earlier timestamp first
      });

      // Try to match orders
      for (const buyOrder of activeBuys) {
        if (totalMatches >= MAX_MATCHES_PER_CYCLE) {
          break;
        }

        for (const sellOrder of activeSells) {
          if (totalMatches >= MAX_MATCHES_PER_CYCLE) {
            break;
          }

          if (canOrdersMatch(buyOrder, sellOrder)) {
            console.log(`[Matchmaker] 🎯 Found match: ${buyOrder.orderId} <-> ${sellOrder.orderId}`);
            
            // Execute the match
            const success = await executeMatchOrders(
              adminToken,
              contractId,
              buyOrder.contractId,
              sellOrder.contractId
            );

            if (success) {
              totalMatches++;
              console.log(`[Matchmaker] ✅ Match executed (${totalMatches}/${MAX_MATCHES_PER_CYCLE})`);
              
              // Break to avoid double-matching
              break;
            }
          }
        }
      }
    }

    if (totalMatches > 0) {
      console.log(`[Matchmaker] ✅ Cycle complete: ${totalMatches} match(es) executed`);
    } else {
      console.log('[Matchmaker] No matches found in this cycle');
    }

  } catch (error: any) {
    console.error('[Matchmaker] Error in matching loop:', error);
  }
}

/**
 * Start the matchmaker bot
 */
export function startMatchmaker(): void {
  console.log('[Matchmaker] 🤖 Starting Matchmaker Bot...');
  console.log(`[Matchmaker] Operator Party ID: ${OPERATOR_PARTY_ID}`);
  console.log(`[Matchmaker] Matching interval: ${MATCHING_INTERVAL_MS}ms`);
  console.log(`[Matchmaker] Max matches per cycle: ${MAX_MATCHES_PER_CYCLE}`);

  // Run immediately, then on interval
  matchOrders();
  
  setInterval(() => {
    matchOrders();
  }, MATCHING_INTERVAL_MS);
}

// If running as standalone script
if (require.main === module) {
  startMatchmaker();
}
