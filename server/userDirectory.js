const ROLES=new Set(['all','manager','planner','pm','engineer']);

function parsePositive(value,fallback,max) {
  if (value===undefined) return fallback;
  if (typeof value!=='string' || !/^[1-9]\d*$/.test(value)) return null;
  const number=Number(value);
  return Number.isSafeInteger(number) && number<=max ? number : null;
}

function parseUserDirectoryQuery(query={}) {
  const allowed=new Set(['paged','page','page_size','search','role']);
  if (query.paged!=='1' || Object.keys(query).some(key => !allowed.has(key)) || Object.values(query).some(value => typeof value!=='string')) return { error:'Invalid user directory parameters' };
  const page=parsePositive(query.page,1,10_000),pageSize=parsePositive(query.page_size,25,100);
  const search=(query.search || '').trim(),role=query.role || 'all';
  if (!page || !pageSize || search.length>200 || !ROLES.has(role)) return { error:'Invalid user directory filters or pagination' };
  return { page,page_size:pageSize,offset:(page-1)*pageSize,search,role };
}

function escapeLike(value) { return value.replace(/[\\%_]/g,match => `\\${match}`); }

module.exports={ parseUserDirectoryQuery,escapeLike };
