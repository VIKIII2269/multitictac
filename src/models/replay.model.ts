import mongoose from "mongoose";

const ActionSchema = new mongoose.Schema(
  {
    seq: { type: Number, required: true },
    type: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    ts: { type: Date, required: true },
    rng_seed: { type: String }
  },
  { _id: false }
);

const ReplaySchema = new mongoose.Schema({
  gameId: { type: String, required: true, unique: true },
  players: { type: [String], required: true },
  createdAt: { type: Date, required: true },
  endedAt: { type: Date },
  result: { type: mongoose.Schema.Types.Mixed },
  actionCount: { type: Number, required: true },
  actions: { type: [ActionSchema], required: true }
});

export const ReplayModel = mongoose.models.Replay || mongoose.model("Replay", ReplaySchema);
