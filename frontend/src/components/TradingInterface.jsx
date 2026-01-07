import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { useConfirmationModal } from './ConfirmationModal';

// Import trading components
import BalanceCard from './trading/BalanceCard';
import OrderForm from './trading/OrderForm';
import OrderBookCard from './trading/OrderBookCard';
import ActiveOrdersTable from './trading/ActiveOrdersTable';

// Import services
import { 
  createContract, 
  exerciseChoice, 
  queryContracts, 
  fetchContracts, 
  fetchContract,
  getAvailableTradingPairs
} from '../services/cantonApi';

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
  const { showModal, ModalComponent } = useConfirmationModal();
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
      
      const interval = setInterval(() => {
        if (!isLoadingRef.current) {
        loadOrderBook(false);
        }
        loadOrders();
      loadBalance(false);
      }, 5000);
      
      return () => {
        clearInterval(interval);
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

  const loadOrders = async () => {
    try {
      console.log('[Active Orders] Querying Order contracts for party:', partyId, 'trading pair:', tradingPair);
      
      // First try querying at current ledger end
      let userOrders = await queryContracts('Order:Order', partyId);
      console.log('[Active Orders] Found', userOrders.length, 'total Order contracts at current ledger end');
      
      // If empty, try querying at stored OrderBook completion offset (where orders were created)
      if (userOrders.length === 0) {
        const storedOffset = localStorage.getItem(`orderBook_${tradingPair}_${partyId}_offset`);
        if (storedOffset) {
          console.log('[Active Orders] No orders at current ledger end, trying stored offset:', storedOffset);
          try {
            const { queryContractsAtOffset } = await import('../services/cantonApi');
            const ordersAtOffset = await queryContractsAtOffset('Order:Order', partyId, storedOffset);
            console.log('[Active Orders] Found', ordersAtOffset.length, 'Order contracts at stored offset', storedOffset);
            
            if (ordersAtOffset.length > 0) {
              userOrders = ordersAtOffset;
              console.log('[Active Orders] ✅ Using orders from stored offset');
            }
          } catch (err) {
            console.warn('[Active Orders] Error querying at stored offset:', err);
          }
        }
      }
      
      if (userOrders.length > 0) {
        console.log('[Active Orders] All orders:', userOrders.map(o => ({
          contractId: o.contractId?.substring(0, 20) + '...',
          orderId: o.payload?.orderId,
          status: o.payload?.status,
          tradingPair: o.payload?.tradingPair,
          owner: o.payload?.owner,
          orderType: o.payload?.orderType
        })));
      }
      
      const activeOrders = userOrders.filter(o => 
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
  };

  const loadOrderBook = async (showLoader = false) => {
    if (isLoadingRef.current) return;
    
    isLoadingRef.current = true;
    
    const isEmpty = orderBook.buys.length === 0 && orderBook.sells.length === 0;
    if (showLoader && isEmpty) {
      setOrderBookLoading(true);
    } else if (showLoader && !isEmpty) {
      setOrderBookLoading(true);
    }
    
    try {
      // First try querying at current ledger end
      let orderBooks = await queryContracts('OrderBook:OrderBook', partyId);
      console.log('[OrderBook] Found', orderBooks.length, 'OrderBooks at current ledger end');
      let book = orderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
      
      // If not found at current ledger end, try querying at stored completion offset
      if (!book) {
        const storedOffset = localStorage.getItem(`orderBook_${tradingPair}_${partyId}_offset`);
        const storedOrderBookId = localStorage.getItem(`orderBook_${tradingPair}_${partyId}`);
        
        if (storedOffset) {
          console.log('[OrderBook] Not found at current ledger end, trying stored offset:', storedOffset);
          try {
            const { queryContractsAtOffset } = await import('../services/cantonApi');
            const orderBooksAtOffset = await queryContractsAtOffset('OrderBook:OrderBook', partyId, storedOffset);
            console.log('[OrderBook] Found', orderBooksAtOffset.length, 'OrderBooks at stored offset', storedOffset);
            book = orderBooksAtOffset.find(ob => ob.payload?.tradingPair === tradingPair);
            if (book) {
              console.log('[OrderBook] ✅ Found OrderBook at stored offset:', book.contractId);
          }
        } catch (err) {
          console.warn('[OrderBook] Error querying at stored offset:', err);
        }
      }
      
        // If still not found, try fetching by stored contract ID
      if (!book && storedOrderBookId) {
          console.log('[OrderBook] Trying to fetch stored OrderBook by ID:', storedOrderBookId);
        try {
          const storedBook = await fetchContract(storedOrderBookId, partyId);
          if (storedBook && storedBook.payload?.tradingPair === tradingPair) {
              console.log('[OrderBook] ✅ Found stored OrderBook by ID');
            book = storedBook;
          }
        } catch (err) {
          console.warn('[OrderBook] Could not fetch stored OrderBook:', err);
        }
        }
      } else {
        // Found at current ledger end - clear stored offset
        console.log('[OrderBook] ✅ Found at current ledger end, clearing stored offset');
        localStorage.removeItem(`orderBook_${tradingPair}_${partyId}_offset`);
      }
      
      if (!book) {
        setOrderBook({ buys: [], sells: [] });
        setOrderBookExists(false);
        setOrderBookLoading(false);
        isLoadingRef.current = false;
        return;
      }
      
      setOrderBookExists(true);
      localStorage.setItem(`orderBook_${tradingPair}_${partyId}`, book.contractId);

      const buyCids = book.payload?.buyOrders || [];
      const sellCids = book.payload?.sellOrders || [];
      
      console.log('[OrderBook] OrderBook contains:', {
        buyOrders: buyCids.length,
        sellOrders: sellCids.length,
        buyOrderIds: buyCids.map(cid => cid.substring(0, 20) + '...'),
        sellOrderIds: sellCids.map(cid => cid.substring(0, 20) + '...')
      });
      
      if (buyCids.length === 0 && sellCids.length === 0) {
        setOrderBook({ buys: [], sells: [] });
        setOrderBookExists(true);
        setOrderBookLoading(false);
        isLoadingRef.current = false;
        return;
      }
      
      const allCids = [...buyCids, ...sellCids];
      
      // Try fetching contracts - first try current ledger end
      let orderContracts = await fetchContracts(allCids, partyId);
      console.log('[OrderBook] Fetched', orderContracts.length, 'order contracts at current ledger end');
      
      // If some contracts are missing, try fetching at stored offset
      if (orderContracts.length < allCids.length) {
        const storedOffset = localStorage.getItem(`orderBook_${tradingPair}_${partyId}_offset`);
        if (storedOffset) {
          console.log('[OrderBook] Some orders missing, trying to fetch at stored offset:', storedOffset);
          try {
            const { queryContractsAtOffset } = await import('../services/cantonApi');
            const ordersAtOffset = await queryContractsAtOffset('Order:Order', partyId, storedOffset);
            console.log('[OrderBook] Found', ordersAtOffset.length, 'Order contracts at stored offset');
            
            // Merge results - use contracts from offset if they're not already fetched
            const fetchedIds = new Set(orderContracts.map(c => c.contractId));
            const missingOrders = ordersAtOffset.filter(o => allCids.includes(o.contractId) && !fetchedIds.has(o.contractId));
            
            if (missingOrders.length > 0) {
              console.log('[OrderBook] Adding', missingOrders.length, 'missing orders from stored offset');
              orderContracts = [...orderContracts, ...missingOrders];
          }
        } catch (err) {
            console.warn('[OrderBook] Error fetching orders at stored offset:', err);
          }
        }
      }
      
      const buyOrders = orderContracts
        .filter(contract => buyCids.includes(contract.contractId) && contract?.payload?.status === 'OPEN')
        .map(contract => ({
          price: contract.payload?.price || null,
          quantity: parseFloat(contract.payload?.quantity || 0),
          filled: parseFloat(contract.payload?.filled || 0),
          remaining: parseFloat(contract.payload?.quantity || 0) - parseFloat(contract.payload?.filled || 0),
          timestamp: contract.payload?.timestamp || 0
        }))
        .filter(order => order.remaining > 0)
        .sort((a, b) => {
          if (a.price === null && b.price === null) return a.timestamp - b.timestamp;
          if (a.price === null) return 1;
          if (b.price === null) return -1;
          if (b.price !== a.price) return b.price - a.price;
          return a.timestamp - b.timestamp;
        });

      const sellOrders = orderContracts
        .filter(contract => sellCids.includes(contract.contractId) && contract?.payload?.status === 'OPEN')
        .map(contract => {
          const price = contract.payload?.price || null;
          const quantity = parseFloat(contract.payload?.quantity || 0);
          const filled = parseFloat(contract.payload?.filled || 0);
          return {
            price: price,
            quantity: quantity,
            filled: filled,
            remaining: quantity - filled,
            timestamp: contract.payload?.timestamp || 0
          };
        })
        .filter(order => order.remaining > 0)
        .sort((a, b) => {
          if (a.price === null && b.price === null) return a.timestamp - b.timestamp;
          if (a.price === null) return 1;
          if (b.price === null) return -1;
          if (a.price !== b.price) return a.price - b.price;
          return a.timestamp - b.timestamp;
        });

      setOrderBook({ buys: buyOrders, sells: sellOrders });
    } catch (err) {
      console.error('Error loading order book:', err);
      setOrderBook({ buys: [], sells: [] });
      setOrderBookExists(false);
    } finally {
      setOrderBookLoading(false);
      isLoadingRef.current = false;
    }
  };

  // Order book creation
  const handleCreateOrderBook = async () => {
    // Check if OrderBook already exists before creating - try stored offset first
    console.log('[Create OrderBook] Checking if OrderBook already exists for', tradingPair);
    let existingOrderBooks = await queryContracts('OrderBook:OrderBook', partyId);
    let existing = existingOrderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
    
    // If not found at current ledger end, check stored offset
    if (!existing) {
      const storedOffset = localStorage.getItem(`orderBook_${tradingPair}_${partyId}_offset`);
      if (storedOffset) {
        console.log('[Create OrderBook] Checking stored offset:', storedOffset);
        const { queryContractsAtOffset } = await import('../services/cantonApi');
        const orderBooksAtOffset = await queryContractsAtOffset('OrderBook:OrderBook', partyId, storedOffset);
        existing = orderBooksAtOffset.find(ob => ob.payload?.tradingPair === tradingPair);
      }
    }
    
    if (existing) {
      console.log('[Create OrderBook] OrderBook already exists:', existing.contractId);
      await showModal({
        title: 'OrderBook Already Exists',
        message: `An OrderBook for ${tradingPair} already exists.\n\nContract ID: ${existing.contractId}`,
        type: 'info',
        confirmText: 'OK',
      });
      setCreatingOrderBook(false);
      return { success: true, contractId: existing.contractId };
    }
    
    const confirmed = await showModal({
      title: 'Create OrderBook',
      message: `Create OrderBook for ${tradingPair}?`,
      type: 'info',
      showCancel: true,
      confirmText: 'Create',
      cancelText: 'Cancel',
    });
    
    if (!confirmed) return;

    setError('');
    setCreatingOrderBook(true);

    try {
      console.log('[Create OrderBook] Creating new OrderBook for', tradingPair);
      const payload = {
        tradingPair: tradingPair,
        buyOrders: [],
        sellOrders: [],
        lastPrice: null,
        operator: partyId
      };
      
      const result = await createContract('OrderBook:OrderBook', payload, partyId);
      let contractId = result.contractId;
      
      if (!contractId && result.events && result.events.length > 0) {
        const createdEvent = result.events.find(e => e.created);
        if (createdEvent && createdEvent.created) {
          contractId = createdEvent.created.contractId;
        }
      }

      if (result.updateId) {
        setError('');
        
        if (contractId && result.completionOffset !== undefined) {
          localStorage.setItem(`orderBook_${tradingPair}_${partyId}`, contractId);
          localStorage.setItem(`orderBook_${tradingPair}_${partyId}_offset`, result.completionOffset.toString());
        }
        
      if (contractId) {
        await showModal({
          title: 'OrderBook Created',
          message: `OrderBook created successfully for ${tradingPair}!\n\nContract ID: ${contractId}`,
            type: 'success',
            confirmText: 'OK',
          });
        }
        
      // Refresh available pairs after creating OrderBook
        try {
          // Query at completion offset to get the newly created OrderBook
          if (result.completionOffset !== undefined) {
            const { queryContractsAtOffset } = await import('../services/cantonApi');
            const pairsAtOffset = await queryContractsAtOffset('OrderBook:OrderBook', partyId, result.completionOffset.toString());
            const tradingPairs = pairsAtOffset
              .map(ob => ob.payload?.tradingPair)
              .filter(pair => pair && typeof pair === 'string')
              .filter((pair, index, self) => self.indexOf(pair) === index);
            
            if (tradingPairs.length > 0) {
              setAvailablePairs(tradingPairs);
            }
          }
          
          // Also try current ledger end as fallback
          const pairs = await getAvailableTradingPairs(partyId);
          if (pairs.length > 0) {
            setAvailablePairs(pairs);
            }
          } catch (err) {
          console.error('[Create OrderBook] Error refreshing available pairs:', err);
        }
        
        await loadOrderBook(true);
        return { success: true, contractId, completionOffset: result.completionOffset };
      } else {
        setError('OrderBook creation failed. Please check the console for details and try again.');
        return { success: false };
      }
    } catch (err) {
      console.error('[Create OrderBook] Error:', err);
      setError(`Failed to create OrderBook: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      setCreatingOrderBook(false);
    }
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
      
      // Query OrderBooks - try current ledger end first
      console.log('[Place Order] Querying OrderBooks for party:', partyId);
      let orderBooks = await queryContracts('OrderBook:OrderBook', partyId);
      console.log('[Place Order] Found', orderBooks.length, 'OrderBooks at current ledger end');
      
      // If not found, try stored completion offset
      let orderBookContract = orderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
      
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
      
      // Find ALL OrderBooks for this trading pair (if multiple found)
      const matchingOrderBooks = orderBooks.filter(ob => ob.payload?.tradingPair === tradingPair);
      
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
        console.log('[Place Order] OrderBook not found, prompting user to create...');
        const shouldCreate = await showModal({
          title: 'OrderBook Not Found',
          message: `Order book not found for ${tradingPair}.\n\nWould you like to create it now?`,
          type: 'warning',
          showCancel: true,
          confirmText: 'Create',
          cancelText: 'Cancel',
        });
        
        if (shouldCreate) {
          console.log('[Place Order] User confirmed, creating OrderBook...');
          const createResult = await handleCreateOrderBook();
          
          if (!createResult || !createResult.success) {
            setError('Failed to create OrderBook. Please try again.');
            setLoading(false);
            return;
          }
          
          // Get the completion offset from createResult or stored value
          const completionOffset = createResult.completionOffset || localStorage.getItem(`orderBook_${tradingPair}_${partyId}_offset`);
          
          if (completionOffset) {
            console.log('[Place Order] Querying newly created OrderBook at completion offset:', completionOffset);
            // Wait a bit for ledger propagation
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Query at the completion offset where the OrderBook was created
            const { queryContractsAtOffset } = await import('../services/cantonApi');
            const newOrderBooks = await queryContractsAtOffset('OrderBook:OrderBook', partyId, completionOffset.toString());
            console.log('[Place Order] Found', newOrderBooks.length, 'OrderBooks at completion offset', completionOffset);
            
            orderBookContract = newOrderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
            
            if (!orderBookContract) {
              // Fallback: try current ledger end
              console.log('[Place Order] Not found at completion offset, trying current ledger end...');
              const fallbackOrderBooks = await queryContracts('OrderBook:OrderBook', partyId);
              orderBookContract = fallbackOrderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
            }
            
            if (!orderBookContract) {
              console.error('[Place Order] OrderBook still not found after creation!');
              setError('OrderBook was created but not immediately visible. Please refresh the page and try placing the order again.');
          setLoading(false);
          return;
            }
            
            console.log('[Place Order] ✅ Found newly created OrderBook:', orderBookContract.contractId);
        } else {
            setError('OrderBook creation succeeded but completion offset not available. Please refresh and try again.');
            setLoading(false);
            return;
          }
        } else {
          console.log('[Place Order] User cancelled OrderBook creation');
          throw new Error(`Order book not found for ${tradingPair}. Please create it first.`);
        }
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
        [partyId, operator],
        orderBookContract.templateId || 'OrderBook:OrderBook'
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
      setError(err.message || 'Failed to place order');
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

  return (
    <>
      <ModalComponent />
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
            onOrderTypeChange={setOrderType}
            orderMode={orderMode}
            onOrderModeChange={setOrderMode}
            price={price}
            onPriceChange={setPrice}
            quantity={quantity}
            onQuantityChange={setQuantity}
            loading={loading}
            onSubmit={handlePlaceOrder}
          />
              </div>

        <OrderBookCard
          tradingPair={tradingPair}
          orderBook={orderBook}
          loading={orderBookLoading}
          onRefresh={() => loadOrderBook(true)}
          onCreateOrderBook={handleCreateOrderBook}
          creatingOrderBook={creatingOrderBook}
        />

        <ActiveOrdersTable
          orders={orders}
          onCancelOrder={handleCancelOrder}
        />
    </div>
    </>
  );
}
