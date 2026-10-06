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
  await assert.rejects(() => provider.testConnection(),error => error.status===502 && error.message.startsWith('Request Tracker returned HTTP 401: the API token was not accepted') && !error.message.includes('do-not-expose'));
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

test('RT provider sets a ticket status via PUT and validates the identifier and status value', async () => {
  let seen;
  const provider = new RequestTrackerProvider({ base_url: 'https://rt.example.test', api_token: 'token' }, { validateUrl: async () => {}, fetchImpl: async (url, options) => {
    seen = { url: String(url), options };
    return json([{ id: 'ticket/123', type: 'ticket', ok: true, message: "Status changed from 'open' to 'resolved'" }]);
  } });
  const result = await provider.updateTicketStatus('123', 'resolved');
  assert.equal(seen.url, 'https://rt.example.test/REST/2.0/ticket/123');
  assert.equal(seen.options.method, 'PUT');
  assert.equal(seen.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seen.options.body), { Status: 'resolved' });
  assert.equal(result.ok, true);
  assert.match(result.message, /resolved/);

  await assert.rejects(() => provider.updateTicketStatus('not-a-number', 'resolved'), error => error.status === 400);
  await assert.rejects(() => provider.updateTicketStatus('123', ''), error => error.status === 400);
  await assert.rejects(() => provider.updateTicketStatus('123', 'x'.repeat(200)), error => error.status === 400);
});

test('RT provider surfaces a failed status update instead of reporting success', async () => {
  const provider = new RequestTrackerProvider({ base_url: 'https://rt.example.test', api_token: 'token' }, { validateUrl: async () => {}, fetchImpl: async () =>
    json([{ id: 'ticket/123', type: 'ticket', ok: false, message: "Status 'resolved' isn't a valid status for tickets in this queue" }]) });
  await assert.rejects(() => provider.updateTicketStatus('123', 'resolved'), error => error.status === 502 && /valid status/.test(error.message));
});

test('RT provider status update reports connection failures and non-2xx the same way as reads', async () => {
  const timeoutProvider = new RequestTrackerProvider({ base_url: 'https://rt.example.test', api_token: 'token' }, { validateUrl: async () => {}, fetchImpl: async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); } });
  await assert.rejects(() => timeoutProvider.updateTicketStatus('123', 'resolved'), /did not respond before the timeout/);

  const httpErrorProvider = new RequestTrackerProvider({ base_url: 'https://rt.example.test', api_token: 'do-not-expose' }, { validateUrl: async () => {}, fetchImpl: async () => json({ message: 'token do-not-expose rejected' }, 403) });
  await assert.rejects(() => httpErrorProvider.updateTicketStatus('123', 'resolved'), error => error.status === 502 && !error.message.includes('do-not-expose'));
});

test('a failed connection says why, and what to do about it', async () => {
  const { connectionError } = require('../ticketing/requestTrackerProvider');
  const failed = (code, message = 'x') => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(message), { code }) });
  assert.match(connectionError(failed('ENOTFOUND'), 'ts.example.com'), /ts\.example\.com could not be found.*extra_hosts/);
  assert.match(connectionError(failed('ECONNREFUSED'), 'rt'), /refused the connection/);
  assert.match(connectionError(failed('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), 'rt'), /not trusted.*NODE_EXTRA_CA_CERTS/);
  assert.match(connectionError(failed('DEPTH_ZERO_SELF_SIGNED_CERT'), 'rt'), /not trusted/);
  assert.match(connectionError(failed('ERR_TLS_CERT_ALTNAME_INVALID'), 'rt'), /not issued for rt/);
  assert.match(connectionError(Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') }), 'rt'), /redirect.*\/rt/);
  assert.match(connectionError(Object.assign(new Error('t'), { name: 'TimeoutError' }), 'rt'), /timeout/);

  const provider = new RequestTrackerProvider({ base_url: 'https://rt.example.test', api_token: 'secret' }, { fetchImpl: async () => { throw failed('ECONNREFUSED'); }, validateUrl: async () => {} });
  await assert.rejects(() => provider.testConnection(), error => error.status === 502 && /refused/.test(error.message) && !error.message.includes('secret'));
});
