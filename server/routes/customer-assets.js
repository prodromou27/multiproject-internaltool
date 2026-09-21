const router = require('express').Router({ mergeParams: true });
const crypto = require('crypto');
const net = require('net');
const db = require('../db');
const { requireManager } = require('../middleware/auth');
const { encrypt,decrypt } = require('../fieldCipher');
const { logAudit } = require('../auditLog');

const COVERAGE = new Set(['managed','support','neither']);
const LIFECYCLE = new Set(['active','spare','retired','decommissioned']);
const ENVIRONMENTS = new Set(['production','test','development','dr','other']);
const CRITICALITY = new Set(['low','medium','high','critical']);
const encryptedFields = ['name','asset_tag','vendor','model','serial_number','hostname','ip_address','mac_address','software_version','location','support_provider','support_reference','management_url','notes'];
const positiveId = value => (typeof value === 'number' || typeof value === 'string') && /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const realDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0,4))>=1900 && Number(value.slice(0,4))<=9998 && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
const decryptAsset = row => {
  if (!row) return row;
  const { asset_tag_hash: _internalHash,...visible }=row;
  return Object.fromEntries(Object.entries(visible).map(([key,value]) => [key,encryptedFields.includes(key) ? decrypt(value) : value]));
};
const hashTag = value => value ? crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex') : null;

router.use(requireManager, async (req,res,next) => {
  if (['POST','PUT','DELETE'].includes(req.method) && (!req.body || typeof req.body!=='object' || Array.isArray(req.body))) return res.status(400).json({ error: 'A JSON object is required' });
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid customer ID' });
  if (!await db.prepare('SELECT id FROM customers WHERE id=?').get(Number(req.params.id))) return res.status(404).json({ error: 'Customer not found' });
  next();
});

function validate(body,existing={}) {
  const value={ ...decryptAsset(existing),...body };
  if (typeof value.name!=='string' || !value.name.trim() || value.name.trim().length>300) return { error: 'Asset name must contain 1 to 300 characters' };
  if (typeof value.asset_type!=='string' || !value.asset_type.trim() || value.asset_type.trim().length>100) return { error: 'Asset type must contain 1 to 100 characters' };
  for (const field of ['asset_tag','vendor','model','serial_number','hostname','ip_address','mac_address','software_version','location','support_provider','support_reference','management_url']) if (value[field]!=null && (typeof value[field]!=='string' || value[field].length>500)) return { error: `${field} must be text of at most 500 characters` };
  if (value.notes!=null && (typeof value.notes!=='string' || value.notes.length>10000)) return { error: 'notes must be text of at most 10000 characters' };
  if (!COVERAGE.has(value.coverage_type ?? 'neither')) return { error: 'Invalid coverage type' };
  if (!LIFECYCLE.has(value.lifecycle_status ?? 'active')) return { error: 'Invalid lifecycle status' };
  if (!ENVIRONMENTS.has(value.environment ?? 'production')) return { error: 'Invalid environment' };
  if (!CRITICALITY.has(value.criticality ?? 'medium')) return { error: 'Invalid criticality' };
  if (value.technology_id!=null && value.technology_id!=='' && !positiveId(value.technology_id)) return { error: 'Invalid technology' };
  if (value.hostname && (!/^[A-Za-z0-9.-]+$/.test(value.hostname) || value.hostname.length>253 || value.hostname.split('.').some(part => !part || part.length>63 || part.startsWith('-') || part.endsWith('-')))) return { error: 'Hostname must be a valid DNS hostname' };
  if (value.ip_address && !net.isIP(value.ip_address.trim())) return { error: 'IP address must be a valid IPv4 or IPv6 address' };
  if (value.mac_address && !/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(value.mac_address.trim())) return { error: 'MAC address must contain six hexadecimal octets' };
  if (value.management_url) { try { const url=new URL(value.management_url); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error(); } catch { return { error: 'Management URL must be an HTTP(S) URL without credentials' }; } }
  for (const field of ['support_start_date','support_end_date','warranty_expiry_date']) if (value[field]!=null && value[field]!=='' && !realDate(value[field])) return { error: `${field} must be a real YYYY-MM-DD date` };
  if (value.support_start_date && value.support_end_date && value.support_end_date<value.support_start_date) return { error: 'Support end date cannot precede its start date' };
  const clean={};
  for (const field of encryptedFields) clean[field]=typeof value[field]==='string' && value[field].trim() ? value[field].trim() : null;
  return { value: { ...clean,asset_type:value.asset_type.trim(),technology_id:value.technology_id ? Number(value.technology_id) : null,environment:value.environment ?? 'production',criticality:value.criticality ?? 'medium',lifecycle_status:value.lifecycle_status ?? 'active',coverage_type:value.coverage_type ?? 'neither',support_start_date:value.support_start_date || null,support_end_date:value.support_end_date || null,warranty_expiry_date:value.warranty_expiry_date || null } };
}
async function references(value,existing={}) {
  if (value.technology_id && value.technology_id!==existing.technology_id && !await db.prepare('SELECT id FROM technologies WHERE id=? AND active=1').get(value.technology_id)) return 'Technology must be active';
}
function stored(value) { return { ...value,...Object.fromEntries(encryptedFields.map(field => [field,encrypt(value[field])])),asset_tag_hash:hashTag(value.asset_tag) }; }
async function history(req,row,action,runner=db) {
  await runner.prepare('INSERT INTO customer_asset_history (asset_id,customer_id,user_id,action,lifecycle_status,coverage_type,version) VALUES (?,?,?,?,?,?,?)').run(action==='deleted' ? null : row.id,row.customer_id,req.user.id,action,row.lifecycle_status,row.coverage_type,row.version);
  await logAudit(runner,req,'customer_asset',row.id,'Customer asset',action,`customer_id=${row.customer_id}; coverage=${row.coverage_type}; version=${row.version}`);
}

router.get('/',async (req,res) => {
  const rawPage=req.query.page ?? '1';
  if (!positiveId(rawPage) || !Number.isSafeInteger((Number(rawPage)-1)*25)) return res.status(400).json({ error: 'Invalid page' });
  if (req.query.coverage!==undefined && (typeof req.query.coverage!=='string' || !COVERAGE.has(req.query.coverage))) return res.status(400).json({ error: 'Invalid coverage filter' });
  if (req.query.status!==undefined && (typeof req.query.status!=='string' || !LIFECYCLE.has(req.query.status))) return res.status(400).json({ error: 'Invalid status filter' });
  const customer=Number(req.params.id),page=Number(rawPage),clauses=['a.customer_id=?'],params=[customer];
  if (req.query.coverage) { clauses.push('a.coverage_type=?'); params.push(req.query.coverage); }
  if (req.query.status) { clauses.push('a.lifecycle_status=?'); params.push(req.query.status); }
  const where=clauses.join(' AND ');
  const [rows,count,technologies]=await Promise.all([
    db.prepare(`SELECT a.*,t.name AS technology_name,u.name AS updated_by_name FROM customer_assets a LEFT JOIN technologies t ON t.id=a.technology_id LEFT JOIN users u ON u.id=COALESCE(a.updated_by,a.created_by) WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`).all(...params,25,(page-1)*25),
    db.prepare(`SELECT COUNT(*) AS total FROM customer_assets a WHERE ${where}`).get(...params),
    db.prepare('SELECT id,name FROM technologies WHERE active=1 ORDER BY sort_order,name LIMIT 500').all(),
  ]);
  res.json({ rows: rows.map(decryptAsset),total:Number(count.total),page,page_size:25,technologies });
});

router.post('/',async (req,res) => {
  const input=validate(req.body); if (input.error) return res.status(400).json({ error: input.error });
  const refError=await references(input.value); if (refError) return res.status(400).json({ error: refError });
  const value=stored(input.value),customer=Number(req.params.id);
  try {
    const row=await db.transaction(async tx => {
      const created=(await tx.prepare(`INSERT INTO customer_assets (customer_id,technology_id,name,asset_tag,asset_tag_hash,asset_type,vendor,model,serial_number,hostname,ip_address,mac_address,software_version,location,environment,criticality,lifecycle_status,coverage_type,support_provider,support_reference,support_start_date,support_end_date,warranty_expiry_date,management_url,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).all(customer,value.technology_id,value.name,value.asset_tag,value.asset_tag_hash,value.asset_type,value.vendor,value.model,value.serial_number,value.hostname,value.ip_address,value.mac_address,value.software_version,value.location,value.environment,value.criticality,value.lifecycle_status,value.coverage_type,value.support_provider,value.support_reference,value.support_start_date,value.support_end_date,value.warranty_expiry_date,value.management_url,value.notes,req.user.id))[0];
      await history(req,{ ...created,name:input.value.name },'created',tx); return created;
    });
    res.status(201).json(decryptAsset(row));
  } catch (error) { if (error.code==='23505') return res.status(409).json({ error: 'This customer already has that asset tag' }); throw error; }
});

router.put('/:assetId',async (req,res) => {
  if (!positiveId(req.params.assetId) || !positiveId(req.body.version)) return res.status(400).json({ error: 'Valid asset ID and version are required' });
  const customer=Number(req.params.id),id=Number(req.params.assetId),existing=await db.prepare('SELECT * FROM customer_assets WHERE id=? AND customer_id=?').get(id,customer);
  if (!existing) return res.status(404).json({ error: 'Asset not found' });
  const input=validate(req.body,existing); if (input.error) return res.status(400).json({ error: input.error });
  const refError=await references(input.value,existing); if (refError) return res.status(400).json({ error: refError });
  const value=stored(input.value);
  try {
    const row=await db.transaction(async tx => {
      const updated=(await tx.prepare(`UPDATE customer_assets SET technology_id=?,name=?,asset_tag=?,asset_tag_hash=?,asset_type=?,vendor=?,model=?,serial_number=?,hostname=?,ip_address=?,mac_address=?,software_version=?,location=?,environment=?,criticality=?,lifecycle_status=?,coverage_type=?,support_provider=?,support_reference=?,support_start_date=?,support_end_date=?,warranty_expiry_date=?,management_url=?,notes=?,updated_by=?,updated_at=datetime('now'),version=version+1 WHERE id=? AND customer_id=? AND version=? RETURNING *`).all(value.technology_id,value.name,value.asset_tag,value.asset_tag_hash,value.asset_type,value.vendor,value.model,value.serial_number,value.hostname,value.ip_address,value.mac_address,value.software_version,value.location,value.environment,value.criticality,value.lifecycle_status,value.coverage_type,value.support_provider,value.support_reference,value.support_start_date,value.support_end_date,value.warranty_expiry_date,value.management_url,value.notes,req.user.id,id,customer,Number(req.body.version)))[0];
      if (updated) await history(req,{ ...updated,name:input.value.name },'updated',tx); return updated;
    });
    if (!row) return res.status(409).json({ error: 'This asset changed. Reload before saving.',code:'ASSET_CONFLICT' });
    res.json(decryptAsset(row));
  } catch (error) { if (error.code==='23505') return res.status(409).json({ error: 'This customer already has that asset tag' }); throw error; }
});

router.delete('/:assetId',async (req,res) => {
  if (!positiveId(req.params.assetId) || !positiveId(req.body.version)) return res.status(400).json({ error: 'Valid asset ID and version are required' });
  const row=await db.transaction(async tx => {
    const removed=(await tx.prepare('DELETE FROM customer_assets WHERE id=? AND customer_id=? AND version=? RETURNING *').all(Number(req.params.assetId),Number(req.params.id),Number(req.body.version)))[0];
    if (removed) await history(req,{ ...removed,name:decrypt(removed.name) },'deleted',tx); return removed;
  });
  if (!row) return res.status(409).json({ error: 'This asset changed or was removed. Reload before deleting.',code:'ASSET_CONFLICT' });
  res.json({ ok:true });
});

router.use((error,req,res,next) => { if (error.code==='23503') return res.status(409).json({ error: 'A linked customer, technology or user changed. Reload before saving.' }); next(error); });
module.exports=router;
