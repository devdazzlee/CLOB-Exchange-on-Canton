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
    <div className="flex flex-col bg-[#0E1116] h-full overflow-y-auto scrollbar-thin transition-all">
      {/* Order Mode tabs - Underline Tab Style Matching Reference */}
      <div className="flex items-stretch border-b border-[#21262d] flex-shrink-0 bg-[#06080A]">
        {['MARKET', 'LIMIT', 'STOP_LOSS'].map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => onOrderModeChange({ target: { value: mode } })}
            className={cn(
              "flex-1 py-3.5 text-[14px] font-normal transition-all duration-200 relative",
              orderMode === mode 
                ? "bg-[#101418] text-white" 
                : "text-[#B7BDC6] hover:text-white"
            )}
          >
            {mode === 'STOP_LOSS' ? 'Stop-Loss' : mode.charAt(0) + mode.slice(1).toLowerCase()}
            {orderMode === mode && (
              <span className="absolute bottom-[-1px] left-0 right-0 h-[3px] bg-[#626AEB] rounded-t-sm" />
            )}
          </button>
        ))}
      </div>

      {/* Buy / Sell Toggles matching reference */}
      <div className="flex border-b border-[#21262d]">
         <button
            type="button"
            onClick={() => onOrderTypeChange({ target: { value: 'BUY' } })}
            className={cn(
               "flex-1 py-[11px] text-[14px] font-normal transition-all duration-200",
               orderType === 'BUY' ? "bg-[#126127] text-white" : "bg-transparent text-[#EAECEF] hover:bg-white/5"
            )}
         >
            Buy
         </button>
         <button
            type="button"
            onClick={() => onOrderTypeChange({ target: { value: 'SELL' } })}
            className={cn(
               "flex-1 py-[11px] text-[14px] font-normal transition-all duration-200",
               orderType === 'SELL' ? "bg-[#7A1A22] text-white" : "bg-transparent text-[#EAECEF] hover:bg-white/5"
            )}
         >
            Sell
         </button>
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
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="text-[#848E9C] text-[12px] font-semibold">Available to Trade</span>
          <span className="text-white text-[12px] font-mono">
            {orderType === 'BUY'
              ? quoteBalance > 0 ? `${formatNumber(quoteBalance, 4)} ${quoteToken}` : '-'
              : baseBalance > 0 ? `${formatNumber(baseBalance, 8)} ${baseToken}` : '-'}
          </span>
        </div>

        {/* Input Fields Container */}
        <div className="px-4 pb-3 space-y-2">
          {orderMode === 'LIMIT' && (
            <div className="flex flex-col gap-2">
               <div className="flex items-center justify-between bg-[#131518] rounded-[6px] px-3 h-10 border border-[#1e2329] focus-within:border-[#2b3139] transition-colors">
                 <span className="text-[#848E9C] text-[12px] whitespace-nowrap font-medium">Limit Price</span>
                 <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                   <input
                     type="text"
                     value={price}
                     onChange={(e) => {
                       let val = e.target.value.replace(/[^0-9.]/g, '');
                       if (val.length > 1 && val.startsWith('0') && val[1] !== '.') {
                         val = val.substring(1);
                       }
                       onPriceChange(val);
                     }}
                     placeholder="0.00"
                     className="bg-transparent text-white text-right text-[13px] font-mono font-medium flex-1 min-w-0 outline-none focus:ring-0 p-0 shadow-none border-none"
                   />
                   <button 
                     type="button" 
                     onClick={() => onPriceChange(midPrice?.toFixed(4) || '0')} 
                     className="text-[#626AEB] text-[12px] font-bold ml-1.5 flex items-center shrink-0 hover:text-[#7d85f5] transition-colors"
                   >
                     Mid
                   </button>
                 </div>
               </div>
            </div>
          )}

          {/* Amount Field */}
          <div className="flex flex-col gap-2">
             <div className="flex items-center justify-between bg-[#131518] rounded-[6px] px-3 h-10 border border-[#1e2329] focus-within:border-[#2b3139] transition-colors">
               <span className="text-[#848E9C] text-[12px] whitespace-nowrap font-medium">Amount</span>
               <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                 <input
                   type="text"
                   value={quantity}
                   onChange={(e) => {
                     let val = e.target.value.replace(/[^0-9.]/g, '');
                     if (val.length > 1 && val.startsWith('0') && val[1] !== '.') {
                       val = val.substring(1);
                     }
                     onQuantityChange(val);
                   }}
                   placeholder="0.00"
                   className="bg-transparent text-[#EAECEF] text-right text-[13px] font-mono font-medium flex-1 min-w-0 outline-none focus:ring-0 p-0 shadow-none border-none"
                 />
                  <div className="min-w-fit flex items-center pr-1 border-l border-[#21262d] pl-2 ml-2 h-5">
                    <Select value={tradingPair} onValueChange={onTradingPairChange}>
                      <SelectTrigger className="h-full bg-transparent border-0 ring-0 focus:ring-0 text-[#EAECEF] font-bold text-[12px] p-0 hover:bg-transparent shadow-none gap-1">
                        <SelectValue>
                          {baseToken}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent 
                        align="end" 
                        sideOffset={4} 
                        collisionPadding={12} 
                        className="bg-[#1e2329] border-[#2B3139] z-[100] min-w-[120px] shadow-2xl"
                      >
                        {availablePairs?.map(p => (
                          <SelectItem key={p} value={p} className="text-[12px] font-semibold cursor-pointer focus:bg-[#2b3139]">
                            {p.split('/')[0]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
               </div>
             </div>
          </div>

          {/* Percent Slider & Buttons */}
          <div className="pt-3 pb-1 flex items-center gap-4">
             <div className="flex-1 relative h-6 flex items-center group cursor-pointer" onClick={(e) => {
                 const rect = e.currentTarget.getBoundingClientRect();
                 const pct = Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
                 handlePercentage([pct]);
             }}>
                 {/* Track Base */}
                 <div className="absolute left-0 right-0 h-[3px] bg-[#1a1e24] rounded-sm" />
                 {/* Stops */}
                 {[0, 25, 50, 75, 100].map(pt => (
                    <div key={pt} className="absolute h-2 w-px bg-[#2B3139]" style={{ left: `${pt}%` }} />
                 ))}
                 {/* Filled Progress */}
                 <div className="absolute left-0 h-[3px] rounded-sm pointer-events-none" style={{ width: `${sliderPct}%`, backgroundColor: orderType === 'BUY' ? '#118a36' : '#d13c51' }} />
                 {/* Thumb */}
                 <div className="absolute w-[5px] h-[14px] rounded-[1px] transition-all -ml-[2px] pointer-events-none" style={{ left: `${sliderPct}%`, backgroundColor: orderType === 'BUY' ? '#21d167' : '#ff4f68' }} />
             </div>
             {/* Text Box */}
             <div className="flex items-center justify-center gap-1.5 px-2 py-0.5 bg-[#131518] rounded-[4px] border border-[#21262d] min-w-[45px]">
                <span className="text-white text-[12px] font-semibold">{Math.round(sliderPct)}</span>
                <span className="text-white text-[12px] font-semibold">%</span>
             </div>
          </div>
        </div>

        {/* Advanced Section */}
        <div className="px-4 pt-1 pb-4">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 mb-4 group"
          >
            <span className="text-[12px] font-semibold text-white group-hover:text-[#EAECEF]">Advanced</span>
            <ChevronDown className={cn("w-3 h-3 text-[#B7BDC6] transition-transform duration-300", showAdvanced && "rotate-180")} strokeWidth={3} />
          </button>
          
          {showAdvanced && (
            <div className="space-y-1.5 pr-2">
               <div className="flex justify-between items-center text-[12px]">
                  <span className="text-[#848E9C] font-medium">Order Size</span>
                  <span className="text-[#EAECEF] font-medium">-</span>
               </div>
               <div className="flex justify-between items-center text-[12px]">
                  <span className="text-[#848E9C] font-medium">Order Value</span>
                  <span className="text-[#EAECEF] font-medium">-</span>
               </div>
               <div className="flex justify-between items-center text-[12px]">
                  <span className="text-[#848E9C] font-medium">Limit Price</span>
                  <span className="text-white font-mono font-medium">{price || '-'}</span>
               </div>
               <div className="flex justify-between items-center text-[12px]">
                  <span className="text-[#848E9C] font-medium">Fees</span>
                  <span className="text-white font-medium text-[11px]">Taker: 0% <span className="text-[#848E9C] mx-0.5">|</span> Maker: 0%</span>
               </div>
            </div>
          )}
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
        <div className="px-4 pb-4 pt-1 mt-auto">
          <Button
            type="submit"
            disabled={loading || !validation.isValid}
            className={cn(
              "w-full h-12 rounded-[10px] text-[15px] font-normal transition-all duration-300",
              orderType === 'BUY'
                ? "bg-[#0A5F20] hover:bg-[#0e7529] text-white border border-[#20c25a]/10"
                : "bg-[#7A1A22] hover:bg-[#96202a] text-white border border-[#e84153]/10"
            )}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing
              </span>
            ) : (
              <span>{orderType === 'BUY' ? 'Buy' : 'Sell'}</span>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
