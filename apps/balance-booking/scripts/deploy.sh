#!/bin/bash

# Two-pass deploy of the Balance Booking POC.
# Pass 1: deploy backend stacks → read outputs → configure web env
# Pass 2: build web → deploy web stack
# Usage: ./deploy-balance-booking.sh [dev|test|prod|pr-N] [--seed]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}
SEED=""
# Empty by default — admin bootstrap must be opt-in via --admin-email so we never bake
# default credentials into shared environments. If --admin-email is provided without
# --admin-password, create-admin.sh generates a random password and prints it once.
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
shift || true
while [ $# -gt 0 ]; do
  case $1 in
    --seed) SEED="yes" ;;
    --admin-email) ADMIN_EMAIL="$2"; shift ;;
    --admin-password) ADMIN_PASSWORD="$2"; shift ;;
  esac
  shift
done

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [[ ! "$STAGE" =~ ^(dev|test|prod|pr-[0-9]+)$ ]]; then
  echo -e "${RED}❌ Invalid stage: $STAGE${NC}"
  exit 1
fi

PREFIX="${STAGE}-balance-booking"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

echo -e "${BLUE}🚀 Balance Booking deploy — stage=${STAGE}${NC}\n"

echo -e "${BLUE}🔐 Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo -e "${RED}❌ AWS credentials not configured${NC}"
  exit 1
fi
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}✓ AWS account ${ACCOUNT_ID}${NC}\n"

echo -e "${BLUE}🔧 CDK bootstrap (idempotent)...${NC}"
(cd "$(dirname "$0")/.." && npx cdk bootstrap "aws://${ACCOUNT_ID}/${REGION}" --require-approval never 2>&1) \
  || echo "Bootstrap already exists or continuing"
echo ""

echo -e "${BLUE}📦 Building all workspaces...${NC}"
npm run build
echo -e "${GREEN}✓ Build OK${NC}\n"

echo -e "${BLUE}🚀 Pass 1: deploy backend stacks${NC}"
(cd "$(dirname "$0")/.." && \
  STAGE="$STAGE" npx cdk deploy \
    "${PREFIX}-auth" \
    "${PREFIX}-data" \
    "${PREFIX}-functions" \
    "${PREFIX}-api" \
    --require-approval never)
echo ""

echo -e "${BLUE}🔧 Configuring web app env from CFN outputs${NC}"
"$(dirname "$0")/configure-webapp.sh" "$STAGE"
echo ""

echo -e "${BLUE}🏗️  Building web app${NC}"
(cd web-app && npx tsc -b && npx vite build --mode "$STAGE")
echo -e "${GREEN}✓ Web app built${NC}\n"

echo -e "${BLUE}🚀 Pass 2: deploy web stack${NC}"
(cd "$(dirname "$0")/.." && \
  DEPLOY_BALANCE_WEB=true STAGE="$STAGE" npx cdk deploy \
    "${PREFIX}-web" \
    --require-approval never)
echo ""

# Re-run configure to pick up the now-known WebUrl and re-write env (so OAuth redirects point to CloudFront)
echo -e "${BLUE}🔁 Re-configuring web env with CloudFront URL${NC}"
"$(dirname "$0")/configure-webapp.sh" "$STAGE"
(cd web-app && npx tsc -b && npx vite build --mode "$STAGE")
(cd "$(dirname "$0")/.." && \
  DEPLOY_BALANCE_WEB=true STAGE="$STAGE" npx cdk deploy \
    "${PREFIX}-web" \
    --require-approval never)
echo ""

# Update Cognito user pool client OAuth callback URLs with the deployed CloudFront origin.
# Without this, hosted-UI redirects (forgotten password, federated identity etc.) fail in
# any deployed environment because only localhost is registered at synth time.
WEB_URL_FOR_CALLBACKS=$(aws cloudformation describe-stacks \
  --stack-name "${PREFIX}-web" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='WebUrl'].OutputValue" \
  --output text 2>/dev/null || echo "")
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "${PREFIX}-auth" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text 2>/dev/null || echo "")
USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name "${PREFIX}-auth" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
  --output text 2>/dev/null || echo "")

if [ -n "$WEB_URL_FOR_CALLBACKS" ] && [ -n "$USER_POOL_ID" ] && [ -n "$USER_POOL_CLIENT_ID" ]; then
  echo -e "${BLUE}🔁 Registering ${WEB_URL_FOR_CALLBACKS} as Cognito OAuth callback${NC}"
  # Non-fatal: a transient API error shouldn't sink the whole deploy. The OAuth
  # redirects are only used if/when we ever route through the Hosted UI; the custom
  # forms work without this update. Re-running the deploy will retry it.
  if aws cognito-idp update-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-id "$USER_POOL_CLIENT_ID" \
    --region "$REGION" \
    --supported-identity-providers COGNITO \
    --allowed-o-auth-flows code \
    --allowed-o-auth-flows-user-pool-client \
    --allowed-o-auth-scopes openid email profile \
    --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --callback-urls \
      "${WEB_URL_FOR_CALLBACKS}/auth/callback" \
      "${WEB_URL_FOR_CALLBACKS}/" \
      "http://localhost:3001/auth/callback" \
      "http://localhost:3001/" \
    --logout-urls \
      "${WEB_URL_FOR_CALLBACKS}/" \
      "http://localhost:3001/" \
    --prevent-user-existence-errors ENABLED >/dev/null; then
    echo -e "${GREEN}✓ Cognito callbacks updated${NC}\n"
  else
    echo -e "${YELLOW}⚠️  Failed to update Cognito callbacks (non-fatal — re-run deploy to retry)${NC}\n"
  fi
fi

if [ "$SEED" = "yes" ]; then
  echo -e "${BLUE}🌱 Seeding sample classes${NC}"
  aws lambda invoke \
    --function-name "${STAGE}-balance-booking-seed-classes" \
    --region "$REGION" \
    /tmp/seed-output.json >/dev/null
  echo -e "${GREEN}✓ Seeded:${NC} $(cat /tmp/seed-output.json)"
fi

if [ -n "$ADMIN_EMAIL" ]; then
  # Guard: never accept a manually-supplied password for prod — force the generated path so we
  # don't risk a weak default like 'password123' ever reaching production.
  if [ "$STAGE" = "prod" ] && [ -n "$ADMIN_PASSWORD" ]; then
    echo -e "${RED}❌ --admin-password is not allowed for prod. Omit it to use a generated password.${NC}"
    exit 1
  fi
  echo -e "${BLUE}👤 Bootstrapping admin user${NC}"
  if [ -n "$ADMIN_PASSWORD" ]; then
    "${SCRIPT_DIR}/create-admin.sh" "$STAGE" "$ADMIN_EMAIL" "$ADMIN_PASSWORD"
  else
    "${SCRIPT_DIR}/create-admin.sh" "$STAGE" "$ADMIN_EMAIL"
  fi
fi

WEB_URL=$(aws cloudformation describe-stacks \
  --stack-name "${PREFIX}-web" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='WebUrl'].OutputValue" \
  --output text 2>/dev/null || echo "")

GRAPHQL_URL=$(aws cloudformation describe-stacks \
  --stack-name "${PREFIX}-api" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='GraphqlUrl'].OutputValue" \
  --output text 2>/dev/null || echo "")

# Persist outputs for downstream tooling (e.g. PR comment in CI)
OUT_FILE=".balance-booking-outputs-${STAGE}.json"
cat > "$OUT_FILE" <<JSONEOF
{
  "stage": "${STAGE}",
  "webUrl": "${WEB_URL}",
  "graphqlUrl": "${GRAPHQL_URL}"
}
JSONEOF

# ────────────────────────────────────────────────────────────────────────────────
# Health check — fail loudly if the deployed stack isn't actually serving traffic.
# Catches the "interrupted destroy left CloudFront disabled" failure mode where
# the stack reports UPDATE_COMPLETE but the URL doesn't resolve.
# ────────────────────────────────────────────────────────────────────────────────
echo -e "${BLUE}🏥 Health check${NC}"

DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name "${PREFIX}-web" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text 2>/dev/null || echo "")

if [ -z "$WEB_URL" ] || [ -z "$DIST_ID" ]; then
  echo -e "${YELLOW}⚠️  Skipping health check — web stack not deployed${NC}"
else
  # 1. CloudFront distribution must be enabled. Catches the disabled-distribution drift.
  DIST_INFO=$(aws cloudfront get-distribution \
    --id "$DIST_ID" \
    --query '[Distribution.DistributionConfig.Enabled,Distribution.Status]' \
    --output text 2>/dev/null || echo "False NotFound")
  DIST_ENABLED=$(echo "$DIST_INFO" | awk '{print $1}')
  DIST_STATE=$(echo "$DIST_INFO" | awk '{print $2}')

  if [ "$DIST_ENABLED" != "True" ]; then
    echo -e "${RED}❌ CloudFront distribution ${DIST_ID} is disabled (Enabled=${DIST_ENABLED})${NC}"
    echo -e "${RED}   Likely cause: an interrupted destroy left it half-torn-down.${NC}"
    echo -e "${RED}   Fix: re-enable via 'aws cloudfront update-distribution', or re-run this script.${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ Distribution enabled (CloudFront status: ${DIST_STATE})${NC}"

  # 2. HTTP probe with retry — propagation can take a few minutes on first deploy or after
  # a config change (CloudFront takes ~5–15 min globally). 20 × 15s = 5 min max wait.
  MAX_ATTEMPTS=20
  ATTEMPT=0
  HTTP_CODE=0
  while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$WEB_URL" || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
      echo -e "${GREEN}✓ ${WEB_URL} returned 200 (attempt ${ATTEMPT}/${MAX_ATTEMPTS})${NC}"
      break
    fi
    if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
      echo -e "${YELLOW}⏳ HTTP ${HTTP_CODE} (attempt ${ATTEMPT}/${MAX_ATTEMPTS}) — retrying in 15s${NC}"
      sleep 15
    fi
  done

  if [ "$HTTP_CODE" != "200" ]; then
    echo -e "${RED}❌ Health check failed: ${WEB_URL} returned HTTP ${HTTP_CODE} after ${MAX_ATTEMPTS} attempts${NC}"
    echo -e "${RED}   Distribution is enabled but not serving — check S3 bucket contents and OAC policy.${NC}"
    exit 1
  fi
fi

echo -e "${GREEN}✅ Deploy complete${NC}"
echo -e "${YELLOW}Web:${NC}     ${WEB_URL}"
echo -e "${YELLOW}GraphQL:${NC} ${GRAPHQL_URL}"
