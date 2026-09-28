// Adaptateur client du poker Texas Hold'em : cartes communes au centre,
// barre d'actions (se coucher / check / suivre / relancer / tapis), tapis de
// jetons sur les etiquettes, abattage avec les meilleures cartes en lumiere.

import { createCardFaceCanvas } from "../cards/cardArt.js";
import { ChipLayer } from "../scene/chips.js";

const $ = (id) => document.getElementById(id);
const STREET = { preflop: "Pré-flop", flop: "Flop", turn: "Turn", river: "River" };
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f"); // espace insecable fine
// Quand je montre mes cartes : elles s'envolent de ma main vers la table,
// grandes et face visible, pour que je voie ce que les autres voient.
function showMyCardsFx(cards) {
  if (!cards || !cards.length) return;
  document.querySelectorAll(".show-cards-fx").forEach((n) => n.remove());
  const el = document.createElement("div");
  el.className = "show-cards-fx";
  el.innerHTML = `<div class="scf-cards">${cards.map((c, i) => `<img src="${createCardFaceCanvas(c, 0.7).toDataURL()}" alt="" style="--i:${i}" />`).join("")}</div><div class="scf-label">👀 Tu montres tes cartes à la table</div>`;
  document.body.appendChild(el);
  el.addEventListener("animationend", (ev) => { if (ev.target === el) el.remove(); });
  setTimeout(() => el.remove(), 4000);
}

// Eclair lumineux quand une carte tombe pendant un tapis.
function flashScreen(kind) {
  const el = document.createElement("div");
  el.className = "suspense-flash" + (kind ? " " + kind : "");
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
  setTimeout(() => el.remove(), 2000);
}
const esc = (t) => String(t == null ? "" : t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

export default {
  id: "poker",
  name: "Poker Texas Hold'em",
  emoji: "🪙",
  tagline: "Deux cartes, cinq au milieu… et du bluff.",
  players: "2 à 8 joueurs",
  minPlayers: 2,
  maxSelect: 1,
  pendingFaceUp: true,
  defaultSorted: false,
  hideSort: true,
  rankOrder: ["2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R", "A"],

  dealKey: (v) => `${v.uid}-${v.handNumber}`,
  isFreshDeal(v) {
    return !v.history.some((e) => e.hand === v.handNumber && (e.type === "bet" || e.type === "street" || e.type === "win" || e.type === "showdown"));
  },

  desired(v, handOrder, app) {
    const S = app && app.S;
    const myId = S ? S.me.id : v.you.id;
    const byId = new Map(v.hand.map((c) => [c.id, c]));
    // apres s'etre couche, on garde ses cartes sous les yeux (assombries)
    const me = handOrder.map((id) => byId.get(id)).filter(Boolean);
    const best = new Set(Object.values((v.results && v.results.best) || {}).flat());
    const opp = new Map();
    const shown = [];
    let folded = 0;
    for (const s of v.seats) {
      if (s.id === myId) continue;
      if (s.inHand && s.folded) folded += 2;
      if (s.cards) {
        s.cards.forEach((c, j) => shown.push({ card: c, owner: s.id, j, win: best.has(c.id) }));
        opp.set(s.id, 0);
      } else opp.set(s.id, s.cardCount);
    }
    const board = v.board.map((c) => ({ card: c, win: best.has(c.id) }))
      .concat((v.ghostBoard || []).map((c) => ({ card: c, ghost: true })));
    let used = me.length + shown.length + board.length + folded;
    for (const n of opp.values()) used += n;
    const talon = Math.max(0, 52 - used);
    if (app) app.table.trickSize = 2;
    return { me, opp, shown, board, discard: folded, talon };
  },

  turnBanner: () => "À toi de parler !",
  isPlaying: (v) => v.phase === "betting",
  showRing: () => false,

  legality: () => ({ ok: false, why: "" }),
  canDrop: () => false,
  commitPlay(ids, v, app) {
    if (v.you.isYourTurn) app.hud.toast("Utilise les boutons en bas pour parler.");
  },
  playButton: () => ({ show: false }),

  onEvent(ev, app) {
    const { hud, sfx, S } = app;
    const who = app.who;
    const me = S.me.id;
    switch (ev.type) {
      case "hand_start":
        if (ev.level > 0 && S.game && S.game.options.blindEvery && (ev.hand - 1) % S.game.options.blindEvery === 0) {
          hud.toast(`📈 Les blindes montent : ${ev.sb} / ${ev.bb}`, 3000);
        }
        break;
      case "bet":
        hud.bubble(who(ev.playerId), ev.kind === "fold" ? "Je me couche" : ev.label, ev.kind === "allin" || /Tapis/.test(ev.label) ? "liar" : "");
        if (ev.kind === "raise" || ev.kind === "allin") sfx.play("stamp");
        else if (ev.kind === "call") sfx.play("pickup", 2);
        else if (ev.kind === "fold") sfx.play("flick");
        break;
      case "street":
        if (ev.runout) {
          // tapis : chaque carte tombe comme un coup de tambour
          sfx.play("stamp");
          sfx.play("flip");
          flashScreen(ev.street === "river" ? "big" : "");
        } else sfx.play("flip");
        break;
      case "allin_reveal":
        hud.showTurnBanner("⚡ TAPIS ! ⚡", "allin");
        sfx.play("allin");
        flashScreen("big");
        break;
      case "win":
        hud.bubble(who(ev.playerId), `+${fmt(ev.amount)} 🪙`, "gold");
        hud.showTurnBanner(ev.playerId === me ? "🏆 Tu gagnes !" : `🏆 ${ev.playerName} gagne`, "gold");
        sfx.play(ev.playerId === me ? "win" : "truth");
        break;
      case "showdown": {
        for (const w of ev.winners) hud.bubble(who(w.id), `+${fmt(w.amount)} · ${w.handName}`, "gold");
        const names = [...new Set(ev.winners.map((w) => w.id))];
        const nm = (id) => (id === me ? "Toi" : app.playerName ? app.playerName(id) : "");
        hud.showTurnBanner(names.length > 1 ? `🏆 ${names.map(nm).join(" & ")}` : names[0] === me ? "🏆 Tu gagnes !" : `🏆 ${nm(names[0])} gagne`, "gold");
        sfx.play(ev.winners.some((w) => w.id === me) ? "win" : "quad");
        break;
      }
      case "show_cards":
        hud.bubble(who(ev.playerId), "Regardez ! 👀", "");
        if (ev.playerId === me && S.game) {
          showMyCardsFx(S.game.hand);
          sfx.play("truth");
        }
        sfx.play("flip");
        break;
      case "reveal_board":
        sfx.play("flip");
        break;
      case "eliminated":
        hud.toast(`💀 ${ev.playerId === me ? "Tu es éliminé" : ev.playerName + " est éliminé"} (${ev.place}ᵉ).`, 3200);
        break;
      case "busted":
        if (ev.playerId === me) hud.toast("Plus de jetons… tu peux te recaver 💰", 3200);
        break;
      case "rebuy":
        hud.bubble(who(ev.playerId), "Je me recave ! 💰", "gold");
        break;
      default:
        break;
    }
  },

  refresh(v, app) {
    const { hud, S } = app;
    const you = v.you;
    const dealing = S.dealing;
    const myTurn = !dealing && you.isYourTurn;
    const lvl = v.nextLevelIn ? ` · ×2 dans ${v.nextLevelIn} main${v.nextLevelIn > 1 ? "s" : ""}` : "";

    // plaque
    if (v.phase === "finished") {
      hud.setAnnounce({ label: "Poker", value: "Partie terminée", sub: "", key: "end" });
    } else if (v.phase === "waiting") {
      hud.setAnnounce({ label: "Poker", value: "En attente d'une recave", sub: "Il faut au moins deux joueurs avec des jetons", key: "wait" });
    } else if (v.phase === "runout") {
      hud.setAnnounce({ label: `Main ${v.handNumber} · tapis !`, value: v.board.length >= 5 ? "Et le gagnant est…" : v.board.length ? STREET[v.street] : "Cartes sur table", sub: `Pot : ${fmt(v.pot)}`, key: "ro" + v.handNumber + v.board.length });
    } else if (v.phase === "showdown" && v.results) {
      const ws = v.results.winners;
      const meWin = ws.some((x) => x.id === S.me.id);
      const value = ws.length > 1
        ? `Partage : ${ws.map((x) => (x.id === S.me.id ? "toi" : x.name)).join(" et ")}`
        : meWin ? "Tu gagnes !" : `${ws[0].name} gagne`;
      hud.setAnnounce({ label: `Main ${v.handNumber}`, value, sub: v.results.byFold ? "Tout le monde s'est couché" : v.results.winners.map((x) => x.handName).filter(Boolean)[0] || "", key: "sd" + v.handNumber });
    } else {
      hud.setAnnounce({ label: `Main ${v.handNumber} · blindes ${fmt(v.sb)}/${fmt(v.bb)}`, value: dealing ? "Distribution…" : STREET[v.street], sub: `Pot : ${fmt(v.pot)}${lvl}`, key: "st" + v.handNumber + v.street });
    }

    // aide
    let hint = "";
    if (!dealing && v.phase === "betting") {
      const mine = you.handName ? `Tu as : <b>${esc(you.handName)}</b>` : "";
      if (you.folded) hint = `Tu t'es couché${you.handName ? ` (tu avais : <b>${esc(you.handName)}</b>)` : ""} : attends la main suivante.`;
      // a mon tour, la description de ma main est integree a la barre
      // d'actions (sinon les boutons la cachent)
      else if (myTurn) {
        this.myInfo = `${mine}${mine ? " · " : ""}${you.legal.toCall ? `<b>${fmt(you.legal.toCall)}</b> à suivre` : "tu peux checker"}`;
        hint = "";
      }
      else if (you.inHand) hint = `${mine}${mine ? " · " : ""}<b>${esc(v.currentTurnName)}</b> réfléchit…`;
      else hint = `<b>${esc(v.currentTurnName)}</b> réfléchit…`;
    }
    hud.setHint(hint, myTurn);

    // cartes gardees apres s'etre couche : assombries
    app.table.setDimmed(you.folded ? v.hand.map((c) => c.id) : []);

    if (!dealing && v.phase === "showdown" && v.results) this.renderResult(v, app);
    else if (!dealing && v.phase === "runout") this.renderRunout(v, app);
    else this.renderBar(v, app, myTurn);
    this.suspense(!dealing && v.phase === "runout", app);

    $("btn-liar").classList.add("hidden");
    $("btn-pass").classList.add("hidden");
    const chips = [];
    if (you.canRebuy) chips.push({ key: "rebuy", label: `💰 Me recaver (${fmt(v.options.startStack)})`, onClick: () => app.emit("game:rebuy", {}) });
    if (S.room.hostId === S.me.id && v.options.rebuy && v.phase !== "finished" && v.phase !== "betting") {
      chips.push({ key: "end", label: "🏁 Arrêter la partie", onClick: () => app.emit("game:endGame", {}) });
    }
    hud.setActionChips(chips);

    // etiquettes
    const wonBy = new Map();
    if (v.phase === "showdown" && v.results) for (const w of v.results.winners) wonBy.set(w.id, (wonBy.get(w.id) || 0) + w.amount);
    const status = (s) => {
      const d = s.isDealer ? "🔘 " : "";
      if (wonBy.has(s.id)) return `🏆 +${fmt(wonBy.get(s.id))}`;
      if (v.phase === "runout" && s.equity !== null && s.equity !== undefined) return `🔥 ${s.equity} %`;
      if (s.eliminated) return "💀 éliminé";
      if (s.busted && !s.inHand) return "💸 plus de jetons";
      if (!s.inHand) return `${d}attend`;
      if (s.folded) return `${d}couché`;
      if (s.lastAction) return d + s.lastAction;
      return d + (s.isSB ? "petite blinde" : s.isBB ? "grosse blinde" : "");
    };
    const meSeat = v.seats.find((s) => s.id === S.me.id);
    hud.setMyPlate(
      S.me.name,
      you.inHand ? 2 : 0,
      `🪙 ${fmt(you.stack)}${you.bet ? ` · mise ${fmt(you.bet)}` : ""}${meSeat && meSeat.isDealer ? " · 🔘 donneur" : ""}${you.hasShown ? " · 👀 cartes montrées" : ""}`,
      `🪙 ${fmt(you.stack)}${you.bet ? ` · ${fmt(you.bet)}` : ""}`
    );
    hud.syncPlates(v.opponents.map((o) => ({
      id: o.id,
      name: o.name,
      count: fmt(o.stack),
      countIcon: "chips",
      connected: o.connected,
      finished: o.folded || o.eliminated || !o.inHand,
      active: !dealing && ((v.phase === "betting" && o.id === v.currentTurn) || wonBy.has(o.id)),
      statusText: !o.connected ? "hors ligne" : status(o) + (o.handName ? ` · ${o.handName}` : "")
    })));

    this.syncChips(v, app);
    this.updateEnd(v, app);
  },

  // Jetons 3D : pile de mise devant chaque joueur, pot au centre. On compare
  // avec l'etat precedent pour animer : mise (du joueur vers sa pile), fin de
  // tour (les piles glissent au pot), gains (le pot part chez le gagnant).
  syncChips(v, app) {
    const { world, S } = app;
    if (!app.chips) app.chips = new ChipLayer(world);
    const C = app.chips;
    const me = S.me.id;
    const fr = world.feltRadius;
    const p = world.anchors.pile;
    const at = (x, z) => p.clone().set(p.x + x, 0.012, p.z + z);
    const potPos = at(0, fr.z * 0.62);
    // ou poser la mise d'un joueur (sur le tapis, jamais sur les cartes communes)
    const betPos = (id) => {
      if (id === me) return at(fr.x * 0.5, fr.z * 0.64);
      if (!S.seatPhi.has(id)) return null;
      const phi = S.seatPhi.get(id);
      // joueurs de cote : sous la rangee de cartes ; joueurs du haut :
      // resserres vers le milieu (hors des etiquettes des voisins)
      const side = Math.abs(Math.cos(phi)) < 0.45;
      const x = Math.sin(phi) * fr.x * (side ? 0.78 : 0.55);
      const z = side ? (Math.cos(phi) > -0.1 ? 0.95 : -0.8) : Math.cos(phi) * fr.z * 0.55;
      return at(x, z);
    };
    // d'ou partent les jetons d'un joueur (et ou arrivent ses gains)
    const seatPos = (id) => {
      if (id === me || !S.seatPhi.has(id)) return at(0, fr.z * 1.12);
      const phi = S.seatPhi.get(id);
      return at(Math.sin(phi) * fr.x * 1.05, Math.cos(phi) * fr.z * 1.05);
    };
    const hand = `${v.uid}-${v.handNumber}`;
    const bets = new Map(v.seats.filter((s) => s.bet > 0 && betPos(s.id)).map((s) => [s.id, s.bet]));
    let inBets = 0;
    for (const a of bets.values()) inBets += a;
    const center = Math.max(0, v.pot - inBets);
    const prev = this.chipPrev;
    const cur = { hand, street: v.street, bets, center, paid: false };
    this.chipPrev = cur;

    // gains : une seule fois par main
    if (v.phase === "showdown" && v.results) {
      cur.paid = true;
      if (prev && prev.hand === hand && !prev.paid) {
        const won = new Map();
        for (const w of v.results.winners) won.set(w.id, (won.get(w.id) || 0) + w.amount);
        C.payout([...won].map(([id, amount]) => ({ amount, pos: seatPos(id) })));
      } else if (!prev || prev.hand !== hand || prev.paid) C.clear();
      return;
    }
    if (v.phase === "finished" || v.phase === "waiting") {
      C.clear();
      return;
    }
    // premiere vue (arrivee en cours de main) : tout en place, sans animation
    if (!prev) {
      C.clear();
      for (const [id, a] of bets) C.setPile("bet:" + id, a, betPos(id));
      C.setPile("pot", center, potPos);
      return;
    }
    // nouvelle main : table vide, les blindes arrivent
    const fresh = prev.hand !== hand;
    if (fresh) C.clear();
    const before = fresh ? new Map() : prev.bets;
    // fin de tour : les mises partent au pot
    const gone = [...before.keys()].filter((id) => (bets.get(id) || 0) < before.get(id));
    if (gone.length) C.collect(gone.map((id) => "bet:" + id), "pot", center, potPos);
    else C.setPile("pot", center, potPos);
    for (const [id, a] of bets) {
      if (a > (gone.includes(id) ? 0 : before.get(id) || 0)) C.bet("bet:" + id, a, betPos(id), seatPos(id));
      else C.setPile("bet:" + id, a, betPos(id));
    }
  },

  // Fin de main : qui a gagne (en clair), montrer ses cartes, voir le
  // tableau qui serait tombe, et bouton du prochain donneur.
  renderResult(v, app) {
    const { S } = app;
    const bar = $("action-bar");
    const me = S.me.id;
    const r = v.results;
    const meSeat = v.seats.find((s) => s.id === me);
    const canShow = !!(meSeat && meSeat.inHand && !meSeat.cards && v.hand.length);
    const canGhost = v.board.length < 5 && !(v.ghostBoard && v.ghostBoard.length);
    const isHost = S.room.hostId === me;
    const isDealer = !!v.you.isNextDealer;
    // apres 30 s, tout le monde peut lancer la main suivante
    const rk = `${v.uid}-${v.handNumber}`;
    if (this.resultKey !== rk) {
      this.resultKey = rk;
      this.resultAt = Date.now();
      clearTimeout(this.lateTimer);
      this.lateTimer = setTimeout(() => { if (app.S.game && app.S.game.phase === "showdown") this.refresh(app.S.game, app); }, 30500);
    }
    const late = Date.now() - this.resultAt > 30000;
    const key = JSON.stringify(["res", v.uid, v.handNumber, canShow, canGhost, isDealer, isHost, v.nextDealerId, late]);
    bar.classList.remove("hidden");
    bar.classList.add("result");
    if (bar.dataset.key === key) return;
    bar.dataset.key = key;
    this.raiseOpen = false;
    // gains par joueur (pots annexes additionnes)
    const byId = new Map();
    for (const w of r.winners) {
      const cur = byId.get(w.id) || { id: w.id, name: w.name, amount: 0, handName: w.handName };
      cur.amount += w.amount;
      byId.set(w.id, cur);
    }
    const ws = [...byId.values()].sort((a, b) => b.amount - a.amount);
    const nm = (w) => (w.id === me ? "Toi" : esc(w.name));
    let head;
    if (ws.length === 1) {
      const w = ws[0];
      head = `<div class="pr-title">🏆 ${w.id === me ? "Tu remportes" : `<b>${esc(w.name)}</b> remporte`} <b>${fmt(w.amount)}</b> 🪙</div>
        <div class="pr-sub">${r.byFold ? "Tout le monde s'est couché" : `avec <b>${esc(w.handName)}</b>`}</div>`;
    } else {
      const split = ws.every((w) => w.handName === ws[0].handName);
      head = `<div class="pr-title">🏆 ${split ? "Pot partagé !" : "Plusieurs pots"}</div>`
        + ws.map((w) => `<div class="pr-line"><b>${nm(w)}</b> +${fmt(w.amount)} 🪙${w.handName ? ` <small>· ${esc(w.handName)}</small>` : ""}</div>`).join("");
    }
    const buttons = [];
    if (canShow) buttons.push(`<button class="act show" data-act="show">👁 Montrer mes cartes</button>`);
    if (canGhost) buttons.push(`<button class="act ghost" data-act="ghost">🔮 Voir la suite</button>`);
    if (isDealer) buttons.push(`<button class="act next" data-act="next">▶ Main suivante</button>`);
    let wait = "";
    if (!v.nextDealerId) wait = "Fin de la partie…";
    else if (isDealer) wait = "Tu es le prochain donneur : lance la main quand tout le monde a vu le résultat.";
    else wait = `<b>${esc(v.nextDealerName)}</b> (prochain donneur) lance la main suivante…${isHost || late ? ` <button class="pr-link" data-act="next">Lancer à sa place</button>` : ""}`;
    bar.innerHTML = `<div class="poker-result wood-panel">${head}</div>
      ${buttons.length ? `<div class="act-row">${buttons.join("")}</div>` : ""}
      <div class="pr-wait">${wait}</div>`;
    bar.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
      app.sfx.play("select");
      const act = b.dataset.act;
      if (act === "show") app.emit("game:showCards", {});
      else if (act === "ghost") app.emit("game:revealBoard", {});
      else if (act === "next") app.emit("game:nextHand", {});
    }));
  },

  // Tapis : mains retournees, cartes qui tombent au ralenti et chances de
  // chacun qui evoluent.
  renderRunout(v, app) {
    const { S } = app;
    const bar = $("action-bar");
    bar.classList.remove("hidden");
    bar.classList.add("result");
    const key = `ro-${v.uid}-${v.handNumber}`;
    if (bar.dataset.key !== key) {
      bar.dataset.key = key;
      bar.innerHTML = `<div class="allin-panel wood-panel"><div class="ap-title">⚡ Tapis ! Qui va l'emporter ?</div><div class="ap-rows"></div></div>`;
    }
    const box = bar.querySelector(".ap-rows");
    const rows = v.seats.filter((s) => s.equity !== null && s.equity !== undefined);
    for (const s of rows) {
      let el = box.querySelector(`[data-id="${s.id}"]`);
      if (!el) {
        el = document.createElement("div");
        el.className = "ap-row";
        el.dataset.id = s.id;
        el.innerHTML = `<span class="ap-name"></span><span class="ap-bar"><i></i></span><b class="ap-pct"></b>`;
        box.appendChild(el);
      }
      el.querySelector(".ap-name").innerHTML = `${s.id === S.me.id ? "Toi" : esc(s.name)}${s.handName ? ` <small>${esc(s.handName)}</small>` : ""}`;
      el.querySelector(".ap-bar i").style.width = `${Math.max(2, s.equity)}%`;
      el.querySelector(".ap-pct").textContent = `${s.equity} %`;
      el.classList.toggle("lead", s.equity >= 50);
      el.classList.toggle("dead", s.equity === 0);
      el.classList.toggle("me", s.id === S.me.id);
    }
  },

  // Ambiance "suspense" pendant un tapis : bords de l'ecran assombris et
  // battements de coeur.
  suspense(on, app) {
    document.body.classList.toggle("suspense", on);
    if (on && !this.hb) {
      app.sfx.play("heartbeat");
      this.hb = setInterval(() => app.sfx.play("heartbeat"), 900);
    } else if (!on && this.hb) {
      clearInterval(this.hb);
      this.hb = null;
    }
  },

  // Barre d'actions : se coucher / check / suivre / relancer / tapis.
  renderBar(v, app, myTurn) {
    const bar = $("action-bar");
    bar.classList.remove("result");
    if (!myTurn || !v.you.legal) {
      bar.classList.add("hidden");
      bar.dataset.key = "";
      this.raiseOpen = false;
      return;
    }
    const L = v.you.legal;
    const key = `${v.uid}-${v.handNumber}-${v.street}-${v.currentBet}-${v.you.bet}-${this.raiseOpen ? 1 : 0}-${this.myInfo}`;
    bar.classList.remove("hidden");
    if (bar.dataset.key === key) return;
    bar.dataset.key = key;
    const send = (kind, amount) => {
      bar.classList.add("hidden");
      this.raiseOpen = false;
      app.emit("game:bet", { kind, amount }, null, () => { bar.dataset.key = ""; this.refresh(app.S.game, app); });
    };
    const allInAmount = L.maxRaiseTo;
    const step = v.bb;
    if (this.raiseValue === undefined || this.raiseValue < L.minRaiseTo || this.raiseValue > L.maxRaiseTo) this.raiseValue = L.minRaiseTo;
    const potTo = Math.min(L.maxRaiseTo, Math.max(L.minRaiseTo, v.currentBet + L.toCall + v.pot));
    const halfTo = Math.min(L.maxRaiseTo, Math.max(L.minRaiseTo, v.currentBet + Math.round((v.pot / 2) / step) * step));
    const raiseLabel = v.currentBet === 0 ? "Miser" : "Relancer";
    bar.innerHTML = `
      ${this.raiseOpen && L.canRaise ? `<div class="raise-panel wood-panel">
        <div class="raise-top"><span>${raiseLabel} à</span><b id="raise-val">${fmt(this.raiseValue)}</b></div>
        <input id="raise-range" type="range" min="${L.minRaiseTo}" max="${L.maxRaiseTo}" step="${step}" value="${this.raiseValue}" />
        <div class="raise-presets">
          <button data-to="${L.minRaiseTo}">Min</button>
          <button data-to="${halfTo}">½ pot</button>
          <button data-to="${potTo}">Pot</button>
          <button data-to="${L.maxRaiseTo}">Tapis</button>
        </div>
        <button id="raise-ok" class="btn brass">✔ ${raiseLabel} à <span id="raise-ok-val">${fmt(this.raiseValue)}</span></button>
      </div>` : ""}
      ${this.myInfo ? `<div class="act-info">${this.myInfo}</div>` : ""}
      <div class="act-row">
        <button class="act fold" data-act="fold">Se coucher</button>
        ${L.canCheck ? `<button class="act check" data-act="check">Check</button>` : `<button class="act call" data-act="call">Suivre ${fmt(L.toCall)}</button>`}
        ${L.canRaise ? `<button class="act raise ${this.raiseOpen ? "on" : ""}" data-act="raise">${raiseLabel} ▴</button>` : ""}
        <button class="act allin" data-act="allin">Tapis ${fmt(allInAmount)}</button>
      </div>`;
    bar.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
      const act = b.dataset.act;
      app.sfx.play("select");
      if (act === "raise") {
        this.raiseOpen = !this.raiseOpen;
        bar.dataset.key = "";
        this.renderBar(app.S.game, app, true);
      } else send(act);
    }));
    const range = bar.querySelector("#raise-range");
    const setVal = (val) => {
      this.raiseValue = Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, Number(val)));
      bar.querySelector("#raise-val").textContent = fmt(this.raiseValue);
      bar.querySelector("#raise-ok-val").textContent = fmt(this.raiseValue);
      range.value = this.raiseValue;
    };
    if (range) {
      range.addEventListener("input", () => setVal(range.value));
      bar.querySelectorAll("[data-to]").forEach((b) => b.addEventListener("click", () => setVal(b.dataset.to)));
      bar.querySelector("#raise-ok").addEventListener("click", () => send(this.raiseValue >= L.maxRaiseTo ? "allin" : "raise", this.raiseValue));
    }
  },

  updateEnd(v, app) {
    const { S } = app;
    if (v.phase !== "finished") return;
    if (S.endShownFor === v.uid) return;
    S.endShownFor = v.uid;
    setTimeout(() => {
      if (!S.game || S.game.uid !== v.uid) return;
      const rebuy = v.options.rebuy;
      const entries = v.ranking.map((r, i) => ({
        medal: i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`,
        name: r.name,
        me: r.id === S.me.id,
        title: `${fmt(r.stack)} 🪙`,
        sub: rebuy ? `Bilan ${r.net >= 0 ? "+" : ""}${fmt(r.net)}${r.buyins > 1 ? ` · ${r.buyins - 1} recave${r.buyins > 2 ? "s" : ""}` : ""}` : i === 0 ? "Rafle tous les jetons !" : ""
      }));
      if (v.ranking[0] && v.ranking[0].id === S.me.id) app.sfx.play("win");
      const isHost = S.room.hostId === S.me.id;
      app.hud.showEnd({
        key: "end-" + v.uid,
        title: "Fin de la partie",
        entries,
        primary: isHost ? { label: "🔁 Revanche !", onClick: () => app.emit("room:rematch", {}) } : null,
        secondary: isHost ? { label: "🎲 Changer de jeu", onClick: () => app.emit("room:playAgain", {}) } : null,
        wait: isHost ? "" : "Le patron peut lancer la revanche…",
        onLeave: app.leaveTable
      });
    }, 1200);
  },

  hideOverlays(app) {
    if (app && app.chips) app.chips.clear();
    this.chipPrev = null;
    const bar = $("action-bar");
    bar.classList.add("hidden");
    bar.classList.remove("result");
    bar.dataset.key = "";
    document.body.classList.remove("suspense");
    if (this.hb) {
      clearInterval(this.hb);
      this.hb = null;
    }
  },

  chips(v) {
    return {
      pile: v.phase === "showdown" && v.ghostBoard && v.ghostBoard.length
        ? `🔮 <b>${v.ghostBoard.length}</b> carte${v.ghostBoard.length > 1 ? "s" : ""} qui seraient tombée${v.ghostBoard.length > 1 ? "s" : ""}`
        : v.pot && (v.phase === "betting" || v.phase === "runout") ? `Pot : <b>${fmt(v.pot)}</b>` : "",
      tray: "🪙 Jetons"
    };
  },

  trayTitle: "Les jetons",
  trayHtml(v) {
    const rows = v.ranking.map((r) => `<tr class="${r.id === v.you.id ? "me" : ""}"><td>${esc(r.name)}</td><td><b>${fmt(r.stack)}</b></td>${v.options.rebuy ? `<td class="${r.net >= 0 ? "ok" : "ko"}">${r.net >= 0 ? "+" : ""}${fmt(r.net)}</td><td>${r.buyins - 1}</td>` : ""}</tr>`).join("");
    return `<table class="score-table"><thead><tr><th>Joueur</th><th>Jetons</th>${v.options.rebuy ? "<th>Bilan</th><th>Recaves</th>" : ""}</tr></thead><tbody>${rows}</tbody></table>
      <p class="score-seq">Blindes : ${fmt(v.sb)} / ${fmt(v.bb)}${v.options.blindEvery ? `, doublées toutes les ${v.options.blindEvery} mains` : " (fixes)"}. Tapis de départ : ${fmt(v.options.startStack)}.</p>`;
  },

  historyHtml(history, escape) {
    if (!history.length) return "<p>Rien ne s'est encore passé.</p>";
    const items = history.slice().reverse().map((e) => {
      switch (e.type) {
        case "hand_start": return `<li>🃏 <b>Main ${e.hand}</b> — ${escape(e.dealerName || "")} donne, blindes ${fmt(e.sb)}/${fmt(e.bb)}</li>`;
        case "bet": return `<li><b>${escape(e.playerName)}</b> : ${escape(e.label)}</li>`;
        case "street": return `<li>🂠 ${STREET[e.street]}${e.runout ? " (tapis)" : ""}</li>`;
        case "allin_reveal": return `<li>⚡ <b>Tapis !</b> Les mains sont retournées</li>`;
        case "show_cards": return `<li>👀 <b>${escape(e.playerName)}</b> montre ses cartes</li>`;
        case "reveal_board": return `<li>🔮 <b>${escape(e.playerName)}</b> dévoile les cartes qui seraient tombées</li>`;
        case "win": return `<li>🏆 <b>${escape(e.playerName)}</b> remporte ${fmt(e.amount)} (tout le monde s'est couché)</li>`;
        case "showdown": return `<li>🏆 Abattage : ${e.winners.map((w) => `${fmt(w.amount)} pour un joueur avec ${escape(w.handName)}`).join(" · ")}</li>`;
        case "eliminated": return `<li>💀 <b>${escape(e.playerName)}</b> est éliminé</li>`;
        case "rebuy": return `<li>💰 <b>${escape(e.playerName)}</b> se recave</li>`;
        default: return "";
      }
    });
    return `<ul>${items.join("")}</ul>`;
  },

  // Reglages du salon
  renderLobbyOptions(el, room, isHost, app) {
    const o = Object.assign({ startStack: 1000, blindEvery: 10, rebuy: false }, (room.options && room.options.poker) || {});
    const key = JSON.stringify([o, isHost]);
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    const dis = isHost ? "" : "disabled";
    const seg = (name, values, label) => `<div class="opt-row wide"><span>${label}</span><div class="opt-seg">${values.map(([val, text]) => `<button data-k="${name}" data-v="${val}" class="${String(o[name]) === String(val) ? "on" : ""}" ${dis}>${text}</button>`).join("")}</div></div>`;
    const blind = Math.max(5, Math.round(o.startStack / 100));
    el.innerHTML = seg("startStack", [[500, "500"], [1000, "1 000"], [2000, "2 000"], [5000, "5 000"]], "Tapis de départ")
      + seg("blindEvery", [[5, "toutes les 5 mains"], [10, "toutes les 10"], [20, "toutes les 20"], [0, "jamais"]], "Blindes doublées")
      + seg("rebuy", [[false, "Éliminé"], [true, "Recave possible"]], "Plus de jetons")
      + `<div class="opt-seq">Blindes de départ : ${blind} / ${blind * 2}. ${o.rebuy ? "Le patron arrête la partie quand il veut." : "Dernier joueur avec des jetons = vainqueur."}</div>`;
    if (!isHost) return;
    el.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => {
      const next = { ...o };
      const v = b.dataset.v;
      next[b.dataset.k] = v === "true" ? true : v === "false" ? false : Number(v);
      app.sfx.play("select");
      app.emit("room:setOptions", { options: next });
    }));
  },

  rulesHtml() {
    return `
      <p class="rule"><i>🪙</i><span>Chacun commence avec le même <b>tapis de jetons</b>. À chaque main, les deux joueurs à gauche du donneur posent la <b>petite</b> et la <b>grosse blinde</b>, qui doublent régulièrement (réglable dans le salon).</span></p>
      <p class="rule"><i>🃏</i><span>Chacun reçoit <b>deux cartes cachées</b>. Puis on retourne au centre trois cartes (<b>le flop</b>), une quatrième (<b>le turn</b>) et une cinquième (<b>la river</b>).</span></p>
      <p class="rule"><i>🗣️</i><span>Avant chaque étape, un tour de paroles : <b>se coucher</b>, <b>check</b> (passer sans miser, si personne n'a misé), <b>suivre</b>, <b>relancer</b> (au moins autant que la dernière relance) ou faire <b>tapis</b>.</span></p>
      <p class="rule"><i>🏆</i><span>À l'abattage, chacun forme la <b>meilleure main de cinq cartes</b> avec ses deux cartes et les cinq du centre. Du plus faible au plus fort : hauteur, paire, double paire, brelan, quinte, couleur, full, carré, quinte flush.</span></p>
      <p class="rule"><i>⚖️</i><span>Un joueur à tapis ne peut gagner que ce qu'il a misé face à chacun : le reste forme un <b>pot annexe</b>. En cas d'égalité, le pot est partagé.</span></p>
      <p class="rule"><i>⚡</i><span>Quand plusieurs joueurs sont <b>à tapis</b>, leurs mains sont retournées et les cartes tombent une à une, avec les <b>chances de gagner</b> de chacun.</span></p>
      <p class="rule"><i>▶</i><span>À la fin d'une main, le <b>prochain donneur</b> lance la suivante. En attendant, chacun peut <b>montrer ses cartes</b> ou <b>voir les cartes qui seraient tombées</b>.</span></p>
      <p class="rule"><i>💸</i><span>Plus de jetons ? Selon le réglage du salon, tu es <b>éliminé</b> (le dernier joueur avec des jetons gagne) ou tu peux <b>te recaver</b> (le patron arrête alors la partie quand il veut).</span></p>`;
  }
};
