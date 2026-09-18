// Isolated UI smoke checks: synthetic API only, no production database or email.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { metadata } = require('../server/customReports');
const { reportTemplates } = require('../server/reportTemplates');
const build = path.resolve(process.argv[2] || '.tmp-client-build');
assert.ok(fs.existsSync(path.join(build,'index.html')),'Build the client into .tmp-client-build first');
const chrome = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(file => fs.existsSync(file));
assert.ok(chrome,'Set CHROME_BIN to an installed Chrome/Chromium executable');
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'operations-browser-'));
let role = 'manager';
let failSources = false;
let socket,browser;
const errors = [];
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let body = '';
    for await (const chunk of req) body+=chunk;
    let value = {};
    if (url.pathname==='/api/auth/me') value={ id: 1,name: 'Browser fixture',role };
    else if (url.pathname==='/api/notifications') value={ notifications: [],unread: 0 };
    else if (url.pathname==='/api/tasks/overdue-counts') value={ tasks: 0,visits: 0 };
    else if (url.pathname==='/api/teams/mine') value={ service_activity_enabled: true,teams: [] };
    else if (url.pathname==='/api/reports/summary') value={ byStatus: [],engineerLoad: [],pendingClosure: [],kpiHealth: [],taskStats: {} };
    else if (url.pathname==='/api/reports/projects') value=[];
    else if (url.pathname==='/api/admin/stats') value={ attachments: { total_size: 0 },customers: 0,users: { total: 1,active: 1,managers: 1,engineers: 0 },projects: { active: 0,overdue: 0,pending_closure: 0 },tasks: { total: 0,open: 0,done: 0,adhoc: 0 },maintenance: { total: 0,report_pending: 0,report_sent: 0 } };
    else if (url.pathname==='/api/admin/activity') value=[];
    else if (url.pathname==='/api/reports/custom/sources') {
      if (failSources) { res.statusCode=503; value={ error: 'Fixture metadata unavailable' }; }
      else value={ sources: metadata(),templates: reportTemplates(new Date('2026-09-18T00:00:00Z')),preview_limit: 100,export_limit: 5000 };
    } else if (url.pathname==='/api/reports/custom/saved') value={ rows: [{ id: 1,name: 'Saved fixture',owner_id: 1,visibility: 'private',version: 1 }],page: 1,page_size: 25,total: 1 };
    else if (url.pathname==='/api/reports/custom/saved/1') value={ id: 1,name: 'Saved fixture',owner_id: 1,can_edit: true,visibility: 'private',version: 1,definition: { source: 'tasks',fields: ['id','title'] } };
    else if (url.pathname==='/api/reports/custom/saved/1/schedule') value={ schedule: null,recipients: [{ id: 1,name: 'Browser fixture' }],visibility: 'private' };
    else if (url.pathname==='/api/reports/custom/preview') {
      const definition = JSON.parse(body);
      value={ columns: definition.fields.map(key => ({ key,label: key })),rows: [Object.fromEntries(definition.fields.map(key => [key,key==='id' ? 1 : 'Fixture task']))],limit: 100,truncated: false };
    } else if (url.pathname==='/api/settings/integrations') value={ teams: { enabled: true,webhook_url: '',webhook_url_set: true },webex: { enabled: true,bot_token: '',bot_token_set: true,mode: 'both' },notify_on: { task_assigned: true,project_assigned: true,visit_assigned: true } };
    else if (url.pathname==='/api/settings/security') value={ password_expiry_days: 90 };
    else if (url.pathname==='/api/settings/deployment-health') value={ status: 'ok' };
    else if (/links|users|customers/.test(url.pathname)) value=[];
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(value)); return;
  }
  let file = path.resolve(build,'.'+decodeURIComponent(url.pathname));
  if (file!==build && !file.startsWith(build+path.sep)) { res.statusCode=404; res.end(); return; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file=path.join(build,'index.html');
  res.setHeader('Content-Type',({ '.js': 'text/javascript','.css': 'text/css','.png': 'image/png','.svg': 'image/svg+xml' })[path.extname(file)] || 'text/html');
  fs.createReadStream(file).pipe(res);
});
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function main() {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{ windowsHide: true,stdio: 'ignore' });
  browser.on('error',error => errors.push(error.message));
  const portFile = path.join(profile,'DevToolsActivePort');
  for (let i=0;i<100 && !fs.existsSync(portFile);i++) await delay(100);
  assert.ok(fs.existsSync(portFile),'Headless browser did not start');
  const port = fs.readFileSync(portFile,'utf8').split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket=new WebSocket(pages.find(page => page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; });
  let sequence=0;
  const waiting = new Map();
  socket.onmessage=event => {
    const message=JSON.parse(event.data);
    if (message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (!message.id) return;
    const pending=waiting.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout); waiting.delete(message.id);
    message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
  };
  const call = (method,params = {}) => new Promise((resolve,reject) => {
    const id=++sequence;
    const timeout=setTimeout(() => { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)); },10_000);
    waiting.set(id,{ resolve,reject,timeout }); socket.send(JSON.stringify({ id,method,params }));
  });
  const evaluate = async expression => {
    const result=await call('Runtime.evaluate',{ expression,returnByValue: true,awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async expression => {
    for (let i=0;i<80;i++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`UI wait failed: ${expression}`);
  };
  const click = text => evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(node => node.textContent.trim()===${JSON.stringify(text)}); if (!button) throw new Error('Missing button'); button.focus(); button.click(); })()`);
  const navigate = async route => {
    await call('Page.navigate',{ url: base+route });
    await delay(150);
    await until(`location.pathname===${JSON.stringify(route)} && document.readyState==='complete'`);
  };
  const key = async (name,modifiers = 0) => {
    await call('Input.dispatchKeyEvent',{ type: 'keyDown',key: name,code: name,modifiers,windowsVirtualKeyCode: name==='Tab' ? 9 : name==='Escape' ? 27 : 13,...(name==='Enter' ? { text: '\r',unmodifiedText: '\r' } : {}) });
    await call('Input.dispatchKeyEvent',{ type: 'keyUp',key: name,code: name,modifiers });
  };
  await call('Page.enable'); await call('Runtime.enable');
  for (const width of [1440,768,390]) {
    await call('Emulation.setDeviceMetricsOverride',{ width,height: 1000,deviceScaleFactor: 1,mobile: false });
    await navigate('/reports');
    await until("[...document.querySelectorAll('button')].some(node => node.textContent==='Report Builder')");
    await click('Report Builder');
    await until("!!document.querySelector('#report-source')");
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true,`Report Builder overflows at ${width}px`);
  }
  await evaluate("[...document.querySelectorAll('button')].find(node => node.textContent.startsWith('Saved fixture')).click()");
  await until("[...document.querySelectorAll('h2')].some(node => node.textContent.includes('Saved fixture'))");
  await click('Preview');
  await until("document.querySelector('table')?.textContent.includes('Fixture task')");
  await click('Save as new');
  await until("document.activeElement?.id==='report-name'");
  await key('Escape');
  await until("!document.querySelector('[role=dialog]')");
  assert.equal(await evaluate('document.activeElement.textContent'),'Save as new');
  await click('Delivery schedule');
  await until("!!document.querySelector('#schedule-frequency')");
  await evaluate("document.querySelector('[role=dialog] button').focus()");
  await key('Tab',8);
  assert.equal(await evaluate('document.activeElement.textContent'),'Save schedule','Shift+Tab wraps within the dialog');
  await key('Escape');
  await navigate('/settings/integrations');
  await until("!!document.querySelector('[role=switch]')");
  assert.equal(await evaluate("[...document.querySelectorAll('input[type=password]')].every(node => node.value==='')"),true);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true,'Settings overflows on mobile');
  await evaluate("document.querySelector('[role=switch]').focus()");
  await key('Enter');
  assert.equal(await evaluate("document.querySelector('[role=switch]').getAttribute('aria-checked')"),'false');
  await click('Business');
  await until("[...document.querySelectorAll('a')].some(node => node.textContent==='Customers')");
  await navigate('/settings');
  await until("!!document.querySelector('.settings-content-header h2')");
  assert.equal(await evaluate("document.querySelector('.settings-content-header h2').textContent"),'Overview');
  failSources=true;
  await navigate('/reports');
  await until("[...document.querySelectorAll('button')].some(node => node.textContent==='Report Builder')");
  await click('Report Builder');
  await until("document.querySelector('[role=alert]')?.textContent.includes('Fixture metadata unavailable')");
  failSources=false; await click('Retry');
  await until("!!document.querySelector('#report-source')");
  role='engineer';
  await navigate('/reports');
  await until("document.querySelector('#page-state-title')?.textContent==='Access unavailable'");
  assert.equal(await evaluate("!!document.querySelector('#report-source')"),false);
  assert.deepEqual(errors,[],'Browser runtime exceptions');
  console.log('PASS: 1440/768/390px report layout; saved definitions; preview; dialog focus/Escape; schedule focus trap; mobile settings; keyboard switches; root/deep links; retry; role guard. Synthetic API fixtures only.');
  await call('Browser.close');
}
main().catch(error => { console.error(error.message); if (errors.length) console.error(errors.join('\n')); process.exitCode=1; }).finally(async () => {
  socket?.close();
  if (browser && browser.exitCode===null) { browser.kill(); await delay(1000); }
  await new Promise(resolve => server.close(resolve));
  // Only remove the exact temporary directory created by this process.
  try {
    const resolved=fs.realpathSync(profile),temporaryRoot=fs.realpathSync(os.tmpdir());
    assert.ok(resolved.startsWith(temporaryRoot+path.sep+'operations-browser-'),'Unexpected browser profile path');
    fs.rmSync(resolved,{ recursive: true,force: true,maxRetries: 10,retryDelay: 100 });
  } catch { console.error(`Browser profile cleanup needed: ${profile}`); process.exitCode=1; }
});
