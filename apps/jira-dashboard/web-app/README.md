# Web App - AWS Amplify Frontend

A simple React application that demonstrates CRUD operations using AWS AppSync GraphQL API and DynamoDB.

## Features

- List all items from DynamoDB
- Create new items
- Delete items
- Real-time updates after create/delete operations

## Setup

### 1. Install Dependencies

From the root of the project:

```bash
npm install
```

### 2. Configure AWS AppSync Connection

Before running the app, you need to configure the AppSync API connection:

1. Open `src/amplifyconfiguration.ts`
2. Update the configuration with your AppSync API details:

```typescript
export const amplifyConfig = {
  aws_project_region: 'us-east-1',
  aws_appsync_graphqlEndpoint: 'YOUR_APPSYNC_URL_HERE',
  aws_appsync_region: 'us-east-1',
  aws_appsync_authenticationType: 'API_KEY',
  aws_appsync_apiKey: 'YOUR_API_KEY_HERE',
};
```

### 3. Get Your AppSync API Details

You can get these values from the CloudFormation stack outputs:

```bash
# For dev environment
aws cloudformation describe-stacks \
  --stack-name dev-aws-boilerplate-appsync \
  --query 'Stacks[0].Outputs' \
  --output table

# For prod environment
aws cloudformation describe-stacks \
  --stack-name prod-aws-boilerplate-appsync \
  --query 'Stacks[0].Outputs' \
  --output table
```

Or view them in the AWS Console:
- Go to CloudFormation → Stacks → `{stage}-aws-boilerplate-appsync` → Outputs tab

You'll need:
- `GraphQLApiUrl` → `aws_appsync_graphqlEndpoint`
- `GraphQLApiKey` → `aws_appsync_apiKey`

### 4. Run the Development Server

From the web-app directory:

```bash
npm run dev
```

Or from the root:

```bash
cd packages/web-app && npm run dev
```

The app will be available at `http://localhost:3000`

## Deploying to AWS

To deploy the web app to AWS (S3 + CloudFront), run from the **root** directory:

```bash
# From project root
npm run deploy:webapp:dev   # Deploy to dev
npm run deploy:webapp:test  # Deploy to test
npm run deploy:webapp:prod  # Deploy to prod
```

This will:
1. Automatically configure the app with your AppSync API details
2. Build the production bundle
3. Create/update S3 bucket and CloudFront distribution
4. Deploy the built app
5. Output the CloudFront URL

To get the deployed URL:

```bash
aws cloudformation describe-stacks \
  --stack-name dev-aws-boilerplate-web-app \
  --query 'Stacks[0].Outputs[?OutputKey==`WebAppUrl`].OutputValue' \
  --output text
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Lint TypeScript files

## Project Structure

```
src/
├── components/
│   ├── CreateItemForm.tsx  # Form to create new items
│   └── DataTable.tsx        # Table to display items
├── graphql/
│   └── operations.ts        # GraphQL queries and mutations
├── amplifyconfiguration.ts  # Amplify/AppSync configuration
├── types.ts                 # TypeScript type definitions
├── App.tsx                  # Main application component
├── App.css                  # Application styles
└── main.tsx                 # Application entry point
```

## GraphQL Operations

The app uses the following GraphQL operations:

- `listItems` - Query to fetch all items
- `createItem` - Mutation to create a new item
- `deleteItem` - Mutation to delete an item

## Troubleshooting

### "Failed to fetch items" error

This usually means the AppSync configuration is incorrect. Make sure:

1. The `aws_appsync_graphqlEndpoint` is correct
2. The `aws_appsync_apiKey` is valid and not expired
3. The API key has not been rotated

### CORS errors

If you see CORS errors:

1. Check that your AppSync API allows the origin
2. Make sure you're using the correct authentication type (API_KEY)

### Build errors

If you encounter TypeScript errors:

```bash
npm run build
```

Check the console output for specific errors.

## Next Steps

- Add update functionality
- Add pagination for large datasets
- Add filtering and search
- Implement real-time subscriptions with AppSync subscriptions
- Add authentication with Cognito
