// Simulation du Tarot : des joueurs jouent au hasard (coups legaux) des
// centaines de donnes a 3, 4 et 5 joueurs ; on verifie les invariants a
// chaque coup, puis quelques cas precis (regles de jeu et comptage).
// Usage : node test/simulate-tarot.js
const assert = require("assert");
const tarot = require("../server/games/tarot");
const { botActions } = require("../server/bots");

const T = tarot._internals;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const names = (ids) => Object.fromEntries(ids.map((id) => [id, { name: id, connected: true }]));

function countCards(s) {
  let n = s.chien.length * (["bidding", "calling", "chien"].includes(s.phase) || (s.contract && s.contract.key !== "prise" && s.contract.key !== "garde") ? 1 : 0);
  n += s.ecart.length;
  for (const id of s.seatOrder) n += s.hands[id].length + s.wonCards[id].length;
  n += s.trick.length;
  return n;
}

const stats = { games: 0, donnes: 0, made: 0, failed: 0, allPass: 0, petitSec: 0, pab: 0, poignees: 0, miseres: 0, chelemAnn: 0, alone5: 0, bots: 0 };

function playGame(n, opts, useBots) {
  const ids = Array.from({ length: n }, (_, i) => "p" + i);
  const s = tarot.createGame(ids, opts);
  stats.games += 1;
  const players = names(ids);
  let safety = 0;
  while (s.phase !== "finished" && safety < 40000) {
    safety += 1;
    if (s.phase === "round_end") {
      stats.donnes += 1;
      const r = s.lastResult;
      if (r.made) stats.made += 1; else stats.failed += 1;
      if (r.petitAuBout) stats.pab += 1;
      if (r.poignees.length) stats.poignees += 1;
      if (r.miseres.length) stats.miseres += 1;
      if (r.chelemAnnounced) stats.chelemAnn += 1;
      if (n === 5 && !r.partnerId) stats.alone5 += 1;
      const sum = Object.values(r.deltas).reduce((a, b) => a + b, 0);
      assert.strictEqual(sum, 0, "les points s'equilibrent");
      assert.ok(r.points >= 0 && r.points <= 91, "points entre 0 et 91 : " + r.points);
      if (s.donne >= 6) {
        assert.ok(tarot.applyAction(s, ids[0], { type: "end_game" }, { isHost: true }).ok);
        break;
      }
      assert.ok(!tarot.applyAction(s, ids[1], { type: "next_round" }, { isHost: false }).ok, "seul le patron relance");
      assert.ok(tarot.applyAction(s, ids[0], { type: "next_round" }, { isHost: true }).ok);
      continue;
    }
    if (s.phase === "chien" || s.phase === "trick_done") {
      assert.ok(tarot.tick(s).ok);
      continue;
    }
    assert.strictEqual(countCards(s), 78, "78 cartes en permanence (phase " + s.phase + ")");
    const cur = s.currentTurn;
    assert.ok(cur, "quelqu'un doit agir en phase " + s.phase);
    if (useBots) {
      const level = ["facile", "normal", "fort"][stats.games % 3];
      const acts = botActions("tarot", s, cur, level);
      assert.ok(acts.length, "le robot a une action en phase " + s.phase);
      let ok = false;
      for (const a of acts) if (tarot.applyAction(s, cur, a).ok) { ok = true; stats.bots += 1; break; }
      assert.ok(ok, "une action du robot passe (phase " + s.phase + ") " + JSON.stringify(acts[0]));
      continue;
    }
    const v = tarot.getViewForPlayer(s, cur, players);
    if (s.phase === "bidding") {
      const options = ["passe"].concat(s.contracts.filter((c, i) => i > s.bestBid).map((c) => c.key));
      const choice = Math.random() < 0.55 ? "passe" : pick(options);
      assert.ok(tarot.applyAction(s, cur, { type: "bid", bid: choice }).ok);
      if (s.phase === "bidding" && Object.keys(s.bids).length === 0) stats.allPass += 1;
    } else if (s.phase === "calling") {
      assert.ok(v.you.mustCall);
      assert.ok(tarot.applyAction(s, cur, { type: "call", suit: pick(["pique", "coeur", "carreau", "trefle"]) }).ok);
    } else if (s.phase === "ecart") {
      const hand = s.hands[cur];
      const { size, needTrumps } = T.ecartRules(s);
      const noTrump = hand.filter((c) => !T.isTrump(c) && !T.isExcuse(c) && c.rank !== "R");
      const trumps = hand.filter((c) => T.isTrump(c) && !T.isBout(c));
      const chosen = noTrump.sort(() => Math.random() - 0.5).slice(0, size).concat(trumps.slice(0, needTrumps));
      assert.strictEqual(chosen.length, size);
      // un Roi a l'ecart est refuse
      const king = hand.find((c) => c.rank === "R" && !T.isTrump(c));
      if (king) assert.ok(!tarot.applyAction(s, cur, { type: "ecart", cardIds: [king.id].concat(chosen.slice(1).map((c) => c.id)) }).ok, "pas de Roi a l'ecart");
      const r = tarot.applyAction(s, cur, { type: "ecart", cardIds: chosen.map((c) => c.id) });
      assert.ok(r.ok, r.error);
    } else if (s.phase === "chelem") {
      assert.ok(tarot.applyAction(s, cur, { type: "chelem", announce: Math.random() < 0.03 }).ok);
    } else if (s.phase === "playing") {
      if (v.you.canAnnounce) {
        for (const lvl of v.you.poigneeLevels) { if (Math.random() < 0.7) { assert.ok(tarot.applyAction(s, cur, { type: "announce", kind: "poignee", level: lvl }).ok); break; } }
        for (const k of v.you.misereKinds) assert.ok(tarot.applyAction(s, cur, { type: "announce", kind: "misere", misere: k }).ok);
      }
      const legal = T.legalCards(s, cur);
      assert.ok(legal.length > 0, "au moins une carte jouable");
      const illegal = s.hands[cur].find((c) => !legal.includes(c));
      if (illegal) assert.ok(!tarot.applyAction(s, cur, { type: "play", cardIds: [illegal.id] }).ok, "carte illegale refusee");
      const r = tarot.applyAction(s, cur, { type: "play", cardIds: [pick(legal).id] });
      assert.ok(r.ok, r.error);
    } else {
      throw new Error("phase inattendue " + s.phase);
    }
  }
  assert.ok(safety < 40000, "la partie avance");
  return s;
}

for (let g = 0; g < 90; g += 1) {
  const n = 3 + (g % 3);
  const opts = { misere: g % 2 === 0, firstBid: g % 4 === 0 ? "petite" : "prise", gardeContre: g % 5 !== 0, donnes: 0 };
  playGame(n, opts, false);
}
for (let g = 0; g < 30; g += 1) playGame(3 + (g % 3), { misere: true }, true);
// partie avec un nombre de donnes fixe
{
  const s = playGame(4, { donnes: 3 }, true);
  assert.strictEqual(s.phase, "finished");
}
console.log("SUCCES Tarot :", JSON.stringify(stats));

// ------------------------------------------------------------------ cas precis
const C = (spec) => {
  const [rank, suit] = spec.split(":");
  return { id: spec + Math.random(), rank, suit };
};
{
  // obligation de couper et de monter
  const s = tarot.createGame(["a", "b", "c", "d"], {});
  s.phase = "playing";
  s.trick = [{ playerId: "a", card: C("5:coeur") }, { playerId: "b", card: C("12:atout") }];
  s.hands.c = [C("3:atout"), C("15:atout"), C("R:pique"), C("E:excuse")];
  let legal = T.legalCards(s, "c").map((c) => c.rank);
  assert.deepStrictEqual(legal.sort(), ["15", "E"].sort(), "doit surcouper (ou Excuse)");
  s.hands.c = [C("3:atout"), C("R:pique")];
  legal = T.legalCards(s, "c").map((c) => c.rank);
  assert.deepStrictEqual(legal, ["3"], "doit couper meme sans pouvoir monter");
  s.hands.c = [C("7:coeur"), C("20:atout")];
  legal = T.legalCards(s, "c").map((c) => c.rank);
  assert.deepStrictEqual(legal, ["7"], "doit fournir la couleur");
  // Excuse en premier : la carte suivante donne la couleur
  s.trick = [{ playerId: "a", card: C("E:excuse") }];
  s.hands.b = [C("2:trefle"), C("9:atout")];
  assert.strictEqual(T.legalCards(s, "b").length, 2, "apres l'Excuse, tout est permis");
  assert.strictEqual(T.trickWinnerOf([{ playerId: "a", card: C("E:excuse") }, { playerId: "b", card: C("2:trefle") }, { playerId: "c", card: C("R:trefle") }], false, null), "c");
  assert.strictEqual(T.trickWinnerOf([{ playerId: "a", card: C("R:coeur") }, { playerId: "b", card: C("1:atout") }], false, null), "b", "le Petit coupe le Roi");
  // valeur totale 91
  const { buildTarotDeck } = require("../server/deck");
  assert.strictEqual(buildTarotDeck().reduce((t, c) => t + T.cardPoints(c), 0), 91);
}
{
  // comptage : garde reussie avec 2 bouts et 45 points -> (25 + 4) x 2 = 58
  const s = tarot.createGame(["a", "b", "c", "d"], { chelem: false });
  s.takerId = "a";
  s.contract = { key: "garde", label: "Garde", mult: 2 };
  const deck = require("../server/deck").buildTarotDeck();
  const find = (rank, suit) => deck.find((c) => c.rank === rank && c.suit === suit);
  // cartes du preneur : 21, Petit, 4 Rois (27 points) + 36 cartes basses (18) = 45
  const atkCards = [find("21", "atout"), find("1", "atout"), find("R", "pique"), find("R", "coeur"), find("R", "carreau"), find("R", "trefle")];
  const low = deck.filter((c) => !atkCards.includes(c) && T.cardPoints(c) === 0.5).slice(0, 36);
  s.wonCards = { a: atkCards.concat(low), b: [], c: [], d: [] };
  s.ecart = [];
  s.chien = [];
  s.trickWinners = ["a", "b"];
  s.lastTrick = { winner: "b", cards: [] };
  s.poignees = {};
  s.miseres = {};
  s.hands = { a: [], b: [], c: [], d: [] };
  s.phase = "playing";
  tarot._internals.attackCamp(s);
  require("../server/games/tarot");
  // on passe par la fin de donne
  s.trickNumber = 18;
  s.phase = "trick_done";
  s.trick = [];
  s.trickWinner = "b";
  tarot.tick(s);
  const r = s.lastResult;
  assert.strictEqual(r.points, 45);
  assert.strictEqual(r.needed, 41);
  assert.ok(r.made);
  assert.strictEqual(r.perDefender, (25 + 4) * 2);
  assert.strictEqual(r.deltas.a, 3 * 58);
  assert.strictEqual(r.deltas.b, -58);
  console.log("SUCCES Comptage FFT : garde faite de 4 avec 2 bouts =", r.perDefender, "par défenseur");
}
