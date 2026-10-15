import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLES, type Role } from '@cullinari/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorNotice, Field, Modal, useToast } from '../components/ui';

interface Member { id: string; userId: string; name: string; email: string; role: Role; branchId: string | null; branchName: string | null }

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including billing, team and settings',
  manager: 'Menu, inventory and orders',
  cashier: 'Takes and completes orders, marks items sold out',
  kitchen: 'Sees the order queue only',
};

export function Team() {
  const { me, branches } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['team'], queryFn: () => api<Member[]>('/team') });
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  const remove = useMutation({
    mutationFn: (m: Member) => api(`/team/${m.id}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['team'] }); toast('Removed from the team'); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p className="muted">Who can sign in to {me?.tenant.name}, and what they can do.</p>
        </div>
        <button className="btn" onClick={() => setInviting(true)}>Add staff</button>
      </div>
      <div className="card table-wrap">
        {q.isError && <ErrorNotice error={q.error} />}
        <table>
          <thead><tr><th>Name</th><th>Role</th>{branches.length > 1 && <th>Branch</th>}<th /></tr></thead>
          <tbody>
            {q.data?.map((m) => (
              <tr key={m.id}>
                <td><b>{m.name}</b><div className="muted" style={{ fontSize: 13 }}>{m.email}</div></td>
                <td style={{ textTransform: 'capitalize' }}>{m.role}</td>
                {branches.length > 1 && <td>{m.branchName ?? <span className="muted">All branches</span>}</td>}
                <td className="actions">
                  {m.userId !== me?.user.id && (
                    <>
                      <button className="btn sm ghost" onClick={() => setEditing(m)}>Edit</button>
                      <button className="btn sm danger" onClick={() => confirm(`Remove ${m.name} from ${me?.tenant.name}?`) && remove.mutate(m)}>Remove</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(inviting || editing) && <MemberModal member={editing} onClose={() => { setInviting(false); setEditing(null); }} />}
    </main>
  );
}

function MemberModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const { branches } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>(member?.role ?? 'cashier');
  const [branchId, setBranchId] = useState(member?.branchId ?? '');
  const save = useMutation({
    mutationFn: () =>
      member
        ? api(`/team/${member.id}`, { method: 'PATCH', body: { role, branchId: branchId || null } })
        : api<{ temporaryPassword: string | null; email: string }>('/team', { method: 'POST', body: { email, name, role, branchId: branchId || null } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['team'] }),
  });
  const created = !member && save.data ? (save.data as { temporaryPassword: string | null; email: string }) : null;

  if (created) {
    return (
      <Modal title="Staff added" onClose={onClose} footer={<button className="btn" onClick={onClose}>Done</button>}>
        {created.temporaryPassword ? (
          <>
            <p>Share these sign-in details with them. They'll choose their own password the first time they sign in.</p>
            <div className="grid" style={{ gap: 6 }}>
              <span className="muted">Email</span><div className="secret">{created.email}</div>
              <span className="muted">Temporary password</span><div className="secret">{created.temporaryPassword}</div>
            </div>
            <p className="muted">This password is shown once.</p>
          </>
        ) : (
          <p>{created.email} already has a Cullinari login, so they can sign in with their existing password.</p>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={member ? `Edit ${member.name}` : 'Add staff'}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" form="member-form" disabled={save.isPending}>{member ? 'Save' : 'Add'}</button></>}
    >
      <form id="member-form" className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {!member && (
          <>
            <Field label="Name"><input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Email"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          </>
        )}
        <Field label="Role" hint={ROLE_HELP[role]}>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r[0].toUpperCase() + r.slice(1)}</option>)}
          </select>
        </Field>
        {role !== 'owner' && branches.length > 1 && (
          <Field label="Branch" hint="Staff tied to a branch only see that branch.">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}
        <ErrorNotice error={save.error} />
      </form>
    </Modal>
  );
}
