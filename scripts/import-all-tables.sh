#!/bin/bash

# Import all existing DynamoDB tables into CloudFormation management
# Usage: ./scripts/import-all-tables.sh <stage>
# Example: ./scripts/import-all-tables.sh prod

set -e

STAGE=${1}
REGION=${AWS_REGION:-us-east-1}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -z "$STAGE" ]; then
    echo -e "${RED}❌ Error: Stage is required${NC}"
    echo "Usage: $0 <stage>"
    echo "Example: $0 prod"
    exit 1
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        Import All Existing Tables to CloudFormation           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Stage:${NC} $STAGE"
echo -e "${YELLOW}Region:${NC} $REGION"
echo ""

# Define tables and their stacks
declare -A TABLES=(
    ["${STAGE}-main-table"]="${STAGE}-aws-boilerplate-database:MainTable"
    ["${STAGE}-jira-uploads"]="${STAGE}-aws-boilerplate-jira-dashboard:JiraUploadsTable"
    ["${STAGE}-jira-issues"]="${STAGE}-aws-boilerplate-jira-dashboard:JiraIssuesTable"
)

# Check which tables exist and are orphaned
ORPHANED_TABLES=()

echo -e "${BLUE}📋 Checking for orphaned tables...${NC}\n"

for table_name in "${!TABLES[@]}"; do
    IFS=':' read -r stack_name logical_id <<< "${TABLES[$table_name]}"
    
    echo -e "${YELLOW}Checking: ${table_name}${NC}"
    
    # Check if table exists
    if ! aws dynamodb describe-table --table-name "$table_name" --region "$REGION" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓ Table does not exist (no import needed)${NC}\n"
        continue
    fi
    
    # Check if stack exists
    if ! aws cloudformation describe-stacks --stack-name "$stack_name" --region "$REGION" >/dev/null 2>&1; then
        echo -e "  ${YELLOW}⚠️  Stack does not exist - table will be imported during deployment${NC}\n"
        ORPHANED_TABLES+=("$table_name:$stack_name:$logical_id")
        continue
    fi
    
    # Check if table is managed by CloudFormation
    cf_table=$(aws cloudformation describe-stack-resources \
        --stack-name "$stack_name" \
        --region "$REGION" \
        --query "StackResources[?ResourceType=='AWS::DynamoDB::Table' && PhysicalResourceId=='${table_name}'].PhysicalResourceId" \
        --output text 2>/dev/null || echo "")
    
    if [ "$cf_table" = "$table_name" ]; then
        echo -e "  ${GREEN}✓ Already managed by CloudFormation${NC}\n"
    else
        echo -e "  ${RED}✗ Orphaned (exists but not managed by CloudFormation)${NC}\n"
        ORPHANED_TABLES+=("$table_name:$stack_name:$logical_id")
    fi
done

# Summary
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                        Summary                                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ ${#ORPHANED_TABLES[@]} -eq 0 ]; then
    echo -e "${GREEN}✅ All tables are either non-existent or already managed by CloudFormation${NC}"
    echo -e "${GREEN}No import needed!${NC}"
    exit 0
fi

echo -e "${YELLOW}Found ${#ORPHANED_TABLES[@]} orphaned table(s):${NC}"
for item in "${ORPHANED_TABLES[@]}"; do
    IFS=':' read -r table stack logical <<< "$item"
    echo -e "  • ${table} → ${stack}:${logical}"
done
echo ""

# Provide import options
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                   Import Options                               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Option 1: Manual CDK Import (Recommended - No Data Loss)${NC}"
echo -e "  This imports existing tables into CloudFormation management."
echo -e "  ${YELLOW}Steps:${NC}"
echo -e "    1. cd packages/infrastructure"
echo -e "    2. STAGE=$STAGE npx cdk import ${STAGE}-aws-boilerplate-database"
echo -e "       - Select 'MainTable' when prompted"
echo -e "    3. STAGE=$STAGE npx cdk import ${STAGE}-aws-boilerplate-jira-dashboard"
echo -e "       - Select 'JiraUploadsTable' and 'JiraIssuesTable' when prompted"
echo ""
echo -e "${YELLOW}Option 2: Delete and Recreate (Data Loss if tables have data!)${NC}"
echo -e "  This is what the cleanup script currently does."
echo -e "  ${YELLOW}Steps:${NC}"
echo -e "    1. Backup tables (if they have data):"
for item in "${ORPHANED_TABLES[@]}"; do
    IFS=':' read -r table stack logical <<< "$item"
    echo -e "       aws dynamodb scan --table-name $table > backup-$table.json"
done
echo -e "    2. Run cleanup: ./scripts/cleanup-orphaned-resources.sh $STAGE"
echo -e "    3. Run deployment: ./scripts/deploy-with-cleanup.sh $STAGE --webapp"
echo -e "    4. Restore data (if needed)"
echo ""
echo -e "${BLUE}Option 3: Use CloudFormation Import Change Set (Advanced)${NC}"
echo -e "  Manually create import change sets via AWS Console or CLI."
echo ""

# Offer automated import attempt
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Would you like to attempt automatic CDK import? (y/n)${NC}"
echo -e "${YELLOW}This will import all orphaned tables into CloudFormation.${NC}"
read -r response

if [[ "$response" =~ ^[Yy]$ ]]; then
    echo -e "\n${BLUE}🚀 Starting automated import...${NC}\n"
    
    cd packages/infrastructure
    
    # Group tables by stack
    declare -A STACK_TABLES
    for item in "${ORPHANED_TABLES[@]}"; do
        IFS=':' read -r table stack logical <<< "$item"
        if [ -z "${STACK_TABLES[$stack]}" ]; then
            STACK_TABLES[$stack]="$logical"
        else
            STACK_TABLES[$stack]="${STACK_TABLES[$stack]},$logical"
        fi
    done
    
    # Import each stack
    for stack in "${!STACK_TABLES[@]}"; do
        echo -e "${BLUE}Importing stack: ${stack}${NC}"
        echo -e "${YELLOW}Resources to import: ${STACK_TABLES[$stack]}${NC}"
        
        echo -e "\n${YELLOW}Note: CDK import is interactive. You'll need to:${NC}"
        echo -e "  1. Confirm the resources to import"
        echo -e "  2. Enter the physical resource identifier (table name)"
        echo -e "  3. Review the changes"
        echo ""
        
        # Run CDK import interactively
        STAGE=$STAGE npx cdk import "$stack" || {
            echo -e "${RED}✗ Import failed for $stack${NC}"
            echo -e "${YELLOW}You can retry manually with:${NC}"
            echo -e "  cd packages/infrastructure"
            echo -e "  STAGE=$STAGE npx cdk import $stack"
        }
        
        echo ""
    done
    
    echo -e "${GREEN}✅ Import process completed!${NC}"
    echo -e "${YELLOW}Verify the tables are now managed:${NC}"
    echo -e "  ./scripts/import-all-tables.sh $STAGE"
else
    echo -e "\n${YELLOW}Import cancelled.${NC}"
    echo -e "Tables remain orphaned. Choose one of the options above to proceed."
fi

echo ""
