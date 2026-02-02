import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { useConfirmationModal } from './ConfirmationModal';
import { useToast, OrderSuccessModal } from './ui/toast';

// Import trading components
import OrderForm from './trading/OrderForm';
import OrderBookCard from './trading/OrderBookCard';
import ActiveOrdersTable from './trading/ActiveOrdersTable';
import DepthChart from './trading/DepthChart';
import PriceChart from './trading/PriceChart';
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
  const toast = useToast();
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
  const [balance, setBalance] = useState({ BTC: '0.0', USDT: '0.0', ETH: '0.0', SOL: '0.0' });
  const [balanceLoading, setBalanceLoading] = useState(false);
  const isMintingRef = useRef(false);
  const lastMintAtRef = useRef(0);
  const hasLoadedBalanceRef = useRef(false);
  const [orders, setOrders] = useState([]);
  const [orderBook, setOrderBook] = useState({ buys: [], sells: [] });
  const [loading, setLoading] = useState(false);
  const [orderPlacing, setOrderPlacing] = useState(false); // Separate state for order placement
  const [orderBookLoading, setOrderBookLoading] = useState(true);
  const [orderBookExists, setOrderBookExists] = useState(true);
  const [error, setError] = useState('');
  const [creatingOrderBook, setCreatingOrderBook] = useState(false);
  const [trades, setTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('trading');
  const [showOrderSuccess, setShowOrderSuccess] = useState(false);
  const [lastOrderData, setLastOrderData] = useState(null);
  const { showModal, ModalComponent, isOpenRef: modalIsOpenRef } = useConfirmationModal();
  const isLoadingRef = useRef(false);

  // Minting state
  const [mintingLoading, setMintingLoading] = useState(false);
  
  // === PHASE 3: ALL USECALLBACK HOOKS - NO CONDITIONALS ===
  const handleMintTokens = useCallback(async () => {
    console.log('[Mint] Manual mint button clicked for party:', partyId);
    
    if (mintingLoading || isMintingRef.current) {
      console.log('[Mint] Already minting, skipping...');
      return;
    }
    
    isMintingRef.current = true;
    setMintingLoading(true);
    
    const API_BASE = import.meta.env.VITE_API_BASE_URL || 
      (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
    
    try {
      // Try the balance/mint endpoint (creates/updates UserAccount)
      const response = await fetch(`${API_BASE}/balance/mint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          partyId: partyId,
          tokens: [
            { symbol: 'BTC', amount: 10 },
            { symbol: 'USDT', amount: 100000 },
            { symbol: 'ETH', amount: 100 },
            { symbol: 'SOL', amount: 1000 }
          ]
        })
      });
      
      const mintData = await response.json();
      
      if (response.ok && mintData.success) {
        console.log('[Mint] Backend mint successful:', mintData);
        toast.success('Test tokens minted successfully!', {
          title: '🪙 Tokens Minted',
          details: 'BTC: 10 | USDT: 100,000 | ETH: 100 | SOL: 1,000'
        });
        
        // Refresh balance from backend
        setTimeout(async () => {
          try {
            const balanceResponse = await fetch(`${API_BASE}/balance/${partyId}`);
            const balanceData = await balanceResponse.json();
            if (balanceResponse.ok && balanceData.success && balanceData.data?.balance) {
              setBalance({
                BTC: balanceData.data.balance.BTC || '0.0',
                USDT: balanceData.data.balance.USDT || '0.0',
                ETH: balanceData.data.balance.ETH || '0.0',
                SOL: balanceData.data.balance.SOL || '0.0'
              });
              console.log('[Mint] Balance refreshed:', balanceData.data.balance);
            }
          } catch (err) {
            console.error('[Mint] Failed to refresh balance:', err);
          }
        }, 1000);
        
        return;
      }
      
      // If the response wasn't ok, show error
      throw new Error(mintData.error || mintData.message || 'Failed to mint tokens');
      
    } catch (err) {
      console.error('[Mint] Backend mint failed:', err);
      toast.error(err.message || 'Failed to mint tokens. Please complete onboarding first.', {
        title: '❌ Mint Failed'
      });
    } finally {
      isMintingRef.current = false;
      setMintingLoading(false);
    }
  }, [partyId, toast, mintingLoading]);

  const handlePlaceOrder = useCallback(async (orderData) => {
    try {
      setOrderPlacing(true); // Use separate state - don't use setLoading which causes full-screen
      console.log('[Place Order] Placing order:', orderData);
      
      // Use the simpler /api/orders/place endpoint that works with partyId
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 
        (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
      
      const response = await fetch(`${API_BASE}/orders/place`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': partyId || 'anonymous'
        },
        body: JSON.stringify({
          tradingPair: orderData.tradingPair,
          orderType: orderData.orderType,
          orderMode: orderData.orderMode,
          price: orderData.price,
          quantity: orderData.quantity,
          partyId: partyId
        })
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || result.message || 'Failed to place order');
      }

      console.log('[Place Order] Order placed successfully:', result);
      
      // Clear form fields on success
      setPrice('');
      setQuantity('');
      
      // Show beautiful success modal
      setLastOrderData({
        orderId: result.data?.orderId,
        orderType: orderData.orderType,
        orderMode: orderData.orderMode,
        tradingPair: orderData.tradingPair,
        price: orderData.price,
        quantity: orderData.quantity
      });
      setShowOrderSuccess(true);
      
      // IMPORTANT: Refresh all data from API after order placement
      // This ensures UI shows real data, not stale cache
      console.log('[Place Order] Refreshing data from API...');
      
      // Refresh order book from API
      try {
        const bookResponse = await fetch(`${API_BASE}/orderbooks/${encodeURIComponent(tradingPair)}`);
        if (bookResponse.ok) {
          const bookData = await bookResponse.json();
          setOrderBook({
            buys: bookData.data?.raw?.buyOrders || [],
            sells: bookData.data?.raw?.sellOrders || []
          });
        }
      } catch (e) { console.error('[Refresh] Order book error:', e); }
      
      // Refresh user orders from API
      try {
        const ordersResponse = await fetch(`${API_BASE}/orders/user/${encodeURIComponent(partyId)}?status=OPEN`);
        if (ordersResponse.ok) {
          const ordersData = await ordersResponse.json();
          const ordersList = ordersData?.data?.orders || [];
          setOrders(ordersList.map(order => ({
            id: order.orderId || order.contractId,
            contractId: order.contractId,
            type: order.orderType,
            mode: order.orderMode,
            price: order.price,
            quantity: order.quantity,
            filled: order.filled || '0',
            status: order.status,
            tradingPair: order.tradingPair,
            timestamp: order.timestamp
          })));
        }
      } catch (e) { console.error('[Refresh] User orders error:', e); }
      
      // Refresh trades from API
      try {
        const tradesResponse = await fetch(`${API_BASE}/trades/${encodeURIComponent(tradingPair)}?limit=50`);
        if (tradesResponse.ok) {
          const tradesData = await tradesResponse.json();
          setTrades(tradesData?.data?.trades || []);
        }
      } catch (e) { console.error('[Refresh] Trades error:', e); }
      
    } catch (error) {
      console.error('[Place Order] Failed:', error);
      toast.error(error.message || 'Failed to place order', {
        title: '❌ Order Failed',
        duration: 6000
      });
    } finally {
      setOrderPlacing(false);
    }
  }, [partyId, toast]);

  const handleCancelOrder = useCallback(async (orderId) => {
    try {
      console.log('[Cancel Order] Cancelling order:', orderId);
      // Order cancellation logic would go here
    } catch (error) {
      console.error('[Cancel Order] Failed:', error);
      setError(error.message || 'Failed to cancel order');
    }
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
    // More robust heartbeat checker - increased threshold to 20 seconds
    // to account for temporary main thread blocking
    const heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastHeartbeat = now - heartbeatRef.current;
      
      // Only trigger error if no heartbeat for 20 seconds (was 10 seconds)
      // This accounts for temporary blocking from heavy operations
      if (timeSinceLastHeartbeat > 20000) {
        console.error('[TradingInterface] UI appears to be unresponsive - no heartbeat for', timeSinceLastHeartbeat, 'ms');
        setErrorMessage(`UI unresponsive - no heartbeat for ${timeSinceLastHeartbeat}ms`);
        setHasError(true);
        setIsAlive(false);
      }
    }, 3000); // Check every 3 seconds instead of 2

    return () => clearInterval(heartbeatInterval);
  }, []);

  useEffect(() => {
    // Robust heartbeat updater using recursive setTimeout
    // This is more reliable than setInterval when the main thread is busy
    let timeoutId;
    
    const updateHeartbeat = () => {
      heartbeatRef.current = Date.now();
      setIsAlive(true);
      // Use recursive setTimeout instead of setInterval for better reliability
      // This ensures the next update is scheduled after the current one completes
      timeoutId = setTimeout(updateHeartbeat, 2000);
    };
    
    // Initial update
    updateHeartbeat();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
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
        console.log('[WebSocket] Order book update received:', data?.type || 'FULL_UPDATE');
        
        // Handle NEW_ORDER event - add to user's orders if they own it
        if (data?.type === 'NEW_ORDER') {
          // Add to order book
          if (data.tradingPair === tradingPair) {
            setOrderBook(prev => {
              const newOrder = {
                contractId: data.contractId,
                orderId: data.orderId,
                price: data.price,
                quantity: data.quantity,
                remaining: data.remaining || data.quantity,
                owner: data.owner,
                timestamp: data.timestamp
              };
              
              if (data.orderType === 'BUY') {
                const newBuys = [...(prev.buys || []), newOrder]
                  .sort((a, b) => parseFloat(b.price || 0) - parseFloat(a.price || 0));
                return { ...prev, buys: newBuys };
              } else {
                const newSells = [...(prev.sells || []), newOrder]
                  .sort((a, b) => parseFloat(a.price || 0) - parseFloat(b.price || 0));
                return { ...prev, sells: newSells };
              }
            });
            
            // If this order belongs to the current user, add to their orders
            if (data.owner === partyId) {
              setOrders(prev => [{
                id: data.orderId,
                contractId: data.contractId,
                type: data.orderType,
                mode: data.orderMode,
                price: data.price,
                quantity: data.quantity,
                filled: '0',
                status: 'OPEN',
                tradingPair: data.tradingPair,
                timestamp: data.timestamp
              }, ...prev]);
              console.log('[WebSocket] Added new order to user orders:', data.orderId);
            }
          }
          return;
        }
        
        // Handle full order book update
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
        console.log('[WebSocket] Trade received:', data?.tradeId);
        if (data?.tradingPair === tradingPair) {
          // Add to trades list
          setTrades(prev => {
            // Avoid duplicates
            if (prev.some(t => t.tradeId === data.tradeId)) {
              return prev;
            }
            return [data, ...prev.slice(0, 49)];
          });
          
          // If current user was involved in the trade, update their orders
          if (data.buyer === partyId || data.seller === partyId) {
            console.log('[WebSocket] User involved in trade, refreshing orders');
            // Remove filled orders from user's order list
            setOrders(prev => prev.filter(order => {
              // Remove if this order was filled
              if (order.id === data.buyOrderId || order.id === data.sellOrderId) {
                return false;
              }
              return true;
            }));
          }
        }
      } catch (err) {
        console.error('[TradingInterface] Error in trade callback:', err);
      }
    };

    // Initial load - merge with existing (don't overwrite WebSocket data)
    const loadInitialOrderBook = async () => {
      try {
        console.log('[TradingInterface] Loading initial order book for:', tradingPair);
        const bookData = await getGlobalOrderBook(tradingPair);
        if (bookData) {
          // Only update if we got actual data
          setOrderBook(prev => ({
            buys: bookData.buyOrders?.length > 0 ? bookData.buyOrders : prev.buys,
            sells: bookData.sellOrders?.length > 0 ? bookData.sellOrders : prev.sells
          }));
          console.log('[TradingInterface] Order book loaded:', bookData);
        }
      } catch (error) {
        console.error('[TradingInterface] Failed to load initial order book:', error);
        // On error, keep existing data
      } finally {
        // Always stop loading regardless of success/failure
        setOrderBookLoading(false);
        setTradesLoading(false);
        hasLoadedOrderBook = true;
      }
    };

    loadInitialOrderBook();
    
    // Load initial trades from backend - merge with existing (don't overwrite WebSocket data)
    const loadInitialTrades = async () => {
      try {
        const API_BASE = import.meta.env.VITE_API_BASE_URL || 
          (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
        const response = await fetch(`${API_BASE}/trades/${encodeURIComponent(tradingPair)}?limit=50`);
        if (response.ok) {
          const data = await response.json();
          const tradesList = data?.data?.trades || data?.trades || [];
          
          // Merge with existing trades (keep WebSocket trades that aren't in API response)
          setTrades(prev => {
            if (tradesList.length === 0) {
              return prev; // Keep existing if API returns empty
            }
            // Merge: API trades + any WebSocket trades not in API
            const apiTradeIds = new Set(tradesList.map(t => t.tradeId));
            const newFromWs = prev.filter(t => !apiTradeIds.has(t.tradeId));
            return [...newFromWs, ...tradesList].slice(0, 50);
          });
          console.log('[TradingInterface] Initial trades loaded:', tradesList.length);
        }
      } catch (error) {
        console.error('[TradingInterface] Failed to load initial trades:', error);
        // On error, keep existing trades
      } finally {
        setTradesLoading(false);
      }
    };
    
    loadInitialTrades();

    if (!websocketService.isConnected()) {
      websocketService.connect();
    }

    websocketService.subscribe(`orderbook:${tradingPair}`, orderBookCallback);
    websocketService.subscribe(`trades:${tradingPair}`, tradeCallback);

    // Poll order book - but DON'T overwrite existing data with empty results
    interval = setInterval(async () => {
      if (!isLoadingRef.current) {
        try {
          const bookData = await getGlobalOrderBook(tradingPair);
          // Only update if we got actual data (not empty due to Canton 200+ limit)
          if (bookData && (bookData.buyOrders?.length > 0 || bookData.sellOrders?.length > 0)) {
            setOrderBook(prev => ({
              // Merge: keep existing if new is empty
              buys: bookData.buyOrders?.length > 0 ? bookData.buyOrders : prev.buys,
              sells: bookData.sellOrders?.length > 0 ? bookData.sellOrders : prev.sells
            }));
          }
          // If API returns empty, keep existing data (from WebSocket)
        } catch (error) {
          console.error('[TradingInterface] Failed to poll order book:', error);
          // On error, keep existing data
        }
      }
    }, 30000);

    return () => {
      if (interval) clearInterval(interval);
      websocketService.unsubscribe(`orderbook:${tradingPair}`, orderBookCallback);
      websocketService.unsubscribe(`trades:${tradingPair}`, tradeCallback);
    };
  }, [partyId, tradingPair]);

  // Load user's active orders
  useEffect(() => {
    if (!partyId) return;

    const loadUserOrders = async (isInitial = false) => {
      try {
        const API_BASE = import.meta.env.VITE_API_BASE_URL || 
          (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
        const response = await fetch(`${API_BASE}/orders/user/${encodeURIComponent(partyId)}?status=OPEN`);
        if (response.ok) {
          const data = await response.json();
          const ordersList = data?.data?.orders || data?.orders || [];
          
          // Transform orders to expected format
          const formattedOrders = ordersList.map(order => ({
            id: order.orderId || order.contractId,
            contractId: order.contractId,
            type: order.orderType,
            mode: order.orderMode,
            price: order.price,
            quantity: order.quantity,
            filled: order.filled || '0',
            status: order.status,
            tradingPair: order.tradingPair,
            timestamp: order.timestamp
          }));
          
          // Only update if we got data OR if it's initial load
          // Don't overwrite WebSocket data with empty API results
          if (formattedOrders.length > 0 || isInitial) {
            setOrders(prev => {
              // If API returned data, use it
              if (formattedOrders.length > 0) {
                return formattedOrders;
              }
              // If API returned empty but we have existing data, keep it
              return prev;
            });
          }
          console.log('[TradingInterface] User orders loaded:', formattedOrders.length);
        }
      } catch (error) {
        console.error('[TradingInterface] Failed to load user orders:', error);
        // On error, keep existing data
      }
    };

    loadUserOrders(true); // Initial load
    
    // Refresh user orders every 10 seconds - but don't overwrite with empty
    const ordersInterval = setInterval(() => loadUserOrders(false), 10000);
    
    return () => clearInterval(ordersInterval);
  }, [partyId]);

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
          const API_BASE = import.meta.env.VITE_API_BASE_URL || 
            (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
          const response = await fetch(`${API_BASE}/balance/${partyId}`);
          const balanceData = await response.json();
          
          if (response.ok && balanceData.success) {
            // Handle different response formats
            const balanceObj = balanceData.data?.balance || balanceData.data?.available || balanceData.data;
            if (balanceObj && typeof balanceObj === 'object') {
              setBalance({
                BTC: balanceObj.BTC || '0.0',
                USDT: balanceObj.USDT || '0.0',
                ETH: balanceObj.ETH || '0.0',
                SOL: balanceObj.SOL || '0.0'
              });
              console.log('[Balance] Balance loaded:', balanceObj);
              hasLoadedBalanceRef.current = true;
              return;
            }
          }
          // If response not ok, show zero balance (user needs onboarding)
          console.log('[Balance] Backend returned error - user may need onboarding');
          setBalance({ BTC: '0.0', USDT: '0.0', ETH: '0.0', SOL: '0.0' });
          hasLoadedBalanceRef.current = true;
        } catch (balanceError) {
          console.error('[Balance] Backend balance fetch failed:', balanceError);
          // Show zero balance on error (no fake balances)
          setBalance({ BTC: '0.0', USDT: '0.0', ETH: '0.0', SOL: '0.0' });
          hasLoadedBalanceRef.current = true;
        }
      } catch (error) {
        console.error('[Balance] Failed to load balance:', error);
        // Show zero balance on error (no fake balances)
        setBalance({ BTC: '0.0', USDT: '0.0', ETH: '0.0', SOL: '0.0' });
        hasLoadedBalanceRef.current = true;
      } finally {
        // FIX: Always stop loading regardless of outcome
        setBalanceLoading(false);
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

  // REMOVED: Full-screen error display - errors are now shown as toasts
  // Non-blocking error display is handled in the main render via motion.div

  // REMOVED: Full-screen loading that was causing the screen change issue
  // Order placement now uses orderPlacing state and shows inline loading on button

  // === PHASE 6: MAIN RENDER - NO HOOKS HERE ===
  return (
    <>
      {memoizedModal}
      
      {/* Order Success Modal */}
      <OrderSuccessModal
        isOpen={showOrderSuccess}
        onClose={() => setShowOrderSuccess(false)}
        orderData={lastOrderData}
      />
      
    <div className="space-y-6">
      <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold text-foreground">Trading Interface</h2>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
          <span className="text-sm text-muted-foreground">Connected</span>
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
              loading={orderPlacing}
              onSubmit={handlePlaceOrder}
              balance={balance}
              orderBook={orderBook}
              onMintTokens={handleMintTokens}
              mintingLoading={mintingLoading}
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

        {/* Price Chart - Full Width */}
        <PriceChart 
          tradingPair={tradingPair}
          trades={trades}
          currentPrice={orderBook.buys?.[0]?.price ? parseFloat(orderBook.buys[0].price) : 
                       orderBook.sells?.[0]?.price ? parseFloat(orderBook.sells[0].price) : 0}
          priceChange24h={0}
          high24h={trades.length > 0 ? Math.max(...trades.map(t => parseFloat(t.price) || 0)) : 0}
          low24h={trades.length > 0 ? Math.min(...trades.filter(t => parseFloat(t.price) > 0).map(t => parseFloat(t.price))) : 0}
          volume24h={trades.reduce((sum, t) => sum + (parseFloat(t.quantity) || 0), 0)}
        />

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

        {/* Depth Chart and History */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DepthChart 
            orderBook={{
              bids: orderBook.buys || [],
              asks: orderBook.sells || []
            }}
            currentPrice={orderBook.buys?.[0]?.price ? parseFloat(orderBook.buys[0].price) : 
                         orderBook.sells?.[0]?.price ? parseFloat(orderBook.sells[0].price) : 0}
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
