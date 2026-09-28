// Simulation du Pouilleux : parties completes, verification des regles.
// Usage : node test/simulate-pouilleux.js
const assert = require("assert");
const p = require("../server/games/pouilleux");
const { COLOR, isPouilleux } = p._internals;

const stats = { games: 0, draws: 0, pairs: 0, pouilleuxDrawn: 0 };
for (let g = 0; g < 200; g += 1) {
  const n = 2 + (g % 7);
  const ids = Array.from({ length: n }, (_, i) => "p" + i);
  const s = p.createGame(ids);
  stats.games += 1;
  let safety = 0;
  const count = () => s.pairs.length * 2 + ids.reduce((t, id) => t + s.hands[id].length, 0);
  assert.strictEqual(count(), 51, "51 cartes (valet de trefle retire)");
  // aucune paire en main apres la donne
  for (const id of ids) {
    const keys = s.hands[id].map((c) => c.rank + COLOR[c.suit]);
    assert.strictEqual(new Set(keys).size, keys.length, "plus de paire en main");
  }
  while (s.phase !== "finished" && safety < 5000) {
    safety += 1;
    if (s.phase === "pairing") {
      assert.ok(!p.applyAction(s, s.currentTurn, { type: "draw", index: 0 }).ok, "pas de tirage pendant la sortie d'une paire");
      assert.ok(p.tick(s).ok);
      continue;
    }
    const cur = s.currentTurn;
    assert.ok(s.hands[cur].length > 0, "le joueur courant a des cartes");
    const other = ids.find((id) => id !== cur);
    assert.ok(!p.applyAction(s, other, { type: "draw", index: 0 }).ok, "hors tour refuse");
    const victim = p._internals.victimOf(s, cur);
    const idx = Math.floor(Math.random() * s.hands[victim].length);
    const before = s.pairs.length;
    const card = s.hands[victim][idx];
    const r = p.applyAction(s, cur, { type: "draw", index: idx });
    assert.ok(r.ok, r.error);
    assert.ok(r.schedule > 0);
    if (isPouilleux(card)) stats.pouilleuxDrawn += 1;
    p.tick(s);
    if (s.showPair) {
      // la paire formee reste montree au centre avant d'aller au plateau
      assert.strictEqual(s.phase, "pairing");
      assert.strictEqual(s.showPair.cards[0].id, card.id, "la carte tiree en premier");
      assert.ok(!s.hands[cur].some((c) => s.showPair.cards.includes(c)), "la paire a quitte la main");
      const view = p.getViewForPlayer(s, other, {});
      assert.ok(view.showPair && view.showPair.cards.length === 2);
      assert.strictEqual(view.pairs.length, s.pairs.length - 1, "pas encore dans le plateau");
      stats.shownPairs = (stats.shownPairs || 0) + 1;
    }
    stats.draws += 1;
    stats.pairs += s.pairs.length - before;
    assert.strictEqual(count(), 51);
    if (Math.random() < 0.1) p.applyAction(s, victim, { type: "shuffle" });
  }
  assert.strictEqual(s.phase, "finished");
  assert.ok(s.loserId, "il y a un pouilleux");
  assert.strictEqual(s.hands[s.loserId].length, 1);
  assert.ok(isPouilleux(s.hands[s.loserId][0]), "le perdant garde le valet de pique");
  assert.strictEqual(s.safeOrder.length, n - 1);
}
console.log("SUCCES Pouilleux :", JSON.stringify(stats));
