// Interface HTML superposee a la scene 3D : plaques des joueurs, bulles,
// annonce, bandeau de tour, boutons, modales, revelation, fin de partie.
import { RANK_ORDER, RANK_NAMES, createRankBadgeCanvas, createCardFaceCanvas } from "../cards/cardArt.js";

const $ = (id) => document.getElementById(id);

const badgeCache = new Map();
export function rankBadgeUrl(rank) {
  if (!badgeCache.has(rank)) badgeCache.set(rank, createRankBadgeCanvas(rank, 150).toDataURL());
  return badgeCache.get(rank);
}
const miniCache = new Map();
export function miniCardUrl(card) {
  const key = card.rank + card.suit;
  if (!miniCache.has(key)) miniCache.set(key, createCardFaceCanvas(card, 0.25).toDataURL());
  return miniCache.get(key);
}

export function rankPlural(rank) {
  return RANK_NAMES[rank] ? RANK_NAMES[rank][1] : rank;
}

export function claimText(count, rank) {
  const [sing, plur] = RANK_NAMES[rank] || [rank, rank];
  const fem = rank === "D";
  const words = ["", fem ? "Une" : "Un", "Deux", "Trois", "Quatre"];
  return `${words[count] || count} ${count > 1 ? plur : sing} !`;
}

// Rythme commun des clignotements (doit valoir --beat en CSS et BEAT dans
// world.js) : on cale la phase de l'animation CSS sur l'horloge de la page
// pour qu'elle batte exactement en meme temps que le jeton 3D.
export const BEAT_MS = 1400;
export function syncBeat(el) {
  if (el) el.style.animationDelay = `-${(performance.now() % BEAT_MS) / 1000}s`;
}

export function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 40%)`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export class Hud {
  constructor() {
    this.plates = new Map();
    this.bubbleTimers = new Map();
    this.toastTimer = null;
    this.lastAnnounceKey = null;
    this.modalOnClose = null;
    $("modal-close").addEventListener("click", () => this.closeModal());
    $("modal").addEventListener("click", (e) => { if (e.target.id === "modal") this.closeModal(); });
  }

  // ------------------------------------------------------------ ecrans

  showScreen(name) {
    $("home").classList.toggle("hidden", name !== "home");
    $("lobby").classList.toggle("hidden", name !== "lobby");
    $("hud").classList.toggle("hidden", name !== "game");
    if (name !== "game") {
      this.hideReveal();
      $("end").classList.add("hidden");
      $("rank-picker").classList.add("hidden");
    }
    if (name === "home") this.clearPlates();
  }

  toast(msg, ms = 2400) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  // ------------------------------------------------------------ lobby

  renderGameMenu(catalog, selected, isHost, onSelect) {
    const menu = $("game-menu");
    const key = `${selected}|${isHost}`;
    if (menu.dataset.key !== key) {
      menu.dataset.key = key;
      menu.innerHTML = "";
      catalog.forEach((g) => {
        const b = document.createElement("button");
        b.className = "game-tile" + (g.id === selected ? " selected" : "") + (g.soon ? " soon" : "");
        b.disabled = !isHost || !!g.soon;
        b.innerHTML = `<span class="gt-art">${g.art ? `<img alt="" src="${g.art}" />` : `<i>${g.emoji}</i>`}</span>
          <span class="gt-text"><b>${esc(g.name)}</b><small>${esc(g.tagline)}</small><em>${esc(g.players || "")}</em></span>
          ${g.id === selected ? `<span class="gt-check">✔</span>` : ""}`;
        if (isHost && !g.soon) b.addEventListener("click", () => onSelect(g.id));
        menu.appendChild(b);
      });
    }
    $("game-menu-hint").textContent = isHost ? "Choisis le jeu de la soirée :" : "Le patron choisit le jeu :";
  }

  renderLobby(room, meId, url, qrFactory, onRemoveBot, minPlayers = 3) {
    $("lobby-code").textContent = room.code;
    const ul = $("lobby-players");
    const prev = new Set([...ul.querySelectorAll("li")].map((li) => li.dataset.id));
    ul.innerHTML = "";
    room.players.forEach((p) => {
      const li = document.createElement("li");
      li.dataset.id = p.id;
      if (prev.has(p.id)) li.style.animation = "none";
      li.innerHTML = `<span>${p.isBot ? "🤖 " : ""}${esc(p.name)}${p.id === meId ? " <span class='tag'>(toi)</span>" : ""}</span>
        <span class="tag">${p.isHost ? "👑 patron" : ""}${p.isBot ? "robot" : ""}${!p.connected ? " · parti fumer" : ""}${p.isBot && room.hostId === meId ? ` <button class="bot-kick" data-bot="${p.id}" aria-label="Renvoyer ce robot" data-no-fs>✕</button>` : ""}</span>`;
      const kick = li.querySelector(".bot-kick");
      if (kick && onRemoveBot) kick.addEventListener("click", () => onRemoveBot(p.id));
      ul.appendChild(li);
    });
    const isHost = room.hostId === meId;
    const n = room.players.length;
    $("btn-start").classList.toggle("hidden", !isHost);
    $("btn-add-bot").classList.toggle("hidden", !isHost || n >= 8);
    // niveau des robots : reglable par le patron, affiche aux autres s'il y a des robots
    const hasBots = room.players.some((p) => p.isBot && !p.leftGame);
    const lvl = $("bot-level");
    lvl.classList.toggle("hidden", !isHost && !hasBots);
    lvl.classList.toggle("readonly", !isHost);
    for (const b of lvl.querySelectorAll("button")) {
      b.classList.toggle("on", b.dataset.level === (room.botLevel || "normal"));
      b.disabled = !isHost;
    }
    $("btn-start").disabled = n < minPlayers;
    $("lobby-status").textContent = isHost
      ? n < minPlayers ? `Il faut au moins ${minPlayers} joueurs (${n}/${minPlayers}) : invite tes potes ou ajoute des robots !` : `${n} joueurs autour de la table. On y va ?`
      : "Le patron va bientôt distribuer les cartes…";
    const qrEl = $("qr");
    if (qrEl.dataset.url !== url && qrFactory) {
      qrEl.dataset.url = url;
      try {
        const qr = qrFactory(0, "M");
        qr.addData(url);
        qr.make();
        qrEl.innerHTML = `<img alt="QR code pour rejoindre" src="${qr.createDataURL(5, 0)}" />`;
      } catch (e) {
        qrEl.textContent = "";
      }
    }
  }

  // ------------------------------------------------------------ plaques

  clearPlates() {
    $("plates").innerHTML = "";
    this.plates.clear();
  }

  syncPlates(players) {
    const root = $("plates");
    const keep = new Set(players.map((p) => p.id));
    for (const [id, el] of this.plates) {
      if (!keep.has(id)) {
        el.remove();
        this.plates.delete(id);
      }
    }
    for (const p of players) {
      let el = this.plates.get(p.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "plate";
        el.innerHTML = `<div class="bubble"></div><div class="plate-inner"><div class="avatar"></div><span class="plate-name"></span><span class="plate-left" title="Parti, remplacé par un robot">🤖 robot</span><span class="plate-count"></span></div><div class="plate-status"></div>`;
        root.appendChild(el);
        this.plates.set(p.id, el);
      }
      const av = el.querySelector(".avatar");
      av.textContent = (p.name || "?").trim().charAt(0).toUpperCase();
      av.style.background = avatarColor(p.name || "?");
      el.querySelector(".plate-name").textContent = p.name;
      // joueur parti en pleine partie : un robot joue a sa place
      el.classList.toggle("left", !!(this.leftIds && this.leftIds.has(p.id)));
      const count = el.querySelector(".plate-count");
      count.textContent = p.count === undefined ? "" : String(p.count);
      count.dataset.icon = p.countIcon || "";
      count.style.display = p.count === undefined ? "none" : "";
      if (!!p.active !== el.classList.contains("active")) syncBeat(el.querySelector(".plate-inner"));
      el.classList.toggle("active", !!p.active);
      el.classList.toggle("finished", !!p.finished);
      el.classList.toggle("offline", !p.connected);
      const st = el.querySelector(".plate-status");
      st.className = "plate-status" + (p.active && !p.statusText ? " dots" : "");
      st.textContent = p.statusText || (p.active ? "réfléchit" : "");
    }
  }

  positionPlates(project) {
    // Elements du haut de l'ecran que les etiquettes ne doivent pas chevaucher
    // (plaque de l'annonce / de l'atout, boutons menu et son).
    const obstacles = [];
    if (!$("hud").classList.contains("hidden")) {
      for (const id of ["announce", "btn-menu", "btn-sound", "btn-emote"]) {
        const r = $(id).getBoundingClientRect();
        if (r.height > 0) obstacles.push(r);
      }
    }
    const items = [];
    for (const [id, el] of this.plates) {
      const s = project(id);
      if (!s) {
        el.style.opacity = "0";
        continue;
      }
      el.style.opacity = "";
      // on garde l'etiquette entierement a l'ecran (bords des telephones)
      const half = (el.offsetWidth || 120) / 2 + 6;
      const h = el.offsetHeight || 40;
      const x = Math.max(half, Math.min(window.innerWidth - half, s.x));
      let y = Math.max(s.y, h + 4);
      // si l'etiquette passe sous la plaque du haut, on la descend juste en dessous
      for (const r of obstacles) {
        const overlapX = x + half > r.left - 4 && x - half < r.right + 4;
        if (overlapX && y - h < r.bottom + 6) y = r.bottom + 6 + h;
      }
      items.push({ el, x, y, half, h });
    }
    // etiquettes qui se chevauchent entre elles (beaucoup de joueurs sur un
    // ecran etroit) : on decale vers le bas celle qui est la plus basse
    items.sort((p, q) => p.y - q.y);
    for (let i = 0; i < items.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const a = items[j];
        const b = items[i];
        const overlapX = Math.abs(a.x - b.x) < a.half + b.half - 10;
        if (overlapX && b.y - b.h < a.y - 2 && b.y > a.y - a.h) b.y = a.y + b.h + 2;
      }
    }
    const W = window.innerWidth;
    for (const it of items) {
      it.el.style.transform = `translate(${it.x}px, ${it.y}px) translate(-50%, -100%)`;
      // la bulle de dialogue reste entierement a l'ecran (la pointe, elle,
      // continue de viser le joueur)
      const b = it.el.querySelector(".bubble");
      if (b) {
        const bw = b.offsetWidth;
        const over = it.x + bw / 2 - (W - 6);
        const under = 6 - (it.x - bw / 2);
        const bx = over > 0 ? -over : under > 0 ? under : 0;
        b.style.setProperty("--bx", `${Math.round(bx)}px`);
      }
    }
  }

  // Emoji qui s'envole au-dessus d'un joueur (target = "me" ou id).
  floatEmote(target, emoji) {
    let r = null;
    if (target === "me") r = $("my-plate").getBoundingClientRect();
    else {
      const plate = this.plates.get(target);
      if (!plate || plate.style.opacity === "0") return;
      r = plate.querySelector(".plate-inner").getBoundingClientRect();
    }
    if (!r || !r.width) return;
    const el = document.createElement("span");
    el.className = "emote-float";
    el.textContent = emoji;
    const x = target === "me" ? r.left + 26 : r.left + r.width / 2;
    el.style.left = `${x}px`;
    const high = r.top < window.innerHeight * 0.3;
    el.style.top = `${high ? r.bottom : r.top}px`;
    if (high) el.classList.add("down");
    el.style.setProperty("--dx", `${Math.round((Math.random() - 0.5) * 50)}px`);
    document.body.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
    setTimeout(() => el.remove(), 6000);
  }

  bubble(target, text, kind = "") {
    let el;
    if (target === "me") el = $("my-bubble");
    else {
      const plate = this.plates.get(target);
      if (!plate) return;
      el = plate.querySelector(".bubble");
    }
    el.textContent = text;
    el.className = `bubble ${target === "me" ? "mine" : ""} ${kind}`;
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(this.bubbleTimers.get(target));
    this.bubbleTimers.set(target, setTimeout(() => el.classList.remove("show"), kind === "liar" ? 2600 : 2300));
  }

  positionChip(id, s, text) {
    const el = $(id);
    if (!s || !s.visible || !text) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    if (el.dataset.text !== text) {
      el.innerHTML = text;
      el.dataset.text = text;
    }
    el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, 0)`;
  }

  // ------------------------------------------------------------ annonce / aide

  setAnnounce({ label, value, sub, rank, img, key }) {
    const box = $("announce");
    $("announce-label").textContent = label;
    $("announce-value").textContent = value;
    $("announce-sub").textContent = sub || "";
    box.classList.toggle("no-card", !rank && !img);
    const src = img || (rank ? rankBadgeUrl(rank) : null);
    if (src && $("announce-card").getAttribute("src") !== src) $("announce-card").src = src;
    if (key !== this.lastAnnounceKey) {
      this.lastAnnounceKey = key;
      box.classList.remove("pulse");
      void box.offsetWidth;
      box.classList.add("pulse");
    }
  }

  setHint(html, myTurn) {
    const h = $("hint");
    h.innerHTML = html || "";
    if (!!myTurn !== h.classList.contains("my-turn")) syncBeat(h);
    h.classList.toggle("my-turn", !!myTurn);
  }

  showTurnBanner(text, variant = "") {
    const b = $("turn-banner");
    $("turn-banner-text").textContent = text;
    b.classList.remove("show", "gold", "allin");
    if (variant) b.classList.add(variant);
    void b.offsetWidth;
    b.classList.add("show");
  }

  // text : ligne detaillee (grands ecrans) ; short : version courte pour
  // les telephones (ex : "🎯 2 · ✋ 1" a l'Ascenseur).
  setMyPlate(name, count, text, short) {
    const long = text || `${count} carte${count > 1 ? "s" : ""} en main`;
    const html = `<div class="avatar" style="background:${avatarColor(name || "?")}">${esc((name || "?").charAt(0).toUpperCase())}<span class="me-count">${count}</span></div>
      <div class="me-text"><div class="me-name">${esc(name || "Toi")}</div><small class="me-long">${long}</small><small class="me-short">${short || long}</small></div>`;
    if ($("my-plate").dataset.html !== html) {
      $("my-plate").dataset.html = html;
      $("my-plate").innerHTML = html;
    }
  }

  // Boutons dores flottants au-dessus de la main (carres, carre magique...).
  setActionChips(items) {
    const bar = $("quad-bar");
    const key = items.map((i) => i.key).join(",");
    if (bar.dataset.key === key) return;
    bar.dataset.key = key;
    bar.innerHTML = "";
    items.forEach((it) => {
      const b = document.createElement("button");
      b.className = "btn brass";
      b.textContent = it.label;
      b.addEventListener("click", it.onClick);
      bar.appendChild(b);
    });
  }

  // ------------------------------------------------------------ annonces (Ascenseur)

  // Barre de choix d'un nombre (0..max) au-dessus de la main : on voit ses
  // cartes pendant qu'on reflechit.
  showBidBar({ title, sub, max, forbidden, key, onPick }) {
    const bar = $("bid-bar");
    $("bid-title").textContent = title;
    $("bid-sub").innerHTML = sub || "";
    if (bar.dataset.key !== key) {
      bar.dataset.key = key;
      const grid = $("bid-grid");
      grid.innerHTML = "";
      for (let i = 0; i <= max; i += 1) {
        const b = document.createElement("button");
        b.className = "bid-btn" + (i === forbidden ? " forbidden" : "");
        b.textContent = String(i);
        if (i === forbidden) {
          b.disabled = true;
          b.title = "Interdit : le total tomberait juste";
        } else {
          b.addEventListener("click", () => onPick(i));
        }
        grid.appendChild(b);
      }
    }
    bar.classList.remove("hidden");
  }

  hideBidBar() {
    const bar = $("bid-bar");
    bar.classList.add("hidden");
    bar.dataset.key = "";
  }

  // ------------------------------------------------------------ choix de valeur

  openRankPicker(onPick, onCancel) {
    const grid = $("rank-grid");
    grid.innerHTML = "";
    RANK_ORDER.forEach((rank) => {
      const b = document.createElement("button");
      b.className = "rank-card";
      b.innerHTML = `<img alt="" src="${rankBadgeUrl(rank)}" /><span>${RANK_NAMES[rank][0]}</span>`;
      b.addEventListener("click", () => {
        $("rank-picker").classList.add("hidden");
        onPick(rank);
      });
      grid.appendChild(b);
    });
    $("rank-cancel").onclick = () => {
      $("rank-picker").classList.add("hidden");
      onCancel();
    };
    $("rank-picker").classList.remove("hidden");
  }

  closeRankPicker() {
    $("rank-picker").classList.add("hidden");
  }

  // ------------------------------------------------------------ revelation

  showReveal({ top, text, canPickup, pickupLabel, wait }) {
    $("reveal").classList.remove("hidden");
    $("reveal-top").textContent = top;
    $("reveal-text").textContent = text || "";
    const btn = $("btn-pickup");
    btn.classList.toggle("hidden", !canPickup);
    btn.textContent = pickupLabel || "Ramasser";
    $("reveal-wait").textContent = wait || "";
  }

  stamp(lie) {
    const s = $("stamp");
    s.textContent = lie ? "MENTEUR !" : "SINCÈRE !";
    s.classList.toggle("truth", !lie);
    s.classList.remove("show");
    void s.offsetWidth;
    s.classList.add("show");
  }

  hideReveal() {
    $("reveal").classList.add("hidden");
    $("stamp").classList.remove("show");
  }

  // ------------------------------------------------------------ fin

  // entries : [{ medal, name, me, title, extra }]
  showEnd({ title, entries, primary, secondary, extra, wait, onLeave, key, cards }) {
    const box = $("end");
    const already = !box.classList.contains("hidden") && box.dataset.key === key;
    box.dataset.key = key || "";
    $("end-title").textContent = title;
    const list = $("end-list");
    list.innerHTML = "";
    entries.forEach((p, i) => {
      const li = document.createElement("li");
      if (!already) li.style.animationDelay = `${i * 0.12}s`;
      else li.style.animation = "none";
      li.innerHTML = `<span class="medal">${p.medal}</span><span class="who">${esc(p.name)}${p.me ? " (toi)" : ""}${p.sub ? `<small>${esc(p.sub)}</small>` : ""}</span><span class="title">${esc(p.title || "")}</span>${p.extra !== undefined ? `<span class="pts">${esc(p.extra)}</span>` : ""}`;
      list.appendChild(li);
    });
    // cartes a montrer (ex : jeu du Trou du cul au President)
    const cb = $("end-cards");
    cb.classList.toggle("hidden", !(cards && cards.list && cards.list.length));
    if (cards && cards.list && cards.list.length) {
      cb.querySelector(".end-cards-label").textContent = cards.label || "";
      cb.querySelector(".end-cards-row").innerHTML = cards.list.map((c, i) => `<img src="${miniCardUrl(c)}" alt="" style="animation-delay:${already ? 0 : 0.4 + i * 0.08}s" />`).join("");
    }
    const b1 = $("btn-again");
    b1.classList.toggle("hidden", !primary);
    if (primary) {
      b1.textContent = primary.label;
      b1.onclick = primary.onClick;
    }
    const b2 = $("btn-end-alt");
    b2.classList.toggle("hidden", !secondary);
    if (secondary) {
      b2.textContent = secondary.label;
      b2.onclick = secondary.onClick;
    }
    const b3 = $("btn-end-extra");
    b3.classList.toggle("hidden", !extra);
    if (extra) {
      b3.textContent = extra.label;
      b3.onclick = extra.onClick;
    }
    $("end-wait").textContent = wait || "";
    $("btn-end-leave").onclick = onLeave;
    box.classList.remove("hidden");
  }

  hideEnd() {
    $("end").classList.add("hidden");
  }

  // ------------------------------------------------------------ modales

  openModal(title, html, onClose) {
    $("modal-title").textContent = title;
    $("modal-body").innerHTML = html;
    $("modal-body").scrollTop = 0;
    $("modal").classList.remove("hidden");
    this.modalOnClose = onClose || null;
  }

  closeModal() {
    $("modal").classList.add("hidden");
    if (this.modalOnClose) this.modalOnClose();
    this.modalOnClose = null;
  }

  historyHtml(history) {
    if (!history.length) return "<p>Rien ne s'est encore passé… le silence avant la tempête.</p>";
    const items = history.slice().reverse().map((e) => {
      switch (e.type) {
        case "play": return `<li><b>${esc(e.playerName)}</b> pose ${e.count} carte${e.count > 1 ? "s" : ""} : « ${claimText(e.count, e.claimedRank)} »</li>`;
        case "quad_discard": return `<li>✨ <b>${esc(e.playerName)}</b> sort le carré de ${rankPlural(e.rank)}</li>`;
        case "accuse": return `<li>🚨 <b>${esc(e.accuserName)}</b> crie MENTEUR sur <b>${esc(e.accusedName)}</b> → ${e.mismatch ? `${esc(e.accusedName)} bluffait !` : `c'était vrai !`}</li>`;
        case "pickup": return `<li>🫳 <b>${esc(e.playerName)}</b> ramasse ${e.count} carte${e.count > 1 ? "s" : ""}</li>`;
        default: return "";
      }
    });
    return `<ul>${items.join("")}</ul>`;
  }

  quadsHtml(quads) {
    if (!quads.length) return "<p>Aucun carré n'est sorti pour l'instant. Garde l'œil ouvert !</p>";
    return quads.slice().reverse().map((q) => `
      <div class="quad-row">
        <div class="minis">${q.cards.map((c) => `<img alt="" src="${miniCardUrl(c)}" />`).join("")}</div>
        <div class="txt"><b>${esc(q.playerName)}</b> a sorti les ${rankPlural(q.rank)}</div>
      </div>`).join("");
  }

  rulesHtml() {
    return `
      <p class="rule"><i>🃏</i><span>Tout le paquet est distribué. Le but : <b>vider ta main</b> le premier.</span></p>
      <p class="rule"><i>🗣️</i><span>Celui qui ouvre la manche pose 1 à 3 cartes face cachée et <b>annonce une valeur</b> (« Deux Rois ! »).</span></p>
      <p class="rule"><i>🔁</i><span>Chacun à son tour pose 1 à 3 cartes en prétendant <b>la même valeur</b>. Tu peux mentir…</span></p>
      <p class="rule"><i>🚨</i><span>Juste avant de jouer, tu peux crier <b>MENTEUR !</b> sur la pose précédente. Les cartes sont retournées : si c'était un bluff, le menteur ramasse tout le tapis. Sinon, c'est toi.</span></p>
      <p class="rule"><i>➡️</i><span>Le joueur après celui qui a ramassé ouvre la manche suivante.</span></p>
      <p class="rule"><i>✨</i><span>Tu as les 4 cartes d'une même valeur ? Sors le <b>carré</b> quand tu veux, ça ne compte pas comme ton tour.</span></p>
      <p class="rule"><i>🍺</i><span>Le dernier avec des cartes en main… paie sa tournée.</span></p>`;
  }
}
