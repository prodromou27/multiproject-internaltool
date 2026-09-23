const router=require('express').Router();
const db=require('../db');
const { requireManager }=require('../middleware/auth');
const permissions=require('../permissions');
const { logAudit }=require('../auditLog');

router.use(requireManager);

router.get('/',async (req,res) => {
  const [roleRules,userRules,users]=await Promise.all([
    db.prepare('SELECT role,permission_key,allowed,version,updated_at FROM role_permission_overrides ORDER BY role,permission_key').all(),
    db.prepare('SELECT user_id,permission_key,allowed,version,updated_at FROM user_permission_overrides ORDER BY user_id,permission_key').all(),
    db.prepare('SELECT id,name,email,role,active FROM users ORDER BY active DESC,name').all(),
  ]);
  res.json({ definitions:permissions.DEFINITIONS,roles:permissions.ROLES,defaults:permissions.DEFAULTS,role_rules:roleRules,user_rules:userRules,users });
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
