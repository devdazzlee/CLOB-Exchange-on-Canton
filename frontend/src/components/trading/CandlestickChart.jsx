/**
 * Candlestick Chart Component
 * Displays OHLC (Open, High, Low, Close) price data using lightweight-charts
 */

import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';

export default function CandlestickChart({ tradingPair, trades, width = 800, height = 400 }) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);

  // Convert trades to OHLC candles
  const tradesToOHLC = (trades, interval = 60) => {
    if (!trades || trades.length === 0) return [];

    // Group trades by time interval (default: 1 minute)
    const candles = {};

    trades.forEach(trade => {
      const timestamp = Math.floor(trade.timestamp / (interval * 1000)) * interval;

      if (!candles[timestamp]) {
        candles[timestamp] = {
          time: timestamp,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume: 0
        };
      }

      const candle = candles[timestamp];
      candle.high = Math.max(candle.high, trade.price);
      candle.low = Math.min(candle.low, trade.price);
      candle.close = trade.price;
      candle.volume += trade.quantity;
    });

    return Object.values(candles).sort((a, b) => a.time - b.time);
  };

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart instance
    const chart = createChart(chartContainerRef.current, {
      width: width,
      height: height,
      layout: {
        background: { color: '#1a1d29' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2b2f3e' },
        horzLines: { color: '#2b2f3e' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#2b2f3e',
      },
      timeScale: {
        borderColor: '#2b2f3e',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    // Create candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;

    // Handle resize
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
      }
    };
  }, [width, height]);

  // Update data when trades change
  useEffect(() => {
    if (!candlestickSeriesRef.current) return;

    const ohlcData = tradesToOHLC(trades);

    if (ohlcData.length > 0) {
      candlestickSeriesRef.current.setData(ohlcData);

      // Fit content to visible range
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
    }
  }, [trades]);

  if (!trades || trades.length === 0) {
    return (
      <div className="bg-[#1a1d29] rounded-lg p-8 text-center" style={{ width, height }}>
        <div className="flex flex-col items-center justify-center h-full">
          <svg className="w-16 h-16 text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-gray-400 text-sm">No trade data available yet</p>
          <p className="text-gray-500 text-xs mt-2">Chart will appear after first trade</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1a1d29] rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-white font-medium">{tradingPair} Price Chart</h3>
        <div className="flex gap-2">
          <button className="px-3 py-1 text-xs bg-[#2b2f3e] text-gray-400 rounded hover:bg-[#363a4d]">
            1m
          </button>
          <button className="px-3 py-1 text-xs bg-[#2b2f3e] text-gray-400 rounded hover:bg-[#363a4d]">
            5m
          </button>
          <button className="px-3 py-1 text-xs bg-[#2b2f3e] text-gray-400 rounded hover:bg-[#363a4d]">
            15m
          </button>
          <button className="px-3 py-1 text-xs bg-[#2b2f3e] text-gray-400 rounded hover:bg-[#363a4d]">
            1h
          </button>
        </div>
      </div>
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}
