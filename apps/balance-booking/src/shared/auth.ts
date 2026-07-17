import type { AppSyncIdentityCognito } from './types.js';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Unauthorized';
  }
}

export function requireUser(identity: AppSyncIdentityCognito | null): {
  userId: string;
  email: string;
  isAdmin: boolean;
} {
  if (!identity?.sub) {
    throw new AuthError('Sign-in required');
  }
  const groups = identity.claims['cognito:groups'] ?? [];
  return {
    userId: identity.sub,
    email: identity.claims.email ?? '',
    isAdmin: groups.includes('admin'),
  };
}

export function requireAdmin(identity: AppSyncIdentityCognito | null): {
  userId: string;
  email: string;
} {
  const user = requireUser(identity);
  if (!user.isAdmin) {
    throw new AuthError('Admin access required');
  }
  return { userId: user.userId, email: user.email };
}
