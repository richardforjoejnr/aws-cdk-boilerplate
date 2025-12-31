#!/bin/bash

# Configure web app with API endpoints
# Usage: ./configure-webapp.sh [dev|test|prod]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🔧 Configuring web app for ${STAGE} environment${NC}\n"

STACK_PREFIX="${STAGE}-aws-boilerplate"

# Get AppSync API URL and Key
API_URL=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_PREFIX}-appsync" \
    --query "Stacks[0].Outputs[?OutputKey=='GraphQLApiUrl'].OutputValue" \
    --output text 2>/dev/null)

API_KEY=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_PREFIX}-appsync" \
    --query "Stacks[0].Outputs[?OutputKey=='GraphQLApiKey'].OutputValue" \
    --output text 2>/dev/null)

API_ID=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_PREFIX}-appsync" \
    --query "Stacks[0].Outputs[?OutputKey=='GraphQLApiId'].OutputValue" \
    --output text 2>/dev/null)

# Get Jira Dashboard API URL (if stack exists)
JIRA_API_URL=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_PREFIX}-jira-dashboard" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
    --output text 2>/dev/null || echo "")

# Validate we got the required values
if [ -z "$API_URL" ] || [ "$API_URL" == "None" ]; then
    echo -e "${RED}❌ Error: Could not retrieve API URL from CloudFormation${NC}"
    echo -e "${YELLOW}Stack: ${STACK_PREFIX}-appsync${NC}"
    exit 1
fi

if [ -z "$API_KEY" ] || [ "$API_KEY" == "None" ]; then
    echo -e "${RED}❌ Error: Could not retrieve API Key from CloudFormation${NC}"
    echo -e "${YELLOW}Stack: ${STACK_PREFIX}-appsync${NC}"
    exit 1
fi

# Create/Update .env file for web app
ENV_FILE="packages/web-app/.env.${STAGE}"

cat > "$ENV_FILE" << ENVEOF
VITE_STAGE=${STAGE}
VITE_AWS_REGION=${REGION}
VITE_GRAPHQL_API_URL=${API_URL}
VITE_GRAPHQL_API_KEY=${API_KEY}
VITE_GRAPHQL_API_ID=${API_ID}
VITE_JIRA_API_URL=${JIRA_API_URL}
ENVEOF

echo -e "${GREEN}✓ Configuration saved to ${ENV_FILE}${NC}"

# Also create .env file for Vite to use during build
cp "$ENV_FILE" "packages/web-app/.env"
echo -e "${GREEN}✓ Copied to packages/web-app/.env for Vite${NC}"

echo -e "${YELLOW}GraphQL API URL:${NC} $API_URL"
echo -e "${YELLOW}GraphQL API Key:${NC} $API_KEY"
if [ -n "$JIRA_API_URL" ]; then
    echo -e "${YELLOW}Jira API URL:${NC} $JIRA_API_URL"
fi
