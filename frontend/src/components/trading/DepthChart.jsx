import { useEffect, useRef, memo } from 'react';
import { createChart, AreaSeries, ColorType } from 'lightweight-charts';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { cn } from '@/lib/utils';
import { Layers } from 'lucide-react';

/**
 * Professional Depth Chart Component using Lightweight Charts v5
 * Shows cumulative bid/ask liquidity as area mountains
 */
function DepthChart({ 
  orderBook = { bids: [], asks: [] },
  currentPrice = 0,
  className 
}) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const bidSeriesRef = useRef(null);
  const askSeriesRef = useRef(null);
  const resizeObserverRef = useRef(null);

  // Process order book into cumulative depth data
  const processDepthData = (bids, asks) => {
    const sortedBids = [...bids]
      .filter(b => parseFloat(b.price) > 0 && parseFloat(b.quantity || b.amount || b.remaining) > 0)
      .sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    
    let bidCumulative = 0;
    const bidData = sortedBids.map(bid => {
      bidCumulative += parseFloat(bid.quantity || bid.amount || bid.remaining || 0);
      return {
        price: parseFloat(bid.price),
        cumulative: bidCumulative
      };
    });

    const sortedAsks = [...asks]
      .filter(a => parseFloat(a.price) > 0 && parseFloat(a.quantity || a.amount || a.remaining) > 0)
      .sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    
    let askCumulative = 0;
    const askData = sortedAsks.map(ask => {
      askCumulative += parseFloat(ask.quantity || ask.amount || ask.remaining || 0);
      return {
        price: parseFloat(ask.price),
        cumulative: askCumulative
      };
    });

    return { bidData, askData };
  };

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9CA3AF',
        fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.02)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.02)' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(255, 255, 255, 0.3)', width: 1, style: 2 },
        horzLine: { color: 'rgba(255, 255, 255, 0.3)', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: { visible: false },
      handleScroll: false,
      handleScale: false,
    });

    chartRef.current = chart;

    // Create bid area series (green) - v5 API
    bidSeriesRef.current = chart.addSeries(AreaSeries, {
      topColor: 'rgba(34, 197, 94, 0.4)',
      bottomColor: 'rgba(34, 197, 94, 0.0)',
      lineColor: '#22C55E',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Create ask area series (red) - v5 API
    askSeriesRef.current = chart.addSeries(AreaSeries, {
      topColor: 'rgba(239, 68, 68, 0.4)',
      bottomColor: 'rgba(239, 68, 68, 0.0)',
      lineColor: '#EF4444',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    resizeObserverRef.current = new ResizeObserver(handleResize);
    resizeObserverRef.current.observe(chartContainerRef.current);

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Update data when orderBook changes
  useEffect(() => {
    if (!bidSeriesRef.current || !askSeriesRef.current) return;

    const { bidData, askData } = processDepthData(orderBook.bids || [], orderBook.asks || []);

    if (bidData.length > 0) {
      const reversedBids = [...bidData].reverse();
      const bidChartData = reversedBids.map((d, i) => ({
        time: i,
        value: d.cumulative
      }));
      bidSeriesRef.current.setData(bidChartData);
    } else {
      bidSeriesRef.current.setData([]);
    }

    if (askData.length > 0) {
      const offset = bidData.length;
      const askChartData = askData.map((d, i) => ({
        time: offset + i,
        value: d.cumulative
      }));
      askSeriesRef.current.setData(askChartData);
    } else {
      askSeriesRef.current.setData([]);
    }

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [orderBook]);

  // Calculate market stats
  const { bidData, askData } = processDepthData(orderBook.bids || [], orderBook.asks || []);
  const totalBidVolume = bidData.length > 0 ? bidData[bidData.length - 1]?.cumulative || 0 : 0;
  const totalAskVolume = askData.length > 0 ? askData[askData.length - 1]?.cumulative || 0 : 0;
  const totalVolume = totalBidVolume + totalAskVolume;
  const bidPercent = totalVolume > 0 ? (totalBidVolume / totalVolume * 100) : 50;
  const askPercent = totalVolume > 0 ? (totalAskVolume / totalVolume * 100) : 50;

  return (
    <Card className={cn("bg-card/50 backdrop-blur-sm border-border/50", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            Market Depth
          </CardTitle>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-success"></span>
              <span className="text-success font-medium">{bidPercent.toFixed(1)}%</span>
              <span className="text-muted-foreground">Bids</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-destructive"></span>
              <span className="text-destructive font-medium">{askPercent.toFixed(1)}%</span>
              <span className="text-muted-foreground">Asks</span>
            </div>
          </div>
        </div>
        
        {/* Buy/Sell Pressure Bar */}
        <div className="mt-2 h-2 w-full rounded-full overflow-hidden flex">
          <div 
            className="h-full bg-gradient-to-r from-success/80 to-success transition-all duration-500"
            style={{ width: `${bidPercent}%` }}
          />
          <div 
            className="h-full bg-gradient-to-r from-destructive to-destructive/80 transition-all duration-500"
            style={{ width: `${askPercent}%` }}
          />
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <div 
          ref={chartContainerRef} 
          className="w-full h-[150px]"
        />
        
        {/* Volume Stats */}
        <div className="px-4 py-2 border-t border-border/50 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Bid Depth:</span>
            <span className="text-success font-mono font-medium">
              {totalBidVolume.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </span>
          </div>
          <div className="text-muted-foreground">|</div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Ask Depth:</span>
            <span className="text-destructive font-mono font-medium">
              {totalAskVolume.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(DepthChart);
