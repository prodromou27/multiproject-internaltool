#!/usr/bin/env node
/*
 * Decrypt an off-server backup copy (teamhub-…sql.gz.enc) back into the
 * .sql.gz the app restores (Settings → Backups → Upload, or deploy/restore.sh).
 * Needs only Node.js — not the app or its database — so it works on a new server.
 *
 *   BACKUP_PASSPHRASE='…' node deploy/decrypt-backup.js teamhub-20261011-023000-scheduled.sql.gz.enc
 *   node deploy/decrypt-backup.js <file.enc> [output.sql.gz]     # asks for the passphrase
 *
 * The passphrase is the encryption passphrase set in Settings → Backups → Off-server copies.
 * Format: "THBKENC1" | salt (16) | iv (12) | AES-256-GCM ciphertext | tag (16); key = scrypt(passphrase, salt, N=2^15).
 */
const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('THBKENC1');

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise(resolve => rl.question(question, resolve));
  rl.close();
  return answer;
}

async function main() {
  const [source, target = source && source.replace(/\.enc$/, '')] = process.argv.slice(2);
  if (!source || target === source) {
    console.error('Usage: node deploy/decrypt-backup.js <teamhub-….sql.gz.enc> [output.sql.gz]');
    process.exit(2);
  }
  const passphrase = process.env.BACKUP_PASSPHRASE || await ask('Encryption passphrase: ');
  const size = fs.statSync(source).size, header = MAGIC.length + 28;
  const fd = fs.openSync(source, 'r'), head = Buffer.alloc(header), tag = Buffer.alloc(16);
  fs.readSync(fd, head, 0, header, 0); fs.readSync(fd, tag, 0, 16, size - 16); fs.closeSync(fd);
  if (size < header + 16 || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('This is not an encrypted TeamHub backup');
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16), iv = head.subarray(MAGIC.length + 16, header);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(fs.createReadStream(source, { start: header, end: size - 17 }), decipher, fs.createWriteStream(target));
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw new Error(/auth/i.test(error.message) ? 'Wrong passphrase, or the file is damaged' : error.message);
  }
  console.error(`Wrote ${target}`);
}

main().catch(error => { console.error(error.message); process.exit(1); });
