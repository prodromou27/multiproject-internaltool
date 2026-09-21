// Pulls the static SQL text out of `db.prepare('...')` / `tx.prepare(`...`)` calls in
// the server source, so tests can check every statement the app can run.
const fs = require('node:fs');
const path = require('node:path');

const CALL = /\bprepare\(\s*(['"`])((?:\\[\s\S]|(?!\1)[\s\S])*?)\1\s*\)/g;

function listSourceFiles(root) {
  const skip = new Set(['node_modules', 'test', 'scripts', 'data', 'uploads']);
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { if (!skip.has(entry.name)) walk(path.join(dir, entry.name)); }
      else if (entry.name.endsWith('.js')) out.push(path.join(dir, entry.name));
    }
  })(root);
  return out;
}

// Returns { statements: [{ file, line, sql }], dynamic: n } where `dynamic` counts
// statements built with ${...} that can't be checked statically.
function extractStatements(root) {
  const statements = [];
  let dynamic = 0;
  for (const file of listSourceFiles(root)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(CALL)) {
      const sql = m[2].replace(/\\(['"`\\])/g, '$1');
      const line = text.slice(0, m.index).split('\n').length;
      if (sql.includes('${')) { dynamic++; continue; }
      if (!/^\s*(select|insert|update|delete|with)\b/i.test(sql)) continue;
      statements.push({ file: path.relative(root, file).replace(/\\/g, '/'), line, sql });
    }
  }
  return { statements, dynamic };
}

module.exports = { extractStatements };
