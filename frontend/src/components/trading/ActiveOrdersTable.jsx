import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { cn } from '@/lib/utils';
import { Loader2, AlertTriangle, X, ShieldAlert } from 'lucide-react';

// Cancel Confirmation Modal
function CancelOrderModal({ isOpen, onClose, onConfirm, order, isLoading }) {
  if (!isOpen || !order) return null;

  const formatPrice = (price) => {
    if (price?.Some) return parseFloat(price.Some).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    if (price !== null && price !== undefined && price !== '' && price !== 'None') {
      const numPrice = parseFloat(price);
      if (!isNaN(numPrice) && numPrice > 0) return numPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    }
    return order.mode === 'MARKET' ? 'Market' : 'N/A';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={!isLoading ? onClose : undefined}
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border bg-destructive/10">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-destructive/20">
                    <AlertTriangle className="w-5 h-5 text-destructive" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Cancel Order</h3>
                </div>
                {!isLoading && (
                  <button
                    onClick={onClose}
                    className="p-1 rounded-lg hover:bg-muted transition-colors"
                  >
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                )}
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                <p className="text-muted-foreground">
                  Are you sure you want to cancel this order? This action cannot be undone.
                </p>

                {/* Order Details */}
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Order ID</span>
                    <span className="text-sm font-mono text-foreground">{order.id?.substring(0, 16)}...</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Type</span>
                    <span className={cn(
                      "text-sm font-semibold",
                      order.type === 'BUY' ? 'text-success' : 'text-destructive'
                    )}>
                      {order.type} {order.mode}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Price</span>
                    <span className="text-sm font-mono text-foreground">{formatPrice(order.price)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Quantity</span>
                    <span className="text-sm font-mono text-foreground">{parseFloat(order.quantity || 0).toFixed(8)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Trading Pair</span>
                    <span className="text-sm font-semibold text-foreground">{order.tradingPair || 'BTC/USDT'}</span>
                  </div>
                </div>

                {isLoading && (
                  <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Cancelling order on Canton ledger...</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex gap-3 p-4 border-t border-border bg-muted/30">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={onClose}
                  disabled={isLoading}
                >
                  Keep Order
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={onConfirm}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    'Cancel Order'
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default function ActiveOrdersTable({ orders, onCancelOrder }) {
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancelClick = (order) => {
    setSelectedOrder(order);
    setCancelModalOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (!selectedOrder?.contractId) return;
    
    setIsCancelling(true);
    try {
      await onCancelOrder(selectedOrder.contractId);
      setCancelModalOpen(false);
      setSelectedOrder(null);
    } catch (error) {
      console.error('[ActiveOrdersTable] Cancel failed:', error);
      // Keep modal open on error so user can retry
    } finally {
      setIsCancelling(false);
    }
  };

  const handleCloseModal = () => {
    if (!isCancelling) {
      setCancelModalOpen(false);
      setSelectedOrder(null);
    }
  };

  return (
    <>
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
                  {orders.filter(o => o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED' || o.status === 'PENDING_TRIGGER').length > 0 ? (
                    orders.filter(o => o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED' || o.status === 'PENDING_TRIGGER').map((order) => (
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
                        <td className="py-3 px-4 text-foreground font-mono">
                          {(() => {
                            const price = order.price;
                            if (price?.Some) return parseFloat(price.Some).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
                            if (price !== null && price !== undefined && price !== '' && price !== 'None') {
                              const numPrice = parseFloat(price);
                              if (!isNaN(numPrice) && numPrice > 0) return numPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
                            }
                            if (order.mode === 'STOP_LOSS' && order.stopPrice) {
                              return `SL @ ${parseFloat(order.stopPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
                            }
                            return order.mode === 'MARKET' ? 'Market' : 'N/A';
                          })()}
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
                            "px-2.5 py-1 rounded text-xs font-semibold inline-flex items-center gap-1",
                            order.status === 'OPEN' ? 'bg-primary/15 text-primary border border-primary/40' :
                            order.status === 'PENDING_TRIGGER' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40' :
                            order.status === 'FILLED' ? 'bg-success/15 text-success border border-success/40' :
                            'bg-destructive/15 text-destructive border border-destructive/40'
                          )}>
                            {order.status === 'PENDING_TRIGGER' && <ShieldAlert className="w-3 h-3" />}
                            {order.status === 'PENDING_TRIGGER' ? 'Stop-Loss' : order.status}
                            {order.stopPrice && order.status === 'PENDING_TRIGGER' && (
                              <span className="ml-1 font-mono">@ {parseFloat(order.stopPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            )}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {(order.status === 'OPEN' || order.status === 'PENDING_TRIGGER') && (
                            <Button
                              onClick={() => handleCancelClick(order)}
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

      {/* Cancel Confirmation Modal */}
      <CancelOrderModal
        isOpen={cancelModalOpen}
        onClose={handleCloseModal}
        onConfirm={handleConfirmCancel}
        order={selectedOrder}
        isLoading={isCancelling}
      />
    </>
  );
}
