#!/bin/bash

# Configure web app with API endpoints
# Usage: ./configure-webapp.sh [dev|test|prod]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

# Colors
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

# Create/Update .env file for web app
ENV_FILE="packages/web-app/.env.${STAGE}"

cat > "$ENV_FILE" << ENVEOF
VITE_STAGE=${STAGE}
VITE_AWS_REGION=${REGION}
VITE_GRAPHQL_API_URL=${API_URL}
VITE_GRAPHQL_API_KEY=${API_KEY}
VITE_GRAPHQL_API_ID=${API_ID}
ENVEOF

echo -e "${GREEN}✓ Configuration saved to ${ENV_FILE}${NC}"

# Also create .env file for Vite to use during build
cp "$ENV_FILE" "packages/web-app/.env"
echo -e "${GREEN}✓ Copied to packages/web-app/.env for Vite${NC}"

echo -e "${YELLOW}API URL:${NC} $API_URL"
echo -e "${YELLOW}API Key:${NC} $API_KEY"
