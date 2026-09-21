const { assertPublicHttpUrl } = require('../security');

class RequestTrackerProvider {
  constructor(config,{ fetchImpl=global.fetch,validateUrl=assertPublicHttpUrl,timeoutMs=15000 }={}) {
    this.config=config || {};this.fetchImpl=fetchImpl;this.validateUrl=validateUrl;this.timeoutMs=timeoutMs;this.ready=null;
    const root=String(this.config.base_url || '').replace(/\/+$/,'').replace(/\/REST\/2\.0$/i,'');
    this.apiRoot=`${root}/REST/2.0`;
  }

  async validate() {
    if (!this.config.base_url || !this.config.api_token || this.config.api_token.startsWith('[')) throw Object.assign(new Error('Request Tracker is not fully configured'),{ status:400 });
    await this.validateUrl(this.config.base_url,{ label:'RT base URL',allowPrivate:process.env.ALLOW_PRIVATE_TICKETING_URLS==='true' });
  }

  async request(path,params={}) {
    this.ready ||= this.validate();await this.ready;
    const url=new URL(this.apiRoot+path);
    for (const [key,value] of Object.entries(params)) if (value!==undefined) url.searchParams.set(key,String(value));
    let response;
    try { response=await this.fetchImpl(url,{ headers:{ Accept:'application/json',Authorization:`token ${this.config.api_token}` },redirect:'error',signal:AbortSignal.timeout(this.timeoutMs) }); }
    catch(error) { throw Object.assign(new Error(error.name==='TimeoutError' ? 'Request Tracker did not respond before the timeout' : 'Could not connect to Request Tracker'),{ status:502 }); }
    if (!response.ok) throw Object.assign(new Error(`Request Tracker returned HTTP ${response.status}`),{ status:502 });
    const type=response.headers.get('content-type') || '';
    if (!type.toLowerCase().includes('application/json')) throw Object.assign(new Error('Request Tracker returned an unexpected response type'),{ status:502 });
    try { return await response.json(); } catch { throw Object.assign(new Error('Request Tracker returned invalid JSON'),{ status:502 }); }
  }

  async testConnection() {
    const result=await this.request('/queues/all',{ page:1,per_page:1 });
    if (!Array.isArray(result.items)) throw Object.assign(new Error('Request Tracker queue response is invalid'),{ status:502 });
    return { ok:true,queue_count:Number.isFinite(Number(result.total)) ? Number(result.total) : result.items.length };
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
        const detail=reference.Name ? reference : await this.request(`/queue/${encodeURIComponent(id)}`);
        return { id,name:String(detail.Name || detail.name || `Queue ${id}`).slice(0,500),description:String(detail.Description || detail.description || '').slice(0,2000) };
      })));
    }
    return queues.sort((a,b) => a.name.localeCompare(b.name) || Number(a.id)-Number(b.id));
  }
}

module.exports={ RequestTrackerProvider };
