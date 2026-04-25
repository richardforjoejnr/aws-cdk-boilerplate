export const config = {
  graphqlUrl: import.meta.env.VITE_GRAPHQL_URL ?? '',
  region: import.meta.env.VITE_AWS_REGION ?? 'us-east-1',
  userPoolId: import.meta.env.VITE_USER_POOL_ID ?? '',
  userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID ?? '',
  hostedUiDomain: import.meta.env.VITE_HOSTED_UI_DOMAIN ?? '',
  redirectSignIn: import.meta.env.VITE_REDIRECT_SIGN_IN ?? 'http://localhost:3001/auth/callback',
  redirectSignOut: import.meta.env.VITE_REDIRECT_SIGN_OUT ?? 'http://localhost:3001/',
};
