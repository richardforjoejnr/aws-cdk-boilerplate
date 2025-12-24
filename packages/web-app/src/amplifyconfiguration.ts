// Amplify configuration for AWS AppSync
// Dynamically configured from environment variables

function getEnvString(key: keyof ImportMetaEnv, fallback = ''): string {
  const env = import.meta.env as ImportMetaEnv;
  return typeof env[key] === 'string' ? env[key] : fallback;
}

const apiUrl: string = getEnvString('VITE_GRAPHQL_API_URL');
const apiKey: string = getEnvString('VITE_GRAPHQL_API_KEY');
const region: string = getEnvString('VITE_AWS_REGION', 'us-east-1');

if (!apiUrl || !apiKey) {
  console.error('Missing required environment variables:');
  console.error('VITE_GRAPHQL_API_URL:', apiUrl);
  console.error('VITE_GRAPHQL_API_KEY:', apiKey ? '[REDACTED]' : 'missing');
  throw new Error('Amplify configuration is missing required environment variables. Please run: npm run webapp:config:dev');
}

interface AmplifyConfig {
  aws_project_region: string;
  aws_appsync_graphqlEndpoint: string;
  aws_appsync_region: string;
  aws_appsync_authenticationType: string;
  aws_appsync_apiKey: string;
}

export const amplifyConfig: AmplifyConfig = {
  aws_project_region: region,
  aws_appsync_graphqlEndpoint: apiUrl,
  aws_appsync_region: region,
  aws_appsync_authenticationType: 'API_KEY',
  aws_appsync_apiKey: apiKey,
};
