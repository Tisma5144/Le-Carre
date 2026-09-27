// Moteur du jeu "L'Ascenseur" (jeu de plis avec annonces).
//
// Regles implementees (validees avec Mathis) :
// - Le nombre de cartes distribuees change a chaque manche : par defaut on
//   monte de 1 carte jusqu'au maximum (52 / nombre de joueurs) puis on
//   redescend jusqu'a 1. Le patron peut regler le maximum, le sens et le pas.
// - Apres la distribution, on retourne la carte du dessus du talon : sa
//   couleur est l'atout. S'il ne reste aucune carte, la manche est sans atout.
// - Chacun annonce, a tour de role (en commencant a gauche du donneur), le
//   nombre de plis qu'il pense faire. Le dernier a annoncer (le donneur) n'a
//   pas le droit de faire tomber le total juste : quelqu'un doit se tromper.
// - Le joueur a gauche du donneur entame le premier pli ; le gagnant d'un pli
//   entame le suivant.
// - Il faut fournir la couleur demandee si on l'a. Sinon, on joue ce qu'on
//   veut (couper n'est pas obligatoire).
// - Le pli est remporte par le plus gros atout, sinon par la plus forte carte
//   de la couleur demandee. Ordre : 2 < 3 < ... < 10 < V < D < R < A.
// - Points : pari reussi = 40 points par pli annonce (20 points pour une
//   annonce de 0 reussie). Pari rate = -40 points par pli d'ecart.
// - Le donneur tourne a chaque manche. Le patron lance la manche suivante.

const crypto = require("crypto");
const { buildStandardDeck, shuffle, cardPublicView, SUIT_SYMBOLS } = require("../deck");

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const POWER = Object.fromEntries(["2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R", "A"].map((r, i) => [r, i]));
const SUIT_NAMES = { pique: "Pique", coeur: "Cœur", carreau: "Carreau", trefle: "Trèfle" };
const MODES = ["up-down", "down-up", "up", "down"];
const TRICK_PAUSE_MS = 1700;

// Chaque evenement est rattache a sa manche (et chaque carte jouee a son
// pli), pour pouvoir masquer les plis precedents de la manche en cours.
function logEvent(state, entry) {
  state.eventSeq += 1;
  state.history.push({ id: state.eventSeq, at: Date.now(), round: state.roundIndex + 1, ...entry });
  if (state.history.length > 6000) state.history.splice(0, state.history.length - 6000);
}

// Historique visible : tout pour les manches terminees ; pour la manche en
// cours, seulement les annonces, le dernier pli termine et le pli en cours
// (on ne peut pas remonter les plis pour compter les cartes).
function visibleHistory(state) {
  const live = state.phase === "bidding" || state.phase === "playing" || state.phase === "trick_done";
  const current = state.roundIndex + 1;
  const lastDone = state.phase === "trick_done" ? state.trickNumber - 1 : state.trickNumber;
  return state.history.filter((e) => {
    if (!live || e.round !== current) return true;
    if (e.type === "play") return e.trick >= lastDone;
    if (e.type === "trick_won") return e.number >= lastDone;
    return true;
  });
}

function namedHistory(events, name) {
  return events.map((e) => ({
    ...e,
    playerName: e.playerId ? name(e.playerId) : undefined,
    dealerName: e.dealerId ? name(e.dealerId) : undefined,
    starterName: e.starterId ? name(e.starterId) : undefined
  }));
}

// Historique complet (visible) envoye a la demande (bouton Historique).
function fullHistory(state, playerId, players) {
  const name = (id) => (players[id] ? players[id].name : "?");
  return namedHistory(visibleHistory(state), name);
}

function maxCardsFor(n) {
  return Math.max(1, Math.floor(52 / n));
}

// Options reglees par le patron dans le salon, nettoyees et bornees.
function normalizeOptions(raw, nPlayers) {
  const o = raw || {};
  const hardMax = maxCardsFor(nPlayers || 3);
  let max = parseInt(o.maxCards, 10);
  if (!Number.isFinite(max) || max <= 0) max = hardMax;
  max = Math.max(1, Math.min(hardMax, max));
  const mode = MODES.includes(o.mode) ? o.mode : "up-down";
  const step = o.step === 2 || o.step === "2" ? 2 : 1;
  return { maxCards: max, mode, step, auto: !(parseInt(o.maxCards, 10) > 0) };
}

// Suite des nombres de cartes par manche, ex : 1 2 3 … max … 3 2 1.
function buildSequence({ maxCards, mode, step }) {
  const up = [];
  for (let c = 1; c < maxCards; c += step) up.push(c);
  up.push(maxCards);
  const down = up.slice().reverse();
  if (mode === "up") return up;
  if (mode === "down") return down;
  if (mode === "down-up") return down.concat(up.slice(1));
  return up.concat(down.slice(1));
}

function createGame(playerIds, rawOptions) {
  const seatOrder = shuffle(playerIds);
  const options = normalizeOptions(rawOptions, seatOrder.length);
  const state = {
    id: "ascenseur",
    uid: crypto.randomBytes(5).toString("hex"),
    eventSeq: 0,
    history: [],
    options,
    sequence: buildSequence(options),
    seatOrder,
    roundIndex: -1,
    dealerIdx: seatOrder.length - 1,
    phase: "bidding",
    hands: {},
    trump: null,
    talon: [],
    bids: {},
    won: {},
    wonCards: {},
    trick: [],
    leadSuit: null,
    trickWinner: null,
    trickNumber: 0,
    currentTurn: null,
    scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
    lastResult: null,
    roundResults: []
  };
  startRound(state);
  return state;
}

function seatAfter(state, id, k = 1) {
  const o = state.seatOrder;
  return o[(o.indexOf(id) + k) % o.length];
}

function dealerId(state) {
  return state.seatOrder[state.dealerIdx % state.seatOrder.length];
}

function startRound(state) {
  state.roundIndex += 1;
  state.dealerIdx = (state.dealerIdx + 1) % state.seatOrder.length;
  const n = state.sequence[state.roundIndex];
  const deck = shuffle(buildStandardDeck());
  const dealer = dealerId(state);
  state.hands = {};
  for (const id of state.seatOrder) state.hands[id] = [];
  let k = 0;
  for (let c = 0; c < n; c += 1) {
    for (let p = 1; p <= state.seatOrder.length; p += 1) {
      state.hands[seatAfter(state, dealer, p)].push(deck[k]);
      k += 1;
    }
  }
  state.trump = k < deck.length ? deck[k] : null;
  state.talon = deck.slice(state.trump ? k + 1 : k);
  state.bids = {};
  state.won = Object.fromEntries(state.seatOrder.map((id) => [id, 0]));
  state.wonCards = Object.fromEntries(state.seatOrder.map((id) => [id, 0]));
  state.trick = [];
  state.leadSuit = null;
  state.trickWinner = null;
  state.trickNumber = 0;
  state.phase = "bidding";
  state.currentTurn = seatAfter(state, dealer, 1);
  logEvent(state, {
    type: "round_start",
    round: state.roundIndex + 1,
    cards: n,
    dealerId: dealer,
    trump: state.trump ? state.trump.suit : null
  });
}

function cardsThisRound(state) {
  return state.sequence[state.roundIndex];
}

// Valeur interdite pour le dernier a annoncer (ou null).
function forbiddenBid(state, playerId) {
  const others = state.seatOrder.filter((id) => id !== playerId);
  if (others.some((id) => state.bids[id] === undefined)) return null;
  const sum = others.reduce((s, id) => s + state.bids[id], 0);
  const f = cardsThisRound(state) - sum;
  return f >= 0 && f <= cardsThisRound(state) ? f : null;
}

function doBid(state, playerId, action) {
  if (state.phase !== "bidding") return { ok: false, error: "Ce n'est pas le moment d'annoncer." };
  if (state.currentTurn !== playerId) return { ok: false, error: "Ce n'est pas ton tour d'annoncer." };
  const bid = parseInt(action.bid, 10);
  const n = cardsThisRound(state);
  if (!Number.isInteger(bid) || bid < 0 || bid > n) return { ok: false, error: `Annonce entre 0 et ${n}.` };
  const f = forbiddenBid(state, playerId);
  if (f !== null && bid === f) return { ok: false, error: `Interdit d'annoncer ${f} : le total tomberait juste.` };
  state.bids[playerId] = bid;
  logEvent(state, { type: "bid", playerId, bid });
  if (state.seatOrder.every((id) => state.bids[id] !== undefined)) {
    state.phase = "playing";
    state.currentTurn = seatAfter(state, dealerId(state), 1);
    logEvent(state, { type: "play_start", starterId: state.currentTurn, total: state.seatOrder.reduce((s, id) => s + state.bids[id], 0) });
  } else {
    state.currentTurn = seatAfter(state, playerId, 1);
  }
  return { ok: true };
}

function legalCards(state, playerId) {
  const hand = state.hands[playerId] || [];
  if (!state.leadSuit) return hand;
  const follow = hand.filter((c) => c.suit === state.leadSuit);
  return follow.length ? follow : hand;
}

function trickWinnerOf(state) {
  const trumpSuit = state.trump ? state.trump.suit : null;
  let best = state.trick[0];
  for (const p of state.trick.slice(1)) {
    const c = p.card;
    const b = best.card;
    const cTrump = c.suit === trumpSuit;
    const bTrump = b.suit === trumpSuit;
    if (cTrump && !bTrump) best = p;
    else if (cTrump === bTrump && c.suit === b.suit && POWER[c.rank] > POWER[b.rank]) best = p;
  }
  return best.playerId;
}

function doPlay(state, playerId, action) {
  if (state.phase === "trick_done") return { ok: false, error: "Le pli est en train d'être ramassé…" };
  if (state.phase !== "playing") return { ok: false, error: "Ce n'est pas le moment de jouer." };
  if (state.currentTurn !== playerId) return { ok: false, error: "Ce n'est pas ton tour." };
  const ids = Array.isArray(action.cardIds) ? action.cardIds : [];
  if (ids.length !== 1) return { ok: false, error: "Pose une seule carte." };
  const card = (state.hands[playerId] || []).find((c) => c.id === ids[0]);
  if (!card) return { ok: false, error: "Carte introuvable dans ta main." };
  if (!legalCards(state, playerId).includes(card)) {
    return { ok: false, error: `Tu dois fournir : joue du ${SUIT_NAMES[state.leadSuit]} ${SUIT_SYMBOLS[state.leadSuit]}.` };
  }
  state.hands[playerId] = state.hands[playerId].filter((c) => c !== card);
  if (!state.trick.length) state.leadSuit = card.suit;
  state.trick.push({ playerId, card });
  const cut = !!state.trump && card.suit === state.trump.suit && state.leadSuit !== state.trump.suit;
  logEvent(state, { type: "play", playerId, rank: card.rank, suit: card.suit, lead: state.trick.length === 1, cut, trick: state.trickNumber + 1 });

  if (state.trick.length < state.seatOrder.length) {
    state.currentTurn = seatAfter(state, playerId, 1);
    return { ok: true };
  }
  // pli complet : on le laisse visible un instant avant de le ramasser
  const winner = trickWinnerOf(state);
  state.trickWinner = winner;
  state.phase = "trick_done";
  state.currentTurn = null;
  state.trickNumber += 1;
  logEvent(state, { type: "trick_won", playerId: winner, number: state.trickNumber });
  return { ok: true, schedule: TRICK_PAUSE_MS };
}

// Appele par le serveur apres la pause : ramasse le pli termine.
function tick(state) {
  if (state.phase !== "trick_done") return { ok: false };
  const winner = state.trickWinner;
  state.won[winner] += 1;
  state.wonCards[winner] += state.trick.length;
  state.trick = [];
  state.leadSuit = null;
  state.trickWinner = null;
  if (state.seatOrder.every((id) => state.hands[id].length === 0)) {
    endRound(state);
  } else {
    state.phase = "playing";
    state.currentTurn = winner;
  }
  return { ok: true };
}

function pointsFor(bid, won) {
  if (bid === won) return bid === 0 ? 20 : 40 * won;
  return -40 * Math.abs(bid - won);
}

function endRound(state) {
  state.lastResult = state.seatOrder.map((id) => {
    const bid = state.bids[id];
    const won = state.won[id];
    const points = pointsFor(bid, won);
    state.scores[id] += points;
    return { id, bid, won, points, total: state.scores[id] };
  });
  state.roundResults.push({
    round: state.roundIndex + 1,
    cards: state.sequence[state.roundIndex],
    trump: state.trump ? state.trump.suit : null,
    results: state.lastResult
  });
  const last = state.roundIndex >= state.sequence.length - 1;
  state.phase = last ? "finished" : "round_end";
  state.currentTurn = null;
  logEvent(state, { type: "round_end", round: state.roundIndex + 1, last });
}

function doNextRound(state, playerId, ctx) {
  if (state.phase !== "round_end") return { ok: false, error: "La manche n'est pas terminée." };
  if (!ctx || !ctx.isHost) return { ok: false, error: "Seul le patron lance la manche suivante." };
  startRound(state);
  return { ok: true };
}

function applyAction(state, playerId, action, ctx) {
  if (!state.seatOrder.includes(playerId)) return { ok: false, error: "Joueur inconnu dans cette partie." };
  switch (action.type) {
    case "bid": return doBid(state, playerId, action);
    case "play": return doPlay(state, playerId, action);
    case "next_round": return doNextRound(state, playerId, ctx);
    default: return { ok: false, error: `Action inconnue: ${action.type}` };
  }
}

function getViewForPlayer(state, playerId, players) {
  const name = (id) => (players[id] ? players[id].name : "?");
  const n = cardsThisRound(state);
  const dealer = dealerId(state);
  const bidOf = (id) => (state.bids[id] === undefined ? null : state.bids[id]);
  const isMyBid = state.phase === "bidding" && state.currentTurn === playerId;
  const myTurn = state.phase === "playing" && state.currentTurn === playerId;
  const totalBids = state.seatOrder.reduce((s, id) => s + (state.bids[id] || 0), 0);
  const ranking = state.seatOrder.slice().sort((a, b) => state.scores[b] - state.scores[a]);
  return {
    gameId: "ascenseur",
    uid: state.uid,
    lastEventId: state.eventSeq,
    phase: state.phase,
    round: state.roundIndex + 1,
    roundsTotal: state.sequence.length,
    sequence: state.sequence,
    cards: n,
    options: state.options,
    seatOrder: state.seatOrder,
    dealerId: dealer,
    dealerName: name(dealer),
    currentTurn: state.currentTurn,
    currentTurnName: state.currentTurn ? name(state.currentTurn) : "",
    hand: (state.hands[playerId] || []).map(cardPublicView),
    trump: state.trump ? cardPublicView(state.trump) : null,
    trumpSuit: state.trump ? state.trump.suit : null,
    trumpName: state.trump ? SUIT_NAMES[state.trump.suit] : null,
    talonCount: state.talon.length,
    trick: state.trick.map((p) => ({ playerId: p.playerId, playerName: name(p.playerId), card: cardPublicView(p.card) })),
    leadSuit: state.leadSuit,
    trickWinner: state.trickWinner,
    trickWinnerName: state.trickWinner ? name(state.trickWinner) : "",
    trickNumber: state.trickNumber,
    totalBids,
    allBid: state.seatOrder.every((id) => state.bids[id] !== undefined),
    players: state.seatOrder.map((id) => ({
      id,
      name: name(id),
      bid: bidOf(id),
      won: state.won[id] || 0,
      wonCards: state.wonCards[id] || 0,
      score: state.scores[id] || 0,
      isDealer: id === dealer
    })),
    opponents: state.seatOrder.filter((id) => id !== playerId).map((id) => ({
      id,
      name: name(id),
      cardCount: (state.hands[id] || []).length,
      bid: bidOf(id),
      won: state.won[id] || 0,
      wonCards: state.wonCards[id] || 0,
      isDealer: id === dealer,
      connected: players[id] ? players[id].connected !== false : false
    })),
    scores: state.seatOrder.map((id) => ({ id, name: name(id), score: state.scores[id] || 0 })),
    ranking: ranking.map((id) => ({ id, name: name(id), score: state.scores[id] })),
    lastResult: state.lastResult ? state.lastResult.map((r) => ({ ...r, name: name(r.id) })) : null,
    roundResults: state.roundResults.map((r) => ({ ...r, results: r.results.map((x) => ({ ...x, name: name(x.id) })) })),
    history: namedHistory(visibleHistory(state).slice(-40), name),
    you: {
      id: playerId,
      isYourTurn: isMyBid || myTurn,
      mustBid: isMyBid,
      forbiddenBid: isMyBid ? forbiddenBid(state, playerId) : null,
      bid: bidOf(playerId),
      won: state.won[playerId] || 0,
      wonCards: state.wonCards[playerId] || 0,
      isDealer: playerId === dealer,
      legalIds: myTurn ? legalCards(state, playerId).map((c) => c.id) : [],
      isFinished: false
    }
  };
}

module.exports = {
  id: "ascenseur",
  name: "L'Ascenseur",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  createGame,
  applyAction,
  tick,
  getViewForPlayer,
  fullHistory,
  normalizeOptions,
  _internals: { visibleHistory, buildSequence, pointsFor, forbiddenBid, legalCards, trickWinnerOf, maxCardsFor }
};
