const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const db     = require('../db');
const { requireAuth, requireDownloadAuth } = require('../middleware/auth');
const cipher = require('../cipher');
const { logAudit } = require('../auditLog');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
]);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
    cb(null, `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${safeExt}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type "${file.mimetype}" is not allowed. Accepted: images, PDF, Word, Excel, text, CSV, ZIP.`));
    }
  },
});

function safeStoredName(storedName) {
  const safeName = path.basename(String(storedName || ''));
  return safeName && safeName === storedName ? safeName : null;
}

function safeDownloadName(originalName) {
  return path.basename(String(originalName || 'download'))
    .replace(/[^\w .\-()]/g, '_')
    .trim() || 'download';
}

function hasAllowedMagic(filePath, mimeType) {
  let b;
  try { b = fs.readFileSync(filePath); } catch { return false; }
  if (!b.length) return false;

  if (mimeType === 'image/jpeg') return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mimeType === 'image/png') return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
  if (mimeType === 'image/gif') return b.length >= 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a');
  if (mimeType === 'image/webp') return b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'application/pdf') return b.length >= 5 && b.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'application/msword' || mimeType === 'application/vnd.ms-excel') {
    return b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1;
  }
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-zip-compressed' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && [0x03, 0x05, 0x07].includes(b[2]) && [0x04, 0x06, 0x08].includes(b[3]);
  }
  if (mimeType === 'text/plain' || mimeType === 'text/csv') {
    return !b.includes(0x00) && b.subarray(0, Math.min(b.length, 4096)).toString('utf8').length > 0;
  }
  return false;
}

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
