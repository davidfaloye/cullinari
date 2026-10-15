import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { Cloche, ErrorNotice, Field } from '../components/ui';
import { api } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-art">
        <span className="brand">
          <Cloche />
          Cullinari
        </span>
        <h1>
          Run the whole kitchen, <em>every branch</em>, from one screen.
        </h1>
        <p style={{ opacity: 0.8 }}>Orders, menu, stock and sales for your restaurant.</p>
      </div>
      <div className="auth-form">
        <form className="card" onSubmit={submit}>
          <div>
            <h1>Sign in</h1>
            <p className="muted">Use the email your restaurant added you with.</p>
          </div>
          <Field label="Email">
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNotice error={error} />
          <button className="btn lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}

/** Shown to staff signing in with a temporary password. */
export function ChangePassword({ forced }: { forced?: boolean }) {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/auth/password', { method: 'POST', body: { current, next } });
      setDone(true);
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="auth-form" style={{ minHeight: '100%' }}>
      <form className="card" onSubmit={submit}>
        <div>
          <h1>Choose a password</h1>
          <p className="muted">{forced ? 'You signed in with a temporary password. Pick your own to continue.' : 'Change your password.'}</p>
        </div>
        <Field label="Current password">
          <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 8 characters">
          <input type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <ErrorNotice error={error} />
        {done && <p className="muted">Password changed.</p>}
        <button className="btn lg">Save password</button>
        <button type="button" className="link" onClick={logout}>Sign out</button>
      </form>
    </div>
  );
}
