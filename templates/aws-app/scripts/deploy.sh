#!/bin/bash
# Deploy __APP_TITLE__ to a stage. Usage: ./scripts/deploy.sh [dev|test|prod]
set -e
STAGE=${1:-dev}
GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
cd "$(dirname "$0")/.."

echo -e "${BLUE}Installing deps...${NC}"; npm ci
echo -e "${BLUE}Building + testing...${NC}"; npm run build && npm test
echo -e "${BLUE}Bootstrapping CDK (idempotent)...${NC}"
npx cdk bootstrap "aws://$(aws sts get-caller-identity --query Account --output text)/${AWS_REGION:-us-east-1}" 2>/dev/null || true
echo -e "${BLUE}Deploying stage: ${STAGE}...${NC}"
STAGE=${STAGE} npx cdk deploy "${STAGE}-__APP_NAME__" --require-approval never

API_URL=$(aws cloudformation describe-stacks --stack-name "${STAGE}-__APP_NAME__" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text 2>/dev/null)
echo -e "${GREEN}✓ Deployed ${STAGE}-__APP_NAME__${NC}"
echo -e "API: ${GREEN}${API_URL}${NC}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "api_url=${API_URL}" >> "$GITHUB_OUTPUT"; fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## 🚀 __APP_TITLE__ deployed to ${STAGE}"
    echo ""
    echo "| What | URL |"; echo "| --- | --- |"
    echo "| API | ${API_URL} |"
    echo ""
    echo "Try: \`curl ${API_URL}\` · \`curl -X POST ${API_URL}items -d '{\"name\":\"hello\"}'\`"
  } >> "$GITHUB_STEP_SUMMARY"
fi
