import { useQuery } from '@tanstack/react-query';
import type { Entitlements, PlanCode, UsageSummary } from '@cullinari/shared';
import { api } from '../lib/api';
import { ErrorNotice, UsageMeter } from '../components/ui';

interface BillingData {
  plan: PlanCode;
  status: string;
  entitlements: Entitlements;
  usage: UsageSummary;
  plans: { code: PlanCode; name: string; monthlyUsd: number; setupUsd: number; entitlements: Entitlements }[];
}

const cap = (n: number | null) => (n === null ? 'Unlimited' : n.toLocaleString());
const APP_FEATURES: Record<PlanCode, string[]> = {
  starter: ['Your own ordering app', 'Logo, colours and menu'],
  growth: ['Custom splash screen', 'Choice of menu layouts', 'A few extra app options'],
  pro: ['Custom features built for you', 'Your own domain', 'Priority support'],
};
const SALES_EMAIL = 'hello@cullinari.com';

export function Billing() {
  const q = useQuery({ queryKey: ['billing'], queryFn: () => api<BillingData>('/billing') });
  const d = q.data;
  if (q.isError) return <main className="content"><ErrorNotice error={q.error} /></main>;
  if (!d) return <main className="content"><p className="muted">Loading…</p></main>;
  const current = d.plans.find((p) => p.code === d.plan)!;
  const order: PlanCode[] = ['starter', 'growth', 'pro'];

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <h1>Billing</h1>
          <p className="muted">You're on <b>{current.name}</b> at ${current.monthlyUsd}/month. All prices in US dollars.</p>
        </div>
      </div>

      <section className="card grid" style={{ gap: 18 }}>
        <h2>Usage</h2>
        <div className="grid cols-2" style={{ gap: 24 }}>
          <UsageMeter label="Online orders today" meter={d.usage.orders_today} kind="orders" />
          <UsageMeter label="Inventory items" meter={d.usage.inventory_items} kind="items" />
          <UsageMeter label="Branches" meter={d.usage.branches} kind="branches" />
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {d.plans.map((p) => {
          const isCurrent = p.code === d.plan;
          const isUpgrade = order.indexOf(p.code) > order.indexOf(d.plan);
          const setupDiff = Math.max(0, p.setupUsd - current.setupUsd);
          return (
            <article key={p.code} className="card grid" style={{ gap: 12, borderColor: isCurrent ? 'var(--accent)' : undefined, borderWidth: isCurrent ? 2 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h2>{p.name}</h2>
                {isCurrent && <span className="pill green">Current plan</span>}
              </div>
              <div><span style={{ fontFamily: 'var(--f-display)', fontWeight: 800, fontSize: '2.2rem' }}>${p.monthlyUsd}</span> <span className="muted">/ month</span></div>
              <table>
                <tbody>
                  <tr><td className="muted">Orders per day</td><td className="num" style={{ textAlign: 'right' }}>{cap(p.entitlements.max_orders_per_day)}</td></tr>
                  <tr><td className="muted">Inventory items</td><td className="num" style={{ textAlign: 'right' }}>{cap(p.entitlements.max_inventory_items)}</td></tr>
                  <tr><td className="muted">Branches</td><td className="num" style={{ textAlign: 'right' }}>{p.entitlements.max_branches === null ? 'Many' : p.entitlements.max_branches}</td></tr>
                  <tr><td className="muted">App setup, one time</td><td className="num" style={{ textAlign: 'right' }}>${p.setupUsd}</td></tr>
                </tbody>
              </table>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }} className="muted">
                {APP_FEATURES[p.code].map((f) => <li key={f}>{f}</li>)}
              </ul>
              {isUpgrade && (
                <>
                  <p style={{ fontSize: 13 }} className="muted">
                    Upgrading costs the rest of this month at the new price{setupDiff ? `, plus $${setupDiff} setup difference` : ''}. New limits apply immediately.
                  </p>
                  <a
                    className="btn"
                    href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`Upgrade to ${p.name}`)}`}
                  >
                    {p.code === 'pro' ? 'Talk to us about Pro' : `Upgrade to ${p.name}`}
                  </a>
                </>
              )}
            </article>
          );
        })}
      </section>
      <p className="muted" style={{ fontSize: 14 }}>
        Self-serve upgrades and card billing are coming. For now, upgrades are applied by the Cullinari team, usually within the hour.
      </p>
    </main>
  );
}
