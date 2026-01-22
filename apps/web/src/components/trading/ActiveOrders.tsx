/**
 * Active Orders Component
 * Shows user's open orders with cancel functionality
 */

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { walletService } from '../../services/wallet';

const API_BASE = import.meta.env.VITE_INDEXER_API || 'http://localhost:3002';

interface Order {
  order_id: string;
  party: string;
  market_id: string;
  side: string;
  price: number;
  quantity: number;
  remaining_qty: number;
  status: string;
  created_at: string;
}

export const ActiveOrders: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 2000);
    return () => clearInterval(interval);
  }, []);

  const fetchOrders = async () => {
    try {
      const state = walletService.getState();
      if (!state.partyId) return;

      const response = await axios.get(
        `${API_BASE}/me/orders?party=${state.partyId}&status=OPEN`
      );
      setOrders(response.data.orders || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (orderId: string) => {
    try {
      const state = walletService.getState();
      await axios.post(`${API_BASE}/orders/cancel`, {
        party: state.partyId,
        orderId,
      });
      fetchOrders();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to cancel order');
    }
  };

  if (loading) {
    return <div>Loading orders...</div>;
  }

  return (
    <div className="active-orders">
      <h3>My Open Orders</h3>
      {orders.length === 0 ? (
        <p>No open orders</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th>Side</th>
              <th>Price</th>
              <th>Quantity</th>
              <th>Filled</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.order_id}>
                <td>{order.market_id}</td>
                <td className={order.side.toLowerCase()}>{order.side}</td>
                <td>{order.price.toFixed(4)}</td>
                <td>{order.quantity.toFixed(4)}</td>
                <td>
                  {((order.quantity - order.remaining_qty) / order.quantity * 100).toFixed(1)}%
                </td>
                <td>{order.status}</td>
                <td>
                  <button onClick={() => handleCancel(order.order_id)}>Cancel</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
