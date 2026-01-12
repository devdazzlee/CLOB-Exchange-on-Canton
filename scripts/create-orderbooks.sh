#!/bin/bash

# Script to create OrderBooks for testing
# This uses the backend admin API endpoint

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"

echo "🌱 Creating OrderBooks for testing..."
echo "Backend URL: $BACKEND_URL"
echo ""

# Trading pairs to create
TRADING_PAIRS=("BTC/USDT" "ETH/USDT" "SOL/USDT")

SUCCESS_COUNT=0
FAIL_COUNT=0

for pair in "${TRADING_PAIRS[@]}"; do
  echo "Creating OrderBook for $pair..."
  
  # URL encode the trading pair
  encoded_pair=$(echo -n "$pair" | jq -sRr @uri)
  
  response=$(curl -s -w "\n%{http_code}" -X POST "$BACKEND_URL/api/admin/orderbooks/$encoded_pair" \
    -H "Content-Type: application/json")
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
    echo "✅ Created OrderBook for $pair"
    contract_id=$(echo "$body" | jq -r '.contractId // "N/A"')
    echo "   Contract ID: $contract_id"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  elif [ "$http_code" -eq 409 ]; then
    echo "⚠️  OrderBook for $pair already exists"
    contract_id=$(echo "$body" | jq -r '.contractId // "N/A"')
    echo "   Contract ID: $contract_id"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    echo "❌ Failed to create OrderBook for $pair"
    echo "   HTTP $http_code: $(echo "$body" | jq -r '.error // .message // "Unknown error"')"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  
  echo ""
  sleep 0.5
done

echo "=========================================="
echo "Summary:"
echo "  ✅ Created/Exists: $SUCCESS_COUNT"
echo "  ❌ Failed: $FAIL_COUNT"
echo "=========================================="

if [ $SUCCESS_COUNT -eq ${#TRADING_PAIRS[@]} ]; then
  echo ""
  echo "🎉 All OrderBooks are ready!"
  echo "You can now test the trading interface."
  exit 0
else
  echo ""
  echo "⚠️  Some OrderBooks failed to create. Check errors above."
  exit 1
fi

