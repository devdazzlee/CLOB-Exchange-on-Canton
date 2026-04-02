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
    <div className={cn("flex flex-col h-full bg-[#0d1117]", className)}>
      {/* Chart controls bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#21262d] flex-shrink-0 flex-wrap">
        {/* Trading pair label */}
        <span className="text-xs font-medium text-white mr-1">{tradingPair}</span>
        {isPositiveChange
          ? <TrendingUp className="w-3 h-3 text-[#26a641]" />
          : <TrendingDown className="w-3 h-3 text-[#f85149]" />
        }

        {/* Chart type toggles - Segmented Style */}
        <div className="flex items-center gap-1 p-0.5 bg-[#0d1117] border border-[#2B3139] rounded-lg">
          {CHART_TYPES.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.value}
                onClick={() => setChartType(type.value)}
                title={type.label}
                className={cn(
                  "p-1 rounded transition-all duration-200",
                  chartType === type.value
                    ? "bg-[#2b3139] text-[#F7B500] shadow-inner border border-[#3A4149]"
                    : "text-[#848E9C] hover:text-white hover:bg-white/5"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>

        {/* Time interval toggles - Segmented Style */}
        <div className="flex items-center gap-1 p-0.5 bg-[#0d1117] border border-[#2B3139] rounded-lg">
          {TIME_INTERVALS.map((interval) => (
            <button
              key={interval.value}
              onClick={() => setSelectedInterval(interval)}
              className={cn(
                "px-2 py-0.5 text-[10px] font-bold uppercase transition-all duration-200 rounded",
                selectedInterval.value === interval.value
                  ? "bg-[#2b3139] text-[#F7B500] shadow-inner border border-[#3A4149]"
                  : "text-[#848E9C] hover:text-white hover:bg-white/5"
              )}
            >
              {interval.displayLabel}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <button
          onClick={() => {
            setIsLoading(true);
            const data = generateOHLCData(trades, selectedInterval.value);
            setChartData(data);
          }}
          className="p-1 text-[#848E9C] hover:text-white hover:bg-[#21262d] rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
        </button>

        {/* Legend */}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-[#848E9C]">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-[#26a641] rounded-sm" />Bullish
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-[#f85149] rounded-sm" />Bearish
          </span>
          {lastUpdate && <span>Updated: {lastUpdate.toLocaleTimeString()}</span>}
        </div>
      </div>

      {/* Chart container - fills remaining height */}
      <div ref={chartContainerRef} className="flex-1 min-h-0 relative w-full">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]/80 backdrop-blur-sm z-10">
            <div className="flex items-center gap-2 text-[#848E9C]">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-xs">Loading chart...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(PriceChart);
