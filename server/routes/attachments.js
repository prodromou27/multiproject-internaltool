const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth,requireDownloadAuth } = require('../middleware/auth');
const cipher = require('../cipher');
const { logAudit } = require('../auditLog');
const { uploadDir,upload,safeStoredName,safeDownloadName,hasAllowedMagic } = require('../uploadUtils');

const positiveId = value => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

async function requireProjectAccess(req,res,next) {
  if (!positiveId(req.params.project_id)) return res.status(400).json({ error:'Invalid project ID' });
  const project=await db.prepare('SELECT id FROM projects WHERE id=?').get(Number(req.params.project_id));
  if (!project) return res.status(404).json({ error:'Project not found' });
  if (['manager','pm'].includes(req.user.role)) { req.project=project;return next(); }
  if (!['engineer','planner'].includes(req.user.role)) return res.status(403).json({ error:'Forbidden' });
  const assigned=await db.prepare('SELECT 1 FROM project_assignments WHERE project_id=? AND user_id=?').get(project.id,req.user.id);
  if (!assigned) return res.status(403).json({ error:'Forbidden' });
  req.project=project;next();
}

function requireProjectWrite(req,res,next) {
  if (req.user.role==='pm') return res.status(403).json({ error:'PMs have read-only access to projects' });
  next();
}

router.get('/:project_id',requireAuth,requireProjectAccess,async (req,res) => {
  const rows=await db.prepare('SELECT a.id,a.original_name,a.mime_type,a.size,a.uploaded_by,a.created_at,u.name AS uploaded_by_name FROM attachments a JOIN users u ON u.id=a.uploaded_by WHERE a.project_id=? ORDER BY a.created_at DESC,a.id DESC').all(req.project.id);
  res.json(rows);
});

router.post('/:project_id',requireAuth,requireProjectAccess,requireProjectWrite,async (req,res) => {
  try { await new Promise((resolve,reject) => upload.single('file')(req,res,error => error ? reject(error) : resolve())); }
  catch(error) { return res.status(400).json({ error:error.message }); }
  if (!req.file) return res.status(400).json({ error:'No file uploaded' });
  try {
    if (!hasAllowedMagic(req.file.path,req.file.mimetype)) return res.status(400).json({ error:'Uploaded file content does not match the declared file type' });
    let encIv=null,encTag=null;
    if (cipher.isConfigured()) {
      const encrypted=cipher.encrypt(await fs.promises.readFile(req.file.path));
      await fs.promises.writeFile(req.file.path,encrypted.data);encIv=encrypted.iv;encTag=encrypted.tag;
    }
    const name=safeDownloadName(req.file.originalname);
    const result=await db.transaction(async tx => {
      const inserted=await tx.prepare('INSERT INTO attachments (project_id,original_name,stored_name,mime_type,size,uploaded_by,enc_iv,enc_tag) VALUES (?,?,?,?,?,?,?,?)').run(req.project.id,name,req.file.filename,req.file.mimetype,req.file.size,req.user.id,encIv,encTag);
      await logAudit(tx,req,'attachment',inserted.lastInsertRowid,name,'attachment_uploaded',`project_id=${req.project.id}`);
      return inserted;
    });
    res.status(201).json({ id:result.lastInsertRowid,original_name:name,encrypted:!!encIv });
    req.file=null;
  } finally {
    if (req.file?.path) await fs.promises.unlink(req.file.path).catch(error => { if (error.code!=='ENOENT') console.error('[attachments] upload cleanup failed:',error); });
  }
});

router.get('/:project_id/download/:id',requireDownloadAuth,requireProjectAccess,async (req,res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error:'Invalid attachment ID' });
  const attachment=await db.prepare('SELECT * FROM attachments WHERE id=? AND project_id=?').get(Number(req.params.id),req.project.id);
  if (!attachment) return res.status(404).json({ error:'Attachment not found' });
  const storedName=safeStoredName(attachment.stored_name);if (!storedName) return res.status(400).json({ error:'Invalid file reference' });
  const filePath=path.join(uploadDir,storedName),downloadName=safeDownloadName(attachment.original_name);
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if (attachment.enc_iv && attachment.enc_tag) {
    try {
      const plaintext=cipher.decrypt(await fs.promises.readFile(filePath),attachment.enc_iv,attachment.enc_tag);
      res.setHeader('Content-Disposition',`attachment; filename="${downloadName}"`);res.setHeader('Content-Type',attachment.mime_type || 'application/octet-stream');res.setHeader('Content-Length',plaintext.length);
      return res.send(plaintext);
    } catch(error) { console.error('[attachments] decrypt error:',error.message);return res.status(500).json({ error:'Failed to decrypt file' }); }
  }
  res.download(filePath,downloadName);
});

router.delete('/:project_id/:id',requireAuth,requireProjectAccess,requireProjectWrite,async (req,res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error:'Invalid attachment ID' });
  const existing=await db.prepare('SELECT id,uploaded_by FROM attachments WHERE id=? AND project_id=?').get(Number(req.params.id),req.project.id);
  if (!existing) return res.status(404).json({ error:'Attachment not found' });
  if (req.user.role!=='manager' && existing.uploaded_by!==req.user.id) return res.status(403).json({ error:'Only the uploader or a manager can remove this attachment' });
  const attachment=await db.transaction(async tx => {
    const removed=(await tx.prepare('DELETE FROM attachments WHERE id=? AND project_id=? RETURNING *').all(existing.id,req.project.id))[0];
    if (removed) await logAudit(tx,req,'attachment',removed.id,removed.original_name,'attachment_deleted',`project_id=${req.project.id}`);
    return removed;
  });
  if (!attachment) return res.status(404).json({ error:'Attachment not found' });
  const storedName=safeStoredName(attachment.stored_name);
  if (storedName) await fs.promises.unlink(path.join(uploadDir,storedName)).catch(error => { if (error.code!=='ENOENT') console.error('[attachments] cleanup failed:',error); });
  res.json({ ok:true });
});

router._safeStoredName = safeStoredName;
router._safeDownloadName = safeDownloadName;
router._hasAllowedMagic = hasAllowedMagic;

module.exports = router;
