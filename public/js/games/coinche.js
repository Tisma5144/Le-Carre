// Adaptateur client de la Coinche : encheres (contrat + atout, coinche,
// surcoinche), plis poses devant chaque joueur, annonces et belote, scores
// par equipe.
import { miniCardUrl } from "../ui/hud.js";
import { seriesColors, scoreChartHtml, bindScoreChart } from "./ascenseur.js";

const $ = (id) => document.getElementById(id);
const SYM = { pique: "♠", coeur: "♥", carreau: "♦", trefle: "♣", sa: "SA", ta: "TA" };
const SUIT_NAME = { pique: "Pique", coeur: "Cœur", carreau: "Carreau", trefle: "Trèfle", sa: "Sans Atout", ta: "Tout Atout" };
const RANK_NAME = { V: "Valet", D: "Dame", R: "Roi", A: "As" };
const TRUMP_ORDER = ["7", "8", "D", "R", "10", "A", "9", "V"];
const PLAIN_ORDER = ["7", "8", "9", "V", "D", "R", "10", "A"];
const SUIT_SORT = { pique: 0, coeur: 1, trefle: 2, carreau: 3 };
const VALUES = [80, 90, 100, 110, 120, 130, 140, 150, 160, 250, 500];
const VALUE_LABEL = { 250: "Capot", 500: "Générale" };
const esc = (t) => String(t == null ? "" : t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const red = (s) => s === "coeur" || s === "carreau";
const isTrumpSuit = (trump, suit) => trump === "ta" || trump === suit;

export function cardName(c) {
  return `${RANK_NAME[c.rank] || c.rank} ${SYM[c.suit]}`;
}
const shortName = (c) => `${RANK_NAME[c.rank] || c.rank}${SYM[c.suit]}`;
const valueLabel = (v) => VALUE_LABEL[v] || String(v);
const multLabel = (m) => (m === 4 ? " · surcoinché ×4" : m === 2 ? " · coinché ×2" : "");

function miniRow(cards) {
  return `<span class="mini-row">${cards.map((c) => `<img src="${miniCardUrl(c)}" alt="${esc(cardName(c))}" />`).join("")}</span>`;
}

// ------------------------------------------------------------------ scores par equipe
function chartView(v) {
  return {
    seatOrder: ["t0", "t1"],
    players: v.teams.map((t) => ({ id: "t" + t.team, name: t.name })),
    roundResults: v.roundResults.map((r) => ({
      round: r.donne,
      results: [0, 1].map((t) => ({ id: "t" + t, points: r.marks[t], total: r.totals[t] }))
    }))
  };
}
const CHART_OPTS = { unit: "donne", tipHead: (rr) => `Après la donne ${rr.round}` };

function resultLine(r, v) {
  const team = v.teams[r.team].name;
  const parts = [`${team} : ${r.points[r.team]} points de plis`];
  if (r.annonces[r.team]) parts.push(`annonces ${r.annonces[r.team]}`);
  if (r.belote[r.team]) parts.push("belote 20");
  parts.push(`pour ${valueLabel(r.value)} demandés`);
  if (r.capot !== null) parts.push(`capot de ${v.teams[r.capot].name}`);
  return parts.join(" · ");
}

export default {
  id: "coinche",
  name: "La Coinche",
  emoji: "♣️",
  tagline: "Annonce, coinche… et belote-rebelote !",
  players: "4 joueurs (2 équipes)",
  minPlayers: 4,
  maxPlayers: 4,
  deckSize: 32,
  maxSelect: 1,
  pendingFaceUp: true,
  defaultSorted: true,
  rankOrder: PLAIN_ORDER,

  // couleurs alternees ; dans chaque couleur, l'ordre de force (atout ou non)
  sortHand(hand, g) {
    const trump = g && g.contract ? g.contract.trump : null;
    const pw = (c) => (isTrumpSuit(trump, c.suit) ? TRUMP_ORDER : PLAIN_ORDER).indexOf(c.rank);
    const suitKey = (c) => (trump && c.suit === trump ? 9 : SUIT_SORT[c.suit]);
    return hand.slice().sort((a, b) => suitKey(a) - suitKey(b) || pw(a) - pw(b));
  },

  dealKey: (v) => `${v.uid}-${v.dealNo}`,
  isFreshDeal(v) {
    for (let i = v.history.length - 1; i >= 0; i -= 1) {
      const e = v.history[i];
      if (e.type === "bid" || e.type === "play" || e.type === "taker") return false;
      if (e.type === "deal") return true;
    }
    return true;
  },

  desired(v, handOrder, app) {
    const myId = app ? app.S.me.id : v.you.id;
    const byId = new Map(v.hand.map((c) => [c.id, c]));
    const me = handOrder.map((id) => byId.get(id)).filter(Boolean);
    const opp = new Map(v.opponents.map((o) => [o.id, o.cardCount]));
    const trick = v.trick.map((p) => ({ card: p.card, owner: p.playerId === myId ? "__me" : p.playerId, win: p.playerId === v.trickWinner }));
    const won = new Map(v.players.map((p) => [p.id === myId ? "__me" : p.id, p.wonCards]));
    if (app) app.table.trickSize = 4;
    return { me, opp, trick, won };
  },

  turnBanner(v) {
    if (v.you.mustBid) return "À toi de parler !";
    if (v.you.mustSurcoinche) return "Surcoinche ?";
    return v.trick.length === 0 ? "À toi d'entamer !" : "À toi de jouer !";
  },
  isPlaying: (v) => ["bidding", "surcoinche", "playing"].includes(v.phase),
  showRing: (v) => v.phase === "playing",

  legality(ids, v, app) {
    if (!v || app.S.dealing) return { ok: false, why: "" };
    if (v.phase === "bidding" || v.phase === "surcoinche") return { ok: false, why: v.you.isYourTurn ? "Choisis d'abord ton enchère." : "Attends la fin des enchères." };
    if (v.phase === "trick_done") return { ok: false, why: "Le pli est en train d'être ramassé…" };
    if (v.phase !== "playing") return { ok: false, why: "" };
    if (!v.you.isYourTurn) return { ok: false, why: `Pas si vite ! C'est au tour de ${v.currentTurnName}.` };
    if (ids.length !== 1) return { ok: false, why: "Une seule carte à la fois." };
    if (!v.you.legalIds.includes(ids[0])) return { ok: false, why: this.ruleText(v) };
    return { ok: true };
  },

  // Ce que la regle impose a mon tour (texte court).
  ruleText(v) {
    const lead = v.leadSuit;
    const trump = v.contract && v.contract.trump;
    if (!lead) return "Joue la carte de ton choix.";
    if (v.hand.some((c) => c.suit === lead)) {
      return isTrumpSuit(trump, lead) ? `Fournis du ${SYM[lead]} et monte si tu peux.` : `Tu dois fournir : joue du ${SUIT_NAME[lead]} ${SYM[lead]}.`;
    }
    if (trump === "sa" || trump === "ta") return "Pas de cette couleur : joue ce que tu veux.";
    if (v.trickWinner === null && this.partnerMaster(v)) return "Ton partenaire est maître : joue ce que tu veux.";
    if (!v.hand.some((c) => c.suit === trump)) return "Pas d'atout : défausse ce que tu veux.";
    return v.trick.some((p) => p.card.suit === trump) ? "Coupe plus haut si tu peux (sinon coupe quand même)." : `Tu dois couper à l'atout ${SYM[trump]}.`;
  },

  partnerMaster(v) {
    if (!v.trick.length || !v.contract) return false;
    const trump = v.contract.trump;
    const lead = v.trick[0].card.suit;
    const pw = (c) => (isTrumpSuit(trump, c.suit) ? TRUMP_ORDER : PLAIN_ORDER).indexOf(c.rank);
    let best = v.trick[0];
    for (const p of v.trick.slice(1)) {
      const cT = trump !== "sa" && trump !== "ta" && p.card.suit === trump;
      const bT = trump !== "sa" && trump !== "ta" && best.card.suit === trump;
      if (cT && !bT) best = p;
      else if (cT === bT && p.card.suit === best.card.suit && (p.card.suit === lead || cT) && pw(p.card) > pw(best.card)) best = p;
    }
    return best.playerId === v.you.partnerId;
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
    if (app.S.dealing || sel.length !== 1 || !this.legality(sel, v, app).ok) return { show: false };
    const c = v.hand.find((x) => x.id === sel[0]);
    return { show: true, text: `Poser : ${shortName(c)}` };
  },

  onEvent(ev, app) {
    const { hud, sfx, S } = app;
    const who = app.who;
    const me = S.me.id;
    const nm = (id) => (id === me ? "Toi" : app.playerName(id));
    switch (ev.type) {
      case "all_pass":
        hud.toast("Tout le monde passe : on redistribue 🔄", 3000);
        break;
      case "bid":
        if (ev.bid === "coinche") {
          hud.bubble(who(ev.playerId), "Coinche ! 🔥", "liar");
          hud.showTurnBanner("Coinche !", "allin");
          sfx.play("liar");
        } else if (ev.bid === "surcoinche") {
          hud.bubble(who(ev.playerId), "Surcoinche ! 💥", "liar");
          hud.showTurnBanner("Surcoinche !", "allin");
          sfx.play("allin");
        } else {
          hud.bubble(who(ev.playerId), ev.bid === "passe" ? "Passe" : `${ev.label} !`, ev.bid === "passe" ? "" : "gold");
          sfx.play(ev.bid === "passe" ? "select" : "stamp");
        }
        break;
      case "taker":
        hud.toast(`${ev.playerId === me ? "Tu prends" : `${nm(ev.playerId)} prend`} : ${ev.label}${multLabel(ev.mult)}`, 3000);
        break;
      case "annonce": {
        const txt = ev.items.map((a) => a.label).join(" + ");
        hud.bubble(who(ev.playerId), `${txt} !`, "gold");
        if (ev.playerId !== me) hud.toast(`${nm(ev.playerId)} annonce : ${ev.items.map((a) => `${a.label} (${a.value})`).join(", ")}`, 3200);
        sfx.play("quad");
        break;
      }
      case "belote":
        hud.bubble(who(ev.playerId), ev.step === 1 ? "Belote !" : "Rebelote ! 👑", "gold");
        sfx.play("truth");
        break;
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
        sfx.play(ev.made ? "win" : "bluff");
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
    const me = S.me.id;
    const nm = (id) => (id === me ? "toi" : (v.players.find((p) => p.id === id) || { name: "?" }).name);
    const my = v.teams[you.team];
    const their = v.teams[1 - you.team];
    const scoreSub = `Nous ${my.score} · Eux ${their.score} · en ${v.options.target}`;

    // plaque
    if (dealing) {
      hud.setAnnounce({ label: `Donne ${v.donne}`, value: "Distribution…", sub: scoreSub, key: "deal" + v.dealNo });
    } else if (v.phase === "bidding" || v.phase === "surcoinche") {
      hud.setAnnounce({
        label: `Donne ${v.donne} · enchères`,
        value: v.best ? `${v.best.label} (${nm(v.best.playerId)})` : "Personne n'a parlé",
        sub: v.phase === "surcoinche" ? `Coinché par ${v.coincheByName} !` : `au tour de ${nm(v.currentTurn)}`,
        key: "bid" + v.dealNo + (v.best ? v.best.label : "") + v.currentTurn
      });
    } else if (v.phase === "round_end" || v.phase === "finished") {
      hud.setAnnounce({ label: `Donne ${v.donne}`, value: "Terminée !", sub: scoreSub, key: "end" + v.donne });
    } else if (v.contract) {
      hud.setAnnounce({ label: `Donne ${v.donne} · atout ${SUIT_NAME[v.contract.trump]}`, value: `${v.contract.label} · ${nm(v.contract.takerId)}`, sub: `${v.contract.mult > 1 ? `×${v.contract.mult} · ` : ""}Nous ${my.score} · Eux ${their.score}`, key: "c" + v.dealNo });
    }

    // aide
    let hint = "";
    if (!dealing) {
      if (v.phase === "bidding") hint = you.mustBid ? "" : `<b>${esc(v.currentTurnName)}</b> réfléchit à son enchère…`;
      else if (v.phase === "surcoinche") hint = you.mustSurcoinche ? "" : `<b>${esc(v.currentTurnName)}</b> va-t-il surcoincher ?`;
      else if (v.phase === "playing") {
        if (myTurn && !v.trick.length) hint = "À toi d'entamer : <b>glisse une carte</b> sur le tapis.";
        else if (myTurn) hint = esc(this.ruleText(v));
        else hint = `Au tour de <b>${esc(v.currentTurnName)}</b>…`;
      } else if (v.phase === "trick_done") {
        hint = v.trickWinner === me ? "✋ <b>Tu remportes le pli !</b>" : `✋ Pli pour <b>${esc(v.trickWinnerName)}</b>`;
      }
    }
    hud.setHint(hint, myTurn);

    table.setDimmed(myTurn ? v.hand.filter((c) => !you.legalIds.includes(c.id)).map((c) => c.id) : []);
    this.renderBar(v, app);
    $("btn-liar").classList.add("hidden");
    $("btn-pass").classList.add("hidden");
    hud.setActionChips([]);

    // plaques
    const role = (id) => {
      if (v.contract && id === v.contract.takerId) return `👑 ${v.contract.label}`;
      return "";
    };
    const myRole = role(me);
    hud.setMyPlate(
      S.me.name,
      v.hand.length,
      v.phase === "bidding" || v.phase === "surcoinche" ? ((v.players.find((p) => p.id === me) || {}).lastBid || (you.isDealer ? "🃏 Tu distribues" : "Enchères en cours")) : myRole || `Équipe : ${my.score} pts`,
      v.phase === "bidding" || v.phase === "surcoinche" ? ((v.players.find((p) => p.id === me) || {}).lastBid || "…") : myRole || `${my.score}`
    );
    hud.syncPlates(v.opponents.map((o) => {
      const active = !dealing && this.isPlaying(v) && o.id === v.currentTurn;
      let st = v.phase === "bidding" || v.phase === "surcoinche" ? o.lastBid || (o.isDealer ? "🃏 distribue" : "") : role(o.id);
      if ((v.phase === "bidding" || v.phase === "surcoinche") && active) st = "réfléchit";
      if (o.partner) st = `🤝 ${st || "partenaire"}`;
      if (!o.connected) st = "hors ligne";
      return { id: o.id, name: o.name, count: o.cardCount, connected: o.connected, active, statusText: st };
    }));

    this.updateRoundEnd(v, app);
  },

  // Barre d'enchères : montant (moins / plus), couleur d'atout, passe, coinche.
  renderBar(v, app) {
    const bar = $("action-bar");
    const you = v.you;
    const dealing = app.S.dealing;
    let key = "";
    let html = "";
    if (!dealing && you.mustBid) {
      const min = you.minValue;
      const options = min === null ? [] : VALUES.filter((x) => x >= min);
      if (!options.includes(this.bidValue)) this.bidValue = options[0];
      key = `bid-${v.uid}-${v.dealNo}-${v.best ? v.best.label : ""}-${this.bidValue}`;
      const suits = you.trumps.map((t) => `<button class="act suit ${red(t) ? "red" : ""}" data-trump="${t}">${SYM[t]}</button>`).join("");
      const ann = you.annonces && you.annonces.length ? ` · annonces : <b>${you.annonces.map((a) => a.label).join(", ")}</b>` : "";
      html = `<div class="act-info">${v.best ? `À battre : <b>${esc(v.best.label)}</b> (${esc(v.best.playerName)})` : "Ouvre les enchères (80 minimum)"}${ann}</div>
        ${options.length ? `<div class="act-row bid-step"><button class="act check" data-step="-1" ${options.indexOf(this.bidValue) <= 0 ? "disabled" : ""}>−</button><div class="bid-value">${valueLabel(this.bidValue)}</div><button class="act check" data-step="1" ${options.indexOf(this.bidValue) >= options.length - 1 ? "disabled" : ""}>+</button></div>
        <div class="act-row">${suits}</div>` : ""}
        <div class="act-row"><button class="act fold" data-bid="passe">Passe</button>${you.canCoinche ? `<button class="act allin" data-bid="coinche">Coinche ! ×2</button>` : ""}</div>`;
    } else if (!dealing && you.mustSurcoinche) {
      key = `sur-${v.uid}-${v.dealNo}`;
      html = `<div class="act-info"><b>${esc(v.coincheByName)}</b> coinche ton ${esc(v.best.label)} ! Tu maintiens ?</div>
        <div class="act-row"><button class="act check" data-bid="passe">Non, on joue ×2</button><button class="act allin" data-bid="surcoinche">Surcoinche ! ×4</button></div>`;
    }
    if (!key) {
      if (bar.dataset.key && bar.dataset.key.startsWith("c-")) {
        bar.classList.add("hidden");
        bar.dataset.key = "";
      }
      return;
    }
    bar.classList.remove("hidden");
    if (bar.dataset.key === "c-" + key) return;
    bar.dataset.key = "c-" + key;
    bar.innerHTML = html;
    const done = () => {
      bar.classList.add("hidden");
      bar.dataset.key = "";
    };
    const retry = () => this.refresh(app.S.game, app);
    bar.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
      const options = VALUES.filter((x) => x >= you.minValue);
      const i = Math.max(0, Math.min(options.length - 1, options.indexOf(this.bidValue) + Number(b.dataset.step)));
      this.bidValue = options[i];
      app.sfx.play("select");
      this.renderBar(app.S.game, app);
    }));
    bar.querySelectorAll("[data-trump]").forEach((b) => b.addEventListener("click", () => {
      app.sfx.play("select");
      done();
      app.emit("game:bid", { bid: String(this.bidValue), trump: b.dataset.trump }, null, retry);
    }));
    bar.querySelectorAll("[data-bid]").forEach((b) => b.addEventListener("click", () => {
      app.sfx.play("select");
      done();
      app.emit("game:bid", { bid: b.dataset.bid }, null, retry);
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
    const key = `${v.uid}-${v.donne}-${v.phase}`;
    if (S.roundEndShown === key) return;
    S.roundEndShown = key;
    setTimeout(() => {
      const g = S.game;
      if (!g || g.uid !== v.uid || g.donne !== v.donne || g.phase !== v.phase) return;
      const isHost = S.room.hostId === S.me.id;
      const scores = { label: "📊 Voir les scores et le graphique", onClick: () => app.openTray() };
      const mine = v.you.team;
      if (v.phase === "finished") {
        const w = v.winnerTeam;
        const entries = [0, 1].sort((a, b) => v.teams[b].score - v.teams[a].score).map((t, i) => ({
          medal: i === 0 ? "🏆" : "🍺",
          name: v.teams[t].name,
          me: t === mine,
          title: `${v.teams[t].score} pts`,
          sub: i === 0 ? "Champions de la coinche" : "Paient la tournée"
        }));
        if (w === mine) app.sfx.play("win");
        hud.showEnd({
          key,
          title: w === null ? "Fin de la partie" : w === mine ? "Vous gagnez la partie !" : "Partie perdue…",
          entries,
          primary: isHost ? { label: "🔁 Revanche !", onClick: () => app.emit("room:rematch", {}) } : null,
          secondary: isHost ? { label: "🎲 Changer de jeu", onClick: () => app.emit("room:playAgain", {}) } : null,
          wait: isHost ? "" : "Le patron peut lancer la revanche…",
          extra: scores,
          onLeave: app.leaveTable
        });
        return;
      }
      const r = v.lastResult;
      const entries = [0, 1].map((t) => ({
        medal: t === r.team ? "👑" : "🛡️",
        name: v.teams[t].name,
        me: t === mine,
        title: signed(r.marks[t]),
        sub: `total ${r.totals[t]}`
      }));
      const taker = v.players.find((p) => p.id === r.takerId);
      hud.showEnd({
        key,
        title: `${r.label}${multLabel(r.mult)} de ${taker ? taker.name : "?"} ${r.made ? "réussi" : "chuté"} !`,
        entries,
        primary: isHost ? { label: "▶ Donne suivante", onClick: () => app.emit("game:nextRound", {}) } : null,
        secondary: isHost ? { label: "🏁 Terminer la partie", onClick: () => app.emit("game:endGame", {}) } : null,
        wait: resultLine(r, v) + (isHost ? "" : " — le patron lance la donne suivante…"),
        extra: scores,
        onLeave: app.leaveTable
      });
    }, 1600);
  },

  hideOverlays(app) {
    const bar = $("action-bar");
    if (bar.dataset.key && bar.dataset.key.startsWith("c-")) {
      bar.classList.add("hidden");
      bar.dataset.key = "";
    }
    if (app && app.table) app.table.setDimmed([]);
  },

  chips(v) {
    const on = v.phase === "playing" || v.phase === "trick_done";
    return {
      pile: on ? `Pli <b>${Math.min(v.trickNumber + (v.phase === "playing" ? 1 : 0), 8)}</b> / 8` : "",
      tray: "📊 Scores"
    };
  },

  trayTitle: "Tableau des scores",
  trayHtml(v) {
    const cv = chartView(v);
    const color = seriesColors(cv);
    const rows = v.teams.slice().sort((a, b) => b.score - a.score).map((t) => `<tr class="${t.team === v.you.team ? "me" : ""}"><td><i class="sw" style="background:${color["t" + t.team]}"></i>${esc(t.name)}</td><td><b>${t.score}</b></td></tr>`).join("");
    const recap = v.roundResults.length ? `<div class="recap-wrap"><table class="recap-table">
      <thead><tr><th>Donne</th>${v.teams.map((t) => `<th><i class="sw" style="background:${color["t" + t.team]}"></i>${esc(t.name)}</th>`).join("")}</tr></thead>
      <tbody>${v.roundResults.map((r) => `<tr><td class="rc">${r.donne} <small>${esc(r.label)}${r.mult > 1 ? ` ×${r.mult}` : ""} ${r.made ? "✅" : "❌"}</small></td>${[0, 1].map((t) => `<td><span class="${r.marks[t] > 0 ? "ok" : ""}">${signed(r.marks[t])}</span><small>${t === r.team ? "👑" : ""}</small></td>`).join("")}</tr>`).join("")}
      <tr class="tot"><td class="rc">Total</td>${v.teams.map((t) => `<td><b>${t.score}</b></td>`).join("")}</tr></tbody></table></div>` : `<p class="chart-empty">Aucune donne terminée pour l'instant.</p>`;
    const last = v.lastResult ? `<p class="score-seq"><b>Dernière donne :</b> ${esc(resultLine(v.lastResult, v))}</p>` : "";
    return `<h4 class="score-h">${v.phase === "finished" ? "Classement final" : `Scores (partie en ${v.options.target})`}</h4>
      <table class="score-table"><thead><tr><th>Équipe</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
      ${last}
      <h4 class="score-h">Évolution des scores</h4>
      ${scoreChartHtml(cv, color, CHART_OPTS)}
      <h4 class="score-h">Donne par donne</h4>
      ${recap}`;
  },
  bindTray(root, v) {
    bindScoreChart(root, chartView(v), CHART_OPTS);
  },

  fetchHistory: true,
  historyHtml(history, escape) {
    if (!history.length) return "<p>Rien ne s'est encore passé.</p>";
    const donnes = new Map();
    for (const e of history) {
      if (!donnes.has(e.donne)) donnes.set(e.donne, []);
      donnes.get(e.donne).push(e);
    }
    const g = window.__menteur && window.__menteur.S.game;
    const live = g && ["bidding", "surcoinche", "playing", "trick_done"].includes(g.phase);
    return [...donnes.entries()].sort((a, b) => b[0] - a[0]).map(([d, evs]) => {
      const lines = [];
      const bids = evs.filter((e) => e.type === "bid");
      if (bids.length) lines.push(`<li>🗣️ Enchères : ${bids.map((e) => `<b>${escape(e.playerName)}</b> ${escape(e.label)}`).join(" · ")}</li>`);
      for (const e of evs) {
        if (e.type === "annonce") lines.push(`<li>📣 <b>${escape(e.playerName)}</b> : ${e.items.map((a) => `${escape(a.label)} (${a.value}) ${miniRow(a.cards)}`).join(" ")}</li>`);
        if (e.type === "belote" && e.step === 2) lines.push(`<li>👑 <b>${escape(e.playerName)}</b> : belote-rebelote</li>`);
      }
      const tricks = new Map();
      for (const e of evs) {
        if (e.type === "play") {
          if (!tricks.has(e.trick)) tricks.set(e.trick, { plays: [], winner: null });
          tricks.get(e.trick).plays.push(e);
        } else if (e.type === "trick_won") {
          if (!tricks.has(e.number)) tricks.set(e.number, { plays: [], winner: null });
          tricks.get(e.number).winner = e.playerName;
        }
      }
      for (const [num, t] of [...tricks.entries()].sort((a, b) => a[0] - b[0])) {
        const cards = t.plays.map((e) => `${escape(e.playerName)} <span class="hcard ${red(e.suit) ? "red" : ""}">${shortName(e)}</span>${e.cut ? " ✂️" : ""}`).join(", ");
        lines.push(`<li>✋ <b>Pli ${num}</b>${t.winner ? ` pour <b>${escape(t.winner)}</b>` : " (en cours)"} : ${cards}</li>`);
      }
      const end = evs.find((e) => e.type === "round_end");
      if (end) lines.push(`<li>🏁 ${end.made ? "Contrat réussi" : "Contrat chuté"} : ${end.points} points pour ${valueLabel(end.value)}</li>`);
      const note = live && d === g.donne ? `<p class="hist-note">👀 Donne en cours : seul le dernier pli est visible.</p>` : "";
      return `<h4 class="hist-round">Donne ${d}</h4>${note}<ul>${lines.join("")}</ul>`;
    }).join("");
  },

  // Reglages du salon
  renderLobbyOptions(el, room, isHost, app) {
    const o = Object.assign({ scoring: "points", target: 1000, atouts: "couleurs", annonces: true }, (room.options && room.options.coinche) || {});
    const key = JSON.stringify([o, isHost]);
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    const dis = isHost ? "" : "disabled";
    const seg = (name, values, label) => `<div class="opt-row wide"><span>${label}</span><div class="opt-seg">${values.map(([val, text]) => `<button data-k="${name}" data-v="${val}" class="${String(o[name]) === String(val) ? "on" : ""}" ${dis}>${text}</button>`).join("")}</div></div>`;
    el.innerHTML = seg("target", [[500, "500"], [1000, "1000"], [2000, "2000"]], "Partie en")
      + seg("scoring", [["points", "Contrat + points"], ["contrat", "Contrat seul"]], "On marque")
      + seg("atouts", [["couleurs", "4 couleurs"], ["tous", "+ SA / TA"]], "Atouts")
      + seg("annonces", [[true, "Oui"], [false, "Non"]], "Annonces")
      + `<div class="opt-seq">4 joueurs, équipes de 2 tirées au sort (partenaires face à face).</div>`;
    if (!isHost) return;
    el.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => {
      const v = b.dataset.v;
      app.sfx.play("select");
      app.emit("room:setOptions", { options: { ...o, [b.dataset.k]: /^\d+$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v } });
    }));
  },

  rulesHtml() {
    return `
      <p class="rule"><i>🃏</i><span><b>4 joueurs</b> en 2 équipes (partenaires face à face), <b>32 cartes</b> (du 7 à l'As), 8 cartes chacun.</span></p>
      <p class="rule"><i>🗣️</i><span><b>Enchères</b> : chacun son tour annonce un contrat de <b>80 à 160</b> (par 10), puis <b>capot</b> (250, tous les plis) ou <b>générale</b> (500, tous les plis à lui seul), avec une couleur d'atout — ou passe. Il faut monter. Trois passes après une enchère la terminent ; si tout le monde passe d'entrée, on redistribue. En option : Sans Atout et Tout Atout.</span></p>
      <p class="rule"><i>🔥</i><span><b>Coinche</b> : à son tour, un adversaire peut coincher le contrat (points ×2). Le preneur peut alors <b>surcoincher</b> (×4).</span></p>
      <p class="rule"><i>👉</i><span>Il faut <b>fournir</b> la couleur demandée ; à l'atout, il faut <b>monter</b> si on peut. Sans la couleur, il faut <b>couper</b> (plus haut qu'un adversaire qui a déjà coupé, sinon couper quand même), sauf si ton <b>partenaire est maître</b> du pli : tu joues alors ce que tu veux.</span></p>
      <p class="rule"><i>🧮</i><span><b>Atout</b> : Valet 20, 9 14, As 11, 10 10, Roi 4, Dame 3. <b>Autres couleurs</b> : As 11, 10 10, Roi 4, Dame 3, Valet 2. 152 points + <b>10 de der</b> = 162. Sans Atout : As 19 ; Tout Atout : Valet 14, 9 9, As 6, 10 5, Roi 3, Dame 1.</span></p>
      <p class="rule"><i>📣</i><span><b>Annonces</b> (faites automatiquement à ta première carte) : tierce 20, cinquante 50, cent 100 (cartes qui se suivent : 7 8 9 10 V D R A), carré 100 (As, Rois, Dames, 10), 150 (9), 200 (Valets). Seule l'équipe qui a la meilleure annonce marque les siennes. <b>Belote-rebelote</b> (Roi et Dame d'atout) : 20 points imprenables.</span></p>
      <p class="rule"><i>🏁</i><span>Le contrat est <b>réussi</b> si les plis + annonces + belote de l'équipe preneuse atteignent le contrat. Réussi : contrat + points faits (réglable : contrat seul) ; coinché et réussi : 160 + contrat × 2 (ou × 4). <b>Chuté</b> : la défense marque 160 + contrat (× 2 ou × 4). Première équipe à 1000 points (réglable : 500 ou 2000).</span></p>`;
  }
};
