import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, LogOut } from 'lucide-react';
import { useConfirmationModal } from './ConfirmationModal';
import DebugPanel from './DebugPanel';

// Import trading components
import OrderForm from './trading/OrderForm';
import OrderBookCard from './trading/OrderBookCard';
import ActiveOrdersTable from './trading/ActiveOrdersTable';
import DepthChart from './trading/DepthChart';
import RecentTrades from './trading/RecentTrades';
import GlobalTrades from './trading/GlobalTrades';
import TransactionHistory from './trading/TransactionHistory';
import PortfolioView from './trading/PortfolioView';
import MarketData from './trading/MarketData';

// Import skeleton components
import OrderBookSkeleton from './trading/OrderBookSkeleton';

// Import services
import websocketService from '../services/websocketService';
import { getAvailableTradingPairs, getGlobalOrderBook } from '../services/cantonApi';

export default function TradingInterface({ partyId }) {
  // === PHASE 1: ALL HOOKS MUST BE DECLARED FIRST - NO EXCEPTIONS ===
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isAlive, setIsAlive] = useState(true);
  const heartbeatRef = useRef(Date.now());
  
  const [tradingPair, setTradingPair] = useState('BTC/USDT');
  const [availablePairs, setAvailablePairs] = useState(['BTC/USDT']);
  const [orderType, setOrderType] = useState('BUY');
  const [orderMode, setOrderMode] = useState('LIMIT');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [balance, setBalance] = useState({ BTC: '0.0', USDT: '0.0' });
  const [balanceLoading, setBalanceLoading] = useState(false);
  const isMintingRef = useRef(false);
  const lastMintAtRef = useRef(0);
  const hasLoadedBalanceRef = useRef(false);
  const [orders, setOrders] = useState([]);
  const [orderBook, setOrderBook] = useState({ buys: [], sells: [] });
  const [loading, setLoading] = useState(false);
  const [orderBookLoading, setOrderBookLoading] = useState(true);
  const [orderBookExists, setOrderBookExists] = useState(true);
  const [error, setError] = useState('');
  const [creatingOrderBook, setCreatingOrderBook] = useState(false);
  const [trades, setTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('trading');
  const { showModal, ModalComponent, isOpenRef: modalIsOpenRef } = useConfirmationModal();
  const isLoadingRef = useRef(false);

  // === PHASE 3: ALL USECALLBACK HOOKS - NO CONDITIONALS ===
  const handleMintTokens = useCallback(async () => {
    console.log('[Mint] Manual mint button clicked!');
    
    try {
      // Try to use backend mint endpoint
      const response = await fetch(`http://localhost:3001/api/balance/${partyId}/mint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          BTC: '100.0',
          USDT: '1000000.0',
          ETH: '1000.0',
          SOL: '10000.0'
        })
      });
      
      if (response.ok) {
        const mintData = await response.json();
        if (mintData.success && mintData.data?.balance) {
          setBalance(mintData.data.balance);
          console.log('[Mint] Backend mint successful:', mintData.data.balance);
          alert(`Test tokens minted via backend!\nBTC: ${mintData.data.balance.BTC}\nUSDT: ${mintData.data.balance.USDT}\nETH: ${mintData.data.balance.ETH}\nSOL: ${mintData.data.balance.SOL}`);
          return;
        }
      }
    } catch (err) {
      console.log('[Mint] Backend mint failed, using local fallback');
    }
    
    // Fallback: Local mint
    const newBalance = {
      BTC: '100.0',
      USDT: '1000000.0',
      ETH: '1000.0',
      SOL: '10000.0'
    };
    
    setBalance(newBalance);
    console.log('[Mint] Local fallback mint successful:', newBalance);
    alert(`Test tokens minted locally!\nBTC: ${newBalance.BTC}\nUSDT: ${newBalance.USDT}\nETH: ${newBalance.ETH}\nSOL: ${newBalance.SOL}`);
  }, [partyId]);

  const handlePlaceOrder = useCallback(async (orderData) => {
    try {
      setLoading(true);
      console.log('[Place Order] Placing order:', orderData);
      
      // Use apiService for proper authentication and error handling
      const { placeOrder } = await import('../services/apiService');
      
      const result = await placeOrder({
        tradingPair: orderData.tradingPair,
        orderType: orderData.orderType,
        orderMode: orderData.orderMode,
        price: orderData.price,
        quantity: orderData.quantity,
        timeInForce: orderData.timeInForce || 'GTC',
        stopLoss: orderData.stopLoss || null
      });

      console.log('[Place Order] Order placed successfully:', result);
      
      // Clear form fields on success
      setPrice('');
      setQuantity('');
      
      // Show success message
      alert('Order placed successfully!');
      
    } catch (error) {
      console.error('[Place Order] Failed:', error);
      setError(error.message || 'Failed to place order');
      alert(`Failed to place order: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  const handleCancelOrder = useCallback(async (orderId) => {
    try {
      console.log('[Cancel Order] Cancelling order:', orderId);
      // Order cancellation logic would go here
    } catch (error) {
      console.error('[Cancel Order] Failed:', error);
      setError(error.message || 'Failed to cancel order');
    }
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('canton_party_id');
    window.location.href = '/';
  }, []);

  // === PHASE 2: ALL USEEFFECT HOOKS - NO CONDITIONALS ===
  useEffect(() => {
    const handleError = (event) => {
      console.error('[TradingInterface] Global error caught:', event.error);
      setErrorMessage(`${event.error?.message || 'Unknown error'} (${event.filename}:${event.lineno}:${event.colno})`);
      setHasError(true);
    };

    const handleUnhandledRejection = (event) => {
      console.error('[TradingInterface] Unhandled promise rejection:', event.reason);
      setErrorMessage(`Promise rejection: ${event.reason?.message || event.reason}`);
      setHasError(true);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    const heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastHeartbeat = now - heartbeatRef.current;
      
      if (timeSinceLastHeartbeat > 10000) {
        console.error('[TradingInterface] UI appears to be unresponsive - no heartbeat for', timeSinceLastHeartbeat, 'ms');
        setErrorMessage(`UI unresponsive - no heartbeat for ${timeSinceLastHeartbeat}ms`);
        setHasError(true);
        setIsAlive(false);
      }
    }, 2000);

    return () => clearInterval(heartbeatInterval);
  }, []);

  useEffect(() => {
    const heartbeatUpdater = setInterval(() => {
      heartbeatRef.current = Date.now();
      setIsAlive(true);
    }, 2000);

    return () => clearInterval(heartbeatUpdater);
  }, []);

  useEffect(() => {
    if (!partyId) return;

    const initializeData = async () => {
      try {
        console.log('[TradingInterface] Initializing with partyId:', partyId);
        console.log('[TradingInterface] Loading available trading pairs...');
        
        const pairs = await getAvailableTradingPairs(partyId);
        console.log('[TradingInterface] Found pairs:', pairs);
        
        setAvailablePairs(pairs.length > 0 ? pairs : ['BTC/USDT']);
        console.log('[TradingInterface] Data initialization completed');
      } catch (error) {
        console.error('[TradingInterface] Failed to initialize data:', error);
        setError('Failed to initialize trading interface');
      }
    };

    initializeData();
      
    if (websocketService && !websocketService.isConnected()) {
      websocketService.connect();
    }
  }, [partyId]);

  useEffect(() => {
    if (!partyId) return;

    let interval = null;
    let hasLoadedOrderBook = false;
    
    const orderBookCallback = (data) => {
      try {
        if (data?.tradingPair === tradingPair) {
          setOrderBook({
            buys: Array.isArray(data.buyOrders) ? data.buyOrders : [],
            sells: Array.isArray(data.sellOrders) ? data.sellOrders : []
          });
          if (!hasLoadedOrderBook) {
            setOrderBookLoading(false);
            hasLoadedOrderBook = true;
          }
        }
      } catch (err) {
        console.error('[TradingInterface] Error in orderBook callback:', err);
      }
    };

    const tradeCallback = (data) => {
      try {
        if (data?.tradingPair === tradingPair) {
          setTrades(prev => [data, ...prev.slice(0, 49)]);
        }
      } catch (err) {
        console.error('[TradingInterface] Error in trade callback:', err);
      }
    };

    // Initial load
    const loadInitialOrderBook = async () => {
      try {
        const bookData = await getGlobalOrderBook(tradingPair);
        if (bookData) {
          setOrderBook({
            buys: bookData.buyOrders || [],
            sells: bookData.sellOrders || []
          });
          setOrderBookLoading(false);
          hasLoadedOrderBook = true;
        }
      } catch (error) {
        console.error('[TradingInterface] Failed to load initial order book:', error);
        setOrderBookLoading(false);
      }
    };

    loadInitialOrderBook();

    if (!websocketService.isConnected()) {
      websocketService.connect();
    }

    websocketService.subscribe(`orderbook:${tradingPair}`, orderBookCallback);
    websocketService.subscribe(`trades:${tradingPair}`, tradeCallback);

    interval = setInterval(async () => {
      if (!isLoadingRef.current) {
        try {
          const bookData = await getGlobalOrderBook(tradingPair);
          if (bookData) {
            setOrderBook({
              buys: bookData.buyOrders || [],
              sells: bookData.sellOrders || []
            });
          }
        } catch (error) {
          console.error('[TradingInterface] Failed to poll order book:', error);
        }
      }
    }, 30000);

    return () => {
      if (interval) clearInterval(interval);
      websocketService.unsubscribe(`orderbook:${tradingPair}`, orderBookCallback);
      websocketService.unsubscribe(`trades:${tradingPair}`, tradeCallback);
    };
  }, [partyId, tradingPair]);

  useEffect(() => {
    if (!partyId) return;

    const loadBalance = async (showLoader = false) => {
      try {
        if (showLoader && !hasLoadedBalanceRef.current) {
          setBalanceLoading(true);
        }
        console.log('[Balance] Loading balance for party:', partyId);
        
        // Try to load real balance from backend first
        try {
          const response = await fetch(`http://localhost:3001/api/balance/${partyId}`);
          if (response.ok) {
            const balanceData = await response.json();
            if (balanceData.success && balanceData.data?.balance) {
              setBalance(balanceData.data.balance);
              console.log('[Balance] Real balance loaded:', balanceData.data.balance);
              hasLoadedBalanceRef.current = true;
              return;
            }
          }
        } catch (balanceError) {
          console.error('[Balance] Backend balance fetch failed:', balanceError);
          throw new Error('Failed to fetch balances - please check your connection');
        }
      } catch (error) {
        console.error('[Balance] Failed to load balance:', error);
      } finally {
        if (hasLoadedBalanceRef.current) {
          setBalanceLoading(false);
        }
      }
    };

    // Add keyboard shortcut for minting (Ctrl+M)
    const handleKeyPress = (event) => {
      if (event.ctrlKey && event.key === 'm') {
        event.preventDefault();
        console.log('[Mint] Keyboard shortcut triggered (Ctrl+M)');
        handleMintTokens();
      }
    };

    loadBalance(true);
    const balanceInterval = setInterval(() => loadBalance(false), 60000); // Reduced from 30s to 60s to avoid spam
    window.addEventListener('keydown', handleKeyPress);

    return () => {
      clearInterval(balanceInterval);
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [partyId]);

  // === PHASE 4: ALL USEMEMO HOOKS - NO CONDITIONALS ===
  const memoizedModal = useMemo(() => <ModalComponent />, [ModalComponent]);

  // === PHASE 5: CONDITIONAL LOGIC - AFTER ALL HOOKS ===
  // Early returns based on state
  if (hasError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0B0E11]">
        <div className="text-center space-y-4 p-8">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto" />
          <h3 className="text-2xl font-bold text-white">Trading Interface Error</h3>
          <p className="text-gray-300 max-w-md">{errorMessage}</p>
          <div className="space-y-2">
            <button
              onClick={() => {
                setHasError(false);
                setErrorMessage('');
                window.location.reload();
              }}
              className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Reload Page
            </button>
            <button
              onClick={() => window.location.href = '/'}
              className="block mx-auto px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              Go to Home
            </button>
          </div>
          <details className="text-left text-gray-400 text-sm">
            <summary>Technical Details</summary>
            <pre className="mt-2 p-2 bg-gray-800 rounded overflow-auto">
              {errorMessage}
            </pre>
          </details>
        </div>
      </div>
    );
  }

  if (!partyId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Party ID is required</p>
        </div>
      </div>
    );
  }

  if (error && !loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
          <h3 className="text-lg font-semibold text-foreground">Error</h3>
          <p className="text-muted-foreground max-w-md">{error}</p>
          <button
            onClick={() => setError('')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-muted-foreground">Loading trading interface...</p>
        </div>
      </div>
    );
  }

  // === PHASE 6: MAIN RENDER - NO HOOKS HERE ===
  return (
    <>
      {memoizedModal}
      <DebugPanel partyId={partyId} />
      
      {/* Heartbeat Indicator */}
      <div style={{
        position: 'fixed',
        top: '10px',
        left: '10px',
        zIndex: 9999,
        background: isAlive ? '#00ff00' : '#ff0000',
        color: '#000',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '10px',
        fontFamily: 'monospace'
      }}>
        {isAlive ? 'ALIVE' : 'DEAD'} - {new Date().toLocaleTimeString()}
      </div>
      
    <div className="space-y-6">
      <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold text-foreground">Trading Interface</h2>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
            <span className="text-sm text-muted-foreground">Connected</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center space-x-2 px-4 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 hover:border-destructive/40 rounded-md transition-colors text-sm font-medium"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </div>
      
      {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-destructive/10 border border-destructive rounded-lg p-4"
          >
            <p className="text-destructive text-sm">{error}</p>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {balanceLoading ? (
            <OrderBookSkeleton />
          ) : (
            <OrderForm
              tradingPair={tradingPair}
              availablePairs={availablePairs}
              onTradingPairChange={setTradingPair}
              orderBookExists={orderBookExists}
              orderType={orderType}
              onOrderTypeChange={(e) => setOrderType(e.target.value)}
              orderMode={orderMode}
              onOrderModeChange={(e) => setOrderMode(e.target.value)}
              price={price}
              onPriceChange={setPrice}
              quantity={quantity}
              onQuantityChange={setQuantity}
              loading={loading}
              onSubmit={handlePlaceOrder}
              balance={balance}
              orderBook={orderBook}
            />
          )}
          
          {/* Balance Card */}
          {/* {balanceLoading ? (
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="animate-pulse">
                <div className="h-6 bg-muted rounded mb-4"></div>
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-muted rounded-full"></div>
                        <div>
                          <div className="h-4 bg-muted rounded w-16 mb-1"></div>
                          <div className="h-3 bg-muted rounded w-12"></div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="h-4 bg-muted rounded w-20 mb-1"></div>
                        <div className="h-3 bg-muted rounded w-8"></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Balances</h3>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      console.log('[Mint] Button clicked directly!');
                      handleMintTokens();
                    }}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-md transition-colors shadow-lg hover:shadow-xl transform hover:scale-105"
                    title="Mint test tokens"
                    style={{ cursor: 'pointer', zIndex: 1000 }}
                  >
                    🪙 Mint Test Tokens
                  </button>
                </div>
                <div className="space-y-3">
                  {Object.entries(balance).map(([token, amount]) => (
                    <div key={token} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center text-xs font-bold">
                          {token.substring(0, 2)}
                        </div>
                        <div>
                          <div className="font-medium">{token}</div>
                          <div className="text-sm text-muted-foreground">Available</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-semibold">{parseFloat(amount).toLocaleString()}</div>
                        <div className="text-sm text-muted-foreground">{token}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )} */}
        </div>

        {/* Order Book and Active Orders */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Order Book */}
            <OrderBookCard 
              orderBook={orderBook}
              loading={orderBookLoading}
              tradingPair={tradingPair}
            />

            {/* Active Orders */}
            <ActiveOrdersTable
              orders={orders}
              loading={loading}
              onCancelOrder={handleCancelOrder}
              partyId={partyId}
            />
          </div>

          {/* Market Data and Recent Trades */}
          <div className="space-y-6">
            <MarketData 
              tradingPair={tradingPair}
              orderBook={orderBook}
            />
            
            <RecentTrades 
              trades={trades}
              loading={tradesLoading}
              tradingPair={tradingPair}
            />
          </div>
        </div>

        {/* Charts and History */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DepthChart 
            orderBook={orderBook}
            loading={orderBookLoading}
            tradingPair={tradingPair}
          />
          
          <TransactionHistory 
            partyId={partyId}
            tradingPair={tradingPair}
          />
        </div>
      </div>
    </>
  );
}
