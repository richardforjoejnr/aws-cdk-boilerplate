import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../lib/config';

export function AuthCallbackPage() {
  const { user, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    }
  }, [user, navigate, location.state]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        await signUp(email, password);
        setInfo('Account created. Check your email to verify, then sign in.');
        setMode('signin');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!config.userPoolId) {
    return (
      <section>
        <h1 className="text-4xl mt-0">Sign in</h1>
        <p className="text-text-muted">
          Auth not configured yet — set <code>VITE_USER_POOL_ID</code> and
          <code> VITE_USER_POOL_CLIENT_ID</code> after the auth stack deploys.
        </p>
      </section>
    );
  }

  return (
    <section className="max-w-md">
      <h1 className="text-4xl mt-0">{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-medium">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="p-3 border border-stone rounded-md bg-white"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-medium">Password</span>
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="p-3 border border-stone rounded-md bg-white"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="px-8 py-3 rounded-full bg-charcoal text-white disabled:opacity-50"
        >
          {submitting ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        {error && <p className="text-error">{error}</p>}
        {info && <p className="text-text-muted">{info}</p>}
      </form>
      <button
        type="button"
        onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
        className="mt-4 text-text-muted hover:text-charcoal"
      >
        {mode === 'signin' ? 'Need an account? Create one' : 'Have an account? Sign in'}
      </button>
    </section>
  );
}
