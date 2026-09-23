import { useEffect,useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';

const labelRole=role => role==='pm'?'PM':role.charAt(0).toUpperCase()+role.slice(1);

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
  const RuleSelect=({ scope,owner,permissionKey,rule,eligible=true }) => eligible ? <select aria-label={`${permissionKey} ${scope} rule`} value={rule?rule.allowed?'allow':'deny':'default'} disabled={saving===`${scope}:${owner}:${permissionKey}`} onChange={event => change(scope,owner,permissionKey,event.target.value)} style={{ minWidth:115 }}><option value="default">Default</option><option value="allow">Allow</option><option value="deny">Deny</option></select> : <span className="text-muted text-sm">Not eligible</span>;
  return <div style={{ display:'grid',gap:18 }}>
    {error && <div className="error-msg" role="alert">{error}</div>}
    <div className="card"><div className="card-header"><div><h3 style={{ display:'flex',alignItems:'center',gap:7,fontSize:15 }}><ShieldCheck size={16} /> Role permissions</h3><p className="text-muted text-sm mt-4">Overrides change one capability without changing the user’s primary role. Default preserves the built-in behavior.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Capability</th>{data.roles.map(role => <th key={role}>{labelRole(role)}</th>)}</tr></thead><tbody>{data.definitions.map(permission => <tr key={permission.key}><td><strong>{permission.label}</strong><div className="text-muted text-sm">{permission.description}</div><code style={{ fontSize:11 }}>{permission.key}</code></td>{data.roles.map(role => { const rule=roleRule(role,permission.key),eligible=!permission.eligible_roles || permission.eligible_roles.includes(role);return <td key={role}><RuleSelect scope="role" owner={role} permissionKey={permission.key} rule={rule} eligible={eligible} /><div className="text-muted text-sm mt-4">{eligible ? `Default: ${data.defaults[role][permission.key]?'Allow':'Deny'}` : 'Restricted by policy'}</div></td>; })}</tr>)}</tbody></table></div>
    </div>
    <div className="card"><div className="card-header"><div><h3 style={{ fontSize:15 }}>User exceptions</h3><p className="text-muted text-sm mt-4">A user exception takes precedence over both the role default and a role override.</p></div></div>
      <div className="form-group" style={{ maxWidth:420 }}><label htmlFor="permission-user">User</label><select id="permission-user" value={selectedUser} onChange={event => setSelectedUser(event.target.value)}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name} · {labelRole(user.role)}{user.active?'':' · Inactive'}</option>)}</select></div>
      {selected && <div className="table-wrap"><table><thead><tr><th>Capability</th><th>Exception</th><th>Effective source</th></tr></thead><tbody>{data.definitions.map(permission => { const rule=userRule(selected.id,permission.key),role=roleRule(selected.role,permission.key),eligible=!permission.eligible_roles || permission.eligible_roles.includes(selected.role),effective=eligible?(rule?`User ${rule.allowed?'allow':'deny'}`:role?`Role ${role.allowed?'allow':'deny'}`:`${labelRole(selected.role)} default`):'Restricted by policy';return <tr key={permission.key}><td><strong>{permission.label}</strong><div className="text-muted text-sm">{permission.group}</div></td><td><RuleSelect scope="user" owner={selected.id} permissionKey={permission.key} rule={rule} eligible={eligible} /></td><td>{effective}</td></tr>; })}</tbody></table></div>}
    </div>
  </div>;
}
