const router=require('express').Router();
const db=require('../db');
const { requireManager,requirePermission }=require('../middleware/auth');
const { logAudit }=require('../auditLog');
const reporting=require('../managedCustomerReportingService');
const wordTemplates=require('../managedReportDocx');
const multer=require('multer');

// Word templates are layout plus placeholders; a few MB is generous.
const wordUpload=multer({ storage:multer.memoryStorage(),limits:{ fileSize:5*1024*1024,files:1 } }).single('file');
const DOCX_TYPE='application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const fail=(message,status=400) => { throw Object.assign(new Error(message),{ status }); };
// The stored Word file is never sent in listings; callers see whether one exists.
const parse=row => {
  if (!row) return row;
  const { word_template:file,...rest }=row;
  return { ...rest,active:!!row.active,version:Number(row.version),sections:JSON.parse(row.sections),default_narratives:JSON.parse(row.default_narratives),has_word_template:!!file };
};
function input(body,{ create=false }={}) {
  if (!body || typeof body!=='object' || Array.isArray(body)) fail('Invalid report template');
  // Fields the listing returns but the client cannot change are ignored, so saving
  // back what was loaded works; anything else unknown is refused.
  const allowed=new Set(['name','description','sections','default_narratives','active','version']);
  const readOnly=new Set(['id','created_by','updated_by','created_at','updated_at','has_word_template','word_template_name','word_template_uploaded_at','word_template_uploaded_by']);
  if (Object.keys(body).some(key => !allowed.has(key) && !readOnly.has(key))) fail('Invalid report template');
  const name=String(body.name || '').trim(),description=String(body.description || '').trim();
  if (!name || name.length>120) fail('Template name must be between 1 and 120 characters');if (description.length>1000) fail('Description must be at most 1000 characters');
  const sections=reporting.validateSections(body.sections);if (!sections.length) fail('Select at least one report section');
  const narratives=reporting.validateNarratives(body.default_narratives);
  if (typeof body.active!=='boolean') fail('active must be true or false');
  if (!create && (!Number.isSafeInteger(Number(body.version)) || Number(body.version)<1)) fail('A valid template version is required');
  return { name,description,sections,narratives,active:body.active,version:Number(body.version || 0) };
}
/* ── Word templates ──────────────────────────────────────────────────────── */
router.get('/placeholders',requirePermission('managed_customers.view'),(req,res) => res.json({ rows:wordTemplates.placeholderReference() }));
router.get('/starter.docx',requireManager,async (req,res) => {
  res.setHeader('Content-Type',DOCX_TYPE);
  res.setHeader('Content-Disposition','attachment; filename="customer-report-template.docx"');
  res.send(await wordTemplates.starterTemplate());
});
const templateId=req => { const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) fail('Invalid template ID');return id; };
router.post('/:id/word-template',requireManager,(req,res,next) => wordUpload(req,res,error => {
  if (error) return res.status(400).json({ error:error.code==='LIMIT_FILE_SIZE' ? 'The Word template must be 5 MB or smaller' : 'Upload one .docx file' });
  next();
}),async (req,res) => {
  try {
    const id=templateId(req);
    const template=await db.prepare('SELECT id,name FROM managed_report_templates WHERE id=?').get(id);if (!template) fail('Report template not found',404);
    if (!req.file) fail('Choose a .docx file to upload');
    const name=String(req.file.originalname || 'template.docx').replace(/[^\w .()-]+/g,'_').slice(0,120);
    if (!/\.docx$/i.test(name)) fail('Upload a Word document (.docx)');
    wordTemplates.validateTemplate(req.file.buffer);
    await db.prepare('UPDATE managed_report_templates SET word_template=?,word_template_name=?,word_template_uploaded_at=app_now(),word_template_uploaded_by=? WHERE id=?')
      .run(req.file.buffer.toString('base64'),name,req.user.id,id);
    await logAudit(db,req,'managed_report_template',id,template.name,'word_template_uploaded',`file=${name}; bytes=${req.file.size}`);
    res.json(parse(await db.prepare('SELECT * FROM managed_report_templates WHERE id=?').get(id)));
  } catch(error) { res.status(error.status || 500).json({ error:error.status ? error.message : 'Could not save the Word template',details:error.details }); }
});
router.get('/:id/word-template',requireManager,async (req,res) => {
  try {
    const id=templateId(req);
    const row=await db.prepare('SELECT word_template,word_template_name FROM managed_report_templates WHERE id=?').get(id);
    if (!row || !row.word_template) fail('This report template has no Word template',404);
    res.setHeader('Content-Type',DOCX_TYPE);
    res.setHeader('Content-Disposition',`attachment; filename="${row.word_template_name || 'template.docx'}"`);
    res.send(Buffer.from(row.word_template,'base64'));
  } catch(error) { res.status(error.status || 500).json({ error:error.status ? error.message : 'Could not download the Word template' }); }
});
router.delete('/:id/word-template',requireManager,async (req,res) => {
  try {
    const id=templateId(req);
    const template=await db.prepare('SELECT id,name FROM managed_report_templates WHERE id=?').get(id);if (!template) fail('Report template not found',404);
    await db.prepare('UPDATE managed_report_templates SET word_template=NULL,word_template_name=NULL,word_template_uploaded_at=NULL,word_template_uploaded_by=NULL WHERE id=?').run(id);
    await logAudit(db,req,'managed_report_template',id,template.name,'word_template_removed','');
    res.json(parse(await db.prepare('SELECT * FROM managed_report_templates WHERE id=?').get(id)));
  } catch(error) { res.status(error.status || 500).json({ error:error.status ? error.message : 'Could not remove the Word template' }); }
});

router.get('/',requirePermission('managed_customers.view'),async (req,res) => { const rows=await db.prepare('SELECT * FROM managed_report_templates ORDER BY active DESC,name,id').all();res.json({ rows:rows.map(parse),section_keys:reporting.SECTION_KEYS,narrative_keys:reporting.NARRATIVE_KEYS }); });
router.post('/',requireManager,async (req,res) => { try { const value=input(req.body,{ create:true }),result=await db.prepare('INSERT INTO managed_report_templates (name,description,sections,default_narratives,active,created_by,updated_by) VALUES (?,?,?,?,?,?,?)').run(value.name,value.description,JSON.stringify(value.sections),JSON.stringify(value.narratives),value.active?1:0,req.user.id,req.user.id);await logAudit(db,req,'managed_report_template',result.lastInsertRowid,value.name,'created',`sections=${value.sections.join(',')}`);res.status(201).json(parse(await db.prepare('SELECT * FROM managed_report_templates WHERE id=?').get(result.lastInsertRowid))); } catch(error) { if (error.code==='23505') return res.status(409).json({ error:'A report template with this name already exists' });res.status(error.status || 500).json({ error:error.status?error.message:'Could not create report template' }); } });
router.put('/:id',requireManager,async (req,res) => { try { const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) fail('Invalid template ID');const value=input(req.body),result=await db.prepare('UPDATE managed_report_templates SET name=?,description=?,sections=?,default_narratives=?,active=?,version=version+1,updated_by=?,updated_at=app_now() WHERE id=? AND version=?').run(value.name,value.description,JSON.stringify(value.sections),JSON.stringify(value.narratives),value.active?1:0,req.user.id,id,value.version);if (result.changes!==1) fail('This template changed after you opened it. Reload and try again.',409);await logAudit(db,req,'managed_report_template',id,value.name,'updated',`version=${value.version+1}`);res.json(parse(await db.prepare('SELECT * FROM managed_report_templates WHERE id=?').get(id))); } catch(error) { if (error.code==='23505') return res.status(409).json({ error:'A report template with this name already exists' });res.status(error.status || 500).json({ error:error.status?error.message:'Could not update report template' }); } });
router.delete('/:id',requireManager,async (req,res) => { try { const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) fail('Invalid template ID');const template=await db.prepare('SELECT * FROM managed_report_templates WHERE id=?').get(id);if (!template) fail('Report template not found',404);const used=await db.prepare('SELECT COUNT(*) AS count FROM managed_customer_configurations WHERE default_report_template_id=?').get(id);if (Number(used.count)) fail('This template is the default for one or more managed customers',409);await db.prepare('DELETE FROM managed_report_templates WHERE id=?').run(id);await logAudit(db,req,'managed_report_template',id,template.name,'deleted','');res.json({ ok:true }); } catch(error) { res.status(error.status || 500).json({ error:error.status?error.message:'Could not delete report template' }); } });

module.exports=router;
