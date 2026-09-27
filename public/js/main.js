// Point d'entree : relie le reseau (Socket.io), la scene 3D, les cartes et le
// HUD. Tout ce qui est propre a un jeu vit dans js/games/<jeu>.js.
import { World } from "./scene/world.js";
import { woodCanvas } from "./scene/textures.js";
import { CardTable } from "./game/cardTable.js";
import { Hud } from "./ui/hud.js";
import { Sfx } from "./ui/audio.js";
import { ensureCardFonts, createCardBackCanvas, createCardFaceCanvas } from "./cards/cardArt.js";
import menteurUi from "./games/menteur.js";
import presidentUi from "./games/president.js";
import ascenseurUi from "./games/ascenseur.js";
import pouilleuxUi from "./games/pouilleux.js";
import pokerUi from "./games/poker.js";
import qrcode from "/vendor/qrcode.mjs";
import * as FS from "./ui/fullscreen.js";

const EMOTES = ["😂", "😱", "🔥", "👏", "😡", "🤡", "🍺", "🤔", "😎", "💀", "😭", "🙏"];
const ADAPTERS = { menteur: menteurUi, president: presidentUi, ascenseur: ascenseurUi, pouilleux: pouilleuxUi, poker: pokerUi };
const SESSION_KEY = "menteurSession";
const SUIT_INDEX = { pique: 0, coeur: 1, trefle: 2, carreau: 3 };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = {
  me: { id: null, name: "" },
  room: null,
  game: null,
  adapter: null,
  screen: null,
  lastUid: null,
  lastDealKey: null,
  lastEventId: 0,
  dealing: false,
  wasMyTurn: false,
  revealKey: null,
  endShownFor: null,
  roundEndShown: null,
  sorted: false,
  seatsKey: "",
  seatPhi: new Map()
};

let world;
let table;
let hud;
let sfx;
let socket;
let app;
let CATALOG = [];

// ------------------------------------------------------------------ session

function saveSession() {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ code: S.room ? S.room.code : S.pendingCode, playerId: S.me.id, name: S.me.name })); } catch (e) { /* ignore */ }
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}
function savedName() {
  try { return localStorage.getItem("menteurName") || ""; } catch (e) { return ""; }
}
function rememberName(n) {
  try { localStorage.setItem("menteurName", n); } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------ textures CSS

function paintCssTextures() {
  const wood = woodCanvas({ size: 512, planks: 4, base: "#7b4a28", seed: 7, knots: 2 });
  document.documentElement.style.setProperty("--wood-img", `url(${wood.toDataURL("image/jpeg", 0.82)})`);
  const c = document.createElement("canvas");
  c.width = 700;
  c.height = 520;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(350, 240, 60, 350, 260, 480);
  g.addColorStop(0, "#2c3a33");
  g.addColorStop(1, "#18211c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 70; i += 1) {
    ctx.fillStyle = `rgba(255,255,255,${0.012 + Math.random() * 0.03})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * 700, Math.random() * 520, 30 + Math.random() * 120, 8 + Math.random() * 30, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  document.documentElement.style.setProperty("--chalk-img", `url(${c.toDataURL("image/jpeg", 0.8)})`);
}

function buildCatalog() {
  CATALOG = [
    { ...pick(menteurUi), art: createCardBackCanvas(0.22).toDataURL() },
    { ...pick(presidentUi), art: createCardFaceCanvas({ rank: "R", suit: "coeur" }, 0.22).toDataURL() },
    { ...pick(ascenseurUi), art: createCardFaceCanvas({ rank: "A", suit: "pique" }, 0.22).toDataURL() },
    { ...pick(pouilleuxUi), art: createCardFaceCanvas({ rank: "V", suit: "pique" }, 0.22).toDataURL() },
    { ...pick(pokerUi), art: createCardFaceCanvas({ rank: "A", suit: "coeur" }, 0.22).toDataURL() },
    { id: "custom", name: "Tes propres jeux", emoji: "🛠️", tagline: "Bientôt : invente tes règles", players: "", soon: true }
  ];
}
function pick(a) {
  return { id: a.id, name: a.name, emoji: a.emoji, tagline: a.tagline, players: a.players };
}

function updateHandCssVar() {
  if (!world) return;
  const px = Math.round(world.handFraction() * window.innerHeight);
  document.documentElement.style.setProperty("--hand-h", `${px}px`);
  // Haut reel de la main (2 rangees, carte soulevee) : les bulles et
  // messages se placent au-dessus pour ne pas cacher les cartes.
  const top = table && table.handTopFrac ? Math.round(table.handTopFrac * window.innerHeight) + 4 : 0;
  document.documentElement.style.setProperty("--hand-top", `${Math.max(px, top)}px`);
}

// ------------------------------------------------------------------ sieges

function computeSeats(orderedIds) {
  const idx = orderedIds.indexOf(S.me.id);
  const rel = idx >= 0 ? orderedIds.slice(idx + 1).concat(orderedIds.slice(0, idx)) : orderedIds.slice();
  // Sens des aiguilles d'une montre : le joueur qui joue apres moi est
  // assis a ma gauche, puis on tourne vers le haut de la table et la droite.
  const phis = World.opponentPhis(rel.length);
  return rel.map((id, i) => ({ id, phi: phis[phis.length - 1 - i] }));
}

function applySeats(orderedIds) {
  const seats = computeSeats(orderedIds);
  const key = seats.map((s) => s.id).join("|");
  if (key !== S.seatsKey) {
    S.seatsKey = key;
    world.setOpponents(seats.length);
    table.setSeats(seats);
    S.seatPhi = new Map(seats.map((s) => [s.id, s.phi]));
  }
  return seats;
}

function playerName(id) {
  const p = S.room && S.room.players.find((x) => x.id === id);
  return p ? p.name : "?";
}
function isConnected(id) {
  const p = S.room && S.room.players.find((x) => x.id === id);
  return p ? p.connected : false;
}

// ------------------------------------------------------------------ routage

function onState({ room, game }) {
  // on vient de quitter la table : on ignore les derniers messages en vol
  if (S.leaving) return;
  S.room = room;
  S.game = game;
  if (!room) return showHome();
  saveSession();
  if (room.status === "lobby" || !game) showLobby();
  else showGame();
}

function leaveGameUi() {
  if (S.adapter && S.adapter.hideOverlays) S.adapter.hideOverlays(app);
  S.adapter = null;
  S.lastUid = null;
  S.lastDealKey = null;
  S.wasMyTurn = false;
  S.roundEndShown = null;
  hud.hideEnd();
}

function showHome() {
  const was = S.screen;
  leaveGameUi();
  S.screen = "home";
  S.room = null;
  S.game = null;
  S.seatsKey = "";
  hud.showScreen("home");
  world.setMode("home");
  world.hideToken();
  world.setPileRing("hidden");
  world.setOpponents(0);
  table.setSeats([]);
  table.setInteractive(false);
  if (was !== "home") table.showDecor();
}

function joinUrl(code) {
  return `${location.origin}/?c=${code}`;
}

function showLobby() {
  const room = S.room;
  const firstTime = S.screen !== "lobby";
  if (firstTime) leaveGameUi();
  S.screen = "lobby";
  hud.showScreen("lobby");
  world.setMode("lobby");
  world.hideToken();
  world.setPileRing("hidden");
  table.setInteractive(false);
  table.setTurnGlow(null);
  const seats = applySeats(room.players.map((p) => p.id));
  if (firstTime) table.gatherToDeck(true);
  const isHost = room.hostId === S.me.id;
  const AL = ADAPTERS[room.gameType] || menteurUi;
  hud.renderLobby(room, S.me.id, joinUrl(room.code), qrcode, (botId) => app.emit("room:removeBot", { playerId: botId }), AL.minPlayers || 3);
  hud.renderGameMenu(CATALOG, room.gameType, isHost, (gameType) => {
    sfx.play("select");
    app.emit("room:setGame", { gameType });
  });
  const A = ADAPTERS[room.gameType] || menteurUi;
  $("btn-start").textContent = `Distribuer · ${A.name}`;
  $("btn-rules-lobby").textContent = `📜 Lire les règles ${A.name.startsWith("L'") ? "de l'" + A.name.slice(2) : "du " + A.name.replace(/^Le /, "")}`;
  const optEl = $("game-options");
  if (A.renderLobbyOptions) {
    optEl.classList.remove("hidden");
    A.renderLobbyOptions(optEl, room, isHost, app);
  } else {
    optEl.classList.add("hidden");
    optEl.dataset.key = "";
  }
  hud.syncPlates(seats.map((s) => ({ id: s.id, name: playerName(s.id), connected: isConnected(s.id), statusText: "s'installe" })));
}

function handOrder(hand) {
  if (!S.sorted || !S.adapter) return hand.map((c) => c.id);
  if (S.adapter.sortHand) return S.adapter.sortHand(hand, S.game).map((c) => c.id);
  const idx = Object.fromEntries(S.adapter.rankOrder.map((r, i) => [r, i]));
  return hand.slice().sort((a, b) => idx[a.rank] - idx[b.rank] || SUIT_INDEX[a.suit] - SUIT_INDEX[b.suit]).map((c) => c.id);
}

function updateSortButton() {
  $("btn-sort").classList.toggle("active", S.sorted);
  $("btn-sort").innerHTML = S.sorted ? `✅<span class="pill-txt"> Triées</span>` : `🔀<span class="pill-txt"> Trier</span>`;
}

function showGame() {
  const g = S.game;
  const A = ADAPTERS[g.gameId] || menteurUi;
  if (S.adapter !== A) {
    if (S.adapter && S.adapter.hideOverlays) S.adapter.hideOverlays(app);
    S.adapter = A;
    table.maxSelect = A.maxSelect;
    $("btn-sort").classList.toggle("hidden", !!A.hideSort);
    table.pendingFaceUp = A.pendingFaceUp;
    S.sorted = A.defaultSorted;
    updateSortButton();
  }
  S.screen = "game";
  hud.showScreen("game");
  world.setMode("game");
  applySeats(g.seatOrder);
  table.pruneSelection(g.hand.map((c) => c.id));

  const dealKey = A.dealKey(g);
  if (dealKey !== S.lastDealKey) {
    const sameGame = S.lastUid === g.uid;
    S.lastDealKey = dealKey;
    const animate = sameGame || A.isFreshDeal(g);
    if (!sameGame) {
      S.lastUid = g.uid;
      S.lastEventId = animate ? 0 : g.lastEventId;
      S.revealKey = null;
      S.endShownFor = null;
      S.roundEndShown = null;
      hud.hideEnd();
    }
    table.clearSelection();
    if (animate) {
      S.dealing = true;
      table.gatherToDeck(true);
      setTimeout(() => {
        table.applyState(A.desired(S.game, handOrder(S.game.hand), app), { deal: true });
        setTimeout(() => {
          S.dealing = false;
          // certains jeux affichent des cartes en plus une fois la donne finie
          // (ex : les cartes tendues par le voisin au Pouilleux)
          if (S.game && S.adapter === A && S.screen === "game") table.applyState(A.desired(S.game, handOrder(S.game.hand), app));
          refreshGameUi();
        }, 1900);
      }, 750);
    } else {
      table.applyState(A.desired(g, handOrder(g.hand), app), { instant: true });
    }
  } else if (!S.dealing) {
    table.applyState(A.desired(g, handOrder(g.hand), app));
  }
  processEvents(g);
  refreshGameUi();
}

function processEvents(g) {
  const fresh = g.history.filter((e) => e.id > S.lastEventId);
  S.lastEventId = Math.max(S.lastEventId, g.lastEventId);
  for (const ev of fresh) S.adapter.onEvent(ev, app);
}

// ------------------------------------------------------------------ UI de jeu commune

function refreshGameUi() {
  const g = S.game;
  const A = S.adapter;
  if (!g || !A || S.screen !== "game") return;
  const you = g.you;
  const dealing = S.dealing;
  const playing = A.isPlaying(g);
  const myTurn = !dealing && playing && you.isYourTurn;

  table.setInteractive(!dealing && !you.isFinished && (playing || g.phase === "exchange" || g.phase === "reveal_pending"));
  table.setTurnGlow(dealing || !playing ? null : myTurn ? "__me" : g.currentTurn);

  if (!dealing && playing && g.currentTurn) {
    const pos = g.currentTurn === S.me.id ? world.anchors.myToken : S.seatPhi.has(g.currentTurn) ? world.seatPoint(S.seatPhi.get(g.currentTurn), 0.5) : null;
    if (pos) world.moveTokenTo(pos);
  } else if (["finished", "round_end", "exchange", "showdown", "waiting"].includes(g.phase)) {
    world.hideToken();
  }
  const ring = myTurn && (!A.showRing || A.showRing(g));
  if (!table.drag) world.setPileRing(ring ? "idle" : "hidden");

  if (myTurn && !S.wasMyTurn) {
    hud.showTurnBanner(A.turnBanner(g));
    sfx.play("turn");
    if (navigator.vibrate) navigator.vibrate([70, 60, 70]);
  }
  S.wasMyTurn = myTurn;

  A.refresh(g, app);
  updatePlayButton();
}

function updatePlayButton() {
  const g = S.game;
  const btn = $("btn-play");
  if (!g || !S.adapter || S.screen !== "game") return btn.classList.add("hidden");
  const r = S.adapter.playButton(g, table.getSelected(), app);
  btn.classList.toggle("hidden", !r.show);
  if (r.show) btn.textContent = r.text;
}

function leaveTable() {
  S.leaving = true;
  socket.emit("room:leave", {}, () => {});
  clearSession();
  hud.closeModal();
  showHome();
}

// ------------------------------------------------------------------ boutons

function bindUi() {
  const nameInput = $("in-name");
  const codeInput = $("in-code");
  nameInput.value = savedName();
  const params = new URLSearchParams(location.search);
  const urlCode = (params.get("c") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  if (urlCode) codeInput.value = urlCode;
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  });

  const needName = () => {
    const n = nameInput.value.trim();
    if (!n) {
      hud.toast("Donne-toi un blaze d'abord 😉");
      nameInput.focus();
      return null;
    }
    rememberName(n);
    return n;
  };
  // Verrou anti double-clic : une seule demande "ouvrir / rejoindre" a la fois.
  let joining = false;
  let lockTimer = null;
  const lock = (on) => {
    joining = on;
    clearTimeout(lockTimer);
    if (on) lockTimer = setTimeout(() => lock(false), 8000);
    $("btn-create").disabled = on;
    $("btn-join").disabled = on;
  };
  const onJoined = (res, name) => {
    lock(false);
    S.leaving = false;
    if (!res || !res.ok) {
      hud.toast((res && res.error) || "Impossible de rejoindre cette table.");
      sfx.play("error");
      return;
    }
    S.me.id = res.playerId;
    S.me.name = name;
    S.pendingCode = res.code;
    saveSession();
    if (location.search) history.replaceState(null, "", "/");
  };

  $("btn-create").addEventListener("click", () => {
    if (joining) return;
    const name = needName();
    if (!name) return;
    lock(true);
    S.leaving = false;
    socket.emit("room:create", { name }, (res) => onJoined(res, name));
  });
  $("btn-join").addEventListener("click", () => {
    const name = needName();
    if (!name) return;
    const code = codeInput.value.trim();
    if (code.length !== 4) {
      hud.toast("Le code de la table fait 4 lettres.");
      codeInput.focus();
      return;
    }
    if (joining) return;
    lock(true);
    S.leaving = false;
    socket.emit("room:join", { name, code }, (res) => onJoined(res, name));
  });
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-join").click(); });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") (codeInput.value.length === 4 ? $("btn-join") : $("btn-create")).click(); });

  $("btn-fullscreen-home").addEventListener("click", fullscreenAction);
  $("btn-rules-home").addEventListener("click", () => {
    hud.openModal("Les règles de la maison", Object.values(ADAPTERS).map((A) => `<h4 class="rules-game">${A.emoji} ${A.name}</h4>${A.rulesHtml()}`).join(""));
  });

  $("btn-start").addEventListener("click", () => app.emit("room:start", {}));
  $("btn-add-bot").addEventListener("click", () => {
    sfx.play("select");
    app.emit("room:addBot", {});
  });
  $("btn-rules-lobby").addEventListener("click", () => {
    const A = ADAPTERS[S.room && S.room.gameType] || menteurUi;
    hud.openModal(`Règles · ${A.name}`, A.rulesHtml());
  });
  $("btn-leave").addEventListener("click", leaveTable);
  $("btn-share").addEventListener("click", async () => {
    const url = joinUrl(S.room.code);
    const A = ADAPTERS[S.room.gameType] || menteurUi;
    const text = `Viens jouer au ${A.name.replace(/^Le /, "")} au Carré ! Table ${S.room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Le Carré", text, url });
      else {
        await navigator.clipboard.writeText(url);
        hud.toast("Lien copié ! Colle-le dans ta conv 📋");
      }
    } catch (e) { /* partage annule */ }
  });

  // emotes
  const palette = $("emote-palette");
  palette.innerHTML = EMOTES.map((e) => `<button data-emote="${e}" data-no-fs aria-label="${e}">${e}</button>`).join("");
  const closePalette = () => {
    palette.classList.add("hidden");
    $("btn-emote").classList.remove("open");
  };
  $("btn-emote").addEventListener("click", (ev) => {
    ev.stopPropagation();
    const open = palette.classList.toggle("hidden") === false;
    $("btn-emote").classList.toggle("open", open);
  });
  palette.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-emote]");
    if (!b) return;
    ev.stopPropagation();
    closePalette();
    socket.emit("room:emote", { emoji: b.dataset.emote }, (res) => {
      if (res && res.error) hud.toast(res.error, 1200);
    });
  });
  document.addEventListener("pointerdown", (ev) => {
    if (!palette.classList.contains("hidden") && !ev.target.closest("#emote-palette, #btn-emote")) closePalette();
  });

  $("btn-liar").addEventListener("click", () => app.emit("game:accuse", {}));
  $("btn-pass").addEventListener("click", () => {
    table.clearSelection();
    app.emit("game:pass", {});
  });
  $("btn-pickup").addEventListener("click", () => app.emit("game:pickup", {}));
  $("btn-play").addEventListener("click", () => {
    if (S.adapter && S.game) S.adapter.commitPlay(table.getSelected(), S.game, app);
  });
  $("btn-sort").addEventListener("click", () => {
    S.sorted = !S.sorted;
    updateSortButton();
    if (S.game) table.setHandOrder(handOrder(S.game.hand));
    sfx.play("pickup", 2);
  });
  $("btn-sound").textContent = sfx.enabled ? "🔊" : "🔇";
  $("btn-sound").addEventListener("click", () => {
    $("btn-sound").textContent = sfx.toggle() ? "🔊" : "🔇";
  });
  $("announce").addEventListener("click", openHistory);
  $("pile-chip").addEventListener("click", openHistory);
  $("tray-chip").addEventListener("click", openTray);
  $("btn-menu").addEventListener("click", () => {
    const A = S.adapter;
    const isHost = S.room && S.room.hostId === S.me.id;
    hud.openModal("Menu", `<div class="menu-list">
      <button class="btn wood" data-act="history">📜 Historique</button>
      <button class="btn wood" data-act="tray">🗃️ ${A ? A.trayTitle : "Cartes sorties"}</button>
      <button class="btn wood" data-act="rules">📖 Règles ${A ? "du " + A.name.replace(/^Le /, "") : ""}</button>
      ${FS.isStandalone() ? "" : `<button class="btn wood" data-act="fs" data-no-fs>${fsLabel()}</button>`}
      ${isHost ? `<button class="btn wood" data-act="lobby">🎲 Changer de jeu</button>` : ""}
      <button class="btn brass" data-act="leave">🚪 Quitter la table</button>
    </div>${S.version ? `<p class="menu-version">Le Carré · version ${S.version}</p>` : ""}`);
    document.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "history") openHistory();
      else if (act === "tray") openTray();
      else if (act === "fs") fullscreenAction();
      else if (act === "rules") hud.openModal(`Règles · ${A ? A.name : ""}`, A ? A.rulesHtml() : "");
      else if (act === "lobby") {
        hud.closeModal();
        app.emit("room:playAgain", {});
      } else if (act === "leave") leaveTable();
    }));
  });
}

// ------------------------------------------------------------------ plein ecran

function fsLabel() {
  if (FS.isFullscreen() && !FS.isStandalone()) return "⛶ Quitter le plein écran";
  if (!FS.canFullscreen() && FS.canInstall()) return "📲 Installer l'appli";
  return FS.isIOS() ? "📲 Plein écran" : "⛶ Plein écran";
}

function updateFsButton() {
  const b = $("btn-fullscreen-home");
  b.classList.toggle("hidden", FS.isStandalone());
  b.textContent = fsLabel();
}

function fullscreenAction() {
  if (FS.canFullscreen()) {
    FS.toggleFullscreen();
    hud.closeModal();
  } else if (FS.canInstall()) {
    FS.promptInstall();
  } else {
    hud.openModal("Jouer en plein écran", FS.helpHtml());
  }
}

// ------------------------------------------------------------------ connexion
//
// Sur telephone, la connexion saute souvent (ecran qui s'eteint, appli mise
// en arriere-plan, Wi-Fi du bar). On se reconnecte tout seul, on
// resynchronise l'etat quand l'appli revient au premier plan, et on verifie
// regulierement qu'on est toujours a jour.

let netTimer = null;
let syncing = false;

function setNetBanner(show) {
  clearTimeout(netTimer);
  const el = $("net-banner");
  if (!show) {
    el.classList.add("hidden");
    return;
  }
  // petit delai : pas de clignotement pour une micro-coupure
  netTimer = setTimeout(() => {
    if (!socket.connected && S.screen && S.screen !== "home") el.classList.remove("hidden");
  }, 1200);
}

// Se rassoit a sa table (apres une coupure ou un refresh). Renvoie false s'il
// n'y a pas de table memorisee.
function doRejoin() {
  const saved = loadSession();
  if (!saved || !saved.playerId || !saved.code) return false;
  S.me.id = saved.playerId;
  S.me.name = saved.name;
  socket.emit("room:rejoin", { code: saved.code, playerId: saved.playerId }, (res) => {
    if (!res || !res.ok) {
      if (res && res.gone) {
        clearSession();
        if (S.screen && S.screen !== "home") hud.toast(res.error || "Cette table n'existe plus.", 4000);
        if (S.screen !== "home") showHome();
      }
    }
  });
  return true;
}

// Verifie qu'on est bien a jour ; sinon se reconnecte / se rassoit.
function resync() {
  if (!loadSession() || syncing) return;
  if (!socket.connected) {
    socket.connect();
    return;
  }
  syncing = true;
  let answered = false;
  const guard = setTimeout(() => {
    // pas de reponse : connexion "zombie" -> on repart sur une connexion neuve
    syncing = false;
    if (!answered) {
      socket.disconnect();
      socket.connect();
    }
  }, 5000);
  socket.emit("room:sync", {}, (res) => {
    answered = true;
    syncing = false;
    clearTimeout(guard);
    if (!res || !res.ok) doRejoin();
  });
}

function setupConnectionWatch() {
  socket.on("disconnect", () => setNetBanner(true));
  socket.io.on("reconnect_attempt", () => setNetBanner(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resync();
  });
  window.addEventListener("pageshow", resync);
  window.addEventListener("online", resync);
  window.addEventListener("focus", resync);
  // filet de securite : toutes les 15 s tant que l'appli est affichee
  setInterval(() => {
    if (document.visibilityState === "visible" && S.screen && S.screen !== "home") resync();
  }, 15000);
}

function openHistory() {
  if (!S.game || !S.adapter) return;
  const A = S.adapter;
  if (A.fetchHistory) {
    // historique complet demande au serveur (il n'est pas envoye a chaque coup)
    hud.openModal("Ce qui s'est passé", A.historyHtml(S.game.history, esc));
    socket.emit("game:history", {}, (res) => {
      if (res && res.ok && S.adapter === A && !$("modal").classList.contains("hidden")) {
        $("modal-body").innerHTML = A.historyHtml(res.history, esc);
      }
    });
    return;
  }
  hud.openModal("Ce qui s'est passé", A.historyHtml(S.game.history, esc));
}
function openTray() {
  if (!S.game || !S.adapter) return;
  hud.openModal(S.adapter.trayTitle, S.adapter.trayHtml(S.game, hud));
  if (S.adapter.bindTray) S.adapter.bindTray($("modal-body"), S.game);
}

// ------------------------------------------------------------------ boucle HUD

function projectSeat(id) {
  const a = table.seatAnchor(id);
  if (!a) return null;
  const s = world.toScreen(a);
  return s.visible ? s : null;
}

function hudFrame() {
  if (S.adapter && S.adapter.frame) S.adapter.frame(app);
  if (S.screen === "game" || S.screen === "lobby") hud.positionPlates(projectSeat);
  if (S.screen === "game" && S.game && S.adapter && !S.dealing) {
    const chips = S.adapter.chips(S.game);
    const pile = world.toScreen(table.pileAnchor().add({ x: 0, y: 0, z: world.feltRadius.z * 0.78 }));
    hud.positionChip("pile-chip", pile, chips.pile);
    const ta = table.trayAnchor();
    hud.positionChip("tray-chip", ta ? world.toScreen(ta) : null, chips.tray);
  } else {
    hud.positionChip("pile-chip", null, "");
    hud.positionChip("tray-chip", null, "");
  }
}

// ------------------------------------------------------------------ demarrage

async function boot() {
  await ensureCardFonts();
  try {
    await Promise.all([
      document.fonts.load('700 20px "Cabin Sketch"'),
      document.fonts.load('900 20px "Nunito"'),
      document.fonts.load('italic 900 20px "Playfair Display"')
    ]);
  } catch (e) { /* ignore */ }
  paintCssTextures();
  buildCatalog();

  world = new World($("scene"));
  sfx = new Sfx();
  hud = new Hud();
  table = new CardTable(world, {
    canDrop: (ids) => !!(S.adapter && S.game && S.adapter.canDrop(ids, S.game, app)),
    onDrop: (ids) => { if (S.adapter && S.game) S.adapter.commitPlay(ids, S.game, app); },
    onHandTop: () => updateHandCssVar(),
    onPick: (slot) => { if (S.adapter && S.adapter.onPick && S.game) S.adapter.onPick(slot, S.game, app); },
    onSelectionChange: () => {
      sfx.play("select");
      updatePlayButton();
    },
    onSelectLimit: () => hud.toast(`${table.maxSelect} cartes maximum à la fois.`),
    onTrayClick: openTray,
    onPileClick: openHistory,
    onLand: (sound, count) => sound && sfx.play(sound, count),
    onDragEnd: () => {
      const g = S.game;
      world.setPileRing(g && S.adapter && S.adapter.isPlaying(g) && g.you.isYourTurn ? "idle" : "hidden");
    }
  });

  app = {
    S,
    world,
    table,
    hud,
    sfx,
    get socket() { return socket; },
    who: (id) => (id === S.me.id ? "me" : id),
    shake() {
      document.body.classList.remove("shake");
      void document.body.offsetWidth;
      document.body.classList.add("shake");
    },
    emit(ev, data, onOk, onErr) {
      socket.emit(ev, data || {}, (res) => {
        if (!res || !res.ok) {
          hud.toast((res && res.error) || "Oups, ça n'a pas marché.");
          sfx.play("error");
          if (onErr) onErr(res);
        } else if (onOk) onOk(res);
        updatePlayButton();
      });
    },
    leaveTable,
    openTray: () => openTray()
  };

  world.onResize = () => {
    updateHandCssVar();
    table.layoutAll();
  };
  updateHandCssVar();
  world.onFrame(hudFrame);
  // numero de version affiche en bas de l'accueil et du salon
  fetch("/version.json").then((r) => r.json()).then((d) => {
    S.version = d.version;
    $("app-version").textContent = `Le Carré · v${d.version}`;
  }).catch(() => {});
  FS.setupFullscreen();
  bindUi();
  FS.onChange(updateFsButton);
  updateFsButton();

  socket = io({ reconnectionDelay: 500, reconnectionDelayMax: 3000, timeout: 8000 });
  socket.on("state", onState);
  setupConnectionWatch();
  socket.on("emote", ({ playerId, emoji }) => {
    if (S.screen !== "game") return;
    hud.floatEmote(playerId === S.me.id ? "me" : playerId, emoji);
    sfx.play("select");
  });
  socket.on("connect", () => {
    setNetBanner(false);
    if (!doRejoin() && !S.screen) showHome();
  });
  if (!loadSession()) showHome();

  // point d'acces pour le debogage (console du navigateur, tests automatises)
  window.__menteur = {
    S,
    world,
    table,
    hud,
    get socket() { return socket; },
    screenOfCard(id) {
      const e = table.entities.find((x) => x.id === id && x.zone === "me");
      return e ? world.toScreen(e.group.position) : null;
    },
    screenOfPile() {
      return world.toScreen(world.anchors.pile);
    }
  };

  setTimeout(() => $("loader").classList.add("gone"), 250);
  setTimeout(() => $("loader").remove(), 1000);
}

boot().catch((err) => {
  console.error(err);
  $("loader").querySelector("p").textContent = "Oups, ton navigateur n'arrive pas à afficher la 3D. Essaie avec Chrome ou Safari à jour.";
});
