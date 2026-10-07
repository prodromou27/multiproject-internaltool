import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { api } from '../../api';
import { Modal } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';
import { CategoriesEditor, TechnologiesEditor } from './ActivityCatalogEditors';
import { useLiveRefresh } from '../../live';
import CheckList from '../../components/CheckList';

export function TeamsAdminSection() {
  const toast = useToast();
  const confirm = useConfirm();
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [name, setName] = useState('');
  const [editingMembers, setEditingMembers] = useState(null);

  const load = () => Promise.all([api.teams(), api.users()]).then(([t, u]) => { setTeams(t); setUsers(u); });
  useEffect(() => { load(); }, []);
  useLiveRefresh(load);

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
          <thead><tr><th>Team</th><th>Members</th><th>Workflow emphasis</th><th>Activity tracking</th><th></th></tr></thead>
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
                <td><button className="btn btn-sm btn-ghost" onClick={() => remove(t)}><Trash2 size={12} /></button></td>
              </tr>
            ))}
            {teams.length === 0 && <tr><td colSpan={5} className="text-muted">No teams yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {editingMembers && (
        <Modal title={`Members — ${editingMembers.name}`} onClose={() => setEditingMembers(null)}>
          <div className="form-group">
            <span id="team-members-label" className="sr-only">Team members</span>
            <CheckList id="team-members" label="team members" searchPlaceholder="Search people…"
              options={users.filter(u => u.active !== 0 && u.active !== false || editingMembers.memberIds.includes(u.id)).map(u => ({ id: u.id, label: u.name, detail: u.role }))}
              selected={editingMembers.memberIds}
              onChange={memberIds => setEditingMembers(em => ({ ...em, memberIds }))} />
          </div>
          <div className="modal-footer u-cc45258">
            <button className="btn btn-ghost" onClick={() => setEditingMembers(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveMembers}>Save Members</button>
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
  const [categories, setCategories] = useState([]);
  const [technologies, setTechnologies] = useState([]);
  const [teams, setTeams] = useState([]);

  const load = () => Promise.all([api.activityCategories({ includeInactive: true }), api.technologies({ includeInactive: true }), api.teams()])
    .then(([c, t, tm]) => { setCategories(c); setTechnologies(t); setTeams(tm); });
  useEffect(() => { load(); }, []);
  useLiveRefresh(load);

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

      <CategoriesEditor categories={categories} teams={teams} onChanged={load} />
      <TechnologiesEditor technologies={technologies} onChanged={load} />

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
