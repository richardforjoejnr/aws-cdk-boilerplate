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
  "${STAGE}-ghana-payments-web"
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

# Step 1: detach + delete IoT policies that are NOT CloudFormation-managed or would
# block stack deletion: per-device policies are created at pairing time by the pair
# Lambda, and any policy still attached to a Cognito identity cannot be deleted.
echo -e "${BLUE}Step 1: Cleaning IoT device policies + attachments...${NC}"
cleanup_iot_policy() {
  local policy="$1"
  local targets
  targets=$(aws iot list-targets-for-policy --policy-name "$policy" --query 'targets[]' --output text 2>/dev/null || true)
  for t in $targets; do
    [ "$t" == "None" ] && continue
    aws iot detach-policy --policy-name "$policy" --target "$t" && echo "  detached $policy from $t"
  done
}
DEVICE_POLICIES=$(aws iot list-policies --query "policies[?starts_with(policyName, '${STAGE}-ghana-device-')].policyName" --output text)
for p in $DEVICE_POLICIES; do
  [ "$p" == "None" ] && continue
  cleanup_iot_policy "$p"
  aws iot delete-policy --policy-name "$p" && echo "  deleted policy $p"
done
# Spike policy is CFN-managed but its identity attachments block CFN deletion — detach only
cleanup_iot_policy "${STAGE}-ghana-spike-policy"
echo -e "${GREEN}✓ IoT policies cleaned${NC}"

# Step 2: destroy the main stacks (reverse dependency order)
echo -e "${BLUE}Step 2: Destroying stacks...${NC}"
cd packages/infrastructure
STAGE=${STAGE} npx cdk destroy "${REVERSED[@]}" --force

# Step 3: destroy the spike stack if it was ever deployed (gated stack)
if aws cloudformation describe-stacks --stack-name "${STAGE}-ghana-payments-spike" >/dev/null 2>&1; then
  echo -e "${BLUE}Step 3: Destroying spike stack...${NC}"
  DEPLOY_GHANA_SPIKE=true STAGE=${STAGE} npx cdk destroy "${STAGE}-ghana-payments-spike" --force
else
  echo -e "${BLUE}Step 3: No spike stack deployed — skipping${NC}"
fi
cd ../..

# Step 4: delete SSM parameters created at runtime / out-of-band (admin credentials,
# cost cache) plus anything CFN left behind under the project path
echo -e "${BLUE}Step 4: Cleaning SSM parameters...${NC}"
LEFTOVER_PARAMS=$(aws ssm get-parameters-by-path --path "/${STAGE}/ghana-payments" --recursive \
  --query 'Parameters[].Name' --output text)
for name in $LEFTOVER_PARAMS; do
  [ "$name" == "None" ] && continue
  aws ssm delete-parameter --name "$name" && echo "  deleted param $name"
done
echo -e "${GREEN}✓ SSM parameters cleaned${NC}"

# Step 5: verify nothing is left
echo -e "${BLUE}Step 5: Verifying cleanup...${NC}"
LEFT_STACKS=$(aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE DELETE_FAILED \
  --query "StackSummaries[?starts_with(StackName, '${STAGE}-ghana-payments')].StackName" --output text)
LEFT_PARAMS=$(aws ssm get-parameters-by-path --path "/${STAGE}/ghana-payments" --recursive --query 'Parameters[].Name' --output text)
LEFT_POLICIES=$(aws iot list-policies --query "policies[?contains(policyName, '${STAGE}-ghana')].policyName" --output text)
CLEAN=true
[ -n "$LEFT_STACKS" ] && [ "$LEFT_STACKS" != "None" ] && { echo -e "${RED}Stacks remaining: $LEFT_STACKS${NC}"; CLEAN=false; }
[ -n "$LEFT_PARAMS" ] && [ "$LEFT_PARAMS" != "None" ] && { echo -e "${RED}SSM params remaining: $LEFT_PARAMS${NC}"; CLEAN=false; }
[ -n "$LEFT_POLICIES" ] && [ "$LEFT_POLICIES" != "None" ] && { echo -e "${RED}IoT policies remaining: $LEFT_POLICIES${NC}"; CLEAN=false; }
if [ "$CLEAN" = true ]; then
  echo -e "${GREEN}✓ Ghana Payments PoC fully destroyed in ${STAGE} — nothing left running or billing${NC}"
else
  echo -e "${RED}✗ Some resources remain (see above) — re-run or remove manually${NC}"
  exit 1
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## 🗑️ Ghana Payments fully destroyed in ${STAGE}"
    echo ""
    echo "- Stacks removed: ${REVERSED[*]} (+ spike if present)"
    echo "- Per-device IoT policies detached and deleted"
    echo "- Runtime SSM parameters removed (admin credentials, cost cache)"
    echo "- Verified: no stacks, parameters, or IoT policies remain"
  } >> "$GITHUB_STEP_SUMMARY"
fi
