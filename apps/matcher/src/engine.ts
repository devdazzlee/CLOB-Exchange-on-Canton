/**
 * Matching Engine
 * Implements price-time priority matching with self-trade prevention
 */

import { OrderBook, Order } from './orderbook';

export interface Trade {
  tradeId: string;
  buyer: string;
  seller: string;
  marketId: string;
  price: number;
  quantity: number;
  buyOrderId: string;
  sellOrderId: string;
  timestamp: Date;
}

export class MatchingEngine {
  /**
   * Try to match orders
   * Returns array of trades if matches found
   */
  matchOrders(buyOrder: Order, sellOrder: Order): Trade[] {
    const trades: Trade[] = [];

    // Self-trade prevention
    if (buyOrder.party === sellOrder.party) {
      return trades;
    }

    // Check if orders can match
    if (buyOrder.price < sellOrder.price) {
      return trades; // No match
    }

    // Determine trade price (use limit order price if available)
    const tradePrice = buyOrder.price; // Or use mid-price: (buyOrder.price + sellOrder.price) / 2

    // Determine trade quantity
    const tradeQuantity = Math.min(buyOrder.remainingQty, sellOrder.remainingQty);

    // Create trade
    const trade: Trade = {
      tradeId: `${buyOrder.orderId}-${sellOrder.orderId}-${Date.now()}`,
      buyer: buyOrder.party,
      seller: sellOrder.party,
      marketId: buyOrder.marketId,
      price: tradePrice,
      quantity: tradeQuantity,
      buyOrderId: buyOrder.orderId,
      sellOrderId: sellOrder.orderId,
      timestamp: new Date(),
    };

    trades.push(trade);

    // Update remaining quantities
    buyOrder.remainingQty -= tradeQuantity;
    sellOrder.remainingQty -= tradeQuantity;

    // Update status
    const buyFilled = buyOrder.remainingQty <= 0;
    const sellFilled = sellOrder.remainingQty <= 0;
    
    if (buyFilled) {
      buyOrder.status = 'FILLED';
    } else {
      buyOrder.status = 'PARTIALLY_FILLED';
    }

    if (sellFilled) {
      sellOrder.status = 'FILLED';
    } else {
      sellOrder.status = 'PARTIALLY_FILLED';
    }

    // If orders are still open and can match again, try again
    if (!buyFilled && !sellFilled) {
      if (buyOrder.price >= sellOrder.price) {
        // Try to match again (recursive, but with updated quantities)
        const moreTrades = this.matchOrders(buyOrder, sellOrder);
        trades.push(...moreTrades);
      }
    }

    return trades;
  }

  /**
   * Match order book (continuous matching)
   */
  matchOrderBook(orderBook: OrderBook): Trade[] {
    const trades: Trade[] = [];
    let matched = true;

    while (matched) {
      matched = false;
      const bestBid = orderBook.getBestBid();
      const bestAsk = orderBook.getBestAsk();

      if (bestBid && bestAsk && bestBid.price >= bestAsk.price) {
        const newTrades = this.matchOrders(bestBid, bestAsk);
        if (newTrades.length > 0) {
          trades.push(...newTrades);
          matched = true;

          // Update order book
          if (bestBid.status === 'FILLED') {
            orderBook.removeOrder(bestBid.orderId);
          } else {
            orderBook.updateOrder(bestBid.orderId, bestBid);
          }

          if (bestAsk.status === 'FILLED') {
            orderBook.removeOrder(bestAsk.orderId);
          } else {
            orderBook.updateOrder(bestAsk.orderId, bestAsk);
          }
        }
      }
    }

    return trades;
  }
}
