// Moteur du jeu "Le Pouilleux" (aussi appele "le Puant").
//
// Regles implementees (validees avec Mathis) :
// - On retire le valet de trefle du paquet : le valet de pique reste seul,
//   c'est le Pouilleux. 51 cartes distribuees en entier (2 a 8 joueurs).
// - Une paire = deux cartes de meme valeur ET de meme couleur (rouge avec
//   rouge, noir avec noir). Les paires sont defaussees automatiquement.
// - Chacun son tour (sens des aiguilles d'une montre), on tire une carte au
//   hasard dans le jeu de son voisin de gauche (le joueur suivant). Si elle
//   forme une paire, la paire est defaussee. Puis c'est a ce voisin de jouer.
// - Un joueur qui n'a plus de cartes est tire d'affaire. Le dernier a garder
//   des cartes (forcement le valet de pique) est le Pouilleux.

const crypto = require("crypto");
const { buildStandardDeck, shuffle, RANKS, cardPublicView } = require("../deck");

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const PAIR_PAUSE_MS = 1100;
const COLOR = { coeur: "rouge", carreau: "rouge", pique: "noir", trefle: "noir" };

function logEvent(state, entry) {
  state.eventSeq += 1;
  state.history.push({ id: state.eventSeq, at: Date.now(), ...entry });
  if (state.history.length > 300) state.history.splice(0, state.history.length - 300);
}

const isPouilleux = (c) => c.rank === "V" && c.suit === "pique";

// Retire toutes les paires (meme valeur + meme couleur) d'une main.
function removePairs(state, playerId, reason) {
  const hand = state.hands[playerId];
  const found = [];
  for (const rank of RANKS) {
    for (const color of ["rouge", "noir"]) {
      const same = hand.filter((c) => c.rank === rank && COLOR[c.suit] === color);
      if (same.length >= 2) found.push(same.slice(0, 2));
    }
  }
  for (const pair of found) {
    const ids = new Set(pair.map((c) => c.id));
    state.hands[playerId] = state.hands[playerId].filter((c) => !ids.has(c.id));
    state.pairs.push({ playerId, rank: pair[0].rank, cards: pair });
    logEvent(state, { type: "pair", playerId, rank: pair[0].rank, color: COLOR[pair[0].suit], reason });
  }
  return found.length;
}

function createGame(playerIds) {
  const deck = shuffle(buildStandardDeck().filter((c) => !(c.rank === "V" && c.suit === "trefle")));
  const seatOrder = shuffle(playerIds);
  const hands = Object.fromEntries(seatOrder.map((id) => [id, []]));
  deck.forEach((c, i) => hands[seatOrder[i % seatOrder.length]].push(c));
  const state = {
    id: "pouilleux",
    uid: crypto.randomBytes(5).toString("hex"),
    eventSeq: 0,
    history: [],
    seatOrder,
    hands,
    pairs: [],
    safeOrder: [],
    loserId: null,
    phase: "playing",
    currentTurn: null,
    lastDraw: null
  };
  logEvent(state, { type: "deal" });
  for (const id of seatOrder) removePairs(state, id, "deal");
  for (const id of seatOrder) checkSafe(state, id);
  if (!checkEnd(state)) state.currentTurn = seatOrder.find((id) => inGame(state, id));
  return state;
}

function inGame(state, id) {
  return state.hands[id] && state.hands[id].length > 0;
}

// Voisin chez qui on tire : le prochain joueur (sens horaire) qui a encore des cartes.
function victimOf(state, id) {
  const o = state.seatOrder;
  const i = o.indexOf(id);
  for (let k = 1; k < o.length; k += 1) {
    const c = o[(i + k) % o.length];
    if (inGame(state, c)) return c;
  }
  return null;
}

function checkSafe(state, id) {
  if (!inGame(state, id) && !state.safeOrder.includes(id)) {
    state.safeOrder.push(id);
    logEvent(state, { type: "safe", playerId: id, place: state.safeOrder.length });
  }
}

function checkEnd(state) {
  const left = state.seatOrder.filter((id) => inGame(state, id));
  if (left.length > 1) return false;
  state.loserId = left[0] || null;
  state.phase = "finished";
  state.currentTurn = null;
  logEvent(state, { type: "end", playerId: state.loserId });
  return true;
}

function doDraw(state, playerId, action) {
  if (state.phase === "pairing") return { ok: false, error: "Un instant…" };
  if (state.phase !== "playing") return { ok: false, error: "Ce n'est pas le moment." };
  if (state.currentTurn !== playerId) return { ok: false, error: "Ce n'est pas ton tour." };
  const victim = victimOf(state, playerId);
  if (!victim) return { ok: false, error: "Personne chez qui tirer." };
  const hand = state.hands[victim];
  const index = Number.isInteger(action.index) ? action.index : parseInt(action.index, 10);
  if (!(index >= 0 && index < hand.length)) return { ok: false, error: "Choisis une carte." };
  const [card] = hand.splice(index, 1);
  state.hands[playerId].push(card);
  state.lastDraw = { from: victim, to: playerId, card, seq: state.eventSeq + 1 };
  // l'evenement public ne dit pas quelle carte a ete tiree
  logEvent(state, { type: "draw", playerId, from: victim });
  // on laisse la carte un instant en main avant de sortir la paire
  state.phase = "pairing";
  state.pairingFor = { drawer: playerId, victim };
  return { ok: true, schedule: PAIR_PAUSE_MS };
}

function tick(state) {
  if (state.phase !== "pairing") return { ok: false };
  const { drawer, victim } = state.pairingFor;
  state.pairingFor = null;
  removePairs(state, drawer, "draw");
  checkSafe(state, victim);
  checkSafe(state, drawer);
  state.phase = "playing";
  if (checkEnd(state)) return { ok: true };
  // c'est au voisin chez qui on a tire (ou au suivant s'il est sorti)
  state.currentTurn = inGame(state, victim) ? victim : nextToPlay(state, victim);
  return { ok: true };
}

function nextToPlay(state, fromId) {
  const o = state.seatOrder;
  const i = o.indexOf(fromId);
  for (let k = 1; k <= o.length; k += 1) {
    const c = o[(i + k) % o.length];
    if (inGame(state, c)) return c;
  }
  return null;
}

// Le joueur peut melanger sa main (pour cacher ou il a range le pouilleux).
function doShuffle(state, playerId) {
  if (!inGame(state, playerId)) return { ok: false, error: "Tu n'as plus de cartes." };
  state.hands[playerId] = shuffle(state.hands[playerId]);
  logEvent(state, { type: "shuffle", playerId });
  return { ok: true };
}

function applyAction(state, playerId, action) {
  if (!state.seatOrder.includes(playerId)) return { ok: false, error: "Joueur inconnu dans cette partie." };
  switch (action.type) {
    case "draw": return doDraw(state, playerId, action);
    case "shuffle": return doShuffle(state, playerId);
    default: return { ok: false, error: `Action inconnue: ${action.type}` };
  }
}

function getViewForPlayer(state, playerId, players) {
  const name = (id) => (players[id] ? players[id].name : "?");
  const victim = state.currentTurn ? victimOf(state, state.currentTurn) : null;
  const n = state.seatOrder.length;
  const ranking = state.safeOrder.concat(state.loserId ? [state.loserId] : []);
  return {
    gameId: "pouilleux",
    uid: state.uid,
    lastEventId: state.eventSeq,
    phase: state.phase,
    seatOrder: state.seatOrder,
    currentTurn: state.currentTurn,
    currentTurnName: state.currentTurn ? name(state.currentTurn) : "",
    victimId: victim,
    victimName: victim ? name(victim) : "",
    victimCount: victim ? state.hands[victim].length : 0,
    hand: (state.hands[playerId] || []).map(cardPublicView),
    opponents: state.seatOrder.filter((id) => id !== playerId).map((id) => ({
      id,
      name: name(id),
      cardCount: state.hands[id].length,
      safe: state.safeOrder.includes(id),
      connected: players[id] ? players[id].connected !== false : false
    })),
    pairs: state.pairs.map((p) => ({ playerId: p.playerId, rank: p.rank, cards: p.cards.map(cardPublicView) })),
    // la carte tiree n'est connue que du tireur et de sa victime
    lastDraw: state.lastDraw ? {
      from: state.lastDraw.from,
      to: state.lastDraw.to,
      seq: state.lastDraw.seq,
      card: state.lastDraw.to === playerId || state.lastDraw.from === playerId ? cardPublicView(state.lastDraw.card) : null,
      pouilleux: state.lastDraw.to === playerId || state.lastDraw.from === playerId ? isPouilleux(state.lastDraw.card) : null
    } : null,
    safeOrder: state.safeOrder.map((id) => ({ id, name: name(id) })),
    loserId: state.loserId,
    loserName: state.loserId ? name(state.loserId) : "",
    ranking: ranking.map((id, i) => ({ id, name: name(id), place: i + 1, loser: id === state.loserId })),
    players: n,
    history: state.history.slice(-40).map((e) => ({ ...e, playerName: e.playerId ? name(e.playerId) : undefined, fromName: e.from ? name(e.from) : undefined })),
    you: {
      id: playerId,
      isYourTurn: state.phase === "playing" && state.currentTurn === playerId,
      isFinished: !inGame(state, playerId),
      victimId: state.currentTurn === playerId ? victim : null
    }
  };
}

module.exports = {
  id: "pouilleux",
  name: "Le Pouilleux",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  createGame,
  applyAction,
  tick,
  getViewForPlayer,
  _internals: { victimOf, isPouilleux, COLOR }
};
