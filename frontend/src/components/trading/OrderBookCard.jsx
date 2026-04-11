import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, RefreshCw, Loader2, Globe, CheckCircle2, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../../lib/utils';

/**
 * OrderBookCard - Displays the GLOBAL order book with aggregation and view modes.
 */
export default function OrderBookCard({ 
  tradingPair, 
  orderBook, 
  loading, 
  onRefresh,
  userOrders = [],
  availablePairs = [],
  onTradingPairChange
}) {
  const [viewMode, setViewMode] = useState('both'); // 'both', 'sell', 'buy'
  const [aggregation, setAggregation] = useState('0.001');

  // Helper to aggregate orders by price at a certain precision
  const aggregateOrders = (orders, precision) => {
    const step = parseFloat(precision);
    const groups = {};
    
    for (const o of (orders || [])) {
      const price = parseFloat(o.price || 0);
      if (!price) continue;
      
      const decimals = precision.includes('.') ? precision.split('.')[1].length : 0;
      const roundedPriceVal = Math.floor(price / step) * step;
      const roundedPrice = roundedPriceVal.toFixed(decimals);
      
      const qty = parseFloat(o.remaining || o.quantity || 0);
      
      if (!groups[roundedPrice]) {
        groups[roundedPrice] = { price: roundedPrice, remaining: 0 };
      }
      groups[roundedPrice].remaining += qty;
    }
    
    return Object.values(groups);
  };

  const aggregatedBuys = useMemo(() => 
    aggregateOrders(orderBook?.buys || [], aggregation)
      .sort((a, b) => parseFloat(b.price) - parseFloat(a.price)),
    [orderBook?.buys, aggregation]
  );

  const aggregatedSells = useMemo(() => 
    aggregateOrders(orderBook?.sells || [], aggregation)
      .sort((a, b) => parseFloat(a.price) - parseFloat(b.price)),
    [orderBook?.sells, aggregation]
  );

  const myOrdersByPrice = useMemo(() => {
    const map = {};
    for (const o of userOrders) {
      if (o.status !== 'OPEN' || o.tradingPair !== tradingPair) continue;
      const side = (o.type || '').toUpperCase();
      const p = parseFloat(o.price || 0);
      if (!p) continue;
      
      const step = parseFloat(aggregation);
      const decimals = aggregation.includes('.') ? aggregation.split('.')[1].length : 0;
      const roundedPrice = (Math.floor(p / step) * step).toFixed(decimals);
      
      const key = `${side}|${roundedPrice}`;
      if (!map[key]) map[key] = true;
    }
    return map;
  }, [userOrders, tradingPair, aggregation]);

  const getMyInfo = (price, side) => myOrdersByPrice[`${side}|${price}`] || null;

  const calculateDepth = (orders) => {
    let cumulative = 0;
    return orders.map(order => {
      cumulative += order.remaining;
      return { ...order, cumulative };
    });
  };

  const buyOrdersWithDepth = useMemo(() => calculateDepth(aggregatedBuys), [aggregatedBuys]);
  const sellOrdersWithDepth = useMemo(() => calculateDepth(aggregatedSells), [aggregatedSells]);
  
  const maxDepth = Math.max(
    buyOrdersWithDepth.length > 0 ? buyOrdersWithDepth[buyOrdersWithDepth.length - 1]?.cumulative || 0 : 0,
    sellOrdersWithDepth.length > 0 ? sellOrdersWithDepth[sellOrdersWithDepth.length - 1]?.cumulative || 0 : 0,
    1
  );

  const sortedRawBuys = [...(orderBook?.buys || [])].sort((a, b) => parseFloat(b.price || 0) - parseFloat(a.price || 0));
  const sortedRawSells = [...(orderBook?.sells || [])].sort((a, b) => parseFloat(a.price || 0) - parseFloat(b.price || 0));
  const bestBid = sortedRawBuys.length > 0 ? parseFloat(sortedRawBuys[0]?.price || 0) : 0;
  const bestAsk = sortedRawSells.length > 0 ? parseFloat(sortedRawSells[0]?.price || 0) : 0;
  const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;
  const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0;

  const sellsReversed = [...sellOrdersWithDepth].reverse();
  
  const displaySells = viewMode === 'buy' ? [] : (viewMode === 'sell' ? sellsReversed : sellsReversed.slice(-15));
  const displayBuys = viewMode === 'sell' ? [] : (viewMode === 'buy' ? buyOrdersWithDepth : buyOrdersWithDepth.slice(0, 15));

  return (
    <div className="flex flex-col h-full bg-[#0E1116] overflow-hidden">
      {/* Top Filter Controls - Matching Reference */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0A0D10] border-b border-[#21262d] flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* Layout Buttons (custom icons imitating the image) */}
          <button 
            onClick={() => setViewMode('both')}
            className={cn("p-1.5 rounded transition-all flex flex-col gap-[2px] items-center justify-center", viewMode === 'both' ? "bg-[#21262d]" : "hover:bg-[#1e2329]")}
          >
            <div className="w-3 h-1 bg-[#F6465D] rounded-sm" />
            <div className="w-3 h-1 bg-[#0ECB81] rounded-sm" />
          </button>
          <button 
            onClick={() => setViewMode('sell')}
            className={cn("p-1.5 rounded transition-all flex flex-col gap-[2px] items-center justify-center", viewMode === 'sell' ? "bg-[#21262d]" : "hover:bg-[#1e2329]")}
          >
            <div className="w-3 h-1 bg-[#F6465D] rounded-sm" />
            <div className="w-3 h-1 bg-[#F6465D] rounded-sm" />
          </button>
          <button 
            onClick={() => setViewMode('buy')}
            className={cn("p-1.5 rounded transition-all flex flex-col gap-[2px] items-center justify-center", viewMode === 'buy' ? "bg-[#21262d]" : "hover:bg-[#1e2329]")}
          >
            <div className="w-3 h-1 bg-[#0ECB81] rounded-sm" />
            <div className="w-3 h-1 bg-[#0ECB81] rounded-sm" />
          </button>
        </div>
        
         <div className="flex items-center gap-3">
           {/* Pair Select - Functional */}
           <div className="min-w-fit relative z-[60]">
              <Select value={tradingPair} onValueChange={onTradingPairChange}>
                 <SelectTrigger className="h-7 w-full bg-transparent border-0 hover:bg-[#1e2329] text-[11px] font-bold px-1 rounded-md shadow-none focus:ring-0 gap-1 text-[#848E9C] hover:text-white transition-colors">
                    <SelectValue>
                       {tradingPair.split('/')[0] || 'LIT'}
                    </SelectValue>
                 </SelectTrigger>
                 <SelectContent 
                   sideOffset={4} 
                   collisionPadding={12} 
                   className="bg-[#1e2329] border-[#2B3139] min-w-[120px] shadow-2xl"
                 >
                   {availablePairs?.map(p => (
                     <SelectItem key={p} value={p} className="text-[11px] font-bold cursor-pointer focus:bg-[#2b3139]">
                       {p.split('/')[0]}
                     </SelectItem>
                   ))}
                 </SelectContent>
              </Select>
           </div>
           {/* Aggregation Select */}
           <div className="w-[82px] relative z-[60]">
             <Select value={aggregation} onValueChange={setAggregation}>
                <SelectTrigger className="h-7 w-full bg-transparent border-0 hover:bg-[#1e2329] text-[11px] font-bold px-2 rounded-md shadow-none focus:ring-0 gap-1">
                   <SelectValue placeholder="Prec" />
                </SelectTrigger>
                <SelectContent className="bg-[#1e2329] border-[#2B3139]">
                  {['0.0001', '0.001', '0.01', '0.1', '1', '10'].map(val => (
                    <SelectItem key={val} value={val} className="text-[11px] font-bold">{val}</SelectItem>
                  ))}
                </SelectContent>
             </Select>
          </div>
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-4 py-2 border-b border-[#21262d] bg-[#0E1116] flex-shrink-0">
        <span className="flex-1 text-[11px] text-[#848E9C] font-semibold tracking-wide">Price</span>
        <div className="w-24 text-right flex items-center justify-end gap-1.5">
          <span className="text-[11px] text-[#848E9C] font-semibold tracking-wide">Size</span>
          <span className="text-[9px] text-[#848E9C] bg-[#1e2329] border border-[#2B3139] px-1 rounded font-bold">{tradingPair.split('/')[0] || 'LIT'}</span>
        </div>
        <span className="w-24 text-right text-[11px] text-[#848E9C] font-semibold tracking-wide">Total</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-[#F7B500]" />
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0d10]">
          {/* Sell orders (red) */}
          <div className={cn("overflow-y-auto flex flex-col justify-end min-h-0 custom-scrollbar", viewMode === 'both' ? 'flex-1' : viewMode === 'sell' ? 'flex-[2]' : 'hidden')}>
            {displaySells.length > 0 ? displaySells.map((order, i) => {
              const depthPercent = maxDepth > 0 ? (order.cumulative / maxDepth) * 100 : 0;
              const priceNum = parseFloat(order.price);
              const qty = order.remaining;
              const total = priceNum * qty;
              return (
                <div
                  key={i}
                  className="flex items-center px-4 py-[3px] hover:bg-[#F6465D]/10 cursor-pointer relative"
                  style={{ background: `linear-gradient(to right, rgba(246,70,93,0.15) ${depthPercent}%, transparent ${depthPercent}%)` }}
                >
                  <span className="flex-1 text-[12px] font-mono font-medium text-[#F6465D]">
                    {priceNum.toFixed(aggregation.includes('.') ? aggregation.split('.')[1].length : 0)}
                  </span>
                  <span className="w-24 text-right text-[12px] font-mono text-[#EAECEF] font-medium">{qty.toFixed(2)}</span>
                  <span className="w-24 text-right text-[12px] font-mono text-[#B7BDC6]">
                    {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              );
            }) : (
              <div className="py-8 text-center text-[#848E9C] text-xs font-medium">No sell orders</div>
            )}
          </div>

          {/* Spread Bar */}
          <div className="flex items-center px-4 py-[5px] bg-[#161a20] border-y border-[#21262d] flex-shrink-0">
            <span className={`flex-1 text-[13px] font-bold font-mono ${spread > 0 ? 'text-white' : 'text-[#848E9C]'}`}>
              {spread.toFixed(4)}
            </span>
            <span className="w-24 text-center text-[11px] text-[#848E9C] font-semibold">Spread</span>
            <span className="w-24 text-right text-[12px] text-white font-bold font-mono">
              {spreadPercent.toFixed(3)}%
            </span>
          </div>

          {/* Buy orders (green) */}
          <div className={cn("overflow-y-auto min-h-0 custom-scrollbar", viewMode === 'both' ? 'flex-1' : viewMode === 'buy' ? 'flex-[2]' : 'hidden')}>
            {displayBuys.length > 0 ? displayBuys.map((order, i) => {
              const depthPercent = maxDepth > 0 ? (order.cumulative / maxDepth) * 100 : 0;
              const priceNum = parseFloat(order.price);
              const qty = order.remaining;
              const total = priceNum * qty;
              return (
                <div
                  key={i}
                  className="flex items-center px-4 py-[3px] hover:bg-[#0ECB81]/10 cursor-pointer relative"
                  style={{ background: `linear-gradient(to right, rgba(14,203,129,0.15) ${depthPercent}%, transparent ${depthPercent}%)` }}
                >
                  <span className="flex-1 text-[12px] font-mono font-medium text-[#0ECB81]">
                    {priceNum.toFixed(aggregation.includes('.') ? aggregation.split('.')[1].length : 0)}
                  </span>
                  <span className="w-24 text-right text-[12px] font-mono text-[#EAECEF] font-medium">{qty.toFixed(2)}</span>
                  <span className="w-24 text-right text-[12px] font-mono text-[#B7BDC6]">
                    {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              );
            }) : (
              <div className="py-8 text-center text-[#848E9C] text-xs font-medium">No buy orders</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
