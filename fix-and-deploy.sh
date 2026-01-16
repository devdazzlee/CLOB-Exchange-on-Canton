#!/bin/bash
set -e

ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njg1NjE0MTcsImlhdCI6MTc2ODU1OTYxNywiYXV0aF90aW1lIjoxNzY4NTU5NjA5LCJqdGkiOiJvbnJ0YWM6MmRkMGExN2QtNjI1MS1jOWViLWJmOTUtYTdjZTA3MDIyZTFhIiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOiJhY2NvdW50Iiwic3ViIjoiODEwMGIyZGItODZjZi00MGExLTgzNTEtNTU0ODNjMTUxY2RjIiwidHlwIjoiQmVhcmVyIiwiYXpwIjoiYWNjb3VudC1jb25zb2xlIiwic2lkIjoiOTJmYzRmYTItZjM0YS00MTA3LTllMTctNzQ3ZjIxMjI5M2ViIiwiYWNyIjoiMCIsInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiXX19LCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJab3lhIE11aGFtbWFkIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiem95YSIsImdpdmVuX25hbWUiOiJab3lhIiwiZmFtaWx5X25hbWUiOiJNdWhhbW1hZCIsImVtYWlsIjoiem95YW11aGFtbWFkOTlAZ21haWwuY29tIn0.pKk-tqXArtR-ZR4BWGXJWaWzc3eHob0Q5c9wBQ_4RLE3Tc0z33aBhOasZwRXLOgRPINikHV5F7DKPVxHEpNOPicNuh-iVCbS_2mdTfTGlaka5xMciYPNV8xUyUjdWN1lTckgGiKkNWrwI09e5oFV9U5iQmaS8ZtJk5tep44CegpaadtKDmO9BuX0U8Mxy4BDrqPNxzlkvIk5huocODcN8KGNAR0O4sIbNkCS4JCbUu5Sq4Vf8ZpK96tNvSw6zlCq-Q5Td7Y7wtLcSGX6mITnaZckj3XwJy5u7xihyRPEHpPH3fR8kI0QSK6OawjfHt0NQiG8ATzRXgOEjwZtIgUzkw"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== Fix and Deploy CLOB Exchange ===${NC}\n"

# Step 1: Build DAR
DAR_FILE=".daml/dist/clob-exchange-1.0.0.dar"
if [ ! -f "$DAR_FILE" ]; then
  echo -e "${YELLOW}Building DAML contracts...${NC}"
  export PATH="$HOME/.daml/bin:$PATH"
  cd daml
  daml build --no-legacy-assistant-warning 2>&1 | grep -v "WARNING\|warning" || true
  cd ..
fi

echo -e "${GREEN}✓ DAR file ready: $DAR_FILE${NC}\n"

# Step 2: Upload DAR using gRPC (ignore duplicate errors - means it's already uploaded)
echo -e "${YELLOW}Step 1: Uploading DAR to Canton...${NC}"

if ! command -v grpcurl &> /dev/null || ! command -v jq &> /dev/null; then
  echo -e "${RED}Error: grpcurl and jq are required${NC}"
  exit 1
fi

# Base64 encode
if [[ "$OSTYPE" == "darwin"* ]]; then
  BASE64_DAR=$(base64 -i "$DAR_FILE" | tr -d '\n')
else
  BASE64_DAR=$(base64 -w 0 "$DAR_FILE")
fi

GRPC_REQUEST=$(jq -n --arg bytes "$BASE64_DAR" '{
  "dars": [{"bytes": $bytes}],
  "vet_all_packages": true,
  "synchronize_vetting": true
}')

echo "Uploading via gRPC..."
UPLOAD_RESULT=$(echo "$GRPC_REQUEST" | grpcurl \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d @ \
  participant.dev.canton.wolfedgelabs.com:443 \
  com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar 2>&1) || true

# Check if upload succeeded or if it's a duplicate (which means it's already uploaded)
if echo "$UPLOAD_RESULT" | grep -q "KNOWN_PACKAGE_VERSION\|duplicate\|already exists"; then
  echo -e "${GREEN}✓ DAR is already uploaded (duplicate detected - this is OK)${NC}\n"
elif echo "$UPLOAD_RESULT" | grep -q "error\|Error\|ERROR" && ! echo "$UPLOAD_RESULT" | grep -q "KNOWN_PACKAGE_VERSION"; then
  echo -e "${YELLOW}⚠ Upload may have issues, but continuing...${NC}"
  echo "$UPLOAD_RESULT" | head -5
  echo ""
else
  echo -e "${GREEN}✓ DAR uploaded successfully${NC}\n"
fi

# Step 3: Wait for Canton to process
echo -e "${YELLOW}Step 2: Waiting for Canton to process...${NC}"
sleep 5

# Step 4: Find the correct package ID by querying for OrderBook template
echo -e "${YELLOW}Step 3: Finding correct package ID...${NC}"

CANTON_API="http://95.216.34.215:31539"

# Try to query for OrderBook template with different methods
echo "Querying Canton for OrderBook template..."

# Method 1: Try filtersForAnyParty
QUERY_RESULT=$(curl -s -X POST \
  "$CANTON_API/v2/state/active-contracts" \
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

# Extract package ID from template ID if found
PACKAGE_ID=$(echo "$QUERY_RESULT" | jq -r '.activeContracts[0].contractEntry.JsActiveContract.createdEvent.templateId // .activeContracts[0].createdEvent.templateId // .activeContracts[0].templateId // empty' 2>/dev/null | cut -d: -f1)

if [ -n "$PACKAGE_ID" ] && [ "$PACKAGE_ID" != "null" ] && [ "$PACKAGE_ID" != "OrderBook" ]; then
  echo -e "${GREEN}✓ Found package ID: $PACKAGE_ID${NC}\n"
  
  # Update backend .env or create a config
  echo "Updating backend configuration..."
  cd backend
  
  # Add package ID to .env if not exists
  if ! grep -q "ORDERBOOK_PACKAGE_ID" .env 2>/dev/null; then
    echo "" >> .env
    echo "# OrderBook Package ID (auto-detected)" >> .env
    echo "ORDERBOOK_PACKAGE_ID=$PACKAGE_ID" >> .env
    echo -e "${GREEN}✓ Added package ID to backend/.env${NC}"
  else
    # Update existing
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/ORDERBOOK_PACKAGE_ID=.*/ORDERBOOK_PACKAGE_ID=$PACKAGE_ID/" .env
    else
      sed -i "s/ORDERBOOK_PACKAGE_ID=.*/ORDERBOOK_PACKAGE_ID=$PACKAGE_ID/" .env
    fi
    echo -e "${GREEN}✓ Updated package ID in backend/.env${NC}"
  fi
else
  echo -e "${YELLOW}⚠ Could not auto-detect package ID, backend will try to find it${NC}\n"
fi

# Step 5: Create OrderBooks
echo -e "${YELLOW}Step 4: Creating OrderBooks...${NC}\n"

# Check if backend is running
if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then
  echo -e "${RED}Error: Backend is not running!${NC}"
  echo "Please start it: cd backend && npm start"
  exit 1
fi

# Run from backend directory
cd backend
npm run init-orderbooks

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}=== ✅ Deployment Complete! ===${NC}\n"
  echo "OrderBooks created successfully!"
  echo ""
  echo "Next steps:"
  echo "1. Frontend: cd frontend && npm run dev"
  echo "2. Visit: http://localhost:5173"
  echo "3. Start trading!"
else
  echo ""
  echo -e "${YELLOW}⚠ OrderBook creation had issues${NC}"
  echo "Check backend logs for details"
  echo "The DAR is uploaded, but package ID detection may need manual adjustment"
fi

