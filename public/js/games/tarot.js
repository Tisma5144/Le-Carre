// Adaptateur client du Tarot : encheres, appel du Roi (a 5), chien et
// ecart, annonces (poignee, misere, chelem), plis poses devant chaque
// joueur, plis remportes en tas, comptage FFT et tableau des scores.
import { miniCardUrl } from "../ui/hud.js";
import { seriesColors, scoreChartHtml, bindScoreChart } from "./ascenseur.js";

const $ = (id) => document.getElementById(id);
const COLOR_ORDER = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "C", "D", "R"];
const POWER = Object.fromEntries(COLOR_ORDER.map((r, i) => [r, i]));
const SYM = { pique: "♠", coeur: "♥", carreau: "♦", trefle: "♣" };
const SUIT_NAME = { pique: "Pique", coeur: "Cœur", carreau: "Carreau", trefle: "Trèfle", atout: "Atout" };
const SUIT_SORT = { pique: 0, coeur: 1, trefle: 2, carreau: 3, atout: 4, excuse: 5 };
const RANK_NAME = { V: "Valet", C: "Cavalier", D: "Dame", R: "Roi" };
const MISERE_NAME = { atout: "Misère d'atout", tete: "Misère de tête" };
const BID_CLASS = { prise: "check", garde: "raise", garde_sans: "allin", garde_contre: "contre" };
const esc = (t) => String(t == null ? "" : t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const fmtPts = (p) => String(p).replace(".", ",");

const isTrump = (c) => c.suit === "atout";
const isExcuse = (c) => c.suit === "excuse";
const isBout = (c) => isExcuse(c) || (isTrump(c) && (c.rank === "1" || c.rank === "21"));

export function cardName(c) {
  if (isExcuse(c)) return "l'Excuse";
  if (isTrump(c)) return c.rank === "1" ? "le Petit" : `${c.rank} d'atout`;
  return `${RANK_NAME[c.rank] || c.rank} ${SYM[c.suit]}`;
}
const shortName = (c) => (isExcuse(c) ? "Excuse" : isTrump(c) ? `${c.rank} atout` : `${RANK_NAME[c.rank] || c.rank}${SYM[c.suit]}`);

function contractOf(v, idx) {
  return idx === null || idx === undefined || idx < 0 ? null : v.contracts[idx];
}

function miniRow(cards) {
  return `<span class="mini-row">${cards.map((c) => `<img src="${miniCardUrl(c)}" alt="${esc(cardName(c))}" />`).join("")}</span>`;
}

// ------------------------------------------------------------------ ecart
function ecartAllowed(v, c) {
  if (isBout(c)) return false;
  if (!isTrump(c) && c.rank === "R") return false;
  if (isTrump(c)) return v.you.ecartNeedTrumps > 0;
  return true;
}

// ------------------------------------------------------------------ scores
function chartView(v) {
  return {
    seatOrder: v.seatOrder,
    players: v.players,
    roundResults: v.roundResults.map((r) => ({
      round: r.donne,
      donne: r,
      results: v.seatOrder.map((id) => ({ id, points: r.deltas[id], total: r.totals[id] }))
    }))
  };
}
const CHART_OPTS = {
  unit: "donne",
  tipHead: (rr) => `Après la donne ${rr.round}`
};

function resultLine(r, v) {
  const name = (id) => (v.players.find((p) => p.id === id) || { name: "?" }).name;
  const parts = [`${fmtPts(r.points)} points pour ${r.needed} demandés (${r.bouts} bout${r.bouts > 1 ? "s" : ""})`];
  if (r.petitAuBout) parts.push(`petit au bout ${signed(r.petitAuBout)}`);
  if (r.poignees.length) parts.push(`poignée ${signed(r.poignee)}`);
  if (r.chelem) parts.push(`chelem ${signed(r.chelem)}`);
  if (r.miseres.length) parts.push(r.miseres.map((m) => `${MISERE_NAME[m.kind]} de ${name(m.id)}`).join(", "));
  return parts.join(" · ");
}

export default {
  id: "tarot",
  name: "Le Tarot",
  emoji: "🃏",
  tagline: "Prends, garde… et mène le Petit au bout !",
  players: "3 à 5 joueurs",
  minPlayers: 3,
  maxPlayers: 5,
  deckSize: 78,
  maxSelect: 1,
  pendingFaceUp: true,
  defaultSorted: true,
  rankOrder: COLOR_ORDER,

  // couleurs alternees, puis les atouts dans l'ordre, l'Excuse a la fin
  sortHand(hand) {
    const val = (c) => (isTrump(c) ? parseInt(c.rank, 10) : POWER[c.rank] || 0);
    return hand.slice().sort((a, b) => SUIT_SORT[a.suit] - SUIT_SORT[b.suit] || val(a) - val(b));
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
    // poignees des adversaires : montrees pendant le premier pli
    const shown = [];
    if ((v.phase === "playing" || v.phase === "trick_done") && v.trickNumber === 0) {
      const inTrick = new Set(v.trick.map((p) => p.card.id));
      for (const pg of v.poignees) {
        if (pg.id === myId || !opp.has(pg.id)) continue;
        const cards = pg.cards.filter((c) => !inTrick.has(c.id));
        cards.forEach((card, j) => shown.push({ card, owner: pg.id, j }));
        opp.set(pg.id, Math.max(0, opp.get(pg.id) - cards.length));
      }
    }
    const won = new Map(v.players.map((p) => [p.id === myId ? "__me" : p.id, p.wonCards]));
    if (v.defenseChien) {
      // garde contre : le chien part chez le premier defenseur
      const def = v.seatOrder.find((id) => id !== v.takerId);
      const key = def === myId ? "__me" : def;
      won.set(key, (won.get(key) || 0) + v.defenseChien);
    }
    if (app) app.table.trickSize = v.seatOrder.length;
    return {
      me,
      opp,
      trick,
      won,
      shown,
      chien: v.chienCount || 0,
      center: v.chien || []
    };
  },

  turnBanner(v) {
    if (v.you.mustBid) return "À toi de parler !";
    if (v.you.mustCall) return "Appelle un Roi !";
    if (v.you.mustEcart) return "Fais ton écart !";
    if (v.you.mustChelem) return "Un chelem ?";
    return v.trick.length === 0 ? "À toi d'entamer !" : "À toi de jouer !";
  },
  isPlaying: (v) => ["bidding", "calling", "ecart", "chelem", "playing"].includes(v.phase),
  showRing: (v) => v.phase === "playing",

  legality(ids, v, app) {
    if (!v || app.S.dealing) return { ok: false, why: "" };
    if (v.phase === "ecart") {
      if (!v.you.mustEcart) return { ok: false, why: `${v.takerName} fait son écart…` };
      const cards = ids.map((id) => v.hand.find((c) => c.id === id)).filter(Boolean);
      const bad = cards.find((c) => !ecartAllowed(v, c));
      if (bad) return { ok: false, why: isBout(bad) ? "Interdit d'écarter un bout." : bad.rank === "R" ? "Interdit d'écarter un Roi." : "Pas d'atout à l'écart (sauf si tu n'as pas le choix)." };
      if (cards.length !== v.you.ecartSize) return { ok: false, why: `Choisis ${v.you.ecartSize} cartes à écarter (${cards.length}/${v.you.ecartSize}).`, partial: true };
      return { ok: true, ecart: true };
    }
    if (v.phase === "bidding") return { ok: false, why: v.you.mustBid ? "Choisis d'abord ton enchère." : "Attends la fin des enchères." };
    if (v.phase === "calling" || v.phase === "chien" || v.phase === "chelem") return { ok: false, why: "Patience, la partie va commencer." };
    if (v.phase === "trick_done") return { ok: false, why: "Le pli est en train d'être ramassé…" };
    if (v.phase !== "playing") return { ok: false, why: "" };
    if (!v.you.isYourTurn) return { ok: false, why: `Pas si vite ! C'est au tour de ${v.currentTurnName}.` };
    if (ids.length !== 1) return { ok: false, why: "Une seule carte à la fois." };
    if (!v.you.legalIds.includes(ids[0])) {
      const lead = v.leadSuit;
      const hasLead = lead && lead !== "atout" && v.hand.some((c) => c.suit === lead);
      if (hasLead) return { ok: false, why: `Tu dois fournir : joue du ${SUIT_NAME[lead]} ${SYM[lead]}.` };
      return { ok: false, why: lead === "atout" ? "À l'atout, il faut monter si tu peux." : "Tu dois couper (et monter si tu peux)." };
    }
    return { ok: true };
  },

  canDrop(ids, v, app) {
    if (v.phase === "ecart") return false;
    return this.legality(ids, v, app).ok;
  },

  commitPlay(ids, v, app) {
    const l = this.legality(ids, v, app);
    if (!l.ok) {
      if (l.why && !(l.partial && v.phase === "ecart")) app.hud.toast(l.why);
      else if (l.partial) app.hud.toast(l.why);
      app.sfx.play("error");
      return;
    }
    if (l.ecart) {
      app.emit("game:ecart", { cardIds: ids }, () => app.table.clearSelection());
      return;
    }
    app.table.setPendingDrop(ids);
    app.emit("game:play", { cardIds: ids }, () => app.table.clearSelection(), () => app.table.clearPendingDrop());
  },

  playButton(v, sel, app) {
    if (app.S.dealing) return { show: false };
    if (v.phase === "ecart" && v.you.mustEcart) {
      if (!sel.length) return { show: false };
      const l = this.legality(sel, v, app);
      return { show: l.ok, text: `Écarter ces ${v.you.ecartSize} cartes` };
    }
    if (sel.length !== 1 || !this.legality(sel, v, app).ok) return { show: false };
    const c = v.hand.find((x) => x.id === sel[0]);
    return { show: true, text: `Poser : ${shortName(c)}` };
  },

  onEvent(ev, app) {
    const { hud, sfx, S } = app;
    const who = app.who;
    const me = S.me.id;
    const nm = (id) => (id === me ? "Toi" : app.playerName(id));
    switch (ev.type) {
      case "deal":
        break;
      case "petit_sec":
        hud.toast(`Petit sec chez ${nm(ev.playerId)} : la donne est annulée, on redistribue.`, 3400);
        break;
      case "all_pass":
        hud.toast("Tout le monde passe : on redistribue 🔄", 3000);
        break;
      case "bid":
        hud.bubble(who(ev.playerId), ev.bid === "passe" ? "Passe" : `${ev.label} !`, ev.bid === "passe" ? "" : "gold");
        sfx.play(ev.bid === "passe" ? "select" : "stamp");
        break;
      case "taker":
        hud.toast(`${ev.playerId === me ? "Tu prends" : `${nm(ev.playerId)} prend`} : ${ev.label} !`, 2800);
        break;
      case "call":
        hud.bubble(who(ev.playerId), `J'appelle le ${RANK_NAME[ev.rank] || ev.rank} ${SYM[ev.suit]} !`, "gold");
        sfx.play("stamp");
        break;
      case "chien_reveal":
        sfx.play("flip");
        break;
      case "chien_hidden":
        hud.toast(ev.toAttack ? "Garde sans : le chien va au preneur, sans être vu." : "Garde contre : le chien va à la défense.", 3000);
        break;
      case "ecart":
        if (ev.trumps && ev.trumps.length) hud.toast(`Atouts mis à l'écart : ${ev.trumps.map((c) => cardName(c)).join(", ")}`, 3600);
        sfx.play("pickup");
        break;
      case "chelem":
        hud.showTurnBanner("Chelem annoncé !", "gold");
        sfx.play("stamp");
        break;
      case "poignee":
        hud.bubble(who(ev.playerId), `${ev.name} ! ✋`, "gold");
        hud.toast(`${nm(ev.playerId)} annonce une ${ev.name.toLowerCase()} (${ev.cards.length} atouts)`, 3600);
        sfx.play("quad");
        break;
      case "misere":
        hud.bubble(who(ev.playerId), `${MISERE_NAME[ev.kind]} !`, "gold");
        sfx.play("truth");
        break;
      case "partner":
        if (ev.alone) hud.toast(`${nm(ev.playerId)} joue seul${ev.playerId === me ? "" : " (son Roi appelé était chez lui)"} !`, 3200);
        else {
          hud.showTurnBanner(ev.playerId === me ? "Tu es le partenaire !" : `${nm(ev.playerId)} est le partenaire`, "gold");
          hud.bubble(who(ev.playerId), "C'était moi ! 🤝", "gold");
        }
        sfx.play("truth");
        break;
      case "play":
        if (ev.cut) {
          hud.bubble(who(ev.playerId), "Je coupe ! ✂️", "gold");
          sfx.play("stamp");
        }
        if (ev.suit === "atout" && ev.rank === "1") hud.bubble(who(ev.playerId), "Le Petit ! 😬", "gold");
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
    const n = v.seatOrder.length;
    table.maxSelect = v.phase === "ecart" && you.mustEcart ? you.ecartSize : 1;

    // plaque
    const donneLbl = `Donne ${v.donne}${v.donnes ? `/${v.donnes}` : ""}`;
    const best = contractOf(v, v.bestBid);
    if (dealing) {
      hud.setAnnounce({ label: donneLbl, value: "Distribution…", sub: `${nm(v.dealerId)} distribue`, key: "deal" + v.dealNo });
    } else if (v.phase === "bidding") {
      hud.setAnnounce({ label: `${donneLbl} · enchères`, value: best ? `${best.label} (${nm(v.takerId)})` : "Personne n'a pris", sub: `au tour de ${nm(v.currentTurn)}`, key: "bid" + v.dealNo + v.bestBid + v.currentTurn });
    } else if (v.phase === "round_end" || v.phase === "finished") {
      hud.setAnnounce({ label: donneLbl, value: "Terminée !", sub: "", key: "end" + v.donne });
    } else if (v.contract) {
      let sub = `×${v.contract.mult}`;
      if (v.calledCard) sub = `${RANK_NAME[v.calledCard.rank]} ${SYM[v.calledCard.suit]} appelé${v.partnerName ? ` · partenaire : ${v.partnerId === me ? "toi" : v.partnerName}` : ""}`;
      if (v.chelemAnnounced) sub += " · chelem annoncé";
      hud.setAnnounce({ label: donneLbl, value: `${v.contract.label} · ${nm(v.takerId)}`, sub, key: "c" + v.dealNo + v.partnerRevealed + (v.partnerName || "") });
    }

    // aide
    let hint = "";
    if (!dealing) {
      if (v.phase === "bidding") hint = you.mustBid ? "" : `<b>${esc(v.currentTurnName)}</b> réfléchit à son enchère…`;
      else if (v.phase === "calling") hint = you.mustCall ? "" : `<b>${esc(v.takerName)}</b> appelle un Roi…`;
      else if (v.phase === "chien") hint = `Le chien : <b>${esc(v.takerName)}</b> va le prendre.`;
      else if (v.phase === "ecart") hint = you.mustEcart ? `Touche <b>${you.ecartSize} cartes</b> à mettre à l'écart (ni Roi ni bout${you.ecartNeedTrumps ? `, ${you.ecartNeedTrumps} atout${you.ecartNeedTrumps > 1 ? "s" : ""} obligé${you.ecartNeedTrumps > 1 ? "s" : ""}` : ", pas d'atout"}), puis valide.` : `<b>${esc(v.takerName)}</b> fait son écart…`;
      else if (v.phase === "chelem") hint = you.mustChelem ? "" : `<b>${esc(v.takerName)}</b> réfléchit…`;
      else if (v.phase === "playing") {
        const lead = v.leadSuit;
        if (myTurn && !v.trick.length) hint = "À toi d'entamer : <b>glisse une carte</b> sur le tapis.";
        else if (myTurn && lead && lead !== "atout" && v.hand.some((c) => c.suit === lead)) hint = `Fournis du <b>${SYM[lead]} ${SUIT_NAME[lead]}</b>.`;
        else if (myTurn && lead === "atout") hint = "Atout demandé : <b>monte</b> si tu peux.";
        else if (myTurn && lead) hint = v.hand.some(isTrump) ? `Pas de ${SYM[lead]} : <b>coupe</b> (et monte si tu peux).` : `Pas de ${SYM[lead]} ni d'atout : <b>défausse</b> ce que tu veux.`;
        else if (myTurn) hint = "Joue la carte de ton choix.";
        else hint = `Au tour de <b>${esc(v.currentTurnName)}</b>…`;
      } else if (v.phase === "trick_done") {
        hint = v.trickWinner === me ? "✋ <b>Tu remportes le pli !</b>" : `✋ Pli pour <b>${esc(v.trickWinnerName)}</b>`;
      }
    }
    hud.setHint(hint, myTurn || you.mustEcart);

    // cartes interdites assombries
    let dim = [];
    if (myTurn) dim = v.hand.filter((c) => !you.legalIds.includes(c.id)).map((c) => c.id);
    else if (you.mustEcart && !dealing) dim = v.hand.filter((c) => !ecartAllowed(v, c)).map((c) => c.id);
    table.setDimmed(dim);

    this.renderBar(v, app);

    $("btn-liar").classList.add("hidden");
    $("btn-pass").classList.add("hidden");
    // annonces avant sa premiere carte
    const chips = [];
    if (myTurn && you.canAnnounce) {
      const need = { 3: [13, 15, 18], 4: [10, 13, 15], 5: [8, 10, 13] }[n];
      const names = ["Poignée", "Double poignée", "Triple poignée"];
      for (const lvl of you.poigneeLevels) {
        chips.push({ key: "pg" + lvl, label: `✋ ${names[lvl]} (${need[lvl]} atouts)`, onClick: () => app.emit("game:announce", { kind: "poignee", level: lvl }) });
      }
      for (const k of you.misereKinds) chips.push({ key: "mi" + k, label: `😶 ${MISERE_NAME[k]}`, onClick: () => app.emit("game:announce", { kind: "misere", misere: k }) });
    }
    hud.setActionChips(chips);

    // plaques
    const campLabel = (id, camp) => {
      if (id === v.takerId) return `👑 ${v.contract ? v.contract.label : "preneur"}`;
      if (camp === "attack") return "🤝 partenaire";
      if (camp === "defense") return "🛡️ défense";
      return "";
    };
    const bidLabel = (p) => (p.bid === null ? "" : p.bid < 0 ? "passe" : v.contracts[p.bid].label);
    const myP = v.players.find((p) => p.id === me) || {};
    const myCamp = campLabel(me, you.camp);
    hud.setMyPlate(
      S.me.name,
      v.hand.length,
      v.phase === "bidding" ? (you.isDealer ? "🃏 Tu distribues" : bidLabel(myP) ? `Enchère : ${bidLabel(myP)}` : "Enchères en cours") : myCamp || (n === 5 && v.takerId ? "Camp secret 🤫" : "🛡️ défense"),
      v.phase === "bidding" ? (bidLabel(myP) || (you.isDealer ? "🃏 donneur" : "…")) : myCamp || "🛡️"
    );
    hud.syncPlates(v.opponents.map((o) => {
      const active = !dealing && this.isPlaying(v) && o.id === v.currentTurn;
      let st = v.phase === "bidding" ? bidLabel(o) || (o.isDealer ? "🃏 distribue" : "") : campLabel(o.id, o.camp);
      if (v.phase === "bidding" && active) st = "réfléchit";
      if (!o.connected) st = "hors ligne";
      return { id: o.id, name: o.name, count: o.cardCount, connected: o.connected, active, statusText: st };
    }));

    this.updateRoundEnd(v, app);
  },

  // Barre d'actions : encheres, appel du Roi, chelem.
  renderBar(v, app) {
    const bar = $("action-bar");
    const you = v.you;
    const dealing = app.S.dealing;
    let key = "";
    let html = "";
    if (!dealing && you.mustBid) {
      key = `bid-${v.uid}-${v.dealNo}-${v.bestBid}`;
      const trumps = v.hand.filter(isTrump).length;
      const bouts = v.hand.filter(isBout).length;
      const kings = v.hand.filter((c) => !isTrump(c) && c.rank === "R").length;
      const btns = [`<button class="act fold" data-bid="passe">Passe</button>`]
        .concat(v.contracts.map((c, i) => (i > v.bestBid ? `<button class="act ${BID_CLASS[c.key]}" data-bid="${c.key}">${c.label}<small>×${c.mult}</small></button>` : "")).filter(Boolean));
      html = `<div class="act-info">Ta main : <b>${trumps}</b> atout${trumps > 1 ? "s" : ""} · <b>${bouts}</b> bout${bouts > 1 ? "s" : ""} · <b>${kings}</b> Roi${kings > 1 ? "s" : ""}${v.bestBid >= 0 ? ` · à battre : <b>${esc(v.contracts[v.bestBid].label)}</b>` : ""}</div>
        <div class="act-row">${btns.join("")}</div>`;
    } else if (!dealing && you.mustCall) {
      key = `call-${v.uid}-${v.dealNo}`;
      const rn = RANK_NAME[you.callRank] || you.callRank;
      html = `<div class="act-info">Appelle un ${rn} : son propriétaire sera ton partenaire secret</div>
        <div class="act-row">${["pique", "coeur", "carreau", "trefle"].map((s) => `<button class="act suit ${s === "coeur" || s === "carreau" ? "red" : ""}" data-call="${s}">${rn} ${SYM[s]}</button>`).join("")}</div>`;
    } else if (!dealing && you.mustChelem) {
      key = `chelem-${v.uid}-${v.dealNo}`;
      html = `<div class="act-info">Annoncer un chelem ? (tous les plis : +400, raté : −200)</div>
        <div class="act-row"><button class="act check" data-chelem="0">Non, on joue</button><button class="act allin" data-chelem="1">Chelem !</button></div>`;
    }
    if (!key) {
      if (bar.dataset.key && bar.dataset.key.startsWith("t-")) {
        bar.classList.add("hidden");
        bar.dataset.key = "";
      }
      return;
    }
    bar.classList.remove("hidden");
    if (bar.dataset.key === "t-" + key) return;
    bar.dataset.key = "t-" + key;
    bar.innerHTML = html;
    const done = () => {
      bar.classList.add("hidden");
      bar.dataset.key = "";
    };
    const retry = () => this.refresh(app.S.game, app);
    bar.querySelectorAll("[data-bid]").forEach((b) => b.addEventListener("click", () => {
      app.sfx.play("select");
      done();
      app.emit("game:bid", { bid: b.dataset.bid }, null, retry);
    }));
    bar.querySelectorAll("[data-call]").forEach((b) => b.addEventListener("click", () => {
      app.sfx.play("select");
      done();
      app.emit("game:call", { suit: b.dataset.call }, null, retry);
    }));
    bar.querySelectorAll("[data-chelem]").forEach((b) => b.addEventListener("click", () => {
      app.sfx.play("select");
      done();
      app.emit("game:chelem", { announce: b.dataset.chelem === "1" }, null, retry);
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
      if (v.phase === "finished") {
        const nb = v.ranking.length;
        const entries = v.ranking.map((r, i) => ({
          medal: i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 && nb > 3 ? "🥉" : `${i + 1}`,
          name: r.name,
          me: r.id === S.me.id,
          title: `${r.score} pts`,
          sub: i === 0 ? "Grand maître du Tarot" : ""
        }));
        if (v.ranking[0] && v.ranking[0].id === S.me.id) app.sfx.play("win");
        hud.showEnd({
          key,
          title: "Fin de la partie",
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
      const taker = v.players.find((p) => p.id === r.takerId);
      const partner = r.partnerId ? v.players.find((p) => p.id === r.partnerId) : null;
      const entries = v.seatOrder.map((id) => v.players.find((p) => p.id === id)).sort((a, b) => r.deltas[b.id] - r.deltas[a.id]).map((p) => ({
        medal: p.id === r.takerId ? "👑" : p.id === r.partnerId ? "🤝" : "🛡️",
        name: p.name,
        me: p.id === S.me.id,
        title: `${signed(r.deltas[p.id])}`,
        sub: `total ${r.totals[p.id]}`
      }));
      const verdict = r.made ? `réussie de ${r.ecart}` : `chutée de ${r.ecart}`;
      hud.showEnd({
        key,
        title: `${r.contractLabel} de ${taker ? taker.name : "?"}${partner ? ` et ${partner.name}` : ""} ${verdict} !`,
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
    if (bar.dataset.key && bar.dataset.key.startsWith("t-")) {
      bar.classList.add("hidden");
      bar.dataset.key = "";
    }
    if (app && app.table) {
      app.table.setDimmed([]);
      app.table.maxSelect = 1;
    }
  },

  chips(v) {
    const on = v.phase === "playing" || v.phase === "trick_done";
    return {
      pile: on ? `Pli <b>${Math.min(v.trickNumber + (v.phase === "playing" ? 1 : 0), v.tricksTotal)}</b> / ${v.tricksTotal}` : v.phase === "chien" ? "Le chien" : "",
      tray: "📊 Scores"
    };
  },

  trayTitle: "Tableau des scores",
  trayHtml(v) {
    const cv = chartView(v);
    const color = seriesColors(cv);
    const rows = v.players.slice().sort((a, b) => b.score - a.score).map((p) => `<tr class="${p.id === v.you.id ? "me" : ""}"><td><i class="sw" style="background:${color[p.id]}"></i>${p.isDealer ? "🃏 " : ""}${esc(p.name)}</td><td><b>${p.score}</b></td></tr>`).join("");
    const players = v.seatOrder.map((id) => v.players.find((p) => p.id === id));
    const recap = v.roundResults.length ? `<div class="recap-wrap"><table class="recap-table">
      <thead><tr><th>Donne</th>${players.map((p) => `<th><i class="sw" style="background:${color[p.id]}"></i>${esc(p.name)}</th>`).join("")}</tr></thead>
      <tbody>${v.roundResults.map((r) => `<tr><td class="rc">${r.donne} <small>${esc(r.contractLabel)} ${r.made ? "✅" : "❌"}</small></td>${players.map((p) => `<td><span class="${r.deltas[p.id] >= 0 ? "ok" : "ko"}">${signed(r.deltas[p.id])}</span><small>${p.id === r.takerId ? "👑" : p.id === r.partnerId ? "🤝" : ""}</small></td>`).join("")}</tr>`).join("")}
      <tr class="tot"><td class="rc">Total</td>${players.map((p) => `<td><b>${p.score}</b></td>`).join("")}</tr></tbody></table></div>` : `<p class="chart-empty">Aucune donne terminée pour l'instant.</p>`;
    const last = v.lastResult ? `<p class="score-seq"><b>Dernière donne :</b> ${esc(resultLine(v.lastResult, v))}</p>` : "";
    return `<h4 class="score-h">${v.phase === "finished" ? "Classement final" : "Scores"}</h4>
      <table class="score-table"><thead><tr><th>Joueur</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
      ${last}
      <h4 class="score-h">Évolution des scores</h4>
      ${scoreChartHtml(cv, color, CHART_OPTS)}
      <h4 class="score-h">Donne par donne</h4>
      ${recap}
      <p class="score-seq">Contrat : 56 / 51 / 41 / 36 points avec 0 / 1 / 2 / 3 bouts. Marque = (25 + écart) × multiplicateur, payée par chaque défenseur.</p>`;
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
    const live = g && ["bidding", "calling", "chien", "ecart", "chelem", "playing", "trick_done"].includes(g.phase);
    const blocks = [...donnes.entries()].sort((a, b) => b[0] - a[0]).map(([d, evs]) => {
      const lines = [];
      const bids = evs.filter((e) => e.type === "bid");
      if (bids.length) lines.push(`<li>🗣️ Enchères : ${bids.map((e) => `<b>${escape(e.playerName)}</b> ${escape(e.label)}`).join(" · ")}</li>`);
      for (const e of evs) {
        if (e.type === "call") lines.push(`<li>👑 <b>${escape(e.playerName)}</b> appelle le ${RANK_NAME[e.rank] || e.rank} ${SYM[e.suit]}</li>`);
        if (e.type === "chien_reveal") lines.push(`<li>🐶 Chien : ${miniRow(e.cards)}</li>`);
        if (e.type === "poignee") lines.push(`<li>✋ <b>${escape(e.playerName)}</b> : ${escape(e.name)} ${miniRow(e.cards)}</li>`);
        if (e.type === "misere") lines.push(`<li>😶 <b>${escape(e.playerName)}</b> : ${MISERE_NAME[e.kind]}</li>`);
        if (e.type === "chelem") lines.push(`<li>🎯 <b>${escape(e.playerName)}</b> annonce un chelem</li>`);
        if (e.type === "partner" && !e.alone) lines.push(`<li>🤝 <b>${escape(e.playerName)}</b> est le partenaire</li>`);
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
        const cards = t.plays.map((e) => `${escape(e.playerName)} <span class="hcard ${e.suit === "coeur" || e.suit === "carreau" ? "red" : ""}">${shortName(e)}</span>${e.cut ? " ✂️" : ""}`).join(", ");
        lines.push(`<li>✋ <b>Pli ${num}</b>${t.winner ? ` pour <b>${escape(t.winner)}</b>` : " (en cours)"} : ${cards}</li>`);
      }
      const end = evs.find((e) => e.type === "round_end");
      if (end) lines.push(`<li>🏁 ${end.made ? "Contrat réussi" : "Contrat chuté"} : ${fmtPts(end.points)} points pour ${end.needed}</li>`);
      const note = live && d === g.donne ? `<p class="hist-note">👀 Donne en cours : seul le dernier pli est visible.</p>` : "";
      return `<h4 class="hist-round">Donne ${d}</h4>${note}<ul>${lines.join("")}</ul>`;
    });
    return blocks.join("");
  },

  // Reglages du salon
  renderLobbyOptions(el, room, isHost, app) {
    const o = Object.assign({ firstBid: "prise", gardeSans: true, gardeContre: true, petitAuBout: true, poignee: true, chelem: true, misere: false, donnes: 0 }, (room.options && room.options.tarot) || {});
    const key = JSON.stringify([o, isHost]);
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    const dis = isHost ? "" : "disabled";
    const seg = (name, values, label) => `<div class="opt-row wide"><span>${label}</span><div class="opt-seg">${values.map(([val, text]) => `<button data-k="${name}" data-v="${val}" class="${String(o[name]) === String(val) ? "on" : ""}" ${dis}>${text}</button>`).join("")}</div></div>`;
    const tog = (name, text) => `<button data-t="${name}" class="${o[name] ? "on" : ""}" ${dis}>${o[name] ? "✔ " : ""}${text}</button>`;
    el.innerHTML = seg("firstBid", [["prise", "Prise"], ["petite", "Petite"]], "Première enchère")
      + `<div class="opt-row wide"><span>Enchères fortes</span><div class="opt-seg">${tog("gardeSans", "Garde sans")}${tog("gardeContre", "Garde contre")}</div></div>`
      + `<div class="opt-row wide"><span>Primes</span><div class="opt-seg">${tog("petitAuBout", "Petit au bout")}${tog("poignee", "Poignée")}${tog("chelem", "Chelem")}${tog("misere", "Misère")}</div></div>`
      + seg("donnes", [[0, "Libre"], [5, "5 donnes"], [10, "10"], [20, "20"]], "Durée")
      + `<div class="opt-seq">3 à 5 joueurs (à 5, le preneur appelle un Roi). Comptage officiel FFT.${o.donnes ? "" : " Le patron arrête la partie quand il veut."}</div>`;
    if (!isHost) return;
    const send = (next) => {
      app.sfx.play("select");
      app.emit("room:setOptions", { options: next });
    };
    el.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => {
      const v = b.dataset.v;
      send({ ...o, [b.dataset.k]: /^\d+$/.test(v) ? Number(v) : v });
    }));
    el.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => send({ ...o, [b.dataset.t]: !o[b.dataset.t] })));
  },

  rulesHtml() {
    return `
      <p class="rule"><i>🃏</i><span>78 cartes : quatre couleurs de 14 cartes (du 1 au 10, Valet, <b>Cavalier</b>, Dame, Roi), <b>21 atouts</b> et l'<b>Excuse</b>. Les trois <b>bouts</b> sont le Petit (atout 1), le 21 et l'Excuse. De 3 à 5 joueurs ; le reste forme le <b>chien</b> (6 cartes, 3 à cinq joueurs).</span></p>
      <p class="rule"><i>🗣️</i><span><b>Enchères</b>, un seul tour de parole : Prise (ou Petite) ×1, Garde ×2, Garde sans le chien ×4, Garde contre le chien ×6 (les deux dernières peuvent être désactivées dans le salon). Il faut monter ou passer. Si tout le monde passe, on redistribue.</span></p>
      <p class="rule"><i>👑</i><span>À cinq joueurs, le preneur <b>appelle un Roi</b> : celui qui l'a devient son partenaire secret, révélé quand le Roi tombe. Si le Roi est dans le chien ou dans sa main, le preneur joue seul.</span></p>
      <p class="rule"><i>🐶</i><span>Prise et Garde : le chien est montré à tous, le preneur le prend et fait son <b>écart</b> (ni Roi ni bout ; pas d'atout, sauf s'il n'a pas le choix : ils sont alors montrés). Garde sans : le chien va au preneur sans être vu. Garde contre : il va à la défense.</span></p>
      <p class="rule"><i>👉</i><span>Il faut <b>fournir</b> la couleur demandée ; sinon <b>couper</b> avec un atout ; à l'atout, il faut toujours <b>monter</b> si on peut. Sans la couleur ni atout, on joue ce qu'on veut. L'<b>Excuse</b> se joue à tout moment, ne gagne jamais le pli et reste à son camp (qui donne une demi-carte en échange) ; jouée au dernier pli, elle change de camp.</span></p>
      <p class="rule"><i>✋</i><span><b>Annonces</b> juste avant de jouer ta première carte : <b>poignée</b> (10 / 13 / 15 atouts à quatre joueurs ; 13 / 15 / 18 à trois ; 8 / 10 / 13 à cinq), primes de 20 / 30 / 40 pour le camp gagnant ; <b>misère</b> (règle maison) : main sans atout ni Excuse, ou sans tête (ni Valet, Cavalier, Dame ou Roi), 10 points par adversaire. Le preneur peut annoncer un <b>chelem</b> avant de jouer.</span></p>
      <p class="rule"><i>🧮</i><span><b>Comptage</b> : bouts et Rois 4,5 ; Dames 3,5 ; Cavaliers 2,5 ; Valets 1,5 ; autres cartes 0,5 (91 points en tout). Il faut <b>56 / 51 / 41 / 36</b> points avec 0 / 1 / 2 / 3 bouts. Marque = (25 + écart + petit au bout 10) × multiplicateur, + poignée, + chelem (+400 annoncé, +200 non annoncé, −200 raté). Chaque défenseur paie cette marque au preneur (à cinq : le preneur en reçoit deux, le partenaire une).</span></p>
      <p class="rule"><i>🎯</i><span>Le <b>Petit au bout</b> : si le Petit est joué au dernier pli, le camp qui remporte ce pli gagne 10 points × le multiplicateur. Une donne où un joueur a le Petit sec (seul atout, sans l'Excuse) est annulée.</span></p>`;
  }
};
