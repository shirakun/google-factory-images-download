// Same-origin download proxy for sharded firmware entries.
//
// A sharded entry only exists because GitHub caps release assets at 2 GB. The
// Original image on dl.google.com is a single file, so this Function streams it
// to the browser instead of merging release parts. Only canonical AOSP firmware
// filenames are accepted; Range/HEAD pass through so downloads can resume.

const UPSTREAM = 'https://dl.google.com';
const AOSP_PREFIX = '/dl/android/aosp/';
const FILE_RE = /^[a-z0-9._]+-(?:[A-Za-z0-9._]+-factory|ota-[A-Za-z0-9._]+)-[0-9a-f]{8}\.zip$/;
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'set-cookie',
]);

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonError('method not allowed', 405);
  }

  const file = new URL(request.url).searchParams.get('file') ?? '';
  if (!FILE_RE.test(file)) return jsonError('invalid firmware file', 400);

  const inbound = new Headers();
  for (const h of ['range', 'if-range', 'if-none-match', 'if-modified-since', 'accept']) {
    const value = request.headers.get(h);
    if (value) inbound.set(h, value);
  }
  inbound.set('user-agent', request.headers.get('user-agent') || 'firmware-browser/download-proxy');
  // Keep the body byte-exact so Content-Length and Range math stay honest.
  inbound.set('accept-encoding', 'identity');

  let upstream;
  try {
    upstream = await fetch(UPSTREAM + AOSP_PREFIX + file, {
      method: request.method,
      headers: inbound,
      redirect: 'follow',
    });
  } catch (error) {
    return jsonError(`upstream fetch failed: ${String(error)}`, 502);
  }

  const headers = new Headers();
  for (const [key, value] of upstream.headers) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  }
  headers.set('cache-control', 'no-store');
  if (!headers.has('content-disposition')) {
    headers.set('content-disposition', `attachment; filename="${file}"`);
  }

  if (request.method === 'HEAD') {
    return new Response(null, { status: upstream.status, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
