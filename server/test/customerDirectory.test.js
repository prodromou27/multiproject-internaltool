const test=require('node:test');
const assert=require('node:assert/strict');
const { parseCustomerListQuery,customerListPage }=require('../customerDirectory');

const rows=[
  { id:1,name:'Northwind Logistics',contact_email:'ops@northwind.test',active:1,service_activity_enabled:1 },
  { id:2,name:'Contoso Retail',location:'Nicosia',active:1,service_activity_enabled:0 },
  { id:3,name:'Legacy Industries',active:0,service_activity_enabled:0 },
];

test('customer directory validates paging before route/database work',() => {
  assert.deepEqual(parseCustomerListQuery({}),{ paged:false });
  assert.equal(parseCustomerListQuery({ paged:'1',page:'0' }).error,'Invalid customer filters or pagination');
  assert.equal(parseCustomerListQuery({ paged:'1',view:'unknown' }).error,'Invalid customer filters or pagination');
  assert.equal(parseCustomerListQuery({ paged:['1','2'] }).error,'Invalid customer list parameters');
  assert.deepEqual(parseCustomerListQuery({ paged:'1',page:'2',page_size:'10',search:'  NORTH  ',view:'tracked' }),
    { paged:true,page:2,pageSize:10,search:'north',view:'tracked' });
});

test('customer directory applies literal search, full-scope counts, views, and pages',() => {
  const searched=customerListPage(rows,{ page:1,pageSize:25,search:'north',view:'all' });
  assert.deepEqual(searched.rows.map(row => row.id),[1]);
  assert.deepEqual(searched.counts,{ all:1,active:1,inactive:0,tracked:1 });
  const inactive=customerListPage(rows,{ page:1,pageSize:1,search:'',view:'inactive' });
  assert.equal(inactive.total,1);assert.equal(inactive.rows[0].id,3);assert.equal(inactive.page_size,1);
});
