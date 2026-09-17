import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync, existsSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assertInvariants } from './engine.mjs';
import { requireThat } from './errors.mjs';
export class Store {
  constructor(path) {
    this.path = path === ':memory:' ? path : resolve(path);
    if (path !== ':memory:') {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      requireThat(!existsSync(this.path) || !lstatSync(this.path).isSymbolicLink(), 'INVALID_DATABASE', 'Database cannot be a symlink.');
    }
    this.db = new DatabaseSync(this.path);
    if (path !== ':memory:') chmodSync(this.path,0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY) STRICT');
    const versions = this.db.prepare('SELECT version FROM schema_version').all();
    requireThat(versions.every(v=>v.version===1), 'UNSUPPORTED_DATABASE', 'Database schema is newer than this engine.', 500);
    if (!versions.length) this.transaction(() => {
      this.db.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));
      this.db.prepare('INSERT INTO schema_version VALUES(1)').run();
    });
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); requireThat(!result?.then,'ASYNC_TRANSACTION','Transactions must be synchronous.',500); this.db.exec('COMMIT'); return result; }
    catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  load(id) {
    const row=this.db.prepare('SELECT state_json FROM matches WHERE id=?').get(id);
    requireThat(row,'MATCH_NOT_FOUND','Match not found.',404);
    const state=JSON.parse(row.state_json); assertInvariants(state); return state;
  }
  save(state, previousVersion, kind) {
    const result=this.db.prepare('UPDATE matches SET version=?,phase=?,deadline_at=?,state_json=? WHERE id=? AND version=?').run(state.version,state.phase,state.deadlineAt,JSON.stringify(state),state.id,previousVersion);
    requireThat(result.changes===1,'STALE_VERSION','Match changed; refresh its view.',409);
    this.db.prepare('INSERT INTO transitions VALUES(?,?,?,?)').run(state.id,state.version,kind,state.lastTransitionAt);
  }
  close() { this.db.close(); }
}
