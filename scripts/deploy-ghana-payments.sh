#!/bin/bash

# Deploy Ghana Payments PoC
# Usage: ./scripts/deploy-ghana-payments.sh <stage>
# Example: ./scripts/deploy-ghana-payments.sh dev
#
# Add new stacks to GHANA_STACKS (deploy order) as roadmap phases land.
# Design: packages/ghana-payments/docs/planning/architecture.md

set -e

STAGE=${1:-dev}

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Stacks in dependency order. Future phases append here (e.g. api, iot, web).
GHANA_STACKS=(
  "${STAGE}-ghana-payments-foundation"
  "${STAGE}-ghana-payments-api"
  "${STAGE}-ghana-payments-web"
)

echo "==============================================="
echo "Deploying Ghana Payments PoC to ${STAGE}"
echo "Stacks: ${GHANA_STACKS[*]}"
echo "==============================================="

echo -e "${BLUE}Step 1: Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

echo -e "${BLUE}Step 2: Building ghana-payments package...${NC}"
npm run build --workspace=@aws-boilerplate/ghana-payments
echo -e "${GREEN}✓ Package built${NC}"

echo -e "${BLUE}Step 3: Deploying infrastructure...${NC}"
cd packages/infrastructure
STAGE=${STAGE} npx cdk deploy "${GHANA_STACKS[@]}" --require-approval never
cd ../..
echo -e "${GREEN}✓ Infrastructure deployed${NC}"

echo -e "${BLUE}Step 4: Stack outputs...${NC}"
for stack in "${GHANA_STACKS[@]}"; do
  echo -e "${BLUE}${stack}:${NC}"
  aws cloudformation describe-stacks \
    --stack-name "${stack}" \
    --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' \
    --output table || echo -e "${RED}Could not read outputs for ${stack}${NC}"
done

# Per-deployment info (also exported for CI)
get_output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text 2>/dev/null
}
PORTAL_URL=$(get_output "${STAGE}-ghana-payments-web" PortalUrl)
API_URL=$(get_output "${STAGE}-ghana-payments-api" ApiUrl)
KEY_ID=$(get_output "${STAGE}-ghana-payments-api" AdminApiKeyId)

echo ""
echo "==============================================="
echo -e "${GREEN}✓ Ghana Payments PoC deployed to ${STAGE}${NC}"
echo "==============================================="
echo -e "Portal (everything runs from here): ${GREEN}${PORTAL_URL}${NC}"
echo -e "  Merchant portal:  ${PORTAL_URL}/admin/   (sign in with the admin credentials)"
echo -e "  Soundbox:         ${PORTAL_URL}/soundbox/"
echo -e "  Payment portal:   ${PORTAL_URL}/pay/{qr_id}  (opened by scanning a QR)"
echo -e "API (direct):       ${API_URL}"
echo -e "Admin API key id:   ${KEY_ID}"
echo -e "  Fetch value:      aws apigateway get-api-key --api-key ${KEY_ID} --include-value --query value --output text"
echo -e "Runbook:            packages/ghana-payments/docs/RUNBOOK.md"

# GitHub Actions outputs + summary
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "portal_url=${PORTAL_URL}"
    echo "api_url=${API_URL}"
    echo "api_key_id=${KEY_ID}"
  } >> "$GITHUB_OUTPUT"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## 🇬🇭 Ghana Payments deployed to ${STAGE}"
    echo ""
    echo "| What | URL / value |"
    echo "| --- | --- |"
    echo "| Portal | ${PORTAL_URL} |"
    echo "| Merchant portal | ${PORTAL_URL}/admin/ |"
    echo "| Soundbox | ${PORTAL_URL}/soundbox/ |"
    echo "| API (direct) | ${API_URL} |"
    echo "| Admin API key id | \`${KEY_ID}\` (fetch: \`aws apigateway get-api-key --api-key ${KEY_ID} --include-value\`) |"
    echo ""
    echo "Stacks: ${GHANA_STACKS[*]}"
  } >> "$GITHUB_STEP_SUMMARY"
fi
