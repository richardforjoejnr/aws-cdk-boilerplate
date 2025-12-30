#!/bin/bash

# Deploy Jira Dashboard
# Usage: ./scripts/deploy-jira-dashboard.sh <stage>
# Example: ./scripts/deploy-jira-dashboard.sh dev

set -e

STAGE=${1:-dev}

echo "==============================================="
echo "Deploying Jira Dashboard to ${STAGE}"
echo "==============================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if stage is provided
if [ -z "$STAGE" ]; then
    echo -e "${RED}Error: Stage not provided${NC}"
    echo "Usage: ./scripts/deploy-jira-dashboard.sh <stage>"
    exit 1
fi

echo -e "${BLUE}Stage: ${STAGE}${NC}"
echo ""

# Step 1: Install dependencies
echo -e "${BLUE}Step 1: Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 2: Build Lambda functions
echo -e "${BLUE}Step 2: Building Lambda functions...${NC}"
cd packages/functions
npm install
npm run build

# Create dist directories for each Jira Lambda function
mkdir -p dist/jira-csv-processor
mkdir -p dist/jira-get-upload-url
mkdir -p dist/jira-list-uploads
mkdir -p dist/jira-get-dashboard-data
mkdir -p dist/jira-get-historical-data

# Copy built files and package.json to dist directories
cp dist/jira-csv-processor.js dist/jira-csv-processor/index.js
cp dist/jira-get-upload-url.js dist/jira-get-upload-url/index.js
cp dist/jira-list-uploads.js dist/jira-list-uploads/index.js
cp dist/jira-get-dashboard-data.js dist/jira-get-dashboard-data/index.js
cp dist/jira-get-historical-data.js dist/jira-get-historical-data/index.js

# Copy node_modules to each dist directory
for dir in dist/jira-*; do
    if [ -d "$dir" ]; then
        cp package.json "$dir/"
        cd "$dir"
        npm install --production
        cd ../..
    fi
done

cd ../..
echo -e "${GREEN}✓ Lambda functions built${NC}"
echo ""

# Step 3: Deploy infrastructure
echo -e "${BLUE}Step 3: Deploying infrastructure...${NC}"
cd packages/infrastructure
npm install
STAGE=${STAGE} npx cdk deploy ${STAGE}-aws-boilerplate-jira-dashboard --require-approval never

echo -e "${GREEN}✓ Infrastructure deployed${NC}"
echo ""

# Step 4: Get API URL from CloudFormation outputs
echo -e "${BLUE}Step 4: Retrieving API URL...${NC}"
API_URL=$(aws cloudformation describe-stacks \
    --stack-name ${STAGE}-aws-boilerplate-jira-dashboard \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
    --output text)

echo -e "${GREEN}API URL: ${API_URL}${NC}"
echo ""

# Step 5: Build web app with API URL
echo -e "${BLUE}Step 5: Building web app...${NC}"
cd ../web-app
npm install

# Create .env file with API URL
echo "VITE_JIRA_API_URL=${API_URL}" > .env.${STAGE}

# Build with the correct env file
VITE_JIRA_API_URL=${API_URL} npm run build -- --mode ${STAGE}

echo -e "${GREEN}✓ Web app built${NC}"
echo ""

# Step 6: Deploy web app (optional - only if web-app stack exists)
if [ "$2" == "--deploy-webapp" ]; then
    echo -e "${BLUE}Step 6: Deploying web app...${NC}"
    cd ../infrastructure
    DEPLOY_WEBAPP=true STAGE=${STAGE} npx cdk deploy ${STAGE}-aws-boilerplate-web-app --require-approval never

    # Get CloudFront URL
    WEBAPP_URL=$(aws cloudformation describe-stacks \
        --stack-name ${STAGE}-aws-boilerplate-web-app \
        --query 'Stacks[0].Outputs[?OutputKey==`WebAppUrl`].OutputValue' \
        --output text)

    echo -e "${GREEN}✓ Web app deployed${NC}"
    echo -e "${GREEN}Web App URL: ${WEBAPP_URL}${NC}"
fi

cd ../..

echo ""
echo -e "${GREEN}===============================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}===============================================${NC}"
echo ""
echo -e "${BLUE}API URL:${NC} ${API_URL}"
if [ ! -z "$WEBAPP_URL" ]; then
    echo -e "${BLUE}Web App URL:${NC} ${WEBAPP_URL}"
fi
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Navigate to the Jira Dashboard at ${WEBAPP_URL:-'your CloudFront URL'}"
echo "2. Upload a Jira CSV export"
echo "3. View your metrics and insights!"
echo ""
