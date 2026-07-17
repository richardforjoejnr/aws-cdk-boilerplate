#!/bin/bash
# Deploy Ghana Payments to a stage. Usage: ./scripts/deploy.sh [dev|test|prod]
# Self-contained: `cdk --all` here only ever means the ghana-payments stacks.
set -e
STAGE=${1:-dev}
GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
cd "$(dirname "$0")/.."

echo -e "${BLUE}Installing deps...${NC}"; npm install --no-audit --no-fund
echo -e "${BLUE}Building + testing...${NC}"; npm run build && npm test
echo -e "${BLUE}Bootstrapping CDK (idempotent)...${NC}"
npx cdk bootstrap "aws://$(aws sts get-caller-identity --query Account --output text)/${AWS_REGION:-us-east-1}" 2>/dev/null || true
echo -e "${BLUE}Deploying stage: ${STAGE}...${NC}"
STAGE=${STAGE} npx cdk deploy --all --require-approval never

get_output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text 2>/dev/null
}
PORTAL_URL=$(get_output "${STAGE}-ghana-payments-web" PortalUrl)
API_URL=$(get_output "${STAGE}-ghana-payments-api" ApiUrl)
KEY_ID=$(get_output "${STAGE}-ghana-payments-api" AdminApiKeyId)

echo ""
echo -e "${GREEN}✓ Ghana Payments deployed to ${STAGE}${NC}"
echo -e "Portal:            ${GREEN}${PORTAL_URL}${NC}"
echo -e "  Merchant portal: ${PORTAL_URL}/admin/"
echo -e "  Soundbox:        ${PORTAL_URL}/soundbox/"
echo -e "API (direct):      ${API_URL}"
echo -e "Admin API key id:  ${KEY_ID}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "portal_url=${PORTAL_URL}"; echo "api_url=${API_URL}"; echo "api_key_id=${KEY_ID}"; } >> "$GITHUB_OUTPUT"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## 🇬🇭 Ghana Payments deployed to ${STAGE}"
    echo ""
    echo "| What | URL / value |"; echo "| --- | --- |"
    echo "| Portal | ${PORTAL_URL} |"
    echo "| Merchant portal | ${PORTAL_URL}/admin/ |"
    echo "| Soundbox | ${PORTAL_URL}/soundbox/ |"
    echo "| API (direct) | ${API_URL} |"
    echo "| Admin API key id | \`${KEY_ID}\` |"
  } >> "$GITHUB_STEP_SUMMARY"
fi
