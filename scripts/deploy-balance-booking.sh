#!/bin/bash

# Two-pass deploy of the Balance Booking POC.
# Pass 1: deploy backend stacks → read outputs → configure web env
# Pass 2: build web → deploy web stack
# Usage: ./deploy-balance-booking.sh [dev|test|prod|pr-N] [--seed]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}
SEED=""
shift || true
for arg in "$@"; do
  case $arg in
    --seed) SEED="yes" ;;
  esac
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
(cd packages/infrastructure && npx cdk bootstrap "aws://${ACCOUNT_ID}/${REGION}" --require-approval never 2>&1) \
  || echo "Bootstrap already exists or continuing"
echo ""

echo -e "${BLUE}📦 Building all workspaces...${NC}"
npm run build
echo -e "${GREEN}✓ Build OK${NC}\n"

echo -e "${BLUE}🚀 Pass 1: deploy backend stacks${NC}"
(cd packages/infrastructure && \
  STAGE="$STAGE" npx cdk deploy \
    "${PREFIX}-auth" \
    "${PREFIX}-data" \
    "${PREFIX}-functions" \
    "${PREFIX}-api" \
    --require-approval never)
echo ""

echo -e "${BLUE}🔧 Configuring web app env from CFN outputs${NC}"
./scripts/configure-balance-webapp.sh "$STAGE"
echo ""

echo -e "${BLUE}🏗️  Building web app${NC}"
(cd packages/balance-booking-web && npm run build)
echo -e "${GREEN}✓ Web app built${NC}\n"

echo -e "${BLUE}🚀 Pass 2: deploy web stack${NC}"
(cd packages/infrastructure && \
  DEPLOY_BALANCE_WEB=true STAGE="$STAGE" npx cdk deploy \
    "${PREFIX}-web" \
    --require-approval never)
echo ""

# Re-run configure to pick up the now-known WebUrl and re-write env (so OAuth redirects point to CloudFront)
echo -e "${BLUE}🔁 Re-configuring web env with CloudFront URL${NC}"
./scripts/configure-balance-webapp.sh "$STAGE"
(cd packages/balance-booking-web && npm run build)
(cd packages/infrastructure && \
  DEPLOY_BALANCE_WEB=true STAGE="$STAGE" npx cdk deploy \
    "${PREFIX}-web" \
    --require-approval never)
echo ""

if [ "$SEED" = "yes" ]; then
  echo -e "${BLUE}🌱 Seeding sample classes${NC}"
  aws lambda invoke \
    --function-name "${STAGE}-balance-booking-seed-classes" \
    --region "$REGION" \
    /tmp/seed-output.json >/dev/null
  echo -e "${GREEN}✓ Seeded:${NC} $(cat /tmp/seed-output.json)"
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

echo -e "${GREEN}✅ Deploy complete${NC}"
echo -e "${YELLOW}Web:${NC}     ${WEB_URL}"
echo -e "${YELLOW}GraphQL:${NC} ${GRAPHQL_URL}"
