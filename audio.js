// Petits bruitages synthetises (aucun fichier audio a telecharger).
const KEY = "menteurSound";

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    try { this.enabled = localStorage.getItem(KEY) !== "off"; } catch (e) { /* ignore */ }
    this.lastFlick = 0;
    const unlock = () => {
      this.ensure();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(KEY, this.enabled ? "on" : "off"); } catch (e) { /* ignore */ }
    return this.enabled;
  }

  noiseBurst({ freq = 3000, q = 0.8, dur = 0.07, gain = 0.5, delay = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  tone({ freq = 440, type = "sine", dur = 0.3, gain = 0.3, delay = 0, slideTo = null, attack = 0.01 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, count = 1) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    switch (name) {
      case "flick":
      case "deal": {
        const now = performance.now();
        if (now - this.lastFlick < 35) return;
        this.lastFlick = now;
        this.noiseBurst({ freq: name === "deal" ? 4200 : 3000, q: 0.7, dur: name === "deal" ? 0.05 : 0.08, gain: name === "deal" ? 0.25 : 0.45 });
        this.noiseBurst({ freq: 700, q: 1.2, dur: 0.05, gain: 0.18, delay: 0.01 });
        break;
      }
      case "pickup":
        for (let i = 0; i < Math.min(8, 3 + count); i += 1) this.noiseBurst({ freq: 2600 + Math.random() * 1500, dur: 0.05, gain: 0.25, delay: i * 0.035 });
        break;
      case "flip":
        this.noiseBurst({ freq: 2000, dur: 0.09, gain: 0.4 });
        this.tone({ freq: 180, dur: 0.12, gain: 0.15, type: "triangle" });
        break;
      case "select":
        this.tone({ freq: 1400, dur: 0.05, gain: 0.08, type: "triangle" });
        break;
      case "turn":
        this.tone({ freq: 659, dur: 0.35, gain: 0.22, attack: 0.02 });
        this.tone({ freq: 988, dur: 0.55, gain: 0.2, delay: 0.14, attack: 0.02 });
        this.tone({ freq: 1319, dur: 0.6, gain: 0.08, delay: 0.14, attack: 0.02 });
        break;
      case "liar":
        this.tone({ freq: 520, slideTo: 140, dur: 0.5, gain: 0.25, type: "sawtooth" });
        this.tone({ freq: 70, dur: 0.4, gain: 0.5, type: "sine" });
        this.noiseBurst({ freq: 400, dur: 0.25, gain: 0.35 });
        break;
      case "stamp":
        this.tone({ freq: 95, slideTo: 45, dur: 0.35, gain: 0.7, type: "sine" });
        this.noiseBurst({ freq: 900, q: 0.5, dur: 0.18, gain: 0.5 });
        break;
      case "truth":
        [523, 659, 784].forEach((f, i) => this.tone({ freq: f, dur: 0.4, gain: 0.15, delay: i * 0.07, type: "triangle" }));
        break;
      case "bluff":
        [392, 330, 262].forEach((f, i) => this.tone({ freq: f, dur: 0.35, gain: 0.16, delay: i * 0.09, type: "square" }));
        break;
      case "quad":
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.5, gain: 0.14, delay: i * 0.06, type: "triangle" }));
        break;
      case "win":
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone({ freq: f, dur: 0.7, gain: 0.14, delay: i * 0.09, type: "triangle" }));
        break;
      case "heartbeat":
        // "boum-boum" sourd (suspense d'un tapis)
        this.tone({ freq: 62, slideTo: 40, dur: 0.16, gain: 0.55, type: "sine", attack: 0.005 });
        this.tone({ freq: 58, slideTo: 38, dur: 0.14, gain: 0.38, type: "sine", delay: 0.2, attack: 0.005 });
        break;
      case "allin":
        this.tone({ freq: 110, dur: 0.9, gain: 0.3, type: "sawtooth", attack: 0.02 });
        this.tone({ freq: 164.8, dur: 0.9, gain: 0.2, type: "sawtooth", attack: 0.02, delay: 0.05 });
        this.tone({ freq: 55, slideTo: 35, dur: 0.8, gain: 0.6, type: "sine" });
        this.noiseBurst({ freq: 300, q: 0.5, dur: 0.4, gain: 0.45 });
        break;
      case "error":
        this.tone({ freq: 220, dur: 0.18, gain: 0.15, type: "square" });
        break;
      default:
        break;
    }
  }
}
