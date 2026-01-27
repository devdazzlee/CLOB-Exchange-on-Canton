/**
 * Helper functions for Canton API interactions
 */
const config = require('../config');
const cantonService = require('./cantonService');

async function getOrderBookTemplateId(adminToken) {
  let packageId = config.canton.packageIds?.clobExchange;
  if (!packageId && adminToken) {
    try {
      packageId = await cantonService.getPackageIdForTemplate('OrderBook', adminToken);
    } catch (error) {
      // Fall through to error below if discovery fails
    }
  }
  if (!packageId) {
    throw new Error('Missing package ID for OrderBook template');
  }
  return `${packageId}:OrderBook:OrderBook`;
}

/**
 * Get OrderBook contract ID for a trading pair
 * ROOT CAUSE FIX: Try multiple query methods to find OrderBook with enhanced retry logic
 */
async function getOrderBookContractId(tradingPair, adminToken, cantonApiBase) {
  const operatorPartyId = config.canton.operatorPartyId;
  const orderBookTemplateId = await getOrderBookTemplateId(adminToken);
  let activeAtOffset = "0";
  try {
    activeAtOffset = await cantonService.getActiveAtOffset(adminToken);
  } catch (error) {
    // Fallback to "0" if ledger end is unavailable
  }
  
  // Try multiple approaches with better error handling
  const attempts = [
    {
      name: 'filtersByParty with readAs',
      query: () => fetch(`${cantonApiBase}/v2/state/active-contracts?limit=50`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          readAs: [operatorPartyId],
          activeAtOffset: activeAtOffset,
          verbose: true,
          filter: {
            filtersByParty: {
              [operatorPartyId]: {
                inclusive: {
                  templateIds: [orderBookTemplateId]
                }
              }
            }
          }
        })
      })
    },
    {
      name: 'filtersForAnyParty',
      query: () => fetch(`${cantonApiBase}/v2/state/active-contracts?limit=50`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          activeAtOffset: activeAtOffset,
          verbose: true,
          filter: {
            filtersForAnyParty: {
              inclusive: {
                templateIds: [orderBookTemplateId]
              }
            }
          }
        })
      })
    },
    {
      name: 'No filter - just OrderBook template',
      query: () => fetch(`${cantonApiBase}/v2/state/active-contracts?limit=50`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          activeAtOffset: activeAtOffset,
          verbose: true,
          filter: {
            filtersForAnyParty: {
              inclusive: {
                templateIds: [orderBookTemplateId]
              }
            }
          }
        })
      })
    }
  ];

  for (const attempt of attempts) {
    try {
      console.log(`[getOrderBookContractId] Trying ${attempt.name} for ${tradingPair}`);
      const response = await attempt.query();
      
      if (response.ok) {
        const data = await response.json();
        const orderBooks = data.activeContracts || [];
        
        console.log(`[getOrderBookContractId] ${attempt.name} returned ${orderBooks.length} contracts`);
        
        // More flexible matching for trading pair
        const orderBook = orderBooks.find(ob => {
          const contractData = ob.contractEntry?.JsActiveContract?.createdEvent || ob.createdEvent || ob;
          const pair = contractData.createArgument?.tradingPair || contractData.argument?.tradingPair;
          return pair === tradingPair;
        });
        
        if (orderBook) {
          const contractData = orderBook.contractEntry?.JsActiveContract?.createdEvent || orderBook.createdEvent || orderBook;
          console.log(`[getOrderBookContractId] ✅ Found OrderBook using ${attempt.name}: ${contractData.contractId.substring(0, 30)}...`);
          return contractData.contractId;
        } else {
          console.log(`[getOrderBookContractId] No matching OrderBook found with ${attempt.name}`);
        }
      } else {
        const errorText = await response.text();
        console.warn(`[getOrderBookContractId] ${attempt.name} failed: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.warn(`[getOrderBookContractId] ${attempt.name} error:`, error.message);
    }
  }
  
  console.warn(`[getOrderBookContractId] ❌ OrderBook not found for ${tradingPair} after all attempts`);
  return null;
}

/**
 * Broadcast order book update via WebSocket
 */
function broadcastOrderBookUpdate(tradingPair, orderBookData) {
  if (global.broadcastWebSocket) {
    global.broadcastWebSocket(`orderbook:${tradingPair}`, {
      tradingPair,
      buyOrders: orderBookData.buyOrders || [],
      sellOrders: orderBookData.sellOrders || [],
      lastPrice: orderBookData.lastPrice,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Broadcast trade update via WebSocket
 */
function broadcastTradeUpdate(tradingPair, tradeData) {
  if (global.broadcastWebSocket) {
    global.broadcastWebSocket(`trades:${tradingPair}`, {
      tradingPair,
      ...tradeData,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = {
  getOrderBookContractId,
  broadcastOrderBookUpdate,
  broadcastTradeUpdate
};
