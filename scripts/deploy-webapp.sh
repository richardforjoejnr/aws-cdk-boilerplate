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
npm run build
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
echo -e "${YELLOW}🔄 Invalidating CloudFront cache...${NC}"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null 2>&1 || true
echo -e "${GREEN}✓ Cache invalidation initiated${NC}"
