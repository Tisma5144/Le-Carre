// Moteur de la Coinche (belote coinchee).
//
// Regles implementees (validees avec Mathis) :
// - 4 joueurs, 2 equipes de 2 (partenaires face a face, tires au sort).
//   32 cartes (7 a l'As), 8 cartes chacun.
// - Encheres : chacun son tour (a gauche du donneur d'abord), on annonce un
//   contrat de 80 a 160 (par 10), puis capot (250) ou generale (500), avec
//   une couleur d'atout (Sans Atout / Tout Atout en option du salon), ou on
//   passe. Il faut monter. Trois passes apres une enchere la cloturent ;
//   quatre passes d'entree : on redistribue.
// - Coinche : a son tour, un adversaire de l'equipe qui tient l'enchere peut
//   coincher (x2). Les encheres s'arretent et le preneur peut surcoincher
//   (x4) ou non.
// - Jeu de la carte : fournir la couleur demandee ; a l'atout, monter si on
//   peut ; sans la couleur : couper (et surcouper si un adversaire a deja
//   coupe, sinon sous-couper), sauf si son partenaire est maitre du pli : on
//   joue alors ce qu'on veut. Sans Atout : seulement fournir. Tout Atout :
//   fournir et monter dans la couleur demandee.
// - Valeurs : atout V 20, 9 14, A 11, 10 10, R 4, D 3 ; autres couleurs
//   A 11, 10 10, R 4, D 3, V 2. Sans Atout : A 19, 10 10, R 4, D 3, V 2.
//   Tout Atout : V 14, 9 9, A 6, 10 5, R 3, D 1. Toujours 152 + 10 de der.
// - Annonces (option, activee par defaut), faites automatiquement a sa
//   premiere carte : tierce 20, cinquante 50, cent 100 (suites dans l'ordre
//   7 8 9 10 V D R A), carres d'As/R/D/10 100, de 9 150, de V 200. Seule
//   l'equipe qui a la meilleure annonce marque les siennes. Belote-rebelote
//   (R + D d'atout dans la meme main, contrats a la couleur) : 20 points
//   imprenables, annoncee quand on pose la 1re puis la 2e carte.
// - Contrat reussi si plis + der + annonces + belote de l'equipe preneuse
//   >= contrat (capot : tous les plis ; generale : tous les plis par le
//   preneur seul). Un capot realise vaut 250 au lieu de 162.
// - Marque (option « points », par defaut) : reussi -> preneurs : contrat +
//   leurs points ; defense : ses points. Coinche reussie -> preneurs :
//   160 + contrat x multiplicateur. Chute -> defense : 160 + contrat x
//   multiplicateur + toutes les annonces. La belote reste toujours a son
//   equipe. Option « contrat » : on ne marque que le contrat (x mult), la
//   defense marque 160 + contrat (x mult) en cas de chute.
// - Partie en 500, 1000 (defaut) ou 2000 points.

const crypto = require("crypto");
const { buildStandardDeck, shuffle, cardPublicView } = require("../deck");

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 4;
const TRICK_PAUSE_MS = 1500;
const SUITS = ["pique", "coeur", "carreau", "trefle"];
const RANKS32 = ["7", "8", "9", "10", "V", "D", "R", "A"];
const SEQ_ORDER = Object.fromEntries(RANKS32.map((r, i) => [r, i])); // pour les suites
const TRUMP_ORDER = ["7", "8", "D", "R", "10", "A", "9", "V"]; // du plus faible au plus fort
const PLAIN_ORDER = ["7", "8", "9", "V", "D", "R", "10", "A"];
const TRUMP_POWER = Object.fromEntries(TRUMP_ORDER.map((r, i) => [r, i]));
const PLAIN_POWER = Object.fromEntries(PLAIN_ORDER.map((r, i) => [r, i]));
const PTS_TRUMP = { V: 20, 9: 14, A: 11, 10: 10, R: 4, D: 3, 8: 0, 7: 0 };
const PTS_PLAIN = { A: 11, 10: 10, R: 4, D: 3, V: 2, 9: 0, 8: 0, 7: 0 };
const PTS_SA = { A: 19, 10: 10, R: 4, D: 3, V: 2, 9: 0, 8: 0, 7: 0 };
const PTS_TA = { V: 14, 9: 9, A: 6, 10: 5, R: 3, D: 1, 8: 0, 7: 0 };
const VALUES = [80, 90, 100, 110, 120, 130, 140, 150, 160, 250, 500];
const VALUE_LABEL = { 250: "Capot", 500: "Générale" };
const SUIT_NAMES = { pique: "Pique", coeur: "Cœur", carreau: "Carreau", trefle: "Trèfle", sa: "Sans Atout", ta: "Tout Atout" };
const SUIT_SYMBOLS = { pique: "♠", coeur: "♥", carreau: "♦", trefle: "♣", sa: "SA", ta: "TA" };
const RANK_NAMES = { V: "Valet", D: "Dame", R: "Roi", A: "As" };
const CARRE_VALUE = { V: 200, 9: 150, A: 100, 10: 100, R: 100, D: 100 };

// ------------------------------------------------------------------ options

function normalizeOptions(raw) {
  const o = raw || {};
  const target = parseInt(o.target, 10);
  return {
    scoring: o.scoring === "contrat" ? "contrat" : "points",
    target: [500, 1000, 2000].includes(target) ? target : 1000,
    atouts: o.atouts === "tous" ? "tous" : "couleurs",
    annonces: !(o.annonces === false || o.annonces === "false")
  };
}

// ------------------------------------------------------------------ cartes

const bidLabel = (value, trump) => `${VALUE_LABEL[value] || value} ${SUIT_SYMBOLS[trump]}`;
const cardLabel = (c) => `${RANK_NAMES[c.rank] || c.rank} ${SUIT_SYMBOLS[c.suit]}`;

// La couleur est-elle de l'atout pour ce contrat ?
function isTrumpSuit(trump, suit) {
  return trump === "ta" || trump === suit;
}

function cardPoints(c, trump) {
  if (trump === "sa") return PTS_SA[c.rank];
  if (trump === "ta") return PTS_TA[c.rank];
  return c.suit === trump ? PTS_TRUMP[c.rank] : PTS_PLAIN[c.rank];
}

function power(c, trump) {
  return isTrumpSuit(trump, c.suit) ? TRUMP_POWER[c.rank] : PLAIN_POWER[c.rank];
}

function buildDeck() {
  return buildStandardDeck().filter((c) => RANKS32.includes(c.rank));
}

// ------------------------------------------------------------------ utilitaires

function logEvent(state, entry) {
  state.eventSeq += 1;
  state.history.push({ id: state.eventSeq, at: Date.now(), donne: state.donne, ...entry });
  if (state.history.length > 4000) state.history.splice(0, state.history.length - 4000);
}

function seatAfter(state, id, k = 1) {
  const o = state.seatOrder;
  return o[(o.indexOf(id) + k) % o.length];
}
const teamOf = (state, id) => state.seatOrder.indexOf(id) % 2;
const partnerOf = (state, id) => seatAfter(state, id, 2);
const dealerId = (state) => state.seatOrder[state.dealerIdx % 4];

// ------------------------------------------------------------------ partie

function createGame(playerIds, rawOptions) {
  const seatOrder = shuffle(playerIds);
  const state = {
    id: "coinche",
    uid: crypto.randomBytes(5).toString("hex"),
    eventSeq: 0,
    history: [],
    options: normalizeOptions(rawOptions),
    seatOrder,
    donne: 0,
    dealerIdx: 3,
    scores: [0, 0],
    roundResults: [],
    lastResult: null,
    winnerTeam: null
  };
  startDonne(state);
  return state;
}

function startDonne(state) {
  state.donne += 1;
  state.dealerIdx = (state.dealerIdx + 1) % 4;
  deal(state);
}

function deal(state) {
  state.dealNo = (state.dealNo || 0) + 1;
  const deck = shuffle(buildDeck());
  const dealer = dealerId(state);
  state.hands = {};
  for (let p = 0; p < 4; p += 1) state.hands[seatAfter(state, dealer, p + 1)] = deck.slice(p * 8, p * 8 + 8);
  state.bids = []; // { playerId, bid: "passe" | "coinche" | "surcoinche" | { value, trump } }
  state.best = null; // { playerId, value, trump }
  state.passes = 0;
  state.coinche = 1;
  state.coincheBy = null;
  state.contract = null;
  state.trick = [];
  state.trickNumber = 0;
  state.trickWinner = null;
  state.trickWinners = [];
  state.lastTrick = null;
  state.wonCards = Object.fromEntries(state.seatOrder.map((id) => [id, []]));
  state.played = Object.fromEntries(state.seatOrder.map((id) => [id, 0]));
  state.annonces = {}; // id -> [{ kind, label, value, top, cards }]
  state.declared = {}; // id -> true une fois ses annonces faites
  state.belote = null; // { playerId, step }
  state.phase = "bidding";
  state.currentTurn = seatAfter(state, dealer, 1);
  logEvent(state, { type: "deal", dealerId: dealer });
}

// ------------------------------------------------------------------ encheres

function allowedTrumps(state) {
  return state.options.atouts === "tous" ? SUITS.concat(["sa", "ta"]) : SUITS.slice();
}

function minValue(state) {
  if (!state.best) return 80;
  const i = VALUES.indexOf(state.best.value);
  return VALUES[i + 1] || null;
}

function canCoinche(state, playerId) {
  return state.phase === "bidding" && state.currentTurn === playerId && !!state.best && teamOf(state, state.best.playerId) !== teamOf(state, playerId);
}

function doBid(state, playerId, action) {
  const bid = action.bid;
  if (state.phase === "surcoinche") {
    if (playerId !== state.best.playerId) return { ok: false, error: "C'est au preneur de décider." };
    if (bid !== "surcoinche" && bid !== "passe") return { ok: false, error: "Surcoinche ou passe." };
    if (bid === "surcoinche") state.coinche = 4;
    state.bids.push({ playerId, bid });
    logEvent(state, { type: "bid", playerId, bid, label: bid === "surcoinche" ? "Surcoinche !" : "Pas de surcoinche" });
    return closeBidding(state);
  }
  if (state.phase !== "bidding") return { ok: false, error: "Ce n'est pas le moment d'enchérir." };
  if (state.currentTurn !== playerId) return { ok: false, error: "Ce n'est pas ton tour de parler." };
  if (bid === "passe") {
    state.passes += 1;
    state.bids.push({ playerId, bid });
    logEvent(state, { type: "bid", playerId, bid, label: "Passe" });
    if (!state.best && state.passes >= 4) {
      logEvent(state, { type: "all_pass" });
      state.dealerIdx = (state.dealerIdx + 1) % 4;
      deal(state);
      return { ok: true };
    }
    if (state.best && state.passes >= 3) return closeBidding(state);
    state.currentTurn = seatAfter(state, playerId, 1);
    return { ok: true };
  }
  if (bid === "coinche") {
    if (!canCoinche(state, playerId)) return { ok: false, error: "On ne coinche que le contrat des adversaires." };
    state.coinche = 2;
    state.coincheBy = playerId;
    state.bids.push({ playerId, bid });
    logEvent(state, { type: "bid", playerId, bid, label: "Coinche !" });
    state.phase = "surcoinche";
    state.currentTurn = state.best.playerId;
    return { ok: true };
  }
  const value = parseInt(bid, 10);
  const trump = action.trump;
  if (!VALUES.includes(value)) return { ok: false, error: "Enchère inconnue." };
  if (!allowedTrumps(state).includes(trump)) return { ok: false, error: "Choisis une couleur d'atout." };
  const min = minValue(state);
  if (min === null || value < min) return { ok: false, error: `Il faut monter au-dessus de ${bidLabel(state.best.value, state.best.trump)}.` };
  state.best = { playerId, value, trump };
  state.passes = 0;
  state.bids.push({ playerId, bid: { value, trump } });
  logEvent(state, { type: "bid", playerId, bid: "contrat", value, trump, label: bidLabel(value, trump) });
  state.currentTurn = seatAfter(state, playerId, 1);
  return { ok: true };
}

function closeBidding(state) {
  const b = state.best;
  state.contract = { takerId: b.playerId, team: teamOf(state, b.playerId), value: b.value, trump: b.trump, mult: state.coinche };
  logEvent(state, { type: "taker", playerId: b.playerId, value: b.value, trump: b.trump, mult: state.coinche, label: bidLabel(b.value, b.trump) });
  state.phase = "playing";
  state.currentTurn = seatAfter(state, dealerId(state), 1);
  if (state.options.annonces) for (const id of state.seatOrder) state.annonces[id] = findAnnonces(state.hands[id]);
  return { ok: true };
}

// ------------------------------------------------------------------ annonces

// Suites (3 cartes et plus de la meme couleur) et carres d'une main.
function findAnnonces(hand) {
  const out = [];
  for (const suit of SUITS) {
    const idx = hand.filter((c) => c.suit === suit).map((c) => SEQ_ORDER[c.rank]).sort((a, b) => a - b);
    let run = [];
    const flush = () => {
      if (run.length >= 3) {
        const value = run.length >= 5 ? 100 : run.length === 4 ? 50 : 20;
        const label = run.length >= 5 ? "Cent" : run.length === 4 ? "Cinquante" : "Tierce";
        const cards = run.map((i) => hand.find((c) => c.suit === suit && SEQ_ORDER[c.rank] === i));
        out.push({ kind: "suite", label, value, top: run[run.length - 1], cards });
      }
    };
    for (const i of idx) {
      if (run.length && i !== run[run.length - 1] + 1) {
        flush();
        run = [];
      }
      run.push(i);
    }
    flush();
  }
  for (const rank of Object.keys(CARRE_VALUE)) {
    const cs = hand.filter((c) => c.rank === rank);
    if (cs.length === 4) out.push({ kind: "carre", label: `Carré de ${RANK_NAMES[rank] ? RANK_NAMES[rank] + "s" : rank}`, value: CARRE_VALUE[rank], top: 10 + SEQ_ORDER[rank], cards: cs });
  }
  return out;
}

// Meilleure annonce d'une equipe : valeur, puis hauteur ; carre > suite a
// valeur egale.
function bestAnnonce(list) {
  let best = null;
  for (const a of list) {
    if (!best || a.value > best.value || (a.value === best.value && a.top > best.top)) best = a;
  }
  return best;
}

// Equipe qui marque ses annonces (null : aucune, ou egalite parfaite).
function annonceWinner(state) {
  const per = [0, 1].map((t) => bestAnnonce(state.seatOrder.filter((id) => teamOf(state, id) === t).flatMap((id) => state.annonces[id] || [])));
  if (!per[0] && !per[1]) return null;
  if (!per[1]) return 0;
  if (!per[0]) return 1;
  if (per[0].value !== per[1].value) return per[0].value > per[1].value ? 0 : 1;
  if (per[0].top !== per[1].top) return per[0].top > per[1].top ? 0 : 1;
  return state.contract.team; // egalite parfaite : avantage au preneur
}

// ------------------------------------------------------------------ jeu de la carte

function trickWinnerOf(trick, trump) {
  const lead = trick[0].card.suit;
  let best = trick[0];
  for (const p of trick.slice(1)) {
    const c = p.card;
    const b = best.card;
    const cTrump = trump !== "sa" && trump !== "ta" && c.suit === trump;
    const bTrump = trump !== "sa" && trump !== "ta" && b.suit === trump;
    if (cTrump && !bTrump) best = p;
    else if (cTrump === bTrump && c.suit === b.suit && (c.suit === lead || cTrump) && power(c, trump) > power(b, trump)) best = p;
  }
  return best.playerId;
}

function legalCards(state, playerId) {
  const hand = state.hands[playerId] || [];
  const trick = state.trick;
  if (!trick.length) return hand;
  const trump = state.contract.trump;
  const lead = trick[0].card.suit;
  const follow = hand.filter((c) => c.suit === lead);
  if (follow.length) {
    // couleur d'atout demandee (ou Tout Atout) : il faut monter si on peut
    if (isTrumpSuit(trump, lead)) {
      const top = Math.max(...trick.filter((p) => p.card.suit === lead).map((p) => power(p.card, trump)));
      const over = follow.filter((c) => power(c, trump) > top);
      return over.length ? over : follow;
    }
    return follow;
  }
  if (trump === "sa" || trump === "ta") return hand;
  // partenaire maitre du pli : on joue ce qu'on veut
  const winner = trickWinnerOf(trick, trump);
  if (winner === partnerOf(state, playerId)) return hand;
  const trumps = hand.filter((c) => c.suit === trump);
  if (!trumps.length) return hand;
  const played = trick.filter((p) => p.card.suit === trump);
  if (!played.length) return trumps;
  const top = Math.max(...played.map((p) => power(p.card, trump)));
  const over = trumps.filter((c) => power(c, trump) > top);
  return over.length ? over : trumps; // sinon on sous-coupe
}

function illegalReason(state, playerId) {
  const trump = state.contract.trump;
  const lead = state.trick[0].card.suit;
  const hand = state.hands[playerId];
  if (hand.some((c) => c.suit === lead)) {
    return isTrumpSuit(trump, lead) ? `Tu dois fournir ${SUIT_SYMBOLS[lead]} et monter si tu peux.` : `Tu dois fournir : joue du ${SUIT_NAMES[lead]} ${SUIT_SYMBOLS[lead]}.`;
  }
  return state.trick.some((p) => p.card.suit === trump) ? "Tu dois couper plus haut si tu peux (sinon couper quand même)." : `Tu dois couper à l'atout ${SUIT_SYMBOLS[trump]}.`;
}

function doPlay(state, playerId, action) {
  if (state.phase === "trick_done") return { ok: false, error: "Le pli est en train d'être ramassé…" };
  if (state.phase !== "playing") return { ok: false, error: "Ce n'est pas le moment de jouer." };
  if (state.currentTurn !== playerId) return { ok: false, error: "Ce n'est pas ton tour." };
  const ids = Array.isArray(action.cardIds) ? action.cardIds : [];
  if (ids.length !== 1) return { ok: false, error: "Pose une seule carte." };
  const card = (state.hands[playerId] || []).find((c) => c.id === ids[0]);
  if (!card) return { ok: false, error: "Carte introuvable dans ta main." };
  if (!legalCards(state, playerId).includes(card)) return { ok: false, error: illegalReason(state, playerId) };
  const trump = state.contract.trump;
  // annonces : faites a sa premiere carte
  if (!state.declared[playerId]) {
    state.declared[playerId] = true;
    const list = state.annonces[playerId] || [];
    if (list.length) logEvent(state, { type: "annonce", playerId, items: list.map((a) => ({ label: a.label, value: a.value, cards: a.cards.map(cardPublicView) })) });
  }
  // belote puis rebelote
  if (SUITS.includes(trump) && card.suit === trump && (card.rank === "R" || card.rank === "D")) {
    const hand = state.hands[playerId];
    const other = card.rank === "R" ? "D" : "R";
    if (state.belote && state.belote.playerId === playerId) {
      state.belote.step = 2;
      logEvent(state, { type: "belote", playerId, step: 2 });
    } else if (hand.some((c) => c.suit === trump && c.rank === other)) {
      state.belote = { playerId, step: 1 };
      logEvent(state, { type: "belote", playerId, step: 1 });
    }
  }
  state.hands[playerId] = state.hands[playerId].filter((c) => c !== card);
  state.played[playerId] += 1;
  const lead = state.trick.length ? state.trick[0].card.suit : null;
  state.trick.push({ playerId, card });
  const cut = SUITS.includes(trump) && card.suit === trump && lead && lead !== trump;
  logEvent(state, { type: "play", playerId, rank: card.rank, suit: card.suit, cut: !!cut, trick: state.trickNumber + 1 });
  if (state.trick.length < 4) {
    state.currentTurn = seatAfter(state, playerId, 1);
    return { ok: true };
  }
  const winner = trickWinnerOf(state.trick, trump);
  state.trickWinner = winner;
  state.phase = "trick_done";
  state.currentTurn = null;
  state.trickNumber += 1;
  logEvent(state, { type: "trick_won", playerId: winner, number: state.trickNumber });
  return { ok: true, schedule: TRICK_PAUSE_MS };
}

function tick(state) {
  if (state.phase !== "trick_done") return { ok: false };
  const winner = state.trickWinner;
  state.wonCards[winner].push(...state.trick.map((p) => p.card));
  state.trickWinners.push(winner);
  state.lastTrick = { winner, cards: state.trick.map((p) => ({ playerId: p.playerId, card: p.card })) };
  state.trick = [];
  state.trickWinner = null;
  if (state.trickNumber >= 8) endDonne(state);
  else {
    state.phase = "playing";
    state.currentTurn = winner;
  }
  return { ok: true };
}

// ------------------------------------------------------------------ comptage

function endDonne(state) {
  const C = state.contract;
  const trump = C.trump;
  const atk = C.team;
  const def = 1 - atk;
  const pts = [0, 0];
  for (const id of state.seatOrder) pts[teamOf(state, id)] += state.wonCards[id].reduce((s, c) => s + cardPoints(c, trump), 0);
  const lastWinner = state.trickWinners[state.trickWinners.length - 1];
  pts[teamOf(state, lastWinner)] += 10; // dix de der
  const tricksBy = [0, 1].map((t) => state.trickWinners.filter((w) => teamOf(state, w) === t).length);
  const capot = tricksBy[atk] === 8 ? atk : tricksBy[def] === 8 ? def : null;
  if (capot !== null) pts[capot] = 250;
  const generale = state.trickWinners.every((w) => w === C.takerId);
  // annonces
  const annWinner = state.options.annonces ? annonceWinner(state) : null;
  const ann = [0, 0];
  if (annWinner !== null) {
    for (const id of state.seatOrder) {
      if (teamOf(state, id) === annWinner) ann[annWinner] += (state.annonces[id] || []).reduce((s, a) => s + a.value, 0);
    }
  }
  const bel = [0, 0];
  if (state.belote && state.belote.step === 2) bel[teamOf(state, state.belote.playerId)] = 20;
  let made;
  if (C.value === 500) made = generale;
  else if (C.value === 250) made = capot === atk;
  else made = pts[atk] + ann[atk] + bel[atk] >= C.value;

  const marks = [0, 0];
  const contractPts = C.value * C.mult;
  if (state.options.scoring === "contrat") {
    if (made) marks[atk] += contractPts;
    else marks[def] += 160 + contractPts;
  } else if (made) {
    if (C.mult > 1) marks[atk] += 160 + contractPts + ann[atk];
    else {
      marks[atk] += contractPts + pts[atk] + ann[atk];
      marks[def] += pts[def] + ann[def];
    }
  } else {
    marks[def] += 160 + contractPts + ann[0] + ann[1];
  }
  marks[0] += bel[0];
  marks[1] += bel[1];
  state.scores[0] += marks[0];
  state.scores[1] += marks[1];

  state.lastResult = {
    donne: state.donne,
    takerId: C.takerId,
    team: atk,
    value: C.value,
    trump,
    mult: C.mult,
    label: bidLabel(C.value, trump),
    points: pts,
    annonces: ann,
    belote: bel,
    capot,
    made,
    marks,
    totals: state.scores.slice()
  };
  state.roundResults.push(state.lastResult);
  const target = state.options.target;
  const over = state.scores.some((s) => s >= target) && state.scores[0] !== state.scores[1];
  if (over) state.winnerTeam = state.scores[0] > state.scores[1] ? 0 : 1;
  state.phase = over ? "finished" : "round_end";
  state.currentTurn = null;
  logEvent(state, { type: "round_end", made, team: atk, points: pts[atk] + ann[atk] + bel[atk], value: C.value, marks, last: over });
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
  state.phase = "finished";
  state.currentTurn = null;
  if (state.scores[0] !== state.scores[1]) state.winnerTeam = state.scores[0] > state.scores[1] ? 0 : 1;
  logEvent(state, { type: "end", byHost: true });
  return { ok: true };
}

function applyAction(state, playerId, action, ctx) {
  if (!state.seatOrder.includes(playerId)) return { ok: false, error: "Joueur inconnu dans cette partie." };
  switch (action.type) {
    case "bid": return doBid(state, playerId, action);
    case "play": return doPlay(state, playerId, action);
    case "next_round": return doNextRound(state, playerId, ctx);
    case "end_game": return doEnd(state, ctx);
    default: return { ok: false, error: `Action inconnue: ${action.type}` };
  }
}

// ------------------------------------------------------------------ vues

function namedHistory(events, name) {
  return events.map((e) => ({ ...e, playerName: e.playerId ? name(e.playerId) : undefined, dealerName: e.dealerId ? name(e.dealerId) : undefined }));
}

// Pendant une donne, seul le dernier pli termine (et le pli en cours) reste
// visible.
function visibleHistory(state) {
  const live = ["bidding", "surcoinche", "playing", "trick_done"].includes(state.phase);
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
  const myTeam = teamOf(state, playerId);
  const teamName = (t) => state.seatOrder.filter((id) => teamOf(state, id) === t).map(name).join(" & ");
  const C = state.contract;
  const lastBid = Object.fromEntries(state.seatOrder.map((id) => [id, null]));
  for (const b of state.bids) {
    lastBid[b.playerId] = b.bid === "passe" ? "Passe" : b.bid === "coinche" ? "Coinche !" : b.bid === "surcoinche" ? "Surcoinche !" : bidLabel(b.bid.value, b.bid.trump);
  }
  return {
    gameId: "coinche",
    uid: state.uid,
    lastEventId: state.eventSeq,
    phase: state.phase,
    donne: state.donne,
    dealNo: state.dealNo,
    options: state.options,
    seatOrder: state.seatOrder,
    dealerId: dealer,
    currentTurn: state.currentTurn,
    currentTurnName: state.currentTurn ? name(state.currentTurn) : "",
    hand: (state.hands[playerId] || []).map(cardPublicView),
    best: state.best ? { ...state.best, playerName: name(state.best.playerId), label: bidLabel(state.best.value, state.best.trump) } : null,
    coinche: state.coinche,
    coincheByName: state.coincheBy ? name(state.coincheBy) : "",
    contract: C ? { ...C, takerName: name(C.takerId), label: bidLabel(C.value, C.trump) } : null,
    trick: state.trick.map((p) => ({ playerId: p.playerId, playerName: name(p.playerId), card: cardPublicView(p.card) })),
    leadSuit: state.trick.length ? state.trick[0].card.suit : null,
    trickWinner: state.trickWinner,
    trickWinnerName: state.trickWinner ? name(state.trickWinner) : "",
    trickNumber: state.trickNumber,
    lastTrick: state.lastTrick ? { winner: state.lastTrick.winner, winnerName: name(state.lastTrick.winner), cards: state.lastTrick.cards.map((p) => ({ playerId: p.playerId, card: cardPublicView(p.card) })) } : null,
    belote: state.belote ? { playerId: state.belote.playerId, step: state.belote.step } : null,
    teams: [0, 1].map((t) => ({ team: t, name: teamName(t), score: state.scores[t], ids: state.seatOrder.filter((id) => teamOf(state, id) === t) })),
    scores: state.scores.slice(),
    winnerTeam: state.winnerTeam,
    players: state.seatOrder.map((id) => ({
      id,
      name: name(id),
      team: teamOf(state, id),
      isDealer: id === dealer,
      wonCards: state.wonCards[id].length,
      lastBid: lastBid[id]
    })),
    opponents: state.seatOrder.filter((id) => id !== playerId).map((id) => ({
      id,
      name: name(id),
      team: teamOf(state, id),
      partner: teamOf(state, id) === myTeam,
      cardCount: (state.hands[id] || []).length,
      isDealer: id === dealer,
      lastBid: lastBid[id],
      connected: players[id] ? players[id].connected !== false : false
    })),
    lastResult: state.lastResult,
    roundResults: state.roundResults,
    history: namedHistory(visibleHistory(state).slice(-40), name),
    you: {
      id: playerId,
      team: myTeam,
      partnerId: partnerOf(state, playerId),
      isYourTurn: state.currentTurn === playerId && ["bidding", "surcoinche", "playing"].includes(state.phase),
      mustBid: state.phase === "bidding" && state.currentTurn === playerId,
      mustSurcoinche: state.phase === "surcoinche" && state.currentTurn === playerId,
      canCoinche: canCoinche(state, playerId),
      minValue: state.phase === "bidding" ? minValue(state) : null,
      trumps: allowedTrumps(state),
      legalIds: myTurn ? legalCards(state, playerId).map((c) => c.id) : [],
      annonces: (state.annonces[playerId] || []).map((a) => ({ label: a.label, value: a.value })),
      isDealer: playerId === dealer,
      isFinished: false
    }
  };
}

module.exports = {
  id: "coinche",
  name: "La Coinche",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  createGame,
  applyAction,
  tick,
  getViewForPlayer,
  fullHistory,
  normalizeOptions,
  _internals: {
    legalCards, trickWinnerOf, cardPoints, power, isTrumpSuit, findAnnonces, annonceWinner, teamOf, partnerOf, seatAfter,
    minValue, canCoinche, allowedTrumps, VALUES, SUITS, endDonne, buildDeck
  }
};
