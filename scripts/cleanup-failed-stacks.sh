#!/bin/bash

# Cleanup failed CloudFormation stacks
# Usage: ./cleanup-failed-stacks.sh [dev|test|prod]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Cleaning up failed stacks for stage: ${STAGE}${NC}\n"

STACK_PREFIX="${STAGE}-aws-boilerplate"

# Get all stacks with failed status
FAILED_STACKS=$(aws cloudformation list-stacks \
    --stack-status-filter \
        CREATE_FAILED \
        ROLLBACK_FAILED \
        ROLLBACK_COMPLETE \
        DELETE_FAILED \
        UPDATE_ROLLBACK_FAILED \
        UPDATE_ROLLBACK_COMPLETE \
    --region "$REGION" \
    --query "StackSummaries[?contains(StackName, '${STACK_PREFIX}')].{Name:StackName,Status:StackStatus}" \
    --output json)

if [ "$FAILED_STACKS" == "[]" ]; then
    echo -e "${GREEN}✓ No failed stacks found${NC}"
    exit 0
fi

echo -e "${RED}Found failed stacks:${NC}"
echo "$FAILED_STACKS" | jq -r '.[] | "  • \(.Name) (\(.Status))"'

echo ""
read -p "Do you want to delete these stacks? (y/N) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "$FAILED_STACKS" | jq -r '.[].Name' | while read stack; do
        echo -e "${YELLOW}Deleting stack: ${stack}${NC}"
        aws cloudformation delete-stack --stack-name "$stack" --region "$REGION" 2>/dev/null || true
    done
    echo -e "${GREEN}✓ Failed stacks deletion initiated${NC}"
else
    echo -e "${YELLOW}Cleanup cancelled${NC}"
fi
