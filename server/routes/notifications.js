const router=require('express').Router();
const db=require('../db');
const { requireAuth }=require('../middleware/auth');

const positiveInteger=(value,fallback,max) => {
  if (value===undefined) return fallback;
  if (typeof value!=='string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>max) return null;
  return Number(value);
};
const positiveId=value => typeof value==='string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

router.get('/',requireAuth,async (req,res) => {
  const page=positiveInteger(req.query.page,1,100000),pageSize=positiveInteger(req.query.page_size,30,100);
  const status=req.query.status || 'all';
  if (!page || !pageSize) return res.status(400).json({ error:'Invalid notification pagination' });
  if (!['all','unread','action_required'].includes(status)) return res.status(400).json({ error:'Invalid notification status filter' });
  let condition='';
  if (status==='unread') condition=' AND read=0';
  if (status==='action_required') condition=" AND priority IN ('high','critical') AND acknowledged_at IS NULL";
  const rows=await db.prepare(`SELECT id,type,title,body,link,priority,read,read_at,acknowledged_at,created_at
    FROM notifications WHERE user_id=? AND dismissed_at IS NULL${condition}
    ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(req.user.id,pageSize,(page-1)*pageSize);
  const [totalRow,unreadRow,actionRow]=await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND dismissed_at IS NULL${condition}`).get(req.user.id),
    db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND dismissed_at IS NULL AND read=0').get(req.user.id),
    db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND dismissed_at IS NULL AND priority IN ('high','critical') AND acknowledged_at IS NULL").get(req.user.id),
  ]);
  const total=Number(totalRow.count);
  res.json({ notifications:rows,unread:Number(unreadRow.count),action_required:Number(actionRow.count),page,page_size:pageSize,total,pages:Math.ceil(total/pageSize) });
});

router.post('/read-all',requireAuth,async (req,res) => {
  await db.prepare('UPDATE notifications SET read=1,read_at=COALESCE(read_at,app_now()) WHERE user_id=? AND dismissed_at IS NULL AND read=0').run(req.user.id);
  res.json({ ok:true });
});

router.patch('/:id/read',requireAuth,async (req,res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error:'Invalid notification ID' });
  const result=await db.prepare('UPDATE notifications SET read=1,read_at=COALESCE(read_at,app_now()) WHERE id=? AND user_id=? AND dismissed_at IS NULL').run(Number(req.params.id),req.user.id);
  if (result.changes!==1) return res.status(404).json({ error:'Notification not found' });
  res.json({ ok:true });
});

router.patch('/:id/acknowledge',requireAuth,async (req,res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error:'Invalid notification ID' });
  const result=await db.prepare(`UPDATE notifications SET read=1,read_at=COALESCE(read_at,app_now()),acknowledged_at=COALESCE(acknowledged_at,app_now())
    WHERE id=? AND user_id=? AND dismissed_at IS NULL AND priority IN ('high','critical')`).run(Number(req.params.id),req.user.id);
  if (result.changes!==1) return res.status(404).json({ error:'Action-required notification not found' });
  res.json({ ok:true });
});

router.delete('/:id',requireAuth,async (req,res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error:'Invalid notification ID' });
  const result=await db.prepare('UPDATE notifications SET dismissed_at=app_now() WHERE id=? AND user_id=? AND dismissed_at IS NULL').run(Number(req.params.id),req.user.id);
  if (result.changes!==1) return res.status(404).json({ error:'Notification not found' });
  res.json({ ok:true });
});

router.delete('/',requireAuth,async (req,res) => {
  await db.prepare('UPDATE notifications SET dismissed_at=app_now() WHERE user_id=? AND dismissed_at IS NULL').run(req.user.id);
  res.json({ ok:true });
});

module.exports=router;
