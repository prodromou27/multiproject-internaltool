const { assertPublicHttpUrl, pinnedFetch } = require('../security');

/* Why a request to Request Tracker never got an answer, in words a manager can
   act on. fetch() reports every network failure as "fetch failed"; the cause
   carries the real reason. No secrets are included. */
function connectionError(error,host) {
  if (error?.name==='TimeoutError') return 'Request Tracker did not respond before the timeout';
  const cause=error?.cause || error || {};
  const code=String(cause.code || '');
  const text=String(cause.message || '');
  let reason;
  if (code==='ENOTFOUND' || code==='EAI_AGAIN') reason=`the name ${host} could not be found. The server running this app must resolve it: add it to that server's DNS or hosts file (under Docker, use extra_hosts)`;
  else if (code==='ECONNREFUSED') reason=`${host} refused the connection. Check the port in the base URL and that Request Tracker is running`;
  else if (code==='ETIMEDOUT' || code==='ENETUNREACH' || code==='EHOSTUNREACH' || code==='UND_ERR_CONNECT_TIMEOUT') reason=`${host} could not be reached from the server running this app. Check routing and firewalls`;
  else if (code==='ECONNRESET') reason=`${host} closed the connection`;
  else if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code)) reason=code==='ERR_TLS_CERT_ALTNAME_INVALID'
    ? `the HTTPS certificate is not issued for ${host}. Use the name on the certificate in the base URL`
    : `the HTTPS certificate of ${host} is not trusted (${code}). If it comes from your own certificate authority, set NODE_EXTRA_CA_CERTS to that CA's certificate file`;
  else if (/redirect/i.test(text)) reason='Request Tracker answered with a redirect. Use the exact address of the RT web interface as the base URL (for example https://host/rt if RT lives under /rt)';
  else reason=code || text || 'unknown network error';
  return `Could not connect to Request Tracker: ${reason}`;
}

/* An HTTP error from Request Tracker, with what usually causes it. */
function httpError(status) {
  const hint={
    401:'the API token was not accepted. Create an auth token in RT (Logged in as > Settings > Auth Tokens) and paste it again',
    403:'the token user may not do this. Give that RT user rights to see the queues and tickets',
    404:'the REST 2.0 API was not found at this address. Check the base URL is the RT web address (for example https://host/rt) and that REST2 is enabled',
  }[status];
  return `Request Tracker returned HTTP ${status}${hint ? `: ${hint}` : ''}`;
}

// Pages of 100 tickets one sync may read (the first sync of a busy queue reads two years).
const MAX_PAGES=500;

class RequestTrackerProvider {
  constructor(config,{ fetchImpl=pinnedFetch,validateUrl=assertPublicHttpUrl,timeoutMs=15000 }={}) {
    this.config=config || {};this.fetchImpl=fetchImpl;this.validateUrl=validateUrl;this.timeoutMs=timeoutMs;this.ready=null;
    const root=String(this.config.base_url || '').replace(/\/+$/,'').replace(/\/REST\/2\.0$/i,'');
    this.apiRoot=`${root}/REST/2.0`;
  }

  async validate() {
    if (!this.config.base_url || !this.config.api_token || this.config.api_token.startsWith('[')) throw Object.assign(new Error('Request Tracker is not fully configured'),{ status:400 });
    const checked=await this.validateUrl(this.config.base_url,{ label:'RT base URL',allowPrivate:process.env.ALLOW_PRIVATE_TICKETING_URLS!=='false' });
    // Requests connect only to the addresses that passed the check (no DNS switch afterwards).
    this.addresses=checked?.validatedAddresses;
  }

  /** Validates once; a failed check is forgotten so the next call tries again. */
  async ensureReady() {
    this.ready ||= this.validate().catch(error => { this.ready=null;throw error; });
    await this.ready;
  }

  async request(path,params={},{ timeoutMs=this.timeoutMs }={}) {
    await this.ensureReady();
    const url=new URL(this.apiRoot+path);
    for (const [key,value] of Object.entries(params)) if (value!==undefined) url.searchParams.set(key,String(value));
    let response;
    try { response=await this.fetchImpl(url,{ headers:{ Accept:'application/json',Authorization:`token ${this.config.api_token}` },redirect:'error',addresses:this.addresses,signal:AbortSignal.timeout(timeoutMs) }); }
    catch(error) { throw Object.assign(new Error(connectionError(error,url.hostname)),{ status:502,timedOut:error?.name==='TimeoutError' }); }
    if (!response.ok) throw Object.assign(new Error(httpError(response.status)),{ status:502,httpStatus:response.status });
    const type=response.headers.get('content-type') || '';
    if (!type.toLowerCase().includes('application/json')) throw Object.assign(new Error('Request Tracker returned an unexpected response type'),{ status:502 });
    try { return await response.json(); } catch { throw Object.assign(new Error('Request Tracker returned invalid JSON'),{ status:502 }); }
  }

  /** Sets a ticket's Status field via RT REST 2.0's ticket update endpoint (PUT /ticket/{id}). */
  async updateTicketStatus(ticketId,status) {
    const id=String(ticketId ?? '');
    if (!/^\d+$/.test(id)) throw Object.assign(new Error('Invalid Request Tracker ticket identifier'),{ status:400 });
    if (!status || typeof status!=='string' || status.length>100) throw Object.assign(new Error('Invalid Request Tracker status value'),{ status:400 });
    await this.ensureReady();
    const url=new URL(`${this.apiRoot}/ticket/${encodeURIComponent(id)}`);
    let response;
    try {
      response=await this.fetchImpl(url,{
        method:'PUT',
        headers:{ Accept:'application/json','Content-Type':'application/json',Authorization:`token ${this.config.api_token}` },
        body:JSON.stringify({ Status:status }),
        redirect:'error',
        addresses:this.addresses,
        signal:AbortSignal.timeout(this.timeoutMs),
      });
    } catch(error) { throw Object.assign(new Error(connectionError(error,url.hostname)),{ status:502 }); }
    if (!response.ok) throw Object.assign(new Error(httpError(response.status)),{ status:502,httpStatus:response.status });
    const type=response.headers.get('content-type') || '';
    let result=null;
    if (type.toLowerCase().includes('application/json')) { try { result=await response.json(); } catch { /* fall through with no parsed body */ } }
    // RT2.0 returns an array of per-field result messages on ticket update.
    const messages=Array.isArray(result) ? result.map(entry => entry?.message).filter(Boolean) : [];
    const failed=Array.isArray(result) && result.some(entry => entry && entry.ok===false);
    if (failed) throw Object.assign(new Error(messages.join('; ') || 'Request Tracker rejected the status update'),{ status:502 });
    return { ok:true,message:messages.join('; ') || `Status set to ${status}` };
  }

  async testConnection() {
    const result=await this.request('/queues/all',{ page:1,per_page:1 });
    if (!Array.isArray(result.items)) throw Object.assign(new Error('Request Tracker queue response is invalid'),{ status:502 });
    return { ok:true,queue_count:Number.isFinite(Number(result.total)) ? Number(result.total) : result.items.length };
  }

  async getQueue(queueId) {
    const id=String(queueId ?? '');
    if (!/^\d+$/.test(id)) throw Object.assign(new Error('Invalid Request Tracker queue identifier'),{ status:400 });
    const detail=await this.request(`/queue/${encodeURIComponent(id)}`);
    return { id,name:String(detail.Name || detail.name || `Queue ${id}`).slice(0,500),description:String(detail.Description || detail.description || '').slice(0,2000) };
  }

  /** A queue's tickets: changed since `updatedAfter` (later syncs), or, on the first sync, those
      changed since `since` plus any older ones still open (not the whole history of a big queue). */
  async getTickets(queueId,{ updatedAfter,since }={}) {
    const id=String(queueId ?? '');
    if (!/^\d+$/.test(id)) throw Object.assign(new Error('Invalid Request Tracker queue identifier'),{ status:400 });
    const day=(value,label) => { const date=new Date(value);if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`Invalid ${label} date`),{ status:400 });return date.toISOString(); };
    let query=`Queue = ${id}`;
    if (updatedAfter) query+=` AND LastUpdated > '${day(updatedAfter,'incremental synchronization')}'`;
    else if (since) query+=` AND (Status = '__Active__' OR LastUpdated > '${day(since,'history')}')`;
    const tickets=[];let page=1;
    while (page<=MAX_PAGES) {
      const result=await this.request('/tickets',{ query,page,per_page:100,fields:'Subject,Status,Priority,Owner,Created,LastUpdated,Resolved,Due,Queue','fields[Owner]':'Name,EmailAddress,RealName','fields[Queue]':'Name' });
      if (!Array.isArray(result.items)) throw Object.assign(new Error('Request Tracker ticket response is invalid'),{ status:502 });
      tickets.push(...result.items);
      if (tickets.length>MAX_PAGES*100) throw Object.assign(new Error(`A single Request Tracker sync cannot exceed ${MAX_PAGES*100} tickets`),{ status:413 });
      const hasPageCount=result.pages!==null && result.pages!==undefined && Number.isFinite(Number(result.pages));
      if ((hasPageCount && page>=Number(result.pages)) || (!hasPageCount && !result.next_page) || result.items.length===0) return tickets;
      page++;
    }
    throw Object.assign(new Error(`Request Tracker ticket pagination exceeded ${MAX_PAGES} pages`),{ status:413 });
  }

  /** A queue's tickets page by page, oldest change first, so a big queue can be saved as it
      is read and resumed from the last change saved (ticketSync.js). Yields { items, more }.
      A slow page is asked again once with a longer wait. */
  async *getTicketPages(queueId,{ updatedAfter,since }={}) {
    const id=String(queueId ?? '');
    if (!/^\d+$/.test(id)) throw Object.assign(new Error('Invalid Request Tracker queue identifier'),{ status:400 });
    const day=(value,label) => { const date=new Date(value);if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`Invalid ${label} date`),{ status:400 });return date.toISOString(); };
    let query=`Queue = ${id}`;
    if (updatedAfter) query+=` AND LastUpdated > '${day(updatedAfter,'incremental synchronization')}'`;
    else if (since) query+=` AND (Status = '__Active__' OR LastUpdated > '${day(since,'history')}')`;
    const params=page => ({ query,page,per_page:100,orderby:'LastUpdated',order:'ASC',fields:'Subject,Status,Priority,Owner,Created,LastUpdated,Resolved,Due,Queue','fields[Owner]':'Name,EmailAddress,RealName','fields[Queue]':'Name' });
    for (let page=1;page<=MAX_PAGES;page++) {
      let result;
      try { result=await this.request('/tickets',params(page)); }
      catch(error) { if (!error.timedOut) throw error; result=await this.request('/tickets',params(page),{ timeoutMs:this.timeoutMs*4 }); }
      if (!Array.isArray(result.items)) throw Object.assign(new Error('Request Tracker ticket response is invalid'),{ status:502 });
      const hasPageCount=result.pages!==null && result.pages!==undefined && Number.isFinite(Number(result.pages));
      const more=!((hasPageCount && page>=Number(result.pages)) || (!hasPageCount && !result.next_page) || result.items.length===0);
      yield { items:result.items,more };
      if (!more) return;
    }
    throw Object.assign(new Error(`Request Tracker ticket pagination exceeded ${MAX_PAGES} pages`),{ status:413 });
  }

  /** The ids of a queue's active tickets (new, open, stalled…), to find tickets that left it. */
  async getActiveTicketIds(queueId) {
    const id=String(queueId ?? '');
    if (!/^\d+$/.test(id)) throw Object.assign(new Error('Invalid Request Tracker queue identifier'),{ status:400 });
    const ids=new Set();let page=1;
    while (page<=MAX_PAGES) {
      const result=await this.request('/tickets',{ query:`Queue = ${id} AND Status = '__Active__'`,page,per_page:100 });
      if (!Array.isArray(result.items)) throw Object.assign(new Error('Request Tracker ticket response is invalid'),{ status:502 });
      for (const item of result.items) if (item && /^\d+$/.test(String(item.id))) ids.add(String(item.id));
      const hasPageCount=result.pages!==null && result.pages!==undefined && Number.isFinite(Number(result.pages));
      if ((hasPageCount && page>=Number(result.pages)) || (!hasPageCount && !result.next_page) || result.items.length===0) return ids;
      page++;
    }
    throw Object.assign(new Error(`Request Tracker ticket pagination exceeded ${MAX_PAGES} pages`),{ status:413 });
  }

  /** One ticket as RT has it now; null when it no longer exists. A merged ticket comes back
      as the ticket it was merged into (another id, or EffectiveId pointing there). */
  async getTicket(ticketId) {
    const id=String(ticketId ?? '');
    if (!/^\d+$/.test(id)) throw Object.assign(new Error('Invalid Request Tracker ticket identifier'),{ status:400 });
    try { return await this.request(`/ticket/${encodeURIComponent(id)}`); }
    catch(error) { if (error.httpStatus===404) return null; throw error; }
  }

  /** RT staff accounts (privileged users), to link to TeamHub users. */
  async getUsers() {
    const users=[];let page=1,pages=1;
    do {
      let result;
      try { result=await this.request('/users/privileged',{ page,per_page:100,fields:'Name,EmailAddress,RealName,Disabled' }); }
      catch(error) {
        if (/HTTP 403/.test(error.message)) throw Object.assign(new Error('Request Tracker did not list its users: give the token\'s RT user the right to see users (for example AdminUsers or ShowUserHistory)'),{ status:502 });
        throw error;
      }
      if (!Array.isArray(result.items)) throw Object.assign(new Error('Request Tracker user response is invalid'),{ status:502 });
      users.push(...result.items);pages=Math.max(1,Number(result.pages || 1));page++;
      if (users.length>2000 || page>20) break;
    } while(page<=pages);
    return users.filter(user => user && !Number(user.Disabled)).map(user => ({
      username:String(user.Name || user.id || '').slice(0,200),email:user.EmailAddress ? String(user.EmailAddress).trim().toLowerCase().slice(0,320) : null,
      real_name:user.RealName ? String(user.RealName).slice(0,200) : null,
    })).filter(user => user.username && user.username.toLowerCase()!=='nobody').sort((a,b) => a.username.localeCompare(b.username));
  }

  /** Tickets an RT user owns, in any queue: open now, or resolved since `since`. */
  async getOwnedTickets(username,{ since }={}) {
    const name=String(username ?? '');
    if (!name || name.length>200 || /['\\\r\n]/.test(name)) throw Object.assign(new Error('Invalid Request Tracker user name'),{ status:400 });
    const from=new Date(since);
    if (Number.isNaN(from.getTime())) throw Object.assign(new Error('Invalid date'),{ status:400 });
    const query=`Owner = '${name}' AND (Status = '__Active__' OR Resolved >= '${from.toISOString().slice(0,10)}')`;
    const tickets=[];let page=1;
    while (page<=100) {
      const result=await this.request('/tickets',{ query,page,per_page:100,fields:'Subject,Status,Created,Resolved,Queue','fields[Queue]':'Name' });
      if (!Array.isArray(result.items)) throw Object.assign(new Error('Request Tracker ticket response is invalid'),{ status:502 });
      tickets.push(...result.items);
      if (tickets.length>10000) throw Object.assign(new Error(`${name} owns more than 10,000 tickets in the period`),{ status:413 });
      const hasPageCount=result.pages!==null && result.pages!==undefined && Number.isFinite(Number(result.pages));
      if ((hasPageCount && page>=Number(result.pages)) || (!hasPageCount && !result.next_page) || result.items.length===0) return tickets;
      page++;
    }
    throw Object.assign(new Error('Request Tracker ticket pagination exceeded 100 pages'),{ status:413 });
  }

  async getQueues() {
    const references=[];let page=1,pages=1;
    do {
      const result=await this.request('/queues/all',{ page,per_page:100 });
      if (!Array.isArray(result.items)) throw Object.assign(new Error('Request Tracker queue response is invalid'),{ status:502 });
      references.push(...result.items);pages=Math.max(1,Number(result.pages || 1));page++;
      if (references.length>500 || pages>5) throw Object.assign(new Error('Request Tracker exposes more than 500 queues; reduce the integration account scope'),{ status:413 });
    } while(page<=pages);
    const queues=[];
    for (let offset=0;offset<references.length;offset+=10) {
      const batch=references.slice(offset,offset+10);
      queues.push(...await Promise.all(batch.map(async reference => {
        const id=String(reference.id ?? '');if (!/^\d+$/.test(id)) throw Object.assign(new Error('Request Tracker returned an invalid queue identifier'),{ status:502 });
        if (!reference.Name) return this.getQueue(id);
        return { id,name:String(reference.Name || `Queue ${id}`).slice(0,500),description:String(reference.Description || '').slice(0,2000) };
      })));
    }
    return queues.sort((a,b) => a.name.localeCompare(b.name) || Number(a.id)-Number(b.id));
  }
}

module.exports={ RequestTrackerProvider,connectionError,httpError };
