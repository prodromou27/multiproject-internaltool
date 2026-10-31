const router=require('express').Router();
const db=require('../db');
const { requireManager }=require('../middleware/auth');
const permissions=require('../permissions');
const { logAudit }=require('../auditLog');

router.use(requireManager);

router.get('/',async (req,res) => {
  const [roleRules,userRules,users,customRoles]=await Promise.all([
    db.prepare('SELECT role,permission_key,allowed,version,updated_at FROM role_permission_overrides ORDER BY role,permission_key').all(),
    db.prepare('SELECT user_id,permission_key,allowed,version,updated_at FROM user_permission_overrides ORDER BY user_id,permission_key').all(),
    db.prepare('SELECT id,name,email,role,active,custom_role_id FROM users ORDER BY active DESC,name').all(),
    customRoleList(),
  ]);
  res.json({ definitions:permissions.DEFINITIONS,roles:permissions.ROLES,defaults:permissions.DEFAULTS,role_rules:roleRules,user_rules:userRules,users,custom_roles:customRoles });
});

/* ── Custom roles ─────────────────────────────────────────────────────────────
   A named role on one of the four roles, with its own permissions: each one ticked
   or not (only those the base role may hold). The base role does not change once
   made; people get the role from Settings → Users. */
async function customRoleList(store=db) {
  const [roles,rules,members]=await Promise.all([
    store.prepare('SELECT id,name,base_role,description,version FROM custom_roles ORDER BY name').all(),
    store.prepare('SELECT custom_role_id,permission_key,allowed FROM custom_role_permissions').all(),
    store.prepare('SELECT custom_role_id,COUNT(*) AS n FROM users WHERE custom_role_id IS NOT NULL GROUP BY custom_role_id').all(),
  ]);
  return roles.map(role => ({ ...role,
    permissions:Object.fromEntries(rules.filter(rule => Number(rule.custom_role_id)===Number(role.id)).map(rule => [rule.permission_key,!!rule.allowed])),
    members:Number(members.find(row => Number(row.custom_role_id)===Number(role.id))?.n || 0) }));
}
function customRoleInput(body,existing=null) {
  if (!body || typeof body!=='object') return { error:'A JSON object is required' };
  const name=typeof body.name==='string' ? body.name.trim() : '';
  if (name.length<2 || name.length>60) return { error:'The role name must have 2 to 60 characters' };
  if (permissions.ROLES.includes(name.toLowerCase()) || ['manager','planner','pm','engineer','project manager'].includes(name.toLowerCase())) return { error:'Use a name other than the built-in roles' };
  const base=existing ? existing.base_role : body.base_role;
  if (!permissions.validRole(base)) return { error:'Choose the role it is built on: manager, planner, pm or engineer' };
  if (existing && body.base_role!==undefined && body.base_role!==existing.base_role) return { error:'The base role cannot change; make a new role instead' };
  const description=body.description==null ? null : String(body.description).trim().slice(0,300) || null;
  const chosen=body.permissions && typeof body.permissions==='object' && !Array.isArray(body.permissions) ? body.permissions : {};
  for (const [key,value] of Object.entries(chosen)) {
    if (!permissions.validPermission(key)) return { error:`Unknown permission: ${key}` };
    if (typeof value!=='boolean') return { error:`${key} must be true or false` };
    if (value && !permissions.eligibleRole(key,base)) return { error:`A role built on ${base} cannot have ${key}` };
  }
  // Every permission the base role may hold is set: ticked or not.
  const rules=permissions.DEFINITIONS.filter(item => permissions.eligibleRole(item.key,base))
    .map(item => [item.key,Object.prototype.hasOwnProperty.call(chosen,item.key) ? chosen[item.key] : !!permissions.DEFAULTS[base][item.key]]);
  return { value:{ name,base_role:base,description,rules } };
}
const announceChange=() => { try { require('../liveUpdates').emitChange('permissions'); } catch { /* optional */ } };

router.post('/custom-roles',async (req,res) => {
  const input=customRoleInput(req.body);if (input.error) return res.status(400).json({ error:input.error });
  const { name,base_role:base,description,rules }=input.value;
  try {
    const id=await db.transaction(async tx => {
      const created=await tx.prepare('INSERT INTO custom_roles (name,base_role,description,created_by) VALUES (?,?,?,?)').run(name,base,description,req.user.id);
      for (const [key,allowed] of rules) await tx.prepare('INSERT INTO custom_role_permissions (custom_role_id,permission_key,allowed) VALUES (?,?,?)').run(created.lastInsertRowid,key,allowed?1:0);
      return created.lastInsertRowid;
    });
    await logAudit(db,req,'custom_role',id,name,'custom_role_created',`base=${base}; allowed=${rules.filter(([,allowed]) => allowed).map(([key]) => key).join(',')}`);
    res.status(201).json((await customRoleList()).find(role => Number(role.id)===Number(id)));
  } catch(error) {
    if (error.code==='23505' || /unique/i.test(error.message)) return res.status(409).json({ error:'A role with this name already exists' });
    throw error;
  }
});

router.put('/custom-roles/:roleId',async (req,res) => {
  const id=Number(req.params.roleId);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid role ID' });
  const existing=await db.prepare('SELECT * FROM custom_roles WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error:'Role not found' });
  if (!Number.isInteger(req.body?.version)) return res.status(400).json({ error:'version is required' });
  const input=customRoleInput(req.body,existing);if (input.error) return res.status(400).json({ error:input.error });
  const { name,description,rules }=input.value;
  try {
    const changed=await db.transaction(async tx => {
      const updated=await tx.prepare('UPDATE custom_roles SET name=?,description=?,version=version+1,updated_at=app_now() WHERE id=? AND version=?').run(name,description,id,req.body.version);
      if (!updated.changes) return false;
      await tx.prepare('DELETE FROM custom_role_permissions WHERE custom_role_id=?').run(id);
      for (const [key,allowed] of rules) await tx.prepare('INSERT INTO custom_role_permissions (custom_role_id,permission_key,allowed) VALUES (?,?,?)').run(id,key,allowed?1:0);
      return true;
    });
    if (!changed) return res.status(409).json({ error:'This role changed since it was loaded. Reload and try again.' });
  } catch(error) {
    if (error.code==='23505' || /unique/i.test(error.message)) return res.status(409).json({ error:'A role with this name already exists' });
    throw error;
  }
  await logAudit(db,req,'custom_role',id,name,'custom_role_updated',`allowed=${rules.filter(([,allowed]) => allowed).map(([key]) => key).join(',')}`);
  announceChange();
  res.json((await customRoleList()).find(role => Number(role.id)===id));
});

// People with the role keep its base role and lose only its extra permissions.
router.delete('/custom-roles/:roleId',async (req,res) => {
  const id=Number(req.params.roleId);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid role ID' });
  const existing=await db.prepare('SELECT id,name FROM custom_roles WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error:'Role not found' });
  await db.transaction(async tx => {
    await tx.prepare('UPDATE users SET custom_role_id=NULL WHERE custom_role_id=?').run(id);
    await tx.prepare('DELETE FROM custom_roles WHERE id=?').run(id);
  });
  await logAudit(db,req,'custom_role',id,existing.name,'custom_role_deleted',null);
  announceChange();
  res.json({ ok:true });
});

function validateRule(body) {
  if (!body || !['role','user'].includes(body.scope)) return 'scope must be role or user';
  if (!permissions.validPermission(body.permission_key)) return 'Unknown permission';
  if (body.allowed!==null && typeof body.allowed!=='boolean') return 'allowed must be true, false, or null';
  if (!Number.isInteger(body.version) || body.version<0) return 'version must be a non-negative integer';
  if (body.scope==='role' && !permissions.validRole(body.role)) return 'Invalid role';
  if (body.scope==='user' && (!Number.isSafeInteger(body.user_id) || body.user_id<1)) return 'Invalid user ID';
  return null;
}

router.put('/rule',async (req,res) => {
  const error=validateRule(req.body);if (error) return res.status(400).json({ error });
  const { scope,permission_key:permissionKey,allowed,version }=req.body;
  const owner=scope==='role'?req.body.role:req.body.user_id,table=scope==='role'?'role_permission_overrides':'user_permission_overrides',column=scope==='role'?'role':'user_id';
  const result=await db.transaction(async tx => {
    const targetUser=scope==='user' ? await tx.prepare('SELECT id,role FROM users WHERE id=?').get(owner) : null;
    if (scope==='user' && !targetUser) return { status:404,error:'User not found' };
    const targetRole=scope==='role' ? owner : targetUser.role;
    if (allowed===true && !permissions.eligibleRole(permissionKey,targetRole)) return { status:400,error:'This role is not eligible for this permission' };
    const current=await tx.prepare(`SELECT allowed,version FROM ${table} WHERE ${column}=? AND permission_key=? FOR UPDATE`).get(owner,permissionKey);
    if ((current?.version || 0)!==version) return { status:409,error:'Permission rule changed since it was loaded',code:'PERMISSION_CONFLICT',current:current || null };
    if (allowed===null) {
      if (current) await tx.prepare(`DELETE FROM ${table} WHERE ${column}=? AND permission_key=?`).run(owner,permissionKey);
      return { rule:null };
    }
    const nextVersion=version+1;
    if (current) await tx.prepare(`UPDATE ${table} SET allowed=?,version=?,updated_by=?,updated_at=app_now() WHERE ${column}=? AND permission_key=?`).run(allowed?1:0,nextVersion,req.user.id,owner,permissionKey);
    else await tx.prepare(`INSERT INTO ${table} (${column},permission_key,allowed,version,updated_by) VALUES (?,?,?,?,?)`).run(owner,permissionKey,allowed?1:0,nextVersion,req.user.id);
    return { rule:{ [column]:owner,permission_key:permissionKey,allowed:allowed?1:0,version:nextVersion } };
  });
  if (result.status) return res.status(result.status).json(result);
  await logAudit(db,req,'permission',null,`${scope}:${owner}`,'permission_rule_updated',`permission=${permissionKey}; allowed=${allowed===null?'default':allowed}`);
  res.json(result);
});

module.exports=router;
module.exports.customRoleList=customRoleList;
