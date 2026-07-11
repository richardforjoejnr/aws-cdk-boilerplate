#!/bin/bash

# Deploy Ghana Payments PoC
# Usage: ./scripts/deploy-ghana-payments.sh <stage>
# Example: ./scripts/deploy-ghana-payments.sh dev
#
# Add new stacks to GHANA_STACKS (deploy order) as roadmap phases land.
# Design: packages/ghana-payments/docs/planning/architecture.md

set -e

STAGE=${1:-dev}

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Stacks in dependency order. Future phases append here (e.g. api, iot, web).
GHANA_STACKS=(
  "${STAGE}-ghana-payments-foundation"
  "${STAGE}-ghana-payments-api"
  "${STAGE}-ghana-payments-web"
)

echo "==============================================="
echo "Deploying Ghana Payments PoC to ${STAGE}"
echo "Stacks: ${GHANA_STACKS[*]}"
echo "==============================================="

echo -e "${BLUE}Step 1: Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

echo -e "${BLUE}Step 2: Building ghana-payments package...${NC}"
npm run build --workspace=@aws-boilerplate/ghana-payments
echo -e "${GREEN}✓ Package built${NC}"

echo -e "${BLUE}Step 3: Deploying infrastructure...${NC}"
cd packages/infrastructure
STAGE=${STAGE} npx cdk deploy "${GHANA_STACKS[@]}" --require-approval never
cd ../..
echo -e "${GREEN}✓ Infrastructure deployed${NC}"

echo -e "${BLUE}Step 4: Stack outputs...${NC}"
for stack in "${GHANA_STACKS[@]}"; do
  echo -e "${BLUE}${stack}:${NC}"
  aws cloudformation describe-stacks \
    --stack-name "${stack}" \
    --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' \
    --output table || echo -e "${RED}Could not read outputs for ${stack}${NC}"
done

echo -e "${GREEN}✓ Ghana Payments PoC deployed to ${STAGE}${NC}"
