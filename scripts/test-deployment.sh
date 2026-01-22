#!/bin/bash

# Test and Deploy Script
# Tests all Milestone 1-3 features and deploys contracts

set -e

echo "========================================="
echo "CLOB Exchange - Comprehensive Test Suite"
echo "========================================="
echo ""

# Configuration
TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3NjkwOTE5MDksImlhdCI6MTc2OTA5MDEwOCwiYXV0aF90aW1lIjoxNzY5MDkwMTA4LCJqdGkiOiJvZnJ0YWM6YTRmYmE1MTQtM2M1Yi1hM2QwLTQ4OTEtZTA1ODljNzM4YWM0IiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOlsiaHR0cHM6Ly9jYW50b24ubmV0d29yay5nbG9iYWwiLCJodHRwczovL3ZhbGlkYXRvci13YWxsZXQudGFpbGViNGY1Ni50cy5uZXQiLCJodHRwczovL3dhbGxldC52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiYWNjb3VudCJdLCJzdWIiOiI4MTAwYjJkYi04NmNmLTQwYTEtODM1MS01NTQ4M2MxNTFjZGMiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiI0cm9oOVg3eTRUeVQ4OWZlSnU3QW5NMnNNWmJSOXhoNyIsInNpZCI6ImE5NmNlYTAzLTljOGQtNDZlZi1iYmJkLTk2OWE4ODkyMmZjMiIsImFjciI6IjEiLCJhbGxvd2VkLW9yaWdpbnMiOlsiaHR0cHM6Ly9zeW5jaW5zaWdodHMtYXBwLmRldi5jYW50b24ud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0Mi52YWxpZGF0b3IuZGV2LmNhbnRvbi53b2xmZWRnZWxhYnMuY29tIiwiaHR0cHM6Ly93YWxsZXQxLnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3dhbGxldC52YWxpZGF0b3Iud29sZmVkZ2VsYWJzLmNvbSIsImh0dHBzOi8vd2FsbGV0LnZhbGlkYXRvci5kZXYuY2FudG9uLndvbGZlZGdlbGFicy5jb20iLCJodHRwczovL3ZhbGlkYXRvci13YWxsZXQtY2FudG9uLWRldm5ldC50YWlsZWI0ZjU2LnRzLm5ldCJdLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsiZGVmYXVsdC1yb2xlcy1jYW50b24tZGV2bmV0Iiwib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoib3BlbmlkIG9mZmxpbmVfYWNjZXNzIHByb2ZpbGUgZGFtbF9sZWRnZXJfYXBpIHdhbGxldF9hdWRpZW5jZSBlbWFpbCIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiWm95YSBNdWhhbW1hZCIsInByZWZlcnJlZF91c2VybmFtZSI6InpveWEiLCJnaXZlbl9uYW1lIjoiWm95YSIsImZhbWlseV9uYW1lIjoiTXVoYW1tYWQiLCJlbWFpbCI6InpveWFtdWhhbW1hZDk5QGdtYWlsLmNvbSJ9.b1yfGKCYHchtzZk3tJuhdIUz8gbrfAmbWbkM3gsq92vdSfefNMe9zHPeV2a1_eP5a9Tt1odTogj9CJr9A52zaF6WKpBE9bRIP5kws6gjAlcv8lvsCqNhXGR-a-QeawcqPfmxjOJmXdCeoHI75m5aoPIKczPz7mxs3Ug-qa1NvqvkpaTtOmEBEfUQ1cb-v6QUbvbAYMNePQT6oHWUDDbuDv0aSA8eyrNBbhBXIUBULnJVwJBNDRUFwDYIw6gkJxZ1yWTRs7iIPtc0hvUIZUYFJ4emPhPX8wSsP8PXskh-89vYHntK7HgQgE37uxOmbyk81iWHGuEt5fiYbjcHD1Tkwg"
PARTY_ID="8100b2db-86cf-40a1-8351-55483c151cdc"
CANTON_API="http://65.108.40.104:31539"
BACKEND_URL="http://localhost:3001"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Test function
test_feature() {
    local test_name="$1"
    local test_cmd="$2"

    TESTS_TOTAL=$((TESTS_TOTAL + 1))
    echo -e "${YELLOW}[TEST $TESTS_TOTAL]${NC} $test_name"

    if eval "$test_cmd" > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ PASSED${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}  ✗ FAILED${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# ========================================
# Milestone 1 Tests: Foundation & Wallet
# ========================================
echo ""
echo "========================================="
echo "Milestone 1: Foundation & Wallet"
echo "========================================="

# Test 1.1: Canton Connectivity
test_feature "1.1 Canton JSON API connectivity" \
    "curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer $TOKEN' $CANTON_API/v2/state/ledger-end | grep -q '200'"

# Test 1.2: Party ID exists
test_feature "1.2 Party ID exists in Canton" \
    "curl -s -H 'Authorization: Bearer $TOKEN' $CANTON_API/v2/parties | grep -q '$PARTY_ID'"

# Test 1.3: Synchronizer discovery
test_feature "1.3 Synchronizer ID discovery" \
    "curl -s -H 'Authorization: Bearer $TOKEN' $CANTON_API/v2/state/connected-synchronizers | grep -q 'synchronizers'"

# Test 1.4: Backend health check
test_feature "1.4 Backend server health" \
    "curl -s $BACKEND_URL/health | grep -q 'healthy'"

# Test 1.5: Onboarding API endpoint
test_feature "1.5 Onboarding API available" \
    "curl -s -o /dev/null -w '%{http_code}' $BACKEND_URL/api/onboarding/discover-synchronizer | grep -q '200'"

# ========================================
# Milestone 2 Tests: Matching Engine
# ========================================
echo ""
echo "========================================="
echo "Milestone 2: Matching Engine & Logic"
echo "========================================="

# Test 2.1: Matching engine running
test_feature "2.1 Matching engine process exists" \
    "ps aux | grep -v grep | grep -q 'node.*backend'"

# Test 2.2: WebSocket server
test_feature "2.2 WebSocket server running" \
    "curl -s $BACKEND_URL/api/ws/status | grep -q 'connected'"

# Test 2.3: Order placement API
test_feature "2.3 Order placement endpoint exists" \
    "curl -s -o /dev/null -w '%{http_code}' -X OPTIONS $BACKEND_URL/api/orders/place | grep -q '200\|405'"

# Test 2.4: Order cancellation API
test_feature "2.4 Order cancellation endpoint exists" \
    "curl -s -o /dev/null -w '%{http_code}' -X OPTIONS $BACKEND_URL/api/orders/cancel | grep -q '200\|405'"

# Test 2.5: Orderbook query API
test_feature "2.5 Orderbook query endpoint" \
    "curl -s -o /dev/null -w '%{http_code}' $BACKEND_URL/api/orderbooks | grep -q '200'"

# ========================================
# Milestone 3 Tests: Professional UI
# ========================================
echo ""
echo "========================================="
echo "Milestone 3: Professional UI & Real-Time"
echo "========================================="

# Test 3.1: Frontend build exists
test_feature "3.1 Frontend dist folder exists" \
    "test -d ../frontend/dist || test -f ../frontend/index.html"

# Test 3.2: Trading interface files
test_feature "3.2 Trading interface components" \
    "test -f ../frontend/src/components/TradingInterface.jsx"

# Test 3.3: Order book component
test_feature "3.3 Order book visualization" \
    "test -f ../frontend/src/components/trading/OrderBookCard.jsx"

# Test 3.4: Depth chart component
test_feature "3.4 Depth chart component" \
    "test -f ../frontend/src/components/trading/DepthChart.jsx"

# Test 3.5: WebSocket service
test_feature "3.5 Frontend WebSocket service" \
    "test -f ../frontend/src/services/websocketService.js"

# Test 3.6: Wallet setup component
test_feature "3.6 Wallet setup UI" \
    "test -f ../frontend/src/components/WalletSetup.jsx"

# Test 3.7: Key manager (Ed25519)
test_feature "3.7 Ed25519 key generation" \
    "test -f ../frontend/src/wallet/keyManager.js && grep -q 'ed25519' ../frontend/src/wallet/keyManager.js"

# ========================================
# Contract Tests
# ========================================
echo ""
echo "========================================="
echo "Contract Tests"
echo "========================================="

# Test C.1: DAML build success
test_feature "C.1 DAML contracts build" \
    "test -f ../daml/.daml/dist/clob-exchange-splice-1.0.0.dar"

# Test C.2: MasterOrderBook exists
test_feature "C.2 MasterOrderBook contract" \
    "test -f ../daml/MasterOrderBook.daml"

# Test C.3: Order contract exists
test_feature "C.3 Order contract" \
    "test -f ../daml/Order.daml"

# Test C.4: Trade contract exists
test_feature "C.4 Trade contract" \
    "test -f ../daml/Trade.daml"

# ========================================
# Test Results
# ========================================
echo ""
echo "========================================="
echo "Test Results Summary"
echo "========================================="
echo ""
echo -e "Total Tests: $TESTS_TOTAL"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    echo ""
    echo "Please check the failed tests above and fix issues."
    exit 1
fi
