import { TrendingUp, TrendingDown, BarChart3, Volume2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { motion } from 'framer-motion';

export default function MarketData({ tradingPair, orderBook, trades = [] }) {
  // Calculate 24h stats from trades
  const calculate24hStats = () => {
    if (!trades || trades.length === 0) {
      return {
        high: 0,
        low: 0,
        volume: 0,
        change: 0,
        changePercent: 0
      };
    }

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    
    const recentTrades = trades.filter(trade => {
      const tradeTime = new Date(trade.timestamp || trade.time || 0).getTime();
      return tradeTime >= oneDayAgo;
    });

    if (recentTrades.length === 0) {
      return {
        high: 0,
        low: 0,
        volume: 0,
        change: 0,
        changePercent: 0
      };
    }

    const prices = recentTrades.map(t => parseFloat(t.price || 0)).filter(p => p > 0);
    const volumes = recentTrades.map(t => parseFloat(t.quantity || 0)).filter(v => v > 0);
    
    const high = Math.max(...prices, 0);
    const low = Math.min(...prices, 0);
    const volume = volumes.reduce((sum, v) => sum + v, 0);
    
    // Calculate price change (first vs last trade)
    const firstPrice = prices[0] || 0;
    const lastPrice = prices[prices.length - 1] || 0;
    const change = lastPrice - firstPrice;
    const changePercent = firstPrice > 0 ? (change / firstPrice) * 100 : 0;

    return { high, low, volume, change, changePercent, lastPrice };
  };

  const stats = calculate24hStats();
  const isPositive = stats.change >= 0;

  // Get current price — REAL DATA ONLY
  // Priority: 1) Last trade price, 2) Mid-point of bid/ask, 3) Best bid or ask
  const bestBid = orderBook?.buys?.[0]?.price || null;
  const bestAsk = orderBook?.sells?.[0]?.price || null;
  const midPrice = bestBid && bestAsk 
    ? (parseFloat(bestBid) + parseFloat(bestAsk)) / 2 
    : parseFloat(bestBid) || parseFloat(bestAsk) || 0;
  
  // Last trade price is the TRUE market price (like Binance/Hyperliquid)
  const currentPrice = stats.lastPrice || midPrice || 0;

  const formatPrice = (price) => {
    if (!price || price === 0) return '0.00';
    return parseFloat(price).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8
    });
  };

  const formatVolume = (volume) => {
    if (!volume || volume === 0) return '0.00';
    if (volume >= 1000000) return `${(volume / 1000000).toFixed(2)}M`;
    if (volume >= 1000) return `${(volume / 1000).toFixed(2)}K`;
    return volume.toFixed(2);
  };

  const [baseToken, quoteToken] = tradingPair.split('/');

  return (
    <Card>
      <CardHeader className="px-3 sm:px-6">
        <CardTitle className="flex items-center justify-between text-sm sm:text-base">
          <span>{tradingPair}</span>
          <div className="flex items-center gap-2">
            {isPositive ? (
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-success" />
            ) : (
              <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5 text-destructive" />
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        <div className="space-y-3 sm:space-y-4">
          {/* Current Price */}
          <div className="text-center py-3 sm:py-4 border-b border-border">
            <div className="text-xs sm:text-sm text-muted-foreground uppercase tracking-wide mb-1">
              Current Price
            </div>
            <motion.div
              key={currentPrice}
              initial={{ scale: 1.1, opacity: 0.5 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`text-2xl sm:text-3xl font-bold font-mono ${
                isPositive ? 'text-success' : 'text-destructive'
              }`}
            >
              {formatPrice(currentPrice)} <span className="text-base sm:text-lg">{quoteToken}</span>
            </motion.div>
            {stats.change !== 0 && (
              <div className={`text-xs sm:text-sm font-medium mt-1 ${
                isPositive ? 'text-success' : 'text-destructive'
              }`}>
                {isPositive ? '+' : ''}{formatPrice(stats.change)} ({isPositive ? '+' : ''}{stats.changePercent.toFixed(2)}%)
              </div>
            )}
          </div>

          {/* 24h Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 bg-success/5 border border-success/20 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground uppercase tracking-wide font-medium">
                <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-success" />
                24h High
              </div>
              <div className="text-base sm:text-xl lg:text-2xl font-bold font-mono text-success">
                {formatPrice(stats.high)}
              </div>
            </div>

            <div className="space-y-1.5 bg-destructive/5 border border-destructive/20 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground uppercase tracking-wide font-medium">
                <TrendingDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-destructive" />
                24h Low
              </div>
              <div className="text-base sm:text-xl lg:text-2xl font-bold font-mono text-destructive">
                {formatPrice(stats.low)}
              </div>
            </div>

            <div className="space-y-1.5 col-span-2 bg-muted/30 border border-border/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground uppercase tracking-wide font-medium">
                <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                24h Volume
              </div>
              <div className="text-base sm:text-xl lg:text-2xl font-bold font-mono">
                {formatVolume(stats.volume)} <span className="text-sm sm:text-base text-muted-foreground">{baseToken}</span>
              </div>
            </div>
          </div>

          {/* Spread Info */}
          {bestBid && bestAsk && (
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Spread</span>
                <div className="text-right">
                  <div className="font-semibold font-mono">
                    {formatPrice(parseFloat(bestAsk) - parseFloat(bestBid))} {quoteToken}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ({((parseFloat(bestAsk) - parseFloat(bestBid)) / parseFloat(bestBid) * 100).toFixed(2)}%)
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

