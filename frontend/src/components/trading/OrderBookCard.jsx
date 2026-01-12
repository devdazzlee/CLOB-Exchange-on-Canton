import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export default function OrderBookCard({ 
  tradingPair, 
  orderBook, 
  loading, 
  onRefresh, 
  onCreateOrderBook, 
  creatingOrderBook 
}) {
  const isEmpty = orderBook.buys.length === 0 && orderBook.sells.length === 0;

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

  const buyOrdersWithDepth = calculateDepth([...orderBook.buys].reverse()); // Reverse for display (highest first)
  const sellOrdersWithDepth = calculateDepth([...orderBook.sells]); // Lowest first
  
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
          <CardTitle>Order Book - {tradingPair}</CardTitle>
          <div className="flex items-center space-x-2">
            {isEmpty && !loading && (
              <Button
                onClick={onCreateOrderBook}
                disabled={creatingOrderBook}
                variant="default"
                size="sm"
              >
                {creatingOrderBook ? 'Creating...' : 'Create OrderBook'}
              </Button>
            )}
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
                      </tr>
                    </thead>
                    <tbody>
                      <AnimatePresence>
                        {sellOrdersWithDepth.length > 0 ? (
                          sellOrdersWithDepth.map((order, i) => {
                            const depthPercent = maxDepth > 0 ? (order.cumulative / maxDepth) * 100 : 0;
                            return (
                              <motion.tr
                                key={i}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0 }}
                                className="border-b border-border/50 hover:bg-card transition-colors cursor-pointer relative"
                              >
                                {/* Depth bar background */}
                                <td colSpan="3" className="absolute inset-0 pointer-events-none">
                                  <div 
                                    className="h-full bg-destructive/10"
                                    style={{ width: `${depthPercent}%`, marginLeft: 'auto' }}
                                  />
                                </td>
                                <td className="py-2.5 px-3 text-destructive font-mono text-sm font-medium relative z-10">
                                  {order.price !== null ? parseFloat(order.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : 'Market'}
                                </td>
                                <td className="py-2.5 px-3 text-right text-foreground text-sm relative z-10">
                                  {order.remaining.toFixed(8)}
                                </td>
                                <td className="py-2.5 px-3 text-right text-muted-foreground text-sm relative z-10">
                                  {order.price !== null ? (order.price * order.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                                </td>
                              </motion.tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan="3" className="py-8 text-center text-muted-foreground text-sm">No sell orders</td>
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
                      </tr>
                    </thead>
                    <tbody>
                      <AnimatePresence>
                        {buyOrdersWithDepth.length > 0 ? (
                          buyOrdersWithDepth.map((order, i) => {
                            const depthPercent = maxDepth > 0 ? (order.cumulative / maxDepth) * 100 : 0;
                            return (
                              <motion.tr
                                key={i}
                                initial={{ opacity: 0, x: 10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0 }}
                                className="border-b border-border/50 hover:bg-card transition-colors cursor-pointer relative"
                              >
                                {/* Depth bar background */}
                                <td colSpan="3" className="absolute inset-0 pointer-events-none">
                                  <div 
                                    className="h-full bg-success/10"
                                    style={{ width: `${depthPercent}%` }}
                                  />
                                </td>
                                <td className="py-2.5 px-3 text-success font-mono text-sm font-medium relative z-10">
                                  {order.price !== null ? parseFloat(order.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : 'Market'}
                                </td>
                                <td className="py-2.5 px-3 text-right text-foreground text-sm relative z-10">
                                  {order.remaining.toFixed(8)}
                                </td>
                                <td className="py-2.5 px-3 text-right text-muted-foreground text-sm relative z-10">
                                  {order.price !== null ? (order.price * order.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                                </td>
                              </motion.tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan="3" className="py-8 text-center text-muted-foreground text-sm">No buy orders</td>
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

