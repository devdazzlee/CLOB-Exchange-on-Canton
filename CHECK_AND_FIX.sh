#!/bin/bash

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     COMPREHENSIVE CHECK & FIX SCRIPT                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check 1: DAR File
echo "1️⃣  Checking DAR file..."
if [ -f ".daml/dist/clob-exchange-1.0.0.dar" ]; then
    SIZE=$(ls -lh .daml/dist/clob-exchange-1.0.0.dar | awk '{print $5}')
    echo "   ✅ DAR file exists: .daml/dist/clob-exchange-1.0.0.dar ($SIZE)"
    DAR_EXISTS=true
elif [ -f "dars/clob-exchange-1.0.0.dar" ]; then
    SIZE=$(ls -lh dars/clob-exchange-1.0.0.dar | awk '{print $5}')
    echo "   ✅ DAR file exists: dars/clob-exchange-1.0.0.dar ($SIZE)"
    DAR_EXISTS=true
else
    echo "   ❌ DAR file not found"
    echo "   → Need to build: cd daml && daml build"
    DAR_EXISTS=false
fi
echo ""

# Check 2: API Endpoint
echo "2️⃣  Testing API endpoint..."
API_RESPONSE=$(curl -s -X POST "https://participant.dev.canton.wolfedgelabs.com/json-api/v1/query" \
  -H "Content-Type: application/json" \
  -d '{"templateIds":["UserAccount:UserAccount"]}')
if echo "$API_RESPONSE" | grep -q "errors"; then
    echo "   ❌ API returns error:"
    echo "   $API_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "   $API_RESPONSE"
else
    echo "   ✅ API responds successfully"
    echo "   Response: $API_RESPONSE"
fi
echo ""

# Check 3: Deployment Scripts
echo "3️⃣  Checking deployment scripts..."
if [ -f "scripts/upload-dar-live.sh" ]; then
    echo "   ✅ Deployment script exists: scripts/upload-dar-live.sh"
elif [ -f "upload-dars (2).sh" ]; then
    echo "   ✅ Upload script exists: upload-dars (2).sh"
else
    echo "   ❌ No deployment script found"
fi
echo ""

# Summary
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     SUMMARY & RECOMMENDATIONS                               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

if [ "$DAR_EXISTS" = true ]; then
    echo "✅ DAR file ready for deployment"
    echo ""
    echo "To deploy contracts:"
    echo "  1. Set JWT token (if required):"
    echo "     export JWT_TOKEN=\"your-token\""
    echo ""
    echo "  2. Run deployment:"
    if [ -f "scripts/upload-dar-live.sh" ]; then
        echo "     ./scripts/upload-dar-live.sh"
    else
        echo "     mkdir -p dars"
        echo "     cp .daml/dist/clob-exchange-1.0.0.dar dars/"
        echo "     bash \"upload-dars (2).sh\""
    fi
else
    echo "❌ Need to build DAR file first:"
    echo "  cd daml && daml build"
fi

echo ""
echo "⚠️  API Endpoint Issue:"
echo "  The 404 error with double slash suggests server-side configuration."
echo "  This may resolve after contracts are deployed."
echo ""

