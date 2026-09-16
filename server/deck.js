// Utilitaires generiques pour un jeu de 52 cartes standard.
// Reutilisable par n'importe quel jeu (Menteur, President, futurs jeux...).

const SUITS = ["pique", "coeur", "carreau", "trefle"];
const SUIT_SYMBOLS = { pique: "♠", coeur: "♥", carreau: "♦", trefle: "♣" };
const SUIT_COLORS = { pique: "black", coeur: "red", carreau: "red", trefle: "black" };

// Ordre d'affichage standard. Le Menteur n'a pas besoin d'un ordre de force
// (aucune comparaison de valeur n'est utilisee dans ses regles), mais on le
// garde disponible pour les jeux qui en auront besoin (ex: President).
const RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R", "A", "2"];
const RANK_LABELS = {
  "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9", "10": "10",
  V: "Valet", D: "Dame", R: "Roi", A: "As", 2: "2"
};

let cardIdCounter = 0;

function buildStandardDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cardIdCounter += 1;
      deck.push({
        id: `c${cardIdCounter}_${rank}_${suit}`,
        rank,
        suit
      });
    }
  }
  return deck;
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Distribue l'integralite du paquet entre les joueurs, le plus equitablement
// possible (certains joueurs peuvent recevoir une carte de plus que d'autres).
function dealAll(deck, playerIds) {
  const hands = {};
  for (const id of playerIds) hands[id] = [];
  const shuffled = shuffle(deck);
  shuffled.forEach((card, index) => {
    const playerId = playerIds[index % playerIds.length];
    hands[playerId].push(card);
  });
  return hands;
}

function cardPublicView(card) {
  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit,
    symbol: SUIT_SYMBOLS[card.suit],
    color: SUIT_COLORS[card.suit],
    label: RANK_LABELS[card.rank]
  };
}

module.exports = {
  SUITS,
  SUIT_SYMBOLS,
  SUIT_COLORS,
  RANKS,
  RANK_LABELS,
  buildStandardDeck,
  shuffle,
  dealAll,
  cardPublicView
};
