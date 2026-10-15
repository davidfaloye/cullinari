import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UsageSummary } from '@cullinari/shared';
import { api } from '../lib/api';
import { useAuth, type Branch } from '../lib/auth';
import { ErrorNotice, Field, Modal, UsageMeter, useToast } from '../components/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Hours = Record<string, { open: string; close: string } | null>;

export function Branches() {
  const { branches } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api<UsageSummary>('/usage') });
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const atCap = usage.data?.branches.state === 'reached';

  const toggle = useMutation({
    mutationFn: (b: Branch) => api(`/branches/${b.id}`, { method: 'PATCH', body: { isActive: !b.isActive } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['branches'] }); void qc.invalidateQueries({ queryKey: ['usage'] }); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <h1>Branches</h1>
          <p className="muted">Each branch has its own orders, stock and opening hours.</p>
        </div>
        <button className="btn" disabled={atCap} onClick={() => setEditing('new')}>Add branch</button>
      </div>
      {usage.data && (
        <div className="card">
          <UsageMeter label="Active branches on your plan" meter={usage.data.branches} kind="branches" />
          {atCap && <p className="muted" style={{ marginTop: 8 }}>To add another branch, upgrade your plan or deactivate one.</p>}
        </div>
      )}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Branch</th><th>Address</th><th>Hours</th><th>Status</th><th /></tr></thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <td><b>{b.name}</b>{b.phone && <div className="muted" style={{ fontSize: 13 }}>{b.phone}</div>}</td>
                <td>{b.address ?? <span className="muted">—</span>}</td>
                <td>{b.hours && Object.keys(b.hours).length ? summarise(b.hours) : <span className="muted">Always open</span>}</td>
                <td><span className={`pill ${b.isActive ? 'green' : ''}`}>{b.isActive ? 'Active' : 'Inactive'}</span></td>
                <td className="actions">
                  <button className="btn sm ghost" onClick={() => setEditing(b)}>Edit</button>
                  <button className="btn sm ghost" disabled={toggle.isPending || (!b.isActive && atCap)} onClick={() => toggle.mutate(b)}>
                    {b.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <BranchModal branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

function summarise(h: Hours) {
  const open = DAYS.map((d, i) => (h[String(i)] ? `${d} ${h[String(i)]!.open}–${h[String(i)]!.close}` : null)).filter(Boolean);
  return open.length ? <span style={{ fontSize: 13 }}>{open.join(', ')}</span> : <span className="muted">Closed</span>;
}

function BranchModal({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(branch?.name ?? '');
  const [address, setAddress] = useState(branch?.address ?? '');
  const [phone, setPhone] = useState(branch?.phone ?? '');
  const [useHours, setUseHours] = useState(!!branch?.hours && Object.keys(branch.hours).length > 0);
  const [hours, setHours] = useState<Hours>(
    branch?.hours && Object.keys(branch.hours).length ? branch.hours : Object.fromEntries(DAYS.map((_, i) => [String(i), { open: '09:00', close: '21:00' }])),
  );

  const save = useMutation({
    mutationFn: () => {
      const body = { name, address: address || undefined, phone: phone || undefined, hours: useHours ? hours : null };
      return branch ? api(`/branches/${branch.id}`, { method: 'PATCH', body }) : api('/branches', { method: 'POST', body });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['branches'] }); void qc.invalidateQueries({ queryKey: ['usage'] }); onClose(); },
  });

  return (
    <Modal
      title={branch ? 'Edit branch' : 'Add branch'}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" form="branch-form" disabled={save.isPending}>Save</button></>}
    >
      <form id="branch-form" className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Name"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wuse 2" /></Field>
        <Field label="Address"><input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="Phone"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={useHours} onChange={(e) => setUseHours(e.target.checked)} /> Set opening hours (the app won't take orders when closed)</label>
        {useHours && (
          <div className="grid" style={{ gap: 8 }}>
            {DAYS.map((d, i) => {
              const day = hours[String(i)];
              return (
                <div key={d} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 1fr auto', gap: 8, alignItems: 'center' }}>
                  <b>{d}</b>
                  <input type="time" aria-label={`${d} opens`} disabled={!day} value={day?.open ?? ''} onChange={(e) => setHours({ ...hours, [i]: { open: e.target.value, close: day?.close ?? '21:00' } })} />
                  <input type="time" aria-label={`${d} closes`} disabled={!day} value={day?.close ?? ''} onChange={(e) => setHours({ ...hours, [i]: { open: day?.open ?? '09:00', close: e.target.value } })} />
                  <label className="check"><input type="checkbox" checked={!day} onChange={(e) => setHours({ ...hours, [i]: e.target.checked ? null : { open: '09:00', close: '21:00' } })} />Closed</label>
                </div>
              );
            })}
          </div>
        )}
        <ErrorNotice error={save.error} />
      </form>
    </Modal>
  );
}
