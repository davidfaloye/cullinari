import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { UsageSummary } from '@cullinari/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, qty } from '../lib/format';
import { Empty, UsageMeter } from '../components/ui';

interface Dashboard {
  today: { revenueMinor: number; orders: number; activeOrders: number; cancelled: number };
  usage: UsageSummary;
  topItems: { name: string; quantity: number; revenueMinor: number }[];
  last7Days: { day: string; revenueMinor: number; orders: number }[];
  lowStock: { id: string; name: string; unit: string; qty: number; reorderLevel: number; branchName: string }[];
}

export function Home() {
  const { me, branchId, branches } = useAuth();
  const q = useQuery({
    queryKey: ['dashboard', branchId ?? 'all'],
    queryFn: () => api<Dashboard>('/dashboard', { query: { branchId } }),
    refetchInterval: 60_000,
  });
  const d = q.data;
  const cur = me?.tenant.currency ?? 'NGN';
  const scope = branchId ? branches.find((b) => b.id === branchId)?.name : branches.length > 1 ? 'All branches' : null;

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <h1>Today</h1>
          <p className="muted">{new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}{scope ? ` · ${scope}` : ''}</p>
        </div>
        <Link className="btn" to="/orders">Open order queue</Link>
      </div>

      {q.isError && <p className="error">Couldn't load today's numbers.</p>}

      <section className="grid cols-4" aria-label="Today's numbers">
        <Stat label="Revenue" value={d ? money(d.today.revenueMinor, cur) : '—'} />
        <Stat label="Orders" value={d ? String(d.today.orders) : '—'} />
        <Stat label="In progress" value={d ? String(d.today.activeOrders) : '—'} />
        <Stat label="Avg. order" value={d && d.today.orders ? money(Math.round(d.today.revenueMinor / d.today.orders), cur) : '—'} />
      </section>

      <section className="grid cols-3-1">
        <div className="card">
          <div className="card-head">
            <h2>Sales, last 7 days</h2>
            <span className="muted num">{d ? money(d.last7Days.reduce((s, x) => s + x.revenueMinor, 0), cur) : ''}</span>
          </div>
          {d && <Spark days={d.last7Days} currency={cur} />}
        </div>
        <div className="card grid" style={{ gap: 18 }}>
          <h2>Plan usage</h2>
          {d && (
            <>
              <UsageMeter label="Online orders today" meter={d.usage.orders_today} kind="orders" />
              <UsageMeter label="Inventory items" meter={d.usage.inventory_items} kind="items" />
              <UsageMeter label="Branches" meter={d.usage.branches} kind="branches" />
            </>
          )}
        </div>
      </section>

      <section className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h2>Top items today</h2>
          </div>
          {d && d.topItems.length === 0 && <Empty title="No orders yet today" />}
          {d && d.topItems.length > 0 && (
            <table>
              <tbody>
                {d.topItems.map((t) => (
                  <tr key={t.name}>
                    <td>{t.name}</td>
                    <td className="num muted">{t.quantity} sold</td>
                    <td className="num" style={{ textAlign: 'right' }}>{money(t.revenueMinor, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Low stock</h2>
            <Link to="/inventory?low=1">View inventory</Link>
          </div>
          {d && d.lowStock.length === 0 && <Empty title="Nothing running low" />}
          {d && d.lowStock.length > 0 && (
            <table>
              <tbody>
                {d.lowStock.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.name}
                      {branches.length > 1 && !branchId && <div className="muted" style={{ fontSize: 13 }}>{i.branchName}</div>}
                    </td>
                    <td className="num" style={{ textAlign: 'right' }}>
                      <span className="pill bad">{qty(i.qty)} {i.unit} left</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
    </div>
  );
}

function Spark({ days, currency }: { days: Dashboard['last7Days']; currency: string }) {
  const max = Math.max(1, ...days.map((d) => d.revenueMinor));
  const w = 700;
  const h = 120;
  const pts = days.map((d, i) => [(i / (days.length - 1)) * w, h - 8 - (d.revenueMinor / max) * (h - 24)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const label = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-NG', { weekday: 'short' });
  return (
    <>
      <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Daily sales: ${days.map((d) => `${label(d.day)} ${money(d.revenueMinor, currency)}`).join(', ')}`}>
        <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="var(--accent-soft)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="spark-legend">
        {days.map((d) => (
          <span key={d.day} title={money(d.revenueMinor, currency)}>{label(d.day)}</span>
        ))}
      </div>
    </>
  );
}
