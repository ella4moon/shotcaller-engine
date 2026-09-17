CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  phase TEXT NOT NULL,
  deadline_at INTEGER,
  state_json TEXT NOT NULL CHECK(json_valid(state_json))
) STRICT;
CREATE INDEX due_matches ON matches(deadline_at) WHERE deadline_at IS NOT NULL;
CREATE TABLE seats (
  match_id TEXT NOT NULL REFERENCES matches(id),
  player_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  PRIMARY KEY(match_id, player_id)
) STRICT;
CREATE TABLE commands (
  match_id TEXT NOT NULL REFERENCES matches(id),
  player_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  resulting_version INTEGER NOT NULL,
  PRIMARY KEY(match_id, player_id, request_id)
) STRICT;
CREATE TABLE transitions (
  match_id TEXT NOT NULL REFERENCES matches(id),
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY(match_id, version)
) STRICT;
