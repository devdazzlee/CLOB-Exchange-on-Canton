#!/bin/bash
set -e

ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njg1NjE0MTcsImlhdCI6MTc2ODU1OTYxNywiYXV0aF90aW1lIjoxNzY4NTU5NjA5LCJqdGkiOiJvbnJ0YWM6MmRkMGExN2QtNjI1MS1jOWViLWJmOTUtYTdjZTA3MDIyZTFhIiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOiJhY2NvdW50Iiwic3ViIjoiODEwMGIyZGItODZjZi00MGExLTgzNTEtNTU0ODNjMTUxY2RjIiwidHlwIjoiQmVhcmVyIiwiYXpwIjoiYWNjb3VudC1jb25zb2xlIiwic2lkIjoiOTJmYzRmYTItZjM0YS00MTA3LTllMTctNzQ3ZjIxMjI5M2ViIiwiYWNyIjoiMCIsInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiXX19LCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJab3lhIE11aGFtbWFkIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiem95YSIsImdpdmVuX25hbWUiOiJab3lhIiwiZmFtaWx5X25hbWUiOiJNdWhhbW1hZCIsImVtYWlsIjoiem95YW11aGFtbWFkOTlAZ21haWwuY29tIn0.pKk-tqXArtR-ZR4BWGXJWaWzc3eHob0Q5c9wBQ_4RLE3Tc0z33aBhOasZwRXLOgRPINikHV5F7DKPVxHEpNOPicNuh-iVCbS_2mdTfTGlaka5xMciYPNV8xUyUjdWN1lTckgGiKkNWrwI09e5oFV9U5iQmaS8ZtJk5tep44CegpaadtKDmO9BuX0U8Mxy4BDrqPNxzlkvIk5huocODcN8KGNAR0O4sIbNkCS4JCbUu5Sq4Vf8ZpK96tNvSw6zlCq-Q5Td7Y7wtLcSGX6mITnaZckj3XwJy5u7xihyRPEHpPH3fR8kI0QSK6OawjfHt0NQiG8ATzRXgOEjwZtIgUzkw"

DAR_FILE=".daml/dist/clob-exchange-1.0.0.dar"

echo "📤 Uploading DAR file to Canton..."
echo "File: $DAR_FILE"
echo ""

# Base64 encode
if [[ "$OSTYPE" == "darwin"* ]]; then
  BASE64_DAR=$(base64 -i "$DAR_FILE" | tr -d '\n')
else
  BASE64_DAR=$(base64 -w 0 "$DAR_FILE")
fi

# Try JSON API endpoint (might not work, but worth trying)
echo "Trying JSON API endpoint..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "https://participant.dev.canton.wolfedgelabs.com/json-api/v1/packages" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"dar\": \"$BASE64_DAR\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 201 ]; then
  echo "✅ Upload successful via JSON API!"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
  exit 0
fi

echo "JSON API returned: $HTTP_CODE"
echo "Trying gRPC method..."

# Use gRPC with timeout
if command -v grpcurl &> /dev/null && command -v jq &> /dev/null; then
  GRPC_REQUEST=$(jq -n --arg bytes "$BASE64_DAR" '{
    "dars": [{"bytes": $bytes}],
    "vet_all_packages": true,
    "synchronize_vetting": true
  }')
  
  echo "$GRPC_REQUEST" | grpcurl \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d @ \
    -max-time 30 \
    participant.dev.canton.wolfedgelabs.com:443 \
    com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar 2>&1
  
  if [ $? -eq 0 ]; then
    echo "✅ Upload successful via gRPC!"
    exit 0
  fi
fi

echo ""
echo "❌ Upload failed. The DAR file needs to be uploaded manually."
echo ""
echo "The DAR file is ready at: $DAR_FILE"
echo ""
echo "Please upload it using one of these methods:"
echo "1. Canton Admin UI (if available)"
echo "2. Contact your Canton administrator"
echo "3. Use the gRPC method with proper network access"
echo ""
echo "After upload, run: cd backend && npm run init-orderbooks"

