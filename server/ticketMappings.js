const db=require('./db');

const KEY='ticket_mapping_config';
const NORMALIZED_STATUSES=new Set(['New','Open','In Progress','Pending','Resolved','Closed','Rejected','Excluded']);
const STATUS_GROUPS=new Set(['open','closed']);
const PRIORITIES=new Set(['Low','Normal','High','Critical']);
const DEFAULTS={
  statuses:[
    { external:'new',normalized:'New',group:'open' },{ external:'open',normalized:'Open',group:'open' },
    { external:'in progress',normalized:'In Progress',group:'open' },{ external:'in_progress',normalized:'In Progress',group:'open' },
    { external:'stalled',normalized:'Pending',group:'open' },
    { external:'pending',normalized:'Pending',group:'open' },{ external:'resolved',normalized:'Resolved',group:'closed' },
    { external:'closed',normalized:'Closed',group:'closed' },{ external:'rejected',normalized:'Rejected',group:'closed' },
    { external:'deleted',normalized:'Excluded',group:'closed' },
  ],
  priorities:[
    { external:'low',normalized:'Low' },{ external:'normal',normalized:'Normal' },{ external:'high',normalized:'High' },
    { external:'critical',normalized:'Critical' },{ external:'urgent',normalized:'Critical' },
  ],
};
const fail=message => { throw Object.assign(new Error(message),{ status:400 }); };

function validate(config) {
  if (!config || typeof config!=='object' || Array.isArray(config) || !Array.isArray(config.statuses) || !Array.isArray(config.priorities)) fail('Invalid ticket mapping configuration');
  if (config.statuses.length>100 || config.priorities.length>100) fail('Ticket mappings cannot exceed 100 entries per type');
  const statusSeen=new Set(),prioritySeen=new Set();
  const statuses=config.statuses.map(item => {
    const external=typeof item?.external==='string' ? item.external.trim() : '';
    if (!external || external.length>200 || !NORMALIZED_STATUSES.has(item.normalized) || !STATUS_GROUPS.has(item.group)) fail('Each status mapping needs a valid external value, normalized status, and status group');
    const key=external.toLowerCase();if (statusSeen.has(key)) fail(`Duplicate status mapping: ${external}`);statusSeen.add(key);
    return { external,normalized:item.normalized,group:item.group };
  });
  const priorities=config.priorities.map(item => {
    const external=typeof item?.external==='string' ? item.external.trim() : '';
    if (!external || external.length>200 || !PRIORITIES.has(item.normalized)) fail('Each priority mapping needs a valid external value and normalized priority');
    const key=external.toLowerCase();if (prioritySeen.has(key)) fail(`Duplicate priority mapping: ${external}`);prioritySeen.add(key);
    return { external,normalized:item.normalized };
  });
  return { statuses,priorities };
}

async function loadMappings(store=db) {
  const row=await store.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
  if (!row) return structuredClone(DEFAULTS);
  try { return validate(JSON.parse(row.value)); } catch { return structuredClone(DEFAULTS); }
}

async function saveMappings(config,store=db) {
  const valid=validate(config);
  await store.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value').run(KEY,JSON.stringify(valid));
  return valid;
}

module.exports={ DEFAULTS,NORMALIZED_STATUSES,STATUS_GROUPS,PRIORITIES,validate,loadMappings,saveMappings };
