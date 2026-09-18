const { validDate } = require('./workloadModel');
const field = (sql,type,label) => ({ sql,type,label });
const common = { id: field('r.id','id','ID'),title: field('r.title','text','Title'),status: field('r.status','text','Status'),created_at: field('r.created_at','text','Created at'),created_date: field('substr(r.created_at,1,10)','date','Created date (UTC)') };
const SOURCES = {
  projects: { label: 'Projects',grain: 'One row per project',from: 'projects r',fields: { ...common,customer_id: field('r.customer_id','id','Customer ID'),deadline: field('r.deadline','date','Deadline') } },
  tasks: { label: 'Tasks',grain: 'One row per task; customer comes from its project',from: 'tasks r LEFT JOIN projects p ON p.id=r.project_id',fields: { ...common,project_id: field('r.project_id','id','Project ID'),customer_id: field('p.customer_id','id','Customer ID'),engineer_id: field('r.assigned_to','id','Assigned engineer ID'),priority: field('r.priority','text','Priority'),deadline: field('r.deadline','date','Deadline'),is_adhoc: field('r.is_adhoc','number','Ad-hoc flag') } },
  visits: { label: 'Maintenance visits',grain: 'One row per visit, including multi-engineer visits once',from: 'maintenance_visits r',fields: { ...common,customer_id: field('r.customer_id','id','Customer ID'),scheduled_date: field('r.scheduled_date','date','Scheduled date'),report_sent: field('r.report_sent','number','Report submitted'),report_forwarded: field('r.report_sent_to_customer','number','Report forwarded') } },
  activities: { label: 'Service activities',grain: 'One row per service activity',from: 'service_activities r',fields: { ...common,reference: field('r.activity_reference','text','Reference'),customer_id: field('r.customer_id','id','Customer ID'),engineer_id: field('r.engineer_id','id','Engineer ID'),team_id: field('r.team_id','id','Team ID'),activity_date: field('r.activity_date','date','Activity date'),duration_minutes: field('r.duration_minutes','number','Duration minutes'),classification: field('r.billable_classification','text','Billable classification') } },
  recommendations: { label: 'Customer recommendations',grain: 'One row per recommendation',from: 'customer_recommendations r',fields: { id: common.id,status: common.status,created_at: common.created_at,created_date: common.created_date,customer_id: field('r.customer_id','id','Customer ID'),owner_id: field('r.owner_id','id','Owner ID'),risk_level: field('r.risk_level','text','Risk level'),due_date: field('r.due_date','date','Due date'),project_id: field('r.related_project_id','id','Converted project ID') } },
};
const OPERATORS = { text: ['eq','neq','contains','in','not_in','is_null','is_not_null'],id: ['eq','neq','in','not_in','is_null','is_not_null'],date: ['eq','neq','lt','lte','gt','gte','in','not_in','is_null','is_not_null'],number: ['eq','neq','lt','lte','gt','gte','in','not_in','is_null','is_not_null'] };
const fail = message => { throw Object.assign(new Error(message),{ status: 400 }); };
const object = value => value && typeof value==='object' && !Array.isArray(value);
function shape(value,keys,label) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(`Invalid ${label}`);
}
function array(value,max,label) {
  if (!Array.isArray(value) || value.length>max) fail(`${label} must be an array of at most ${max} entries`);
  return value;
}
function metadata() {
  return Object.entries(SOURCES).map(([key,source]) => ({ key,label: source.label,grain: source.grain,fields: Object.entries(source.fields).map(([name,value]) => ({ key: name,type: value.type,label: value.label,operators: OPERATORS[value.type],aggregations: value.type==='number' ? ['count','sum','avg','min','max'] : ['count'] })) }));
}
function compileReport(definition,limit) {
  shape(definition,['source','fields','filters','group_by','aggregations','sort'],'report definition');
  if (typeof definition.source!=='string' || !Object.hasOwn(SOURCES,definition.source)) fail('Unknown report source');
  const source = SOURCES[definition.source];
  const get = key => {
    if (typeof key!=='string' || !Object.hasOwn(source.fields,key)) fail('Unknown report field');
    return source.fields[key];
  };
  const fields = array(definition.fields ?? [],12,'Fields');
  const groups = array(definition.group_by ?? [],4,'Groups');
  if (new Set(fields).size!==fields.length || new Set(groups).size!==groups.length) fail('Duplicate report fields');
  fields.forEach(get); groups.forEach(get);
  const metrics = array(definition.aggregations ?? [],6,'Aggregations');
  const grouped = groups.length>0 || metrics.length>0;
  if (grouped && (fields.length!==groups.length || fields.some(key => !groups.includes(key)))) fail('Grouped fields must match group_by');
  if (!grouped && !fields.length) fail('Choose at least one field');
  const columns = (grouped ? groups : fields).map(key => ({ key,label: get(key).label,sql: get(key).sql }));
  metrics.forEach((metric,index) => {
    shape(metric,['field','operation'],'aggregation');
    if (metric.field==='*' && metric.operation==='count') columns.push({ key: `metric_${index}`,label: 'Record count',sql: 'COUNT(*)' });
    else {
      const value = get(metric.field);
      if (!['count','sum','avg','min','max'].includes(metric.operation) || metric.operation!=='count' && value.type!=='number') fail('Unsupported aggregation');
      columns.push({ key: `metric_${index}`,label: `${metric.operation.toUpperCase()} ${value.label}`,sql: `${metric.operation.toUpperCase()}(${value.sql})` });
    }
  });
  if (!columns.length || columns.length>12) fail('Choose between 1 and 12 output columns');
  const params = [],clauses = [];
  const scalar = (value,type) => {
    const valid = type==='date' ? validDate(value) : type==='number' ? typeof value==='number' && Number.isFinite(value) : type==='id' ? Number.isSafeInteger(value) && value>0 : typeof value==='string' && value.length<=5000;
    if (!valid) fail('Filter value does not match its field type');
    return value;
  };
  array(definition.filters ?? [],12,'Filters').forEach(filter => {
    shape(filter,['field','operator','value'],'filter');
    const value = get(filter.field);
    if (!OPERATORS[value.type].includes(filter.operator)) fail('Unsupported filter operator');
    if (['is_null','is_not_null'].includes(filter.operator)) {
      if (filter.value!==undefined) fail('Null operators do not accept values');
      clauses.push(`${value.sql} IS ${filter.operator==='is_not_null' ? 'NOT ' : ''}NULL`);
    } else if (['in','not_in'].includes(filter.operator)) {
      const entries = array(filter.value,50,'IN values');
      if (!entries.length) fail('IN requires values');
      entries.forEach(entry => params.push(scalar(entry,value.type)));
      clauses.push(`${value.sql} ${filter.operator==='not_in' ? 'NOT IN' : 'IN'} (${entries.map(() => '?').join(',')})`);
    } else {
      const entry = scalar(filter.value,value.type);
      if (filter.operator==='contains') {
        params.push(`%${entry.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`);
        clauses.push(`LOWER(${value.sql}) LIKE ?`);
      } else {
        params.push(entry);
        const operator = { eq: '=',neq: '<>',lt: '<',lte: '<=',gt: '>',gte: '>=' }[filter.operator];
        clauses.push(`${value.sql}${operator}?`);
      }
    }
  });
  const sorts = array(definition.sort ?? [],3,'Sorts').map(sort => {
    shape(sort,['field','direction'],'sort');
    if (!['asc','desc'].includes(sort.direction)) fail('Invalid sort direction');
    const selected = columns.find(column => column.key===sort.field);
    const sql = grouped ? selected?.sql : get(sort.field).sql;
    if (!sql) fail('Grouped sorts must refer to an output column');
    return `${sql} ${sort.direction.toUpperCase()} NULLS LAST`;
  });
  const stable = grouped ? groups.map(key => `${get(key).sql} ASC NULLS LAST`) : ['r.id ASC'];
  const order = [...sorts,...stable];
  const sql = `SELECT ${columns.map(column => `${column.sql} AS "${column.key}"`).join(',')} FROM ${source.from}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}${groups.length ? ` GROUP BY ${groups.map(key => get(key).sql).join(',')}` : ''}${order.length ? ` ORDER BY ${order.join(',')}` : ''} LIMIT ?`;
  return { sql,params: [...params,limit+1],columns: columns.map(({ key,label }) => ({ key,label })) };
}
function csvCell(value) {
  if (value==null) return '""';
  let text = String(value);
  if (typeof value==='string' && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}
module.exports = { metadata,compileReport,csvCell };
