import { createHash } from 'node:crypto';
import { exactKeys, requireThat } from './errors.mjs';
const active = state => state.players.filter(p => p.alive);
const player = (state, id) => state.players.find(p => p.id === id);
export function createMatch({ id, names, seed = 'demo', now = Date.now(), planningMs = 300000, conflictMs = 180000, maxTurns = 20 }) {
  requireThat(typeof id === 'string' && id.length <= 100 && id.length > 0, 'INVALID_MATCH', 'Invalid match ID.');
  requireThat(Array.isArray(names) && names.length >= 2 && names.length <= 5 && names.every(n => typeof n === 'string' && n.trim().length > 0 && n.length <= 40), 'INVALID_PLAYERS', 'Provide two to five names, each 1–40 characters.');
  requireThat(new Set(names.map(n => n.trim())).size === names.length, 'INVALID_PLAYERS', 'Names must be distinct.');
  requireThat(typeof seed === 'string' && seed.length <= 100, 'INVALID_SEED', 'Invalid seed.');
  requireThat([now, planningMs, conflictMs, maxTurns].every(Number.isSafeInteger) && now >= 0 && planningMs >= 100 && conflictMs >= 100 && maxTurns >= 1 && maxTurns <= 1000 && planningMs <= 86400000 && conflictMs <= 86400000, 'INVALID_CLOCK', 'Invalid timing or turn limit.');
  const players = names.map((name, i) => ({ id: `p${i+1}`, name: name.trim(), position: i*2, alive: true, treasury: 0, order: null, sealed: false }));
  const districts = Array.from({ length: names.length * 2 }, (_, i) => ({ id: i, ownerId: players[Math.floor(i/2)].id, income: 1 + createHash('sha256').update(`${seed}:${i}`).digest()[0] % 3 }));
  return { schemaVersion: 1, id, seed, version: 0, phase: 'planning', turn: 1, settledTurn: 0, lastTransitionAt: now, deadlineAt: now + planningMs,
    settings: { planningMs, conflictMs, maxTurns }, players, districts, conflicts: [], pending: null, events: [], winners: [], scores: null };
}
function neighbor(state, from, to) { const n = state.districts.length; return (from+1)%n === to || (from+n-1)%n === to; }
function currentTime(state, now) {
  requireThat(Number.isSafeInteger(now) && now >= state.lastTransitionAt, 'CLOCK_REGRESSION', 'Server clock moved backwards.', 409);
  return now;
}
function event(state, type, fields = {}) { state.events.push({ turn: state.turn, type, ...fields }); }
function finishTurn(state, now) {
  const turn = state.turn;
  for (const p of active(state)) {
    const order = state.pending.orders[p.id];
    if (order.type === 'collect') p.treasury += state.districts[p.position].income;
  }
  state.settledTurn = turn;
  state.pending = null; state.conflicts = [];
  for (const p of state.players) { p.order = null; p.sealed = false; }
  if (active(state).length <= 1 || turn >= state.settings.maxTurns) {
    state.phase = 'finished'; state.deadlineAt = null;
    state.scores = Object.fromEntries(state.players.map(p => [p.id, p.alive ? p.treasury + state.districts.filter(d => d.ownerId === p.id).length * 2 : 0]));
    const living = active(state);
    const best = Math.max(...living.map(p => state.scores[p.id]));
    state.winners = living.filter(p => state.scores[p.id] === best).map(p => p.id);
    event(state, 'finished', { winners: state.winners });
  } else {
    state.turn++; state.phase = 'planning'; state.deadlineAt = now + state.settings.planningMs;
  }
}
function eliminate(state, id) {
  const p = player(state, id); p.alive = false; p.position = null;
  event(state, 'eliminated', { playerId: id });
}
function arrive(state, id, to) {
  const p = player(state, id), from = p.position;
  p.position = to; state.districts[to].ownerId = id;
  event(state, 'moved', { playerId: id, from, to });
}
function settleConflicts(state, now) {
  const involved = new Set();
  for (const conflict of state.conflicts) {
    conflict.participants.forEach(id => involved.add(id));
    const attackers = conflict.participants.filter(id => conflict.choices[id] === 'engage');
    if (attackers.length === 1) {
      const winner = attackers[0];
      conflict.participants.filter(id => id !== winner).forEach(id => eliminate(state, id));
      const order = state.pending.orders[winner];
      if (['move','attack'].includes(order.type)) arrive(state, winner, order.target);
      event(state, 'conflict_resolved', { conflictId: conflict.id, result: 'sole_engager', survivor: winner });
    } else if (attackers.length > 1) {
      conflict.participants.forEach(id => eliminate(state, id));
      event(state, 'conflict_resolved', { conflictId: conflict.id, result: 'mutual_elimination' });
    } else event(state, 'conflict_resolved', { conflictId: conflict.id, result: 'withdrawn' });
  }
  for (const p of active(state)) {
    const order = state.pending.orders[p.id];
    if (!involved.has(p.id) && ['move','attack'].includes(order.type)) arrive(state, p.id, order.target);
  }
  finishTurn(state, now);
}
function beginResolution(state, now) {
  state.events = [];
  const living = active(state);
  const orders = Object.fromEntries(living.map(p => [p.id, p.sealed && p.order ? structuredClone(p.order) : { type: 'hold' }]));
  state.pending = { turn: state.turn, orders };
  // Connect all competing intents using starting occupancy. Each unit resolves once.
  const links = new Map(living.map(p => [p.id, new Set()]));
  const connect = (a,b) => { if (a !== b) { links.get(a).add(b); links.get(b).add(a); } };
  const movers = living.filter(p => ['move','attack'].includes(orders[p.id].type));
  for (const a of movers) {
    const target = orders[a.id].target;
    for (const b of living) if (b.position === target) connect(a.id,b.id);
    for (const b of movers) if (orders[b.id].target === target) connect(a.id,b.id);
  }
  const visited = new Set();
  for (const p of living) {
    if (visited.has(p.id) || !links.get(p.id).size) continue;
    const pending = [p.id], participants = [];
    while (pending.length) {
      const id = pending.pop(); if (visited.has(id)) continue;
      visited.add(id); participants.push(id); pending.push(...links.get(id));
    }
    participants.sort();
    state.conflicts.push({ id: `t${state.turn}-c${state.conflicts.length+1}`, participants, choices: {} });
  }
  if (state.conflicts.length) { state.phase = 'conflict'; state.deadlineAt = now + state.settings.conflictMs; }
  else settleConflicts(state, now);
}
export function applyCommand(original, playerId, command, { now = Date.now() } = {}) {
  currentTime(original, now);
  requireThat(original.phase !== 'finished', 'MATCH_FINISHED', 'Match has finished.', 409);
  requireThat(now < original.deadlineAt, 'DEADLINE_PASSED', 'The decision deadline has passed.', 409);
  const p = player(original, playerId);
  requireThat(p?.alive, 'PLAYER_INACTIVE', 'Player is not active in this match.', 403);
  exactKeys(command, command?.type === 'order' ? ['type','order'] : command?.type === 'vote' ? ['type','conflictId','choice'] : ['type']);
  const state = structuredClone(original), self = player(state, playerId);
  if (command.type === 'order') {
    requireThat(state.phase === 'planning' && !self.sealed, 'ORDER_LOCKED', 'Orders require an unsealed planning turn.', 409);
    exactKeys(command.order, ['type','target']);
    const order = command.order;
    requireThat(['hold','collect','move','attack'].includes(order.type), 'INVALID_ORDER', 'Unknown order type.');
    if (['move','attack'].includes(order.type)) {
      requireThat(Number.isInteger(order.target) && order.target >= 0 && order.target < state.districts.length && neighbor(state,self.position,order.target), 'INVALID_TARGET', 'Target must be an adjacent district.');
      if (order.type === 'attack') requireThat(state.players.some(q => q.alive && q.id !== self.id && q.position === order.target), 'INVALID_TARGET', 'Attack requires an occupied enemy district.');
    } else requireThat(!Object.hasOwn(order,'target'), 'INVALID_ORDER', 'Hold and collect have no target.');
    self.order = structuredClone(order);
  } else if (command.type === 'seal') {
    requireThat(state.phase === 'planning' && !self.sealed, 'ORDER_LOCKED', 'Planning order is already sealed or unavailable.', 409);
    self.order ||= { type: 'hold' }; self.sealed = true;
    // Everyone sealing is NOT authority to shorten the deadline.
  } else if (command.type === 'vote') {
    requireThat(state.phase === 'conflict', 'WRONG_PHASE', 'No conflict vote is open.', 409);
    const conflict = state.conflicts.find(c => c.id === command.conflictId);
    requireThat(conflict?.participants.includes(self.id), 'NOT_PARTICIPANT', 'Player is not part of this conflict.', 403);
    requireThat(['engage','withdraw'].includes(command.choice), 'INVALID_CHOICE', 'Choose engage or withdraw.');
    requireThat(!Object.hasOwn(conflict.choices,self.id), 'VOTE_LOCKED', 'A submitted choice cannot be changed.', 409);
    conflict.choices[self.id] = command.choice;
    if (state.conflicts.every(c => c.participants.every(id => Object.hasOwn(c.choices,id)))) settleConflicts(state,now);
  } else requireThat(false,'INVALID_COMMAND','Unknown command type.');
  state.version++; state.lastTransitionAt = now;
  assertInvariants(state); return state;
}
export function advanceDeadline(original, now = Date.now()) {
  currentTime(original, now);
  if (original.phase === 'finished' || now < original.deadlineAt) return original;
  const state = structuredClone(original);
  if (state.phase === 'planning') beginResolution(state,now);
  else settleConflicts(state,now); // Missing votes mean withdraw.
  state.version++; state.lastTransitionAt = now;
  assertInvariants(state); return state;
}
export function playerView(state, playerId) {
  const self = player(state, playerId);
  requireThat(self, 'NOT_PARTICIPANT', 'Player does not belong to this match.', 403);
  return {
    id: state.id, version: state.version, phase: state.phase, turn: state.turn, settledTurn: state.settledTurn,
    deadlineAt: state.deadlineAt, selfId: self.id, winners: [...state.winners], scores: state.scores ? { ...state.scores } : null,
    districts: state.districts.map(d => ({ id:d.id, ownerId:d.ownerId, income:d.income })),
    players: state.players.map(p => ({ id:p.id, name:p.name, alive:p.alive, position:p.position })),
    self: { treasury:self.treasury, order:structuredClone(self.order), sealed:self.sealed },
    conflicts: state.conflicts.map(c => ({ id:c.id, participants:[...c.participants], selfChoice:c.choices[playerId] || null })),
    events: structuredClone(state.events),
  };
}
export function assertInvariants(state) {
  requireThat(state.schemaVersion === 1, 'UNSUPPORTED_STATE', 'Unsupported state version.', 500);
  const living = active(state);
  requireThat(new Set(living.map(p => p.position)).size === living.length, 'INVARIANT', 'Duplicate unit occupancy.', 500);
  requireThat(state.players.every(p => p.alive ? Number.isInteger(p.position) && p.position >= 0 && p.position < state.districts.length : p.position === null), 'INVARIANT', 'Invalid unit position.', 500);
  requireThat(state.players.every(p => Number.isSafeInteger(p.treasury) && p.treasury >= 0), 'INVARIANT', 'Invalid treasury.', 500);
  requireThat(state.settledTurn <= state.turn && (state.phase === 'conflict') === !!state.pending && (state.phase === 'finished') === (state.deadlineAt === null), 'INVARIANT', 'Invalid phase state.', 500);
}
