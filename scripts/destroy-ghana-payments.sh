#!/bin/bash

# Destroy Ghana Payments PoC
# Usage: ./scripts/destroy-ghana-payments.sh <stage>
# Example: ./scripts/destroy-ghana-payments.sh dev
#
# Keep GHANA_STACKS in sync with deploy-ghana-payments.sh (destroyed in reverse).

set -e

STAGE=${1:-dev}

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Same list as deploy script; destroyed in reverse dependency order below.
GHANA_STACKS=(
  "${STAGE}-ghana-payments-foundation"
  "${STAGE}-ghana-payments-api"
)

if [ "${STAGE}" == "prod" ] || [ "${STAGE}" == "test" ]; then
  echo -e "${RED}WARNING: destroying ${STAGE}. Tables/buckets use RETAIN there and will be orphaned, not deleted.${NC}"
  read -p "Type the stage name (${STAGE}) to continue: " CONFIRM
  if [ "${CONFIRM}" != "${STAGE}" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# Reverse the array for teardown
REVERSED=()
for ((i = ${#GHANA_STACKS[@]} - 1; i >= 0; i--)); do
  REVERSED+=("${GHANA_STACKS[$i]}")
done

echo "==============================================="
echo "Destroying Ghana Payments PoC in ${STAGE}"
echo "Stacks (reverse order): ${REVERSED[*]}"
echo "==============================================="

cd packages/infrastructure
STAGE=${STAGE} npx cdk destroy "${REVERSED[@]}" --force
cd ../..

echo -e "${GREEN}✓ Ghana Payments PoC destroyed in ${STAGE}${NC}"
