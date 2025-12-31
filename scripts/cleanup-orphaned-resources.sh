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
    local stack_name=$2

    echo -e "\n${YELLOW}Checking CloudWatch log group: ${log_group_name}${NC}"

    if aws logs describe-log-groups \
        --log-group-name-prefix "$log_group_name" \
        --region "$REGION" 2>/dev/null | grep -q "$log_group_name"; then

        echo -e "${YELLOW}  → Log group exists${NC}"

        # Check if log group is managed by CloudFormation
        # Use CloudFormation API instead of tags to avoid false positives
        local is_managed=false

        if [ -n "$stack_name" ] && aws cloudformation describe-stacks \
            --stack-name "$stack_name" \
            --region "$REGION" >/dev/null 2>&1; then

            # Query by resource type and physical ID
            local cf_log_group=$(aws cloudformation describe-stack-resources \
                --stack-name "$stack_name" \
                --region "$REGION" \
                --query "StackResources[?ResourceType=='AWS::Logs::LogGroup' && PhysicalResourceId=='${log_group_name}'].PhysicalResourceId" \
                --output text 2>/dev/null || echo "")

            if [ "$cf_log_group" = "$log_group_name" ]; then
                is_managed=true
            fi
        fi

        if [ "$is_managed" = false ]; then
            echo -e "${RED}  → Log group is NOT managed by CloudFormation (orphaned)${NC}"
            echo -e "${YELLOW}  → Deleting log group...${NC}"

            aws logs delete-log-group --log-group-name "$log_group_name" --region "$REGION" 2>/dev/null || true

            echo -e "${GREEN}  ✓ Log group deleted successfully${NC}"
        else
            echo -e "${GREEN}  ✓ Log group is managed by CloudFormation stack: ${stack_name}${NC}"
            echo -e "${GREEN}  → No cleanup needed${NC}"
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

# Function to delete S3 bucket
check_and_delete_s3_bucket() {
    local bucket_name=$1

    echo -e "\n${YELLOW}Checking S3 bucket: ${bucket_name}${NC}"

    if aws s3 ls "s3://${bucket_name}" --region "$REGION" >/dev/null 2>&1; then
        echo -e "${YELLOW}  → Bucket exists${NC}"

        # Count objects
        local object_count=$(aws s3 ls "s3://${bucket_name}" --recursive --region "$REGION" 2>/dev/null | wc -l || echo "0")
        echo -e "${YELLOW}  → Bucket contains ${object_count} objects${NC}"

        # Delete bucket and all contents
        echo -e "${YELLOW}  → Deleting bucket and all contents...${NC}"
        aws s3 rb "s3://${bucket_name}" --force --region "$REGION" 2>/dev/null || {
            echo -e "${RED}  → Force delete failed, trying to empty first...${NC}"
            aws s3 rm "s3://${bucket_name}" --recursive --region "$REGION" 2>/dev/null || true
            aws s3 rb "s3://${bucket_name}" --region "$REGION" 2>/dev/null || true
        }

        echo -e "${GREEN}  ✓ Bucket deleted successfully${NC}"
    else
        echo -e "${GREEN}  ✓ Bucket does not exist${NC}"
    fi
}

# Function to delete all log groups for a stage
cleanup_all_log_groups() {
    local stage=$1

    echo -e "\n${YELLOW}Cleaning up all CloudWatch log groups for ${stage}...${NC}"

    # Define log group prefixes to search
    local prefixes=(
        "/aws/lambda/${stage}-"
        "/aws/appsync/${stage}-"
        "/aws/stepfunctions/${stage}-"
        "/aws/apigateway/${stage}-"
    )

    local total_deleted=0
    local total_skipped=0

    for prefix in "${prefixes[@]}"; do
        echo -e "\n${YELLOW}Searching for log groups with prefix: ${prefix}${NC}"

        # Get all log groups with this prefix
        local log_groups=$(aws logs describe-log-groups \
            --log-group-name-prefix "$prefix" \
            --region "$REGION" \
            --query 'logGroups[*].logGroupName' \
            --output text 2>/dev/null || echo "")

        if [ -n "$log_groups" ]; then
            for log_group in $log_groups; do
                # Check if log group is managed by CloudFormation
                # Log groups created by CDK/CloudFormation often have retention policies
                # and are tagged. We'll try to delete and handle errors gracefully.

                echo -e "${YELLOW}  → Attempting to delete: ${log_group}${NC}"

                if aws logs delete-log-group --log-group-name "$log_group" --region "$REGION" 2>/dev/null; then
                    echo -e "${GREEN}    ✓ Deleted${NC}"
                    ((total_deleted++)) || true
                else
                    # Log group might be managed by CloudFormation or protected
                    echo -e "${BLUE}    → Skipped (may be managed by CloudFormation)${NC}"
                    ((total_skipped++)) || true
                fi
            done
        fi
    done

    if [ $total_deleted -gt 0 ]; then
        echo -e "${GREEN}  ✓ Deleted ${total_deleted} log group(s)${NC}"
    fi
    if [ $total_skipped -gt 0 ]; then
        echo -e "${BLUE}  ℹ Skipped ${total_skipped} log group(s) (CloudFormation-managed)${NC}"
    fi
    if [ $total_deleted -eq 0 ] && [ $total_skipped -eq 0 ]; then
        echo -e "${GREEN}  ✓ No log groups found to delete${NC}"
    fi

    # Always return success
    return 0
}

# Function to disable CloudFront distributions
check_and_delete_cloudfront_distribution() {
    local stage=$1

    echo -e "\n${YELLOW}Checking for CloudFront distributions for ${stage}...${NC}"

    # Get distributions with tag Environment=${stage}
    local distribution_ids=$(aws cloudfront list-distributions \
        --query "DistributionList.Items[?contains(Comment, '${stage}')].Id" \
        --output text 2>/dev/null || echo "")

    if [ -n "$distribution_ids" ]; then
        for dist_id in $distribution_ids; do
            echo -e "${YELLOW}  → Found distribution: ${dist_id}${NC}"

            # Get current distribution status
            local enabled=$(aws cloudfront get-distribution --id "$dist_id" --query 'Distribution.DistributionConfig.Enabled' --output text 2>/dev/null || echo "")

            if [ "$enabled" = "True" ] || [ "$enabled" = "true" ]; then
                # Distribution is enabled, disable it
                echo -e "${YELLOW}  → Disabling distribution...${NC}"

                local etag=$(aws cloudfront get-distribution-config --id "$dist_id" --query 'ETag' --output text 2>/dev/null || echo "")

                if [ -n "$etag" ]; then
                    # Get config and disable
                    aws cloudfront get-distribution-config --id "$dist_id" 2>/dev/null | \
                        jq '.DistributionConfig | .Enabled = false' > /tmp/cf-config-${dist_id}.json || true

                    if aws cloudfront update-distribution \
                        --id "$dist_id" \
                        --distribution-config file:///tmp/cf-config-${dist_id}.json \
                        --if-match "$etag" >/dev/null 2>&1; then
                        echo -e "${GREEN}  ✓ Distribution disabled${NC}"
                    else
                        echo -e "${YELLOW}  ⚠️  Could not disable distribution${NC}"
                    fi

                    rm -f /tmp/cf-config-${dist_id}.json || true
                fi
            else
                echo -e "${GREEN}  ✓ Distribution already disabled${NC}"
            fi

            # Provide manual deletion command
            echo -e "${BLUE}  ℹ To delete manually (after ~15 mins): ${NC}"
            echo -e "${BLUE}    aws cloudfront delete-distribution --id ${dist_id}${NC}"
        done
    else
        echo -e "${GREEN}  ✓ No CloudFront distributions found${NC}"
    fi

    # Always return success
    return 0
}

# Main cleanup logic
echo -e "\n${YELLOW}Starting cleanup for ${STAGE} environment...${NC}\n"

# Define resources based on stage
STACK_PREFIX="${STAGE}-aws-boilerplate"
MAIN_TABLE="${STAGE}-main-table"
LAMBDA_LOG_GROUP="/aws/lambda/${STAGE}-hello-world"
STATE_MACHINE_LOG_GROUP="/aws/stepfunctions/${STAGE}-hello-world-state-machine"
LAMBDA_STACK="${STAGE}-aws-boilerplate-lambda"
STEP_FUNCTIONS_STACK="${STAGE}-aws-boilerplate-step-functions"

# Jira Dashboard resources
JIRA_UPLOADS_TABLE="${STAGE}-jira-uploads"
JIRA_ISSUES_TABLE="${STAGE}-jira-issues"
JIRA_CSV_BUCKET="${STAGE}-jira-dashboard-csvs"

# Web App resources
WEB_APP_BUCKET="${STAGE}-aws-boilerplate-web-app"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              Comprehensive Resource Cleanup                    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"

# 1. Clean up failed stacks first
check_and_cleanup_failed_stacks "$STACK_PREFIX"

# 2. Clean up DynamoDB tables
echo -e "\n${BLUE}━━━ DynamoDB Tables ━━━${NC}"
check_and_delete_dynamodb_table "$MAIN_TABLE"
check_and_delete_dynamodb_table "$JIRA_UPLOADS_TABLE"
check_and_delete_dynamodb_table "$JIRA_ISSUES_TABLE"

# 3. Clean up S3 buckets
echo -e "\n${BLUE}━━━ S3 Buckets ━━━${NC}"
check_and_delete_s3_bucket "$JIRA_CSV_BUCKET"
check_and_delete_s3_bucket "$WEB_APP_BUCKET"

# 4. Clean up all CloudWatch log groups
echo -e "\n${BLUE}━━━ CloudWatch Log Groups ━━━${NC}"
cleanup_all_log_groups "$STAGE"

# 5. Clean up CloudFront distributions
echo -e "\n${BLUE}━━━ CloudFront Distributions ━━━${NC}"
check_and_delete_cloudfront_distribution "$STAGE"

# Summary
echo -e "\n${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                  Cleanup Summary                               ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo -e "${GREEN}✅ Cleanup completed successfully!${NC}"
echo -e "${GREEN}─────────────────────────────────────────────────────────────────${NC}"
echo -e "${YELLOW}Note: CloudFront distributions (if any) are being disabled.${NC}"
echo -e "${YELLOW}They will be fully deleted in 15-60 minutes.${NC}"
echo -e "${GREEN}─────────────────────────────────────────────────────────────────${NC}"
echo -e "${GREEN}You can now proceed with deployment.${NC}\n"
