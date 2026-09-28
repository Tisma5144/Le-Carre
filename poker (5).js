// Moteur du poker Texas Hold'em (no limit).
//
// Regles implementees (validees avec Mathis) :
// - Chaque joueur recoit un tapis de depart (1 000 jetons par defaut). Petite
//   et grosse blinde (10/20 par defaut) doublent toutes les X mains (reglable).
// - Deux cartes privees chacun, puis flop (3 cartes), turn et river, avec un
//   tour d'encheres a chaque etape : se coucher, check, suivre, relancer,
//   tapis. Relance minimale = derniere relance (au moins la grosse blinde).
// - Abattage : meilleure main de 5 cartes parmi 7 ; pots annexes quand un
//   joueur est a tapis ; partage en cas d'egalite.
// - Joueur sans jetons : elimine (la partie s'arrete quand il n'en reste
//   qu'un) ou recave possible selon le reglage du patron ; dans ce cas c'est
//   le patron qui arrete la partie.

const crypto = require("crypto");
const { buildStandardDeck, shuffle, cardPublicView } = require("../deck");
const { bestHand, compare, partialName, fastScore } = require("./pokerEval");

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const WAIT_MS = 1500;
const FINISH_MS = 5000;
const NEXT_HAND_GRACE_MS = 30000; // derniere main : pause avant l'ecran de fin
// Tapis de plusieurs joueurs : revelation au ralenti, carte par carte.
const RUNOUT_START_MS = 3200;
const RUNOUT_STREET_MS = 3000;
const RUNOUT_RIVER_MS = 3800;

function logEvent(state, entry) {
  state.eventSeq += 1;
  state.history.push({ id: state.eventSeq, at: Date.now(), hand: state.handNumber, ...entry });
  if (state.history.length > 400) state.history.splice(0, state.history.length - 400);
}

function normalizeOptions(o = {}) {
  const stacks = [500, 1000, 2000, 5000];
  const every = [0, 5, 10, 15, 20];
  const startStack = stacks.includes(Number(o.startStack)) ? Number(o.startStack) : 1000;
  const blindEvery = every.includes(Number(o.blindEvery)) ? Number(o.blindEvery) : 10;
  const rebuy = o.rebuy === true || o.rebuy === "true";
  return { startStack, blindEvery, rebuy, baseBlind: Math.max(5, Math.round(startStack / 100)) };
}

function createGame(playerIds, rawOptions) {
  const options = normalizeOptions(rawOptions);
  const seatOrder = shuffle(playerIds);
  const state = {
    id: "poker",
    uid: crypto.randomBytes(5).toString("hex"),
    eventSeq: 0,
    history: [],
    options,
    seatOrder,
    stacks: Object.fromEntries(seatOrder.map((id) => [id, options.startStack])),
    buyins: Object.fromEntries(seatOrder.map((id) => [id, 1])),
    eliminated: [],
    handNumber: 0,
    dealerIdx: Math.floor(Math.random() * seatOrder.length) - 1,
    sb: 0,
    bb: 0,
    level: 0,
    phase: "betting",
    street: "preflop",
    deck: [],
    board: [],
    holes: {},
    inHand: [],
    folded: [],
    allIn: [],
    bets: {},
    contrib: {},
    acted: [],
    currentBet: 0,
    minRaise: 0,
    currentTurn: null,
    lastAction: {},
    results: null,
    finishedBy: null
  };
  startHand(state);
  return state;
}

const seated = (state) => state.seatOrder.filter((id) => state.stacks[id] > 0 && !state.eliminated.includes(id));

function nextInHandAfter(state, fromId, canActOnly = true) {
  const o = state.seatOrder;
  const i = o.indexOf(fromId);
  for (let k = 1; k <= o.length; k += 1) {
    const c = o[(i + k) % o.length];
    if (!state.inHand.includes(c) || state.folded.includes(c)) continue;
    if (canActOnly && state.allIn.includes(c)) continue;
    return c;
  }
  return null;
}

function pay(state, id, amount) {
  const a = Math.min(amount, state.stacks[id]);
  state.stacks[id] -= a;
  state.bets[id] = (state.bets[id] || 0) + a;
  state.contrib[id] = (state.contrib[id] || 0) + a;
  if (state.stacks[id] === 0 && !state.allIn.includes(id)) state.allIn.push(id);
  return a;
}

function startHand(state) {
  const players = seated(state);
  if (players.length < 2) {
    if (!state.options.rebuy) return finish(state, "last_standing");
    // en attente d'une recave
    state.phase = "waiting";
    state.currentTurn = null;
    return;
  }
  state.handNumber += 1;
  const { blindEvery, baseBlind } = state.options;
  state.level = blindEvery ? Math.floor((state.handNumber - 1) / blindEvery) : 0;
  state.sb = baseBlind * Math.pow(2, state.level);
  state.bb = state.sb * 2;
  // bouton : prochain joueur assis
  const n = state.seatOrder.length;
  for (let k = 1; k <= n; k += 1) {
    const cand = state.seatOrder[(state.dealerIdx + k + n) % n];
    if (players.includes(cand)) {
      state.dealerIdx = state.seatOrder.indexOf(cand);
      break;
    }
  }
  const dealer = state.seatOrder[state.dealerIdx];
  state.inHand = players.slice();
  state.folded = [];
  state.allIn = [];
  state.bets = {};
  state.contrib = {};
  state.acted = [];
  state.board = [];
  state.results = null;
  state.lastAction = {};
  state.shownBy = [];
  state.ghostBoard = [];
  state.equity = null;
  state.nextDealerId = null;
  state.street = "preflop";
  state.phase = "betting";
  state.deck = shuffle(buildStandardDeck());
  state.holes = {};
  for (const id of state.inHand) state.holes[id] = [state.deck.pop(), state.deck.pop()];

  const headsUp = state.inHand.length === 2;
  const sbId = headsUp ? dealer : nextInHandAfter(state, dealer, false);
  const bbId = nextInHandAfter(state, sbId, false);
  state.sbId = sbId;
  state.bbId = bbId;
  pay(state, sbId, state.sb);
  pay(state, bbId, state.bb);
  state.lastAction[sbId] = `Petite blinde ${state.bets[sbId]}`;
  state.lastAction[bbId] = `Grosse blinde ${state.bets[bbId]}`;
  state.currentBet = Math.max(state.bets[sbId], state.bets[bbId]);
  state.minRaise = state.bb;
  logEvent(state, { type: "hand_start", dealerId: dealer, sb: state.sb, bb: state.bb, level: state.level, sbId, bbId });
  const first = headsUp ? sbId : nextInHandAfter(state, bbId);
  state.currentTurn = first;
  if (!first || roundComplete(state)) return advanceStreet(state);
  return null;
}

function active(state) {
  return state.inHand.filter((id) => !state.folded.includes(id));
}

function canAct(state) {
  return active(state).filter((id) => !state.allIn.includes(id));
}

function roundComplete(state) {
  const acting = canAct(state);
  if (active(state).length <= 1) return true;
  if (acting.length === 0) return true;
  if (acting.length === 1 && (state.bets[acting[0]] || 0) >= state.currentBet) return true;
  return acting.every((id) => state.acted.includes(id) && (state.bets[id] || 0) === state.currentBet);
}

function legal(state, id) {
  const bet = state.bets[id] || 0;
  const stack = state.stacks[id];
  const toCall = Math.max(0, state.currentBet - bet);
  const maxTo = bet + stack;
  const minTo = Math.min(maxTo, state.currentBet + Math.max(state.minRaise, state.bb));
  const othersCanAct = canAct(state).filter((x) => x !== id).length > 0;
  return {
    toCall: Math.min(toCall, stack),
    canCheck: toCall === 0,
    canCall: toCall > 0,
    canRaise: stack > toCall && othersCanAct,
    minRaiseTo: minTo,
    maxRaiseTo: maxTo
  };
}

function doBet(state, id, action) {
  if (state.phase !== "betting") return { ok: false, error: "Ce n'est pas le moment de miser." };
  if (state.currentTurn !== id) return { ok: false, error: "Ce n'est pas ton tour." };
  const L = legal(state, id);
  const kind = action.kind;
  let label = "";
  if (kind === "fold") {
    state.folded.push(id);
    label = "Se couche";
  } else if (kind === "check") {
    if (!L.canCheck) return { ok: false, error: `Il faut suivre ${L.toCall} ou se coucher.` };
    label = "Check";
  } else if (kind === "call") {
    if (!L.canCall) return { ok: false, error: "Rien à suivre : fais check." };
    const paid = pay(state, id, L.toCall);
    label = state.allIn.includes(id) ? `Tapis (${state.bets[id]})` : `Suit ${paid}`;
  } else if (kind === "allin" && !L.canRaise) {
    // personne ne peut plus suivre une relance : "tapis" = suivre
    if (L.canCheck) label = "Check";
    else {
      pay(state, id, L.toCall);
      label = state.allIn.includes(id) ? `Tapis (${state.bets[id]})` : `Suit ${L.toCall}`;
    }
  } else if (kind === "raise" || kind === "allin") {
    let to = kind === "allin" ? L.maxRaiseTo : Math.floor(Number(action.amount));
    if (!Number.isFinite(to)) return { ok: false, error: "Montant invalide." };
    to = Math.min(to, L.maxRaiseTo);
    if (to <= state.currentBet) {
      // tapis inferieur ou egal a la mise : c'est un suivi
      if (kind === "allin") {
        pay(state, id, L.maxRaiseTo - (state.bets[id] || 0));
        label = `Tapis (${state.bets[id]})`;
      } else return { ok: false, error: "Relance trop petite." };
    } else {
      if (!L.canRaise) return { ok: false, error: "Tu ne peux plus relancer." };
      if (to < L.minRaiseTo && to < L.maxRaiseTo) return { ok: false, error: `Relance minimum : ${L.minRaiseTo}.` };
      const wasBet = state.currentBet === 0;
      const raiseSize = to - state.currentBet;
      pay(state, id, to - (state.bets[id] || 0));
      if (raiseSize >= state.minRaise) state.minRaise = raiseSize;
      state.currentBet = to;
      state.acted = [];
      label = state.allIn.includes(id) ? `Tapis (${to})` : wasBet ? `Mise ${to}` : `Relance à ${to}`;
    }
  } else {
    return { ok: false, error: "Action inconnue." };
  }
  if (!state.acted.includes(id)) state.acted.push(id);
  state.lastAction[id] = label;
  logEvent(state, { type: "bet", playerId: id, kind, label, amount: state.bets[id] || 0, street: state.street });

  if (active(state).length === 1) return winByFold(state);
  if (roundComplete(state)) return advanceStreet(state);
  state.currentTurn = nextInHandAfter(state, id);
  return { ok: true };
}

function collectStreet(state) {
  state.bets = {};
  state.acted = [];
  state.currentBet = 0;
  state.minRaise = state.bb;
}

function advanceStreet(state) {
  const order = ["preflop", "flop", "turn", "river"];
  collectStreet(state);
  // si plus personne (ou un seul) ne peut miser, on deroule tout le tableau
  const runOut = canAct(state).length <= 1;
  if (runOut && active(state).length >= 2 && state.board.length < 5) {
    // plusieurs joueurs a tapis : on retourne les mains et on revele le
    // tableau au ralenti, avec les chances de chacun (suspense !)
    state.phase = "runout";
    state.currentTurn = null;
    state.equity = equity(state);
    logEvent(state, { type: "allin_reveal", players: active(state), equity: state.equity });
    return { ok: true, schedule: RUNOUT_START_MS };
  }
  do {
    const i = order.indexOf(state.street);
    if (i === 3) return showdown(state);
    state.street = order[i + 1];
    const n = state.street === "flop" ? 3 : 1;
    for (let k = 0; k < n; k += 1) state.board.push(state.deck.pop());
    logEvent(state, { type: "street", street: state.street, cards: state.board.length });
  } while (runOut);
  for (const id of active(state)) if (!state.allIn.includes(id)) delete state.lastAction[id];
  const dealer = state.seatOrder[state.dealerIdx];
  state.currentTurn = nextInHandAfter(state, dealer);
  if (!state.currentTurn || roundComplete(state)) return advanceStreet(state);
  return { ok: true };
}

function dealStreet(state) {
  const order = ["preflop", "flop", "turn", "river"];
  const i = order.indexOf(state.street);
  state.street = order[i + 1];
  const n = state.street === "flop" ? 3 : 1;
  for (let k = 0; k < n; k += 1) state.board.push(state.deck.pop());
  logEvent(state, { type: "street", street: state.street, cards: state.board.length, runout: true });
}

// Chances de gain de chaque joueur encore en course (egalites partagees) :
// enumeration exacte s'il manque 1 ou 2 cartes, tirages aleatoires sinon.
function equity(state) {
  const players = active(state);
  const need = 5 - state.board.length;
  const deck = state.deck;
  const wins = Object.fromEntries(players.map((id) => [id, 0]));
  let total = 0;
  const score = (board) => {
    let best = -1;
    let winners = [];
    for (const id of players) {
      const s = fastScore(state.holes[id].concat(board));
      if (s > best) { best = s; winners = [id]; } else if (s === best) winners.push(id);
    }
    for (const id of winners) wins[id] += 1 / winners.length;
    total += 1;
  };
  if (need === 0) score(state.board);
  else if (need === 1) for (const c of deck) score(state.board.concat([c]));
  else if (need === 2) {
    for (let a = 0; a < deck.length; a += 1) for (let b = a + 1; b < deck.length; b += 1) score(state.board.concat([deck[a], deck[b]]));
  } else {
    for (let k = 0; k < 3000; k += 1) {
      const pick = [];
      const used = new Set();
      while (pick.length < need) {
        const i = Math.floor(Math.random() * deck.length);
        if (!used.has(i)) { used.add(i); pick.push(deck[i]); }
      }
      score(state.board.concat(pick));
    }
  }
  return Object.fromEntries(players.map((id) => [id, Math.round((wins[id] / total) * 100)]));
}

function winByFold(state) {
  collectStreet(state);
  const winner = active(state)[0];
  const pot = Object.values(state.contrib).reduce((a, b) => a + b, 0);
  state.stacks[winner] += pot;
  state.results = { byFold: true, winners: [{ id: winner, amount: pot, handName: null }], shown: {}, best: {}, pot };
  logEvent(state, { type: "win", playerId: winner, amount: pot, byFold: true });
  return endHand(state);
}

function showdown(state) {
  const contenders = active(state);
  const hands = {};
  for (const id of contenders) hands[id] = bestHand(state.holes[id].concat(state.board));
  // pots successifs (pot principal + pots annexes)
  const levels = [...new Set(Object.values(state.contrib).filter((v) => v > 0))].sort((a, b) => a - b);
  const won = {};
  let prev = 0;
  const pots = [];
  for (const level of levels) {
    let amount = 0;
    for (const v of Object.values(state.contrib)) amount += Math.max(0, Math.min(v, level) - prev);
    let eligible = contenders.filter((id) => (state.contrib[id] || 0) >= level);
    if (!eligible.length) eligible = contenders;
    let best = null;
    let winners = [];
    for (const id of eligible) {
      const c = best ? compare(hands[id].score, best) : 1;
      if (c > 0) {
        best = hands[id].score;
        winners = [id];
      } else if (c === 0) winners.push(id);
    }
    // partage ; les jetons restants vont au premier gagnant apres le bouton
    const share = Math.floor(amount / winners.length);
    let rest = amount - share * winners.length;
    const ordered = state.seatOrder.slice(state.dealerIdx + 1).concat(state.seatOrder.slice(0, state.dealerIdx + 1)).filter((id) => winners.includes(id));
    for (const id of ordered) {
      won[id] = (won[id] || 0) + share + (rest > 0 ? 1 : 0);
      if (rest > 0) rest -= 1;
    }
    pots.push({ amount, winners });
    prev = level;
  }
  for (const [id, amount] of Object.entries(won)) state.stacks[id] += amount;
  state.results = {
    byFold: false,
    winners: Object.entries(won).map(([id, amount]) => ({ id, amount, handName: hands[id].name })),
    shown: Object.fromEntries(contenders.map((id) => [id, hands[id].name])),
    best: Object.fromEntries(Object.keys(won).map((id) => [id, hands[id].cards.map((c) => c.id)])),
    pots: pots.length,
    pot: levels.length ? pots.reduce((t, p) => t + p.amount, 0) : 0
  };
  logEvent(state, { type: "showdown", winners: state.results.winners.map((w) => ({ id: w.id, amount: w.amount, handName: w.handName })) });
  return endHand(state);
}

// Fin de main : on attend que le prochain donneur lance la main suivante
// (sauf si la partie est terminee).
function endHand(state) {
  state.phase = "showdown";
  state.currentTurn = null;
  state.equity = null;
  for (const id of state.inHand) {
    if (state.stacks[id] === 0) {
      if (state.options.rebuy) logEvent(state, { type: "busted", playerId: id });
      else if (!state.eliminated.includes(id)) {
        state.eliminated.push(id);
        logEvent(state, { type: "eliminated", playerId: id, place: state.seatOrder.length - state.eliminated.length + 1 });
      }
    }
  }
  const players = seated(state);
  if (players.length < 2 && !state.options.rebuy) return { ok: true, schedule: FINISH_MS };
  setNextDealer(state);
  state.handEndedAt = Date.now();
  return { ok: true };
}

// Prochain donneur : le joueur assis apres le donneur actuel. C'est lui qui
// lance la main suivante.
function setNextDealer(state) {
  const players = seated(state);
  const n = state.seatOrder.length;
  state.nextDealerId = null;
  for (let k = 1; k <= n; k += 1) {
    const cand = state.seatOrder[(state.dealerIdx + k) % n];
    if (players.includes(cand)) {
      state.nextDealerId = cand;
      break;
    }
  }
}

// Pauses automatiques : revelation au ralenti d'un tapis, fin de partie,
// reprise apres une recave.
function tick(state) {
  if (state.phase === "runout") {
    if (state.board.length >= 5) return showdown(state);
    dealStreet(state);
    state.equity = equity(state); // au river : 100 % pour le gagnant
    return { ok: true, schedule: state.board.length >= 5 ? RUNOUT_RIVER_MS : RUNOUT_STREET_MS };
  }
  if (state.phase === "showdown") {
    // uniquement pour la fin de partie (sinon c'est le prochain donneur qui relance)
    if (seated(state).length >= 2 || state.options.rebuy) return { ok: false };
    return startHand(state) || { ok: true };
  }
  if (state.phase === "waiting" && seated(state).length >= 2) {
    const r = startHand(state);
    return { ok: true, schedule: r && r.schedule };
  }
  return { ok: false };
}

// Le prochain donneur (ou le patron) lance la main suivante.
function doNextHand(state, id, ctx) {
  if (state.phase !== "showdown") return { ok: false, error: "La main n'est pas terminée." };
  // le prochain donneur lance ; le patron peut le faire a sa place, et
  // n'importe qui apres 30 s (donneur parti chercher a boire...)
  const late = Date.now() - (state.handEndedAt || 0) > NEXT_HAND_GRACE_MS;
  if (id !== state.nextDealerId && !(ctx && ctx.isHost) && !late) return { ok: false, error: "C'est au prochain donneur de lancer la main." };
  const r = startHand(state);
  return { ok: true, schedule: r && r.schedule };
}

// Apres une main : voir les cartes qui seraient tombees.
function doRevealBoard(state, id) {
  if (state.phase !== "showdown") return { ok: false, error: "Attends la fin de la main." };
  const missing = 5 - state.board.length;
  if (missing <= 0) return { ok: false, error: "Tout le tableau est déjà retourné." };
  if (state.ghostBoard.length) return { ok: true };
  // les prochaines cartes du paquet, dans l'ordre ou elles seraient sorties
  state.ghostBoard = state.deck.slice(-missing).reverse();
  logEvent(state, { type: "reveal_board", playerId: id });
  return { ok: true };
}

// Apres une main : montrer ses cartes a la table.
function doShowCards(state, id) {
  if (state.phase !== "showdown") return { ok: false, error: "Attends la fin de la main." };
  if (!state.inHand.includes(id)) return { ok: false, error: "Tu n'étais pas dans cette main." };
  if (!state.shownBy.includes(id)) {
    state.shownBy.push(id);
    logEvent(state, { type: "show_cards", playerId: id });
  }
  return { ok: true };
}

function finish(state, reason) {
  state.phase = "finished";
  state.currentTurn = null;
  state.finishedBy = reason;
  logEvent(state, { type: "end", reason });
  return { ok: true };
}

function doRebuy(state, id) {
  if (!state.options.rebuy) return { ok: false, error: "Pas de recave dans cette partie." };
  if (state.phase === "finished") return { ok: false, error: "La partie est terminée." };
  if (state.stacks[id] > 0) return { ok: false, error: "Tu as encore des jetons." };
  if ((state.phase === "betting" || state.phase === "runout") && state.inHand.includes(id) && !state.folded.includes(id)) return { ok: false, error: "Attends la fin de la main." };
  state.stacks[id] = state.options.startStack;
  state.buyins[id] += 1;
  logEvent(state, { type: "rebuy", playerId: id });
  if (state.phase === "showdown") setNextDealer(state);
  if (state.phase === "waiting" && seated(state).length >= 2) return { ok: true, schedule: WAIT_MS };
  return { ok: true };
}

function doEnd(state, ctx) {
  if (!ctx || !ctx.isHost) return { ok: false, error: "Seul le patron peut arrêter la partie." };
  if (state.phase === "finished") return { ok: false, error: "La partie est déjà terminée." };
  // main en cours : chacun recupere ses mises
  if (state.phase === "betting" || state.phase === "runout") {
    for (const [id, v] of Object.entries(state.contrib)) state.stacks[id] += v;
    state.contrib = {};
  }
  return finish(state, "host");
}

function applyAction(state, playerId, action, ctx) {
  if (!state.seatOrder.includes(playerId)) return { ok: false, error: "Joueur inconnu dans cette partie." };
  switch (action.type) {
    case "bet": return doBet(state, playerId, action);
    case "rebuy": return doRebuy(state, playerId);
    case "end_game": return doEnd(state, ctx);
    case "next_hand": return doNextHand(state, playerId, ctx);
    case "reveal_board": return doRevealBoard(state, playerId);
    case "show_cards": return doShowCards(state, playerId);
    default: return { ok: false, error: `Action inconnue: ${action.type}` };
  }
}

function ranking(state) {
  const start = state.options.startStack;
  const rows = state.seatOrder.map((id) => ({ id, stack: state.stacks[id], net: state.stacks[id] - state.buyins[id] * start, buyins: state.buyins[id] }));
  if (!state.options.rebuy) {
    // les elimines sont classes du dernier elimine au premier
    const alive = rows.filter((r) => !state.eliminated.includes(r.id)).sort((a, b) => b.stack - a.stack);
    const out = state.eliminated.slice().reverse().map((id) => rows.find((r) => r.id === id));
    return alive.concat(out);
  }
  return rows.sort((a, b) => b.net - a.net);
}

function getViewForPlayer(state, playerId, players) {
  const name = (id) => (players[id] ? players[id].name : "?");
  const dealer = state.seatOrder[state.dealerIdx];
  const inHand = state.inHand.includes(playerId);
  const showdownNow = state.phase === "showdown" && state.results && !state.results.byFold;
  const runout = state.phase === "runout";
  const myTurn = state.phase === "betting" && state.currentTurn === playerId;
  const pot = Object.values(state.contrib).reduce((a, b) => a + b, 0);
  const seatView = (id) => {
    // cartes visibles : abattage, tapis revele, ou joueur qui choisit de montrer
    const shows = (showdownNow && state.results.shown[id] !== undefined)
      || (runout && active(state).includes(id))
      || (state.phase === "showdown" && state.shownBy.includes(id));
    const fullBoard = state.board.concat(state.ghostBoard || []);
    return {
      id,
      name: name(id),
      stack: state.stacks[id],
      bet: state.bets[id] || 0,
      inHand: state.inHand.includes(id),
      folded: state.folded.includes(id),
      allIn: state.allIn.includes(id),
      eliminated: state.eliminated.includes(id),
      busted: state.stacks[id] === 0 && !state.eliminated.includes(id),
      isDealer: id === dealer,
      isSB: id === state.sbId && state.phase !== "waiting",
      isBB: id === state.bbId && state.phase !== "waiting",
      cardCount: state.inHand.includes(id) && !state.folded.includes(id) ? 2 : 0,
      cards: shows ? state.holes[id].map(cardPublicView) : null,
      handName: shows ? (showdownNow && state.results.shown[id]) || partialName(state.holes[id].concat(fullBoard.length >= 3 ? fullBoard : state.board)) : null,
      equity: runout && state.equity ? state.equity[id] : null,
      showedVoluntarily: state.shownBy.includes(id),
      lastAction: state.lastAction[id] || null,
      buyins: state.buyins[id],
      connected: players[id] ? players[id].connected !== false : false
    };
  };
  const L = myTurn ? legal(state, playerId) : null;
  const myCards = inHand ? state.holes[playerId] : [];
  return {
    gameId: "poker",
    uid: state.uid,
    lastEventId: state.eventSeq,
    phase: state.phase,
    street: state.street,
    handNumber: state.handNumber,
    options: state.options,
    seatOrder: state.seatOrder,
    dealerId: dealer,
    sb: state.sb,
    bb: state.bb,
    level: state.level,
    nextLevelIn: state.options.blindEvery ? state.options.blindEvery - ((state.handNumber - 1) % state.options.blindEvery) : null,
    currentTurn: state.currentTurn,
    currentTurnName: state.currentTurn ? name(state.currentTurn) : "",
    currentBet: state.currentBet,
    pot,
    board: state.board.map(cardPublicView),
    ghostBoard: (state.ghostBoard || []).map(cardPublicView),
    nextDealerId: state.nextDealerId || null,
    nextDealerName: state.nextDealerId ? name(state.nextDealerId) : "",
    runout,
    hand: myCards.map(cardPublicView),
    seats: state.seatOrder.map(seatView),
    opponents: state.seatOrder.filter((id) => id !== playerId).map(seatView),
    results: state.results ? {
      byFold: state.results.byFold,
      winners: state.results.winners.map((w) => ({ ...w, name: name(w.id) })),
      best: showdownNow ? state.results.best : {},
      pot: state.results.pot || 0
    } : null,
    ranking: ranking(state).map((r) => ({ ...r, name: name(r.id) })),
    history: state.history.slice(-40).map((e) => ({ ...e, playerName: e.playerId ? name(e.playerId) : undefined, dealerName: e.dealerId ? name(e.dealerId) : undefined })),
    you: {
      id: playerId,
      isYourTurn: myTurn,
      inHand: inHand && !state.folded.includes(playerId),
      folded: state.folded.includes(playerId),
      stack: state.stacks[playerId],
      bet: state.bets[playerId] || 0,
      allIn: state.allIn.includes(playerId),
      handName: inHand && myCards.length ? partialName(myCards.concat(state.board)) : null,
      legal: L,
      canRebuy: state.options.rebuy && state.stacks[playerId] === 0 && state.phase !== "finished" && !((state.phase === "betting" || state.phase === "runout") && state.inHand.includes(playerId) && !state.folded.includes(playerId)),
      eliminated: state.eliminated.includes(playerId),
      isFinished: state.eliminated.includes(playerId),
      isNextDealer: state.phase === "showdown" && state.nextDealerId === playerId,
      hasShown: state.shownBy.includes(playerId)
    }
  };
}

module.exports = {
  id: "poker",
  name: "Poker Texas Hold'em",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  createGame,
  applyAction,
  tick,
  getViewForPlayer,
  normalizeOptions,
  _internals: { legal, active, canAct, bestHand, showdown, equity }
};
