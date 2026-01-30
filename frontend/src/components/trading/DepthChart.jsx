import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

/**
 * Depth Chart Component - Visualizes order book depth
 * Shows cumulative buy and sell orders as a depth chart
 */
export default function DepthChart({ orderBook, buyOrders: propBuyOrders, sellOrders: propSellOrders, tradingPair, loading }) {
  // Support both orderBook object OR separate buyOrders/sellOrders props
  const buyOrders = propBuyOrders || orderBook?.buys || orderBook?.buyOrders || [];
  const sellOrders = propSellOrders || orderBook?.sells || orderBook?.sellOrders || [];
  
  const chartData = useMemo(() => {
    if (!buyOrders?.length && !sellOrders?.length) return { buyData: [], sellData: [], maxDepth: 0 };

    // Process buy orders (cumulative from lowest to highest price)
    let buyCumulative = 0;
    const buyData = [...buyOrders]
      .filter(order => order.price !== null && order.price !== undefined)
      .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
      .map(order => {
        buyCumulative += parseFloat(order.remaining || order.quantity || 0);
        return { 
          price: parseFloat(order.price), 
          depth: buyCumulative,
          quantity: parseFloat(order.remaining || order.quantity || 0)
        };
      });

    // Process sell orders (cumulative from lowest to highest price)
    let sellCumulative = 0;
    const sellData = [...sellOrders]
      .filter(order => order.price !== null && order.price !== undefined)
      .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
      .map(order => {
        sellCumulative += parseFloat(order.remaining || order.quantity || 0);
        return { 
          price: parseFloat(order.price), 
          depth: sellCumulative,
          quantity: parseFloat(order.remaining || order.quantity || 0)
        };
      });

    const maxDepth = Math.max(
      buyData.length > 0 ? buyData[buyData.length - 1]?.depth || 0 : 0,
      sellData.length > 0 ? sellData[sellData.length - 1]?.depth || 0 : 0
    );

    return { buyData, sellData, maxDepth };
  }, [buyOrders, sellOrders]);

  const { buyData, sellData, maxDepth } = chartData;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Depth Chart - {tradingPair}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <div className="animate-pulse text-muted-foreground">Loading depth chart...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (maxDepth === 0 || (!buyOrders.length && !sellOrders.length)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Depth Chart - {tradingPair}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground space-y-2">
            <span>No order book data available</span>
            <span className="text-xs opacity-60">Place orders to see the depth chart</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Find the price range
  const allPrices = [
    ...buyData.map(d => d.price),
    ...sellData.map(d => d.price)
  ].filter(p => p > 0);
  
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : 0;
  const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : 0;
  const priceRange = maxPrice - minPrice || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Depth Chart - {tradingPair}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-64 w-full">
          {/* Buy Orders Depth (Green) */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {buyData.map((point, idx) => {
              const nextPoint = buyData[idx + 1];
              if (!nextPoint) return null;
              
              const x1 = ((point.price - minPrice) / priceRange) * 100;
              const x2 = ((nextPoint.price - minPrice) / priceRange) * 100;
              const y1 = 100 - (point.depth / maxDepth) * 100;
              const y2 = 100 - (nextPoint.depth / maxDepth) * 100;
              
              return (
                <polygon
                  key={`buy-${idx}`}
                  points={`${x1},100 ${x1},${y1} ${x2},${y2} ${x2},100`}
                  fill="rgba(34, 197, 94, 0.2)"
                  stroke="rgba(34, 197, 94, 0.5)"
                  strokeWidth="0.5"
                />
              );
            })}
          </svg>

          {/* Sell Orders Depth (Red) */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {sellData.map((point, idx) => {
              const nextPoint = sellData[idx + 1];
              if (!nextPoint) return null;
              
              const x1 = ((point.price - minPrice) / priceRange) * 100;
              const x2 = ((nextPoint.price - minPrice) / priceRange) * 100;
              const y1 = 100 - (point.depth / maxDepth) * 100;
              const y2 = 100 - (nextPoint.depth / maxDepth) * 100;
              
              return (
                <polygon
                  key={`sell-${idx}`}
                  points={`${x1},100 ${x1},${y1} ${x2},${y2} ${x2},100`}
                  fill="rgba(239, 68, 68, 0.2)"
                  stroke="rgba(239, 68, 68, 0.5)"
                  strokeWidth="0.5"
                />
              );
            })}
          </svg>

          {/* Price Labels */}
          <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-muted-foreground px-2 pb-1">
            <span>{minPrice.toFixed(2)}</span>
            <span>{((minPrice + maxPrice) / 2).toFixed(2)}</span>
            <span>{maxPrice.toFixed(2)}</span>
          </div>

          {/* Depth Labels */}
          <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-xs text-muted-foreground pl-2 py-2">
            <span>{maxDepth.toFixed(2)}</span>
            <span>{(maxDepth / 2).toFixed(2)}</span>
            <span>0</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center space-x-6 mt-4 pt-4 border-t border-border">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-success/20 border border-success/50 rounded"></div>
            <span className="text-xs text-muted-foreground">Buy Orders</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-destructive/20 border border-destructive/50 rounded"></div>
            <span className="text-xs text-muted-foreground">Sell Orders</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

