// Amplify configuration for AWS AppSync
// Dynamically configured from environment variables

const apiUrl = import.meta.env.VITE_GRAPHQL_API_URL;
const apiKey = import.meta.env.VITE_GRAPHQL_API_KEY;
const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';

if (!apiUrl || !apiKey) {
  console.error('Missing required environment variables:');
  console.error('VITE_GRAPHQL_API_URL:', apiUrl);
  console.error('VITE_GRAPHQL_API_KEY:', apiKey ? '[REDACTED]' : 'missing');
  throw new Error('Amplify configuration is missing required environment variables. Please run: npm run webapp:config:dev');
}

export const amplifyConfig = {
  aws_project_region: region,
  aws_appsync_graphqlEndpoint: apiUrl,
  aws_appsync_region: region,
  aws_appsync_authenticationType: 'API_KEY',
  aws_appsync_apiKey: apiKey,
};
