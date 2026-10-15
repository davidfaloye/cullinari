import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  allowedNextStatuses,
  ORDER_STATUS_LABELS,
  STATUS_ROLES,
  type OrderStatus,
  type OrderView,
} from '@cullinari/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { clock, money, timeAgo } from '../lib/format';
import { Empty, ErrorNotice, Field, Modal, useToast } from '../components/ui';

const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  accepted: 'Accept',
  preparing: 'Start cooking',
  ready: 'Mark ready',
  out_for_delivery: 'Out for delivery',
  completed: 'Complete',
};

const LANES: { title: string; statuses: OrderStatus[] }[] = [
  { title: 'New', statuses: ['placed'] },
  { title: 'Accepted', statuses: ['accepted'] },
  { title: 'Cooking', statuses: ['preparing'] },
  { title: 'Ready / on the way', statuses: ['ready', 'out_for_delivery'] },
];
const KITCHEN_LANES = LANES.slice(1, 3).map((l) => (l.title === 'Accepted' ? { ...l, title: 'To cook' } : l));

export function Orders() {
  const { me } = useAuth();
  const [tab, setTab] = useState<'live' | 'history'>('live');
  const [kitchen, setKitchen] = useState(me?.role === 'kitchen');

  return (
    <main className={`content ${kitchen && tab === 'live' ? 'kitchen' : ''}`} style={kitchen ? { maxWidth: 'none' } : undefined}>
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p className="muted">New orders from your app appear here as they arrive.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {tab === 'live' && me?.role !== 'kitchen' && (
            <label className="check">
              <input type="checkbox" checked={kitchen} onChange={(e) => setKitchen(e.target.checked)} />
              Kitchen view
            </label>
          )}
          {me?.role !== 'kitchen' && (
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'live'} className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>Live</button>
              <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>
            </div>
          )}
        </div>
      </div>
      {tab === 'live' ? <LiveBoard kitchen={kitchen} /> : <History />}
    </main>
  );
}

function LiveBoard({ kitchen }: { kitchen: boolean }) {
  const { branchId } = useAuth();
  const q = useQuery({
    queryKey: ['orders', 'active', branchId ?? 'all'],
    queryFn: () => api<OrderView[]>('/orders', { query: { view: 'active', branchId } }),
    // The socket keeps this current; the poll is a safety net.
    refetchInterval: 60_000,
  });
  const [open, setOpen] = useState<OrderView | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string> | null>(null);

  // Highlight tickets that arrived after the board loaded.
  useEffect(() => {
    if (!q.data) return;
    if (!seen) return setSeen(new Set(q.data.map((o) => o.id)));
    const added = q.data.filter((o) => !seen.has(o.id)).map((o) => o.id);
    if (added.length) {
      setSeen(new Set([...seen, ...added]));
      setFresh(new Set(added));
      const t = setTimeout(() => setFresh(new Set()), 4000);
      return () => clearTimeout(t);
    }
  }, [q.data, seen]);

  if (q.isLoading) return <p className="muted">Loading orders…</p>;
  if (q.isError) return <ErrorNotice error={q.error} />;
  const orders = q.data ?? [];
  const lanes = kitchen ? KITCHEN_LANES : LANES;

  return (
    <>
      <div className="board">
        {lanes.map((lane) => {
          const list = orders.filter((o) => lane.statuses.includes(o.status));
          return (
            <section key={lane.title} className="lane" aria-label={lane.title}>
              <div className="lane-head">
                {lane.title}
                <span>{list.length}</span>
              </div>
              {list.map((o) => (
                <Ticket key={o.id} order={o} fresh={fresh.has(o.id)} onOpen={() => setOpen(o)} kitchen={kitchen} />
              ))}
            </section>
          );
        })}
      </div>
      {orders.length === 0 && <Empty title="No open orders">New orders will show up here with a sound.</Empty>}
      {open && <OrderDetail id={open.id} initial={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function useTransition() {
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: OrderStatus; reason?: string }) =>
      api<OrderView>(`/orders/${id}/status`, { method: 'PATCH', body: { status, reason } }),
    onError: (err: Error) => toast(err.message, 'bad'),
  });
}

function Ticket({ order, fresh, onOpen, kitchen }: { order: OrderView; fresh: boolean; onOpen: () => void; kitchen: boolean }) {
  const { me, branches } = useAuth();
  const move = useTransition();
  const next = allowedNextStatuses(order.status, order.fulfilment).filter(
    (s) => s !== 'cancelled' && me && STATUS_ROLES[s].includes(me.role),
  );
  const awaitingPayment = order.paymentMethod === 'paystack' && order.paymentStatus !== 'paid';

  return (
    <article className={`ticket ${fresh ? 'fresh' : ''}`}>
      <div className="ticket-head">
        <b>#{order.number}</b>
        <small>{clock(order.placedAt)} · {timeAgo(order.placedAt)}</small>
      </div>
      <div className="ticket-meta">
        <span className={`pill ${order.fulfilment === 'delivery' ? 'sun' : 'green'}`}>{order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</span>
        {awaitingPayment && <span className="pill warn">Awaiting payment</span>}
        {order.paymentMethod === 'pay_on_delivery' && !kitchen && <span className="pill">Pay on delivery</span>}
        {branches.length > 1 && !me?.branchId && <span className="pill">{order.branchName}</span>}
      </div>
      <ul>
        {order.items.map((i) => (
          <li key={i.id}>
            {i.quantity}× {i.name}
            {i.note && <em>{i.note}</em>}
          </li>
        ))}
      </ul>
      {order.note && <p className="muted" style={{ fontSize: 13 }}>Note: {order.note}</p>}
      {!kitchen && (
        <div className="ticket-meta" style={{ justifyContent: 'space-between' }}>
          <span>{order.customer?.name ?? 'Customer'}</span>
          <b className="num">{money(order.totalMinor)}</b>
        </div>
      )}
      <div className="ticket-actions">
        {next.map((s) => (
          <button
            key={s}
            className="btn sm"
            disabled={move.isPending || (s === 'accepted' && awaitingPayment)}
            onClick={() => move.mutate({ id: order.id, status: s })}
          >
            {ACTION_LABELS[s]}
          </button>
        ))}
        {!kitchen && <button className="btn sm ghost" onClick={onOpen}>Details</button>}
      </div>
    </article>
  );
}

function OrderDetail({ id, initial, onClose }: { id: string; initial?: OrderView; onClose: () => void }) {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<OrderView>(`/orders/${id}`), initialData: initial });
  const move = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const o = q.data;
  if (!o) return null;
  const canCancel = allowedNextStatuses(o.status, o.fulfilment).includes('cancelled') && !!me && STATUS_ROLES.cancelled.includes(me.role);

  return (
    <Modal
      title={`Order #${o.number}`}
      onClose={onClose}
      footer={
        canCancel &&
        (cancelling ? (
          <>
            <button className="btn ghost" onClick={() => setCancelling(false)}>Keep order</button>
            <button
              className="btn danger"
              disabled={!reason.trim() || move.isPending}
              onClick={() => move.mutate({ id: o.id, status: 'cancelled', reason }, { onSuccess: onClose })}
            >
              Cancel order
            </button>
          </>
        ) : (
          <button className="btn danger" onClick={() => setCancelling(true)}>Cancel order…</button>
        ))
      }
    >
      <div className="ticket-meta">
        <span className="pill green">{ORDER_STATUS_LABELS[o.status]}</span>
        <span className="pill">{o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</span>
        <span className={`pill ${o.paymentStatus === 'paid' ? 'green' : o.paymentStatus === 'failed' ? 'bad' : ''}`}>
          {o.paymentMethod === 'paystack' ? 'Card' : 'Pay on delivery'} · {o.paymentStatus.replace('_', ' ')}
        </span>
        <span className="muted">{o.branchName} · {new Date(o.placedAt).toLocaleString('en-NG')}</span>
      </div>
      <table>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.id}>
              <td>{i.quantity}× {i.name}{i.note && <div className="muted" style={{ fontSize: 13 }}>{i.note}</div>}</td>
              <td className="num" style={{ textAlign: 'right' }}>{money(i.unitPriceMinor * i.quantity)}</td>
            </tr>
          ))}
          <tr><td className="muted">Subtotal</td><td className="num" style={{ textAlign: 'right' }}>{money(o.subtotalMinor)}</td></tr>
          {o.deliveryFeeMinor > 0 && <tr><td className="muted">Delivery</td><td className="num" style={{ textAlign: 'right' }}>{money(o.deliveryFeeMinor)}</td></tr>}
          {o.taxMinor > 0 && <tr><td className="muted">Tax</td><td className="num" style={{ textAlign: 'right' }}>{money(o.taxMinor)}</td></tr>}
          <tr><td><b>Total</b></td><td className="num" style={{ textAlign: 'right' }}><b>{money(o.totalMinor)}</b></td></tr>
        </tbody>
      </table>
      <div className="notice plain">
        <b>{o.customer?.name ?? 'Customer'}</b>
        {o.customer && <a href={`tel:${o.customer.phone}`}>{o.customer.phone}</a>}
        {o.deliveryAddress && <span>{o.deliveryAddress}</span>}
        {o.note && <span>Note: {o.note}</span>}
      </div>
      {o.cancelReason && <p className="error">Cancelled: {o.cancelReason}</p>}
      {o.status === 'cancelled' && o.paymentStatus === 'paid' && (
        <p className="muted">This card payment needs a refund from your Paystack dashboard.</p>
      )}
      {cancelling && (
        <Field label="Why is it cancelled?" hint="The customer is notified that the order was cancelled.">
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Out of jollof rice" />
        </Field>
      )}
    </Modal>
  );
}

function History() {
  const { branchId } = useAuth();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const size = 50;
  const q = useQuery({
    queryKey: ['orders', 'history', branchId ?? 'all', page],
    queryFn: () => api<OrderView[]>('/orders', { query: { view: 'history', branchId, limit: size, offset: page * size } }),
  });
  if (q.isError) return <ErrorNotice error={q.error} />;
  const rows = q.data ?? [];
  return (
    <div className="card">
      {q.isLoading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 && page === 0 ? (
        <Empty title="No completed orders yet" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Order</th><th>Placed</th><th>Customer</th><th>Branch</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th></tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} onClick={() => setOpen(o.id)} style={{ cursor: 'pointer' }}>
                  <td className="mono">#{o.number}</td>
                  <td>{new Date(o.placedAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{o.customer?.name ?? '—'}</td>
                  <td>{o.branchName}</td>
                  <td><span className={`pill ${o.status === 'cancelled' ? 'bad' : 'green'}`}>{ORDER_STATUS_LABELS[o.status]}</span></td>
                  <td className="num" style={{ textAlign: 'right' }}>{money(o.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn sm ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</button>
        <button className="btn sm ghost" disabled={rows.length < size} onClick={() => setPage(page + 1)}>Older</button>
      </div>
      {open && <OrderDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
