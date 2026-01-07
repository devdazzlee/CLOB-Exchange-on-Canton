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
        const pairs = await getAvailableTradingPairs(partyId);
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
      const userOrders = await queryContracts('Order:Order', partyId);
      const activeOrders = userOrders.filter(o => 
        o.payload?.status === 'OPEN' && 
        o.payload?.tradingPair === tradingPair
      );
      
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
      console.error('[Active Orders] Error:', err);
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
      let orderBooks = await queryContracts('OrderBook:OrderBook', partyId);
      let book = orderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
      
      if (book) {
        localStorage.removeItem(`orderBook_${tradingPair}_${partyId}_offset`);
      }
      
      if (!book) {
        const storedOrderBookId = localStorage.getItem(`orderBook_${tradingPair}_${partyId}`);
        if (storedOrderBookId) {
        try {
          const storedBook = await fetchContract(storedOrderBookId, partyId);
          if (storedBook && storedBook.payload?.tradingPair === tradingPair) {
            book = storedBook;
          }
        } catch (err) {
          console.warn('[OrderBook] Could not fetch stored OrderBook:', err);
          }
        }
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
      
      if (buyCids.length === 0 && sellCids.length === 0) {
        setOrderBook({ buys: [], sells: [] });
        setOrderBookExists(true);
        setOrderBookLoading(false);
        isLoadingRef.current = false;
        return;
      }
      
      const allCids = [...buyCids, ...sellCids];
      const orderContracts = await fetchContracts(allCids, partyId);
      
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
        
        await loadOrderBook(true);
            } else {
        setError('OrderBook creation failed. Please check the console for details and try again.');
      }
    } catch (err) {
      console.error('[Create OrderBook] Error:', err);
      setError(`Failed to create OrderBook: ${err.message}`);
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
      
      const orderBooks = await queryContracts('OrderBook:OrderBook', partyId);
      let orderBookContract = orderBooks.find(ob => ob.payload?.tradingPair === tradingPair);

      if (!orderBookContract) {
        const shouldCreate = await showModal({
          title: 'OrderBook Not Found',
          message: `Order book not found for ${tradingPair}.\n\nWould you like to create it now?`,
          type: 'warning',
          showCancel: true,
          confirmText: 'Create',
          cancelText: 'Cancel',
        });
        
        if (shouldCreate) {
          await handleCreateOrderBook();
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const newOrderBooks = await queryContracts('OrderBook:OrderBook', partyId);
          orderBookContract = newOrderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
          
          if (!orderBookContract) {
            setError('OrderBook was created but not immediately visible. Please refresh.');
          setLoading(false);
          return;
          }
        } else {
          throw new Error(`Order book not found for ${tradingPair}. Please create it first.`);
        }
      }

      const operator = orderBookContract.payload?.operator;
      if (!operator) {
        throw new Error('OrderBook operator not found. Cannot place order.');
      }
      
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
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
          let updatedOrderBooks = await queryContracts('OrderBook:OrderBook', partyId);
          let updatedBook = updatedOrderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
            
            if (updatedBook) {
            localStorage.setItem(`orderBook_${tradingPair}_${partyId}`, updatedBook.contractId);
            localStorage.setItem(`orderBook_${tradingPair}_${partyId}_offset`, exerciseResult.completionOffset.toString());
          }
        } catch (err) {
          console.error('[Place Order] Error finding updated OrderBook:', err);
        }
      }

      await loadOrders();
      await loadOrderBook(true);
      await loadBalance(false);
      setPrice('');
      setQuantity('');
      await showModal({
        title: 'Order Placed',
        message: 'Order placed successfully!',
        type: 'success',
        confirmText: 'OK',
      });
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
