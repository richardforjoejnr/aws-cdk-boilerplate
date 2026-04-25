#!/bin/bash

# Destroy all Balance Booking stacks for a stage, in reverse dependency order.
# Usage: ./destroy-balance-booking.sh [dev|test|prod|pr-N]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [[ ! "$STAGE" =~ ^(dev|test|prod|pr-[0-9]+)$ ]]; then
  echo -e "${RED}❌ Invalid stage: $STAGE${NC}"
  exit 1
fi

PREFIX="${STAGE}-balance-booking"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

echo -e "${BLUE}🗑️  Destroying balance-booking stacks for ${STAGE}${NC}\n"

# Reverse dependency order: web → api → functions → data → auth
STACKS=(
  "${PREFIX}-web"
  "${PREFIX}-api"
  "${PREFIX}-functions"
  "${PREFIX}-data"
  "${PREFIX}-auth"
)

for stack in "${STACKS[@]}"; do
  if aws cloudformation describe-stacks --stack-name "$stack" --region "$REGION" >/dev/null 2>&1; then
    echo -e "${YELLOW}→ Destroying ${stack}${NC}"
    (cd packages/infrastructure && \
      DEPLOY_BALANCE_WEB=true STAGE="$STAGE" npx cdk destroy "$stack" --force) || \
      echo -e "${RED}⚠️  Destroy of ${stack} failed — continuing${NC}"
  else
    echo -e "${YELLOW}→ ${stack} does not exist, skipping${NC}"
  fi
done

# Best-effort cleanup of orphaned table (in case CFN removal policy retained it)
TABLE="${STAGE}-balance-booking"
if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo -e "${YELLOW}→ Found orphaned table ${TABLE} — leaving in place (delete manually if intended)${NC}"
fi

echo -e "${GREEN}✅ Destroy complete${NC}"
