import { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, Loader2, Info, ShieldAlert, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Slider } from '../ui/slider';
import { cn } from '@/lib/utils';

export default function OrderForm({ 
  tradingPair,
  availablePairs = ['BTC/USDT'],
  onTradingPairChange, 
  orderBookExists,
  orderType, 
  onOrderTypeChange, 
  orderMode, 
  onOrderModeChange, 
  price, 
  onPriceChange, 
  quantity, 
  onQuantityChange, 
  loading, 
  onSubmit,
  balance = { BTC: '0.0', USDT: '0.0' },
  lockedBalance = {},
  orderBook = { buys: [], sells: [] },
  lastTradePrice = null
}) {
  const [timeInForce, setTimeInForce] = useState('GTC'); // GTC, IOC, FOK
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopPrice, setStopPrice] = useState(''); // For STOP_LOSS order mode

  // Get base and quote tokens
  const [baseToken, quoteToken] = tradingPair.split('/');
  const baseBalance = Math.max(0, parseFloat(balance[baseToken] || 0));
  const quoteBalance = Math.max(0, parseFloat(balance[quoteToken] || 0));

  // Get best bid/ask prices
  const bestBid = orderBook.buys?.[0]?.price || null;
  const bestAsk = orderBook.sells?.[0]?.price || null;
  
  const midPrice = bestBid && bestAsk 
    ? (parseFloat(bestBid) + parseFloat(bestAsk)) / 2 
    : null;
  const marketPrice = (lastTradePrice && parseFloat(lastTradePrice) > 0 ? parseFloat(lastTradePrice) : null) 
    || midPrice 
    || parseFloat(bestBid) || parseFloat(bestAsk) || null;

  // Calculate estimated cost/value
  const estimatedCost = useMemo(() => {
    if (!quantity || parseFloat(quantity) <= 0) return null;
    const qty = parseFloat(quantity);
    
    if (orderMode === 'MARKET') {
      if (orderType === 'BUY' && bestAsk) {
        return qty * parseFloat(bestAsk);
      } else if (orderType === 'SELL' && bestBid) {
        return qty * parseFloat(bestBid);
      }
      return null;
    } else {
      if (price && parseFloat(price) > 0) {
        return qty * parseFloat(price);
      }
    }
    return null;
  }, [quantity, price, orderMode, orderType, bestBid, bestAsk]);

  // Handle percentage changes
  const [sliderPct, setSliderPct] = useState(0);

  const calculatePercentage = useCallback((percent) => {
    if (orderType === 'BUY') {
      const availableBalance = quoteBalance;
      let priceToUse = orderMode === 'MARKET'
        ? (bestAsk || marketPrice || 0)
        : (parseFloat(price) || 0);

      if (priceToUse <= 0 || availableBalance <= 0) {
        onQuantityChange('0');
        return;
      }
      const maxQty = availableBalance / priceToUse;
      const qty = (maxQty * percent) / 100;
      onQuantityChange(qty.toFixed(8));
    } else {
      const availableBalance = baseBalance;
      if (availableBalance <= 0) {
        onQuantityChange('0');
        return;
      }
      const qty = (availableBalance * percent) / 100;
      onQuantityChange(qty.toFixed(8));
    }
  }, [orderType, orderMode, quoteBalance, baseBalance, bestAsk, marketPrice, price, onQuantityChange]);

  const handlePercentage = (percent) => {
    setSliderPct(percent);
    calculatePercentage(percent);
  };

  // Validation
  const validation = useMemo(() => {
    const errors = [];
    const warnings = [];

    const qty = parseFloat(quantity) || 0;
    if (!quantity || qty <= 0) {
      errors.push('Quantity is required');
    }
    if (orderMode === 'LIMIT' && (!price || parseFloat(price) <= 0)) {
      errors.push('Price is required for limit orders');
    }
    if (orderMode === 'STOP_LOSS' && (!stopPrice || parseFloat(stopPrice) <= 0)) {
      errors.push('Stop price is required for stop-loss orders');
    }

    if (qty > 0) {
      if (orderType === 'BUY') {
        if (estimatedCost && estimatedCost > quoteBalance) {
          errors.push(`Insufficient ${quoteToken} balance`);
        }
      } else {
        if (qty > baseBalance) {
          errors.push(`Insufficient ${baseToken} balance`);
        }
      }
    }

    return { errors, warnings, isValid: errors.length === 0 };
  }, [orderType, orderMode, price, quantity, stopPrice, estimatedCost, baseBalance, quoteBalance, baseToken, quoteToken]);

  const formatNumber = (num, decimals = 8) => {
    if (!num || isNaN(num)) return '0';
    return parseFloat(num).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: decimals
    });
  };

  return (
    <div className="flex flex-col bg-card h-full overflow-y-auto scrollbar-thin transition-all">
      {/* Order Mode tabs - Professional Segmented Control */}
      <div className="flex items-center gap-1 p-1 bg-[#0d1117] border border-[#2B3139] m-3 mb-2 rounded-xl w-fit flex-shrink-0 shadow-sm">
        {['MARKET', 'LIMIT', 'STOP_LOSS'].map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => onOrderModeChange({ target: { value: mode } })}
            className={cn(
              "py-1.5 px-4 text-[10px] font-bold uppercase tracking-[1px] transition-all duration-200 rounded-lg whitespace-nowrap",
              orderMode === mode 
                ? "bg-[#2b3139] text-[#F7B500] border border-[#3A4149] shadow-inner" 
                : "text-muted-foreground hover:bg-white/5 hover:text-white"
            )}
          >
            {mode.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Buy / Sell Toggles */}
      <div className="px-3 pb-3">
        <div className="relative flex p-1 bg-[#161b22] rounded-xl border border-border">
          <button
            type="button"
            onClick={() => onOrderTypeChange({ target: { value: 'BUY' } })}
            className={cn(
              "flex-1 py-2 text-xs font-bold rounded-lg transition-all duration-300 z-10",
              orderType === 'BUY' 
                ? "bg-[#0ECB81] text-white shadow-lg shadow-[#0ECB81]/20 ring-1 ring-white/10" 
                : "text-muted-foreground hover:text-white"
            )}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => onOrderTypeChange({ target: { value: 'SELL' } })}
            className={cn(
              "flex-1 py-2 text-xs font-bold rounded-lg transition-all duration-300 z-10",
              orderType === 'SELL' 
                ? "bg-[#F6465D] text-white shadow-lg shadow-[#F6465D]/20 ring-1 ring-white/10" 
                : "text-muted-foreground hover:text-white"
            )}
          >
            Sell
          </button>
        </div>
      </div>


      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (validation.isValid) {
            onSubmit({
              tradingPair,
              orderType,
              orderMode,
              price: orderMode === 'LIMIT' ? price : null,
              quantity,
              timeInForce,
              stopPrice: orderMode === 'STOP_LOSS' ? stopPrice : (showAdvanced && stopLoss ? stopLoss : null),
              stopLoss: showAdvanced ? stopLoss : null,
              takeProfit: showAdvanced ? takeProfit : null,
            });
          }
        }}
        className="flex flex-col gap-0"
      >
        {/* Available section */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#21262d] bg-[#161b22]/30">
          <span className="text-[#848E9C] text-[11px] uppercase font-bold tracking-tight">Available</span>
          <span className="text-white text-[12px] font-mono font-bold">
            {orderType === 'BUY'
              ? `${formatNumber(quoteBalance, 4)} ${quoteToken}`
              : `${formatNumber(baseBalance, 8)} ${baseToken}`}
          </span>
        </div>

        {/* Input Fields Container */}
        <div className="p-3 space-y-3">
          {/* Stop Price (if STOP_LOSS) */}
          {orderMode === 'STOP_LOSS' && (
            <div className="space-y-1.5 focus-within:translate-y-[-1px] transition-transform">
              <label className="text-[11px] font-bold text-[#848E9C] uppercase ml-1 tracking-tight">Stop Price</label>
              <div className="relative group">
                <Input
                  type="number"
                  step="0.0001"
                  value={stopPrice}
                  onChange={(e) => setStopPrice(e.target.value)}
                  placeholder="0.0000"
                  className="bg-[#161b22] border-[#2B3139] focus:border-[#F7B500]/50 hover:border-[#4a4a5a] pr-12 font-mono h-11 text-[13px] font-bold"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#848E9C] font-bold">{quoteToken}</span>
              </div>
            </div>
          )}

          {/* Limit Price */}
          {orderMode === 'LIMIT' && (
            <div className="space-y-1.5 focus-within:translate-y-[-1px] transition-transform">
              <div className="flex justify-between items-center ml-1">
                <label className="text-[11px] font-bold text-[#848E9C] uppercase tracking-tight">Price</label>
                {midPrice && (
                  <button 
                    type="button" 
                    onClick={() => onPriceChange(midPrice.toFixed(4))}
                    className="text-[10px] text-[#F7B500] hover:underline font-bold"
                  >
                    Set Mid
                  </button>
                )}
              </div>
              <div className="relative group">
                <Input
                  type="number"
                  step="0.0001"
                  value={price}
                  onChange={(e) => onPriceChange(e.target.value)}
                  placeholder={midPrice ? midPrice.toFixed(4) : "0.0000"}
                  className="bg-[#161b22] border-[#2B3139] focus:border-[#F7B500]/50 hover:border-[#4a4a5a] pr-12 font-mono h-11 text-[13px] font-bold"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#848E9C] font-bold">{quoteToken}</span>
              </div>
            </div>
          )}

          {/* Amount Field */}
          <div className="space-y-1.5 focus-within:translate-y-[-1px] transition-transform">
            <label className="text-[11px] font-bold text-[#848E9C] uppercase ml-1 tracking-tight">Amount</label>
            <div className="relative group">
              <Input
                type="number"
                step="0.00000001"
                value={quantity}
                onChange={(e) => onQuantityChange(e.target.value)}
                placeholder="0.00"
                className="bg-[#161b22] border-[#2B3139] focus:border-[#F7B500]/50 hover:border-[#4a4a5a] pr-12 font-mono h-11 text-[13px] font-bold"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#848E9C] font-bold">{baseToken}</span>
            </div>
          </div>

          {/* Percent Slider & Buttons */}
          <div className="pt-2 space-y-4">
            <div className="flex items-center gap-4">
              <Slider 
                min={0} 
                max={100} 
                step={1} 
                value={sliderPct} 
                onValueChange={handlePercentage}
                className="flex-1 py-1"
              />
              <span className="text-xs font-bold text-white w-8 text-right font-mono">{sliderPct}%</span>
            </div>
            
            <div className="grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map(p => (
                <Button
                  key={p}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePercentage(p)}
                  className={cn(
                    "h-8 text-[11px] font-bold border-[#2B3139] bg-transparent hover:bg-[#F7B500]/10 hover:text-[#F7B500] hover:border-[#F7B500]/30 transition-all",
                    sliderPct === p && "border-[#F7B500] text-[#F7B500] bg-[#F7B500]/10 shadow-[0_0_10px_rgba(247,181,0,0.1)]"
                  )}
                >
                  {p}%
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Advanced Section */}
        <div className="border-t border-[#21262d]">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#161b22]/50 transition-colors group"
          >
            <span className="text-xs font-bold text-[#848E9C] group-hover:text-white uppercase tracking-wider">Advanced Options</span>
            <ChevronDown className={cn("w-4 h-4 text-[#848E9C] transition-transform duration-300", showAdvanced && "rotate-180")} />
          </button>
          
          <AnimatePresence>
            {showAdvanced && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-[#848E9C] uppercase block ml-1">Time In Force</label>
                    <Select value={timeInForce} onValueChange={setTimeInForce}>
                      <SelectTrigger className="h-10 bg-[#161b22] border-[#2B3139] text-xs font-bold ring-0 focus:ring-0">
                        <SelectValue placeholder="Select Time In Force" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1e2329] border-[#2B3139]">
                        <SelectItem value="GTC" className="text-xs font-bold">GTC - Good Till Cancel</SelectItem>
                        <SelectItem value="IOC" className="text-xs font-bold">IOC - Immediate Or Cancel</SelectItem>
                        <SelectItem value="FOK" className="text-xs font-bold">FOK - Fill Or Kill</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-[#848E9C] uppercase block ml-1">Stop Loss</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={stopLoss}
                        onChange={(e) => setStopLoss(e.target.value)}
                        placeholder="Price"
                        className="h-10 bg-[#161b22] border-[#2B3139] text-xs font-mono font-bold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-[#848E9C] uppercase block ml-1">Take Profit</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={takeProfit}
                        onChange={(e) => setTakeProfit(e.target.value)}
                        placeholder="Price"
                        className="h-10 bg-[#161b22] border-[#2B3139] text-xs font-mono font-bold"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Order Info Summary */}
        <div className="mx-3 my-2 p-3 rounded-lg bg-[#161b22]/50 border border-[#21262d] space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-[#848E9C]">Est. Order Value</span>
            <span className="text-white font-mono font-bold">
              {estimatedCost ? `${estimatedCost.toFixed(2)} ${quoteToken}` : '0.00'}
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-[#848E9C]">Trading Fee</span>
            <span className="text-[#848E9C] font-bold tracking-tighter italic">0% Maker / 0.1% Taker</span>
          </div>
        </div>

        {/* Validation Errors */}
        <AnimatePresence>
          {validation.errors.length > 0 && quantity && parseFloat(quantity) > 0 && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mx-3 mb-2 p-2 bg-red-900/10 border border-red-500/20 rounded-md"
            >
              {validation.errors.map((err, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px] text-red-400 font-bold">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  {err}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submission Button */}
        <div className="p-3 pt-0">
          <Button
            type="submit"
            disabled={loading || !validation.isValid}
            className={cn(
              "w-full h-12 text-sm font-black transition-all duration-300 shadow-xl active:scale-[0.98] border border-white/5",
              orderType === 'BUY'
                ? "bg-[#0ECB81] hover:bg-[#0fdc8c] text-white shadow-[#0ECB81]/10"
                : "bg-[#F6465D] hover:bg-[#ff5169] text-white shadow-[#F6465D]/10"
            )}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {orderMode === 'STOP_LOSS' ? 'STAKING...' : 'PLACING...'}
              </span>
            ) : (
              <span className="uppercase tracking-[2px]">
                {orderMode === 'STOP_LOSS' 
                  ? `Set Stop-Loss ${orderType}` 
                  : `${orderType} ${baseToken}`}
              </span>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
