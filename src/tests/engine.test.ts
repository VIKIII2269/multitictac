import { GameEngine } from "../game/engine";

describe("GameEngine - TicTacToe", () => {
  test("accepts legal moves and detects win", async () => {
    const g = new GameEngine("game-test-1", [{ id: "A" }, { id: "B" }], { turnTimeMs: 10000 });
    g.start();
    const first = g.getState().currentPlayer;
    // play a winning sequence for player who starts
    const p0 = first;
    const p1 = p0 === "A" ? "B" : "A";
    // find mapping: playerId to mark index (1 or 2)
    const moves = [
      { player: p0, x: 0, y: 0 },
      { player: p1, x: 1, y: 0 },
      { player: p0, x: 0, y: 1 },
      { player: p1, x: 1, y: 1 },
      { player: p0, x: 0, y: 2 } // this should be a vertical win
    ];
    for (const m of moves) {
      const res = g.makeMove(m.player, m.x, m.y);
      expect(res.ok).toBeTruthy();
    }
    // final action should be end
    const last = g.getActions()[g.getActions().length - 1];
    expect(last.type).toBe("end");
    expect(last.payload.winner).toBe(p0);
  });

  test("rejects move out of turn", () => {
    const g = new GameEngine("game-test-2", [{ id: "A" }, { id: "B" }], { turnTimeMs: 10000 });
    g.start();
    const first = g.getState().currentPlayer;
    const other = first === "A" ? "B" : "A";
    const res = g.makeMove(other, 0, 0);
    expect(res.ok).toBeFalsy();
    expect(res.error.code).toBe("not_your_turn");
  });

  test("serializes deterministic actions with seq", () => {
    const g = new GameEngine("game-test-3", [{ id: "A" }, { id: "B" }], { turnTimeMs: 10000 });
    g.start();
    g.makeMove(g.getState().currentPlayer, 0, 0);
    g.makeMove(g.getState().currentPlayer, 1, 0);
    const actions = g.getActions();
    expect(actions.length).toBeGreaterThanOrEqual(3);
    // seqs are increasing
    for (let i = 1; i < actions.length; i++) {
      expect(actions[i].seq).toBeGreaterThan(actions[i - 1].seq);
    }
  });
});
