#!/bin/bash

# Configure Web App with AppSync API Details
# Usage: ./scripts/configure-webapp.sh [dev|test|prod]

set -e

STAGE=${1:-dev}
REGION=${AWS_REGION:-us-east-1}
CONFIG_FILE="packages/web-app/src/amplifyconfiguration.ts"

echo "🔧 Configuring web app for stage: $STAGE"
echo "Region: $REGION"
echo ""

# Get CloudFormation stack outputs
STACK_NAME="${STAGE}-aws-boilerplate-appsync"

echo "📡 Fetching AppSync API details from CloudFormation..."

# Check if stack exists
if ! aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &>/dev/null; then
    echo "❌ Error: Stack '$STACK_NAME' not found in region $REGION"
    echo ""
    echo "Please deploy the infrastructure first:"
    echo "  npm run deploy:$STAGE"
    exit 1
fi

# Get API URL
API_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`GraphQLApiUrl`].OutputValue' \
    --output text)

# Get API Key
API_KEY=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`GraphQLApiKey`].OutputValue' \
    --output text)

if [ -z "$API_URL" ] || [ -z "$API_KEY" ]; then
    echo "❌ Error: Could not retrieve API details from CloudFormation"
    exit 1
fi

echo "✅ Retrieved API details:"
echo "   API URL: $API_URL"
echo "   API Key: ${API_KEY:0:10}..."
echo ""

# Update configuration file
echo "📝 Updating configuration file..."

cat > "$CONFIG_FILE" << EOF
// Amplify configuration for AWS AppSync
// Auto-generated for stage: $STAGE
// Generated at: $(date)

export const amplifyConfig = {
  aws_project_region: '$REGION',
  aws_appsync_graphqlEndpoint: '$API_URL',
  aws_appsync_region: '$REGION',
  aws_appsync_authenticationType: 'API_KEY',
  aws_appsync_apiKey: '$API_KEY',
};
EOF

echo "✅ Configuration file updated: $CONFIG_FILE"
echo ""
echo "🎉 Web app is now configured for the $STAGE environment!"
echo ""
echo "To run the web app:"
echo "  cd packages/web-app"
echo "  npm run dev"
echo ""
echo "The app will be available at http://localhost:3000"
