#!/bin/bash

# Quick Start and Test Script
# Starts all services and runs basic tests

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         CLOB Exchange - Quick Start & Test                     ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if frontend dependencies are installed
echo -e "${YELLOW}[1/6] Checking frontend dependencies...${NC}"
if ! npm list --prefix frontend lightweight-charts > /dev/null 2>&1; then
  echo "Installing lightweight-charts..."
  cd frontend && npm install lightweight-charts && cd ..
  echo -e "${GREEN}✓ Installed lightweight-charts${NC}"
else
  echo -e "${GREEN}✓ lightweight-charts already installed${NC}"
fi
echo ""

# Check if backend dependencies are installed
echo -e "${YELLOW}[2/6] Checking backend dependencies...${NC}"
if [ ! -d "backend/node_modules" ]; then
  echo "Installing backend dependencies..."
  cd backend && npm install && cd ..
  echo -e "${GREEN}✓ Backend dependencies installed${NC}"
else
  echo -e "${GREEN}✓ Backend dependencies OK${NC}"
fi
echo ""

# Start backend
echo -e "${YELLOW}[3/6] Starting backend server...${NC}"
cd backend
npm start > ../backend.log 2>&1 &
BACKEND_PID=$!
cd ..
echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"
echo "  Log: backend.log"
echo ""

# Wait for backend to be ready
echo -e "${YELLOW}[4/6] Waiting for backend to be ready...${NC}"
for i in {1..30}; do
  if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend is ready!${NC}"
    break
  fi
  echo -n "."
  sleep 1
done
echo ""

# Create orderbooks
echo -e "${YELLOW}[5/6] Creating orderbooks...${NC}"
curl -s -X POST http://localhost:3001/api/admin/orderbooks/BTC%2FUSDT | jq -r '.message // "Created"'
curl -s -X POST http://localhost:3001/api/admin/orderbooks/ETH%2FUSDT | jq -r '.message // "Created"'
curl -s -X POST http://localhost:3001/api/admin/orderbooks/SOL%2FUSDT | jq -r '.message // "Created"'
echo -e "${GREEN}✓ Orderbooks created${NC}"
echo ""

# Start frontend
echo -e "${YELLOW}[6/6] Starting frontend...${NC}"
cd frontend
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..
echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"
echo "  Log: frontend.log"
echo ""

# Save PIDs
echo "$BACKEND_PID" > .backend.pid
echo "$FRONTEND_PID" > .frontend.pid

echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    🚀 ALL SERVICES RUNNING                     ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Backend:  ${GREEN}http://localhost:3001${NC}"
echo -e "Frontend: ${GREEN}http://localhost:5173${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Open http://localhost:5173 in your browser"
echo "2. Create wallet and onboard"
echo "3. Test new features:"
echo "   ⭐ Mint test tokens (quick-mint button)"
echo "   ⭐ Place order → See asset locking"
echo "   ⭐ Match trade → See asset settlement"
echo "   ⭐ Cancel order → See refund"
echo "   ⭐ View candlestick chart"
echo ""
echo "To stop services:"
echo "  bash scripts/stop-services.sh"
echo ""
echo "To view logs:"
echo "  tail -f backend.log"
echo "  tail -f frontend.log"
echo ""
