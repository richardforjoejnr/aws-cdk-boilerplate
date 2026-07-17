import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../lib/config';

type Mode = 'signin' | 'signup' | 'confirm';

export function AuthCallbackPage() {
  const { user, signIn, signUp, confirmSignUp, resendSignUpCode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

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
      } else if (mode === 'signup') {
        const result = await signUp(email, password);
        if (result.confirmed) {
          // Some flows (admin-created users, federated identity) skip email verification.
          setInfo('Account created. You can sign in now.');
          setMode('signin');
          setPassword('');
        } else {
          // Standard flow: Cognito has emailed a 6-digit code to verify the address.
          setInfo("We've emailed you a 6-digit verification code. Enter it below to finish.");
          setMode('confirm');
          setCode('');
          setPassword('');
        }
      } else {
        await confirmSignUp(email, code.trim());
        setInfo('Email verified! You can sign in now.');
        setMode('signin');
        setCode('');
      }
    } catch (err) {
      setError(humanizeAuthError(err as Error));
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      await resendSignUpCode(email);
      setInfo('New code sent. Check your email — it can take a minute to arrive.');
    } catch (err) {
      setError(humanizeAuthError(err as Error));
    } finally {
      setResending(false);
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

  const heading =
    mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Verify your email';

  return (
    <section className="max-w-md">
      <h1 className="text-4xl mt-0">{heading}</h1>

      {mode === 'confirm' && (
        <p className="text-text-muted mt-2">
          We've sent a 6-digit code to <strong>{email}</strong>. Enter it below to finish creating
          your account, then you can sign in.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-medium">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={mode === 'confirm'}
            className="p-3 border border-stone rounded-md bg-white disabled:bg-stone disabled:text-text-muted"
          />
        </label>

        {mode !== 'confirm' && (
          <label className="flex flex-col gap-2">
            <span className="font-medium">Password</span>
            <input
              required
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="p-3 border border-stone rounded-md bg-white"
            />
            {mode === 'signup' && (
              <span className="text-xs text-text-muted">
                Must be at least 8 characters with a lowercase letter and a number.
              </span>
            )}
          </label>
        )}

        {mode === 'confirm' && (
          <label className="flex flex-col gap-2">
            <span className="font-medium">Verification code</span>
            <input
              required
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="p-3 border border-stone rounded-md bg-white text-2xl tracking-widest text-center"
              placeholder="123456"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="px-8 py-3 rounded-full bg-charcoal text-white disabled:opacity-50"
        >
          {submitting
            ? '…'
            : mode === 'signin'
              ? 'Sign in'
              : mode === 'signup'
                ? 'Create account'
                : 'Verify email'}
        </button>

        {error && <p className="text-error">{error}</p>}
        {info && <p className="text-text-muted">{info}</p>}
      </form>

      <div className="mt-6 flex flex-col gap-2 text-sm">
        {mode === 'signin' && (
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setError(null);
              setInfo(null);
            }}
            className="text-left text-text-muted hover:text-charcoal"
          >
            Need an account? Create one
          </button>
        )}
        {mode === 'signup' && (
          <button
            type="button"
            onClick={() => {
              setMode('signin');
              setError(null);
              setInfo(null);
            }}
            className="text-left text-text-muted hover:text-charcoal"
          >
            Have an account? Sign in
          </button>
        )}
        {mode === 'confirm' && (
          <>
            <button
              type="button"
              onClick={onResend}
              disabled={resending}
              className="text-left text-text-muted hover:text-charcoal disabled:opacity-50"
            >
              {resending ? 'Sending…' : "Didn't get the code? Resend it"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
                setInfo(null);
              }}
              className="text-left text-text-muted hover:text-charcoal"
            >
              Already verified? Sign in
            </button>
          </>
        )}
      </div>
    </section>
  );
}

// Cognito errors come back with cryptic class names. Translate the common ones.
function humanizeAuthError(err: Error): string {
  const name = err.name;
  const msg = err.message;
  if (name === 'CodeMismatchException')
    return "That code doesn't match. Double-check and try again.";
  if (name === 'ExpiredCodeException')
    return 'That code has expired. Tap "Resend it" to get a new one.';
  if (name === 'UserNotConfirmedException')
    return "Your email isn't verified yet. Check your inbox for the code.";
  if (name === 'NotAuthorizedException') return 'Wrong email or password.';
  if (name === 'UsernameExistsException')
    return 'An account with this email already exists. Try signing in.';
  if (name === 'InvalidPasswordException') return msg.replace(/^.*?:\s*/, '');
  if (name === 'LimitExceededException')
    return 'Too many attempts. Please wait a few minutes and try again.';
  return msg || 'Something went wrong. Please try again.';
}
