#!/bin/bash

# Start Matching Engine
# This script starts only the matching engine bot

set -e

echo "========================================="
echo "CLOB Exchange - Matching Engine"
echo "========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting Matching Engine Bot...${NC}"
echo ""

cd "$(dirname "$0")/../backend"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "Error: .env file not found"
    exit 1
fi

# Enable matching engine
export ENABLE_MATCHING_ENGINE=true

# Start server with matching engine
npm start

echo ""
echo -e "${GREEN}✓ Matching Engine started${NC}"
echo ""
