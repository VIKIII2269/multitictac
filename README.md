# TTT Authoritative Server — Tic-Tac-Toe (Authoritative, Deterministic, Replayable)

Authoritative Tic-Tac-Toe server (3×3, K=3) with matchmaking, deterministic replay recording, and WebSocket realtime events.
This repository contains a compact, runnable TypeScript implementation of a server that enforces turn rules, validates moves, records deterministic action logs, supports Redis (or in-memory) matchmaking, and exposes HTTP + WebSocket endpoints for game lifecycle and replay playback.

---

## Table of Contents

* [Highlights](#highlights)
* [Architecture](#architecture)
* [Features](#features)
* [Deterministic Replay Format](#deterministic-replay-format)
* [Prerequisites](#prerequisites)
* [Environment variables](#environment-variables)
* [Quickstart (local)](#quickstart-local)
* [Docker (optional)](#docker-optional)
* [API Endpoints](#api-endpoints)
* [WebSocket: `/game` namespace & Events](#websocket-game-namespace--events)
* [Matchmaking](#matchmaking)
* [Optimistic client reconciliation (snippet)](#optimistic-client-reconciliation-snippet)
* [Determinism & RNG](#determinism--rng)
* [Testing](#testing)
* [Observability & Metrics](#observability--metrics)
* [Troubleshooting](#troubleshooting)
* [Extending this MVP](#extending-this-mvp)
* [Contributing](#contributing)
* [License](#license)

---

## Highlights

* **Authoritative server:** server is the source of truth — validates every move and enforces turn/time rules.
* **Deterministic replays:** action logs with monotonically increasing `seq` allow exact replay.
* **Matchmaking:** Redis FIFO queue (with in-memory fallback for dev).
* **Realtime:** WebSocket realtime events via `socket.io`.
* **Tests:** Jest unit tests for the game engine.
* **Replay playback:** HTTP endpoints to fetch and stream replays.

---

## Architecture

* **Server:** Node + TypeScript + Express + `socket.io`
* **Persistence:** MongoDB (Mongoose) for storing replays (best-effort; saves only when connected)
* **Queue:** Redis (`ioredis`) FIFO; in-memory fallback if Redis unavailable
* **Game Engine:** authoritative, deterministic, emits events, enforces timeouts
* **Clients:** connect to `/game` namespace, listen for server events and optionally do optimistic UI updates

---

## Features

* Enforces turn order, in-bounds, and empty cell checks.
* Turn timeout (default 30s) — opponent wins on timeout (configurable via env).
* Emits events:

  * `game_started`, `state_update`, `move_accepted`, `move_rejected`, `game_ended`
* Deterministic action log recorded per game:

  * actions: `start`, `move`, `timeout`, `end` with `seq`, `ts`
  * deterministic RNG seed (sha256 of `gameId + createdAt`) if randomness is used
* Matchmaking via `matchmaking.enqueue()` and periodic pairing loop
* Replay endpoints (fetch & playback stream)

---

## Deterministic Replay Format

A replay saved in Mongo is a JSON object:

```json
{
  "gameId": "string",
  "players": ["A","B"],
  "createdAt": "ISO timestamp",
  "endedAt": "ISO timestamp",
  "result": { "winner": "A|null", "reason": "win|draw|timeout" },
  "actionCount": 5,
  "actions": [
    { "seq": 1, "type": "start",  "payload": { "firstPlayer": "A" }, "ts": "..." },
    { "seq": 2, "type": "move",   "payload": { "playerId":"A","x":0,"y":0,"moveId":"..." }, "ts": "..." },
    { "seq": 3, "type": "move",   "payload": { "playerId":"B","x":1,"y":0,"moveId":"..." }, "ts": "..." },
    { "seq": 4, "type": "move",   "payload": { "playerId":"A","x":0,"y":1,"moveId":"..." }, "ts": "..." },
    { "seq": 5, "type": "end",    "payload": { "winner": "A", "reason": "win" }, "ts": "..." }
  ]
}
```

**Notes**

* `seq` is monotonically increasing and starts at 1.
* `type` ∈ {`start`, `move`, `timeout`, `end`}.
* `rng_seed` included in `start` if randomness is used; seed is `sha256(gameId + createdAt)`.
* Replayer must apply actions in ascending `seq` to reconstruct the exact game state.

(See `docs/replay_format.md` for full description.)

---

## Prerequisites

* Node 18+ / npm
* (Optional) MongoDB for persistent replay storage
* (Optional) Redis for matchmaking queue
* Recommended: `ts-node-dev` for local TypeScript development

---

## Environment variables

Copy `.env.example` to `.env` and edit as needed:

```
PORT=4000
MONGO_URL=mongodb://localhost:27017/ttt
REDIS_URL=redis://localhost:6379
AUTH_SECRET=dev_secret
TURN_TIME_MS=30000
```

* `MONGO_URL` — if empty or Mongo unreachable, replays will be skipped (in-memory behavior).
* `REDIS_URL` — if empty or Redis unreachable, matchmaking uses in-memory queue.
* `AUTH_SECRET` — simple token used for socket auth (mocked).

---

## Quickstart (local)

1. Install dependencies:

```bash
npm install
```

2. Copy env:

```bash
cp .env.example .env
# edit .env if needed
```

3. Start dev server:

```bash
npm run start
```

Server listens on `PORT` (default `4000`). If Mongo/Redis are not running, the server falls back to in-memory behaviors (replays will not persist).

---

## Docker (optional)

Create a `docker-compose.yml` like the snippet below to run with Mongo + Redis:

```yaml
version: '3.8'
services:
  app:
    build: .
    command: npm run start
    ports:
      - "4000:4000"
    env_file:
      - .env
    depends_on:
      - mongo
      - redis

  mongo:
    image: mongo:6
    restart: unless-stopped
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db

  redis:
    image: redis:7
    restart: unless-stopped
    ports:
      - "6379:6379"

volumes:
  mongo-data:
```

Then:

```bash
docker-compose up --build
```

---

## API Endpoints

* **POST** `/api/create-game`
  Create an immediate game with two players.
  Request JSON: `{ "players": ["playerA", "playerB"] }`
  Response: `{ "gameId": "..." }`

* **GET** `/api/games/:id`
  Get in-memory game status (if still in memory). Returns players, timestamps, actionCount.

* **GET** `/api/replay/:gameId`
  Return stored replay JSON (requires Mongo connected). If Mongo offline, returns 500 or 404.

* **GET** `/replay/playback/:gameId`
  Streams stored replay actions as a JSON actions array (useful to stream to a replay UI).

---

## WebSocket: `/game` namespace & Events

Clients connect to the `socket.io` server and use the `/game` namespace. Include `auth.token` equal to `AUTH_SECRET`.

### Connect (client)

```ts
import { io } from "socket.io-client";
const socket = io("http://localhost:4000/game", { auth: { token: "dev_secret" } });
```

### Client → Server (RPC)

* `enqueue` — `{ playerId, rating? }` → places player into matchmaking queue.
* `join_game` — `{ gameId, playerId }` → join the socket room for that game.
* `make_move` — `{ gameId, playerId, x, y, moveId? }` → attempt to make a move.

### Server → Clients (events)

* `matched` — `{ gameId, opponent }` (sent to enqueued sockets on match)
* `joined` — `{ gameId, playerId, state }` (ack after `join_game`)
* `game_started` — `{ gameId, players, first }`
* `state_update` — `{ board, currentPlayer }`
* `move_accepted` — action object for the accepted move
* `move_rejected` — `{ code, message, ... }`
* `game_ended` — `{ gameId, result }`

---

## Matchmaking

* Public API: `matchmaking.enqueue({ playerId, rating?, socketId })`.
* Uses Redis list (FIFO) under key `ttt:matchmaking:queue`. If Redis unreachable, in-memory queue used.
* A periodic pairing loop runs (every 500ms in the sample server); when two players are dequeued they are matched into a new `GameEngine`.

---

## Optimistic Client Reconciliation (example)

Clients can optimistically render a local move for snappy UX but must reconcile with server authoritative updates.

```ts
// optimistic-reconcile.ts (concept)
type OptimisticMove = { moveId: string; x: number; y: number; playerId: string };

let optimisticQueue: OptimisticMove[] = [];

function sendMove(socket, gameId, playerId, x, y) {
  const moveId = generateUuid();
  optimisticQueue.push({ moveId, x, y, playerId });
  // render immediately on client UI (optimistic)
  applyLocalMoveToUi(playerId, x, y, moveId);

  socket.emit("make_move", { gameId, playerId, x, y, moveId });
}

// reconcile when server confirms authoritative action or state_update arrives
socket.on("move_accepted", (action) => {
  // remove matching optimistic move by moveId (if present)
  optimisticQueue = optimisticQueue.filter(m => m.moveId !== action.payload.moveId);
  // update UI using authoritative board from state_update or action
});

socket.on("move_rejected", (err) => {
  // if a previously optimistic move was rejected, rollback the UI for that move
  rollbackLastOptimisticMove(err);
});

socket.on("state_update", (state) => {
  // authoritative snapshot — re-render board
  renderBoard(state.board);
  // reapply any outstanding optimistic moves on top of authoritative state
  for (const m of optimisticQueue) {
    if (cellIsEmpty(state.board, m.x, m.y)) applyLocalMoveToUi(m.playerId, m.x, m.y, m.moveId);
  }
});
```

**Key points**

* Each optimistic move includes a unique `moveId`.
* Server responses (`move_accepted`/`move_rejected` and `state_update`) are authoritative.
* Client keeps an optimistic queue and replays outstanding optimistic moves after each authoritative state update.

---

## Determinism & RNG

* First player chosen deterministically by `sha256(gameId)[0] % 2`.
* If future rules use randomness, seed RNG with `sha256(gameId + createdAt)` and record `rng_seed` in the `start` action. Using the same seed ensures deterministic behavior on replay.

---

## Testing

* Unit tests (Jest) located under `src/tests/` — run:

```bash
npm test
```

* Tests cover move validation, turn enforcement, win detection, and deterministic action sequencing.

> Note: The full spec requested Playwright E2E tests. This MVP includes Jest unit tests. You can add Playwright tests in an `e2e/` directory that spin up server and use `socket.io-client` or browser clients to perform full match flows.

---

## Observability & Metrics

* Basic console logging is present (startup, game end, errors).
* Metric stubs exist in the engine (`metrics.movesAccepted / movesRejected`). Hook a metrics backend (Prometheus, Datadog) by incrementing counters where those stubs are updated.

---

## Troubleshooting

* **Mongo not saving replays:** Ensure `MONGO_URL` is correct and server logs `Mongo connected`. Without Mongo, replays are skipped and a warning is printed.
* **Redis not matching:** If `REDIS_URL` invalid, server falls back to in-memory queue (process-lifetime only).
* **Auth errors on socket:** Make sure the client supplies `auth.token` equal to `AUTH_SECRET`.

---

## Extending this MVP

* Add persistent player profiles & ELO rating updates.
* Add robust matchmaking (rating windows, skill buckets, timeouts).
* Add replay playback UI (frontend) that fetches `/replay/:gameId` and steps through `actions`.
* Add Playwright E2E tests that spin up server, simulate two client sockets, and verify end-to-end flow (matching → game → replay saved).
* Add persistent game state cache (Redis) for long-running scalability and horizontal server instances.

---

## Contributing

Contributions welcome. Please open issues or PRs with focused changes (engine, matchmaking, persistence, tests). Keep changes small and well-tested.

---

## License

MIT
