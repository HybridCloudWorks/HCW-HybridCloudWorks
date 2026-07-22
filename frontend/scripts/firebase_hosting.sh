#!/bin/bash
# HCW V2 Deployment Script
# Execute this to deploy to Firebase Hosting

set -e

PROJECT_DIR="C:\Users\saulp\AppData\Workspace\Personal-Site_HCW"
FIREBASE_PROJECT="hybridcloudworks-61e8d"

echo "🚀 HCW V2 Deployment Script"
echo "=================================="
echo "Project: $FIREBASE_PROJECT"
echo "Domain: hybridcloudworks.com"
echo ""

# Step 1: Verify Firebase CLI
echo "📦 Step 1: Verifying Firebase CLI..."
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI not found. Install with: npm install -g firebase-tools"
    exit 1
fi
firebase --version
echo "✅ Firebase CLI ready"
echo ""

# Step 2: Verify build
echo "🔨 Step 2: Building production bundle..."
cd "$PROJECT_DIR"
npm ci
npm run build
echo "✅ Build successful"
echo ""

# Step 3: Preview (optional)
echo "👀 Step 3: Ready to deploy"
echo "   Build output: dist/"
echo "   Files: $(find dist -type f | wc -l) files"
echo "   Size: $(du -sh dist | cut -f1)"
echo ""

# Step 4: Deploy
echo "🌐 Step 4: Deploying to Firebase Hosting..."
echo "   Project: $FIREBASE_PROJECT"
echo "   URL: https://hybridcloudworks.com"
echo ""
echo "Press Enter to continue or Ctrl+C to cancel..."
read

firebase deploy --only hosting --project $FIREBASE_PROJECT

echo ""
echo "✅ Deployment complete!"
echo "=================================="
echo "Live at: https://hybridcloudworks.com"
echo ""
echo "Post-deployment verification:"
echo "  1. Visit https://hybridcloudworks.com"
echo "  2. Check HomePage loads"
echo "  3. Visit /about - should show profile"
echo "  4. Visit /contact - should show form"
echo "  5. Check browser console (F12) for errors"
echo ""
echo "Need to rollback? Run: firebase hosting:rollback --project $FIREBASE_PROJECT"
