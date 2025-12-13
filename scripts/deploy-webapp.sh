#!/bin/bash

# Deploy Web App to S3 + CloudFront
# Usage: ./scripts/deploy-webapp.sh [dev|test|prod]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

echo "🚀 Deploying web app for stage: $STAGE"
echo "Region: $REGION"
echo ""

# Step 1: Configure the web app with AppSync API details
echo "Step 1: Configuring web app..."
echo "=============================="
./scripts/configure-webapp.sh "$STAGE"
echo ""

# Step 2: Build the web app
echo "Step 2: Building web app..."
echo "============================"
cd packages/web-app
npm run build
cd ../..
echo "✅ Web app built successfully"
echo ""

# Step 3: Deploy infrastructure with web app
echo "Step 3: Deploying infrastructure..."
echo "===================================="
export DEPLOY_WEBAPP=true
STAGE=$STAGE npm run deploy
echo ""

echo "🎉 Web app deployment complete!"
echo ""
echo "To get the web app URL:"
echo "  aws cloudformation describe-stacks \\"
echo "    --stack-name ${STAGE}-aws-boilerplate-web-app \\"
echo "    --query 'Stacks[0].Outputs[?OutputKey==\`WebAppUrl\`].OutputValue' \\"
echo "    --output text"
