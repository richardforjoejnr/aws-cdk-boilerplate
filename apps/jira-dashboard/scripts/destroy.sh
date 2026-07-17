#!/bin/bash
# Destroy Jira Dashboard in a stage. Usage: ./scripts/destroy.sh [dev|test|prod]
set -e
STAGE=${1:-dev}
GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm install --no-audit --no-fund

if [ "${STAGE}" = "prod" ] || [ "${STAGE}" = "test" ]; then
  echo -e "${RED}Destroying ${STAGE}.${NC}"
  read -p "Type the stage name (${STAGE}) to continue: " C; [ "$C" = "${STAGE}" ] || { echo Aborted; exit 1; }
fi

# Empty the CSV bucket first so the stack (and its bucket-notification custom resource) delete cleanly.
BUCKET="${STAGE}-jira-dashboard-csvs"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo -e "${BLUE}Emptying s3://${BUCKET}...${NC}"; aws s3 rm "s3://${BUCKET}" --recursive >/dev/null 2>&1 || true
fi

echo -e "${BLUE}Destroying stacks...${NC}"
DEPLOY_WEB=true STAGE=${STAGE} npx cdk destroy --all --force

LEFT=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_FAILED \
  --query "StackSummaries[?starts_with(StackName, '${STAGE}-jira-dashboard')].StackName" --output text)
if [ -z "$LEFT" ]; then
  echo -e "${GREEN}✓ Jira Dashboard fully destroyed in ${STAGE}${NC}"
else
  echo -e "${RED}✗ Remaining: ${LEFT}${NC}"; exit 1
fi
