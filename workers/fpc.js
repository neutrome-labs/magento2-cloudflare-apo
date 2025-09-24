addEventListener('fetch', event => {
  event.respondWith(handleRequest(event));
});


function debugLog(config, ...args) {
  if (config && config.debug) {
    // Prefix logs for easier filtering
    console.log('[FPC DEBUG]', ...args);
  }
}


async function handleRequest(event) {
  const request = event.request;
  const config = {
    "debug": false,
    "ttl": 3600,
    "grace": 3600*9,
    "purge_secret": "true",
    "included_mimetypes": [
      "text/html",
      "text/css",
      "text/javascript",
      "application/javascript",
      "font/",
      "image/svg"
    ],
    "excluded_paths": ["/admin", "customer", "checkout", "wishlist"],
    "vary_on_params": "*",
    "ignored_params": [
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
      "gclid", "dclid", "fbclid", "msclkid", "yclid", "icid", "gclsrc",
      "mc_cid", "mc_eid", "_bta_tid", "_bta_c",
      "_ga", "_gl", "_gid", "_gac", "ga_source", "ga_medium",
      "ref", "referrer"
    ],
    "vary_on_headers": ["x-magento-tags"],
    "vary_on_cookies": ["X-Magento-Vary"]
  };

  debugLog(config, `Request: ${request.method} ${new URL(request.url).href}`);

  const bypass = shouldBypassCache(request, config);
  if (bypass.bypass) {
    debugLog(config, `Bypass cache -> reason: ${bypass.reason || 'unspecified'}`);
    return fetch(request);
  }

  const cacheKey = await getCacheKey(request, config);
  debugLog(config, `Computed cache key: ${cacheKey}`);

  if (request.method === 'POST' && request.headers.get('X-Purge-Cache') === config.purge_secret) {
    debugLog(config, `Purge requested for key: ${cacheKey}`);
    return handlePurgeRequest(cacheKey, config);
  }

  const cached = await FPC_CACHE.get(cacheKey, { type: 'json' });

  if (cached && cached.expires > Date.now()) {
    const headers = { ...cached.headers, 'X-FPC-Cache': 'HIT' };
    debugLog(config, `Cache HIT for key: ${cacheKey}. Expires in ${(cached.expires - Date.now())/1000 | 0}s`);
    return new Response(cached.body, { headers });
  }

  if (cached) {
    event.waitUntil(fetchAndCache(request, cacheKey, cached, config));
    const headers = { ...cached.headers, 'X-FPC-Cache': 'STALE' };
    debugLog(config, `Cache STALE for key: ${cacheKey}. Stale age ${(Date.now() - cached.expires)/1000 | 0}s`);
    return new Response(cached.body, { headers });
  }

  const response = await fetchAndCache(request, cacheKey, cached, config);

  const headers = new Headers(response.headers);
  headers.set('X-FPC-Cache', 'MISS');
  debugLog(config, `Cache MISS for key: ${cacheKey}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}


function shouldBypassCache(request, config) {
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    debugLog(config, `Bypass reason matched: method is ${request.method} (only GET cached)`);
    return { bypass: true, reason: `method:${request.method}` };
  }
  const matchedPath = (config.excluded_paths || []).find(path => url.pathname.includes(path));
  if (matchedPath) {
    debugLog(config, `Bypass reason matched: excluded_paths contains '${matchedPath}' for pathname '${url.pathname}'`);
    return { bypass: true, reason: `excluded_path:${matchedPath}` };
  }
  return { bypass: false };
}


async function getCacheKey(request, config) {
  const url = new URL(request.url);
  let key = `fpc:${url.hostname}${url.pathname}`;

  const params = new URLSearchParams(url.search);
  const allKeys = Array.from(params.keys());
  let selectedPairs = [];

  const isAll = typeof config.vary_on_params === 'string' && config.vary_on_params.trim() === '*';
  if (isAll) {
    const ignored = new Set(
      (config.ignored_params || []).map(p => String(p).toLowerCase())
    );
    const keptKeys = allKeys
      .filter(k => !ignored.has(k.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
    for (const k of keptKeys) {
      selectedPairs.push(`${k}=${params.get(k)}`);
    }
    debugLog(config, `Vary params mode='*'. kept=${JSON.stringify(keptKeys)}, ignored=${JSON.stringify(Array.from(ignored))}`);
  } else if (Array.isArray(config.vary_on_params) && config.vary_on_params.length > 0) {
    const paramKeys = allKeys;
    for (const p of config.vary_on_params) {
      const matchKey = paramKeys.find(k => k.toLowerCase() === String(p).toLowerCase());
      if (matchKey) {
        selectedPairs.push(`${matchKey}=${params.get(matchKey)}`);
      }
    }
    debugLog(config, `Vary params explicit. used=${JSON.stringify(selectedPairs.map(p => p.split('=')[0]))}`);
  }

  if (selectedPairs.length > 0) {
    key += `?${selectedPairs.join('&')}`;
  }

  if (Array.isArray(config.vary_on_cookies) && config.vary_on_cookies.length > 0) {
    const cookieHeader = request.headers.get('Cookie') || '';
    const cookies = cookieHeader.split(';').map(c => c.trim());
    let varyValues = [];
    for (const cookieName of config.vary_on_cookies) {
      const found = cookies.find(c => c.split('=')[0].trim().toLowerCase() === cookieName.toLowerCase());
      if (found) {
        varyValues.push(found.split('=')[1]);
      } else {
        varyValues.push('');
      }
    }
    if (varyValues.length > 0) {
      key += `#${varyValues.join('_')}`;
    }
    debugLog(config, `Vary cookies: names=${JSON.stringify(config.vary_on_cookies)}, values=${JSON.stringify(varyValues)}`);
  }

  if (Array.isArray(config.vary_on_headers) && config.vary_on_headers.length > 0) {
    let headerValues = [];
    for (const headerName of config.vary_on_headers) {
      const value = request.headers.get(headerName);
      headerValues.push(value || '');
    }
    if (headerValues.length > 0) {
      key += `@${headerValues.join('_')}`;
    }
    debugLog(config, `Vary headers: names=${JSON.stringify(config.vary_on_headers)}, values=${JSON.stringify(headerValues)}`);
  }

  return key;
}


async function fetchAndCache(request, cacheKey, cached, config) {
  const originResponse = await fetch(request);

  if (originResponse.ok && request.method === 'GET') {
    const contentType = originResponse.headers.get('Content-Type') || '';
    debugLog(config, `Origin response: status=${originResponse.status}, content-type='${contentType}'`);

    if (!config.included_mimetypes.some(mime => contentType.startsWith(mime))) {
      debugLog(config, `Skip caching: content-type '${contentType}' not in included_mimetypes ${JSON.stringify(config.included_mimetypes)}`);
      return originResponse; // Return original response without caching
    }

    const responseToCache = originResponse.clone();

    const headers = {};
    for (let [key, value] of responseToCache.headers.entries()) {
      headers[key] = value;
    }

    const body = await responseToCache.text();
    if (body.length < 3) {
      debugLog(config, `Skip caching: body too small (length=${body.length})`);
      return originResponse;
    }

    const cacheData = {
      body: body,
      headers: headers,
      expires: Date.now() + (config.ttl * 1000),
    };

    if (!cached || cached.body !== cacheData.body) { // Avoid redundant writes
      debugLog(config, `Writing to cache. key=${cacheKey}, ttl=${config.ttl}s, grace=${config.grace}s, bodyLen=${body.length}`);
      await FPC_CACHE.put(cacheKey, JSON.stringify(cacheData), { expirationTtl: config.ttl + config.grace });
    } else {
      debugLog(config, `Skip cache write: body unchanged for key=${cacheKey}`);
    }

    return originResponse;
  }

  return originResponse;
}


async function handlePurgeRequest(cacheKey, config) {
  if (!cacheKey) {
    return new Response('Cache key not provided', { status: 400 });
  }
  await FPC_CACHE.delete(cacheKey);
  debugLog(config, `Purged cache key=${cacheKey}`);
  return new Response('Cache purged', { status: 200 });
}
