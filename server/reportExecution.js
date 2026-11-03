const db = require('./db');
const { compileReport,csvCell } = require('./customReports');
const { decrypt } = require('./fieldCipher');

// Where each lookup type's names live; customer names are stored encrypted.
const NAMES = {
  customer: { sql: 'SELECT id,name FROM customers WHERE id IN',name: row => decrypt(row.name) },
  user: { sql: 'SELECT id,name FROM users WHERE id IN',name: row => row.name },
  team: { sql: 'SELECT id,name FROM teams WHERE id IN',name: row => row.name },
  project: { sql: 'SELECT id,title AS name FROM projects WHERE id IN',name: row => row.name },
  category: { sql: 'SELECT id,name FROM activity_categories WHERE id IN',name: row => row.name },
};

async function names(tx,columns,rows) {
  for (const column of columns.filter(entry => entry.lookup)) {
    const ids = [...new Set(rows.map(row => row[column.key]).filter(value => value!==null && value!==undefined))].map(Number);
    const found = new Map();
    for (let index=0;index<ids.length;index+=500) {
      const chunk = ids.slice(index,index+500);
      const lookup = NAMES[column.lookup];
      for (const row of await tx.prepare(`${lookup.sql} (${chunk.map(() => '?').join(',')})`).all(...chunk)) found.set(Number(row.id),lookup.name(row));
    }
    for (const row of rows) if (row[column.key]!==null && row[column.key]!==undefined) row[column.key] = found.get(Number(row[column.key])) ?? `#${row[column.key]}`;
  }
  for (const column of columns.filter(entry => entry.encrypted)) for (const row of rows) row[column.key] = decrypt(row[column.key]);
}

const compare = (a,b) => {
  if (a===b) return 0;
  if (a===null || a===undefined || a==='') return 1;
  if (b===null || b===undefined || b==='') return -1;
  if (typeof a==='number' && typeof b==='number') return a-b;
  return String(a).localeCompare(String(b),undefined,{ numeric: true,sensitivity: 'base' });
};

/** What `user` may get from reports (null: everything, for managers and system runs). */
async function scopeFor(user) {
  if (!user || user.role==='manager') return null;
  const { accessibleCustomerIds } = require('./customerAccess');
  const { hasPermission } = require('./permissions');
  return { customerIds: await accessibleCustomerIds(user), permissions: new Set(await hasPermission(user,'assets.access') ? ['assets.access'] : []) };
}

async function run(definition,limit,{ user } = {}) {
  const compiled = compileReport(definition,limit,new Date(),await scopeFor(user));
  const rows = await db.transaction(async tx => {
    await tx.exec("SET LOCAL statement_timeout = '5s'; SET LOCAL TRANSACTION READ ONLY;");
    const found = await tx.prepare(compiled.sql).all(...compiled.params);
    await names(tx,compiled.columns,found);
    return found;
  });
  if (compiled.postSort.length) rows.sort((a,b) => {
    for (const sort of compiled.postSort) { const order = compare(a[sort.field],b[sort.field]) * (sort.direction==='desc' ? -1 : 1); if (order) return order; }
    return 0;
  });
  return { columns: compiled.columns.map(({ key,label }) => ({ key,label })),rows: rows.slice(0,limit),truncated: rows.length>limit,limit };
}
function csv(result) {
  return '﻿'+[result.columns.map(column => csvCell(column.label)).join(','),...result.rows.map(row => result.columns.map(column => csvCell(row[column.key])).join(','))].join('\r\n');
}

/** A report result as a landscape PDF table. */
function pdf(result,title = 'Custom report') {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve,reject) => {
    const doc = new PDFDocument({ size: 'A4',layout: 'landscape',margin: 36,bufferPages: true,info: { Title: title } });
    const chunks = []; doc.on('data',chunk => chunks.push(chunk)); doc.on('error',reject); doc.on('end',() => resolve(Buffer.concat(chunks)));
    const left = doc.page.margins.left,width = doc.page.width-left-doc.page.margins.right,padding = 3;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#1e3a8a').text(title).moveDown(.2);
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`${result.rows.length} row${result.rows.length===1 ? '' : 's'} · generated ${new Date().toISOString().slice(0,16).replace('T',' ')} UTC`).moveDown(.6);
    // Wider columns for longer content, measured on the header and the first rows.
    const weights = result.columns.map(column => Math.min(40,Math.max(6,column.label.length,...result.rows.slice(0,50).map(row => String(row[column.key] ?? '').length))));
    const total = weights.reduce((sum,weight) => sum+weight,0),widths = weights.map(weight => width*weight/total);
    const text = value => (value===null || value===undefined || value==='' ? '—' : String(value));
    const drawRow = (values,header) => {
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 8 : 7);
      const height = Math.max(16,...values.map((value,index) => doc.heightOfString(text(value),{ width: widths[index]-padding*2 })+padding*2));
      if (doc.y+height>doc.page.height-doc.page.margins.bottom-14) { doc.addPage(); if (!header) drawRow(result.columns.map(column => column.label),true); }
      const y = doc.y;
      let x = left;
      values.forEach((value,index) => {
        doc.rect(x,y,widths[index],height).fillAndStroke(header ? '#e2e8f0' : '#ffffff','#cbd5e1');
        doc.fillColor('#172033').text(text(value),x+padding,y+padding,{ width: widths[index]-padding*2 });
        x += widths[index];
      });
      doc.x = left; doc.y = y+height;
    };
    drawRow(result.columns.map(column => column.label),true);
    for (const row of result.rows) drawRow(result.columns.map(column => row[column.key]),false);
    if (!result.rows.length) doc.font('Helvetica').fontSize(9).fillColor('#64748b').text('No matching records.',left,doc.y+6);
    const range = doc.bufferedPageRange();
    for (let index=0;index<range.count;index++) {
      doc.switchToPage(index); const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(`Page ${index+1} of ${range.count}`,left,doc.page.height-22,{ width,align: 'center',lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
module.exports = { run,csv,pdf,scopeFor };
