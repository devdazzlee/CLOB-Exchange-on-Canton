/**
 * Order Form Component
 * Place buy/sell orders
 */

import React, { useState } from 'react';
import axios from 'axios';
import { walletService } from '../../services/wallet';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

interface OrderFormProps {
  marketId: string;
  onOrderPlaced?: () => void;
}

export const OrderForm: React.FC<OrderFormProps> = ({ marketId, onOrderPlaced }) => {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const state = walletService.getState();
      if (!state.partyId) {
        throw new Error('Party ID not found. Please complete onboarding.');
      }

      await axios.post(`${API_BASE}/orders/place`, {
        party: state.partyId,
        marketId,
        side,
        orderType,
        price: orderType === 'LIMIT' ? parseFloat(price) : undefined,
        quantity: parseFloat(quantity),
      });

      // Reset form
      setPrice('');
      setQuantity('');
      onOrderPlaced?.();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="order-form">
      <h3>Place Order</h3>
      <form onSubmit={handleSubmit}>
        <div className="side-selector">
          <button
            type="button"
            className={side === 'BUY' ? 'active buy' : ''}
            onClick={() => setSide('BUY')}
          >
            Buy
          </button>
          <button
            type="button"
            className={side === 'SELL' ? 'active sell' : ''}
            onClick={() => setSide('SELL')}
          >
            Sell
          </button>
        </div>

        <div>
          <label>Order Type</label>
          <select value={orderType} onChange={(e) => setOrderType(e.target.value as 'LIMIT' | 'MARKET')}>
            <option value="LIMIT">Limit</option>
            <option value="MARKET">Market</option>
          </select>
        </div>

        {orderType === 'LIMIT' && (
          <div>
            <label>Price</label>
            <input
              type="number"
              step="0.0001"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
        )}

        <div>
          <label>Quantity</label>
          <input
            type="number"
            step="0.0001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </div>

        {error && <div className="error">{error}</div>}

        <button type="submit" disabled={loading}>
          {loading ? 'Placing...' : `Place ${side} Order`}
        </button>
      </form>
    </div>
  );
};
