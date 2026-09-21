const test=require('node:test');
const assert=require('node:assert/strict');
const { mergeSettings,publicSettings,runtimeSettings }=require('../ticketingSettings');

test('RT settings retain, encrypt, redact and explicitly clear API tokens',() => {
  const previous=process.env.CUSTOMER_FIELD_KEY;process.env.CUSTOMER_FIELD_KEY='cd'.repeat(32);
  try {
    const stored=mergeSettings({}, { enabled:true,base_url:'https://rt.example.test/',sync_interval_minutes:30,api_token:'secret-token' });
    assert.match(stored.api_token,/^enc:/);assert.equal(stored.base_url,'https://rt.example.test');
    const safe=publicSettings(stored);assert.equal(safe.api_token,'');assert.equal(safe.api_token_set,true);assert.equal(JSON.stringify(safe).includes('secret-token'),false);
    assert.equal(runtimeSettings(stored).api_token,'secret-token');
    assert.equal(mergeSettings(stored,{ sync_interval_minutes:60 }).api_token,stored.api_token);
    assert.equal(mergeSettings({ ...stored,enabled:false },{ clear_api_token:true }).api_token,null);
  } finally { if (previous===undefined) delete process.env.CUSTOMER_FIELD_KEY;else process.env.CUSTOMER_FIELD_KEY=previous; }
});

test('RT settings reject invalid shapes and incomplete enabled configurations',() => {
  for (const value of [[],{ enabled:'true' },{ sync_interval_minutes:5 },{ api_token:{} },{ unknown:true },{ enabled:true,base_url:'https://rt.example.test' }]) assert.throws(() => mergeSettings({},value),error => error.status===400);
});
