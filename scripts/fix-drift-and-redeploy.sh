#!/bin/bash

# Fix CloudFormation drift and redeploy
# Usage: ./fix-drift-and-redeploy.sh [dev|test|prod]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║            Fix CloudFormation Drift & Redeploy                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

STACK_PREFIX="${STAGE}-aws-boilerplate"

# Function to safely delete and recreate a stack
fix_drifted_stack() {
    local stack_name=$1

    echo -e "\n${YELLOW}Checking ${stack_name}...${NC}"

    if ! aws cloudformation describe-stacks --stack-name "$stack_name" --region "$REGION" >/dev/null 2>&1; then
        echo -e "${GREEN}  ✓ Stack does not exist, will be created fresh${NC}"
        return 0
    fi

    # Detect drift
    echo -e "${YELLOW}  → Initiating drift detection...${NC}"
    local drift_id=$(aws cloudformation detect-stack-drift \
        --stack-name "$stack_name" \
        --region "$REGION" \
        --query 'StackDriftDetectionId' \
        --output text 2>/dev/null || echo "")

    if [ -n "$drift_id" ]; then
        # Wait for drift detection
        sleep 5
        local drift_status=$(aws cloudformation describe-stack-drift-detection-status \
            --stack-drift-detection-id "$drift_id" \
            --region "$REGION" \
            --query 'StackDriftStatus' \
            --output text 2>/dev/null || echo "UNKNOWN")

        if [ "$drift_status" = "DRIFTED" ]; then
            echo -e "${RED}  ✗ Stack has drift, deleting and will recreate...${NC}"

            # Delete the stack
            aws cloudformation delete-stack --stack-name "$stack_name" --region "$REGION"
            echo -e "${YELLOW}  → Waiting for stack deletion...${NC}"
            aws cloudformation wait stack-delete-complete --stack-name "$stack_name" --region "$REGION" 2>/dev/null || sleep 30
            echo -e "${GREEN}  ✓ Stack deleted${NC}"
        else
            echo -e "${GREEN}  ✓ No drift detected${NC}"
        fi
    fi
}

# Fix drifted stacks in order
echo -e "${BLUE}Step 1: Detecting and fixing drift${NC}"
fix_drifted_stack "${STACK_PREFIX}-database"

echo -e "\n${BLUE}Step 2: Redeploying infrastructure${NC}"
cd "$(dirname "$0")/.."
./scripts/deploy-with-cleanup.sh "$STAGE"

echo -e "\n${GREEN}✅ Drift fixed and infrastructure redeployed!${NC}"
