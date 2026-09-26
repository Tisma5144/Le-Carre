// Simulation du Président : des robots jouent des centaines de manches en
// appelant directement le moteur, et on verifie les invariants a chaque coup.
// Usage : node test/simulate-president.js

const assert = require("assert");
const president = require("../server/games/president");
const { STRENGTH, topRun } = president._internals;

function rnd(n) {
  return Math.floor(Math.random() * n);
}

function countCards(state) {
  let n = state.discardCount;
  for (const id of state.seatOrder) n += state.hands[id].length;
  for (const p of state.trick) n += p.cards.length;
  return n;
}

function groups(hand) {
  const g = {};
  for (const c of hand) (g[c.rank] = g[c.rank] || []).push(c);
  return g;
}

function legalPlays(state, id) {
  const hand = state.hands[id];
  const g = groups(hand);
  const top = state.trick.length ? state.trick[state.trick.length - 1] : null;
  const out = [];
  for (const [rank, cards] of Object.entries(g)) {
    if (!top) {
      for (let k = 1; k <= cards.length; k += 1) out.push(cards.slice(0, k));
    } else {
      const k = top.cards.length;
      if (cards.length < k) continue;
      if (state.ouRien && rank !== state.ouRien) continue;
      if (STRENGTH[rank] < STRENGTH[top.cards[0].rank]) continue;
      out.push(cards.slice(0, k));
    }
  }
  return out;
}

function magicPlays(state) {
  const run = topRun(state);
  if (!run.rank || run.rank === "2") return [];
  const need = 4 - run.count;
  const out = [];
  for (const id of state.seatOrder) {
    const cards = (state.hands[id] || []).filter((c) => c.rank === run.rank);
    if (cards.length === need && need > 0) out.push({ id, cards });
  }
  return out;
}

const stats = { games: 0, rounds: 0, magic: 0, twoCloses: 0, finishOnTwo: 0, ouRien: 0, exchanges: 0 };

for (let game = 0; game < 60; game += 1) {
  const n = 3 + (game % 6);
  const players = Array.from({ length: n }, (_, i) => "p" + i);
  const state = president.createGame(players);
  stats.games += 1;
  const host = players[0];
  let safety = 0;
  while (state.round <= 4 && safety < 20000) {
    safety += 1;
    assert.strictEqual(countCards(state), 52, "52 cartes en permanence");
    if (state.phase === "round_end") {
      stats.rounds += 1;
      const ranking = state.lastRanking;
      assert.strictEqual(ranking.length, n, "classement complet");
      assert.strictEqual(new Set(ranking.map((r) => r.id)).size, n);
      if (state.round === 4) break;
      const res = president.applyAction(state, host, { type: "next_round" }, { isHost: true });
      assert.ok(res.ok, res.error);
      continue;
    }
    if (state.phase === "exchange") {
      stats.exchanges += 1;
      for (const task of state.exchange.pending.filter((p) => !p.done)) {
        const hand = state.hands[task.from];
        const res = president.applyAction(state, task.from, { type: "give", cardIds: hand.slice(0, task.count).map((c) => c.id) });
        assert.ok(res.ok, res.error);
        if (!state.exchange) break;
      }
      assert.strictEqual(state.phase, "playing");
      for (const id of players) assert.ok(state.hands[id].length >= 5);
      continue;
    }
    // un carre magique de temps en temps
    const magic = magicPlays(state);
    if (magic.length && Math.random() < 0.6) {
      const m = magic[0];
      const res = president.applyAction(state, m.id, { type: "play", cardIds: m.cards.map((c) => c.id) });
      assert.ok(res.ok, "carre magique refuse : " + res.error);
      stats.magic += 1;
      assert.ok(state.trick.length === 0 || state.phase === "round_end", "le carre ferme le pli");
      continue;
    }
    const cur = state.currentTurn;
    assert.ok(cur, "quelqu'un doit jouer");
    assert.ok(state.hands[cur].length > 0, "le joueur courant a des cartes");
    const plays = legalPlays(state, cur);
    const canPass = state.trick.length > 0;
    if (state.ouRien) stats.ouRien += 1;
    if (!plays.length || (canPass && Math.random() < 0.25)) {
      assert.ok(canPass, "on ne peut pas etre bloque en ouvrant un pli");
      const res = president.applyAction(state, cur, { type: "pass" });
      assert.ok(res.ok, res.error);
      continue;
    }
    const choice = plays[rnd(plays.length)];
    const before = state.hands[cur].length;
    const res = president.applyAction(state, cur, { type: "play", cardIds: choice.map((c) => c.id) });
    assert.ok(res.ok, res.error);
    if (choice[0].rank === "2") {
      stats.twoCloses += 1;
      if (before === choice.length) stats.finishOnTwo += 1;
    }
    // coups illegaux refuses
    if (state.phase === "playing" && state.trick.length) {
      const other = state.seatOrder.find((id) => id !== state.currentTurn && state.hands[id].length);
      if (other) {
        const bad = president.applyAction(state, other, { type: "pass" });
        assert.ok(!bad.ok, "passer hors de son tour doit etre refuse");
      }
    }
  }
  assert.ok(safety < 20000, "la partie doit avancer");
}

// cas precis : "ou rien", 2 qui ferme, fin sur un 2
{
  const s = president.createGame(["a", "b", "c"]);
  const card = (rank, suit) => ({ id: `${rank}-${suit}-${Math.random()}`, rank, suit });
  s.hands = { a: [card("8", "coeur"), card("R", "pique")], b: [card("8", "pique"), card("9", "pique")], c: [card("8", "trefle"), card("A", "pique"), card("2", "coeur")] };
  s.seatOrder = ["a", "b", "c"];
  s.currentTurn = "a";
  s.trick = [];
  s.discardCount = 52 - 7;
  let r = president.applyAction(s, "a", { type: "play", cardIds: [s.hands.a[0].id] });
  assert.ok(r.ok);
  r = president.applyAction(s, "b", { type: "play", cardIds: [s.hands.b[0].id] });
  assert.ok(r.ok, "8 sur 8 autorise");
  assert.strictEqual(s.ouRien, "8");
  r = president.applyAction(s, "c", { type: "play", cardIds: [s.hands.c[1].id] });
  assert.ok(!r.ok, "ou rien : l'As est refuse");
  r = president.applyAction(s, "c", { type: "play", cardIds: [s.hands.c[0].id] });
  assert.ok(r.ok, "le 3e 8 est accepte");
  assert.strictEqual(s.ouRien, "8");
  assert.strictEqual(s.currentTurn, "a");
  r = president.applyAction(s, "a", { type: "pass" });
  assert.ok(r.ok);
  assert.strictEqual(s.ouRien, null, "apres un passe, le ou rien tombe");
  r = president.applyAction(s, "b", { type: "play", cardIds: [s.hands.b[0].id] });
  assert.ok(r.ok, "le 9 est accepte apres le passe");
  r = president.applyAction(s, "c", { type: "play", cardIds: [s.hands.c.find((c) => c.rank === "2").id] });
  assert.ok(r.ok);
  assert.strictEqual(s.trick.length, 0, "le 2 ferme le pli");
  assert.strictEqual(s.currentTurn, "c", "celui qui pose le 2 rejoue");
  r = president.applyAction(s, "c", { type: "play", cardIds: [s.hands.c[0].id] });
  assert.ok(r.ok);
}
{
  // fin sur un 2 = trou du cul
  const s = president.createGame(["a", "b", "c"]);
  const card = (rank, suit) => ({ id: `${rank}-${suit}-${Math.random()}`, rank, suit });
  s.hands = { a: [card("2", "coeur")], b: [card("5", "pique"), card("9", "pique")], c: [card("7", "trefle"), card("V", "pique")] };
  s.seatOrder = ["a", "b", "c"];
  s.currentTurn = "a";
  s.trick = [];
  s.discardCount = 52 - 5;
  let r = president.applyAction(s, "a", { type: "play", cardIds: [s.hands.a[0].id] });
  assert.ok(r.ok);
  assert.ok(s.disqualified.includes("a"));
  // b et c finissent
  while (s.phase === "playing") {
    const cur = s.currentTurn;
    const plays = legalPlays(s, cur);
    if (plays.length) president.applyAction(s, cur, { type: "play", cardIds: plays[0].map((c) => c.id) });
    else president.applyAction(s, cur, { type: "pass" });
  }
  assert.strictEqual(s.lastRanking[2].id, "a", "fini sur un 2 = dernier");
  assert.strictEqual(s.roles.a, "trou");
}

console.log("SUCCES Président :", JSON.stringify(stats));
