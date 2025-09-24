addEventListener('fetch', event => {
  event.respondWith(handleRequest(event));
});


function debugLog(config, ...args) {
  if (config && config.debug) {
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
    "cache_logged_in": true,
    "included_mimetypes": [
      "text/html",
      "text/css",
      "text/javascript",
      "application/javascript",
      "font/",
      "image/svg"
    ],
    "excluded_paths": [
      "/admin",
      "/customer",
      "/checkout",
      "/wishlist",
      "/cart",
      "/sales",
      "/graphql",
      "/rest/",
      "/customer/section/",
      "/customer/account",
      "/customer/address",
      "/customer/orders",
      "/onestepcheckout",
      "/password",
    ],
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
    return request.method === 'HEAD'
      ? new Response(null, { headers })
      : new Response(cached.body, { headers });
  }

  if (cached) {
    event.waitUntil(fetchAndCache(request, cacheKey, cached, config));
    const headers = { ...cached.headers, 'X-FPC-Cache': 'STALE' };
    debugLog(config, `Cache STALE for key: ${cacheKey}. Stale age ${(Date.now() - cached.expires)/1000 | 0}s`);
    return request.method === 'HEAD'
      ? new Response(null, { headers })
      : new Response(cached.body, { headers });
  }

  const response = await fetchAndCache(request, cacheKey, cached, config);

  const headers = new Headers(response.headers);
  headers.set('X-FPC-Cache', 'MISS');
  debugLog(config, `Cache MISS for key: ${cacheKey}`);

  return request.method === 'HEAD' 
    ? new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    })
    : new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
}


function shouldBypassCache(request, config) {
  const url = new URL(request.url);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    debugLog(config, `Bypass reason matched: method is ${request.method} (only GET/HEAD cached)`);
    return { bypass: true, reason: `method:${request.method}` };
  }

  const authz = request.headers.get('Authorization');
  if (authz) {
    debugLog(config, 'Bypass reason matched: Authorization header present');
    return { bypass: true, reason: 'authz' };
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
  const reqUrl = new URL(request.url);
  const isStaticAsset = /\.(?:css|js|mjs|json|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot)(?:\?.*)?$/i.test(reqUrl.pathname);
  const isExcludedPath = (config.excluded_paths || []).some(path => reqUrl.pathname.includes(path));
  const isCacheableHtmlPath = !isStaticAsset && !isExcludedPath;

  const cookieHeader = request.headers.get('Cookie') || '';
  let sanitizedRequest = request;
  if (cookieHeader) {
    const headers = new Headers(request.headers);
    if (isStaticAsset) {
      headers.delete('Cookie');
    } else {
      const allowlist = [
        'X-Magento-Vary',
        'store',
        'currency',
        'form_key',
        'private_content_version',
        'section_data_ids',
        'mage-cache-sessid',
        'mage-cache-storage',
        'mage-cache-storage-section-invalidation'
      ];

      if (config.cache_logged_in && isCacheableHtmlPath) {
        allowlist.push('PHPSESSID');
      }

      const parsed = cookieHeader.split(';').map(c => c.trim());

      const kept = parsed.filter(c => {
        const name = c.split('=')[0].trim();
        return allowlist.some(a => a.toLowerCase() === name.toLowerCase());
      });

      if (kept.length > 0) {
        headers.set('Cookie', kept.join('; '));
      } else {
        headers.delete('Cookie');
      }
    }
    sanitizedRequest = new Request(request, { headers });
  }

  const originResponse = await fetch(sanitizedRequest);

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

    if (/^text\/html/i.test(contentType) && responseToCache.headers.has('Set-Cookie')) {
      delete headers['set-cookie'];
    }

    /*
    const cc = responseToCache.headers.get('Cache-Control') || '';
    if (/(?:no-store|private|no-cache)/i.test(cc)) {
      debugLog(config, `Skip caching: Cache-Control indicates non-cacheable -> '${cc}'`);
      return originResponse;
    }
    */

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
