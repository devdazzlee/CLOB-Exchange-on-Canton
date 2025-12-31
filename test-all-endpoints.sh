#!/bin/bash

echo "Testing all possible endpoint structures..."
echo ""

# Test 1: /v1/query (root)
echo "1. Testing /v1/query..."
curl -s -X POST "https://participant.dev.canton.wolfedgelabs.com/v1/query" \
  -H "Content-Type: application/json" \
  -d '{"templateIds":["UserAccount:UserAccount"]}' | head -3
echo ""
echo ""

# Test 2: /json-api/v1/query
echo "2. Testing /json-api/v1/query..."
curl -s -X POST "https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query" \
  -H "Content-Type: application/json" \
  -d '{"templateIds":["UserAccount:UserAccount"]}' | head -3
echo ""
echo ""

# Test 3: Check if there's a different base path
echo "3. Checking base domain..."
curl -s -I "https://participant.dev.canton.wolfedgelabs.com/" | head -5
echo ""

