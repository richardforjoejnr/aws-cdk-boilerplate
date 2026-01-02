#!/bin/bash

# Cleanup all orphaned PR preview environments
# This script finds and destroys all resources from closed PRs

set -e

REGION=${AWS_REGION:-us-east-1}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        Cleanup All Orphaned PR Environments                    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Find all PR-prefixed resources

echo -e "${YELLOW}🔍 Scanning for orphaned PR resources...${NC}\n"

# 1. Find all PR DynamoDB tables
echo -e "${BLUE}━━━ DynamoDB Tables ━━━${NC}"
PR_TABLES=$(aws dynamodb list-tables \
    --region "$REGION" \
    --query 'TableNames[?starts_with(@, `pr-`)]' \
    --output text 2>/dev/null || echo "")

if [ -n "$PR_TABLES" ]; then
    echo -e "${YELLOW}Found PR tables:${NC}"
    for table in $PR_TABLES; do
        echo -e "  • $table"
    done
else
    echo -e "${GREEN}  ✓ No orphaned PR tables found${NC}"
fi

# 2. Find all PR S3 buckets
echo -e "\n${BLUE}━━━ S3 Buckets ━━━${NC}"
PR_BUCKETS=$(aws s3api list-buckets \
    --region "$REGION" \
    --query 'Buckets[?starts_with(Name, `pr-`)].Name' \
    --output text 2>/dev/null || echo "")

if [ -n "$PR_BUCKETS" ]; then
    echo -e "${YELLOW}Found PR buckets:${NC}"
    for bucket in $PR_BUCKETS; do
        echo -e "  • $bucket"
    done
else
    echo -e "${GREEN}  ✓ No orphaned PR buckets found${NC}"
fi

# 3. Find all PR Step Functions
echo -e "\n${BLUE}━━━ Step Functions ━━━${NC}"
PR_STATE_MACHINES=$(aws stepfunctions list-state-machines \
    --region "$REGION" \
    --query "stateMachines[?starts_with(name, 'pr-')].name" \
    --output text 2>/dev/null || echo "")

if [ -n "$PR_STATE_MACHINES" ]; then
    echo -e "${YELLOW}Found PR state machines:${NC}"
    for sm in $PR_STATE_MACHINES; do
        echo -e "  • $sm"
    done
else
    echo -e "${GREEN}  ✓ No orphaned PR state machines found${NC}"
fi

# 4. Find all PR CloudFormation stacks
echo -e "\n${BLUE}━━━ CloudFormation Stacks ━━━${NC}"
PR_STACKS=$(aws cloudformation list-stacks \
    --region "$REGION" \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE \
    --query 'StackSummaries[?starts_with(StackName, `pr-`)].StackName' \
    --output text 2>/dev/null || echo "")

if [ -n "$PR_STACKS" ]; then
    echo -e "${YELLOW}Found PR stacks:${NC}"
    for stack in $PR_STACKS; do
        echo -e "  • $stack"
    done
else
    echo -e "${GREEN}  ✓ No orphaned PR stacks found${NC}"
fi

# Ask for confirmation before cleanup
echo -e "\n${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${RED}⚠️  WARNING: This will DELETE all resources listed above!${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}\n"

read -p "Do you want to proceed with cleanup? (type 'yes' to confirm): " confirmation

if [ "$confirmation" != "yes" ]; then
    echo -e "${BLUE}Cleanup cancelled.${NC}"
    exit 0
fi

echo -e "\n${GREEN}Starting cleanup...${NC}\n"

# Extract unique PR numbers
PR_NUMBERS=$(echo "$PR_TABLES $PR_BUCKETS $PR_STATE_MACHINES $PR_STACKS" | \
    tr ' ' '\n' | \
    grep -E '^pr-[0-9]+' | \
    sed 's/pr-\([0-9]*\).*/\1/' | \
    sort -u)

if [ -z "$PR_NUMBERS" ]; then
    echo -e "${GREEN}✅ No PR environments to clean up!${NC}"
    exit 0
fi

echo -e "${YELLOW}Cleaning up PR environments: $(echo $PR_NUMBERS | tr '\n' ' ')${NC}\n"

CLEANUP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run cleanup for each PR
for pr_num in $PR_NUMBERS; do
    PR_ENV="pr-${pr_num}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Cleaning up environment: ${PR_ENV}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

    # Run the comprehensive cleanup script
    if [ -f "$CLEANUP_SCRIPT_DIR/cleanup-orphaned-resources.sh" ]; then
        "$CLEANUP_SCRIPT_DIR/cleanup-orphaned-resources.sh" "$PR_ENV" || echo -e "${YELLOW}  ⚠️  Cleanup had some errors, continuing...${NC}"
    else
        echo -e "${RED}  ✗ cleanup-orphaned-resources.sh not found!${NC}"
    fi

    echo ""
done

echo -e "\n${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                Cleanup Complete                                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo -e "${GREEN}✅ All orphaned PR environments have been cleaned up!${NC}\n"
