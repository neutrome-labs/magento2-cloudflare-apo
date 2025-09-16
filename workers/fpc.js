addEventListener('fetch', event => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  const request = event.request;

  const config = await FPC_CONFIG.get('config', { type: 'json' });

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
    event.waitUntil(fetchAndCache(request, cacheKey, config));
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
  if (config.excluded_paths.some(path => url.pathname.startsWith(path))) return true;
  return false;
}

async function getCacheKey(request, config) {
  const url = new URL(request.url);
  let key = `fpc:${url.hostname}${url.pathname}`;

  // Vary cache by specified query parameters
  const params = new URLSearchParams(url.search);
  const sortedParams = [];
  for (const p of config.vary_on_params) {
    if (params.has(p)) {
      sortedParams.push(`${p}=${params.get(p)}`);
    }
  }
  if (sortedParams.length > 0) {
    key += `?${sortedParams.join('&')}`;
  }

  // Vary cache by cookie values (array)
  if (Array.isArray(config.vary_on_cookies) && config.vary_on_cookies.length > 0) {
    const cookieHeader = request.headers.get('Cookie') || '';
    const cookies = cookieHeader.split(';').map(c => c.trim());
    let varyValues = [];
    for (const cookieName of config.vary_on_cookies) {
      const found = cookies.find(c => c.startsWith(`${cookieName}=`));
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

  return key;
}

async function fetchAndCache(request, cacheKey, cached, config) {
  const originResponse = await fetch(request);

  // Only process successful GET requests for caching
  if (originResponse.ok && request.method === 'GET') {
    const contentType = originResponse.headers.get('Content-Type') || '';

    // Check if the content type is in the list of cacheable types.
    if (!config.included_mimetypes.some(mime => contentType.startsWith(mime))) {
      return originResponse; // Return original response without caching
    }

    // We need to clone the response to be able to read its body for caching
    // and still return the original response to the client.
    const responseToCache = originResponse.clone();

    const headers = {};
    for (let [key, value] of responseToCache.headers.entries()) {
      headers[key] = value;
    }

    const body = await responseToCache.text();
    const cacheData = {
      body: body,
      headers: headers,
      expires: Date.now() + (config.ttl * 1000),
    };

    // Store the cache data as a JSON string.
    if (!cached || cached.body !== cacheData.body) { // Avoid redundant writes
      await FPC_CACHE.put(cacheKey, JSON.stringify(cacheData));
    }

    // Return the original response. Its body is still intact and can be streamed.
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
