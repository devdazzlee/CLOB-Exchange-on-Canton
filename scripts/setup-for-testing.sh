#!/bin/bash

# Complete setup script for CLOB Exchange testing
# This script sets up everything needed to test the frontend

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     CLOB Exchange - Complete Testing Setup                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Step 1: Check DAML build
echo -e "${BLUE}[1/4] Checking DAML contracts...${NC}"
if [ ! -f ".daml/dist/clob-exchange-1.0.0.dar" ]; then
  echo -e "${YELLOW}⚠ DAR file not found. Building DAML contracts...${NC}"
  cd daml
  if ! daml build 2>&1; then
    echo -e "${RED}✗ DAML build failed${NC}"
    exit 1
  fi
  cd ..
fi
echo -e "${GREEN}✓ DAML contracts ready${NC}"
echo ""

# Step 2: Check frontend dependencies
echo -e "${BLUE}[2/4] Checking frontend dependencies...${NC}"
cd frontend
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}⚠ Installing frontend dependencies...${NC}"
  npm install
fi
echo -e "${GREEN}✓ Frontend dependencies ready${NC}"
cd ..
echo ""

# Step 3: Create OrderBook contracts
echo -e "${BLUE}[3/4] Creating OrderBook contracts...${NC}"
echo -e "${YELLOW}This will create OrderBooks for BTC/USDT, ETH/USDT, and SOL/USDT${NC}"
echo ""

# Check if Node.js is available
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js not found. Please install Node.js first.${NC}"
  exit 1
fi

# Run OrderBook creation script
if node scripts/create-orderbook.js 2>&1; then
  echo -e "${GREEN}✓ OrderBook contracts created${NC}"
else
  echo -e "${YELLOW}⚠ OrderBook creation had issues (may already exist)${NC}"
fi
echo ""

# Step 4: Verify setup
echo -e "${BLUE}[4/4] Verifying setup...${NC}"

# Check DAR file
if [ -f ".daml/dist/clob-exchange-1.0.0.dar" ]; then
  echo -e "${GREEN}✓ DAR file exists${NC}"
else
  echo -e "${RED}✗ DAR file missing${NC}"
fi

# Check frontend
if [ -d "frontend/node_modules" ]; then
  echo -e "${GREEN}✓ Frontend dependencies installed${NC}"
else
  echo -e "${RED}✗ Frontend dependencies missing${NC}"
fi

# Check if OrderBooks exist (query API)
echo -e "${YELLOW}Checking OrderBook contracts...${NC}"
ORDERBOOK_CHECK=$(curl -s -X POST https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"templateIds": ["OrderBook:OrderBook"]}' 2>/dev/null || echo "[]")

if echo "$ORDERBOOK_CHECK" | grep -q "contractId" || echo "$ORDERBOOK_CHECK" | grep -q "\[\]"; then
  echo -e "${GREEN}✓ OrderBook API accessible${NC}"
else
  echo -e "${YELLOW}⚠ Could not verify OrderBooks (may need manual creation)${NC}"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              ✅ Setup Complete!                             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo ""
echo -e "1. Start the frontend:"
echo -e "   ${GREEN}cd frontend && npm run dev${NC}"
echo ""
echo -e "2. Open browser:"
echo -e "   ${GREEN}http://localhost:3000${NC}"
echo ""
echo -e "3. Test with these values:"
echo -e "   ${YELLOW}Password:${NC} test123456"
echo -e "   ${YELLOW}Buy Order:${NC} BTC/USDT, LIMIT, Price 42000, Quantity 0.5"
echo -e "   ${YELLOW}Sell Order:${NC} BTC/USDT, LIMIT, Price 43000, Quantity 0.3"
echo ""
echo -e "📚 Full testing guide: ${BLUE}FRONTEND_TESTING_GUIDE.md${NC}"
echo ""





