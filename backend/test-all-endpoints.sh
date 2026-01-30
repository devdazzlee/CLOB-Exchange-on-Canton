#!/bin/bash

# CLOB Exchange API Test Script
# Tests all endpoints with real calls

BASE_URL="http://localhost:3001"
PARTY_ID="external-wallet-user-test-$(date +%s)::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           CLOB Exchange API Test Suite                         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TOTAL=0
PASSED=0
FAILED=0

test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local expected_status=$4
    local description=$5
    
    TOTAL=$((TOTAL + 1))
    echo -n "Testing: $description... "
    
    if [ "$method" == "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "$BASE_URL$endpoint" -H "x-user-id: $PARTY_ID")
    else
        response=$(curl -s -w "\n%{http_code}" -X $method "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -H "x-user-id: $PARTY_ID" \
            -d "$data")
    fi
    
    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" == "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $status_code)"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (Expected: $expected_status, Got: $status_code)"
        echo "  Response: $(echo $body | head -c 200)"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

echo "═══════════════════════════════════════════════════════════════"
echo "1. HEALTH & STATUS ENDPOINTS"
echo "═══════════════════════════════════════════════════════════════"

test_endpoint "GET" "/health" "" "200" "Health check"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "2. ORDER BOOK ENDPOINTS (Global - Public)"
echo "═══════════════════════════════════════════════════════════════"

test_endpoint "GET" "/api/orderbooks" "" "200" "Get all order books"
test_endpoint "GET" "/api/orderbooks/BTC%2FUSDT" "" "200" "Get BTC/USDT order book"
test_endpoint "GET" "/api/orderbooks/BTC%2FUSDT?aggregate=true&precision=2&depth=50" "" "200" "Get aggregated order book"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "3. BALANCE ENDPOINTS"
echo "═══════════════════════════════════════════════════════════════"

test_endpoint "GET" "/api/balance/$PARTY_ID" "" "200" "Get user balance"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "4. ORDER ENDPOINTS (Place Order)"
echo "═══════════════════════════════════════════════════════════════"

# Place a LIMIT BUY order
ORDER_DATA='{
    "tradingPair": "BTC/USDT",
    "orderType": "BUY",
    "orderMode": "LIMIT",
    "price": "50000",
    "quantity": "0.01",
    "partyId": "'$PARTY_ID'"
}'
test_endpoint "POST" "/api/orders/place" "$ORDER_DATA" "201" "Place LIMIT BUY order"

# Store the order ID for later
ORDER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/orders/place" \
    -H "Content-Type: application/json" \
    -H "x-user-id: $PARTY_ID" \
    -d "$ORDER_DATA")
ORDER_ID=$(echo $ORDER_RESPONSE | grep -o '"orderId":"[^"]*"' | cut -d'"' -f4)
CONTRACT_ID=$(echo $ORDER_RESPONSE | grep -o '"contractId":"[^"]*"' | cut -d'"' -f4)
echo "  📝 Order ID: $ORDER_ID"
echo "  📝 Contract ID: ${CONTRACT_ID:0:40}..."

# Place a LIMIT SELL order
SELL_ORDER_DATA='{
    "tradingPair": "BTC/USDT",
    "orderType": "SELL",
    "orderMode": "LIMIT",
    "price": "51000",
    "quantity": "0.01",
    "partyId": "'$PARTY_ID'"
}'
test_endpoint "POST" "/api/orders/place" "$SELL_ORDER_DATA" "201" "Place LIMIT SELL order"

# Place a MARKET order
MARKET_ORDER_DATA='{
    "tradingPair": "BTC/USDT",
    "orderType": "BUY",
    "orderMode": "MARKET",
    "quantity": "0.001",
    "partyId": "'$PARTY_ID'"
}'
test_endpoint "POST" "/api/orders/place" "$MARKET_ORDER_DATA" "201" "Place MARKET BUY order"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "5. USER ORDERS ENDPOINTS"
echo "═══════════════════════════════════════════════════════════════"

test_endpoint "GET" "/api/orders/user/$PARTY_ID" "" "200" "Get user orders"
test_endpoint "GET" "/api/orders/user/$PARTY_ID?status=OPEN&limit=10" "" "200" "Get open orders with limit"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "6. CANCEL ORDER ENDPOINT"
echo "═══════════════════════════════════════════════════════════════"

if [ -n "$CONTRACT_ID" ]; then
    CANCEL_DATA='{
        "orderContractId": "'$CONTRACT_ID'",
        "partyId": "'$PARTY_ID'",
        "tradingPair": "BTC/USDT"
    }'
    test_endpoint "POST" "/api/orders/cancel" "$CANCEL_DATA" "200" "Cancel order"
else
    echo -e "${YELLOW}⚠ Skipped: No order to cancel${NC}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "7. TRADES ENDPOINTS"
echo "═══════════════════════════════════════════════════════════════"

test_endpoint "GET" "/api/trades/BTC%2FUSDT" "" "200" "Get BTC/USDT trades"
test_endpoint "GET" "/api/trades/user/$PARTY_ID?limit=500" "" "200" "Get user trades"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "8. v1 API ENDPOINTS (Public)"
echo "═══════════════════════════════════════════════════════════════"

test_endpoint "GET" "/api/v1/orderbook/BTC%2FUSDT" "" "200" "v1 Get orderbook"
test_endpoint "GET" "/api/v1/trades" "" "200" "v1 Get all trades"
test_endpoint "GET" "/api/v1/trades?pair=BTC/USDT&limit=50" "" "200" "v1 Get trades for pair"
test_endpoint "GET" "/api/v1/tickers" "" "200" "v1 Get market tickers"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "9. WALLET ENDPOINTS"
echo "═══════════════════════════════════════════════════════════════"

test_endpoint "POST" "/api/wallet/create" '{"displayName":"TestWallet"}' "200" "Create wallet (step 1)"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "10. TESTNET ENDPOINTS"
echo "═══════════════════════════════════════════════════════════════"

test_endpoint "GET" "/api/testnet/balances/$PARTY_ID" "" "200" "Get testnet balances"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                      TEST SUMMARY"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo -e "Total Tests: $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED!${NC}"
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                 FRONTEND INTEGRATION"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "The frontend uses these endpoints:"
echo ""
echo "📊 Order Book:   GET /api/orderbooks/:pair"
echo "💰 Balance:      GET /api/balance/:partyId"  
echo "📝 Place Order:  POST /api/orders/place"
echo "❌ Cancel Order: POST /api/orders/cancel"
echo "📜 User Orders:  GET /api/orders/user/:partyId"
echo "📈 Trades:       GET /api/trades/:pair"
echo "🔌 WebSocket:    ws://localhost:3001/ws"
echo ""
echo "To test in browser:"
echo "1. Open http://localhost:5173"
echo "2. Create a wallet (top right)"
echo "3. Place orders using the order form"
echo "4. Watch the order book update in real-time"
echo ""
