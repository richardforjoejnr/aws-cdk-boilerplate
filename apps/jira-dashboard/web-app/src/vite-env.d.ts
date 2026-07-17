/// <reference types="vite/client" />

declare module 'vite/client' {
  interface ImportMetaEnv {
    readonly VITE_STAGE: string
    readonly VITE_AWS_REGION: string
    readonly VITE_GRAPHQL_API_URL: string
    readonly VITE_GRAPHQL_API_KEY: string
    readonly VITE_GRAPHQL_API_ID: string
  }
}
