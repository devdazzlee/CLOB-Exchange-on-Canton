import { useState, useEffect, useRef } from 'react';
import { createContract, exerciseChoice, queryContracts, fetchContracts, fetchContract, queryContractsAtOffset } from '../services/cantonApi';
import { useConfirmationModal } from './ConfirmationModal';

export default function TradingInterface({ partyId }) {
  const [tradingPair, setTradingPair] = useState('BTC/USDT');
  const [orderType, setOrderType] = useState('BUY');
  const [orderMode, setOrderMode] = useState('LIMIT');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [balance, setBalance] = useState({ BTC: '0.0', USDT: '0.0' });
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [orders, setOrders] = useState([]);
  const [orderBook, setOrderBook] = useState({ buys: [], sells: [] });
  const [loading, setLoading] = useState(false);
  const [orderBookLoading, setOrderBookLoading] = useState(true); // Start with loading true to show loader initially
  const [error, setError] = useState('');
  const [creatingOrderBook, setCreatingOrderBook] = useState(false);
  const { showModal, ModalComponent } = useConfirmationModal();
  const isLoadingRef = useRef(false); // Track if loadOrderBook is currently running to prevent multiple simultaneous calls

  useEffect(() => {
    if (partyId) {
      // Reset loading flag when trading pair changes
      isLoadingRef.current = false;
      
      // Clear order book when trading pair changes to show loader for new pair
      setOrderBook({ buys: [], sells: [] });
      setOrderBookLoading(true); // Show loader immediately when switching pairs
      
      loadBalance();
      loadOrders();
      loadOrderBook(true); // Show loader on initial load
      
      // Refresh order book and balance every 5 seconds
      // Don't show loader on periodic refreshes to avoid flickering
      const interval = setInterval(() => {
        // Only refresh if not already loading
        if (!isLoadingRef.current) {
          loadOrderBook(false); // Don't show loader on refresh
        }
        loadOrders();
        loadBalance(); // Refresh balance periodically
      }, 5000);
      
      return () => {
        clearInterval(interval);
        isLoadingRef.current = false; // Reset on cleanup
      };
    }
  }, [partyId, tradingPair]);

  const loadBalance = async () => {
    setBalanceLoading(true);
    try {
      console.log('[Balance] Loading balance for party:', partyId);
      const accounts = await queryContracts('UserAccount:UserAccount', partyId);
      console.log('[Balance] Found accounts:', accounts.length, accounts);
      
      if (accounts.length > 0) {
        const account = accounts[0];
        console.log('[Balance] Account payload:', account.payload);
        
        // Handle Map format from DAML (array of [key, value] pairs)
        const balances = account.payload?.balances || {};
        console.log('[Balance] Raw balances:', balances, 'Type:', typeof balances, 'Is Array:', Array.isArray(balances));
        
        let btcBalance = '0.0';
        let usdtBalance = '0.0';
        
        // If balances is an array (Map format), convert to object
        if (Array.isArray(balances)) {
          balances.forEach(([key, value]) => {
            console.log('[Balance] Map entry:', key, value);
            if (key === 'BTC') btcBalance = value?.toString() || '0.0';
            if (key === 'USDT') usdtBalance = value?.toString() || '0.0';
          });
        } else if (balances && typeof balances === 'object') {
          // If balances is already an object
          console.log('[Balance] Object keys:', Object.keys(balances));
          btcBalance = balances?.BTC?.toString() || balances?.get?.('BTC')?.toString() || '0.0';
          usdtBalance = balances?.USDT?.toString() || balances?.get?.('USDT')?.toString() || '0.0';
        }
        
        console.log('[Balance] Final balances - BTC:', btcBalance, 'USDT:', usdtBalance);
        
        setBalance({
          BTC: btcBalance,
          USDT: usdtBalance
        });
      } else {
        // No account found, set default balances
        console.warn('[Balance] No UserAccount contract found for party:', partyId);
        console.warn('[Balance] UserAccount needs to be created by operator first');
        setBalance({ BTC: '0.0', USDT: '0.0' });
      }
    } catch (err) {
      console.error('[Balance] Error loading balance:', err);
      console.error('[Balance] Error details:', err.message, err.stack);
      setBalance({ BTC: '0.0', USDT: '0.0' });
    } finally {
      setBalanceLoading(false);
    }
  };

  const loadOrders = async () => {
    try {
      console.log('[Active Orders] Querying Order contracts for party:', partyId);
      const userOrders = await queryContracts('Order:Order', partyId);
      console.log('[Active Orders] Found', userOrders.length, 'Order contracts');
      
      // Filter to only OPEN orders for the current trading pair
      const activeOrders = userOrders.filter(o => 
        o.payload?.status === 'OPEN' && 
        o.payload?.tradingPair === tradingPair
      );
      
      console.log('[Active Orders] Filtered to', activeOrders.length, 'OPEN orders for trading pair', tradingPair);
      
      if (userOrders.length === 0) {
        console.warn('[Active Orders] ⚠️ No orders found. Possible reasons:');
        console.warn('[Active Orders] 1. No orders have been placed yet');
        console.warn('[Active Orders] 2. Orders were created but are not visible to this party');
        console.warn('[Active Orders] 3. Orders were matched/filled immediately and archived');
        console.warn('[Active Orders] Party ID:', partyId);
      } else if (activeOrders.length === 0 && userOrders.length > 0) {
        console.log('[Active Orders] Found', userOrders.length, 'orders but none are OPEN for', tradingPair);
        console.log('[Active Orders] All orders:', userOrders.map(o => ({
          contractId: o.contractId,
          orderId: o.payload?.orderId,
          type: o.payload?.orderType,
          status: o.payload?.status,
          tradingPair: o.payload?.tradingPair,
          owner: o.payload?.owner,
        })));
      } else {
        console.log('[Active Orders] Active order details:', activeOrders.map(o => ({
          contractId: o.contractId,
          orderId: o.payload?.orderId,
          type: o.payload?.orderType,
          status: o.payload?.status,
          owner: o.payload?.owner,
          operator: o.payload?.operator
        })));
      }
      
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
    }
  };

  const loadOrderBook = async (showLoader = false) => {
    // Prevent multiple simultaneous calls
    if (isLoadingRef.current) {
      console.log('[OrderBook] Already loading, skipping duplicate call');
      return;
    }
    
    isLoadingRef.current = true;
    
    // Only show loader if explicitly requested AND order book is empty
    // This prevents flickering on periodic refreshes and trading pair changes
    const isEmpty = orderBook.buys.length === 0 && orderBook.sells.length === 0;
    if (showLoader && isEmpty) {
      setOrderBookLoading(true);
    } else if (showLoader && !isEmpty) {
      // If explicitly requested but data exists, show loader briefly (user action)
      setOrderBookLoading(true);
    }
    // If showLoader is false, don't show loader (periodic refresh)
    
    try {
      // CRITICAL FIX: OrderBook exists at creation offset but NOT at current ledger end
      // Solution: Query at current ledger end first (most up-to-date), then fall back to stored offset
      
      let orderBooks = [];
      const storedOrderBookId = localStorage.getItem(`orderBook_${tradingPair}_${partyId}`);
      const storedCompletionOffset = localStorage.getItem(`orderBook_${tradingPair}_${partyId}_offset`);
      
      // Strategy 1: Query at current ledger end first (this is the most up-to-date)
      console.log('[OrderBook] Querying at current ledger end (most up-to-date)...');
      orderBooks = await queryContracts('OrderBook:OrderBook', partyId);
      console.log('[OrderBook] Found', orderBooks.length, 'OrderBooks at current ledger end');
      
      // Find OrderBook for this trading pair at current ledger end
      let book = orderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
      
      // Strategy 2: If not found at current ledger end, try stored offset
      if (!book && storedOrderBookId && storedCompletionOffset) {
        console.log('[OrderBook] OrderBook not found at current ledger end, trying stored offset:', storedCompletionOffset);
        console.log('[OrderBook] Stored contract ID:', storedOrderBookId.substring(0, 20) + '...');
        
        try {
          // Query at the completion offset where OrderBook was created/updated
          const orderBooksAtOffset = await queryContractsAtOffset('OrderBook:OrderBook', partyId, storedCompletionOffset);
          console.log('[OrderBook] Found', orderBooksAtOffset.length, 'OrderBooks at offset', storedCompletionOffset);
          
          // Strategy 2a: Find the OrderBook with matching contract ID
          let storedBook = orderBooksAtOffset.find(ob => ob.contractId === storedOrderBookId);
          
          // Strategy 2b: If stored contract ID doesn't match, find ANY OrderBook for this trading pair
          // This handles the case where AddOrder created a new OrderBook (old one was archived)
          if (!storedBook || storedBook.payload?.tradingPair !== tradingPair) {
            console.log('[OrderBook] Stored contract ID not found or wrong trading pair, searching for OrderBook with trading pair:', tradingPair);
            storedBook = orderBooksAtOffset.find(ob => ob.payload?.tradingPair === tradingPair);
            
            if (storedBook) {
              console.log('[OrderBook] ✅ Found OrderBook for trading pair at stored offset (different contract ID)');
              console.log('[OrderBook] Old contract ID:', storedOrderBookId);
              console.log('[OrderBook] New contract ID:', storedBook.contractId);
              // Update stored contract ID to the new one
              localStorage.setItem(`orderBook_${tradingPair}_${partyId}`, storedBook.contractId);
              book = storedBook;
            } else {
              console.warn('[OrderBook] No OrderBook found for trading pair at stored offset');
              console.warn('[OrderBook] Available trading pairs:', orderBooksAtOffset.map(ob => ob.payload?.tradingPair));
            }
          } else {
            book = storedBook;
          }
          
          if (book && book.payload?.tradingPair === tradingPair) {
            console.log('[OrderBook] ✅ Found OrderBook using stored contract ID at stored offset!');
            orderBooks = [book];
          }
        } catch (err) {
          console.warn('[OrderBook] Error querying at stored offset:', err);
        }
      }
      
      // Strategy 3: If still no results, try fetching by contract ID at current ledger end
      if (!book && storedOrderBookId) {
        console.log('[OrderBook] No OrderBooks found, trying to fetch by stored contract ID at current ledger end...');
        try {
          const storedBook = await fetchContract(storedOrderBookId, partyId);
          if (storedBook && storedBook.payload?.tradingPair === tradingPair) {
            console.log('[OrderBook] ✅ Found OrderBook using stored contract ID at current ledger end!');
            book = storedBook;
            orderBooks = [book];
          }
        } catch (err) {
          console.warn('[OrderBook] Could not fetch stored OrderBook:', err);
        }
      }
      
      // If still no results, show empty order book
      if (!book) {
        console.log('[OrderBook] No OrderBook found for trading pair:', tradingPair);
        console.log('[OrderBook] Available trading pairs:', orderBooks.map(ob => ob.payload?.tradingPair));
        setOrderBook({ buys: [], sells: [] });
        setOrderBookLoading(false);
        isLoadingRef.current = false; // Reset loading flag
        return;
      }
      
      // Store the contract ID for future queries
      localStorage.setItem(`orderBook_${tradingPair}_${partyId}`, book.contractId);

      console.log('[OrderBook] Found OrderBook:', {
        contractId: book.contractId,
        tradingPair: book.payload?.tradingPair,
        buyOrdersCount: book.payload?.buyOrders?.length || 0,
        sellOrdersCount: book.payload?.sellOrders?.length || 0,
        fullPayload: JSON.stringify(book.payload, null, 2)
      });

      const buyCids = book.payload?.buyOrders || [];
      const sellCids = book.payload?.sellOrders || [];
      
      console.log('[OrderBook] 🔍 DEBUGGING Contract IDs:', {
        buyCids: buyCids,
        sellCids: sellCids,
        totalCids: buyCids.length + sellCids.length,
        buyCidsTypes: buyCids.map(cid => typeof cid),
        sellCidsTypes: sellCids.map(cid => typeof cid),
        buyCidsRaw: JSON.stringify(buyCids),
        sellCidsRaw: JSON.stringify(sellCids)
      });
      
      // Check if ContractIds are in the correct format
      if (buyCids.length > 0 || sellCids.length > 0) {
        const sampleCid = buyCids[0] || sellCids[0];
        console.log('[OrderBook] Sample ContractId:', {
          value: sampleCid,
          type: typeof sampleCid,
          isString: typeof sampleCid === 'string',
          length: sampleCid?.length,
          firstChars: sampleCid?.substring(0, 20)
        });
      } else {
        console.warn('[OrderBook] ⚠️ NO ContractIds in OrderBook! buyOrders and sellOrders are empty arrays.');
        console.warn('[OrderBook] This means either:');
        console.warn('[OrderBook] 1. No orders have been placed yet');
        console.warn('[OrderBook] 2. Orders were matched/filled and removed from OrderBook');
        console.warn('[OrderBook] 3. Orders were created but not added to OrderBook arrays');
      }
      
      // Fetch all order contracts using user's party ID
      // Orders should be visible to the user's party
      const allCids = [...buyCids, ...sellCids];
      console.log('[OrderBook] 🔍 Fetching contracts for', allCids.length, 'ContractIds...');
      
      // Use the same offset as the OrderBook for consistency
      const orderBookOffset = localStorage.getItem(`orderBook_${tradingPair}_${partyId}_offset`);
      
      if (allCids.length === 0) {
        console.warn('[OrderBook] ⚠️ CRITICAL: No ContractIds to fetch! OrderBook arrays are empty.');
        console.warn('[OrderBook] Querying ALL Order contracts to see if any exist...');
        // Query all Order contracts to see if they exist at all
        try {
          // Query at the same offset as OrderBook for consistency
          const queryOffset = orderBookOffset || undefined;
          const allOrders = queryOffset 
            ? await queryContractsAtOffset('Order:Order', partyId, queryOffset)
            : await queryContracts('Order:Order', partyId);
          
          // Filter to only orders for this trading pair and OPEN status
          const relevantOrders = allOrders.filter(o => 
            o.payload?.tradingPair === tradingPair && 
            o.payload?.status === 'OPEN'
          );
          
          console.log('[OrderBook] Found', allOrders.length, 'total Order contracts in ledger');
          console.log('[OrderBook] Found', relevantOrders.length, 'OPEN orders for trading pair', tradingPair);
          
          if (relevantOrders.length > 0) {
            console.log('[OrderBook] Order contracts found:', relevantOrders.map(o => ({
              contractId: o.contractId,
              orderId: o.payload?.orderId,
              type: o.payload?.orderType,
              status: o.payload?.status,
              tradingPair: o.payload?.tradingPair,
              price: o.payload?.price,
              quantity: o.payload?.quantity
            })));
            console.warn('[OrderBook] ⚠️ Orders exist but are NOT in OrderBook arrays!');
            console.warn('[OrderBook] This suggests MatchOrders failed to fetch orders or filtered them out incorrectly');
            console.warn('[OrderBook] WORKAROUND: Using orders directly from query instead of OrderBook arrays');
            
            // WORKAROUND: Use the orders we found directly instead of relying on OrderBook arrays
            // This handles the case where MatchOrders creates an OrderBook with empty arrays
            // but the orders actually exist and are OPEN
            const workaroundBuyOrders = relevantOrders.filter(o => o.payload?.orderType === 'BUY');
            const workaroundSellOrders = relevantOrders.filter(o => o.payload?.orderType === 'SELL');
            
            console.log('[OrderBook] Using workaround: Found', workaroundBuyOrders.length, 'buy orders and', workaroundSellOrders.length, 'sell orders');
            
            // Process these orders as if they came from the OrderBook
            const processedBuyOrders = workaroundBuyOrders.map(contract => {
              const quantity = parseFloat(contract.payload?.quantity || 0);
              const filled = parseFloat(contract.payload?.filled || 0);
              return {
                price: contract.payload?.price?.Some || null,
                quantity: quantity,
                filled: filled,
                remaining: quantity - filled, // Calculate remaining quantity
                contractId: contract.contractId,
                orderId: contract.payload?.orderId
              };
            }).sort((a, b) => {
              if (a.price === null) return -1;
              if (b.price === null) return 1;
              return b.price - a.price; // Highest price first for buys
            });
            
            const processedSellOrders = workaroundSellOrders.map(contract => {
              const quantity = parseFloat(contract.payload?.quantity || 0);
              const filled = parseFloat(contract.payload?.filled || 0);
              return {
                price: contract.payload?.price?.Some || null,
                quantity: quantity,
                filled: filled,
                remaining: quantity - filled, // Calculate remaining quantity
                contractId: contract.contractId,
                orderId: contract.payload?.orderId
              };
            }).sort((a, b) => {
              if (a.price === null) return 1;
              if (b.price === null) return -1;
              return a.price - b.price; // Lowest price first for sells
            });
            
            console.log('[OrderBook] ✅ Final processed orders (workaround):', {
              buyOrdersCount: processedBuyOrders.length,
              sellOrdersCount: processedSellOrders.length,
              buyOrders: processedBuyOrders,
              sellOrders: processedSellOrders
            });
            
            setOrderBook({
              buys: processedBuyOrders,
              sells: processedSellOrders
            });
            setOrderBookLoading(false);
            isLoadingRef.current = false; // Reset loading flag
            return; // Early return - we've handled it with the workaround
          }
        } catch (err) {
          console.error('[OrderBook] Error querying all orders:', err);
        }
      }
      
      // Fetch orders at the same offset as OrderBook, or current ledger end
      const orderContracts = orderBookOffset 
        ? await fetchContracts(allCids, partyId, orderBookOffset)
        : await fetchContracts(allCids, partyId);
      console.log('[OrderBook] 🔍 Fetched', orderContracts.length, 'order contracts out of', allCids.length, 'requested');
      
      if (orderContracts.length === 0 && allCids.length > 0) {
        console.error('[OrderBook] ❌ CRITICAL ERROR: No contracts fetched but ContractIds exist!');
        console.error('[OrderBook] ContractIds that failed:', allCids);
        console.error('[OrderBook] This might indicate:');
        console.error('[OrderBook] 1. Visibility issue - orders not visible to party:', partyId);
        console.error('[OrderBook] 2. ContractIds format mismatch');
        console.error('[OrderBook] 3. Orders were archived/deleted');
        
        // Try fetching each ContractId individually to see which ones fail
        for (let i = 0; i < allCids.length; i++) {
          const cid = allCids[i];
          try {
            const singleContract = await fetchContract(cid, partyId);
            console.log(`[OrderBook] ✅ ContractId ${i} (${cid.substring(0, 20)}...) fetched successfully:`, {
              contractId: singleContract?.contractId,
              orderId: singleContract?.payload?.orderId,
              status: singleContract?.payload?.status
            });
          } catch (err) {
            console.error(`[OrderBook] ❌ ContractId ${i} (${cid.substring(0, 20)}...) failed:`, err.message);
          }
        }
      } else if (orderContracts.length > 0) {
        console.log('[OrderBook] ✅ Successfully fetched order contracts:', orderContracts.map(c => ({
          contractId: c.contractId,
          orderId: c.payload?.orderId,
          type: c.payload?.orderType,
          status: c.payload?.status,
          price: c.payload?.price,
          quantity: c.payload?.quantity,
          filled: c.payload?.filled
        })));
      }
      
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
      // CRITICAL: Don't filter by index - match by ContractId to ensure correct mapping
      const sellOrders = orderContracts
        .filter(contract => {
          // Check if this contract's ID is in sellCids array
          const isSellOrder = sellCids.includes(contract.contractId);
          const isOpen = contract?.payload?.status === 'OPEN';
          if (!isSellOrder) return false;
          if (!isOpen) {
            console.log('[OrderBook] Skipping non-OPEN sell order:', {
              contractId: contract.contractId,
              orderId: contract.payload?.orderId,
              status: contract.payload?.status
            });
          }
          return isOpen;
        })
        .map(contract => {
          const price = contract.payload?.price?.Some || contract.payload?.price || null;
          const quantity = parseFloat(contract.payload?.quantity || 0);
          const filled = parseFloat(contract.payload?.filled || 0);
          return {
            price: price,
            quantity: quantity,
            filled: filled,
            remaining: quantity - filled,
            timestamp: contract.payload?.timestamp || 0,
            contractId: contract.contractId,
            orderId: contract.payload?.orderId
          };
        })
        .filter(order => order.remaining > 0) // Only show orders with remaining quantity
        .sort((a, b) => {
          // Sort sell orders: lowest price first, then by timestamp (oldest first)
          if (a.price === null && b.price === null) return a.timestamp - b.timestamp;
          if (a.price === null) return 1; // Market orders go to end
          if (b.price === null) return -1;
          if (a.price !== b.price) return a.price - b.price; // Lower price first
          return a.timestamp - b.timestamp; // Older first for same price
        });

      console.log('[OrderBook] ✅ Final processed orders:', {
        buyOrdersCount: buyOrders.length,
        sellOrdersCount: sellOrders.length,
        buyOrders: buyOrders,
        sellOrders: sellOrders
        });

      setOrderBook({
        buys: buyOrders,
        sells: sellOrders
      });
    } catch (err) {
      console.error('Error loading order book:', err);
      setOrderBook({ buys: [], sells: [] });
    } finally {
      setOrderBookLoading(false);
      isLoadingRef.current = false; // Reset loading flag
    }
  };

  const handleCreateOrderBook = async () => {
    const confirmed = await showModal({
      title: 'Create OrderBook',
      message: `Create OrderBook for ${tradingPair}?`,
      type: 'info',
      showCancel: true,
      confirmText: 'Create',
      cancelText: 'Cancel',
    });
    
    if (!confirmed) {
      return;
    }

    setError('');
    setCreatingOrderBook(true);

    try {
      // OrderBook template requires all fields:
      // - tradingPair: Text (required)
      // - buyOrders: [ContractId Order] (required - empty array for new book)
      // - sellOrders: [ContractId Order] (required - empty array for new book)
      // - lastPrice: Optional Decimal (can be null)
      // - operator: Party (required)
      const payload = {
        tradingPair: tradingPair,
        buyOrders: [], // Required field - must be included even if empty
        sellOrders: [], // Required field - must be included even if empty
        lastPrice: null, // Optional field - null for new order book
        operator: partyId
      };
      
      console.log('[Create OrderBook] Payload:', JSON.stringify(payload, null, 2));
      
      const result = await createContract('OrderBook:OrderBook', payload, partyId);
      
      console.log('[Create OrderBook] ✅ Success! Result:', result);
      
      // Extract contract ID from response
      // The createContract function now extracts contractId from transaction events
      let contractId = result.contractId;
      
      // Fallback: try to extract from events if contractId not directly available
      if (!contractId && result.events && result.events.length > 0) {
        const createdEvent = result.events.find(e => e.created);
        if (createdEvent && createdEvent.created) {
          contractId = createdEvent.created.contractId;
        }
      }

      // ROOT CAUSE FIX: Trust the API response - if updateId exists, creation succeeded
      // The API returning updateId means the transaction was committed successfully
      if (result.updateId) {
        // Clear any previous errors immediately
        setError('');
        
        console.log('[Create OrderBook] ✅ SUCCESS - Transaction committed:', {
          updateId: result.updateId,
          completionOffset: result.completionOffset,
          contractId: contractId || 'will be available after query'
        });
        
        // Store OrderBook contract ID and completion offset for future queries
        if (contractId && result.completionOffset !== undefined) {
          localStorage.setItem(`orderBook_${tradingPair}_${partyId}`, contractId);
          localStorage.setItem(`orderBook_${tradingPair}_${partyId}_offset`, result.completionOffset.toString());
          console.log('[Create OrderBook] Stored OrderBook contract ID and offset:', {
            contractId: contractId,
            offset: result.completionOffset
          });
        }
        
        // Show success message - creation succeeded even if contract ID not found yet
      if (contractId) {
        await showModal({
          title: 'OrderBook Created',
          message: `OrderBook created successfully for ${tradingPair}!\n\nContract ID: ${contractId}`,
          type: 'success',
          confirmText: 'OK',
        });
      } else {
          // Contract ID not found yet, but creation succeeded - show success message
          await showModal({
            title: 'OrderBook Creation Submitted',
            message: `OrderBook creation command submitted successfully for ${tradingPair}!\n\nThe order book should appear shortly. If it doesn't appear, this might indicate a visibility/permissions issue.`,
            type: 'success',
            confirmText: 'OK',
          });
        }
        
        // Refresh the order book immediately (show loader since we just created it)
        await loadOrderBook(true);
        
        // Background verification: Try to find the contract (with longer delays for ledger propagation)
        // This is informational only - we don't fail if it doesn't find it immediately
        const verifyOrderBook = async (attempt = 1, maxAttempts = 5) => {
          try {
            // Increasing delays: 2s, 4s, 8s, 16s, 32s
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            
            console.log(`[Create OrderBook] Verification attempt ${attempt}/${maxAttempts}...`);
            console.log(`[Create OrderBook] Using completionOffset: ${result.completionOffset}`);
            
            // Try querying at the completionOffset first
            let orderBooks = await queryContractsAtOffset('OrderBook:OrderBook', partyId, result.completionOffset);
            
            // If no results, try current ledger end
            if (orderBooks.length === 0) {
              orderBooks = await queryContracts('OrderBook:OrderBook', partyId);
            }
            
            console.log(`[Create OrderBook] Found ${orderBooks.length} OrderBook(s) in query`);
            
            const orderBookContract = orderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
            if (orderBookContract) {
              console.log('[Create OrderBook] ✅ VERIFIED: OrderBook exists in ledger', {
                contractId: orderBookContract.contractId,
                tradingPair: orderBookContract.payload?.tradingPair
              });
              // Refresh order book one more time to ensure UI is updated (no loader, just refresh)
              await loadOrderBook(false);
              return true; // Found it!
            } else {
              console.log(`[Create OrderBook] OrderBook not found yet (attempt ${attempt}/${maxAttempts})`);
              if (attempt < maxAttempts) {
                // Try again
                return verifyOrderBook(attempt + 1, maxAttempts);
              } else {
                console.warn('[Create OrderBook] ⚠️ OrderBook not found after all verification attempts');
                console.warn('[Create OrderBook] Possible causes:');
                console.warn('[Create OrderBook] 1. Contract visibility issue (party may not have read permissions)');
                console.warn('[Create OrderBook] 2. Ledger propagation delay (contract may appear later)');
                console.warn('[Create OrderBook] 3. Contract was created but not visible to this party');
                console.warn('[Create OrderBook] Available OrderBooks:', orderBooks.map(ob => ({
                  contractId: ob.contractId,
                  tradingPair: ob.payload?.tradingPair
                })));
                return false;
              }
            }
          } catch (err) {
            console.warn(`[Create OrderBook] Verification attempt ${attempt} failed:`, err);
            if (attempt < maxAttempts) {
              return verifyOrderBook(attempt + 1, maxAttempts);
            }
            return false;
          }
        };
        
        // Start verification in background (don't await - non-blocking)
        verifyOrderBook().catch(err => {
          console.warn('[Create OrderBook] Background verification error:', err);
          // Don't set error - creation succeeded, verification is just informational
        });
        
      } else {
        // No updateId means creation actually failed at the API level
        console.error('[Create OrderBook] ❌ Creation failed - no updateId in response');
        console.error('[Create OrderBook] Response:', result);
        setError('OrderBook creation failed. Please check the console for details and try again.');
      }
    } catch (err) {
      console.error('[Create OrderBook] Error:', err);
      setError(`Failed to create OrderBook: ${err.message}`);
    } finally {
      setCreatingOrderBook(false);
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
      
      // CRITICAL: OrderBook exists at creation offset, not at current ledger end
      // Try using stored contract ID and completion offset first
      const storedOrderBookId = localStorage.getItem(`orderBook_${tradingPair}_${partyId}`);
      const storedCompletionOffset = localStorage.getItem(`orderBook_${tradingPair}_${partyId}_offset`);
      
      let orderBookContract = null;
      
      if (storedOrderBookId && storedCompletionOffset) {
        console.log('[Place Order] Using stored OrderBook contract ID and offset:', {
          contractId: storedOrderBookId.substring(0, 20) + '...',
          offset: storedCompletionOffset
        });
        
        try {
          // Query at the completion offset where OrderBook was created
          const orderBooksAtOffset = await queryContractsAtOffset('OrderBook:OrderBook', partyId, storedCompletionOffset);
          console.log('[Place Order] Found', orderBooksAtOffset.length, 'OrderBooks at offset', storedCompletionOffset);
          
          // Find the OrderBook with matching contract ID
          orderBookContract = orderBooksAtOffset.find(ob => ob.contractId === storedOrderBookId);
          if (orderBookContract && orderBookContract.payload?.tradingPair === tradingPair) {
            console.log('[Place Order] ✅ Found OrderBook using stored contract ID at completion offset!');
          } else {
            // Try to find any OrderBook for this trading pair at that offset
            orderBookContract = orderBooksAtOffset.find(ob => ob.payload?.tradingPair === tradingPair);
            if (orderBookContract) {
              console.log('[Place Order] ✅ Found OrderBook for trading pair at completion offset (different contract ID)');
              // Update stored contract ID
              localStorage.setItem(`orderBook_${tradingPair}_${partyId}`, orderBookContract.contractId);
            }
          }
        } catch (err) {
          console.warn('[Place Order] Error querying at stored offset:', err);
        }
      }
      
      // Fallback: Query at current ledger end
      if (!orderBookContract) {
        console.log('[Place Order] OrderBook not found at stored offset, trying current ledger end...');
      const orderBooks = await queryContracts('OrderBook:OrderBook', partyId);
        orderBookContract = orderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
        
        // If still not found, try fetching by stored contract ID at current ledger end
        if (!orderBookContract && storedOrderBookId) {
          console.log('[Place Order] Trying to fetch stored OrderBook contract ID at current ledger end...');
          try {
            const storedBook = await fetchContract(storedOrderBookId, partyId);
            if (storedBook && storedBook.payload?.tradingPair === tradingPair) {
              console.log('[Place Order] ✅ Found OrderBook using stored contract ID at current ledger end!');
              orderBookContract = storedBook;
            }
          } catch (err) {
            console.warn('[Place Order] Could not fetch stored OrderBook:', err);
          }
        }
      }

      if (!orderBookContract) {
        // OrderBook doesn't exist - show option to create it
        const shouldCreate = await showModal({
          title: 'OrderBook Not Found',
          message: `Order book not found for ${tradingPair}.\n\nWould you like to create it now? (You need operator permissions)`,
          type: 'warning',
          showCancel: true,
          confirmText: 'Create',
          cancelText: 'Cancel',
        });
        
        if (shouldCreate) {
          await handleCreateOrderBook();
          // Retry querying after creation
          // Wait a bit for the contract to be visible
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const newOrderBooks = await queryContracts('OrderBook:OrderBook', partyId);
          const newOrderBookContract = newOrderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
          if (!newOrderBookContract) {
            // Don't throw error immediately - creation succeeded, might just need more time
            console.warn('[Place Order] OrderBook not found immediately after creation, but creation succeeded');
            console.warn('[Place Order] This might be a visibility/permissions issue');
            // Show a helpful message instead of throwing
            await showModal({
              title: 'OrderBook Created',
              message: `OrderBook was created but not immediately visible. This might indicate a visibility/permissions issue.\n\nPlease try refreshing the page or check if the OrderBook appears in a few seconds.`,
              type: 'warning',
              confirmText: 'OK',
            });
            setLoading(false);
            return;
          }
          // Continue with placing order using newOrderBookContract
          // CRITICAL: AddOrder requires both owner and operator authorization
          const operator = newOrderBookContract.payload?.operator;
          if (!operator) {
            throw new Error('OrderBook operator not found. Cannot place order.');
          }
          
          // CRITICAL: Decimal values in Canton JSON API must be strings, not numbers
          // CRITICAL: Optional values in Canton JSON API: use value directly for Some, null for None
          await exerciseChoice(
            newOrderBookContract.contractId,
            'AddOrder',
            {
              orderId: orderId,
              owner: partyId,
              orderType: orderType,
              orderMode: orderMode,
              price: orderMode === 'LIMIT' 
                ? parseFloat(price).toString() // Optional Decimal: pass value directly (not wrapped in Some)
                : null, // Optional Decimal: use null for None
              quantity: parseFloat(quantity).toString() // Decimal must be string
            },
            [partyId, operator], // Both owner and operator must authorize
            newOrderBookContract.templateId || 'OrderBook:OrderBook' // Provide templateId
          );
          await loadOrders();
          await loadOrderBook(true); // Show loader after placing order
          setPrice('');
          setQuantity('');
          await showModal({
            title: 'Order Placed',
            message: 'Order placed successfully!',
            type: 'success',
            confirmText: 'OK',
          });
          setLoading(false);
          return;
        } else {
          throw new Error(`Order book not found for ${tradingPair}. Please create it first.`);
        }
      }

      // CRITICAL: AddOrder internally calls MatchOrders which requires operator authorization
      // We need BOTH owner and operator in actAs array
      const operator = orderBookContract.payload?.operator;
      if (!operator) {
        throw new Error('OrderBook operator not found. Cannot place order.');
      }
      
      console.log('[Place Order] 🔍 Exercising AddOrder choice...', {
        orderBookContractId: orderBookContract.contractId,
        orderId: orderId,
        owner: partyId,
        operator: operator,
        orderType: orderType,
        orderMode: orderMode,
        price: orderMode === 'LIMIT' ? { Some: parseFloat(price) } : { None: null },
        quantity: parseFloat(quantity),
        tradingPair: tradingPair
      });
      
      // Include both owner and operator in actAs for multi-party authorization
      // This is required because AddOrder internally exercises MatchOrders (controlled by operator)
      // CRITICAL: Decimal values in Canton JSON API must be strings, not numbers
      // CRITICAL: Optional values in Canton JSON API: use value directly for Some, null for None
      const exerciseResult = await exerciseChoice(
        orderBookContract.contractId,
        'AddOrder',
        {
          orderId: orderId,
          owner: partyId,
          orderType: orderType,
          orderMode: orderMode,
          price: orderMode === 'LIMIT' 
            ? parseFloat(price).toString() // Optional Decimal: pass value directly (not wrapped in Some)
            : null, // Optional Decimal: use null for None
          quantity: parseFloat(quantity).toString() // Decimal must be string
        },
        [partyId, operator], // Both owner and operator must authorize
        orderBookContract.templateId || 'OrderBook:OrderBook' // Provide templateId
      );
      
      console.log('[Place Order] ✅ AddOrder exercise result:', exerciseResult);
      console.log('[Place Order] UpdateId:', exerciseResult.updateId);
      console.log('[Place Order] CompletionOffset:', exerciseResult.completionOffset);
      
      // CRITICAL: AddOrder creates a NEW OrderBook contract (old one is archived)
      // We need to find the new OrderBook contract ID and store it with the new completion offset
      if (exerciseResult.updateId && exerciseResult.completionOffset !== undefined) {
        console.log('[Place Order] 🔍 OrderBook was updated, finding new contract ID...');
        console.log('[Place Order] Completion offset:', exerciseResult.completionOffset);
        
        // Wait a bit for the new contract to be visible
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // CRITICAL FIX: Query for the updated OrderBook at the completion offset
        // AddOrder creates a new OrderBook, then MatchOrders creates another new OrderBook
        // We need to find the LATEST OrderBook (after MatchOrders runs)
        try {
          // Query at completion offset - this should include the OrderBook after MatchOrders
          let updatedOrderBooks = await queryContractsAtOffset('OrderBook:OrderBook', partyId, exerciseResult.completionOffset);
          console.log('[Place Order] Found', updatedOrderBooks.length, 'OrderBooks at completion offset', exerciseResult.completionOffset);
          
          // If we have the created order contract ID, try to find OrderBook that contains it
          let updatedBook = null;
          if (exerciseResult.createdOrderContractId) {
            // Try to find OrderBook that contains this order's ContractId
            updatedBook = updatedOrderBooks.find(ob => {
              const buyCids = ob.payload?.buyOrders || [];
              const sellCids = ob.payload?.sellOrders || [];
              return buyCids.includes(exerciseResult.createdOrderContractId) || 
                     sellCids.includes(exerciseResult.createdOrderContractId);
            });
            
            if (updatedBook) {
              console.log('[Place Order] ✅ Found OrderBook containing the created order by ContractId');
            }
          }
          
          // Fallback: Find OrderBook for this trading pair (should be the latest one)
          if (!updatedBook) {
            updatedBook = updatedOrderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
            if (updatedBook) {
              console.log('[Place Order] ✅ Found OrderBook for trading pair at completion offset');
            }
          }
          
          // If still not found, try querying at a slightly later offset (completionOffset + 1)
          // This handles cases where MatchOrders creates the OrderBook at a slightly later offset
          if (!updatedBook && exerciseResult.completionOffset) {
            console.log('[Place Order] OrderBook not found at completion offset, trying offset + 1...');
            try {
              const nextOffset = parseInt(exerciseResult.completionOffset) + 1;
              const nextOrderBooks = await queryContractsAtOffset('OrderBook:OrderBook', partyId, nextOffset.toString());
              updatedBook = nextOrderBooks.find(ob => ob.payload?.tradingPair === tradingPair);
              if (updatedBook) {
                console.log('[Place Order] ✅ Found OrderBook at offset + 1');
              }
            } catch (err) {
              console.warn('[Place Order] Error querying at offset + 1:', err);
            }
          }
          
          if (updatedBook) {
            console.log('[Place Order] ✅ Found updated OrderBook with new contract ID:', updatedBook.contractId);
            console.log('[Place Order] OrderBook details:', {
              contractId: updatedBook.contractId,
              buyOrdersCount: updatedBook.payload?.buyOrders?.length || 0,
              sellOrdersCount: updatedBook.payload?.sellOrders?.length || 0,
              buyOrders: updatedBook.payload?.buyOrders,
              sellOrders: updatedBook.payload?.sellOrders,
              fullPayload: JSON.stringify(updatedBook.payload, null, 2)
            });
            
            // Store the new contract ID AND completion offset
            localStorage.setItem(`orderBook_${tradingPair}_${partyId}`, updatedBook.contractId);
            localStorage.setItem(`orderBook_${tradingPair}_${partyId}_offset`, exerciseResult.completionOffset.toString());
            console.log('[Place Order] Updated stored OrderBook contract ID and offset');
            
            // CRITICAL CHECK: Verify the order is in the OrderBook arrays
            const orderInBuyOrders = exerciseResult.createdOrderContractId && 
              (updatedBook.payload?.buyOrders || []).includes(exerciseResult.createdOrderContractId);
            const orderInSellOrders = exerciseResult.createdOrderContractId && 
              (updatedBook.payload?.sellOrders || []).includes(exerciseResult.createdOrderContractId);
            
            if (orderType === 'BUY') {
              if (updatedBook.payload?.buyOrders?.length === 0) {
                console.error('[Place Order] ❌ CRITICAL: Buy order placed but buyOrders array is empty!');
                console.error('[Place Order] Created order ContractId:', exerciseResult.createdOrderContractId);
                console.error('[Place Order] This suggests MatchOrders filtered out all orders or failed to fetch them');
              } else if (!orderInBuyOrders && exerciseResult.createdOrderContractId) {
                console.error('[Place Order] ❌ CRITICAL: Buy order created but NOT in buyOrders array!');
                console.error('[Place Order] Created order ContractId:', exerciseResult.createdOrderContractId);
                console.error('[Place Order] BuyOrders array:', updatedBook.payload?.buyOrders);
                console.error('[Place Order] This suggests the order was filtered out by MatchOrders');
              } else {
                console.log('[Place Order] ✅ Order appears to be in OrderBook buyOrders array');
                console.log('[Place Order] Buy orders count:', updatedBook.payload?.buyOrders?.length || 0);
              }
            } else if (orderType === 'SELL') {
              if (updatedBook.payload?.sellOrders?.length === 0) {
                console.error('[Place Order] ❌ CRITICAL: Sell order placed but sellOrders array is empty!');
                console.error('[Place Order] Created order ContractId:', exerciseResult.createdOrderContractId);
                console.error('[Place Order] This suggests MatchOrders filtered out all orders or failed to fetch them');
              } else if (!orderInSellOrders && exerciseResult.createdOrderContractId) {
                console.error('[Place Order] ❌ CRITICAL: Sell order created but NOT in sellOrders array!');
                console.error('[Place Order] Created order ContractId:', exerciseResult.createdOrderContractId);
                console.error('[Place Order] SellOrders array:', updatedBook.payload?.sellOrders);
                console.error('[Place Order] This suggests the order was filtered out by MatchOrders');
              } else {
                console.log('[Place Order] ✅ Order appears to be in OrderBook sellOrders array');
                console.log('[Place Order] Sell orders count:', updatedBook.payload?.sellOrders?.length || 0);
              }
            }
          } else {
            console.warn('[Place Order] ⚠️ Could not find updated OrderBook at completion offset');
            console.warn('[Place Order] Available trading pairs:', updatedOrderBooks.map(ob => ob.payload?.tradingPair));
            console.warn('[Place Order] Created order ContractId:', exerciseResult.createdOrderContractId);
          }
        } catch (err) {
          console.error('[Place Order] Error finding updated OrderBook:', err);
        }
      }
      
      // Wait a bit more for everything to propagate
      await new Promise(resolve => setTimeout(resolve, 1500));

      await loadOrders();
      await loadOrderBook(true); // Show loader after placing order
      await loadBalance(); // Refresh balance after order
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

  const handleCancelOrder = async (contractId) => {
    const confirmed = await showModal({
      title: 'Cancel Order',
      message: 'Are you sure you want to cancel this order?',
      type: 'warning',
      showCancel: true,
      confirmText: 'Cancel Order',
      cancelText: 'Keep Order',
    });
    
    if (!confirmed) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Fetch the contract to get templateId for CancelOrder
      const orderContract = await fetchContract(contractId, partyId);
      await exerciseChoice(
        contractId, 
        'CancelOrder', 
        {}, 
        partyId,
        orderContract?.templateId || 'Order:Order'
      );
      await loadOrders();
      await loadOrderBook(true); // Show loader after canceling order
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
        <h2 className="text-3xl font-bold text-[#EAECEF]">Trading Interface</h2>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
          <span className="text-sm text-[#848E9C]">Connected</span>
        </div>
      </div>
      
      {error && (
        <div className="bg-danger-light border border-danger rounded-lg p-4">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Balance Card - Beautiful and Prominent */}
        <div className="card bg-gradient-to-br from-[#1E2329] to-[#181A20] border-2 border-[#2B3139] shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-[#EAECEF] flex items-center space-x-2">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Your Balance</span>
            </h3>
            <button
              onClick={loadBalance}
              disabled={balanceLoading}
              className="p-1.5 hover:bg-[#2B3139] rounded-lg transition-colors"
              title="Refresh balance"
            >
              {balanceLoading ? (
                <svg className="animate-spin h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-4 h-4 text-[#848E9C] hover:text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
            </button>
          </div>
          <div className="space-y-3">
            {/* BTC Balance */}
            <div className="relative overflow-hidden bg-[#1E2329] border-2 border-[#2B3139] rounded-xl p-5 hover:border-[#F0B90B40] hover:shadow-lg transition-all group">
              <div className="absolute top-0 right-0 w-20 h-20 bg-[#F0B90B10] rounded-full blur-2xl"></div>
              <div className="relative flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-[#F0B90B20] rounded-lg flex items-center justify-center border border-[#F0B90B40]">
                    <span className="text-lg font-bold text-primary">₿</span>
                  </div>
                  <div>
                    <div className="text-xs text-[#848E9C] uppercase tracking-wide font-semibold">Bitcoin</div>
                    <div className="text-sm text-[#EAECEF] font-medium">BTC</div>
                  </div>
                </div>
                <div className="text-right">
                  {balanceLoading ? (
                    <div className="flex items-center space-x-2">
                      <div className="animate-pulse bg-[#2B3139] h-6 w-20 rounded"></div>
                    </div>
                  ) : (
                    <div className="text-2xl font-bold text-[#EAECEF] group-hover:text-primary transition-colors">
                      {parseFloat(balance.BTC).toLocaleString(undefined, { 
                        minimumFractionDigits: 2, 
                        maximumFractionDigits: 8 
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* USDT Balance */}
            <div className="relative overflow-hidden bg-[#1E2329] border-2 border-[#2B3139] rounded-xl p-5 hover:border-success/40 hover:shadow-lg transition-all group">
              <div className="absolute top-0 right-0 w-20 h-20 bg-success/10 rounded-full blur-2xl"></div>
              <div className="relative flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-success/20 rounded-lg flex items-center justify-center border border-success/40">
                    <span className="text-lg font-bold text-success">$</span>
                  </div>
                  <div>
                    <div className="text-xs text-[#848E9C] uppercase tracking-wide font-semibold">Tether</div>
                    <div className="text-sm text-[#EAECEF] font-medium">USDT</div>
                  </div>
                </div>
                <div className="text-right">
                  {balanceLoading ? (
                    <div className="flex items-center space-x-2">
                      <div className="animate-pulse bg-[#2B3139] h-6 w-20 rounded"></div>
                    </div>
                  ) : (
                    <div className="text-2xl font-bold text-success group-hover:text-[#26A17B] transition-colors">
                      {parseFloat(balance.USDT).toLocaleString(undefined, { 
                        minimumFractionDigits: 2, 
                        maximumFractionDigits: 2 
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Total Value Estimate */}
          <div className="mt-4 pt-4 border-t border-[#2B3139]">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#848E9C] uppercase tracking-wide font-semibold">Total Value</span>
              <span className="text-sm font-semibold text-[#EAECEF]">
                {balanceLoading ? (
                  <span className="animate-pulse bg-[#2B3139] h-4 w-16 rounded inline-block"></span>
                ) : (
                  `≈ ${parseFloat(balance.USDT).toLocaleString(undefined, { 
                    minimumFractionDigits: 2, 
                    maximumFractionDigits: 2 
                  })} USDT`
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Order Form */}
        <div className="card lg:col-span-2">
          <h3 className="text-lg font-semibold text-[#EAECEF] mb-4">Place Order</h3>
          <form onSubmit={handlePlaceOrder} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#EAECEF] mb-2">Trading Pair</label>
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
                <label className="block text-sm font-medium text-[#EAECEF] mb-2">Order Type</label>
                <div className="flex space-x-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      value="BUY"
                      checked={orderType === 'BUY'}
                      onChange={(e) => setOrderType(e.target.value)}
                      className="w-4 h-4 text-success focus:ring-success"
                    />
                    <span className={`font-medium ${orderType === 'BUY' ? 'text-success' : 'text-[#848E9C]'}`}>Buy</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      value="SELL"
                      checked={orderType === 'SELL'}
                      onChange={(e) => setOrderType(e.target.value)}
                      className="w-4 h-4 text-danger focus:ring-danger"
                    />
                    <span className={`font-medium ${orderType === 'SELL' ? 'text-danger' : 'text-[#848E9C]'}`}>Sell</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#EAECEF] mb-2">Order Mode</label>
                <div className="flex space-x-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      value="LIMIT"
                      checked={orderMode === 'LIMIT'}
                      onChange={(e) => setOrderMode(e.target.value)}
                      className="w-4 h-4 text-primary focus:ring-primary"
                    />
                    <span className="text-[#EAECEF]">Limit</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      value="MARKET"
                      checked={orderMode === 'MARKET'}
                      onChange={(e) => setOrderMode(e.target.value)}
                      className="w-4 h-4 text-primary focus:ring-primary"
                    />
                    <span className="text-[#EAECEF]">Market</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#EAECEF] mb-2">
                  Price {orderMode === 'MARKET' && <span className="text-[#848E9C]">(Market)</span>}
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
              <label className="block text-sm font-medium text-[#EAECEF] mb-2">Quantity</label>
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
              className={`btn w-full py-3 font-semibold ${orderType === 'BUY' ? 'btn-success' : 'btn-danger'}`}
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
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
          <h3 className="text-lg font-semibold text-[#EAECEF]">Order Book - {tradingPair}</h3>
          <div className="flex items-center space-x-2">
            {orderBook.buys.length === 0 && orderBook.sells.length === 0 && !orderBookLoading && (
              <button
                onClick={handleCreateOrderBook}
                disabled={creatingOrderBook}
                className="btn btn-primary btn-sm"
                title="Create OrderBook for this trading pair"
              >
                {creatingOrderBook ? 'Creating...' : 'Create OrderBook'}
              </button>
            )}
            <button
              onClick={() => loadOrderBook(true)} // Show loader when user clicks refresh
              disabled={orderBookLoading}
              className={`text-sm text-primary hover:text-[#F8D12F] transition-colors flex items-center space-x-1 ${orderBookLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              title="Refresh order book"
            >
              <svg className={`w-4 h-4 ${orderBookLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{orderBookLoading ? 'Loading...' : 'Refresh'}</span>
            </button>
          </div>
        </div>
        {orderBookLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-[#2B3139] border-t-primary rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 bg-[#181A20] rounded-full"></div>
              </div>
            </div>
            <p className="mt-4 text-[#848E9C] text-sm font-medium">Loading order book data...</p>
            <p className="mt-1 text-[#848E9C] text-xs">Please wait while we fetch the latest orders</p>
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-semibold text-danger mb-3 uppercase tracking-wide">Sell Orders</h4>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2B3139]">
                    <th className="text-left py-3 px-3 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Price</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Quantity</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orderBook.sells.length > 0 ? (
                    orderBook.sells.map((order, i) => (
                      <tr key={i} className="border-b border-[#2B3139]/50 hover:bg-[#1E2329] transition-colors cursor-pointer">
                        <td className="py-2.5 px-3 text-danger font-mono text-sm font-medium">
                          {order.price !== null ? order.price.toLocaleString() : 'Market'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-[#EAECEF] text-sm">{order.remaining.toFixed(8)}</td>
                        <td className="py-2.5 px-3 text-right text-[#848E9C] text-sm">
                          {order.price !== null ? (order.price * order.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" className="py-8 text-center text-[#848E9C] text-sm">No sell orders</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-success mb-3 uppercase tracking-wide">Buy Orders</h4>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2B3139]">
                    <th className="text-left py-3 px-3 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Price</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Quantity</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orderBook.buys.length > 0 ? (
                    orderBook.buys.map((order, i) => (
                      <tr key={i} className="border-b border-[#2B3139]/50 hover:bg-[#1E2329] transition-colors cursor-pointer">
                        <td className="py-2.5 px-3 text-success font-mono text-sm font-medium">
                          {order.price !== null ? order.price.toLocaleString() : 'Market'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-[#EAECEF] text-sm">{order.remaining.toFixed(8)}</td>
                        <td className="py-2.5 px-3 text-right text-[#848E9C] text-sm">
                          {order.price !== null ? (order.price * order.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" className="py-8 text-center text-[#848E9C] text-sm">No buy orders</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Active Orders */}
      <div className="card">
        <h3 className="text-lg font-semibold text-[#EAECEF] mb-4">Your Active Orders</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2B3139]">
                <th className="text-left py-3 px-4 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">ID</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Type</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Mode</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Price</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Quantity</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Filled</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Status</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-[#848E9C] uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.length > 0 ? (
                orders.map((order) => (
                  <tr key={order.id} className="border-b border-[#2B3139]/50 hover:bg-[#1E2329] transition-colors">
                    <td className="py-3 px-4 text-[#EAECEF] font-mono text-sm">{order.id?.substring(0, 10)}...</td>
                    <td className={`py-3 px-4 font-semibold ${order.type === 'BUY' ? 'text-success' : 'text-danger'}`}>
                      {order.type}
                    </td>
                    <td className="py-3 px-4 text-[#EAECEF]">{order.mode}</td>
                    <td className="py-3 px-4 text-[#EAECEF]">
                      {order.price?.Some ? parseFloat(order.price.Some).toLocaleString() : (order.price === null || order.price === undefined ? 'Market' : 'N/A')}
                    </td>
                    <td className="py-3 px-4 text-right text-[#EAECEF]">{parseFloat(order.quantity || 0).toFixed(8)}</td>
                    <td className="py-3 px-4 text-right text-[#EAECEF]">{parseFloat(order.filled || 0).toFixed(8)}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2.5 py-1 rounded text-xs font-semibold ${
                        order.status === 'OPEN' ? 'bg-[#F0B90B15] text-primary border border-[#F0B90B40]' :
                        order.status === 'FILLED' ? 'bg-success-light text-success border border-success' :
                        'bg-danger-light text-danger border border-danger'
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
                  <td colSpan="8" className="py-8 text-center text-[#848E9C] text-sm">No active orders</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </>
  );
}
