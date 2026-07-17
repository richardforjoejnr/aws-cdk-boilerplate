#!/bin/bash
# Deploy Jira Dashboard to a stage. Usage: ./scripts/deploy.sh [dev|test|prod]
# Two-phase: backend first (to get the API URL), then build the web with that URL and deploy it.
set -e
STAGE=${1:-dev}
GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
cd "$(dirname "$0")/.."

echo -e "${BLUE}Installing deps...${NC}"; npm install --no-audit --no-fund
echo -e "${BLUE}Type-checking...${NC}"; npm run build
echo -e "${BLUE}Bootstrapping CDK (idempotent)...${NC}"
npx cdk bootstrap "aws://$(aws sts get-caller-identity --query Account --output text)/${AWS_REGION:-us-east-1}" 2>/dev/null || true

echo -e "${BLUE}1/3 Deploying backend...${NC}"
STAGE=${STAGE} npx cdk deploy "${STAGE}-jira-dashboard" --require-approval never

API_URL=$(aws cloudformation describe-stacks --stack-name "${STAGE}-jira-dashboard" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
echo -e "API: ${GREEN}${API_URL}${NC}"

echo -e "${BLUE}2/3 Building web with API URL...${NC}"
( cd web-app && npm install --no-audit --no-fund && VITE_JIRA_API_URL="${API_URL}" npm run build -- --mode "${STAGE}" )

echo -e "${BLUE}3/3 Deploying web...${NC}"
DEPLOY_WEB=true STAGE=${STAGE} npx cdk deploy "${STAGE}-jira-dashboard-web" --require-approval never

WEB_URL=$(aws cloudformation describe-stacks --stack-name "${STAGE}-jira-dashboard-web" \
  --query "Stacks[0].Outputs[?starts_with(OutputKey,'WebApp')].OutputValue | [0]" --output text 2>/dev/null)
echo ""
echo -e "${GREEN}✓ Jira Dashboard deployed to ${STAGE}${NC}"
echo -e "Dashboard: ${GREEN}${WEB_URL}/jira-dashboard.html${NC}"
echo -e "API:       ${API_URL}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "dashboard_url=${WEB_URL}/jira-dashboard.html"
    echo "web_url=${WEB_URL}"
    echo "api_url=${API_URL}"
  } >> "$GITHUB_OUTPUT"
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## 📊 Jira Dashboard deployed to ${STAGE}"
    echo ""
    echo "| What | URL |"; echo "| --- | --- |"
    echo "| Dashboard | ${WEB_URL}/jira-dashboard.html |"
    echo "| API | ${API_URL} |"
  } >> "$GITHUB_STEP_SUMMARY"
fi
