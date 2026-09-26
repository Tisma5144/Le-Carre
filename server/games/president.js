// Moteur du jeu "Le President".
//
// Regles implementees (validees avec Mathis) :
// - 52 cartes distribuees en entier (3 a 8 joueurs). Force : 3 < 4 < ... < R < A < 2.
// - On pose 1 a 4 cartes de meme valeur. Pour suivre, il faut poser le meme
//   nombre de cartes, de valeur egale ou superieure.
// - "Ou rien" : si un joueur pose la meme valeur que la pose precedente, le
//   joueur suivant doit poser cette valeur... ou passer.
// - Passer = on est hors du pli jusqu'a ce qu'il soit ramasse.
// - Le 2 ferme le pli : celui qui l'a pose rejoue ce qu'il veut.
// - Carre ferme le pli : des que 4 cartes de la meme valeur se suivent au
//   sommet du pli, il est ferme. "Carre magique" : n'importe qui (meme hors de
//   son tour, meme s'il a passe) peut completer le carre en ajoutant les 1 a 3
//   cartes manquantes ; il rejoue ensuite.
// - Interdit de finir sur un 2 : celui qui termine sa main avec un 2 finit
//   dernier (trou du cul).
// - Le pli est ramasse quand tous les autres joueurs ont passe : le dernier a
//   avoir pose rejoue.
// - Premiere manche : celui qui a la Dame de coeur commence. Ensuite, le Trou
//   du cul commence.
// - Echange au debut de chaque nouvelle manche : le Trou du cul donne ses 2
//   meilleures cartes au President qui lui en rend 2 de son choix ; idem avec 1
//   carte entre Vice-trou et Vice-president (a partir de 4 joueurs).
// - Points par manche : President +2, Vice +1, Neutre 0, Vice-trou -1, Trou -2.

const crypto = require("crypto");
const { buildStandardDeck, dealAll, cardPublicView, RANKS } = require("../deck");

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const STRENGTH = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const ROLE_LABELS = {
  president: "Président",
  vice: "Vice-président",
  neutre: "Neutre",
  vicetrou: "Vice-trou du cul",
  trou: "Trou du cul"
};
const ROLE_POINTS = { president: 2, vice: 1, neutre: 0, vicetrou: -1, trou: -2 };

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function logEvent(state, entry) {
  state.eventSeq += 1;
  state.history.push({ id: state.eventSeq, at: Date.now(), ...entry });
  if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
}

function createGame(playerIds) {
  const state = {
    id: "president",
    uid: crypto.randomBytes(5).toString("hex"),
    eventSeq: 0,
    history: [],
    seatOrder: shuffle(playerIds),
    hands: {},
    round: 0,
    phase: "playing",
    roles: {},
    scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
    lastRanking: null,
    finishOrder: [],
    disqualified: [],
    trick: [],
    passed: [],
    currentTurn: null,
    lastPlayerId: null,
    ouRien: null,
    discardCount: 0,
    exchange: null
  };
  startRound(state);
  return state;
}

function holderOf(state, role) {
  return Object.keys(state.roles).find((id) => state.roles[id] === role) || null;
}

function bestCards(hand, n) {
  return hand.slice().sort((a, b) => STRENGTH[b.rank] - STRENGTH[a.rank]).slice(0, n);
}

function moveCards(state, from, to, cards) {
  const ids = new Set(cards.map((c) => c.id));
  state.hands[from] = state.hands[from].filter((c) => !ids.has(c.id));
  state.hands[to] = state.hands[to].concat(cards);
}

function startRound(state) {
  state.round += 1;
  state.hands = dealAll(buildStandardDeck(), state.seatOrder);
  state.finishOrder = [];
  state.disqualified = [];
  state.trick = [];
  state.passed = [];
  state.ouRien = null;
  state.lastPlayerId = null;
  state.discardCount = 0;
  state.exchange = null;

  const pres = holderOf(state, "president");
  const trou = holderOf(state, "trou");
  if (state.round === 1 || !pres || !trou) {
    const starter = state.seatOrder.find((id) => state.hands[id].some((c) => c.rank === "D" && c.suit === "coeur"));
    state.phase = "playing";
    state.currentTurn = starter;
    logEvent(state, { type: "round_start", round: state.round, starterId: starter, reason: "dame" });
    return;
  }

  // echange : les perdants donnent d'office leurs meilleures cartes
  const pending = [];
  const give = (from, to, n) => {
    const cards = bestCards(state.hands[from], n);
    moveCards(state, from, to, cards);
    logEvent(state, { type: "exchange_auto", from, to, count: n });
    pending.push({ from: to, to: from, count: n, done: false });
  };
  give(trou, pres, 2);
  const vice = holderOf(state, "vice");
  const vtrou = holderOf(state, "vicetrou");
  if (vice && vtrou) give(vtrou, vice, 1);
  state.exchange = { pending };
  state.phase = "exchange";
  state.currentTurn = null;
}

function isActive(state, id) {
  return state.hands[id] && state.hands[id].length > 0 && !state.finishOrder.includes(id) && !state.disqualified.includes(id);
}

function activePlayers(state) {
  return state.seatOrder.filter((id) => isActive(state, id));
}

function nextActiveAfter(state, fromId) {
  const order = state.seatOrder;
  const start = order.indexOf(fromId);
  for (let step = 1; step <= order.length; step += 1) {
    const c = order[(start + step) % order.length];
    if (isActive(state, c)) return c;
  }
  return null;
}

function topPlay(state) {
  return state.trick.length ? state.trick[state.trick.length - 1] : null;
}

// Nombre de cartes de la valeur du sommet qui se suivent en haut du pli.
function topRun(state) {
  const top = topPlay(state);
  if (!top) return { rank: null, count: 0 };
  const rank = top.cards[0].rank;
  let count = 0;
  for (let i = state.trick.length - 1; i >= 0; i -= 1) {
    const p = state.trick[i];
    if (p.cards[0].rank !== rank) break;
    count += p.cards.length;
  }
  return { rank, count };
}

function closeTrick(state, leaderId, reason, by) {
  const n = state.trick.reduce((s, p) => s + p.cards.length, 0);
  state.discardCount += n;
  state.trick = [];
  state.passed = [];
  state.ouRien = null;
  state.lastPlayerId = null;
  logEvent(state, { type: "trick_closed", reason, by, count: n });
  const leader = isActive(state, leaderId) ? leaderId : nextActiveAfter(state, leaderId);
  state.currentTurn = leader;
}

function advanceTurn(state, fromId) {
  const order = state.seatOrder;
  const start = order.indexOf(fromId);
  for (let step = 1; step <= order.length; step += 1) {
    const c = order[(start + step) % order.length];
    if (!isActive(state, c)) continue;
    if (c === state.lastPlayerId) {
      closeTrick(state, c, "all_passed", c);
      return;
    }
    if (state.passed.includes(c)) continue;
    state.currentTurn = c;
    return;
  }
  closeTrick(state, state.lastPlayerId, "all_passed", state.lastPlayerId);
}

function rolesFor(n) {
  const roles = [];
  for (let i = 0; i < n; i += 1) {
    if (i === 0) roles.push("president");
    else if (i === n - 1) roles.push("trou");
    else if (n >= 4 && i === 1) roles.push("vice");
    else if (n >= 4 && i === n - 2) roles.push("vicetrou");
    else roles.push("neutre");
  }
  return roles;
}

function checkRoundEnd(state) {
  const active = activePlayers(state);
  if (active.length > 1) return false;
  if (active.length === 1) state.finishOrder.push(active[0]);
  const ranking = state.finishOrder.concat(state.disqualified.slice().reverse());
  const roles = rolesFor(ranking.length);
  state.roles = {};
  ranking.forEach((id, i) => {
    state.roles[id] = roles[i];
    state.scores[id] = (state.scores[id] || 0) + ROLE_POINTS[roles[i]];
  });
  state.lastRanking = ranking.map((id, i) => ({
    id,
    role: roles[i],
    points: ROLE_POINTS[roles[i]],
    onTwo: state.disqualified.includes(id)
  }));
  state.discardCount += state.trick.reduce((s, p) => s + p.cards.length, 0);
  state.trick = [];
  state.phase = "round_end";
  state.currentTurn = null;
  logEvent(state, { type: "round_end", round: state.round, presidentId: ranking[0], trouId: ranking[ranking.length - 1] });
  return true;
}

function findCards(hand, ids) {
  const out = [];
  for (const id of ids) {
    const c = hand.find((x) => x.id === id);
    if (!c || out.includes(c)) return null;
    out.push(c);
  }
  return out;
}

// Verifie si la pose serait un "carre magique" (complete un carre au sommet).
function isMagic(state, cards) {
  const run = topRun(state);
  if (!run.rank || run.rank === "2") return false;
  return cards.every((c) => c.rank === run.rank) && run.count + cards.length === 4;
}

function doPlay(state, playerId, action) {
  if (state.phase !== "playing") return { ok: false, error: "Ce n'est pas le moment de jouer." };
  if (!isActive(state, playerId)) return { ok: false, error: "Tu as déjà fini cette manche." };
  const ids = Array.isArray(action.cardIds) ? action.cardIds : [];
  if (ids.length < 1 || ids.length > 4) return { ok: false, error: "Pose 1 à 4 cartes." };
  const cards = findCards(state.hands[playerId], ids);
  if (!cards) return { ok: false, error: "Carte introuvable dans ta main." };
  const rank = cards[0].rank;
  if (!cards.every((c) => c.rank === rank)) return { ok: false, error: "Les cartes posées doivent avoir la même valeur." };

  const top = topPlay(state);
  const magic = isMagic(state, cards);
  if (!magic) {
    if (state.currentTurn !== playerId) return { ok: false, error: "Ce n'est pas ton tour." };
    if (top) {
      const topRank = top.cards[0].rank;
      if (cards.length !== top.cards.length) return { ok: false, error: `Il faut poser ${top.cards.length} carte${top.cards.length > 1 ? "s" : ""}.` };
      if (state.ouRien && rank !== state.ouRien) return { ok: false, error: "« Ou rien » : pose la même valeur ou passe." };
      if (STRENGTH[rank] < STRENGTH[topRank]) return { ok: false, error: "Il faut une valeur égale ou supérieure." };
    }
  }

  const equal = !!top && top.cards[0].rank === rank;
  const idSet = new Set(ids);
  state.hands[playerId] = state.hands[playerId].filter((c) => !idSet.has(c.id));
  state.trick.push({ playerId, cards });
  state.lastPlayerId = playerId;
  logEvent(state, { type: "play", playerId, count: cards.length, rank, equal, magic, outOfTurn: magic && state.currentTurn !== playerId });

  if (state.hands[playerId].length === 0) {
    const onTwo = rank === "2";
    if (onTwo) state.disqualified.push(playerId);
    else state.finishOrder.push(playerId);
    logEvent(state, { type: "finish", playerId, onTwo, place: onTwo ? null : state.finishOrder.length });
  }
  if (checkRoundEnd(state)) return { ok: true };

  const run = topRun(state);
  if (rank === "2") {
    closeTrick(state, playerId, "deux", playerId);
  } else if (run.count >= 4) {
    closeTrick(state, playerId, magic ? "carre_magique" : "carre", playerId);
  } else {
    state.ouRien = equal ? rank : null;
    advanceTurn(state, playerId);
  }
  return { ok: true };
}

function doPass(state, playerId) {
  if (state.phase !== "playing") return { ok: false, error: "Ce n'est pas le moment." };
  if (state.currentTurn !== playerId) return { ok: false, error: "Ce n'est pas ton tour." };
  if (!state.trick.length) return { ok: false, error: "Tu ouvres le pli : tu dois poser quelque chose." };
  state.passed.push(playerId);
  state.ouRien = null;
  logEvent(state, { type: "pass", playerId });
  advanceTurn(state, playerId);
  return { ok: true };
}

function doGive(state, playerId, action) {
  if (state.phase !== "exchange" || !state.exchange) return { ok: false, error: "Pas d'échange en cours." };
  const task = state.exchange.pending.find((p) => p.from === playerId && !p.done);
  if (!task) return { ok: false, error: "Tu n'as rien à donner." };
  const ids = Array.isArray(action.cardIds) ? action.cardIds : [];
  if (ids.length !== task.count) return { ok: false, error: `Choisis ${task.count} carte${task.count > 1 ? "s" : ""} à donner.` };
  const cards = findCards(state.hands[playerId], ids);
  if (!cards) return { ok: false, error: "Carte introuvable dans ta main." };
  moveCards(state, playerId, task.to, cards);
  task.done = true;
  logEvent(state, { type: "exchange_give", from: playerId, to: task.to, count: task.count });
  if (state.exchange.pending.every((p) => p.done)) {
    const trou = holderOf(state, "trou");
    state.exchange = null;
    state.phase = "playing";
    state.currentTurn = trou;
    logEvent(state, { type: "round_start", round: state.round, starterId: trou, reason: "trou" });
  }
  return { ok: true };
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
    case "play": return doPlay(state, playerId, action);
    case "pass": return doPass(state, playerId);
    case "give": return doGive(state, playerId, action);
    case "next_round": return doNextRound(state, playerId, ctx);
    default: return { ok: false, error: `Action inconnue: ${action.type}` };
  }
}

function getViewForPlayer(state, playerId, players) {
  const name = (id) => (players[id] ? players[id].name : "?");
  const finished = (id) => state.finishOrder.includes(id) || state.disqualified.includes(id);
  const top = topPlay(state);
  const run = topRun(state);
  let exchange = null;
  if (state.phase === "exchange" && state.exchange) {
    const mine = state.exchange.pending.find((p) => p.from === playerId && !p.done);
    exchange = {
      myGive: mine ? { count: mine.count, toId: mine.to, toName: name(mine.to) } : null,
      waiting: state.exchange.pending.filter((p) => !p.done).map((p) => ({ fromName: name(p.from), toName: name(p.to), count: p.count }))
    };
  }
  return {
    gameId: "president",
    uid: state.uid,
    lastEventId: state.eventSeq,
    phase: state.phase,
    round: state.round,
    seatOrder: state.seatOrder,
    currentTurn: state.currentTurn,
    currentTurnName: state.currentTurn ? name(state.currentTurn) : "",
    hand: (state.hands[playerId] || []).map(cardPublicView),
    opponents: state.seatOrder.filter((id) => id !== playerId).map((id) => ({
      id,
      name: name(id),
      cardCount: (state.hands[id] || []).length,
      finished: finished(id),
      passed: state.passed.includes(id),
      role: state.roles[id] || null,
      connected: players[id] ? players[id].connected !== false : false
    })),
    trick: state.trick.map((p) => ({ playerId: p.playerId, playerName: name(p.playerId), cards: p.cards.map(cardPublicView) })),
    top: top ? { rank: top.cards[0].rank, count: top.cards.length, playerId: top.playerId, playerName: name(top.playerId) } : null,
    run,
    ouRien: state.ouRien,
    discardCount: state.discardCount,
    roles: state.roles,
    roleLabels: ROLE_LABELS,
    scores: state.seatOrder.map((id) => ({ id, name: name(id), score: state.scores[id] || 0 })),
    ranking: state.lastRanking ? state.lastRanking.map((r) => ({ ...r, name: name(r.id), label: ROLE_LABELS[r.role] })) : null,
    finishedOrder: state.finishOrder.concat(state.disqualified).map((id) => ({ id, name: name(id) })),
    exchange,
    history: state.history.slice(-40).map((e) => ({
      ...e,
      playerName: e.playerId ? name(e.playerId) : undefined,
      fromName: e.from ? name(e.from) : undefined,
      toName: e.to ? name(e.to) : undefined,
      byName: e.by ? name(e.by) : undefined,
      starterName: e.starterId ? name(e.starterId) : undefined
    })),
    you: {
      id: playerId,
      role: state.roles[playerId] || null,
      isYourTurn: state.phase === "playing" && state.currentTurn === playerId,
      canPass: state.phase === "playing" && state.currentTurn === playerId && state.trick.length > 0,
      isFinished: finished(playerId),
      passed: state.passed.includes(playerId)
    }
  };
}

module.exports = {
  id: "president",
  name: "Le Président",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  createGame,
  applyAction,
  getViewForPlayer,
  _internals: { STRENGTH, topRun, isMagic }
};
