#!/bin/bash
# Destroy Ghana Payments in a stage + clean up out-of-band resources.
# Usage: ./scripts/destroy.sh [dev|test|prod]
set -e
STAGE=${1:-dev}
GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm install --no-audit --no-fund

if [ "${STAGE}" = "prod" ] || [ "${STAGE}" = "test" ]; then
  echo -e "${RED}Destroying ${STAGE}.${NC}"
  read -p "Type the stage name (${STAGE}) to continue: " C; [ "$C" = "${STAGE}" ] || { echo Aborted; exit 1; }
fi

# 1. Per-device IoT policies (created at pairing, not CFN-managed) + spike policy attachments.
echo -e "${BLUE}Cleaning IoT device policies...${NC}"
cleanup_policy() {
  local p="$1" t
  for t in $(aws iot list-targets-for-policy --policy-name "$p" --query 'targets[]' --output text 2>/dev/null); do
    [ "$t" = "None" ] && continue
    aws iot detach-policy --policy-name "$p" --target "$t" 2>/dev/null && echo "  detached $p from $t" || true
  done
}
for p in $(aws iot list-policies --query "policies[?starts_with(policyName, '${STAGE}-ghana-device-')].policyName" --output text 2>/dev/null); do
  [ "$p" = "None" ] && continue
  cleanup_policy "$p"; aws iot delete-policy --policy-name "$p" 2>/dev/null && echo "  deleted $p" || true
done
cleanup_policy "${STAGE}-ghana-spike-policy"

# 1b. Fleet provisioning leaves out-of-band X.509 certs + Things (the shared claim
# cert and each device's minted cert). They must be detached + deleted or CFN can't
# remove the fleet policies (policy in use). Detach each cert from the fleet policy,
# drop its Things, then deactivate + delete the cert.
echo -e "${BLUE}Cleaning fleet certificates + things...${NC}"
cleanup_cert() {
  local arn="$1" certid thing
  certid="${arn##*/}"
  for thing in $(aws iot list-principal-things --principal "$arn" --query 'things[]' --output text 2>/dev/null); do
    [ "$thing" = "None" ] && continue
    aws iot detach-thing-principal --thing-name "$thing" --principal "$arn" 2>/dev/null || true
    aws iot delete-thing --thing-name "$thing" 2>/dev/null && echo "  deleted thing $thing" || true
  done
  aws iot update-certificate --certificate-id "$certid" --new-status INACTIVE 2>/dev/null || true
  aws iot delete-certificate --certificate-id "$certid" --force-delete 2>/dev/null && echo "  deleted cert $certid" || true
}
for p in "${STAGE}-ghana-soundbox-device" "${STAGE}-ghana-soundbox-claim"; do
  for t in $(aws iot list-targets-for-policy --policy-name "$p" --query 'targets[]' --output text 2>/dev/null); do
    [ "$t" = "None" ] && continue
    aws iot detach-policy --policy-name "$p" --target "$t" 2>/dev/null && echo "  detached $p from $t" || true
    cleanup_cert "$t"
  done
done
# any stray fleet Things left behind
for thing in $(aws iot list-things --query "things[?starts_with(thingName,'soundbox-')].thingName" --output text 2>/dev/null); do
  [ "$thing" = "None" ] && continue
  aws iot delete-thing --thing-name "$thing" 2>/dev/null && echo "  deleted thing $thing" || true
done

# 2. Destroy the stacks (self-contained app → only ghana stacks). Include spike if it exists.
echo -e "${BLUE}Destroying stacks...${NC}"
DEPLOY_GHANA_SPIKE=true STAGE=${STAGE} npx cdk destroy --all --force

# 3. Runtime SSM params (admin creds, cost cache, github token) — loop-until-empty, race-tolerant.
echo -e "${BLUE}Cleaning SSM parameters...${NC}"
for attempt in 1 2 3; do
  names=$(aws ssm get-parameters-by-path --path "/${STAGE}/ghana-payments" --recursive --query 'Parameters[].Name' --output text 2>/dev/null)
  [ -z "$names" ] || [ "$names" = "None" ] && break
  for n in $names; do [ "$n" = "None" ] && continue; aws ssm delete-parameter --name "$n" >/dev/null 2>&1 && echo "  deleted $n" || true; done
  sleep 2
done

# 4. Verify.
LEFT_STACKS=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE DELETE_FAILED \
  --query "StackSummaries[?starts_with(StackName, '${STAGE}-ghana-payments')].StackName" --output text)
LEFT_PARAMS=$(aws ssm get-parameters-by-path --path "/${STAGE}/ghana-payments" --recursive --query 'Parameters[].Name' --output text)
if [ -z "$LEFT_STACKS" ] && { [ -z "$LEFT_PARAMS" ] || [ "$LEFT_PARAMS" = "None" ]; }; then
  echo -e "${GREEN}✓ Ghana Payments fully destroyed in ${STAGE} — nothing left running or billing${NC}"
else
  echo -e "${RED}✗ Remaining — stacks: ${LEFT_STACKS:-none} params: ${LEFT_PARAMS:-none}${NC}"; exit 1
fi
