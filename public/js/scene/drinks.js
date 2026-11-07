// Boissons posees devant les joueurs : chacun choisit la sienne (salon ou
// menu). Tous les verres tiennent dans un rayon d'environ 0,25 et une
// hauteur de 0,75 (la place d'une pinte).
// Chaque verre sait se faire touiller : g.userData.stir(t), t de 0 a 1
// (cuillere qui tourne dans le cafe, pic du cocktail, paille du soda, verre
// qu'on fait tourner pour le vin, le whisky ou la biere).
import * as THREE from "three";

export const DRINKS = [
  { id: "biere", emoji: "🍺", label: "Bière" },
  { id: "whisky", emoji: "🥃", label: "Whisky" },
  { id: "vin", emoji: "🍷", label: "Vin rouge" },
  { id: "cocktail", emoji: "🍸", label: "Cocktail" },
  { id: "soda", emoji: "🥤", label: "Soda" },
  { id: "cafe", emoji: "☕", label: "Café" },
  { id: "chai", emoji: "🍵", label: "Chai latte" }
];

// enveloppe douce : 0 au debut et a la fin du mouvement, 1 au milieu
const env = (t) => Math.min(1, t * 5, (1 - t) * 5);
const TURNS = 3;

// Le verre entier tourne en petits cercles (vin, whisky, biere).
function swirl(g, amp) {
  g.userData.stir = (t) => {
    const a = t * Math.PI * 2 * TURNS;
    const k = env(t);
    g.children.forEach((c) => {
      if (c.userData.base === undefined) c.userData.base = c.position.clone();
      c.position.x = c.userData.base.x + Math.cos(a) * amp * k;
      c.position.z = c.userData.base.z + Math.sin(a) * amp * k;
    });
    g.rotation.x = Math.sin(a) * 0.05 * k;
    g.rotation.z = Math.cos(a) * 0.05 * k;
  };
}

// Un objet (cuillere, pic, paille) tourne autour de l'axe du verre ; rest :
// sa pose au repos, stir : sa pose dans le verre (position, inclinaison).
function stirrer(g, obj, { r, y, tilt }, extra) {
  const rest = { p: obj.position.clone(), r: obj.rotation.clone() };
  g.userData.stir = (t) => {
    const k = env(t);
    const a = t * Math.PI * 2 * TURNS;
    if (t <= 0 || t >= 1) {
      obj.position.copy(rest.p);
      obj.rotation.copy(rest.r);
    } else {
      // l'objet rejoint le centre du verre puis tourne
      const px = Math.cos(a) * r;
      const pz = Math.sin(a) * r;
      obj.position.set(rest.p.x + (px - rest.p.x) * k, rest.p.y + (y - rest.p.y) * k, rest.p.z + (pz - rest.p.z) * k);
      obj.rotation.set(rest.r.x * (1 - k) + Math.sin(a) * tilt * k, rest.r.y * (1 - k) - a * k, rest.r.z * (1 - k) + Math.cos(a) * tilt * k);
    }
    // le verre tremble un peu sous la cuillere
    g.rotation.x = Math.sin(a * 2) * 0.03 * k;
    g.rotation.z = Math.cos(a * 2) * 0.03 * k;
    if (extra) extra(t, a, k);
  };
}

// cuillere : manche + cuilleron, pivot au bout du manche (en haut)
function spoon(len = 0.3) {
  const metal = new THREE.MeshStandardMaterial({ color: 0xd8d8de, metalness: 0.85, roughness: 0.25 });
  const s = new THREE.Group();
  const handle = mesh(new THREE.CylinderGeometry(0.016, 0.012, len, 8), metal, -len / 2);
  const bowl = mesh(new THREE.SphereGeometry(0.04, 12, 8), metal, -len);
  bowl.scale.set(1, 0.4, 1.5);
  s.add(handle, bowl);
  return s;
}

const glassMat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
const liquid = (color, emissive, opacity = 0.92) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.5, transparent: true, opacity, roughness: 0.2 });
const mesh = (geo, mat, y = 0, cast = false) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.castShadow = cast;
  return m;
};

function pint(i) {
  const g = new THREE.Group();
  const stout = i % 3 === 2;
  g.add(
    mesh(new THREE.CylinderGeometry(0.21, 0.175, 0.56, 28), liquid(stout ? 0x1d0e06 : 0xe0901f, stout ? 0x0a0402 : 0x6a2c00), 0.3, true),
    mesh(new THREE.CylinderGeometry(0.215, 0.21, 0.1, 28), new THREE.MeshStandardMaterial({ color: 0xfff4e0, roughness: 0.9 }), 0.62),
    mesh(new THREE.CylinderGeometry(0.23, 0.19, 0.72, 28, 1, true), glassMat(), 0.36),
    mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 28), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05 }), 0.02)
  );
  swirl(g, 0.015);
  return g;
}

// verre bas, whisky ambre et glacons
function whisky() {
  const g = new THREE.Group();
  g.add(
    mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 28), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0.05 }), 0.025),
    mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.16, 28), liquid(0xc7771c, 0x5a2a00, 0.85), 0.13, true),
    mesh(new THREE.CylinderGeometry(0.21, 0.2, 0.34, 28, 1, true), glassMat(), 0.17)
  );
  const ice = new THREE.MeshStandardMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.7, roughness: 0.1 });
  for (const [x, z, r] of [[-0.05, 0.03, 0.4], [0.06, -0.04, 1.1]]) {
    const c = mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), ice, 0.21);
    c.position.x = x;
    c.position.z = z;
    c.rotation.set(r, r * 0.7, 0.3);
    g.add(c);
  }
  swirl(g, 0.03);
  return g;
}

// verre a pied, vin rouge
function wine() {
  const g = new THREE.Group();
  const clear = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, roughness: 0.05 });
  g.add(
    mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 28), clear, 0.01),
    mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 10), clear, 0.17),
    mesh(new THREE.CylinderGeometry(0.15, 0.1, 0.1, 28), liquid(0x5e0b16, 0x2a0006, 0.9), 0.4, true),
    mesh(new THREE.CylinderGeometry(0.19, 0.1, 0.28, 28, 1, true), glassMat(), 0.47)
  );
  swirl(g, 0.035);
  return g;
}

// verre a cocktail en cone, olive sur un pic
function cocktail() {
  const g = new THREE.Group();
  const clear = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, roughness: 0.05 });
  g.add(
    mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 28), clear, 0.01),
    mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 10), clear, 0.18),
    mesh(new THREE.CylinderGeometry(0.2, 0.02, 0.18, 28), liquid(0xff5c8a, 0x7a0030, 0.85), 0.44, true),
    mesh(new THREE.CylinderGeometry(0.25, 0.02, 0.24, 28, 1, true), glassMat(), 0.47)
  );
  // pic + olive, pivot en haut du pic
  const stick = new THREE.Group();
  const pick = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0xd9a640 }), -0.15);
  const olive = mesh(new THREE.SphereGeometry(0.045, 14, 10), new THREE.MeshStandardMaterial({ color: 0x6f8f1f, roughness: 0.5 }), -0.2);
  stick.add(pick, olive);
  stick.position.set(0.13, 0.7, 0);
  stick.rotation.z = -0.5;
  g.add(stick);
  stirrer(g, stick, { r: 0.06, y: 0.72, tilt: 0.25 });
  return g;
}

// grand verre de cola, glacons et paille
function soda() {
  const g = new THREE.Group();
  g.add(
    mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 28), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, roughness: 0.05 }), 0.02),
    mesh(new THREE.CylinderGeometry(0.155, 0.15, 0.48, 28), liquid(0x3a1206, 0x120400, 0.9), 0.28, true),
    mesh(new THREE.CylinderGeometry(0.175, 0.165, 0.62, 28, 1, true), glassMat(), 0.31)
  );
  const ice = new THREE.MeshStandardMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.75, roughness: 0.1 });
  const c = mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), ice, 0.5);
  c.rotation.set(0.4, 0.5, 0.2);
  const straw = new THREE.Group();
  straw.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xe53935, roughness: 0.4 }), -0.35));
  straw.position.set(0.14, 0.89, 0);
  straw.rotation.z = -0.22;
  g.add(c, straw);
  const cBase = c.position.clone();
  stirrer(g, straw, { r: 0.07, y: 0.9, tilt: 0.18 }, (t, a, k) => {
    c.position.set(cBase.x + Math.cos(a + 2) * 0.05 * k, cBase.y, cBase.z + Math.sin(a + 2) * 0.05 * k);
    c.rotation.y = 0.5 + a * 0.5;
  });
  return g;
}

// tasse de cafe sur sa soucoupe
function coffee() {
  const g = new THREE.Group();
  const china = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.35 });
  g.add(
    mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.03, 32), china, 0.015),
    mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.2, 28), china, 0.13, true),
    mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.01, 28), [
      new THREE.MeshStandardMaterial({ color: 0x3b1f0e, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ map: foamTexture("#6b3a17", "rgba(225,175,120,.8)", "rgba(40,18,6,.6)"), roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0x3b1f0e, roughness: 0.3 })
    ], 0.225)
  );
  const handle = mesh(new THREE.TorusGeometry(0.06, 0.018, 8, 16), china, 0.14);
  handle.position.x = 0.16;
  g.add(handle);
  // cuillere posee sur la soucoupe ; touillee, elle plonge dans la tasse
  const sp = spoon(0.24);
  sp.position.set(-0.17, 0.05, 0.19);
  sp.rotation.set(0, 0, 1.5);
  g.add(sp);
  const crema = g.children[2];
  stirrer(g, sp, { r: 0.05, y: 0.42, tilt: 0.3 }, (t, a) => { crema.rotation.y = a; });
  return g;
}

// mousse du chai latte : creme saupoudree de cannelle (texture qui tourne)
function foamTexture(base = "#f1e2c9", swirlColor = "rgba(150,90,40,.55)", dots = null) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = swirlColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 6; a += 0.1) {
    const r = 6 + a * 3;
    ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  ctx.stroke();
  for (let i = 0; i < 90; i += 1) {
    ctx.fillStyle = dots || `rgba(${120 + Math.random() * 40},${60 + Math.random() * 30},20,.7)`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// chai latte : grand verre a anse, the au lait epice, mousse a la cannelle
// et longue cuillere
function chai() {
  const g = new THREE.Group();
  g.add(
    mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 28), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, roughness: 0.05 }), 0.02),
    mesh(new THREE.CylinderGeometry(0.16, 0.155, 0.36, 28), liquid(0xb98a5a, 0x4a2a10, 0.95), 0.22, true)
  );
  const foam = mesh(new THREE.CylinderGeometry(0.162, 0.16, 0.08, 28), [
    new THREE.MeshStandardMaterial({ color: 0xf1e2c9, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ map: foamTexture(), roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0xf1e2c9, roughness: 0.9 })
  ], 0.44);
  const glass = mesh(new THREE.CylinderGeometry(0.18, 0.17, 0.52, 28, 1, true), glassMat(), 0.27);
  const handle = mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 18, Math.PI), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05 }), 0.28);
  handle.position.x = 0.18;
  handle.rotation.z = -Math.PI / 2;
  g.add(foam, glass, handle);
  // baton de cannelle sur la mousse
  const stick = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x7a3e17, roughness: 0.8 }), 0.49);
  stick.rotation.set(Math.PI / 2, 0, 0.6);
  stick.position.x = -0.04;
  g.add(stick);
  const sp = spoon(0.5);
  sp.position.set(0.07, 0.75, 0.04);
  sp.rotation.set(0.1, 0, -0.18);
  g.add(sp);
  stirrer(g, sp, { r: 0.06, y: 0.75, tilt: 0.12 }, (t, a) => { foam.rotation.y = -a; stick.rotation.z = 0.6 - a * 0.3; });
  return g;
}

// kind : id de DRINKS (null : biere par defaut) ; i : rang du siege
export function makeDrink(kind, i = 0) {
  switch (kind) {
    case "whisky": return whisky();
    case "vin": return wine();
    case "cocktail": return cocktail();
    case "soda": return soda();
    case "cafe": return coffee();
    case "chai": return chai();
    default: return pint(i);
  }
}
