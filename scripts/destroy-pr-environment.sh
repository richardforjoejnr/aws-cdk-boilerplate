#!/bin/bash

# Destroy a PR preview environment
# Usage: ./scripts/destroy-pr-environment.sh <pr-number>
# Example: ./scripts/destroy-pr-environment.sh 4

set -e

PR_NUMBER=${1}

if [ -z "$PR_NUMBER" ]; then
    echo "❌ Error: PR number is required"
    echo "Usage: ./scripts/destroy-pr-environment.sh <pr-number>"
    echo "Example: ./scripts/destroy-pr-environment.sh 4"
    exit 1
fi

STAGE="pr-${PR_NUMBER}"
REGION=${AWS_REGION:-us-east-1}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🗑️  Destroying PR-${PR_NUMBER} preview environment${NC}\n"

# Change to infrastructure directory
cd packages/infrastructure

# Destroy all stacks
echo -e "${YELLOW}Running: STAGE=${STAGE} npx cdk destroy --all --force${NC}\n"
STAGE=$STAGE npx cdk destroy --all --force

echo ""
echo -e "${GREEN}✅ PR-${PR_NUMBER} environment destroyed successfully!${NC}"
echo ""
echo -e "${BLUE}💡 Tip: Also check for orphaned resources:${NC}"
echo -e "   ./scripts/cleanup-orphaned-resources.sh ${STAGE}"
