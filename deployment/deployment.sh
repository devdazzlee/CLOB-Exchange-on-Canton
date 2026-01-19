#!/bin/bash

# Complete Deployment Script for CLOB Exchange
# This script builds and deploys the DAML contracts to Canton

set -e  # Exit on error

echo "🚀 CLOB Exchange - Complete Deployment"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ============================================================================
# STEP 1: BUILD DAML CONTRACTS
# ============================================================================

echo -e "${GREEN}Step 1: Building DAML Contracts...${NC}"
cd "$(dirname "$0")/.." || exit 1

if ! command -v daml &> /dev/null; then
  echo -e "${RED}❌ DAML SDK not found. Please install DAML SDK first.${NC}"
  exit 1
fi

echo "   Running: daml build"
if daml build 2>&1 | tee /tmp/daml-build.log; then
  echo -e "${GREEN}✅ DAML build successful!${NC}"
else
  echo -e "${RED}❌ DAML build failed. Check /tmp/daml-build.log for details.${NC}"
  exit 1
fi

# Check if DAR file was created
DAR_FILE=$(find .daml/dist -name "clob-exchange-splice*.dar" | head -n 1)
if [ -z "$DAR_FILE" ]; then
  echo -e "${RED}❌ DAR file not found after build!${NC}"
  exit 1
fi

echo "   DAR file: $DAR_FILE"
echo ""

# ============================================================================
# STEP 2: AUTHENTICATION
# ============================================================================

echo -e "${GREEN}Step 2: Authentication...${NC}"
echo ""
echo "Choose authentication method:"
echo "  1) Password Grant (username/password) - RECOMMENDED"
echo "  2) Use provided token"
echo "  3) Use backend admin service"
echo ""
read -p "Enter choice (1-3): " auth_choice

case $auth_choice in
  1)
    echo ""
    echo "Using Password Grant method..."
    ./upload-dar-password-grant.sh
    ;;
  2)
    echo ""
    read -p "Enter your JWT token: " user_token
    export JWT_TOKEN="$user_token"
    ./upload-dar-with-token.sh
    ;;
  3)
    echo ""
    echo "Using Backend Admin Service..."
    ./upload-dar-via-backend.sh
    ;;
  *)
    echo -e "${RED}Invalid choice. Exiting.${NC}"
    exit 1
    ;;
esac

# ============================================================================
# STEP 3: VERIFY DEPLOYMENT
# ============================================================================

echo ""
echo -e "${GREEN}Step 3: Verifying Deployment...${NC}"

# Get token for verification (reuse from upload or get new one)
if [ -z "$JWT_TOKEN" ]; then
  echo "   Getting token for verification..."
  # Use password grant to get token
  TOKEN_URL="https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/protocol/openid-connect/token"
  response=$(curl -k -s -X POST "$TOKEN_URL" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=password" \
    -d "client_id=account-console" \
    -d "username=zoya" \
    -d "password=Zoya123!" \
    -d "scope=openid profile email daml_ledger_api")
  
  JWT_TOKEN=$(echo "$response" | jq -r '.access_token')
fi

if [ -n "$JWT_TOKEN" ] && [ "$JWT_TOKEN" != "null" ]; then
  echo "   Verifying package deployment..."
  
  # Query for packages (this verifies the upload worked)
  verification_result=$(curl -k -s -X GET \
    "https://participant.dev.canton.wolfedgelabs.com/json-api/v2/packages" \
    -H "Authorization: Bearer ${JWT_TOKEN}" 2>&1)
  
  if echo "$verification_result" | jq -e '.packageIds' > /dev/null 2>&1; then
    package_count=$(echo "$verification_result" | jq '.packageIds | length')
    echo -e "${GREEN}✅ Verification successful!${NC}"
    echo "   Found $package_count package(s) on ledger"
  else
    echo -e "${YELLOW}⚠️  Could not verify packages (this is OK if you don't have read permissions)${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  Could not get token for verification${NC}"
fi

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
echo "======================================"
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo "======================================"
echo ""
echo "Next steps:"
echo "  1. Create MasterOrderBook contracts for trading pairs"
echo "  2. Start the backend: cd backend && npm start"
echo "  3. Start the frontend: cd frontend && npm run dev"
echo "  4. Test order placement in the UI"
echo ""
echo "To create MasterOrderBook contracts, run:"
echo "  cd backend && node scripts/deploymentScript.js"
echo ""
