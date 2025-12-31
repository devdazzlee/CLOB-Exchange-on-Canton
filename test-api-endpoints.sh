#!/bin/bash

echo "Testing different API endpoint structures..."
echo ""

# Test 1: /json-api/v1/query
echo "1. Testing /json-api/v1/query..."
curl -s -X POST "https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query" \
  -H "Content-Type: application/json" \
  -d '{"templateIds":["UserAccount:UserAccount"]}' | head -3
echo ""
echo ""

# Test 2: /v1/query (without /json-api)
echo "2. Testing /v1/query..."
curl -s -X POST "https://participant.dev.canton.wolfedgelabs.com/v1/query" \
  -H "Content-Type: application/json" \
  -d '{"templateIds":["UserAccount:UserAccount"]}' | head -3
echo ""
echo ""

# Test 3: /json-api/query (without /v1)
echo "3. Testing /json-api/query..."
curl -s -X POST "https://participant.dev.canton.wolfedgelabs.com/json-api/query" \
  -H "Content-Type: application/json" \
  -d '{"templateIds":["UserAccount:UserAccount"]}' | head -3
echo ""

