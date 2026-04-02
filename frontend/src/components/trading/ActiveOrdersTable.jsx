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

  const activeOrders = orders.filter(o => o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED' || o.status === 'PENDING_TRIGGER');

  const formatOrderPrice = (order) => {
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
  };

  return (
    <>
      <div className="h-full relative overflow-y-auto w-full bg-transparent">
        {/* Desktop View: Dense Table */}
        <div className="hidden md:block overflow-x-auto h-full bg-transparent">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-[#1A1E24]">
                {['ID', 'TYPE', 'MODE', 'PRICE', 'QUANTITY', 'FILLED', 'REMAINING', 'PROGRESS', 'STATUS', 'ACTION'].map(h => (
                  <th key={h} className="text-left py-4 px-4 text-[10px] font-bold text-[#697280] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1A1E24]">
              <AnimatePresence>
                {activeOrders.length > 0 ? (
                  activeOrders.map((order) => {
                    const quantity = parseFloat(order.quantity || 0);
                    const filled = parseFloat(order.filled || 0);
                    const fillPct = quantity > 0 ? (filled / quantity) * 100 : 0;
                    const remaining = Math.max(0, quantity - filled);
                    return (
                      <motion.tr
                        key={order.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="hover:bg-[#161b22]/50 transition-colors group"
                      >
                        <td className="py-3 px-4 text-white font-mono text-[11px] font-medium">
                          {order.id?.substring(0, 8)}
                        </td>
                        <td className={cn("py-3 px-4 text-[11px] font-bold", order.type === 'BUY' ? 'text-green-500' : 'text-red-500')}>
                          {order.type}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground text-[11px] font-medium uppercase">{order.mode}</td>
                        <td className="py-3 px-4 text-white font-mono text-[11px] font-bold">{formatOrderPrice(order)}</td>
                        <td className="py-3 px-4 text-white text-[11px] font-mono">{quantity.toFixed(4)}</td>
                        <td className="py-3 px-4 text-white text-[11px] font-mono">{filled.toFixed(4)}</td>
                        <td className="py-3 px-4 text-white/70 text-[11px] font-mono">{remaining.toFixed(4)}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 min-w-[100px]">
                            <div className="flex-1 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, fillPct)}%` }}
                                className={cn("h-full rounded-full transition-all", fillPct > 0 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-muted-foreground/30')}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground font-bold font-mono">{fillPct.toFixed(0)}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter",
                            order.status === 'OPEN' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                            order.status === 'PENDING_TRIGGER' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            'bg-green-500/10 text-green-500 border border-green-500/20'
                          )}>
                            {order.status === 'PENDING_TRIGGER' ? 'Stop' : order.status}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {(order.status === 'OPEN' || order.status === 'PENDING_TRIGGER') && (
                            <button
                              onClick={() => handleCancelClick(order)}
                              className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest rounded border border-red-500/20 transition-all active:scale-95"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="10" className="opacity-100 py-12 text-center text-[#697280] text-[12px] font-medium border-0">No active orders</td>
                  </tr>
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Mobile View: High-Density UI Cards */}
        <div className="md:hidden flex flex-col gap-3 p-3">
          <AnimatePresence>
            {activeOrders.length > 0 ? (
              activeOrders.map((order) => {
                const quantity = parseFloat(order.quantity || 0);
                const filled = parseFloat(order.filled || 0);
                const fillPct = quantity > 0 ? (filled / quantity) * 100 : 0;
                const remaining = Math.max(0, quantity - filled);
                return (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden shadow-xl p-3 relative flex flex-col gap-2.5"
                  >
                    {/* Card Header */}
                    <div className="flex items-center justify-between pb-2 border-b border-[#30363d]/50">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest border",
                          order.type === 'BUY' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'
                        )}>
                          {order.type} {order.mode}
                        </span>
                        <span className="text-white text-[11px] font-bold uppercase tracking-wider">{order.tradingPair || 'BTC/USDT'}</span>
                      </div>
                      <span className={cn(
                        "text-[9px] font-bold uppercase tracking-widest",
                        order.status === 'OPEN' ? 'text-blue-400' :
                        order.status === 'PENDING_TRIGGER' ? 'text-amber-400' :
                        'text-green-500'
                      )}>
                        {order.status === 'PENDING_TRIGGER' ? 'Stop' : order.status}
                      </span>
                    </div>

                    {/* Numeric Row  */}
                    <div className="grid grid-cols-2 gap-y-1 gap-x-4">
                      <div>
                        <p className="text-[9px] text-[#848E9C] font-black uppercase tracking-widest">Price</p>
                        <p className="text-xs text-white font-mono font-bold leading-tight">{formatOrderPrice(order)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-[#848E9C] font-black uppercase tracking-widest text-right">Amount</p>
                        <p className="text-xs text-white font-mono font-bold leading-tight text-right">{quantity.toFixed(4)}</p>
                      </div>
                      <div className="col-span-2 mt-1">
                        <div className="flex items-center justify-between mt-1 mb-1.5 text-[9px] font-bold text-[#848E9C] uppercase tracking-widest">
                          <span>Fill: {filled.toFixed(4)}</span>
                          <span>Left: {remaining.toFixed(4)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-[#0d1117] rounded-full overflow-hidden border border-[#30363d]/50">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(100, fillPct)}%` }}
                              className={cn("h-full rounded-full transition-all", fillPct > 0 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-transparent')} 
                            />
                          </div>
                          <span className="text-[9px] text-white font-mono font-bold">{fillPct.toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    {(order.status === 'OPEN' || order.status === 'PENDING_TRIGGER') && (
                      <button
                        onClick={() => handleCancelClick(order)}
                        className="mt-1.5 w-full bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl border border-red-500/20 transition-all active:scale-95 flex items-center justify-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel Order
                      </button>
                    )}
                  </motion.div>
                );
              })
            ) : (
               <div className="py-12 bg-[#161b22] border border-[#30363d]/50 rounded-2xl flex flex-col items-center justify-center">
                 <p className="text-[#848E9C] text-[10px] font-black uppercase tracking-[2px]">No Active Orders</p>
               </div>
            )}
          </AnimatePresence>
        </div>
      </div>


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
