// Scene 3D : le bar, la table en bois, la lampe, les accessoires et la camera.
import * as THREE from "three";
import { woodCanvas, feltCanvas, coasterCanvas, tokenCanvas, ringGlowCanvas, toTexture } from "./textures.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    const isMobile = matchMedia("(pointer: coarse)").matches;
    this.isMobile = isMobile;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.75 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#140b06");
    this.scene.fog = new THREE.Fog("#140b06", 16, 38);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.05, 90);
    this.camera.position.set(0, 8, 9);
    this.camera.lookAt(0, 0, 0);

    this.clock = new THREE.Timer();
    this.frameCallbacks = [];
    this.mode = "home";
    this.orbitAngle = 0.6;
    this.camAnim = null;
    this.opponentPhis = [];
    this.dims = null;

    this.buildTextures();
    this.buildLights();
    this.buildRoom();
    this.buildToken();
    this.buildPileRing();
    this.propsGroup = new THREE.Group();
    this.scene.add(this.propsGroup);

    this.resize();
    window.addEventListener("resize", () => this.scheduleResize());
    window.addEventListener("orientationchange", () => this.scheduleResize());
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------ construction

  buildTextures() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.tex = {
      top: toTexture(woodCanvas({ planks: 6, base: "#8a5530", seed: 11, knots: 4 }), { repeat: [0.14, 0.14], anisotropy: maxAniso }),
      rim: toTexture(woodCanvas({ planks: 4, base: "#4a2814", seed: 5, knots: 1, gapColor: "rgba(20,10,4,0.3)" }), { repeat: [0.2, 0.2], anisotropy: maxAniso }),
      floor: toTexture(woodCanvas({ planks: 8, base: "#3a2414", seed: 23, knots: 6 }), { repeat: [5, 5], anisotropy: maxAniso }),
      felt: toTexture(feltCanvas(512, "#1d5a3a"), { repeat: [2, 2] }),
      token: toTexture(tokenCanvas(256)),
      ring: toTexture(ringGlowCanvas(512), { srgb: false })
    };
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffe0b8, 0x2a150a, 0.75);
    this.scene.add(this.hemi);

    this.spot = new THREE.SpotLight(0xffc88a, 420, 0, 0.78, 0.6, 2);
    this.spot.position.set(0, 10.5, 0.4);
    this.spot.target.position.set(0, 0, 0);
    this.spot.castShadow = true;
    const sm = this.isMobile ? 1024 : 2048;
    this.spot.shadow.mapSize.set(sm, sm);
    this.spot.shadow.bias = -0.0004;
    this.spot.shadow.normalBias = 0.02;
    this.spot.shadow.camera.near = 4;
    this.spot.shadow.camera.far = 18;
    this.scene.add(this.spot, this.spot.target);

    this.warm = new THREE.PointLight(0xff8a3c, 60, 30, 2);
    this.warm.position.set(-8, 4, 5);
    this.scene.add(this.warm);
    this.cool = new THREE.PointLight(0x7f9cff, 18, 30, 2);
    this.cool.position.set(9, 5, -6);
    this.scene.add(this.cool);
  }

  buildRoom() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshStandardMaterial({ map: this.tex.floor, roughness: 0.85, color: 0x9a8070 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -7.4;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const darkWood = new THREE.MeshStandardMaterial({ map: this.tex.rim, roughness: 0.45, metalness: 0.05 });
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, 7.2, 32), darkWood);
    pedestal.position.y = -3.8;
    pedestal.castShadow = true;
    this.scene.add(pedestal);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.25, 48), darkWood);
    foot.position.y = -7.28;
    this.scene.add(foot);

    // lampe suspendue facon billard
    this.lamp = new THREE.Group();
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0x1f4a33, roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide });
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.7, 1.0, 40, 1, true), shadeMat);
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 1.68, 0.98, 40, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff1d0, side: THREE.BackSide })
    );
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 16), new THREE.MeshBasicMaterial({ color: 0xfff4d6 }));
    bulb.position.y = -0.35;
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9962b, metalness: 0.9, roughness: 0.3 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.36, 0.2, 24), brass);
    cap.position.y = 0.55;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    cord.position.y = 6.6;
    this.lamp.add(shade, inner, bulb, cap, cord);
    this.lamp.position.set(0, 7.2, 0);
    this.scene.add(this.lamp);

    // cone de lumiere poussiereuse
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 5.2, 7, 40, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.022, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    );
    beam.position.y = 3.3;
    this.beam = beam;
    this.scene.add(beam);

    // lumieres floues du bar au loin
    const dot = document.createElement("canvas");
    dot.width = dot.height = 64;
    const dctx = dot.getContext("2d");
    const g = dctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    dctx.fillStyle = g;
    dctx.fillRect(0, 0, 64, 64);
    const dotTex = toTexture(dot);
    this.bokeh = new THREE.Group();
    const colors = [0xffb35c, 0xff7a3d, 0xffd89a, 0xff5c5c, 0x9fb7ff];
    for (let i = 0; i < 46; i += 1) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: dotTex, color: colors[i % colors.length], transparent: true, opacity: 0.35 + Math.random() * 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      }));
      const a = Math.random() * Math.PI * 2;
      const r = 22 + Math.random() * 16;
      s.position.set(Math.sin(a) * r, 1 + Math.random() * 9, Math.cos(a) * r);
      const sc = 0.8 + Math.random() * 2.6;
      s.scale.set(sc, sc, 1);
      this.bokeh.add(s);
    }
    this.scene.add(this.bokeh);
  }

  buildToken() {
    const brass = new THREE.MeshStandardMaterial({ color: 0xd9a640, metalness: 0.85, roughness: 0.28, emissive: 0x3a2400, emissiveIntensity: 0.4 });
    const top = new THREE.MeshStandardMaterial({ map: this.tex.token, metalness: 0.7, roughness: 0.35, emissive: 0xffc860, emissiveMap: this.tex.token, emissiveIntensity: 0.25 });
    const geo = new THREE.CylinderGeometry(0.34, 0.34, 0.08, 48);
    this.token = new THREE.Mesh(geo, [brass, top, brass]);
    this.token.castShadow = true;
    this.token.position.set(0, 0.05, 0);
    this.token.visible = false;
    this.tokenTopMat = top;
    this.tokenFlight = null;
    this.scene.add(this.token);
  }

  buildPileRing() {
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex.ring, color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.pileRing = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), mat);
    this.pileRing.rotation.x = -Math.PI / 2;
    this.pileRing.position.y = 0.015;
    this.pileRing.renderOrder = 2;
    this.scene.add(this.pileRing);
    this.ringState = "hidden";
    this.ringColor = new THREE.Color(0xffd27a);
  }

  tableDimsFor(aspect) {
    const t = clamp((aspect - 0.5) / (1.45 - 0.5), 0, 1);
    return { ax: lerp(3.05, 5.7, t), az: lerp(4.75, 3.95, t) };
  }

  buildTable(dims) {
    if (this.tableGroup) {
      this.scene.remove(this.tableGroup);
      this.tableGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.dims = dims;
    const { ax, az } = dims;
    const g = new THREE.Group();

    // plateau en lattes
    const topShape = new THREE.Shape();
    topShape.absellipse(0, 0, ax, az, 0, Math.PI * 2, false, 0);
    const topGeo = new THREE.ExtrudeGeometry(topShape, { depth: 0.3, bevelEnabled: false, curveSegments: 72 });
    topGeo.rotateX(-Math.PI / 2);
    topGeo.translate(0, -0.3, 0);
    const topMat = new THREE.MeshPhysicalMaterial({ map: this.tex.top, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.35 });
    const top = new THREE.Mesh(topGeo, topMat);
    top.receiveShadow = true;
    g.add(top);

    // rebord en bois fonce verni
    const rimShape = new THREE.Shape();
    rimShape.absellipse(0, 0, ax + 0.12, az + 0.12, 0, Math.PI * 2, false, 0);
    const hole = new THREE.Path();
    hole.absellipse(0, 0, ax - 0.34, az - 0.34, 0, Math.PI * 2, true, 0);
    rimShape.holes.push(hole);
    const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 5, curveSegments: 90 });
    rimGeo.rotateX(-Math.PI / 2);
    rimGeo.translate(0, -0.3, 0);
    const rimMat = new THREE.MeshPhysicalMaterial({ map: this.tex.rim, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.2, color: 0xc89a78 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.castShadow = true;
    rim.receiveShadow = true;
    g.add(rim);

    // tapis de feutre central + filet de laiton
    const pile = this.anchorsFor(dims).pile;
    const frx = Math.min(1.95, ax * 0.56);
    const frz = Math.min(1.75, az * 0.38);
    const feltShape = new THREE.Shape();
    feltShape.absellipse(0, 0, frx, frz, 0, Math.PI * 2, false, 0);
    const feltGeo = new THREE.ShapeGeometry(feltShape, 64);
    feltGeo.rotateX(-Math.PI / 2);
    const felt = new THREE.Mesh(feltGeo, new THREE.MeshStandardMaterial({ map: this.tex.felt, roughness: 0.95, color: 0xffffff }));
    felt.position.set(pile.x, 0.004, pile.z);
    felt.receiveShadow = true;
    g.add(felt);

    const inlayShape = new THREE.Shape();
    inlayShape.absellipse(0, 0, frx + 0.07, frz + 0.07, 0, Math.PI * 2, false, 0);
    const inlayHole = new THREE.Path();
    inlayHole.absellipse(0, 0, frx + 0.015, frz + 0.015, 0, Math.PI * 2, true, 0);
    inlayShape.holes.push(inlayHole);
    const inlayGeo = new THREE.ShapeGeometry(inlayShape, 64);
    inlayGeo.rotateX(-Math.PI / 2);
    const inlay = new THREE.Mesh(inlayGeo, new THREE.MeshStandardMaterial({ color: 0xd4a444, metalness: 0.85, roughness: 0.3 }));
    inlay.position.set(pile.x, 0.006, pile.z);
    g.add(inlay);

    this.feltRadius = { x: frx, z: frz };
    this.tableGroup = g;
    this.scene.add(g);
    this.anchors = this.anchorsFor(dims);
    this.pileRing.position.x = this.anchors.pile.x;
    this.pileRing.position.z = this.anchors.pile.z;
    this.buildTray();
  }

  anchorsFor({ ax, az }) {
    return {
      pile: V(0, 0, -0.08 * az),
      tray: V(-(ax - 0.34) * 0.6, 0, 0.36 * az),
      myToken: V(0.62 * ax, 0, 0.5 * az),
      center: V(0, 0, 0)
    };
  }

  buildTray() {
    if (this.tray) this.scene.remove(this.tray);
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ map: this.tex.rim, roughness: 0.4, color: 0xd8b090 });
    const w = 1.5;
    const d = 1.05;
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), wood);
    base.position.y = 0.025;
    base.receiveShadow = true;
    g.add(base);
    for (const [x, z, sx, sz] of [[0, -d / 2, w, 0.06], [0, d / 2, w, 0.06], [-w / 2, 0, 0.06, d], [w / 2, 0, 0.06, d]]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.12, sz), wood);
      side.position.set(x, 0.07, z);
      side.castShadow = true;
      g.add(side);
    }
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, d - 0.1), new THREE.MeshStandardMaterial({ color: 0x4d1420, roughness: 0.95 }));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.052;
    inner.receiveShadow = true;
    g.add(inner);
    g.position.copy(this.anchors.tray);
    g.rotation.y = 0.12;
    g.userData.kind = "tray";
    this.tray = g;
    this.scene.add(g);
  }

  // Positions des sieges sur l'ellipse. phi = 0 : moi (vers la camera).
  seatPoint(phi, k = 0.8) {
    const { ax, az } = this.dims;
    // en portrait l'ecran est etroit : on rapproche les joueurs lateraux du centre
    const kx = this.camera.aspect < 0.9 ? k * 0.8 : k;
    return V(Math.sin(phi) * ax * kx, 0, Math.cos(phi) * az * k);
  }

  static opponentPhis(n) {
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(THREE.MathUtils.degToRad(62 + (236 * (i + 0.5)) / n));
    return out;
  }

  setOpponents(n) {
    this.opponentPhis = World.opponentPhis(n);
    this.rebuildProps();
    if (this.mode !== "home") this.fitCamera(true);
  }

  rebuildProps() {
    this.propsGroup.clear();
    const labels = [["CHEZ", "MATHIS"], ["CHEZ", "MATTEO"], ["LE", "MENTEUR"], ["BAR", "DU COIN"]];
    this.opponentPhis.forEach((phi, i) => {
      if (i % 2 === 1 && this.opponentPhis.length > 4) return;
      const side = phi < Math.PI ? 1 : -1;
      const p = this.seatPoint(phi + side * 0.42, 0.77);
      const pint = makePint(i);
      const coaster = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.36, 0.02, 36),
        [
          new THREE.MeshStandardMaterial({ color: 0xd8c7a0, roughness: 0.9 }),
          new THREE.MeshStandardMaterial({ map: toTexture(coasterCanvas(256, i + 1, labels[i % labels.length])), roughness: 0.85 }),
          new THREE.MeshStandardMaterial({ color: 0xd8c7a0 })
        ]
      );
      coaster.position.set(p.x, 0.012, p.z);
      coaster.rotation.y = Math.random() * 6;
      coaster.receiveShadow = true;
      pint.position.set(p.x, 0.02, p.z);
      this.propsGroup.add(coaster, pint);
    });
  }

  // ------------------------------------------------------------ camera

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    const inGame = mode !== "home";
    this.lamp.visible = !inGame;
    this.beam.visible = !inGame;
    this.fitCamera(false);
  }

  isShort() {
    return (window.innerHeight || 800) < 520;
  }

  railPx() {
    return this.isShort() ? 50 : 66;
  }

  // Part de la hauteur d'ecran occupee par la main + le rail en bois.
  handFraction() {
    const aspect = this.camera.aspect;
    const h = window.innerHeight || 800;
    const cards = this.isShort() ? 0.22 : aspect < 0.8 ? 0.2 : 0.24;
    return cards + this.railPx() / h;
  }

  // Points qui doivent rester visibles, avec une marge laterale propre a chacun
  // (les etiquettes des joueurs sont plus larges que les cartes).
  keyPoints() {
    const pts = [];
    const w = window.innerWidth || 1000;
    const plateLim = Math.max(0.45, 1 - (2 * (w < 600 ? 58 : 76)) / w);
    const cardLim = 0.94;
    const add = (v, lim = cardLim) => pts.push({ v, lim });
    const p = this.anchors.pile;
    const fr = this.feltRadius;
    add(V(p.x - fr.x, 0, p.z));
    add(V(p.x + fr.x, 0, p.z));
    add(V(p.x, 0, p.z - fr.z - 0.2));
    add(V(p.x, 0, p.z + fr.z));
    for (const phi of this.opponentPhis) {
      const s = this.seatPoint(phi, 0.8);
      add(s.clone().add(V(0, 1.2, 0)), plateLim);
      add(s.clone(), cardLim);
    }
    if (!this.opponentPhis.length) add(V(0, 0.8, -this.dims.az * 0.8));
    const t = this.anchors.tray;
    add(t.clone().add(V(-0.8, 0, -0.5)));
    add(t.clone().add(V(0.8, 0, 0.6)));
    return pts;
  }

  computeGamePose() {
    const aspect = this.camera.aspect;
    const portrait = aspect < 0.9;
    const fov = portrait ? 58 : aspect < 1.3 ? 50 : 44;
    const elev = THREE.MathUtils.degToRad(portrait ? 63 : 53);
    const dir = V(0, Math.sin(elev), Math.cos(elev));
    const cam = new THREE.PerspectiveCamera(fov, aspect, 0.05, 90);
    const pts = this.keyPoints();
    // on garde de la place en haut pour la plaque d'annonce + une etiquette de joueur
    const hPx = window.innerHeight || 800;
    const reserve = this.isShort() ? 58 : portrait ? 150 : 142;
    const safeTop = 1 - (2 * reserve) / hPx;
    const safeBottom = -1 + 2 * this.handFraction() + 0.04;
    const target = V(0, 0, 0.1 * this.dims.az);
    const ndc = new THREE.Vector3();

    const place = (d) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
    };
    const extent = () => {
      let minY = Infinity;
      let maxY = -Infinity;
      let over = 0;
      for (const p of pts) {
        ndc.copy(p.v).project(cam);
        minY = Math.min(minY, ndc.y);
        maxY = Math.max(maxY, ndc.y);
        over = Math.max(over, Math.abs(ndc.x) - p.lim);
      }
      return { minY, maxY, over };
    };
    let dist = 12;
    for (let iter = 0; iter < 7; iter += 1) {
      let lo = 3;
      let hi = 45;
      for (let k = 0; k < 26; k += 1) {
        const mid = (lo + hi) / 2;
        place(mid);
        const e = extent();
        const fits = e.over <= 0 && e.maxY - e.minY <= safeTop - safeBottom;
        if (fits) hi = mid;
        else lo = mid;
      }
      dist = hi;
      place(dist);
      const e = extent();
      const center = (e.minY + e.maxY) / 2;
      const want = (safeTop + safeBottom) / 2;
      if (Math.abs(center - want) < 0.01) break;
      target.z += (want - center) * dist * 0.45;
    }
    place(dist);
    return { position: cam.position.clone(), quaternion: cam.quaternion.clone(), fov };
  }

  fitCamera(instant) {
    if (this.mode === "home") {
      this.camAnim = null;
      return;
    }
    const pose = this.computeGamePose();
    if (instant) {
      this.camera.position.copy(pose.position);
      this.camera.quaternion.copy(pose.quaternion);
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
      this.camAnim = null;
    } else {
      this.camAnim = {
        fromPos: this.camera.position.clone(),
        fromQuat: this.camera.quaternion.clone(),
        fromFov: this.camera.fov,
        to: pose,
        t: 0,
        dur: 1.4
      };
    }
    this.gamePose = pose;
  }

  // Dimensions du plan "main du joueur" en espace camera.
  handMetrics() {
    const dist = 2.2;
    const visH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.targetFov() / 2));
    const visW = visH * this.camera.aspect;
    const h = window.innerHeight || 800;
    return { dist, visH, visW, bottom: -visH / 2 + visH * (this.railPx() / h), top: visH / 2 };
  }

  targetFov() {
    return this.gamePose && this.mode !== "home" ? this.gamePose.fov : this.camera.fov;
  }

  // ------------------------------------------------------------ jeton / anneau

  moveTokenTo(pos) {
    this.token.visible = true;
    if (!this.tokenTarget) {
      this.token.position.set(pos.x, 0.05, pos.z);
      this.tokenTarget = pos.clone();
      return;
    }
    if (this.tokenTarget.distanceTo(pos) < 0.01) return;
    this.tokenFlight = { from: this.token.position.clone(), to: V(pos.x, 0.05, pos.z), t: 0, dur: 0.75 };
    this.tokenTarget = pos.clone();
  }

  hideToken() {
    this.token.visible = false;
    this.tokenTarget = null;
  }

  setPileRing(state) {
    this.ringState = state;
    if (state === "ok") this.ringColor.set(0x49e38a);
    else if (state === "bad") this.ringColor.set(0xff4b4b);
    else this.ringColor.set(0xffd27a);
  }

  // ------------------------------------------------------------ utilitaires

  toScreen(v) {
    const p = v.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (p.x * 0.5 + 0.5) * rect.width,
      y: (-p.y * 0.5 + 0.5) * rect.height,
      visible: p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2
    };
  }

  onFrame(cb) {
    this.frameCallbacks.push(cb);
  }

  scheduleResize() {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.resize(), 120);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dims = this.tableDimsFor(this.camera.aspect);
    if (!this.dims || Math.abs(dims.ax - this.dims.ax) > 0.12 || Math.abs(dims.az - this.dims.az) > 0.12) {
      this.buildTable(dims);
      this.rebuildProps();
    }
    if (this.mode !== "home") this.fitCamera(true);
    this.frameCallbacks.forEach((cb) => cb.onResize && cb.onResize());
    if (this.onResize) this.onResize();
  }

  // ------------------------------------------------------------ boucle

  loop() {
    requestAnimationFrame(this.loop);
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.getElapsed();

    if (this.mode === "home") {
      this.orbitAngle += dt * 0.07;
      const portrait = this.camera.aspect < 0.9;
      const r = portrait ? 15.5 : 12.5;
      const target = V(0, portrait ? -1.2 : 0.2, 0);
      const pos = V(Math.sin(this.orbitAngle) * r, portrait ? 8.5 : 5.4, Math.cos(this.orbitAngle) * r);
      this.camera.position.lerp(pos, 1 - Math.exp(-dt * 2));
      const m = new THREE.Matrix4().lookAt(this.camera.position, target, V(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      this.camera.quaternion.slerp(q, 1 - Math.exp(-dt * 3));
      if (Math.abs(this.camera.fov - 42) > 0.1) {
        this.camera.fov = lerp(this.camera.fov, 42, 1 - Math.exp(-dt * 2));
        this.camera.updateProjectionMatrix();
      }
    } else if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(1, a.t + dt / a.dur);
      const e = easeInOut(a.t);
      this.camera.position.lerpVectors(a.fromPos, a.to.position, e);
      this.camera.quaternion.slerpQuaternions(a.fromQuat, a.to.quaternion, e);
      this.camera.fov = lerp(a.fromFov, a.to.fov, e);
      this.camera.updateProjectionMatrix();
      if (a.t >= 1) this.camAnim = null;
    }
    this.camera.updateMatrixWorld(true);

    // jeton de tour
    if (this.tokenFlight) {
      const f = this.tokenFlight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = easeInOut(f.t);
      this.token.position.lerpVectors(f.from, f.to, e);
      this.token.position.y = 0.05 + Math.sin(Math.PI * e) * 0.9;
      this.token.rotation.y = e * Math.PI * 2;
      if (f.t >= 1) this.tokenFlight = null;
    }
    this.tokenTopMat.emissiveIntensity = 0.25 + (Math.sin(time * 4) * 0.5 + 0.5) * 0.35;

    // anneau du tapis
    const ringMat = this.pileRing.material;
    let targetOpacity = 0;
    if (this.ringState === "idle") targetOpacity = 0.32 + Math.sin(time * 3) * 0.12;
    else if (this.ringState === "ok" || this.ringState === "bad") targetOpacity = 0.75 + Math.sin(time * 10) * 0.12;
    ringMat.opacity = lerp(ringMat.opacity, targetOpacity, 1 - Math.exp(-dt * 10));
    ringMat.color.lerp(this.ringColor, 1 - Math.exp(-dt * 12));

    // ambiance : la flamme de la lampe vacille tres legerement
    this.spot.intensity = 420 + Math.sin(time * 1.7) * 6 + Math.sin(time * 5.3) * 3;
    this.bokeh.rotation.y = time * 0.01;

    for (const cb of this.frameCallbacks) (cb.update || cb)(dt, time);
    this.renderer.render(this.scene, this.camera);
  }
}

function makePint(i) {
  const g = new THREE.Group();
  const stout = i % 3 === 2;
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.23, 0.19, 0.72, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide })
  );
  glass.position.y = 0.36;
  const beer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.21, 0.175, 0.56, 28),
    new THREE.MeshStandardMaterial({
      color: stout ? 0x1d0e06 : 0xe0901f, emissive: stout ? 0x0a0402 : 0x6a2c00, emissiveIntensity: 0.5,
      transparent: true, opacity: 0.92, roughness: 0.2
    })
  );
  beer.position.y = 0.3;
  const foam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.215, 0.21, 0.1, 28),
    new THREE.MeshStandardMaterial({ color: 0xfff4e0, roughness: 0.9 })
  );
  foam.position.y = 0.62;
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.19, 0.04, 28),
    new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05 })
  );
  base.position.y = 0.02;
  beer.castShadow = true;
  g.add(beer, foam, glass, base);
  return g;
}
