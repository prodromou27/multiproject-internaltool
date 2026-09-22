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
        (customer_id,template_id,period_start,period_end,output_format,report_version,status,workflow_status,original_name,stored_name,mime_type,size,sections,generated_by,enc_iv,enc_tag)
        VALUES (?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?) RETURNING id,report_version,workflow_version,generated_at`).get(customerId,templateId,from,to,format,counter.last_version,status,safeDownloadName(filename),storedName,FORMATS[format],buffer.length,JSON.stringify(sections),userId,encIv,encTag);
      await tx.prepare(`INSERT INTO managed_report_workflow_history
        (report_id,from_status,to_status,action,actor_id,workflow_version) VALUES (?,NULL,'draft','generated',?,?)`).run(inserted.id,userId,inserted.workflow_version);
      return inserted;
    });
  } catch(error) {
    await fs.promises.unlink(filePath).catch(cleanupError => { if (cleanupError.code!=='ENOENT') console.error('[managed-reports] archive cleanup failed:',cleanupError); });
    throw error;
  }
}

async function list(customerId) {
  return db.prepare(`SELECT h.id,h.template_id,t.name AS template_name,h.period_start,h.period_end,h.output_format,h.report_version,
    h.workflow_status AS status,h.workflow_version,h.original_name,h.mime_type,h.size,h.generated_by,u.name AS generated_by_name,h.generated_at,
    h.submitted_at,su.name AS submitted_by_name,h.reviewed_at,ru.name AS reviewed_by_name,h.finalized_at,fu.name AS finalized_by_name,h.decision_comment
    FROM managed_report_history h LEFT JOIN users u ON u.id=h.generated_by LEFT JOIN users su ON su.id=h.submitted_by
    LEFT JOIN users ru ON ru.id=h.reviewed_by LEFT JOIN users fu ON fu.id=h.finalized_by LEFT JOIN managed_report_templates t ON t.id=h.template_id
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

const TRANSITIONS=Object.freeze({
  submit:{ from:'draft',to:'in_review',event:'submitted' },
  approve:{ from:'in_review',to:'approved',event:'approved' },
  reject:{ from:'in_review',to:'draft',event:'rejected',comment:true },
  finalize:{ from:'approved',to:'final',event:'finalized' },
  reopen:{ from:'final',to:'draft',event:'reopened',comment:true },
});

function workflowInput({ action,version,comment }) {
  const transition=TRANSITIONS[action];
  if (!transition) throw Object.assign(new Error('Invalid report workflow action'),{ status:400 });
  const parsedVersion=Number(version);
  if (!Number.isSafeInteger(parsedVersion) || parsedVersion<1) throw Object.assign(new Error('A valid workflow version is required'),{ status:400 });
  if (comment!==undefined && comment!==null && typeof comment!=='string') throw Object.assign(new Error('Workflow comment must be text'),{ status:400 });
  const cleanComment=String(comment || '').trim();
  if (cleanComment.length>2000) throw Object.assign(new Error('Workflow comment must be at most 2,000 characters'),{ status:400 });
  if (transition.comment && !cleanComment) throw Object.assign(new Error('A reason is required for this action'),{ status:400 });
  return { ...transition,action,version:parsedVersion,comment:cleanComment || null };
}

async function transition(customerId,reportId,input,userId) {
  const change=workflowInput(input);
  return db.transaction(async tx => {
    const report=await tx.prepare('SELECT id,customer_id,generated_by,original_name,workflow_status,workflow_version FROM managed_report_history WHERE id=? AND customer_id=?').get(reportId,customerId);
    if (!report) throw Object.assign(new Error('Report not found'),{ status:404 });
    if (report.workflow_status!==change.from) throw Object.assign(new Error(`This report cannot be ${change.event} while it is ${report.workflow_status.replace('_',' ')}`),{ status:409 });
    const assignments=['workflow_status=?','workflow_version=workflow_version+1','status=?'];
    const values=[change.to,change.to==='final'?'final':'draft'];
    if (change.action==='submit') {
      assignments.push('submitted_by=?','submitted_at=app_now()','reviewed_by=NULL','reviewed_at=NULL','finalized_by=NULL','finalized_at=NULL','decision_comment=NULL');
      values.push(userId);
    }
    if (['approve','reject'].includes(change.action)) {
      assignments.push('reviewed_by=?','reviewed_at=app_now()','decision_comment=?');
      values.push(userId,change.comment);
    }
    if (change.action==='finalize') {
      assignments.push('finalized_by=?','finalized_at=app_now()');
      values.push(userId);
    }
    if (change.action==='reopen') {
      assignments.push('submitted_by=NULL','submitted_at=NULL','reviewed_by=NULL','reviewed_at=NULL','finalized_by=NULL','finalized_at=NULL','decision_comment=?');
      values.push(change.comment);
    }
    const updated=await tx.prepare(`UPDATE managed_report_history SET ${assignments.join(',')} WHERE id=? AND customer_id=? AND workflow_status=? AND workflow_version=?`).run(...values,reportId,customerId,change.from,change.version);
    if (updated.changes!==1) throw Object.assign(new Error('This report changed after you opened it. Reload and try again.'),{ status:409 });
    const nextVersion=change.version+1;
    await tx.prepare(`INSERT INTO managed_report_workflow_history
      (report_id,from_status,to_status,action,comment,actor_id,workflow_version) VALUES (?,?,?,?,?,?,?)`).run(reportId,change.from,change.to,change.event,change.comment,userId,nextVersion);
    return { report:{ ...report,workflow_status:change.to,workflow_version:nextVersion },change };
  });
}

async function workflowHistory(customerId,reportId) {
  const report=await get(customerId,reportId);
  if (!report) return null;
  return db.prepare(`SELECT w.id,w.from_status,w.to_status,w.action,w.comment,w.workflow_version,w.created_at,w.actor_id,u.name AS actor_name
    FROM managed_report_workflow_history w LEFT JOIN users u ON u.id=w.actor_id WHERE w.report_id=? ORDER BY w.id`).all(reportId);
}

module.exports={ FORMATS,TRANSITIONS,validateTemplate,archive,list,get,read,transition,workflowHistory };
