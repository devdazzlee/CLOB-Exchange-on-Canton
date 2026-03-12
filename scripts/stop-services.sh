#!/bin/bash

# Stop all running services

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "Stopping CLOB Exchange services..."

# Stop backend
if [ -f .backend.pid ]; then
  BACKEND_PID=$(cat .backend.pid)
  if kill -0 $BACKEND_PID 2>/dev/null; then
    kill $BACKEND_PID
    echo -e "${GREEN}✓ Backend stopped (PID: $BACKEND_PID)${NC}"
  fi
  rm .backend.pid
fi

# Stop frontend
if [ -f .frontend.pid ]; then
  FRONTEND_PID=$(cat .frontend.pid)
  if kill -0 $FRONTEND_PID 2>/dev/null; then
    kill $FRONTEND_PID
    echo -e "${GREEN}✓ Frontend stopped (PID: $FRONTEND_PID)${NC}"
  fi
  rm .frontend.pid
fi

# Kill any remaining processes on ports
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

echo -e "${GREEN}✅ All services stopped${NC}"
