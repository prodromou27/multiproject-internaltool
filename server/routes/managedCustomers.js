const router=require('express').Router();
const { requireManager }=require('../middleware/auth');
const service=require('../managedCustomerService');
const reporting=require('../managedCustomerReportingService');

router.use(requireManager);
const validCalendarDay=value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const positiveInteger=(value,fallback,max) => {
  if (value===undefined) return fallback;
  if (typeof value!=='string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>max) return null;
  return Number(value);
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

module.exports=router;
