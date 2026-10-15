const test=require('node:test');
const assert=require('node:assert/strict');
const { createResponseCache }=require('../responseCache');

function response() {
  return { statusCode:200,headers:{},setHeader(key,value){ this.headers[key]=value; },json(body){ this.body=body;return body; } };
}

test('response cache isolates keys, expires entries and skips failures',async () => {
  let now=0;const realNow=Date.now;Date.now=() => now;
  try {
    const cache=createResponseCache({ ttlMs:20,maxEntries:2,key:req => req.key });
    const first=response();cache({ key:'user-1' },first,() => first.json({ private:'one' }));
    const hit=response();cache({ key:'user-1' },hit,() => assert.fail('cache miss'));assert.deepEqual(hit.body,{ private:'one' });
    const other=response();cache({ key:'user-2' },other,() => other.json({ private:'two' }));assert.deepEqual(other.body,{ private:'two' });
    now=21;const expired=response();cache({ key:'user-1' },expired,() => expired.json({ private:'fresh' }));assert.deepEqual(expired.body,{ private:'fresh' });
    const failed=response();failed.statusCode=500;cache({ key:'failure' },failed,() => failed.json({ error:'no' }));
    const retry=response();cache({ key:'failure' },retry,() => retry.json({ ok:true }));assert.deepEqual(retry.body,{ ok:true });
    assert.equal(cache.stats().hits,1);
  } finally { Date.now=realNow; }
});
