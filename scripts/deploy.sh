#!/bin/bash

# Deployment script for CLOB Exchange
# Builds and deploys all components

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           CLOB Exchange Deployment Script                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Please copy .env.example to .env and configure it."
    exit 1
fi

# Build packages
echo "📦 Building packages..."
npm run build

# Build DAML contracts
echo "📦 Building DAML contracts..."
cd daml/exchange
daml build
cd ../..

# Create database if it doesn't exist
echo "🗄️  Setting up database..."
# Note: This assumes PostgreSQL is running locally
# Adjust connection string in .env as needed

echo ""
echo "✅ Build complete!"
echo ""
echo "To start services:"
echo "  1. Backend API:    cd apps/api && npm run dev"
echo "  2. Indexer:        cd apps/indexer && npm run dev"
echo "  3. Matcher:        cd apps/matcher && npm run dev"
echo "  4. Frontend:       cd apps/web && npm run dev"
echo ""
echo "To deploy DAR file:"
echo "  ./scripts/upload-dar.sh"
echo ""
