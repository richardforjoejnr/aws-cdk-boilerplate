#!/bin/bash
# Mint the shared "claim" certificate bundle for fleet provisioning — the bootstrap
# credential that ships baked into EVERY soundbox's firmware. It can only call the
# provisioning API (see the claim policy), so it's safe to embed fleet-wide.
#
# Run once per stage (rotate if it ever leaks). Deploy the fleet stack first.
# Usage: ./scripts/provision-claim.sh <stage>
# Output: ./claim-bundle/  — claim.cert.pem, claim.private.key, AmazonRootCA1.pem, claim.json
set -e
STAGE=${1:?usage: provision-claim.sh <stage>}
REGION=${AWS_REGION:-us-east-1}
OUT="claim-bundle"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'

get_output() {
  aws cloudformation describe-stacks --stack-name "${STAGE}-ghana-payments-fleet" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null
}
TEMPLATE=$(get_output ProvisioningTemplateName)
CLAIM_POLICY=$(get_output ClaimPolicyName)
if [ -z "$TEMPLATE" ] || [ -z "$CLAIM_POLICY" ]; then
  echo "Fleet stack outputs not found — deploy ${STAGE}-ghana-payments-fleet first." >&2
  exit 1
fi

mkdir -p "$OUT"
echo -e "${BLUE}1/4 Creating the claim certificate + keys...${NC}"
CERT=$(aws iot create-keys-and-certificate --set-as-active --region "$REGION" \
  --certificate-pem-outfile "$OUT/claim.cert.pem" \
  --public-key-outfile "$OUT/claim.public.key" \
  --private-key-outfile "$OUT/claim.private.key")
CERT_ARN=$(echo "$CERT" | python3 -c 'import json,sys;print(json.load(sys.stdin)["certificateArn"])')

echo -e "${BLUE}2/4 Attaching the claim policy (${CLAIM_POLICY}) — provisioning calls only...${NC}"
aws iot attach-policy --policy-name "$CLAIM_POLICY" --target "$CERT_ARN" --region "$REGION"

echo -e "${BLUE}3/4 Downloading Amazon Root CA...${NC}"
curl -sf https://www.amazontrust.com/repository/AmazonRootCA1.pem -o "$OUT/AmazonRootCA1.pem"

echo -e "${BLUE}4/4 Writing claim.json...${NC}"
ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --region "$REGION" --query endpointAddress --output text)
cat > "$OUT/claim.json" <<JSON
{
  "iot_endpoint": "${ENDPOINT}",
  "region": "${REGION}",
  "template_name": "${TEMPLATE}",
  "claim_certificate_arn": "${CERT_ARN}"
}
JSON

echo ""
echo -e "${GREEN}✓ Claim bundle ready: ${OUT}/${NC}"
echo "  This is what you flash into every unit's firmware (see docs/SOUNDBOX_SETUP.md)."
echo "  Test the whole flow now, no hardware needed:"
echo "    1. record a serial:  curl -X POST \$API/v1/fleet/serials -H \"x-api-key: \$KEY\" -d '{\"serials\":[\"SBX-DEMO-1\"]}'"
echo "    2. provision + run:  node device-client/fleet-provision.mjs ${OUT} SBX-DEMO-1"
