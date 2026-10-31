import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';

/* Editors for the lists engineers pick from when logging an activity:
   categories (with subcategories) and technologies. Items can be renamed in
   place, reordered, switched off and on again, and deleted when unused. */

// Rename in place: saves on Enter or when the field loses focus; Escape cancels.
// Callers key it on the saved name, so a reload with a new name starts it afresh.
function NameField({ value, label, onSave }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  async function commit() {
    const next = draft.trim();
    if (!next) { setDraft(value); return toast.error('A name cannot be empty'); }
    if (next === value) return;
    setSaving(true);
    try { await onSave(next); } catch (failure) { toast.error(failure.message); setDraft(value); } finally { setSaving(false); }
  }
  return <input className="catalog-name" aria-label={label} value={draft} maxLength={100} disabled={saving}
    onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(value); setTimeout(() => event.target.blur(), 0); } }} />;
}

// Move one item up or down, renumbering the list so the order is unambiguous.
async function move(items, index, step, save) {
  const target = index + step;
  if (target < 0 || target >= items.length) return;
  const ordered = [...items];
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  await Promise.all(ordered.map((item, position) => (Number(item.sort_order) !== (position + 1) * 10 ? save(item, (position + 1) * 10) : null)));
}

function OrderButtons({ index, count, name, onMove }) {
  return <span className="catalog-order">
    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={12} /></button>
    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown size={12} /></button>
  </span>;
}

function AddForm({ placeholder, onAdd, children }) {
  const [name, setName] = useState(''), [busy, setBusy] = useState(false);
  const toast = useToast();
  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await onAdd(name.trim()); setName(''); } catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  return <form className="catalog-add" onSubmit={submit}>
    <input value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
    {children}
    <button className="btn btn-primary btn-sm" disabled={busy || !name.trim()}><Plus size={13} /> Add</button>
  </form>;
}

function Subcategories({ category, onChanged }) {
  const toast = useToast(), confirm = useConfirm();
  const items = category.subcategories || [];
  const run = async work => { try { await work(); await onChanged(); } catch (failure) { toast.error(failure.message); } };
  return <div className="catalog-subs">
    {items.length ? <ul>{items.map((sub, index) => <li key={sub.id} className={sub.active ? '' : 'is-off'}>
      <OrderButtons index={index} count={items.length} name={sub.name} onMove={step => run(() => move(items, index, step, (item, order) => api.updateActivitySubcategory(category.id, item.id, { sort_order: order })))} />
      <NameField key={sub.name} value={sub.name} label={`Subcategory name: ${sub.name}`} onSave={async name => { await api.updateActivitySubcategory(category.id, sub.id, { name }); await onChanged(); }} />
      <label className="catalog-switch"><input type="checkbox" checked={!!sub.active} onChange={() => run(() => api.updateActivitySubcategory(category.id, sub.id, { active: !sub.active }))} /> {sub.active ? 'On' : 'Off'}</label>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${sub.name}`} onClick={async () => { if (await confirm(`Delete subcategory "${sub.name}"?`, { title: 'Delete subcategory' })) run(() => api.deleteActivitySubcategory(category.id, sub.id)); }}><Trash2 size={12} /></button>
    </li>)}</ul> : <p className="text-muted text-sm">No subcategories. Add some to let engineers be more specific within {category.name}.</p>}
    <AddForm placeholder={`New subcategory of ${category.name}`} onAdd={async name => { await api.createActivitySubcategory(category.id, { name, sort_order: (items.length + 1) * 10 }); await onChanged(); }} />
  </div>;
}

export function CategoriesEditor({ categories, teams, onChanged }) {
  const toast = useToast(), confirm = useConfirm();
  const [open, setOpen] = useState({});
  const [teamForNew, setTeamForNew] = useState('');
  const run = async work => { try { await work(); await onChanged(); } catch (failure) { toast.error(failure.message); } };
  const update = (category, data) => run(() => api.updateActivityCategory(category.id, data));
  return <section className="card mb-16 catalog-editor" aria-label="Activity categories">
    <div className="section-title">Activity categories</div>
    <p className="text-sm text-muted">What engineers choose from when logging an activity. Rename in place, change the order, or switch one off to hide it from new activities without affecting existing ones.</p>
    <AddForm placeholder="New category" onAdd={async name => { await api.createActivityCategory({ name, team_id: teamForNew || null, sort_order: (categories.length + 1) * 10 }); setTeamForNew(''); await onChanged(); }}>
      <select value={teamForNew} onChange={event => setTeamForNew(event.target.value)} aria-label="Team for the new category">
        <option value="">Shared (every team)</option>
        {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
    </AddForm>
    <div className="table-wrap"><table className="catalog-table">
      <thead><tr><th>Order</th><th>Name</th><th>Team</th><th>Requires attachment</th><th>Requires asset</th><th>Subcategories</th><th>On</th><th /></tr></thead>
      <tbody>{categories.flatMap((category, index) => [
        <tr key={category.id} className={category.active ? '' : 'is-off'}>
          <td><OrderButtons index={index} count={categories.length} name={category.name} onMove={step => run(() => move(categories, index, step, (item, order) => api.updateActivityCategory(item.id, { sort_order: order })))} /></td>
          <td><NameField key={category.name} value={category.name} label={`Category name: ${category.name}`} onSave={async name => { await api.updateActivityCategory(category.id, { name }); await onChanged(); }} /></td>
          <td><select value={category.team_id || ''} aria-label={`Team for ${category.name}`} onChange={event => update(category, { team_id: event.target.value || null })}>
            <option value="">Shared (every team)</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select></td>
          <td><input type="checkbox" aria-label={`${category.name} requires an attachment`} checked={!!category.require_attachment} onChange={() => update(category, { require_attachment: !category.require_attachment })} /></td>
          <td><input type="checkbox" aria-label={`${category.name} requires an asset`} checked={!!category.require_asset} onChange={() => update(category, { require_asset: !category.require_asset })} title="Activities in this category must name the customer asset worked on (when the customer has assets)" /></td>
          <td><button type="button" className="btn btn-ghost btn-sm" aria-expanded={!!open[category.id]} onClick={() => setOpen(current => ({ ...current, [category.id]: !current[category.id] }))}>
            {open[category.id] ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {(category.subcategories || []).length}
          </button></td>
          <td><label className="catalog-switch"><input type="checkbox" checked={!!category.active} aria-label={`${category.name} is on`} onChange={() => update(category, { active: !category.active })} /> {category.active ? 'On' : 'Off'}</label></td>
          <td><button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${category.name}`} onClick={async () => { if (await confirm(`Delete category "${category.name}"?`, { title: 'Delete category' })) run(() => api.deleteActivityCategory(category.id)); }}><Trash2 size={12} /></button></td>
        </tr>,
        ...(open[category.id] ? [<tr key={`${category.id}-subs`} className="catalog-subs-row"><td /><td colSpan={7}><Subcategories category={category} onChanged={onChanged} /></td></tr>] : []),
      ])}
      {!categories.length && <tr><td colSpan={8} className="text-muted">No categories yet.</td></tr>}</tbody>
    </table></div>
  </section>;
}

export function TechnologiesEditor({ technologies, onChanged }) {
  const toast = useToast(), confirm = useConfirm();
  const run = async work => { try { await work(); await onChanged(); } catch (failure) { toast.error(failure.message); } };
  return <section className="card mb-16 catalog-editor" aria-label="Technologies">
    <div className="section-title">Technologies</div>
    <p className="text-sm text-muted">The technologies an activity can be tagged with. Switching one off hides it from new activities and keeps it on existing ones.</p>
    <AddForm placeholder="New technology" onAdd={async name => { await api.createTechnology({ name, sort_order: (technologies.length + 1) * 10 }); await onChanged(); }} />
    <div className="table-wrap"><table className="catalog-table">
      <thead><tr><th>Order</th><th>Name</th><th>On</th><th /></tr></thead>
      <tbody>{technologies.map((technology, index) => <tr key={technology.id} className={technology.active ? '' : 'is-off'}>
        <td><OrderButtons index={index} count={technologies.length} name={technology.name} onMove={step => run(() => move(technologies, index, step, (item, order) => api.updateTechnology(item.id, { sort_order: order })))} /></td>
        <td><NameField key={technology.name} value={technology.name} label={`Technology name: ${technology.name}`} onSave={async name => { await api.updateTechnology(technology.id, { name }); await onChanged(); }} /></td>
        <td><label className="catalog-switch"><input type="checkbox" checked={!!technology.active} aria-label={`${technology.name} is on`} onChange={() => run(() => api.updateTechnology(technology.id, { active: !technology.active }))} /> {technology.active ? 'On' : 'Off'}</label></td>
        <td><button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${technology.name}`} onClick={async () => { if (await confirm(`Delete technology "${technology.name}"?`, { title: 'Delete technology' })) run(() => api.deleteTechnology(technology.id)); }}><Trash2 size={12} /></button></td>
      </tr>)}
      {!technologies.length && <tr><td colSpan={4} className="text-muted">No technologies yet.</td></tr>}</tbody>
    </table></div>
  </section>;
}
