import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, toMajor, toMinor } from '../lib/format';
import { Empty, ErrorNotice, Field, Modal, useToast } from '../components/ui';

interface Category { id: string; name: string; sortOrder: number; branchId: string | null }
interface Item {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  categoryId: string | null;
  branchId: string | null;
  imageUrl: string | null;
  isAvailable: boolean;
}

export function Menu() {
  const { branchId, can, branches, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['menu', branchId ?? 'all'], queryFn: () => api<{ categories: Category[]; items: Item[] }>('/menu', { query: { branchId } }) });
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [catModal, setCatModal] = useState(false);
  const canEdit = can('owner', 'manager');

  const toggle = useMutation({
    mutationFn: (i: Item) => api(`/menu/items/${i.id}/availability`, { method: 'PATCH', body: { isAvailable: !i.isAvailable } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
    onError: (e: Error) => toast(e.message, 'bad'),
  });

  const data = q.data;
  const groups = data
    ? [...data.categories.map((c) => ({ id: c.id, name: c.name })), { id: null as string | null, name: 'Uncategorised' }]
        .map((c) => ({ ...c, items: data.items.filter((i) => i.categoryId === c.id) }))
        .filter((g) => g.items.length || g.id)
    : [];
  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name : null);

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <h1>Menu</h1>
          <p className="muted">Changes show in your ordering app straight away. Turn items off when you run out.</p>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={() => setCatModal(true)}>Add category</button>
            <button className="btn" onClick={() => setEditing('new')}>Add item</button>
          </div>
        )}
      </div>
      {q.isError && <ErrorNotice error={q.error} />}
      {data && data.items.length === 0 && (
        <div className="card">
          <Empty title="Your menu is empty">
            {canEdit && <button className="btn" onClick={() => setEditing('new')}>Add your first dish</button>}
          </Empty>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.id ?? 'none'} className="card">
          <div className="card-head">
            <h2>{g.name}</h2>
            <span className="muted">{g.items.length} item{g.items.length === 1 ? '' : 's'}</span>
          </div>
          {g.items.length === 0 ? (
            <p className="muted">No items in this category.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {g.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <b>{i.name}</b>
                        {i.description && <div className="muted" style={{ fontSize: 13 }}>{i.description}</div>}
                      </td>
                      <td>{branchName(i.branchId) ? <span className="pill">{branchName(i.branchId)} only</span> : branches.length > 1 ? <span className="pill">All branches</span> : null}</td>
                      <td className="num">{money(i.priceMinor, me?.tenant.currency)}</td>
                      <td>
                        <label className="check">
                          <input type="checkbox" checked={i.isAvailable} disabled={toggle.isPending} onChange={() => toggle.mutate(i)} />
                          {i.isAvailable ? 'Available' : 'Sold out'}
                        </label>
                      </td>
                      <td className="actions">{canEdit && <button className="btn sm ghost" onClick={() => setEditing(i)}>Edit</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
      {editing && <ItemModal item={editing === 'new' ? null : editing} categories={data?.categories ?? []} onClose={() => setEditing(null)} />}
      {catModal && <CategoryModal onClose={() => setCatModal(false)} />}
    </main>
  );
}

function ItemModal({ item, categories, onClose }: { item: Item | null; categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me, branches } = useAuth();
  const [form, setForm] = useState({
    name: item?.name ?? '',
    description: item?.description ?? '',
    price: item ? toMajor(item.priceMinor) : '',
    categoryId: item?.categoryId ?? categories[0]?.id ?? '',
    branchId: item?.branchId ?? '',
    imageUrl: item?.imageUrl ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        description: form.description || null,
        priceMinor: toMinor(form.price),
        categoryId: form.categoryId || null,
        imageUrl: form.imageUrl || null,
        ...(item ? {} : { branchId: form.branchId || null }),
      };
      return item ? api(`/menu/items/${item.id}`, { method: 'PATCH', body }) : api('/menu/items', { method: 'POST', body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      toast(item ? 'Item saved' : 'Item added');
      onClose();
    },
  });
  const archive = useMutation({
    mutationFn: () => api(`/menu/items/${item!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      toast('Item removed from the menu');
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal
      title={item ? 'Edit item' : 'Add item'}
      onClose={onClose}
      footer={
        <>
          {item && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => archive.mutate()}>Remove</button>}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" form="item-form" disabled={save.isPending}>Save</button>
        </>
      }
    >
      <form id="item-form" className="form" onSubmit={submit}>
        <Field label="Name"><input required value={form.name} onChange={set('name')} /></Field>
        <Field label="Description"><input value={form.description} onChange={set('description')} placeholder="Shown under the name in the app" /></Field>
        <div className="row">
          <Field label={`Price (${me?.tenant.currency === 'NGN' ? '₦' : me?.tenant.currency})`}>
            <input required type="number" min="0" step="1" inputMode="decimal" value={form.price} onChange={set('price')} />
          </Field>
          <Field label="Category">
            <select value={form.categoryId} onChange={set('categoryId')}>
              <option value="">None</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        {!item && !me?.branchId && branches.length > 1 && (
          <Field label="Available at" hint="Branch-only items appear in the app only when a customer picks that branch.">
            <select value={form.branchId} onChange={set('branchId')}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} only</option>)}
            </select>
          </Field>
        )}
        <Field label="Photo URL" hint="Photo uploads are coming; for now paste a link to the image.">
          <input type="url" value={form.imageUrl} onChange={set('imageUrl')} placeholder="https://" />
        </Field>
        <ErrorNotice error={save.error ?? archive.error} />
      </form>
    </Modal>
  );
}

function CategoryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () => api('/menu/categories', { method: 'POST', body: { name } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      onClose();
    },
  });
  return (
    <Modal
      title="Add category"
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" form="cat-form" disabled={save.isPending}>Add</button></>}
    >
      <form id="cat-form" className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Name"><input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Soups" /></Field>
        <ErrorNotice error={save.error} />
      </form>
    </Modal>
  );
}
