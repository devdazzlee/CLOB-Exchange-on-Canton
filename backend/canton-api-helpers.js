/**
 * Helper functions for Canton API interactions
 */

/**
 * Get OrderBook contract ID for a trading pair
 * ROOT CAUSE FIX: Try multiple query methods to find OrderBook
 */
async function getOrderBookContractId(tradingPair, adminToken, cantonApiBase) {
  const operatorPartyId = process.env.OPERATOR_PARTY_ID || 
    '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292';
  
  // Method 1: Try filtersForAnyParty (doesn't require specific party permissions)
  try {
    console.log(`[getOrderBookContractId] Trying filtersForAnyParty for ${tradingPair}`);
    const response = await fetch(`${cantonApiBase}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        activeAtOffset: "0",
        filter: {
          filtersForAnyParty: {
            inclusive: {
              templateIds: ['OrderBook:OrderBook']
            }
          }
        }
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const orderBooks = data.activeContracts || [];
      
      const orderBook = orderBooks.find(ob => {
        const contractData = ob.contractEntry?.JsActiveContract?.createdEvent || ob.createdEvent || ob;
        return contractData.createArgument?.tradingPair === tradingPair || contractData.argument?.tradingPair === tradingPair;
      });
      
      if (orderBook) {
        const contractData = orderBook.contractEntry?.JsActiveContract?.createdEvent || orderBook.createdEvent || orderBook;
        console.log(`[getOrderBookContractId] Found OrderBook using filtersForAnyParty: ${contractData.contractId.substring(0, 30)}...`);
        return contractData.contractId;
      }
    } else {
      console.warn(`[getOrderBookContractId] filtersForAnyParty failed: ${response.status}`);
    }
  } catch (error) {
    console.warn('[getOrderBookContractId] filtersForAnyParty error:', error.message);
  }
  
  // Method 2: Try filtersByParty with readAs
  try {
    console.log(`[getOrderBookContractId] Trying filtersByParty with readAs for ${tradingPair}`);
    const response = await fetch(`${cantonApiBase}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        readAs: [operatorPartyId],
        activeAtOffset: "0",
        filter: {
          filtersByParty: {
            [operatorPartyId]: {
              inclusive: {
                templateIds: ['OrderBook:OrderBook']
              }
            }
          }
        }
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const orderBooks = data.activeContracts || [];
      
      const orderBook = orderBooks.find(ob => {
        const contractData = ob.contractEntry?.JsActiveContract?.createdEvent || ob.createdEvent || ob;
        return contractData.createArgument?.tradingPair === tradingPair || contractData.argument?.tradingPair === tradingPair;
      });
      
      if (orderBook) {
        const contractData = orderBook.contractEntry?.JsActiveContract?.createdEvent || orderBook.createdEvent || orderBook;
        console.log(`[getOrderBookContractId] Found OrderBook using filtersByParty: ${contractData.contractId.substring(0, 30)}...`);
        return contractData.contractId;
      }
    } else {
      console.warn(`[getOrderBookContractId] filtersByParty failed: ${response.status}`);
    }
  } catch (error) {
    console.warn('[getOrderBookContractId] filtersByParty error:', error.message);
  }
  
  console.warn(`[getOrderBookContractId] OrderBook not found for ${tradingPair}`);
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

