#!/bin/bash

# Smart deployment script that handles orphaned resources and validation
# Usage: ./deploy-with-cleanup.sh [dev|test|prod] [--skip-cleanup] [--webapp]

set -e

STAGE=${1:-dev}
SKIP_CLEANUP=${2}
DEPLOY_WEBAPP=${3}
REGION=${AWS_REGION:-us-east-1}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          AWS Boilerplate - Smart Deployment                   ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${YELLOW}Stage:${NC} $STAGE"
echo -e "${YELLOW}Region:${NC} $REGION"
echo -e "${YELLOW}Deploy WebApp:${NC} ${DEPLOY_WEBAPP:-no}"
echo ""

# Validate stage
if [[ ! "$STAGE" =~ ^(dev|test|prod)$ ]]; then
    echo -e "${RED}❌ Invalid stage: $STAGE${NC}"
    echo -e "${YELLOW}Usage: $0 [dev|test|prod] [--skip-cleanup] [--webapp]${NC}"
    exit 1
fi

# Check AWS credentials
echo -e "${BLUE}🔐 Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    exit 1
fi
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}✓ Using AWS Account: ${ACCOUNT_ID}${NC}\n"

# Run cleanup unless explicitly skipped
if [[ "$SKIP_CLEANUP" != "--skip-cleanup" ]]; then
    echo -e "${BLUE}📋 Step 1: Running pre-deployment cleanup...${NC}"
    ./scripts/cleanup-orphaned-resources.sh "$STAGE"
else
    echo -e "${YELLOW}⚠️  Skipping cleanup (--skip-cleanup flag provided)${NC}\n"
fi

# Build all packages
echo -e "${BLUE}📦 Step 2: Building all packages...${NC}"
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Build completed successfully${NC}\n"

# Deploy infrastructure
echo -e "${BLUE}🚀 Step 3: Deploying infrastructure...${NC}"
cd packages/infrastructure

if [[ "$DEPLOY_WEBAPP" == "--webapp" ]]; then
    echo -e "${YELLOW}Deploying with WebApp...${NC}"
    STAGE=$STAGE DEPLOY_WEBAPP=true npx cdk deploy --all --require-approval never
else
    echo -e "${YELLOW}Deploying core infrastructure only...${NC}"
    STAGE=$STAGE npx cdk deploy --all --require-approval never
fi

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Deployment failed${NC}"
    echo -e "${YELLOW}💡 Tip: Check CloudFormation console for details${NC}"
    exit 1
fi

cd ../..

echo -e "${GREEN}✓ Infrastructure deployed successfully${NC}\n"

# Get stack outputs
echo -e "${BLUE}📊 Step 4: Fetching deployment outputs...${NC}"

STACK_PREFIX="${STAGE}-aws-boilerplate"

# Get DynamoDB table name
TABLE_NAME=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_PREFIX}-database" \
    --query "Stacks[0].Outputs[?OutputKey=='MainTableName'].OutputValue" \
    --output text 2>/dev/null || echo "N/A")

# Get Lambda function name
LAMBDA_NAME=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_PREFIX}-lambda" \
    --query "Stacks[0].Outputs[?OutputKey=='HelloWorldFunctionName'].OutputValue" \
    --output text 2>/dev/null || echo "N/A")

# Get AppSync API URL
API_URL=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_PREFIX}-appsync" \
    --query "Stacks[0].Outputs[?OutputKey=='GraphQLApiUrl'].OutputValue" \
    --output text 2>/dev/null || echo "N/A")

# Get AppSync API Key
API_KEY=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_PREFIX}-appsync" \
    --query "Stacks[0].Outputs[?OutputKey=='GraphQLApiKey'].OutputValue" \
    --output text 2>/dev/null || echo "N/A")

# Get State Machine ARN
STATE_MACHINE_ARN=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_PREFIX}-step-functions" \
    --query "Stacks[0].Outputs[?OutputKey=='StateMachineArn'].OutputValue" \
    --output text 2>/dev/null || echo "N/A")

# Get WebApp outputs if deployed
if [[ "$DEPLOY_WEBAPP" == "--webapp" ]]; then
    WEBAPP_URL=$(aws cloudformation describe-stacks \
        --stack-name "${STACK_PREFIX}-web-app" \
        --query "Stacks[0].Outputs[?OutputKey=='WebAppUrl'].OutputValue" \
        --output text 2>/dev/null || echo "N/A")

    DIST_ID=$(aws cloudformation describe-stacks \
        --stack-name "${STACK_PREFIX}-web-app" \
        --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
        --output text 2>/dev/null || echo "N/A")

    S3_BUCKET=$(aws cloudformation describe-stacks \
        --stack-name "${STACK_PREFIX}-web-app" \
        --query "Stacks[0].Outputs[?OutputKey=='S3BucketName'].OutputValue" \
        --output text 2>/dev/null || echo "N/A")
fi

echo -e "${GREEN}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    Deployment Summary                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${YELLOW}DynamoDB Table:${NC}      $TABLE_NAME"
echo -e "${YELLOW}Lambda Function:${NC}     $LAMBDA_NAME"
echo -e "${YELLOW}GraphQL API URL:${NC}     $API_URL"
echo -e "${YELLOW}GraphQL API Key:${NC}     $API_KEY"
echo -e "${YELLOW}State Machine:${NC}       $STATE_MACHINE_ARN"

if [[ "$DEPLOY_WEBAPP" == "--webapp" ]]; then
    echo -e "${YELLOW}WebApp URL:${NC}          $WEBAPP_URL"
    echo -e "${YELLOW}CloudFront Dist ID:${NC}  $DIST_ID"
    echo -e "${YELLOW}S3 Bucket:${NC}           $S3_BUCKET"
fi

echo ""
echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo ""

# Save outputs to file
OUTPUT_FILE=".deployment-outputs-${STAGE}.json"
cat > "$OUTPUT_FILE" << EOF
{
  "stage": "$STAGE",
  "region": "$REGION",
  "accountId": "$ACCOUNT_ID",
  "tableName": "$TABLE_NAME",
  "lambdaName": "$LAMBDA_NAME",
  "apiUrl": "$API_URL",
  "apiKey": "$API_KEY",
  "stateMachineArn": "$STATE_MACHINE_ARN"$(if [[ "$DEPLOY_WEBAPP" == "--webapp" ]]; then echo ",
  \"webappUrl\": \"$WEBAPP_URL\",
  \"distributionId\": \"$DIST_ID\",
  \"s3BucketName\": \"$S3_BUCKET\""; fi)
}
EOF

echo -e "${BLUE}💾 Deployment outputs saved to: ${OUTPUT_FILE}${NC}\n"
