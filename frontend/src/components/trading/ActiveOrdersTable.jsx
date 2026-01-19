import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { cn } from '@/lib/utils';

export default function ActiveOrdersTable({ orders, onCancelOrder }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Active Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">ID</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mode</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Price</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quantity</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filled</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Remaining</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Progress</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {orders.length > 0 ? (
                  orders.map((order) => (
                    <motion.tr
                      key={order.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="border-b border-border/50 hover:bg-card transition-colors"
                    >
                      <td className="py-3 px-4 text-foreground font-mono text-sm">
                        {order.id?.includes('-PARTIAL-') ? (
                          <span className="flex items-center gap-1">
                            <span>{order.id?.substring(0, 10)}...</span>
                            <span className="text-xs text-muted-foreground" title="Remainder order from partial fill">🔄</span>
                          </span>
                        ) : (
                          <span>{order.id?.substring(0, 10)}...</span>
                        )}
                      </td>
                      <td className={cn("py-3 px-4 font-semibold", order.type === 'BUY' ? 'text-success' : 'text-destructive')}>
                        {order.type}
                      </td>
                      <td className="py-3 px-4 text-foreground">{order.mode}</td>
                      <td className="py-3 px-4 text-foreground">
                        {order.price?.Some ? parseFloat(order.price.Some).toLocaleString() : (order.price === null || order.price === undefined ? 'Market' : 'N/A')}
                      </td>
                      <td className="py-3 px-4 text-right text-foreground">{parseFloat(order.quantity || 0).toFixed(8)}</td>
                      <td className="py-3 px-4 text-right text-foreground">{parseFloat(order.filled || 0).toFixed(8)}</td>
                      <td className="py-3 px-4 text-right text-foreground">
                        {(() => {
                          const quantity = parseFloat(order.quantity || 0);
                          const filled = parseFloat(order.filled || 0);
                          const remaining = Math.max(0, quantity - filled);
                          return remaining.toFixed(8);
                        })()}
                      </td>
                      <td className="py-3 px-4">
                        {(() => {
                          const quantity = parseFloat(order.quantity || 0);
                          const filled = parseFloat(order.filled || 0);
                          const fillPercentage = quantity > 0 ? (filled / quantity) * 100 : 0;
                          const remaining = Math.max(0, quantity - filled);
                          const isPartiallyFilled = filled > 0 && remaining > 0;
                          
                          return (
                            <div className="flex items-center gap-2 min-w-[100px]">
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full transition-all duration-300",
                                    isPartiallyFilled ? 'bg-warning' : 'bg-success',
                                    fillPercentage >= 100 ? 'bg-success' : ''
                                  )}
                                  style={{ width: `${Math.min(100, fillPercentage)}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground min-w-[35px] text-right">
                                {fillPercentage.toFixed(1)}%
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-3 px-4">
                        <span className={cn(
                          "px-2.5 py-1 rounded text-xs font-semibold",
                          order.status === 'OPEN' ? 'bg-primary/15 text-primary border border-primary/40' :
                          order.status === 'FILLED' ? 'bg-success/15 text-success border border-success/40' :
                          'bg-destructive/15 text-destructive border border-destructive/40'
                        )}>
                          {order.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {order.status === 'OPEN' && (
                          <Button
                            onClick={() => onCancelOrder(order.contractId)}
                            variant="destructive"
                            size="sm"
                          >
                            Cancel
                          </Button>
                        )}
                      </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="10" className="py-8 text-center text-muted-foreground text-sm">No active orders</td>
                  </tr>
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

