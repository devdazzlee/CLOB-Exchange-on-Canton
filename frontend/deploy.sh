#!/bin/bash

# Production Deployment Script for Vercel
# Usage: ./deploy.sh

set -e

echo "🚀 Starting Production Deployment..."

# Check if we're in the frontend directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must run from frontend directory"
    echo "Usage: cd frontend && ./deploy.sh"
    exit 1
fi

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "📦 Installing Vercel CLI..."
    npm install -g vercel
fi

# Check if logged in to Vercel
if ! vercel whoami &> /dev/null; then
    echo "🔐 Please login to Vercel..."
    vercel login
fi

# Build the project
echo "🔨 Building project..."
npm run build

# Check if build was successful
if [ ! -d "dist" ]; then
    echo "❌ Error: Build failed - dist directory not found"
    exit 1
fi

# Check if API directory exists
if [ ! -d "api" ]; then
    echo "❌ Error: api directory not found"
    exit 1
fi

echo "✅ Build successful!"
echo "📤 Deploying to Vercel..."

# Deploy to production
vercel --prod

echo "✅ Deployment complete!"
echo "🌐 Your app should be live at: https://your-project.vercel.app"
echo ""
echo "📝 Next steps:"
echo "1. Check Vercel Dashboard for deployment status"
echo "2. Test API endpoint: curl https://your-project.vercel.app/api/test"
echo "3. Check function logs in Vercel Dashboard → Functions"


