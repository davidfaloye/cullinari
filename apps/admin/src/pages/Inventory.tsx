import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { UsageSummary } from '@cullinari/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { qty } from '../lib/format';
import { Empty, ErrorNotice, Field, Modal, UsageMeter, useToast } from '../components/ui';

interface InvItem {
  id: string;
  branchId: string;
  branchName: string;
  name: string;
  unit: string;
  qty: number;
  reorderLevel: number;
  archivedAt: string | null;
  archivedReason: string | null;
  isLow: boolean;
}

type MoveType = 'stock_in' | 'waste' | 'count';
const MOVE_LABEL: Record<MoveType, string> = { stock_in: 'Stock in', waste: 'Record waste', count: 'Stock count' };

export function Inventory() {
  const { branchId, branches, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const lowOnly = params.get('low') === '1';
  const archived = params.get('archived') === '1';
  const qc = useQueryClient();
  const toast = useToast();

  const items = useQuery({
    queryKey: ['inventory', branchId ?? 'all', lowOnly, archived],
    queryFn: () => api<InvItem[]>('/inventory', { query: { branchId, lowOnly: lowOnly ? 'true' : undefined, archived: archived ? 'true' : undefined } }),
  });
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api<UsageSummary>('/usage') });
  const atCap = usage.data?.inventory_items.state === 'reached';

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<InvItem | null>(null);
  const [moving, setMoving] = useState<{ item: InvItem; type: MoveType } | null>(null);
  const [log, setLog] = useState<InvItem | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['inventory'] });
    void qc.invalidateQueries({ queryKey: ['usage'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const archive = useMutation({
    mutationFn: (i: InvItem) => api(`/inventory/${i.id}/${i.archivedAt ? 'unarchive' : 'archive'}`, { method: 'POST' }),
    onSuccess: (_, i) => { refresh(); toast(i.archivedAt ? 'Item restored' : 'Item archived'); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  const setFilter = (key: 'low' | 'archived', on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set(key, '1'); else next.delete(key);
    setParams(next, { replace: true });
  };
  const showBranch = branches.length > 1 && !branchId;

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p className="muted">Stock per branch. Items at or below their reorder level are flagged.</p>
        </div>
        <button className="btn" disabled={atCap || archived} onClick={() => setAdding(true)} title={atCap ? 'Plan limit reached' : undefined}>
          Add item
        </button>
      </div>

      <div className="grid cols-2">
        {usage.data && (
          <div className="card">
            <UsageMeter label="Inventory items on your plan" meter={usage.data.inventory_items} kind="items" />
          </div>
        )}
        <div className="card" style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="check"><input type="checkbox" checked={lowOnly} onChange={(e) => setFilter('low', e.target.checked)} /> Low stock only</label>
          <label className="check"><input type="checkbox" checked={archived} onChange={(e) => setFilter('archived', e.target.checked)} /> Show archived</label>
        </div>
      </div>

      <div className="card">
        {items.isError && <ErrorNotice error={items.error} />}
        {items.data && items.data.length === 0 && (
          <Empty title={lowOnly ? 'Nothing is running low' : archived ? 'No archived items' : 'No inventory items yet'}>
            {!lowOnly && !archived && <button className="btn" onClick={() => setAdding(true)}>Add your first item</button>}
          </Empty>
        )}
        {items.data && items.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  {showBranch && <th>Branch</th>}
                  <th style={{ textAlign: 'right' }}>In stock</th>
                  <th style={{ textAlign: 'right' }}>Reorder at</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.data.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <b>{i.name}</b>
                      {i.archivedReason === 'plan' && <div className="muted" style={{ fontSize: 13 }}>Archived when your plan changed</div>}
                    </td>
                    {showBranch && <td>{i.branchName}</td>}
                    <td className="num" style={{ textAlign: 'right' }}>
                      {i.isLow && !i.archivedAt ? <span className="pill bad">{qty(i.qty)} {i.unit}</span> : `${qty(i.qty)} ${i.unit}`}
                    </td>
                    <td className="num muted" style={{ textAlign: 'right' }}>{qty(i.reorderLevel)} {i.unit}</td>
                    <td className="actions">
                      {i.archivedAt ? (
                        <button className="btn sm ghost" disabled={atCap} onClick={() => archive.mutate(i)}>Restore</button>
                      ) : (
                        <>
                          <button className="btn sm" onClick={() => setMoving({ item: i, type: 'stock_in' })}>Stock in</button>
                          <button className="btn sm ghost" onClick={() => setMoving({ item: i, type: 'waste' })}>Waste</button>
                          <button className="btn sm ghost" onClick={() => setMoving({ item: i, type: 'count' })}>Count</button>
                          <button className="btn sm ghost" onClick={() => setLog(i)}>History</button>
                          <button className="btn sm ghost" onClick={() => setEditing(i)}>Edit</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(adding || editing) && <ItemModal item={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={refresh} onArchive={editing ? () => { archive.mutate(editing); setEditing(null); } : undefined} defaultBranch={me?.branchId ?? branchId} />}
      {moving && <MoveModal {...moving} onClose={() => setMoving(null)} onSaved={refresh} />}
      {log && <LogModal item={log} onClose={() => setLog(null)} />}
    </main>
  );
}

function ItemModal({ item, onClose, onSaved, onArchive, defaultBranch }: { item: InvItem | null; onClose: () => void; onSaved: () => void; onArchive?: () => void; defaultBranch: string | null }) {
  const { branches, me } = useAuth();
  const active = branches.filter((b) => b.isActive);
  const [form, setForm] = useState({
    name: item?.name ?? '',
    unit: item?.unit ?? 'kg',
    qty: '',
    reorderLevel: item ? String(item.reorderLevel) : '',
    branchId: defaultBranch ?? active[0]?.id ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      item
        ? api(`/inventory/${item.id}`, { method: 'PATCH', body: { name: form.name, unit: form.unit, reorderLevel: Number(form.reorderLevel || 0) } })
        : api('/inventory', { method: 'POST', body: { name: form.name, unit: form.unit, qty: Number(form.qty || 0), reorderLevel: Number(form.reorderLevel || 0), branchId: form.branchId || undefined } }),
    onSuccess: () => { onSaved(); onClose(); },
  });
  return (
    <Modal
      title={item ? 'Edit item' : 'Add inventory item'}
      onClose={onClose}
      footer={<>
        {onArchive && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={onArchive}>Archive</button>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" form="inv-form" disabled={save.isPending}>Save</button>
      </>}
    >
      <form id="inv-form" className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Name"><input required value={form.name} onChange={set('name')} placeholder="e.g. Rice, 50 kg bags" /></Field>
        <div className="row">
          <Field label="Unit"><input required value={form.unit} onChange={set('unit')} placeholder="kg, bag, litre" /></Field>
          {!item && <Field label="Opening stock"><input type="number" min="0" step="any" value={form.qty} onChange={set('qty')} /></Field>}
          <Field label="Reorder at" hint="Flag as low at this level"><input type="number" min="0" step="any" value={form.reorderLevel} onChange={set('reorderLevel')} /></Field>
        </div>
        {!item && !me?.branchId && active.length > 1 && (
          <Field label="Branch">
            <select value={form.branchId} onChange={set('branchId')}>
              {active.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}
        <ErrorNotice error={save.error} />
      </form>
    </Modal>
  );
}

function MoveModal({ item, type, onClose, onSaved }: { item: InvItem; type: MoveType; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(type === 'count' ? String(item.qty) : '');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/inventory/${item.id}/movements`, { method: 'POST', body: { type, qty: Number(amount), note: note || undefined } }),
    onSuccess: () => { onSaved(); onClose(); },
  });
  return (
    <Modal
      title={`${MOVE_LABEL[type]}: ${item.name}`}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" form="move-form" disabled={save.isPending || amount === ''}>Save</button></>}
    >
      <p className="muted">Now in stock: {qty(item.qty)} {item.unit}</p>
      <form id="move-form" className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label={type === 'count' ? `Counted on the shelf (${item.unit})` : type === 'waste' ? `Amount wasted (${item.unit})` : `Amount received (${item.unit})`}>
          <input autoFocus required type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'stock_in' ? 'Supplier, invoice number' : 'Optional'} /></Field>
        <ErrorNotice error={save.error} />
      </form>
    </Modal>
  );
}

function LogModal({ item, onClose }: { item: InvItem; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['movements', item.id],
    queryFn: () => api<{ id: string; change: number; reason: string; note: string | null; createdAt: string; userName: string | null }[]>(`/inventory/${item.id}/movements`),
  });
  return (
    <Modal title={`History: ${item.name}`} onClose={onClose}>
      {q.data?.length === 0 && <p className="muted">No stock changes yet.</p>}
      {q.data && q.data.length > 0 && (
        <table>
          <tbody>
            {q.data.map((m) => (
              <tr key={m.id}>
                <td>
                  <span style={{ textTransform: 'capitalize' }}>{m.reason}</span>
                  <div className="muted" style={{ fontSize: 13 }}>{new Date(m.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}{m.userName ? ` · ${m.userName}` : ''}{m.note ? ` · ${m.note}` : ''}</div>
                </td>
                <td className="num" style={{ textAlign: 'right', color: m.change < 0 ? 'var(--bad)' : 'var(--accent)' }}>
                  {m.change > 0 ? '+' : ''}{qty(m.change)} {item.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
