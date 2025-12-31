# ✅ READY FOR TESTING

## Configuration Complete

### ✅ API Endpoints Updated
- Changed from v1 to v2 API
- Using correct endpoints per Canton documentation:
  - `/v2/state/active-contracts` for queries
  - `/v2/commands/submit-and-wait` for create/exercise

### ✅ Authentication Configured
- JWT token setup complete
- Token automatically included in all API requests
- Supports both environment variable and localStorage

### ✅ Proxy Configuration
- Vite proxy correctly routes `/api/canton` to `/json-api`
- Handles CORS issues in development

---

## 🚀 START TESTING

### 1. Start Frontend
```bash
cd frontend
yarn dev
```

### 2. Open Browser
Navigate to: http://localhost:3000

### 3. Test Flow

#### Step 1: Create Wallet
1. Click "Create New Wallet"
2. Enter password (min 8 characters)
3. Save the 12-word seed phrase
4. Click "Confirm & Create Wallet"
5. ✅ Should see wallet address

#### Step 2: Check Balances
1. After wallet creation, balances should load
2. ✅ Should see USDT, BTC, ETH balances (may be 0 initially)

#### Step 3: Place Order
1. Go to "Place Order" tab
2. Select trading pair: BTC/USDT
3. Click "BUY" or "SELL"
4. Enter Price: 42000
5. Enter Quantity: 0.5
6. Click "Place Order"
7. ✅ Should see success message

#### Step 4: View Order Book
1. Go to "Order Book" tab
2. ✅ Should see your order listed
3. Buy orders sorted highest first
4. Sell orders sorted lowest first

#### Step 5: View My Orders
1. Go to "My Orders" tab
2. ✅ Should see your placed order
3. Status should be "Open"

#### Step 6: Cancel Order
1. In "My Orders", click "Cancel" on an order
2. Confirm cancellation
3. ✅ Order should disappear from both "My Orders" and "Order Book"

---

## 🔍 Troubleshooting

### If you see 401 Unauthorized:
- Check that `frontend/.env` exists with `VITE_CANTON_JWT_TOKEN`
- Restart frontend after creating `.env` file
- Or set token in browser console: `localStorage.setItem('canton_jwt_token', 'your-token')`

### If you see 404 Not Found:
- Verify frontend is running on port 3000
- Check browser console for exact error
- Verify proxy is working (check terminal logs)

### If orders don't appear:
- Check browser console for errors
- Verify contracts are deployed to Canton
- Check that OrderBook contract exists for the trading pair

---

## ✅ Success Criteria

- [ ] Wallet creates successfully
- [ ] Balances load (even if 0)
- [ ] Orders can be placed
- [ ] Orders appear in order book
- [ ] Orders appear in "My Orders"
- [ ] Orders can be cancelled
- [ ] No console errors

---

## 📝 Notes

- All API calls now use Canton JSON Ledger API v2
- Authentication is handled automatically
- Proxy handles CORS in development
- Production will use direct API calls with authentication

