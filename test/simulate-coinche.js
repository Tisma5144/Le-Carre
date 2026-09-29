// Simulation de la Coinche : des centaines de donnes jouees au hasard (coups
// legaux) et par les robots ; on verifie les invariants a chaque coup, puis
// des cas precis (obligations de jeu, annonces, comptage).
// Usage : node test/simulate-coinche.js
const assert = require("assert");
const coinche = require("../server/games/coinche");
const { botActions } = require("../server/bots");

const K = coinche._internals;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const ids = ["p0", "p1", "p2", "p3"];
const players = Object.fromEntries(ids.map((id) => [id, { name: id, connected: true }]));
const card = (rank, suit) => ({ id: `x_${rank}_${suit}`, rank, suit });

const stats = { games: 0, donnes: 0, made: 0, failed: 0, allPass: 0, coinche: 0, surcoinche: 0, capots: 0, annonces: 0, belotes: 0, sa: 0, ta: 0, bots: 0 };

function countCards(s) {
  let n = s.trick.length;
  for (const id of s.seatOrder) n += s.hands[id].length + s.wonCards[id].length;
  return n;
}

function randomBid(s, id) {
  if (s.phase === "surcoinche") return { type: "bid", bid: Math.random() < 0.3 ? "surcoinche" : "passe" };
  if (K.canCoinche(s, id) && Math.random() < 0.08) return { type: "bid", bid: "coinche" };
  const min = K.minValue(s);
  if (min !== null && Math.random() < 0.35) {
    const vals = K.VALUES.filter((v) => v >= min && v <= Math.min(min + 30, 500));
    return { type: "bid", bid: String(pick(vals)), trump: pick(K.allowedTrumps(s)) };
  }
  return { type: "bid", bid: "passe" };
}

function playGame(opts, useBots) {
  const s = coinche.createGame(ids, opts);
  stats.games += 1;
  let safety = 0;
  let lastDonne = 0;
  while (s.phase !== "finished" && safety < 20000) {
    safety += 1;
    if (s.phase === "round_end") {
      const r = s.lastResult;
      stats.donnes += 1;
      if (r.made) stats.made += 1; else stats.failed += 1;
      if (r.mult === 2) stats.coinche += 1;
      if (r.mult === 4) stats.surcoinche += 1;
      if (r.capot !== null) stats.capots += 1;
      if (r.annonces[0] || r.annonces[1]) stats.annonces += 1;
      if (r.belote[0] || r.belote[1]) stats.belotes += 1;
      if (r.trump === "sa") stats.sa += 1;
      if (r.trump === "ta") stats.ta += 1;
      // 162 points de plis (250 en cas de capot)
      const total = r.points[0] + r.points[1];
      assert.ok(total === 162 || (r.capot !== null && total === 250), "162 points en jeu : " + total);
      assert.deepStrictEqual(r.totals, s.scores.slice());
      assert.ok(!coinche.applyAction(s, ids[1], { type: "next_round" }, { isHost: false }).ok, "seul le patron relance");
      assert.ok(coinche.applyAction(s, ids[0], { type: "next_round" }, { isHost: true }).ok);
      assert.ok(s.donne > lastDonne);
      lastDonne = s.donne;
      continue;
    }
    if (s.phase === "trick_done") {
      assert.ok(coinche.tick(s).ok);
      continue;
    }
    assert.strictEqual(countCards(s), 32, "32 cartes en permanence");
    const cur = s.currentTurn;
    assert.ok(cur, "quelqu'un doit agir en phase " + s.phase);
    const others = ids.filter((x) => x !== cur);
    assert.ok(!coinche.applyAction(s, others[0], { type: "bid", bid: "passe" }).ok || s.phase !== "bidding", "hors tour refuse");
    let action;
    if (useBots) {
      const acts = botActions("coinche", s, cur, ["facile", "normal", "fort"][stats.games % 3]);
      assert.ok(acts.length, "le robot a une action en phase " + s.phase);
      action = acts.find((a) => {
        const copy = JSON.parse(JSON.stringify(s));
        return coinche.applyAction(copy, cur, a).ok;
      });
      assert.ok(action, "au moins une action du robot est valide");
      stats.bots += 1;
    } else if (s.phase === "playing") {
      const legal = K.legalCards(s, cur);
      assert.ok(legal.length > 0);
      const illegal = s.hands[cur].filter((c) => !legal.includes(c));
      if (illegal.length) assert.ok(!coinche.applyAction(s, cur, { type: "play", cardIds: [illegal[0].id] }).ok, "carte interdite refusee");
      action = { type: "play", cardIds: [pick(legal).id] };
    } else action = randomBid(s, cur);
    const before = s.donne;
    const r = coinche.applyAction(s, cur, action);
    assert.ok(r.ok, r.error + " " + JSON.stringify(action));
    if (s.phase === "bidding" && s.bids.length === 0 && s.donne === before) stats.allPass += 0;
    const v = coinche.getViewForPlayer(s, cur, players);
    assert.ok(v.hand.length <= 8);
  }
  assert.strictEqual(s.phase, "finished", "la partie se termine");
  assert.ok(Math.max(...s.scores) >= s.options.target);
  assert.ok(s.winnerTeam === 0 || s.winnerTeam === 1);
}

for (let g = 0; g < 60; g += 1) playGame({ target: 1000, atouts: g % 2 ? "tous" : "couleurs", scoring: g % 3 ? "points" : "contrat" }, false);
for (let g = 0; g < 30; g += 1) playGame({ target: 1000, atouts: g % 2 ? "tous" : "couleurs" }, true);

// ------------------------------------------------------------ cas precis
function fixed(hands, trump, trick = []) {
  const s = coinche.createGame(ids, {});
  s.hands = hands;
  s.contract = { takerId: s.seatOrder[0], team: 0, value: 80, trump, mult: 1 };
  s.phase = "playing";
  s.trick = trick;
  return s;
}
{
  // sans la couleur, partenaire maitre : on joue ce qu'on veut
  const s = coinche.createGame(ids, {});
  const [a, b, c, d] = s.seatOrder; // a et c partenaires
  const t = fixed({ [a]: [], [b]: [], [c]: [card("7", "pique"), card("A", "trefle")], [d]: [] }, "pique", [
    { playerId: a, card: card("A", "coeur") }, { playerId: b, card: card("7", "coeur") }
  ]);
  t.seatOrder = s.seatOrder;
  assert.strictEqual(K.legalCards(t, c).length, 2, "partenaire maitre : defausse libre");
  // adversaire maitre : il faut couper
  const t2 = fixed({ [a]: [], [b]: [], [c]: [card("7", "pique"), card("A", "trefle")], [d]: [] }, "pique", [
    { playerId: a, card: card("7", "coeur") }, { playerId: b, card: card("A", "coeur") }
  ]);
  t2.seatOrder = s.seatOrder;
  assert.deepStrictEqual(K.legalCards(t2, c).map((x) => x.rank), ["7"], "adversaire maitre : couper");
  // surcouper obligatoire, sinon sous-couper
  const t3 = fixed({ [a]: [], [b]: [], [c]: [card("7", "pique"), card("V", "pique"), card("A", "trefle")], [d]: [] }, "pique", [
    { playerId: a, card: card("7", "coeur") }, { playerId: b, card: card("9", "pique") }
  ]);
  t3.seatOrder = s.seatOrder;
  assert.deepStrictEqual(K.legalCards(t3, c).map((x) => x.rank), ["V"], "surcouper");
  const t4 = fixed({ [a]: [], [b]: [], [c]: [card("7", "pique"), card("A", "trefle")], [d]: [] }, "pique", [
    { playerId: a, card: card("7", "coeur") }, { playerId: b, card: card("9", "pique") }
  ]);
  t4.seatOrder = s.seatOrder;
  assert.deepStrictEqual(K.legalCards(t4, c).map((x) => x.rank), ["7"], "sous-couper");
  // atout demande : monter
  const t5 = fixed({ [a]: [], [b]: [card("8", "pique"), card("A", "pique"), card("A", "coeur")], [c]: [], [d]: [] }, "pique", [
    { playerId: a, card: card("10", "pique") }
  ]);
  t5.seatOrder = s.seatOrder;
  assert.deepStrictEqual(K.legalCards(t5, b).map((x) => x.rank), ["A"], "monter a l'atout");
  // gagnant du pli : le 9 d'atout bat l'As d'atout, l'atout bat l'As
  assert.strictEqual(K.trickWinnerOf([{ playerId: a, card: card("A", "pique") }, { playerId: b, card: card("9", "pique") }], "pique"), b);
  assert.strictEqual(K.trickWinnerOf([{ playerId: a, card: card("A", "coeur") }, { playerId: b, card: card("7", "pique") }], "pique"), b);
  assert.strictEqual(K.trickWinnerOf([{ playerId: a, card: card("10", "coeur") }, { playerId: b, card: card("A", "trefle") }], "pique"), a, "la couleur demandee l'emporte");
  assert.strictEqual(K.trickWinnerOf([{ playerId: a, card: card("A", "coeur") }, { playerId: b, card: card("V", "coeur") }], "ta"), b, "Tout Atout : le Valet gagne");
  // points : 152 par donne dans chaque mode
  const deck = K.buildDeck();
  for (const tr of ["pique", "sa", "ta"]) assert.strictEqual(deck.reduce((t, x) => t + K.cardPoints(x, tr), 0), 152, "152 points (" + tr + ")");
  // annonces
  const ann = K.findAnnonces([card("7", "coeur"), card("8", "coeur"), card("9", "coeur"), card("10", "coeur"), card("V", "pique"), card("V", "coeur"), card("V", "trefle"), card("V", "carreau")]);
  const labels = ann.map((x) => x.label + ":" + x.value).sort();
  assert.deepStrictEqual(labels, ["Carré de Valets:200", "Cent:100"], "cent + carre de valets : " + labels);
}

console.log("SUCCES Coinche :", JSON.stringify(stats));
