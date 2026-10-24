/**
 * Checks that a backup is plain SQL as pg_dump writes it, before psql runs it.
 *
 * The scan is statement by statement (a statement may span lines), and only the
 * kinds of statement pg_dump writes are accepted: SET, the set_config/setval
 * SELECTs, CREATE/ALTER/DROP/COMMENT of schema objects, object GRANT/REVOKE,
 * INSERT, and COPY … FROM stdin with its data. Anything else is refused, among
 * them: DO blocks and other queries, COPY to or from a server file or a program,
 * ALTER SYSTEM, roles (SET ROLE, SESSION AUTHORIZATION, CREATE ROLE, GRANT of a
 * role), languages other than sql and plpgsql, extensions other than pg_trgm,
 * dynamic SQL or COPY inside function bodies, and server file, large-object and
 * dblink functions.
 *
 * psql runs its own backslash commands as well as SQL — \! (a shell command),
 * \connect (another database), \copy … program, \o |cmd — anywhere outside a
 * quoted string. pg_dump only ever writes \. (the end of a COPY data block)
 * and \restrict / \unrestrict lines. So outside COPY data, a backslash in
 * plain SQL text means the file was not made by pg_dump: it is refused.
 *
 * The scanner follows SQL quoting: '…' (with '' and, for E'…', \' escapes),
 * "…" identifiers, $tag$…$tag$ bodies, -- and /* comments.
 *
 * This narrows what an uploaded file can do; it is not a sandbox. The database
 * user the app connects as should not be a superuser (see deploy/README.md).
 */
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');

const PG_DUMP_LINE = /^\\(restrict|unrestrict) [A-Za-z0-9]+$/;
const COPY_FROM_STDIN = /^COPY\s[\s\S]*\sFROM\s+stdin$/i;
const PROGRAM = /\b(FROM|TO)\s+PROGRAM\b/i;
const MAX_STATEMENT = 1_000_000;
const STATEMENTS = /^(SET|SELECT|CREATE|ALTER|DROP|COMMENT|COPY|GRANT|REVOKE|INSERT)\b/i;
const SAFE_EXTENSIONS = new Set(['pg_trgm', 'plpgsql']);
const SAFE_LANGUAGES = new Set(['sql', 'plpgsql']);
// Functions that reach outside the database: server files, large objects, other servers.
const OUTSIDE = /\b(pg_read_file|pg_read_binary_file|pg_ls_\w*|pg_stat_file|pg_file_\w+|lo_import|lo_export|lo_from_bytea|lo_put|dblink\w*|pg_execute_server_program|pg_reload_conf|pg_terminate_backend|pg_cancel_backend|pg_promote|pg_rotate_logfile)\b/i;
// GRANT/REVOKE of an object privilege names the object kind right after ON, as pg_dump always writes it.
// A role-membership grant (what this must refuse) never has an object kind there, so this is a structural
// check, not a substring search — unlike a bare /\bON\b/ test it cannot be satisfied by a quoted identifier
// such as "ON" that merely contains the word ON.
const GRANT_OBJECT = /\bON\s+(TABLE|ALL\s+TABLES\s+IN\s+SCHEMA|SEQUENCE|ALL\s+SEQUENCES\s+IN\s+SCHEMA|SCHEMA|FUNCTION|PROCEDURE|ROUTINE|ALL\s+(FUNCTIONS|PROCEDURES|ROUTINES)\s+IN\s+SCHEMA|DATABASE|DOMAIN|FOREIGN\s+DATA\s+WRAPPER|FOREIGN\s+SERVER|LANGUAGE|LARGE\s+OBJECT|TABLESPACE|TYPE|VIEW|MATERIALIZED\s+VIEW|PARAMETER)\b/i;
// Lets a grant name a grantor other than the current user; pg_dump never writes this, and it is also the
// clause a role-membership grant can use to smuggle an arbitrary role name past a plain keyword search.
const GRANTED_BY = /\bGRANTED\s+BY\b/i;
const REFUSED = [
  [/^SET\s+(LOCAL\s+|SESSION\s+)?(ROLE|SESSION\s+AUTHORIZATION)\b/i, 'it changes the database user'],
  [/^ALTER\s+(SYSTEM|ROLE|USER|GROUP|DATABASE|SERVER|LARGE\s+OBJECT|EVENT\s+TRIGGER|SUBSCRIPTION|PUBLICATION|TABLESPACE|LANGUAGE|FOREIGN\s+DATA\s+WRAPPER|USER\s+MAPPING)\b/i, 'it changes the database server or its users'],
  [/^CREATE\s+(OR\s+REPLACE\s+)?(TRUSTED\s+)?(PROCEDURAL\s+)?LANGUAGE\b/i, 'it adds a programming language'],
  [/^CREATE\s+(ROLE|USER|GROUP|DATABASE|SERVER|EVENT\s+TRIGGER|SUBSCRIPTION|PUBLICATION|TABLESPACE|FOREIGN\s+DATA\s+WRAPPER|USER\s+MAPPING)\b/i, 'it changes the database server or its users'],
];

const refuse = (line, reason) => { throw Object.assign(new Error(`This backup was not made by pg_dump and cannot be used: ${reason} (line ${line})`), { status: 400 }); };

/** Checks one complete statement (strings are replaced by '?'; function bodies come separately). */
function checkStatement(text, bodies, line) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (!sql) return;
  if (PROGRAM.test(sql)) refuse(line, 'it runs a program (COPY … PROGRAM)');
  const kind = sql.match(STATEMENTS);
  if (!kind) refuse(line, `it runs a ${sql.split(/[\s(;]/)[0].toUpperCase()} statement`);
  for (const [pattern, reason] of REFUSED) if (pattern.test(sql)) refuse(line, reason);
  if (/^SELECT\b/i.test(sql) && !/^SELECT pg_catalog\.(set_config|setval) ?\(/i.test(sql)) refuse(line, 'it runs a query');
  if (/^COPY\b/i.test(sql) && !COPY_FROM_STDIN.test(sql)) refuse(line, 'it reads or writes files on the server (COPY)');
  if (/^(GRANT|REVOKE)\b/i.test(sql)) {
    if (GRANTED_BY.test(sql)) refuse(line, 'it names a grantor (GRANTED BY)');
    if (!GRANT_OBJECT.test(sql)) refuse(line, 'it grants a database role');
  }
  const extension = sql.match(/^CREATE EXTENSION (IF NOT EXISTS )?"?([\w-]+)"?/i);
  if (extension && !SAFE_EXTENSIONS.has(extension[2].toLowerCase())) refuse(line, `it adds the ${extension[2]} extension`);
  if (/^(CREATE|ALTER)\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|AGGREGATE)\b/i.test(sql)) {
    for (const [, lang] of sql.matchAll(/\bLANGUAGE "?(\w+)"?/gi)) if (!SAFE_LANGUAGES.has(lang.toLowerCase())) refuse(line, `it has a function in the ${lang} language`);
  }
  if (OUTSIDE.test(sql)) refuse(line, `it calls ${sql.match(OUTSIDE)[1]}`);
  for (const body of bodies) {
    if (PROGRAM.test(body)) refuse(line, 'it runs a program (COPY … PROGRAM)');
    if (OUTSIDE.test(body)) refuse(line, `a function calls ${body.match(OUTSIDE)[1]}`);
    if (/\b(EXECUTE|COPY)\b/i.test(body.replace(/'(?:[^']|'')*'/g, "''"))) refuse(line, 'a function runs dynamic SQL or COPY');
  }
}

/** Scans an iterable of lines; throws on anything pg_dump would not write. */
async function scanLines(lines) {
  let state = 'sql', dollarTag = '', escapes = false, inCopy = false, sawHeader = false, number = 0;
  let statement = '', body = '', bodies = [];
  const finish = () => {
    const sql = statement.replace(/\s+/g, ' ').trim();
    checkStatement(statement, bodies, number);
    statement = ''; bodies = [];
    return sql;
  };
  for await (const raw of lines) {
    number++;
    const line = String(raw).replace(/\r$/, '');
    if (number <= 40 && /PostgreSQL database dump/.test(line)) sawHeader = true;
    if (inCopy) { if (line === '\\.') inCopy = false; continue; }
    if (state === 'sql' && !statement.trim() && PG_DUMP_LINE.test(line)) continue;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i], next = line[i + 1];
      if (state === 'sql') {
        if (ch === '-' && next === '-') break; // comment to end of line
        if (ch === '/' && next === '*') { state = 'block'; i++; continue; }
        if (ch === '\\') refuse(number, 'it contains a psql command');
        if (ch === "'") { escapes = /[Ee]$/.test(line.slice(0, i)) && !/[A-Za-z0-9_][Ee]$/.test(line.slice(0, i)); state = 'string'; statement += "'?'"; continue; }
        if (ch === '"') { state = 'ident'; statement += ' '; continue; }
        if (ch === '$') {
          const tag = line.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
          if (tag && !/[A-Za-z0-9_]$/.test(line.slice(0, i))) { dollarTag = tag[0]; state = 'dollar'; body = ''; statement += ' $body$ '; i += tag[0].length - 1; continue; }
        }
        if (ch === ';') {
          // pg_dump's COPY data starts on the next line, after the statement.
          if (COPY_FROM_STDIN.test(finish())) {
            if (line.slice(i + 1).trim()) refuse(number, 'data follows COPY on the same line');
            inCopy = true;
            break;
          }
          continue;
        }
        statement += ch;
      } else if (state === 'string') {
        if (escapes && ch === '\\') { i++; continue; }
        if (ch === "'") { if (next === "'") { i++; continue; } state = 'sql'; }
      } else if (state === 'ident') {
        // Quoted names are kept (without quotes), so "pg_read_file"(…) is still seen.
        if (ch === '"') { if (next === '"') { i++; statement += '"'; continue; } state = 'sql'; statement += ' '; continue; }
        statement += ch;
      } else if (state === 'dollar') {
        if (line.startsWith(dollarTag, i)) { state = 'sql'; bodies.push(body); body = ''; i += dollarTag.length - 1; continue; }
        body += ch;
      } else if (state === 'block') {
        if (ch === '*' && next === '/') { state = 'sql'; i++; }
      }
    }
    if (state === 'sql' || state === 'ident') statement += ' ';
    if (state === 'dollar') body += '\n';
    if (statement.length + body.length > MAX_STATEMENT) refuse(number, 'a statement is too long');
  }
  if (!sawHeader) refuse(1, 'it does not start like a PostgreSQL dump');
  if (inCopy) refuse(number, 'a data block is not finished');
  if (state !== 'sql' && state !== 'block') refuse(number, 'a quoted text is not finished');
  if (statement.trim()) finish();
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
