import express from "express";
import http from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import { Matchmaker } from "./matchmaking";
import { registerSocketHandlers } from "./socketHandlers";
import { GameEngine } from "./game/engine";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const PORT = Number(process.env.PORT || 4000);
const MONGO_URL = process.env.MONGO_URL || "";
const REDIS_URL = process.env.REDIS_URL || "";
const TURN_TIME_MS = Number(process.env.TURN_TIME_MS || 30000);

(async function main() {
  // connect mongoose if available
  if (MONGO_URL) {
    try {
      await mongoose.connect(MONGO_URL);
      console.log("Mongo connected");
    } catch (e) {
      console.warn("Mongo connect failed; continuing without persistent replay store");
    }
  }

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  const matchmaker = new Matchmaker(REDIS_URL || undefined);
  const games: Map<string, GameEngine> = new Map();

  // matchmaking loop (simple)
  setInterval(async () => {
    const pair = await matchmaker.tryMatch();
    if (pair) {
      const [a, b] = pair;
      const gameId = uuidv4();
      const engine = new GameEngine(gameId, [{ id: a.playerId, socketId: a.socketId }, { id: b.playerId, socketId: b.socketId }], { turnTimeMs: TURN_TIME_MS });
      games.set(gameId, engine);
      engine.start();
      // attach a listener to cleanup finished games
      engine.on("game_ended", () => {
        // keep for retrieval; optionally remove from memory later
        console.log(`Game ended ${gameId}`);
      });
      // notify players via sockets
      if (a.socketId) io.of("/game").to(a.socketId).emit("matched", { gameId, opponent: b.playerId });
      if (b.socketId) io.of("/game").to(b.socketId).emit("matched", { gameId, opponent: a.playerId });
    }
  }, 500);

  registerSocketHandlers(io, matchmaker, games);

  app.post("/api/create-game", (req, res) => {
    const { players } = req.body;
    if (!players || players.length !== 2) return res.status(400).json({ error: "players array of length 2 required" });
    const gameId = uuidv4();
    const engine = new GameEngine(gameId, [{ id: players[0] }, { id: players[1] }], { turnTimeMs: TURN_TIME_MS });
    games.set(gameId, engine);
    engine.start();
    res.json({ gameId });
  });

  app.get("/api/games/:id", (req, res) => {
    const g = games.get(req.params.id);
    if (!g) return res.status(404).json({ error: "not found" });
    res.json({ gameId: g.gameId, players: g.players.map(p => p.id), startedAt: g.startedAt, endedAt: g.endedAt, actionCount: g.actions.length });
  });

  app.get("/api/replay/:gameId", async (req, res) => {
    // try mongoose model
    try {
      const { ReplayModel } = await import("./models/replay.model");
      const r = await ReplayModel.findOne({ gameId: req.params.gameId }).lean();
      if (!r) return res.status(404).json({ error: "replay not found" });
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: "replay store unavailable" });
    }
  });

  // simple replay playback streaming endpoint: streams JSON actions one by one with small delay
  app.get("/replay/playback/:gameId", async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const { ReplayModel } = await import("./models/replay.model");
      const r = await ReplayModel.findOne({ gameId: req.params.gameId }).lean();
      if (!r) return res.status(404).end(JSON.stringify({ error: "not found" }));
      res.write('{"actions":[');
      for (let i = 0; i < r.actions.length; i++) {
        res.write(JSON.stringify(r.actions[i]));
        if (i < r.actions.length - 1) res.write(",");
        // small delay is omitted in server streaming to keep implementation simple
      }
      res.write("]}");
      res.end();
    } catch (e) {
      res.status(500).json({ error: "playback failed" });
    }
  });

  server.listen(PORT, () => console.log(`Server listening ${PORT}`));
})();
