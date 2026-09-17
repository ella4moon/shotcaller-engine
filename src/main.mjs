import { loadEnvFile } from 'node:process';
import { Store } from './store.mjs';
import { MatchService } from './service.mjs';
import { createHttpServer } from './server.mjs';
import { createMatch } from './engine.mjs';
try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1-65535.');
const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken || adminToken.startsWith('replace-') || adminToken.length < 32) throw new Error('Set ADMIN_TOKEN; see .env.example.');
const settings = { planningMs: Number(process.env.PLANNING_MS || 300000), conflictMs: Number(process.env.CONFLICT_MS || 180000), maxTurns: Number(process.env.MAX_TURNS || 20) };
createMatch({ id: 'startup-check', names: ['A', 'B'], ...settings });
const store = new Store(process.env.DATABASE_PATH || './data/engine.sqlite'), service = new MatchService(store, { settings });
service.sweep();
const server = createHttpServer(service, { adminToken, onError: message => console.error(JSON.stringify(message)) });
server.on('error', () => { console.error('Server failed to listen. Check host/port.'); store.close(); process.exitCode = 1; });
server.listen(port, host, () => console.log(JSON.stringify({ event: 'listening', host, port })));
let stopping = false;
for (const name of ['SIGINT', 'SIGTERM']) process.on(name, () => {
  if (stopping) return; stopping = true;
  server.close(() => { store.close(); process.exitCode = 0; }); server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), 5000).unref();
});
