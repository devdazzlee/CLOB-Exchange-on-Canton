#!/bin/bash

# Production build script for CLOB Exchange
# Usage: ./scripts/build-production.sh

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Building CLOB Exchange for Production ===${NC}\n"

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf frontend/build/
rm -rf frontend/dist/
rm -rf .daml/dist/
echo -e "${GREEN}✓ Cleaned${NC}\n"

# Build DAML contracts
echo "Building DAML contracts..."
cd daml
if ! daml build 2>&1; then
  echo -e "${RED}✗ DAML build failed!${NC}"
  exit 1
fi
cd ..
echo -e "${GREEN}✓ DAML contracts built${NC}\n"

# Copy DAR to scripts directory
mkdir -p scripts/dars
cp .daml/dist/*.dar scripts/dars/ 2>/dev/null || true
echo -e "${GREEN}✓ DAR file copied to scripts/dars/${NC}\n"

# Build React app
echo "Building React app..."
cd frontend

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Build for production
if ! npm run build 2>&1; then
  echo -e "${RED}✗ Frontend build failed!${NC}"
  exit 1
fi

cd ..
echo -e "${GREEN}✓ Frontend built${NC}\n"

# Create deployment package
echo "Creating deployment package..."
mkdir -p dist
cp -r frontend/build/* dist/ 2>/dev/null || cp -r frontend/dist/* dist/ 2>/dev/null || true
cp .daml/dist/*.dar dist/ 2>/dev/null || true
cp README.md dist/ 2>/dev/null || true
cp TESTING_GUIDE.md dist/ 2>/dev/null || true

echo -e "${GREEN}✓ Deployment package created${NC}\n"

# Summary
echo -e "${GREEN}=== Build Summary ===${NC}"
echo "DAML DAR: .daml/dist/clob-exchange-1.0.0.dar"
echo "Frontend: frontend/dist/ or frontend/build/"
echo "Deployment package: ./dist/"
echo ""
echo -e "${GREEN}✅ Production build complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Upload DAR: ./scripts/upload-dar.sh"
echo "2. Deploy frontend to hosting service"
echo "3. Test deployment"



