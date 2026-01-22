/**
 * Order Book
 * Maintains in-memory order book per market
 */

export interface Order {
  orderId: string;
  party: string;
  marketId: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  remainingQty: number;
  createdAt: Date;
  status: 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED';
}

export class OrderBook {
  private buyOrders: Order[] = [];
  private sellOrders: Order[] = [];
  private marketId: string;

  constructor(marketId: string) {
    this.marketId = marketId;
  }

  /**
   * Add order to book
   */
  addOrder(order: Order): void {
    if (order.side === 'BUY') {
      this.buyOrders.push(order);
      this.sortBuyOrders();
    } else {
      this.sellOrders.push(order);
      this.sortSellOrders();
    }
  }

  /**
   * Remove order from book
   */
  removeOrder(orderId: string): void {
    this.buyOrders = this.buyOrders.filter((o) => o.orderId !== orderId);
    this.sellOrders = this.sellOrders.filter((o) => o.orderId !== orderId);
  }

  /**
   * Update order (e.g., after partial fill)
   */
  updateOrder(orderId: string, updates: Partial<Order>): void {
    const updateInList = (orders: Order[]) => {
      const index = orders.findIndex((o) => o.orderId === orderId);
      if (index !== -1) {
        orders[index] = { ...orders[index], ...updates };
        return true;
      }
      return false;
    };

    if (!updateInList(this.buyOrders)) {
      updateInList(this.sellOrders);
    }
  }

  /**
   * Get best bid (highest buy price)
   */
  getBestBid(): Order | null {
    return this.buyOrders.length > 0 ? this.buyOrders[0] : null;
  }

  /**
   * Get best ask (lowest sell price)
   */
  getBestAsk(): Order | null {
    return this.sellOrders.length > 0 ? this.sellOrders[0] : null;
  }

  /**
   * Get spread
   */
  getSpread(): number | null {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (bid && ask) {
      return ask.price - bid.price;
    }
    return null;
  }

  /**
   * Get all buy orders (sorted)
   */
  getBuyOrders(): Order[] {
    return [...this.buyOrders];
  }

  /**
   * Get all sell orders (sorted)
   */
  getSellOrders(): Order[] {
    return [...this.sellOrders];
  }

  /**
   * Sort buy orders: highest price first, then earliest timestamp (FIFO)
   */
  private sortBuyOrders(): void {
    this.buyOrders.sort((a, b) => {
      if (a.price !== b.price) {
        return b.price - a.price; // Higher price first
      }
      return a.createdAt.getTime() - b.createdAt.getTime(); // Earlier first
    });
  }

  /**
   * Sort sell orders: lowest price first, then earliest timestamp (FIFO)
   */
  private sortSellOrders(): void {
    this.sellOrders.sort((a, b) => {
      if (a.price !== b.price) {
        return a.price - b.price; // Lower price first
      }
      return a.createdAt.getTime() - b.createdAt.getTime(); // Earlier first
    });
  }
}
