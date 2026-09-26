// Fabrique des cartes 3D : geometrie a coins arrondis, textures faces/dos, halo.
import * as THREE from "three";
import { CARD_W, CARD_H, CARD_RADIUS, createCardFaceCanvas, createCardBackCanvas } from "../cards/cardArt.js";
import { glowCanvas, toTexture } from "./textures.js";

export const CARD_WORLD_W = 0.63;
export const CARD_WORLD_H = CARD_WORLD_W * (CARD_H / CARD_W);

function roundedCardGeometry(w, h, r) {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ShapeGeometry(shape, 5);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) {
    uv.setXY(i, (pos.getX(i) - x) / w, (pos.getY(i) - y) / h);
  }
  uv.needsUpdate = true;
  return geo;
}

export class CardFactory {
  constructor(renderer) {
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    const r = CARD_RADIUS * (CARD_WORLD_W / CARD_W);
    this.geo = roundedCardGeometry(CARD_WORLD_W, CARD_WORLD_H, r);
    this.edgeGeo = roundedCardGeometry(CARD_WORLD_W + 0.006, CARD_WORLD_H + 0.006, r + 0.003);
    this.glowGeo = new THREE.PlaneGeometry(CARD_WORLD_W * 1.34, CARD_WORLD_H * 1.26);
    this.backTexture = toTexture(createCardBackCanvas(0.85), { anisotropy: this.maxAniso });
    this.glowTexture = toTexture(glowCanvas(), { srgb: false });
    this.faceCache = new Map();
    this.edgeMat = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.8, side: THREE.DoubleSide });
  }

  faceTexture(card) {
    const key = card.rank + "-" + card.suit;
    let t = this.faceCache.get(key);
    if (!t) {
      t = toTexture(createCardFaceCanvas(card, 0.85), { anisotropy: this.maxAniso });
      this.faceCache.set(key, t);
    }
    return t;
  }

  // Pre-genere les 52 faces pendant les temps morts pour eviter les saccades.
  warmup(cards) {
    const queue = cards.slice();
    const step = (deadline) => {
      let n = 0;
      while (queue.length && (deadline ? deadline.timeRemaining() > 6 : n < 3)) {
        this.faceTexture(queue.shift());
        n += 1;
      }
      if (queue.length) schedule();
    };
    const schedule = () => {
      if (window.requestIdleCallback) requestIdleCallback(step, { timeout: 400 });
      else setTimeout(() => step(null), 30);
    };
    schedule();
  }

  createCard() {
    const group = new THREE.Group();
    const frontMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.55, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.12
    });
    const backMat = new THREE.MeshStandardMaterial({
      map: this.backTexture, roughness: 0.5, metalness: 0, emissive: 0xffffff, emissiveMap: this.backTexture, emissiveIntensity: 0.1
    });
    const front = new THREE.Mesh(this.geo, frontMat);
    front.position.z = 0.0012;
    const back = new THREE.Mesh(this.geo, backMat);
    back.rotation.y = Math.PI;
    back.position.z = -0.0012;
    const edge = new THREE.Mesh(this.edgeGeo, this.edgeMat);
    edge.scale.z = 1;
    const glowMat = new THREE.MeshBasicMaterial({
      map: this.glowTexture, color: 0xffd35a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const glow = new THREE.Mesh(this.glowGeo, glowMat);
    glow.position.z = -0.004;
    glow.renderOrder = 1;
    back.castShadow = true;
    front.receiveShadow = back.receiveShadow = true;
    group.add(glow, edge, back, front);
    group.userData = { front, back, glow, frontMat, backMat, glowMat };
    return group;
  }

  setFace(group, card) {
    const { frontMat } = group.userData;
    if (!card) {
      frontMat.map = this.backTexture;
      frontMat.emissiveMap = this.backTexture;
    } else {
      const t = this.faceTexture(card);
      frontMat.map = t;
      frontMat.emissiveMap = t;
    }
    frontMat.needsUpdate = true;
  }
}
