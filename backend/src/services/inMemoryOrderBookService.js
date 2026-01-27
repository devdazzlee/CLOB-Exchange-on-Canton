/**
 * In-Memory OrderBook Service
 * Temporary solution to bypass DAML ledger issues
 */

class InMemoryOrderBookService {
  constructor() {
    this.orderBooks = new Map(); // tradingPair -> OrderBook data
    this.trades = new Map(); // tradingPair -> trades array
    this.orders = new Map(); // orderId -> Order data
  }

  createOrderBook(tradingPair, operatorPartyId) {
    console.log(`[InMemoryOrderBook] Creating OrderBook for ${tradingPair}`);
    
    if (this.orderBooks.has(tradingPair)) {
      return {
        success: false,
        error: `OrderBook already exists for ${tradingPair}`,
        data: null
      };
    }

    const orderBook = {
      contractId: `in-memory-${tradingPair}-${Date.now()}`,
      tradingPair,
      buyOrders: [],
      sellOrders: [],
      lastPrice: null,
      operator: operatorPartyId,
      activeUsers: [operatorPartyId],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.orderBooks.set(tradingPair, orderBook);
    
    console.log(`[InMemoryOrderBook] ✅ Created OrderBook: ${orderBook.contractId}`);
    
    return {
      success: true,
      message: 'OrderBook created successfully',
      data: {
        contractId: orderBook.contractId,
        masterOrderBookContractId: null,
        tradingPair: tradingPair
      }
    };
  }

  getOrderBookContractId(tradingPair) {
    const orderBook = this.orderBooks.get(tradingPair);
    return orderBook ? orderBook.contractId : null;
  }

  addOrder(orderData) {
    const { tradingPair, orderId, owner, orderType, price, quantity } = orderData;
    
    if (!this.orderBooks.has(tradingPair)) {
      return { success: false, error: `OrderBook not found for ${tradingPair}` };
    }

    const orderBook = this.orderBooks.get(tradingPair);
    const order = {
      orderId,
      owner,
      orderType,
      orderMode: 'LIMIT',
      price: price ? parseFloat(price) : null,
      quantity: parseFloat(quantity),
      filled: 0,
      status: 'OPEN',
      timestamp: new Date().toISOString(),
      operator: orderBook.operator
    };

    if (orderType === 'BUY') {
      orderBook.buyOrders.push(order);
    } else {
      orderBook.sellOrders.push(order);
    }

    this.orders.set(orderId, order);
    orderBook.updatedAt = new Date().toISOString();
    
    console.log(`[InMemoryOrderBook] Added order ${orderId} to ${tradingPair}`);
    
    // Try to match orders
    this.matchOrders(tradingPair);
    
    return { success: true, data: order };
  }

  matchOrders(tradingPair) {
    const orderBook = this.orderBooks.get(tradingPair);
    if (!orderBook) return;

    // Sort orders
    const sortedBuys = orderBook.buyOrders.sort((a, b) => {
      if (a.price === null && b.price === null) return 0;
      if (a.price === null) return -1;
      if (b.price === null) return 1;
      if (a.price > b.price) return -1;
      if (a.price < b.price) return 1;
      return 0;
    });

    const sortedSells = orderBook.sellOrders.sort((a, b) => {
      if (a.price === null && b.price === null) return 0;
      if (a.price === null) return 1;
      if (b.price === null) return -1;
      if (a.price < b.price) return -1;
      if (a.price > b.price) return 1;
      return 0;
    });

    // Match orders
    while (sortedBuys.length > 0 && sortedSells.length > 0) {
      const buyOrder = sortedBuys[0];
      const sellOrder = sortedSells[0];

      if (this.canMatch(buyOrder, sellOrder)) {
        const tradeQuantity = Math.min(
          buyOrder.quantity - buyOrder.filled,
          sellOrder.quantity - sellOrder.filled
        );

        if (tradeQuantity > 0) {
          const tradePrice = this.determineTradePrice(buyOrder, sellOrder);
          
          // Update orders
          buyOrder.filled += tradeQuantity;
          sellOrder.filled += tradeQuantity;

          if (buyOrder.filled >= buyOrder.quantity) {
            buyOrder.status = 'FILLED';
            orderBook.buyOrders.shift();
          }

          if (sellOrder.filled >= sellOrder.quantity) {
            sellOrder.status = 'FILLED';
            orderBook.sellOrders.shift();
          }

          // Create trade record
          const trade = {
            tradeId: `${buyOrder.orderId}-${sellOrder.orderId}-${Date.now()}`,
            buyer: buyOrder.owner,
            seller: sellOrder.owner,
            tradingPair,
            price: tradePrice,
            quantity: tradeQuantity,
            timestamp: new Date().toISOString(),
            buyOrderId: buyOrder.orderId,
            sellOrderId: sellOrder.orderId
          };

          if (!this.trades.has(tradingPair)) {
            this.trades.set(tradingPair, []);
          }
          this.trades.get(tradingPair).push(trade);

          // Update last price
          orderBook.lastPrice = tradePrice;
          orderBook.updatedAt = new Date().toISOString();

          console.log(`[InMemoryOrderBook] ✅ Trade executed: ${tradeQuantity} ${tradingPair} at ${tradePrice}`);
        } else {
          break; // No more matching possible
        }
      } else {
        break; // No more matching possible
      }
    }

    // Remove filled orders
    orderBook.buyOrders = orderBook.buyOrders.filter(order => order.status === 'OPEN');
    orderBook.sellOrders = orderBook.sellOrders.filter(order => order.status === 'OPEN');
  }

  canMatch(buyOrder, sellOrder) {
    if (buyOrder.owner === sellOrder.owner) return false; // No self-trading
    
    if (buyOrder.price === null || sellOrder.price === null) return true; // Market orders match anything
    
    return buyOrder.price >= sellOrder.price; // Limit orders must have cross price
  }

  determineTradePrice(buyOrder, sellOrder) {
    if (buyOrder.price === null) return sellOrder.price || 0;
    if (sellOrder.price === null) return buyOrder.price;
    return (buyOrder.price + sellOrder.price) / 2;
  }

  getTrades(tradingPair, limit = 50) {
    const trades = this.trades.get(tradingPair) || [];
    return trades.slice(-limit).reverse(); // Most recent first
  }

  getOrderBook(tradingPair) {
    return this.orderBooks.get(tradingPair) || null;
  }

  // Get order book with current orders
  getOrderBookWithOrders(tradingPair) {
    const orderBook = this.orderBooks.get(tradingPair);
    if (!orderBook) return null;

    return {
      ...orderBook,
      buyOrders: orderBook.buyOrders.map(order => ({
        ...order,
        remainingQuantity: order.quantity - order.filled
      })),
      sellOrders: orderBook.sellOrders.map(order => ({
        ...order,
        remainingQuantity: order.quantity - order.filled
      }))
    };
  }
}

module.exports = InMemoryOrderBookService;
