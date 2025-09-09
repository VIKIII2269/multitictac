import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { saveReplay } from "./replay";

export type Action =
  | { seq: number; type: "start" | "move" | "timeout" | "end"; payload: any; ts: string; rng_seed?: string }
  ;

export type Player = { id: string; socketId?: string; rating?: number };

export class GameEngine extends EventEmitter {
  gameId: string;
  board: number[][]; // 0 empty, 1 player0, 2 player1
  size: number;
  k: number;
  players: [Player, Player];
  turnIndex: 0 | 1;
  actions: Action[] = [];
  seq = 0;
  startedAt?: string;
  endedAt?: string;
  turnTimer?: NodeJS.Timeout;
  turnTimeMs: number;
  metrics: { movesAccepted: number; movesRejected: number } = { movesAccepted: 0, movesRejected: 0 };

  constructor(gameId: string, players: [Player, Player], opts?: { size?: number; k?: number; turnTimeMs?: number }) {
    super();
    this.gameId = gameId;
    this.size = opts?.size ?? 3;
    this.k = opts?.k ?? 3;
    this.turnTimeMs = opts?.turnTimeMs ?? 30000;
    this.players = players;
    this.board = Array.from({ length: this.size }, () => Array(this.size).fill(0));
    // deterministic first player: hash(gameId) % 2
    const h = crypto.createHash("sha256").update(gameId).digest()[0];
    this.turnIndex = (h % 2) as 0 | 1;
  }

  private nextSeq() { this.seq += 1; return this.seq; }

  private record(type: Action["type"], payload: any, rng_seed?: string) {
    const a: Action = { seq: this.nextSeq(), type, payload, ts: new Date().toISOString(), rng_seed };
    this.actions.push(a);
    return a;
  }

  start() {
    this.startedAt = new Date().toISOString();
    const seed = crypto.createHash("sha256").update(this.gameId + this.startedAt).digest("hex");
    this.record("start", { firstPlayer: this.players[this.turnIndex].id }, seed);
    this.emit("game_started", { gameId: this.gameId, players: this.players.map(p => p.id), first: this.players[this.turnIndex].id });
    this.scheduleTimeout();
    this.emitState();
  }

  private scheduleTimeout() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = setTimeout(() => {
      const player = this.players[this.turnIndex];
      const action = this.record("timeout", { playerId: player.id, reason: "turn_timeout" });
      this.metrics.movesRejected += 1;
      this.emit("move_rejected", { reason: "timeout", action });
      // opponent wins by timeout
      this.end({ winner: this.players[1 - this.turnIndex].id, reason: "timeout" });
    }, this.turnTimeMs);
  }

  makeMove(playerId: string, x: number, y: number, moveId?: string) {
    // Validate turn order
    const expected = this.players[this.turnIndex].id;
    if (playerId !== expected) {
      this.metrics.movesRejected += 1;
      const err = { code: "not_your_turn", message: "It's not your turn", expected };
      this.emit("move_rejected", err);
      return { ok: false, error: err };
    }
    // Validate bounds
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) {
      this.metrics.movesRejected += 1;
      const err = { code: "out_of_bounds", message: "Move out of bounds" };
      this.emit("move_rejected", err);
      return { ok: false, error: err };
    }
    // Validate empty
    if (this.board[y][x] !== 0) {
      this.metrics.movesRejected += 1;
      const err = { code: "cell_taken", message: "Cell already occupied" };
      this.emit("move_rejected", err);
      return { ok: false, error: err };
    }
    // Accept move
    const pid = this.turnIndex + 1;
    this.board[y][x] = pid;
    const move = { playerId, x, y, moveId: moveId || uuidv4() };
    const action = this.record("move", move);
    this.metrics.movesAccepted += 1;
    this.emit("move_accepted", action);
    // Check win or draw
    const winner = this.checkWinAt(x, y, pid);
    if (winner) {
      this.end({ winner: playerId, reason: "win" });
    } else if (this.isFull()) {
      this.end({ winner: null, reason: "draw" });
    } else {
      // next turn
      this.turnIndex = 1 - this.turnIndex as 0 | 1;
      this.scheduleTimeout();
      this.emitState();
    }
    return { ok: true, action };
  }

  private isFull() {
    return this.board.every(row => row.every(c => c !== 0));
  }

  private checkWinAt(x: number, y: number, pid: number) {
    // check 4 directions for K contiguous
    const dirs = [
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 1 },
      { dx: 1, dy: -1 }
    ];
    for (const d of dirs) {
      let cnt = 1;
      // forward
      let nx = x + d.dx, ny = y + d.dy;
      while (this.inBounds(nx, ny) && this.board[ny][nx] === pid) { cnt++; nx += d.dx; ny += d.dy; }
      // backward
      nx = x - d.dx; ny = y - d.dy;
      while (this.inBounds(nx, ny) && this.board[ny][nx] === pid) { cnt++; nx -= d.dx; ny -= d.dy; }
      if (cnt >= this.k) return true;
    }
    return false;
  }

  private inBounds(x: number, y: number) {
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  }

  emitState() {
    this.emit("state_update", { board: this.board, currentPlayer: this.players[this.turnIndex].id });
  }

  async end(result: { winner: string | null; reason: string }) {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = undefined; }
    this.endedAt = new Date().toISOString();
    this.record("end", result);
    this.emit("game_ended", { gameId: this.gameId, result });
    // persist replay
    try {
      await saveReplay({
        gameId: this.gameId,
        players: this.players.map(p => p.id),
        createdAt: this.startedAt ?? new Date().toISOString(),
        endedAt: this.endedAt,
        result,
        actionCount: this.actions.length,
        actions: this.actions
      });
    } catch (e) {
      // best-effort logging
      console.error("saveReplay failed", e);
    }
  }

  getState() {
    return { board: this.board, currentPlayer: this.players[this.turnIndex].id, players: this.players.map(p => p.id) };
  }

  getActions() { return this.actions; }
}
