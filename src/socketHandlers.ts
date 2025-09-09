import { Server, Socket } from "socket.io";
import { GameEngine } from "./game/engine";
import { Matchmaker } from "./matchmaking";

type GamesMap = Map<string, GameEngine>;
const AUTH_SECRET = process.env.AUTH_SECRET || "dev_secret";

export function registerSocketHandlers(io: Server, matchmaker: Matchmaker, games: GamesMap) {
  const nsp = io.of("/game");
  nsp.on("connection", (socket: Socket) => {
    const token = (socket.handshake.auth && socket.handshake.auth.token) || socket.handshake.headers["x-auth-token"];
    if (token !== AUTH_SECRET) {
      socket.emit("auth_error", { message: "invalid token" });
      socket.disconnect(true);
      return;
    }

    socket.on("join_game", (data: { gameId: string; playerId: string }) => {
      const { gameId, playerId } = data;
      const g = games.get(gameId);
      if (!g) {
        socket.emit("error", { code: "game_not_found" });
        return;
      }
      socket.join(gameId);
      // attach socketId to player
      for (const p of g.players) {
        if (p.id === playerId) p.socketId = socket.id;
      }
      // forward events from engine to socket room
      const forward = (ev: string, payload: any) => nsp.to(gameId).emit(ev, payload);
      // small one-time forward registration
      g.on("game_started", (p) => forward("game_started", p));
      g.on("state_update", (s) => forward("state_update", s));
      g.on("move_accepted", (m) => forward("move_accepted", m));
      g.on("move_rejected", (r) => forward("move_rejected", r));
      g.on("game_ended", (res) => forward("game_ended", res));
      socket.emit("joined", { gameId, playerId, state: g.getState() });
    });

    socket.on("enqueue", async (payload: { playerId: string; rating?: number }) => {
      await matchmaker.enqueue({ playerId: payload.playerId, rating: payload.rating, socketId: socket.id, ts: Date.now() });
      socket.emit("enqueued");
    });

    socket.on("make_move", (payload: { gameId: string; playerId: string; x: number; y: number; moveId?: string }) => {
      const g = games.get(payload.gameId);
      if (!g) { socket.emit("error", { code: "game_not_found" }); return; }
      const res = g.makeMove(payload.playerId, payload.x, payload.y, payload.moveId);
      if (!res.ok) {
        socket.emit("move_rejected", res.error);
      } else {
        // server emits events already
      }
    });
  });
}
