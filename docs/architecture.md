# Architecture

## Pure engine

`createMatch()` creates plain JSON state. `applyCommand()` and `advanceDeadline()` return a new state after a successful transition; rejected commands cannot mutate the original. A deadline check with no work returns the original object. Time is explicit, making deterministic tests possible. The production service supplies the clock and clamps backwards wall-clock movement to the last stored transition time.

The state machine is planning → conflict (when needed) → planning/finished. The pending record holds the exact turn and snapshotted orders while conflict decisions are outstanding. `settledTurn` identifies the last settled turn. Invariants reject duplicate occupancy, invalid unit positions/treasuries, and inconsistent phase state.

## SQL boundary

Each command runs inside `BEGIN IMMEDIATE`. Its sequence is: read idempotency receipt, load state, verify version, compute transition, update state using a version predicate, insert transition index, insert command receipt, commit. Failure at any point rolls back all writes. A test injects a failing SQL trigger to verify this behavior.

SQLite runs in WAL mode with foreign keys, a busy timeout, and FULL synchronous mode. The JSON snapshot is authoritative; indexed SQL columns support due-match queries. Seat tokens are random 256-bit capabilities stored only as SHA-256 hashes. This differs from passwords: fast hashing is appropriate for high-entropy random tokens, not human passwords.

## Privacy boundary

`playerView()` constructs an allowlisted response rather than removing a handful of secret keys from a full snapshot. The HTTP layer never serializes raw engine state. No opponent treasury, order, seal status, or conflict choice is included. API error messages do not embed snapshots.

The administrator who creates a match receives all seat tokens once and is trusted with them. Protect that administrative capability; this reference API is not an untrusted public lobby service.

## Recovery and concurrency

Startup and a periodic scheduler look up due matches. Each overdue phase is advanced transactionally. Recovery opens a new deadline relative to the current time, so downtime does not skip future decision windows. A second tick at the same time does nothing. Pending votes remain in SQLite across process restarts.

There is one authoritative process. Transactions and versions protect requests inside this topology, but the project does not claim distributed clock coordination or multi-leader safety. A synchronous SQLite connection is an intentional small-server tradeoff; long blocking custom rules would delay all matches.

## Extension points and limits

Use the exported engine functions for another transport. Use `MatchService` with an injected clock for simulations. A different storage adapter would need to preserve transactional state/receipt semantics, not merely implement JSON reads and writes.

The public demo has one unit per player, which makes connected conflict groups inspectable. A richer multi-unit ruleset, durable event replay, WebSockets, archival, account management, and token rotation are separate extensions. They are not hidden behind empty interfaces in V1.
