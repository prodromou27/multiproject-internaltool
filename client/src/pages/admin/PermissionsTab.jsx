import { useEffect,useState } from 'react';
import { ShieldCheck,Plus,Pencil,Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';
import { Modal } from '../../components/Shared';

const labelRole=role => role==='pm'?'PM':role.charAt(0).toUpperCase()+role.slice(1);

const eligible=(definition,role) => !definition.eligible_roles || definition.eligible_roles.includes(role);

/* A custom role: a name, the role it is built on (pages and screens follow it),
   and which of that role's permissions it has. */
function CustomRoleForm({ data,initial,onClose,onSaved }) {
  const [form,setForm]=useState(() => ({ name:initial?.name || '',description:initial?.description || '',base_role:initial?.base_role || 'engineer',permissions:initial?.permissions || {} }));
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const allowedFor=key => (Object.prototype.hasOwnProperty.call(form.permissions,key) ? form.permissions[key] : !!data.defaults[form.base_role]?.[key]);
  const definitions=data.definitions.filter(definition => eligible(definition,form.base_role));
  const groups=[...new Set(definitions.map(definition => definition.group))];
  async function submit(event) {
    event.preventDefault();setSaving(true);setError('');
    const permissions=Object.fromEntries(definitions.map(definition => [definition.key,allowedFor(definition.key)]));
    try {
      if (initial) await api.updateCustomRole(initial.id,{ name:form.name,description:form.description,version:initial.version,permissions });
      else await api.createCustomRole({ name:form.name,description:form.description,base_role:form.base_role,permissions });
      onSaved();onClose();
    } catch(failure) { setError(failure.message); } finally { setSaving(false); }
  }
  return <Modal title={initial ? `Edit ${initial.name}` : 'New role'} onClose={saving ? () => {} : onClose} wide>
    <form onSubmit={submit}>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="form-row">
        <div className="form-group"><label htmlFor="custom-role-name">Name</label><input id="custom-role-name" required minLength={2} maxLength={60} value={form.name} onChange={event => setForm(old => ({ ...old,name:event.target.value }))} placeholder="e.g. Team lead" autoFocus /></div>
        <div className="form-group"><label htmlFor="custom-role-base">Built on</label>
          <select id="custom-role-base" value={form.base_role} disabled={!!initial} onChange={event => setForm(old => ({ ...old,base_role:event.target.value,permissions:{} }))}>{data.roles.map(role => <option key={role} value={role}>{labelRole(role)}</option>)}</select>
          <small className="text-muted">{initial ? 'Fixed once made.' : 'Its pages and screens; the permissions below start from it.'}</small></div>
      </div>
      <div className="form-group"><label htmlFor="custom-role-description">Description <span className="text-muted">(optional)</span></label><input id="custom-role-description" maxLength={300} value={form.description} onChange={event => setForm(old => ({ ...old,description:event.target.value }))} /></div>
      {groups.map(group => <fieldset key={group} className="custom-role-group"><legend>{group}</legend>
        {definitions.filter(definition => definition.group===group).map(definition => <label key={definition.key} className="custom-role-permission">
          <input type="checkbox" checked={allowedFor(definition.key)} onChange={event => setForm(old => ({ ...old,permissions:{ ...old.permissions,[definition.key]:event.target.checked } }))} />
          <span><strong>{definition.label}</strong><span className="text-muted text-sm"> — {definition.description}</span></span>
        </label>)}
      </fieldset>)}
      <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save role' : 'Create role'}</button></div>
    </form>
  </Modal>;
}

function CustomRoles({ data,onChanged }) {
  const [editing,setEditing]=useState(null);
  const toast=useToast(),confirm=useConfirm();
  async function remove(role) {
    const who=role.members ? `${role.members} ${role.members===1 ? 'person keeps' : 'people keep'} the ${labelRole(role.base_role)} role without its extra permissions.` : 'Nobody has it.';
    if (!await confirm(`Delete the role "${role.name}"? ${who}`,{ title:'Delete role',label:'Delete' })) return;
    try { await api.deleteCustomRole(role.id);toast.success('Role deleted');onChanged(); } catch(failure) { toast.error(failure.message); }
  }
  const roles=data.custom_roles || [];
  return <div className="card"><div className="card-header"><div><h3 className="u-de00808">Custom roles</h3><p className="text-muted text-sm mt-4">Your own roles, such as Team lead: built on one of the roles above, with the permissions you tick. Give them to people in Settings → Users & teams.</p></div>
    <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({})}><Plus size={14} /> New role</button></div>
    {roles.length===0 ? <p className="text-muted text-sm">No custom roles yet.</p> : <div className="table-wrap"><table><thead><tr><th>Role</th><th>Built on</th><th>Permissions</th><th>People</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {roles.map(role => { const on=data.definitions.filter(definition => role.permissions[definition.key]); return <tr key={role.id}>
        <td><strong>{role.name}</strong>{role.description && <div className="text-muted text-sm">{role.description}</div>}</td>
        <td>{labelRole(role.base_role)}</td>
        <td className="text-sm">{on.length ? on.map(definition => definition.label).join(', ') : 'None'}</td>
        <td>{role.members}</td>
        <td className="table-actions"><button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${role.name}`} onClick={() => setEditing(role)}><Pencil size={13} /></button><button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${role.name}`} onClick={() => remove(role)}><Trash2 size={13} /></button></td>
      </tr>; })}
    </tbody></table></div>}
    {editing && <CustomRoleForm data={data} initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { toast.success(editing.id ? 'Role saved' : 'Role created');onChanged(); }} />}
  </div>;
}

export function PermissionsTab() {
  const [data,setData]=useState(null),[selectedUser,setSelectedUser]=useState(''),[saving,setSaving]=useState(''),[error,setError]=useState('');
  const toast=useToast();
  const load=() => api.permissionMatrix().then(result => { setData(result);setSelectedUser(current => current || String(result.users.find(user => user.active)?.id || ''));setError(''); }).catch(failure => setError(failure.message));
  useEffect(() => { load(); },[]);
  const roleRule=(role,key) => data.role_rules.find(rule => rule.role===role && rule.permission_key===key);
  const userRule=(userId,key) => data.user_rules.find(rule => rule.user_id===Number(userId) && rule.permission_key===key);
  async function change(scope,owner,key,value) {
    const rule=scope==='role'?roleRule(owner,key):userRule(owner,key),id=`${scope}:${owner}:${key}`;setSaving(id);setError('');
    try { await api.savePermissionRule({ scope,role:scope==='role'?owner:undefined,user_id:scope==='user'?Number(owner):undefined,permission_key:key,allowed:value==='default'?null:value==='allow',version:rule?.version || 0 });window.dispatchEvent(new Event('permissions-changed'));await load();toast.success('Permission rule saved'); }
    catch(failure) { setError(failure.message);await load(); }
    finally { setSaving(''); }
  }
  if (!data) return <div>{error?<div className="error-msg" role="alert">{error}</div>:<p className="text-muted">Loading permissions…</p>}</div>;
  const selected=data.users.find(user => String(user.id)===selectedUser);
  const RuleSelect=({ scope,owner,permissionKey,rule,eligible=true }) => eligible ? <select aria-label={`${permissionKey} ${scope} rule`} value={rule?rule.allowed?'allow':'deny':'default'} disabled={saving===`${scope}:${owner}:${permissionKey}`} onChange={event => change(scope,owner,permissionKey,event.target.value)} className="u-59933d1"><option value="default">Default</option><option value="allow">Allow</option><option value="deny">Deny</option></select> : <span className="text-muted text-sm">Not eligible</span>;
  return <div className="u-eecfdda">
    {error && <div className="error-msg" role="alert">{error}</div>}
    <div className="card"><div className="card-header"><div><h3 className="u-8e0f45d"><ShieldCheck size={16} /> Role permissions</h3><p className="text-muted text-sm mt-4">Overrides change one capability without changing the user’s primary role. Default preserves the built-in behavior.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Capability</th>{data.roles.map(role => <th key={role}>{labelRole(role)}</th>)}</tr></thead><tbody>{data.definitions.map(permission => <tr key={permission.key}><td><strong>{permission.label}</strong><div className="text-muted text-sm">{permission.description}</div><code className="u-11a5081">{permission.key}</code></td>{data.roles.map(role => { const rule=roleRule(role,permission.key),eligible=!permission.eligible_roles || permission.eligible_roles.includes(role);return <td key={role}><RuleSelect scope="role" owner={role} permissionKey={permission.key} rule={rule} eligible={eligible} /><div className="text-muted text-sm mt-4">{eligible ? `Default: ${data.defaults[role][permission.key]?'Allow':'Deny'}` : 'Restricted by policy'}</div></td>; })}</tr>)}</tbody></table></div>
    </div>
    <CustomRoles data={data} onChanged={load} />
    <div className="card"><div className="card-header"><div><h3 className="u-de00808">User exceptions</h3><p className="text-muted text-sm mt-4">A user exception takes precedence over both the role default and a role override.</p></div></div>
      <div className="form-group u-0fd8744"><label htmlFor="permission-user">User</label><select id="permission-user" value={selectedUser} onChange={event => setSelectedUser(event.target.value)}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name} · {labelRole(user.role)}{user.active?'':' · Inactive'}</option>)}</select></div>
      {selected && <div className="table-wrap"><table><thead><tr><th>Capability</th><th>Exception</th><th>Effective source</th></tr></thead><tbody>{data.definitions.map(permission => { const rule=userRule(selected.id,permission.key),role=roleRule(selected.role,permission.key),eligible=!permission.eligible_roles || permission.eligible_roles.includes(selected.role),effective=eligible?(rule?`User ${rule.allowed?'allow':'deny'}`:role?`Role ${role.allowed?'allow':'deny'}`:`${labelRole(selected.role)} default`):'Restricted by policy';return <tr key={permission.key}><td><strong>{permission.label}</strong><div className="text-muted text-sm">{permission.group}</div></td><td><RuleSelect scope="user" owner={selected.id} permissionKey={permission.key} rule={rule} eligible={eligible} /></td><td>{effective}</td></tr>; })}</tbody></table></div>}
    </div>
  </div>;
}
