import axios from 'axios';

// Base API URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

// API Routes
export const API_ROUTES = {
  // Auth
  AUTH: {
    SESSION: '/auth/session',
    REFRESH: '/auth/refresh',
    LOGOUT: '/auth/logout',
    ME: '/auth/me',
    LOGIN: '/auth/login',
  },
  
  // Wallet & Onboarding
  WALLET: {
    CREATE: '/v1/wallets/create',
    ALLOCATE: '/v1/wallets/allocate',
    INFO: (walletId) => `/v1/wallets/${encodeURIComponent(walletId)}`,
  },
  
  // Balance (Legacy UserAccount-based)
  BALANCE: {
    GET: (partyId) => `/balance/${encodeURIComponent(partyId)}`,
    MINT: '/balance/mint',
    EXTERNAL: (walletId) => `/balance/external-wallet-${walletId}`,
  },
  
  // Balance V2 (New Holding-based Token Standard)
  BALANCE_V2: {
    GET: (partyId) => `/balance/v2/${encodeURIComponent(partyId)}`,
    MINT: '/balance/v2/mint',
    HOLDINGS: (partyId, symbol) => {
      const base = `/balance/v2/holdings/${encodeURIComponent(partyId)}`;
      return symbol ? `${base}?symbol=${encodeURIComponent(symbol)}` : base;
    },
    LOCK: '/balance/v2/lock',
    UNLOCK: '/balance/v2/unlock',
  },
  
  // Instruments (Token Types)
  INSTRUMENTS: {
    GET_ALL: '/instruments',
    GET: (symbol) => `/instruments/${encodeURIComponent(symbol)}`,
    CREATE: '/instruments',
  },
  
  // Trading Pairs
  TRADING_PAIRS: {
    GET_ALL: '/trading-pairs',
    GET: (pairId) => `/trading-pairs/${encodeURIComponent(pairId)}`,
  },
  
  // Settlements (DvP)
  SETTLEMENTS: {
    PENDING: '/settlements/pending',
    EXECUTE: (settlementId) => `/settlements/${encodeURIComponent(settlementId)}/execute`,
    CANCEL: (settlementId) => `/settlements/${encodeURIComponent(settlementId)}/cancel`,
  },
  
  // Orders (Legacy)
  ORDERS: {
    PLACE: '/orders/place',
    GET_USER: (partyId, status) => {
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      return `/orders/user/${encodeURIComponent(partyId)}${params.toString() ? `?${params.toString()}` : ''}`;
    },
    CANCEL: (contractId) => `/orders/${encodeURIComponent(contractId)}/cancel`,
    GET_ALL: (params = {}) => {
      const queryString = new URLSearchParams(params).toString();
      return `/v1/orders${queryString ? `?${queryString}` : ''}`;
    },
  },
  
  // Orders V2 (Token Standard - Holdings + OrderV3)
  ORDERS_V2: {
    PLACE: '/orders/v2',
    GET: (partyId, status) => {
      const params = new URLSearchParams();
      if (partyId) params.append('partyId', partyId);
      if (status) params.append('status', status);
      return `/orders/v2${params.toString() ? `?${params.toString()}` : ''}`;
    },
    CANCEL: (contractId, partyId) => {
      const params = new URLSearchParams();
      if (partyId) params.append('partyId', partyId);
      return `/orders/v2/${encodeURIComponent(contractId)}${params.toString() ? `?${params.toString()}` : ''}`;
    },
    ORDERBOOK: (pair) => `/orders/v2/orderbook/${encodeURIComponent(pair)}`,
  },
  
  // Order Book
  ORDERBOOK: {
    GET: (pair) => `/orderbooks/${encodeURIComponent(pair)}`,
    GET_AGGREGATE: (pair, precision = 2, depth = 50) => 
      `/orderbooks/${encodeURIComponent(pair)}?aggregate=true&precision=${precision}&depth=${depth}`,
    GET_ALL: '/orderbooks',
    TRADES: (pair, limit = 50) => 
      `/orderbooks/${encodeURIComponent(pair)}/trades?limit=${limit}`,
  },
  
  // Trades (Legacy)
  TRADES: {
    GET: (pair, limit = 50) => 
      `/trades/${encodeURIComponent(pair)}?limit=${limit}`,
    GET_USER: (partyId, limit = 500) => 
      `/trades/user/${encodeURIComponent(partyId)}?limit=${limit}`,
    GET_ALL: (params = {}) => {
      const queryString = new URLSearchParams(params).toString();
      return `/v1/trades${queryString ? `?${queryString}` : ''}`;
    },
  },
  
  // Trades V2 (Token Standard - DvP Settlements)
  TRADES_V2: {
    GET: (pair, limit = 50) => {
      const params = new URLSearchParams();
      if (pair) params.append('pair', pair);
      params.append('limit', limit);
      return `/trades/v2?${params.toString()}`;
    },
    GET_USER: (partyId, limit = 50) => 
      `/trades/v2/user/${encodeURIComponent(partyId)}?limit=${limit}`,
    PENDING_SETTLEMENTS: '/trades/v2/pending-settlements',
  },
  
  // Admin
  ADMIN: {
    ORDERBOOKS: '/admin/orderbooks',
    ORDERBOOK_CREATE: (pair) => `/admin/orderbooks/${encodeURIComponent(pair)}`,
  },
  
  // Tickers
  TICKERS: '/v1/tickers',
};

// Create axios instance with base configuration
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for adding auth tokens
apiClient.interceptors.request.use(
  (config) => {
    // Try to get auth token from localStorage or session
    const token = localStorage.getItem('accessToken') || 
                  localStorage.getItem('canton_session_token');
    
    if (token) {
      config.headers.Authorization = token.startsWith('Bearer ') 
        ? token 
        : `Bearer ${token}`;
    }
    
    // Add party ID header if available
    const partyId = localStorage.getItem('partyId') || 
                    localStorage.getItem('canton_party_id');
    if (partyId) {
      config.headers['x-party-id'] = partyId;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for handling errors
apiClient.interceptors.response.use(
  (response) => {
    return response.data || response;
  },
  (error) => {
    // Handle 401 - Session expired
    if (error.response?.status === 401) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('canton_session_token');
      localStorage.removeItem('canton_wallet_id');
      localStorage.removeItem('partyId');
      localStorage.removeItem('canton_party_id');
      
      // Redirect to wallet unlock if not already there
      if (!window.location.pathname.includes('/wallet')) {
        window.location.href = '/wallet';
      }
      
      return Promise.reject(new Error('Session expired. Please unlock your wallet again.'));
    }
    
    // Handle other errors
    const errorMessage = error.response?.data?.error?.message || 
                        error.response?.data?.error || 
                        error.message || 
                        'An unexpected error occurred';
    
    return Promise.reject(new Error(errorMessage));
  }
);

// Export base URL for direct use if needed
export { API_BASE_URL };

// Default export
export default {
  API_BASE_URL,
  API_ROUTES,
  apiClient,
};
