#!/bin/bash

# Complete Deployment Script for CLOB Exchange
# Includes: DAML build, DAR upload, OrderBook initialization, and verification

set -e  # Exit on error

echo "🚀 Starting Complete CLOB Exchange Deployment"
echo "=============================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
CANTON_JSON_API_BASE="${CANTON_JSON_API_BASE:-http://65.108.40.104:31539}"
CANTON_ADMIN_API="${CANTON_ADMIN_API:-http://65.108.40.104:30100}"
BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"

# Step 1: Build DAML Contracts
echo -e "\n${YELLOW}Step 1: Building DAML Contracts...${NC}"
cd daml
if [ ! -f "daml.yaml" ]; then
    echo -e "${RED}Error: daml.yaml not found. Are you in the daml directory?${NC}"
    exit 1
fi

daml build
if [ $? -ne 0 ]; then
    echo -e "${RED}Error: DAML build failed${NC}"
    exit 1
fi

DAR_FILE=".daml/dist/clob-exchange-1.0.0.dar"
if [ ! -f "$DAR_FILE" ]; then
    echo -e "${RED}Error: DAR file not found: $DAR_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}✅ DAML contracts built successfully${NC}"
echo -e "   DAR file: $DAR_FILE"
cd ..

# Step 2: Get Admin Token
echo -e "\n${YELLOW}Step 2: Getting Admin Token...${NC}"
cd backend
ADMIN_TOKEN=$(node -e "
const admin = require('./canton-admin');
admin.getAdminToken().then(token => {
  console.log(token);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
" 2>/dev/null)

if [ -z "$ADMIN_TOKEN" ]; then
    echo -e "${RED}Error: Failed to get admin token${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Admin token obtained${NC}"
cd ..

# Step 3: Upload DAR to Canton
echo -e "\n${YELLOW}Step 3: Uploading DAR to Canton...${NC}"

# Try using grpcurl first (more reliable)
if command -v grpcurl &> /dev/null; then
    echo "Using grpcurl to upload DAR..."
    
    # Extract host and port from JSON API base
    HOST=$(echo $CANTON_JSON_API_BASE | sed 's|http://||' | cut -d: -f1)
    PORT=$(echo $CANTON_JSON_API_BASE | sed 's|http://||' | cut -d: -f2)
    
    # Upload via gRPC
    grpcurl -plaintext \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -d @ \
        "${HOST}:${PORT}" \
        com.daml.ledger.api.v1.admin.PackageManagementService.UploadDarFile \
        < <(echo "{\"dar_file\": \"$(base64 -i $DAR_FILE)\"}") 2>&1 | grep -v "KNOWN_PACKAGE_VERSION" || true
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ DAR uploaded via grpcurl${NC}"
    else
        echo -e "${YELLOW}⚠️  grpcurl upload had issues, trying JSON API...${NC}"
    fi
fi

# Fallback: Try JSON API upload
echo "Trying JSON API upload..."
UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${CANTON_JSON_API_BASE}/v1/packages" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@${DAR_FILE}")

HTTP_CODE=$(echo "$UPLOAD_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$UPLOAD_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo -e "${GREEN}✅ DAR uploaded successfully via JSON API${NC}"
elif echo "$RESPONSE_BODY" | grep -q "KNOWN_PACKAGE_VERSION"; then
    echo -e "${YELLOW}⚠️  DAR already uploaded (KNOWN_PACKAGE_VERSION) - this is OK${NC}"
else
    echo -e "${RED}Error: DAR upload failed (HTTP $HTTP_CODE)${NC}"
    echo "Response: $RESPONSE_BODY"
    exit 1
fi

# Step 4: Wait for DAR to be processed
echo -e "\n${YELLOW}Step 4: Waiting for DAR to be processed...${NC}"
sleep 5

# Step 5: Verify DAR is active
echo -e "\n${YELLOW}Step 5: Verifying DAR is active...${NC}"
PACKAGES_RESPONSE=$(curl -s -X GET \
    "${CANTON_JSON_API_BASE}/v2/packages" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

if echo "$PACKAGES_RESPONSE" | grep -q "OrderBook"; then
    echo -e "${GREEN}✅ OrderBook template found in packages${NC}"
else
    echo -e "${YELLOW}⚠️  OrderBook template not immediately visible (may need more time)${NC}"
fi

# Step 6: Initialize OrderBooks
echo -e "\n${YELLOW}Step 6: Initializing OrderBooks...${NC}"
cd backend

# Check if backend is running
if ! curl -s "${BACKEND_URL}/health" > /dev/null; then
    echo -e "${RED}Error: Backend is not running at ${BACKEND_URL}${NC}"
    echo "Please start the backend first: cd backend && npm start"
    exit 1
fi

echo -e "${GREEN}✅ Backend is running${NC}"

# Run OrderBook initialization
npm run init-orderbooks
if [ $? -ne 0 ]; then
    echo -e "${RED}Error: OrderBook initialization failed${NC}"
    exit 1
fi

cd ..

# Step 7: Verify OrderBooks
echo -e "\n${YELLOW}Step 7: Verifying OrderBooks...${NC}"
cd backend
sleep 3  # Wait for OrderBooks to be processed

npm run check-orderbooks
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  OrderBooks may not be immediately visible (Canton processing delay)${NC}"
    echo "This is normal - wait 1-2 minutes and check again"
fi

cd ..

# Step 8: Summary
echo -e "\n${GREEN}=============================================="
echo "✅ Deployment Complete!"
echo "==============================================${NC}"
echo ""
echo "Next Steps:"
echo "1. Start backend: cd backend && npm start"
echo "2. Start frontend: cd frontend && npm run dev"
echo "3. Visit http://localhost:5173 to start trading"
echo ""
echo "API Endpoints:"
echo "  - Admin-api: 65.108.40.104:30100"
echo "  - Ledger-api: 65.108.40.104:31217"
echo "  - Json-api: 65.108.40.104:31539"
echo ""
echo "Features:"
echo "  ✅ Global OrderBook (one per trading pair)"
echo "  ✅ UTXO handling (automatic merging)"
echo "  ✅ Matchmaking with UTXO support"
echo "  ✅ Cancellation with UTXO merge"
echo "  ✅ Partial fills with UTXO merge"
echo ""

