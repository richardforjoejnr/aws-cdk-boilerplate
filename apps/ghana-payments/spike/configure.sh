#!/bin/bash
# Generates spike/.env and spike/browser/config.js from deployed spike-stack outputs.
# Usage: ./packages/ghana-payments/spike/configure.sh [stage]
set -e
STAGE=${1:-dev}
DIR="$(cd "$(dirname "$0")" && pwd)"
STACK="${STAGE}-ghana-payments-spike"

get_output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

REGION=$(get_output Region)
IDENTITY_POOL_ID=$(get_output IdentityPoolId)
ATTACH_URL=$(get_output AttachPolicyUrl)
IOT_ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)

cat > "$DIR/.env" <<EOF
REGION=$REGION
IDENTITY_POOL_ID=$IDENTITY_POOL_ID
ATTACH_URL=$ATTACH_URL
IOT_ENDPOINT=$IOT_ENDPOINT
EOF

cat > "$DIR/browser/config.js" <<EOF
window.SPIKE_CONFIG = {
  region: "$REGION",
  identityPoolId: "$IDENTITY_POOL_ID",
  attachUrl: "$ATTACH_URL",
  iotEndpoint: "$IOT_ENDPOINT",
};
EOF

# mqtt may be hoisted to the monorepo root
MQTT_JS="$DIR/../node_modules/mqtt/dist/mqtt.min.js"
[ -f "$MQTT_JS" ] || MQTT_JS="$DIR/../../../node_modules/mqtt/dist/mqtt.min.js"
cp "$MQTT_JS" "$DIR/browser/mqtt.min.js"
echo "Spike configured for $STAGE: endpoint $IOT_ENDPOINT"
