#!/bin/bash

# Cleanup Failed CloudFormation Stacks and Orphaned Resources
# Usage: ./scripts/cleanup-failed-stacks.sh [dev|test|prod]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

echo "🧹 Cleaning up failed stacks for stage: $STAGE"
echo "Region: $REGION"
echo ""

# Function to check if table exists and delete it
cleanup_table() {
    local TABLE_NAME=$1

    if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" &>/dev/null; then
        echo "📊 Found orphaned table: $TABLE_NAME"

        # Check if deletion protection is enabled
        DELETION_PROTECTED=$(aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" --query 'Table.DeletionProtectionEnabled' --output text)

        if [ "$DELETION_PROTECTED" == "True" ]; then
            echo "   🔓 Disabling deletion protection..."
            aws dynamodb update-table --table-name "$TABLE_NAME" --region "$REGION" --no-deletion-protection-enabled &>/dev/null
            sleep 2
        fi

        echo "   🗑️  Deleting table..."
        aws dynamodb delete-table --table-name "$TABLE_NAME" --region "$REGION" &>/dev/null
        echo "   ✅ Table deletion initiated"
    else
        echo "✅ No orphaned table: $TABLE_NAME"
    fi
}

# Function to delete orphaned log groups
cleanup_log_group() {
    local LOG_GROUP_NAME=$1

    if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP_NAME" --region "$REGION" --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$LOG_GROUP_NAME"; then
        echo "📝 Found orphaned log group: $LOG_GROUP_NAME"
        aws logs delete-log-group --log-group-name "$LOG_GROUP_NAME" --region "$REGION" &>/dev/null
        echo "   ✅ Log group deleted"
    else
        echo "✅ No orphaned log group: $LOG_GROUP_NAME"
    fi
}

# Function to delete orphaned Lambda functions
cleanup_lambda() {
    local FUNCTION_NAME=$1

    if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &>/dev/null; then
        echo "λ Found orphaned Lambda: $FUNCTION_NAME"
        aws lambda delete-function --function-name "$FUNCTION_NAME" --region "$REGION" &>/dev/null
        echo "   ✅ Lambda function deleted"
    else
        echo "✅ No orphaned Lambda: $FUNCTION_NAME"
    fi
}

# Function to delete failed CloudFormation stacks
cleanup_stack() {
    local STACK_NAME=$1

    STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")

    if [[ "$STACK_STATUS" == "ROLLBACK_COMPLETE" ]] || [[ "$STACK_STATUS" == "CREATE_FAILED" ]] || [[ "$STACK_STATUS" == "REVIEW_IN_PROGRESS" ]]; then
        echo "🗑️  Deleting failed stack: $STACK_NAME (Status: $STACK_STATUS)"
        aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
        echo "   ✅ Stack deletion initiated"
    elif [[ "$STACK_STATUS" == "NOT_FOUND" ]]; then
        echo "✅ Stack not found: $STACK_NAME"
    else
        echo "ℹ️  Stack exists with status: $STACK_STATUS - $STACK_NAME"
    fi
}

# Cleanup orphaned resources
echo "Step 1: Checking for orphaned resources..."
echo "==========================================="
cleanup_table "${STAGE}-main-table"
cleanup_lambda "${STAGE}-hello-world"
cleanup_log_group "/aws/lambda/${STAGE}-hello-world"
cleanup_log_group "/aws/appsync/apis"  # AppSync logs (if any)
echo ""

# Cleanup failed stacks
echo "Step 2: Checking for failed CloudFormation stacks..."
echo "====================================================="
cleanup_stack "${STAGE}-aws-boilerplate-database"
cleanup_stack "${STAGE}-aws-boilerplate-lambda"
cleanup_stack "${STAGE}-aws-boilerplate-appsync"
cleanup_stack "${STAGE}-aws-boilerplate-step-functions"
echo ""

echo "🎉 Cleanup complete for stage: $STAGE"
echo ""
echo "Note: Resources may take a few minutes to fully delete."
echo "You can monitor deletion with: aws cloudformation list-stacks --region $REGION"
