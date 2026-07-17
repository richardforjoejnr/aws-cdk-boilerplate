/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GRAPHQL_URL?: string;
  readonly VITE_GRAPHQL_API_KEY?: string;
  readonly VITE_AWS_REGION?: string;
  readonly VITE_USER_POOL_ID?: string;
  readonly VITE_USER_POOL_CLIENT_ID?: string;
  readonly VITE_HOSTED_UI_DOMAIN?: string;
  readonly VITE_REDIRECT_SIGN_IN?: string;
  readonly VITE_REDIRECT_SIGN_OUT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
