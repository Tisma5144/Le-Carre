// Simulation du poker : evaluation des mains + parties completes avec des
// joueurs qui jouent au hasard. Verifie la conservation des jetons, les pots
// annexes, les blindes et la fin de partie.
// Usage : node test/simulate-poker.js
const assert = require("assert");
const poker = require("../server/games/poker");
const E = require("../server/games/pokerEval");

const C = (s) => s.split(" ").map((t, i) => {
  const suit = { s: "pique", h: "coeur", d: "carreau", c: "trefle" }[t.slice(-1)];
  return { id: t + i, rank: t.slice(0, -1), suit };
});
const name = (s) => E.bestHand(C(s)).name;
assert.strictEqual(name("A♠".replace("♠", "s") + " Rs Ds Vs 10s 2h 3c"), "Quinte flush royale");
assert.strictEqual(name("As 2d 3c 4h 5s Rd Rc"), "Quinte hauteur 5");
assert.strictEqual(name("7s 7h 7d 2c 2h Rs 9c"), "Full aux 7 par les 2");
assert.strictEqual(name("Rs Rh 7d 7c 2h 2s 9c"), "Double paire, Rois et 7");
assert.strictEqual(name("As 3s 9s Vs 2s Rh Rd"), "Couleur hauteur As");
assert.strictEqual(name("Ds Dh Dd Dc 2h 3s 9c"), "Carré de Dames");
assert.ok(E.compare(E.bestHand(C("As Ah 2d 3c 9h Vs 8d")).score, E.bestHand(C("Rs Rh Ad Dc 9h Vs 8d")).score) > 0, "paire d'As > paire de Rois");
assert.strictEqual(E.compare(E.bestHand(C("As 2h 5d 7c 9h Vs Rd")).score, E.bestHand(C("Ah 2s 5c 7d 9s Vh Rc")).score), 0, "egalite parfaite");

const stats = { games: 0, hands: 0, showdowns: 0, folds: 0, allins: 0, sidePots: 0, split: 0, rebuys: 0, runouts: 0, ghosts: 0, shows: 0 };
for (let g = 0; g < 80; g += 1) {
  const n = 2 + (g % 7);
  const ids = Array.from({ length: n }, (_, i) => "p" + i);
  const rebuy = g % 4 === 3;
  const s = poker.createGame(ids, { startStack: 500, blindEvery: 5, rebuy });
  stats.games += 1;
  let safety = 0;
  const total = () => ids.reduce((t, id) => t + s.stacks[id], 0) + Object.values(s.contrib).reduce((a, b) => a + b, 0);
  while (s.phase !== "finished" && safety < 30000) {
    safety += 1;
    const expected = ids.reduce((t, id) => t + s.buyins[id], 0) * 500;
    if (s.phase === "runout") {
      // tapis : revelation carte par carte, avec les chances de chacun
      assert.strictEqual(total(), expected, "jetons conserves pendant le tapis");
      if (s.equity) {
        const sum = Object.values(s.equity).reduce((a, b) => a + b, 0);
        assert.ok(sum >= 97 && sum <= 103, "les chances font ~100 % : " + sum);
      }
      const v = poker.getViewForPlayer(s, ids[0], Object.fromEntries(ids.map((id) => [id, { name: id }])));
      assert.ok(v.seats.filter((x) => x.cards).length >= 2, "mains des joueurs a tapis retournees");
      if (s.board.length === 0) stats.runouts += 1;
      assert.ok(poker.tick(s).ok);
      continue;
    }
    if (s.phase === "showdown" || s.phase === "waiting") {
      assert.strictEqual(ids.reduce((t, id) => t + s.stacks[id], 0), expected, "jetons conserves apres la main");
      if (s.results) {
        stats.hands += 1;
        if (s.results.byFold) stats.folds += 1; else stats.showdowns += 1;
        if (s.results.pots > 1) stats.sidePots += 1;
        if (s.results.winners.length > 1) stats.split += 1;
      }
      if (rebuy) for (const id of ids) if (s.stacks[id] === 0 && poker.applyAction(s, id, { type: "rebuy" }).ok) stats.rebuys += 1;
      if (rebuy && s.handNumber >= 40) { assert.ok(poker.applyAction(s, ids[0], { type: "end_game" }, { isHost: true }).ok); break; }
      if (s.phase === "showdown" && s.nextDealerId) {
        // montrer ses cartes / voir le tableau qui aurait pu tomber
        if (s.board.length < 5 && Math.random() < 0.5) {
          assert.ok(poker.applyAction(s, ids[1], { type: "reveal_board" }).ok);
          assert.strictEqual(s.board.length + s.ghostBoard.length, 5, "tableau fantome complet");
          stats.ghosts += 1;
        }
        const shower = s.inHand[0];
        if (Math.random() < 0.3 && poker.applyAction(s, shower, { type: "show_cards" }).ok) {
          const v = poker.getViewForPlayer(s, ids.find((id) => id !== shower), Object.fromEntries(ids.map((id) => [id, { name: id }])));
          assert.ok(v.seats.find((x) => x.id === shower).cards, "cartes montrees visibles");
          stats.shows += 1;
        }
        const notDealer = ids.find((id) => id !== s.nextDealerId);
        assert.ok(!poker.applyAction(s, notDealer, { type: "next_hand" }, { isHost: false }).ok, "seul le prochain donneur relance");
        const dealer = s.nextDealerId;
        assert.ok(poker.applyAction(s, dealer, { type: "next_hand" }).ok);
        if (s.phase === "betting") assert.strictEqual(s.seatOrder[s.dealerIdx], dealer, "le prochain donneur a bien le bouton");
        continue;
      }
      const r = poker.tick(s);
      if (!r.ok) break;
      continue;
    }
    assert.strictEqual(total(), expected, "jetons conserves pendant la main");
    const cur = s.currentTurn;
    assert.ok(cur, "quelqu'un doit parler");
    assert.ok(!s.folded.includes(cur) && !s.allIn.includes(cur), "le joueur qui parle peut agir");
    const other = ids.find((id) => id !== cur);
    assert.ok(!poker.applyAction(s, other, { type: "bet", kind: "fold" }).ok || other === cur, "hors tour refuse");
    const L = poker._internals.legal(s, cur);
    const r = Math.random();
    let a;
    if (r < 0.15 && !L.canCheck) a = { kind: "fold" };
    else if (r < 0.2) { a = { kind: "allin" }; stats.allins += 1; }
    else if (r < 0.4 && L.canRaise) a = { kind: "raise", amount: L.minRaiseTo + Math.floor(Math.random() * 3) * s.bb };
    else a = L.canCheck ? { kind: "check" } : { kind: "call" };
    const res = poker.applyAction(s, cur, { type: "bet", ...a });
    assert.ok(res.ok, res.error + " " + JSON.stringify(a) + " " + JSON.stringify(L));
  }
  assert.ok(safety < 30000, "la partie avance");
  if (!rebuy) {
    assert.strictEqual(s.phase, "finished");
    assert.strictEqual(ids.filter((id) => s.stacks[id] > 0).length, 1, "un seul joueur garde les jetons");
  }
}
console.log("SUCCES Poker :", JSON.stringify(stats));

// pot annexe precis : A (tapis 100) a la meilleure main, B la deuxieme
{
  const s = poker.createGame(["A", "B", "C"], { startStack: 1000 });
  s.inHand = ["A", "B", "C"];
  s.folded = [];
  s.allIn = ["A"];
  s.contrib = { A: 100, B: 300, C: 300 };
  s.stacks = { A: 0, B: 700, C: 700 };
  s.board = C("2s 7d 9c Vh Rs");
  s.holes = { A: C("As Ad"), B: C("8h 8d"), C: C("3c 4c") };
  poker._internals.showdown(s);
  assert.strictEqual(s.stacks.A, 300, "A gagne le pot principal (3 x 100)");
  assert.strictEqual(s.stacks.B, 700 + 400, "B gagne le pot annexe (2 x 200)");
  assert.strictEqual(s.stacks.C, 700);
  console.log("SUCCES Pot annexe : " + JSON.stringify(s.results.winners.map((w) => [w.id, w.amount, w.handName])));
}

// evaluation rapide (chances pendant un tapis) = meme classement que bestHand
{
  const { buildStandardDeck, shuffle } = require("../server/deck");
  for (let i = 0; i < 5000; i += 1) {
    const d = shuffle(buildStandardDeck());
    const a = d.slice(0, 7);
    const b = d.slice(7, 14);
    assert.strictEqual(Math.sign(E.compare(E.bestHand(a).score, E.bestHand(b).score)), Math.sign(E.fastScore(a) - E.fastScore(b)), "fastScore coherent");
  }
  console.log("SUCCES Evaluation rapide coherente sur 5000 duels.");
}
