#!/bin/bash

# Fix CloudFormation drift by detecting and re-creating missing resources
# Usage: ./fix-cloudformation-drift.sh [dev|test|prod]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔍 Detecting CloudFormation drift for ${STAGE} environment${NC}\n"

STACK_PREFIX="${STAGE}-aws-boilerplate"
DRIFT_DETECTED=false

# Function to check if a stack has drift
check_stack_drift() {
    local stack_name=$1
    local resource_type=$2
    local physical_id=$3

    echo -e "${YELLOW}Checking ${stack_name}...${NC}"

    # Check if stack exists
    if ! aws cloudformation describe-stacks --stack-name "$stack_name" --region "$REGION" >/dev/null 2>&1; then
        echo -e "${RED}  ✗ Stack does not exist${NC}"
        return 0
    fi

    # Get stack resources
    local resources=$(aws cloudformation describe-stack-resources \
        --stack-name "$stack_name" \
        --region "$REGION" \
        --query "StackResources[?ResourceType=='${resource_type}'].PhysicalResourceId" \
        --output text 2>/dev/null)

    if [ -z "$resources" ]; then
        echo -e "${GREEN}  ✓ No resources of type ${resource_type}${NC}"
        return 0
    fi

    # Check if the actual resource exists
    for resource_id in $resources; do
        local exists=false

        case "$resource_type" in
            "AWS::DynamoDB::Table")
                if aws dynamodb describe-table --table-name "$resource_id" --region "$REGION" >/dev/null 2>&1; then
                    exists=true
                fi
                ;;
            "AWS::Logs::LogGroup")
                if aws logs describe-log-groups --log-group-name-prefix "$resource_id" --region "$REGION" 2>/dev/null | grep -q "$resource_id"; then
                    exists=true
                fi
                ;;
        esac

        if [ "$exists" = false ]; then
            echo -e "${RED}  ✗ DRIFT DETECTED: Resource ${resource_id} does not exist but stack thinks it does${NC}"
            DRIFT_DETECTED=true
            return 1
        else
            echo -e "${GREEN}  ✓ Resource ${resource_id} exists${NC}"
        fi
    done

    return 0
}

# Check database stack
check_stack_drift "${STACK_PREFIX}-database" "AWS::DynamoDB::Table" || true

# Check lambda stack  
check_stack_drift "${STACK_PREFIX}-lambda" "AWS::Logs::LogGroup" || true

# Check step functions stack
check_stack_drift "${STACK_PREFIX}-step-functions" "AWS::Logs::LogGroup" || true

echo ""

if [ "$DRIFT_DETECTED" = true ]; then
    echo -e "${RED}❌ Drift detected! CloudFormation stacks are out of sync with actual resources.${NC}"
    echo -e "${YELLOW}📋 Recommended fix:${NC}"
    echo -e "${YELLOW}   1. Delete the drifted stack(s) to remove the drift${NC}"
    echo -e "${YELLOW}   2. Redeploy to recreate everything fresh${NC}"
    echo ""
    echo -e "${BLUE}Run this command to fix:${NC}"
    echo -e "${GREEN}   ./scripts/fix-drift-and-redeploy.sh ${STAGE}${NC}"
    exit 1
else
    echo -e "${GREEN}✅ No drift detected! All resources are in sync with CloudFormation.${NC}"
    exit 0
fi
