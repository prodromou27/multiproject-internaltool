import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { Toggle } from './shared';

/* Settings → SLAs: which SLAs apply and their limits (server: slaPolicy.js).
   The SLA page shows compliance against these. Targets for anything else
   (tickets resolved, trainings, certifications…) are KPIs. */
export function SlaSettingsTab() {
  const toast = useToast();
  const [data, setData] = useState(null), [form, setForm] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    api.slaPolicy().then(result => { setData(result); setForm(result.policy); }).catch(failure => setError(failure.message));
  }, []);
  if (error) return <div className="error-msg" role="alert">{error}</div>;
  if (!form) return <p className="text-muted">Loading…</p>;
  const changed = JSON.stringify(form) !== JSON.stringify(data.policy);
  const set = (key, patch) => setForm(current => ({ ...current, [key]: { ...current[key], ...patch } }));
  async function save() {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, { enabled: value.enabled, limit: Number(value.limit) }]));
      const result = await api.saveSlaPolicy(body);
      setData(result); setForm(result.policy); toast.success('SLA settings saved');
    } catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  return <section className="card">
    <p className="text-muted text-sm">Choose which SLAs apply and their limits. <Link to="/sla">The SLA page</Link> shows what is on time, at risk and breached. For targets on anything else, such as tickets resolved per engineer, trainings or certifications, use <Link to="/kpis">KPIs</Link>.</p>
    <div className="table-wrap"><table>
      <thead><tr><th scope="col">SLA</th><th scope="col">On</th><th scope="col">Limit</th></tr></thead>
      <tbody>{data.slas.map(sla => <tr key={sla.key}>
        <td><strong>{sla.label}</strong><div className="text-muted text-sm">{sla.description}</div></td>
        <td><Toggle checked={form[sla.key].enabled} onChange={enabled => set(sla.key, { enabled })} label={form[sla.key].enabled ? 'On' : 'Off'} /></td>
        <td><label className="sla-limit"><input type="number" min={0.5} step={0.5} aria-label={`${sla.label} limit (${sla.unit})`} value={form[sla.key].limit} disabled={!form[sla.key].enabled}
          onChange={event => set(sla.key, { limit: event.target.value })} /> <span className="text-sm text-muted">{sla.unit}</span></label></td>
      </tr>)}</tbody>
    </table></div>
    <div className="flex gap-8 mt-12">
      <button type="button" className="btn btn-primary btn-sm" disabled={!changed || busy} onClick={save}><Save size={13} /> {busy ? 'Saving…' : 'Save SLAs'}</button>
      {changed && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(data.policy)}>Undo changes</button>}
    </div>
  </section>;
}
