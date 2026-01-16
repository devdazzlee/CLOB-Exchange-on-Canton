#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== Quick Deployment - CLOB Exchange ===${NC}\n"

# Step 1: Verify DAR exists
DAR_FILE=".daml/dist/clob-exchange-1.0.0.dar"
if [ ! -f "$DAR_FILE" ]; then
  echo -e "${YELLOW}Building DAML contracts...${NC}"
  export PATH="$HOME/.daml/bin:$PATH"
  cd daml
  daml build --no-legacy-assistant-warning 2>&1 | grep -v "WARNING\|warning" || true
  cd ..
fi

if [ ! -f "$DAR_FILE" ]; then
  echo -e "${RED}Error: DAR file not found${NC}"
  exit 1
fi

echo -e "${GREEN}✓ DAR file ready: $DAR_FILE${NC}\n"

# Step 2: Try creating OrderBooks (DAR might already be uploaded)
echo -e "${YELLOW}Step 1: Attempting to create OrderBooks...${NC}"
echo "If DAR is already uploaded, this will work."
echo ""

cd backend

# Check if backend is running
if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then
  echo -e "${RED}Error: Backend is not running!${NC}"
  echo "Please start the backend first:"
  echo "  cd backend && npm start"
  echo ""
  echo "Then run this script again."
  exit 1
fi

echo -e "${GREEN}✓ Backend is running${NC}\n"

# Try to create OrderBooks
npm run init-orderbooks

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo ""
  echo -e "${GREEN}=== ✅ Deployment Successful! ===${NC}\n"
  echo "OrderBooks created successfully!"
  echo ""
  echo "Next steps:"
  echo "1. Frontend is ready at: http://localhost:5173"
  echo "2. Start trading!"
  exit 0
fi

# If OrderBook creation failed, DAR needs to be uploaded
echo ""
echo -e "${YELLOW}⚠ OrderBook creation failed - DAR needs to be uploaded${NC}\n"
echo "The DAR file is ready but needs to be uploaded to Canton."
echo ""
echo "Option 1: Manual Upload via Canton Admin UI"
echo "  1. Go to Canton admin interface"
echo "  2. Upload the DAR file: $DAR_FILE"
echo ""
echo "Option 2: Use gRPC (if you have access)"
echo "  export JWT_TOKEN='your-token'"
echo "  ./scripts/upload-dar.sh"
echo ""
echo "Option 3: Contact your Canton administrator to upload the DAR"
echo ""
echo "After DAR is uploaded, run: cd backend && npm run init-orderbooks"

