const test=require('node:test');
const assert=require('node:assert/strict');
const { parseUserDirectoryQuery,escapeLike }=require('../userDirectory');

test('user directory accepts bounded pages and approved roles',() => {
  assert.deepEqual(parseUserDirectoryQuery({ paged:'1',page:'2',page_size:'50',search:'  Mina  ',role:'engineer' }),
    { page:2,page_size:50,offset:50,search:'Mina',role:'engineer' });
});

test('user directory rejects repeated, malformed and unbounded values',() => {
  for (const query of [
    {},{ paged:'1',page:['1','2'] },{ paged:'1',unknown:'1' },{ paged:'1',page:'0' },{ paged:'1',page_size:'101' },
    { paged:'1',role:'owner' },{ paged:'1',search:'x'.repeat(201) },
  ]) assert.match(parseUserDirectoryQuery(query).error,/Invalid user directory/);
});

test('user directory escapes wildcard search characters for literal matching',() => {
  assert.equal(escapeLike('100%_\\ready'),'100\\%\\_\\\\ready');
});
