const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const db=require('./db');
const cipher=require('./cipher');
const { uploadDir,safeStoredName,safeDownloadName }=require('./uploadUtils');

const FORMATS={
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf:'application/pdf',
};

async function validateTemplate(templateId) {
  if (templateId===undefined || templateId===null || templateId==='') return null;
  const id=Number(templateId);
  if (!Number.isSafeInteger(id) || id<1) throw Object.assign(new Error('Invalid report template ID'),{ status:400 });
  const template=await db.prepare('SELECT id FROM managed_report_templates WHERE id=? AND active=1').get(id);
  if (!template) throw Object.assign(new Error('Active report template not found'),{ status:400 });
  return id;
}

async function archive({ customerId,templateId,from,to,format,status,filename,sections,userId,buffer }) {
  if (!FORMATS[format]) throw new Error('Unsupported report format');
  const storedName=`managed-report-${crypto.randomUUID()}`;
  const filePath=path.join(uploadDir,storedName);
  let payload=buffer,encIv=null,encTag=null;
  if (cipher.isConfigured()) { const encrypted=cipher.encrypt(buffer);payload=encrypted.data;encIv=encrypted.iv;encTag=encrypted.tag; }
  await fs.promises.writeFile(filePath,payload,{ flag:'wx' });
  try {
    return await db.transaction(async tx => {
      const counter=await tx.prepare(`INSERT INTO managed_report_version_counters (customer_id,period_start,period_end,output_format,last_version)
        VALUES (?,?,?,?,1) ON CONFLICT (customer_id,period_start,period_end,output_format)
        DO UPDATE SET last_version=managed_report_version_counters.last_version+1 RETURNING last_version`).get(customerId,from,to,format);
      const inserted=await tx.prepare(`INSERT INTO managed_report_history
        (customer_id,template_id,period_start,period_end,output_format,report_version,status,original_name,stored_name,mime_type,size,sections,generated_by,enc_iv,enc_tag)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id,report_version,generated_at`).get(customerId,templateId,from,to,format,counter.last_version,status,safeDownloadName(filename),storedName,FORMATS[format],buffer.length,JSON.stringify(sections),userId,encIv,encTag);
      return inserted;
    });
  } catch(error) {
    await fs.promises.unlink(filePath).catch(cleanupError => { if (cleanupError.code!=='ENOENT') console.error('[managed-reports] archive cleanup failed:',cleanupError); });
    throw error;
  }
}

async function list(customerId) {
  return db.prepare(`SELECT h.id,h.template_id,t.name AS template_name,h.period_start,h.period_end,h.output_format,h.report_version,h.status,
    h.original_name,h.mime_type,h.size,h.generated_by,u.name AS generated_by_name,h.generated_at
    FROM managed_report_history h LEFT JOIN users u ON u.id=h.generated_by LEFT JOIN managed_report_templates t ON t.id=h.template_id
    WHERE h.customer_id=? ORDER BY h.generated_at DESC,h.id DESC LIMIT 100`).all(customerId);
}

async function get(customerId,id) {
  return db.prepare('SELECT * FROM managed_report_history WHERE id=? AND customer_id=?').get(id,customerId);
}

async function read(report) {
  const storedName=safeStoredName(report.stored_name);
  if (!storedName) throw Object.assign(new Error('Invalid report file reference'),{ status:500 });
  const data=await fs.promises.readFile(path.join(uploadDir,storedName));
  return report.enc_iv && report.enc_tag ? cipher.decrypt(data,report.enc_iv,report.enc_tag) : data;
}

module.exports={ FORMATS,validateTemplate,archive,list,get,read };
