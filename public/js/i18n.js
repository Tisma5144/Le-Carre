// Langues de l'interface. Le jeu est ecrit en francais ; pour les autres
// langues, tout texte affiche est traduit a la volee depuis un dictionnaire
// (public/i18n/<langue>.json) dont les cles sont les phrases francaises.
//   - Cle exacte : "Passe" -> "Pass".
//   - Cle a trous : "Au tour de <b>{0}</b>…" -> "<b>{0}</b>'s turn…" ; chaque
//     morceau capture est lui-meme traduit (noms de cartes, nombres…).
//   - Un observateur traduit tout ce qui apparait dans la page (textes,
//     morceaux de HTML en ligne, attributs title / placeholder / aria-label).
// En francais, rien n'est fait : zero risque pour la version d'origine.

export const LANGS = [
  { id: "fr", label: "Français", flag: "🇫🇷" },
  { id: "en", label: "English", flag: "🇬🇧" },
  { id: "it", label: "Italiano", flag: "🇮🇹" },
  { id: "ru", label: "Русский", flag: "🇷🇺" }
];
const KEY = "carreLang";

// lettres des figures sur les cartes
const RANK_LETTERS = {
  en: { V: "J", D: "Q", R: "K" },
  it: { V: "J", D: "Q", R: "K" },
  ru: { V: "В", D: "Д", R: "К", A: "Т" }
};

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && LANGS.some((l) => l.id === saved)) return saved;
  } catch (e) { /* ignore */ }
  const nav = (navigator.language || "fr").slice(0, 2).toLowerCase();
  return LANGS.some((l) => l.id === nav) ? nav : "fr";
}

export let lang = detect();
let exact = new Map();
let patterns = [];
const cache = new Map();

export function setLang(id) {
  try { localStorage.setItem(KEY, id); } catch (e) { /* ignore */ }
  // les cartes et textures sont dessinees une fois : on recharge la page
  location.reload();
}

export function rankLabel(rank) {
  const m = RANK_LETTERS[lang];
  return (m && m[rank]) || rank;
}

const ESC = /[.*+?^${}()|[\]\\]/g;
// {0} : trou libre ; {#0} : trou qui n'accepte qu'un nombre ("{#0} cartes").
function compile(key, value) {
  const parts = key.split(/\{(#?\d+)\}/);
  // parties paires : texte fixe ; impaires : numero du trou
  let src = "^";
  const order = [];
  let longest = "";
  let fixed = 0;
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 0) {
      src += parts[i].replace(ESC, "\\$&");
      fixed += parts[i].length;
      if (parts[i].length > longest.length) longest = parts[i];
    } else if (parts[i][0] === "#") {
      src += "([\\d\\s.,+−\\-]+?)";
      order.push(Number(parts[i].slice(1)));
      fixed += 2; // un trou numerique est plus precis qu'un trou libre
    } else {
      src += "([\\s\\S]*?)";
      order.push(Number(parts[i]));
    }
  }
  src += "$";
  // une cle qui contient « · » decoupe une liste : seul son dernier trou
  // peut contenir d'autres « · »
  return { re: new RegExp(src), order, value, longest, fixed, sep: key.includes(" · ") };
}

// Charge le dictionnaire de la langue (a appeler avant le demarrage).
export async function loadDictionary() {
  if (lang === "fr") return;
  try {
    const res = await fetch(`/i18n/${lang}.json`, { cache: "no-cache" });
    const dict = await res.json();
    for (const [k, v] of Object.entries(dict)) {
      if (!v) continue;
      if (/\{#?\d+\}/.test(k)) patterns.push(compile(k, v));
      else exact.set(k, v);
    }
    // les cles les plus precises d'abord
    patterns.sort((a, b) => b.fixed - a.fixed);
    document.documentElement.lang = lang;
  } catch (e) {
    lang = "fr";
  }
}

// Un trou ne doit jamais couper une balise en deux (sinon une cle tres
// generale comme « {0} · {1} » avalerait n'importe quel bloc de HTML).
const VOID = /^(br|img|hr|input)$/i;
function balanced(piece) {
  if (!/[<>]/.test(piece)) return true;
  if ((piece.match(/</g) || []).length !== (piece.match(/>/g) || []).length) return false;
  const stack = [];
  for (const m of piece.matchAll(/<(\/?)([a-z][\w-]*)[^>]*?(\/?)>/gi)) {
    if (m[3] || VOID.test(m[2])) continue;
    if (!m[1]) stack.push(m[2].toLowerCase());
    else if (stack.pop() !== m[2].toLowerCase()) return false;
  }
  return stack.length === 0 && !/^[^<]*>/.test(piece) && !/<[^>]*$/.test(piece);
}

function translateCore(s, depth) {
  if (exact.has(s)) return exact.get(s);
  for (const p of patterns) {
    if (p.longest && !s.includes(p.longest)) continue;
    const m = p.re.exec(s);
    if (!m) continue;
    if (!m.slice(1).every(balanced)) continue;
    if (p.sep && m.slice(1, -1).some((x) => x.includes(" · "))) continue;
    let out = p.value;
    p.order.forEach((n, i) => {
      const piece = m[i + 1];
      out = out.split(`{${n}}`).join(depth < 4 ? tr(piece, depth + 1) : piece);
    });
    return out;
  }
  return null;
}

function trExact(s) {
  const core = s.trim();
  const out = exact.get(core);
  return out === undefined ? s : s.replace(core, out);
}

// Traduit une chaine (texte ou HTML en ligne). Les espaces autour sont
// conserves ; sans traduction connue, la chaine revient telle quelle.
export function tr(s, depth = 0) {
  if (lang === "fr" || s == null) return s;
  s = String(s);
  const core = s.trim();
  if (!core || !/[A-Za-zÀ-ÿ]/.test(core)) return s;
  let out = cache.get(core);
  if (out === undefined) {
    // espaces insecables (« ! », milliers) : ignores pour la recherche
    const norm = core.replace(/&nbsp;|[\u00a0\u202f]/g, " ");
    out = translateCore(norm, depth);
    if (out === null && norm !== core) out = translateCore(core, depth);
    if (out === null && /\s/.test(core) === false && core.length < 3) out = core;
    if (out === null) out = core;
    if (depth === 0) {
      if (cache.size > 5000) cache.clear();
      cache.set(core, out);
    }
  }
  if (out === core) return s;
  const lead = s.slice(0, s.indexOf(core));
  const tail = s.slice(s.indexOf(core) + core.length);
  return lead + out + tail;
}

// ------------------------------------------------------------------ page

const INLINE = new Set(["B", "I", "EM", "STRONG", "SMALL", "BR", "SPAN", "U", "SUP", "SUB"]);
const SKIP = new Set(["SCRIPT", "STYLE", "CANVAS", "SVG", "TEXTAREA", "INPUT", "SELECT", "OPTION", "TITLE"]);
const ATTRS = ["title", "placeholder", "aria-label"];
const written = new WeakMap(); // noeud -> dernier texte / HTML ecrit par nous

// Element dont tout le contenu est du texte ou des balises en ligne : il est
// traduit d'un bloc (phrase entiere, mise en forme comprise).
export function isInlineBlock(el) {
  if (!el.childNodes.length) return false;
  for (const n of el.querySelectorAll("*")) {
    if (!INLINE.has(n.tagName)) return false;
  }
  return true;
}

function translateElement(el) {
  if (el.closest("[data-no-tr]")) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && written.get(el) !== "a:" + a + v) {
      const t = tr(v);
      if (t !== v) {
        el.setAttribute(a, t);
        written.set(el, "a:" + a + t);
      }
    }
  }
  if (SKIP.has(el.tagName)) return;
  if (isInlineBlock(el) && /[A-Za-zÀ-ÿ]/.test(el.textContent)) {
    const html = el.innerHTML;
    if (written.get(el) === html) return;
    // phrase a trous seulement si l'element porte lui-meme du texte : un
    // simple conteneur (ex. les 3 lignes de la plaque d'annonce) ne doit pas
    // etre pris pour une phrase ; on le traduit ligne par ligne
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && /[A-Za-zÀ-ÿ]/.test(n.nodeValue));
    const t = direct ? tr(html) : trExact(html);
    if (t !== html) {
      el.innerHTML = t;
      written.set(el, el.innerHTML);
      return;
    }
    // pas de phrase complete connue : on traduit morceau par morceau
  }
  for (const n of [...el.childNodes]) {
    if (n.nodeType === 3) translateText(n);
    else if (n.nodeType === 1) translateElement(n);
  }
}

function safely(fn, n) {
  try { fn(n); } catch (e) { /* un noeud bizarre ne doit pas tout bloquer */ }
}

function translateText(node) {
  const v = node.nodeValue;
  if (!v || written.get(node) === v) return;
  const t = tr(v);
  if (t !== v) {
    node.nodeValue = t;
    written.set(node, t);
  }
}

// Plus haut element "en ligne" qui contient ce noeud (pour retraduire la
// phrase entiere quand le jeu n'en change qu'un morceau).
function blockOf(node) {
  let el = node.nodeType === 1 ? node : node.parentElement;
  let best = null;
  while (el && el !== document.body && INLINE.has(el.tagName)) {
    best = el;
    el = el.parentElement;
  }
  if (el && el !== document.body && isInlineBlock(el)) best = el;
  return best;
}

export function startPageTranslation() {
  if (lang === "fr") return;
  document.title = tr(document.title);
  translateElement(document.body);
  let queue = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const items = queue;
    queue = new Set();
    for (const n of items) {
      if (!n.isConnected) continue;
      if (n.nodeType === 3) {
        const b = blockOf(n);
        if (b) safely(translateElement, b);
        else safely(translateText, n);
      } else if (n.nodeType === 1) safely(translateElement, n);
    }
  };
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "characterData") queue.add(m.target);
      else if (m.type === "attributes") queue.add(m.target);
      else {
        const b = blockOf(m.target);
        if (b) queue.add(b);
        else m.addedNodes.forEach((n) => queue.add(n));
      }
    }
    // traduit avant l'affichage de l'image suivante
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
