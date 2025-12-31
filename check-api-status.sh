#!/bin/bash

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     CHECKING CANTON API STATUS                               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check 1: API Base Endpoint
echo "1️⃣  Checking API base endpoint..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "https://participant.dev.canton.wolfedgelabs.com/json-api")
if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "404" ] || [ "$RESPONSE" = "405" ]; then
    echo "   ✅ API endpoint is reachable (HTTP $RESPONSE)"
else
    echo "   ❌ API endpoint not reachable (HTTP $RESPONSE)"
fi
echo ""

# Check 2: Query endpoint without auth
echo "2️⃣  Testing query endpoint (no auth)..."
QUERY_RESPONSE=$(curl -s -X POST "https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query" \
  -H "Content-Type: application/json" \
  -d '{"templateIds":[]}')
echo "   Response: $QUERY_RESPONSE"
echo ""

# Check 3: Check if DAR files exist
echo "3️⃣  Checking DAR files..."
if [ -f "daml/.daml/dist/clob-exchange-1.0.0.dar" ]; then
    DAR_SIZE=$(ls -lh daml/.daml/dist/clob-exchange-1.0.0.dar | awk '{print $5}')
    echo "   ✅ DAR file exists: clob-exchange-1.0.0.dar ($DAR_SIZE)"
else
    echo "   ❌ DAR file not found"
fi
echo ""

# Check 4: Check deployment status
echo "4️⃣  Checking deployment scripts..."
if [ -f "scripts/upload-dar-live.sh" ]; then
    echo "   ✅ Deployment script exists"
else
    echo "   ❌ Deployment script not found"
fi
if [ -f "upload-dars (2).sh" ]; then
    echo "   ✅ Original upload script exists"
fi
echo ""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     SUMMARY                                                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
