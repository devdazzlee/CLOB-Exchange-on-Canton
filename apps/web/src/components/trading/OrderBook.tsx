/**
 * Order Book Component
 * Visual order book with bids (green) and asks (red)
 */

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { websocketClient } from '../../services/websocket';

const API_BASE = import.meta.env.VITE_INDEXER_API || 'http://localhost:3002';

interface OrderBookLevel {
  price: number;
  quantity: number;
}

interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

interface OrderBookProps {
  marketId: string;
}

export const OrderBook: React.FC<OrderBookProps> = ({ marketId }) => {
  const [orderBook, setOrderBook] = useState<OrderBookData>({ bids: [], asks: [] });
  const [spread, setSpread] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Connect WebSocket
    websocketClient.connect();

    const fetchOrderBook = async () => {
      try {
        const response = await axios.get(`${API_BASE}/orderbook?market=${marketId}`);
        setOrderBook(response.data.orderbook);
        
        if (response.data.orderbook.bids.length > 0 && response.data.orderbook.asks.length > 0) {
          const bestBid = response.data.orderbook.bids[0].price;
          const bestAsk = response.data.orderbook.asks[0].price;
          setSpread(bestAsk - bestBid);
        }
      } catch (error) {
        console.error('Error fetching order book:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchOrderBook();

    // Subscribe to WebSocket updates
    const handleUpdate = (data: any) => {
      setOrderBook(data);
      if (data.bids && data.bids.length > 0 && data.asks && data.asks.length > 0) {
        const bestBid = data.bids[0].price;
        const bestAsk = data.asks[0].price;
        setSpread(bestAsk - bestBid);
      }
    };

    websocketClient.subscribe(`orderbook:${marketId}`, handleUpdate);

    // Fallback polling every 5 seconds
    const interval = setInterval(fetchOrderBook, 5000);

    return () => {
      clearInterval(interval);
      websocketClient.unsubscribe(`orderbook:${marketId}`, handleUpdate);
    };
  }, [marketId]);

  if (loading) {
    return <div>Loading order book...</div>;
  }

  const maxQuantity = Math.max(
    ...orderBook.bids.map((b) => b.quantity),
    ...orderBook.asks.map((a) => a.quantity),
    1
  );

  return (
    <div className="order-book">
      <h3>Order Book</h3>
      {spread !== null && (
        <div className="spread">
          Spread: {spread.toFixed(4)}
        </div>
      )}
      <div className="order-book-content">
        <div className="asks">
          <div className="order-book-header">
            <span>Price</span>
            <span>Quantity</span>
            <span>Total</span>
          </div>
          {orderBook.asks.map((ask, index) => {
            const depth = (ask.quantity / maxQuantity) * 100;
            return (
              <div key={index} className="order-book-row ask">
                <div className="depth-bar" style={{ width: `${depth}%` }} />
                <span className="price">{ask.price.toFixed(4)}</span>
                <span className="quantity">{ask.quantity.toFixed(4)}</span>
                <span className="total">{(ask.price * ask.quantity).toFixed(2)}</span>
              </div>
            );
          })}
        </div>
        <div className="bids">
          {orderBook.bids.map((bid, index) => {
            const depth = (bid.quantity / maxQuantity) * 100;
            return (
              <div key={index} className="order-book-row bid">
                <div className="depth-bar" style={{ width: `${depth}%` }} />
                <span className="price">{bid.price.toFixed(4)}</span>
                <span className="quantity">{bid.quantity.toFixed(4)}</span>
                <span className="total">{(bid.price * bid.quantity).toFixed(2)}</span>
              </div>
            );
          })}
          <div className="order-book-header">
            <span>Price</span>
            <span>Quantity</span>
            <span>Total</span>
          </div>
        </div>
      </div>
    </div>
  );
};
