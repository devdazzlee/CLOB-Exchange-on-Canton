#!/bin/bash

# DAML Contract Deployment Script
# Builds and deploys DAML contracts to Canton network

set -e

echo "========================================="
echo "CLOB Exchange - DAML Deployment"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DAML_DIR="./daml"
DAR_OUTPUT="./dars"
CANTON_JSON_API="${CANTON_JSON_API_BASE:-http://65.108.40.104:31539}"
CANTON_ADMIN_PORT="${CANTON_ADMIN_PORT:-30100}"
PARTICIPANT_ADMIN_API="${PARTICIPANT_ADMIN_API:-http://65.108.40.104:30100}"

echo -e "${YELLOW}Configuration:${NC}"
echo "  DAML Directory: $DAML_DIR"
echo "  DAR Output: $DAR_OUTPUT"
echo "  Canton JSON API: $CANTON_JSON_API"
echo "  Participant Admin API: $PARTICIPANT_ADMIN_API"
echo ""

# Check if DAML is installed
if ! command -v daml &> /dev/null; then
    echo -e "${RED}Error: DAML SDK not found${NC}"
    echo "Please install DAML SDK from: https://docs.daml.com/getting-started/installation.html"
    exit 1
fi

echo -e "${GREEN}✓ DAML SDK found${NC}"
echo ""

# Step 1: Build DAML contracts
echo "========================================="
echo "Step 1: Building DAML Contracts"
echo "========================================="
echo ""

cd "$DAML_DIR"

echo "Building contracts..."
daml build

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build successful${NC}"
echo ""

# Step 2: Copy DAR to output directory
echo "========================================="
echo "Step 2: Preparing DAR for Deployment"
echo "========================================="
echo ""

cd ..

mkdir -p "$DAR_OUTPUT"

DAR_FILE=$(find "$DAML_DIR/.daml/dist" -name "*.dar" | head -n 1)

if [ -z "$DAR_FILE" ]; then
    echo -e "${RED}✗ DAR file not found${NC}"
    exit 1
fi

DAR_BASENAME=$(basename "$DAR_FILE")
cp "$DAR_FILE" "$DAR_OUTPUT/$DAR_BASENAME"

echo "DAR file: $DAR_BASENAME"
echo "Location: $DAR_OUTPUT/$DAR_BASENAME"
echo -e "${GREEN}✓ DAR prepared${NC}"
echo ""

# Step 3: Upload to Canton (optional - requires Canton Console)
echo "========================================="
echo "Step 3: Upload to Canton"
echo "========================================="
echo ""

echo -e "${YELLOW}Manual Upload Required:${NC}"
echo ""
echo "To upload the DAR to Canton, use one of these methods:"
echo ""
echo "Method 1: Using Canton Console"
echo "  1. Connect to Canton console"
echo "  2. Run: participant1.dars.upload(\"$DAR_OUTPUT/$DAR_BASENAME\")"
echo ""
echo "Method 2: Using HTTP API (if available)"
echo "  curl -X POST $PARTICIPANT_ADMIN_API/v1/dars \\
       -H 'Content-Type: application/octet-stream' \\
       --data-binary @$DAR_OUTPUT/$DAR_BASENAME"
echo ""
echo "Method 3: Using Backend API"
echo "  POST http://localhost:3001/api/admin/upload-dar"
echo "  Body: { darPath: \"$DAR_OUTPUT/$DAR_BASENAME\" }"
echo ""

# Check if we can auto-upload via backend
if [ -f "backend/.env" ]; then
    echo -e "${YELLOW}Attempting auto-upload via backend...${NC}"

    # Source backend env
    export $(cat backend/.env | grep -v '^#' | xargs)

    if [ ! -z "$BACKEND_AUTO_UPLOAD" ] && [ "$BACKEND_AUTO_UPLOAD" = "true" ]; then
        echo "Auto-upload enabled, uploading via backend API..."

        # Start backend if not running (in background)
        cd backend
        npm start &
        BACKEND_PID=$!
        sleep 5

        # Upload DAR
        curl -X POST http://localhost:3001/api/admin/upload-dar \
            -H "Content-Type: application/json" \
            -d "{\"darPath\": \"../$DAR_OUTPUT/$DAR_BASENAME\"}"

        # Stop backend
        kill $BACKEND_PID
        cd ..

        echo -e "${GREEN}✓ Auto-upload complete${NC}"
    fi
fi

echo ""
echo "========================================="
echo "Deployment Complete"
echo "========================================="
echo ""
echo -e "${GREEN}✓ DAML contracts built successfully${NC}"
echo -e "${GREEN}✓ DAR file ready: $DAR_OUTPUT/$DAR_BASENAME${NC}"
echo ""
echo "Next Steps:"
echo "  1. Upload the DAR to Canton (see methods above)"
echo "  2. Create global orderbooks for trading pairs"
echo "  3. Start the matching engine"
echo ""
