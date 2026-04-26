import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
// Amplify v6: import from the umbrella `aws-amplify` package and `aws-amplify/auth`
// subpath. Using `@aws-amplify/core` + `@aws-amplify/auth` directly can result in two
// different singleton instances under some bundler configurations — `Amplify.configure()`
// writes to one and `signIn` reads from the other, producing "Auth UserPool not configured".
import { Amplify } from 'aws-amplify';
import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  signOut as amplifySignOut,
  fetchAuthSession,
  getCurrentUser,
} from 'aws-amplify/auth';
import { config } from '../lib/config';
import { setAuthToken } from '../lib/api';

if (config.userPoolId && config.userPoolClientId) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        loginWith: {
          oauth: {
            domain: config.hostedUiDomain,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [config.redirectSignIn],
            redirectSignOut: [config.redirectSignOut],
            responseType: 'code',
          },
        },
      },
    },
  });
}

interface AuthUser {
  userId: string;
  email: string;
  groups: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!config.userPoolId) {
      setLoading(false);
      return;
    }
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      if (!idToken) {
        setUser(null);
        setAuthToken(null);
        return;
      }
      setAuthToken(idToken.toString());
      const current = await getCurrentUser();
      const groups = (idToken.payload['cognito:groups'] as string[] | undefined) ?? [];
      setUser({
        userId: current.userId,
        email: (idToken.payload.email as string) ?? '',
        groups,
      });
    } catch {
      setUser(null);
      setAuthToken(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    refresh,
    signIn: async (email, password) => {
      await amplifySignIn({ username: email, password });
      await refresh();
    },
    signUp: async (email, password) => {
      await amplifySignUp({
        username: email,
        password,
        options: { userAttributes: { email } },
      });
    },
    signOut: async () => {
      await amplifySignOut();
      setUser(null);
      setAuthToken(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
