// Evaluation des mains de poker (meilleure main de 5 cartes parmi 7).
// Renvoie un score comparable (tableau : categorie puis departages), le
// nom francais de la main et les 5 cartes qui la composent.

const VALUE = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, V: 11, D: 12, R: 13, A: 14 };
const SING = { 11: "Valet", 12: "Dame", 13: "Roi", 14: "As" };
const PLUR = { 11: "Valets", 12: "Dames", 13: "Rois", 14: "As" };
const sing = (v) => SING[v] || String(v);
const plur = (v) => PLUR[v] || String(v);
const de = (v) => (v === 14 ? "d'As" : `de ${plur(v)}`);

function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Score d'une main de exactement 5 cartes.
function eval5(cards) {
  const vals = cards.map((c) => VALUE[c.rank]).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals[0] === 14 && vals[1] === 5) straightHigh = 5; // A-2-3-4-5
  }
  const counts = {};
  vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  const groups = Object.entries(counts).map(([v, n]) => [n, Number(v)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...vals];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, groups[0][1], ...groups.slice(1).map((g) => g[1])];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, groups[0][1], groups[1][1], groups[2][1]];
  if (groups[0][0] === 2) return [1, groups[0][1], ...groups.slice(1).map((g) => g[1])];
  return [0, ...vals];
}

function handName(score) {
  const [cat, a, b] = score;
  switch (cat) {
    case 8: return a === 14 ? "Quinte flush royale" : `Quinte flush hauteur ${sing(a)}`;
    case 7: return `Carré ${de(a)}`;
    case 6: return `Full aux ${plur(a)} par les ${plur(b)}`;
    case 5: return `Couleur hauteur ${sing(a)}`;
    case 4: return `Quinte hauteur ${sing(a)}`;
    case 3: return `Brelan ${de(a)}`;
    case 2: return `Double paire, ${plur(a)} et ${plur(b)}`;
    case 1: return `Paire ${de(a)}`;
    default: return `Hauteur ${sing(a)}`;
  }
}

// Meilleure main parmi 5 a 7 cartes.
function bestHand(cards) {
  let best = null;
  const n = cards.length;
  const pick = [];
  const rec = (start) => {
    if (pick.length === 5) {
      const hand = pick.map((i) => cards[i]);
      const score = eval5(hand);
      if (!best || compare(score, best.score) > 0) best = { score, cards: hand };
      return;
    }
    for (let i = start; i <= n - (5 - pick.length); i += 1) {
      pick.push(i);
      rec(i + 1);
      pick.pop();
    }
  };
  if (n >= 5) rec(0);
  if (!best) return null;
  return { score: best.score, cards: best.cards, name: handName(best.score) };
}

// Main partielle (avant le flop / moins de 5 cartes) : categorie simple.
function partialName(cards) {
  if (cards.length >= 5) return bestHand(cards).name;
  const vals = cards.map((c) => VALUE[c.rank]).sort((a, b) => b - a);
  const counts = {};
  vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  const g = Object.entries(counts).map(([v, k]) => [k, Number(v)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  if (g[0][0] === 3) return `Brelan ${de(g[0][1])}`;
  if (g[0][0] === 2 && g[1] && g[1][0] === 2) return `Double paire, ${plur(g[0][1])} et ${plur(g[1][1])}`;
  if (g[0][0] === 2) return `Paire ${de(g[0][1])}`;
  return `Hauteur ${sing(vals[0])}`;
}

module.exports = { VALUE, compare, eval5, bestHand, handName, partialName };
