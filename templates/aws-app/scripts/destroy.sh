#!/bin/bash
# Destroy __APP_TITLE__ in a stage. Usage: ./scripts/destroy.sh [dev|test|prod]
set -e
STAGE=${1:-dev}
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
cd "$(dirname "$0")/.."

if [ "${STAGE}" = "prod" ]; then
  echo -e "${RED}Destroying PROD — tables use RETAIN and will be orphaned, not deleted.${NC}"
  read -p "Type prod to continue: " C; [ "$C" = "prod" ] || { echo Aborted; exit 1; }
fi

STAGE=${STAGE} npx cdk destroy "${STAGE}-__APP_NAME__" --force

LEFT=$(aws cloudformation describe-stacks --stack-name "${STAGE}-__APP_NAME__" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "")
if [ -z "$LEFT" ]; then
  echo -e "${GREEN}✓ ${STAGE}-__APP_NAME__ destroyed — nothing left running${NC}"
else
  echo -e "${RED}✗ stack still present (${LEFT}) — check the console${NC}"; exit 1
fi
