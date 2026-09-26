// Adaptateur client de l'Ascenseur : annonces du nombre de plis, pli pose
// devant chaque joueur, atout retourne dans la boite, plis remportes en tas,
// tableau des scores entre les manches, reglages dans le salon.
import { RANK_NAMES } from "../cards/cardArt.js";
import { miniCardUrl } from "../ui/hud.js";

const $ = (id) => document.getElementById(id);
const ORDER = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R", "A"];
const POWER = Object.fromEntries(ORDER.map((r, i) => [r, i]));
const SYM = { pique: "♠", coeur: "♥", carreau: "♦", trefle: "♣" };
const SUIT_NAME = { pique: "Pique", coeur: "Cœur", carreau: "Carreau", trefle: "Trèfle" };
const SUIT_SORT = ["pique", "coeur", "trefle", "carreau"];
const MODE_LABELS = {
  "up-down": "Monte puis descend",
  "down-up": "Descend puis monte",
  up: "Monte seulement",
  down: "Descend seulement"
};

const cardName = (c) => `${RANK_NAMES[c.rank] ? RANK_NAMES[c.rank][0] : c.rank} ${SYM[c.suit]}`;
const plis = (n) => `${n} pli${n > 1 ? "s" : ""}`;
const cartes = (n) => `${n} carte${n > 1 ? "s" : ""}`;
const signed = (n) => (n > 0 ? `+${n}` : String(n));

// Meme calcul que le serveur, pour afficher la suite des manches dans le salon.
export function buildSequence({ maxCards, mode, step }) {
  const up = [];
  for (let c = 1; c < maxCards; c += step) up.push(c);
  up.push(maxCards);
  const down = up.slice().reverse();
  if (mode === "up") return up;
  if (mode === "down") return down;
  if (mode === "down-up") return down.concat(up.slice(1));
  return up.concat(down.slice(1));
}

function lobbyOptions(room) {
  const n = Math.max(3, room.players.length);
  const hardMax = Math.floor(52 / n);
  const o = (room.options && room.options.ascenseur) || {};
  const asked = parseInt(o.maxCards, 10);
  const maxCards = asked > 0 ? Math.min(asked, hardMax) : hardMax;
  return {
    maxCards,
    hardMax,
    auto: !(asked > 0) || asked >= hardMax,
    mode: MODE_LABELS[o.mode] ? o.mode : "up-down",
    step: o.step === 2 ? 2 : 1
  };
}

function seqText(seq) {
  if (seq.length <= 17) return seq.join(" · ");
  return `${seq.slice(0, 7).join(" · ")} · … · ${seq.slice(-5).join(" · ")}`;
}

export default {
  id: "ascenseur",
  name: "L'Ascenseur",
  emoji: "🛗",
  tagline: "Annonce tes plis… et tiens parole !",
  players: "3 à 8 joueurs",
  maxSelect: 1,
  pendingFaceUp: true,
  defaultSorted: true,
  rankOrder: ORDER,

  // Tri de la main : par couleur (couleurs alternees), l'atout a droite,
  // puis par force.
  sortHand(hand, v) {
    const trump = v && v.trumpSuit;
    const suitIdx = (s) => (s === trump ? 10 : SUIT_SORT.indexOf(s));
    return hand.slice().sort((a, b) => suitIdx(a.suit) - suitIdx(b.suit) || POWER[a.rank] - POWER[b.rank]);
  },

  dealKey: (v) => `${v.uid}-${v.round}`,
  isFreshDeal(v) {
    for (let i = v.history.length - 1; i >= 0; i -= 1) {
      const e = v.history[i];
      if (e.type === "bid" || e.type === "play") return false;
      if (e.type === "round_start") return true;
    }
    return true;
  },

  desired(v, handOrder, app) {
    const byId = new Map(v.hand.map((c) => [c.id, c]));
    const me = handOrder.map((id) => byId.get(id)).filter(Boolean);
    const opp = new Map(v.opponents.map((o) => [o.id, o.cardCount]));
    const myId = app ? app.S.me.id : v.you.id;
    const trick = v.trick.map((p) => ({ card: p.card, owner: p.playerId === myId ? "__me" : p.playerId, win: p.playerId === v.trickWinner }));
    const won = new Map(v.players.map((p) => [p.id === myId ? "__me" : p.id, p.wonCards]));
    if (app) app.table.trickSize = v.seatOrder.length;
    return { me, opp, trick, won, talon: v.talonCount, trump: v.trump ? [v.trump] : [] };
  },

  turnBanner(v) {
    if (v.you.mustBid) return "À toi d'annoncer !";
    return v.trick.length === 0 ? "À toi d'entamer !" : "À toi de jouer !";
  },
  isPlaying: (v) => v.phase === "bidding" || v.phase === "playing",
  showRing: (v) => v.phase === "playing",

  legality(ids, v, app) {
    if (!v || app.S.dealing) return { ok: false, why: "" };
    if (v.phase === "bidding") return { ok: false, why: v.you.mustBid ? "Annonce d'abord ton nombre de plis." : "Attends la fin des annonces." };
    if (v.phase === "trick_done") return { ok: false, why: "Le pli est en train d'être ramassé…" };
    if (v.phase !== "playing") return { ok: false, why: "" };
    if (!v.you.isYourTurn) return { ok: false, why: `Pas si vite ! C'est au tour de ${v.currentTurnName}.` };
    if (ids.length !== 1) return { ok: false, why: "Une seule carte à la fois." };
    if (!v.you.legalIds.includes(ids[0])) {
      return { ok: false, why: `Tu dois fournir : joue du ${SUIT_NAME[v.leadSuit]} ${SYM[v.leadSuit]}.` };
    }
    return { ok: true };
  },

  canDrop(ids, v, app) {
    return this.legality(ids, v, app).ok;
  },

  commitPlay(ids, v, app) {
    const l = this.legality(ids, v, app);
    if (!l.ok) {
      if (l.why) app.hud.toast(l.why);
      app.sfx.play("error");
      return;
    }
    app.table.setPendingDrop(ids);
    app.emit("game:play", { cardIds: ids }, () => app.table.clearSelection(), () => app.table.clearPendingDrop());
  },

  playButton(v, sel, app) {
    if (app.S.dealing || sel.length !== 1) return { show: false };
    if (!this.legality(sel, v, app).ok) return { show: false };
    const c = v.hand.find((x) => x.id === sel[0]);
    return { show: true, text: `Poser : ${cardName(c)}` };
  },

  onEvent(ev, app) {
    const { hud, sfx, S } = app;
    const who = app.who;
    const me = S.me.id;
    switch (ev.type) {
      case "round_start":
        hud.toast(`🛗 Manche ${ev.round} : ${cartes(ev.cards)} · ${ev.trump ? `atout ${SYM[ev.trump]} ${SUIT_NAME[ev.trump]}` : "sans atout"} · ${ev.dealerId === me ? "tu distribues" : ev.dealerName + " distribue"}`, 3600);
        break;
      case "bid":
        hud.bubble(who(ev.playerId), ev.bid === 0 ? "Aucun pli pour moi !" : `J'en fais ${ev.bid} !`);
        sfx.play("select");
        break;
      case "play_start": {
        const g = S.game;
        const n = g ? g.cards : 0;
        const diff = ev.total - n;
        hud.toast(`Annonces : ${ev.total} pour ${plis(n)} ${diff > 0 ? "— ça va se battre ! ⚔️" : "— il y aura des cadeaux 🎁"}`, 3200);
        break;
      }
      case "play":
        if (ev.cut) {
          hud.bubble(who(ev.playerId), "Je coupe ! ✂️", "gold");
          sfx.play("stamp");
        }
        break;
      case "trick_won":
        hud.bubble(who(ev.playerId), ev.playerId === me ? "Pour moi ! ✋" : "Pli ! ✋", "gold");
        sfx.play(ev.playerId === me ? "truth" : "pickup");
        break;
      case "round_end":
        sfx.play("win");
        break;
      default:
        break;
    }
  },

  refresh(v, app) {
    const { hud, S, table } = app;
    const you = v.you;
    const dealing = S.dealing;
    const myTurn = !dealing && v.phase === "playing" && you.isYourTurn;

    // plaque : l'atout
    const trumpLabel = v.trump ? `${SYM[v.trumpSuit]} ${v.trumpName}` : "Sans atout";
    let sub = `${cartes(v.cards)} · annonces en cours`;
    if (v.allBid) sub = `${cartes(v.cards)} · annonces ${v.totalBids} pour ${v.cards}`;
    if (dealing) {
      hud.setAnnounce({ label: `Manche ${v.round}/${v.roundsTotal}`, value: "Distribution…", sub: cartes(v.cards), key: "deal" + v.round });
    } else if (v.phase === "round_end" || v.phase === "finished") {
      hud.setAnnounce({ label: `Manche ${v.round}/${v.roundsTotal}`, value: "Terminée !", sub: "", key: "end" + v.round });
    } else {
      hud.setAnnounce({
        label: `Atout · manche ${v.round}/${v.roundsTotal}`,
        value: trumpLabel,
        sub,
        img: v.trump ? miniCardUrl(v.trump) : null,
        key: "tr" + v.round
      });
    }

    // barre d'annonce
    if (!dealing && you.mustBid) {
      const bidsSoFar = v.players.filter((p) => p.bid !== null);
      const total = bidsSoFar.reduce((s, p) => s + p.bid, 0);
      let subHtml = bidsSoFar.length ? `Déjà annoncé : <b>${total}</b> pour ${plis(v.cards)}.` : "Tu annonces en premier.";
      if (you.forbiddenBid !== null) subHtml += ` Tu es le dernier : <b>${you.forbiddenBid}</b> est interdit.`;
      hud.showBidBar({
        title: `Combien de plis vas-tu faire ?`,
        sub: subHtml,
        max: v.cards,
        forbidden: you.forbiddenBid,
        key: `${v.uid}-${v.round}-${you.forbiddenBid}`,
        onPick: (bid) => {
          hud.hideBidBar();
          app.emit("game:bid", { bid }, null, () => this.refresh(S.game, app));
        }
      });
    } else {
      hud.hideBidBar();
    }

    // aide
    let hint = "";
    if (!dealing) {
      if (v.phase === "bidding") {
        hint = you.mustBid ? "" : `<b>${v.currentTurnName}</b> annonce…`;
      } else if (v.phase === "playing") {
        if (myTurn && !v.leadSuit) hint = "À toi d'entamer : <b>glisse une carte</b> sur le tapis.";
        else if (myTurn && you.legalIds.length && v.hand.some((c) => c.suit === v.leadSuit)) hint = `Fournis du <b>${SYM[v.leadSuit]} ${SUIT_NAME[v.leadSuit]}</b>.`;
        else if (myTurn) hint = `Pas de ${SYM[v.leadSuit]} : <b>coupe ou défausse</b> ce que tu veux.`;
        else hint = `Au tour de <b>${v.currentTurnName}</b>…`;
      } else if (v.phase === "trick_done") {
        hint = v.trickWinner === S.me.id ? "✋ <b>Tu remportes le pli !</b>" : `✋ Pli pour <b>${v.trickWinnerName}</b>`;
      }
    }
    hud.setHint(hint, myTurn);

    // cartes injouables assombries
    const dim = myTurn ? v.hand.filter((c) => !you.legalIds.includes(c.id)).map((c) => c.id) : [];
    table.setDimmed(dim);

    $("btn-liar").classList.add("hidden");
    $("btn-pass").classList.add("hidden");
    hud.setActionChips([]);

    // plaques
    const myBid = you.bid;
    const status = (p) => (p.bid === null ? null : `🎯 ${p.bid} · ✋ ${p.won}`);
    hud.setMyPlate(S.me.name, v.hand.length, myBid === null ? (you.isDealer ? "🃏 Tu distribues" : null) : `Pari ${myBid} · ${plis(you.won)} fait${you.won > 1 ? "s" : ""}`);
    hud.syncPlates(v.opponents.map((o) => {
      const active = !dealing && (v.phase === "playing" || v.phase === "bidding") && o.id === v.currentTurn;
      let st = status(o);
      if (!st && !active) st = o.isDealer ? "🃏 distribue" : "";
      if (!o.connected) st = "hors ligne";
      return {
        id: o.id,
        name: o.name,
        count: o.cardCount,
        connected: o.connected,
        active,
        statusText: active && v.phase === "bidding" ? "annonce" : st || ""
      };
    }));

    this.updateRoundEnd(v, app);
  },

  resultEntries(v, S) {
    const rows = (v.lastResult || []).slice().sort((a, b) => b.total - a.total);
    return rows.map((r) => ({
      medal: r.bid === r.won ? "✅" : "❌",
      name: r.name,
      me: r.id === S.me.id,
      title: `${signed(r.points)} pts`,
      sub: `Pari ${r.bid} · fait ${r.won} · total ${r.total}`
    }));
  },

  updateRoundEnd(v, app) {
    const { S, hud } = app;
    if (v.phase !== "round_end" && v.phase !== "finished") {
      if (S.roundEndShown && S.roundEndShown.startsWith(v.uid)) {
        S.roundEndShown = null;
        hud.hideEnd();
      }
      return;
    }
    const key = `${v.uid}-${v.round}-${v.phase}`;
    if (S.roundEndShown === key) return;
    S.roundEndShown = key;
    setTimeout(() => {
      const g = S.game;
      if (!g || g.uid !== v.uid || g.round !== v.round || g.phase !== v.phase) return;
      const isHost = S.room.hostId === S.me.id;
      if (v.phase === "finished") {
        const n = v.ranking.length;
        const entries = v.ranking.map((r, i) => ({
          medal: i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 && n > 3 ? "🥉" : i === n - 1 ? "🍺" : `${i + 1}`,
          name: r.name,
          me: r.id === S.me.id,
          title: `${r.score} pts`,
          sub: i === 0 ? "Roi de l'ascenseur" : i === n - 1 ? "Resté coincé au sous-sol" : ""
        }));
        if (v.ranking[0] && v.ranking[0].id === S.me.id) app.sfx.play("win");
        hud.showEnd({
          key,
          title: "Fin de la partie",
          entries,
          primary: isHost ? { label: "🔁 Revanche !", onClick: () => app.emit("room:rematch", {}) } : null,
          secondary: isHost ? { label: "🎲 Changer de jeu", onClick: () => app.emit("room:playAgain", {}) } : null,
          wait: isHost ? "" : "Le patron peut lancer la revanche…",
          onLeave: app.leaveTable
        });
        return;
      }
      const next = v.sequence[v.round];
      hud.showEnd({
        key,
        title: `Fin de la manche ${v.round}/${v.roundsTotal}`,
        entries: this.resultEntries(v, S),
        primary: isHost ? { label: `▶ Manche suivante (${cartes(next)})`, onClick: () => app.emit("game:nextRound", {}) } : null,
        secondary: isHost ? { label: "🎲 Changer de jeu", onClick: () => app.emit("room:playAgain", {}) } : null,
        wait: isHost ? "" : `Prochaine manche : ${cartes(next)}. Le patron la lance…`,
        onLeave: app.leaveTable
      });
    }, 1500);
  },

  hideOverlays(app) {
    const bar = $("bid-bar");
    bar.classList.add("hidden");
    bar.dataset.key = "";
    if (app && app.table) app.table.setDimmed([]);
  },

  chips(v) {
    const total = v.cards;
    const done = v.trickNumber;
    return {
      pile: v.phase === "playing" || v.phase === "trick_done" ? `Pli <b>${Math.min(done + (v.phase === "playing" ? 1 : 0), total)}</b> / ${total}` : "",
      tray: "📊 Scores"
    };
  },

  trayTitle: "Tableau des scores",
  trayHtml(v) {
    const rows = v.players.slice().sort((a, b) => b.score - a.score).map((p) => {
      const cls = p.bid === null ? "" : p.bid === p.won ? "ok" : "ko";
      return `<tr class="${p.id === v.you.id ? "me" : ""}"><td>${p.isDealer ? "🃏 " : ""}${p.name.replace(/[<>&]/g, "")}</td><td>${p.bid === null ? "—" : p.bid}</td><td class="${cls}">${p.won}</td><td><b>${p.score}</b></td></tr>`;
    }).join("");
    const seq = v.sequence.map((n, i) => (i === v.round - 1 ? `<b>${n}</b>` : String(n))).join(" · ");
    return `<table class="score-table"><thead><tr><th>Joueur</th><th>Pari</th><th>Plis</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="score-seq">Manches : ${seq}</p>
      <p class="score-seq">Atout : ${v.trump ? `${SYM[v.trumpSuit]} ${v.trumpName}` : "sans atout"} · pari réussi = 40 pts par pli (20 pts pour 0), raté = −40 par pli d'écart.</p>`;
  },

  historyHtml(history, esc) {
    if (!history.length) return "<p>Rien ne s'est encore passé.</p>";
    const items = history.slice().reverse().map((e) => {
      switch (e.type) {
        case "round_start": return `<li>🛗 Manche ${e.round} : ${cartes(e.cards)}, ${e.trump ? `atout ${SYM[e.trump]}` : "sans atout"} — ${esc(e.dealerName)} distribue</li>`;
        case "bid": return `<li><b>${esc(e.playerName)}</b> annonce ${plis(e.bid)}</li>`;
        case "play_start": return `<li>🎯 Total des annonces : ${e.total} — <b>${esc(e.starterName)}</b> entame</li>`;
        case "play": return `<li><b>${esc(e.playerName)}</b> ${e.lead ? "entame avec" : e.cut ? "coupe avec" : "joue"} ${cardName(e)}</li>`;
        case "trick_won": return `<li>✋ Pli ${e.number} pour <b>${esc(e.playerName)}</b></li>`;
        case "round_end": return `<li>🏁 Fin de la manche ${e.round}</li>`;
        default: return "";
      }
    });
    return `<ul>${items.join("")}</ul>`;
  },

  // Reglages du salon : le patron les modifie, les autres les voient.
  renderLobbyOptions(el, room, isHost, app) {
    const o = lobbyOptions(room);
    const seq = buildSequence(o);
    const key = JSON.stringify([o, isHost, room.players.length]);
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    const dis = isHost ? "" : "disabled";
    const send = (patch) => {
      const cur = (room.options && room.options.ascenseur) || {};
      const next = { maxCards: cur.maxCards || 0, mode: o.mode, step: o.step, ...patch };
      app.sfx.play("select");
      app.emit("room:setOptions", { options: next });
    };
    el.innerHTML = `
      <div class="opt-row"><span>Cartes max</span>
        <div class="opt-step"><button data-o="minus" ${dis}>−</button><b>${o.maxCards}</b><button data-o="plus" ${dis}>+</button></div></div>
      <div class="opt-row wide"><span>Sens</span>
        <div class="opt-seg">${Object.entries(MODE_LABELS).map(([k, l]) => `<button data-mode="${k}" class="${k === o.mode ? "on" : ""}" ${dis}>${l}</button>`).join("")}</div></div>
      <div class="opt-row wide"><span>Pas</span>
        <div class="opt-seg">${[1, 2].map((s) => `<button data-step="${s}" class="${s === o.step ? "on" : ""}" ${dis}>de ${s} en ${s}</button>`).join("")}</div></div>
      <div class="opt-seq">${seq.length} manches : ${seqText(seq)}${o.auto ? ` <i>(max possible à ${room.players.length < 3 ? 3 : room.players.length} joueurs)</i>` : ""}</div>`;
    if (!isHost) return;
    el.querySelector('[data-o="minus"]').addEventListener("click", () => send({ maxCards: Math.max(1, o.maxCards - 1) }));
    el.querySelector('[data-o="plus"]').addEventListener("click", () => send({ maxCards: Math.min(o.hardMax, o.maxCards + 1) >= o.hardMax ? 0 : o.maxCards + 1 }));
    el.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => send({ mode: b.dataset.mode })));
    el.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => send({ step: Number(b.dataset.step) })));
  },

  rulesHtml() {
    return `
      <p class="rule"><i>🛗</i><span>À chaque manche, on distribue une carte de plus… jusqu'au maximum (52 ÷ nombre de joueurs), puis on redescend jusqu'à 1. Le patron peut changer le maximum, le sens et le pas dans le salon.</span></p>
      <p class="rule"><i>🃏</i><span>On retourne la carte du dessus du talon : sa couleur est l'<b>atout</b>. S'il ne reste plus de carte, la manche se joue <b>sans atout</b>.</span></p>
      <p class="rule"><i>🎯</i><span>Chacun à son tour <b>annonce le nombre de plis</b> qu'il pense faire. Le dernier (celui qui distribue) n'a pas le droit de faire tomber le total juste : quelqu'un devra se tromper !</span></p>
      <p class="rule"><i>👉</i><span>Le joueur à gauche du donneur entame. Il faut <b>fournir la couleur demandée</b> si on l'a ; sinon on joue ce qu'on veut (couper n'est pas obligatoire).</span></p>
      <p class="rule"><i>✋</i><span>Le plus gros atout remporte le pli, sinon la plus forte carte de la couleur demandée (2 &lt; 3 &lt; … &lt; Roi &lt; As). Le gagnant entame le pli suivant.</span></p>
      <p class="rule"><i>📊</i><span>Pari réussi : <b>40 points par pli</b> annoncé (<b>20 points</b> pour une annonce de 0 réussie). Pari raté : <b>−40 points par pli d'écart</b>.</span></p>`;
  }
};
