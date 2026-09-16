/**
 * Shared file-upload security helpers, factored out of routes/attachments.js so
 * any route accepting uploads (project attachments, service-activity attachments)
 * reuses the exact same validation — never re-implement magic-byte checking.
 */
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const uploadDir = path.join(__dirname, 'uploads');
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

module.exports = { uploadDir, ALLOWED_MIME_TYPES, upload, safeStoredName, safeDownloadName, hasAllowedMagic };
