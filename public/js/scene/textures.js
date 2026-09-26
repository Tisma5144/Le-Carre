// Textures procedurales : bois, feutre, parquet, sous-bock, jeton, halo.
import * as THREE from "three";
import { roundRectPath, drawMask } from "../cards/cardArt.js";

function rng(seed) {
  let s = seed >>> 0 || 7;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade([r, g, b], f) {
  return `rgb(${Math.max(0, Math.min(255, r * f)) | 0},${Math.max(0, Math.min(255, g * f)) | 0},${Math.max(0, Math.min(255, b * f)) | 0})`;
}

export function woodCanvas({ size = 1024, planks = 5, base = "#7a4a28", seed = 1, knots = 3, gapColor = "rgba(20,10,4,0.85)" } = {}) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const r = rng(seed);
  const baseRgb = hexToRgb(base);
  const ph = size / planks;

  for (let p = 0; p < planks; p += 1) {
    const y0 = p * ph;
    const tint = 0.85 + r() * 0.3;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + ph);
    g.addColorStop(0, shade(baseRgb, tint * 1.04));
    g.addColorStop(0.5, shade(baseRgb, tint));
    g.addColorStop(1, shade(baseRgb, tint * 0.92));
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, size, ph);

    // veinage
    const lines = 70 + (r() * 40) | 0;
    for (let i = 0; i < lines; i += 1) {
      const yy = y0 + r() * ph;
      const amp = 1 + r() * 5;
      const freq = 0.002 + r() * 0.01;
      const phase = r() * 100;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 16) {
        const y = yy + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase) * amp * 0.3;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const dark = r() > 0.35;
      ctx.strokeStyle = dark ? `rgba(40,20,8,${0.05 + r() * 0.18})` : `rgba(255,220,170,${0.03 + r() * 0.08})`;
      ctx.lineWidth = 0.6 + r() * 2.2;
      ctx.stroke();
    }

    // noeuds
    for (let k = 0; k < knots / planks + (r() < (knots % planks) / planks ? 1 : 0); k += 1) {
      const kx = r() * size;
      const ky = y0 + ph * (0.3 + r() * 0.4);
      for (let ring = 0; ring < 9; ring += 1) {
        ctx.beginPath();
        ctx.ellipse(kx, ky, 6 + ring * 7, 3 + ring * 2.4, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(40,18,6,${0.28 - ring * 0.025})`;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(kx, ky, 5, 3, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(35,15,5,0.6)";
      ctx.fill();
    }

    // joints entre lattes
    ctx.fillStyle = gapColor;
    ctx.fillRect(0, y0, size, 2.5);
    ctx.fillStyle = "rgba(255,210,160,0.08)";
    ctx.fillRect(0, y0 + 2.5, size, 1.5);
    // decalage des abouts de lattes
    const cut = r() * size;
    ctx.fillStyle = gapColor;
    ctx.fillRect(cut, y0, 2.5, ph);
  }

  // grain fin
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 14;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function feltCanvas(size = 512, color = "#1e5c3c") {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const r = rng(99);
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 22;
    d[i] += n * 0.6;
    d[i + 1] += n;
    d[i + 2] += n * 0.7;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function coasterCanvas(size = 256, seed = 1, lines = ["LE", "MENTEUR"]) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const r = rng(seed);
  const cx = size / 2;
  const palettes = [
    ["#f3e6c8", "#8f1d25", "#1b1b1b"],
    ["#1f4d3a", "#f0d58a", "#f3e6c8"],
    ["#223a6b", "#f3e6c8", "#e0a93b"]
  ];
  const [bg, ring, text] = palettes[(seed * 7) % palettes.length];
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 20, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = text;
  ctx.font = `900 34px "Playfair Display", Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(lines[0], cx, cx - 22);
  ctx.font = `900 ${lines[1].length > 6 ? 28 : 34}px "Playfair Display", Georgia, serif`;
  ctx.fillText(lines[1], cx, cx + 18);
  ctx.font = `700 16px "Playfair Display", Georgia, serif`;
  ctx.fillText("depuis 2026", cx, cx + 50);
  // traces de verre
  ctx.strokeStyle = "rgba(90,60,20,0.18)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx + (r() - 0.5) * 20, cx + (r() - 0.5) * 20, cx * 0.62, 0.3, 5.6);
  ctx.stroke();
  return c;
}

export function tokenCanvas(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx * 0.8, cx * 0.7, 10, cx, cx, cx);
  g.addColorStop(0, "#fff0b8");
  g.addColorStop(0.5, "#d8a63d");
  g.addColorStop(1, "#7d5412");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cx, cx, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(70,40,5,0.8)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 16, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 40; i += 1) {
    const a = (i / 40) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (cx - 8), cx + Math.sin(a) * (cx - 8));
    ctx.lineTo(cx + Math.cos(a) * (cx - 2), cx + Math.sin(a) * (cx - 2));
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(cx, cx - 6);
  drawMask(ctx, 150);
  ctx.restore();
  ctx.fillStyle = "#4a2e06";
  ctx.font = `900 30px "Playfair Display", Georgia, serif`;
  ctx.textAlign = "center";
  ctx.fillText("À TOI", cx, cx + 66);
  return c;
}

export function glowCanvas(w = 256, h = 340) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const pad = 34;
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 26;
  ctx.fillStyle = "#ffffff";
  roundRectPath(ctx, pad, pad, w - pad * 2, h - pad * 2, 20);
  ctx.fill();
  ctx.fill();
  return c;
}

export function ringGlowCanvas(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx, cx, cx * 0.62, cx, cx, cx);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.55, "rgba(255,255,255,0.9)");
  g.addColorStop(0.7, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function toTexture(canvas, { repeat = null, anisotropy = 8, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.needsUpdate = true;
  return t;
}
