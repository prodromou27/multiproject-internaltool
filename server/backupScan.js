/**
 * Checks that a backup is plain SQL as pg_dump writes it, before psql runs it.
 *
 * psql runs its own backslash commands as well as SQL — \! (a shell command),
 * \connect (another database), \copy … program, \o |cmd — anywhere outside a
 * quoted string. pg_dump only ever writes \. (the end of a COPY data block)
 * and \restrict / \unrestrict lines. So outside COPY data, a backslash in
 * plain SQL text means the file was not made by pg_dump: it is refused.
 * COPY … PROGRAM (running a program from SQL) is refused anywhere outside data.
 *
 * The scanner follows SQL quoting: '…' (with '' and, for E'…', \' escapes),
 * "…" identifiers, $tag$…$tag$ bodies, -- and /* comments.
 */
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');

const PG_DUMP_LINE = /^\\(restrict|unrestrict) [A-Za-z0-9]+$/;
const COPY_FROM_STDIN = /^COPY\s[\s\S]*\sFROM\s+stdin;\s*$/i;
const PROGRAM = /\b(FROM|TO)\s+PROGRAM\b/i;
const refuse = (line, reason) => { throw Object.assign(new Error(`This backup was not made by pg_dump and cannot be used: ${reason} (line ${line})`), { status: 400 }); };

/** Scans an iterable of lines; throws on anything pg_dump would not write. */
async function scanLines(lines) {
  let state = 'sql', dollarTag = '', escapes = false, inCopy = false, sawHeader = false, number = 0, statement = '';
  for await (const raw of lines) {
    number++;
    const line = String(raw).replace(/\r$/, '');
    if (number <= 40 && /PostgreSQL database dump/.test(line)) sawHeader = true;
    if (inCopy) { if (line === '\\.') inCopy = false; continue; }
    if (state === 'sql' && PG_DUMP_LINE.test(line)) continue;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i], next = line[i + 1];
      if (state === 'sql') {
        if (ch === '-' && next === '-') break; // comment to end of line
        if (ch === '/' && next === '*') { state = 'block'; i++; continue; }
        if (ch === '\\') refuse(number, 'it contains a psql command');
        if (ch === "'") { escapes = /[Ee]$/.test(line.slice(0, i)) && !/[A-Za-z0-9_][Ee]$/.test(line.slice(0, i)); state = 'string'; continue; }
        if (ch === '"') { state = 'ident'; continue; }
        if (ch === '$') {
          const tag = line.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
          if (tag && !/[A-Za-z0-9_]$/.test(line.slice(0, i))) { dollarTag = tag[0]; state = 'dollar'; i += tag[0].length - 1; continue; }
        }
        statement += ch;
      } else if (state === 'string') {
        if (escapes && ch === '\\') { i++; continue; }
        if (ch === "'") { if (next === "'") { i++; continue; } state = 'sql'; }
      } else if (state === 'ident') {
        if (ch === '"') { if (next === '"') { i++; continue; } state = 'sql'; }
      } else if (state === 'dollar') {
        if (line.startsWith(dollarTag, i)) { state = 'sql'; i += dollarTag.length - 1; }
      } else if (state === 'block') {
        if (ch === '*' && next === '/') { state = 'sql'; i++; }
      }
    }
    if (PROGRAM.test(line)) refuse(number, 'it runs a program (COPY … PROGRAM)');
    statement += ' ';
    if (state === 'sql' && /;\s*$/.test(line)) {
      if (COPY_FROM_STDIN.test(statement.trim())) inCopy = true;
      statement = '';
    }
    if (statement.length > 100000) statement = statement.slice(-1000);
  }
  if (!sawHeader) refuse(1, 'it does not start like a PostgreSQL dump');
  if (inCopy) refuse(number, 'a data block is not finished');
  return { lines: number };
}

/** Scans a gzipped backup file. */
function scanFile(file) {
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  return new Promise((resolve, reject) => {
    input.on('error', () => reject(Object.assign(new Error('That file is not a gzipped backup (.sql.gz)'), { status: 400 })));
    scanLines(lines).then(resolve, reject);
  }).finally(() => { lines.close(); input.destroy(); });
}

module.exports = { scanLines, scanFile };
