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
  userOrders = []
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
    <div className="flex flex-col h-full bg-card overflow-hidden">
      {/* Top Filter Controls - Segmented Style */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 bg-[#0d1117]/50 flex-shrink-0">
        <div className="flex items-center gap-1 py-0.5 px-2 bg-[#0d1117] border border-[#2B3139] rounded-lg">
          <button 
            onClick={() => setViewMode('sell')}
            className={cn(
              "p-1.5 rounded transition-all duration-200", 
              viewMode === 'sell' 
                ? "bg-[#2b3139] text-[#f84962] border border-[#3A4149] shadow-inner" 
                : "text-muted-foreground hover:bg-white/5 hover:text-white"
            )}
            title="Sell Orders Only"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><rect x="3" y="3" width="18" height="6" rx="1"/><rect x="3" y="15" width="18" height="6" rx="1" opacity="0.3"/></svg>
          </button>
          <button 
            onClick={() => setViewMode('both')}
            className={cn(
              "p-1.5 rounded transition-all duration-200", 
              viewMode === 'both' 
                ? "bg-[#2b3139] text-white border border-[#3A4149] shadow-inner" 
                : "text-muted-foreground hover:bg-white/5 hover:text-white"
            )}
            title="Both Sides"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><rect x="3" y="3" width="18" height="6" rx="1"/><rect x="3" y="15" width="18" height="6" rx="1"/></svg>
          </button>
          <button 
            onClick={() => setViewMode('buy')}
            className={cn(
              "p-1.5 rounded transition-all duration-200", 
              viewMode === 'buy' 
                ? "bg-[#2b3139] text-[#00b07b] border border-[#3A4149] shadow-inner" 
                : "text-muted-foreground hover:bg-white/5 hover:text-white"
            )}
            title="Buy Orders Only"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><rect x="3" y="3" width="18" height="6" rx="1" opacity="0.3"/><rect x="3" y="15" width="18" height="6" rx="1"/></svg>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#848E9C] font-bold uppercase tracking-widest hidden sm:inline">Aggregation</span>
          <div className="w-[80px] sm:w-[90px] relative z-[60]">
             <Select value={aggregation} onValueChange={setAggregation}>
                <SelectTrigger className="h-7 w-full bg-[#1e2329] border-[#F7B500] hover:border-[#F7B500] text-[11px] font-bold rounded-full px-2 shadow-sm">
                   <SelectValue placeholder="Precision" />
                </SelectTrigger>
                <SelectContent className="bg-[#1e2329] border-[#2B3139]">
                  {['0.001', '0.01', '0.1', '1', '10', '50', '100'].map(val => (
                    <SelectItem key={val} value={val} className="text-[11px] font-bold">{val}</SelectItem>
                  ))}
                </SelectContent>
             </Select>
          </div>
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-4 py-2 border-b border-border/50 bg-[#161b22]/50 flex-shrink-0">
        <span className="flex-1 text-[11px] text-[#848E9C] font-bold uppercase tracking-widest">Price</span>
        <span className="w-24 text-right text-[11px] text-[#848E9C] font-bold uppercase tracking-widest">Quantity</span>
        <span className="w-24 text-right text-[11px] text-[#848E9C] font-bold uppercase tracking-widest">Total</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Sell orders (red) */}
          <div className={cn("overflow-y-auto flex flex-col justify-end min-h-0 custom-scrollbar", viewMode === 'both' ? 'flex-1' : viewMode === 'sell' ? 'flex-[2]' : 'hidden')}>
            {displaySells.length > 0 ? displaySells.map((order, i) => {
              const depthPercent = maxDepth > 0 ? (order.cumulative / maxDepth) * 100 : 0;
              const myInfo = getMyInfo(order.price, 'SELL');
              const priceNum = parseFloat(order.price);
              const qty = order.remaining;
              const total = priceNum * qty;
              return (
                <div
                  key={i}
                  className="flex items-center px-4 py-[5px] hover:bg-red-500/5 cursor-pointer relative group transition-colors"
                  style={{ background: `linear-gradient(to left, rgba(248,73,96,0.12) ${depthPercent}%, transparent ${depthPercent}%)` }}
                >
                  <span className={cn("flex-1 text-[13px] font-mono font-bold", myInfo ? "text-primary" : "text-[#f84962]")}>
                    {priceNum.toFixed(aggregation.includes('.') ? aggregation.split('.')[1].length : 0)}
                    {myInfo && <span className="ml-1 text-[10px] text-primary">●</span>}
                  </span>
                  <span className="w-24 text-right text-[13px] font-mono text-white font-medium">{qty.toFixed(4)}</span>
                  <span className="w-24 text-right text-[13px] font-mono text-[#848E9C]">
                    {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              );
            }) : (
              <div className="py-8 text-center text-muted-foreground text-xs font-medium italic">No sell orders</div>
            )}
          </div>

          {/* Spread Bar */}
          <div className="flex items-center px-4 py-2 bg-[#161b22] border-y border-border/80 flex-shrink-0">
            <div className="flex-1 flex items-baseline gap-2">
               <span className={`text-[14px] font-bold font-mono ${spread > 0 ? 'text-white' : 'text-muted-foreground/50'}`}>
                {spread.toFixed(4)}
               </span>
               <span className="text-[10px] text-[#848E9C] font-bold uppercase tracking-tight">Spread</span>
            </div>
            <div className="text-[11px] text-[#00b07b] font-bold bg-[#00b07b]/10 px-2 py-0.5 rounded border border-[#00b07b]/20">
              {spreadPercent.toFixed(3)}%
            </div>
          </div>

          {/* Buy orders (green) */}
          <div className={cn("overflow-y-auto min-h-0 custom-scrollbar", viewMode === 'both' ? 'flex-1' : viewMode === 'buy' ? 'flex-[2]' : 'hidden')}>
            {displayBuys.length > 0 ? displayBuys.map((order, i) => {
              const depthPercent = maxDepth > 0 ? (order.cumulative / maxDepth) * 100 : 0;
              const myInfo = getMyInfo(order.price, 'BUY');
              const priceNum = parseFloat(order.price);
              const qty = order.remaining;
              const total = priceNum * qty;
              return (
                <div
                  key={i}
                  className="flex items-center px-4 py-[5px] hover:bg-green-500/5 cursor-pointer relative group transition-colors"
                  style={{ background: `linear-gradient(to left, rgba(0,176,123,0.12) ${depthPercent}%, transparent ${depthPercent}%)` }}
                >
                  <span className={cn("flex-1 text-[13px] font-mono font-bold", myInfo ? "text-primary" : "text-[#00b07b]")}>
                    {priceNum.toFixed(aggregation.includes('.') ? aggregation.split('.')[1].length : 0)}
                    {myInfo && <span className="ml-1 text-[10px] text-primary">●</span>}
                  </span>
                  <span className="w-24 text-right text-[13px] font-mono text-white font-medium">{qty.toFixed(4)}</span>
                  <span className="w-24 text-right text-[13px] font-mono text-[#848E9C]">
                    {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              );
            }) : (
              <div className="py-8 text-center text-muted-foreground text-xs font-medium italic">No buy orders</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
