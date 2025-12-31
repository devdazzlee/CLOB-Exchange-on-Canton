import { useState, useEffect } from 'react';
import { createContract, exerciseChoice, queryContracts, fetchContracts } from '../services/cantonApi';

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
      
      // Refresh order book every 5 seconds
      const interval = setInterval(() => {
        loadOrderBook();
        loadOrders();
      }, 5000);
      
      return () => clearInterval(interval);
    }
  }, [partyId, tradingPair]);

  const loadBalance = async () => {
    try {
      const accounts = await queryContracts('UserAccount:UserAccount', partyId);
      if (accounts.length > 0) {
        const account = accounts[0];
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
      const book = orderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
      
      if (!book) {
        setOrderBook({ buys: [], sells: [] });
        return;
      }

      const buyCids = book.payload?.buyOrders || [];
      const sellCids = book.payload?.sellOrders || [];
      
      // Fetch all order contracts
      const allCids = [...buyCids, ...sellCids];
      const orderContracts = await fetchContracts(allCids);
      
      // Process buy orders
      const buyOrders = orderContracts
        .filter((contract, index) => index < buyCids.length && contract?.payload?.status === 'OPEN')
        .map(contract => ({
          price: contract.payload?.price?.Some || null,
          quantity: parseFloat(contract.payload?.quantity || 0),
          filled: parseFloat(contract.payload?.filled || 0),
          remaining: parseFloat(contract.payload?.quantity || 0) - parseFloat(contract.payload?.filled || 0),
          timestamp: contract.payload?.timestamp || 0
        }))
        .filter(order => order.remaining > 0) // Only show orders with remaining quantity
        .sort((a, b) => {
          // Sort buy orders: highest price first, then by timestamp (oldest first)
          if (a.price === null && b.price === null) return a.timestamp - b.timestamp;
          if (a.price === null) return 1; // Market orders go to end
          if (b.price === null) return -1;
          if (b.price !== a.price) return b.price - a.price; // Higher price first
          return a.timestamp - b.timestamp; // Older first for same price
        });

      // Process sell orders
      const sellOrders = orderContracts
        .filter((contract, index) => index >= buyCids.length && contract?.payload?.status === 'OPEN')
        .map(contract => ({
          price: contract.payload?.price?.Some || null,
          quantity: parseFloat(contract.payload?.quantity || 0),
          filled: parseFloat(contract.payload?.filled || 0),
          remaining: parseFloat(contract.payload?.quantity || 0) - parseFloat(contract.payload?.filled || 0),
          timestamp: contract.payload?.timestamp || 0
        }))
        .filter(order => order.remaining > 0) // Only show orders with remaining quantity
        .sort((a, b) => {
          // Sort sell orders: lowest price first, then by timestamp (oldest first)
          if (a.price === null && b.price === null) return a.timestamp - b.timestamp;
          if (a.price === null) return 1; // Market orders go to end
          if (b.price === null) return -1;
          if (a.price !== b.price) return a.price - b.price; // Lower price first
          return a.timestamp - b.timestamp; // Older first for same price
        });

      setOrderBook({
        buys: buyOrders,
        sells: sellOrders
      });
    } catch (err) {
      console.error('Error loading order book:', err);
      setOrderBook({ buys: [], sells: [] });
    }
  };

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!quantity || parseFloat(quantity) <= 0) {
        throw new Error('Invalid quantity');
      }

      if (orderMode === 'LIMIT' && (!price || parseFloat(price) <= 0)) {
        throw new Error('Price required for limit orders');
      }

      const orderId = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const orderBooks = await queryContracts('OrderBook:OrderBook');
      let orderBookContract = orderBooks.find(ob => ob.payload?.tradingPair === tradingPair);

      if (!orderBookContract) {
        throw new Error('Order book not found. Please contact operator to create one.');
      }

      await exerciseChoice(
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

      await loadOrders();
      await loadOrderBook();
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold text-white">Trading Interface</h2>
        <div className="flex items-center space-x-2">
          <span className="text-green-400 text-sm font-semibold">●</span>
          <span className="text-sm text-gray-400">Connected</span>
        </div>
      </div>
      
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Balance Card */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Your Balance</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
              <span className="text-gray-400 font-medium">BTC</span>
              <span className="text-xl font-bold text-blue-400">{balance.BTC}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
              <span className="text-gray-400 font-medium">USDT</span>
              <span className="text-xl font-bold text-green-400">{balance.USDT}</span>
            </div>
          </div>
        </div>

        {/* Order Form */}
        <div className="card lg:col-span-2">
          <h3 className="text-lg font-semibold text-white mb-4">Place Order</h3>
          <form onSubmit={handlePlaceOrder} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Trading Pair</label>
                <select
                  value={tradingPair}
                  onChange={(e) => setTradingPair(e.target.value)}
                  className="input"
                >
                  <option value="BTC/USDT">BTC/USDT</option>
                  <option value="ETH/USDT">ETH/USDT</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Order Type</label>
                <div className="flex space-x-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      value="BUY"
                      checked={orderType === 'BUY'}
                      onChange={(e) => setOrderType(e.target.value)}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                    />
                    <span className={`font-medium ${orderType === 'BUY' ? 'text-green-400' : 'text-gray-400'}`}>Buy</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      value="SELL"
                      checked={orderType === 'SELL'}
                      onChange={(e) => setOrderType(e.target.value)}
                      className="w-4 h-4 text-red-600 focus:ring-red-500"
                    />
                    <span className={`font-medium ${orderType === 'SELL' ? 'text-red-400' : 'text-gray-400'}`}>Sell</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Order Mode</label>
                <div className="flex space-x-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      value="LIMIT"
                      checked={orderMode === 'LIMIT'}
                      onChange={(e) => setOrderMode(e.target.value)}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-gray-300">Limit</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      value="MARKET"
                      checked={orderMode === 'MARKET'}
                      onChange={(e) => setOrderMode(e.target.value)}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-gray-300">Market</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Price {orderMode === 'MARKET' && <span className="text-gray-500">(Market)</span>}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  disabled={orderMode === 'MARKET'}
                  className="input disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder={orderMode === 'MARKET' ? 'Market price' : 'Enter price'}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Quantity</label>
              <input
                type="number"
                step="0.00000001"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="input"
                placeholder="Enter quantity"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`btn btn-primary w-full py-3 ${orderType === 'BUY' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Placing Order...
                </span>
              ) : (
                `${orderType} ${tradingPair.split('/')[0]}`
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Order Book */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Order Book - {tradingPair}</h3>
          <button
            onClick={loadOrderBook}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            title="Refresh order book"
          >
            ↻ Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium text-red-400 mb-3">Sell Orders</h4>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-2 px-3 text-sm font-medium text-gray-400">Price</th>
                    <th className="text-right py-2 px-3 text-sm font-medium text-gray-400">Quantity</th>
                    <th className="text-right py-2 px-3 text-sm font-medium text-gray-400">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orderBook.sells.length > 0 ? (
                    orderBook.sells.map((order, i) => (
                      <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                        <td className="py-2 px-3 text-red-400 font-mono">
                          {order.price !== null ? order.price.toLocaleString() : 'Market'}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-300">{order.remaining.toFixed(8)}</td>
                        <td className="py-2 px-3 text-right text-gray-400 text-sm">
                          {order.price !== null ? (order.price * order.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" className="py-8 text-center text-gray-500 text-sm">No sell orders</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium text-green-400 mb-3">Buy Orders</h4>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-2 px-3 text-sm font-medium text-gray-400">Price</th>
                    <th className="text-right py-2 px-3 text-sm font-medium text-gray-400">Quantity</th>
                    <th className="text-right py-2 px-3 text-sm font-medium text-gray-400">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orderBook.buys.length > 0 ? (
                    orderBook.buys.map((order, i) => (
                      <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                        <td className="py-2 px-3 text-green-400 font-mono">
                          {order.price !== null ? order.price.toLocaleString() : 'Market'}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-300">{order.remaining.toFixed(8)}</td>
                        <td className="py-2 px-3 text-right text-gray-400 text-sm">
                          {order.price !== null ? (order.price * order.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" className="py-8 text-center text-gray-500 text-sm">No buy orders</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Active Orders */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4">Your Active Orders</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">ID</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Type</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Mode</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Price</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-400">Quantity</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-400">Filled</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.length > 0 ? (
                orders.map((order) => (
                  <tr key={order.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-3 px-4 text-gray-300 font-mono text-sm">{order.id?.substring(0, 10)}...</td>
                    <td className={`py-3 px-4 font-semibold ${order.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                      {order.type}
                    </td>
                    <td className="py-3 px-4 text-gray-300">{order.mode}</td>
                    <td className="py-3 px-4 text-gray-300">
                      {order.price?.Some || order.price === null ? (order.price?.Some || 'Market') : 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-300">{order.quantity}</td>
                    <td className="py-3 px-4 text-right text-gray-300">{order.filled}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        order.status === 'OPEN' ? 'bg-blue-500/20 text-blue-400' :
                        order.status === 'FILLED' ? 'bg-green-500/20 text-green-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
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
                ))
              ) : (
                <tr>
                  <td colSpan="8" className="py-8 text-center text-gray-500 text-sm">No active orders</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
