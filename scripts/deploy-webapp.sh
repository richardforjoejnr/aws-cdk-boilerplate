#!/bin/bash

# Deploy web app to specific environment
# Usage: ./deploy-webapp.sh [dev|test|prod]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 Deploying web app to ${STAGE} environment${NC}\n"

# Configure web app with API endpoints
echo -e "${YELLOW}🔧 Configuring web app...${NC}"
./scripts/configure-webapp.sh $STAGE

# Build web app
echo -e "${YELLOW}📦 Building web app...${NC}"
cd packages/web-app

# Clean previous build to ensure fresh build
rm -rf dist

# Build with fresh environment
npm run build

# Verify .env file has correct API URL
if [ -f .env ]; then
    echo -e "${BLUE}📋 Current .env configuration:${NC}"
    cat .env | grep VITE_GRAPHQL_API_URL || echo "⚠️  VITE_GRAPHQL_API_URL not found in .env"
fi

cd ../..

# Deploy with CDK
echo -e "${YELLOW}☁️  Deploying to AWS...${NC}"
cd packages/infrastructure
STAGE=$STAGE DEPLOY_WEBAPP=true npx cdk deploy ${STAGE}-aws-boilerplate-web-app --require-approval never
cd ../..

echo -e "${GREEN}✅ Web app deployed successfully!${NC}"

# Get the CloudFront URL and distribution ID
WEBAPP_URL=$(aws cloudformation describe-stacks \
    --stack-name "${STAGE}-aws-boilerplate-web-app" \
    --query "Stacks[0].Outputs[?OutputKey=='WebAppUrl'].OutputValue" \
    --output text 2>/dev/null)

DIST_ID=$(aws cloudformation describe-stacks \
    --stack-name "${STAGE}-aws-boilerplate-web-app" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
    --output text 2>/dev/null)

echo -e "${BLUE}🌐 WebApp URL: ${WEBAPP_URL}${NC}"

# Invalidate CloudFront cache
if [ -n "$DIST_ID" ] && [ "$DIST_ID" != "N/A" ]; then
    echo -e "${YELLOW}🔄 Invalidating CloudFront cache (distribution: $DIST_ID)...${NC}"
    INVALIDATION_ID=$(aws cloudfront create-invalidation \
        --distribution-id "$DIST_ID" \
        --paths "/*" \
        --query 'Invalidation.Id' \
        --output text 2>/dev/null)

    if [ -n "$INVALIDATION_ID" ]; then
        echo -e "${GREEN}✓ Cache invalidation created: $INVALIDATION_ID${NC}"
        echo -e "${BLUE}💡 Note: It may take 5-15 minutes for changes to appear globally${NC}"
        echo -e "${BLUE}💡 To force immediate refresh: Open DevTools → Network tab → Disable cache${NC}"
    else
        echo -e "${YELLOW}⚠️  Cache invalidation may have failed${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  No CloudFront distribution found, skipping cache invalidation${NC}"
fi
