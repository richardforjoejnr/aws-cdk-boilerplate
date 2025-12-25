#!/bin/bash

# Destroy a specific environment (including preview environments)
# Usage: ./destroy-environment.sh [stage]

set -e

STAGE=${1}

if [ -z "$STAGE" ]; then
    echo "Usage: $0 [stage]"
    echo "Example: $0 pr-123"
    exit 1
fi

REGION=${AWS_REGION:-us-east-1}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          Destroying Environment: $STAGE                       "
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${YELLOW}Stage:${NC} $STAGE"
echo -e "${YELLOW}Region:${NC} $REGION"
echo ""

# Check AWS credentials
echo -e "${BLUE}🔐 Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    exit 1
fi
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}✓ Using AWS Account: ${ACCOUNT_ID}${NC}\n"

# Get stack prefix
STACK_PREFIX="${STAGE}-aws-boilerplate"

# List all stacks for this environment
echo -e "${BLUE}📋 Finding stacks for environment: ${STAGE}${NC}"
STACKS=$(aws cloudformation list-stacks \
    --region "$REGION" \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE \
    --query "StackSummaries[?starts_with(StackName, '${STACK_PREFIX}')].StackName" \
    --output text)

if [ -z "$STACKS" ]; then
    echo -e "${YELLOW}⚠️  No stacks found for environment: ${STAGE}${NC}"
    echo -e "${GREEN}Environment may already be destroyed${NC}"
    exit 0
fi

echo -e "${YELLOW}Found stacks:${NC}"
for stack in $STACKS; do
    echo -e "  - $stack"
done
echo ""

# Destroy stacks in reverse order
echo -e "${BLUE}🗑️  Destroying stacks...${NC}\n"

# Stack destruction order (reverse of creation)
DESTROY_ORDER=(
    "${STACK_PREFIX}-web-app"
    "${STACK_PREFIX}-step-functions"
    "${STACK_PREFIX}-appsync"
    "${STACK_PREFIX}-lambda"
    "${STACK_PREFIX}-database"
)

for stack in "${DESTROY_ORDER[@]}"; do
    # Check if stack exists
    if aws cloudformation describe-stacks --stack-name "$stack" --region "$REGION" >/dev/null 2>&1; then
        echo -e "${YELLOW}Deleting stack: ${stack}${NC}"

        aws cloudformation delete-stack --stack-name "$stack" --region "$REGION"

        # Wait for deletion (with timeout)
        echo -e "${YELLOW}  → Waiting for deletion to complete...${NC}"
        if aws cloudformation wait stack-delete-complete --stack-name "$stack" --region "$REGION" 2>/dev/null; then
            echo -e "${GREEN}  ✓ Stack deleted: ${stack}${NC}\n"
        else
            echo -e "${YELLOW}  ⚠️  Stack deletion timed out or failed: ${stack}${NC}"
            echo -e "${YELLOW}  → Check CloudFormation console for details${NC}\n"
        fi
    else
        echo -e "${GREEN}  ✓ Stack does not exist: ${stack}${NC}\n"
    fi
done

echo -e "${GREEN}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║              Environment Destroyed Successfully                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${BLUE}💡 Tip: Run cleanup script to remove any orphaned resources:${NC}"
echo -e "  ./scripts/cleanup-orphaned-resources.sh $STAGE"
echo ""
