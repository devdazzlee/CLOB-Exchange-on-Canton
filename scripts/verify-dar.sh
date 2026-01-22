#!/bin/bash

# Verify DAR contains all new features before uploading
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

DAR_FILE="daml/.daml/dist/clob-exchange-1.0.0.dar"

echo -e "${GREEN}=== DAR Verification Script ===${NC}\n"

# Check if DAR exists
if [ ! -f "$DAR_FILE" ]; then
  echo -e "${RED}✗ DAR file not found: $DAR_FILE${NC}"
  echo "Run: cd daml && daml build"
  exit 1
fi

echo -e "${GREEN}✓ DAR file exists${NC}"

# Check file size (new DAR should be ~862KB, old was ~725KB)
FILE_SIZE=$(ls -lh "$DAR_FILE" | awk '{print $5}')
echo "  Size: $FILE_SIZE"

# Get MD5 hash
FILE_HASH=$(md5 "$DAR_FILE" | awk '{print $NF}')
echo "  MD5: $FILE_HASH"
echo ""

# Extract and check for new modules
echo "Checking for new contracts..."
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

unzip -q "$DAR_FILE" -d "$TEMP_DIR"

# Function to check if module exists in DAR
check_module() {
  local module_name=$1
  if grep -r "module $module_name" "$TEMP_DIR" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} $module_name"
    return 0
  else
    echo -e "  ${RED}✗${NC} $module_name ${RED}MISSING${NC}"
    return 1
  fi
}

# Check for all expected modules
ALL_FOUND=true

echo "Core contracts:"
check_module "Asset" || ALL_FOUND=false
check_module "AssetHolding" || ALL_FOUND=false
check_module "OrderV2" || ALL_FOUND=false
check_module "MasterOrderBookV2" || ALL_FOUND=false

echo ""
echo "Legacy contracts (for backward compatibility):"
check_module "Order" || ALL_FOUND=false
check_module "MasterOrderBook" || ALL_FOUND=false
check_module "OrderBook" || ALL_FOUND=false
check_module "UserAccount" || ALL_FOUND=false
check_module "Trade" || ALL_FOUND=false

echo ""

if [ "$ALL_FOUND" = true ]; then
  echo -e "${GREEN}✅ All new features present in DAR!${NC}"
  echo ""
  echo "New features included:"
  echo "  • Asset templates (fungible tokens)"
  echo "  • AssetHolding (wallet with locked balances)"
  echo "  • OrderV2 (orders with real asset locking)"
  echo "  • MasterOrderBookV2 (settlement with asset transfers)"
  echo ""
  echo -e "${GREEN}Ready to upload!${NC}"
  echo ""
  echo "Upload command:"
  echo '  export JWT_TOKEN="your-token-here"'
  echo "  bash scripts/upload-dar.sh"
  exit 0
else
  echo -e "${RED}✗ Some contracts are missing!${NC}"
  echo "Rebuild the DAR:"
  echo "  cd daml"
  echo "  daml clean"
  echo "  daml build"
  exit 1
fi
