import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { createChart, CandlestickSeries, LineSeries, AreaSeries, HistogramSeries, ColorType, CrosshairMode } from 'lightweight-charts';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  LineChart,
  CandlestickChart as CandleIcon,
  RefreshCw
} from 'lucide-react';

// Time interval options
const TIME_INTERVALS = [
  { label: '1m', value: 60000, displayLabel: '1m' },
  { label: '5m', value: 300000, displayLabel: '5m' },
  { label: '15m', value: 900000, displayLabel: '15m' },
  { label: '1H', value: 3600000, displayLabel: '1H' },
  { label: '4H', value: 14400000, displayLabel: '4H' },
  { label: '1D', value: 86400000, displayLabel: '1D' },
  { label: '1W', value: 604800000, displayLabel: '1W' },
];

// Chart type options
const CHART_TYPES = [
  { label: 'Candles', value: 'candlestick', icon: CandleIcon },
  { label: 'Line', value: 'line', icon: LineChart },
  { label: 'Area', value: 'area', icon: BarChart3 },
];

/**
 * Professional Price Chart Component using TradingView Lightweight Charts v5
 */
function PriceChart({ 
  tradingPair = 'BTC/USDT',
  trades = [],
  currentPrice = 0,
  priceChange24h = 0,
  high24h = 0,
  low24h = 0,
  volume24h = 0,
  className
}) {
  const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

  const normalizeCandle = useCallback((candle) => {
    if (!candle) return null;
    const time = Number(candle.time);
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Number(candle.volume ?? 0);
    if (!isFiniteNumber(time) || !isFiniteNumber(open) || !isFiniteNumber(high) || !isFiniteNumber(low) || !isFiniteNumber(close)) {
      return null;
    }
    return { time, open, high, low, close, volume: isFiniteNumber(volume) ? volume : 0 };
  }, []);

  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const resizeObserverRef = useRef(null);
  
  const [selectedInterval, setSelectedInterval] = useState(TIME_INTERVALS[3]); // Default 1H
  const [chartType, setChartType] = useState('candlestick');
  const [chartData, setChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Generate OHLC data from trades
  const generateOHLCData = useCallback((tradesData, intervalMs) => {
    if (!tradesData || tradesData.length === 0) {
      return generateSampleData(intervalMs);
    }

    const sortedTrades = [...tradesData].sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    const candles = new Map();
    
    sortedTrades.forEach(trade => {
      const timestamp = new Date(trade.timestamp).getTime();
      const candleTime = Math.floor(timestamp / intervalMs) * intervalMs;
      const price = parseFloat(trade.price) || 0;
      const volume = parseFloat(trade.quantity) || 0;
      
      if (price <= 0) return;

      if (candles.has(candleTime)) {
        const candle = candles.get(candleTime);
        candle.high = Math.max(candle.high, price);
        candle.low = Math.min(candle.low, price);
        candle.close = price;
        candle.volume += volume;
      } else {
        candles.set(candleTime, {
          time: candleTime / 1000,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: volume
        });
      }
    });

    const candleArray = Array.from(candles.values()).sort((a, b) => a.time - b.time);
    
    if (candleArray.length > 1) {
      const filled = [];
      for (let i = 0; i < candleArray.length; i++) {
        filled.push(candleArray[i]);
        
        if (i < candleArray.length - 1) {
          const currentTime = candleArray[i].time;
          const nextTime = candleArray[i + 1].time;
          const intervalSec = intervalMs / 1000;
          
          for (let t = currentTime + intervalSec; t < nextTime; t += intervalSec) {
            filled.push({
              time: t,
              open: candleArray[i].close,
              high: candleArray[i].close,
              low: candleArray[i].close,
              close: candleArray[i].close,
              volume: 0
            });
          }
        }
      }
      return filled;
    }
    
    const normalized = candleArray.map(normalizeCandle).filter(Boolean);
    return normalized.length > 0 ? normalized : generateSampleData(intervalMs);
  }, []);

  // Generate sample data for demonstration
  const generateSampleData = useCallback((intervalMs) => {
    const now = Date.now();
    const candles = [];
    const basePrice = currentPrice || 50000;
    let price = basePrice * 0.95;
    
    for (let i = 100; i >= 0; i--) {
      const time = Math.floor((now - (i * intervalMs)) / 1000);
      const volatility = 0.02;
      const change = (Math.random() - 0.5) * 2 * volatility * price;
      const open = price;
      const close = price + change;
      const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.5);
      const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.5);
      const volume = Math.random() * 10 + 1;
      
      candles.push({ time, open, high, low, close, volume });
      price = close;
    }
    
    return candles.map(normalizeCandle).filter(Boolean);
  }, [currentPrice, normalizeCandle]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9CA3AF',
        fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255, 193, 7, 0.5)',
          width: 1,
          style: 2,
          labelBackgroundColor: '#FFC107',
        },
        horzLine: {
          color: 'rgba(255, 193, 7, 0.5)',
          width: 1,
          style: 2,
          labelBackgroundColor: '#FFC107',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    chartRef.current = chart;

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
      // Clear series refs before removing chart
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (e) {
          console.warn('[PriceChart] Error removing chart:', e.message);
        }
        chartRef.current = null;
      }
    };
  }, [selectedInterval.value]);

  // Update series when chart type or data changes
  useEffect(() => {
    if (!chartRef.current) return;

    // Remove existing series safely
    try {
      if (seriesRef.current) {
        chartRef.current.removeSeries(seriesRef.current);
      }
    } catch (e) {
      console.warn('[PriceChart] Error removing price series:', e.message);
    }
    seriesRef.current = null;
    
    try {
      if (volumeSeriesRef.current) {
        chartRef.current.removeSeries(volumeSeriesRef.current);
      }
    } catch (e) {
      console.warn('[PriceChart] Error removing volume series:', e.message);
    }
    volumeSeriesRef.current = null;

    // Create new series based on chart type - v5 API
    if (chartType === 'candlestick') {
      seriesRef.current = chartRef.current.addSeries(CandlestickSeries, {
        upColor: '#22C55E',
        downColor: '#EF4444',
        borderUpColor: '#22C55E',
        borderDownColor: '#EF4444',
        wickUpColor: '#22C55E',
        wickDownColor: '#EF4444',
      });
    } else if (chartType === 'line') {
      seriesRef.current = chartRef.current.addSeries(LineSeries, {
        color: '#FFC107',
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        lastValueVisible: true,
        priceLineVisible: true,
      });
    } else if (chartType === 'area') {
      seriesRef.current = chartRef.current.addSeries(AreaSeries, {
        topColor: 'rgba(255, 193, 7, 0.4)',
        bottomColor: 'rgba(255, 193, 7, 0.0)',
        lineColor: '#FFC107',
        lineWidth: 2,
      });
    }

    // Add volume series - v5 API
    volumeSeriesRef.current = chartRef.current.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeriesRef.current.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    // Set data
    const safeChartData = chartData.map(normalizeCandle).filter(Boolean);
    if (safeChartData.length > 0 && seriesRef.current) {
      try {
        if (chartType === 'candlestick') {
          seriesRef.current.setData(safeChartData);
        } else {
          const lineData = safeChartData
            .map(d => ({ time: d.time, value: Number(d.close) }))
            .filter(d => isFiniteNumber(d.value));
          if (lineData.length > 0) seriesRef.current.setData(lineData);
        }

        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData(safeChartData.map((d) => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'
          })));
        }

        chartRef.current.timeScale().fitContent();
      } catch (e) {
        console.warn('[PriceChart] Error setting chart data:', e.message);
      }
    }

    setLastUpdate(new Date());
    setIsLoading(false);
  }, [chartType, chartData, normalizeCandle]);

  // Generate chart data when trades or interval changes
  useEffect(() => {
    setIsLoading(true);
    const data = generateOHLCData(trades, selectedInterval.value);
    setChartData(data);
  }, [trades, selectedInterval, generateOHLCData]);

  // Update current candle in real-time
  useEffect(() => {
    if (!seriesRef.current || !chartData.length || !currentPrice) return;
    const parsedCurrentPrice = Number(currentPrice);
    if (!isFiniteNumber(parsedCurrentPrice) || parsedCurrentPrice <= 0) return;

    try {
      const now = Math.floor(Date.now() / 1000);
      const intervalSec = selectedInterval.value / 1000;
      const currentCandleTime = Math.floor(now / intervalSec) * intervalSec;
      
      const lastCandle = normalizeCandle(chartData[chartData.length - 1]);
      
      if (lastCandle && lastCandle.time === currentCandleTime) {
        const updatedCandle = {
          ...lastCandle,
          high: Math.max(lastCandle.high, parsedCurrentPrice),
          low: Math.min(lastCandle.low, parsedCurrentPrice),
          close: parsedCurrentPrice
        };
        
        if (chartType === 'candlestick') {
          seriesRef.current.update(updatedCandle);
        } else {
          seriesRef.current.update({ time: updatedCandle.time, value: parsedCurrentPrice });
        }
      }
    } catch (e) {
      console.warn('[PriceChart] Error updating candle:', e.message);
    }
  }, [currentPrice, chartData, selectedInterval, chartType, normalizeCandle]);

  const formatPrice = (price) => {
    if (!price || isNaN(price)) return '--';
    return price.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: price < 1 ? 6 : 2 
    });
  };

  const formatVolume = (vol) => {
    if (!vol || isNaN(vol)) return '--';
    if (vol >= 1000000) return `${(vol / 1000000).toFixed(2)}M`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(2)}K`;
    return vol.toFixed(2);
  };

  const priceChangePercent = currentPrice > 0 ? ((priceChange24h / currentPrice) * 100) : 0;
  const isPositiveChange = priceChange24h >= 0;

  return (
    <Card className={cn("bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden", className)}>
      <CardHeader className="pb-2 px-3 sm:px-6">
        {/* Top: Trading pair name + price */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
              {tradingPair}
              {isPositiveChange ? (
                <TrendingUp className="w-4 h-4 text-success flex-shrink-0" />
              ) : (
                <TrendingDown className="w-4 h-4 text-destructive flex-shrink-0" />
              )}
            </CardTitle>
            <div className="flex items-center gap-2 sm:gap-3 mt-1 flex-wrap">
              <span className="text-xl sm:text-2xl font-bold text-foreground font-mono">
                ${formatPrice(currentPrice)}
              </span>
              <span className={cn(
                "text-xs sm:text-sm font-semibold px-1.5 sm:px-2 py-0.5 rounded",
                isPositiveChange 
                  ? "text-success bg-success/10" 
                  : "text-destructive bg-destructive/10"
              )}>
                {isPositiveChange ? '+' : ''}{priceChangePercent.toFixed(2)}%
              </span>
            </div>
          </div>
          
          {/* 24h stats - hidden on mobile */}
          <div className="hidden md:flex items-center gap-4 text-xs flex-shrink-0">
            <div className="border-l border-border pl-4">
              <div className="text-muted-foreground">24h High</div>
              <div className="text-foreground font-mono font-medium">${formatPrice(high24h)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">24h Low</div>
              <div className="text-foreground font-mono font-medium">${formatPrice(low24h)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">24h Vol</div>
              <div className="text-foreground font-mono font-medium">{formatVolume(volume24h)}</div>
            </div>
          </div>
        </div>

        {/* Mobile: 24h stats row */}
        <div className="flex md:hidden items-center gap-3 mt-2 text-[10px] sm:text-xs overflow-x-auto">
          <div className="flex-shrink-0">
            <span className="text-muted-foreground">H: </span>
            <span className="text-foreground font-mono">${formatPrice(high24h)}</span>
          </div>
          <div className="flex-shrink-0">
            <span className="text-muted-foreground">L: </span>
            <span className="text-foreground font-mono">${formatPrice(low24h)}</span>
          </div>
          <div className="flex-shrink-0">
            <span className="text-muted-foreground">Vol: </span>
            <span className="text-foreground font-mono">{formatVolume(volume24h)}</span>
          </div>
        </div>

        {/* Chart controls row */}
        <div className="flex items-center gap-1.5 sm:gap-2 mt-3 flex-wrap">
          {/* Chart type toggles */}
          <div className="flex items-center bg-background/50 rounded-lg p-0.5 sm:p-1 border border-border/50">
            {CHART_TYPES.map((type) => {
              const Icon = type.icon;
              return (
                <Button
                  key={type.value}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-6 w-6 sm:h-7 sm:w-7 p-0 rounded",
                    chartType === type.value 
                      ? "bg-primary text-primary-foreground" 
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setChartType(type.value)}
                  title={type.label}
                >
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Button>
              );
            })}
          </div>

          {/* Time interval toggles */}
          <div className="flex items-center bg-background/50 rounded-lg p-0.5 sm:p-1 border border-border/50 overflow-x-auto">
            {TIME_INTERVALS.map((interval) => (
              <Button
                key={interval.value}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 sm:h-7 px-1.5 sm:px-2 text-[10px] sm:text-xs font-medium rounded flex-shrink-0",
                  selectedInterval.value === interval.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setSelectedInterval(interval)}
              >
                {interval.displayLabel}
              </Button>
            ))}
          </div>

          {/* Refresh */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 sm:h-7 sm:w-7 p-0 text-muted-foreground hover:text-foreground flex-shrink-0"
            onClick={() => {
              setIsLoading(true);
              const data = generateOHLCData(trades, selectedInterval.value);
              setChartData(data);
            }}
            title="Refresh Chart"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 sm:w-4 sm:h-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <div 
          ref={chartContainerRef} 
          className="w-full h-[280px] sm:h-[350px] md:h-[400px] relative"
        >
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
              <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading chart...</span>
              </div>
            </div>
          )}
        </div>

        <div className="px-3 sm:px-4 py-2 border-t border-border/50 flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground">
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-success rounded-sm"></span>
              Bullish
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-destructive rounded-sm"></span>
              Bearish
            </span>
          </div>
          {lastUpdate && (
            <span>Updated: {lastUpdate.toLocaleTimeString()}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(PriceChart);
