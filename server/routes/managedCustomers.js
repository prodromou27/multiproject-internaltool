const router=require('express').Router();
const { requireManager }=require('../middleware/auth');
const service=require('../managedCustomerService');
const reporting=require('../managedCustomerReportingService');
const { renderWord }=require('../managedCustomerWordRenderer');
const { renderExcel }=require('../managedCustomerExcelRenderer');
const reportHistory=require('../managedReportHistoryService');
const db=require('../db');
const { logAudit }=require('../auditLog');

router.use(requireManager);
const validCalendarDay=value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const positiveInteger=(value,fallback,max) => {
  if (value===undefined) return fallback;
  if (typeof value!=='string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>max) return null;
  return Number(value);
};
const positiveId=value => Number.isSafeInteger(Number(value)) && Number(value)>0 && /^\d+$/.test(String(value));
const reportStatus=value => value===undefined ? 'draft' : ['draft','final'].includes(value) ? value : null;
const reportRequest=async body => {
  const { from,to,sections,narratives,template_id:templateId }=body || {};
  const status=reportStatus(body?.status);
  if (!validCalendarDay(from) || !validCalendarDay(to) || from>to) throw Object.assign(new Error('from and to must be valid dates with from on or before to'),{ status:400 });
  if (!status) throw Object.assign(new Error('Report status must be draft or final'),{ status:400 });
  return { from,to,sections,narratives,status,templateId:await reportHistory.validateTemplate(templateId) };
};

router.get('/',async (req,res) => res.json({ rows:await service.listManagedCustomers() }));
router.get('/:id/overview',async (req,res) => {
  const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid customer ID' });
  const now=new Date(),defaultFrom=`${now.toISOString().slice(0,7)}-01`,defaultTo=now.toISOString().slice(0,10);
  const from=req.query.from || defaultFrom,to=req.query.to || defaultTo;
  if (!validCalendarDay(from) || !validCalendarDay(to) || from>to) return res.status(400).json({ error:'from and to must be valid dates with from on or before to' });
  const result=await service.getOverview(id,from,to);if (!result) return res.status(404).json({ error:'Managed customer not found' });
  res.json(result);
});
router.get('/:id/tickets',async (req,res) => {
  const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid customer ID' });
  const page=positiveInteger(req.query.page,1,1000000),pageSize=positiveInteger(req.query.page_size,25,100);
  if (!page || !pageSize || !Number.isSafeInteger((page-1)*pageSize)) return res.status(400).json({ error:'Invalid pagination' });
  const strings={};
  for (const key of ['status','priority','owner','search']) {
    const value=req.query[key];
    if (value!==undefined && (typeof value!=='string' || !value.trim() || value.length>(key==='search'?200:100))) return res.status(400).json({ error:`Invalid ${key}` });
    strings[key]=value?.trim();
  }
  const from=req.query.from,to=req.query.to;
  if ((from!==undefined && !validCalendarDay(from)) || (to!==undefined && !validCalendarDay(to)) || (from && to && from>to)) return res.status(400).json({ error:'from and to must be valid dates with from on or before to' });
  const result=await service.listTickets(id,{ ...strings,from,to,page,pageSize,offset:(page-1)*pageSize });
  if (!result) return res.status(404).json({ error:'Managed customer not found' });
  res.json(result);
});
router.get('/:id/ticket-analytics',async (req,res) => {
  const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid customer ID' });
  const now=new Date(),from=req.query.from || `${now.toISOString().slice(0,7)}-01`,to=req.query.to || now.toISOString().slice(0,10);
  if (!validCalendarDay(from) || !validCalendarDay(to) || from>to) return res.status(400).json({ error:'from and to must be valid dates with from on or before to' });
  const result=await service.getTicketAnalytics(id,from,to);if (!result) return res.status(404).json({ error:'Managed customer not found' });
  res.json(result);
});
router.get('/:id/activities',async (req,res) => {
  const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid customer ID' });
  const page=positiveInteger(req.query.page,1,1000000),pageSize=positiveInteger(req.query.page_size,25,100);
  if (!page || !pageSize || !Number.isSafeInteger((page-1)*pageSize)) return res.status(400).json({ error:'Invalid pagination' });
  const from=req.query.from,to=req.query.to;
  if (!validCalendarDay(from) || !validCalendarDay(to) || from>to) return res.status(400).json({ error:'from and to must be valid dates with from on or before to' });
  const result=await service.getActivities(id,from,to,{ page,pageSize,offset:(page-1)*pageSize });if (!result) return res.status(404).json({ error:'Managed customer not found' });
  res.json(result);
});
router.get('/:id/work',async (req,res) => {
  const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid customer ID' });
  const from=req.query.from,to=req.query.to;
  if (!validCalendarDay(from) || !validCalendarDay(to) || from>to) return res.status(400).json({ error:'from and to must be valid dates with from on or before to' });
  const result=await service.getWork(id,from,to);if (!result) return res.status(404).json({ error:'Managed customer not found' });
  res.json(result);
});
router.get('/:id/service-review',async (req,res) => {
  const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid customer ID' });
  const from=req.query.from,to=req.query.to;
  if (!validCalendarDay(from) || !validCalendarDay(to) || from>to) return res.status(400).json({ error:'from and to must be valid dates with from on or before to' });
  const result=await service.getServiceReview(id,from,to);if (!result) return res.status(404).json({ error:'Managed customer not found' });
  res.json(result);
});
router.get('/:id/timeline',async (req,res) => {
  const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid customer ID' });
  const page=positiveInteger(req.query.page,1,1000000),pageSize=positiveInteger(req.query.page_size,25,100),from=req.query.from,to=req.query.to;
  if (!page || !pageSize || !Number.isSafeInteger((page-1)*pageSize)) return res.status(400).json({ error:'Invalid pagination' });
  if (!validCalendarDay(from) || !validCalendarDay(to) || from>to) return res.status(400).json({ error:'from and to must be valid dates with from on or before to' });
  const result=await service.getTimeline(id,from,to,{ page,pageSize,offset:(page-1)*pageSize });if (!result) return res.status(404).json({ error:'Managed customer not found' });
  res.json(result);
});
router.post('/:id/report-preview',async (req,res) => {
  const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid customer ID' });
  const { from,to,sections,narratives }=req.body || {};
  if (!validCalendarDay(from) || !validCalendarDay(to) || from>to) return res.status(400).json({ error:'from and to must be valid dates with from on or before to' });
  try {
    const result=await reporting.buildReportModel({ customerId:id,from,to,sections,narratives });
    if (!result) return res.status(404).json({ error:'Managed customer not found' });
    res.json(result);
  } catch(error) { res.status(error.status || 500).json({ error:error.status ? error.message : 'Could not prepare the managed customer report' }); }
});
router.post('/:id/report.docx',async (req,res) => {
  const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid customer ID' });
  try {
    const { from,to,sections,narratives,status,templateId }=await reportRequest(req.body);
    const model=await reporting.buildReportModel({ customerId:id,from,to,sections,narratives });
    if (!model) return res.status(404).json({ error:'Managed customer not found' });
    const buffer=await renderWord(model),safeName=model.customer.name.replace(/[^a-z0-9_-]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,80) || `customer_${id}`,filename=`${safeName}_${from}_${to}.docx`;
    const history=await reportHistory.archive({ customerId:id,templateId,from,to,format:'docx',status,filename,sections:model.sections,userId:req.user.id,buffer });
    await logAudit(db,req,'managed_report',history.id,filename,'managed_customer_word_report_generated',`customer_id=${id}; period=${from}:${to}; version=${history.report_version}; status=${status}; sections=${model.sections.join(',')}`);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    res.setHeader('X-Report-Id',String(history.id));res.setHeader('X-Report-Version',String(history.report_version));
    res.send(buffer);
  } catch(error) { res.status(error.status || 500).json({ error:error.status ? error.message : 'Could not generate the Word report' }); }
});
router.post('/:id/report.xlsx',async (req,res) => {
  const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid customer ID' });
  try {
    const { from,to,sections,narratives,status,templateId }=await reportRequest(req.body);
    const model=await reporting.buildReportModel({ customerId:id,from,to,sections,narratives });
    if (!model) return res.status(404).json({ error:'Managed customer not found' });
    const buffer=await renderExcel(model),safeName=model.customer.name.replace(/[^a-z0-9_-]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,80) || `customer_${id}`,filename=`${safeName}_${from}_${to}.xlsx`;
    const history=await reportHistory.archive({ customerId:id,templateId,from,to,format:'xlsx',status,filename,sections:model.sections,userId:req.user.id,buffer });
    await logAudit(db,req,'managed_report',history.id,filename,'managed_customer_excel_report_generated',`customer_id=${id}; period=${from}:${to}; version=${history.report_version}; status=${status}; sections=${model.sections.join(',')}`);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    res.setHeader('X-Report-Id',String(history.id));res.setHeader('X-Report-Version',String(history.report_version));
    res.send(buffer);
  } catch(error) { res.status(error.status || 500).json({ error:error.status ? error.message : 'Could not generate the Excel report' }); }
});

router.get('/:id/reports',async (req,res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error:'Invalid customer ID' });
  const customer=await db.prepare('SELECT customer_id FROM managed_customer_configurations WHERE customer_id=? AND managed_services_enabled=1').get(Number(req.params.id));
  if (!customer) return res.status(404).json({ error:'Managed customer not found' });
  res.json({ rows:await reportHistory.list(Number(req.params.id)) });
});

router.get('/:id/reports/:reportId/download',async (req,res) => {
  if (!positiveId(req.params.id) || !positiveId(req.params.reportId)) return res.status(400).json({ error:'Invalid report reference' });
  const report=await reportHistory.get(Number(req.params.id),Number(req.params.reportId));
  if (!report) return res.status(404).json({ error:'Report not found' });
  try {
    const buffer=await reportHistory.read(report);
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Type',report.mime_type);res.setHeader('Content-Disposition',`attachment; filename="${report.original_name}"`);res.setHeader('Content-Length',String(buffer.length));
    res.send(buffer);
  } catch(error) { console.error('[managed-reports] download failed:',error.message);res.status(error.status || 500).json({ error:'Could not download the archived report' }); }
});

module.exports=router;
