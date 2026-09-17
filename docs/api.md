# HTTP API

All responses are JSON with `Cache-Control: no-store`. Requests are limited to 8 KiB. The reference process applies a coarse limit of 600 requests per minute per connecting IP; behind a proxy this sees the proxy address, so deploy a suitable proxy-side policy. Unknown body fields and query parameters are rejected.

## Create a match

`POST /matches`, authenticated with `Authorization: Bearer <ADMIN_TOKEN>`:

```json
{"names":["Amber","Blue","Coral","Dusk","Elm"]}
```

Response (`201`):

```json
{"matchId":"<uuid>","seats":[{"playerId":"p1","token":"<random-seat-token>"}]}
```

The real response contains one seat per supplied name. Tokens are returned at creation only. Save and distribute them privately. Names are display strings; a UI must render them as text, not HTML. Clients cannot choose the seed, player IDs, timing, or turn limit.

## Read your view

`GET /matches/<matchId>`, with that player's bearer token. A view includes public map/unit state, version, phase, deadline, settled turn, public outcomes, and a `self` object containing only your private treasury/order/seal state. Conflict entries include your own choice only. Opponent seal state is also omitted.

After the match finishes, final scores become public. These can disclose previously hidden treasury indirectly; that is an explicit rule of this demo.

## Submit a command

`POST /matches/<matchId>/commands`, with the seat bearer token:

```json
{
  "requestId":"client-request-0001",
  "expectedVersion":0,
  "command":{"type":"order","order":{"type":"move","target":1}}
}
```

Other command shapes:

```json
{"type":"order","order":{"type":"collect"}}
```

```json
{"type":"seal"}
```

```json
{"type":"vote","conflictId":"t1-c1","choice":"engage"}
```

A success response contains `{replayed, view}`. Refresh the version before a new command. A stale request returns HTTP 409 and `STALE_VERSION`; do not silently overwrite a newer state. Retry an uncertain request with exactly the same request ID, version, and command. Reusing its ID for another payload returns `IDEMPOTENCY_CONFLICT`.

Request IDs contain 8–100 letters, digits, underscores, or hyphens. Idempotency is scoped to match and player. Replays return the current private view, not a historical snapshot. The server derives player identity from the token, never from a body field.

Commands arriving at/after the deadline are rejected. The scheduler or the next view fetch performs the overdue transition. The client should refresh after `DEADLINE_PASSED`.

## Health and errors

`GET /health` performs a database query and returns `{"status":"ok"}`. It reveals no match information.

Errors use `{"error":{"code":"...","message":"..."}}`. Common statuses: 400 invalid input, 401 bad credentials, 403 inactive/nonparticipant, 404 unknown route, 409 stale/locked/deadline conflict, 413 oversized body, 415 content type, 429 rate limit. Unexpected exceptions return a generic 500 response without database state or stack traces.

## Environment

| Variable | Default |
| --- | --- |
| `ADMIN_TOKEN` | Required random token, at least 32 characters |
| `HOST` | `127.0.0.1` |
| `PORT` | `3000` |
| `DATABASE_PATH` | `./data/engine.sqlite` |
| `PLANNING_MS` | `300000` |
| `CONFLICT_MS` | `180000` |
| `MAX_TURNS` | `20` |

`.env` is loaded from the working directory. Existing process environment values take precedence. Timing values must be integer milliseconds from 100 through 86,400,000; the turn limit is 1–1,000. Settings are stored per match, so later environment changes do not rewrite existing matches.
