import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, LogOut } from 'lucide-react';
import { useConfirmationModal } from './ConfirmationModal';

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
import { clearWallet } from '../wallet/keyManager';
import { getOrCreateUserId } from '../services/userId';
import { normalizeDamlMap } from '../utils/daml';

const USER_ACCOUNT_STORAGE_KEY = 'user_account_contract_id';

function getUserAccountStorageKey(partyId) {
  return partyId ? `${USER_ACCOUNT_STORAGE_KEY}:${partyId}` : USER_ACCOUNT_STORAGE_KEY;
}

function getStoredUserAccountId(partyId) {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(getUserAccountStorageKey(partyId));
}

function setStoredUserAccountId(partyId, contractId) {
  if (typeof localStorage === 'undefined' || !contractId) return;
  localStorage.setItem(getUserAccountStorageKey(partyId), contractId);
}

function clearStoredUserAccountId(partyId) {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(getUserAccountStorageKey(partyId));
}

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
  const isMintingRef = useRef(false);
  const lastMintAtRef = useRef(0);
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

    const applyBalances = (balances) => {
      const normalized = normalizeDamlMap(balances);
      let btcBalance = '0.0';
      let usdtBalance = '0.0';

      if (Array.isArray(normalized)) {
        normalized.forEach(([key, value]) => {
          if (key === 'BTC') btcBalance = value?.toString() || '0.0';
          if (key === 'USDT') usdtBalance = value?.toString() || '0.0';
        });
      } else if (normalized && typeof normalized === 'object') {
        btcBalance = normalized?.BTC?.toString() || '0.0';
        usdtBalance = normalized?.USDT?.toString() || '0.0';
      }

      setBalance({ BTC: btcBalance, USDT: usdtBalance });
    };

    try {
      const storedAccountId = getStoredUserAccountId(partyId);
      if (storedAccountId) {
        try {
          const account = await fetchContract(storedAccountId, partyId);
          if (account?.payload?.balances) {
            applyBalances(account.payload.balances);
            return;
          }
          clearStoredUserAccountId(partyId);
        } catch (storedErr) {
          console.warn('[Balance] Stored UserAccount fetch failed:', storedErr.message);
          clearStoredUserAccountId(partyId);
        }
      }

      const accounts = await queryContracts('UserAccount:UserAccount', partyId);
      const matching = accounts.filter((acc) => acc.payload?.party === partyId);
      const sorted = matching.length > 0
        ? matching.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        : accounts;

      if (sorted.length > 0) {
        const account = sorted[0];
        if (account?.contractId) {
          setStoredUserAccountId(partyId, account.contractId);
        }
        applyBalances(account.payload?.balances || {});
        return;
      }

      // TESTNET: Auto-create UserAccount with test tokens if it doesn't exist
      const now = Date.now();
      if (isMintingRef.current || now - lastMintAtRef.current < 60000) {
        console.warn('[Balance] Skipping quick mint (cooldown active)');
        return;
      }

      isMintingRef.current = true;
      lastMintAtRef.current = now;
      console.log('[Balance] UserAccount not found, auto-creating with test tokens...');
      try {
        const backendBase = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
        const response = await fetch(`${backendBase}/api/testnet/quick-mint`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': getOrCreateUserId(),
          },
          body: JSON.stringify({ partyId })
        });

        const responseJson = await response.json().catch(() => ({}));
        const result = responseJson?.data ?? responseJson;

        if (response.ok) {
          console.log('[Balance] ✅ UserAccount created with test tokens:', result.balances);
          if (result.accountContractId) {
            setStoredUserAccountId(partyId, result.accountContractId);
          }
          if (result.balances && typeof result.balances === 'object') {
            applyBalances(result.balances);
            console.log('[Balance] ✅ Set balances immediately from mint response');
          }

          setTimeout(async () => {
            try {
              const newAccounts = await queryContracts('UserAccount:UserAccount', partyId);
              const newMatching = newAccounts.filter((acc) => acc.payload?.party === partyId);
              if (newMatching.length > 0) {
                const account = newMatching.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
                if (account?.contractId) {
                  setStoredUserAccountId(partyId, account.contractId);
                }
                applyBalances(account.payload?.balances || {});
                console.log('[Balance] ✅ Updated balances from UserAccount query');
              } else {
                console.log('[Balance] UserAccount not yet queryable, using mint response balances');
              }
            } catch (retryErr) {
              console.warn('[Balance] Retry query failed (non-critical):', retryErr.message);
            }
          }, 2000);
        } else {
          console.warn('[Balance] Failed to auto-create UserAccount:', response.status);
        }
      } catch (mintErr) {
        console.error('[Balance] Error auto-creating UserAccount:', mintErr);
      } finally {
        isMintingRef.current = false;
      }
    } catch (err) {
      console.error('[Balance] Error:', err);
    } finally {
      if (showLoader) setBalanceLoading(false);
    }
  };

  // Memoize loadOrders to prevent unnecessary re-renders
  const loadOrders = useCallback(async () => {
    try {
      console.log('[Active Orders] Loading open orders for party:', partyId, 'trading pair:', tradingPair);

      const { getGlobalOrderBook, fetchContracts } = await import('../services/cantonApi');
      const globalOrderBook = await getGlobalOrderBook(tradingPair);

      if (!globalOrderBook) {
        setOrders([]);
        return;
      }

      const rawOrders = [
        ...(globalOrderBook.buyOrders || []),
        ...(globalOrderBook.sellOrders || [])
      ];

      if (rawOrders.length === 0) {
        setOrders([]);
        return;
      }

      const hasDetails = rawOrders.some((order) => typeof order === 'object' && order !== null);
      let activeOrders = [];

      if (hasDetails) {
        activeOrders = rawOrders.filter((order) =>
          order?.owner === partyId &&
          order?.status === 'OPEN' &&
          order?.tradingPair === tradingPair
        );
      } else {
        const orderIds = rawOrders
          .map((order) => (typeof order === 'string' ? order : order?.contractId))
          .filter(Boolean);

        const uniqueOrderIds = Array.from(new Set(orderIds));
        const limitedOrderIds = uniqueOrderIds.length > 200 ? uniqueOrderIds.slice(0, 200) : uniqueOrderIds;
        if (uniqueOrderIds.length > limitedOrderIds.length) {
          console.warn('[Active Orders] Truncated order fetch to 200 contracts');
        }

        const orderContracts = await fetchContracts(limitedOrderIds, partyId);
        activeOrders = orderContracts.filter((o) =>
          o.payload?.owner === partyId &&
          o.payload?.status === 'OPEN' &&
          o.payload?.tradingPair === tradingPair
        );
      }

      console.log('[Active Orders] Filtered to', activeOrders.length, 'OPEN orders for', tradingPair);

      setOrders(activeOrders.map(o => {
        const payload = o.payload || o;
        return {
          id: payload?.orderId,
          type: payload?.orderType,
          mode: payload?.orderMode || (payload?.price ? 'LIMIT' : 'MARKET'),
          pair: payload?.tradingPair,
          price: payload?.price,
          quantity: payload?.quantity,
          filled: payload?.filled,
          status: payload?.status,
          contractId: o.contractId || payload?.contractId
        };
      }));
    } catch (err) {
      console.error('[Active Orders] Error loading orders:', err);
      console.error('[Active Orders] Error details:', err.message, err.stack);
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

        const allowAutoCreate = import.meta.env.DEV || import.meta.env.VITE_AUTO_CREATE_ORDERBOOK === 'true';
        if (allowAutoCreate && !creatingOrderBook) {
          setCreatingOrderBook(true);
          try {
            const backendBase = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
            const createResponse = await fetch(
              `${backendBase}/api/admin/orderbooks/${encodeURIComponent(tradingPair)}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' } }
            );

            const createJson = await createResponse.json().catch(() => ({}));
            const createData = createJson?.data ?? createJson;

            if (createResponse.ok) {
              console.log('[OrderBook] ✅ Created OrderBook:', createData?.contractId || tradingPair);
              const createdOrderBook = await getGlobalOrderBook(tradingPair);
              if (createdOrderBook) {
                setOrderBookExists(true);
                setOrderBook({
                  buys: createdOrderBook.buyOrders || [],
                  sells: createdOrderBook.sellOrders || []
                });
                setOrderBookLoading(false);
                isLoadingRef.current = false;
                return;
              }
            } else {
              console.warn('[OrderBook] Failed to create OrderBook:', createJson?.message || createJson?.error || createResponse.statusText);
            }
          } catch (createErr) {
            console.warn('[OrderBook] Auto-create OrderBook failed:', createErr.message);
          } finally {
            setCreatingOrderBook(false);
          }
        }

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
      const backendBase = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const res = await fetch(
        `${backendBase}/api/orderbooks/${encodeURIComponent(tradingPair)}/trades?limit=100`
      );
      const json = await res.json().catch(() => ({}));
      const data = json?.data ?? json;

      if (!res.ok) {
        throw new Error(data?.message || data?.error || 'Failed to load trades');
      }

      const tradeList = data?.trades || [];
      const normalized = tradeList.map((trade) => ({
        tradeId: trade.tradeId || trade.contractId,
        tradingPair: trade.tradingPair,
        buyer: trade.buyer,
        seller: trade.seller,
        price: trade.price,
        quantity: trade.quantity,
        timestamp: trade.timestamp,
        partyId: partyId
      }));

      setTrades(normalized);
    } catch (err) {
      console.error('[Trades] Error loading trades:', err);
      setTrades([]);
    }
  }, [partyId, tradingPair]);

  // ==========================================================================
  // GLOBAL ORDER BOOK MODEL
  // ==========================================================================
  // OrderBooks are GLOBAL and owned by the Operator (Venue).
  // Users do NOT create order books - they interact with the global market.
  // This is similar to how Hyperliquid, Lighter, and other pro exchanges work.
  //
  // The order book is initialized by the operator using:
  //   node backend/scripts/deploymentScript.js
  //
  // Users simply trade against the global order book.
  // ==========================================================================

  // DEPRECATED: handleCreateOrderBook is no longer used
  // Kept for backward compatibility but does nothing
  const handleCreateOrderBook = async () => {
    console.warn('[TradingInterface] Create OrderBook is disabled - using Global OrderBook model');
    return { success: false, error: 'Global OrderBook model - users cannot create order books' };
  };

  // Order placement with UserAccount/UTXO model
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

      console.log('[Place Order] UTXO Order Flow:', {
        orderType,
        orderMode,
        quantity,
        price: orderMode === 'LIMIT' ? price : null,
        tradingPair
      });
      setError('Placing order...');
      
      // Get OrderBook - try backend endpoint first (for global OrderBooks)
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
        console.log('[Place Order] OrderBook not found for', tradingPair, '- backend will auto-create it on first order');
      }

      // OrderBook can be null - backend will auto-create it if needed
      // No need to block order placement
      
      console.log('[Place Order] Using UTXO-aware order placement endpoint');
      console.log('[Place Order] Order details:', {
        orderId,
        owner: partyId,
        orderType,
        orderMode,
        price: orderMode === 'LIMIT' ? parseFloat(price).toString() : null,
        quantity: parseFloat(quantity).toString()
      });
      
        // Get UserAccount contract ID for UTXO handling
        let userAccountContractId = getStoredUserAccountId(partyId);
        if (!userAccountContractId) {
          try {
            const { queryContracts } = await import('../services/cantonApi');
            const userAccounts = await queryContracts('UserAccount:UserAccount', partyId);
            const userAccount = userAccounts.find(ua => ua.payload?.party === partyId);
            if (userAccount) {
              userAccountContractId = userAccount.contractId;
              setStoredUserAccountId(partyId, userAccountContractId);
              console.log('[Place Order] Found UserAccount:', userAccountContractId.substring(0, 30) + '...');
            } else {
              console.warn('[Place Order] UserAccount not found - UTXO handling may be limited');
            }
          } catch (err) {
            console.warn('[Place Order] Could not fetch UserAccount:', err.message);
          }
        }
      
      // Use UTXO-aware order placement endpoint
      const backendBase = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const placeOrderResponse = await fetch(`${backendBase}/api/orders/place`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          partyId: partyId,
          tradingPair: tradingPair,
          orderType: orderType,
          orderMode: orderMode || 'LIMIT',
          quantity: parseFloat(quantity).toString(),
          price: orderMode === 'LIMIT' && price ? parseFloat(price).toString() : null,
          orderBookContractId: orderBookContract?.contractId || null, // Can be null - backend will auto-create
          userAccountContractId: userAccountContractId
        })
      });
      
      const responseJson = await placeOrderResponse.json().catch(() => ({}));
      const result = responseJson?.data ?? responseJson;
        const orderContractId = result.orderContractId || null;
        const nextUserAccountId = result.userAccountContractId || result.userAccount?.contractId || null;
        if (nextUserAccountId) {
          setStoredUserAccountId(partyId, nextUserAccountId);
        }

      if (!placeOrderResponse.ok) {
        throw new Error(responseJson.message || responseJson.error || result.message || result.error || 'Failed to place order');
      }
      
      // Backend returns: { success, updateId, completionOffset, orderId, utxoHandled, ... }
      const exerciseResult = {
        updateId: result.updateId,
        completionOffset: result.completionOffset,
        orderId: result.orderId || orderId
      };
      const resolvedOrderId = exerciseResult.orderId || orderId;
      
      console.log('[Place Order] Order placed with UTXO handling:', {
        updateId: result.updateId,
        completionOffset: result.completionOffset,
        utxoHandled: result.utxoHandled,
        orderId: result.orderId
      });
      
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
      
      // Try to fetch the new Order contract directly (avoids large queries)
      let newOrder = null;
      if (orderContractId) {
        try {
          console.log('[Place Order] Fetching Order contract:', orderContractId.substring(0, 30) + '...');
          newOrder = await fetchContract(orderContractId, partyId, exerciseResult.completionOffset);
          if (newOrder) {
            console.log('[Place Order] ✅ Found Order contract:', newOrder.contractId);
          }
        } catch (err) {
          console.warn('[Place Order] Error fetching Order contract:', err);
        }
      } else {
        console.warn('[Place Order] Order contract ID not returned; skipping fetch');
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
          message: `Order placed successfully!\n\nOrder ID: ${resolvedOrderId}\nStatus: ${newOrder.payload?.status || 'OPEN'}`,
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

  // Order cancellation with UTXO handling
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
      // Get order details
      const orderContract = await fetchContract(contractId, partyId);
      if (!orderContract) {
        throw new Error('Order not found');
      }

      const orderPayload = orderContract.payload || {};
      const tradingPair = orderPayload.tradingPair || tradingPair;
      const orderType = orderPayload.orderType || 'BUY';

      // Get OrderBook contract ID
      let orderBookContractId = null;
      try {
        const { getOrderBook } = await import('../services/cantonApi');
        const orderBook = await getOrderBook(tradingPair);
        if (orderBook && orderBook.contractId) {
          orderBookContractId = orderBook.contractId;
        }
      } catch (err) {
        console.warn('[Cancel Order] Could not fetch OrderBook:', err.message);
      }

        // Get UserAccount contract ID for UTXO handling
        let userAccountContractId = getStoredUserAccountId(partyId);
        if (!userAccountContractId) {
          try {
            const { queryContracts } = await import('../services/cantonApi');
            const userAccounts = await queryContracts('UserAccount:UserAccount', partyId);
            const userAccount = userAccounts.find(ua => ua.payload?.party === partyId);
            if (userAccount) {
              userAccountContractId = userAccount.contractId;
              setStoredUserAccountId(partyId, userAccountContractId);
            }
          } catch (err) {
            console.warn('[Cancel Order] Could not fetch UserAccount:', err.message);
          }
        }

      // Use new UTXO-aware order cancellation endpoint
      const backendBase = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const cancelResponse = await fetch(`${backendBase}/api/orders/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          partyId: partyId,
          tradingPair: tradingPair,
          orderType: orderType,
          orderContractId: contractId,
          orderBookContractId: orderBookContractId,
          userAccountContractId: userAccountContractId
        })
      });

      if (!cancelResponse.ok) {
        const errorData = await cancelResponse.json();
        throw new Error(errorData.message || errorData.error || 'Failed to cancel order');
      }

      const result = await cancelResponse.json();
      console.log('[Cancel Order] Order cancelled with UTXO handling:', result);

      await loadOrders();
      await loadOrderBook(true);
      await loadBalance(false); // Reload balance after UTXO merge
      
      await showModal({
        title: 'Order Cancelled',
        message: 'Order cancelled successfully! UTXOs have been merged.',
        type: 'success',
        confirmText: 'OK',
      });
    } catch (err) {
      setError(err.message || 'Failed to cancel order');
    } finally {
      setLoading(false);
    }
  };

  // Handle logout
  const handleLogout = () => {
    // Clear all authentication and wallet data
    clearWallet();
    localStorage.removeItem('canton_party_id');
    clearStoredUserAccountId(partyId);
    // Force redirect to home page
    window.location.href = '/';
  };

  // Memoize modal component to prevent re-renders
  const memoizedModal = useMemo(() => <ModalComponent />, [ModalComponent]);

  return (
    <>
      {memoizedModal}
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
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* OrderBook - Left Column (2/3 width) */}
              <div className="lg:col-span-2">
                <OrderBookCard
                  tradingPair={tradingPair}
                  orderBook={orderBook}
                  loading={orderBookLoading}
                  onRefresh={() => loadOrderBook(true)}
                  // Global OrderBook model - these props are deprecated
                  // onCreateOrderBook and creatingOrderBook are no longer used
                />
              </div>
              
              {/* Right Column (1/3 width) - Global Trades */}
              <div className="space-y-6">
                <GlobalTrades
                  tradingPair={tradingPair}
                  limit={50}
                />
              </div>
            </div>
            
            {/* Depth Chart and Recent Trades Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
