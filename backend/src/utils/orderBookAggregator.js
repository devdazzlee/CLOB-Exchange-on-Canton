/**
 * Order Book Aggregator
 * Aggregates orders by price level for professional exchange UI
 * Milestone 3: Professional Exchange UI requirement
 */

/**
 * Aggregate orders into price levels
 * Groups orders at the same price and sums their quantities
 * 
 * @param {Array} orders - Array of order objects with price and quantity
 * @param {Object} options - Aggregation options
 * @returns {Array} Aggregated price levels
 */
function aggregatePriceLevels(orders, options = {}) {
  const {
    precision = 2, // Price precision for grouping
    minQuantity = 0, // Minimum quantity to include
  } = options;

  const levels = new Map();

  for (const order of orders) {
    if (!order.price || order.price === null || order.price === undefined) {
      continue; // Skip market orders
    }

    // Round price to specified precision for grouping
    const price = parseFloat(order.price);
    const roundedPrice = Math.round(price * Math.pow(10, precision)) / Math.pow(10, precision);
    const priceKey = roundedPrice.toFixed(precision);

    // Get remaining quantity
    const quantity = parseFloat(order.remaining || order.quantity || 0);

    if (quantity < minQuantity) {
      continue; // Skip orders below minimum quantity
    }

    const existing = levels.get(priceKey) || {
      price: priceKey,
      quantity: 0,
      count: 0,
      orders: []
    };

    existing.quantity += quantity;
    existing.count += 1;
    existing.orders.push(order);

    levels.set(priceKey, existing);
  }

  // Convert to array and format
  return Array.from(levels.values())
    .map(level => ({
      price: level.price,
      quantity: level.quantity.toFixed(8),
      remaining: level.quantity.toFixed(8), // Alias for frontend compatibility
      count: level.count,
      // Keep original orders for reference if needed
      _orders: level.orders
    }))
    .sort((a, b) => parseFloat(b.price) - parseFloat(a.price)); // Highest price first for bids
}

/**
 * Aggregate buy orders (bids) - highest price first
 */
function aggregateBids(orders, options = {}) {
  return aggregatePriceLevels(orders, options);
}

/**
 * Aggregate sell orders (asks) - lowest price first
 */
function aggregateAsks(orders, options = {}) {
  const aggregated = aggregatePriceLevels(orders, options);
  return aggregated.reverse(); // Lowest price first for asks
}

/**
 * Calculate cumulative depth for visualization
 * Used for depth chart rendering
 */
function calculateCumulativeDepth(levels, isBids = true) {
  let cumulative = 0;
  const result = [];

  const sortedLevels = isBids
    ? [...levels].sort((a, b) => parseFloat(b.price) - parseFloat(a.price)) // Highest first
    : [...levels].sort((a, b) => parseFloat(a.price) - parseFloat(b.price)); // Lowest first

  for (const level of sortedLevels) {
    cumulative += parseFloat(level.quantity);
    result.push({
      ...level,
      cumulative: cumulative,
      depth: parseFloat(level.quantity)
    });
  }

  return result;
}

/**
 * Calculate spread between best bid and best ask
 */
function calculateSpread(bids, asks) {
  if (!bids || bids.length === 0 || !asks || asks.length === 0) {
    return {
      spread: 0,
      spreadPercent: 0,
      bestBid: 0,
      bestAsk: 0
    };
  }

  const bestBid = parseFloat(bids[0]?.price || 0);
  const bestAsk = parseFloat(asks[0]?.price || 0);

  if (bestBid === 0 || bestAsk === 0) {
    return {
      spread: 0,
      spreadPercent: 0,
      bestBid,
      bestAsk
    };
  }

  const spread = bestAsk - bestBid;
  const spreadPercent = (spread / bestBid) * 100;

  return {
    spread,
    spreadPercent,
    bestBid,
    bestAsk
  };
}

/**
 * Format order book with aggregated levels
 * Main entry point for order book aggregation
 */
function formatOrderBook(orderBook, options = {}) {
  const {
    aggregate = true,
    precision = 2,
    depth = 50, // Maximum number of levels to return
  } = options;

  let bids = orderBook.buyOrders || orderBook.buys || orderBook.bids || [];
  let asks = orderBook.sellOrders || orderBook.sells || orderBook.asks || [];

  if (aggregate) {
    bids = aggregateBids(bids, { precision, minQuantity: 0 });
    asks = aggregateAsks(asks, { precision, minQuantity: 0 });
  }

  // Limit depth
  bids = bids.slice(0, depth);
  asks = asks.slice(0, depth);

  // Calculate spread
  const spread = calculateSpread(bids, asks);

  // Calculate cumulative depth
  const bidsWithDepth = calculateCumulativeDepth(bids, true);
  const asksWithDepth = calculateCumulativeDepth(asks, false);

  // Convert aggregated levels back to order format for backward compatibility
  const buyOrders = bidsWithDepth.map(level => ({
    price: level.price,
    quantity: level.quantity,
    remaining: level.quantity,
    cumulative: level.cumulative,
    depth: level.depth,
    count: level.count || 1
  }));

  const sellOrders = asksWithDepth.map(level => ({
    price: level.price,
    quantity: level.quantity,
    remaining: level.quantity,
    cumulative: level.cumulative,
    depth: level.depth,
    count: level.count || 1
  }));

  return {
    tradingPair: orderBook.tradingPair || orderBook.pair,
    bids: bidsWithDepth,
    asks: asksWithDepth,
    spread: spread.spread,
    spreadPercent: spread.spreadPercent,
    bestBid: spread.bestBid,
    bestAsk: spread.bestAsk,
    lastPrice: orderBook.lastPrice,
    timestamp: orderBook.timestamp || new Date().toISOString(),
    // Keep original format for backward compatibility
    buyOrders: buyOrders,
    sellOrders: sellOrders,
    buys: buyOrders, // Additional alias
    sells: sellOrders // Additional alias
  };
}

module.exports = {
  aggregatePriceLevels,
  aggregateBids,
  aggregateAsks,
  calculateCumulativeDepth,
  calculateSpread,
  formatOrderBook
};
