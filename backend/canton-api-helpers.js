/**
 * Helper functions for Canton API interactions
 */

/**
 * Get OrderBook contract ID for a trading pair
 */
async function getOrderBookContractId(tradingPair, adminToken, cantonApiBase) {
  try {
    const response = await fetch(`${cantonApiBase}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        readAs: [process.env.OPERATOR_PARTY_ID || '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292'],
        activeAtOffset: "0",
        filter: {
          filtersByParty: {
            [process.env.OPERATOR_PARTY_ID || '8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292']: {
              inclusive: {
                templateIds: ['OrderBook:OrderBook']
              }
            }
          }
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to query OrderBooks: ${response.statusText}`);
    }
    
    const data = await response.json();
    const orderBooks = data.activeContracts || [];
    
    const orderBook = orderBooks.find(ob => {
      const contractData = ob.contractEntry?.JsActiveContract?.createdEvent || ob.createdEvent || ob;
      return contractData.createArgument?.tradingPair === tradingPair;
    });
    
    if (orderBook) {
      const contractData = orderBook.contractEntry?.JsActiveContract?.createdEvent || orderBook.createdEvent || orderBook;
      return contractData.contractId;
    }
    
    return null;
  } catch (error) {
    console.error('[getOrderBookContractId] Error:', error);
    throw error;
  }
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

