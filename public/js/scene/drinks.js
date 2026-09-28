// Boissons posees devant les joueurs : chacun choisit la sienne (salon ou
// menu). Tous les verres tiennent dans un rayon d'environ 0,25 et une
// hauteur de 0,75 (la place d'une pinte).
import * as THREE from "three";

export const DRINKS = [
  { id: "biere", emoji: "🍺", label: "Bière" },
  { id: "whisky", emoji: "🥃", label: "Whisky" },
  { id: "vin", emoji: "🍷", label: "Vin rouge" },
  { id: "cocktail", emoji: "🍸", label: "Cocktail" },
  { id: "soda", emoji: "🥤", label: "Soda" },
  { id: "cafe", emoji: "☕", label: "Café" }
];

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
  const olive = mesh(new THREE.SphereGeometry(0.045, 14, 10), new THREE.MeshStandardMaterial({ color: 0x6f8f1f, roughness: 0.5 }), 0.52);
  olive.position.x = 0.04;
  const pick = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0xd9a640 }), 0.58);
  pick.position.x = 0.07;
  pick.rotation.z = -0.5;
  g.add(olive, pick);
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
  const straw = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xe53935, roughness: 0.4 }), 0.55);
  straw.position.x = 0.06;
  straw.rotation.z = -0.22;
  g.add(c, straw);
  return g;
}

// tasse de cafe sur sa soucoupe
function coffee() {
  const g = new THREE.Group();
  const china = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.35 });
  g.add(
    mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.03, 32), china, 0.015),
    mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.2, 28), china, 0.13, true),
    mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.01, 28), new THREE.MeshStandardMaterial({ color: 0x3b1f0e, roughness: 0.3 }), 0.225)
  );
  const handle = mesh(new THREE.TorusGeometry(0.06, 0.018, 8, 16), china, 0.14);
  handle.position.x = 0.16;
  g.add(handle);
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
    default: return pint(i);
  }
}
