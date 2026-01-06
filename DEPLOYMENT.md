# CLOB Exchange - Production Deployment Guide

**Last Updated:** December 31, 2024  
**Environment:** Canton Devnet  
**Participant Node:** participant.dev.canton.wolfedgelabs.com

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Deployment Steps](#deployment-steps)
3. [Post-Deployment Verification](#post-deployment-verification)
4. [Rollback Procedure](#rollback-procedure)
5. [Monitoring](#monitoring)

---

## Pre-Deployment Checklist

### Code Quality
- [ ] All DAML tests passing (`daml test --all`)
- [ ] Frontend builds without errors (`npm run build`)
- [ ] No console errors in development
- [ ] Code reviewed and approved

### DAML Contracts
- [ ] Contracts compile successfully
- [ ] DAR file generated: `.daml/dist/clob-exchange-1.0.0.dar`
- [ ] All templates verified:
  - [ ] UserAccount
  - [ ] Order
  - [ ] OrderBook
  - [ ] Trade

### Frontend
- [ ] Production build successful
- [ ] Environment variables configured
- [ ] API endpoints correct
- [ ] Error handling implemented

### Infrastructure
- [ ] Canton node accessible
- [ ] JWT token obtained (if required)
- [ ] Keycloak credentials available
- [ ] Network access verified

---

## Deployment Steps

### Step 1: Build Production Package

```bash
# Run production build script
./scripts/build-production.sh
```

**Expected Output:**
```
✓ DAML contracts built
✓ Frontend built
✓ Deployment package created
```

**Verify:**
- DAR file exists: `.daml/dist/clob-exchange-1.0.0.dar`
- Frontend build exists: `frontend/dist/` or `frontend/build/`

---

### Step 2: Upload DAML Contracts to Canton

#### Option A: Using Upload Script (Recommended)

```bash
# Set JWT token if required
export JWT_TOKEN="your-jwt-token-here"

# Upload DAR file
./scripts/upload-dar.sh
```

#### Option B: Manual Upload

```bash
# Copy DAR to dars directory
mkdir -p scripts/dars
cp .daml/dist/clob-exchange-1.0.0.dar scripts/dars/

# Update upload-dars script with JWT token
# Edit scripts/upload-dars.sh and set jwt_token variable

# Run upload script
cd scripts
bash upload-dars.sh
```

**Verify Upload:**
```bash
# Query contracts to verify deployment
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"templateIds": ["UserAccount:UserAccount"]}'
```

**Expected:** Returns empty array `[]` or list of contracts (not error)

---

### Step 3: Deploy Frontend

#### Option A: Static Hosting (Netlify, Vercel, etc.)

```bash
# Build for production
cd frontend
npm run build

# Deploy build folder to hosting service
# Example for Netlify:
netlify deploy --prod --dir=dist
```

#### Option B: Traditional Web Server

```bash
# Copy build files to web server
scp -r frontend/dist/* user@server:/var/www/clob-exchange/

# Or use rsync
rsync -avz frontend/dist/ user@server:/var/www/clob-exchange/
```

#### Option C: Docker Container

```dockerfile
# Create Dockerfile
FROM nginx:alpine
COPY frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

```bash
# Build and run
docker build -t clob-exchange .
docker run -p 80:80 clob-exchange
```

---

### Step 4: Configure Environment Variables

Create production environment file or set in hosting platform:

```bash
REACT_APP_CANTON_NODE=participant.dev.canton.wolfedgelabs.com
REACT_APP_CANTON_JSON_API=https://participant.dev.canton.wolfedgelabs.com/json-api
REACT_APP_CANTON_ADMIN_API=https://participant.dev.canton.wolfedgelabs.com
REACT_APP_ENVIRONMENT=production
```

**For Vercel/Netlify:**
- Set environment variables in dashboard
- Redeploy after setting variables

---

### Step 5: Seed Initial Data (Optional)

```bash
# Run demo data seeding script
node scripts/seed-demo-data.js
```

This creates:
- Demo user accounts
- Sample orders
- Order books for trading pairs

---

## Post-Deployment Verification

### 1. Verify DAML Contracts

```bash
# Test contract creation
curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/create \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "UserAccount:UserAccount",
    "payload": {
      "party": "party::test",
      "balances": [["USDT", 1000.0]],
      "operator": "party::test"
    },
    "actAs": ["party::test"]
  }'
```

### 2. Verify Frontend

1. Open deployed URL
2. Check browser console (F12) for errors
3. Test wallet creation
4. Test order placement
5. Verify API calls succeed

### 3. End-to-End Test

Follow [TESTING_GUIDE.md](./TESTING_GUIDE.md) test scenarios:
- [ ] Wallet creation works
- [ ] Order placement works
- [ ] Order book displays
- [ ] Order cancellation works

---

## Rollback Procedure

### Rollback DAML Contracts

If new contracts cause issues:

1. **Stop new contract creation:**
   - Disable frontend temporarily
   - Or add feature flag

2. **Revert to previous DAR:**
   ```bash
   # Upload previous DAR version
   ./scripts/upload-dar.sh .daml/dist/clob-exchange-0.9.0.dar
   ```

3. **Verify rollback:**
   ```bash
   # Check contract versions
   curl -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"templateIds": ["UserAccount:UserAccount"]}'
   ```

### Rollback Frontend

1. **Revert to previous build:**
   ```bash
   # Deploy previous build
   netlify deploy --prod --dir=previous-build/
   ```

2. **Or use hosting platform rollback:**
   - Netlify: Deploys → Select previous deploy → Publish
   - Vercel: Deployments → Select previous → Promote to Production

---

## Monitoring

### Key Metrics to Monitor

1. **API Response Times**
   - Create contract: < 2 seconds
   - Query contracts: < 1 second
   - Exercise choice: < 2 seconds

2. **Error Rates**
   - API errors: < 1%
   - Frontend errors: < 0.5%

3. **User Activity**
   - Wallets created per day
   - Orders placed per day
   - Active users

### Monitoring Tools

**Browser Console:**
- Check for JavaScript errors
- Monitor API call failures
- Track performance metrics

**Canton Node:**
- Check participant logs
- Monitor contract creation rate
- Watch for errors

**Application Logs:**
- Frontend error tracking (Sentry, LogRocket)
- API error logs
- User activity logs

---

## Troubleshooting

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

# Verify network connectivity
ping participant.dev.canton.wolfedgelabs.com
```

### Issue: Frontend Can't Connect to Canton

**Symptoms:**
- "Failed to fetch" errors
- CORS errors
- 404 errors

**Solutions:**
1. Verify API endpoint: `https://participant.dev.canton.wolfedgelabs.com/json-api`
2. Check CORS settings on Canton node
3. Verify environment variables are set
4. Check browser console for specific errors

### Issue: Contracts Not Found

**Symptoms:**
- Empty query results
- "Template not found" errors

**Solutions:**
1. Verify DAR was uploaded successfully
2. Check template IDs match exactly
3. Verify party has access to contracts
4. Check Canton participant logs

---

## Security Checklist

- [ ] JWT tokens stored securely (not in code)
- [ ] Environment variables not exposed
- [ ] HTTPS enabled for frontend
- [ ] CORS properly configured
- [ ] Input validation on all forms
- [ ] Error messages don't expose sensitive info
- [ ] Private keys encrypted in localStorage
- [ ] Seed phrases never logged

---

## Support Contacts

**Deployment Issues:**
- Check logs first
- Review this guide
- Contact development team

**Canton Node Issues:**
- Contact Canton support
- Check participant status

**Frontend Issues:**
- Check browser console
- Review error logs
- Contact hosting provider

---

## Deployment Checklist Summary

### Pre-Deployment
- [ ] Code tested and approved
- [ ] DAML contracts compiled
- [ ] Frontend built successfully
- [ ] Environment configured

### Deployment
- [ ] DAR file uploaded to Canton
- [ ] Frontend deployed to hosting
- [ ] Environment variables set
- [ ] Initial data seeded (optional)

### Post-Deployment
- [ ] Contracts verified
- [ ] Frontend tested
- [ ] E2E tests passed
- [ ] Monitoring enabled

### Sign-Off
- [ ] Deployment successful
- [ ] All tests passing
- [ ] Ready for production use

---

**Deployment Date:** _______________  
**Deployed By:** _______________  
**Version:** 1.0.0  
**Status:** ☐ Success ☐ Failed

---

**Last Updated:** December 31, 2024




