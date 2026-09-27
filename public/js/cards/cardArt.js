// Generateur procedural des cartes (canvas 2D) : faces illustrees et dos.
// Toutes les illustrations sont dessinees ici, aucune image externe.

export const CARD_W = 360;
export const CARD_H = 504;
export const CARD_RADIUS = 26;

export const RANK_ORDER = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R"];
export const RANK_NAMES = {
  A: ["As", "As"], 2: ["2", "2"], 3: ["3", "3"], 4: ["4", "4"], 5: ["5", "5"], 6: ["6", "6"],
  7: ["7", "7"], 8: ["8", "8"], 9: ["9", "9"], 10: ["10", "10"],
  V: ["Valet", "Valets"], D: ["Dame", "Dames"], R: ["Roi", "Rois"]
};

const INK = "#1d1a1f";
const RED = "#b3202a";
const GOLD = "#c9962b";
const GOLD_LIGHT = "#ecc767";
const BLUE = "#27458f";
const SKIN = "#f3d0aa";
const PAPER_A = "#fffaf0";
const PAPER_B = "#f0e4c8";

export const SUIT_COLOR = { coeur: RED, carreau: RED, pique: INK, trefle: INK };
const INDEX_FONT = '"Playfair Display", Georgia, "Times New Roman", serif';

export async function ensureCardFonts() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all([
      document.fonts.load(`900 60px "Playfair Display"`),
      document.fonts.load(`700 30px "Playfair Display"`)
    ]);
  } catch (e) { /* on retombe sur Georgia */ }
}

// ---------------------------------------------------------------- helpers

export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s % 100000) / 100000;
  };
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- symboles

// Chaque symbole est trace dans une boite unitaire centree [-0.5, 0.5].
function suitPath(ctx, suit) {
  ctx.beginPath();
  if (suit === "coeur") {
    ctx.moveTo(0, 0.44);
    ctx.bezierCurveTo(-0.14, 0.30, -0.5, 0.08, -0.5, -0.17);
    ctx.bezierCurveTo(-0.5, -0.38, -0.33, -0.48, -0.22, -0.48);
    ctx.bezierCurveTo(-0.1, -0.48, -0.02, -0.4, 0, -0.29);
    ctx.bezierCurveTo(0.02, -0.4, 0.1, -0.48, 0.22, -0.48);
    ctx.bezierCurveTo(0.33, -0.48, 0.5, -0.38, 0.5, -0.17);
    ctx.bezierCurveTo(0.5, 0.08, 0.14, 0.30, 0, 0.44);
  } else if (suit === "carreau") {
    ctx.moveTo(0, -0.5);
    ctx.quadraticCurveTo(0.14, -0.2, 0.38, 0);
    ctx.quadraticCurveTo(0.14, 0.2, 0, 0.5);
    ctx.quadraticCurveTo(-0.14, 0.2, -0.38, 0);
    ctx.quadraticCurveTo(-0.14, -0.2, 0, -0.5);
  } else if (suit === "pique") {
    ctx.moveTo(0, -0.5);
    ctx.bezierCurveTo(0.1, -0.34, 0.5, -0.14, 0.5, 0.1);
    ctx.bezierCurveTo(0.5, 0.3, 0.33, 0.37, 0.23, 0.37);
    ctx.bezierCurveTo(0.13, 0.37, 0.06, 0.31, 0.035, 0.25);
    ctx.bezierCurveTo(0.05, 0.38, 0.12, 0.46, 0.22, 0.5);
    ctx.lineTo(-0.22, 0.5);
    ctx.bezierCurveTo(-0.12, 0.46, -0.05, 0.38, -0.035, 0.25);
    ctx.bezierCurveTo(-0.06, 0.31, -0.13, 0.37, -0.23, 0.37);
    ctx.bezierCurveTo(-0.33, 0.37, -0.5, 0.3, -0.5, 0.1);
    ctx.bezierCurveTo(-0.5, -0.14, -0.1, -0.34, 0, -0.5);
  } else {
    // trefle : trois lobes + tige evasee
    const r = 0.205;
    ctx.moveTo(0 + r, -0.27);
    ctx.arc(0, -0.27, r, 0, Math.PI * 2);
    ctx.moveTo(-0.25 + r, 0.07);
    ctx.arc(-0.25, 0.07, r, 0, Math.PI * 2);
    ctx.moveTo(0.25 + r, 0.07);
    ctx.arc(0.25, 0.07, r, 0, Math.PI * 2);
    ctx.moveTo(-0.12, -0.08);
    ctx.lineTo(0.12, -0.08);
    ctx.lineTo(0.12, 0.12);
    ctx.lineTo(-0.12, 0.12);
    ctx.closePath();
    ctx.moveTo(0.04, 0.05);
    ctx.bezierCurveTo(0.05, 0.3, 0.12, 0.44, 0.22, 0.5);
    ctx.lineTo(-0.22, 0.5);
    ctx.bezierCurveTo(-0.12, 0.44, -0.05, 0.3, -0.04, 0.05);
    ctx.closePath();
  }
}

export function drawSuit(ctx, suit, x, y, size, rot = 0, color = null, opts = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(size, size);
  suitPath(ctx, suit);
  const base = color || SUIT_COLOR[suit];
  if (opts.gradient !== false) {
    const g = ctx.createLinearGradient(-0.4, -0.5, 0.4, 0.5);
    if (base === RED) {
      g.addColorStop(0, "#d6353c");
      g.addColorStop(1, "#8f1219");
    } else if (base === INK) {
      g.addColorStop(0, "#3a3640");
      g.addColorStop(1, "#0d0b10");
    } else {
      g.addColorStop(0, base);
      g.addColorStop(1, base);
    }
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = base;
  }
  ctx.fill("nonzero");
  if (opts.shine !== false && size > 24) {
    // petit reflet pour donner du volume
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(-0.16, -0.22, 0.16, 0.09, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (opts.outline) {
    ctx.lineWidth = opts.outline / size;
    ctx.strokeStyle = opts.outlineColor || GOLD;
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- fond papier

function paper(ctx, W, H, seed) {
  roundRectPath(ctx, 0, 0, W, H, CARD_RADIUS * (W / CARD_W));
  const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, PAPER_A);
  g.addColorStop(1, PAPER_B);
  ctx.fillStyle = g;
  ctx.fill();

  // grain du papier
  ctx.save();
  ctx.clip();
  const rnd = seeded(seed);
  for (let i = 0; i < 900; i += 1) {
    ctx.globalAlpha = 0.025 + rnd() * 0.035;
    ctx.fillStyle = rnd() > 0.5 ? "#8a6a3a" : "#ffffff";
    ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  ctx.globalAlpha = 1;
  // vignettage leger
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(90,60,20,0.16)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  roundRectPath(ctx, 1.5, 1.5, W - 3, H - 3, CARD_RADIUS - 1.5);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(60,40,20,0.35)";
  ctx.stroke();
}

// ---------------------------------------------------------------- index

function drawIndex(ctx, card, W, H) {
  const color = SUIT_COLOR[card.suit];
  const draw = () => {
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    // index agrandi : lisible meme sur les cartes posees au loin (telephone)
    const isTen = card.rank === "10";
    const fs = isTen ? 70 : 82;
    ctx.font = `900 ${fs}px ${INDEX_FONT}`;
    ctx.translate(35, 80);
    if (isTen) ctx.scale(0.7, 1);
    ctx.fillText(card.rank, 0, 0);
    ctx.restore();
    drawSuit(ctx, card.suit, 35, 124, 52, 0, null, { shine: false });
  };
  draw();
  ctx.save();
  ctx.translate(W, H);
  ctx.rotate(Math.PI);
  draw();
  ctx.restore();
}

// ---------------------------------------------------------------- pips 2-10

const PIPS = {
  2: [[0.5, 0.2], [0.5, 0.8]],
  3: [[0.5, 0.2], [0.5, 0.5], [0.5, 0.8]],
  4: [[0.3, 0.2], [0.7, 0.2], [0.3, 0.8], [0.7, 0.8]],
  5: [[0.3, 0.2], [0.7, 0.2], [0.5, 0.5], [0.3, 0.8], [0.7, 0.8]],
  6: [[0.3, 0.2], [0.7, 0.2], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
  7: [[0.3, 0.2], [0.7, 0.2], [0.5, 0.35], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
  8: [[0.3, 0.2], [0.7, 0.2], [0.5, 0.35], [0.3, 0.5], [0.7, 0.5], [0.5, 0.65], [0.3, 0.8], [0.7, 0.8]],
  9: [[0.3, 0.2], [0.7, 0.2], [0.3, 0.4], [0.7, 0.4], [0.5, 0.5], [0.3, 0.6], [0.7, 0.6], [0.3, 0.8], [0.7, 0.8]],
  10: [[0.3, 0.2], [0.7, 0.2], [0.5, 0.3], [0.3, 0.4], [0.7, 0.4], [0.3, 0.6], [0.7, 0.6], [0.5, 0.7], [0.3, 0.8], [0.7, 0.8]]
};

function drawPips(ctx, card, W, H) {
  const n = Number(card.rank);
  const layout = PIPS[n];
  const size = n <= 3 ? 70 : n <= 8 ? 64 : 58;
  const x0 = W * 0.2;
  const x1 = W * 0.8;
  const y0 = H * 0.09;
  const y1 = H * 0.91;
  for (const [fx, fy] of layout) {
    const x = x0 + (x1 - x0) * fx;
    const y = y0 + (y1 - y0) * fy;
    const flip = fy > 0.52;
    ctx.save();
    ctx.shadowColor = "rgba(60,30,0,0.25)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1.5;
    drawSuit(ctx, card.suit, x, y, size, flip ? Math.PI : 0);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- As

function flourish(ctx, x, y, s, flipX) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flipX ? -s : s, s);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(0.3, -0.35, 0.8, -0.2, 0.75, 0.15);
  ctx.bezierCurveTo(0.7, 0.45, 0.35, 0.4, 0.4, 0.15);
  ctx.bezierCurveTo(0.45, -0.02, 0.62, 0.02, 0.58, 0.16);
  ctx.lineWidth = 0.06;
  ctx.strokeStyle = GOLD;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

function drawAce(ctx, card, W, H) {
  const cx = W / 2;
  const cy = H / 2;
  const special = card.suit === "pique";

  // medaillon dore
  ctx.save();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, W * 0.34, H * 0.27, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, W * 0.36, H * 0.285, 0, 0, Math.PI * 2);
  ctx.stroke();
  // perles autour
  for (let i = 0; i < 36; i += 1) {
    const a = (i / 36) * Math.PI * 2;
    ctx.fillStyle = i % 2 ? GOLD : GOLD_LIGHT;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * W * 0.35, cy + Math.sin(a) * H * 0.2775, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  flourish(ctx, cx + 8, cy - H * 0.3, 44, false);
  flourish(ctx, cx - 8, cy - H * 0.3, 44, true);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI);
  flourish(ctx, 8, -H * 0.3, 44, false);
  flourish(ctx, -8, -H * 0.3, 44, true);
  ctx.restore();

  const size = special ? 190 : 150;
  ctx.save();
  ctx.shadowColor = "rgba(60,30,0,0.35)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  drawSuit(ctx, card.suit, cx, cy, size, 0, null, special ? { outline: 5, outlineColor: GOLD } : {});
  ctx.restore();

  if (special) {
    // l'as de pique porte la signature du jeu
    ctx.save();
    ctx.translate(cx, cy + 128);
    ctx.fillStyle = "#6e1b26";
    ctx.beginPath();
    ctx.moveTo(-92, -16);
    ctx.lineTo(92, -16);
    ctx.lineTo(80, 0);
    ctx.lineTo(92, 16);
    ctx.lineTo(-92, 16);
    ctx.lineTo(-80, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = `700 18px ${INDEX_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LE CARRÉ", 0, 1);
    ctx.restore();

    // arabesque dans le pique
    ctx.save();
    ctx.translate(cx, cy - 10);
    ctx.strokeStyle = GOLD_LIGHT;
    ctx.lineWidth = 2.2;
    ctx.globalAlpha = 0.85;
    for (const dir of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(0, 30);
      ctx.bezierCurveTo(dir * 10, 0, dir * 40, -10, dir * 36, 18);
      ctx.bezierCurveTo(dir * 32, 36, dir * 16, 30, dir * 20, 18);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- figures

const FIGURE_PALETTES = {
  coeur: { main: RED, second: GOLD_LIGHT, third: BLUE, hair: "#b8742f", queenHair: "#dba443" },
  carreau: { main: "#d9892a", second: RED, third: BLUE, hair: "#6b3e1e", queenHair: "#a4532b" },
  trefle: { main: BLUE, second: RED, third: GOLD_LIGHT, hair: "#3b2416", queenHair: "#c98b3a" },
  pique: { main: "#27264a", second: GOLD_LIGHT, third: RED, hair: "#1e1a1a", queenHair: "#7b4526" }
};

function outline(ctx, w = 2.4) {
  ctx.lineWidth = w;
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawEye(ctx, x, y, flip) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-6.5, 0);
  ctx.quadraticCurveTo(0, -5.5, 6.5, 0);
  ctx.quadraticCurveTo(0, 4, -6.5, 0);
  ctx.fillStyle = "#fffdf6";
  ctx.fill();
  outline(ctx, 1.4);
  ctx.beginPath();
  ctx.arc(flip ? -0.8 : 0.8, -0.3, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = "#2b2016";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(flip ? -0.2 : 1.6, -1.2, 0.8, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.restore();
}

function drawFace(ctx, hx, hy, kind, pal) {
  // cou
  ctx.beginPath();
  ctx.rect(hx - 10, hy + 20, 20, 22);
  ctx.fillStyle = SKIN;
  ctx.fill();
  outline(ctx, 1.6);

  // dame : chignon + deux meches laterales (jamais sous le menton)
  if (kind === "D") {
    ctx.beginPath();
    ctx.arc(hx, hy - 30, 15, 0, Math.PI * 2);
    ctx.fillStyle = pal.queenHair;
    ctx.fill();
    outline(ctx, 1.6);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx + s * 22, hy - 16);
      ctx.bezierCurveTo(hx + s * 36, hy - 4, hx + s * 38, hy + 26, hx + s * 34, hy + 48);
      ctx.bezierCurveTo(hx + s * 30, hy + 56, hx + s * 24, hy + 54, hx + s * 24, hy + 44);
      ctx.bezierCurveTo(hx + s * 28, hy + 24, hx + s * 26, hy + 6, hx + s * 20, hy - 4);
      ctx.closePath();
      ctx.fillStyle = pal.queenHair;
      ctx.fill();
      outline(ctx, 1.6);
      ctx.beginPath();
      ctx.moveTo(hx + s * 27, hy);
      ctx.bezierCurveTo(hx + s * 33, hy + 18, hx + s * 32, hy + 34, hx + s * 29, hy + 48);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.stroke();
    }
  }

  // visage
  ctx.beginPath();
  ctx.ellipse(hx, hy, 25, 30, 0, 0, Math.PI * 2);
  const fg = ctx.createRadialGradient(hx - 6, hy - 8, 4, hx, hy, 34);
  fg.addColorStop(0, "#f8dcbc");
  fg.addColorStop(1, "#e2b286");
  ctx.fillStyle = fg;
  ctx.fill();
  outline(ctx, 2);

  // joues
  ctx.fillStyle = "rgba(220,90,80,0.28)";
  ctx.beginPath();
  ctx.ellipse(hx - 14, hy + 9, 6, 4, 0, 0, Math.PI * 2);
  ctx.ellipse(hx + 14, hy + 9, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // yeux + sourcils
  drawEye(ctx, hx - 10, hy - 3, false);
  drawEye(ctx, hx + 10, hy - 3, true);
  ctx.beginPath();
  ctx.moveTo(hx - 17, hy - 11);
  ctx.quadraticCurveTo(hx - 10, hy - 16, hx - 4, hy - 12);
  ctx.moveTo(hx + 17, hy - 11);
  ctx.quadraticCurveTo(hx + 10, hy - 16, hx + 4, hy - 12);
  outline(ctx, 1.8);

  // nez
  ctx.beginPath();
  ctx.moveTo(hx - 1, hy - 4);
  ctx.quadraticCurveTo(hx - 5, hy + 7, hx - 2, hy + 9);
  ctx.quadraticCurveTo(hx + 2, hy + 10, hx + 4, hy + 8);
  outline(ctx, 1.5);

  // bouche
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy + 16);
  ctx.quadraticCurveTo(hx, hy + (kind === "D" ? 21 : 19), hx + 7, hy + 16);
  if (kind === "D") {
    ctx.quadraticCurveTo(hx, hy + 13, hx - 7, hy + 16);
    ctx.fillStyle = "#c43a45";
    ctx.fill();
  }
  outline(ctx, 1.4);

  if (kind === "R") {
    // barbe et moustache royales
    ctx.beginPath();
    ctx.moveTo(hx - 25, hy + 2);
    ctx.bezierCurveTo(hx - 26, hy + 30, hx - 16, hy + 50, hx, hy + 56);
    ctx.bezierCurveTo(hx + 16, hy + 50, hx + 26, hy + 30, hx + 25, hy + 2);
    ctx.bezierCurveTo(hx + 18, hy + 20, hx + 10, hy + 24, hx, hy + 24);
    ctx.bezierCurveTo(hx - 10, hy + 24, hx - 18, hy + 20, hx - 25, hy + 2);
    ctx.fillStyle = "#ece6da";
    ctx.fill();
    outline(ctx, 1.8);
    ctx.strokeStyle = "rgba(90,80,70,0.55)";
    ctx.lineWidth = 1.2;
    for (let i = -3; i <= 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(hx + i * 5, hy + 26);
      ctx.quadraticCurveTo(hx + i * 6, hy + 40, hx + i * 3, hy + 52);
      ctx.stroke();
    }
    // moustache
    ctx.beginPath();
    ctx.moveTo(hx, hy + 12);
    ctx.bezierCurveTo(hx - 8, hy + 9, hx - 18, hy + 12, hx - 22, hy + 20);
    ctx.bezierCurveTo(hx - 14, hy + 17, hx - 6, hy + 17, hx, hy + 15);
    ctx.bezierCurveTo(hx + 6, hy + 17, hx + 14, hy + 17, hx + 22, hy + 20);
    ctx.bezierCurveTo(hx + 18, hy + 12, hx + 8, hy + 9, hx, hy + 12);
    ctx.fillStyle = "#e7e0d2";
    ctx.fill();
    outline(ctx, 1.5);
    // cheveux lateraux
    ctx.fillStyle = "#ece6da";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx + s * 22, hy - 18);
      ctx.bezierCurveTo(hx + s * 34, hy - 10, hx + s * 34, hy + 6, hx + s * 26, hy + 8);
      ctx.bezierCurveTo(hx + s * 26, hy - 2, hx + s * 24, hy - 10, hx + s * 22, hy - 18);
      ctx.fill();
      outline(ctx, 1.5);
    }
  } else if (kind === "V") {
    // coupe au bol avec frange + petite moustache
    ctx.beginPath();
    ctx.moveTo(hx - 27, hy + 6);
    ctx.bezierCurveTo(hx - 32, hy - 30, hx + 32, hy - 30, hx + 27, hy + 6);
    ctx.bezierCurveTo(hx + 20, hy - 2, hx + 18, hy - 12, hx + 12, hy - 14);
    ctx.bezierCurveTo(hx + 4, hy - 10, hx - 4, hy - 10, hx - 12, hy - 14);
    ctx.bezierCurveTo(hx - 18, hy - 12, hx - 20, hy - 2, hx - 27, hy + 6);
    ctx.fillStyle = pal.hair;
    ctx.fill();
    outline(ctx, 1.8);
    ctx.beginPath();
    ctx.moveTo(hx - 9, hy + 13);
    ctx.quadraticCurveTo(hx, hy + 9, hx + 9, hy + 13);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = pal.hair;
    ctx.stroke();
  } else {
    // dame : cheveux separes au milieu
    ctx.beginPath();
    ctx.moveTo(hx - 26, hy + 2);
    ctx.bezierCurveTo(hx - 30, hy - 30, hx + 30, hy - 30, hx + 26, hy + 2);
    ctx.bezierCurveTo(hx + 18, hy - 16, hx + 6, hy - 18, hx, hy - 14);
    ctx.bezierCurveTo(hx - 6, hy - 18, hx - 18, hy - 16, hx - 26, hy + 2);
    ctx.fillStyle = pal.queenHair;
    ctx.fill();
    outline(ctx, 1.8);
  }
}

function drawCrown(ctx, hx, hy, kind, pal) {
  if (kind === "R") {
    const top = hy - 66;
    const base = hy - 24;
    ctx.beginPath();
    ctx.moveTo(hx - 28, base);
    ctx.lineTo(hx - 30, top + 14);
    ctx.lineTo(hx - 18, top + 26);
    ctx.lineTo(hx - 10, top + 2);
    ctx.lineTo(hx, top + 22);
    ctx.lineTo(hx + 10, top + 2);
    ctx.lineTo(hx + 18, top + 26);
    ctx.lineTo(hx + 30, top + 14);
    ctx.lineTo(hx + 28, base);
    ctx.closePath();
    const g = ctx.createLinearGradient(hx - 30, top, hx + 30, base);
    g.addColorStop(0, "#f7dc7c");
    g.addColorStop(0.5, GOLD);
    g.addColorStop(1, "#8f6517");
    ctx.fillStyle = g;
    ctx.fill();
    outline(ctx, 2);
    // bandeau et joyaux
    ctx.beginPath();
    ctx.rect(hx - 29, base - 11, 58, 11);
    ctx.fillStyle = pal.second === GOLD_LIGHT ? RED : pal.main;
    ctx.fill();
    outline(ctx, 1.5);
    for (const [dx, c] of [[-16, BLUE], [0, "#2f8a4a"], [16, BLUE]]) {
      ctx.beginPath();
      ctx.arc(hx + dx, base - 5.5, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
      outline(ctx, 1);
    }
    for (const [dx, dy] of [[-30, 14], [-10, 2], [10, 2], [30, 14]]) {
      ctx.beginPath();
      ctx.arc(hx + dx, top + dy - 3, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = "#fff4cf";
      ctx.fill();
      outline(ctx, 1.2);
    }
  } else if (kind === "D") {
    const base = hy - 25;
    ctx.beginPath();
    ctx.moveTo(hx - 22, base);
    ctx.quadraticCurveTo(hx - 20, base - 20, hx - 8, base - 16);
    ctx.quadraticCurveTo(hx, base - 34, hx + 8, base - 16);
    ctx.quadraticCurveTo(hx + 20, base - 20, hx + 22, base);
    ctx.closePath();
    const g = ctx.createLinearGradient(hx, base - 34, hx, base);
    g.addColorStop(0, "#f7dc7c");
    g.addColorStop(1, "#9c6f1c");
    ctx.fillStyle = g;
    ctx.fill();
    outline(ctx, 1.8);
    ctx.beginPath();
    ctx.arc(hx, base - 13, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = RED;
    ctx.fill();
    outline(ctx, 1.1);
    for (const dx of [-12, 12]) {
      ctx.beginPath();
      ctx.arc(hx + dx, base - 7, 2.8, 0, Math.PI * 2);
      ctx.fillStyle = "#fff4cf";
      ctx.fill();
      outline(ctx, 1);
    }
  } else {
    // valet : beret a plume
    ctx.beginPath();
    ctx.ellipse(hx + 2, hy - 26, 34, 12, -0.12, 0, Math.PI * 2);
    ctx.fillStyle = pal.second === GOLD_LIGHT ? RED : pal.second;
    ctx.fill();
    outline(ctx, 2);
    ctx.beginPath();
    ctx.ellipse(hx - 2, hy - 20, 26, 5, -0.05, 0, Math.PI);
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fill();
    outline(ctx, 1.4);
    // plume
    ctx.beginPath();
    ctx.moveTo(hx + 22, hy - 32);
    ctx.bezierCurveTo(hx + 44, hy - 58, hx + 62, hy - 62, hx + 70, hy - 76);
    ctx.bezierCurveTo(hx + 58, hy - 52, hx + 44, hy - 40, hx + 26, hy - 28);
    ctx.closePath();
    ctx.fillStyle = "#f6f1e3";
    ctx.fill();
    outline(ctx, 1.5);
    ctx.beginPath();
    ctx.moveTo(hx + 24, hy - 30);
    ctx.quadraticCurveTo(hx + 50, hy - 52, hx + 70, hy - 76);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function robePath(ctx, fh, hx) {
  const ny = fh * 0.585;
  ctx.beginPath();
  ctx.moveTo(hx - 20, ny);
  ctx.bezierCurveTo(hx - 44, ny + 1, hx - 66, ny + 6, hx - 76, ny + 24);
  ctx.bezierCurveTo(hx - 82, ny + 40, hx - 84, fh - 20, hx - 86, fh + 4);
  ctx.lineTo(hx + 86, fh + 4);
  ctx.bezierCurveTo(hx + 84, fh - 20, hx + 82, ny + 40, hx + 76, ny + 24);
  ctx.bezierCurveTo(hx + 66, ny + 6, hx + 44, ny + 1, hx + 20, ny);
  ctx.closePath();
}

function drawSleeve(ctx, x1, y1, x2, y2, width, color, trim) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const nx = -Math.sin(a) * width / 2;
  const ny = Math.cos(a) * width / 2;
  ctx.beginPath();
  ctx.moveTo(x1 + nx, y1 + ny);
  ctx.lineTo(x2 + nx * 0.8, y2 + ny * 0.8);
  ctx.lineTo(x2 - nx * 0.8, y2 - ny * 0.8);
  ctx.lineTo(x1 - nx, y1 - ny);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  outline(ctx, 1.8);
  // manchette doree
  ctx.beginPath();
  ctx.moveTo(x2 + nx * 0.85 - Math.cos(a) * 8, y2 + ny * 0.85 - Math.sin(a) * 8);
  ctx.lineTo(x2 + nx * 0.8, y2 + ny * 0.8);
  ctx.lineTo(x2 - nx * 0.8, y2 - ny * 0.8);
  ctx.lineTo(x2 - nx * 0.85 - Math.cos(a) * 8, y2 - ny * 0.85 - Math.sin(a) * 8);
  ctx.closePath();
  ctx.fillStyle = trim;
  ctx.fill();
  outline(ctx, 1.3);
}

function drawRobe(ctx, fw, fh, hx, kind, pal, suit) {
  // silhouette
  ctx.save();
  robePath(ctx, fh, hx);
  ctx.fillStyle = pal.main;
  ctx.fill();
  ctx.save();
  ctx.clip();

  // motif de brocart
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = pal.second;
  for (let y = fh * 0.6; y < fh + 10; y += 16) {
    for (let x = ((y / 16) % 2) * 9; x < fw; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 4, y);
      ctx.lineTo(x, y + 4);
      ctx.lineTo(x - 4, y);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // plastron central
  ctx.beginPath();
  ctx.rect(hx - 20, fh * 0.6, 40, fh * 0.45);
  ctx.fillStyle = pal.third;
  ctx.fill();
  outline(ctx, 1.6);
  ctx.strokeStyle = GOLD_LIGHT;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(hx - 16, fh * 0.6);
  ctx.lineTo(hx - 16, fh + 4);
  ctx.moveTo(hx + 16, fh * 0.6);
  ctx.lineTo(hx + 16, fh + 4);
  ctx.stroke();
  for (let y = fh * 0.7; y < fh; y += 18) {
    ctx.beginPath();
    ctx.arc(hx, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fill();
    outline(ctx, 1);
  }
  // petit symbole sur le plastron
  drawSuit(ctx, suit, hx, fh * 0.92, 18, 0, suit === "coeur" || suit === "carreau" ? RED : INK, { shine: false });

  // col
  if (kind === "R") {
    // cape d'hermine
    ctx.beginPath();
    ctx.moveTo(fw * 0.04, fh * 0.76);
    ctx.bezierCurveTo(fw * 0.2, fh * 0.62, hx - 24, fh * 0.6, hx - 18, fh * 0.64);
    ctx.bezierCurveTo(hx - 10, fh * 0.76, hx + 10, fh * 0.76, hx + 18, fh * 0.64);
    ctx.bezierCurveTo(hx + 24, fh * 0.6, fw * 0.8, fh * 0.62, fw * 0.96, fh * 0.74);
    ctx.lineTo(fw * 0.96, fh * 0.84);
    ctx.bezierCurveTo(fw * 0.7, fh * 0.76, hx + 30, fh * 0.8, hx, fh * 0.86);
    ctx.bezierCurveTo(hx - 30, fh * 0.8, fw * 0.2, fh * 0.78, fw * 0.04, fh * 0.86);
    ctx.closePath();
    ctx.fillStyle = "#f8f4ea";
    ctx.fill();
    outline(ctx, 1.6);
    ctx.fillStyle = INK;
    for (const [px, py] of [[0.14, 0.78], [0.3, 0.72], [0.66, 0.72], [0.82, 0.77], [0.22, 0.81], [0.74, 0.81]]) {
      ctx.beginPath();
      ctx.moveTo(fw * px, fh * py - 4);
      ctx.lineTo(fw * px + 2.5, fh * py + 3);
      ctx.lineTo(fw * px - 2.5, fh * py + 3);
      ctx.fill();
    }
  } else if (kind === "D") {
    // col de dentelle
    ctx.beginPath();
    const y = fh * 0.62;
    ctx.moveTo(hx - 46, y);
    for (let i = 0; i <= 8; i += 1) {
      const x = hx - 46 + (92 * i) / 8;
      ctx.quadraticCurveTo(x - 5.75, y + 14, x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "#fbf3dc";
    ctx.fill();
    outline(ctx, 1.4);
    // collier de perles
    for (let i = 0; i < 9; i += 1) {
      const a = Math.PI * (0.15 + (0.7 * i) / 8);
      ctx.beginPath();
      ctx.arc(hx + Math.cos(a) * 18, fh * 0.6 + Math.sin(a) * 10, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "#fffaf0";
      ctx.fill();
      outline(ctx, 0.8);
    }
  } else {
    // col pointu du valet
    ctx.beginPath();
    ctx.moveTo(hx - 34, fh * 0.6);
    ctx.lineTo(hx - 6, fh * 0.6);
    ctx.lineTo(hx - 18, fh * 0.74);
    ctx.closePath();
    ctx.moveTo(hx + 34, fh * 0.6);
    ctx.lineTo(hx + 6, fh * 0.6);
    ctx.lineTo(hx + 18, fh * 0.74);
    ctx.closePath();
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fill();
    outline(ctx, 1.5);
  }
  ctx.restore();
  // contour de la silhouette
  robePath(ctx, fh, hx);
  outline(ctx, 2.2);
  ctx.restore();
}

function drawHand(ctx, x, y) {
  ctx.beginPath();
  ctx.ellipse(x, y, 9, 7.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = SKIN;
  ctx.fill();
  outline(ctx, 1.5);
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 1);
  ctx.lineTo(x + 6, y - 1);
  ctx.moveTo(x - 6, y + 3);
  ctx.lineTo(x + 6, y + 3);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.stroke();
}

function drawItem(ctx, fw, fh, kind, pal) {
  const x = fw * 0.88;
  if (kind === "R") {
    // epee
    ctx.beginPath();
    ctx.moveTo(x - 5, fh * 0.64);
    ctx.lineTo(x - 5, fh * 0.1);
    ctx.lineTo(x, fh * 0.03);
    ctx.lineTo(x + 5, fh * 0.1);
    ctx.lineTo(x + 5, fh * 0.64);
    ctx.closePath();
    const g = ctx.createLinearGradient(x - 5, 0, x + 5, 0);
    g.addColorStop(0, "#f4f6f8");
    g.addColorStop(0.5, "#b9c0c8");
    g.addColorStop(1, "#7d8590");
    ctx.fillStyle = g;
    ctx.fill();
    outline(ctx, 1.6);
    ctx.beginPath();
    ctx.moveTo(x, fh * 0.12);
    ctx.lineTo(x, fh * 0.62);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.stroke();
    // garde
    ctx.beginPath();
    ctx.rect(x - 20, fh * 0.64, 40, 8);
    ctx.fillStyle = GOLD;
    ctx.fill();
    outline(ctx, 1.5);
    ctx.beginPath();
    ctx.rect(x - 4, fh * 0.64 + 8, 8, 26);
    ctx.fillStyle = "#6b3e1e";
    ctx.fill();
    outline(ctx, 1.4);
    return { x, y: fh * 0.64 + 20 };
  } else if (kind === "D") {
    // rose
    const fx = fw * 0.85;
    const fy = fh * 0.4;
    ctx.beginPath();
    ctx.moveTo(fx, fy + 10);
    ctx.bezierCurveTo(fx + 6, fy + 40, fx - 8, fy + 60, fx - 2, fh * 0.9);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#2f6b35";
    ctx.stroke();
    for (const [lx, ly, a] of [[fx + 4, fy + 34, -0.6], [fx - 6, fy + 52, 0.7]]) {
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(8, 0, 9, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#3f8a46";
      ctx.fill();
      outline(ctx, 1.1);
      ctx.restore();
    }
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(fx + Math.cos(a) * 7, fy + Math.sin(a) * 7, 8, 6, a, 0, Math.PI * 2);
      ctx.fillStyle = "#c62f3d";
      ctx.fill();
      outline(ctx, 1.2);
    }
    ctx.beginPath();
    ctx.arc(fx, fy, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#8f1622";
    ctx.fill();
    outline(ctx, 1.1);
    return { x: fx - 3, y: fh * 0.8 };
  } else {
    // hallebarde
    ctx.beginPath();
    ctx.rect(x - 3, fh * 0.1, 6, fh * 0.9);
    ctx.fillStyle = "#7a4a22";
    ctx.fill();
    outline(ctx, 1.4);
    ctx.beginPath();
    ctx.moveTo(x, fh * 0.02);
    ctx.lineTo(x + 5, fh * 0.12);
    ctx.lineTo(x - 5, fh * 0.12);
    ctx.closePath();
    ctx.moveTo(x + 3, fh * 0.14);
    ctx.bezierCurveTo(x + 26, fh * 0.12, x + 30, fh * 0.26, x + 24, fh * 0.32);
    ctx.bezierCurveTo(x + 16, fh * 0.26, x + 10, fh * 0.26, x + 3, fh * 0.28);
    ctx.closePath();
    ctx.moveTo(x - 3, fh * 0.16);
    ctx.lineTo(x - 16, fh * 0.21);
    ctx.lineTo(x - 3, fh * 0.25);
    ctx.closePath();
    const g = ctx.createLinearGradient(x - 16, 0, x + 30, 0);
    g.addColorStop(0, "#eef1f4");
    g.addColorStop(1, "#8a929c");
    ctx.fillStyle = g;
    ctx.fill();
    outline(ctx, 1.5);
    return { x, y: fh * 0.72 };
  }
}

function drawFigureHalf(ctx, fw, fh, card) {
  const kind = card.rank;
  const pal = FIGURE_PALETTES[card.suit];
  const hx = fw * 0.42;
  const hy = fh * 0.4;
  const S = 1.16;

  // fond de la figure
  const bg = ctx.createLinearGradient(0, 0, 0, fh);
  bg.addColorStop(0, "#fbf3df");
  bg.addColorStop(1, "#f1e2bd");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, fw, fh);
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  for (let i = -fh; i < fw; i += 12) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + fh, fh);
    ctx.stroke();
  }
  ctx.restore();

  const hand = drawItem(ctx, fw, fh, kind, pal);
  drawRobe(ctx, fw, fh, hx, kind, pal, card.suit);
  // bras qui tient l'objet
  drawSleeve(ctx, hx + 60, fh * 0.64, hand.x - 5, hand.y + 2, 24, pal.main, GOLD_LIGHT);
  drawHand(ctx, hand.x, hand.y);

  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale(S, S);
  ctx.translate(-hx, -hy);
  drawFace(ctx, hx, hy, kind, pal);
  drawCrown(ctx, hx, hy, kind, pal);
  ctx.restore();

  drawSuit(ctx, card.suit, fw * 0.1, fh * 0.13, 28, 0, null, { shine: false });
}

function drawFaceCard(ctx, card, W, H) {
  const x0 = 74; // laisse la place aux index agrandis
  const y0 = 28;
  const fw = W - x0 * 2;
  const fh = (H - y0 * 2) / 2;

  const half = document.createElement("canvas");
  half.width = Math.round(fw);
  half.height = Math.round(fh);
  const hctx = half.getContext("2d");
  drawFigureHalf(hctx, half.width, half.height, card);

  ctx.save();
  roundRectPath(ctx, x0, y0, fw, fh * 2, 8);
  ctx.clip();
  ctx.drawImage(half, x0, y0);
  ctx.translate(x0 + fw, y0 + fh * 2);
  ctx.rotate(Math.PI);
  ctx.drawImage(half, 0, 0);
  ctx.restore();

  // cadre dore + separation centrale
  roundRectPath(ctx, x0, y0, fw, fh * 2, 8);
  ctx.lineWidth = 4;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  roundRectPath(ctx, x0 - 4, y0 - 4, fw + 8, fh * 2 + 8, 11);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x0, y0 + fh);
  ctx.lineTo(x0 + fw, y0 + fh);
  ctx.lineWidth = 3;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x0, y0 + fh);
  ctx.lineTo(x0 + fw, y0 + fh);
  ctx.lineWidth = 1;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

// ---------------------------------------------------------------- API

export function drawCardFace(ctx, card, W = CARD_W, H = CARD_H) {
  ctx.save();
  ctx.scale(W / CARD_W, H / CARD_H);
  paper(ctx, CARD_W, CARD_H, hashStr(card.rank + card.suit));
  if (card.rank === "A") drawAce(ctx, card, CARD_W, CARD_H);
  else if (card.rank === "V" || card.rank === "D" || card.rank === "R") drawFaceCard(ctx, card, CARD_W, CARD_H);
  else drawPips(ctx, card, CARD_W, CARD_H);
  drawIndex(ctx, card, CARD_W, CARD_H);
  ctx.restore();
}

export function createCardFaceCanvas(card, scale = 1) {
  const c = document.createElement("canvas");
  c.width = Math.round(CARD_W * scale);
  c.height = Math.round(CARD_H * scale);
  drawCardFace(c.getContext("2d"), card, c.width, c.height);
  return c;
}

export function drawMask(ctx, s) {
  ctx.save();
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, -0.17);
  ctx.bezierCurveTo(0.18, -0.3, 0.42, -0.27, 0.52, -0.1);
  ctx.bezierCurveTo(0.47, 0.04, 0.4, 0.17, 0.26, 0.21);
  ctx.bezierCurveTo(0.15, 0.24, 0.08, 0.17, 0.045, 0.1);
  ctx.quadraticCurveTo(0, 0.05, -0.045, 0.1);
  ctx.bezierCurveTo(-0.08, 0.17, -0.15, 0.24, -0.26, 0.21);
  ctx.bezierCurveTo(-0.4, 0.17, -0.47, 0.04, -0.52, -0.1);
  ctx.bezierCurveTo(-0.42, -0.27, -0.18, -0.3, 0, -0.17);
  ctx.closePath();
  // trous des yeux
  for (const sx of [-1, 1]) {
    ctx.moveTo(sx * 0.1, -0.03);
    ctx.bezierCurveTo(sx * 0.15, -0.1, sx * 0.29, -0.1, sx * 0.33, -0.02);
    ctx.bezierCurveTo(sx * 0.27, 0.04, sx * 0.15, 0.04, sx * 0.1, -0.03);
    ctx.closePath();
  }
  const g = ctx.createLinearGradient(-0.5, -0.3, 0.5, 0.3);
  g.addColorStop(0, "#fbe7a1");
  g.addColorStop(0.45, "#d7a53c");
  g.addColorStop(1, "#8a5f16");
  ctx.fillStyle = g;
  ctx.fill("evenodd");
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = "#3a0d14";
  ctx.stroke();

  // volutes
  ctx.lineWidth = 0.022;
  ctx.strokeStyle = "#f3d27a";
  ctx.lineCap = "round";
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx * 0.5, -0.1);
    ctx.bezierCurveTo(sx * 0.62, -0.2, sx * 0.72, -0.05, sx * 0.64, 0.02);
    ctx.bezierCurveTo(sx * 0.58, 0.07, sx * 0.54, 0, sx * 0.59, -0.03);
    ctx.stroke();
    // plumes
    ctx.beginPath();
    ctx.moveTo(sx * 0.18, -0.26);
    ctx.bezierCurveTo(sx * 0.22, -0.45, sx * 0.38, -0.5, sx * 0.44, -0.62);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx * 0.08, -0.2);
    ctx.bezierCurveTo(sx * 0.1, -0.42, sx * 0.2, -0.5, sx * 0.22, -0.66);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, -0.18);
  ctx.lineTo(0, -0.7);
  ctx.stroke();
  // petites perles
  ctx.fillStyle = "#fff5d6";
  for (const [x, y] of [[0, -0.1], [-0.4, -0.12], [0.4, -0.12], [-0.22, 0.14], [0.22, 0.14]]) {
    ctx.beginPath();
    ctx.arc(x, y, 0.022, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawCardBack(ctx, W = CARD_W, H = CARD_H) {
  ctx.save();
  ctx.scale(W / CARD_W, H / CARD_H);
  const w = CARD_W;
  const h = CARD_H;
  roundRectPath(ctx, 0, 0, w, h, CARD_RADIUS);
  ctx.fillStyle = "#fbf5e6";
  ctx.fill();

  const m = 16;
  roundRectPath(ctx, m, m, w - m * 2, h - m * 2, 14);
  const g = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, h * 0.62);
  g.addColorStop(0, "#9b2a37");
  g.addColorStop(1, "#4c0f19");
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.clip();
  // treillis art deco
  ctx.strokeStyle = "rgba(236,199,103,0.22)";
  ctx.lineWidth = 1.4;
  const step = 26;
  for (let i = -h; i < w + h; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i, h);
    ctx.lineTo(i + h, 0);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(236,199,103,0.35)";
  for (let y = 0; y < h + step; y += step) {
    for (let x = (y / step) % 2 ? step / 2 : 0; x < w + step; x += step) {
      ctx.beginPath();
      ctx.arc(x, y + (h % step) / 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // cadres dores
  roundRectPath(ctx, m + 8, m + 8, w - (m + 8) * 2, h - (m + 8) * 2, 10);
  ctx.strokeStyle = GOLD_LIGHT;
  ctx.lineWidth = 3;
  ctx.stroke();
  roundRectPath(ctx, m + 14, m + 14, w - (m + 14) * 2, h - (m + 14) * 2, 8);
  ctx.lineWidth = 1;
  ctx.stroke();

  // coins en eventail
  for (const [cx, cy, a] of [[m + 14, m + 14, 0], [w - m - 14, m + 14, Math.PI / 2], [w - m - 14, h - m - 14, Math.PI], [m + 14, h - m - 14, -Math.PI / 2]]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    for (let r = 14; r <= 38; r += 8) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI / 2);
      ctx.strokeStyle = GOLD_LIGHT;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
  }

  // medaillon central
  const cx = w / 2;
  const cy = h / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 104, 132, 0, 0, Math.PI * 2);
  const mg = ctx.createRadialGradient(cx, cy - 20, 10, cx, cy, 140);
  mg.addColorStop(0, "#5a1420");
  mg.addColorStop(1, "#2c070d");
  ctx.fillStyle = mg;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy, 94, 122, 0, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = GOLD_LIGHT;
  ctx.stroke();
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 112, cy + Math.sin(a) * 140, 3, 0, Math.PI * 2);
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fill();
  }

  ctx.save();
  ctx.translate(cx, cy + 6);
  drawMask(ctx, 150);
  ctx.restore();

  ctx.fillStyle = GOLD_LIGHT;
  ctx.font = `700 17px ${INDEX_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("LE CARRÉ", cx, cy + 82);
  ctx.save();
  ctx.translate(cx, cy - 82);
  ctx.rotate(Math.PI);
  ctx.fillText("LE CARRÉ", 0, 0);
  ctx.restore();

  ctx.restore();
}

export function createCardBackCanvas(scale = 1) {
  const c = document.createElement("canvas");
  c.width = Math.round(CARD_W * scale);
  c.height = Math.round(CARD_H * scale);
  drawCardBack(c.getContext("2d"), c.width, c.height);
  return c;
}

// Petite carte "annonce" : grande valeur + les quatre couleurs.
export function createRankBadgeCanvas(rank, width = 120) {
  const scale = width / CARD_W;
  const c = document.createElement("canvas");
  c.width = Math.round(CARD_W * scale);
  c.height = Math.round(CARD_H * scale);
  const ctx = c.getContext("2d");
  ctx.scale(scale, scale);
  paper(ctx, CARD_W, CARD_H, hashStr("badge" + rank));
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const isTen = rank === "10";
  ctx.font = `900 ${isTen ? 190 : 230}px ${INDEX_FONT}`;
  ctx.save();
  ctx.translate(CARD_W / 2, CARD_H * 0.44);
  if (isTen) ctx.scale(0.8, 1);
  ctx.fillText(rank, 0, 10);
  ctx.restore();
  const suits = ["pique", "coeur", "trefle", "carreau"];
  suits.forEach((s, i) => drawSuit(ctx, s, CARD_W * (0.2 + i * 0.2), CARD_H * 0.83, 56, 0, null, { shine: false }));
  return c;
}
