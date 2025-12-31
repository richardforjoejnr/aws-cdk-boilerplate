#!/bin/bash

# Destroy Jira Dashboard
# Usage: ./scripts/destroy-jira-dashboard.sh <stage>
# Example: ./scripts/destroy-jira-dashboard.sh dev

set -e

STAGE=${1:-dev}

echo "==============================================="
echo "Destroying Jira Dashboard from ${STAGE}"
echo "==============================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if stage is provided
if [ -z "$STAGE" ]; then
    echo -e "${RED}Error: Stage not provided${NC}"
    echo "Usage: ./scripts/destroy-jira-dashboard.sh <stage>"
    exit 1
fi

echo -e "${YELLOW}⚠️  WARNING: This will destroy all Jira Dashboard resources in ${STAGE}${NC}"
echo -e "${YELLOW}This includes:${NC}"
echo -e "${YELLOW}  - DynamoDB tables (uploads and issues)${NC}"
echo -e "${YELLOW}  - S3 bucket with all uploaded CSVs${NC}"
echo -e "${YELLOW}  - Lambda functions${NC}"
echo -e "${YELLOW}  - API Gateway${NC}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r
echo

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo -e "${BLUE}Destruction cancelled${NC}"
    exit 0
fi

echo -e "${BLUE}Stage: ${STAGE}${NC}"
echo ""

# Step 1: Empty S3 bucket first (required before deletion)
echo -e "${BLUE}Step 1: Emptying S3 bucket...${NC}"
BUCKET_NAME="${STAGE}-jira-dashboard-csvs"

# Check if bucket exists
if aws s3 ls "s3://${BUCKET_NAME}" 2>&1 | grep -q 'NoSuchBucket'; then
    echo -e "${YELLOW}Bucket ${BUCKET_NAME} does not exist, skipping...${NC}"
else
    echo -e "${BLUE}Deleting all objects from ${BUCKET_NAME}...${NC}"
    aws s3 rm "s3://${BUCKET_NAME}" --recursive || echo -e "${YELLOW}No objects to delete${NC}"
    echo -e "${GREEN}✓ S3 bucket emptied${NC}"
fi
echo ""

# Step 2: Destroy the stack
echo -e "${BLUE}Step 2: Destroying CloudFormation stack...${NC}"
cd packages/infrastructure
STAGE=${STAGE} npx cdk destroy ${STAGE}-aws-boilerplate-jira-dashboard --force

echo -e "${GREEN}✓ Stack destroyed${NC}"
cd ../..
echo ""

echo ""
echo -e "${GREEN}===============================================${NC}"
echo -e "${GREEN}Destruction Complete!${NC}"
echo -e "${GREEN}===============================================${NC}"
echo ""
echo -e "${BLUE}All Jira Dashboard resources have been removed from ${STAGE}${NC}"
echo ""
