const router=require('express').Router();
const { requireManager }=require('../middleware/auth');
const service=require('../managedCustomerService');

router.use(requireManager);
const validCalendarDay=value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

router.get('/',async (req,res) => res.json({ rows:await service.listManagedCustomers() }));
router.get('/:id/overview',async (req,res) => {
  const id=Number(req.params.id);if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({ error:'Invalid customer ID' });
  const now=new Date(),defaultFrom=`${now.toISOString().slice(0,7)}-01`,defaultTo=now.toISOString().slice(0,10);
  const from=req.query.from || defaultFrom,to=req.query.to || defaultTo;
  if (!validCalendarDay(from) || !validCalendarDay(to) || from>to) return res.status(400).json({ error:'from and to must be valid dates with from on or before to' });
  const result=await service.getOverview(id,from,to);if (!result) return res.status(404).json({ error:'Managed customer not found' });
  res.json(result);
});

module.exports=router;
