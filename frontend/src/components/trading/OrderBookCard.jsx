import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, RefreshCw, Loader2, Globe, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { OPERATOR_PARTY_ID } from '../../config/authConfig';

/**
 * OrderBookCard - Displays the GLOBAL order book
 * 
 * IMPORTANT: Users do NOT create order books.
 * The order book is owned by the Operator (venue) and is shared by all users.
 * This component shows the global market state, like Hyperliquid or other pro exchanges.
 */
export default function OrderBookCard({ 
  tradingPair, 
  orderBook, 
  loading, 
  onRefresh,
  userOrders = [],
  // DEPRECATED: These props are no longer used in Global OrderBook model
  onCreateOrderBook, 
  creatingOrderBook 
}) {
  const isEmpty = orderBook.buys.length === 0 && orderBook.sells.length === 0;
  const isConnectedToGlobalMarket = true; // Always connected to global market

  // Build a map of user's orders by price+side for quick lookup
  // Key: "BUY|<roundedPrice>" or "SELL|<roundedPrice>"  Value: { count, totalQty }
  // Uses multiple precision levels (2..8) so we match regardless of aggregation rounding
  const myOrdersByPrice = useMemo(() => {
    const map = {};
    for (const o of userOrders) {
      if (o.status !== 'OPEN' || o.tradingPair !== tradingPair) continue;
      const side = (o.type || '').toUpperCase();
      const p = parseFloat(o.price || 0);
      if (!p) continue;
      const remaining = parseFloat(o.quantity || 0) - parseFloat(o.filled || 0);
      // Index at multiple precisions so we match the aggregated price string
      for (let prec = 0; prec <= 8; prec++) {
        const key = `${side}|${p.toFixed(prec)}`;
        if (!map[key]) map[key] = { count: 0, totalQty: 0 };
        map[key].count += 1;
        map[key].totalQty += remaining;
      }
    }
    return map;
  }, [userOrders, tradingPair]);

  const getMyInfo = (price, side) => {
    // The aggregated order book price comes as a string like "0.10" or "51000.00"
    const priceStr = String(price);
    const key = `${side}|${priceStr}`;
    return myOrdersByPrice[key] || null;
  };

  // Calculate cumulative depth for visualization
  const calculateDepth = (orders) => {
    let cumulative = 0;
    return orders
      .filter(order => order.price !== null && order.price !== undefined)
      .map(order => {
        const qty = parseFloat(order.remaining || order.quantity || 0);
        cumulative += qty;
        return { ...order, cumulative, depth: qty };
      });
  };

  // Sort buy orders: highest price first (best bid at top)
  const sortedBuys = [...orderBook.buys].sort((a, b) => parseFloat(b.price || 0) - parseFloat(a.price || 0));
  // Sort sell orders: lowest price first (best ask at top)  
  const sortedSells = [...orderBook.sells].sort((a, b) => parseFloat(a.price || 0) - parseFloat(b.price || 0));
  
  const buyOrdersWithDepth = calculateDepth(sortedBuys);
  const sellOrdersWithDepth = calculateDepth(sortedSells);
  
  const maxDepth = Math.max(
    buyOrdersWithDepth.length > 0 ? buyOrdersWithDepth[buyOrdersWithDepth.length - 1]?.cumulative || 0 : 0,
    sellOrdersWithDepth.length > 0 ? sellOrdersWithDepth[sellOrdersWithDepth.length - 1]?.cumulative || 0 : 0
  );

  // Calculate spread
  const bestBid = buyOrdersWithDepth.length > 0 ? parseFloat(buyOrdersWithDepth[0]?.price || 0) : 0;
  const bestAsk = sellOrdersWithDepth.length > 0 ? parseFloat(sellOrdersWithDepth[0]?.price || 0) : 0;
  const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;
  const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Order Book - {tradingPair}</CardTitle>
            {/* Global Market Indicator */}
            {isConnectedToGlobalMarket && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-success/10 border border-success/20 rounded-full">
                <Globe className="w-3 h-3 text-success" />
                <span className="text-xs font-medium text-success">Global Market</span>
              </div>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {/* Connected Status */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3 h-3 text-success" />
              <span>Connected</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              disabled={loading}
              className="h-8 w-8"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground text-sm font-medium">Loading order book data...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Spread Indicator */}
            {bestBid > 0 && bestAsk > 0 && (
              <div className="flex items-center justify-between p-3 bg-card border border-border rounded-lg">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Spread</div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-foreground">
                    {spread.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ({spreadPercent.toFixed(2)}%)
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Sell Orders (Red - Top) */}
              <div>
                <h4 className="text-sm font-semibold text-destructive mb-3 uppercase tracking-wide flex items-center">
                  <TrendingDown className="w-4 h-4 mr-2" />
                  Sell Orders
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full relative">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Price</th>
                        <th className="text-right py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quantity</th>
                        <th className="text-right py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                        <th className="w-8 py-3 px-1 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">My</th>
                      </tr>
                    </thead>
                    <tbody>
                      <AnimatePresence>
                        {sellOrdersWithDepth.length > 0 ? (
                          sellOrdersWithDepth.map((order, i) => {
                            const depthPercent = maxDepth > 0 ? (order.cumulative / maxDepth) * 100 : 0;
                            const myInfo = getMyInfo(order.price, 'SELL');
                            return (
                              <motion.tr
                                key={i}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0 }}
                                className={`border-b border-border/50 hover:bg-card transition-colors cursor-pointer relative ${myInfo ? 'ring-1 ring-inset ring-primary/30' : ''}`}
                                style={{
                                  background: myInfo
                                    ? `linear-gradient(to left, rgba(239, 68, 68, 0.18) ${depthPercent}%, rgba(99, 102, 241, 0.06) ${depthPercent}%)`
                                    : `linear-gradient(to left, rgba(239, 68, 68, 0.1) ${depthPercent}%, transparent ${depthPercent}%)`
                                }}
                              >
                                <td className="py-2.5 px-3 text-destructive font-mono text-sm font-medium">
                                  {order.price !== null ? parseFloat(order.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : 'Market'}
                                </td>
                                <td className="py-2.5 px-3 text-right text-foreground text-sm">
                                  {order.remaining != null ? parseFloat(order.remaining).toFixed(8) : '0.00000000'}
                                </td>
                                <td className="py-2.5 px-3 text-right text-muted-foreground text-sm">
                                  {order.price !== null && order.remaining != null ? (parseFloat(order.price) * parseFloat(order.remaining)).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                                </td>
                                <td className="w-8 py-2.5 px-1 text-center">
                                  {myInfo && (
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold" title={`You have ${myInfo.count} order(s) here`}>
                                      {myInfo.count}
                                    </span>
                                  )}
                                </td>
                              </motion.tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan="4" className="py-8 text-center text-muted-foreground text-sm">No sell orders</td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Buy Orders (Green - Bottom) */}
              <div>
                <h4 className="text-sm font-semibold text-success mb-3 uppercase tracking-wide flex items-center">
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Buy Orders
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full relative">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Price</th>
                        <th className="text-right py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quantity</th>
                        <th className="text-right py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                        <th className="w-8 py-3 px-1 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">My</th>
                      </tr>
                    </thead>
                    <tbody>
                      <AnimatePresence>
                        {buyOrdersWithDepth.length > 0 ? (
                          buyOrdersWithDepth.map((order, i) => {
                            const depthPercent = maxDepth > 0 ? (order.cumulative / maxDepth) * 100 : 0;
                            const myInfo = getMyInfo(order.price, 'BUY');
                            return (
                              <motion.tr
                                key={i}
                                initial={{ opacity: 0, x: 10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0 }}
                                className={`border-b border-border/50 hover:bg-card transition-colors cursor-pointer ${myInfo ? 'ring-1 ring-inset ring-primary/30' : ''}`}
                                style={{
                                  background: myInfo
                                    ? `linear-gradient(to right, rgba(34, 197, 94, 0.18) ${depthPercent}%, rgba(99, 102, 241, 0.06) ${depthPercent}%)`
                                    : `linear-gradient(to right, rgba(34, 197, 94, 0.1) ${depthPercent}%, transparent ${depthPercent}%)`
                                }}
                              >
                                <td className="py-2.5 px-3 text-success font-mono text-sm font-medium">
                                  {order.price !== null ? parseFloat(order.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : 'Market'}
                                </td>
                                <td className="py-2.5 px-3 text-right text-foreground text-sm">
                                  {order.remaining != null ? parseFloat(order.remaining).toFixed(8) : '0.00000000'}
                                </td>
                                <td className="py-2.5 px-3 text-right text-muted-foreground text-sm">
                                  {order.price !== null && order.remaining != null ? (parseFloat(order.price) * parseFloat(order.remaining)).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                                </td>
                                <td className="w-8 py-2.5 px-1 text-center">
                                  {myInfo && (
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold" title={`You have ${myInfo.count} order(s) here`}>
                                      {myInfo.count}
                                    </span>
                                  )}
                                </td>
                              </motion.tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan="4" className="py-8 text-center text-muted-foreground text-sm">No buy orders</td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

