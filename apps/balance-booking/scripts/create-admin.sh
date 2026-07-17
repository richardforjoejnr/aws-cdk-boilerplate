#!/bin/bash

# Create or update a Balance Booking admin user.
# Pre-confirms email, sets a permanent password, adds the user to the `admin` Cognito group.
# Usage: ./create-admin.sh <stage> <email> [password]
#   stage:    dev | test | prod | pr-N
#   email:    user's email (also used as Cognito username)
#   password: permanent password (optional — generated if omitted)

set -e

STAGE=${1:-}
EMAIL=${2:-}
PASSWORD=${3:-}
REGION=${AWS_REGION:-us-east-1}

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -z "$STAGE" ] || [ -z "$EMAIL" ]; then
  echo -e "${RED}Usage: $0 <stage> <email> [password]${NC}"
  echo "  Example: $0 dev franki@balanceuk.uk MySecurePass123"
  exit 1
fi

if [[ ! "$STAGE" =~ ^(dev|test|prod|pr-[0-9]+)$ ]]; then
  echo -e "${RED}❌ Invalid stage: $STAGE${NC}"
  exit 1
fi

if [[ ! "$EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo -e "${RED}❌ Invalid email: $EMAIL${NC}"
  exit 1
fi

# Generate a password if not provided. Must satisfy the user pool policy:
# minLength 8, requireLowercase, requireDigits.
if [ -z "$PASSWORD" ]; then
  RAND=$(openssl rand -base64 9 | tr -dc 'a-zA-Z0-9' | head -c 8)
  PASSWORD="Bal${RAND}1"
  GENERATED=true
else
  GENERATED=false
fi

echo -e "${BLUE}👤 Creating admin in ${STAGE} for ${EMAIL}${NC}\n"

# Look up the user pool ID from the auth stack
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "${STAGE}-balance-booking-auth" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text 2>/dev/null || echo "")

if [ -z "$USER_POOL_ID" ] || [ "$USER_POOL_ID" = "None" ]; then
  echo -e "${RED}❌ Auth stack ${STAGE}-balance-booking-auth not deployed yet.${NC}"
  exit 1
fi

# admin-create-user is idempotent if --message-action SUPPRESS is used and the user already exists,
# we'll catch the UsernameExistsException below.
CREATE_OUTPUT=$(aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --user-attributes "Name=email,Value=${EMAIL}" "Name=email_verified,Value=true" \
  --message-action SUPPRESS \
  --region "$REGION" 2>&1) || CREATE_RC=$?

if [ "${CREATE_RC:-0}" -ne 0 ]; then
  if echo "$CREATE_OUTPUT" | grep -q "UsernameExistsException"; then
    echo -e "${YELLOW}→ User already exists, updating password & group${NC}"
  else
    echo -e "${RED}❌ admin-create-user failed:${NC}"
    echo "$CREATE_OUTPUT"
    exit 1
  fi
else
  echo -e "${GREEN}✓ User created${NC}"
fi

# Set permanent password (skips the FORCE_CHANGE_PASSWORD challenge so the admin can sign in immediately)
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --password "$PASSWORD" \
  --permanent \
  --region "$REGION" >/dev/null
echo -e "${GREEN}✓ Permanent password set${NC}"

# Add to admin group (idempotent — Cognito returns 200 if already a member)
aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --group-name admin \
  --region "$REGION" >/dev/null
echo -e "${GREEN}✓ Added to admin group${NC}"

WEB_URL=$(aws cloudformation describe-stacks \
  --stack-name "${STAGE}-balance-booking-web" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='WebUrl'].OutputValue" \
  --output text 2>/dev/null || echo "")

# Persist creds for downstream tooling (e.g. PR comment in CI). Don't leave this around in shared envs.
OUT_FILE=".balance-admin-${STAGE}.json"
cat > "$OUT_FILE" <<JSONEOF
{
  "stage": "${STAGE}",
  "email": "${EMAIL}",
  "password": "${PASSWORD}",
  "passwordGenerated": ${GENERATED},
  "webUrl": "${WEB_URL}"
}
JSONEOF
chmod 600 "$OUT_FILE"

echo ""
echo -e "${GREEN}✅ Admin ready${NC}"
echo -e "${YELLOW}Email:${NC}    ${EMAIL}"
echo -e "${YELLOW}Password:${NC} ${PASSWORD}"
if [ "$GENERATED" = "true" ]; then
  echo -e "${YELLOW}Note:${NC}     Password was auto-generated — change it on first sign-in."
fi
if [ -n "$WEB_URL" ]; then
  echo -e "${YELLOW}Sign in:${NC} ${WEB_URL}/auth/callback"
fi
echo -e "${YELLOW}Creds saved to ${OUT_FILE} (chmod 600)${NC}"
