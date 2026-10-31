const test=require('node:test');
const assert=require('node:assert/strict');
const index=require('../customerSearchIndex');

async function withKey(fn) {
  const previous=process.env.CUSTOMER_FIELD_KEY;
  process.env.CUSTOMER_FIELD_KEY='ab'.repeat(32);
  try { return await fn(); } finally {
    if (previous===undefined) delete process.env.CUSTOMER_FIELD_KEY;else process.env.CUSTOMER_FIELD_KEY=previous;
  }
}

test('customer search normalization creates unique literal trigrams',() => {
  assert.equal(index.normalizeSearch('  NORTHWIND   Logistics '),'northwind logistics');
  assert.deepEqual(index.searchGrams('aaaa'),['aaa']);
  assert.deepEqual(index.searchGrams('ab'),[]);
});

test('customer blind tokens are stable, key-bound, and contain no plaintext',() => withKey(() => {
  const first=index.customerTokenHashes({ name:'Northwind Logistics',contact_email:'ops@northwind.test' });
  const second=index.customerTokenHashes({ name:'Northwind Logistics',contact_email:'ops@northwind.test' });
  assert.deepEqual(first,second);assert(first.length>5);
  assert(first.every(value => /^[a-f0-9]{64}$/.test(value)));
  assert.equal(JSON.stringify(first).includes('northwind'),false);
}));

test('candidate lookup sends only hashes to the database',async () => {
  await withKey(async () => {
    let sql,args;
    const store={ prepare:value => ({ all:async (...values) => { sql=value;args=values;return values.map(token_hash => ({ customer_id:7,token_hash })); } }) };
    const ids=await index.candidateCustomerIds(store,'Northwind');
    assert.deepEqual([...ids],[7]);assert.match(sql,/SELECT customer_id,token_hash/);
    assert(args.every(value => !String(value).includes('north')));
  });
});
