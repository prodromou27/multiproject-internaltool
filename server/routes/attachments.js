const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');
const db     = require('../db');
const { requireAuth, requireDownloadAuth } = require('../middleware/auth');
const cipher = require('../cipher');
const { logAudit } = require('../auditLog');
const { uploadDir, upload, safeStoredName, safeDownloadName, hasAllowedMagic } = require('../uploadUtils');

router.get('/:project_id', requireAuth, async (req, res) => {
  // Engineers can only see attachments for their projects
  if (req.user.role === 'engineer') {
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(req.params.project_id, req.user.id));
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = (await db.prepare('SELECT a.*, u.name as uploaded_by_name FROM attachments a JOIN users u ON a.uploaded_by = u.id WHERE a.project_id = ? ORDER BY a.created_at DESC').all(req.params.project_id));
  res.json(rows);
});

router.post('/:project_id', requireAuth, async (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    try {
      await handleUpload(req, res);
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: 'Upload failed' });
    }
  });
});

async function handleUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // Engineers can only attach to their own projects
  if (req.user.role === 'engineer') {
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(req.params.project_id, req.user.id));
    if (!assigned) {
      fs.unlink(req.file.path, () => {}); // clean up
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  if (!hasAllowedMagic(req.file.path, req.file.mimetype)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Uploaded file content does not match the declared file type' });
  }

  let encIv = null, encTag = null;

  // Encrypt the file in-place if a key is configured
  if (cipher.isConfigured()) {
    try {
      const raw = await fs.promises.readFile(req.file.path);
      const { data, iv, tag } = cipher.encrypt(raw);
      await fs.promises.writeFile(req.file.path, data);
      encIv  = iv;
      encTag = tag;
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      return res.status(500).json({ error: 'Encryption failed: ' + e.message });
    }
  }

  const result = (await db.prepare(
    'INSERT INTO attachments (project_id, original_name, stored_name, mime_type, size, uploaded_by, enc_iv, enc_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.params.project_id, safeDownloadName(req.file.originalname), req.file.filename, req.file.mimetype, req.file.size, req.user.id, encIv, encTag));
  await logAudit(db, req, 'attachment', result.lastInsertRowid, safeDownloadName(req.file.originalname), 'attachment_uploaded', `project_id=${req.params.project_id}`);
  res.json({ id: result.lastInsertRowid, original_name: safeDownloadName(req.file.originalname), encrypted: !!encIv });
}

router.get('/:project_id/download/:id', requireDownloadAuth, async (req, res) => {
  const att = (await db.prepare('SELECT * FROM attachments WHERE id = ? AND project_id = ?').get(req.params.id, req.params.project_id));
  if (!att) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'engineer') {
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(att.project_id, req.user.id));
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }
  const safeName = safeStoredName(att.stored_name);
  if (!safeName)
    return res.status(400).json({ error: 'Invalid file reference' });
  const filePath = path.join(uploadDir, safeName);
  const downloadName = safeDownloadName(att.original_name);

  // If the file was encrypted, decrypt in-memory before sending
  if (att.enc_iv && att.enc_tag) {
    try {
      const raw       = await fs.promises.readFile(filePath);
      const plaintext = cipher.decrypt(raw, att.enc_iv, att.enc_tag);
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      res.setHeader('Content-Type', att.mime_type || 'application/octet-stream');
      res.setHeader('Content-Length', plaintext.length);
      return res.send(plaintext);
    } catch (e) {
      console.error('[attachments] decrypt error:', e.message);
      return res.status(500).json({ error: 'Failed to decrypt file' });
    }
  }

  res.download(filePath, downloadName);
});

router.delete('/:project_id/:id', requireAuth, async (req, res) => {
  const att = (await db.prepare('SELECT * FROM attachments WHERE id = ? AND project_id = ?').get(req.params.id, req.params.project_id));
  if (!att) return res.status(404).json({ error: 'Not found' });
  // Only the uploader or a manager can delete
  if (req.user.role !== 'manager' && att.uploaded_by !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const safeName = safeStoredName(att.stored_name);
  if (!safeName) return res.status(400).json({ error: 'Invalid file reference' });
  const filePath = path.join(uploadDir, safeName);
  fs.unlink(filePath, () => {});
  (await db.prepare('DELETE FROM attachments WHERE id = ?').run(att.id));
  await logAudit(db, req, 'attachment', att.id, att.original_name, 'attachment_deleted', `project_id=${att.project_id}`);
  res.json({ ok: true });
});

router._safeStoredName = safeStoredName;
router._safeDownloadName = safeDownloadName;
router._hasAllowedMagic = hasAllowedMagic;

module.exports = router;
