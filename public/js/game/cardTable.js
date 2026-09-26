// Moteur de cartes 3D : les 52 cartes du jeu existent en permanence dans la
// scene. A chaque nouvel etat du serveur, on "reconcilie" : chaque carte est
// assignee a une zone (ma main, la main d'un adversaire, le tapis, la
// revelation, le plateau des cartes sorties) et celles qui changent de zone
// s'envolent vers leur nouvelle place. Ainsi, toutes les animations (donne,
// pose, revelation, ramassage, carre) decoulent automatiquement de l'etat.
import * as THREE from "three";
import { CardFactory, CARD_WORLD_W, CARD_WORLD_H } from "../scene/cardMeshes.js";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q_FACE_DOWN = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const Q_FACE_UP = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const Y_AXIS = V(0, 1, 0);
const SUITS = ["pique", "coeur", "trefle", "carreau"];

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function yawQuat(yaw) {
  return new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);
}

class Entity {
  constructor(index, group) {
    this.index = index;
    this.group = group;
    this.id = null;
    this.card = null;
    this.zone = "deck";
    this.owner = null;
    this.slot = index;
    this.quad = 0;
    this.qj = 0;
    this.space = "world";
    this.tPos = V();
    this.tQuat = new THREE.Quaternion();
    this.tScale = 1;
    this.flight = null;
    this.glowTarget = 0;
    this.glowColor = new THREE.Color(0xffd35a);
    this.jitter = { dx: 0, dz: 0, yaw: 0 };
    this.emissive = 0.12;
    this.lift = 0;
  }
}

export class CardTable {
  constructor(world, hooks = {}) {
    this.world = world;
    this.hooks = hooks;
    this.factory = new CardFactory(world.renderer);
    this.entities = [];
    for (let i = 0; i < 52; i += 1) {
      const g = this.factory.createCard();
      world.scene.add(g);
      const e = new Entity(i, g);
      this.entities.push(e);
    }
    this.seatPhi = new Map();
    this.selected = new Set();
    this.interactive = false;
    this.turnGlowOwner = null;
    this.maxSelect = 3;
    this.drag = null;
    this.press = null;
    this.hoverId = null;
    this.pendingDropIds = new Set();
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.tmpPos = V();
    this.tmpQuat = new THREE.Quaternion();
    this.landedBatch = new Map();

    const all = [];
    for (const suit of SUITS) for (const rank of ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R"]) all.push({ rank, suit });
    this.factory.warmup(all);

    this.setupDecor();
    this.layoutAll();
    this.entities.forEach((e) => this.snap(e));

    world.onFrame((dt, t) => this.update(dt, t));
    this.bindPointer();
  }

  // ------------------------------------------------------------ decor (accueil)

  setupDecor() {
    const aces = SUITS.map((suit, i) => ({ id: "decor-A-" + suit, rank: "A", suit }));
    const figures = [{ rank: "R", suit: "coeur" }, { rank: "D", suit: "pique" }, { rank: "V", suit: "carreau" }];
    this.entities.forEach((e, i) => {
      e.zone = "deck";
      e.owner = null;
      e.slot = i;
      e.id = null;
    });
    aces.forEach((c, i) => {
      const e = this.entities[i];
      this.setCard(e, c);
      e.zone = "decor";
      e.slot = i;
    });
    figures.forEach((c, i) => {
      const e = this.entities[4 + i];
      this.setCard(e, { ...c, id: "decor-" + c.rank });
      e.zone = "decor";
      e.slot = 4 + i;
    });
    for (let i = 7; i < 12; i += 1) {
      const e = this.entities[i];
      e.zone = "decor";
      e.slot = i;
    }
  }

  showDecor() {
    this.selected.clear();
    this.setupDecor();
    this.layoutAll();
    this.entities.forEach((e) => this.startFlight(e, { delay: e.index * 0.01, dur: 0.8, arc: 0.6 }));
  }

  gatherToDeck(animate = true) {
    this.selected.clear();
    this.entities.forEach((e, i) => {
      e.zone = "deck";
      e.owner = null;
      e.slot = i;
      e.id = null;
      e.card = null;
    });
    this.layoutAll();
    this.entities.forEach((e) => {
      if (animate) this.startFlight(e, { delay: (51 - e.index) * 0.006, dur: 0.55, arc: 0.4 });
      else this.snap(e);
    });
  }

  // ------------------------------------------------------------ sieges

  setSeats(seats) {
    this.seatPhi = new Map(seats.map((s) => [s.id, s.phi]));
    this.layoutAll();
  }

  // ------------------------------------------------------------ cartes connues

  setCard(e, card) {
    e.id = card.id;
    e.card = card;
    this.factory.setFace(e.group, card);
  }

  clearIdentity(e) {
    e.id = null;
    e.card = null;
  }

  // ------------------------------------------------------------ reconciliation

  // Chaque jeu fournit un "desir" : quelles cartes dans quelles zones.
  //   me: [cartes]           ma main (ordre d'affichage)
  //   opp: Map(id -> n)      nombre de cartes de chaque adversaire
  //   pile: n                cartes face cachee au centre (Menteur)
  //   reveal: [cartes]       cartes retournees en grand (Menteur)
  //   tray: [{card,quad,j}]  cartes sorties (carres du Menteur)
  //   table: [{card,play,j}] pli face visible au centre (President)
  //   discard: n             defausse face cachee (President)
  normalizeDesired(d) {
    return {
      me: d.me || [],
      opp: d.opp || new Map(),
      pile: d.pile || 0,
      reveal: d.reveal || [],
      tray: d.tray || [],
      table: d.table || [],
      discard: d.discard || 0
    };
  }

  nextSlot(zone, owner) {
    let max = -1;
    for (const e of this.entities) if (e.zone === zone && e.owner === owner) max = Math.max(max, e.slot);
    return max + 1;
  }

  takeFree(free, destZone, destOwner) {
    const prio = (e) => {
      const z = e.zone;
      if (destZone === "me" || destZone === "opp") {
        if (z === "reveal") return 0;
        if (z === "pile") return 1 - e.slot * 0.0001;
        if (z === "deck") return 2;
        if (z === "discard") return 2.5 - e.slot * 0.0001;
        if (destZone === "me" && z === "opp") return 3;
        return 4;
      }
      if (destZone === "table") {
        if (z === "me" || z === "opp") return 0;
        return 2;
      }
      if (destZone === "discard") {
        if (z === "table") return 0 - e.slot * 0.0001;
        if (z === "me" || z === "opp") return 1;
        return 2;
      }
      if (destZone === "reveal") {
        if (z === "pile") return 0 - e.slot * 0.0001;
        if (z === "me" || z === "opp") return 1;
        return 2;
      }
      if (destZone === "tray") {
        if (z === "opp" && e.owner === destOwner) return 0;
        if (z === "me") return 1;
        if (z === "opp") return 2;
        return 3;
      }
      if (destZone === "pile") {
        if (z === "me" || z === "opp") return 0;
        if (z === "reveal") return 1;
        return 2;
      }
      return 0;
    };
    if (!free.length) return null;
    let best = 0;
    let bestP = prio(free[0]);
    for (let i = 1; i < free.length; i += 1) {
      const p = prio(free[i]);
      if (p < bestP) {
        bestP = p;
        best = i;
      }
    }
    return free.splice(best, 1)[0];
  }

  applyState(rawDesired, { deal = false, instant = false } = {}) {
    const desired = this.normalizeDesired(rawDesired);
    const E = this.entities;
    const assigned = new Set();
    const moves = [];
    const byId = new Map();
    E.forEach((e) => { if (e.id) byId.set(e.id, e); });

    const setZone = (e, zone, owner, slot) => {
      if (e.zone !== zone || e.owner !== owner) {
        moves.push({ e, fromZone: e.zone, fromOwner: e.owner, toZone: zone, toOwner: owner });
      }
      e.zone = zone;
      e.owner = owner;
      e.slot = slot;
      assigned.add(e);
    };

    // 1. cartes connues deja a leur place
    const knownDest = [];
    desired.me.forEach((c, i) => knownDest.push({ zone: "me", card: c, slot: i }));
    desired.reveal.forEach((c, i) => knownDest.push({ zone: "reveal", card: c, slot: i }));
    desired.tray.forEach((t, i) => knownDest.push({ zone: "tray", card: t.card, slot: i, quad: t.quad, j: t.j, owner: t.owner }));
    desired.table.forEach((t, i) => knownDest.push({ zone: "table", card: t.card, slot: i, quad: t.play, j: t.j, owner: t.owner, size: t.size }));
    const pendingKnown = [];
    for (const d of knownDest) {
      const e = byId.get(d.card.id);
      if (e && e.zone === d.zone && !assigned.has(e)) {
        e.slot = d.slot;
        e.quad = d.quad || 0;
        e.qj = d.j || 0;
        e.qsize = d.size || 1;
        assigned.add(e);
      } else {
        pendingKnown.push(d);
      }
    }

    // 2. zones "a compter" : on garde les cartes du dessous
    const keep = (zone, owner, count) => {
      const cur = E.filter((e) => e.zone === zone && e.owner === owner && !assigned.has(e)).sort((a, b) => a.slot - b.slot);
      cur.slice(0, count).forEach((e) => assigned.add(e));
      return Math.max(0, count - cur.length);
    };
    const oppDeficit = new Map();
    for (const [pid, n] of desired.opp) oppDeficit.set(pid, keep("opp", pid, n));
    const pileDeficit = keep("pile", null, desired.pile);
    const discardDeficit = keep("discard", null, desired.discard);

    // 3. cartes libres (celles qui doivent bouger)
    const free = E.filter((e) => !assigned.has(e));

    // 4. destinations connues
    for (const d of pendingKnown) {
      let e = byId.get(d.card.id);
      if (e && !assigned.has(e) && free.includes(e)) {
        free.splice(free.indexOf(e), 1);
      } else {
        e = this.takeFree(free, d.zone, d.owner);
      }
      if (!e) continue;
      if (d.zone === "me" && e.zone !== "me") e.fromOtherZoneToHand = true;
      this.setCard(e, d.card);
      e.quad = d.quad || 0;
      e.qj = d.j || 0;
      e.qsize = d.size || 1;
      if (d.zone === "table") e.jitter = { dx: (Math.random() - 0.5) * 0.08, dz: (Math.random() - 0.5) * 0.08, yaw: (Math.random() - 0.5) * 0.18 };
      setZone(e, d.zone, null, d.slot);
    }

    // 5. destinations anonymes
    for (const [pid, def] of oppDeficit) {
      for (let k = 0; k < def; k += 1) {
        const e = this.takeFree(free, "opp", pid);
        if (!e) break;
        this.clearIdentity(e);
        setZone(e, "opp", pid, this.nextSlot("opp", pid));
      }
    }
    for (let k = 0; k < pileDeficit; k += 1) {
      const e = this.takeFree(free, "pile", null);
      if (!e) break;
      this.clearIdentity(e);
      e.jitter = { dx: (Math.random() - 0.5) * 0.7, dz: (Math.random() - 0.5) * 0.55, yaw: (Math.random() - 0.5) * 1.6 };
      setZone(e, "pile", null, this.nextSlot("pile", null));
    }
    for (let k = 0; k < discardDeficit; k += 1) {
      const e = this.takeFree(free, "discard", null);
      if (!e) break;
      this.clearIdentity(e);
      e.jitter = { dx: (Math.random() - 0.5) * 0.3, dz: (Math.random() - 0.5) * 0.2, yaw: (Math.random() - 0.5) * 0.5 };
      setZone(e, "discard", null, this.nextSlot("discard", null));
    }
    for (const e of free) {
      this.clearIdentity(e);
      setZone(e, "deck", null, this.nextSlot("deck", null));
    }

    this.layoutAll();
    if (instant) {
      E.forEach((e) => this.snap(e));
      return moves;
    }
    this.scheduleFlights(moves, { deal });
    return moves;
  }

  scheduleFlights(moves, { deal, seatOrder }) {
    if (!moves.length) return;
    if (deal) {
      const buckets = new Map();
      for (const m of moves) {
        const key = m.toZone === "me" ? "__me" : m.toOwner || m.toZone;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(m);
      }
      for (const list of buckets.values()) list.sort((a, b) => a.e.slot - b.e.slot);
      const order = [];
      const keys = [...buckets.keys()];
      let added = true;
      let round = 0;
      while (added) {
        added = false;
        for (const k of keys) {
          const m = buckets.get(k)[round];
          if (m) {
            order.push(m);
            added = true;
          }
        }
        round += 1;
      }
      order.forEach((m, i) => this.startFlight(m.e, { delay: i * 0.03, dur: 0.46, arc: 0.8, sound: "deal" }));
      return;
    }

    const groups = new Map();
    for (const m of moves) {
      const key = `${m.fromZone}:${m.fromOwner}>${m.toZone}:${m.toOwner}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    let baseDelay = 0;
    for (const list of groups.values()) {
      list.sort((a, b) => a.e.slot - b.e.slot);
      const to = list[0].toZone;
      const from = list[0].fromZone;
      let step = 0.05;
      let dur = 0.6;
      let arc = 1.1;
      let sound = "flick";
      if (to === "pile" || to === "table") { step = 0.14; dur = 0.55; arc = 0.9; sound = "flick"; }
      else if (to === "discard") { step = 0.025; dur = 0.55; arc = 0.5; sound = "pickup"; }
      else if (to === "reveal") { step = 0.16; dur = 0.7; arc = 0.5; sound = "flip"; }
      else if (to === "tray") { step = 0.09; dur = 0.75; arc = 1.2; sound = "flick"; }
      else if (to === "me" && (from === "pile" || from === "reveal")) { step = 0.05; dur = 0.62; arc = 0.25; sound = "pickup"; }
      else if (to === "opp" && (from === "pile" || from === "reveal")) { step = 0.04; dur = 0.62; arc = 1.1; sound = "pickup"; }
      else if (to === "deck") { step = 0.006; dur = 0.5; arc = 0.3; sound = null; }
      list.forEach((m, i) => this.startFlight(m.e, { delay: baseDelay + i * step, dur, arc, sound }));
      baseDelay += Math.min(0.35, list.length * step * 0.4);
    }
  }

  // ------------------------------------------------------------ layout

  layoutAll() {
    const world = this.world;
    if (!world.dims) return;
    const zones = { me: [], opp: new Map(), pile: [], reveal: [], tray: [], table: [], discard: [], deck: [], decor: [] };
    for (const e of this.entities) {
      if (e.zone === "opp") {
        if (!zones.opp.has(e.owner)) zones.opp.set(e.owner, []);
        zones.opp.get(e.owner).push(e);
      } else {
        (zones[e.zone] || zones.deck).push(e);
      }
    }
    Object.values(zones).forEach((z) => Array.isArray(z) && z.sort((a, b) => a.slot - b.slot));
    for (const list of zones.opp.values()) list.sort((a, b) => a.slot - b.slot);

    this.layoutHand(zones.me);
    for (const [pid, list] of zones.opp) this.layoutFan(pid, list);
    this.layoutPile(zones.pile);
    this.layoutReveal(zones.reveal);
    this.layoutTray(zones.tray);
    this.layoutTable(zones.table);
    this.layoutDiscard(zones.discard);
    this.layoutDeck(zones.deck);
    this.layoutDecor(zones.decor);
    this.zones = zones;
  }

  handGeometry(n) {
    const hm = this.world.handMetrics();
    const portrait = this.world.camera.aspect < 0.9;
    const cardH = hm.visH * (portrait ? 0.175 : 0.235);
    const s = cardH / CARD_WORLD_H;
    const cardW = CARD_WORLD_W * s;
    const availW = hm.visW * 0.95;
    const minStep = cardW * (portrait ? 0.2 : 0.27);
    const perRow = Math.max(1, Math.floor((availW - cardW) / minStep) + 1);
    const rows = Math.min(3, Math.max(1, Math.ceil(n / perRow)));
    return { hm, cardH, cardW, s, availW, rows, perRow: Math.ceil(n / rows) };
  }

  layoutHand(list) {
    const n = list.length;
    if (!n) return;
    const g = this.handGeometry(n);
    const { hm, cardH, cardW, s, availW, rows } = g;
    const per = g.perRow;
    for (let r = 0; r < rows; r += 1) {
      const rowCards = list.slice(r * per, (r + 1) * per);
      const m = rowCards.length;
      const step = m > 1 ? Math.min(cardW * 0.82, (availW - cardW) / (m - 1)) : 0;
      const spread = Math.min(0.28, (m - 1) * 0.035);
      const rowFromFront = rows - 1 - r;
      rowCards.forEach((e, i) => {
        const u = m > 1 ? i / (m - 1) - 0.5 : 0;
        const x = (i - (m - 1) / 2) * step;
        let y = hm.bottom + cardH * 0.4 + rowFromFront * cardH * 0.36 - Math.abs(u) * Math.abs(u) * cardH * 0.22;
        const selected = this.selected.has(e.id);
        const pressed = this.press && this.press.entity === e && !this.drag;
        // Rangee du fond : la carte choisie monte franchement. Rangees de
        // devant : elle monte moins, pour ne pas recouvrir la rangee du fond.
        const liftMax = rowFromFront === rows - 1 ? 0.24 : 0.12;
        let lift = 0;
        if (selected) lift = cardH * liftMax;
        else if (pressed) lift = cardH * Math.min(0.12, liftMax);
        else if (this.hoverId === e.id) lift = cardH * 0.07;
        y += lift; // elevation purement verticale
        const rot = -u * spread * 2;
        // Profondeur : chaque carte est nettement plus proche de la camera que
        // sa voisine de gauche (et la rangee de devant plus proche que celle
        // du fond). La position et la taille sont corrigees de la perspective,
        // donc a l'ecran rien ne change, mais l'ordre d'affichage est garanti
        // sur tous les telephones : une carte soulevee reste derriere ses
        // voisines de droite et ne les masque jamais.
        const k = r * per + i;
        const d = hm.dist - k * 0.012;
        const f = d / hm.dist;
        e.space = "camera";
        e.tPos.set(x * f, y * f, -d);
        e.tQuat.setFromEuler(new THREE.Euler(0, 0, rot));
        e.tScale = s * f;
        e.emissive = 0.62;
      });
    }
    // Hauteur occupee par la main (carte soulevee comprise), en fraction
    // de l'ecran : l'interface HTML se place au-dessus pour ne rien masquer.
    const topY = hm.bottom + cardH * 0.4 + (rows - 1) * cardH * 0.36 + cardH * 0.24 + cardH * 0.5;
    const frac = (topY + hm.visH / 2) / hm.visH;
    if (Math.abs(frac - (this.handTopFrac || 0)) > 0.002) {
      this.handTopFrac = frac;
      if (this.hooks.onHandTop) this.hooks.onHandTop(frac);
    }
  }

  layoutFan(pid, list) {
    const phi = this.seatPhi.get(pid);
    if (phi === undefined) {
      list.forEach((e) => this.layoutHidden(e));
      return;
    }
    const world = this.world;
    const base = world.seatPoint(phi, 0.8);
    const cam = world.gamePose ? world.gamePose.position : world.camera.position;
    const awayYaw = Math.atan2(base.x - cam.x, base.z - cam.z);
    const outYaw = Math.atan2(base.x, base.z);
    const yaw = awayYaw * 0.75 + outYaw * 0.25;
    const tilt = 0.72;
    const s = 0.8;
    const m = list.length;
    const da = m > 1 ? Math.min(0.13, 1.25 / m) : 0;
    const radius = CARD_WORLD_H * s * 1.15;
    const seatQ = yawQuat(yaw).multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), tilt));
    const glow = this.turnGlowOwner === pid;
    const qa = new THREE.Quaternion();
    const corner = V();
    let minY = Infinity;
    const hw = (CARD_WORLD_W * s) / 2;
    const hh = (CARD_WORLD_H * s) / 2;
    list.forEach((e, j) => {
      const a = (j - (m - 1) / 2) * da;
      const local = V(Math.sin(a) * radius, Math.cos(a) * radius - radius, -j * 0.0035);
      local.applyQuaternion(seatQ);
      e.space = "world";
      e.tPos.copy(base).add(local);
      qa.setFromAxisAngle(V(0, 0, 1), -a);
      e.tQuat.copy(seatQ).multiply(qa);
      // point le plus bas de la carte (ses 4 coins)
      for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]]) {
        corner.set(cx, cy, 0).applyQuaternion(e.tQuat).add(e.tPos);
        minY = Math.min(minY, corner.y);
      }
      e.tScale = s;
      e.emissive = 0.14;
      e.glowTarget = glow ? 0.55 : 0;
      e.glowColor.set(0xffc94d);
    });
    // on souleve tout l'eventail pour qu'aucune carte ne traverse le plateau
    const lift = 0.05 - minY;
    list.forEach((e) => { e.tPos.y += lift; });
  }

  layoutPile(list) {
    const p = this.world.anchors.pile;
    list.forEach((e, k) => {
      e.space = "world";
      e.tPos.set(p.x + e.jitter.dx, 0.014 + k * 0.0048, p.z + e.jitter.dz);
      e.tQuat.copy(yawQuat(e.jitter.yaw)).multiply(Q_FACE_DOWN);
      e.tScale = 1;
      e.emissive = 0.1;
      e.glowTarget = 0;
    });
  }

  layoutReveal(list) {
    const m = list.length;
    if (!m) return;
    const hm = this.world.handMetrics();
    const cardH = hm.visH * 0.3;
    const s = cardH / CARD_WORLD_H;
    const cardW = CARD_WORLD_W * s;
    const step = Math.min(cardW * 1.1, (hm.visW * 0.9 - cardW) / Math.max(1, m - 1));
    list.forEach((e, j) => {
      e.space = "camera";
      e.tPos.set((j - (m - 1) / 2) * step, hm.visH * 0.07, -hm.dist + 0.001 * j);
      e.tQuat.setFromEuler(new THREE.Euler(0, 0, (j - (m - 1) / 2) * -0.06));
      e.tScale = s;
      e.emissive = 0.7;
      e.glowTarget = this.revealClaim ? 0.85 : 0;
      e.glowColor.set(this.revealClaim && e.card ? (e.card.rank === this.revealClaim ? 0x3ee07f : 0xff3b3b) : 0xffd35a);
    });
  }

  layoutTray(list) {
    const tray = this.world.tray;
    if (!tray) return;
    const rot = yawQuat(tray.rotation.y);
    list.forEach((e) => {
      const q = e.quad;
      const col = q % 3;
      const row = Math.floor(q / 3) % 2;
      const layer = Math.floor(q / 6);
      const local = V((col - 1) * 0.46 + e.qj * 0.05 - 0.07, 0.07 + layer * 0.012 + e.qj * 0.0025, (row - 0.5) * 0.47);
      local.applyQuaternion(rot);
      e.space = "world";
      e.tPos.copy(tray.position).add(local);
      e.tQuat.copy(rot).multiply(yawQuat(-0.12 + e.qj * 0.08)).multiply(Q_FACE_UP);
      e.tScale = 0.5;
      e.emissive = 0.2;
      e.glowTarget = 0;
    });
  }

  // Pli du President : chaque pose est un petit eventail face visible, les
  // poses precedentes restent visibles en dessous, decalees vers le fond.
  layoutTable(list) {
    const p = this.world.anchors.pile;
    let maxPlay = 0;
    for (const e of list) maxPlay = Math.max(maxPlay, e.quad);
    list.forEach((e) => {
      const age = maxPlay - e.quad;
      const m = e.qsize || 1;
      const side = e.quad % 2 === 0 ? 1 : -1;
      const off = Math.min(age, 4);
      const x = p.x + (e.qj - (m - 1) / 2) * 0.24 + side * off * 0.09 + e.jitter.dx;
      const z = p.z - off * 0.2 + 0.1 + e.jitter.dz;
      const yaw = (e.qj - (m - 1) / 2) * -0.1 + side * off * 0.07 + e.jitter.yaw;
      e.space = "world";
      e.tPos.set(x, 0.016 + e.quad * 0.01 + e.qj * 0.002, z);
      e.tQuat.copy(yawQuat(yaw)).multiply(Q_FACE_UP);
      e.tScale = 1;
      e.emissive = age === 0 ? 0.3 : 0.14;
      e.glowTarget = age === 0 ? 0.35 : 0;
      e.glowColor.set(0xffd35a);
    });
  }

  layoutDiscard(list) {
    const tray = this.world.tray;
    if (!tray) return;
    const rot = yawQuat(tray.rotation.y);
    list.forEach((e, k) => {
      const local = V(e.jitter.dx, 0.07 + k * 0.0035, e.jitter.dz).applyQuaternion(rot);
      e.space = "world";
      e.tPos.copy(tray.position).add(local);
      e.tQuat.copy(rot).multiply(yawQuat(e.jitter.yaw)).multiply(Q_FACE_DOWN);
      e.tScale = 0.62;
      e.emissive = 0.1;
      e.glowTarget = 0;
    });
  }

  layoutDeck(list) {
    const p = this.world.anchors.pile;
    list.forEach((e, k) => {
      e.space = "world";
      e.tPos.set(p.x + 0.02 * Math.sin(k * 1.7), 0.014 + k * 0.0045, p.z + 0.02 * Math.cos(k * 2.3));
      e.tQuat.copy(yawQuat(0.15 + Math.sin(k) * 0.03)).multiply(Q_FACE_DOWN);
      e.tScale = 1;
      e.emissive = 0.1;
      e.glowTarget = 0;
    });
  }

  layoutDecor(list) {
    const p = this.world.anchors.pile;
    list.forEach((e) => {
      const i = e.slot;
      e.space = "world";
      e.tScale = 1;
      e.emissive = 0.14;
      e.glowTarget = 0;
      if (i < 4) {
        const a = (i - 1.5) * 0.22;
        e.tPos.set(p.x - 0.1 + Math.sin(a) * 0.9, 0.03 + i * 0.004, p.z + 0.35 - Math.cos(a) * 0.9 + 0.9);
        e.tQuat.copy(yawQuat(-a)).multiply(Q_FACE_UP);
      } else if (i < 7) {
        const k = i - 4;
        e.tPos.set(p.x + 1.25 + k * 0.1, 0.02 + k * 0.004, p.z - 0.6 + k * 0.25);
        e.tQuat.copy(yawQuat(-0.5 + k * 0.35)).multiply(Q_FACE_UP);
      } else {
        const k = i - 7;
        e.tPos.set(p.x - 1.3 + k * 0.05, 0.02 + k * 0.004, p.z - 0.5 + k * 0.03);
        e.tQuat.copy(yawQuat(0.4 + k * 0.25)).multiply(Q_FACE_DOWN);
      }
    });
  }

  layoutHidden(e) {
    e.space = "world";
    e.tPos.set(0, -3, 0);
    e.tQuat.identity();
    e.tScale = 0.001;
  }

  // ------------------------------------------------------------ mouvements

  worldTarget(e, outPos, outQuat) {
    if (e.dragPos) {
      outPos.copy(e.dragPos).applyMatrix4(this.world.camera.matrixWorld);
      outQuat.copy(this.world.camera.quaternion).multiply(e.dragQuat);
      return;
    }
    if (this.pendingDropIds.has(e.id) && e.zone === "me") {
      const p = this.world.anchors.pile;
      outPos.set(p.x + (e.slot % 4) * 0.1 - 0.12, 0.55 + (e.slot % 4) * 0.02, p.z);
      outQuat.copy(yawQuat(0.1)).multiply(this.pendingFaceUp ? Q_FACE_UP : Q_FACE_DOWN);
      return;
    }
    if (e.space === "camera") {
      outPos.copy(e.tPos).applyMatrix4(this.world.camera.matrixWorld);
      outQuat.copy(this.world.camera.quaternion).multiply(e.tQuat);
    } else {
      outPos.copy(e.tPos);
      outQuat.copy(e.tQuat);
    }
  }

  targetScale(e) {
    if (e.dragPos) return e.tScale * 1.05;
    if (this.pendingDropIds.has(e.id) && e.zone === "me") return 1;
    return e.tScale;
  }

  startFlight(e, { delay = 0, dur = 0.6, arc = 1, sound = null } = {}) {
    e.flight = {
      fromPos: e.group.position.clone(),
      fromQuat: e.group.quaternion.clone(),
      fromScale: e.group.scale.x,
      t: -delay,
      dur,
      arc,
      sound
    };
  }

  snap(e) {
    this.worldTarget(e, this.tmpPos, this.tmpQuat);
    e.group.position.copy(this.tmpPos);
    e.group.quaternion.copy(this.tmpQuat);
    e.group.scale.setScalar(this.targetScale(e));
    e.flight = null;
  }

  update(dt, time) {
    const pos = this.tmpPos;
    const quat = this.tmpQuat;
    const k = 1 - Math.exp(-dt * 13);
    let landed = 0;
    let landSound = null;
    for (const e of this.entities) {
      this.worldTarget(e, pos, quat);
      const ts = this.targetScale(e);
      const g = e.group;
      if (e.flight) {
        const f = e.flight;
        f.t += dt;
        if (f.t < 0) {
          g.position.copy(f.fromPos);
          g.quaternion.copy(f.fromQuat);
        } else {
          const u = Math.min(1, f.t / f.dur);
          const eu = easeInOut(u);
          g.position.lerpVectors(f.fromPos, pos, eu);
          g.position.y += Math.sin(Math.PI * u) * f.arc;
          g.quaternion.slerpQuaternions(f.fromQuat, quat, eu);
          g.scale.setScalar(f.fromScale + (ts - f.fromScale) * eu);
          if (u >= 1) {
            if (f.sound) {
              landed += 1;
              landSound = f.sound;
            }
            e.flight = null;
          }
        }
      } else {
        g.position.lerp(pos, k);
        g.quaternion.slerp(quat, k);
        const sc = g.scale.x + (ts - g.scale.x) * k;
        g.scale.setScalar(sc);
      }

      // eclairage propre, halo et ombres
      const ud = g.userData;
      const inCamera = e.space === "camera" || !!e.dragPos;
      const emissive = inCamera ? e.emissive : e.emissive;
      ud.frontMat.emissiveIntensity += (emissive - ud.frontMat.emissiveIntensity) * k;
      ud.backMat.emissiveIntensity += ((inCamera ? 0.5 : e.zone === "opp" ? 0.16 : 0.1) - ud.backMat.emissiveIntensity) * k;
      ud.back.castShadow = !inCamera;

      let glowT = e.glowTarget;
      if (e.zone === "me") {
        if (e.dragPos) glowT = 0.95;
        else if (this.selected.has(e.id)) glowT = 0.9;
        else if (this.turnGlowOwner === "__me") glowT = 0.18 + Math.sin(time * 3.2 + e.slot * 0.35) * 0.12;
        else glowT = 0;
      }
      ud.glowMat.opacity += (glowT - ud.glowMat.opacity) * k;
      ud.glowMat.color.lerp(e.glowColor, k);
      ud.glow.visible = ud.glowMat.opacity > 0.01;
    }
    if (landed && this.hooks.onLand) this.hooks.onLand(landSound, landed);
  }

  // ------------------------------------------------------------ interaction

  setInteractive(on) {
    this.interactive = on;
    if (!on) {
      this.cancelDrag();
    }
  }

  setTurnGlow(owner) {
    this.turnGlowOwner = owner;
    this.layoutAll();
  }

  // Pendant une revelation : halo vert pour les cartes sinceres, rouge pour les bluffs.
  setRevealClaim(rank) {
    this.revealClaim = rank;
    this.layoutAll();
  }

  setHandOrder(ids) {
    const index = new Map(ids.map((id, i) => [id, i]));
    for (const e of this.entities) if (e.zone === "me" && index.has(e.id)) e.slot = index.get(e.id);
    this.layoutAll();
  }

  getSelected() {
    return this.entities.filter((e) => e.zone === "me" && this.selected.has(e.id)).sort((a, b) => a.slot - b.slot).map((e) => e.id);
  }

  clearSelection() {
    this.selected.clear();
    this.layoutAll();
  }

  pruneSelection(handIds) {
    const set = new Set(handIds);
    for (const id of [...this.selected]) if (!set.has(id)) this.selected.delete(id);
    for (const id of [...this.pendingDropIds]) if (!set.has(id)) this.pendingDropIds.delete(id);
  }

  setPendingDrop(ids) {
    this.pendingDropIds = new Set(ids);
    this.layoutAll();
  }

  clearPendingDrop() {
    this.pendingDropIds.clear();
    this.layoutAll();
  }

  bindPointer() {
    const el = this.world.canvas;
    el.addEventListener("pointerdown", (ev) => this.onDown(ev));
    window.addEventListener("pointermove", (ev) => this.onMove(ev));
    window.addEventListener("pointerup", (ev) => this.onUp(ev));
    window.addEventListener("pointercancel", () => this.cancelDrag());
  }

  setNdc(ev) {
    const rect = this.world.canvas.getBoundingClientRect();
    this.pointerNdc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  }

  pickHand() {
    this.raycaster.setFromCamera(this.pointerNdc, this.world.camera);
    const fronts = this.entities.filter((e) => e.zone === "me" && !e.flight).map((e) => e.group.userData.front);
    const hits = this.raycaster.intersectObjects(fronts, false);
    if (!hits.length) return null;
    return this.entities.find((e) => e.group.userData.front === hits[0].object) || null;
  }

  pickTable() {
    this.raycaster.setFromCamera(this.pointerNdc, this.world.camera);
    if (this.world.tray) {
      const hits = this.raycaster.intersectObject(this.world.tray, true);
      if (hits.length) return "tray";
    }
    const trayCards = this.entities.filter((e) => e.zone === "tray").map((e) => e.group.userData.front);
    if (trayCards.length && this.raycaster.intersectObjects(trayCards, false).length) return "tray";
    if (this.raycaster.intersectObject(this.world.pileRing, false).length) return "pile";
    return null;
  }

  overPile() {
    const p = this.world.anchors.pile;
    const c = p.clone().project(this.world.camera);
    const fr = this.world.feltRadius;
    const ex = p.clone().add(V(fr.x * 0.85, 0, 0)).project(this.world.camera);
    const ez = p.clone().add(V(0, 0, fr.z * 0.95)).project(this.world.camera);
    const rx = Math.abs(ex.x - c.x);
    const ry = Math.abs(ez.y - c.y) * 1.25;
    const dx = (this.pointerNdc.x - c.x) / rx;
    const dy = (this.pointerNdc.y - c.y) / ry;
    return dx * dx + dy * dy <= 1;
  }

  onDown(ev) {
    this.setNdc(ev);
    if (this.interactive) {
      const e = this.pickHand();
      if (e) {
        ev.preventDefault();
        this.press = { entity: e, x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId };
        try { this.world.canvas.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
        this.layoutAll();
        if (this.hooks.onTouchCard) this.hooks.onTouchCard();
        return;
      }
    }
    const t = this.pickTable();
    if (t === "tray" && this.hooks.onTrayClick) this.hooks.onTrayClick();
    else if (t === "pile" && this.hooks.onPileClick) this.hooks.onPileClick();
  }

  onMove(ev) {
    this.setNdc(ev);
    if (this.press && !this.drag) {
      const d = Math.hypot(ev.clientX - this.press.x, ev.clientY - this.press.y);
      if (d > 9) this.beginDrag();
    }
    if (this.drag) {
      this.updateDrag();
      return;
    }
    if (ev.pointerType === "mouse" && this.interactive) {
      const e = this.pickHand();
      const id = e ? e.id : null;
      if (id !== this.hoverId) {
        this.hoverId = id;
        this.layoutAll();
      }
      this.world.canvas.style.cursor = e ? "grab" : "";
    }
  }

  beginDrag() {
    const e = this.press.entity;
    if (!this.selected.has(e.id)) {
      if (this.selected.size >= this.maxSelect) {
        this.selected.clear();
      }
      this.selected.add(e.id);
    }
    const ids = this.getSelected();
    this.drag = { ids, lead: e.id };
    this.world.canvas.style.cursor = "grabbing";
    this.updateDrag();
  }

  updateDrag() {
    const cam = this.world.camera;
    const hm = this.world.handMetrics();
    const d = hm.dist * 1.05;
    const halfH = d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const halfW = halfH * cam.aspect;
    const px = this.pointerNdc.x * halfW;
    const py = this.pointerNdc.y * halfH;
    const over = this.overPile();
    const legal = over && this.hooks.canDrop ? this.hooks.canDrop(this.drag.ids) : false;
    const color = over ? (legal ? 0x3ee07f : 0xff4040) : 0xffd35a;
    this.drag.over = over;
    this.drag.legal = legal;
    const n = this.drag.ids.length;
    this.drag.ids.forEach((id, i) => {
      const e = this.entities.find((x) => x.id === id && x.zone === "me");
      if (!e) return;
      e.dragPos = V(px + (i - (n - 1) / 2) * 0.05, py + 0.02 - i * 0.012, -d + i * 0.003);
      e.dragQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0, (i - (n - 1) / 2) * -0.12));
      e.glowColor.set(color);
    });
    this.world.setPileRing(over ? (legal ? "ok" : "bad") : "idle");
  }

  cancelDrag() {
    if (this.drag) {
      for (const e of this.entities) {
        e.dragPos = null;
        e.glowColor.set(0xffd35a);
      }
    }
    this.drag = null;
    this.press = null;
    this.world.canvas.style.cursor = "";
    if (this.hooks.onDragEnd) this.hooks.onDragEnd();
    this.layoutAll();
  }

  onUp(ev) {
    if (this.drag) {
      const { ids, over, legal } = this.drag;
      for (const e of this.entities) {
        e.dragPos = null;
        e.glowColor.set(0xffd35a);
      }
      this.drag = null;
      this.press = null;
      this.world.canvas.style.cursor = "";
      if (over && this.hooks.onDrop) this.hooks.onDrop(ids, legal);
      if (this.hooks.onDragEnd) this.hooks.onDragEnd();
      this.layoutAll();
      return;
    }
    if (this.press) {
      const e = this.press.entity;
      this.press = null;
      if (this.selected.has(e.id)) this.selected.delete(e.id);
      else if (this.selected.size < this.maxSelect) this.selected.add(e.id);
      else if (this.hooks.onSelectLimit) this.hooks.onSelectLimit();
      if (this.hooks.onSelectionChange) this.hooks.onSelectionChange(this.getSelected());
      this.layoutAll();
    }
  }

  // ------------------------------------------------------------ ancrages HUD

  seatAnchor(pid) {
    const phi = this.seatPhi.get(pid);
    if (phi === undefined) return null;
    return this.world.seatPoint(phi, 0.8).add(V(0, 1.2, 0));
  }

  isSettled(zone) {
    return !this.entities.some((e) => e.zone === zone && e.flight);
  }

  pileAnchor() {
    const p = this.world.anchors.pile;
    const n = this.zones && this.zones.pile ? this.zones.pile.length : 0;
    return V(p.x, 0.05 + n * 0.0048, p.z);
  }

  trayAnchor() {
    return this.world.tray ? this.world.tray.position.clone().add(V(0, 0.1, -0.62)) : null;
  }
}
