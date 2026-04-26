#!/bin/bash

# Configure balance-booking web app with backend endpoints
# Reads CFN outputs from auth + api stacks, writes packages/balance-booking-web/.env.{stage}
# Usage: ./configure-balance-webapp.sh [dev|test|prod|pr-N]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🔧 Configuring balance-booking web app for ${STAGE}${NC}\n"

PREFIX="${STAGE}-balance-booking"

read_output() {
  local stack=$1
  local key=$2
  # `|| true` is load-bearing: aws cli returns 254 when the stack doesn't exist
  # (expected for the web stack on first pass), and some bash configurations
  # propagate that through `var=$(read_output ...)` and trip set -e. Empty-string
  # output is the contract — every caller already null-checks.
  aws cloudformation describe-stacks \
    --stack-name "$stack" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" \
    --output text 2>/dev/null || true
}

USER_POOL_ID=$(read_output "${PREFIX}-auth" "UserPoolId")
USER_POOL_CLIENT_ID=$(read_output "${PREFIX}-auth" "UserPoolClientId")
HOSTED_UI_DOMAIN=$(read_output "${PREFIX}-auth" "UserPoolDomain")
GRAPHQL_URL=$(read_output "${PREFIX}-api" "GraphqlUrl")
GRAPHQL_API_KEY=$(read_output "${PREFIX}-api" "GraphqlApiKey")

if [ -z "$USER_POOL_ID" ] || [ "$USER_POOL_ID" = "None" ]; then
  echo -e "${RED}❌ Could not read UserPoolId from ${PREFIX}-auth — has it been deployed?${NC}"
  exit 1
fi
if [ -z "$GRAPHQL_URL" ] || [ "$GRAPHQL_URL" = "None" ]; then
  echo -e "${RED}❌ Could not read GraphqlUrl from ${PREFIX}-api — has it been deployed?${NC}"
  exit 1
fi

# Web app uses an opaque CloudFront domain in POC, so we can't know the redirect URL up-front.
# Read the web stack output if it exists; otherwise fall back to localhost for dev.
WEB_URL=$(read_output "${PREFIX}-web" "WebUrl")
if [ -z "$WEB_URL" ] || [ "$WEB_URL" = "None" ]; then
  REDIRECT_SIGN_IN="http://localhost:3001/auth/callback"
  REDIRECT_SIGN_OUT="http://localhost:3001/"
else
  REDIRECT_SIGN_IN="${WEB_URL}/auth/callback"
  REDIRECT_SIGN_OUT="${WEB_URL}/"
fi

ENV_DIR="packages/balance-booking-web"
ENV_FILE="${ENV_DIR}/.env.${STAGE}"

cat > "$ENV_FILE" <<ENVEOF
VITE_AWS_REGION=${REGION}
VITE_GRAPHQL_URL=${GRAPHQL_URL}
VITE_GRAPHQL_API_KEY=${GRAPHQL_API_KEY}
VITE_USER_POOL_ID=${USER_POOL_ID}
VITE_USER_POOL_CLIENT_ID=${USER_POOL_CLIENT_ID}
VITE_HOSTED_UI_DOMAIN=${HOSTED_UI_DOMAIN}.auth.${REGION}.amazoncognito.com
VITE_REDIRECT_SIGN_IN=${REDIRECT_SIGN_IN}
VITE_REDIRECT_SIGN_OUT=${REDIRECT_SIGN_OUT}
ENVEOF

# Note: we deliberately do NOT copy this to .env.production. Each stage gets its own .env.{stage}
# file, and the build is invoked with `vite build --mode {stage}` so Vite loads the right one.
# Copying to .env.production would mean a later `dev` configure run leaves prod-named credentials
# pointing at a dev backend.

echo -e "${GREEN}✓ Wrote ${ENV_FILE}${NC}"
echo -e "${YELLOW}GraphQL:${NC} ${GRAPHQL_URL}"
echo -e "${YELLOW}UserPool:${NC} ${USER_POOL_ID}"
echo -e "${YELLOW}Redirect:${NC} ${REDIRECT_SIGN_IN}"
