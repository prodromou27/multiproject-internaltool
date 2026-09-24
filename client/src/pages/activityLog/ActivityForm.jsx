import { useEffect, useState } from 'react';
import { api } from '../../api';
import { iso, BILLABLE_LABELS, WORK_LOCATION_LABELS } from './helpers';
import { Field, ChipGroup } from './formParts';

/* ── Quick Log / Edit Activity form ──────────────────────────────────── */
export function ActivityForm({ meta, initial, onSave, onClose, onReload }) {
  const [form, setForm] = useState(() => ({
    customer_id: initial?.customer_id || '',
    activity_date: initial?.activity_date?.slice(0, 10) || iso(new Date()),
    category_id: initial?.category_id || '',
    subcategory_id: initial?.subcategory_id || '',
    title: initial?.title || '',
    duration_minutes: initial?.duration_minutes ?? '',
    status: initial?.status || meta.statuses[0]?.value || 'planned',
    description: initial?.description || '',
    technology_ids: initial?.technologies?.map(t => t.id) || [],
    asset_ids: initial?.assets?.map(asset => asset.id) || [],
    asset_versions: Object.fromEntries((initial?.assets || []).filter(asset => asset.version).map(asset => [asset.id, asset.version])),
    start_time: initial?.start_time || '',
    end_time: initial?.end_time || '',
    work_location: initial?.work_location || '',
    ticket_reference: initial?.ticket_reference || '',
    customer_impact: initial?.customer_impact || '',
    billable_classification: initial?.billable_classification || '',
    follow_up_required: !!initial?.follow_up_required,
    follow_up_date: initial?.follow_up_date?.slice(0, 10) || '',
    change_type: initial?.change_type || '',
    change_reason: initial?.change_reason || '',
    previous_state: initial?.previous_state || '',
    new_state: initial?.new_state || '',
    change_risk: initial?.change_risk || '',
    rollback_available: !!initial?.rollback_available,
    customer_approval_reference: initial?.customer_approval_reference || '',
    verification_notes: initial?.verification_notes || '',
  }));
  const [showMore, setShowMore] = useState(false);
  const [showChangeDetails, setShowChangeDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [err, setErr] = useState('');
  const [assets,setAssets] = useState(initial?.assets || []);
  const [assetsLoading,setAssetsLoading] = useState(false);
  const [assetsError,setAssetsError] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (!form.customer_id) { setAssets([]);setAssetsError('');return; }
    const controller=new AbortController();setAssetsLoading(true);setAssetsError('');
    api.serviceActivityAssets(form.customer_id,{ signal:controller.signal }).then(rows => {
      if (controller.signal.aborted) return;
      const merged=new Map([...(initial?.assets || []),...rows].map(row => [row.id,row]));setAssets([...merged.values()]);
    }).catch(error => { if (!controller.signal.aborted) setAssetsError(error.message || 'Could not load customer assets'); })
      .finally(() => { if (!controller.signal.aborted) setAssetsLoading(false); });
    return () => controller.abort();
  },[form.customer_id,initial?.assets]);

  const category = meta.categories.find(c => String(c.id) === String(form.category_id));
  const customer = meta.customers.find(c => String(c.id) === String(form.customer_id));
  const requiredDetails = !!(customer?.require_ticket_reference || customer?.require_technology || customer?.require_billable_classification);
  const subcategories = category?.subcategories || [];
  const isChangeCategory = /change/i.test(category?.name || '');

  function validate() {
    if (!form.customer_id) return 'Customer is required';
    if (!form.activity_date) return 'Activity date is required';
    if (!form.category_id) return 'Category is required';
    if (!form.title.trim()) return 'Title is required';
    if (form.duration_minutes !== '' && Number(form.duration_minutes) <= 0) return 'Duration must be greater than zero';
    if (category?.require_asset && assets.length > 0 && form.asset_ids.length === 0) return 'Select the asset that was worked on';
    if (form.start_time && form.end_time && form.end_time < form.start_time) return 'End time cannot be before start time';
    if (form.follow_up_required && !form.follow_up_date) return 'Follow-up date is required when follow-up is required';
    if (customer?.require_duration && form.duration_minutes === '') return 'Duration is required for this customer';
    if (customer?.require_ticket_reference && !form.ticket_reference.trim()) return 'Ticket reference is required for this customer';
    if (customer?.require_technology && !form.technology_ids.length) return 'At least one technology is required for this customer';
    if (customer?.require_notes && !form.description.trim()) return 'Notes are required for this customer';
    if (customer?.require_billable_classification && !form.billable_classification) return 'Billable classification is required for this customer';
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setErr(validationError); return; }
    setErr(''); setSaving(true);
    try {
      const payload = {
        ...form,
        customer_id: Number(form.customer_id),
        category_id: Number(form.category_id),
        subcategory_id: form.subcategory_id ? Number(form.subcategory_id) : null,
        duration_minutes: form.duration_minutes !== '' ? Number(form.duration_minutes) : null,
        // Version is optional; only for the assets actually selected, blank clears it.
        asset_versions: Object.fromEntries(form.asset_ids.map(id => [id, String(form.asset_versions?.[id] || '').trim()])),
      };
      await onSave(payload);
    } catch (ex) { setConflict(ex.code === 'ACTIVITY_CONFLICT'); setErr(ex.message || 'Failed to save activity'); }
    finally { setSaving(false); }
  }

  const toggleIn = (key, value) => setForm(f => ({
    ...f, [key]: f[key].includes(value) ? f[key].filter(x => x !== value) : [...f[key], value],
  }));
  const today = iso(new Date());
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return iso(d); })();
  const minutes = form.duration_minutes === '' ? null : Number(form.duration_minutes);

  return (
    <form onSubmit={submit} className="af-form" noValidate={false}>
      {err && <div className="error-msg" role="alert">{err}</div>}
      {conflict && <button type="button" className="btn btn-ghost" onClick={onReload}>Reload latest activity</button>}

      <div className="af-grid">
        <Field label="Customer" required className="af-wide">
          <select value={form.customer_id} required
            onChange={e => setForm(f => ({ ...f, customer_id: e.target.value, asset_ids: String(e.target.value) === String(initial?.customer_id || '') ? initial?.assets?.map(asset => asset.id) || [] : [], asset_versions: String(e.target.value) === String(initial?.customer_id || '') ? Object.fromEntries((initial?.assets || []).filter(asset => asset.version).map(asset => [asset.id, asset.version])) : {} }))}>
            <option value="">Select a customer</option>
            {meta.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>

        <Field label="Title" required className="af-wide">
          <input value={form.title} onChange={set('title')} maxLength={300} required placeholder="What did you do?" />
        </Field>

        <Field label="Category" required>
          <select value={form.category_id} required onChange={e => setForm(f => ({ ...f, category_id: e.target.value, subcategory_id: '' }))}>
            <option value="">Select a category</option>
            {meta.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>

        <Field label="Status">
          <select value={form.status} onChange={set('status')}>
            {meta.statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>

        <Field label="Date" required>
          <input type="date" value={form.activity_date} onChange={set('activity_date')} max={today} required />
          <span className="af-quick">
            {[['Today', today], ['Yesterday', yesterday]].map(([label, value]) => (
              <button key={label} type="button" aria-pressed={form.activity_date === value} onClick={() => setForm(f => ({ ...f, activity_date: value }))}>{label}</button>
            ))}
          </span>
        </Field>

        <Field label="Time spent (minutes)" required={!!customer?.require_duration}>
          <input type="number" min="1" max="1440" step="1" required={!!customer?.require_duration}
            value={form.duration_minutes} onChange={set('duration_minutes')} placeholder="For example, 90" />
          <span className="af-quick">
            {[[30, '30m'], [60, '1h'], [90, '1h 30m'], [120, '2h']].map(([value, label]) => (
              <button key={value} type="button" aria-pressed={minutes === value} onClick={() => setForm(f => ({ ...f, duration_minutes: value }))}>{label}</button>
            ))}
          </span>
        </Field>

        <Field label="Notes" required={!!customer?.require_notes} className="af-wide">
          <textarea required={!!customer?.require_notes} maxLength={10000} value={form.description} onChange={set('description')} rows={3}
            placeholder="Actions taken and the outcome" />
        </Field>
      </div>

      <details className="af-more" open={showMore || requiredDetails} onToggle={e => setShowMore(e.target.open)}>
        <summary>More details</summary>

        <fieldset className="af-group">
          <legend>Classification</legend>
          {subcategories.length > 0 && (
            <Field label="Subcategory">
              <select value={form.subcategory_id} onChange={set('subcategory_id')}>
                <option value="">None</option>
                {subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Billing" required={!!customer?.require_billable_classification}>
            <select required={!!customer?.require_billable_classification} value={form.billable_classification} onChange={set('billable_classification')}>
              <option value="">Not specified</option>
              {Object.entries(BILLABLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <ChipGroup legend="Technology" required={!!customer?.require_technology}
            options={meta.technologies.map(t => ({ id: t.id, label: t.name }))}
            selected={form.technology_ids} onToggle={id => toggleIn('technology_ids', id)} />
        </fieldset>

        <fieldset className="af-group">
          <legend>Where and when</legend>
          <div className="af-grid">
            <Field label="Start time"><input type="time" value={form.start_time} onChange={set('start_time')} /></Field>
            <Field label="End time"><input type="time" value={form.end_time} onChange={set('end_time')} /></Field>
            <Field label="Work location">
              <select value={form.work_location} onChange={set('work_location')}>
                <option value="">Not specified</option>
                {Object.entries(WORK_LOCATION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="af-group">
          <legend>References</legend>
          <div className="af-grid">
            <Field label="Ticket reference" required={!!customer?.require_ticket_reference}>
              <input value={form.ticket_reference} onChange={set('ticket_reference')} />
            </Field>
            <Field label="Customer impact"><input value={form.customer_impact} onChange={set('customer_impact')} /></Field>
          </div>
          {form.customer_id && (
            <ChipGroup legend={category?.require_asset ? 'Customer assets (required for this category)' : 'Customer assets'} scroll
              options={assets.map(asset => ({
                id: asset.id,
                label: asset.name,
                detail: asset.hostname || asset.asset_type,
                note: asset.lifecycle_status === 'retired' || asset.lifecycle_status === 'decommissioned' ? asset.lifecycle_status : '',
              }))}
              selected={form.asset_ids} onToggle={id => toggleIn('asset_ids', id)}
              disabled={assetsLoading || !!assetsError}
              status={assetsLoading ? 'Loading assets…' : assetsError || (!assets.length ? 'No active assets recorded for this customer.' : '')}
              statusIsError={!!assetsError} />
          )}
          {form.customer_id && form.asset_ids.length > 0 && (
            <div className="al-asset-versions">
              <span className="al-asset-versions-title">Version <em>(optional — e.g. the version an upgrade left it on)</em></span>
              {form.asset_ids.map(id => {
                const asset = assets.find(item => item.id === id);
                return (
                  <label key={id} className="al-asset-version">
                    <span>{asset?.name || `Asset ${id}`}</span>
                    <input value={form.asset_versions?.[id] || ''} maxLength={100} placeholder="e.g. 12.4.1"
                      onChange={e => setForm(f => ({ ...f, asset_versions: { ...f.asset_versions, [id]: e.target.value } }))} />
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>

        <fieldset className="af-group">
          <legend>Follow-up</legend>
          <label className="af-check">
            <input type="checkbox" checked={form.follow_up_required}
              onChange={e => setForm(f => ({ ...f, follow_up_required: e.target.checked }))} />
            This needs a follow-up
          </label>
          {form.follow_up_required && (
            <Field label="Follow up by" required>
              <input type="date" value={form.follow_up_date} onChange={set('follow_up_date')} required />
            </Field>
          )}
        </fieldset>
      </details>

      {isChangeCategory && (
        <details className="af-more" open={showChangeDetails} onToggle={e => setShowChangeDetails(e.target.open)}>
          <summary>Change details</summary>
          <div className="af-grid">
            <Field label="Change type"><input value={form.change_type} onChange={set('change_type')} placeholder="For example, firewall rule update" /></Field>
            <Field label="Risk">
              <select value={form.change_risk} onChange={set('change_risk')}>
                <option value="">Not specified</option>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
              </select>
            </Field>
            <Field label="Reason" className="af-wide"><textarea value={form.change_reason} onChange={set('change_reason')} rows={2} /></Field>
            <Field label="Previous state"><textarea value={form.previous_state} onChange={set('previous_state')} rows={2} /></Field>
            <Field label="New state"><textarea value={form.new_state} onChange={set('new_state')} rows={2} /></Field>
            <Field label="Customer approval reference"><input value={form.customer_approval_reference} onChange={set('customer_approval_reference')} /></Field>
            <Field label="Verification notes"><textarea value={form.verification_notes} onChange={set('verification_notes')} rows={2} /></Field>
          </div>
          <label className="af-check">
            <input type="checkbox" checked={form.rollback_available}
              onChange={e => setForm(f => ({ ...f, rollback_available: e.target.checked }))} />
            A rollback is available
          </label>
        </details>
      )}

      {category?.require_attachment && (
        <p className="af-note">This category needs at least one attachment before the activity can be marked completed. You can add it after saving.</p>
      )}

      <div className="af-footer">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Log activity'}</button>
      </div>
    </form>
  );
}
