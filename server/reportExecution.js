const db = require('./db');
const { compileReport,csvCell } = require('./customReports');
async function run(definition,limit) {
  const compiled = compileReport(definition,limit);
  const rows = await db.transaction(async tx => {
    await tx.exec("SET LOCAL statement_timeout = '5s'; SET LOCAL TRANSACTION READ ONLY;");
    return tx.prepare(compiled.sql).all(...compiled.params);
  });
  return { columns: compiled.columns,rows: rows.slice(0,limit),truncated: rows.length>limit,limit };
}
function csv(result) {
  return '\uFEFF'+[result.columns.map(column => csvCell(column.label)).join(','),...result.rows.map(row => result.columns.map(column => csvCell(row[column.key])).join(','))].join('\r\n');
}
module.exports = { run,csv };
