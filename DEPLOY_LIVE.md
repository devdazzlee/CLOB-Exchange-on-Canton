# 🚀 Live Deployment Guide - CLOB Exchange

**Date:** December 31, 2024  
**Canton Node:** participant.dev.canton.wolfedgelabs.com  
**Status:** Ready for Live Deployment

---

## 📋 Pre-Deployment Checklist

- [x] DAML contracts compiled successfully
- [x] DAR file generated: `.daml/dist/clob-exchange-1.0.0.dar`
- [x] Frontend builds successfully
- [x] All tests passing
- [ ] JWT token obtained (if required)
- [ ] Network connectivity verified

---

## 🔧 Configuration

### Canton Endpoints

- **Admin API (gRPC):** `participant.dev.canton.wolfedgelabs.com:443`
- **JSON API:** `https://participant.dev.canton.wolfedgelabs.com/json-api`
- **Protocol:** HTTPS/gRPC

### Demo Wallet/Party ID

```
8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292
```

### Keycloak Credentials

- **URL:** https://keycloak.wolfedgelabs.com:8443
- **Username:** zoya
- **Password:** Zoya123!

---

## 📤 Step 1: Upload DAR File

### Option A: Using Automated Script (Recommended)

```bash
# Set JWT token (if required)
export JWT_TOKEN="your-jwt-token-here"

# Run upload script
./scripts/upload-dar-live.sh
```

### Option B: Using Original Script

```bash
# Edit upload-dars (2).sh and set:
# - DAR_DIRECTORY="./dars"
# - jwt_token="your-token-here"

# Then run:
bash "upload-dars (2).sh"
```

### Option C: Manual Upload

```bash
# 1. Copy DAR to dars directory
mkdir -p dars
cp .daml/dist/clob-exchange-1.0.0.dar dars/

# 2. Set JWT token
export JWT_TOKEN="your-token"

# 3. Run upload script
cd scripts
bash upload-dars.sh
```

---

## ✅ Step 2: Verify Deployment

### Check Contracts Are Deployed

```bash
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "templateIds": ["UserAccount:UserAccount"]
  }'
```

**Expected:** Returns empty array `[]` or list of contracts (not error)

### Test All Contract Types

```bash
# UserAccount
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"templateIds": ["UserAccount:UserAccount"]}'

# Order
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"templateIds": ["Order:Order"]}'

# OrderBook
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"templateIds": ["OrderBook:OrderBook"]}'

# Trade
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"templateIds": ["Trade:Trade"]}'
```

---

## 🎯 Step 3: Deploy Frontend

### Development Mode

```bash
cd frontend
npm install
npm run dev
```

Open: **http://localhost:3000**

### Production Build

```bash
cd frontend
npm run build

# Deploy build folder to your hosting service
# Examples:
# - Netlify: netlify deploy --prod --dir=dist
# - Vercel: vercel --prod
# - Traditional: scp -r dist/* user@server:/var/www/clob-exchange/
```

---

## 🧪 Step 4: Test Live Deployment

### 1. Test Wallet Creation

1. Open frontend
2. Click "Create New Wallet"
3. Enter password
4. Save seed phrase
5. Verify wallet address displayed

### 2. Test Order Placement

1. Navigate to "Place Order"
2. Select trading pair: BTC/USDT
3. Place buy order
4. Verify order appears in order book

### 3. Test Order Book

1. Navigate to "Order Book"
2. Verify orders display correctly
3. Check sorting (buy: highest first, sell: lowest first)

### 4. Test Order Cancellation

1. Go to "My Orders"
2. Cancel an order
3. Verify order removed from book

---

## 🔍 Troubleshooting

### Issue: DAR Upload Fails

**Symptoms:**
- `grpcurl: command not found`
- `401 Unauthorized`
- `Connection refused`

**Solutions:**

```bash
# Install grpcurl
brew install grpcurl  # macOS
apt-get install grpcurl  # Linux

# Check JWT token
echo $JWT_TOKEN

# Verify connectivity
ping participant.dev.canton.wolfedgelabs.com

# Test gRPC connection
grpcurl -plaintext participant.dev.canton.wolfedgelabs.com:443 list
```

### Issue: Frontend Can't Connect

**Symptoms:**
- "Failed to fetch" errors
- CORS errors
- 404 errors

**Solutions:**

1. Verify API endpoint in `.env` files:
   ```
   REACT_APP_CANTON_JSON_API=https://participant.dev.canton.wolfedgelabs.com/json-api
   ```

2. Check browser console (F12) for specific errors

3. Verify Canton node is accessible:
   ```bash
   curl https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"templateIds": []}'
   ```

### Issue: Contracts Not Found

**Symptoms:**
- Empty query results
- "Template not found" errors

**Solutions:**

1. Verify DAR was uploaded successfully
2. Check template IDs match exactly (case-sensitive)
3. Verify party has access to contracts
4. Check Canton participant logs

---

## 📊 Post-Deployment Monitoring

### Key Metrics

- **API Response Times:** < 2 seconds
- **Error Rates:** < 1%
- **Contract Creation:** Monitor rate
- **User Activity:** Track wallets/orders created

### Monitoring Commands

```bash
# Check contract count
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"templateIds": ["UserAccount:UserAccount"]}' | jq '. | length'

# Check order count
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"templateIds": ["Order:Order"]}' | jq '. | length'
```

---

## ✅ Deployment Verification Checklist

- [ ] DAR file uploaded successfully
- [ ] Contracts queryable via JSON API
- [ ] Frontend deployed and accessible
- [ ] Frontend connects to Canton
- [ ] Wallet creation works
- [ ] Order placement works
- [ ] Order book displays correctly
- [ ] Order cancellation works
- [ ] No console errors
- [ ] All features functional

---

## 🎉 Success!

Once all checks pass, your CLOB Exchange is **LIVE** on Canton!

**Next Steps:**
1. Share frontend URL with client
2. Provide testing guide: [TESTING_GUIDE.md](./TESTING_GUIDE.md)
3. Monitor for issues
4. Collect feedback

---

## 📞 Support

**Deployment Issues:**
- Check logs first
- Review this guide
- Contact Canton support if needed

**Frontend Issues:**
- Check browser console
- Review error logs
- Verify API connectivity

---

**Last Updated:** December 31, 2024  
**Status:** ✅ Ready for Live Deployment

