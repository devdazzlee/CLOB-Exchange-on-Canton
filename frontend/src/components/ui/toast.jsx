import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle, TrendingUp, Zap } from "lucide-react";

const ToastContext = React.createContext({});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([]);

  const addToast = React.useCallback((toast) => {
    const id = Date.now() + Math.random();
    const newToast = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);

    // Auto remove after duration
    const duration = toast.duration || 5000;
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const removeToast = React.useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useMemo(() => ({
    success: (message, options = {}) => addToast({ type: 'success', message, ...options }),
    error: (message, options = {}) => addToast({ type: 'error', message, ...options }),
    info: (message, options = {}) => addToast({ type: 'info', message, ...options }),
    warning: (message, options = {}) => addToast({ type: 'warning', message, ...options }),
    trade: (tradeData, options = {}) => addToast({ 
      type: 'trade', 
      message: `Trade executed: ${tradeData.quantity} BTC @ $${parseFloat(tradeData.price).toLocaleString()}`,
      tradeData,
      duration: 6000,
      ...options 
    }),
    orderFilled: (orderData, options = {}) => addToast({
      type: 'orderFilled',
      message: `Order filled!`,
      orderData,
      duration: 8000,
      ...options
    }),
    remove: removeToast,
  }), [addToast, removeToast]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onRemove={() => onRemove(toast.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Toast({ toast, onRemove }) {
  const icons = {
    success: <CheckCircle className="w-5 h-5" />,
    error: <AlertCircle className="w-5 h-5" />,
    info: <Info className="w-5 h-5" />,
    warning: <AlertTriangle className="w-5 h-5" />,
    trade: <TrendingUp className="w-5 h-5" />,
    orderFilled: <Zap className="w-5 h-5" />,
  };

  const styles = {
    success: 'bg-gradient-to-r from-green-900/95 to-green-800/95 border-green-500/50 text-green-100',
    error: 'bg-gradient-to-r from-red-900/95 to-red-800/95 border-red-500/50 text-red-100',
    info: 'bg-gradient-to-r from-blue-900/95 to-blue-800/95 border-blue-500/50 text-blue-100',
    warning: 'bg-gradient-to-r from-yellow-900/95 to-yellow-800/95 border-yellow-500/50 text-yellow-100',
    trade: 'bg-gradient-to-r from-purple-900/95 to-indigo-800/95 border-purple-500/50 text-purple-100',
    orderFilled: 'bg-gradient-to-r from-cyan-900/95 to-teal-800/95 border-cyan-500/50 text-cyan-100',
  };

  const iconStyles = {
    success: 'text-green-400',
    error: 'text-red-400',
    info: 'text-blue-400',
    warning: 'text-yellow-400',
    trade: 'text-purple-400',
    orderFilled: 'text-cyan-400',
  };

  // Special rendering for trade notifications
  if (toast.type === 'trade' && toast.tradeData) {
    return (
      <motion.div
        initial={{ opacity: 0, x: 100, scale: 0.9 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: 50, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="pointer-events-auto min-w-[350px] max-w-[450px] rounded-xl border border-purple-500/40 backdrop-blur-xl shadow-2xl overflow-hidden"
      >
        {/* Animated gradient header */}
        <div className="bg-gradient-to-r from-purple-600 via-indigo-500 to-blue-500 px-4 py-2 flex items-center gap-2">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          >
            <TrendingUp className="w-4 h-4 text-white" />
          </motion.div>
          <span className="text-white font-semibold text-sm">⚡ Trade Executed</span>
        </div>
        <div className="bg-gradient-to-br from-[#1a1f2e] to-[#0d1117] p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-400 text-sm">Amount</span>
            <span className="text-white font-bold">{toast.tradeData.quantity} BTC</span>
          </div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-400 text-sm">Price</span>
            <span className="text-yellow-400 font-bold text-lg">${parseFloat(toast.tradeData.price).toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Total</span>
            <span className="text-green-400 font-semibold">
              ${(parseFloat(toast.tradeData.quantity) * parseFloat(toast.tradeData.price)).toLocaleString()}
            </span>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="absolute top-2 right-2 p-1 rounded-lg hover:bg-white/10 transition-colors text-white/70"
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>
    );
  }

  // Special rendering for order filled notifications
  if (toast.type === 'orderFilled' && toast.orderData) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="pointer-events-auto min-w-[350px] max-w-[450px] rounded-xl border border-cyan-500/40 backdrop-blur-xl shadow-2xl overflow-hidden"
      >
        <div className="bg-gradient-to-r from-cyan-600 via-teal-500 to-emerald-500 px-4 py-2 flex items-center gap-2">
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          >
            <Zap className="w-4 h-4 text-white" />
          </motion.div>
          <span className="text-white font-semibold text-sm">🎯 Order Filled!</span>
        </div>
        <div className="bg-gradient-to-br from-[#1a1f2e] to-[#0d1117] p-4">
          <p className="text-white text-sm mb-2">Your order has been matched and executed on Canton</p>
          {toast.orderData.orderId && (
            <p className="text-gray-500 text-xs font-mono">ID: {toast.orderData.orderId}</p>
          )}
        </div>
        <button
          onClick={onRemove}
          className="absolute top-2 right-2 p-1 rounded-lg hover:bg-white/10 transition-colors text-white/70"
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`
        pointer-events-auto min-w-[320px] max-w-[420px] p-4 rounded-xl border backdrop-blur-xl shadow-2xl
        ${styles[toast.type] || styles.info}
      `}
    >
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 ${iconStyles[toast.type] || iconStyles.info}`}>
          {icons[toast.type] || icons.info}
        </div>
        <div className="flex-1 min-w-0">
          {toast.title && (
            <h4 className="font-semibold text-sm mb-1">{toast.title}</h4>
          )}
          <p className="text-sm opacity-90 break-words">{toast.message}</p>
          {toast.details && (
            <p className="text-xs opacity-70 mt-1 font-mono">{toast.details}</p>
          )}
        </div>
        <button
          onClick={onRemove}
          className="flex-shrink-0 p-1 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      {/* Progress bar for auto-dismiss */}
      <motion.div
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: (toast.duration || 5000) / 1000, ease: "linear" }}
        className="absolute bottom-0 left-0 right-0 h-1 bg-white/20 origin-left rounded-b-xl"
      />
    </motion.div>
  );
}

// Order success modal component - Matching Cancel Modal Style
export function OrderSuccessModal({ isOpen, onClose, orderData }) {
  if (!isOpen) return null;

  const isBuy = orderData?.orderType === 'BUY';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"
            onClick={onClose}
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          >
            <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
              {/* Header */}
              <div className={`flex items-center justify-between p-4 border-b border-border ${
                isBuy ? 'bg-green-500/10' : 'bg-red-500/10'
              }`}>
                <div className="flex items-center gap-3">
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
                    className={`p-2 rounded-full ${isBuy ? 'bg-green-500/20' : 'bg-red-500/20'}`}
                  >
                    <CheckCircle className={`w-5 h-5 ${isBuy ? 'text-green-500' : 'text-red-500'}`} />
                  </motion.div>
                  <h3 className="text-lg font-semibold text-foreground">Order Submitted</h3>
                </div>
                <button
                  onClick={onClose}
                  className="p-1 rounded-lg hover:bg-muted transition-colors"
                >
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                <p className="text-muted-foreground">
                  Your order has been placed successfully and is now live on the Canton ledger.
                </p>

                {/* Order Details */}
                {orderData && (
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    {orderData.orderId && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Order ID</span>
                        <span className="text-sm font-mono text-foreground">{orderData.orderId?.substring(0, 16)}...</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Type</span>
                      <span className={`text-sm font-semibold ${isBuy ? 'text-green-500' : 'text-red-500'}`}>
                        {orderData.orderType} {orderData.orderMode}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Trading Pair</span>
                      <span className="text-sm font-semibold text-foreground">{orderData.tradingPair}</span>
                    </div>
                    {orderData.price && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Price</span>
                        <span className="text-sm font-mono text-foreground">
                          ${parseFloat(orderData.price).toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Quantity</span>
                      <span className="text-sm font-mono text-foreground">{orderData.quantity}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex gap-3 p-4 border-t border-border bg-muted/30">
                <button
                  onClick={onClose}
                  className={`flex-1 py-2.5 font-medium rounded-lg transition-colors ${
                    isBuy 
                      ? 'bg-green-500 hover:bg-green-600 text-white' 
                      : 'bg-red-500 hover:bg-red-600 text-white'
                  }`}
                >
                  Continue Trading
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
