import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { ReactNode } from 'react';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <p className="text-text-muted">Loading…</p>;
  }
  if (!user) {
    return <Navigate to="/auth/callback" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}
