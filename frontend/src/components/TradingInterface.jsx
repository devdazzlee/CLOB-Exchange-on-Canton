import { useState, useEffect } from 'react';
import { createContract, exerciseChoice, queryContracts } from '../services/cantonApi';

export default function TradingInterface({ partyId }) {
  const [tradingPair, setTradingPair] = useState('BTC/USDT');
  const [orderType, setOrderType] = useState('BUY');
  const [orderMode, setOrderMode] = useState('LIMIT');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [balance, setBalance] = useState({ BTC: '0.0', USDT: '0.0' });
  const [orders, setOrders] = useState([]);
  const [orderBook, setOrderBook] = useState({ buys: [], sells: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (partyId) {
      loadBalance();
      loadOrders();
      loadOrderBook();
    }
  }, [partyId]);

  const loadBalance = async () => {
    try {
      // Query UserAccount contracts
      const accounts = await queryContracts('UserAccount:UserAccount', partyId);
      if (accounts.length > 0) {
        const account = accounts[0];
        // Mock balance display - in real implementation, call GetBalance choice
        setBalance({
          BTC: account.payload?.balances?.BTC || '0.0',
          USDT: account.payload?.balances?.USDT || '0.0'
        });
      }
    } catch (err) {
      console.error('Error loading balance:', err);
    }
  };

  const loadOrders = async () => {
    try {
      const userOrders = await queryContracts('Order:Order', partyId);
      setOrders(userOrders.map(o => ({
        id: o.payload?.orderId,
        type: o.payload?.orderType,
        mode: o.payload?.orderMode,
        pair: o.payload?.tradingPair,
        price: o.payload?.price,
        quantity: o.payload?.quantity,
        filled: o.payload?.filled,
        status: o.payload?.status,
        contractId: o.contractId
      })));
    } catch (err) {
      console.error('Error loading orders:', err);
    }
  };

  const loadOrderBook = async () => {
    try {
      const orderBooks = await queryContracts('OrderBook:OrderBook');
      if (orderBooks.length > 0) {
        const book = orderBooks[0];
        // Fetch buy and sell orders
        const buyCids = book.payload?.buyOrders || [];
        const sellCids = book.payload?.sellOrders || [];
        
        // In a real implementation, fetch each order contract
        // For now, mock the display
        setOrderBook({
          buys: buyCids.map((cid, i) => ({
            price: `50000${i}`,
            quantity: '0.1',
            type: 'BUY'
          })),
          sells: sellCids.map((cid, i) => ({
            price: `51000${i}`,
            quantity: '0.1',
            type: 'SELL'
          }))
        });
      }
    } catch (err) {
      console.error('Error loading order book:', err);
    }
  };

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate inputs
      if (!quantity || parseFloat(quantity) <= 0) {
        throw new Error('Invalid quantity');
      }

      if (orderMode === 'LIMIT' && (!price || parseFloat(price) <= 0)) {
        throw new Error('Price required for limit orders');
      }

      // Generate order ID
      const orderId = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Find or create order book for this trading pair
      const orderBooks = await queryContracts('OrderBook:OrderBook');
      let orderBookContract = orderBooks.find(ob => ob.payload?.tradingPair === tradingPair);

      if (!orderBookContract) {
        // Create order book if it doesn't exist
        // Note: In production, this should be done by an operator
        throw new Error('Order book not found. Please contact operator to create one.');
      }

      // Add order to order book
      const result = await exerciseChoice(
        orderBookContract.contractId,
        'AddOrder',
        {
          orderId: orderId,
          owner: partyId,
          orderType: orderType,
          orderMode: orderMode,
          price: orderMode === 'LIMIT' ? { Some: parseFloat(price) } : { None: null },
          quantity: parseFloat(quantity)
        },
        partyId
      );

      // Reload orders and order book
      await loadOrders();
      await loadOrderBook();

      // Reset form
      setPrice('');
      setQuantity('');

      alert('Order placed successfully!');
    } catch (err) {
      setError(err.message || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelOrder = async (contractId) => {
    if (!confirm('Are you sure you want to cancel this order?')) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      await exerciseChoice(contractId, 'CancelOrder', {}, partyId);
      await loadOrders();
      await loadOrderBook();
      alert('Order cancelled successfully!');
    } catch (err) {
      setError(err.message || 'Failed to cancel order');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="trading-interface">
      <h2>Trading Interface</h2>
      
      {error && <div className="error">{error}</div>}

      <div className="trading-layout">
        {/* Balance Display */}
        <div className="balance-section">
          <h3>Your Balance</h3>
          <div className="balance-display">
            <div className="balance-item">
              <span className="token">BTC:</span>
              <span className="amount">{balance.BTC}</span>
            </div>
            <div className="balance-item">
              <span className="token">USDT:</span>
              <span className="amount">{balance.USDT}</span>
            </div>
          </div>
        </div>

        {/* Order Placement Form */}
        <div className="order-form-section">
          <h3>Place Order</h3>
          <form onSubmit={handlePlaceOrder} className="order-form">
            <div className="form-group">
              <label>Trading Pair</label>
              <select
                value={tradingPair}
                onChange={(e) => setTradingPair(e.target.value)}
                className="form-control"
              >
                <option value="BTC/USDT">BTC/USDT</option>
                <option value="ETH/USDT">ETH/USDT</option>
              </select>
            </div>

            <div className="form-group">
              <label>Order Type</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    value="BUY"
                    checked={orderType === 'BUY'}
                    onChange={(e) => setOrderType(e.target.value)}
                  />
                  Buy
                </label>
                <label>
                  <input
                    type="radio"
                    value="SELL"
                    checked={orderType === 'SELL'}
                    onChange={(e) => setOrderType(e.target.value)}
                  />
                  Sell
                </label>
              </div>
            </div>

            <div className="form-group">
              <label>Order Mode</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    value="LIMIT"
                    checked={orderMode === 'LIMIT'}
                    onChange={(e) => setOrderMode(e.target.value)}
                  />
                  Limit
                </label>
                <label>
                  <input
                    type="radio"
                    value="MARKET"
                    checked={orderMode === 'MARKET'}
                    onChange={(e) => setOrderMode(e.target.value)}
                  />
                  Market
                </label>
              </div>
            </div>

            <div className="form-group">
              <label>Price {orderMode === 'MARKET' && '(Market Order)'}</label>
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={orderMode === 'MARKET'}
                className="form-control"
                placeholder={orderMode === 'MARKET' ? 'Market price' : 'Enter price'}
              />
            </div>

            <div className="form-group">
              <label>Quantity</label>
              <input
                type="number"
                step="0.00000001"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="form-control"
                placeholder="Enter quantity"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary btn-block"
            >
              {loading ? 'Placing Order...' : 'Place Order'}
            </button>
          </form>
        </div>

        {/* Order Book */}
        <div className="orderbook-section">
          <h3>Order Book - {tradingPair}</h3>
          <div className="orderbook">
            <div className="orderbook-side">
              <h4>Sell Orders</h4>
              <table className="orderbook-table">
                <thead>
                  <tr>
                    <th>Price</th>
                    <th>Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {orderBook.sells.map((order, i) => (
                    <tr key={i} className="sell-order">
                      <td>{order.price}</td>
                      <td>{order.quantity}</td>
                    </tr>
                  ))}
                  {orderBook.sells.length === 0 && (
                    <tr>
                      <td colSpan="2" className="empty">No sell orders</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="orderbook-side">
              <h4>Buy Orders</h4>
              <table className="orderbook-table">
                <thead>
                  <tr>
                    <th>Price</th>
                    <th>Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {orderBook.buys.map((order, i) => (
                    <tr key={i} className="buy-order">
                      <td>{order.price}</td>
                      <td>{order.quantity}</td>
                    </tr>
                  ))}
                  {orderBook.buys.length === 0 && (
                    <tr>
                      <td colSpan="2" className="empty">No buy orders</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* User's Active Orders */}
        <div className="user-orders-section">
          <h3>Your Active Orders</h3>
          <table className="orders-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Mode</th>
                <th>Price</th>
                <th>Quantity</th>
                <th>Filled</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.id?.substring(0, 10)}...</td>
                  <td className={order.type === 'BUY' ? 'buy' : 'sell'}>
                    {order.type}
                  </td>
                  <td>{order.mode}</td>
                  <td>
                    {order.price?.Some || order.price === null
                      ? order.price?.Some || 'Market'
                      : 'N/A'}
                  </td>
                  <td>{order.quantity}</td>
                  <td>{order.filled}</td>
                  <td className={`status status-${order.status?.toLowerCase()}`}>
                    {order.status}
                  </td>
                  <td>
                    {order.status === 'OPEN' && (
                      <button
                        onClick={() => handleCancelOrder(order.contractId)}
                        className="btn btn-danger btn-sm"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan="8" className="empty">No active orders</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

