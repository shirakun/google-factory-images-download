import { FIRMWARE_ALLOWLIST } from '../_lib/firmware-allowlist.js';

const DEVICE_RE = /^[a-z0-9._]+$/;
const BUILD_RE = /^[A-Za-z0-9._-]+$/;
const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]+\.zip$/;
const IDLE_TIMEOUT_MS = 90_000;

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function parseRequest(request) {
  const url = new URL(request.url);
  const device = url.searchParams.get('device') ?? '';
  const type = url.searchParams.get('type') ?? '';
  const buildId = url.searchParams.get('buildId') ?? '';

  if (!DEVICE_RE.test(device)) return { error: 'Invalid device', status: 400 };
  if (type !== 'factory' && type !== 'ota') return { error: 'Invalid type', status: 400 };
  if (!BUILD_RE.test(buildId)) return { error: 'Invalid buildId', status: 400 };

  return { key: `${device}:${type}:${buildId}` };
}

function sanitizeFileName(fileName) {
  if (typeof fileName !== 'string') return null;
  if (!SAFE_FILENAME_RE.test(fileName)) return null;
  if (fileName.includes('/') || fileName.includes('\\') || /[\r\n\0]/.test(fileName)) return null;
  return fileName;
}

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') return 'Missing allowlist entry';
  const fileName = sanitizeFileName(entry.fileName);
  if (!fileName) return 'Invalid file name';
  if (!Array.isArray(entry.parts) || entry.parts.length === 0) return 'Missing parts';

  let previous = 0;
  for (const part of entry.parts) {
    if (!Number.isInteger(part.n) || part.n <= previous) return 'Invalid part order';
    previous = part.n;
    if (typeof part.url !== 'string') return 'Invalid part URL';
    if (!part.url.startsWith('https://github.com/')) return 'Part URL is outside GitHub Releases';
    if (!part.url.includes('/releases/download/firmware-')) return 'Part URL is outside firmware releases';
    if (!part.url.endsWith('.part' + String(part.n).padStart(2, '0'))) return 'Part URL suffix mismatch';
    if (!Number.isFinite(part.size) || part.size < 0) return 'Invalid part size';
  }

  if (typeof entry.manifestUrl !== 'string' || !entry.manifestUrl.endsWith('.sha256')) return 'Invalid manifest URL';
  if (entry.expectedSha256 !== null && entry.expectedSha256 !== undefined && !/^[0-9a-f]{64}$/.test(entry.expectedSha256)) {
    return 'Invalid expected SHA-256';
  }
  return null;
}

function contentDisposition(fileName) {
  return `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function streamParts(entry, requestSignal) {
  let partIndex = 0;
  let currentReader = null;
  let idleTimer = null;
  const upstreamAbort = new AbortController();

  const clearIdleTimer = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  };
  const armIdleTimer = () => {
    clearIdleTimer();
    idleTimer = setTimeout(() => upstreamAbort.abort('upstream idle timeout'), IDLE_TIMEOUT_MS);
  };
  const cleanupSignal = () => {
    if (requestSignal) requestSignal.removeEventListener('abort', abortUpstream);
  };
  const abortUpstream = () => upstreamAbort.abort('client disconnected');

  if (requestSignal) requestSignal.addEventListener('abort', abortUpstream, { once: true });

  const openNextReader = async () => {
    if (partIndex >= entry.parts.length) return false;
    const part = entry.parts[partIndex++];
    armIdleTimer();
    const response = await fetch(part.url, {
      redirect: 'follow',
      signal: upstreamAbort.signal,
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    clearIdleTimer();
    if (!response.ok || !response.body) {
      throw new Error(`upstream ${response.status} for part ${part.n}`);
    }
    currentReader = response.body.getReader();
    return true;
  };

  return new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          if (!currentReader) {
            const opened = await openNextReader();
            if (!opened) {
              clearIdleTimer();
              cleanupSignal();
              controller.close();
              return;
            }
          }

          armIdleTimer();
          const { done, value } = await currentReader.read();
          clearIdleTimer();
          if (done) {
            currentReader.releaseLock();
            currentReader = null;
            continue;
          }
          controller.enqueue(value);
          return;
        }
      } catch (error) {
        clearIdleTimer();
        cleanupSignal();
        controller.error(error);
      }
    },
    async cancel() {
      clearIdleTimer();
      upstreamAbort.abort('stream cancelled');
      if (currentReader) {
        await currentReader.cancel().catch(() => undefined);
      }
      cleanupSignal();
    },
  });
}

async function handleGet(context) {
  const parsed = parseRequest(context.request);
  if (parsed.error) return jsonError(parsed.error, parsed.status);

  const entry = FIRMWARE_ALLOWLIST[parsed.key];
  if (!entry) return jsonError('Firmware shard set is not available for merge download', 404);

  const validationError = validateEntry(entry);
  if (validationError) {
    console.error(JSON.stringify({ event: 'invalid_allowlist_entry', key: parsed.key, error: validationError }));
    return jsonError('Merge download is temporarily unavailable', 503);
  }

  const headers = new Headers({
    'content-type': 'application/octet-stream',
    'content-disposition': contentDisposition(entry.fileName),
    'cache-control': 'no-store',
    'x-expected-size': String(entry.expectedSize ?? 0),
  });
  if (Number.isFinite(entry.expectedSize) && entry.expectedSize > 0) {
    headers.set('content-length', String(entry.expectedSize));
  }
  if (entry.expectedSha256) headers.set('x-expected-sha256', entry.expectedSha256);

  return new Response(streamParts(entry, context.request.signal), { headers });
}

export function onRequest(context) {
  if (context.request.method === 'GET') return handleGet(context);
  return jsonError('Method not allowed', 405);
}
