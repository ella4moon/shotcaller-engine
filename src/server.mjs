import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { EngineError, requireThat } from './errors.mjs';
function equalSecret(a, b) { const hash = s => createHash('sha256').update(s).digest(); return timingSafeEqual(hash(a), hash(b)); }
async function body(req) {
  requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 'CONTENT_TYPE', 'Use application/json.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; requireThat(size <= 8192, 'BODY_TOO_LARGE', 'Request body exceeds 8 KiB.', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new EngineError('INVALID_JSON', 'Invalid JSON body.'); }
}
export function createHttpServer(service, { adminToken, tickMs = 100, onError = () => {} }) {
  requireThat(typeof adminToken === 'string' && adminToken.length >= 32, 'INVALID_ADMIN_TOKEN', 'Set a random ADMIN_TOKEN of at least 32 characters.');
  const requests = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff');
    const send = (status, data) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    try {
      const now = Date.now(), ip = req.socket.remoteAddress;
      if (requests.size > 1000) requests.clear();
      let quota = requests.get(ip);
      if (!quota || quota.until < now) requests.set(ip, quota = { until: now + 60000, count: 0 });
      requireThat(++quota.count <= 600, 'RATE_LIMIT', 'Too many requests.', 429);
      const url = new URL(req.url, 'http://localhost'); requireThat(!url.search, 'INVALID_QUERY', 'Query parameters are not supported.');
      if (req.method === 'GET' && url.pathname === '/health') { service.store.db.prepare('SELECT 1').get(); return send(200, { status: 'ok' }); }
      const authorization = req.headers.authorization || '', token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (req.method === 'POST' && url.pathname === '/matches') {
        requireThat(equalSecret(token, adminToken), 'UNAUTHORIZED', 'Admin bearer token required.', 401); return send(201, service.create(await body(req)));
      }
      const route = /^\/matches\/([a-f0-9-]{36})(\/commands)?$/.exec(url.pathname);
      requireThat(route, 'NOT_FOUND', 'Route not found.', 404);
      if (req.method === 'GET' && !route[2]) return send(200, service.view(route[1], token));
      if (req.method === 'POST' && route[2]) return send(200, service.command(route[1], token, await body(req)));
      throw new EngineError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
    } catch (error) {
      if (!(error instanceof EngineError)) onError({ code: 'INTERNAL_ERROR' });
      send(error instanceof EngineError ? error.status : 500, { error: { code: error instanceof EngineError ? error.code : 'INTERNAL_ERROR', message: error instanceof EngineError ? error.message : 'Internal server error.' } });
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.timeout = 5000;
  let timer;
  server.on('listening', () => { timer = setInterval(() => { try { service.sweep(); } catch { onError({ code: 'SCHEDULER_ERROR' }); } }, tickMs); timer.unref(); });
  server.on('close', () => clearInterval(timer)); return server;
}
