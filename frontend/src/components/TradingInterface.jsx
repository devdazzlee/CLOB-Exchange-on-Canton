import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { useConfirmationModal } from './ConfirmationModal';

// Import trading components
import BalanceCard from './trading/BalanceCard';
import OrderForm from './trading/OrderForm';
import OrderBookCard from './trading/OrderBookCard';
import ActiveOrdersTable from './trading/ActiveOrdersTable';
import DepthChart from './trading/DepthChart';
import RecentTrades from './trading/RecentTrades';
import TransactionHistory from './trading/TransactionHistory';
import PortfolioView from './trading/PortfolioView';
import MarketData from './trading/MarketData';

// Import services
import { 
  createContract, 
  exerciseChoice, 
  queryContracts, 
  fetchContracts, 
  fetchContract,
  getAvailableTradingPairs
} from '../services/cantonApi';
import websocketService from '../services/websocketService';

export default function TradingInterface({ partyId }) {
  // Guard clause
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

  // State management
  const [tradingPair, setTradingPair] = useState('BTC/USDT');
  const [availablePairs, setAvailablePairs] = useState(['BTC/USDT']); // Available trading pairs from OrderBooks
  const [orderType, setOrderType] = useState('BUY');
  const [orderMode, setOrderMode] = useState('LIMIT');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [balance, setBalance] = useState({ BTC: '0.0', USDT: '0.0' });
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [orders, setOrders] = useState([]);
  const [orderBook, setOrderBook] = useState({ buys: [], sells: [] });
  const [loading, setLoading] = useState(false);
  const [orderBookLoading, setOrderBookLoading] = useState(true);
  const [orderBookExists, setOrderBookExists] = useState(true);
  const [error, setError] = useState('');
  const [creatingOrderBook, setCreatingOrderBook] = useState(false);
  const [trades, setTrades] = useState([]);
  const [activeTab, setActiveTab] = useState('trading'); // 'trading', 'portfolio', 'history'
  const { showModal, ModalComponent, isOpenRef: modalIsOpenRef } = useConfirmationModal();
  const isLoadingRef = useRef(false);

  // Effects
  useEffect(() => {
    if (!partyId) return;

    // Load available trading pairs on mount
    const loadAvailablePairs = async () => {
      try {
        // Try current ledger end first
        let pairs = await getAvailableTradingPairs(partyId);
        
        // If empty, check for stored completion offsets
        if (pairs.length === 0) {
          console.log('[TradingInterface] No pairs found at current ledger end, checking stored offsets...');
          // Check localStorage for any stored OrderBook offsets
          const allKeys = Object.keys(localStorage);
          const orderBookKeys = allKeys.filter(k => k.startsWith(`orderBook_`) && k.endsWith(`_${partyId}_offset`));
          
          if (orderBookKeys.length > 0) {
            // Try to query at stored offsets
            const { queryContractsAtOffset } = await import('../services/cantonApi');
            for (const key of orderBookKeys) {
              const offset = localStorage.getItem(key);
              if (offset) {
                try {
                  const orderBooksAtOffset = await queryContractsAtOffset('OrderBook:OrderBook', partyId, offset);
                  const pairsAtOffset = orderBooksAtOffset
                    .map(ob => ob.payload?.tradingPair)
                    .filter(pair => pair && typeof pair === 'string');
                  pairs.push(...pairsAtOffset);
                } catch (err) {
                  console.warn('[TradingInterface] Error querying at stored offset:', err);
                }
              }
            }
            // Remove duplicates
            pairs = [...new Set(pairs)];
          }
        }
        
        setAvailablePairs(pairs.length > 0 ? pairs : ['BTC/USDT']);
        // If current trading pair is not available, switch to first available
        if (pairs.length > 0 && !pairs.includes(tradingPair)) {
          setTradingPair(pairs[0]);
        }
      } catch (err) {
        console.error('[TradingInterface] Error loading available pairs:', err);
      }
    };
    loadAvailablePairs();

    isLoadingRef.current = false;
      setOrderBook({ buys: [], sells: [] });
    setOrderBookLoading(true);
      
    loadBalance(true);
      loadOrders();
    loadOrderBook(true);
    loadTrades();
      
    // WebSocket integration for real-time updates
    if (websocketService && !websocketService.isConnected()) {
      websocketService.connect();
    }
    
    // Subscribe to order book updates
    const orderBookCallback = (data) => {
      if (data.tradingPair === tradingPair) {
        setOrderBook({
          buys: data.buyOrders || [],
          sells: data.sellOrders || []
        });
      }
    };
    
    // Subscribe to trade updates
    const tradeCallback = (data) => {
      if (data.tradingPair === tradingPair) {
        setTrades(prev => [data, ...prev].slice(0, 100)); // Keep last 100 trades
        loadBalance(false); // Refresh balance after trade
      }
    };
    
    websocketService.subscribe(`orderbook:${tradingPair}`, orderBookCallback);
    websocketService.subscribe(`trades:${tradingPair}`, tradeCallback);
      
      const interval = setInterval(() => {
        // Don't poll if modal is open or if we're loading
        if (modalIsOpenRef.current || isLoadingRef.current) {
          return;
        }
        loadOrderBook(false);
        loadOrders();
        loadBalance(false);
        loadTrades();
      }, 5000);
      
      return () => {
        clearInterval(interval);
        websocketService.unsubscribe(`orderbook:${tradingPair}`, orderBookCallback);
        websocketService.unsubscribe(`trades:${tradingPair}`, tradeCallback);
    isLoadingRef.current = false;
      };
  }, [partyId, tradingPair]);

  // Data loading functions
  const loadBalance = async (showLoader = true) => {
    if (showLoader) setBalanceLoading(true);
    try {
      const accounts = await queryContracts('UserAccount:UserAccount', partyId);
      
      if (accounts.length > 0) {
        const account = accounts[0];
        const balances = account.payload?.balances || {};
        
        let btcBalance = '0.0';
        let usdtBalance = '0.0';
        
        if (Array.isArray(balances)) {
          balances.forEach(([key, value]) => {
            if (key === 'BTC') btcBalance = value?.toString() || '0.0';
            if (key === 'USDT') usdtBalance = value?.toString() || '0.0';
          });
        } else if (balances && typeof balances === 'object') {
          btcBalance = balances?.BTC?.toString() || '0.0';
          usdtBalance = balances?.USDT?.toString() || '0.0';
        }
        
        setBalance({ BTC: btcBalance, USDT: usdtBalance });
      } else {
        setBalance({ BTC: '0.0', USDT: '0.0' });
      }
    } catch (err) {
      console.error('[Balance] Error:', err);
      setBalance({ BTC: '0.0', USDT: '0.0' });
    } finally {
      if (showLoader) setBalanceLoading(false);
    }
  };

  // Memoize loadOrders to prevent unnecessary re-renders
  const loadOrders = useCallback(async () => {
    try {
      console.log('[Active Orders] Querying Order contracts for party:', partyId, 'trading pair:', tradingPair);
      
      // First try querying at current ledger end
      let userOrders = await queryContracts('Order:Order', partyId);
      console.log('[Active Orders] Found', userOrders.length, 'total Order contracts at current ledger end');
      
      // If empty, try querying at stored OrderBook completion offset (where orders were created)
      // Also check the latest order completion offset if available
      if (userOrders.length === 0) {
        const storedOffset = localStorage.getItem(`orderBook_${tradingPair}_${partyId}_offset`);
        const latestOrderOffset = localStorage.getItem(`latestOrder_${tradingPair}_${partyId}_offset`);
        const offsetToUse = latestOrderOffset || storedOffset;
        
        if (offsetToUse) {
          console.log('[Active Orders] No orders at current ledger end, trying stored offset:', offsetToUse);
          try {
            const { queryContractsAtOffset } = await import('../services/cantonApi');
            const ordersAtOffset = await queryContractsAtOffset('Order:Order', partyId, offsetToUse);
            console.log('[Active Orders] Found', ordersAtOffset.length, 'Order contracts at stored offset', offsetToUse);
            
            if (ordersAtOffset.length > 0) {
              userOrders = ordersAtOffset;
              console.log('[Active Orders] ✅ Using orders from stored offset');
            }
          } catch (err) {
            console.warn('[Active Orders] Error querying at stored offset:', err);
          }
        }
      } else {
        // If we found orders at current ledger end, also check stored offset to get all orders
        // (Some orders might only be visible at their creation offset)
        const latestOrderOffset = localStorage.getItem(`latestOrder_${tradingPair}_${partyId}_offset`);
        if (latestOrderOffset) {
          try {
            const { queryContractsAtOffset } = await import('../services/cantonApi');
            const ordersAtOffset = await queryContractsAtOffset('Order:Order', partyId, latestOrderOffset);
            // Merge with existing orders, avoiding duplicates
            const existingContractIds = new Set(userOrders.map(o => o.contractId));
            const newOrders = ordersAtOffset.filter(o => !existingContractIds.has(o.contractId));
            if (newOrders.length > 0) {
              console.log('[Active Orders] Found', newOrders.length, 'additional orders at latest order offset');
              userOrders = [...userOrders, ...newOrders];
            }
          } catch (err) {
            console.warn('[Active Orders] Error querying at latest order offset:', err);
          }
        }
      }
      
      // Filter out invalid contracts (must have orderId and status)
      // Also ensure templateId is Order:Order (not OrderBook or other types)
      const validOrders = userOrders.filter(o => {
        const isOrderContract = o.templateId?.includes('Order:Order') || !o.templateId; // Allow if templateId is missing (legacy)
        const hasRequiredFields = o.payload?.orderId && o.payload?.status;
        return isOrderContract && hasRequiredFields;
      });
      
      if (validOrders.length !== userOrders.length) {
        console.warn(`[Active Orders] Filtered out ${userOrders.length - validOrders.length} invalid contracts (missing orderId/status or wrong template)`);
        console.warn('[Active Orders] Invalid contracts:', userOrders
          .filter(o => !(o.templateId?.includes('Order:Order') || !o.templateId) || !o.payload?.orderId || !o.payload?.status)
          .map(o => ({
            contractId: o.contractId?.substring(0, 30) + '...',
            templateId: o.templateId,
            hasOrderId: !!o.payload?.orderId,
            hasStatus: !!o.payload?.status,
            payloadKeys: o.payload ? Object.keys(o.payload) : []
          }))
        );
      }
      
      if (validOrders.length > 0) {
        console.log('[Active Orders] All valid orders:', validOrders.map(o => ({
          contractId: o.contractId?.substring(0, 20) + '...',
          orderId: o.payload?.orderId,
          status: o.payload?.status,
          tradingPair: o.payload?.tradingPair,
          owner: o.payload?.owner,
          orderType: o.payload?.orderType
        })));
      }
      
      const activeOrders = validOrders.filter(o => 
        o.payload?.status === 'OPEN' && 
        o.payload?.tradingPair === tradingPair
      );
      
      console.log('[Active Orders] Filtered to', activeOrders.length, 'OPEN orders for', tradingPair);
      
      setOrders(activeOrders.map(o => ({
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
      console.error('[Active Orders] Error loading orders:', err);
      console.error('[Active Orders] Error details:', err.message, err.stack);
      // Don't set empty array on error - keep existing orders
    }
  }, [partyId, tradingPair]);

  const loadOrderBook = async (showLoader = false) => {
    // Don't load if modal is open
    if (modalIsOpenRef.current) return;
    if (isLoadingRef.current) return;
    
    isLoadingRef.current = true;
    
    const isEmpty = orderBook.buys.length === 0 && orderBook.sells.length === 0;
    if (showLoader && isEmpty) {
      setOrderBookLoading(true);
    } else if (showLoader && !isEmpty) {
      setOrderBookLoading(true);
    }
    
    try {
      // ROOT CAUSE FIX: Use global OrderBook endpoint that queries with operator token
      // This ensures ALL users see the SAME orders (truly global, like Hyperliquid, Lighter, etc.)
      console.log('[OrderBook] Loading global OrderBook for', tradingPair);
      
      const { getGlobalOrderBook } = await import('../services/cantonApi');
      const globalOrderBook = await getGlobalOrderBook(tradingPair);
      
      if (!globalOrderBook) {
        console.log('[OrderBook] ❌ Global OrderBook not found for', tradingPair);
        setOrderBookExists(false);
        setOrderBook({ buys: [], sells: [] });
        setOrderBookLoading(false);
        isLoadingRef.current = false;
        return;
      }
      
      console.log('[OrderBook] ✅ Found global OrderBook:', globalOrderBook.buyOrdersCount, 'buys,', globalOrderBook.sellOrdersCount, 'sells');
      
      setOrderBookExists(true);
      localStorage.setItem(`orderBook_${tradingPair}_${partyId}`, globalOrderBook.contractId);
      
      // Convert backend order format to frontend format
      const buyOrders = (globalOrderBook.buyOrders || []).map(order => ({
        price: order.price,
        quantity: order.quantity,
        filled: order.filled,
        remaining: order.remaining,
        timestamp: order.timestamp,
        contractId: order.contractId,
        owner: order.owner
      }));
      
      const sellOrders = (globalOrderBook.sellOrders || []).map(order => ({
        price: order.price,
        quantity: order.quantity,
        filled: order.filled,
        remaining: order.remaining,
        timestamp: order.timestamp,
        contractId: order.contractId,
        owner: order.owner
      }));
      
      setOrderBook({ buys: buyOrders, sells: sellOrders });
      
      console.log('[OrderBook] ✅ Loaded global OrderBook:', buyOrders.length, 'buys,', sellOrders.length, 'sells');
      
    } catch (err) {
      console.error('[OrderBook] Error loading global OrderBook:', err);
      setOrderBook({ buys: [], sells: [] });
      // Don't set orderBookExists to false on error - might be temporary
    } finally {
      setOrderBookLoading(false);
      isLoadingRef.current = false;
    }
  };

  // Load recent trades
  const loadTrades = useCallback(async () => {
    try {
      const tradeContracts = await queryContracts('Trade:Trade', partyId);
      const filteredTrades = tradeContracts
        .filter(trade => {
          const pair = trade.payload?.tradingPair || trade.tradingPair;
          return pair === tradingPair;
        })
        .map(trade => ({
          tradeId: trade.contractId,
          tradingPair: trade.payload?.tradingPair || trade.tradingPair,
          buyer: trade.payload?.buyer || trade.buyer,
          seller: trade.payload?.seller || trade.seller,
          price: trade.payload?.price || trade.price,
          quantity: trade.payload?.quantity || trade.quantity,
          timestamp: trade.payload?.timestamp || trade.timestamp || trade.createdAt,
          partyId: partyId
        }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 100); // Keep last 100 trades
      
      setTrades(filteredTrades);
    } catch (err) {
      console.error('[Trades] Error loading trades:', err);
      setTrades([]);
    }
  }, [partyId, tradingPair]);

  // Order book creation - DISABLED: Users cannot create OrderBooks
  // OrderBooks must be created by an operator/admin and are global (shared across all users)
  const handleCreateOrderBook = async () => {
    await showModal({
      title: '⚠ Cannot Create OrderBook',
      message: `OrderBooks are global and shared across all users.\n\nThey must be created by an exchange operator, not individual users.\n\nPlease contact the operator to create the OrderBook for ${tradingPair}.`,
      type: 'warning',
      confirmText: 'OK',
    });
    setCreatingOrderBook(false);
    return { success: false, error: 'Users cannot create OrderBooks' };
  };

  // Order placement
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
      
      // Get OrderBook - try backend endpoint first (for global OrderBooks)
      // ROOT CAUSE FIX: Backend returns full OrderBook with operator field
      console.log('[Place Order] Getting OrderBook for', tradingPair);
      let orderBookContract = null;
      
      // First, try to get from backend (queries using operator token, returns full OrderBook with operator)
      try {
        const { getOrderBook } = await import('../services/cantonApi');
        const backendOrderBook = await getOrderBook(tradingPair);
        if (backendOrderBook && backendOrderBook.contractId) {
          console.log('[Place Order] Found OrderBook from backend:', backendOrderBook.contractId.substring(0, 30) + '...');
          console.log('[Place Order] OrderBook operator:', backendOrderBook.operator);
          
          // Try to fetch the full contract to get buyOrders/sellOrders
          try {
            const fetchedBook = await fetchContract(backendOrderBook.contractId, partyId);
            if (fetchedBook && fetchedBook.payload?.tradingPair === tradingPair) {
              orderBookContract = fetchedBook;
              // Ensure operator is set from backend response (in case fetch doesn't include it)
              if (backendOrderBook.operator && !orderBookContract.payload?.operator) {
                orderBookContract.payload = orderBookContract.payload || {};
                orderBookContract.payload.operator = backendOrderBook.operator;
              }
              console.log('[Place Order] ✅ Successfully fetched global OrderBook with operator');
            } else {
              // Use backend response directly - it has contractId and operator
              console.log('[Place Order] Using backend OrderBook response (has operator field)');
              orderBookContract = {
                contractId: backendOrderBook.contractId,
                payload: { 
                  tradingPair: tradingPair, 
                  operator: backendOrderBook.operator 
                },
                templateId: 'OrderBook:OrderBook'
              };
            }
          } catch (fetchErr) {
            console.warn('[Place Order] Could not fetch OrderBook contract, using backend response:', fetchErr.message);
            // Use backend response - it has contractId and operator
            orderBookContract = {
              contractId: backendOrderBook.contractId,
              payload: { 
                tradingPair: tradingPair, 
                operator: backendOrderBook.operator 
              },
              templateId: 'OrderBook:OrderBook'
            };
          }
        }
      } catch (backendErr) {
        console.warn('[Place Order] Backend endpoint failed, trying direct query:', backendErr.message);
      }
      
      // Fallback: Query OrderBooks directly (may not work if user can't see them)
      if (!orderBookContract) {
        console.log('[Place Order] Querying OrderBooks directly for party:', partyId);
        let orderBooks = await queryContracts('OrderBook:OrderBook', partyId);
        console.log('[Place Order] Found', orderBooks.length, 'OrderBooks at current ledger end');
        orderBookContract = orderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
        
        // If not found, try stored completion offset
        if (!orderBookContract) {
          const storedOffset = localStorage.getItem(`orderBook_${tradingPair}_${partyId}_offset`);
          if (storedOffset) {
            console.log('[Place Order] Not found at current ledger end, trying stored offset:', storedOffset);
            const { queryContractsAtOffset } = await import('../services/cantonApi');
            const orderBooksAtOffset = await queryContractsAtOffset('OrderBook:OrderBook', partyId, storedOffset);
            console.log('[Place Order] Found', orderBooksAtOffset.length, 'OrderBooks at stored offset');
            orderBookContract = orderBooksAtOffset.find(ob => ob.payload?.tradingPair === tradingPair);
            if (orderBookContract) {
              console.log('[Place Order] ✅ Found OrderBook at stored offset:', orderBookContract.contractId);
            }
          }
        }
      }
      
      // Find ALL OrderBooks for this trading pair (if multiple found) - only if query worked
      const matchingOrderBooks = orderBookContract ? [] : []; // Simplified for now
      
      if (matchingOrderBooks.length > 1) {
        console.warn('[Place Order] ⚠️ DUPLICATE ORDERBOOKS DETECTED!', matchingOrderBooks.length, 'OrderBooks for', tradingPair);
        console.warn('[Place Order] Using the most recent one (highest offset)');
        // Sort by offset descending and use the most recent one
        matchingOrderBooks.sort((a, b) => (b.offset || 0) - (a.offset || 0));
        orderBookContract = matchingOrderBooks[0];
      }
      
      if (orderBookContract) {
        console.log('[Place Order] Using OrderBook for', tradingPair, ':', orderBookContract.contractId, 'at offset', orderBookContract.offset);
      } else {
        console.warn('[Place Order] No OrderBook found for', tradingPair);
        console.warn('[Place Order] Available pairs:', orderBooks.map(ob => ob.payload?.tradingPair));
      }

      if (!orderBookContract) {
        console.log('[Place Order] OrderBook not found. Showing message to user...');
        await showModal({
          title: '⚠ OrderBook Not Available',
          message: `The OrderBook for ${tradingPair} has not been created yet.\n\nPlease contact the exchange operator to create the OrderBook for this trading pair.\n\nNote: OrderBooks are global and shared across all users - they must be created by an operator, not individual users.`,
          type: 'warning',
          confirmText: 'OK',
        });
        setLoading(false);
        return;
      }

      const operator = orderBookContract.payload?.operator;
      if (!operator) {
        console.error('[Place Order] OrderBook has no operator!');
        throw new Error('OrderBook operator not found. Cannot place order.');
      }
      
      console.log('[Place Order] Exercising AddOrder choice on OrderBook:', orderBookContract.contractId);
      console.log('[Place Order] Order details:', {
        orderId,
        owner: partyId,
        orderType,
        orderMode,
        price: orderMode === 'LIMIT' ? parseFloat(price).toString() : null,
        quantity: parseFloat(quantity).toString()
      });
      
      // Prepare actAs parties - only include unique parties
      const actAsParties = [partyId];
      if (operator && operator !== partyId) {
        actAsParties.push(operator);
      }
      
      console.log('[Place Order] ActAs parties:', actAsParties);
      
      // Ensure we use OrderBook:OrderBook templateId (AddOrder is on OrderBook, not Order)
      const orderBookTemplateId = orderBookContract.templateId || 'OrderBook:OrderBook';
      console.log('[Place Order] Using templateId for AddOrder:', orderBookTemplateId);
      console.log('[Place Order] OrderBook contract details:', {
        contractId: orderBookContract.contractId?.substring(0, 30) + '...',
        templateId: orderBookContract.templateId,
        tradingPair: orderBookContract.payload?.tradingPair
      });
      
      const exerciseResult = await exerciseChoice(
        orderBookContract.contractId,
        'AddOrder',
        {
          orderId: orderId,
          owner: partyId,
          orderType: orderType,
          orderMode: orderMode,
          price: orderMode === 'LIMIT' 
            ? parseFloat(price).toString()
            : null,
          quantity: parseFloat(quantity).toString()
        },
        actAsParties,
        orderBookTemplateId // Explicitly pass OrderBook templateId
      );
      
      if (exerciseResult.updateId && exerciseResult.completionOffset !== undefined) {
        console.log('[Place Order] Order placement succeeded:', {
          updateId: exerciseResult.updateId,
          completionOffset: exerciseResult.completionOffset,
          createdOrderContractId: exerciseResult.createdOrderContractId
        });
        
        // Store the completion offset for future queries
        localStorage.setItem(`orderBook_${tradingPair}_${partyId}_offset`, exerciseResult.completionOffset.toString());
        
        // Wait for Order contract to be visible
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
          // Query OrderBook at completion offset to get the updated one
          const { queryContractsAtOffset } = await import('../services/cantonApi');
          let updatedOrderBooks = await queryContractsAtOffset('OrderBook:OrderBook', partyId, exerciseResult.completionOffset);
          let updatedBook = updatedOrderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
            
            if (updatedBook) {
            console.log('[Place Order] Found updated OrderBook at completion offset:', updatedBook.contractId);
            localStorage.setItem(`orderBook_${tradingPair}_${partyId}`, updatedBook.contractId);
          } else {
            // Fallback to current ledger end
            console.log('[Place Order] OrderBook not found at completion offset, trying current ledger end...');
            updatedOrderBooks = await queryContracts('OrderBook:OrderBook', partyId);
            updatedBook = updatedOrderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
            if (updatedBook) {
              localStorage.setItem(`orderBook_${tradingPair}_${partyId}`, updatedBook.contractId);
            }
              }
            } catch (err) {
          console.error('[Place Order] Error finding updated OrderBook:', err);
        }
      } else {
        console.warn('[Place Order] ⚠️ No updateId or completionOffset in exercise result');
      }
      
      // Wait a bit longer for Order contract to be visible
      console.log('[Place Order] Waiting for Order contract to be visible...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Try to query Order at completion offset if available
      let newOrder = null;
      if (exerciseResult.completionOffset !== undefined) {
        try {
          const { queryContractsAtOffset } = await import('../services/cantonApi');
          console.log('[Place Order] Querying Order at completion offset:', exerciseResult.completionOffset);
          const ordersAtOffset = await queryContractsAtOffset('Order:Order', partyId, exerciseResult.completionOffset);
          newOrder = ordersAtOffset.find(o => 
            o.payload?.orderId === orderId && 
            o.payload?.tradingPair === tradingPair
          );
          
          if (newOrder) {
            console.log('[Place Order] ✅ Found Order at completion offset:', newOrder.contractId);
              } else {
            console.log('[Place Order] Order not found at completion offset, will try current ledger end');
          }
        } catch (err) {
          console.warn('[Place Order] Error querying at completion offset:', err);
        }
      }
      
      // If not found at offset, try current ledger end
      if (!newOrder) {
        console.log('[Place Order] Querying Order at current ledger end...');
        const updatedOrders = await queryContracts('Order:Order', partyId);
        newOrder = updatedOrders.find(o => 
          o.payload?.orderId === orderId && 
          o.payload?.tradingPair === tradingPair
        );
      }
      
      // Store the latest order completion offset for future queries
      if (exerciseResult.completionOffset !== undefined) {
        localStorage.setItem(`latestOrder_${tradingPair}_${partyId}_offset`, exerciseResult.completionOffset.toString());
        console.log('[Place Order] Stored latest order offset:', exerciseResult.completionOffset);
      }
      
      // Reload orders and order book
      console.log('[Place Order] Reloading orders and order book...');
      await loadOrders();
      await loadOrderBook(true);
      await loadBalance(false);
      
      setPrice('');
      setQuantity('');
      
      if (newOrder) {
        console.log('[Place Order] ✅ Order confirmed visible:', newOrder.contractId);
      await showModal({
        title: 'Order Placed',
          message: `Order placed successfully!\n\nOrder ID: ${orderId}\nStatus: ${newOrder.payload?.status || 'OPEN'}`,
        type: 'success',
        confirmText: 'OK',
      });
      } else {
        console.warn('[Place Order] ⚠️ Order not yet visible, but transaction succeeded');
        console.warn('[Place Order] This might indicate:');
        console.warn('[Place Order] 1. Order contract is not visible to this party');
        console.warn('[Place Order] 2. Order was immediately matched/filled and archived');
        console.warn('[Place Order] 3. Ledger propagation delay');
        await showModal({
          title: 'Order Placed',
          message: 'Order placed successfully! It may take a moment to appear in your order list. Please refresh if it doesn\'t appear.',
          type: 'success',
          confirmText: 'OK',
        });
      }
    } catch (err) {
      console.error('[Place Order] Full error object:', err);
      // Extract detailed error message
      let errorMessage = 'Failed to place order';
      
      if (err.message) {
        errorMessage = err.message;
      }
      
      // Check for detailed error in response
      if (err.response?.data) {
        const errorData = err.response.data;
        if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.errors && Array.isArray(errorData.errors)) {
          errorMessage = errorData.errors.join(', ');
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        }
      }
      
      // Check for errors array
      if (err.errors && Array.isArray(err.errors)) {
        errorMessage = err.errors.join(', ');
      }
      
      // Add cause if available
      if (err.cause) {
        errorMessage += ` (${err.cause})`;
      }
      
      console.error('[Place Order] Error message to display:', errorMessage);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Order cancellation
  const handleCancelOrder = async (contractId) => {
    const confirmed = await showModal({
      title: 'Cancel Order',
      message: 'Are you sure you want to cancel this order?',
      type: 'warning',
      showCancel: true,
      confirmText: 'Cancel Order',
      cancelText: 'Keep Order',
    });
    
    if (!confirmed) return;

    setLoading(true);
    setError('');

    try {
      const orderContract = await fetchContract(contractId, partyId);
      await exerciseChoice(
        contractId, 
        'CancelOrder', 
        {}, 
        partyId,
        orderContract?.templateId || 'Order:Order'
      );
      await loadOrders();
      await loadOrderBook(true);
      await showModal({
        title: 'Order Cancelled',
        message: 'Order cancelled successfully!',
        type: 'success',
        confirmText: 'OK',
      });
    } catch (err) {
      setError(err.message || 'Failed to cancel order');
    } finally {
      setLoading(false);
    }
  };

  // Memoize modal component to prevent re-renders
  const memoizedModal = useMemo(() => <ModalComponent />, [ModalComponent]);

  return (
    <>
      {memoizedModal}
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <BalanceCard
            balance={balance}
            loading={balanceLoading}
            onRefresh={() => loadBalance(true)}
          />
          
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
              </div>

        {/* Tabs Navigation */}
        <div className="border-b border-border">
          <div className="flex space-x-1">
            <button
              onClick={() => setActiveTab('trading')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'trading'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Trading
            </button>
            <button
              onClick={() => setActiveTab('portfolio')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'portfolio'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Portfolio
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'history'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              History
            </button>
          </div>
        </div>

        {/* Trading Tab */}
        {activeTab === 'trading' && (
          <div className="space-y-6">
            {/* Market Data */}
            <MarketData
              tradingPair={tradingPair}
              orderBook={orderBook}
              trades={trades}
            />
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <OrderBookCard
                tradingPair={tradingPair}
                orderBook={orderBook}
                loading={orderBookLoading}
                onRefresh={() => loadOrderBook(true)}
                onCreateOrderBook={handleCreateOrderBook}
                creatingOrderBook={creatingOrderBook}
              />
              
              <div className="space-y-6">
                <DepthChart
                  buyOrders={orderBook.buys}
                  sellOrders={orderBook.sells}
                  tradingPair={tradingPair}
                />
                
                <RecentTrades
                  trades={trades}
                  tradingPair={tradingPair}
                  loading={false}
                />
              </div>
            </div>

            <ActiveOrdersTable
              orders={orders}
              onCancelOrder={handleCancelOrder}
            />
          </div>
        )}

        {/* Portfolio Tab */}
        {activeTab === 'portfolio' && (
          <PortfolioView
            partyId={partyId}
            cantonApi={{ queryContracts }}
          />
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <TransactionHistory
            partyId={partyId}
            cantonApi={{ queryContracts }}
          />
        )}
    </div>
    </>
  );
}
