#!/bin/bash

# One-command test runner for CLOB Exchange
# Usage: ./RUN_TEST.sh

echo "🚀 Starting CLOB Exchange Test..."
echo ""

# Run setup
./scripts/setup-for-testing.sh

echo ""
echo "✅ Setup complete! Starting frontend..."
echo ""
echo "📋 Next steps:"
echo "1. Frontend will start automatically"
echo "2. Open: http://localhost:3000"
echo "3. Follow TEST_NOW.md for testing"
echo ""
echo "Starting frontend in 3 seconds..."
sleep 3

cd frontend
npm run dev
