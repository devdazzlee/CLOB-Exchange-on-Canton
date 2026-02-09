#!/bin/bash

# Deploy DAML Contracts Script
# Uses the provided OAuth token to upload DAR file

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           CLOB Exchange DAML Contract Deployment             ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if DAR file exists
DAR_FILE="daml/exchange/.daml/dist/clob-exchange-1.0.0.dar"
if [ ! -f "$DAR_FILE" ]; then
    echo -e "${RED}❌ DAR file not found. Building DAML contracts first...${NC}"
    cd daml/exchange
    daml build
    cd ../..
    
    if [ ! -f "$DAR_FILE" ]; then
        echo -e "${RED}❌ Failed to build DAR file${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✓ DAR file found: $DAR_FILE${NC}"

# Get OAuth token (from .env or use provided token)
if [ -z "$OAUTH_TOKEN" ]; then
    if [ -f .env ]; then
        source .env
        OAUTH_TOKEN=$(curl -s -X POST "$OAUTH_TOKEN_URL" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -d "grant_type=client_credentials" \
            -d "client_id=$OAUTH_CLIENT_ID" \
            -d "client_secret=$OAUTH_CLIENT_SECRET" | jq -r '.access_token')
    else
        echo -e "${RED}❌ No OAuth token provided. Set OAUTH_TOKEN environment variable or configure .env${NC}"
        exit 1
    fi
fi

if [ -z "$OAUTH_TOKEN" ] || [ "$OAUTH_TOKEN" = "null" ]; then
    echo -e "${RED}❌ Failed to get OAuth token${NC}"
    exit 1
fi

echo -e "${GREEN}✓ OAuth token acquired${NC}"

# Admin API endpoint
ADMIN_API="http://65.108.40.104:30100"

echo ""
echo -e "${BLUE}Uploading DAR file to participant...${NC}"

# Upload DAR using Admin API
# Note: The exact endpoint may vary - check Canton Admin API docs
RESPONSE=$(curl -s -X POST "$ADMIN_API/v1/participants/upload-dar" \
    -H "Authorization: Bearer $OAUTH_TOKEN" \
    -H "Content-Type: multipart/form-data" \
    -F "dar=@$DAR_FILE")

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ DAR file uploaded successfully!${NC}"
    echo ""
    echo "Response:"
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
else
    echo -e "${RED}❌ Failed to upload DAR file${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Contract deployment complete!${NC}"



