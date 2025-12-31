# ⚡ Quick Frontend Test Guide

## 🚀 Start Frontend

```bash
cd frontend
npm run dev
```

Open: **http://localhost:3000**

---

## 📝 Quick Test Steps

### 1. Create Wallet
- Click "Create New Wallet"
- **SAVE** the 12-word seed phrase
- Password: `test123456`
- Confirm password: `test123456`
- Click "Confirm & Create Wallet"

### 2. Place Buy Order
- Trading Pair: **BTC/USDT**
- Click **BUY** (green)
- Order Mode: **LIMIT**
- Price: `42000`
- Quantity: `0.5`
- Click "Place Order"

### 3. Place Sell Order
- Trading Pair: **BTC/USDT**
- Click **SELL** (red)
- Order Mode: **LIMIT**
- Price: `43000`
- Quantity: `0.3`
- Click "Place Order"

### 4. View Order Book
- Check "Order Book" section
- Buy orders (highest price first)
- Sell orders (lowest price first)

### 5. Cancel Order
- Go to "My Orders"
- Click "Cancel" on an order
- Confirm

---

## ✅ Expected Results

- ✅ Wallet created with Party ID displayed
- ✅ Orders appear in order book
- ✅ Orders appear in "My Orders"
- ✅ Order book updates automatically
- ✅ No console errors (F12)

---

## 🐛 Troubleshooting

**"Order book not found":**
- OrderBook needs to be created first
- Contact operator or use API

**CORS errors:**
- Check API endpoint: `https://participant.dev.canton.wolfedgelabs.com/json-api`
- Verify Canton node is accessible

**Balance shows 0.0:**
- Normal if UserAccount doesn't exist yet
- Will be created automatically

---

**Full Guide:** See FRONTEND_TESTING_GUIDE.md
