#!/bin/bash

# Test Production API Endpoints on Vercel
# Usage: ./test-production-apis.sh <your-vercel-url>

set -e

VERCEL_URL="${1:-https://clob-exchange-on-canton.vercel.app}"

echo "🧪 Testing Production APIs on Vercel"
echo "URL: $VERCEL_URL"
echo ""

# Test 1: Test endpoint
echo "1️⃣ Testing /api/test endpoint..."
TEST_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$VERCEL_URL/api/test" || echo "HTTP_STATUS:000")
HTTP_STATUS=$(echo "$TEST_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$TEST_RESPONSE" | sed '/HTTP_STATUS/d')

if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Test endpoint works!"
    echo "Response: $BODY"
else
    echo "❌ Test endpoint failed (HTTP $HTTP_STATUS)"
    echo "Response: $BODY"
fi
echo ""

# Test 2: Canton API proxy endpoint
echo "2️⃣ Testing /api/canton/v2/packages endpoint..."
CANTON_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
    -X POST "$VERCEL_URL/api/canton/v2/packages" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE" \
    -d '{}' || echo "HTTP_STATUS:000")
CANTON_STATUS=$(echo "$CANTON_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
CANTON_BODY=$(echo "$CANTON_RESPONSE" | sed '/HTTP_STATUS/d')

if [ "$CANTON_STATUS" = "200" ] || [ "$CANTON_STATUS" = "401" ]; then
    echo "✅ Canton API proxy is working! (Status: $CANTON_STATUS)"
    echo "Note: 401 means auth needed, but proxy is working"
    echo "Response preview: $(echo "$CANTON_BODY" | head -c 200)"
else
    echo "❌ Canton API proxy failed (HTTP $CANTON_STATUS)"
    echo "Response: $CANTON_BODY"
fi
echo ""

# Test 3: OPTIONS preflight
echo "3️⃣ Testing OPTIONS preflight..."
OPTIONS_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
    -X OPTIONS "$VERCEL_URL/api/canton/v2/packages" \
    -H "Origin: $VERCEL_URL" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type,Authorization" || echo "HTTP_STATUS:000")
OPTIONS_STATUS=$(echo "$OPTIONS_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$OPTIONS_STATUS" = "200" ]; then
    echo "✅ OPTIONS preflight works!"
else
    echo "❌ OPTIONS preflight failed (HTTP $OPTIONS_STATUS)"
fi
echo ""

# Summary
echo "📊 Summary:"
echo "============"
if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Serverless functions are working"
else
    echo "❌ Serverless functions NOT detected (404 errors)"
    echo "   → Check Vercel Dashboard → Functions tab"
    echo "   → Verify Root Directory is set to 'frontend'"
    echo "   → Check deployment logs"
fi

if [ "$CANTON_STATUS" = "200" ] || [ "$CANTON_STATUS" = "401" ]; then
    echo "✅ Canton API proxy is working"
else
    echo "❌ Canton API proxy has issues"
fi

echo ""
echo "💡 To check function logs:"
echo "   Vercel Dashboard → Your Project → Functions → /api/canton/[...path]"


