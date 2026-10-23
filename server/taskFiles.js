/**
 * Files attached to a task: the same upload checks (type, content signature, 20 MB)
 * and at-rest encryption as project and activity files (uploadUtils.js, cipher.js).
 * Who may do what is decided by the routes (routes/tasks.js).
 */
const path = require('path');
const fs = require('fs');
const db = require('./db');
const cipher = require('./cipher');
const { logAudit } = require('./auditLog');
const { uploadDir, upload, safeStoredName, safeDownloadName, hasAllowedMagic } = require('./uploadUtils');

const list = taskId => db.prepare(`SELECT a.id, a.original_name, a.mime_type, a.size, a.uploaded_by, a.created_at, u.name AS uploaded_by_name
  FROM attachments a JOIN users u ON u.id = a.uploaded_by WHERE a.task_id = ? ORDER BY a.created_at DESC, a.id DESC`).all(taskId);

/** Stores the uploaded file ("file" field); answers errors itself and returns null, else the new file. */
async function add(req, res, task) {
  try { await new Promise((resolve, reject) => upload.single('file')(req, res, error => error ? reject(error) : resolve())); }
  catch (error) { res.status(400).json({ error: error.message }); return null; }
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return null; }
  try {
    if (!hasAllowedMagic(req.file.path, req.file.mimetype)) { res.status(400).json({ error: 'Uploaded file content does not match the declared file type' }); return null; }
    let encIv = null, encTag = null;
    if (cipher.isConfigured()) {
      const encrypted = cipher.encrypt(await fs.promises.readFile(req.file.path));
      await fs.promises.writeFile(req.file.path, encrypted.data); encIv = encrypted.iv; encTag = encrypted.tag;
    }
    const name = safeDownloadName(req.file.originalname);
    const inserted = await db.transaction(async tx => {
      const row = await tx.prepare('INSERT INTO attachments (task_id, original_name, stored_name, mime_type, size, uploaded_by, enc_iv, enc_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(task.id, name, req.file.filename, req.file.mimetype, req.file.size, req.user.id, encIv, encTag);
      await logAudit(tx, req, 'attachment', row.lastInsertRowid, name, 'attachment_uploaded', `task_id=${task.id}`);
      return row;
    });
    req.file = null;   // kept
    return { id: inserted.lastInsertRowid, original_name: name, encrypted: !!encIv };
  } finally {
    if (req.file?.path) await fs.promises.unlink(req.file.path).catch(error => { if (error.code !== 'ENOENT') console.error('[task files] upload cleanup failed:', error); });
  }
}

async function send(res, taskId, attachmentId) {
  const file = await db.prepare('SELECT * FROM attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const storedName = safeStoredName(file.stored_name);
  if (!storedName) return res.status(400).json({ error: 'Invalid file reference' });
  const filePath = path.join(uploadDir, storedName), downloadName = safeDownloadName(file.original_name);
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (file.enc_iv && file.enc_tag) {
    try {
      const plaintext = cipher.decrypt(await fs.promises.readFile(filePath), file.enc_iv, file.enc_tag);
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream'); res.setHeader('Content-Length', plaintext.length);
      return res.send(plaintext);
    } catch (error) { console.error('[task files] decrypt error:', error.message); return res.status(500).json({ error: 'Failed to decrypt file' }); }
  }
  return res.download(filePath, downloadName);
}

async function remove(req, task, attachmentId) {
  const file = await db.prepare('SELECT * FROM attachments WHERE id = ? AND task_id = ?').get(attachmentId, task.id);
  if (!file) return { status: 404, error: 'File not found' };
  if (req.user.role !== 'manager' && Number(file.uploaded_by) !== Number(req.user.id)) return { status: 403, error: 'Only whoever added the file or a manager can remove it' };
  await db.transaction(async tx => {
    await tx.prepare('DELETE FROM attachments WHERE id = ?').run(file.id);
    await logAudit(tx, req, 'attachment', file.id, file.original_name, 'attachment_deleted', `task_id=${task.id}`);
  });
  await removeStored([file.stored_name]);
  return {};
}

/** The stored file names of tasks' files (read before the tasks are deleted; the rows cascade). */
async function storedFiles(taskIds) {
  const ids = taskIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0);
  if (!ids.length) return [];
  return (await db.prepare(`SELECT stored_name FROM attachments WHERE task_id IN (${ids.map(() => '?').join(',')})`).all(...ids)).map(row => row.stored_name);
}

async function removeStored(names) {
  for (const name of names) {
    const safe = safeStoredName(name);
    if (safe) await fs.promises.unlink(path.join(uploadDir, safe)).catch(error => { if (error.code !== 'ENOENT') console.error('[task files] cleanup failed:', error); });
  }
}

module.exports = { list, add, send, remove, storedFiles, removeStored };
