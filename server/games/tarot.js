// Moteur du Tarot (regles officielles FFT, avec reglages du salon).
//
// Regles implementees (validees avec Mathis) :
// - 78 cartes : 4 couleurs de 14 cartes (1 a 10, Valet, Cavalier, Dame, Roi),
//   21 atouts et l'Excuse. Bouts : le Petit (atout 1), le 21 et l'Excuse.
// - 3, 4 ou 5 joueurs. Chien de 6 cartes (3 a 5 joueurs). A 5 joueurs, le
//   preneur appelle un Roi : celui qui l'a devient son partenaire secret.
// - Encheres (un seul tour de parole, chacun doit monter ou passer) :
//   Prise (ou « Petite », reglage) x1, Garde x2, Garde sans x4, Garde contre
//   x6 ; Garde sans et Garde contre peuvent etre desactivees. Si tout le
//   monde passe, on redistribue.
// - Prise / Garde : le chien est montre a tous, le preneur le prend et fait
//   son ecart (ni Roi ni bout, pas d'atout sauf s'il n'a pas le choix : ils
//   sont alors montres). Garde sans : le chien va au preneur sans etre vu.
//   Garde contre : il va a la defense.
// - Jeu : fournir la couleur demandee ; sinon couper (atout) ; a l'atout, il
//   faut toujours monter si on peut ; sinon on joue ce qu'on veut. L'Excuse
//   se joue a tout moment, ne gagne jamais le pli (sauf chelem) et reste a
//   son camp, qui donne une demi-carte en echange. Jouee au dernier pli,
//   elle change de camp (sauf chelem).
// - Comptage FFT : bouts 4,5, Roi 4,5, Dame 3,5, Cavalier 2,5, Valet 1,5,
//   autres 0,5 (total 91). Contrat : 56 / 51 / 41 / 36 points selon 0 / 1 /
//   2 / 3 bouts. Marque = (25 + ecart + petit au bout) x multiplicateur,
//   + poignee, + chelem ; chaque defenseur paie (ou recoit) cette marque.
//   A 5 : preneur x2, partenaire x1 (preneur x4 s'il joue seul).
// - Primes reglables : petit au bout (10), poignee (20/30/40), chelem
//   (+400 annonce, +200 non annonce, -200 annonce rate), misere (regle
//   maison : 10 points par adversaire, main sans atout ni excuse, ou sans
//   tete).
// - Donne annulee si un joueur a le Petit sec (Petit seul atout, sans Excuse).

const crypto = require("crypto");
const { buildTarotDeck, shuffle, cardPublicView } = require("../deck");

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 5;
const TRICK_PAUSE_MS = 1700;
const CHIEN_SHOW_MS = 3200;
const COLOR_ORDER = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "C", "D", "R"];
const COLOR_POWER = Object.fromEntries(COLOR_ORDER.map((r, i) => [r, i]));
const SUIT_NAMES = { pique: "Pique", coeur: "Cœur", carreau: "Carreau", trefle: "Trèfle", atout: "Atout" };
const SUIT_SYMBOLS = { pique: "♠", coeur: "♥", carreau: "♦", trefle: "♣", atout: "🂠" };
const RANK_NAMES = { V: "Valet", C: "Cavalier", D: "Dame", R: "Roi" };
const HAND_SIZE = { 3: 24, 4: 18, 5: 15 };
const CHIEN_SIZE = { 3: 6, 4: 6, 5: 3 };
const POIGNEE = { 3: [13, 15, 18], 4: [10, 13, 15], 5: [8, 10, 13] };
const POIGNEE_PRIME = [20, 30, 40];
const POIGNEE_NAMES = ["Poignée simple", "Double poignée", "Triple poignée"];
const NEEDED = [56, 51, 41, 36];
const MISERE_PRIME = 10;

// ------------------------------------------------------------------ cartes

const isTrump = (c) => c.suit === "atout";
const isExcuse = (c) => c.suit === "excuse";
const trumpValue = (c) => (isTrump(c) ? parseInt(c.rank, 10) : 0);
const isBout = (c) => isExcuse(c) || (isTrump(c) && (c.rank === "1" || c.rank === "21"));
const isPetit = (c) => isTrump(c) && c.rank === "1";

function cardPoints(c) {
  if (isBout(c)) return 4.5;
  if (isTrump(c)) return 0.5;
  return { R: 4.5, D: 3.5, C: 2.5, V: 1.5 }[c.rank] || 0.5;
}

function cardLabel(c) {
  if (isExcuse(c)) return "l'Excuse";
  if (isTrump(c)) return c.rank === "1" ? "le Petit" : `le ${c.rank} d'atout`;
  return `${RANK_NAMES[c.rank] || c.rank} ${SUIT_SYMBOLS[c.suit]}`;
}

// ------------------------------------------------------------------ options

function normalizeOptions(raw) {
  const o = raw || {};
  const bool = (v, def) => (v === undefined || v === null ? def : v === true || v === "true" || v === 1);
  const donnes = parseInt(o.donnes, 10);
  return {
    firstBid: o.firstBid === "petite" ? "petite" : "prise",
    gardeSans: bool(o.gardeSans, true),
    gardeContre: bool(o.gardeContre, true),
    petitAuBout: bool(o.petitAuBout, true),
    poignee: bool(o.poignee, true),
    chelem: bool(o.chelem, true),
    misere: bool(o.misere, false),
    donnes: [0, 3, 5, 10, 15, 20].includes(donnes) ? donnes : 0
  };
}

function contractsFor(options) {
  const list = [{ key: "prise", label: options.firstBid === "petite" ? "Petite" : "Prise", mult: 1 }, { key: "garde", label: "Garde", mult: 2 }];
  if (options.gardeSans) list.push({ key: "garde_sans", label: "Garde sans", mult: 4 });
  if (options.gardeContre) list.push({ key: "garde_contre", label: "Garde contre", mult: 6 });
  return list;
}

// ------------------------------------------------------------------ utilitaires

function logEvent(state, entry) {
  state.eventSeq += 1;
  state.history.push({ id: state.eventSeq, at: Date.now(), donne: state.donne, ...entry });
  if (state.history.length > 6000) state.history.splice(0, state.history.length - 6000);
}

function seatAfter(state, id, k = 1) {
  const o = state.seatOrder;
  return o[(o.indexOf(id) + k) % o.length];
}

function dealerId(state) {
  return state.seatOrder[state.dealerIdx % state.seatOrder.length];
}

function sortForDisplay(cards) {
  const suitIdx = { pique: 0, coeur: 1, trefle: 2, carreau: 3, atout: 4, excuse: 5 };
  return cards.slice().sort((a, b) => suitIdx[a.suit] - suitIdx[b.suit] || (isTrump(a) ? trumpValue(a) - trumpValue(b) : COLOR_POWER[a.rank] - COLOR_POWER[b.rank]));
}

// ------------------------------------------------------------------ partie

function createGame(playerIds, rawOptions) {
  const seatOrder = shuffle(playerIds);
  const options = normalizeOptions(rawOptions);
  const state = {
    id: "tarot",
    uid: crypto.randomBytes(5).toString("hex"),
    eventSeq: 0,
    history: [],
    options,
    contracts: contractsFor(options),
    seatOrder,
    donne: 0,
    dealerIdx: seatOrder.length - 1,
    scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
    roundResults: [],
    lastResult: null,
    redeals: 0
  };
  startDonne(state);
  return state;
}

function resetDonne(state) {
  state.hands = {};
  state.chien = [];
  state.ecart = [];
  state.ecartShown = [];
  state.bids = {};
  state.bestBid = -1;
  state.takerId = null;
  state.contract = null;
  state.calledCard = null;
  state.partnerId = null;
  state.partnerRevealed = false;
  state.trick = [];
  state.trickNumber = 0;
  state.trickWinner = null;
  state.trickWinners = [];
  state.wonCards = Object.fromEntries(state.seatOrder.map((id) => [id, []]));
  state.excuse = null; // { ownerId, trick, winnerId }
  state.poignees = {};
  state.miseres = {};
  state.chelemAnnounced = false;
  state.played = Object.fromEntries(state.seatOrder.map((id) => [id, 0]));
  state.lastTrick = null;
}

function startDonne(state) {
  state.donne += 1;
  state.dealerIdx = (state.dealerIdx + 1) % state.seatOrder.length;
  deal(state);
}

function deal(state) {
  resetDonne(state);
  state.dealNo = (state.dealNo || 0) + 1;
  const n = state.seatOrder.length;
  const deck = shuffle(buildTarotDeck());
  const dealer = dealerId(state);
  const size = HAND_SIZE[n];
  for (let p = 0; p < n; p += 1) {
    const id = seatAfter(state, dealer, p + 1);
    state.hands[id] = deck.slice(p * size, (p + 1) * size);
  }
  state.chien = deck.slice(n * size);
  // Petit sec : donne annulee, on redistribue
  const sec = state.seatOrder.find((id) => {
    const h = state.hands[id];
    const trumps = h.filter(isTrump);
    return trumps.length === 1 && isPetit(trumps[0]) && !h.some(isExcuse);
  });
  logEvent(state, { type: "deal", dealerId: dealer, donne: state.donne });
  if (sec && state.redeals < 20) {
    state.redeals += 1;
    logEvent(state, { type: "petit_sec", playerId: sec });
    return deal(state);
  }
  state.redeals = 0;
  state.phase = "bidding";
  state.currentTurn = seatAfter(state, dealer, 1);
}

// ------------------------------------------------------------------ encheres

function doBid(state, playerId, action) {
  if (state.phase !== "bidding") return { ok: false, error: "Ce n'est pas le moment d'enchérir." };
  if (state.currentTurn !== playerId) return { ok: false, error: "Ce n'est pas ton tour de parler." };
  const key = action.bid;
  let idx = -1;
  if (key !== "passe") {
    idx = state.contracts.findIndex((c) => c.key === key);
    if (idx < 0) return { ok: false, error: "Enchère inconnue." };
    if (idx <= state.bestBid) return { ok: false, error: `Il faut monter au-dessus de ${state.contracts[state.bestBid].label}.` };
    state.bestBid = idx;
    state.takerId = playerId;
  }
  state.bids[playerId] = idx;
  logEvent(state, { type: "bid", playerId, bid: key, label: idx < 0 ? "Passe" : state.contracts[idx].label });
  const next = seatAfter(state, playerId, 1);
  const allSpoke = state.seatOrder.every((id) => state.bids[id] !== undefined);
  // la plus forte enchere possible met fin aux encheres
  if (!allSpoke && idx !== state.contracts.length - 1) {
    state.currentTurn = next;
    return { ok: true };
  }
  if (state.bestBid < 0) {
    logEvent(state, { type: "all_pass" });
    state.dealerIdx = (state.dealerIdx + 1) % state.seatOrder.length;
    deal(state);
    return { ok: true };
  }
  state.contract = state.contracts[state.bestBid];
  logEvent(state, { type: "taker", playerId: state.takerId, contract: state.contract.key, label: state.contract.label });
  if (state.seatOrder.length === 5) {
    state.phase = "calling";
    state.currentTurn = state.takerId;
    return { ok: true };
  }
  return afterCall(state);
}

// A 5 joueurs : rang que le preneur peut appeler (Roi, ou Dame s'il a les 4
// Rois, etc.)
function callableRank(state) {
  const hand = state.hands[state.takerId];
  for (const rank of ["R", "D", "C", "V"]) {
    if (hand.filter((c) => c.rank === rank && !isTrump(c)).length < 4) return rank;
  }
  return "V";
}

function doCall(state, playerId, action) {
  if (state.phase !== "calling") return { ok: false, error: "Ce n'est pas le moment d'appeler." };
  if (playerId !== state.takerId) return { ok: false, error: "C'est au preneur d'appeler un Roi." };
  const suit = action.suit;
  if (!["pique", "coeur", "carreau", "trefle"].includes(suit)) return { ok: false, error: "Couleur inconnue." };
  const rank = callableRank(state);
  state.calledCard = { rank, suit };
  const owner = state.seatOrder.find((id) => state.hands[id].some((c) => c.rank === rank && c.suit === suit));
  // le Roi est dans le chien ou dans la main du preneur : il joue seul
  state.partnerId = owner && owner !== state.takerId ? owner : null;
  logEvent(state, { type: "call", playerId, rank, suit });
  return afterCall(state);
}

function afterCall(state) {
  const key = state.contract.key;
  if (key === "prise" || key === "garde") {
    state.phase = "chien";
    state.currentTurn = null;
    logEvent(state, { type: "chien_reveal", cards: state.chien.map(cardPublicView) });
    return { ok: true, schedule: CHIEN_SHOW_MS };
  }
  logEvent(state, { type: "chien_hidden", toAttack: key === "garde_sans" });
  return startPlay(state);
}

// ------------------------------------------------------------------ chien / ecart

function ecartRules(state) {
  const hand = state.hands[state.takerId];
  const size = state.chien.length;
  const allowedNoTrump = hand.filter((c) => !isTrump(c) && !isExcuse(c) && c.rank !== "R");
  return { size, needTrumps: Math.max(0, size - allowedNoTrump.length) };
}

function ecartError(state, cards) {
  const { size, needTrumps } = ecartRules(state);
  if (cards.length !== size) return `Écarte exactement ${size} cartes.`;
  if (cards.some(isBout)) return "Interdit d'écarter un bout (le Petit, le 21 ou l'Excuse).";
  if (cards.some((c) => !isTrump(c) && c.rank === "R")) return "Interdit d'écarter un Roi.";
  const trumps = cards.filter(isTrump).length;
  if (trumps > needTrumps) return "Pas d'atout à l'écart, sauf si tu n'as pas le choix.";
  return null;
}

function doEcart(state, playerId, action) {
  if (state.phase !== "ecart") return { ok: false, error: "Ce n'est pas le moment de faire l'écart." };
  if (playerId !== state.takerId) return { ok: false, error: "C'est au preneur de faire l'écart." };
  const ids = Array.isArray(action.cardIds) ? action.cardIds : [];
  const hand = state.hands[playerId];
  const cards = ids.map((id) => hand.find((c) => c.id === id));
  if (cards.some((c) => !c) || new Set(ids).size !== ids.length) return { ok: false, error: "Cartes introuvables." };
  const err = ecartError(state, cards);
  if (err) return { ok: false, error: err };
  const set = new Set(ids);
  state.hands[playerId] = hand.filter((c) => !set.has(c.id));
  state.ecart = cards;
  state.ecartShown = cards.filter(isTrump);
  logEvent(state, { type: "ecart", playerId, trumps: state.ecartShown.map(cardPublicView) });
  return startPlay(state);
}

function startPlay(state) {
  if (state.options.chelem) {
    state.phase = "chelem";
    state.currentTurn = state.takerId;
    return { ok: true };
  }
  return beginTricks(state);
}

function doChelem(state, playerId, action) {
  if (state.phase !== "chelem") return { ok: false, error: "Ce n'est pas le moment d'annoncer un chelem." };
  if (playerId !== state.takerId) return { ok: false, error: "Seul le preneur peut annoncer un chelem." };
  state.chelemAnnounced = !!action.announce;
  if (state.chelemAnnounced) logEvent(state, { type: "chelem", playerId });
  return beginTricks(state);
}

function beginTricks(state) {
  state.phase = "playing";
  // le preneur qui annonce un chelem entame ; sinon le joueur apres le donneur
  state.currentTurn = state.chelemAnnounced ? state.takerId : seatAfter(state, dealerId(state), 1);
  logEvent(state, { type: "play_start", starterId: state.currentTurn });
  return { ok: true };
}

// ------------------------------------------------------------------ annonces

function trumpCount(hand) {
  return hand.filter(isTrump).length + (hand.some(isExcuse) ? 1 : 0);
}

function poigneeLevels(state, playerId) {
  if (!state.options.poignee) return [];
  const k = trumpCount(state.hands[playerId] || []);
  return POIGNEE[state.seatOrder.length].map((need, i) => (k >= need ? i : -1)).filter((i) => i >= 0);
}

function misereKinds(state, playerId) {
  if (!state.options.misere) return [];
  const h = state.hands[playerId] || [];
  const out = [];
  if (!h.some((c) => isTrump(c) || isExcuse(c))) out.push("atout");
  if (!h.some((c) => !isTrump(c) && !isExcuse(c) && ["V", "C", "D", "R"].includes(c.rank))) out.push("tete");
  return out;
}

// Annonces possibles avant de jouer sa premiere carte.
function canAnnounce(state, playerId) {
  return state.phase === "playing" && state.trickNumber === 0 && state.played[playerId] === 0 && state.currentTurn === playerId;
}

function doAnnounce(state, playerId, action) {
  if (!canAnnounce(state, playerId)) return { ok: false, error: "Les annonces se font juste avant de jouer ta première carte." };
  if (action.kind === "poignee") {
    const level = parseInt(action.level, 10);
    if (!poigneeLevels(state, playerId).includes(level)) return { ok: false, error: "Pas assez d'atouts pour cette poignée." };
    if (state.poignees[playerId]) return { ok: false, error: "Poignée déjà annoncée." };
    const need = POIGNEE[state.seatOrder.length][level];
    const hand = state.hands[playerId];
    const trumps = hand.filter(isTrump).sort((a, b) => trumpValue(a) - trumpValue(b));
    // on montre les atouts demandes (l'Excuse seulement s'il en manque)
    const shown = trumps.length >= need ? trumps.slice(trumps.length - need) : trumps.concat(hand.filter(isExcuse));
    state.poignees[playerId] = { level, cards: shown };
    logEvent(state, { type: "poignee", playerId, level, name: POIGNEE_NAMES[level], cards: shown.map(cardPublicView) });
    return { ok: true };
  }
  if (action.kind === "misere") {
    const kinds = misereKinds(state, playerId);
    const kind = action.misere === "tete" ? "tete" : "atout";
    if (!kinds.includes(kind)) return { ok: false, error: "Ta main ne permet pas cette misère." };
    state.miseres[playerId] = state.miseres[playerId] || [];
    if (state.miseres[playerId].includes(kind)) return { ok: false, error: "Misère déjà annoncée." };
    state.miseres[playerId].push(kind);
    logEvent(state, { type: "misere", playerId, kind });
    return { ok: true };
  }
  return { ok: false, error: "Annonce inconnue." };
}

// ------------------------------------------------------------------ jeu de la carte

function leadSuitOf(trick) {
  const first = trick.find((p) => !isExcuse(p.card));
  return first ? first.card.suit : null;
}

function legalCards(state, playerId) {
  const hand = state.hands[playerId] || [];
  const lead = leadSuitOf(state.trick);
  if (!lead) return hand;
  const excuse = hand.filter(isExcuse);
  const highest = Math.max(0, ...state.trick.map((p) => trumpValue(p.card)));
  const trumps = hand.filter(isTrump);
  const over = trumps.filter((c) => trumpValue(c) > highest);
  if (lead !== "atout") {
    const follow = hand.filter((c) => c.suit === lead);
    if (follow.length) return follow.concat(excuse);
  }
  if (trumps.length) return (over.length ? over : trumps).concat(excuse);
  return hand;
}

function trickWinnerOf(trick, isLast, chelemCamp) {
  const lead = leadSuitOf(trick);
  // chelem : l'Excuse jouee en dernier par le camp qui a tout pris gagne
  if (isLast && chelemCamp && isExcuse(trick[0].card) && chelemCamp.has(trick[0].playerId)) return trick[0].playerId;
  let best = null;
  for (const p of trick) {
    const c = p.card;
    if (isExcuse(c)) continue;
    if (!best) { best = p; continue; }
    const b = best.card;
    if (isTrump(c) && !isTrump(b)) best = p;
    else if (isTrump(c) && isTrump(b) && trumpValue(c) > trumpValue(b)) best = p;
    else if (!isTrump(c) && !isTrump(b) && c.suit === lead && b.suit === lead && COLOR_POWER[c.rank] > COLOR_POWER[b.rank]) best = p;
  }
  return best ? best.playerId : trick[0].playerId;
}

function attackCamp(state) {
  const camp = new Set([state.takerId]);
  if (state.partnerId) camp.add(state.partnerId);
  return camp;
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
    const lead = leadSuitOf(state.trick);
    const hasLead = lead && lead !== "atout" && state.hands[playerId].some((c) => c.suit === lead);
    if (hasLead) return { ok: false, error: `Tu dois fournir : joue du ${SUIT_NAMES[lead]} ${SUIT_SYMBOLS[lead]}.` };
    return { ok: false, error: lead === "atout" ? "À l'atout, il faut monter si tu peux." : "Tu dois couper (et monter si tu peux)." };
  }
  state.hands[playerId] = state.hands[playerId].filter((c) => c !== card);
  state.played[playerId] += 1;
  const lead = leadSuitOf(state.trick);
  state.trick.push({ playerId, card });
  const cut = isTrump(card) && lead && lead !== "atout";
  const called = state.calledCard && card.rank === state.calledCard.rank && card.suit === state.calledCard.suit;
  logEvent(state, { type: "play", playerId, rank: card.rank, suit: card.suit, lead: state.trick.length === 1, cut, trick: state.trickNumber + 1 });
  if (called && !state.partnerRevealed) {
    state.partnerRevealed = true;
    logEvent(state, { type: "partner", playerId: state.partnerId || state.takerId, alone: !state.partnerId });
  }
  if (state.trick.length < state.seatOrder.length) {
    state.currentTurn = seatAfter(state, playerId, 1);
    return { ok: true };
  }
  const total = HAND_SIZE[state.seatOrder.length];
  const isLast = state.trickNumber === total - 1;
  // camp qui a remporte tous les plis jusqu'ici (pour l'Excuse au dernier pli)
  let chelemCamp = null;
  if (isLast) {
    const atk = attackCamp(state);
    const def = new Set(state.seatOrder.filter((id) => !atk.has(id)));
    if (state.trickWinners.every((w) => atk.has(w))) chelemCamp = atk;
    else if (state.trickWinners.every((w) => def.has(w))) chelemCamp = def;
  }
  const winner = trickWinnerOf(state.trick, isLast, chelemCamp);
  state.trickWinner = winner;
  state.phase = "trick_done";
  state.currentTurn = null;
  state.trickNumber += 1;
  logEvent(state, { type: "trick_won", playerId: winner, number: state.trickNumber });
  return { ok: true, schedule: TRICK_PAUSE_MS };
}

// Pauses automatiques : fin de la presentation du chien, ramassage d'un pli.
function tick(state) {
  if (state.phase === "chien") {
    state.hands[state.takerId] = state.hands[state.takerId].concat(state.chien);
    state.phase = "ecart";
    state.currentTurn = state.takerId;
    logEvent(state, { type: "chien_taken", playerId: state.takerId });
    return { ok: true };
  }
  if (state.phase !== "trick_done") return { ok: false };
  const winner = state.trickWinner;
  const total = HAND_SIZE[state.seatOrder.length];
  const isLast = state.trickNumber === total;
  const cards = [];
  for (const p of state.trick) {
    if (isExcuse(p.card)) {
      // l'Excuse reste a son camp, sauf au dernier pli (hors chelem)
      const keep = !isLast || p.playerId === winner;
      state.excuse = { ownerId: p.playerId, trick: state.trickNumber, winnerId: winner, kept: keep };
      if (keep) state.wonCards[p.playerId].push(p.card);
      else cards.push(p.card);
    } else cards.push(p.card);
  }
  state.wonCards[winner].push(...cards);
  state.trickWinners.push(winner);
  state.lastTrick = { winner, cards: state.trick.map((p) => ({ playerId: p.playerId, card: p.card })) };
  state.trick = [];
  state.trickWinner = null;
  if (state.seatOrder.every((id) => state.hands[id].length === 0)) {
    endDonne(state);
  } else {
    state.phase = "playing";
    state.currentTurn = winner;
  }
  return { ok: true };
}

// ------------------------------------------------------------------ comptage

function endDonne(state) {
  const atk = attackCamp(state);
  const n = state.seatOrder.length;
  const mult = state.contract.mult;
  const key = state.contract.key;
  let attackCards = [];
  for (const id of atk) attackCards = attackCards.concat(state.wonCards[id]);
  if (key === "prise" || key === "garde") attackCards = attackCards.concat(state.ecart);
  if (key === "garde_sans") attackCards = attackCards.concat(state.chien);
  let points = attackCards.reduce((s, c) => s + cardPoints(c), 0);
  // echange de l'Excuse contre une demi-carte
  const ex = state.excuse;
  if (ex && ex.kept && atk.has(ex.ownerId) !== atk.has(ex.winnerId)) points += atk.has(ex.ownerId) ? -0.5 : 0.5;
  const bouts = attackCards.filter(isBout).length;
  const needed = NEEDED[bouts];
  const diff = points - needed;
  const made = diff >= 0;
  const ecartPts = Math.round(Math.abs(diff));
  const sign = made ? 1 : -1;

  // petit au bout : le Petit dans le dernier pli
  let pab = 0;
  if (state.options.petitAuBout && state.lastTrick && state.lastTrick.cards.some((p) => isPetit(p.card))) {
    pab = atk.has(state.lastTrick.winner) ? 10 : -10;
  }
  const contractScore = ((25 + ecartPts) * sign + pab) * mult;

  // poignees : prime au camp gagnant
  let poignee = 0;
  for (const p of Object.values(state.poignees)) poignee += POIGNEE_PRIME[p.level];
  poignee *= sign;

  // chelem
  let chelem = 0;
  const atkAll = state.trickWinners.every((w) => atk.has(w));
  const defAll = state.trickWinners.every((w) => !atk.has(w));
  if (state.options.chelem) {
    if (atkAll) chelem = state.chelemAnnounced ? 400 : 200;
    else if (state.chelemAnnounced) chelem = -200;
    else if (defAll) chelem = -200;
  }
  const perDefender = contractScore + poignee + chelem;

  const deltas = Object.fromEntries(state.seatOrder.map((id) => [id, 0]));
  const defenders = state.seatOrder.filter((id) => !atk.has(id));
  for (const id of defenders) deltas[id] -= perDefender;
  if (n === 5 && state.partnerId) {
    deltas[state.takerId] += 2 * perDefender;
    deltas[state.partnerId] += perDefender;
  } else {
    deltas[state.takerId] += defenders.length * perDefender;
  }
  // miseres : 10 points payes par chaque adversaire
  const miseres = [];
  for (const [id, kinds] of Object.entries(state.miseres)) {
    for (const kind of kinds) {
      miseres.push({ id, kind });
      for (const other of state.seatOrder) {
        if (other === id) continue;
        deltas[other] -= MISERE_PRIME;
        deltas[id] += MISERE_PRIME;
      }
    }
  }
  for (const id of state.seatOrder) state.scores[id] += deltas[id];

  state.lastResult = {
    donne: state.donne,
    takerId: state.takerId,
    partnerId: state.partnerId,
    calledCard: state.calledCard,
    contract: state.contract.key,
    contractLabel: state.contract.label,
    mult,
    points,
    bouts,
    needed,
    made,
    ecart: ecartPts,
    petitAuBout: pab,
    poignee,
    poignees: Object.entries(state.poignees).map(([id, p]) => ({ id, level: p.level })),
    chelem,
    chelemAnnounced: state.chelemAnnounced,
    miseres,
    perDefender,
    deltas,
    totals: { ...state.scores }
  };
  state.roundResults.push(state.lastResult);
  const last = state.options.donnes > 0 && state.donne >= state.options.donnes;
  state.phase = last ? "finished" : "round_end";
  state.currentTurn = null;
  logEvent(state, { type: "round_end", made, points, needed, last, takerId: state.takerId });
}

function doNextRound(state, playerId, ctx) {
  if (state.phase !== "round_end") return { ok: false, error: "La donne n'est pas terminée." };
  if (!ctx || !ctx.isHost) return { ok: false, error: "Seul le patron lance la donne suivante." };
  startDonne(state);
  return { ok: true };
}

function doEnd(state, ctx) {
  if (!ctx || !ctx.isHost) return { ok: false, error: "Seul le patron peut arrêter la partie." };
  if (state.phase === "finished") return { ok: false, error: "La partie est déjà terminée." };
  // une donne en cours n'est pas comptee
  state.phase = "finished";
  state.currentTurn = null;
  logEvent(state, { type: "end", byHost: true });
  return { ok: true };
}

function applyAction(state, playerId, action, ctx) {
  if (!state.seatOrder.includes(playerId)) return { ok: false, error: "Joueur inconnu dans cette partie." };
  switch (action.type) {
    case "bid": return doBid(state, playerId, action);
    case "call": return doCall(state, playerId, action);
    case "ecart": return doEcart(state, playerId, action);
    case "chelem": return doChelem(state, playerId, action);
    case "announce": return doAnnounce(state, playerId, action);
    case "play": return doPlay(state, playerId, action);
    case "next_round": return doNextRound(state, playerId, ctx);
    case "end_game": return doEnd(state, ctx);
    default: return { ok: false, error: `Action inconnue: ${action.type}` };
  }
}

// ------------------------------------------------------------------ vues

function namedHistory(events, name) {
  return events.map((e) => ({ ...e, playerName: e.playerId ? name(e.playerId) : undefined, dealerName: e.dealerId ? name(e.dealerId) : undefined, starterName: e.starterId ? name(e.starterId) : undefined }));
}

// Pendant une donne, on ne peut pas remonter les plis : seul le dernier pli
// termine (et le pli en cours) reste visible.
function visibleHistory(state) {
  const live = ["bidding", "calling", "chien", "ecart", "chelem", "playing", "trick_done"].includes(state.phase);
  const lastDone = state.phase === "trick_done" ? state.trickNumber - 1 : state.trickNumber;
  return state.history.filter((e) => {
    if (!live || e.donne !== state.donne) return true;
    if (e.type === "play") return e.trick >= lastDone;
    if (e.type === "trick_won") return e.number >= lastDone;
    return true;
  });
}

function fullHistory(state, playerId, players) {
  const name = (id) => (players[id] ? players[id].name : "?");
  return namedHistory(visibleHistory(state), name);
}

function getViewForPlayer(state, playerId, players) {
  const name = (id) => (players[id] ? players[id].name : "?");
  const dealer = dealerId(state);
  const myTurn = state.phase === "playing" && state.currentTurn === playerId;
  const n = state.seatOrder.length;
  const atk = attackCamp(state);
  // a 5, le partenaire reste secret jusqu'a ce que la carte appelee tombe
  const partnerKnown = state.partnerRevealed || playerId === state.partnerId;
  const partnerVisible = partnerKnown ? state.partnerId : null;
  const campOf = (id) => {
    if (!state.takerId) return null;
    if (id === state.takerId) return "attack";
    if (n < 5 || state.partnerRevealed) return atk.has(id) ? "attack" : "defense";
    if (playerId === state.partnerId && id === playerId) return "attack";
    return null;
  };
  const isTaker = playerId === state.takerId;
  const showChien = state.phase === "chien";
  const ecartInfo = state.phase === "ecart" && isTaker ? ecartRules(state) : null;
  const contract = state.contract;
  const total = HAND_SIZE[n];
  return {
    gameId: "tarot",
    uid: state.uid,
    lastEventId: state.eventSeq,
    phase: state.phase,
    donne: state.donne,
    dealNo: state.dealNo,
    donnes: state.options.donnes,
    options: state.options,
    contracts: state.contracts,
    seatOrder: state.seatOrder,
    dealerId: dealer,
    dealerName: name(dealer),
    currentTurn: state.currentTurn,
    currentTurnName: state.currentTurn ? name(state.currentTurn) : "",
    hand: (state.hands[playerId] || []).map(cardPublicView),
    handSize: total,
    chienSize: CHIEN_SIZE[n],
    chien: showChien ? state.chien.map(cardPublicView) : null,
    chienTaken: state.phase === "ecart" && !isTaker ? state.chien.map(cardPublicView) : null,
    chienCount: ["bidding", "calling", "chien"].includes(state.phase) ? state.chien.length : 0,
    ecartTrumps: state.ecartShown.map(cardPublicView),
    bestBid: state.bestBid,
    bids: state.seatOrder.map((id) => ({ id, name: name(id), bid: state.bids[id] === undefined ? null : state.bids[id] })),
    takerId: state.takerId,
    takerName: state.takerId ? name(state.takerId) : "",
    contract: contract ? { key: contract.key, label: contract.label, mult: contract.mult } : null,
    calledCard: state.calledCard,
    partnerId: partnerVisible,
    partnerName: partnerVisible ? name(partnerVisible) : "",
    partnerRevealed: state.partnerRevealed,
    chelemAnnounced: state.chelemAnnounced,
    trick: state.trick.map((p) => ({ playerId: p.playerId, playerName: name(p.playerId), card: cardPublicView(p.card) })),
    leadSuit: leadSuitOf(state.trick),
    trickWinner: state.trickWinner,
    trickWinnerName: state.trickWinner ? name(state.trickWinner) : "",
    trickNumber: state.trickNumber,
    tricksTotal: total,
    lastTrick: state.lastTrick ? { winner: state.lastTrick.winner, winnerName: name(state.lastTrick.winner), cards: state.lastTrick.cards.map((p) => ({ playerId: p.playerId, playerName: name(p.playerId), card: cardPublicView(p.card) })) } : null,
    poignees: Object.entries(state.poignees).map(([id, p]) => ({ id, name: name(id), level: p.level, label: POIGNEE_NAMES[p.level], cards: p.cards.map(cardPublicView) })),
    miseres: Object.entries(state.miseres).map(([id, kinds]) => ({ id, name: name(id), kinds })),
    players: state.seatOrder.map((id) => ({
      id,
      name: name(id),
      score: state.scores[id],
      isDealer: id === dealer,
      camp: campOf(id),
      wonCards: state.wonCards[id] ? state.wonCards[id].length + (id === state.takerId && state.phase !== "chien" && state.phase !== "ecart" ? (contract && contract.key === "garde_sans" ? state.chien.length : state.ecart.length) : 0) : 0,
      bid: state.bids[id] === undefined ? null : state.bids[id]
    })),
    defenseChien: contract && contract.key === "garde_contre" && ["chelem", "playing", "trick_done", "round_end", "finished"].includes(state.phase) ? state.chien.length : 0,
    opponents: state.seatOrder.filter((id) => id !== playerId).map((id) => ({
      id,
      name: name(id),
      cardCount: (state.hands[id] || []).length,
      isDealer: id === dealer,
      camp: campOf(id),
      bid: state.bids[id] === undefined ? null : state.bids[id],
      connected: players[id] ? players[id].connected !== false : false
    })),
    scores: state.seatOrder.map((id) => ({ id, name: name(id), score: state.scores[id] })),
    ranking: state.seatOrder.slice().sort((a, b) => state.scores[b] - state.scores[a]).map((id) => ({ id, name: name(id), score: state.scores[id] })),
    lastResult: state.lastResult,
    roundResults: state.roundResults,
    history: namedHistory(visibleHistory(state).slice(-40), name),
    you: {
      id: playerId,
      isYourTurn: state.currentTurn === playerId && ["bidding", "calling", "ecart", "chelem", "playing"].includes(state.phase),
      mustBid: state.phase === "bidding" && state.currentTurn === playerId,
      mustCall: state.phase === "calling" && isTaker,
      callRank: state.phase === "calling" && isTaker ? callableRank(state) : null,
      mustEcart: !!ecartInfo,
      ecartSize: ecartInfo ? ecartInfo.size : 0,
      ecartNeedTrumps: ecartInfo ? ecartInfo.needTrumps : 0,
      chienIds: ecartInfo ? state.chien.map((c) => c.id) : [],
      mustChelem: state.phase === "chelem" && isTaker,
      isTaker,
      camp: campOf(playerId),
      legalIds: myTurn ? legalCards(state, playerId).map((c) => c.id) : [],
      canAnnounce: canAnnounce(state, playerId),
      poigneeLevels: canAnnounce(state, playerId) && !state.poignees[playerId] ? poigneeLevels(state, playerId) : [],
      misereKinds: canAnnounce(state, playerId) ? misereKinds(state, playerId).filter((k) => !(state.miseres[playerId] || []).includes(k)) : [],
      isDealer: playerId === dealer,
      isFinished: false
    }
  };
}

module.exports = {
  id: "tarot",
  name: "Le Tarot",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  createGame,
  applyAction,
  tick,
  getViewForPlayer,
  fullHistory,
  normalizeOptions,
  _internals: {
    legalCards, trickWinnerOf, cardPoints, isTrump, isExcuse, isBout, isPetit, trumpValue, leadSuitOf,
    ecartRules, ecartError, callableRank, poigneeLevels, misereKinds, attackCamp, COLOR_POWER, HAND_SIZE, CHIEN_SIZE, POIGNEE, cardLabel, sortForDisplay
  }
};
