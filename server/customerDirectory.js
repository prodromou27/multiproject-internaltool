const SEARCH_FIELDS=Object.freeze(['name','contact_name','contact_email','address','location','customer_code']);
const VIEWS=new Set(['all','active','inactive','tracked']);

function parseCustomerListQuery(query={}) {
  if (query.paged===undefined) return { paged:false };
  if (query.paged!=='1' || Object.values(query).some(value => typeof value!=='string'))
    return { error:'Invalid customer list parameters' };
  const page=Number(query.page || 1),pageSize=Number(query.page_size || 25);
  const search=(query.search || '').trim().toLowerCase(),view=query.view || 'all';
  if (!Number.isSafeInteger(page) || page<1 || page>10_000 ||
      !Number.isSafeInteger(pageSize) || pageSize<1 || pageSize>100 ||
      search.length>200 || !VIEWS.has(view))
    return { error:'Invalid customer filters or pagination' };
  return { paged:true,page,pageSize,search,view };
}

function includesCustomerSearch(row,search) {
  return SEARCH_FIELDS.some(field => String(row[field] || '').toLowerCase().includes(search));
}

function customerListPage(rows,options) {
  const searched=options.search ? rows.filter(row => includesCustomerSearch(row,options.search)) : rows;
  const counts={
    all:searched.length,
    active:searched.filter(row => !!row.active).length,
    inactive:searched.filter(row => !row.active).length,
    tracked:searched.filter(row => !!row.service_activity_enabled).length,
  };
  const filtered=options.view==='active' ? searched.filter(row => !!row.active)
    : options.view==='inactive' ? searched.filter(row => !row.active)
    : options.view==='tracked' ? searched.filter(row => !!row.service_activity_enabled)
    : searched;
  const offset=(options.page-1)*options.pageSize;
  return { rows:filtered.slice(offset,offset+options.pageSize),total:filtered.length,
    page:options.page,page_size:options.pageSize,counts };
}

module.exports={ SEARCH_FIELDS,parseCustomerListQuery,includesCustomerSearch,customerListPage };
