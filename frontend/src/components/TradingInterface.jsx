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
import TransferOffers from './trading/TransferOffers';
import BalanceCard from './trading/BalanceCard';

// Import skeleton components
import OrderBookSkeleton from './trading/OrderBookSkeleton';
import TradingPageSkeleton from './trading/TradingPageSkeleton';

// Import services
import websocketService from '../services/websocketService';
import { getAvailableTradingPairs, getGlobalOrderBook } from '../services/cantonApi';
import { apiClient, API_ROUTES } from '../config/config';
// Token Standard V2 services
import * as balanceService from '../services/balanceService';
import * as orderService from '../services/orderService';

export default function TradingInterface({ partyId }) {
  // === PHASE 1: ALL HOOKS MUST BE DECLARED FIRST - NO EXCEPTIONS ===
  const toast = useToast();
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isAlive, setIsAlive] = useState(true);
  const heartbeatRef = useRef(Date.now());
  
  const [tradingPair, setTradingPair] = useState('BTC/USDT');
  // Trading pairs loaded from API - no hardcoding
  const [availablePairs, setAvailablePairs] = useState([]);
  const [orderType, setOrderType] = useState('BUY');
  const [orderMode, setOrderMode] = useState('LIMIT');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  // Dynamic balance object - will be populated from API (includes CBTC)
  const [balance, setBalance] = useState({});
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
  const [initialLoading, setInitialLoading] = useState(true);
  const [lastOrderData, setLastOrderData] = useState(null);
  const { showModal, ModalComponent, isOpenRef: modalIsOpenRef } = useConfirmationModal();
  const isLoadingRef = useRef(false);

  // Minting state
  const [mintingLoading, setMintingLoading] = useState(false);

  // === PHASE 3: ALL USECALLBACK HOOKS - NO CONDITIONALS ===
  // TOKEN STANDARD V2: Mint creates Holding contracts (real tokens)
  const handleMintTokens = useCallback(async () => {
    console.log('[Mint V2] Manual mint button clicked for party:', partyId);
    
    if (mintingLoading || isMintingRef.current) {
      console.log('[Mint V2] Already minting, skipping...');
      return;
    }
    
    isMintingRef.current = true;
    setMintingLoading(true);
    
    try {
      // TOKEN STANDARD V2: Create Holding contracts (real tokens, not text balances)
      const mintResult = await balanceService.mintTokens(partyId, [
        { symbol: 'BTC', amount: 10 },
        { symbol: 'USDT', amount: 100000 },
        { symbol: 'ETH', amount: 100 },
        { symbol: 'SOL', amount: 1000 }
      ]);
      
      if (mintResult.success) {
        console.log('[Mint V2] Holdings created:', mintResult);
        toast.success('Test tokens minted as Holdings!', {
          title: '🪙 Holdings Created',
          details: 'BTC: 10 | USDT: 100,000 | ETH: 100 | SOL: 1,000'
        });
        
        // Refresh balance from V2 Holdings (includes CBTC)
        setTimeout(async () => {
          try {
            const balanceData = await balanceService.getBalances(partyId);
            if (balanceData.available) {
              // Dynamic balance - show ALL tokens from API (including CBTC)
              const dynamicBalance = {};
              Object.keys(balanceData.available).forEach(token => {
                dynamicBalance[token] = balanceData.available[token]?.toString() || '0.0';
              });
              setBalance(dynamicBalance);
              console.log('[Mint V2] Balance refreshed from Holdings:', balanceData.available);
            }
          } catch (err) {
            console.error('[Mint V2] Failed to refresh balance:', err);
          }
        }, 1000);
        
        return;
      }
      
      throw new Error(mintResult.error || 'Failed to mint tokens');
      
    } catch (err) {
      console.error('[Mint V2] Failed:', err);
      toast.error(err.message || 'Failed to mint tokens. Please complete onboarding first.', {
        title: '❌ Mint Failed'
      });
    } finally {
      isMintingRef.current = false;
      setMintingLoading(false);
    }
  }, [partyId, toast, mintingLoading]);

  // Place order - uses legacy API but balances are V2 Holdings
  const handlePlaceOrder = useCallback(async (orderData) => {
    try {
      setOrderPlacing(true);
      console.log('[Place Order] Placing order:', orderData);
      
      // Use legacy order API (OrderV3 DAML encoding needs more work)
      const result = await apiClient.post(API_ROUTES.ORDERS.PLACE, {
          tradingPair: orderData.tradingPair,
          orderType: orderData.orderType,
          orderMode: orderData.orderMode,
          price: orderData.price,
          quantity: orderData.quantity,
          partyId: partyId
      }, {
        headers: {
          'x-user-id': partyId || 'anonymous'
        }
      });
      
      if (!result.success) {
        throw new Error(result.error || result.message || 'Failed to place order');
      }

      console.log('[Place Order] Order placed:', result);
      
      // Clear form fields
      setPrice('');
      setQuantity('');
      
      // Show success toast
      toast.success(
        `${orderData.orderType} ${orderData.quantity} ${orderData.tradingPair?.split('/')[0] || ''} @ ${orderData.orderMode === 'MARKET' ? 'Market Price' : orderData.price}`, 
        {
          title: `✅ ${orderData.orderType} Order Placed`,
          duration: 5000
        }
      );
      
      // Show success modal
      setLastOrderData({
        orderId: result.data?.orderId,
        orderType: orderData.orderType,
        orderMode: orderData.orderMode,
        tradingPair: orderData.tradingPair,
        price: orderData.price,
        quantity: orderData.quantity
      });
      setShowOrderSuccess(true);
      
      // Refresh order book
      try {
        const bookData = await apiClient.get(API_ROUTES.ORDERBOOK.GET(tradingPair));
          setOrderBook({
            buys: bookData.data?.raw?.buyOrders || [],
            sells: bookData.data?.raw?.sellOrders || []
          });
      } catch (e) { console.error('[Refresh] Order book error:', e); }
      
      // Refresh user orders
      try {
        const ordersData = await apiClient.get(API_ROUTES.ORDERS.GET_USER(partyId, 'OPEN'));
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
      } catch (e) { console.error('[Refresh] User orders error:', e); }
      
      // Refresh balance from V2 Holdings (includes CBTC)
      try {
        const balanceData = await balanceService.getBalances(partyId);
        if (balanceData.available) {
          // Dynamic balance - show ALL tokens from API
          const dynamicBalance = {};
          Object.keys(balanceData.available).forEach(token => {
            dynamicBalance[token] = balanceData.available[token]?.toString() || '0.0';
          });
          setBalance(dynamicBalance);
        }
      } catch (e) { console.error('[Refresh] Balance error:', e); }
      
      // Refresh trades
      try {
        const tradesData = await apiClient.get(API_ROUTES.TRADES.GET(tradingPair, 50));
        setTrades(tradesData?.data?.trades || []);
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
  }, [partyId, tradingPair, toast]);

  // Cancel order - uses legacy API but balances are V2 Holdings
  const handleCancelOrder = useCallback(async (contractId) => {
    if (!contractId) {
      console.error('[Cancel Order] No contractId provided');
      toast.error('Cannot cancel order: missing contract ID');
      throw new Error('Missing contract ID');
    }
    
    if (!partyId) {
      console.error('[Cancel Order] No partyId available');
      toast.error('Cannot cancel order: not logged in');
      throw new Error('Not logged in');
    }
    
    console.log('[Cancel Order] Cancelling order:', contractId);
    
    // Use legacy cancel API (POST, not DELETE)
    const result = await apiClient.post(API_ROUTES.ORDERS.CANCEL_BY_ID(contractId), {}, {
      headers: {
        'x-user-id': partyId
      }
    });
    
    if (!result.success) {
      const errorMsg = result.error || 'Failed to cancel order';
      console.error('[Cancel Order] Failed:', errorMsg);
      toast.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    console.log('[Cancel Order] Order cancelled:', result);
    toast.success('Order cancelled successfully! Funds unlocked.');
    
    // Refresh orders list
    try {
      const ordersData = await apiClient.get(API_ROUTES.ORDERS.GET_USER(partyId, 'OPEN'));
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
    } catch (e) {
      console.warn('[Cancel Order] Failed to refresh orders:', e);
    }
    
    // Refresh balance from V2 Holdings (includes CBTC)
    try {
      const balanceData = await balanceService.getBalances(partyId);
      if (balanceData.available) {
        // Dynamic balance - show ALL tokens from API
        const dynamicBalance = {};
        Object.keys(balanceData.available).forEach(token => {
          dynamicBalance[token] = balanceData.available[token]?.toString() || '0.0';
        });
        setBalance(dynamicBalance);
      }
    } catch (e) {
      console.warn('[Cancel Order] Failed to refresh balance:', e);
    }
    
    return result;
  }, [partyId, toast, setOrders, setBalance]);

  // Handle when a transfer offer is accepted - refresh balances
  const handleTransferAccepted = useCallback(async (offer) => {
    console.log('[TradingInterface] Transfer accepted:', offer);
    toast.success(`Received ${offer.amount} ${offer.token}!`);
    
    // Refresh balance after accepting transfer
    try {
      const balanceData = await balanceService.getBalances(partyId);
      if (balanceData.available) {
        const dynamicBalance = {};
        Object.keys(balanceData.available).forEach(token => {
          dynamicBalance[token] = balanceData.available[token]?.toString() || '0.0';
        });
        setBalance(dynamicBalance);
        console.log('[TradingInterface] Balance refreshed after transfer:', dynamicBalance);
      }
    } catch (e) {
      console.warn('[TradingInterface] Failed to refresh balance after transfer:', e);
    }
  }, [partyId, toast, setBalance]);


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
        // Set initial loading to false after a short delay to ensure all components render
        setTimeout(() => setInitialLoading(false), 500);
      } catch (error) {
        console.error('[TradingInterface] Failed to initialize data:', error);
        setError('Failed to initialize trading interface');
        setInitialLoading(false);
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
        
        // Handle TRADE_EXECUTED event - update order book and user orders in real-time
        if (data?.type === 'TRADE_EXECUTED') {
          console.log('[WebSocket] Trade executed:', data.buyOrderId, 'vs', data.sellOrderId);
          // Order book will be refreshed by the next poll or full update
          // But we need to remove/update the matched orders immediately for responsiveness
          setOrderBook(prev => ({
            buys: (prev.buys || []).filter(o => o.orderId !== data.buyOrderId),
            sells: (prev.sells || []).filter(o => o.orderId !== data.sellOrderId)
          }));
          return;
        }
        
        // Handle ORDER_CANCELLED event
        if (data?.type === 'ORDER_CANCELLED') {
          console.log('[WebSocket] Order cancelled:', data.orderId);
          setOrderBook(prev => ({
            buys: (prev.buys || []).filter(o => o.orderId !== data.orderId && o.contractId !== data.contractId),
            sells: (prev.sells || []).filter(o => o.orderId !== data.orderId && o.contractId !== data.contractId)
          }));
          if (data.owner === partyId) {
            setOrders(prev => prev.filter(o => o.id !== data.orderId && o.contractId !== data.contractId));
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
          
          // If current user was involved in the trade, show toast and refresh
          if (data.buyer === partyId || data.seller === partyId) {
            const isBuyer = data.buyer === partyId;
            const side = isBuyer ? 'BUY' : 'SELL';
            const qty = parseFloat(data.quantity || 0);
            const price = parseFloat(data.price || 0);
            const [base] = tradingPair.split('/');

            console.log(`[WebSocket] 🎯 User's ${side} order matched! ${qty} ${base} @ ${price}`);

            // Show trade executed toast
            toast.success(
              `${qty} ${base} @ ${price.toLocaleString()} — ${(qty * price).toLocaleString()} USDT`, 
              {
                title: `🎯 ${side} Order Filled!`,
                duration: 6000
              }
            );
            
            // Refresh user's orders from backend (handles partial fills correctly)
            (async () => {
              try {
                const ordersData = await apiClient.get(API_ROUTES.ORDERS.GET_USER(partyId, 'OPEN'));
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
              } catch (e) {
                console.warn('[WebSocket] Failed to refresh orders after trade:', e);
              }
            })();
            
            // Refresh balance after trade
            (async () => {
              try {
                const balanceData = await balanceService.getBalances(partyId);
                if (balanceData.available) {
                  const dynamicBalance = {};
                  Object.keys(balanceData.available).forEach(token => {
                    dynamicBalance[token] = balanceData.available[token]?.toString() || '0.0';
                  });
                  setBalance(dynamicBalance);
                  console.log('[WebSocket] Balance refreshed after trade');
                }
              } catch (e) {
                console.warn('[WebSocket] Failed to refresh balance after trade:', e);
              }
            })();
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
    
    // Load initial trades (legacy API)
    const loadInitialTrades = async () => {
      try {
        const tradesData = await apiClient.get(API_ROUTES.TRADES.GET(tradingPair, 50));
        const tradesList = tradesData?.data?.trades || [];
        
          setTrades(prev => {
            if (tradesList.length === 0) {
            return prev;
            }
            const apiTradeIds = new Set(tradesList.map(t => t.tradeId));
            const newFromWs = prev.filter(t => !apiTradeIds.has(t.tradeId));
            return [...newFromWs, ...tradesList].slice(0, 50);
          });
          console.log('[TradingInterface] Initial trades loaded:', tradesList.length);
      } catch (error) {
        console.error('[TradingInterface] Failed to load initial trades:', error);
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

    // Poll order book (legacy API)
    interval = setInterval(async () => {
      if (!isLoadingRef.current) {
        try {
          const bookData = await getGlobalOrderBook(tradingPair);
          // Only update if we got actual data
          if (bookData && (bookData.buyOrders?.length > 0 || bookData.sellOrders?.length > 0)) {
            setOrderBook(prev => ({
              buys: bookData.buyOrders?.length > 0 ? bookData.buyOrders : prev.buys,
              sells: bookData.sellOrders?.length > 0 ? bookData.sellOrders : prev.sells
            }));
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

  // Load user's active orders (legacy Order contracts)
  useEffect(() => {
    if (!partyId) return;

    const loadUserOrders = async (isInitial = false) => {
      try {
        const ordersData = await apiClient.get(API_ROUTES.ORDERS.GET_USER(partyId, 'OPEN'));
        const ordersList = ordersData?.data?.orders || [];
        
          const formattedOrders = ordersList.map(order => ({
            id: order.orderId || order.contractId,
            contractId: order.contractId,
            type: order.orderType,
            mode: order.orderMode,
            price: order.price,
            quantity: order.quantity,
            filled: order.filled || '0',
          remaining: order.remaining,
            status: order.status,
            tradingPair: order.tradingPair,
            timestamp: order.timestamp
          }));
          
          if (formattedOrders.length > 0 || isInitial) {
            setOrders(prev => {
              if (formattedOrders.length > 0) {
                return formattedOrders;
              }
              return prev;
            });
          }
          console.log('[TradingInterface] User orders loaded:', formattedOrders.length);
      } catch (error) {
        console.error('[TradingInterface] Failed to load user orders:', error);
      }
    };

    loadUserOrders(true);
    const ordersInterval = setInterval(() => loadUserOrders(false), 10000);
    
    return () => clearInterval(ordersInterval);
  }, [partyId]);

  // Load balance from Holdings (Token Standard V2) - useCallback so it can be called from child components
  const loadBalance = useCallback(async (showLoader = false) => {
    if (!partyId) return;
    
    try {
      // Always show loading when explicitly requested (e.g., refresh button)
      if (showLoader) {
        setBalanceLoading(true);
      }
      console.log('[Balance V2] Loading Holdings-based balance for party:', partyId);
      
      // TOKEN STANDARD V2: Load balance from Holding contracts (includes CBTC)
      try {
        const balanceData = await balanceService.getBalances(partyId);
        
        if (balanceData.available && Object.keys(balanceData.available).length > 0) {
          // Dynamic balance - show ALL tokens from API (including CBTC, CC, etc.)
          const dynamicBalance = {};
          Object.keys(balanceData.available).forEach(token => {
            dynamicBalance[token] = balanceData.available[token]?.toString() || '0.0';
          });
          setBalance(dynamicBalance);
          console.log('[Balance V2] Holdings balance loaded:', dynamicBalance);
          hasLoadedBalanceRef.current = true;
          return;
        }
        
        // No Holdings found - show empty balance (no hardcoded defaults)
        console.log('[Balance V2] No Holdings found - user needs to mint tokens or accept transfers');
        setBalance({});
        hasLoadedBalanceRef.current = true;
      } catch (balanceError) {
        console.error('[Balance V2] Holdings fetch failed:', balanceError);
        setBalance({});
        hasLoadedBalanceRef.current = true;
      }
    } catch (error) {
      console.error('[Balance V2] Failed to load balance:', error);
      setBalance({});
      hasLoadedBalanceRef.current = true;
    } finally {
      setBalanceLoading(false);
    }
  }, [partyId]);

  // Effect to load balance on mount and periodically
  useEffect(() => {
    if (!partyId) return;

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
  }, [partyId, loadBalance]);

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
  
  // Show full-page skeleton during initial load
  if (initialLoading) {
    return <TradingPageSkeleton />;
  }

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

          {/* Balance Card - Shows all token holdings including CBTC */}
          <BalanceCard
            balance={balance}
            loading={balanceLoading}
            onRefresh={() => loadBalance(true)}
          />
          
          {/* Transfer Offers - Accept incoming tokens (CBTC from faucet, etc.) */}
          <TransferOffers
            partyId={partyId}
            onTransferAccepted={handleTransferAccepted}
          />
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
