// Simulation de l'Ascenseur : des robots jouent des parties completes en
// appelant directement le moteur, et on verifie les regles a chaque coup.
// Usage : node test/simulate-ascenseur.js

const assert = require("assert");
const asc = require("../server/games/ascenseur");
const { buildSequence, pointsFor, trickWinnerOf, maxCardsFor } = asc._internals;

const rnd = (n) => Math.floor(Math.random() * n);

function countCards(s) {
  let n = s.talon.length + (s.trump ? 1 : 0) + s.trick.length;
  for (const id of s.seatOrder) n += s.hands[id].length + s.wonCards[id];
  return n;
}

// --- suites de manches
assert.deepStrictEqual(buildSequence({ maxCards: 4, mode: "up-down", step: 1 }), [1, 2, 3, 4, 3, 2, 1]);
assert.deepStrictEqual(buildSequence({ maxCards: 3, mode: "down-up", step: 1 }), [3, 2, 1, 2, 3]);
assert.deepStrictEqual(buildSequence({ maxCards: 5, mode: "up", step: 2 }), [1, 3, 5]);
assert.deepStrictEqual(buildSequence({ maxCards: 6, mode: "down", step: 2 }), [6, 5, 3, 1]);
assert.strictEqual(maxCardsFor(4), 13);
assert.strictEqual(asc.normalizeOptions({ maxCards: 40 }, 5).maxCards, 10, "max borne a 52/n");
assert.strictEqual(asc.normalizeOptions({}, 6).maxCards, 8, "max par defaut = 52/n");

// --- points
assert.strictEqual(pointsFor(3, 3), 120);
assert.strictEqual(pointsFor(0, 0), 20);
assert.strictEqual(pointsFor(3, 1), -80);
assert.strictEqual(pointsFor(0, 2), -80);

// --- gagnant d'un pli
{
  const s = { trump: { suit: "coeur" }, trick: [
    { playerId: "a", card: { suit: "pique", rank: "R" } },
    { playerId: "b", card: { suit: "pique", rank: "A" } },
    { playerId: "c", card: { suit: "carreau", rank: "A" } }
  ] };
  assert.strictEqual(trickWinnerOf(s), "b", "plus forte carte de la couleur demandee");
  s.trick.push({ playerId: "d", card: { suit: "coeur", rank: "2" } });
  assert.strictEqual(trickWinnerOf(s), "d", "le petit atout coupe");
  s.trick.push({ playerId: "e", card: { suit: "coeur", rank: "5" } });
  assert.strictEqual(trickWinnerOf(s), "e", "le plus gros atout gagne");
  s.trump = null;
  assert.strictEqual(trickWinnerOf(s), "b", "sans atout");
}

// --- parties completes
const stats = { games: 0, rounds: 0, tricks: 0, noTrump: 0, forbidden: 0, followRefused: 0 };
for (let g = 0; g < 40; g += 1) {
  const n = 3 + (g % 6);
  const players = Array.from({ length: n }, (_, i) => "p" + i);
  const modes = ["up-down", "down-up", "up", "down"];
  const options = g % 5 === 0 ? {} : { maxCards: 1 + rnd(maxCardsFor(n)), mode: modes[g % 4], step: g % 3 === 0 ? 2 : 1 };
  const s = asc.createGame(players, options);
  stats.games += 1;
  const seq = s.sequence;
  let safety = 0;
  while (s.phase !== "finished" && safety < 50000) {
    safety += 1;
    assert.strictEqual(countCards(s), 52, "52 cartes en permanence");
    if (s.phase === "round_end") {
      assert.strictEqual(s.lastResult.reduce((t, r) => t + r.won, 0), seq[s.roundIndex], "tous les plis attribues");
      const r = asc.applyAction(s, players[1], { type: "next_round" }, { isHost: false });
      assert.ok(!r.ok, "seul le patron lance la manche");
      assert.ok(asc.applyAction(s, players[0], { type: "next_round" }, { isHost: true }).ok);
      continue;
    }
    if (s.phase === "trick_done") {
      stats.tricks += 1;
      assert.ok(!asc.applyAction(s, s.seatOrder[0], { type: "play", cardIds: [] }).ok, "pas de jeu pendant le ramassage");
      assert.ok(asc.tick(s).ok);
      continue;
    }
    const cur = s.currentTurn;
    const cards = seq[s.roundIndex];
    if (s.phase === "bidding") {
      if (Object.keys(s.bids).length === 0) {
        stats.rounds += 1;
        for (const id of players) assert.strictEqual(s.hands[id].length, cards, "bon nombre de cartes");
        if (!s.trump) {
          stats.noTrump += 1;
          assert.strictEqual(cards * n, 52, "sans atout seulement si tout est distribue");
        }
      }
      const other = players.find((id) => id !== cur);
      assert.ok(!asc.applyAction(s, other, { type: "bid", bid: 0 }).ok, "annonce hors tour refusee");
      const f = asc._internals.forbiddenBid(s, cur);
      if (f !== null) {
        stats.forbidden += 1;
        assert.ok(!asc.applyAction(s, cur, { type: "bid", bid: f }).ok, "le dernier ne peut pas faire tomber juste");
      }
      let bid;
      do bid = rnd(cards + 1); while (bid === f);
      assert.ok(asc.applyAction(s, cur, { type: "bid", bid }).ok);
      if (s.phase === "playing") {
        const total = players.reduce((t, id) => t + s.bids[id], 0);
        assert.notStrictEqual(total, cards, "le total des annonces n'est jamais juste");
      }
      continue;
    }
    // jeu de la carte
    const hand = s.hands[cur];
    const legal = asc._internals.legalCards(s, cur);
    if (s.leadSuit && hand.some((c) => c.suit === s.leadSuit)) {
      const bad = hand.find((c) => c.suit !== s.leadSuit);
      if (bad) {
        stats.followRefused += 1;
        assert.ok(!asc.applyAction(s, cur, { type: "play", cardIds: [bad.id] }).ok, "obligation de fournir");
      }
    }
    const card = legal[rnd(legal.length)];
    const res = asc.applyAction(s, cur, { type: "play", cardIds: [card.id] });
    assert.ok(res.ok, res.error);
    if (s.phase === "trick_done") assert.ok(res.schedule > 0, "pause avant ramassage");
  }
  assert.strictEqual(s.phase, "finished");
  assert.strictEqual(s.roundIndex, seq.length - 1, "toutes les manches jouees");
  // total des points = somme des resultats
  const total = players.reduce((t, id) => t + s.scores[id], 0);
  assert.ok(Number.isFinite(total));
}

console.log("SUCCES Ascenseur :", JSON.stringify(stats));
