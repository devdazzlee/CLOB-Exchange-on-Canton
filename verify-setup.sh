#!/bin/bash

echo "🔍 CLOB Exchange Setup Verification"
echo "===================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ $1${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ $1${NC}"
        ((FAILED++))
    fi
}

# Check Node.js
echo "1. Checking Node.js..."
node --version > /dev/null 2>&1
check "Node.js installed"

# Check Yarn
echo "2. Checking Yarn..."
yarn --version > /dev/null 2>&1
check "Yarn installed"

# Check frontend dependencies
echo "3. Checking frontend dependencies..."
cd frontend
if [ -d "node_modules" ]; then
    check "Frontend dependencies installed"
else
    echo -e "${YELLOW}⚠️  Dependencies not installed. Run: cd frontend && yarn install${NC}"
    ((FAILED++))
fi

# Check build
echo "4. Testing frontend build..."
yarn build > /dev/null 2>&1
check "Frontend builds successfully"

# Check DAML SDK (optional)
echo "5. Checking DAML SDK..."
cd ../daml
daml version > /dev/null 2>&1
if [ $? -eq 0 ]; then
    check "DAML SDK installed"
    
    # Try to build
    daml build > /dev/null 2>&1
    check "DAML contracts compile"
else
    echo -e "${YELLOW}⚠️  DAML SDK not found. Install DAML SDK 2.9.3 to test contracts${NC}"
fi

cd ..

# Summary
echo ""
echo "===================================="
echo "Summary:"
echo -e "${GREEN}✅ Passed: $PASSED${NC}"
echo -e "${RED}❌ Failed: $FAILED${NC}"

if [ $FAILED -eq 0 ]; then
    echo ""
    echo -e "${GREEN}🎉 All checks passed!${NC}"
    exit 0
else
    echo ""
    echo -e "${YELLOW}⚠️  Some checks failed. Review above.${NC}"
    exit 1
fi

