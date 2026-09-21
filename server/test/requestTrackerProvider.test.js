const test=require('node:test');
const assert=require('node:assert/strict');
const { RequestTrackerProvider }=require('../ticketing/requestTrackerProvider');

function json(body,status=200) { return new Response(JSON.stringify(body),{ status,headers:{ 'content-type':'application/json' } }); }

test('RT provider uses token authentication and follows bounded queue pagination',async () => {
  const requests=[];
  const fetchImpl=async (url,options) => {
    requests.push({ url:String(url),options });
    if (url.pathname.endsWith('/queues/all')) return json(url.searchParams.get('page')==='1' ? { total:2,pages:2,items:[{ id:'2' }] } : { total:2,pages:2,items:[{ id:'1',Name:'Alpha',Description:'First' }] });
    if (url.pathname.endsWith('/queue/2')) return json({ id:2,Name:'Zulu',Description:'Second' });
    throw new Error(`Unexpected ${url}`);
  };
  const provider=new RequestTrackerProvider({ base_url:'https://rt.example.test/rt/',api_token:'private-token' },{ fetchImpl,validateUrl:async () => {} });
  const queues=await provider.getQueues();
  assert.deepEqual(queues,[{ id:'1',name:'Alpha',description:'First' },{ id:'2',name:'Zulu',description:'Second' }]);
  assert.equal(requests[0].url,'https://rt.example.test/rt/REST/2.0/queues/all?page=1&per_page=100');
  assert.equal(requests.every(request => request.options.headers.Authorization==='token private-token'),true);
  assert.equal(requests.every(request => request.options.redirect==='error'),true);
});

test('RT provider reports connection failures without exposing credentials',async () => {
  const provider=new RequestTrackerProvider({ base_url:'https://rt.example.test',api_token:'do-not-expose' },{ validateUrl:async () => {},fetchImpl:async () => json({ message:'token do-not-expose rejected' },401) });
  await assert.rejects(() => provider.testConnection(),error => error.status===502 && error.message==='Request Tracker returned HTTP 401' && !error.message.includes('do-not-expose'));
});

test('RT provider reads a single queue using a validated identifier',async () => {
  const provider=new RequestTrackerProvider({ base_url:'https://rt.example.test',api_token:'token' },{ validateUrl:async () => {},fetchImpl:async url => {
    assert.equal(String(url),'https://rt.example.test/REST/2.0/queue/42');
    return json({ id:42,Name:'Customer Support',Description:'Managed queue' });
  } });
  assert.deepEqual(await provider.getQueue('42'),{ id:'42',name:'Customer Support',description:'Managed queue' });
  await assert.rejects(() => provider.getQueue('../tickets'),error => error.status===400);
});

test('RT provider fetches expanded ticket pages without following response URLs',async () => {
  const pages=[];
  const provider=new RequestTrackerProvider({ base_url:'https://rt.example.test',api_token:'token' },{ validateUrl:async () => {},fetchImpl:async url => {
    pages.push(String(url));
    assert.equal(url.searchParams.get('query'),"Queue = 42 AND LastUpdated > '2026-09-01T00:00:00.000Z'");
    assert.match(url.searchParams.get('fields'),/LastUpdated/);
    return json(url.searchParams.get('page')==='1' ? { pages:null,next_page:'https://evil.invalid/',items:[{ id:'1' }] } : { pages:null,items:[{ id:'2' }] });
  } });
  assert.deepEqual((await provider.getTickets('42',{ updatedAfter:'2026-09-01' })).map(ticket => ticket.id),['1','2']);
  assert.equal(new URL(pages[1]).searchParams.get('page'),'2');
});

test('RT provider rejects incomplete settings and unbounded queue directories',async () => {
  await assert.rejects(() => new RequestTrackerProvider({ base_url:'https://rt.example.test' },{ validateUrl:async () => {} }).testConnection(),/not fully configured/);
  const provider=new RequestTrackerProvider({ base_url:'https://rt.example.test',api_token:'token' },{ validateUrl:async () => {},fetchImpl:async () => json({ pages:6,items:[] }) });
  await assert.rejects(() => provider.getQueues(),error => error.status===413);
});
