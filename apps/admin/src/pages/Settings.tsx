import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toMajor, toMinor } from '../lib/format';
import { ErrorNotice, Field, useToast } from '../components/ui';

interface SettingsData {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  deliveryFeeMinor: number;
  taxRateBps: number;
  payOnDeliveryEnabled: boolean;
  orderingPaused: boolean;
  paystackPublicKey: string | null;
  paystackSecretKeySet: boolean;
  paystackWebhookUrl: string;
}

export function Settings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsData>('/settings') });
  const [form, setForm] = useState({ name: '', timezone: '', deliveryFee: '', taxPercent: '', payOnDelivery: true, paused: false, pk: '', sk: '' });

  useEffect(() => {
    if (!q.data) return;
    const s = q.data;
    setForm({
      name: s.name,
      timezone: s.timezone,
      deliveryFee: toMajor(s.deliveryFeeMinor),
      taxPercent: String(s.taxRateBps / 100),
      payOnDelivery: s.payOnDeliveryEnabled,
      paused: s.orderingPaused,
      pk: s.paystackPublicKey ?? '',
      sk: '',
    });
  }, [q.data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<SettingsData>('/settings', { method: 'PATCH', body }),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      void qc.invalidateQueries({ queryKey: ['me'] });
      toast('Settings saved');
    },
  });

  if (q.isError) return <main className="content"><ErrorNotice error={q.error} /></main>;
  const s = q.data;
  if (!s) return <main className="content"><p className="muted">Loading…</p></main>;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <main className="content">
      <div className="page-head"><h1>Settings</h1></div>

      <section className="card form">
        <h2>Online ordering</h2>
        <label className="check">
          <input type="checkbox" checked={form.paused} onChange={(e) => { setForm({ ...form, paused: e.target.checked }); save.mutate({ orderingPaused: e.target.checked }); }} />
          Pause online orders (the app tells customers you're not taking orders right now)
        </label>
        <div className="row">
          <Field label="Delivery fee (₦)"><input type="number" min="0" value={form.deliveryFee} onChange={set('deliveryFee')} /></Field>
          <Field label="Tax (%)" hint="Added on top of menu prices. Leave 0 if prices include tax."><input type="number" min="0" max="50" step="0.01" value={form.taxPercent} onChange={set('taxPercent')} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={form.payOnDelivery} onChange={(e) => setForm({ ...form, payOnDelivery: e.target.checked })} /> Allow pay on delivery / pay at pickup</label>
        <div>
          <button className="btn" disabled={save.isPending} onClick={() => save.mutate({ deliveryFeeMinor: toMinor(form.deliveryFee || 0), taxRateBps: Math.round(Number(form.taxPercent || 0) * 100), payOnDeliveryEnabled: form.payOnDelivery })}>Save</button>
        </div>
      </section>

      <section className="card form">
        <h2>Card payments (Paystack)</h2>
        <p className="muted">Customers pay into your own Paystack account. Find your keys in Paystack under Settings → API Keys & Webhooks.</p>
        <div className="row">
          <Field label="Public key"><input value={form.pk} onChange={set('pk')} placeholder="pk_live_…" autoComplete="off" /></Field>
          <Field label="Secret key" hint={s.paystackSecretKeySet ? 'Saved. Paste a new key only to replace it.' : 'Stored encrypted. Never shown again.'}>
            <input type="password" value={form.sk} onChange={set('sk')} placeholder={s.paystackSecretKeySet ? '••••••••••••' : 'sk_live_…'} autoComplete="off" />
          </Field>
        </div>
        <Field label="Webhook URL" hint="Paste this into Paystack as your webhook URL so payments confirm automatically.">
          <input readOnly value={s.paystackWebhookUrl} onFocus={(e) => e.target.select()} />
        </Field>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={save.isPending} onClick={() => save.mutate({ paystackPublicKey: form.pk || null, ...(form.sk ? { paystackSecretKey: form.sk } : {}) })}>Save keys</button>
          {s.paystackSecretKeySet && <button className="btn danger" onClick={() => confirm('Turn off card payments?') && save.mutate({ paystackSecretKey: null, paystackPublicKey: null })}>Remove keys</button>}
        </div>
      </section>

      <section className="card form">
        <h2>Restaurant</h2>
        <div className="row">
          <Field label="Name"><input value={form.name} onChange={set('name')} /></Field>
          <Field label="Timezone" hint="Your daily order count resets at midnight here."><input value={form.timezone} onChange={set('timezone')} /></Field>
        </div>
        <p className="muted" style={{ fontSize: 14 }}>App link name: <span className="mono">{s.slug}</span></p>
        <div><button className="btn" disabled={save.isPending} onClick={() => save.mutate({ name: form.name, timezone: form.timezone })}>Save</button></div>
      </section>
      <ErrorNotice error={save.error} />
    </main>
  );
}
