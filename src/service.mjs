import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createMatch, applyCommand, advanceDeadline, playerView } from './engine.mjs';
import { exactKeys, requireThat } from './errors.mjs';
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export class MatchService {
  constructor(store, { now = Date.now, settings = {} } = {}) { this.store = store; this.now = now; this.settings = settings; }
  create(input) {
    exactKeys(input, ['names']);
    const state = createMatch({ id: randomUUID(), names: input.names, seed: randomBytes(16).toString('hex'), now: this.now(), ...this.settings });
    const seats = state.players.map(p => ({ playerId: p.id, token: randomBytes(32).toString('base64url') }));
    this.store.transaction(() => {
      requireThat(this.store.db.prepare('SELECT count(*) AS n FROM matches').get().n < 1000, 'MATCH_LIMIT', 'Database match capacity reached.', 409);
      this.store.db.prepare('INSERT INTO matches VALUES(?,?,?,?,?)').run(state.id, state.version, state.phase, state.deadlineAt, JSON.stringify(state));
      for (const seat of seats) this.store.db.prepare('INSERT INTO seats VALUES(?,?,?)').run(state.id, seat.playerId, tokenHash(seat.token));
    });
    return { matchId: state.id, seats };
  }
  identity(matchId, token) {
    requireThat(typeof token === 'string' && token.length <= 256, 'UNAUTHORIZED', 'Valid bearer token required.', 401);
    const row = this.store.db.prepare('SELECT player_id FROM seats WHERE match_id=? AND token_hash=?').get(matchId, tokenHash(token));
    requireThat(row, 'UNAUTHORIZED', 'Valid bearer token required.', 401); return row.player_id;
  }
  view(id, token) {
    const playerId = this.identity(id, token); this.tick(id);
    return { ...playerView(this.store.load(id), playerId), serverTime: this.now() };
  }
  command(id, token, input) {
    const playerId = this.identity(id, token);
    exactKeys(input, ['requestId', 'expectedVersion', 'command']);
    requireThat(typeof input.requestId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(input.requestId), 'INVALID_REQUEST_ID', 'requestId must be 8-100 letters, digits, underscores or hyphens.');
    requireThat(Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0, 'INVALID_VERSION', 'expectedVersion must be a nonnegative integer.');
    const payload = canonical({ expectedVersion: input.expectedVersion, command: input.command });
    return this.store.transaction(() => {
      const prior = this.store.db.prepare('SELECT payload FROM commands WHERE match_id=? AND player_id=? AND request_id=?').get(id, playerId, input.requestId);
      const state = this.store.load(id);
      if (prior) {
        requireThat(prior.payload === payload, 'IDEMPOTENCY_CONFLICT', 'requestId was already used for another command.', 409);
        return { replayed: true, view: playerView(state, playerId) };
      }
      requireThat(state.version === input.expectedVersion, 'STALE_VERSION', 'Match changed; refresh its view.', 409);
      const updated = applyCommand(state, playerId, input.command, { now: Math.max(this.now(), state.lastTransitionAt) });
      this.store.save(updated, state.version, 'command');
      this.store.db.prepare('INSERT INTO commands VALUES(?,?,?,?,?)').run(id, playerId, input.requestId, payload, updated.version);
      return { replayed: false, view: playerView(updated, playerId) };
    });
  }
  tick(id) {
    return this.store.transaction(() => {
      const state = this.store.load(id), updated = advanceDeadline(state, Math.max(this.now(), state.lastTransitionAt));
      if (updated !== state) this.store.save(updated, state.version, 'deadline');
      return updated;
    });
  }
  sweep() {
    const due = this.store.db.prepare('SELECT id FROM matches WHERE deadline_at <= ? ORDER BY deadline_at,id LIMIT 100').all(this.now());
    for (const row of due) this.tick(row.id);
    return due.length;
  }
}
