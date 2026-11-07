// Ma boisson, affichee en petit sous le bouton menu (option « Voir ma
// boisson »). Petit rendu 3D a part, dessine seulement quand il change :
// au choix de la boisson et pendant qu'on la touille (on la touche).
import * as THREE from "three";
import { makeDrink } from "../scene/drinks.js";

export class MyDrinkView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.kind = null;
    this.stirT = 1;
    this.raf = 0;
  }

  ensure() {
    if (this.renderer) return true;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    } catch (e) {
      return false; // pas de WebGL : on laisse tomber l'apercu
    }
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff1d6, 0x2a1608, 1.4));
    const key = new THREE.DirectionalLight(0xffe2b0, 2.2);
    key.position.set(1.5, 3, 2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffc070, 1.1);
    rim.position.set(-2, 1.5, -1.5);
    this.scene.add(rim);
    // sous-bock
    const coaster = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.02, 36),
      new THREE.MeshStandardMaterial({ color: 0xd8c7a0, roughness: 0.9 })
    );
    coaster.position.y = 0.01;
    this.scene.add(coaster);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    return true;
  }

  set(kind) {
    if (kind === this.kind && this.drink) return;
    if (!this.ensure()) return;
    this.kind = kind;
    if (this.drink) this.scene.remove(this.drink);
    this.drink = makeDrink(kind, 0);
    this.drink.position.y = 0.02;
    this.scene.add(this.drink);
    this.fit();
    this.render();
  }

  // cadre la boisson (une tasse est plus large que haute, une pinte l'inverse)
  fit() {
    const w = this.canvas.clientWidth || 52;
    const h = this.canvas.clientHeight || 64;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const box = new THREE.Box3().setFromObject(this.drink);
    box.expandByPoint(new THREE.Vector3(0.24, 0, 0.24)).expandByPoint(new THREE.Vector3(-0.24, 0, -0.24));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const fov = (this.camera.fov * Math.PI) / 180;
    const distH = (size.y / 2 + 0.05) / Math.tan(fov / 2);
    const distW = (Math.max(size.x, size.z) / 2 + 0.05) / Math.tan(fov / 2) / this.camera.aspect;
    const d = Math.max(distH, distW) * 1.15;
    this.camera.position.set(0, center.y + d * 0.42, d);
    this.camera.lookAt(0, center.y - size.y * 0.06, 0);
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (this.renderer) this.renderer.render(this.scene, this.camera);
  }

  // on touille ! (animation de 1,8 s)
  stir() {
    if (!this.drink || !this.drink.userData.stir) return;
    this.stirT = 0;
    let last = performance.now();
    cancelAnimationFrame(this.raf);
    const step = (now) => {
      this.stirT = Math.min(1, this.stirT + (now - last) / 1800);
      last = now;
      this.drink.userData.stir(this.stirT);
      this.render();
      if (this.stirT < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}
