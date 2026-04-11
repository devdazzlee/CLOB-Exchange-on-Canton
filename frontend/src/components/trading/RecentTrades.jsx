import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Recent Trades Component - Displays recent executed trades
 */
export default function RecentTrades({ trades, tradingPair, loading }) {
  // Format timestamp: HH:MM:SS is better for "recent" trades than full date
  const formatTime = (timestamp) => {
    if (!timestamp) return '--';
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch {
      return '--';
    }
  };

  // Sort trades by timestamp (most recent first)
  const sortedTrades = [...(trades || [])]
    .sort((a, b) => {
      const timeA = new Date(a.timestamp || a.createdAt || 0).getTime();
      const timeB = new Date(b.timestamp || b.createdAt || 0).getTime();
      return timeB - timeA;
    })
    .slice(0, 50);

  return (
    <div className="flex flex-col h-full bg-[#0E1116]">
      {/* Column headers - using Grid for perfect alignment */}
      <div className="grid grid-cols-[1fr_85px_85px] items-center px-4 py-2 border-b border-[#21262d] flex-shrink-0 bg-transparent">
        <span className="text-[11px] text-[#848E9C] font-semibold tracking-wide">Price</span>
        <span className="text-right text-[11px] text-[#848E9C] font-semibold tracking-wide">Amount</span>
        <span className="text-right text-[11px] text-[#848E9C] font-semibold tracking-wide">Time</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-[#848E9C] text-xs animate-pulse font-medium">Loading market data...</div>
        </div>
      ) : sortedTrades.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[#848E9C] text-xs font-medium italic">
          No recent trades found
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
          <AnimatePresence initial={false}>
            {sortedTrades.map((trade, idx) => {
              const price = parseFloat(trade.price || 0);
              const quantity = parseFloat(trade.quantity || 0);
              const isBuy = trade.buyer === trade.partyId;
              
              return (
                <motion.div
                  key={trade.tradeId || trade.contractId || idx}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="grid grid-cols-[1fr_85px_85px] items-center px-4 py-2 hover:bg-[#161b22] transition-all border-b border-[#21262d]/20 last:border-0 relative group"
                >
                  <span className={cn("text-[13px] font-mono font-bold", isBuy ? "text-[#00b07b]" : "text-[#f84962]")}>
                    {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </span>
                  <span className="text-right text-[13px] font-mono text-[#EAECEF] font-medium">
                    {quantity.toFixed(4)}
                  </span>
                  <span className="text-right text-[12px] font-mono text-[#848E9C] group-hover:text-white transition-colors">
                    {formatTime(trade.timestamp || trade.createdAt)}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

