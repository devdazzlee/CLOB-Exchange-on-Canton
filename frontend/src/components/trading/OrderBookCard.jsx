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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Sell Orders */}
            <div>
              <h4 className="text-sm font-semibold text-destructive mb-3 uppercase tracking-wide flex items-center">
                <TrendingDown className="w-4 h-4 mr-2" />
                Sell Orders
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Price</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quantity</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {orderBook.sells.length > 0 ? (
                        orderBook.sells.map((order, i) => (
                          <motion.tr
                            key={i}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0 }}
                            className="border-b border-border/50 hover:bg-card transition-colors cursor-pointer"
                          >
                            <td className="py-2.5 px-3 text-destructive font-mono text-sm font-medium">
                              {order.price !== null ? order.price.toLocaleString() : 'Market'}
                            </td>
                            <td className="py-2.5 px-3 text-right text-foreground text-sm">{order.remaining.toFixed(8)}</td>
                            <td className="py-2.5 px-3 text-right text-muted-foreground text-sm">
                              {order.price !== null ? (order.price * order.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                            </td>
                          </motion.tr>
                        ))
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

            {/* Buy Orders */}
            <div>
              <h4 className="text-sm font-semibold text-success mb-3 uppercase tracking-wide flex items-center">
                <TrendingUp className="w-4 h-4 mr-2" />
                Buy Orders
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Price</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quantity</th>
                      <th className="text-right py-3 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {orderBook.buys.length > 0 ? (
                        orderBook.buys.map((order, i) => (
                          <motion.tr
                            key={i}
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0 }}
                            className="border-b border-border/50 hover:bg-card transition-colors cursor-pointer"
                          >
                            <td className="py-2.5 px-3 text-success font-mono text-sm font-medium">
                              {order.price !== null ? order.price.toLocaleString() : 'Market'}
                            </td>
                            <td className="py-2.5 px-3 text-right text-foreground text-sm">{order.remaining.toFixed(8)}</td>
                            <td className="py-2.5 px-3 text-right text-muted-foreground text-sm">
                              {order.price !== null ? (order.price * order.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                            </td>
                          </motion.tr>
                        ))
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
        )}
      </CardContent>
    </Card>
  );
}

