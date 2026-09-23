const fs=require('node:fs');
const path=require('node:path');
const ExcelJS=require('exceljs');
const cipher=require('./cipher');
const db=require('./db');
const execution=require('./reportExecution');
const { dbTimestamp }=require('./backgroundJobs');

const exportRoot=path.resolve(__dirname,'uploads','exports');

async function generate(payload,job) {
  if (!cipher.isConfigured()) throw Object.assign(new Error('Encrypted export storage is unavailable'),{ permanent:true });
  if (!['csv','xlsx'].includes(payload.format)) throw Object.assign(new Error('Unsupported export format'),{ permanent:true });
  const owner=await db.prepare("SELECT id FROM users WHERE id=? AND role='manager' AND active=1 AND must_change_password=0").get(job.created_by);
  if (!owner) throw Object.assign(new Error('Export owner no longer has permission to run management reports'),{ permanent:true });
  const result=await execution.run(payload.definition,5000);
  if (result.truncated) throw Object.assign(new Error('Report exceeds 5000 rows; narrow the filters'),{ permanent:true });
  let raw,type,name;
  if (payload.format==='csv') {
    raw=Buffer.from(execution.csv(result),'utf8');type='text/csv; charset=utf-8';name='custom-report.csv';
  } else {
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Report');
    sheet.addRow(result.columns.map(column => column.label));
    for (const row of result.rows) sheet.addRow(result.columns.map(column => row[column.key] ?? ''));
    raw=Buffer.from(await workbook.xlsx.writeBuffer());type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';name='custom-report.xlsx';
  }
  const encrypted=cipher.encrypt(raw),file=`job-${job.id}.bin`;
  await fs.promises.mkdir(exportRoot,{ recursive:true });
  await fs.promises.writeFile(path.join(exportRoot,file),encrypted.data,{ mode:0o600 });
  return { rows:result.rows.length,artifact:{ name,path:file,type,iv:encrypted.iv,tag:encrypted.tag,expires_at:dbTimestamp(Date.now()+24*60*60_000) } };
}

module.exports={ generate,exportRoot };
