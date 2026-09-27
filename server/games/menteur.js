// Moteur du jeu "Menteur" (bluff aux cartes).
//
// Regles implementees (validees avec l'utilisateur) :
// - Paquet de 52 cartes distribue en entier entre tous les joueurs.
// - A son tour, si aucune carte n'est encore posee dans le round, le joueur
//   choisit librement une valeur (ex: "Rois") et pose 1, 2 ou 3 cartes face
//   cachee en pretendant qu'elles sont de cette valeur.
// - Tant que le round continue, TOUS les joueurs suivants doivent aussi
//   poser 1 a 3 cartes en pretendant la MEME valeur (elle ne change pas
//   pendant tout le round). Ils peuvent bluffer (poser d'autres cartes).
// - Exception : si un joueur a les 4 cartes d'une meme valeur en main, il
//   peut les sortir directement du jeu A TOUT MOMENT (meme hors de son
//   tour), dans une pile "cartes sorties" visible publiquement. Cette
//   action ne consomme jamais le tour de personne : elle n'a aucun effet
//   sur la pile, le tour en cours ou la valeur annoncee.
// - Seul le joueur dont c'est le tour, juste avant de jouer, peut appuyer
//   sur MENTEUR pour contester la pose precedente (evite les conflits de
//   clics simultanes). S'il choisit de jouer ou de sortir un carre a la
//   place, la pose precedente est definitivement validee.
// - Une accusation retourne les dernieres cartes posees :
//     - si elles ne correspondent PAS a la valeur annoncee -> celui qui a
//       menti perd et doit "ramasser" toute la pile du round.
//     - si elles correspondent -> l'accusateur perd et doit "ramasser".
// - Le joueur juste apres celui qui a ramasse commence le round suivant.
// - Un joueur qui vide sa main gagne des que sa derniere pose n'est plus
//   contestable (validee par le joueur suivant) ou s'il s'est vide via une
//   sortie de carre (jamais un bluff, donc jamais contestable).
// - La partie se termine quand il ne reste qu'un seul joueur avec des
//   cartes ; il termine dernier.

const { buildStandardDeck, dealAll, cardPublicView, RANKS } = require("../deck");

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;

function createGame(playerIds) {
  const deck = buildStandardDeck();
  const hands = dealAll(deck, playerIds);
  const seatOrder = shuffleOrder(playerIds);

  const state = {
    id: "menteur",
    uid: Math.random().toString(36).slice(2, 10),
    eventSeq: 0,
    seatOrder,
    hands,
    finishedOrder: [],
    removedQuads: [],
    history: [],
    currentTurn: seatOrder[0],
    roundLeaderRank: null,
    lastPlay: null,
    canChallengeLastPlay: false,
    pileCards: [],
    phase: "playing",
    pendingReveal: null
  };
  // Les carres recus a la distribution sortent tout seuls.
  autoDiscardQuads(state, seatOrder);
  return state;
}

// Sortie automatique des carres : des qu'un joueur a les 4 cartes d'une meme
// valeur en main (a la distribution ou apres avoir ramasse), elles sortent du
// jeu. Ca ne consomme jamais de tour.
function autoDiscardQuads(state, playerIds) {
  for (const playerId of playerIds) {
    const hand = state.hands[playerId] || [];
    const counts = {};
    hand.forEach((c) => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
    for (const rank of RANKS) {
      if (counts[rank] !== 4) continue;
      const matching = state.hands[playerId].filter((c) => c.rank === rank);
      const ids = new Set(matching.map((c) => c.id));
      state.hands[playerId] = state.hands[playerId].filter((c) => !ids.has(c.id));
      state.removedQuads.push({ playerId, rank, cards: matching });
      logEvent(state, { type: "quad_discard", playerId, rank, auto: true });
    }
    confirmFinishIfEmpty(state, playerId);
  }
}

function shuffleOrder(ids) {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function activePlayers(state) {
  return state.seatOrder.filter((id) => !state.finishedOrder.includes(id));
}

// Trouve le prochain joueur actif dans l'ordre des sieges, en partant juste
// apres `fromId` (qui peut lui-meme etre deja termine ou non).
function nextActiveAfter(state, fromId) {
  const order = state.seatOrder;
  const startIndex = order.indexOf(fromId);
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(startIndex + step) % order.length];
    if (!state.finishedOrder.includes(candidate)) return candidate;
  }
  return null; // plus personne d'actif
}

function confirmFinishIfEmpty(state, playerId) {
  if (!playerId) return;
  if (state.finishedOrder.includes(playerId)) return;
  if (state.hands[playerId] && state.hands[playerId].length === 0) {
    state.finishedOrder.push(playerId);
  }
  checkForGameEnd(state);
}

function checkForGameEnd(state) {
  if (state.phase === "finished") return;
  const active = activePlayers(state);
  if (active.length <= 1) {
    if (active.length === 1 && !state.finishedOrder.includes(active[0])) {
      state.finishedOrder.push(active[0]);
    }
    // On ne bascule pas la partie en "finished" pendant qu'une revelation
    // est en attente de ramassage : ca casserait l'ecran de revelation en
    // cours. doPickup rappelle checkForGameEnd juste apres, donc la partie
    // se termine proprement des que le ramassage est confirme.
    if (state.phase !== "reveal_pending") {
      state.phase = "finished";
    }
  }
}

// Verrouille la pose precedente (elle ne pourra plus jamais etre contestee)
// et confirme la victoire de son auteur s'il a vide sa main avec.
function lockPreviousPlayIfAny(state) {
  if (state.lastPlay && state.canChallengeLastPlay) {
    confirmFinishIfEmpty(state, state.lastPlay.playerId);
  }
  state.canChallengeLastPlay = false;
}

// Chaque evenement recoit un identifiant croissant : le client s'en sert
// pour savoir ce qui vient de se passer (bulles, sons, animations).
function logEvent(state, entry) {
  state.eventSeq = (state.eventSeq || 0) + 1;
  state.history.push({ id: state.eventSeq, at: Date.now(), ...entry });
  if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
}

function findCardsInHand(hand, cardIds) {
  const found = [];
  for (const id of cardIds) {
    const card = hand.find((c) => c.id === id);
    if (!card) return null;
    found.push(card);
  }
  return found;
}

function applyAction(state, playerId, action) {
  if (!state.seatOrder.includes(playerId)) {
    return { ok: false, error: "Joueur inconnu dans cette partie." };
  }

  switch (action.type) {
    case "play":
      return doPlay(state, playerId, action);
    case "quad_discard":
      return doQuadDiscard(state, playerId, action);
    case "accuse":
      return doAccuse(state, playerId);
    case "pickup":
      return doPickup(state, playerId);
    default:
      return { ok: false, error: `Action inconnue: ${action.type}` };
  }
}

function doPlay(state, playerId, action) {
  if (state.phase !== "playing") return { ok: false, error: "Ce n'est pas le moment de jouer." };
  if (state.currentTurn !== playerId) return { ok: false, error: "Ce n'est pas ton tour." };

  const cardIds = Array.isArray(action.cardIds) ? action.cardIds : [];
  if (cardIds.length < 1 || cardIds.length > 3) {
    return { ok: false, error: "Il faut poser 1, 2 ou 3 cartes." };
  }

  const hand = state.hands[playerId];
  const cards = findCardsInHand(hand, cardIds);
  if (!cards) return { ok: false, error: "Carte introuvable dans ta main." };

  let declaredRank = state.roundLeaderRank;
  if (state.lastPlay === null) {
    // Nouveau round : le joueur choisit librement la valeur annoncee.
    if (!action.declaredRank || !RANKS.includes(action.declaredRank)) {
      return { ok: false, error: "Il faut annoncer une valeur valide pour lancer le round." };
    }
    declaredRank = action.declaredRank;
  } else {
    // Le round est en cours : on verrouille la pose precedente.
    lockPreviousPlayIfAny(state);
    if (state.phase === "finished") return { ok: true };
  }

  // Retire les cartes de la main et les ajoute a la pile du round.
  const idsToRemove = new Set(cardIds);
  state.hands[playerId] = hand.filter((c) => !idsToRemove.has(c.id));
  state.pileCards.push(...cards);
  state.roundLeaderRank = declaredRank;
  state.lastPlay = { playerId, cards };
  state.canChallengeLastPlay = true;

  logEvent(state, {
    type: "play",
    playerId,
    count: cards.length,
    claimedRank: declaredRank
  });

  const next = nextActiveAfter(state, playerId);
  if (next) state.currentTurn = next;

  return { ok: true };
}

// Sortir un carre est une action libre, disponible a tout moment (meme
// hors de son tour) et pour n'importe quel joueur encore en jeu. Elle ne
// touche jamais au tour en cours, a la pile ou a la valeur annoncee : elle
// ne "consomme" donc jamais le tour de qui que ce soit.
function doQuadDiscard(state, playerId, action) {
  if (state.phase !== "playing" && state.phase !== "reveal_pending") {
    return { ok: false, error: "Impossible de sortir un carre pour le moment." };
  }
  if (state.finishedOrder.includes(playerId)) {
    return { ok: false, error: "Tu as deja termine la partie." };
  }

  const rank = action.rank;
  if (!RANKS.includes(rank)) return { ok: false, error: "Valeur invalide." };

  const hand = state.hands[playerId];
  if (!hand) return { ok: false, error: "Joueur inconnu." };
  const matching = hand.filter((c) => c.rank === rank);
  if (matching.length !== 4) {
    return { ok: false, error: "Il faut avoir les 4 cartes de cette valeur en main." };
  }

  const matchingIds = new Set(matching.map((c) => c.id));
  state.hands[playerId] = hand.filter((c) => !matchingIds.has(c.id));
  state.removedQuads.push({ playerId, rank, cards: matching });

  logEvent(state, { type: "quad_discard", playerId, rank });

  // Sortir un carre n'est jamais un bluff : si la main est vide, c'est
  // gagne immediatement, sans possibilite de contestation.
  confirmFinishIfEmpty(state, playerId);

  return { ok: true };
}

function doAccuse(state, playerId) {
  if (state.phase !== "playing") return { ok: false, error: "Aucune pose a contester en ce moment." };
  if (state.currentTurn !== playerId) return { ok: false, error: "Seul le joueur suivant peut crier Menteur." };
  if (!state.lastPlay || !state.canChallengeLastPlay) {
    return { ok: false, error: "Il n'y a rien a contester." };
  }

  const { playerId: accusedId, cards } = state.lastPlay;
  const mismatch = cards.some((c) => c.rank !== state.roundLeaderRank);
  const loserId = mismatch ? accusedId : playerId;

  state.phase = "reveal_pending";
  state.pendingReveal = {
    cards,
    claimedRank: state.roundLeaderRank,
    accusedId,
    accuserId: playerId,
    mismatch,
    loserId,
    pileCount: state.pileCards.length
  };

  logEvent(state, {
    type: "accuse",
    accuserId: playerId,
    accusedId,
    mismatch,
    loserId
  });

  return { ok: true };
}

function doPickup(state, playerId) {
  if (state.phase !== "reveal_pending" || !state.pendingReveal) {
    return { ok: false, error: "Rien a ramasser pour le moment." };
  }
  if (state.pendingReveal.loserId !== playerId) {
    return { ok: false, error: "Ce n'est pas a toi de ramasser." };
  }

  const { accusedId, mismatch } = state.pendingReveal;
  const loserId = state.pendingReveal.loserId;

  state.hands[loserId] = state.hands[loserId].concat(state.pileCards);
  const pickedUpCount = state.pileCards.length;

  state.pileCards = [];
  state.lastPlay = null;
  state.canChallengeLastPlay = false;
  state.roundLeaderRank = null;
  state.pendingReveal = null;
  state.phase = "playing";

  logEvent(state, { type: "pickup", playerId: loserId, count: pickedUpCount });

  // les carres formes en ramassant sortent automatiquement
  autoDiscardQuads(state, [loserId]);

  // Si l'accusation etait fausse, la pose precedente (deja verifiee comme
  // sincere) est maintenant definitivement validee.
  if (!mismatch) {
    confirmFinishIfEmpty(state, accusedId);
  }
  if (state.phase === "finished") return { ok: true };

  const next = nextActiveAfter(state, loserId);
  if (next) state.currentTurn = next;

  return { ok: true };
}

function rankingLabel(position, total) {
  if (position === 0) return "Gagnant";
  if (position === total - 1) return "Dernier";
  return `#${position + 1}`;
}

function getViewForPlayer(state, playerId, players) {
  const hand = (state.hands[playerId] || []).map(cardPublicView);

  const opponents = state.seatOrder
    .filter((id) => id !== playerId)
    .map((id) => ({
      id,
      name: players[id] ? players[id].name : "?",
      cardCount: (state.hands[id] || []).length,
      finished: state.finishedOrder.includes(id),
      connected: players[id] ? players[id].connected !== false : false
    }));

  const removedQuads = state.removedQuads.map((q) => ({
    playerId: q.playerId,
    playerName: players[q.playerId] ? players[q.playerId].name : "?",
    rank: q.rank,
    cards: q.cards.map(cardPublicView)
  }));

  const history = state.history.slice(-40).map((entry) => ({
    ...entry,
    playerName: entry.playerId && players[entry.playerId] ? players[entry.playerId].name : undefined,
    accuserName: entry.accuserId && players[entry.accuserId] ? players[entry.accuserId].name : undefined,
    accusedName: entry.accusedId && players[entry.accusedId] ? players[entry.accusedId].name : undefined
  }));

  const finishedOrder = state.finishedOrder.map((id, index) => ({
    id,
    name: players[id] ? players[id].name : "?",
    label: rankingLabel(index, state.seatOrder.length)
  }));

  let pendingReveal = null;
  if (state.pendingReveal) {
    pendingReveal = {
      ...state.pendingReveal,
      cards: state.pendingReveal.cards.map(cardPublicView),
      accusedName: players[state.pendingReveal.accusedId] ? players[state.pendingReveal.accusedId].name : "?",
      accuserName: players[state.pendingReveal.accuserId] ? players[state.pendingReveal.accuserId].name : "?",
      loserName: players[state.pendingReveal.loserId] ? players[state.pendingReveal.loserId].name : "?"
    };
  }

  return {
    gameId: "menteur",
    uid: state.uid,
    lastEventId: state.eventSeq || 0,
    phase: state.phase,
    seatOrder: state.seatOrder,
    currentTurn: state.currentTurn,
    currentTurnName: players[state.currentTurn] ? players[state.currentTurn].name : "?",
    roundLeaderRank: state.roundLeaderRank,
    lastPlay: state.lastPlay
      ? {
          playerId: state.lastPlay.playerId,
          playerName: players[state.lastPlay.playerId] ? players[state.lastPlay.playerId].name : "?",
          count: state.lastPlay.cards.length
        }
      : null,
    canChallengeLastPlay: state.canChallengeLastPlay,
    pileCount: state.pileCards.length,
    hand,
    opponents,
    removedQuads,
    history,
    pendingReveal,
    finishedOrder,
    you: {
      id: playerId,
      isYourTurn: state.currentTurn === playerId && state.phase === "playing",
      canAccuseNow:
        state.phase === "playing" &&
        state.currentTurn === playerId &&
        state.canChallengeLastPlay &&
        state.lastPlay !== null &&
        state.lastPlay.playerId !== playerId,
      canPickupNow: state.phase === "reveal_pending" && state.pendingReveal && state.pendingReveal.loserId === playerId,
      isFinished: state.finishedOrder.includes(playerId)
    }
  };
}

module.exports = {
  id: "menteur",
  name: "Menteur",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  createGame,
  applyAction,
  getViewForPlayer
};
