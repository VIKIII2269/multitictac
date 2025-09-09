# Deterministic Replay Format

Each replay is stored as a JSON object with metadata and an ordered `actions` array.

Top-level structure:
```json
{
  "gameId": "string",
  "players": ["playerA", "playerB"],
  "createdAt": "ISO timestamp",
  "endedAt": "ISO timestamp",
  "result": { "winner": "playerId|null", "reason": "win|draw|timeout" },
  "actionCount": 10,
  "actions": [
    {
      "seq": 1,
      "type": "start",
      "payload": { "firstPlayer": "playerA" },
      "ts": "ISO timestamp",
      "rng_seed": "hex-string-or-null"
    },
    {
      "seq": 2,
      "type": "move",
      "payload": {
        "playerId": "playerA",
        "x": 0,
        "y": 1,
        "moveId": "uuid"
      },
      "ts": "ISO timestamp"
    },
    {
      "seq": 3,
      "type": "timeout",
      "payload": { "playerId": "playerB", "reason": "no-move" },
      "ts": "ISO timestamp"
    },
    {
      "seq": 4,
      "type": "end",
      "payload": { "winner": "playerA", "reason": "win" },
      "ts": "ISO timestamp"
    }
  ]
}
```

Notes:
- `seq` is monotonically increasing and starts at 1.
- `type` is one of: `start`, `move`, `timeout`, `end`.
- `rng_seed` present only if randomness is used; seeding deterministic RNG via sha256(gameId + createdAt).
- Replays are deterministic: replay player applies actions in sequence to reconstruct state.
