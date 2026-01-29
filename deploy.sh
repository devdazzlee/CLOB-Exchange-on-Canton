#!/bin/bash
# Deployment Script for CLOB Exchange
# Builds DAML contracts, frontend, and prepares for deployment

set -e

echo "🚀 Starting CLOB Exchange Deployment Process"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Build DAML Contracts
echo -e "${YELLOW}Step 1: Building DAML Contracts...${NC}"
cd daml
if daml build --output=../dars/clob-exchange-1.0.0.dar; then
    echo -e "${GREEN}✅ DAML contracts built successfully${NC}"
    ls -lh ../dars/clob-exchange-1.0.0.dar
else
    echo -e "${RED}❌ DAML build failed${NC}"
    exit 1
fi
cd ..

# Step 2: Build Frontend
echo ""
echo -e "${YELLOW}Step 2: Building Frontend...${NC}"
cd frontend
if npm run build; then
    echo -e "${GREEN}✅ Frontend built successfully${NC}"
    ls -lh dist/
else
    echo -e "${RED}❌ Frontend build failed${NC}"
    exit 1
fi
cd ..

# Step 3: Verify Backend Dependencies
echo ""
echo -e "${YELLOW}Step 3: Verifying Backend Dependencies...${NC}"
cd backend
if npm install --production; then
    echo -e "${GREEN}✅ Backend dependencies installed${NC}"
else
    echo -e "${RED}❌ Backend dependency installation failed${NC}"
    exit 1
fi
cd ..

# Step 4: Verify Configuration
echo ""
echo -e "${YELLOW}Step 4: Verifying Configuration...${NC}"
if [ -f backend/.env ]; then
    echo -e "${GREEN}✅ Backend .env file exists${NC}"
    # Check critical env vars
    if grep -q "CANTON_JSON_API_BASE" backend/.env && \
       grep -q "CANTON_OPERATOR_PARTY_ID" backend/.env && \
       grep -q "CLOB_EXCHANGE_PACKAGE_ID" backend/.env; then
        echo -e "${GREEN}✅ Critical environment variables configured${NC}"
    else
        echo -e "${YELLOW}⚠️  Some environment variables may be missing${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Backend .env file not found - create it from .env.example${NC}"
fi

# Step 5: Summary
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Deployment Preparation Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "📦 Artifacts:"
echo "   - DAR file: dars/clob-exchange-1.0.0.dar"
echo "   - Frontend: frontend/dist/"
echo "   - Backend: backend/"
echo ""
echo "📋 Next Steps:"
echo "   1. Upload DAR to Canton: daml ledger upload-dar --dar dars/clob-exchange-1.0.0.dar"
echo "   2. Start backend: cd backend && npm start"
echo "   3. Serve frontend: cd frontend && npm run preview"
echo ""
