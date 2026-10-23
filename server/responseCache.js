function createResponseCache({ ttlMs=15_000,maxEntries=500,key }) {
  const entries=new Map();
  let hits=0,misses=0;

  function prune(now=Date.now()) {
    for (const [cacheKey,entry] of entries) if (entry.expires<=now) entries.delete(cacheKey);
    while (entries.size>maxEntries) entries.delete(entries.keys().next().value);
  }

  function middleware(req,res,next) {
    const cacheKey=key(req);
    if (!cacheKey) return next();
    const now=Date.now(),cached=entries.get(cacheKey);
    if (cached && cached.expires>now) {
      hits += 1;entries.delete(cacheKey);entries.set(cacheKey,cached);
      res.setHeader('X-TeamHub-Cache','hit');
      return res.json(cached.body);
    }
    if (cached) entries.delete(cacheKey);
    misses += 1;
    const original=res.json.bind(res);
    res.json=body => {
      if (res.statusCode<400) {
        entries.set(cacheKey,{ body,expires:Date.now()+ttlMs });
        prune();
      }
      res.setHeader('X-TeamHub-Cache','miss');
      return original(body);
    };
    return next();
  }

  middleware.clear=() => entries.clear();
  middleware.stats=() => ({ entries:entries.size,hits,misses,ttl_ms:ttlMs });
  return middleware;
}

module.exports={ createResponseCache };
