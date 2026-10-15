import { Link, NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Role, UsageSummary } from '@cullinari/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { chime, useLiveEvents } from '../lib/live';
import { Cloche, Icon, useToast } from './ui';

const NAV: { to: string; label: string; icon: string; roles: Role[] }[] = [
  { to: '/', label: 'Home', icon: 'home', roles: ['owner', 'manager'] },
  { to: '/orders', label: 'Orders', icon: 'orders', roles: ['owner', 'manager', 'cashier', 'kitchen'] },
  { to: '/menu', label: 'Menu', icon: 'menu', roles: ['owner', 'manager', 'cashier'] },
  { to: '/inventory', label: 'Inventory', icon: 'inventory', roles: ['owner', 'manager'] },
  { to: '/branches', label: 'Branches', icon: 'branches', roles: ['owner'] },
  { to: '/team', label: 'Team', icon: 'team', roles: ['owner'] },
  { to: '/billing', label: 'Billing', icon: 'billing', roles: ['owner'] },
  { to: '/settings', label: 'Settings', icon: 'settings', roles: ['owner'] },
];

export function Layout() {
  const { me, branches, branchId, setBranchId, logout, switchTenant } = useAuth();
  const toast = useToast();
  const connected = useLiveEvents(!!me, (o) => {
    chime();
    toast(`New order #${o.number} · ${o.branchName}`);
  });
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api<UsageSummary>('/usage'), enabled: !!me, refetchInterval: 120_000 });

  if (!me) return null;
  const activeBranches = branches.filter((b) => b.isActive);
  const status = me.tenant.status;
  const ordersMeter = usage.data?.orders_today;

  return (
    <div className="shell">
      <aside className="side">
        <Link className="brand" to="/">
          <Cloche />
          <span>Cullinari</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.filter((n) => n.roles.includes(me.role)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <span className="who">
            {me.user.name}
            <br />
            <span style={{ opacity: 0.7, textTransform: 'capitalize' }}>{me.role}</span>
          </span>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>

      <div className="main">
        {status === 'restricted' && (
          <div className="banner bad">
            <strong>Your subscription payment is overdue.</strong> The dashboard is read-only and your app is paused until it's paid.
          </div>
        )}
        {status === 'past_due' && (
          <div className="banner warn">
            <strong>Your last payment didn't go through.</strong> Everything keeps working for 7 days while you update your card.
          </div>
        )}
        {ordersMeter && ordersMeter.state !== 'ok' && (
          <div className={`banner ${ordersMeter.state === 'reached' ? 'bad' : 'warn'}`}>
            <strong>
              {ordersMeter.state === 'reached'
                ? `Today's limit of ${ordersMeter.limit} online orders is reached.`
                : `${ordersMeter.used} of ${ordersMeter.limit} online orders used today.`}
            </strong>
            {ordersMeter.state === 'reached' ? 'Your app shows customers that ordering is paused until midnight.' : ''}
            {me.role === 'owner' && <Link to="/billing">Upgrade for more orders</Link>}
          </div>
        )}

        <header className="topbar">
          <span className="tenant">{me.tenant.name}</span>
          {me.tenants.length > 1 && (
            <select className="compact" value={me.tenant.id} onChange={(e) => void switchTenant(e.target.value)} aria-label="Switch restaurant">
              {me.tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {/* Hidden on one-branch accounts (Starter) and for staff tied to one branch. */}
          {!me.branchId && activeBranches.length > 1 && (
            <select className="compact" value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value || null)} aria-label="Branch">
              <option value="">All branches</option>
              {activeBranches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          {me.branchId && <span className="pill">{branches.find((b) => b.id === me.branchId)?.name}</span>}
          <span className="spacer" />
          <span className={`live ${connected ? 'on' : ''}`}>{connected ? 'Live' : 'Connecting…'}</span>
          <button className="link signout" onClick={logout}>Sign out</button>
        </header>

        <Outlet />
      </div>
    </div>
  );
}
