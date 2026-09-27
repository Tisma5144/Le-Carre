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

// ------------------------------------------------------------------ scores
// Couleurs des joueurs : palette categorielle validee (fond sombre), attribuee
// dans l'ordre des sieges -> la couleur suit le joueur, jamais son rang.
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

function seriesColors(v) {
  const out = {};
  v.seatOrder.forEach((id, i) => { out[id] = SERIES[i % SERIES.length]; });
  return out;
}

const escHtml = (t) => String(t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

function niceTicks(min, max, count = 4) {
  const span = Math.max(1, max - min);
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => span / st <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(Math.round(t));
  return ticks;
}

// Donnees : total cumule de chaque joueur apres chaque manche (0 au depart).
function chartSeries(v) {
  const players = v.seatOrder.map((id) => {
    const p = v.players.find((x) => x.id === id);
    return { id, name: p ? p.name : "?", totals: [0] };
  });
  for (const r of v.roundResults) {
    for (const s of players) {
      const res = r.results.find((x) => x.id === s.id);
      s.totals.push(res ? res.total : s.totals[s.totals.length - 1]);
    }
  }
  return players;
}

const CH = { w: 460, h: 230, l: 44, r: 14, t: 12, b: 28 };

function scoreChartHtml(v, color) {
  if (!v.roundResults.length) return `<p class="chart-empty">Le graphique apparaîtra à la fin de la première manche.</p>`;
  const series = chartSeries(v);
  const n = v.roundResults.length;
  const all = series.flatMap((s) => s.totals);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const direct = series.length <= 4;
  const right = direct ? 86 : CH.r;
  const x = (i) => CH.l + (i / Math.max(1, n)) * (CH.w - CH.l - right);
  const y = (val) => CH.t + (1 - (val - ticks[0]) / (ticks[ticks.length - 1] - ticks[0])) * (CH.h - CH.t - CH.b);
  const grid = ticks.map((t) => `<line x1="${CH.l}" x2="${CH.w - right}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? "zero" : "grid"}"/><text x="${CH.l - 6}" y="${y(t) + 4}" class="tick" text-anchor="end">${t}</text>`).join("");
  const step = Math.max(1, Math.ceil(n / 10));
  const xt = [];
  for (let i = 0; i <= n; i += step) xt.push(`<text x="${x(i)}" y="${CH.h - 8}" class="tick" text-anchor="middle">${i}</text>`);
  const lines = series.map((s) => {
    const pts = s.totals.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(" ");
    const dots = s.totals.map((val, i) => (i === 0 ? "" : `<circle cx="${x(i)}" cy="${y(val)}" r="4" fill="${color[s.id]}" class="dot"/>`)).join("");
    return `<polyline points="${pts}" fill="none" stroke="${color[s.id]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  }).join("");
  // etiquettes directes en bout de ligne (4 joueurs max), avec un trait de
  // rappel si deux etiquettes se chevauchent
  let labels = "";
  if (direct) {
    const ends = series.map((s) => ({ s, yy: y(s.totals[n]) })).sort((a, b) => a.yy - b.yy);
    let last = -Infinity;
    for (const e of ends) {
      const ly = Math.max(e.yy, last + 13);
      last = ly;
      const lx = x(n) + 10;
      if (Math.abs(ly - e.yy) > 2) labels += `<line x1="${x(n) + 4}" y1="${e.yy}" x2="${lx - 2}" y2="${ly - 4}" class="leader"/>`;
      labels += `<text x="${lx}" y="${ly}" class="dlabel">${escHtml(e.s.name.slice(0, 9))} ${e.s.totals[n]}</text>`;
    }
  }
  const legend = series.map((s) => `<span class="lg"><i style="background:${color[s.id]}"></i>${escHtml(s.name)}</span>`).join("");
  return `<div class="chart-card">
    <div class="chart-legend">${legend}</div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${CH.w} ${CH.h}" class="score-chart" role="img" aria-label="Évolution des scores cumulés, manche par manche">
        ${grid}${xt.join("")}
        <text x="${(CH.l + CH.w - right) / 2}" y="${CH.h}" class="axis-t" text-anchor="middle">manches</text>
        <line class="xhair" x1="0" x2="0" y1="${CH.t}" y2="${CH.h - CH.b}" visibility="hidden"/>
        ${lines}${labels}
        <rect class="hit" x="${CH.l - 10}" y="0" width="${CH.w - CH.l - right + 20}" height="${CH.h}" fill="transparent"/>
      </svg>
      <div class="chart-tip hidden"></div>
    </div>
  </div>`;
}

function bindScoreChart(root, v) {
  const svg = root.querySelector(".score-chart");
  if (!svg || !v.roundResults.length) return;
  const series = chartSeries(v);
  const color = seriesColors(v);
  const n = v.roundResults.length;
  const right = series.length <= 4 ? 86 : CH.r;
  const x = (i) => CH.l + (i / Math.max(1, n)) * (CH.w - CH.l - right);
  const tip = root.querySelector(".chart-tip");
  const hair = svg.querySelector(".xhair");
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * CH.w;
    let i = Math.round(((px - CH.l) / (CH.w - CH.l - right)) * n);
    i = Math.max(1, Math.min(n, i));
    hair.setAttribute("x1", x(i));
    hair.setAttribute("x2", x(i));
    hair.setAttribute("visibility", "visible");
    const rr = v.roundResults[i - 1];
    const rows = series.slice().sort((a, b) => b.totals[i] - a.totals[i]).map((s) => {
      const res = rr.results.find((q) => q.id === s.id);
      const d = res ? res.points : 0;
      return `<div><i style="background:${color[s.id]}"></i>${escHtml(s.name)} <b>${s.totals[i]}</b> <span class="${d >= 0 ? "ok" : "ko"}">(${signed(d)})</span></div>`;
    }).join("");
    tip.innerHTML = `<div class="tip-h">Après la manche ${i} · ${cartes(rr.cards)}</div>${rows}`;
    tip.classList.remove("hidden");
    const left = (x(i) / CH.w) * r.width;
    tip.style.left = `${Math.min(r.width - tip.offsetWidth - 4, Math.max(4, left + 12 > r.width / 2 ? left - tip.offsetWidth - 12 : left + 12))}px`;
  };
  const hide = () => {
    tip.classList.add("hidden");
    hair.setAttribute("visibility", "hidden");
  };
  const hit = svg.querySelector(".hit");
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") hide(); });
}

function recapTableHtml(v, color) {
  if (!v.roundResults.length) return `<p class="chart-empty">Aucune manche terminée pour l'instant.</p>`;
  const players = v.seatOrder.map((id) => v.players.find((p) => p.id === id)).filter(Boolean);
  const head = players.map((p) => `<th><i class="sw" style="background:${color[p.id]}"></i>${escHtml(p.name)}</th>`).join("");
  const body = v.roundResults.map((r) => {
    const cells = players.map((p) => {
      const x = r.results.find((q) => q.id === p.id);
      if (!x) return "<td>—</td>";
      return `<td><span class="${x.bid === x.won ? "ok" : "ko"}">${signed(x.points)}</span><small>${x.won}/${x.bid}</small></td>`;
    }).join("");
    return `<tr><td class="rc">${r.round} <small>${r.cards} c. ${r.trump ? SYM[r.trump] : "SA"}</small></td>${cells}</tr>`;
  }).join("");
  const totals = players.map((p) => `<td><b>${p.score}</b></td>`).join("");
  return `<div class="recap-wrap"><table class="recap-table">
    <thead><tr><th>Manche</th>${head}</tr></thead>
    <tbody>${body}<tr class="tot"><td class="rc">Total</td>${totals}</tr></tbody>
  </table></div>
  <p class="score-seq">Dans chaque case : points de la manche, puis plis faits / plis annoncés.</p>`;
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
    hud.setMyPlate(
      S.me.name,
      v.hand.length,
      myBid === null ? (you.isDealer ? "🃏 Tu distribues" : "Pas encore annoncé") : `Objectif ${plis(myBid)} · ${plis(you.won)} fait${you.won > 1 ? "s" : ""}`,
      myBid === null ? (you.isDealer ? "🃏 donneur" : "🎯 ? · ✋ 0") : `🎯 ${myBid} · ✋ ${you.won}`
    );
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
    const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
    const color = seriesColors(v);
    const rows = v.players.slice().sort((a, b) => b.score - a.score).map((p) => {
      const cls = p.bid === null ? "" : p.bid === p.won ? "ok" : "ko";
      return `<tr class="${p.id === v.you.id ? "me" : ""}"><td><i class="sw" style="background:${color[p.id]}"></i>${p.isDealer ? "🃏 " : ""}${esc(p.name)}</td><td>${p.bid === null ? "—" : p.bid}</td><td class="${cls}">${p.won}</td><td><b>${p.score}</b></td></tr>`;
    }).join("");
    const seq = v.sequence.map((n, i) => (i === v.round - 1 ? `<b>${n}</b>` : String(n))).join(" · ");
    return `<h4 class="score-h">Manche en cours</h4>
      <table class="score-table"><thead><tr><th>Joueur</th><th>Objectif</th><th>Plis</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
      <h4 class="score-h">Évolution des scores</h4>
      ${scoreChartHtml(v, color)}
      <h4 class="score-h">Points manche par manche</h4>
      ${recapTableHtml(v, color)}
      <p class="score-seq">Manches : ${seq}</p>
      <p class="score-seq">Pari réussi : 40 points par pli (20 pour zéro). Pari raté : −40 par pli d'écart.</p>`;
  },
  bindTray(root, v) {
    bindScoreChart(root, v);
  },

  fetchHistory: true,
  historyHtml(history, esc) {
    if (!history.length) return "<p>Rien ne s'est encore passé.</p>";
    const rounds = new Map();
    for (const e of history) {
      if (!rounds.has(e.round)) rounds.set(e.round, []);
      rounds.get(e.round).push(e);
    }
    const g = window.__menteur && window.__menteur.S.game;
    const current = g ? g.round : 0;
    const live = g && (g.phase === "bidding" || g.phase === "playing" || g.phase === "trick_done");
    const blocks = [...rounds.entries()].sort((a, b) => b[0] - a[0]).map(([round, evs]) => {
      const start = evs.find((e) => e.type === "round_start");
      const head = start
        ? `Manche ${round} · ${cartes(start.cards)} · ${start.trump ? `atout ${SYM[start.trump]}` : "sans atout"} · ${esc(start.dealerName || "")} distribue`
        : `Manche ${round}`;
      const lines = [];
      const bids = evs.filter((e) => e.type === "bid");
      if (bids.length) lines.push(`<li>🎯 Annonces : ${bids.map((e) => `<b>${esc(e.playerName)}</b> ${e.bid}`).join(" · ")}</li>`);
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
      for (const [n, t] of [...tricks.entries()].sort((a, b) => a[0] - b[0])) {
        const cards = t.plays.map((e) => `${esc(e.playerName)} <span class="hcard ${e.suit === "coeur" || e.suit === "carreau" ? "red" : ""}">${cardName(e)}</span>${e.cut ? " ✂️" : ""}`).join(", ");
        lines.push(`<li>✋ <b>Pli ${n}</b>${t.winner ? ` pour <b>${esc(t.winner)}</b>` : " (en cours)"} : ${cards}</li>`);
      }
      const end = evs.find((e) => e.type === "round_end");
      if (end) lines.push(`<li>🏁 Fin de la manche ${round}</li>`);
      const note = live && round === current ? `<p class="hist-note">👀 Manche en cours : seul le dernier pli est visible.</p>` : "";
      return `<h4 class="hist-round">${head}</h4>${note}<ul>${lines.join("")}</ul>`;
    });
    return blocks.join("");
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
      <p class="rule"><i>🛗</i><span>À chaque manche, on distribue <b>une carte de plus</b>, jusqu'au maximum (52 divisé par le nombre de joueurs), puis on redescend jusqu'à une seule carte. Dans le salon, le patron peut modifier le maximum, le sens et le pas.</span></p>
      <p class="rule"><i>🃏</i><span>Après la distribution, on retourne la première carte du talon : sa couleur devient l'<b>atout</b>. S'il ne reste aucune carte, la manche se joue <b>sans atout</b>.</span></p>
      <p class="rule"><i>🎯</i><span>Chacun son tour, en commençant par le joueur à gauche du donneur, <b>annonce le nombre de plis</b> qu'il pense remporter. Le donneur parle en dernier : il n'a pas le droit de choisir un nombre qui rendrait le total des annonces égal au nombre de plis. Au moins un joueur devra donc se tromper !</span></p>
      <p class="rule"><i>👉</i><span>Le joueur à gauche du donneur entame le premier pli. Tu dois <b>fournir la couleur demandée</b> si tu en as ; sinon, tu joues la carte de ton choix (couper n'est pas obligatoire).</span></p>
      <p class="rule"><i>✋</i><span>Le pli revient au <b>plus gros atout</b> ou, à défaut, à la plus forte carte de la couleur demandée (du 2 au Roi, puis l'As). Le gagnant entame le pli suivant.</span></p>
      <p class="rule"><i>👀</i><span>Pendant une manche, seul le <b>dernier pli</b> peut être consulté : à toi de retenir les cartes déjà tombées !</span></p>
      <p class="rule"><i>📊</i><span>Pari réussi : <b>40 points par pli annoncé</b>, ou 20 points pour une annonce de zéro réussie. Pari raté : <b>−40 points par pli d'écart</b>.</span></p>
`;
  }
};
