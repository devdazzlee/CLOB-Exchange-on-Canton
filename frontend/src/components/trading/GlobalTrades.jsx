import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import websocketService from '../../services/websocketService';
import { cn } from '@/lib/utils';

/**
 * GlobalTrades Component - Shows ALL trades across ALL users (global view)
 * Like Binance's "Recent Trades" panel
 */
export default function GlobalTrades({ tradingPair, limit = 50 }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load trades from backend
  const loadTrades = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 
        (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
      const url = tradingPair
        ? `${API_BASE}/orderbooks/${encodeURIComponent(tradingPair)}/trades?limit=${limit}`
        : `${API_BASE}/trades?limit=${limit}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch trades: ${response.statusText}`);
      }

      const data = await response.json().catch(() => ({}));
      const payload = data?.data ?? data;
      const nextTrades = payload?.trades || [];
      setTrades(nextTrades);
    } catch (err) {
      console.error('[GlobalTrades] Error loading trades:', err);
      setError(err.message);
      setTrades([]);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadTrades();
    
    // Set up polling for new trades (every 30 seconds)
    const pollInterval = setInterval(() => {
      loadTrades();
    }, 30000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [tradingPair, limit]);

  // Subscribe to WebSocket for real-time trade updates
  useEffect(() => {
    if (!websocketService.isConnected()) {
      websocketService.connect();
    }

    const handleTradeUpdate = (data) => {
      // Check if this trade is for our trading pair (or all pairs if no filter)
      if (!tradingPair || data.tradingPair === tradingPair) {
        setTrades(prev => {
          // Add new trade at the beginning, remove duplicates, limit to 50
          const newTrades = [data, ...prev.filter(t => t.tradeId !== data.tradeId)];
          return newTrades.slice(0, limit);
        });
      }
    };

    // Subscribe to trades channel
    const channel = tradingPair ? `trades:${tradingPair}` : 'trades:all';
    websocketService.subscribe(channel, handleTradeUpdate);

    return () => {
      websocketService.unsubscribe(channel, handleTradeUpdate);
    };
  }, [tradingPair, limit]);

  // Format time
  const formatTime = (timestamp) => {
    if (!timestamp) return '--';
    try {
      const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp * 1000);
      const now = new Date();
      const diffMs = now - date;
      const diffSecs = Math.floor(diffMs / 1000);
      
      if (diffSecs < 60) return `${diffSecs}s ago`;
      if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
      if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return '--';
    }
  };

  // Sort trades by timestamp (most recent first)
  const sortedTrades = [...trades]
    .sort((a, b) => {
      const timeA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : (a.timestamp || 0);
      const timeB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : (b.timestamp || 0);
      return timeB - timeA;
    })
    .slice(0, limit);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Recent Trades {tradingPair ? `- ${tradingPair}` : '(All Pairs)'}</span>
          {trades.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Live
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && trades.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse text-muted-foreground text-sm">Loading trades...</div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-8 text-destructive text-sm">
            Error: {error}
          </div>
        ) : sortedTrades.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            No trades yet
          </div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {/* Header */}
            <div className="grid grid-cols-4 gap-4 pb-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide sticky top-0 bg-background">
              <div>Price</div>
              <div className="text-right">Amount</div>
              <div className="text-right">Total</div>
              <div className="text-right">Time</div>
            </div>

            {/* Trades List */}
            <AnimatePresence>
              {sortedTrades.map((trade, idx) => {
                const price = parseFloat(trade.price || 0);
                const quantity = parseFloat(trade.quantity || 0);
                const total = price * quantity;
                const isBuy = trade.side === 'BUY' || trade.buyer; // Determine side
                
                return (
                  <motion.div
                    key={trade.tradeId || idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      "grid grid-cols-4 gap-4 py-1.5 px-2 rounded hover:bg-card transition-colors",
                      idx % 2 === 0 && "bg-background/50"
                    )}
                  >
                    <div className={cn(
                      "font-mono font-semibold flex items-center space-x-1 text-sm",
                      isBuy ? "text-green-500" : "text-red-500"
                    )}>
                      {isBuy ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                      <span>${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</span>
                    </div>
                    <div className="text-right text-foreground font-mono text-sm">
                      {quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                    </div>
                    <div className="text-right text-muted-foreground font-mono text-sm">
                      ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-right text-muted-foreground text-xs">
                      {formatTime(trade.timestamp)}
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

