const router=require('express').Router();
const db=require('../db');
const { requireManager }=require('../middleware/auth');
const { logAudit }=require('../auditLog');
const reporting=require('../managedCustomerReportingService');

router.use(requireManager);
const fail=(message,status=400) => { throw Object.assign(new Error(message),{ status }); };
const parse=row => row && ({ ...row,active:!!row.active,version:Number(row.version),sections:JSON.parse(row.sections),default_narratives:JSON.parse(row.default_narratives) });
function input(body,{ create=false }={}) {
  if (!body || typeof body!=='object' || Array.isArray(body)) fail('Invalid report template');
  const allowed=new Set(['name','description','sections','default_narratives','active','version']);if (Object.keys(body).some(key => !allowed.has(key))) fail('Invalid report template');
  const name=String(body.name || '').trim(),description=String(body.description || '').trim();
  if (!name || name.length>120) fail('Template name must be between 1 and 120 characters');if (description.length>1000) fail('Description must be at most 1000 characters');
  const sections=reporting.validateSections(body.sections);if (!sections.length) fail('Select at least one report section');
  const narratives=reporting.validateNarratives(body.default_narratives);
  if (typeof body.active!=='boolean') fail('active must be true or false');
  if (!create && (!Number.isSafeInteger(Number(body.version)) || Number(body.version)<1)) fail('A valid template version is required');
  return { name,description,sections,narratives,active:body.active,version:Number(body.version || 0) };
}
router.get('/',async (req,res) => { const rows=await db.prepare('SELECT * FROM managed_report_templates ORDER BY active DESC,name,id').all();res.json({ rows:rows.map(parse),section_keys:reporting.SECTION_KEYS,narrative_keys:reporting.NARRATIVE_KEYS }); });
router.post('/',async (req,res) => { try { const value=input(req.body,{ create:true }),result=await db.prepare('INSERT INTO managed_report_templates (name,description,sections,default_narratives,active,created_by,updated_by) VALUES (?,?,?,?,?,?,?)').run(value.name,value.description,JSON.stringify(value.sections),JSON.stringify(value.narratives),value.active?1:0,req.user.id,req.user.id);await logAudit(db,req,'managed_report_template',result.lastInsertRowid,value.name,'created',`sections=${value.sections.join(',')}`);res.status(201).json(parse(await db.prepare('SELECT * FROM managed_report_templates WHERE id=?').get(result.lastInsertRowid))); } catch(error) { if (error.code==='23505') return res.status(409).json({ error:'A report template with this name already exists' });res.status(error.status || 500).json({ error:error.status?error.message:'Could not create report template' }); } });
router.put('/:id',async (req,res) => { try { const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) fail('Invalid template ID');const value=input(req.body),result=await db.prepare('UPDATE managed_report_templates SET name=?,description=?,sections=?,default_narratives=?,active=?,version=version+1,updated_by=?,updated_at=app_now() WHERE id=? AND version=?').run(value.name,value.description,JSON.stringify(value.sections),JSON.stringify(value.narratives),value.active?1:0,req.user.id,id,value.version);if (result.changes!==1) fail('This template changed after you opened it. Reload and try again.',409);await logAudit(db,req,'managed_report_template',id,value.name,'updated',`version=${value.version+1}`);res.json(parse(await db.prepare('SELECT * FROM managed_report_templates WHERE id=?').get(id))); } catch(error) { if (error.code==='23505') return res.status(409).json({ error:'A report template with this name already exists' });res.status(error.status || 500).json({ error:error.status?error.message:'Could not update report template' }); } });
router.delete('/:id',async (req,res) => { try { const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) fail('Invalid template ID');const template=await db.prepare('SELECT * FROM managed_report_templates WHERE id=?').get(id);if (!template) fail('Report template not found',404);const used=await db.prepare('SELECT COUNT(*) AS count FROM managed_customer_configurations WHERE default_report_template_id=?').get(id);if (Number(used.count)) fail('This template is the default for one or more managed customers',409);await db.prepare('DELETE FROM managed_report_templates WHERE id=?').run(id);await logAudit(db,req,'managed_report_template',id,template.name,'deleted','');res.json({ ok:true }); } catch(error) { res.status(error.status || 500).json({ error:error.status?error.message:'Could not delete report template' }); } });

module.exports=router;
