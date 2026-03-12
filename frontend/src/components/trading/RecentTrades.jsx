import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Recent Trades Component - Displays recent executed trades
 */
export default function RecentTrades({ trades, tradingPair, loading }) {
  // Format timestamp
  const formatTime = (timestamp) => {
    if (!timestamp) return '--';
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffSecs = Math.floor(diffMs / 1000);
      
      if (diffSecs < 60) return `${diffSecs}s ago`;
      if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
      if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
      return date.toLocaleDateString();
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
    .slice(0, 50); // Limit to 50 most recent

  return (
    <Card>
      <CardHeader className="px-3 sm:px-6">
        <CardTitle className="text-sm sm:text-base">Recent Trades - {tradingPair}</CardTitle>
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        {loading ? (
          <div className="flex items-center justify-center py-6 sm:py-8">
            <div className="animate-pulse text-muted-foreground text-xs sm:text-sm">Loading trades...</div>
          </div>
        ) : sortedTrades.length === 0 ? (
          <div className="flex items-center justify-center py-6 sm:py-8 text-muted-foreground text-xs sm:text-sm">
            No recent trades
          </div>
        ) : (
          <div className="space-y-0.5 sm:space-y-1 max-h-72 sm:max-h-96 overflow-y-auto">
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-4 pb-2 border-b border-border text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <div>Price</div>
              <div className="text-right">Amount</div>
              <div className="text-right hidden sm:block">Total</div>
              <div className="text-right">Time</div>
            </div>
            <AnimatePresence>
              {sortedTrades.map((trade, idx) => {
                const price = parseFloat(trade.price || 0);
                const quantity = parseFloat(trade.quantity || 0);
                const total = price * quantity;
                const isBuy = trade.buyer === trade.partyId;
                
                return (
                  <motion.div
                    key={trade.tradeId || trade.contractId || idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      "grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-4 py-1.5 sm:py-2 px-1 sm:px-2 rounded hover:bg-card transition-colors",
                      idx % 2 === 0 && "bg-background/50"
                    )}
                  >
                    <div className={cn(
                      "font-mono font-semibold flex items-center space-x-0.5 sm:space-x-1 text-[11px] sm:text-sm",
                      isBuy ? "text-success" : "text-destructive"
                    )}>
                      {isBuy ? (
                        <TrendingUp className="w-2.5 h-2.5 sm:w-3 sm:h-3 flex-shrink-0" />
                      ) : (
                        <TrendingDown className="w-2.5 h-2.5 sm:w-3 sm:h-3 flex-shrink-0" />
                      )}
                      <span className="truncate">{price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                    </div>
                    <div className="text-right text-foreground font-mono text-[11px] sm:text-sm truncate">
                      {quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </div>
                    <div className="text-right text-muted-foreground font-mono text-[11px] sm:text-sm hidden sm:block">
                      {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-right text-muted-foreground text-[10px] sm:text-xs">
                      {formatTime(trade.timestamp || trade.createdAt)}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

