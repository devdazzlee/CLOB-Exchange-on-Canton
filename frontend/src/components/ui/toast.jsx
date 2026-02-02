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

// Confetti particle component
function ConfettiParticle({ delay, color }) {
  return (
    <motion.div
      initial={{ 
        opacity: 1, 
        y: 0, 
        x: 0,
        scale: 1,
        rotate: 0
      }}
      animate={{ 
        opacity: [1, 1, 0],
        y: [0, -100, -200],
        x: [0, (Math.random() - 0.5) * 200],
        scale: [1, 1.2, 0.5],
        rotate: [0, 360, 720]
      }}
      transition={{ 
        duration: 2,
        delay: delay,
        ease: "easeOut"
      }}
      className="absolute w-3 h-3 rounded-sm"
      style={{ 
        backgroundColor: color,
        left: `${50 + (Math.random() - 0.5) * 30}%`,
        top: '50%'
      }}
    />
  );
}

// Order success modal component - ATTRACTIVE VERSION
export function OrderSuccessModal({ isOpen, onClose, orderData }) {
  const [showConfetti, setShowConfetti] = React.useState(false);
  
  React.useEffect(() => {
    if (isOpen) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const confettiColors = ['#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#eab308'];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          onClick={onClose}
        >
          {/* Backdrop with blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
          />
          
          {/* Confetti */}
          {showConfetti && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {confettiColors.map((color, i) => (
                <React.Fragment key={i}>
                  <ConfettiParticle delay={i * 0.05} color={color} />
                  <ConfettiParticle delay={i * 0.05 + 0.1} color={color} />
                  <ConfettiParticle delay={i * 0.05 + 0.2} color={color} />
                </React.Fragment>
              ))}
            </div>
          )}
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 50 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            onClick={(e) => e.stopPropagation()}
            className="relative overflow-hidden"
          >
            {/* Glow effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-green-600 via-emerald-500 to-teal-500 rounded-3xl blur-lg opacity-50 animate-pulse" />
            
            {/* Modal content */}
            <div className="relative bg-gradient-to-br from-[#1a1f2e] via-[#151922] to-[#0d1117] border border-green-500/40 rounded-2xl p-8 max-w-md w-full shadow-2xl">
              {/* Decorative corner accents */}
              <div className="absolute top-0 left-0 w-20 h-20 border-l-2 border-t-2 border-green-500/30 rounded-tl-2xl" />
              <div className="absolute bottom-0 right-0 w-20 h-20 border-r-2 border-b-2 border-green-500/30 rounded-br-2xl" />
              
              {/* Success animation */}
              <div className="flex flex-col items-center text-center">
                {/* Animated success icon with rings */}
                <div className="relative mb-6">
                  {/* Outer ring */}
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1.5, opacity: 0 }}
                    transition={{ duration: 1, repeat: Infinity, repeatDelay: 0.5 }}
                    className="absolute inset-0 rounded-full bg-green-500/20"
                  />
                  {/* Middle ring */}
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1.3, opacity: 0 }}
                    transition={{ duration: 1, repeat: Infinity, repeatDelay: 0.5, delay: 0.2 }}
                    className="absolute inset-0 rounded-full bg-green-500/30"
                  />
                  {/* Main circle */}
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                    className="w-24 h-24 rounded-full bg-gradient-to-br from-green-400 via-emerald-500 to-teal-600 flex items-center justify-center shadow-xl shadow-green-500/40"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.3, type: "spring", stiffness: 300 }}
                    >
                      <CheckCircle className="w-12 h-12 text-white drop-shadow-lg" />
                    </motion.div>
                  </motion.div>
                </div>
                
                <motion.h3 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-300 bg-clip-text text-transparent mb-1"
                >
                  🎉 Order Placed!
                </motion.h3>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-gray-400 text-sm mb-4"
                >
                  Your order is now live on the Canton ledger
                </motion.p>
                
                {orderData && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="w-full mt-2 space-y-3 text-left bg-black/40 rounded-xl p-5 border border-white/5"
                  >
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-gray-500" />
                        Order ID
                      </span>
                      <span className="text-gray-300 font-mono text-xs bg-black/30 px-2 py-1 rounded">
                        {orderData.orderId?.substring(0, 16)}...
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${orderData.orderType === 'BUY' ? 'bg-green-500' : 'bg-red-500'}`} />
                        Type
                      </span>
                      <span className={`font-semibold px-3 py-1 rounded-lg text-xs ${
                        orderData.orderType === 'BUY' 
                          ? 'text-green-400 bg-green-500/10 border border-green-500/20' 
                          : 'text-red-400 bg-red-500/10 border border-red-500/20'
                      }`}>
                        {orderData.orderType} {orderData.orderMode}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                        Pair
                      </span>
                      <span className="text-white font-medium">{orderData.tradingPair}</span>
                    </div>
                    {orderData.price && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-yellow-500" />
                          Price
                        </span>
                        <span className="text-yellow-400 font-bold text-lg">
                          ${parseFloat(orderData.price).toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-purple-500" />
                        Quantity
                      </span>
                      <span className="text-purple-400 font-semibold">{orderData.quantity} BTC</span>
                    </div>
                  </motion.div>
                )}
                
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  onClick={onClose}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="mt-6 w-full py-4 bg-gradient-to-r from-green-600 via-emerald-500 to-teal-500 hover:from-green-500 hover:via-emerald-400 hover:to-teal-400 text-white font-bold rounded-xl transition-all duration-300 shadow-xl shadow-green-500/25 flex items-center justify-center gap-2"
                >
                  <span>Continue Trading</span>
                  <motion.span
                    animate={{ x: [0, 5, 0] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                  >
                    →
                  </motion.span>
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
