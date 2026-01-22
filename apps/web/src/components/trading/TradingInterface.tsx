/**
 * Trading Interface Component
 * Main trading UI with order book, order form, and active orders
 */

import React, { useState } from 'react';
import { OrderBook } from './OrderBook';
import { OrderForm } from './OrderForm';
import { ActiveOrders } from './ActiveOrders';

const MARKETS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

export const TradingInterface: React.FC = () => {
  const [selectedMarket, setSelectedMarket] = useState(MARKETS[0]);

  return (
    <div className="trading-interface">
      <div className="market-selector">
        <label>Market: </label>
        <select value={selectedMarket} onChange={(e) => setSelectedMarket(e.target.value)}>
          {MARKETS.map((market) => (
            <option key={market} value={market}>
              {market}
            </option>
          ))}
        </select>
      </div>

      <div className="trading-layout">
        <div className="left-panel">
          <OrderBook marketId={selectedMarket} />
        </div>
        <div className="center-panel">
          <OrderForm marketId={selectedMarket} />
          <ActiveOrders />
        </div>
      </div>
    </div>
  );
};
