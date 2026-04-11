import { useEffect, useRef, memo } from 'react';
import { createChart, LineSeries, ColorType } from 'lightweight-charts';
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

  // Process order book into cumulative depth data.
  // Lightweight Charts will crash if it receives null/NaN points,
  // so we normalize all incoming values to finite numbers here.
  const processDepthData = (bids, asks) => {
    const toFiniteNumber = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'object') {
        if (value.Some !== undefined) return toFiniteNumber(value.Some);
        if (value.value !== undefined) return toFiniteNumber(value.value);
        return null;
      }
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const getQuantity = (entry) => {
      if (!entry || typeof entry !== 'object') return null;
      return toFiniteNumber(
        entry.quantity ??
        entry.amount ??
        entry.remaining ??
        entry.depth ??
        null
      );
    };

    const normalizeSide = (levels, side) => {
      const source = Array.isArray(levels) ? levels : [];
      const valid = source
        .map((level) => {
          const price = toFiniteNumber(level?.price);
          const quantity = getQuantity(level);
          if (price === null || quantity === null || price <= 0 || quantity <= 0) {
            return null;
          }
          return { price, quantity };
        })
        .filter(Boolean)
        .sort((a, b) => side === 'bids' ? b.price - a.price : a.price - b.price);

      let cumulative = 0;
      return valid.map((level) => {
        cumulative += level.quantity;
        return { price: level.price, cumulative };
      });
    };

    return {
      bidData: normalizeSide(bids, 'bids'),
      askData: normalizeSide(asks, 'asks'),
    };
  };

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Defensive cleanup for dev StrictMode / remount races.
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      bidSeriesRef.current = null;
      askSeriesRef.current = null;
    }

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

    // Use LineSeries for depth to avoid AreaSeries null-style crashes
    // observed under rapid real-time order book updates.
    bidSeriesRef.current = chart.addSeries(LineSeries, {
      lineColor: '#22C55E',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Create ask depth line (red)
    askSeriesRef.current = chart.addSeries(LineSeries, {
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
      bidSeriesRef.current = null;
      askSeriesRef.current = null;
    };
  }, []);

  // Update data when orderBook changes
  useEffect(() => {
    if (!chartRef.current || !bidSeriesRef.current || !askSeriesRef.current) return;

    const { bidData, askData } = processDepthData(orderBook.bids || [], orderBook.asks || []);

    const totalPoints = bidData.length + askData.length;
    const nowSec = Math.floor(Date.now() / 1000);
    const startTime = nowSec - Math.max(totalPoints, 1);

    if (bidData.length > 0) {
      const reversedBids = [...bidData].reverse();
      const bidChartData = reversedBids
        .map((d, i) => ({
          time: startTime + i,
          value: Number.isFinite(d.cumulative) ? d.cumulative : null,
        }))
        .filter((p) => p.value !== null);
      bidSeriesRef.current.setData(bidChartData);
    } else {
      bidSeriesRef.current.setData([]);
    }

    if (askData.length > 0) {
      const offset = bidData.length;
      const askChartData = askData
        .map((d, i) => ({
          time: startTime + offset + i,
          value: Number.isFinite(d.cumulative) ? d.cumulative : null,
        }))
        .filter((p) => p.value !== null);
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
      <CardHeader className="pb-2 px-3 sm:px-6">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs sm:text-sm font-medium text-foreground flex items-center gap-1.5 sm:gap-2">
            <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
            Market Depth
          </CardTitle>
          <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-xs">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-success"></span>
              <span className="text-success font-medium">{bidPercent.toFixed(1)}%</span>
              <span className="text-muted-foreground hidden sm:inline">Bids</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-destructive"></span>
              <span className="text-destructive font-medium">{askPercent.toFixed(1)}%</span>
              <span className="text-muted-foreground hidden sm:inline">Asks</span>
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
        <div className="px-3 sm:px-4 py-2 border-t border-border/50 flex items-center justify-between text-[10px] sm:text-xs">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Bid:</span>
            <span className="text-success font-mono font-medium">
              {totalBidVolume.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </span>
          </div>
          <div className="text-muted-foreground">|</div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Ask:</span>
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
