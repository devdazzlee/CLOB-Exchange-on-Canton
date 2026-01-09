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
      <CardHeader>
        <CardTitle>Recent Trades - {tradingPair}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse text-muted-foreground text-sm">Loading trades...</div>
          </div>
        ) : sortedTrades.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            No recent trades
          </div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            <div className="grid grid-cols-4 gap-4 pb-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <div>Price</div>
              <div className="text-right">Amount</div>
              <div className="text-right">Total</div>
              <div className="text-right">Time</div>
            </div>
            <AnimatePresence>
              {sortedTrades.map((trade, idx) => {
                const price = parseFloat(trade.price || 0);
                const quantity = parseFloat(trade.quantity || 0);
                const total = price * quantity;
                const isBuy = trade.buyer === trade.partyId; // Assuming we have partyId in context
                
                return (
                  <motion.div
                    key={trade.tradeId || trade.contractId || idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      "grid grid-cols-4 gap-4 py-2 px-2 rounded hover:bg-card transition-colors",
                      idx % 2 === 0 && "bg-background/50"
                    )}
                  >
                    <div className={cn(
                      "font-mono font-semibold flex items-center space-x-1",
                      isBuy ? "text-success" : "text-destructive"
                    )}>
                      {isBuy ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                      <span>{price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</span>
                    </div>
                    <div className="text-right text-foreground font-mono text-sm">
                      {quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                    </div>
                    <div className="text-right text-muted-foreground font-mono text-sm">
                      {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-right text-muted-foreground text-xs">
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

