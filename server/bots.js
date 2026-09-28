// Robots joueurs : ils completent la table quand on est peu nombreux.
// Chaque fonction regarde l'etat brut de la partie et renvoie la liste des
// actions a tenter (par ordre de preference), ou [] si le robot n'a rien a
// faire pour l'instant. Le serveur les joue avec un petit delai "humain".
//
// Trois niveaux (reglage du patron dans le salon) :
// - "facile" : joue souvent au hasard, se trompe, bluffe mal ;
// - "normal" : joue raisonnablement ;
// - "fort"   : compte les cartes, calcule ses chances (probabilites au
//              Menteur, simulation des tableaux au poker...).

const president = require("./games/president");
const ascenseur = require("./games/ascenseur");
const poker = require("./games/poker");
const { bestHand, VALUE, fastScore } = require("./games/pokerEval");
const { buildStandardDeck } = require("./deck");

const LEVELS = ["facile", "normal", "fort"];

const BOT_NAMES = ["Gaston", "Josiane", "Marcel", "Paulette", "Firmin", "Germaine", "Lucien", "Simone", "Raymond", "Odette"];

const rand = (n) => Math.floor(Math.random() * n);
const chance = (p) => Math.random() < p;

const pickOne = (arr) => arr[rand(arr.length)];

// Combinaisons C(n, k) (petits nombres : suffisant ici).
function comb(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return r;
}
// Probabilite qu'une main de h cartes tiree parmi N contienne au moins m des
// K cartes recherchees (loi hypergeometrique).
function probAtLeast(N, K, h, m) {
  const total = comb(N, h);
  if (!total) return 0;
  let p = 0;
  for (let x = m; x <= Math.min(K, h); x += 1) p += (comb(K, x) * comb(N - K, h - x)) / total;
  return p;
}

function groupByRank(hand) {
  const g = {};
  for (const c of hand) (g[c.rank] = g[c.rank] || []).push(c);
  return g;
}

// ------------------------------------------------------------------ Menteur

function menteurActions(state, id, level) {
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
    const quadGone = (state.removedQuads || []).some((q) => q.rank === claimed);
    if (level === "fort") {
      // calcul : probabilite que l'accuse ait vraiment eu ces cartes
      const others = state.seatOrder.filter((pid) => pid !== id).reduce((t, pid) => t + (state.hands[pid] || []).length, 0);
      const unknown = others + state.pileCards.length;
      const truth = probAtLeast(unknown, Math.max(0, 4 - mine), accusedLeft + count, count);
      p = truth < 0.3 ? 0.9 : truth < 0.5 ? 0.45 : truth < 0.7 ? 0.12 : 0.03;
      // plus la pile est grosse, plus on hesite a se tromper
      if (state.pileCards.length > 10 && truth > 0.4) p *= 0.5;
      if (accusedLeft === 0) p = truth < 0.9 ? 1 : 0.5;
    } else if (level === "facile") {
      p = 0.1 + Math.random() * 0.25; // accuse un peu au hasard
    }
    if (mine + count > 4 || quadGone) p = level === "facile" ? 0.6 : 1; // impossible : c'est forcement un bluff
    if (accusedLeft === 0 && level !== "fort") p = Math.max(p, level === "facile" ? 0.4 : 0.75); // il allait gagner
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
    if (level === "facile" && chance(0.35)) {
      // joue n'importe quoi
      const shuffled = hand.slice().sort(() => Math.random() - 0.5);
      out.push({ type: "play", cardIds: shuffled.slice(0, Math.min(shuffled.length, 1 + rand(3))).map((c) => c.id) });
    } else if (real.length && !chance(0.1)) {
      out.push({ type: "play", cardIds: real.slice(0, Math.min(3, real.length)).map((c) => c.id) });
    } else {
      // bluff : on se debarrasse des valeurs ou l'on a le moins de cartes
      // (le robot fort bluffe discretement, une seule carte)
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

function presidentActions(state, id, level) {
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

  // carre magique (meme hors de son tour) ; le robot facile le rate souvent
  const run = topRun(state);
  if ((level !== "facile" || chance(0.3)) && run.rank && run.rank !== "2" && groups[run.rank]) {
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
    let r = nonTwo.length ? nonTwo[0] : ranks[0];
    if (level === "facile" && chance(0.5)) r = pickOne(ranks);
    if (level === "fort" && nonTwo.length > 1) {
      // on ouvre avec un groupe (paire, brelan) parmi les petites cartes si
      // possible : ca bloque les autres et vide la main plus vite
      const low = nonTwo.filter((x) => STRENGTH[x] <= STRENGTH[nonTwo[0]] + 3);
      const multi = low.filter((x) => groups[x].length >= 2);
      if (multi.length) r = multi[0];
    }
    const cards = groups[r].filter((c, i) => !(r === "2" && i === groups[r].length - 1 && groups[r].length === hand.length));
    out.push({ type: "play", cardIds: (cards.length ? cards : groups[r]).map((c) => c.id) });
    if (r !== ranks[0]) out.push({ type: "play", cardIds: groups[ranks[0]].map((c) => c.id) });
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
  if (level === "facile") {
    // pas de strategie : une option au hasard, ou passe sans raison
    choice = chance(0.2) ? null : options.length ? pickOne(options) : null;
  } else if (level === "fort") {
    // ne casse pas une paire / un brelan pour jouer une carte seule
    const exact = options.filter((r) => r !== "2" && groups[r].length === need);
    const cheap = options.filter((r) => r !== "2");
    if (exact.length && (!cheap.length || STRENGTH[exact[0]] - STRENGTH[cheap[0]] <= 4)) choice = exact[0];
    else if (cheap.length) choice = cheap[0];
    // les 2 et les As servent a reprendre la main quand on en a besoin
    else if (options.includes("2")) choice = hand.length <= 5 || state.trick.length >= 2 ? "2" : null;
    // gros jeu adverse : inutile de gaspiller ses meilleures cartes
    if (choice && choice !== "2" && STRENGTH[choice] >= STRENGTH.A && hand.length > 6 && chance(0.5)) choice = null;
  }
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

// Gagnant d'un pli [{ playerId, card }] (atout, sinon plus forte de la couleur demandee).
function ascTrickWinner(trick, trumpSuit) {
  let best = trick[0];
  for (const p of trick.slice(1)) {
    const c = p.card;
    const b = best.card;
    const cT = c.suit === trumpSuit;
    const bT = b.suit === trumpSuit;
    if ((cT && !bT) || (cT === bT && c.suit === b.suit && POWER[c.rank] > POWER[b.rank])) best = p;
  }
  return best.playerId;
}

// Choix de la carte (robots normal et fort) : gagner avec la plus petite
// carte suffisante quand on veut des plis, sinon perdre avec la plus grosse
// carte possible.
function ascChoose(legal, trick, trumpSuit, id, need, fort) {
  const strength = (c) => POWER[c.rank] + (c.suit === trumpSuit ? 20 : 0);
  const byStrength = legal.slice().sort((a, b) => strength(a) - strength(b));
  const wouldWin = (c) => trick.length > 0 && ascTrickWinner(trick.concat([{ playerId: id, card: c }]), trumpSuit) === id;
  if (!trick.length) {
    if (need > 0 && fort) {
      // on entame avec un As hors atout avant de sortir ses atouts
      const ace = legal.find((c) => c.rank === "A" && c.suit !== trumpSuit);
      if (ace) return ace;
    }
    return need > 0 ? byStrength[byStrength.length - 1] : byStrength[0];
  }
  if (need > 0) return byStrength.find(wouldWin) || byStrength[0];
  const losing = byStrength.filter((c) => !wouldWin(c));
  return losing.length ? losing[losing.length - 1] : byStrength[0];
}

// Robot fort : simule la manche des dizaines de fois (mains adverses tirees
// au hasard) pour chaque annonce possible et garde la plus rentable.
function ascenseurSimBid(state, id, forbidden) {
  const n = state.sequence[state.roundIndex];
  const order = state.seatOrder;
  const trumpSuit = state.trump ? state.trump.suit : null;
  const known = new Set((state.hands[id] || []).map((c) => c.id).concat(state.trump ? [state.trump.id] : []));
  const pool = buildStandardDeck().filter((c) => !known.has(c.id));
  const dealerIdx = state.dealerIdx % order.length;
  const firstLeader = order[(dealerIdx + 1) % order.length];
  const samples = n > 7 ? 30 : n > 4 ? 50 : 80;
  const bids = [];
  for (let b = 0; b <= n; b += 1) if (b !== forbidden) bids.push(b);
  const total = Object.fromEntries(bids.map((b) => [b, 0]));
  for (let k = 0; k < samples; k += 1) {
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = rand(i + 1);
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const baseHands = {};
    let off = 0;
    for (const pid of order) {
      if (pid === id) baseHands[pid] = state.hands[id].slice();
      else { baseHands[pid] = pool.slice(off, off + n); off += n; }
    }
    const baseBids = {};
    for (const pid of order) {
      if (pid === id) continue;
      baseBids[pid] = state.bids[pid] !== undefined ? state.bids[pid] : Math.round(estimateTricks(baseHands[pid], trumpSuit, order.length));
    }
    for (const b of bids) {
      const hands = Object.fromEntries(order.map((pid) => [pid, baseHands[pid].slice()]));
      const won = Object.fromEntries(order.map((pid) => [pid, 0]));
      const want = { ...baseBids, [id]: b };
      let leader = firstLeader;
      for (let t = 0; t < n; t += 1) {
        const trick = [];
        let leadSuit = null;
        const li = order.indexOf(leader);
        for (let p = 0; p < order.length; p += 1) {
          const pid = order[(li + p) % order.length];
          const h = hands[pid];
          const follow = leadSuit ? h.filter((c) => c.suit === leadSuit) : [];
          const legal = follow.length ? follow : h;
          const card = ascChoose(legal, trick, trumpSuit, pid, want[pid] - won[pid], pid === id);
          h.splice(h.indexOf(card), 1);
          if (!leadSuit) leadSuit = card.suit;
          trick.push({ playerId: pid, card });
        }
        leader = ascTrickWinner(trick, trumpSuit);
        won[leader] += 1;
      }
      const diff = Math.abs(won[id] - b);
      total[b] += diff === 0 ? (b === 0 ? 20 : 40 * b) : -40 * diff;
    }
  }
  return bids.sort((x, y) => total[y] - total[x])[0];
}

function ascenseurActions(state, id, level) {
  const { legalCards, forbiddenBid } = ascenseur._internals;
  if (state.currentTurn !== id) return [];
  const hand = state.hands[id] || [];
  const trumpSuit = state.trump ? state.trump.suit : null;
  const n = state.sequence[state.roundIndex];

  if (state.phase === "bidding") {
    const f = forbiddenBid(state, id);
    const safe = { type: "bid", bid: f === 0 ? 1 : 0 };
    if (level === "fort") return [{ type: "bid", bid: ascenseurSimBid(state, id, f) }, safe];
    let raw = estimateTricks(hand, trumpSuit, state.seatOrder.length);
    if (level === "facile") raw += (Math.random() - 0.5) * 2.4; // annonce approximative
    let bid = Math.max(0, Math.min(n, Math.round(raw)));
    if (f !== null && bid === f) bid = raw >= bid ? Math.min(n, bid + 1) : Math.max(0, bid - 1);
    if (f !== null && bid === f) bid = bid === 0 ? 1 : bid - 1;
    return [{ type: "bid", bid }, safe];
  }
  if (state.phase !== "playing") return [];
  const legal = legalCards(state, id);
  if (!legal.length) return [];
  if (level === "facile" && chance(0.45)) {
    const c = pickOne(legal);
    return [{ type: "play", cardIds: [c.id] }, { type: "play", cardIds: [legal[0].id] }];
  }
  const need = (state.bids[id] || 0) - (state.won[id] || 0);
  const card = ascChoose(legal, state.trick, trumpSuit, id, need, level === "fort");
  return [{ type: "play", cardIds: [card.id] }, { type: "play", cardIds: [legal[0].id] }];
}

// ------------------------------------------------------------------ Pouilleux

function pouilleuxActions(state, id) {
  if (state.phase !== "playing" || state.currentTurn !== id) return [];
  const victim = require("./games/pouilleux")._internals.victimOf(state, id);
  if (!victim) return [];
  const n = state.hands[victim].length;
  return [{ type: "draw", index: rand(n) }, { type: "draw", index: 0 }];
}

// ------------------------------------------------------------------ Poker

// Force estimee de la main entre 0 et 1.
function pokerStrength(hole, board) {
  const v = hole.map((c) => VALUE[c.rank]).sort((a, b) => b - a);
  if (board.length === 0) {
    if (v[0] === v[1]) return 0.5 + v[0] / 28;
    let s = ((v[0] + v[1]) / 28) * 0.6;
    if (hole[0].suit === hole[1].suit) s += 0.06;
    if (v[0] - v[1] <= 2) s += 0.04;
    if (v[0] === 14) s += 0.08;
    return Math.min(0.95, s);
  }
  const all = hole.concat(board);
  const mine = bestHand(all);
  const cat = mine.score[0];
  let s = [0.12, 0.42, 0.65, 0.75, 0.82, 0.86, 0.93, 0.98, 1][cat];
  // main qui ne vient que du tableau : tout le monde l'a
  if (board.length >= 5) {
    const table = bestHand(board);
    if (table.score.join() === mine.score.join()) s = 0.15;
  } else if (cat === 1) {
    const pairVal = mine.score[1];
    if (!hole.some((c) => VALUE[c.rank] === pairVal)) s = 0.2; // paire du tableau
    else if (pairVal >= Math.max(...board.map((c) => VALUE[c.rank]))) s += 0.1; // paire max
  }
  // tirage couleur au flop / turn
  if (board.length < 5) {
    const suits = {};
    all.forEach((c) => { suits[c.suit] = (suits[c.suit] || 0) + 1; });
    if (Object.entries(suits).some(([suit, k]) => k === 4 && hole.some((c) => c.suit === suit))) s += 0.12;
  }
  return Math.min(1, s);
}

// Chances de gagner la main (simulation) contre les adversaires encore en
// course, pour le robot fort.
function pokerEquity(state, id, samples = 300) {
  const opp = state.inHand.filter((p) => p !== id && !state.folded.includes(p)).length;
  const known = new Set(state.holes[id].concat(state.board).map((c) => c.id));
  const deck = buildStandardDeck().filter((c) => !known.has(c.id));
  let win = 0;
  for (let k = 0; k < samples; k += 1) {
    // melange partiel suffisant pour tirer les cartes necessaires
    const need = opp * 2 + (5 - state.board.length);
    for (let i = 0; i < need; i += 1) {
      const j = i + rand(deck.length - i);
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    const board = state.board.concat(deck.slice(opp * 2, need));
    const me = fastScore(state.holes[id].concat(board));
    let best = 0;
    let tie = 1;
    for (let o = 0; o < opp; o += 1) {
      const s = fastScore(deck.slice(o * 2, o * 2 + 2).concat(board));
      if (s > me) { best = -1; break; }
      if (s === me) tie += 1;
    }
    if (best === 0) win += 1 / tie;
  }
  return win / samples;
}

function pokerActions(state, id, level) {
  if (state.options.rebuy && state.stacks[id] === 0 && state.phase !== "finished") {
    const inHand = (state.phase === "betting" || state.phase === "runout") && state.inHand.includes(id) && !state.folded.includes(id);
    if (!inHand) return [{ type: "rebuy" }];
  }
  // prochain donneur : lance la main suivante (apres avoir laisse le temps
  // de regarder le resultat)
  if (state.phase === "showdown" && state.nextDealerId === id) return [{ type: "next_hand" }];
  if (state.phase !== "betting" || state.currentTurn !== id) return [];
  const L = poker._internals.legal(state, id);
  const s = pokerStrength(state.holes[id], state.board);
  const pot = Object.values(state.contrib).reduce((a, b) => a + b, 0);
  const stack = state.stacks[id];
  const passive = L.canCheck ? { type: "bet", kind: "check" } : { type: "bet", kind: "call" };
  const fold = { type: "bet", kind: "fold" };
  const raiseTo = (frac) => ({ type: "bet", kind: "raise", amount: Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, state.currentBet + Math.round((pot * frac) / state.bb) * state.bb)) });
  const out = [];
  if (level === "facile") {
    // "station de suivi" : suit beaucoup, relance rarement, se couche au hasard
    if (L.canCheck) out.push(L.canRaise && chance(s > 0.7 ? 0.3 : 0.05) ? raiseTo(0.5) : passive);
    else if (L.toCall > stack * 0.5 && s < 0.6 && chance(0.6)) out.push(fold);
    else out.push(chance(0.12) ? fold : passive);
    out.push(passive, fold);
    return out;
  }
  if (level === "fort") {
    // chances reelles de gagner vs cote du pot, taille de mise adaptee,
    // bluffs occasionnels
    const eq = pokerEquity(state, id);
    const odds = L.toCall / (pot + L.toCall || 1);
    const opp = state.inHand.filter((p) => p !== id && !state.folded.includes(p)).length;
    const strongLine = 1 / (opp + 1) + 0.25;
    if (eq > Math.max(0.62, strongLine)) {
      if (L.canRaise) out.push(eq > 0.85 && chance(0.4) && state.board.length >= 3 ? { type: "bet", kind: "allin" } : raiseTo(eq > 0.75 ? 0.9 : 0.6));
      out.push(passive);
    } else if (L.canCheck) {
      // bluff / semi-bluff de temps en temps, surtout contre un seul adversaire
      if (L.canRaise && chance(opp === 1 ? 0.22 : 0.08)) out.push(raiseTo(0.55));
      out.push(passive);
    } else if (eq > odds + 0.04 || (L.toCall <= state.bb && eq > 0.2)) {
      if (L.canRaise && eq > 0.5 && chance(0.3)) out.push(raiseTo(0.6));
      out.push(passive);
    } else {
      out.push(fold);
    }
    out.push(passive, fold);
    return out;
  }
  if (s > 0.8) {
    if (L.canRaise && chance(0.7)) out.push(raiseTo(0.75));
    out.push(passive);
  } else if (s > 0.55) {
    if (L.canCheck) out.push(L.canRaise && chance(0.5) ? raiseTo(0.5) : passive);
    else if (L.toCall <= stack * 0.35 || s > 0.7) out.push(passive);
    else out.push(fold);
  } else if (s > 0.35) {
    const odds = L.toCall / (pot + L.toCall || 1);
    if (L.canCheck) out.push(L.canRaise && chance(0.1) ? raiseTo(0.5) : passive);
    else if (odds < s * 0.6 || L.toCall <= state.bb) out.push(passive);
    else out.push(fold);
  } else {
    if (L.canCheck) out.push(L.canRaise && chance(0.08) ? raiseTo(0.6) : passive);
    else if (L.toCall <= state.bb && chance(0.5)) out.push(passive);
    else out.push(fold);
  }
  out.push(passive, fold);
  return out;
}


// ------------------------------------------------------------------ Tarot

const tarotEngine = require("./games/tarot");

// Force d'une main de Tarot (methode des points, ramenee a une main de 18).
function tarotHandScore(hand, n) {
  const T = tarotEngine._internals;
  const trumps = hand.filter(T.isTrump);
  const t = trumps.length + (hand.some(T.isExcuse) ? 1 : 0);
  let s = trumps.length * 2 + Math.max(0, trumps.length - 5) * 1.5;
  if (trumps.some((c) => c.rank === "21")) s += 8;
  if (hand.some(T.isExcuse)) s += 6;
  if (trumps.some((c) => c.rank === "1")) s += t >= 6 ? 6 : t >= 4 ? 2 : -2;
  s += trumps.filter((c) => T.trumpValue(c) >= 16 && c.rank !== "21").length;
  for (const suit of ["pique", "coeur", "carreau", "trefle"]) {
    const cs = hand.filter((c) => c.suit === suit);
    const has = (r) => cs.some((c) => c.rank === r);
    if (has("R")) s += has("D") ? 8 : 6;
    else if (has("D")) s += 3;
    if (has("C")) s += 2;
    if (has("V")) s += 1;
    if (cs.length === 0 && trumps.length >= 5) s += 5;
    else if (cs.length === 1 && trumps.length >= 5) s += 2;
    if (cs.length >= 5) s += (cs.length - 4) * 2;
  }
  return (s * 18) / hand.length + (n === 5 ? 6 : n === 3 ? -4 : 0);
}

function tarotActions(state, id, level) {
  const T = tarotEngine._internals;
  const hand = state.hands[id] || [];
  const n = state.seatOrder.length;
  if (state.currentTurn !== id) return [];

  if (state.phase === "bidding") {
    let sc = tarotHandScore(hand, n);
    if (level === "facile") sc += (Math.random() - 0.5) * 24;
    // seuils du robot fort reglés par simulation (plus prudent a 4 joueurs)
    const th = level === "fort" ? (n === 4 ? [42, 56, 72, 86] : [34, 48, 64, 78]) : [38, 52, 68, 82];
    let want = -1;
    th.forEach((v, i) => { if (sc >= v) want = i; });
    want = Math.min(want, state.contracts.length - 1);
    const out = [];
    if (want > state.bestBid) out.push({ type: "bid", bid: state.contracts[want].key });
    out.push({ type: "bid", bid: "passe" });
    return out;
  }

  if (state.phase === "calling") {
    const rank = T.callableRank(state);
    const suits = ["pique", "coeur", "carreau", "trefle"];
    const missing = suits.filter((s) => !hand.some((c) => c.suit === s && c.rank === rank));
    let suit = pickOne(missing.length ? missing : suits);
    if (level !== "facile" && missing.length) {
      // appel dans la couleur ou l'on a le plus de soutien (Dame, Cavalier...)
      const support = (s) => hand.filter((c) => c.suit === s).reduce((t, c) => t + T.cardPoints(c) + 0.3, 0);
      suit = missing.slice().sort((a, b) => support(b) - support(a))[0];
    }
    return [{ type: "call", suit }, { type: "call", suit: missing[0] || "pique" }];
  }

  if (state.phase === "ecart") {
    const { size, needTrumps } = T.ecartRules(state);
    const colors = hand.filter((c) => !T.isTrump(c) && !T.isExcuse(c) && c.rank !== "R");
    const trumps = hand.filter((c) => T.isTrump(c) && !T.isBout(c)).sort((a, b) => T.trumpValue(a) - T.trumpValue(b));
    let chosen;
    if (level === "facile") chosen = colors.slice().sort(() => Math.random() - 0.5).slice(0, size);
    else {
      // on se coupe dans les couleurs courtes (sans Roi), et on met les
      // Dames / Cavaliers a l'abri
      const bySuit = {};
      for (const c of colors) (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
      const kingIn = (s) => hand.some((c) => c.suit === s && c.rank === "R");
      const order = Object.keys(bySuit).sort((a, b) => (kingIn(a) - kingIn(b)) || bySuit[a].length - bySuit[b].length);
      chosen = [];
      if (level === "fort") {
        for (const suit of order) {
          const cs = bySuit[suit].slice().sort((a, b) => T.cardPoints(b) - T.cardPoints(a));
          if (chosen.length + cs.length <= size && !kingIn(suit)) chosen.push(...cs);
        }
      }
      const rest = colors.filter((c) => !chosen.includes(c)).sort((a, b) => T.cardPoints(b) - T.cardPoints(a) || T.COLOR_POWER[a.rank] - T.COLOR_POWER[b.rank]);
      chosen = chosen.concat(rest).slice(0, size);
    }
    chosen = chosen.slice(0, size - needTrumps).concat(trumps.slice(0, needTrumps));
    return [{ type: "ecart", cardIds: chosen.map((c) => c.id) }];
  }

  if (state.phase === "chelem") {
    const sc = tarotHandScore(hand, n);
    return [{ type: "chelem", announce: level === "fort" && sc > 125 }];
  }

  if (state.phase !== "playing") return [];
  const out = [];
  // annonces avant la premiere carte
  if (T.poigneeLevels && state.trickNumber === 0 && state.played[id] === 0) {
    const lv = T.poigneeLevels(state, id);
    const isTaker = id === state.takerId;
    if (lv.length && !state.poignees[id] && (level === "facile" ? chance(0.6) : isTaker || lv.length > 1)) {
      out.push({ type: "announce", kind: "poignee", level: lv[lv.length - 1] });
    }
    const kinds = T.misereKinds(state, id).filter((k) => !(state.miseres[id] || []).includes(k));
    if (kinds.length) out.push({ type: "announce", kind: "misere", misere: kinds[0] });
    if (out.length) return out.slice(0, 1);
  }
  const legal = T.legalCards(state, id);
  if (!legal.length) return [];
  const play = (c) => [{ type: "play", cardIds: [c.id] }, { type: "play", cardIds: [legal[0].id] }];
  if (level === "facile" && chance(0.45)) return play(pickOne(legal));

  const F = () => level === "fort";
  const pts = (c) => T.cardPoints(c);
  const tv = T.trumpValue;
  const atk = T.attackCamp(state);
  const myAttack = atk.has(id);
  // camp d'un autre joueur, avec ce que le robot sait vraiment : a 5, le
  // partenaire reste inconnu (sauf de lui-meme) tant que le Roi n'est pas tombe
  const sameCamp = (other) => {
    if (other === id) return true;
    if (n < 5 || state.partnerRevealed) return atk.has(other) === myAttack;
    if (id === state.partnerId) return other === state.takerId;
    return false;
  };
  const trick = state.trick;
  const remainingAfterMe = n - trick.length - 1;
  const isLastTrick = hand.length === 1;
  const excuse = legal.find(T.isExcuse);
  const nonExcuse = legal.filter((c) => !T.isExcuse(c));
  // l'Excuse ne doit pas rester pour le dernier pli
  if (excuse && hand.length <= 2 && !isLastTrick) return play(excuse);
  if (excuse && nonExcuse.length === 0) return play(excuse);

  // cartes deja jouees (information publique) pour le robot fort
  const seenTrumps = new Set();
  if (level === "fort") {
    for (const e of state.history) if (e.type === "play" && e.suit === "atout" && e.donne === state.donne) seenTrumps.add(parseInt(e.rank, 10));
    for (const p of trick) if (T.isTrump(p.card)) seenTrumps.add(tv(p.card));
  }
  const isMaster = (c) => {
    if (!T.isTrump(c)) return false;
    for (let v = tv(c) + 1; v <= 21; v += 1) if (!seenTrumps.has(v) && !hand.some((h) => T.isTrump(h) && tv(h) === v)) return false;
    return true;
  };

  if (!trick.length) {
    const colors = nonExcuse.filter((c) => !T.isTrump(c));
    const trumps = nonExcuse.filter((c) => T.isTrump(c) && !T.isPetit(c));
    const bySuit = {};
    for (const c of colors) (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
    const king = colors.find((c) => c.rank === "R" && bySuit[c.suit].length <= 4);
    if (king && !(n === 5 && state.calledCard && king.suit === state.calledCard.suit && !myAttack)) return play(king);
    // le preneur avec beaucoup d'atouts les fait tomber
    if (myAttack && trumps.length >= 7 && level !== "facile") {
      const master = trumps.find(isMaster);
      return play(F() && master ? master : trumps.sort((a, b) => tv(b) - tv(a))[Math.min(1, trumps.length - 1)]);
    }
    // en defense a 5 : on joue dans la couleur appelee pour trouver le partenaire
    if (n === 5 && !myAttack && state.calledCard && bySuit[state.calledCard.suit] && !state.partnerRevealed) {
      return play(bySuit[state.calledCard.suit].sort((a, b) => pts(a) - pts(b))[0]);
    }
    const suits = Object.keys(bySuit).sort((a, b) => bySuit[b].length - bySuit[a].length);
    if (suits.length) {
      const cs = bySuit[suits[0]].sort((a, b) => pts(a) - pts(b) || T.COLOR_POWER[a.rank] - T.COLOR_POWER[b.rank]);
      return play(cs[0]);
    }
    const lowTrump = trumps.sort((a, b) => tv(a) - tv(b))[0];
    return play(lowTrump || nonExcuse[0]);
  }

  const winsWith = (c) => T.trickWinnerOf(trick.concat([{ playerId: id, card: c }]), false, null) === id;
  const curWinner = T.trickWinnerOf(trick, false, null);
  const curWinCard = trick.find((p) => p.playerId === curWinner).card;
  const friendWinning = sameCamp(curWinner);
  const trickPts = trick.reduce((t, p) => t + pts(p.card), 0);
  const petitInTrick = trick.some((p) => T.isPetit(p.card) && !sameCamp(p.playerId));
  const byPts = (a, b) => pts(a) - pts(b) || tv(a) - tv(b) || T.COLOR_POWER[a.rank] - T.COLOR_POWER[b.rank];
  const safeWin = (c) => remainingAfterMe === 0 || T.isTrump(c) || (!T.isTrump(c) && c.rank === "R" && !trick.some((p) => T.isTrump(p.card)) && trick.length >= n - 2);

  // le partenaire tient le pli : on charge (points), sans offrir le Petit
  if (friendWinning && (remainingAfterMe === 0 || (T.isTrump(curWinCard) && tv(curWinCard) >= 17) || (F() && T.isTrump(curWinCard) && isMaster(curWinCard)))) {
    const give = nonExcuse.filter((c) => !T.isPetit(c) || remainingAfterMe === 0).sort((a, b) => pts(b) - pts(a));
    const petit = nonExcuse.find(T.isPetit);
    if (petit && remainingAfterMe === 0 && level !== "facile") return play(petit); // Petit sauve
    if (give.length) return play(give[0]);
  }
  const winners = nonExcuse.filter(winsWith).sort((a, b) => tv(a) - tv(b) || T.COLOR_POWER[a.rank] - T.COLOR_POWER[b.rank]);
  if (winners.length && (!friendWinning || petitInTrick)) {
    // Petit : on le joue s'il gagne a coup sur (dernier a jouer)
    const petit = winners.find(T.isPetit);
    if (petit && remainingAfterMe === 0) return play(petit);
    const w = winners.filter((c) => !T.isPetit(c));
    if (w.length) {
      const sure = w.filter(safeWin);
      if (sure.length) return play(sure[0]);
      if (trickPts >= 3 || petitInTrick || myAttack) return play(w[w.length - 1]);
      return play(w[0]);
    }
  }
  // on perd le pli : la plus petite carte (Excuse si on devait lacher des points)
  const losers = nonExcuse.filter((c) => !T.isPetit(c)).sort(byPts);
  if (excuse && (!losers.length || pts(losers[0]) >= 1.5 || (F() && trickPts >= 4.5))) return play(excuse);
  if (losers.length) return play(losers[0]);
  return play(nonExcuse[0]);
}

const BOTS = { tarot: tarotActions, menteur: menteurActions, president: presidentActions, ascenseur: ascenseurActions, pouilleux: pouilleuxActions, poker: pokerActions };

function botActions(gameType, state, botId, level = "normal") {
  const f = BOTS[gameType];
  if (!f || !state) return [];
  if (!LEVELS.includes(level)) level = "normal";
  try {
    return f(state, botId, level) || [];
  } catch (e) {
    console.error("Robot en erreur :", e);
    return [];
  }
}

module.exports = { botActions, BOT_NAMES, LEVELS };
