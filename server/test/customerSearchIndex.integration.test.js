process.env.CUSTOMER_FIELD_KEY='bc'.repeat(32);
const test=require('node:test');
const assert=require('node:assert/strict');
const harness=require('./lib/harness');
const { encryptCustomer }=require('../fieldCipher');
const { replaceCustomerSearchDocument,candidateCustomerIds,candidateCustomerNameIds }=require('../customerSearchIndex');

let h;
test.before(async () => { h=await harness.start({}); });
test.after(async () => { await h.stop(); });

test('blind index narrows literal and exact-name candidates without storing plaintext',async () => {
  const plain={ name:'Northwind Logistics',contact_name:'Mina Cole',contact_email:'ops@northwind.test',address:'Harbour Road',location:'Nicosia',customer_code:'NWL' };
  const encrypted=encryptCustomer(plain);
  const created=await h.db.prepare('INSERT INTO customers (name,contact_name,contact_email,address,location,customer_code) VALUES (?,?,?,?,?,?)')
    .run(encrypted.name,encrypted.contact_name,encrypted.contact_email,encrypted.address,encrypted.location,plain.customer_code);
  await h.db.transaction(tx => replaceCustomerSearchDocument(tx,{ id:created.lastInsertRowid,...plain }));

  assert.deepEqual([...(await candidateCustomerIds(h.db,'wind log'))],[created.lastInsertRowid]);
  assert.deepEqual([...(await candidateCustomerNameIds(h.db,' NORTHWIND LOGISTICS '))],[created.lastInsertRowid]);
  assert.equal((await candidateCustomerIds(h.db,'missing')).size,0);
  const stored=await h.db.prepare('SELECT token_hash FROM customer_search_tokens WHERE customer_id=?').all(created.lastInsertRowid);
  assert(stored.length>5);assert.equal(JSON.stringify(stored).includes('northwind'),false);
});
