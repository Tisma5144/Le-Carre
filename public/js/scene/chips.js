// Jetons de poker en 3D : une pile de mise devant chaque joueur, le pot au
// centre, et des jetons qui volent (mise, ramassage en fin de tour, gains).
import * as THREE from "three";

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// valeur -> couleur (du plus gros au plus petit)
const DENOMS = [
  { v: 1000, color: "#d9a53a", stripe: "#3a2206" },
  { v: 500, color: "#6d2c91", stripe: "#f3e6ff" },
  { v: 100, color: "#1d1d1f", stripe: "#f2d27a" },
  { v: 50, color: "#1f5fbf", stripe: "#ffffff" },
  { v: 10, color: "#c62828", stripe: "#ffffff" },
  { v: 5, color: "#2e7d32", stripe: "#ffffff" },
  { v: 1, color: "#ece6d8", stripe: "#1f5fbf" }
];
const RADIUS = 0.24;
const HEIGHT = 0.042;
const PER_COLUMN = 8;
const MAX_CHIPS = 40;

function topCanvas(d) {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const m = s / 2;
  g.fillStyle = d.color;
  g.beginPath(); g.arc(m, m, m, 0, Math.PI * 2); g.fill();
  // encoches du bord
  g.fillStyle = d.stripe;
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    g.save(); g.translate(m, m); g.rotate(a);
    g.fillRect(m - 16, -7, 16, 14);
    g.restore();
  }
  // anneau et centre
  g.strokeStyle = d.stripe; g.lineWidth = 3; g.setLineDash([6, 5]);
  g.beginPath(); g.arc(m, m, m * 0.62, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  g.fillStyle = d.color;
  g.beginPath(); g.arc(m, m, m * 0.55, 0, Math.PI * 2); g.fill();
  g.fillStyle = d.stripe;
  g.font = `900 ${d.v >= 1000 ? 26 : 32}px Nunito, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(d.v >= 1000 ? "1K" : String(d.v), m, m + 2);
  return c;
}

function sideCanvas(d) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 16;
  const g = c.getContext("2d");
  g.fillStyle = d.color; g.fillRect(0, 0, 256, 16);
  g.fillStyle = d.stripe;
  for (let i = 0; i < 8; i += 1) g.fillRect(i * 32 + 4, 0, 12, 16);
  return c;
}

// Decompose un montant en jetons : [{ d, n }], au plus MAX_CHIPS jetons.
// On evite les trop grosses valeurs (100 = dix jetons de 10, pas un seul
// jeton noir) pour que les piles aient du volume.
export function chipsFor(amount, div = 4, max = MAX_CHIPS) {
  let rest = Math.max(0, Math.round(amount));
  const cap = rest / div;
  const out = [];
  for (const d of DENOMS) {
    if (d.v > cap && d.v > 5) continue;
    const n = Math.floor(rest / d.v);
    if (n > 0) {
      out.push({ d, n });
      rest -= n * d.v;
    }
  }
  let total = out.reduce((t, x) => t + x.n, 0);
  // trop de jetons : on tronque les petites valeurs (c'est un decor)
  while (total > max && out.length) {
    const last = out[out.length - 1];
    const cut = Math.min(last.n, total - max);
    last.n -= cut;
    total -= cut;
    if (!last.n) out.pop();
  }
  return out;
}

export class ChipLayer {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    world.scene.add(this.group);
    this.geo = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 28);
    this.mats = new Map();
    for (const d of DENOMS) {
      const tex = (cv) => {
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      };
      const top = new THREE.MeshStandardMaterial({ map: tex(topCanvas(d)), roughness: 0.45, metalness: 0.05 });
      const side = new THREE.MeshStandardMaterial({ map: tex(sideCanvas(d)), roughness: 0.5 });
      this.mats.set(d.v, [side, top, top]);
    }
    this.piles = new Map(); // cle -> { amount, pos, obj }
    this.flights = [];
    world.onFrame({ update: (dt) => this.update(dt) });
  }

  // Pile de jetons : colonnes d'une meme couleur, cote a cote.
  // opts.compact : tapis d'un joueur (grosses valeurs, pile plus petite).
  buildPile(amount, opts = {}) {
    const g = new THREE.Group();
    const cols = [];
    const parts = opts.compact ? chipsFor(amount, 8, 24) : chipsFor(amount);
    for (const { d, n } of parts) {
      for (let k = 0; k < n; k += PER_COLUMN) cols.push({ d, n: Math.min(PER_COLUMN, n - k) });
    }
    // disposition compacte : rangee de 3 colonnes au plus, puis rangee suivante
    const perRow = cols.length > 4 ? 3 : cols.length;
    cols.forEach((col, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, cols.length - row * perRow);
      const x = ((i % perRow) - (inRow - 1) / 2) * RADIUS * 2.1;
      const z = row * RADIUS * 1.9;
      for (let k = 0; k < col.n; k += 1) {
        const m = new THREE.Mesh(this.geo, this.mats.get(col.d.v));
        m.position.set(x + (Math.random() - 0.5) * 0.012, HEIGHT / 2 + k * HEIGHT, z + (Math.random() - 0.5) * 0.012);
        m.rotation.y = Math.random() * Math.PI * 2;
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
      }
    });
    if (opts.compact) g.scale.setScalar(0.72);
    return g;
  }

  // Place (ou remplace) une pile, sans animation.
  setPile(key, amount, pos, opts = {}) {
    const cur = this.piles.get(key);
    if (cur && cur.amount === amount && cur.pos.distanceTo(pos) < 0.001) return;
    if (cur) this.group.remove(cur.obj);
    if (!amount) {
      this.piles.delete(key);
      return;
    }
    const obj = this.buildPile(amount, opts);
    obj.position.copy(pos);
    this.group.add(obj);
    this.piles.set(key, { amount, pos: pos.clone(), obj, opts });
  }

  amount(key) {
    const p = this.piles.get(key);
    return p ? p.amount : 0;
  }

  fly(obj, from, to, { dur = 0.55, delay = 0, arc = 0.5, fade = false, onDone } = {}) {
    obj.position.copy(from);
    this.group.add(obj);
    this.flights.push({ obj, from: from.clone(), to: to.clone(), t: -delay, dur, arc, fade, onDone });
  }

  // Mise : les jetons partent du joueur et viennent grossir sa pile.
  bet(key, newAmount, pos, from) {
    const delta = newAmount - this.amount(key);
    if (delta <= 0) return this.setPile(key, newAmount, pos);
    const obj = this.buildPile(delta);
    this.fly(obj, from, pos, {
      dur: 0.5,
      arc: 0.35,
      onDone: () => {
        this.group.remove(obj);
        this.setPile(key, newAmount, pos);
      }
    });
  }

  // Fin de tour : chaque pile de mise glisse jusqu'au pot.
  collect(keys, potKey, potAmount, potPos) {
    let n = 0;
    keys.forEach((key, i) => {
      const p = this.piles.get(key);
      if (!p) return;
      this.piles.delete(key);
      this.group.remove(p.obj);
      n += 1;
      this.fly(p.obj, p.pos, potPos, {
        dur: 0.5,
        delay: i * 0.06,
        arc: 0.25,
        onDone: () => {
          this.group.remove(p.obj);
          n -= 1;
          if (!n) this.setPile(potKey, potAmount, potPos);
        }
      });
    });
    if (!n) this.setPile(potKey, potAmount, potPos);
  }

  // Gains : tout ce qui est sur la table part vers le(s) gagnant(s).
  // (les tapis des joueurs, cles "stack:", ne bougent pas ; w.onLand est
  // appele quand les jetons arrivent)
  payout(winners, delay = 0.9) {
    let from = null;
    for (const [key, p] of [...this.piles]) {
      if (key.startsWith("stack:")) continue;
      if (key === "pot" || !from) from = p.pos;
      this.group.remove(p.obj);
      this.piles.delete(key);
    }
    winners.forEach((w, i) => {
      if (!from) return w.onLand && w.onLand();
      const obj = this.buildPile(w.amount);
      this.fly(obj, from, w.pos, {
        dur: 0.75,
        delay: delay + i * 0.15,
        arc: 0.6,
        fade: true,
        onDone: () => {
          this.group.remove(obj);
          if (w.onLand) w.onLand();
        }
      });
    });
  }

  // Tout ce qui est en jeu (mises, pot) disparait ; les tapis restent.
  clearTable() {
    for (const f of this.flights) this.group.remove(f.obj);
    this.flights = [];
    for (const [key, p] of [...this.piles]) {
      if (key.startsWith("stack:")) continue;
      this.group.remove(p.obj);
      this.piles.delete(key);
    }
  }

  clear() {
    for (const f of this.flights) this.group.remove(f.obj);
    this.flights = [];
    for (const p of this.piles.values()) this.group.remove(p.obj);
    this.piles.clear();
  }

  update(dt) {
    if (!this.flights.length) return;
    const done = [];
    for (const f of this.flights) {
      f.t += dt;
      if (f.t < 0) {
        f.obj.visible = false;
        continue;
      }
      f.obj.visible = true;
      const u = Math.min(1, f.t / f.dur);
      const e = easeInOut(u);
      f.obj.position.lerpVectors(f.from, f.to, e);
      f.obj.position.y += Math.sin(Math.PI * u) * f.arc;
      if (f.fade) f.obj.scale.setScalar(1 - 0.7 * Math.max(0, (u - 0.6) / 0.4));
      if (u >= 1) done.push(f);
    }
    for (const f of done) {
      this.flights.splice(this.flights.indexOf(f), 1);
      if (f.onDone) f.onDone();
    }
  }
}

