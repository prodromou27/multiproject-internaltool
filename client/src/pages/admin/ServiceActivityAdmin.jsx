import { useEffect, useState } from 'react';
import { Trash2, Save, Plus, Clock } from 'lucide-react';
import { api } from '../../api';
import { Modal } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';
import { LookupTable } from './shared';

export function TeamsAdminSection() {
  const toast = useToast();
  const confirm = useConfirm();
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [name, setName] = useState('');
  const [editingMembers, setEditingMembers] = useState(null);
  const [editingSla, setEditingSla] = useState(null);

  const load = () => Promise.all([api.teams(), api.users()]).then(([t, u]) => { setTeams(t); setUsers(u); });
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try { await api.createTeam({ name: name.trim(), service_activity_enabled: false }); setName(''); load(); }
    catch (e2) { toast.error(e2.message); }
  }

  async function toggleEnabled(team) {
    try { await api.updateTeam(team.id, { service_activity_enabled: !team.service_activity_enabled }); load(); }
    catch (e2) { toast.error(e2.message); }
  }

  async function toggleCapability(team,key) {
    try { await api.updateTeam(team.id,{ [key]:!team[key] });load(); }
    catch (e2) { toast.error(e2.message); }
  }

  async function remove(team) {
    const ok = await confirm(`Delete team "${team.name}"? This removes all member and customer assignments.`, { title: 'Delete Team' });
    if (!ok) return;
    try { await api.deleteTeam(team.id); toast.success('Team deleted'); load(); } catch (e2) { toast.error(e2.message); }
  }

  async function openMembers(team) {
    const full = await api.team(team.id);
    setEditingMembers({ ...team, memberIds: full.members.map(m => m.id) });
  }

  async function saveMembers() {
    try { await api.setTeamMembers(editingMembers.id, editingMembers.memberIds); toast.success('Team members updated'); setEditingMembers(null); load(); }
    catch (e2) { toast.error(e2.message); }
  }

  async function openSla(team) {
    const full = await api.team(team.id);
    setEditingSla({ id: team.id, name: team.name, response_hours: full.sla.response_hours, resolution_hours: full.sla.resolution_hours });
  }

  async function saveSla() {
    try {
      await api.saveTeamSla(editingSla.id, { response_hours: Number(editingSla.response_hours), resolution_hours: Number(editingSla.resolution_hours) });
      toast.success('SLA targets updated'); setEditingSla(null); load();
    } catch (e2) { toast.error(e2.message); }
  }

  return (
    <div className="card mb-16">
      <div className="section-title">Teams</div>
      <p className="text-sm text-muted u-761d3ad">
        Configure workflow emphasis independently from access. Engineers keep every module allowed by RBAC; these capabilities only prioritize navigation, quick actions and My Work.
      </p>
      <form onSubmit={create} className="u-b37b9a5">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New team name…" />
        <button className="btn btn-primary btn-sm" disabled={!name.trim()}><Plus size={13} /> Add Team</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Team</th><th>Members</th><th>Workflow emphasis</th><th>Activity tracking</th><th>SLA</th><th></th></tr></thead>
          <tbody>
            {teams.map(t => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>
                  <button className="btn btn-sm btn-ghost" onClick={() => openMembers(t)}>{t.member_count} member(s)</button>
                </td>
                <td><div className="u-15d9c4f">
                  <label className="text-sm u-25b5288"><input type="checkbox" checked={!!t.managed_service_operations} onChange={() => toggleCapability(t,'managed_service_operations')} className="u-30e741d" /> Managed Services</label>
                  <label className="text-sm u-25b5288"><input type="checkbox" checked={!!t.project_delivery_enabled} onChange={() => toggleCapability(t,'project_delivery_enabled')} className="u-30e741d" /> Project Delivery</label>
                </div></td>
                <td><input type="checkbox" checked={!!t.service_activity_enabled} onChange={() => toggleEnabled(t)} className="u-30e741d" /></td>
                <td><button className="btn btn-sm btn-ghost" onClick={() => openSla(t)}><Clock size={12} /> Targets</button></td>
                <td><button className="btn btn-sm btn-ghost" onClick={() => remove(t)}><Trash2 size={12} /></button></td>
              </tr>
            ))}
            {teams.length === 0 && <tr><td colSpan={6} className="text-muted">No teams yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {editingMembers && (
        <Modal title={`Members — ${editingMembers.name}`} onClose={() => setEditingMembers(null)}>
          <div className="form-group">
            <select multiple value={editingMembers.memberIds.map(String)}
              onChange={e => setEditingMembers(em => ({ ...em, memberIds: [...e.target.selectedOptions].map(o => Number(o.value)) }))}
              className="u-b9666ec">
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
          </div>
          <div className="modal-footer u-cc45258">
            <button className="btn btn-ghost" onClick={() => setEditingMembers(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveMembers}>Save Members</button>
          </div>
        </Modal>
      )}

      {editingSla && (
        <Modal title={`Service Activity SLA — ${editingSla.name}`} onClose={() => setEditingSla(null)}>
          <p className="text-sm text-muted mb-12">
            Response is how long an activity can sit unstarted before it's flagged; resolution is how long it can stay
            open in total. Shown on the SLA page, broken down per team.
          </p>
          <div className="form-row">
            <div className="form-group">
              <label>Response target (hours)</label>
              <input type="number" min="0.5" max="8760" step="0.5" value={editingSla.response_hours}
                onChange={e => setEditingSla(s => ({ ...s, response_hours: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Resolution target (hours)</label>
              <input type="number" min="0.5" max="8760" step="0.5" value={editingSla.resolution_hours}
                onChange={e => setEditingSla(s => ({ ...s, resolution_hours: e.target.value }))} />
            </div>
          </div>
          <div className="modal-footer u-cc45258">
            <button className="btn btn-ghost" onClick={() => setEditingSla(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveSla}><Save size={13} /> Save Targets</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function ServiceActivityGeneralSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const [settings, setSettings] = useState(null);
  const [retention, setRetention] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => Promise.all([api.getServiceActivitySettings(), api.serviceActivityRetentionStatus()])
    .then(([s, r]) => { setSettings(s); setRetention(r); });
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    try {
      await api.saveServiceActivitySettings({
        ...settings,
        retention_days: settings.retention_days ? Number(settings.retention_days) : null,
      });
      toast.success('Settings saved');
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function purge() {
    const ok = await confirm(
      `Permanently delete ${retention.eligible_count} service activit${retention.eligible_count === 1 ? 'y' : 'ies'} older than ${retention.cutoff}? This cannot be undone.`,
      { title: 'Purge Old Activities' }
    );
    if (!ok) return;
    try { const r = await api.purgeOldActivities(); toast.success(`Deleted ${r.deleted} activities`); load(); }
    catch (e) { toast.error(e.message); }
  }

  if (!settings) return null;

  return (
    <div className="card mb-16">
      <div className="section-title">General Settings</div>
      <div className="form-group">
        <label className="u-ea06b0c">
          <input type="checkbox" checked={settings.allow_attachments} className="u-30e741d"
            onChange={e => setSettings(s => ({ ...s, allow_attachments: e.target.checked }))} />
          Allow Attachments
        </label>
      </div>
      <div className="form-group">
        <label className="u-ea06b0c">
          <input type="checkbox" checked={settings.allow_follow_up_task_creation} className="u-30e741d"
            onChange={e => setSettings(s => ({ ...s, allow_follow_up_task_creation: e.target.checked }))} />
          Allow Follow-Up Task Creation
        </label>
      </div>
      <div className="form-group u-55585d5">
        <label>Retention Period (days)</label>
        <input type="number" min="1" value={settings.retention_days || ''} placeholder="No limit"
          onChange={e => setSettings(s => ({ ...s, retention_days: e.target.value || null }))} />
      </div>
      <button className="btn btn-primary btn-sm mb-12" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save Settings'}
      </button>

      {retention?.retention_days && (
        <div className="u-650b690">
          <span className="text-sm text-muted">
            {retention.eligible_count} activit{retention.eligible_count === 1 ? 'y is' : 'ies are'} older than {retention.retention_days} days (before {retention.cutoff})
          </span>
          <button className="btn btn-sm btn-danger" onClick={purge} disabled={!retention.eligible_count}>Purge Old Activities</button>
        </div>
      )}
    </div>
  );
}

export function ServiceActivityAdminTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [categories, setCategories] = useState([]);
  const [technologies, setTechnologies] = useState([]);
  const [teams, setTeams] = useState([]);

  const load = () => Promise.all([api.activityCategories(), api.technologies(), api.teams()])
    .then(([c, t, tm]) => { setCategories(c); setTechnologies(t); setTeams(tm); });
  useEffect(() => { load(); }, []);

  return (
    <div>
      <ServiceActivityGeneralSettings />

      <div className="card mb-16">
        <div className="section-title">Teams</div>
        <p className="text-sm text-muted">
          Create teams, manage membership, and enable Service Activity Tracking per team under
          {' '}<strong>Teams</strong> in the People &amp; Work group.
        </p>
      </div>

      <LookupTable
        title="Activity Categories"
        items={categories}
        onAdd={async (name, teamId) => { await api.createActivityCategory({ name, team_id: teamId || null }); load(); }}
        onToggle={async item => { await api.updateActivityCategory(item.id, { active: !item.active }); load(); }}
        onDelete={async item => {
          const ok = await confirm(`Delete category "${item.name}"?`, { title: 'Delete Category' });
          if (!ok) return;
          try { await api.deleteActivityCategory(item.id); load(); } catch (e) { toast.error(e.message); }
        }}
        extraField={{
          label: 'Team',
          initial: '',
          render: (value, setValue) => (
            <select value={value || ''} onChange={e => setValue(e.target.value)} className="u-94253f9" aria-label="Team">
              <option value="">Shared (every team)</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ),
        }}
        extraColumns={[
          {
            label: 'Team',
            render: item => (
              <select value={item.team_id || ''} className="u-94253f9" aria-label={`Team for ${item.name}`}
                onChange={async e => { await api.updateActivityCategory(item.id, { team_id: e.target.value || null }); load(); }}>
                <option value="">Shared (every team)</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ),
          },
          {
            label: 'Require Attachment',
            render: item => (
              <input type="checkbox" checked={!!item.require_attachment} className="u-30e741d"
                onChange={async () => { await api.updateActivityCategory(item.id, { require_attachment: !item.require_attachment }); load(); }} />
            ),
          },
          {
            label: 'Require Asset',
            render: item => (
              <input type="checkbox" checked={!!item.require_asset} className="u-30e741d" title="Activities in this category must name the customer asset worked on (when the customer has assets)"
                onChange={async () => { await api.updateActivityCategory(item.id, { require_asset: !item.require_asset }); load(); }} />
            ),
          },
        ]}
      />

      <LookupTable
        title="Technologies"
        items={technologies}
        onAdd={async name => { await api.createTechnology({ name }); load(); }}
        onToggle={async item => { await api.updateTechnology(item.id, { active: !item.active }); load(); }}
        onDelete={async item => {
          const ok = await confirm(`Delete technology "${item.name}"?`, { title: 'Delete Technology' });
          if (!ok) return;
          try { await api.deleteTechnology(item.id); load(); } catch (e) { toast.error(e.message); }
        }}
      />

      <div className="card">
        <div className="section-title">Statuses, Customers & Rules</div>
        <p className="text-sm text-muted">
          Activity statuses share the same configurable workflow editor as Projects/Tasks/Visits — manage them
          under <strong>Status Workflow</strong> (a "Service Activity" group has been added there).
          Customer-level rules (require duration, ticket reference, technology, etc.), team assignment, and
          contract hour tracking are configured per customer on the <strong>Customers</strong> page.
        </p>
      </div>
    </div>
  );
}
