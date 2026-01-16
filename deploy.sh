#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Access token (update this with your token)
ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJDdjhRQVpEa3pYTlVvSXdNTnpZQWxBSmlBWlUtbmlvelV4VG96R0I4eXM0In0.eyJleHAiOjE3Njg1NjE0MTcsImlhdCI6MTc2ODU1OTYxNywiYXV0aF90aW1lIjoxNzY4NTU5NjA5LCJqdGkiOiJvbnJ0YWM6MmRkMGExN2QtNjI1MS1jOWViLWJmOTUtYTdjZTA3MDIyZTFhIiwiaXNzIjoiaHR0cHM6Ly9rZXljbG9hay53b2xmZWRnZWxhYnMuY29tOjg0NDMvcmVhbG1zL2NhbnRvbi1kZXZuZXQiLCJhdWQiOiJhY2NvdW50Iiwic3ViIjoiODEwMGIyZGItODZjZi00MGExLTgzNTEtNTU0ODNjMTUxY2RjIiwidHlwIjoiQmVhcmVyIiwiYXpwIjoiYWNjb3VudC1jb25zb2xlIiwic2lkIjoiOTJmYzRmYTItZjM0YS00MTA3LTllMTctNzQ3ZjIxMjI5M2ViIiwiYWNyIjoiMCIsInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiXX19LCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJab3lhIE11aGFtbWFkIiwicHJlZmVycmVkX3VzZXJuYW1lIjoiem95YSIsImdpdmVuX25hbWUiOiJab3lhIiwiZmFtaWx5X25hbWUiOiJNdWhhbW1hZCIsImVtYWlsIjoiem95YW11aGFtbWFkOTlAZ21haWwuY29tIn0.pKk-tqXArtR-ZR4BWGXJWaWzc3eHob0Q5c9wBQ_4RLE3Tc0z33aBhOasZwRXLOgRPINikHV5F7DKPVxHEpNOPicNuh-iVCbS_2mdTfTGlaka5xMciYPNV8xUyUjdWN1lTckgGiKkNWrwI09e5oFV9U5iQmaS8ZtJk5tep44CegpaadtKDmO9BuX0U8Mxy4BDrqPNxzlkvIk5huocODcN8KGNAR0O4sIbNkCS4JCbUu5Sq4Vf8ZpK96tNvSw6zlCq-Q5Td7Y7wtLcSGX6mITnaZckj3XwJy5u7xihyRPEHpPH3fR8kI0QSK6OawjfHt0NQiG8ATzRXgOEjwZtIgUzkw"

echo -e "${GREEN}=== CLOB Exchange Deployment Script ===${NC}\n"

# Step 1: Build DAML contracts
echo -e "${YELLOW}Step 1: Building DAML contracts...${NC}"
export PATH="$HOME/.daml/bin:$PATH"

if ! command -v daml &> /dev/null; then
  echo -e "${RED}Error: DAML SDK not found. Please install DAML SDK first.${NC}"
  exit 1
fi

cd daml
daml build --no-legacy-assistant-warning 2>&1 | grep -v "WARNING\|warning" || true
cd ..

DAR_FILE=".daml/dist/clob-exchange-1.0.0.dar"

if [ ! -f "$DAR_FILE" ]; then
  echo -e "${RED}Error: DAR file not found at $DAR_FILE${NC}"
  exit 1
fi

echo -e "${GREEN}✓ DAR file built: $DAR_FILE${NC}\n"

# Step 2: Upload DAR to Canton
echo -e "${YELLOW}Step 2: Uploading DAR to Canton...${NC}"

# Check if grpcurl is installed
if ! command -v grpcurl &> /dev/null; then
  echo -e "${RED}Error: grpcurl is not installed${NC}"
  echo "Install with: brew install grpcurl (macOS)"
  exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
  echo -e "${RED}Error: jq is not installed${NC}"
  echo "Install with: brew install jq (macOS)"
  exit 1
fi

# Base64 encode DAR file
if [[ "$OSTYPE" == "darwin"* ]]; then
  BASE64_DAR=$(base64 -i "$DAR_FILE" | tr -d '\n')
else
  BASE64_DAR=$(base64 -w 0 "$DAR_FILE")
fi

# Prepare gRPC request
GRPC_REQUEST=$(jq -n \
  --arg bytes "$BASE64_DAR" \
  '{
    "dars": [{
      "bytes": $bytes
    }],
    "vet_all_packages": true,
    "synchronize_vetting": true
  }')

PARTICIPANT_HOST="participant.dev.canton.wolfedgelabs.com"
CANTON_ADMIN_GRPC_PORT=443

echo "Uploading to: ${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}"

# Upload DAR using gRPC
RESPONSE=$(echo "$GRPC_REQUEST" | grpcurl \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -d @ \
  "${PARTICIPANT_HOST}:${CANTON_ADMIN_GRPC_PORT}" \
  com.digitalasset.canton.admin.participant.v30.PackageService.UploadDar 2>&1)

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✓ DAR uploaded successfully!${NC}"
  echo ""
  echo "Response:"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  echo ""
else
  # Check if it's already uploaded (might show error but still work)
  if echo "$RESPONSE" | grep -q "already exists\|duplicate"; then
    echo -e "${YELLOW}⚠ DAR may already be uploaded (or upload in progress)${NC}"
    echo "Response: $RESPONSE"
    echo ""
    echo "Continuing with OrderBook creation..."
  else
    echo -e "${RED}✗ Upload failed${NC}"
    echo "Error:"
    echo "$RESPONSE"
    echo ""
    echo "Trying to continue anyway (DAR might already be uploaded)..."
  fi
fi

# Step 3: Wait a moment for Canton to process
echo -e "${YELLOW}Step 3: Waiting for Canton to process upload...${NC}"
sleep 3

# Step 4: Create OrderBooks
echo -e "${YELLOW}Step 4: Creating initial OrderBooks...${NC}\n"

cd backend

# Check if backend is running
if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then
  echo -e "${YELLOW}⚠ Backend is not running. Starting it in the background...${NC}"
  echo "Please start the backend manually: cd backend && npm start"
  echo "Then run: npm run init-orderbooks"
  exit 0
fi

# Create OrderBooks
npm run init-orderbooks

echo ""
echo -e "${GREEN}=== Deployment Complete! ===${NC}\n"
echo "Next steps:"
echo "1. Start backend: cd backend && npm start"
echo "2. Start frontend: cd frontend && npm run dev"
echo "3. Visit http://localhost:5173 to start trading"

