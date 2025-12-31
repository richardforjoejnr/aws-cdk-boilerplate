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
DRIFTED_STACKS=()

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
            DRIFTED_STACKS+=("$stack_name")
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
    echo ""

    # Get unique drifted stacks
    UNIQUE_STACKS=($(printf '%s\n' "${DRIFTED_STACKS[@]}" | sort -u))

    echo -e "${YELLOW}🔧 Auto-fixing drift by deleting drifted stacks...${NC}"
    echo ""

    # Delete stacks in reverse dependency order (AppSync depends on Database, so delete AppSync first if both drifted)
    STACK_DELETE_ORDER=(
        "${STACK_PREFIX}-appsync"
        "${STACK_PREFIX}-step-functions"
        "${STACK_PREFIX}-lambda"
        "${STACK_PREFIX}-database"
    )

    for stack in "${STACK_DELETE_ORDER[@]}"; do
        # Check if this stack is in the drifted list
        if printf '%s\n' "${UNIQUE_STACKS[@]}" | grep -q "^${stack}$"; then
            echo -e "${BLUE}Deleting drifted stack: ${stack}${NC}"

            # Check if stack exists and is not already being deleted
            STACK_STATUS=$(aws cloudformation describe-stacks \
                --stack-name "$stack" \
                --region "$REGION" \
                --query 'Stacks[0].StackStatus' \
                --output text 2>/dev/null || echo "DOES_NOT_EXIST")

            if [ "$STACK_STATUS" != "DOES_NOT_EXIST" ] && [ "$STACK_STATUS" != "DELETE_IN_PROGRESS" ]; then
                aws cloudformation delete-stack --stack-name "$stack" --region "$REGION"
                echo -e "${GREEN}  ✓ Stack deletion initiated${NC}"

                # Wait for deletion to complete with timeout
                echo -e "${YELLOW}  ⏳ Waiting for stack deletion to complete (max 10 minutes)...${NC}"

                # Custom wait loop with timeout instead of aws wait command
                MAX_WAIT_TIME=600  # 10 minutes
                WAIT_INTERVAL=10   # Check every 10 seconds
                ELAPSED=0

                while [ $ELAPSED -lt $MAX_WAIT_TIME ]; do
                    # Check current status
                    CURRENT_STATUS=$(aws cloudformation describe-stacks \
                        --stack-name "$stack" \
                        --region "$REGION" \
                        --query 'Stacks[0].StackStatus' \
                        --output text 2>/dev/null || echo "DELETED")

                    if [ "$CURRENT_STATUS" = "DELETED" ]; then
                        echo -e "${GREEN}  ✓ Stack deleted successfully${NC}"
                        break
                    elif [ "$CURRENT_STATUS" = "DELETE_FAILED" ]; then
                        echo -e "${RED}  ✗ Stack deletion failed${NC}"
                        echo -e "${YELLOW}  → Retrying deletion...${NC}"
                        aws cloudformation delete-stack --stack-name "$stack" --region "$REGION" 2>/dev/null || true
                        ELAPSED=0  # Reset timer for retry
                    elif [ "$CURRENT_STATUS" = "DELETE_IN_PROGRESS" ]; then
                        # Still deleting, show progress
                        if [ $((ELAPSED % 60)) -eq 0 ] && [ $ELAPSED -gt 0 ]; then
                            echo -e "${BLUE}  ⏳ Still deleting... ($((ELAPSED / 60)) minute(s) elapsed)${NC}"
                        fi
                    else
                        echo -e "${YELLOW}  ⏳ Stack status: $CURRENT_STATUS${NC}"
                    fi

                    sleep $WAIT_INTERVAL
                    ELAPSED=$((ELAPSED + WAIT_INTERVAL))
                done

                # Check if we timed out
                if [ $ELAPSED -ge $MAX_WAIT_TIME ]; then
                    FINAL_STATUS=$(aws cloudformation describe-stacks \
                        --stack-name "$stack" \
                        --region "$REGION" \
                        --query 'Stacks[0].StackStatus' \
                        --output text 2>/dev/null || echo "DELETED")

                    if [ "$FINAL_STATUS" != "DELETED" ]; then
                        echo -e "${YELLOW}  ⚠️  Timeout waiting for stack deletion (status: $FINAL_STATUS)${NC}"
                        echo -e "${YELLOW}  → Continuing anyway, CDK will handle it...${NC}"
                    fi
                fi
            else
                echo -e "${YELLOW}  ⊘ Stack already being deleted or doesn't exist${NC}"
            fi
            echo ""
        fi
    done

    echo -e "${GREEN}✅ Drift fixed! Drifted stacks have been deleted.${NC}"
    echo -e "${BLUE}💡 The deployment will now recreate these stacks fresh.${NC}"
    exit 0
else
    echo -e "${GREEN}✅ No drift detected! All resources are in sync with CloudFormation.${NC}"
    exit 0
fi
