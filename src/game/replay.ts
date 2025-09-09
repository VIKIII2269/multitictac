import mongoose from "mongoose";
import { ReplayModel } from "../models/replay.model";

export type StoredReplay = {
  gameId: string;
  players: string[];
  createdAt: string;
  endedAt?: string;
  result: any;
  actionCount: number;
  actions: any[];
};

export async function saveReplay(r: StoredReplay) {
  // attempt to save; if mongoose not connected, fall back to writing to console
  try {
    if (mongoose.connection.readyState === 0) {
      // not connected - simulate local save (no-op)
      console.warn("Mongoose not connected; skipping DB save for replay", r.gameId);
      return;
    }
    await ReplayModel.findOneAndUpdate({ gameId: r.gameId }, r, { upsert: true, new: true, setDefaultsOnInsert: true });
    return;
  } catch (err) {
    console.error("saveReplay error:", err);
    throw err;
  }
}

export async function fetchReplay(gameId: string) {
  if (mongoose.connection.readyState === 0) return null;
  return ReplayModel.findOne({ gameId }).lean();
}
