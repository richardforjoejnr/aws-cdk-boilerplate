#!/bin/bash

# AWS Access Setup Helper Script
# This script helps you verify your AWS access and bootstrap CDK

set -e

echo "================================================"
echo "AWS Access Setup Helper"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if AWS CLI is installed
echo "Step 1: Checking AWS CLI installation..."
if command -v aws &> /dev/null; then
    echo -e "${GREEN}✓${NC} AWS CLI is installed"
    aws --version
else
    echo -e "${RED}✗${NC} AWS CLI is not installed"
    echo "Please install AWS CLI:"
    echo "  macOS: brew install awscli"
    echo "  Linux: sudo apt-get install awscli"
    echo "  Windows: https://aws.amazon.com/cli/"
    exit 1
fi

echo ""

# Check if credentials are configured
echo "Step 2: Checking AWS credentials..."
if aws sts get-caller-identity &> /dev/null; then
    echo -e "${GREEN}✓${NC} AWS credentials are configured"
    echo ""
    echo "Your AWS Identity:"
    aws sts get-caller-identity

    # Extract account ID
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    REGION=$(aws configure get region || echo "us-east-1")

    echo ""
    echo "Account ID: $ACCOUNT_ID"
    echo "Region: $REGION"
else
    echo -e "${RED}✗${NC} AWS credentials are not configured"
    echo ""
    echo "Please configure your credentials:"
    echo "  Option 1: Run 'aws configure'"
    echo "  Option 2: Set environment variables:"
    echo "    export AWS_ACCESS_KEY_ID='your-key'"
    echo "    export AWS_SECRET_ACCESS_KEY='your-secret'"
    echo "    export AWS_DEFAULT_REGION='us-east-1'"
    echo ""
    echo "See AWS_ACCESS_SETUP.md for detailed instructions"
    exit 1
fi

echo ""

# Check permissions
echo "Step 3: Checking IAM permissions..."
echo "Testing CloudFormation access..."
if aws cloudformation describe-stacks --region "$REGION" &> /dev/null; then
    echo -e "${GREEN}✓${NC} CloudFormation access confirmed"
else
    echo -e "${YELLOW}⚠${NC} CloudFormation access test failed (might be no stacks yet)"
fi

echo "Testing S3 access..."
if aws s3 ls &> /dev/null; then
    echo -e "${GREEN}✓${NC} S3 access confirmed"
else
    echo -e "${RED}✗${NC} S3 access denied"
    echo "You may need additional IAM permissions"
fi

echo ""

# Check if CDK is installed
echo "Step 4: Checking CDK installation..."
if command -v cdk &> /dev/null; then
    echo -e "${GREEN}✓${NC} CDK CLI is installed"
    cdk --version
else
    echo -e "${YELLOW}⚠${NC} CDK CLI is not installed globally"
    echo "You can use npx cdk or install globally:"
    echo "  npm install -g aws-cdk"
fi

echo ""

# Check if CDK is bootstrapped
echo "Step 5: Checking CDK bootstrap status..."
BOOTSTRAP_STACK_NAME="CDKToolkit"

if aws cloudformation describe-stacks --stack-name "$BOOTSTRAP_STACK_NAME" --region "$REGION" &> /dev/null; then
    echo -e "${GREEN}✓${NC} CDK is bootstrapped in $REGION"
    echo ""
    echo "Bootstrap stack details:"
    aws cloudformation describe-stacks \
        --stack-name "$BOOTSTRAP_STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].[StackName,StackStatus,CreationTime]' \
        --output table
else
    echo -e "${YELLOW}⚠${NC} CDK is not bootstrapped in $REGION"
    echo ""
    echo "Would you like to bootstrap now? (y/n)"
    read -r RESPONSE

    if [[ "$RESPONSE" =~ ^[Yy]$ ]]; then
        echo "Bootstrapping CDK..."
        cd packages/infrastructure
        npx cdk bootstrap "aws://$ACCOUNT_ID/$REGION"
        cd ../..
        echo -e "${GREEN}✓${NC} CDK bootstrap complete!"
    else
        echo "You can bootstrap later by running:"
        echo "  cd packages/infrastructure && npx cdk bootstrap"
    fi
fi

echo ""
echo "================================================"
echo "Setup Summary"
echo "================================================"
echo -e "${GREEN}✓${NC} AWS CLI: Installed"
echo -e "${GREEN}✓${NC} Credentials: Configured"
echo "Account: $ACCOUNT_ID"
echo "Region: $REGION"
echo ""
echo "Next steps:"
echo "1. Install dependencies: npm install"
echo "2. Deploy to dev: npm run deploy:dev"
echo ""
echo "For more information, see:"
echo "  - AWS_ACCESS_SETUP.md (detailed setup guide)"
echo "  - DEPLOYMENT.md (deployment guide)"
echo "  - README.md (project overview)"
echo "================================================"
