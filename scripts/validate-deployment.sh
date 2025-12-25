#!/bin/bash

# Validate deployment health
# Usage: ./validate-deployment.sh [dev|test|prod]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

STACK_PREFIX="${STAGE}-aws-boilerplate"
ERRORS=0

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║              Deployment Validation Report                     ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${YELLOW}Stage:${NC} $STAGE"
echo -e "${YELLOW}Region:${NC} $REGION"
echo ""

# Function to check stack status
check_stack() {
    local stack_name=$1
    local display_name=$2

    echo -ne "${YELLOW}Checking ${display_name}...${NC} "

    local status=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$REGION" \
        --query "Stacks[0].StackStatus" \
        --output text 2>/dev/null || echo "NOT_FOUND")

    if [[ "$status" == *"COMPLETE"* ]]; then
        echo -e "${GREEN}✓ ${status}${NC}"
        return 0
    elif [ "$status" == "NOT_FOUND" ]; then
        echo -e "${RED}✗ Stack not deployed${NC}"
        ((ERRORS++))
        return 1
    else
        echo -e "${RED}✗ ${status}${NC}"
        ((ERRORS++))
        return 1
    fi
}

# Function to test Lambda
test_lambda() {
    local function_name=$1

    echo -ne "${YELLOW}Testing Lambda function...${NC} "

    local result=$(aws lambda invoke \
        --function-name "$function_name" \
        --region "$REGION" \
        --payload '{}' \
        /tmp/lambda-output.json 2>&1 | grep -q "200" && echo "SUCCESS" || echo "FAILED")

    if [ "$result" == "SUCCESS" ]; then
        echo -e "${GREEN}✓ Function responding${NC}"
        return 0
    else
        echo -e "${RED}✗ Function not responding${NC}"
        ((ERRORS++))
        return 1
    fi
}

# Function to test DynamoDB
test_dynamodb() {
    local table_name=$1

    echo -ne "${YELLOW}Testing DynamoDB table...${NC} "

    local status=$(aws dynamodb describe-table \
        --table-name "$table_name" \
        --region "$REGION" \
        --query "Table.TableStatus" \
        --output text 2>/dev/null || echo "NOT_FOUND")

    if [ "$status" == "ACTIVE" ]; then
        echo -e "${GREEN}✓ Table active${NC}"
        return 0
    else
        echo -e "${RED}✗ Table status: ${status}${NC}"
        ((ERRORS++))
        return 1
    fi
}

# Function to test AppSync API
test_appsync() {
    local api_id=$1

    echo -ne "${YELLOW}Testing AppSync API...${NC} "

    local status=$(aws appsync get-graphql-api \
        --api-id "$api_id" \
        --region "$REGION" \
        --query "graphqlApi.name" \
        --output text 2>/dev/null || echo "NOT_FOUND")

    if [ "$status" != "NOT_FOUND" ]; then
        echo -e "${GREEN}✓ API accessible${NC}"
        return 0
    else
        echo -e "${RED}✗ API not found${NC}"
        ((ERRORS++))
        return 1
    fi
}

# Function to test CloudFront
test_cloudfront() {
    local distribution_id=$1

    echo -ne "${YELLOW}Testing CloudFront distribution...${NC} "

    local status=$(aws cloudfront get-distribution \
        --id "$distribution_id" \
        --region "$REGION" \
        --query "Distribution.Status" \
        --output text 2>/dev/null || echo "NOT_FOUND")

    if [ "$status" == "Deployed" ]; then
        echo -e "${GREEN}✓ Distribution deployed${NC}"
        return 0
    else
        echo -e "${RED}✗ Distribution status: ${status}${NC}"
        ((ERRORS++))
        return 1
    fi
}

echo -e "${BLUE}Stack Health Checks:${NC}"
echo "─────────────────────────────────────────────────────────────────"

# Check all stacks
check_stack "${STACK_PREFIX}-database" "Database Stack"
check_stack "${STACK_PREFIX}-lambda" "Lambda Stack"
check_stack "${STACK_PREFIX}-appsync" "AppSync Stack"
check_stack "${STACK_PREFIX}-step-functions" "Step Functions Stack"

# Check web app stack if it exists
if aws cloudformation describe-stacks --stack-name "${STACK_PREFIX}-web-app" --region "$REGION" >/dev/null 2>&1; then
    check_stack "${STACK_PREFIX}-web-app" "Web App Stack"
    HAS_WEBAPP=true
fi

echo ""
echo -e "${BLUE}Resource Health Checks:${NC}"
echo "─────────────────────────────────────────────────────────────────"

# Test resources
TABLE_NAME="${STAGE}-main-table"
LAMBDA_NAME="${STAGE}-hello-world"

test_dynamodb "$TABLE_NAME"
test_lambda "$LAMBDA_NAME"

# Get API ID
API_ID=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_PREFIX}-appsync" \
    --query "Stacks[0].Outputs[?OutputKey=='GraphQLApiId'].OutputValue" \
    --output text 2>/dev/null || echo "")

if [ -n "$API_ID" ]; then
    test_appsync "$API_ID"
fi

# Test CloudFront if web app exists
if [ "$HAS_WEBAPP" == "true" ]; then
    DIST_ID=$(aws cloudformation describe-stacks \
        --stack-name "${STACK_PREFIX}-web-app" \
        --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
        --output text 2>/dev/null || echo "")

    if [ -n "$DIST_ID" ]; then
        test_cloudfront "$DIST_ID"
    fi
fi

echo ""
echo "─────────────────────────────────────────────────────────────────"

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed! Deployment is healthy.${NC}"
    exit 0
else
    echo -e "${RED}❌ Found $ERRORS error(s). Please review the deployment.${NC}"
    exit 1
fi
