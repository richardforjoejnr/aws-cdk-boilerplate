#!/bin/bash

# Import existing DynamoDB table into CloudFormation
# Usage: ./scripts/import-existing-table.sh <stage>
# Example: ./scripts/import-existing-table.sh pr-5

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
    echo "Example: $0 pr-5"
    exit 1
fi

TABLE_NAME="${STAGE}-main-table"
STACK_NAME="${STAGE}-aws-boilerplate-database"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          Import Existing Table to CloudFormation              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Stage:${NC} $STAGE"
echo -e "${YELLOW}Table:${NC} $TABLE_NAME"
echo -e "${YELLOW}Stack:${NC} $STACK_NAME"
echo -e "${YELLOW}Region:${NC} $REGION"
echo ""

# Step 1: Check if table exists
echo -e "${BLUE}📋 Step 1: Checking if table exists...${NC}"
if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Table exists${NC}"

    # Get table details
    ITEM_COUNT=$(aws dynamodb describe-table \
        --table-name "$TABLE_NAME" \
        --region "$REGION" \
        --query 'Table.ItemCount' \
        --output text)

    echo -e "  Items in table: ${ITEM_COUNT}"
else
    echo -e "${RED}✗ Table does not exist${NC}"
    echo -e "${YELLOW}No need to import. Run normal deployment.${NC}"
    exit 0
fi

# Step 2: Check if stack exists
echo -e "\n${BLUE}📋 Step 2: Checking if CloudFormation stack exists...${NC}"
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" >/dev/null 2>&1; then
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text)

    echo -e "${GREEN}✓ Stack exists${NC}"
    echo -e "  Stack status: ${STACK_STATUS}"

    # Check if table is already managed
    if aws cloudformation describe-stack-resources \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --logical-resource-id "MainTable" >/dev/null 2>&1; then

        echo -e "${GREEN}✓ Table is already managed by CloudFormation${NC}"
        echo -e "${YELLOW}No import needed.${NC}"
        exit 0
    fi
else
    echo -e "${YELLOW}⚠️  Stack does not exist${NC}"
    echo -e "${BLUE}Will create stack and import table...${NC}"
fi

# Step 3: Create resources-to-import file
echo -e "\n${BLUE}📋 Step 3: Creating import configuration...${NC}"

IMPORT_FILE="/tmp/resources-to-import-${STAGE}.json"

cat > "$IMPORT_FILE" << EOF
[
  {
    "ResourceType": "AWS::DynamoDB::Table",
    "LogicalResourceId": "MainTable",
    "ResourceIdentifier": {
      "TableName": "${TABLE_NAME}"
    }
  }
]
EOF

echo -e "${GREEN}✓ Import configuration created${NC}"
echo -e "${BLUE}Import file: ${IMPORT_FILE}${NC}"

# Step 4: Get current table schema
echo -e "\n${BLUE}📋 Step 4: Getting table schema...${NC}"

TABLE_SCHEMA=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query 'Table.{Keys:KeySchema,Attributes:AttributeDefinitions,BillingMode:BillingModeSummary.BillingMode,ProvisionedThroughput:ProvisionedThroughput}' \
    --output json)

echo -e "${GREEN}✓ Table schema retrieved${NC}"
echo "$TABLE_SCHEMA" | jq '.'

# Step 5: Instructions for manual import
echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                   Import Instructions                          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}CloudFormation resource import requires a template with matching properties.${NC}"
echo ""
echo -e "${BLUE}Option 1: Use CDK with cdk import (Recommended)${NC}"
echo -e "  1. Ensure your CDK stack matches the existing table configuration"
echo -e "  2. Run: ${GREEN}cd packages/infrastructure && STAGE=$STAGE npx cdk import${NC}"
echo -e "  3. Follow the prompts to import MainTable"
echo ""
echo -e "${BLUE}Option 2: Delete and recreate (Data Loss!)${NC}"
echo -e "  1. Backup data: ${GREEN}./scripts/backup-table.sh $STAGE${NC}"
echo -e "  2. Delete table: ${GREEN}aws dynamodb delete-table --table-name $TABLE_NAME${NC}"
echo -e "  3. Run deployment: ${GREEN}./scripts/deploy-with-cleanup.sh $STAGE --webapp${NC}"
echo ""
echo -e "${BLUE}Option 3: Continue without CloudFormation management${NC}"
echo -e "  The table will remain orphaned (not recommended)"
echo ""

# Step 6: Offer to run CDK import
echo -e "${YELLOW}Would you like to attempt CDK import now? (y/n)${NC}"
read -r response

if [[ "$response" =~ ^[Yy]$ ]]; then
    echo -e "\n${BLUE}🚀 Running CDK import...${NC}"

    cd packages/infrastructure

    # Generate import template
    echo -e "${BLUE}Generating CloudFormation template...${NC}"
    STAGE=$STAGE npx cdk synth --quiet > /tmp/template-${STAGE}.yaml

    echo -e "${GREEN}✓ Template generated${NC}"

    echo -e "\n${YELLOW}Manual steps required:${NC}"
    echo -e "1. Review the generated template: ${GREEN}/tmp/template-${STAGE}.yaml${NC}"
    echo -e "2. Ensure it matches your existing table configuration"
    echo -e "3. Run: ${GREEN}STAGE=$STAGE npx cdk import${NC}"
    echo -e "4. Select the MainTable resource when prompted"
    echo ""
else
    echo -e "\n${YELLOW}Import cancelled.${NC}"
    echo -e "Please choose one of the options above to proceed."
fi

echo ""
echo -e "${BLUE}💡 Tip: For future deployments, consider using separate tables per environment${NC}"
echo -e "${BLUE}   to avoid conflicts and simplify management.${NC}"
echo ""
