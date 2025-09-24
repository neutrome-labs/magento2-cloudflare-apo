addEventListener('fetch', event => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  const request = event.request;
  const config = {
    "ttl": 3600,
    "purge_secret": "true",
    "included_mimetypes": [
      "text/html",
      "application/json",
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

  if (shouldBypassCache(request, config)) {
    return fetch(request);
  }

  const cacheKey = await getCacheKey(request, config);

  if (request.method === 'POST' && request.headers.get('X-Purge-Cache') === config.purge_secret) {
    return handlePurgeRequest(cacheKey);
  }

  const cached = await FPC_CACHE.get(cacheKey, { type: 'json' });

  if (cached && cached.expires > Date.now()) {
    const headers = { ...cached.headers, 'X-FPC-Cache': 'HIT' };
    return new Response(cached.body, { headers });
  }

  if (cached) {
    event.waitUntil(fetchAndCache(request, cacheKey, cached, config));
    const headers = { ...cached.headers, 'X-FPC-Cache': 'STALE' };
    return new Response(cached.body, { headers });
  }

  const response = await fetchAndCache(request, cacheKey, cached, config);

  const headers = new Headers(response.headers);
  headers.set('X-FPC-Cache', 'MISS');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

function shouldBypassCache(request, config) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return true;
  if (config.excluded_paths.some(path => url.pathname.includes(path))) return true;
  return false;
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
  } else if (Array.isArray(config.vary_on_params) && config.vary_on_params.length > 0) {
    const paramKeys = allKeys;
    for (const p of config.vary_on_params) {
      const matchKey = paramKeys.find(k => k.toLowerCase() === String(p).toLowerCase());
      if (matchKey) {
        selectedPairs.push(`${matchKey}=${params.get(matchKey)}`);
      }
    }
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
  }

  return key;
}

async function fetchAndCache(request, cacheKey, cached, config) {
  const originResponse = await fetch(request);

  if (originResponse.ok && request.method === 'GET') {
    const contentType = originResponse.headers.get('Content-Type') || '';

    if (!config.included_mimetypes.some(mime => contentType.startsWith(mime))) {
      return originResponse; // Return original response without caching
    }

    const responseToCache = originResponse.clone();

    const headers = {};
    for (let [key, value] of responseToCache.headers.entries()) {
      headers[key] = value;
    }

    const body = await responseToCache.text();
    if (body.length < 3) {
      return originResponse;
    }

    const cacheData = {
      body: body,
      headers: headers,
      expires: Date.now() + (config.ttl * 1000),
    };

    if (!cached || cached.body !== cacheData.body) { // Avoid redundant writes
      await FPC_CACHE.put(cacheKey, JSON.stringify(cacheData));
    }

    return originResponse;
  }

  return originResponse;
}

async function handlePurgeRequest(cacheKey) {
  if (!cacheKey) {
    return new Response('Cache key not provided', { status: 400 });
  }
  await FPC_CACHE.delete(cacheKey);
  return new Response('Cache purged', { status: 200 });
}
