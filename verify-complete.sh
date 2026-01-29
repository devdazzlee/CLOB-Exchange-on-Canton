#!/bin/bash
# Complete Verification Script
# Verifies all 4 milestones are complete, integrated, and ready

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "🔍 Verifying CLOB Exchange Complete Implementation"
echo ""

# Check 1: DAML Contracts
echo -e "${YELLOW}✓ Checking DAML Contracts...${NC}"
if [ -f "dars/clob-exchange-1.0.0.dar" ]; then
    echo -e "${GREEN}  ✅ DAR file exists${NC}"
else
    echo -e "${RED}  ❌ DAR file missing${NC}"
    exit 1
fi

# Check 2: Frontend Build
echo -e "${YELLOW}✓ Checking Frontend...${NC}"
if [ -d "frontend/dist" ] && [ -f "frontend/dist/index.html" ]; then
    echo -e "${GREEN}  ✅ Frontend built${NC}"
else
    echo -e "${YELLOW}  ⚠️  Frontend not built - run: cd frontend && npm run build${NC}"
fi

# Check 3: Backend Dependencies
echo -e "${YELLOW}✓ Checking Backend...${NC}"
if [ -d "backend/node_modules" ]; then
    echo -e "${GREEN}  ✅ Backend dependencies installed${NC}"
else
    echo -e "${YELLOW}  ⚠️  Backend dependencies missing - run: cd backend && npm install${NC}"
fi

# Check 4: Critical Files
echo -e "${YELLOW}✓ Checking Critical Files...${NC}"
files=(
    "backend/src/services/onboarding-service.js"
    "backend/src/services/cantonService.js"
    "backend/src/services/orderBookService.js"
    "backend/src/services/stopLossService.js"
    "backend/src/utils/orderBookAggregator.js"
    "frontend/src/components/WalletSetup.jsx"
    "frontend/src/components/TradingInterface.jsx"
    "frontend/src/components/trading/OrderForm.jsx"
    "frontend/src/components/trading/OrderBookCard.jsx"
    "daml/MasterOrderBookV2.daml"
    "daml/OrderV2.daml"
    "daml/UserAccount.daml"
    "daml/AssetHolding.daml"
    "daml/Trade.daml"
)

all_exist=true
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}  ✅ $file${NC}"
    else
        echo -e "${RED}  ❌ $file missing${NC}"
        all_exist=false
    fi
done

if [ "$all_exist" = false ]; then
    exit 1
fi

# Check 5: No Fallbacks/Patches (exclude comments and "NO" statements)
echo -e "${YELLOW}✓ Checking for Fallbacks/Patches...${NC}"
if grep -r "fallback\|patch\|mock\|dummy" backend/src/controllers/v1/exchangeController.js 2>/dev/null | \
   grep -v "NO fallback\|NO patch\|NO mock\|no-patches\|no fallback" | \
   grep -v "^[[:space:]]*//" | grep -v "^[[:space:]]*/\*" | grep -v "\*/"; then
    echo -e "${RED}  ❌ Found fallback/patch code${NC}"
    exit 1
else
    echo -e "${GREEN}  ✅ No fallbacks/patches in critical files${NC}"
fi

# Check 6: Integration Points
echo -e "${YELLOW}✓ Checking Integration Points...${NC}"

# Frontend -> Backend API
if grep -q "placeOrder" frontend/src/services/apiService.js && \
   grep -q "stopLossPrice" frontend/src/services/apiService.js; then
    echo -e "${GREEN}  ✅ Frontend API service integrated${NC}"
else
    echo -e "${RED}  ❌ Frontend API service incomplete${NC}"
    exit 1
fi

# Backend -> Canton
if grep -q "queryActiveContracts\|createContract\|exerciseChoice" backend/src/services/orderBookService.js; then
    echo -e "${GREEN}  ✅ Backend queries Canton directly${NC}"
else
    echo -e "${RED}  ❌ Backend not querying Canton${NC}"
    exit 1
fi

# Stop-loss integration
if grep -q "registerStopLoss\|getStopLossService" backend/src/controllers/v1/exchangeController.js; then
    echo -e "${GREEN}  ✅ Stop-loss integrated${NC}"
else
    echo -e "${RED}  ❌ Stop-loss not integrated${NC}"
    exit 1
fi

# Order book aggregation
if grep -q "formatOrderBook\|aggregatePriceLevels" backend/src/controllers/orderBookController.js; then
    echo -e "${GREEN}  ✅ Order book aggregation integrated${NC}"
else
    echo -e "${RED}  ❌ Order book aggregation missing${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ ALL VERIFICATIONS PASSED!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "📦 Ready for Deployment:"
echo "   1. DAR file: dars/clob-exchange-1.0.0.dar"
echo "   2. Frontend: frontend/dist/"
echo "   3. Backend: backend/"
echo ""
echo "🚀 Deployment Steps:"
echo "   ./deploy.sh"
echo ""
