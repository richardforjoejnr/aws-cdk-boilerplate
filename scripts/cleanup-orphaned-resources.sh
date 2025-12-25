#!/bin/bash

# Cleanup orphaned resources before CDK deployment
# This script removes resources that exist outside of CloudFormation management
# and would cause deployment failures

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

echo "🧹 Cleaning up orphaned resources for stage: $STAGE in region: $REGION"
echo "─────────────────────────────────────────────────────────────────"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if resource exists
check_and_delete_dynamodb_table() {
    local table_name=$1

    echo -e "\n${YELLOW}Checking DynamoDB table: ${table_name}${NC}"

    if aws dynamodb describe-table --table-name "$table_name" --region "$REGION" >/dev/null 2>&1; then
        echo -e "${YELLOW}  → Table exists. Checking if it's managed by CloudFormation...${NC}"

        # Check if table is managed by CloudFormation
        # Use CloudFormation API instead of tags to avoid false positives
        local cf_stack_name="${STAGE}-aws-boilerplate-database"
        local is_managed=false

        # Query by resource type and physical ID since logical ID has a hash suffix
        if aws cloudformation describe-stacks \
            --stack-name "$cf_stack_name" \
            --region "$REGION" >/dev/null 2>&1; then
            # Stack exists, check if this table is managed by it
            local cf_table_name=$(aws cloudformation describe-stack-resources \
                --stack-name "$cf_stack_name" \
                --region "$REGION" \
                --query "StackResources[?ResourceType=='AWS::DynamoDB::Table' && PhysicalResourceId=='${table_name}'].PhysicalResourceId" \
                --output text 2>/dev/null || echo "")

            if [ "$cf_table_name" = "$table_name" ]; then
                is_managed=true
            fi
        fi

        if [ "$is_managed" = false ]; then
            echo -e "${RED}  → Table is NOT managed by CloudFormation (orphaned)${NC}"

            # Check if table has data
            local item_count=$(aws dynamodb scan \
                --table-name "$table_name" \
                --select COUNT \
                --region "$REGION" \
                --output json | jq -r '.Count')

            echo -e "${YELLOW}  → Table contains ${item_count} items${NC}"

            if [ "$item_count" -gt 0 ]; then
                echo -e "${RED}  ⚠️  WARNING: Table contains data! Cannot proceed with cleanup.${NC}"
                echo ""
                echo -e "${YELLOW}╔════════════════════════════════════════════════════════════════╗${NC}"
                echo -e "${YELLOW}║                  Orphaned Table with Data                      ║${NC}"
                echo -e "${YELLOW}╚════════════════════════════════════════════════════════════════╝${NC}"
                echo ""
                echo -e "${BLUE}The table '${table_name}' exists but is not managed by CloudFormation.${NC}"
                echo -e "${BLUE}It contains ${item_count} items and cannot be automatically deleted.${NC}"
                echo ""
                echo -e "${YELLOW}Options:${NC}"
                echo ""
                echo -e "${GREEN}Option 1: Import table into CloudFormation (Recommended - No data loss)${NC}"
                echo -e "  Run: ${BLUE}./scripts/import-existing-table.sh ${STAGE}${NC}"
                echo -e "  This will adopt the existing table into CloudFormation management."
                echo ""
                echo -e "${GREEN}Option 2: Backup and recreate (Safe but slower)${NC}"
                echo -e "  1. Backup: ${BLUE}./scripts/backup-table.sh ${STAGE}${NC}"
                echo -e "  2. Delete: ${BLUE}aws dynamodb delete-table --table-name ${table_name}${NC}"
                echo -e "  3. Deploy: ${BLUE}./scripts/deploy-with-cleanup.sh ${STAGE} --webapp${NC}"
                echo -e "  4. Restore: ${BLUE}./scripts/restore-table.sh ${STAGE}${NC}"
                echo ""
                echo -e "${YELLOW}Option 3: Manual deletion (Data loss!)${NC}"
                echo -e "  ${RED}aws dynamodb delete-table --table-name ${table_name}${NC}"
                echo ""
                echo -e "${YELLOW}╚════════════════════════════════════════════════════════════════╝${NC}"
                echo ""
                return 1
            fi

            # Disable deletion protection if enabled
            echo -e "${YELLOW}  → Disabling deletion protection...${NC}"
            aws dynamodb update-table \
                --table-name "$table_name" \
                --no-deletion-protection-enabled \
                --region "$REGION" >/dev/null 2>&1 || true

            # Delete the table
            echo -e "${YELLOW}  → Deleting table...${NC}"
            aws dynamodb delete-table --table-name "$table_name" --region "$REGION" >/dev/null

            # Wait for deletion
            echo -e "${YELLOW}  → Waiting for deletion to complete...${NC}"
            aws dynamodb wait table-not-exists --table-name "$table_name" --region "$REGION" 2>/dev/null || sleep 10

            echo -e "${GREEN}  ✓ Table deleted successfully${NC}"
        else
            echo -e "${GREEN}  ✓ Table is managed by CloudFormation stack: ${cf_stack_name}${NC}"
            echo -e "${GREEN}  → No cleanup needed${NC}"
        fi
    else
        echo -e "${GREEN}  ✓ Table does not exist${NC}"
    fi
}

# Function to delete log group
check_and_delete_log_group() {
    local log_group_name=$1

    echo -e "\n${YELLOW}Checking CloudWatch log group: ${log_group_name}${NC}"

    if aws logs describe-log-groups \
        --log-group-name-prefix "$log_group_name" \
        --region "$REGION" 2>/dev/null | grep -q "$log_group_name"; then

        echo -e "${YELLOW}  → Log group exists${NC}"

        # Check if log group is managed by CloudFormation
        local tags=$(aws logs list-tags-log-group \
            --log-group-name "$log_group_name" \
            --region "$REGION" 2>/dev/null | jq -r '.tags["aws:cloudformation:stack-name"] // empty' || echo "")

        if [ -z "$tags" ]; then
            echo -e "${RED}  → Log group is NOT managed by CloudFormation (orphaned)${NC}"
            echo -e "${YELLOW}  → Deleting log group...${NC}"

            aws logs delete-log-group --log-group-name "$log_group_name" --region "$REGION" 2>/dev/null || true

            echo -e "${GREEN}  ✓ Log group deleted successfully${NC}"
        else
            echo -e "${GREEN}  ✓ Log group is managed by CloudFormation${NC}"
        fi
    else
        echo -e "${GREEN}  ✓ Log group does not exist${NC}"
    fi
}

# Function to check and clean up failed stacks
check_and_cleanup_failed_stacks() {
    local stack_prefix=$1

    echo -e "\n${YELLOW}Checking for failed CloudFormation stacks...${NC}"

    # Get failed stacks
    local failed_stacks=$(aws cloudformation list-stacks \
        --stack-status-filter CREATE_FAILED ROLLBACK_FAILED ROLLBACK_COMPLETE DELETE_FAILED UPDATE_ROLLBACK_FAILED UPDATE_ROLLBACK_COMPLETE \
        --region "$REGION" \
        --query "StackSummaries[?contains(StackName, '${stack_prefix}')].StackName" \
        --output text)

    if [ -n "$failed_stacks" ]; then
        echo -e "${RED}  → Found failed stacks:${NC}"
        for stack in $failed_stacks; do
            echo -e "${YELLOW}    • $stack${NC}"
            echo -e "${YELLOW}      Deleting failed stack...${NC}"
            aws cloudformation delete-stack --stack-name "$stack" --region "$REGION" 2>/dev/null || true
        done
        echo -e "${GREEN}  ✓ Failed stacks deleted${NC}"
    else
        echo -e "${GREEN}  ✓ No failed stacks found${NC}"
    fi
}

# Main cleanup logic
echo -e "\n${YELLOW}Starting cleanup for ${STAGE} environment...${NC}\n"

# Define resources based on stage
STACK_PREFIX="${STAGE}-aws-boilerplate"
MAIN_TABLE="${STAGE}-main-table"
LAMBDA_LOG_GROUP="/aws/lambda/${STAGE}-hello-world"
STATE_MACHINE_LOG_GROUP="/aws/stepfunctions/${STAGE}-hello-world-state-machine"

# Clean up orphaned resources
check_and_cleanup_failed_stacks "$STACK_PREFIX"
check_and_delete_dynamodb_table "$MAIN_TABLE"
check_and_delete_log_group "$LAMBDA_LOG_GROUP"
check_and_delete_log_group "$STATE_MACHINE_LOG_GROUP"

echo -e "\n${GREEN}✅ Cleanup completed successfully!${NC}"
echo -e "${GREEN}─────────────────────────────────────────────────────────────────${NC}"
echo -e "${GREEN}You can now proceed with deployment.${NC}\n"
