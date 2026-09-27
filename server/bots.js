// Robots joueurs : ils completent la table quand on est peu nombreux.
// Chaque fonction regarde l'etat brut de la partie et renvoie la liste des
// actions a tenter (par ordre de preference), ou [] si le robot n'a rien a
// faire pour l'instant. Le serveur les joue avec un petit delai "humain".

const president = require("./games/president");
const ascenseur = require("./games/ascenseur");

const BOT_NAMES = ["Gaston", "Josiane", "Marcel", "Paulette", "Firmin", "Germaine", "Lucien", "Simone", "Raymond", "Odette"];

const rand = (n) => Math.floor(Math.random() * n);
const chance = (p) => Math.random() < p;

function groupByRank(hand) {
  const g = {};
  for (const c of hand) (g[c.rank] = g[c.rank] || []).push(c);
  return g;
}

// ------------------------------------------------------------------ Menteur

function menteurActions(state, id) {
  if (state.phase === "reveal_pending") {
    return state.pendingReveal && state.pendingReveal.loserId === id ? [{ type: "pickup" }] : [];
  }
  if (state.phase !== "playing" || state.currentTurn !== id) return [];
  if (state.finishedOrder.includes(id)) return [];
  const hand = state.hands[id] || [];
  const groups = groupByRank(hand);
  const out = [];

  // crier menteur ?
  if (state.lastPlay && state.canChallengeLastPlay && state.lastPlay.playerId !== id) {
    const claimed = state.roundLeaderRank;
    const mine = (groups[claimed] || []).length;
    const count = state.lastPlay.cards.length;
    const accusedLeft = (state.hands[state.lastPlay.playerId] || []).length;
    let p = 0.12 + mine * 0.18 + (count === 3 ? 0.15 : 0);
    if (mine + count > 4) p = 1; // impossible : c'est forcement un bluff
    if (accusedLeft === 0) p = Math.max(p, 0.75); // il allait gagner
    if (!hand.length) p = 1;
    if (chance(p)) out.push({ type: "accuse" });
  }
  if (!hand.length) return out;

  if (state.lastPlay === null) {
    // ouverture : la valeur dont on a le plus de cartes, en disant la verite
    const best = Object.values(groups).sort((a, b) => b.length - a.length)[0];
    const n = Math.min(3, best.length);
    out.push({ type: "play", cardIds: best.slice(0, n).map((c) => c.id), declaredRank: best[0].rank });
  } else {
    const real = groups[state.roundLeaderRank] || [];
    if (real.length && !chance(0.1)) {
      out.push({ type: "play", cardIds: real.slice(0, Math.min(3, real.length)).map((c) => c.id) });
    } else {
      // bluff : on se debarrasse des valeurs ou l'on a le moins de cartes
      const sorted = hand.slice().sort((a, b) => groups[a.rank].length - groups[b.rank].length);
      const n = Math.min(sorted.length, chance(0.3) ? 2 : 1);
      out.push({ type: "play", cardIds: sorted.slice(0, n).map((c) => c.id) });
    }
  }
  // secours : une carte au hasard
  out.push({ type: "play", cardIds: [hand[rand(hand.length)].id], declaredRank: hand[0].rank });
  return out;
}

// ------------------------------------------------------------------ President

function presidentActions(state, id) {
  const { STRENGTH, topRun, isMagic, singleCloseForbidden } = president._internals;
  const hand = state.hands[id] || [];
  if (state.phase === "exchange" && state.exchange) {
    const task = state.exchange.pending.find((p) => p.from === id && !p.done);
    if (!task) return [];
    const worst = hand.slice().sort((a, b) => STRENGTH[a.rank] - STRENGTH[b.rank]).slice(0, task.count);
    return [{ type: "give", cardIds: worst.map((c) => c.id) }];
  }
  if (state.phase !== "playing" || !hand.length) return [];
  const finished = state.finishOrder.includes(id) || state.disqualified.includes(id);
  if (finished) return [];
  const groups = groupByRank(hand);
  const out = [];

  // carre magique (meme hors de son tour)
  const run = topRun(state);
  if (run.rank && run.rank !== "2" && groups[run.rank]) {
    const mine = groups[run.rank];
    if (run.count + mine.length === 4 && isMagic(state, mine) && !(mine.length === hand.length && run.rank === "2")) {
      out.push({ type: "play", cardIds: mine.map((c) => c.id) });
    }
  }
  if (state.currentTurn !== id) return out;

  const top = state.trick.length ? state.trick[state.trick.length - 1] : null;
  const ranks = Object.keys(groups).sort((a, b) => STRENGTH[a] - STRENGTH[b]);
  const nonTwo = ranks.filter((r) => r !== "2");
  if (!top) {
    // ouverture : la plus petite valeur, tout le groupe ; les 2 en dernier
    const r = nonTwo.length ? nonTwo[0] : ranks[0];
    out.push({ type: "play", cardIds: groups[r].map((c) => c.id) });
    return out;
  }
  const need = top.cards.length;
  const topRank = top.cards[0].rank;
  const options = ranks.filter((r) => {
    if (groups[r].length < need) return false;
    if (STRENGTH[r] < STRENGTH[topRank]) return false;
    if (state.ouRien && r !== state.ouRien) return false;
    const cards = groups[r].slice(0, need);
    if (singleCloseForbidden(state, cards)) return false;
    if (r === "2" && need === hand.length) return false; // interdit de finir sur un 2
    return true;
  });
  // on garde ses 2 pour plus tard, sauf en fin de main
  let choice = options.find((r) => r !== "2");
  if (!choice && options.includes("2") && (hand.length <= 4 || chance(0.5))) choice = "2";
  if (choice) out.push({ type: "play", cardIds: groups[choice].slice(0, need).map((c) => c.id) });
  out.push({ type: "pass" });
  return out;
}

// ------------------------------------------------------------------ Ascenseur

const POWER = Object.fromEntries(["2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R", "A"].map((r, i) => [r, i]));

function estimateTricks(hand, trumpSuit, nPlayers) {
  let e = 0;
  for (const c of hand) {
    const p = POWER[c.rank];
    if (c.suit === trumpSuit) e += p >= 11 ? 0.95 : p >= 8 ? 0.65 : p >= 5 ? 0.35 : 0.2;
    else if (c.rank === "A") e += 0.8;
    else if (c.rank === "R") e += hand.length >= 4 ? 0.45 : 0.3;
    else if (c.rank === "D" && hand.length >= 6) e += 0.15;
  }
  // plus on est nombreux, plus c'est dur de faire des plis
  return e * (nPlayers <= 3 ? 1.05 : nPlayers >= 6 ? 0.85 : 0.95);
}

function ascenseurActions(state, id) {
  const { legalCards, trickWinnerOf, forbiddenBid } = ascenseur._internals;
  if (state.currentTurn !== id) return [];
  const hand = state.hands[id] || [];
  const trumpSuit = state.trump ? state.trump.suit : null;
  const n = state.sequence[state.roundIndex];

  if (state.phase === "bidding") {
    const raw = estimateTricks(hand, trumpSuit, state.seatOrder.length);
    let bid = Math.max(0, Math.min(n, Math.round(raw)));
    const f = forbiddenBid(state, id);
    if (f !== null && bid === f) bid = raw >= bid ? Math.min(n, bid + 1) : Math.max(0, bid - 1);
    if (f !== null && bid === f) bid = bid === 0 ? 1 : bid - 1;
    return [{ type: "bid", bid }, { type: "bid", bid: f === 0 ? 1 : 0 }];
  }
  if (state.phase !== "playing") return [];
  const legal = legalCards(state, id);
  if (!legal.length) return [];
  const strength = (c) => POWER[c.rank] + (c.suit === trumpSuit ? 20 : 0);
  const wouldWin = (c) => {
    if (!state.trick.length) return false;
    const sim = { trump: state.trump, trick: state.trick.concat([{ playerId: id, card: c }]) };
    return trickWinnerOf(sim) === id;
  };
  const need = (state.bids[id] || 0) - (state.won[id] || 0);
  const byStrength = legal.slice().sort((a, b) => strength(a) - strength(b));
  let card;
  if (!state.trick.length) {
    // on entame : fort si on a besoin de plis, faible sinon
    card = need > 0 ? byStrength[byStrength.length - 1] : byStrength[0];
  } else if (need > 0) {
    card = byStrength.find(wouldWin) || byStrength[0];
  } else {
    const losing = byStrength.filter((c) => !wouldWin(c));
    card = losing.length ? losing[losing.length - 1] : byStrength[0];
  }
  return [{ type: "play", cardIds: [card.id] }, { type: "play", cardIds: [legal[0].id] }];
}

const BOTS = { menteur: menteurActions, president: presidentActions, ascenseur: ascenseurActions };

function botActions(gameType, state, botId) {
  const f = BOTS[gameType];
  if (!f || !state) return [];
  try {
    return f(state, botId) || [];
  } catch (e) {
    console.error("Robot en erreur :", e);
    return [];
  }
}

module.exports = { botActions, BOT_NAMES };
