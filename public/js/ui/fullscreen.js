// Plein ecran sur telephone.
// - Android / ordinateur : API Fullscreen (le jeu passe en plein ecran au
//   premier bouton touche, puis bouton pour sortir / revenir).
// - iPhone : Safari ne permet pas le plein ecran d'une page ; on explique
//   comment ajouter Le Carre a l'ecran d'accueil (il s'ouvre alors en plein
//   ecran, comme une appli).
const doc = document;
const root = doc.documentElement;
let installPrompt = null;
let userLeft = false;
const listeners = new Set();

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

export function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isTouch() {
  return window.matchMedia("(pointer: coarse)").matches;
}

export function canFullscreen() {
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled) && !!(root.requestFullscreen || root.webkitRequestFullscreen);
}

export function isFullscreen() {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement) || isStandalone();
}

export function enterFullscreen() {
  if (!canFullscreen() || isFullscreen()) return Promise.resolve(false);
  try {
    const p = root.requestFullscreen ? root.requestFullscreen({ navigationUI: "hide" }) : root.webkitRequestFullscreen();
    return Promise.resolve(p).then(() => true).catch(() => false);
  } catch (e) {
    return Promise.resolve(false);
  }
}

export function exitFullscreen() {
  if (!(doc.fullscreenElement || doc.webkitFullscreenElement)) return;
  userLeft = true;
  if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
  else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
}

export function toggleFullscreen() {
  if (doc.fullscreenElement || doc.webkitFullscreenElement) exitFullscreen();
  else {
    userLeft = false;
    enterFullscreen();
  }
}

export function canInstall() {
  return !!installPrompt;
}

export function promptInstall() {
  if (!installPrompt) return Promise.resolve(false);
  const p = installPrompt;
  installPrompt = null;
  p.prompt();
  return p.userChoice.then((c) => c && c.outcome === "accepted").catch(() => false);
}

export function onChange(fn) {
  listeners.add(fn);
}

function notify() {
  listeners.forEach((fn) => fn());
}

// Astuce "ajoute le site a l'ecran d'accueil" : seulement sur telephone,
// et seulement si le jeu n'est pas deja en plein ecran. "" sinon.
export function tipText() {
  if (!isTouch() || isFullscreen()) return "";
  return isIOS()
    ? "📲 Astuce : pour jouer en plein écran, ajoute Le Carré à ton écran d'accueil (Partager ⬆️ → « Sur l'écran d'accueil »)."
    : "📲 Astuce : pour jouer en plein écran, ajoute Le Carré à ton écran d'accueil (menu ⋮ → « Ajouter à l'écran d'accueil »).";
}

// Texte d'aide quand le plein ecran direct n'est pas possible.
export function helpHtml() {
  if (isIOS()) {
    return `<p>Sur iPhone, Safari ne permet pas à un site de passer en plein écran… mais il y a une astuce :</p>
      <p class="rule"><i>1️⃣</i><span>Touche le bouton <b>Partager</b> <span style="font-size:1.2em">⬆️</span> en bas de Safari.</span></p>
      <p class="rule"><i>2️⃣</i><span>Choisis <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.</span></p>
      <p class="rule"><i>3️⃣</i><span>Ouvre <b>Le Carré</b> depuis l'icône : le jeu s'affiche en plein écran, sans barre d'adresse.</span></p>
      <p>Astuce : tourne le téléphone à l'horizontale pour une table encore plus grande.</p>`;
  }
  return `<p>Ton navigateur ne permet pas le plein écran direct.</p>
    <p class="rule"><i>📲</i><span>Ouvre le menu du navigateur <b>⋮</b> et choisis <b>« Ajouter à l'écran d'accueil »</b> (ou « Installer l'application »). Le Carré s'ouvrira ensuite en plein écran depuis son icône.</span></p>`;
}

// Installation : premier bouton touche = plein ecran automatique sur
// telephone (le navigateur exige un geste de l'utilisateur).
export function setupFullscreen() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    notify();
  });
  doc.addEventListener("fullscreenchange", notify);
  doc.addEventListener("webkitfullscreenchange", notify);
  doc.addEventListener(
    "click",
    (ev) => {
      if (userLeft || !isTouch() || isFullscreen() || !canFullscreen()) return;
      const btn = ev.target && ev.target.closest && ev.target.closest("button");
      if (!btn || btn.dataset.noFs !== undefined) return;
      enterFullscreen();
    },
    true
  );
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}
