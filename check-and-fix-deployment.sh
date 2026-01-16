#!/bin/bash
set -e

ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njg1NjE0MTcsImlhdCI6MTc2ODU1OTYxNywiYXV0aF90aW1lIjoxNzY4NTU5NjA5LCJqdGkiOiJvbnJ0YWM6MmRkMGExN2QtNjI1MS1jOWViLWJmOTUtYTdjZTA3MDIyZTFhIiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOiJhY2NvdW50Iiwic3ViIjoiODEwMGIyZGItODZjZi00MGExLTgzNTEtNTU0ODNjMTUxY2RjIiwidHlwIjoiQmVhcmVyIiwiYXpwIjoiYWNjb3VudC1jb25zb2xlIiwic2lkIjoiOTJmYzRmYTItZjM0YS00MTA3LTllMTctNzQ3ZjIxMjI5M2ViIiwiYWNyIjoiMCIsInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiXX19LCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJab3lhIE11aGFtbWFkIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiem95YSIsImdpdmVuX25hbWUiOiJab3lhIiwiZmFtaWx5X25hbWUiOiJNdWhhbW1hZCIsImVtYWlsIjoiem95YW11aGFtbWFkOTlAZ21haWwuY29tIn0.pKk-tqXArtR-ZR4BWGXJWaWzc3eHob0Q5c9wBQ_4RLE3Tc0z33aBhOasZwRXLOgRPINikHV5F7DKPVxHEpNOPicNuh-iVCbS_2mdTfTGlaka5xMciYPNV8xUyUjdWN1lTckgGiKkNWrwI09e5oFV9U5iQmaS8ZtJk5tep44CegpaadtKDmO9BuX0U8Mxy4BDrqPNxzlkvIk5huocODcN8KGNAR0O4sIbNkCS4JCbUu5Sq4Vf8ZpK96tNvSw6zlCq-Q5Td7Y7wtLcSGX6mITnaZckj3XwJy5u7xihyRPEHpPH3fR8kI0QSK6OawjfHt0NQiG8ATzRXgOEjwZtIgUzkw"

echo "🔍 Checking Canton packages..."

# Check packages via JSON API
PACKAGES=$(curl -s -X GET \
  "http://95.216.34.215:31539/v2/packages" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json")

echo "Packages response:"
echo "$PACKAGES" | jq '.' 2>/dev/null || echo "$PACKAGES"
echo ""

# Try to query for OrderBook template
echo "🔍 Checking if OrderBook template exists..."
ORDERBOOK_QUERY=$(curl -s -X POST \
  "http://95.216.34.215:31539/v2/state/active-contracts" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "activeAtOffset": "0",
    "filter": {
      "filtersForAnyParty": {
        "inclusive": {
          "templateIds": ["OrderBook:OrderBook"]
        }
      }
    }
  }')

echo "OrderBook query response:"
echo "$ORDERBOOK_QUERY" | jq '.' 2>/dev/null || echo "$ORDERBOOK_QUERY"
echo ""

# The issue might be that the backend is using a hardcoded package ID
# Let's check what package IDs are available and update the backend
echo "📝 Summary:"
echo "The DAR appears to be uploaded (duplicate error suggests it exists)"
echo "But the backend might be using the wrong package ID"
echo ""
echo "Next steps:"
echo "1. The backend needs to dynamically find the correct package ID"
echo "2. Or we need to update the backend to use the package ID from the packages list"
echo ""
echo "For now, let's try creating OrderBooks - the backend should auto-detect the package ID"

