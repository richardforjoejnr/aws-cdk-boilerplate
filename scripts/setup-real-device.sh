#!/bin/bash
# Provision a REAL soundbox device: creates an X.509 cert, pairs it to the platform,
# and writes everything the device needs into a config bundle.
#
# Usage: ./scripts/setup-real-device.sh <stage> <serial_number> <pairing_code>
# (register the device + get the pairing code from the merchant portal first)
#
# Output: ./device-bundles/<serial>/  — certs, keys, Amazon Root CA, device.json
set -e

STAGE=${1:?usage: setup-real-device.sh <stage> <serial> <pairing_code>}
SERIAL=${2:?serial_number required}
CODE=${3:?pairing_code required}

PORTAL=$(aws cloudformation describe-stacks --stack-name "${STAGE}-ghana-payments-web" \
  --query "Stacks[0].Outputs[?OutputKey=='PortalUrl'].OutputValue" --output text)
OUT="device-bundles/${SERIAL}"
mkdir -p "$OUT"

echo "1/4 Creating device certificate + keys..."
CERT=$(aws iot create-keys-and-certificate --set-as-active \
  --certificate-pem-outfile "$OUT/device.cert.pem" \
  --public-key-outfile "$OUT/device.public.key" \
  --private-key-outfile "$OUT/device.private.key")
CERT_ARN=$(echo "$CERT" | python3 -c 'import json,sys;print(json.load(sys.stdin)["certificateArn"])')
CERT_ID=$(echo "$CERT" | python3 -c 'import json,sys;print(json.load(sys.stdin)["certificateId"])')
echo "   certificate: $CERT_ID"

echo "2/4 Downloading Amazon Root CA..."
curl -sf https://www.amazontrust.com/repository/AmazonRootCA1.pem -o "$OUT/AmazonRootCA1.pem"

echo "3/4 Pairing with the platform..."
PAIR=$(curl -sf -X POST "$PORTAL/api/v1/devices/pair" -H 'content-type: application/json' \
  -d "{\"serial_number\":\"$SERIAL\",\"pairing_code\":\"$CODE\",\"certificate_arn\":\"$CERT_ARN\"}") || {
  echo "Pairing failed — deactivating the orphaned certificate..."
  aws iot update-certificate --certificate-id "$CERT_ID" --new-status INACTIVE
  aws iot delete-certificate --certificate-id "$CERT_ID"
  exit 1
}
echo "$PAIR" | python3 -m json.tool

echo "4/4 Writing device config..."
echo "$PAIR" | python3 -c "
import json, sys
pair = json.load(sys.stdin)
json.dump({
  **pair,
  'certificate_arn': '$CERT_ARN',
  'certificate_id': '$CERT_ID',
  'mqtt_port': 8883,
  'files': {
    'certificate': 'device.cert.pem',
    'private_key': 'device.private.key',
    'root_ca': 'AmazonRootCA1.pem',
  },
}, open('$OUT/device.json', 'w'), indent=2)
"

echo ""
echo "✓ Device bundle ready: $OUT/"
echo "  Try it now from this machine (needs speakers):"
echo "    node packages/ghana-payments/device-client/soundbox-client.mjs $OUT"
echo "  Or copy the bundle to a Raspberry Pi and run the same command there."
echo "  ESP32 flashing guide: packages/ghana-payments/docs/DEVICE_SETUP.md"