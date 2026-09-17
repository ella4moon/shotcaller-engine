export class EngineError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function requireThat(condition, code, message, status = 400) {
  if (!condition) throw new EngineError(code, message, status);
}
export function exactKeys(object, keys) {
  requireThat(object && typeof object === 'object' && !Array.isArray(object), 'INVALID_COMMAND', 'Expected an object.');
  requireThat(Object.keys(object).every(key => keys.includes(key)), 'INVALID_COMMAND', 'Unknown field.');
}
