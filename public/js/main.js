// Point d'entree : relie le reseau (Socket.io), la scene 3D, les cartes et le HUD.
import { World } from "./scene/world.js";
import { woodCanvas } from "./scene/textures.js";
import { CardTable } from "./game/cardTable.js";
import { Hud, claimText, rankPlural } from "./ui/hud.js";
import { Sfx } from "./ui/audio.js";
import { ensureCardFonts, RANK_ORDER } from "./cards/cardArt.js";
import qrcode from "/vendor/qrcode.mjs";

const SESSION_KEY = "menteurSession";
const $ = (id) => document.getElementById(id);
const RANK_INDEX = Object.fromEntries(RANK_ORDER.map((r, i) => [r, i]));
const SUIT_INDEX = { pique: 0, coeur: 1, trefle: 2, carreau: 3 };

const S = {
  me: { id: null, name: "" },
  room: null,
  game: null,
  screen: null,
  lastUid: null,
  lastEventId: 0,
  dealing: false,
  wasMyTurn: false,
  revealKey: null,
  endShownFor: null,
  sorted: false,
  seatsKey: "",
  seatPhi: new Map()
};

let world;
let table;
let hud;
let sfx;
let socket;

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

function updateHandCssVar() {
  if (!world) return;
  const px = Math.round(world.handFraction() * window.innerHeight);
  document.documentElement.style.setProperty("--hand-h", `${px}px`);
}

// ------------------------------------------------------------------ sieges

function computeSeats(orderedIds) {
  const idx = orderedIds.indexOf(S.me.id);
  const rel = idx >= 0 ? orderedIds.slice(idx + 1).concat(orderedIds.slice(0, idx)) : orderedIds.slice();
  const phis = World.opponentPhis(rel.length);
  return rel.map((id, i) => ({ id, phi: phis[i] }));
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
  if (!S.room) return "?";
  const p = S.room.players.find((x) => x.id === id);
  return p ? p.name : "?";
}

function isConnected(id) {
  const p = S.room && S.room.players.find((x) => x.id === id);
  return p ? p.connected : false;
}

// ------------------------------------------------------------------ routage

function onState({ room, game }) {
  S.room = room;
  S.game = game;
  if (!room) return showHome();
  saveSession();
  if (room.status === "lobby" || !game) showLobby();
  else showGame();
}

function showHome() {
  const was = S.screen;
  S.screen = "home";
  S.room = null;
  S.game = null;
  S.lastUid = null;
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
  S.screen = "lobby";
  S.lastUid = null;
  S.wasMyTurn = false;
  hud.showScreen("lobby");
  world.setMode("lobby");
  world.hideToken();
  world.setPileRing("hidden");
  table.setInteractive(false);
  table.setTurnGlow(null);
  const seats = applySeats(room.players.map((p) => p.id));
  if (firstTime) table.gatherToDeck(true);
  hud.renderLobby(room, S.me.id, joinUrl(room.code), qrcode);
  hud.syncPlates(seats.map((s) => ({ id: s.id, name: playerName(s.id), connected: isConnected(s.id), statusText: "s'installe" })));
}

function handOrder(hand) {
  if (!S.sorted) return hand.map((c) => c.id);
  return hand
    .slice()
    .sort((a, b) => RANK_INDEX[a.rank] - RANK_INDEX[b.rank] || SUIT_INDEX[a.suit] - SUIT_INDEX[b.suit])
    .map((c) => c.id);
}

function showGame() {
  const g = S.game;
  S.screen = "game";
  hud.showScreen("game");
  world.setMode("game");
  applySeats(g.seatOrder);
  table.pruneSelection(g.hand.map((c) => c.id));

  const isNewGame = g.uid !== S.lastUid;
  if (isNewGame) {
    S.lastUid = g.uid;
    S.lastEventId = g.lastEventId;
    S.revealKey = null;
    S.endShownFor = null;
    hud.hideEnd();
    const fresh = g.lastEventId === 0;
    if (fresh) {
      S.dealing = true;
      table.gatherToDeck(true);
      setTimeout(() => {
        table.applyState(S.game, { handOrder: handOrder(S.game.hand), deal: true });
        setTimeout(() => {
          S.dealing = false;
          refreshGameUi();
        }, 1900);
      }, 750);
    } else {
      table.applyState(g, { handOrder: handOrder(g.hand), instant: true });
    }
  } else if (!S.dealing) {
    table.applyState(g, { handOrder: handOrder(g.hand) });
  }
  processEvents(g);
  refreshGameUi();
}

// ------------------------------------------------------------------ evenements

function processEvents(g) {
  const fresh = g.history.filter((e) => e.id > S.lastEventId);
  S.lastEventId = Math.max(S.lastEventId, g.lastEventId);
  for (const ev of fresh) {
    const who = (id) => (id === S.me.id ? "me" : id);
    if (ev.type === "play") {
      hud.bubble(who(ev.playerId), claimText(ev.count, ev.claimedRank));
    } else if (ev.type === "quad_discard") {
      hud.bubble(who(ev.playerId), `Carré de ${rankPlural(ev.rank)} !`, "gold");
      sfx.play("quad");
    } else if (ev.type === "accuse") {
      hud.bubble(who(ev.accuserId), "MENTEUR !", "liar");
      sfx.play("liar");
      document.body.classList.remove("shake");
      void document.body.offsetWidth;
      document.body.classList.add("shake");
    } else if (ev.type === "pickup") {
      hud.bubble(who(ev.playerId), ev.count >= 10 ? `Aïe… ${ev.count} cartes` : "Je ramasse…");
    }
  }
}

// ------------------------------------------------------------------ UI de jeu

function refreshGameUi() {
  const g = S.game;
  if (!g || S.screen !== "game") return;
  const you = g.you;
  const dealing = S.dealing;
  const myTurn = !dealing && g.phase === "playing" && you.isYourTurn;
  const currentName = g.currentTurnName;

  // interaction : on peut toujours manipuler sa main, le tapis dit si c'est permis
  table.setInteractive(!you.isFinished && g.phase !== "finished" && !dealing);
  table.setTurnGlow(dealing || g.phase !== "playing" ? null : myTurn ? "__me" : g.currentTurn);

  // jeton de tour
  if (!dealing && g.phase !== "finished") {
    const pos = myTurn || g.currentTurn === S.me.id ? world.anchors.myToken : S.seatPhi.has(g.currentTurn) ? world.seatPoint(S.seatPhi.get(g.currentTurn), 0.5) : null;
    if (pos) world.moveTokenTo(pos);
  } else if (g.phase === "finished") world.hideToken();

  if (!table.drag) world.setPileRing(myTurn ? "idle" : "hidden");

  if (myTurn && !S.wasMyTurn) {
    hud.showTurnBanner(g.lastPlay === null ? "À toi d'ouvrir !" : "À toi de jouer !");
    sfx.play("turn");
    if (navigator.vibrate) navigator.vibrate([70, 60, 70]);
  }
  S.wasMyTurn = myTurn;

  // plaque d'annonce
  if (dealing) {
    hud.setAnnounce({ label: "Le patron distribue", value: "Les cartes…", sub: "", rank: null, key: "deal" });
  } else if (g.phase === "finished") {
    hud.setAnnounce({ label: "C'est fini", value: "Partie terminée", sub: "", rank: null, key: "end" });
  } else if (g.phase === "reveal_pending") {
    hud.setAnnounce({ label: "Révélation", value: `Des ${rankPlural(g.pendingReveal.claimedRank)} ?`, sub: `${g.pileCount} cartes en jeu`, rank: g.pendingReveal.claimedRank, key: "rev" + g.lastEventId });
  } else if (g.roundLeaderRank) {
    hud.setAnnounce({
      label: "On annonce des",
      value: rankPlural(g.roundLeaderRank),
      sub: `${g.pileCount} carte${g.pileCount > 1 ? "s" : ""} sur le tapis`,
      rank: g.roundLeaderRank,
      key: "r" + g.roundLeaderRank + "-" + (g.history.filter((e) => e.type === "pickup").length)
    });
  } else {
    hud.setAnnounce({ label: "Nouvelle manche", value: myTurn ? "À toi d'annoncer !" : `${currentName} choisit…`, sub: "Tapis vide", rank: null, key: "new" + g.currentTurn + g.lastEventId });
  }

  // bandeau d'aide
  let hint = "";
  if (dealing) hint = "";
  else if (you.isFinished && g.phase !== "finished") hint = "Tu as vidé ta main 🎉 Admire le spectacle, une bière à la main.";
  else if (g.phase === "playing") {
    if (myTurn) {
      if (g.lastPlay === null) hint = "Nouvelle manche : <b>glisse 1 à 3 cartes</b> sur le tapis, puis annonce leur valeur.";
      else if (you.canAccuseNow) hint = `Pose 1 à 3 <b>${rankPlural(g.roundLeaderRank)}</b>… ou crie <b>MENTEUR</b> si tu doutes de ${g.lastPlay.playerName} !`;
      else hint = `Glisse 1 à 3 <b>${rankPlural(g.roundLeaderRank)}</b> sur le tapis (vrais ou pas…).`;
    } else {
      hint = `Au tour de <b>${currentName}</b>…`;
    }
  }
  hud.setHint(hint, myTurn);

  // boutons
  $("btn-liar").classList.toggle("hidden", !(g.phase === "playing" && you.canAccuseNow && !dealing));
  updatePlayButton();
  const counts = {};
  g.hand.forEach((c) => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
  const quads = (g.phase === "playing" || g.phase === "reveal_pending") && !you.isFinished && !dealing
    ? Object.keys(counts).filter((r) => counts[r] === 4) : [];
  hud.setQuadButtons(quads, (rank) => {
    socket.emit("game:quadDiscard", { rank }, (res) => { if (!res.ok) hud.toast(res.error); });
  });

  // plaques
  const finishedIdx = new Map(g.finishedOrder.map((f, i) => [f.id, i]));
  hud.setMyPlate(S.me.name, g.hand.length, you.isFinished ? `Terminé · ${finishedIdx.get(S.me.id) + 1}ᵉ` : null);
  hud.syncPlates(g.opponents.map((o) => ({
    id: o.id,
    name: o.name,
    count: o.cardCount,
    connected: o.connected,
    finished: o.finished,
    active: !dealing && g.phase === "playing" && o.id === g.currentTurn,
    statusText: o.finished ? `🏁 ${finishedIdx.get(o.id) + 1}ᵉ` : !o.connected ? "hors ligne" : ""
  })));

  updateReveal(g);
  updateEnd(g);
}

function updatePlayButton() {
  const g = S.game;
  const btn = $("btn-play");
  if (!g || S.dealing) return btn.classList.add("hidden");
  const sel = table.getSelected();
  const myTurn = g.phase === "playing" && g.you.isYourTurn;
  const show = myTurn && sel.length >= 1 && sel.length <= 3;
  btn.classList.toggle("hidden", !show);
  if (show) btn.textContent = `Poser ${sel.length} carte${sel.length > 1 ? "s" : ""}`;
}

function updateReveal(g) {
  if (g.phase === "reveal_pending" && g.pendingReveal && !S.dealing) {
    const r = g.pendingReveal;
    const key = `${g.uid}-${g.lastEventId}`;
    document.body.classList.add("revealing");
    const loserIsMe = r.loserId === S.me.id;
    const top = `${r.accuserId === S.me.id ? "Tu cries" : r.accuserName + " crie"} MENTEUR sur ${r.accusedId === S.me.id ? "toi" : r.accusedName} !`;
    const verdict = r.mismatch
      ? `${r.accusedId === S.me.id ? "Tu bluffais" : r.accusedName + " bluffait"} !`
      : `${r.accusedId === S.me.id ? "Tu disais" : r.accusedName + " disait"} la vérité…`;
    const who = loserIsMe ? "Tu ramasses" : `${r.loserName} ramasse`;
    const pileWords = r.pileCount > 1 ? `les ${r.pileCount} cartes` : "la carte";
    const show = (withText) => hud.showReveal({
      top,
      text: withText ? `${verdict} ${who} ${pileWords}.` : "",
      canPickup: withText && g.you.canPickupNow,
      pickupLabel: `🫳 Ramasser ${pileWords}`,
      wait: withText && !loserIsMe ? `En attente que ${r.loserName} ramasse…` : ""
    });
    if (S.revealKey !== key) {
      S.revealKey = key;
      table.setRevealClaim(null);
      show(false);
      // le tampon tombe quand les cartes sont retournees devant tout le monde
      S.stampPending = {
        key,
        t0: performance.now(),
        fire: () => {
          table.setRevealClaim(r.claimedRank);
          hud.stamp(r.mismatch);
          sfx.play("stamp");
          setTimeout(() => sfx.play(r.mismatch ? "bluff" : "truth"), 180);
          document.body.classList.remove("shake");
          void document.body.offsetWidth;
          document.body.classList.add("shake");
          show(true);
        }
      };
    } else if (table.revealClaim) {
      show(true);
    }
  } else {
    if (S.revealKey) {
      S.revealKey = null;
      table.setRevealClaim(null);
    }
    document.body.classList.remove("revealing");
    hud.hideReveal();
  }
}

function updateEnd(g) {
  if (g.phase !== "finished") return;
  if (S.endShownFor === g.uid) return;
  S.endShownFor = g.uid;
  setTimeout(() => {
    if (!S.game || S.game.uid !== g.uid) return;
    const entries = g.finishedOrder.map((f) => ({ name: f.name, me: f.id === S.me.id }));
    if (g.finishedOrder[0] && g.finishedOrder[0].id === S.me.id) sfx.play("win");
    hud.showEnd(entries, S.room.hostId === S.me.id, () => {
      socket.emit("room:rematch", {}, (res) => { if (!res.ok) hud.toast(res.error); });
    }, leaveTable);
  }, 1200);
}

// ------------------------------------------------------------------ actions

function canDrop(ids) {
  const g = S.game;
  return !!g && g.phase === "playing" && g.you.isYourTurn && !S.dealing && ids.length >= 1 && ids.length <= 3;
}

function commitPlay(ids) {
  const g = S.game;
  if (!canDrop(ids)) {
    if (!g || !g.you.isYourTurn) hud.toast(`Pas si vite ! C'est au tour de ${g ? g.currentTurnName : "…"}.`);
    else if (ids.length > 3) hud.toast("3 cartes maximum par pose.");
    sfx.play("error");
    return;
  }
  table.setPendingDrop(ids);
  const send = (declaredRank) => {
    socket.emit("game:play", { cardIds: ids, declaredRank }, (res) => {
      if (!res.ok) {
        table.clearPendingDrop();
        hud.toast(res.error);
        sfx.play("error");
      } else {
        table.clearSelection();
        updatePlayButton();
      }
    });
  };
  if (g.lastPlay === null) {
    hud.openRankPicker((rank) => send(rank), () => table.clearPendingDrop());
  } else {
    send(undefined);
  }
}

function leaveTable() {
  socket.emit("room:leave", {}, () => {});
  clearSession();
  hud.hideEnd();
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
  const onJoined = (res, name) => {
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
    const name = needName();
    if (!name) return;
    socket.emit("room:create", { name, gameType: "menteur" }, (res) => onJoined(res, name));
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
    socket.emit("room:join", { name, code }, (res) => onJoined(res, name));
  });
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-join").click(); });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") (codeInput.value.length === 4 ? $("btn-join") : $("btn-create")).click(); });

  $("btn-rules-home").addEventListener("click", () => hud.openModal("Les règles de la maison", hud.rulesHtml()));

  $("btn-start").addEventListener("click", () => {
    socket.emit("room:start", {}, (res) => { if (!res.ok) hud.toast(res.error); });
  });
  $("btn-leave").addEventListener("click", leaveTable);
  $("btn-share").addEventListener("click", async () => {
    const url = joinUrl(S.room.code);
    const text = `Viens jouer au Menteur ! Table ${S.room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Le Menteur", text, url });
      else {
        await navigator.clipboard.writeText(url);
        hud.toast("Lien copié ! Colle-le dans ta conv 📋");
      }
    } catch (e) { /* partage annule */ }
  });

  $("btn-liar").addEventListener("click", () => {
    socket.emit("game:accuse", {}, (res) => { if (!res.ok) hud.toast(res.error); });
  });
  $("btn-pickup").addEventListener("click", () => {
    socket.emit("game:pickup", {}, (res) => { if (!res.ok) hud.toast(res.error); });
  });
  $("btn-play").addEventListener("click", () => commitPlay(table.getSelected()));
  $("btn-sort").addEventListener("click", () => {
    S.sorted = !S.sorted;
    $("btn-sort").classList.toggle("active", S.sorted);
    $("btn-sort").textContent = S.sorted ? "✅ Triées" : "🔀 Trier";
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
    hud.openModal("Menu", `<div class="menu-list">
      <button class="btn wood" data-act="history">📜 Historique</button>
      <button class="btn wood" data-act="tray">✨ Cartes sorties</button>
      <button class="btn wood" data-act="rules">📖 Règles</button>
      <button class="btn brass" data-act="leave">🚪 Quitter la table</button>
    </div>`);
    document.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "history") openHistory();
      else if (act === "tray") openTray();
      else if (act === "rules") hud.openModal("Les règles de la maison", hud.rulesHtml());
      else if (act === "leave") leaveTable();
    }));
  });
}

function openHistory() {
  if (!S.game) return;
  hud.openModal("Ce qui s'est passé", hud.historyHtml(S.game.history));
}
function openTray() {
  if (!S.game) return;
  hud.openModal("Cartes sorties", hud.quadsHtml(S.game.removedQuads));
}

// ------------------------------------------------------------------ boucle HUD

function projectSeat(id) {
  const a = table.seatAnchor(id);
  if (!a) return null;
  const s = world.toScreen(a);
  return s.visible ? s : null;
}

function hudFrame() {
  const sp = S.stampPending;
  if (sp) {
    if (sp.key !== S.revealKey) S.stampPending = null;
    else if (performance.now() - sp.t0 > 700 && table.isSettled("reveal")) {
      if (!sp.landedAt) sp.landedAt = performance.now();
      if (performance.now() - sp.landedAt > 350) {
        S.stampPending = null;
        sp.fire();
      }
    }
  }
  if (S.screen === "game" || S.screen === "lobby") hud.positionPlates(projectSeat);
  if (S.screen === "game" && S.game && !S.dealing && S.game.phase !== "reveal_pending") {
    const pile = world.toScreen(table.pileAnchor().add({ x: 0, y: 0, z: world.feltRadius.z * 0.78 }));
    const n = S.game.pileCount;
    hud.positionChip("pile-chip", pile, n ? `<b>${n}</b> carte${n > 1 ? "s" : ""} sur le tapis` : "");
    const ta = table.trayAnchor();
    const q = S.game.removedQuads.length;
    hud.positionChip("tray-chip", ta ? world.toScreen(ta) : null, q ? `✨ ${q} carré${q > 1 ? "s" : ""} sorti${q > 1 ? "s" : ""}` : "");
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

  world = new World($("scene"));
  sfx = new Sfx();
  hud = new Hud();
  table = new CardTable(world, {
    canDrop,
    onDrop: (ids, legal) => {
      if (legal) commitPlay(ids);
      else commitPlay(ids);
    },
    onSelectionChange: () => {
      sfx.play("select");
      updatePlayButton();
    },
    onSelectLimit: () => hud.toast("3 cartes maximum par pose."),
    onTrayClick: openTray,
    onPileClick: openHistory,
    onLand: (sound, count) => sound && sfx.play(sound, count),
    onDragEnd: () => {
      const g = S.game;
      world.setPileRing(g && g.phase === "playing" && g.you.isYourTurn ? "idle" : "hidden");
    }
  });
  world.onResize = () => {
    updateHandCssVar();
    table.layoutAll();
  };
  updateHandCssVar();
  world.onFrame(hudFrame);
  bindUi();

  socket = io();
  socket.on("state", onState);
  socket.on("connect", () => {
    const saved = loadSession();
    if (saved && saved.playerId && saved.code) {
      S.me.id = saved.playerId;
      S.me.name = saved.name;
      socket.emit("room:rejoin", { code: saved.code, playerId: saved.playerId }, (res) => {
        if (!res || !res.ok) {
          clearSession();
          if (S.screen !== "home") showHome();
        }
      });
    } else if (!S.screen) {
      showHome();
    }
  });
  if (!loadSession()) showHome();

  // petit point d'acces pour le debogage (console du navigateur, tests automatises)
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
