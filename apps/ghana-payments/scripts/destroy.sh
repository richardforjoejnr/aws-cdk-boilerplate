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

# 2. Destroy the stacks.
#
# `cdk destroy --all` alone is not enough. It only knows the stacks the CURRENT
# checkout's bin/app.ts instantiates, but a preview is deployed from the PR's branch
# and destroyed from another. Whenever a branch defines a stack the destroying
# checkout does not, that stack is orphaned — and if it imports foundation's exports,
# foundation cannot delete either, so the teardown silently half-completes. That is
# what stranded pr-26's fleet and monitoring stacks (both since merged to main).
#
# So don't trust the CDK app's stack list: ask CloudFormation what is actually
# deployed for this stage and delete that. CDK first for a clean teardown of what it
# does know, then sweep whatever remains.
echo -e "${BLUE}Destroying stacks (CDK-known)...${NC}"
DEPLOY_GHANA_SPIKE=true STAGE=${STAGE} npx cdk destroy --all --force || true

# Stacks we can issue a delete against right now.
live_stacks() {
  aws cloudformation list-stacks \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE ROLLBACK_COMPLETE DELETE_FAILED \
    --query "StackSummaries[?starts_with(StackName, '${STAGE}-ghana-payments')].StackName" --output text 2>/dev/null
}
# Stacks still present at all, including ones mid-delete. Used to wait for quiet:
# `aws cloudformation wait` is useless here because a delete that CloudFormation
# rejects outright (export still in use) leaves the stack in CREATE_COMPLETE, and
# the wait then polls a stack that will never reach DELETE_COMPLETE until a later
# pass frees it.
busy_stacks() {
  aws cloudformation list-stacks \
    --stack-status-filter DELETE_IN_PROGRESS \
    --query "StackSummaries[?starts_with(StackName, '${STAGE}-ghana-payments')].StackName" --output text 2>/dev/null
}

# Empty buckets first — a stack whose autoDeleteObjects custom resource was already
# torn down leaves a non-empty bucket that blocks DELETE.
for b in $(aws s3api list-buckets --query "Buckets[?starts_with(Name, '${STAGE}-ghana')].Name" --output text 2>/dev/null); do
  [ "$b" = "None" ] && continue
  aws s3 rm "s3://$b" --recursive >/dev/null 2>&1 && echo "  emptied s3://$b" || true
done

# Delete whatever is left, retrying: exports keep a producer stack alive until its
# consumers are gone, and we can't know the order without the CDK graph. Each pass
# deletes what it can; the dependency chain unwinds a layer per pass.
for pass in 1 2 3 4 5 6; do
  REMAINING=$(live_stacks)
  { [ -z "$REMAINING" ] || [ "$REMAINING" = "None" ]; } && break
  echo -e "${BLUE}Sweep pass ${pass}: ${REMAINING}${NC}"
  for st in $REMAINING; do
    aws cloudformation delete-stack --stack-name "$st" 2>/dev/null || true
  done
  # Let this pass's deletes drain before recomputing what's left, so the next pass
  # sees the exports the finished deletes released. Bounded so a wedged stack can't
  # hang the run.
  sleep 10  # let CloudFormation register the accepted deletes before polling
  for _ in $(seq 1 60); do
    BUSY=$(busy_stacks)
    { [ -z "$BUSY" ] || [ "$BUSY" = "None" ]; } && break
    sleep 15
  done
done

STUCK=$(live_stacks)
if [ -n "$STUCK" ] && [ "$STUCK" != "None" ]; then
  echo -e "${RED}Stacks would not delete after 6 passes: ${STUCK}${NC}"
  for st in $STUCK; do
    aws cloudformation describe-stack-events --stack-name "$st" --max-items 20 \
      --query 'StackEvents[?ResourceStatus==`DELETE_FAILED`].[LogicalResourceId,ResourceStatusReason]' --output text 2>/dev/null | head -5
  done
fi

# 3. Runtime SSM params (admin creds, cost cache, github token) — loop-until-empty, race-tolerant.
echo -e "${BLUE}Cleaning SSM parameters...${NC}"
for attempt in 1 2 3; do
  names=$(aws ssm get-parameters-by-path --path "/${STAGE}/ghana-payments" --recursive --query 'Parameters[].Name' --output text 2>/dev/null)
  [ -z "$names" ] || [ "$names" = "None" ] && break
  for n in $names; do [ "$n" = "None" ] && continue; aws ssm delete-parameter --name "$n" >/dev/null 2>&1 && echo "  deleted $n" || true; done
  sleep 2
done

# 3b. Log groups. Lambda auto-creates /aws/lambda/<fn> on first invoke for any
#     function whose group isn't CFN-managed (CDK's own BucketDeployment /
#     AutoDeleteObjects / LogRetention custom resources), so those survive the
#     stack delete and keep storing data. Sweep anything stage-scoped.
echo -e "${BLUE}Cleaning CloudWatch log groups...${NC}"
for lg in $(aws logs describe-log-groups --query "logGroups[?contains(logGroupName, '${STAGE}-ghana')].logGroupName" --output text 2>/dev/null); do
  [ "$lg" = "None" ] && continue
  aws logs delete-log-group --log-group-name "$lg" >/dev/null 2>&1 && echo "  deleted $lg" || true
done

# 3c. IoT things + certificates created at pairing (not CFN-managed). Policies are
#     already detached in step 1; a certificate must be deactivated before delete.
echo -e "${BLUE}Cleaning IoT things and certificates...${NC}"
for t in $(aws iot list-things --query "things[?starts_with(thingName, '${STAGE}-ghana')].thingName" --output text 2>/dev/null); do
  [ "$t" = "None" ] && continue
  for pr in $(aws iot list-thing-principals --thing-name "$t" --query 'principals[]' --output text 2>/dev/null); do
    [ "$pr" = "None" ] && continue
    aws iot detach-thing-principal --thing-name "$t" --principal "$pr" 2>/dev/null || true
    cid="${pr##*/}"
    aws iot update-certificate --certificate-id "$cid" --new-status INACTIVE 2>/dev/null || true
    aws iot delete-certificate --certificate-id "$cid" --force-delete 2>/dev/null && echo "  deleted cert $cid" || true
  done
  aws iot delete-thing --thing-name "$t" 2>/dev/null && echo "  deleted thing $t" || true
done

# 4. Verify.
# Check every category that can outlive the stacks and keep billing. A leftover
# EventBridge rule is the expensive one: it keeps invoking a Lambda that reads
# DynamoDB, which bills KMS Decrypt against alias/aws/dynamodb forever.
blank() { [ -z "$1" ] || [ "$1" = "None" ]; }
LEFT_STACKS=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE DELETE_FAILED \
  --query "StackSummaries[?starts_with(StackName, '${STAGE}-ghana-payments')].StackName" --output text)
LEFT_PARAMS=$(aws ssm get-parameters-by-path --path "/${STAGE}/ghana-payments" --recursive --query 'Parameters[].Name' --output text 2>/dev/null)
LEFT_RULES=$(aws events list-rules --name-prefix "${STAGE}-ghana" --query 'Rules[].Name' --output text 2>/dev/null)
LEFT_FNS=$(aws lambda list-functions --query "Functions[?starts_with(FunctionName, '${STAGE}-ghana')].FunctionName" --output text 2>/dev/null)
LEFT_TABLES=$(aws dynamodb list-tables --query "TableNames[?starts_with(@, '${STAGE}-ghana')]" --output text 2>/dev/null)
LEFT_LOGS=$(aws logs describe-log-groups --query "logGroups[?contains(logGroupName, '${STAGE}-ghana')].logGroupName" --output text 2>/dev/null)
LEFT_POLICIES=$(aws iot list-policies --query "policies[?starts_with(policyName, '${STAGE}-ghana')].policyName" --output text 2>/dev/null)

FAILED=0
for pair in "stacks:$LEFT_STACKS" "ssm-params:$LEFT_PARAMS" "eventbridge-rules:$LEFT_RULES" \
            "lambdas:$LEFT_FNS" "dynamodb-tables:$LEFT_TABLES" "log-groups:$LEFT_LOGS" "iot-policies:$LEFT_POLICIES"; do
  kind="${pair%%:*}"; val="${pair#*:}"
  blank "$val" || { echo -e "${RED}  ✗ ${kind}: ${val}${NC}"; FAILED=1; }
done

if [ "$FAILED" = "0" ]; then
  echo -e "${GREEN}✓ Ghana Payments fully destroyed in ${STAGE} — nothing left running or billing${NC}"
else
  echo -e "${RED}✗ ${STAGE} is NOT clean — the resources above still exist and may still bill${NC}"; exit 1
fi
