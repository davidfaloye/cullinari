import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UsageMeter as Meter } from '@cullinari/shared';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

const CAP_NOTES: Record<string, (m: Meter) => string> = {
  orders: (m) => (m.state === 'reached' ? 'Limit reached. The app is not taking new orders today.' : m.state === 'warning' ? 'Close to today’s limit' : 'Resets at midnight'),
  items: (m) => (m.state === 'reached' ? 'Limit reached. Archive items or upgrade to add more.' : ''),
  branches: () => '',
};

export function UsageMeter({ label, meter, kind }: { label: string; meter: Meter; kind: 'orders' | 'items' | 'branches' }) {
  return (
    <div className={`meter ${meter.state}`}>
      <div className="meter-top">
        <span>{label}</span>
        <span className="num">
          <b>{meter.used}</b> {meter.limit === null ? '· unlimited' : `of ${meter.limit}`}
        </span>
      </div>
      {meter.limit !== null && (
        <div className="bar" role="progressbar" aria-valuenow={meter.percent ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <i style={{ width: `${meter.percent}%` }} />
        </div>
      )}
      {CAP_NOTES[kind](meter) && <p className="note">{CAP_NOTES[kind](meter)}</p>}
    </div>
  );
}

/** Turns a PLAN_LIMIT_* error into an upgrade prompt; anything else into a plain message. */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiError && error.isPlanLimit) {
    return (
      <div className="notice" role="alert">
        <b>Plan limit reached</b>
        <span>{error.message}</span>
        <Link to="/billing">See plans and upgrade</Link>
      </div>
    );
  }
  return <p className="error" role="alert">{error instanceof Error ? error.message : 'Something went wrong'}</p>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function PlanBadge({ plan }: { plan: 'Growth' | 'Pro' }) {
  return <span className="lock" title={`Included in ${plan}`}>{plan}</span>;
}

/* toasts */
const ToastCtx = createContext<(msg: string, tone?: 'ok' | 'bad') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'bad'; id: number } | null>(null);
  const show = useCallback((msg: string, tone: 'ok' | 'bad' = 'ok') => setToast({ msg, tone, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.tone === 'bad' ? 'bad' : ''}`} role="status" aria-live="polite">
          {toast.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* icons: simple strokes, currentColor */
const paths: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  orders: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6',
  menu: 'M4 6h16M4 12h16M4 18h10',
  inventory: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10',
  branches: 'M3 9l2-5h14l2 5M3 9c0 2 3 2 4.5 0 1.5 2 3 2 4.5 0 1.5 2 3 2 4.5 0 1.5 2 4.5 2 4.5 0M5 11v9h14v-9',
  team: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  billing: 'M3 6h18v12H3zM3 10h18M7 15h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z',
};
export function Icon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

export function Cloche() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 22a12 12 0 0 1 24 0z" fill="currentColor" />
      <rect x="2" y="23.5" width="28" height="3.2" rx="1.6" fill="currentColor" />
      <circle cx="16" cy="7" r="2.2" fill="currentColor" />
    </svg>
  );
}
