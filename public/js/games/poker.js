// Adaptateur client du poker Texas Hold'em : cartes communes au centre,
// barre d'actions (se coucher / parole / suivre / relancer / tapis), tapis de
// jetons sur les etiquettes, abattage avec les meilleures cartes en lumiere.

const $ = (id) => document.getElementById(id);
const STREET = { preflop: "Pré-flop", flop: "Flop", turn: "Turn", river: "River" };
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f"); // espace insecable fine
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
    const me = v.you.inHand ? handOrder.map((id) => byId.get(id)).filter(Boolean) : [];
    const best = new Set(Object.values((v.results && v.results.best) || {}).flat());
    const opp = new Map();
    const shown = [];
    let folded = 0;
    for (const s of v.seats) {
      if (s.inHand && s.folded) folded += 2;
      if (s.id === myId) continue;
      if (s.cards) {
        s.cards.forEach((c, j) => shown.push({ card: c, owner: s.id, j, win: best.has(c.id) }));
        opp.set(s.id, 0);
      } else opp.set(s.id, s.cardCount);
    }
    const board = v.board.map((c) => ({ card: c, win: best.has(c.id) }));
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
        sfx.play("flip");
        break;
      case "win":
        hud.bubble(who(ev.playerId), `+${fmt(ev.amount)} 🪙`, "gold");
        sfx.play(ev.playerId === me ? "win" : "truth");
        break;
      case "showdown":
        for (const w of ev.winners) hud.bubble(who(w.id), `+${fmt(w.amount)} · ${w.handName}`, "gold");
        sfx.play(ev.winners.some((w) => w.id === me) ? "win" : "quad");
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
      if (you.folded) hint = "Tu t'es couché : attends la main suivante.";
      else if (myTurn) hint = `${mine}${mine ? " · " : ""}${you.legal.toCall ? `<b>${fmt(you.legal.toCall)}</b> à suivre` : "tu peux faire parole"}`;
      else if (you.inHand) hint = `${mine}${mine ? " · " : ""}<b>${esc(v.currentTurnName)}</b> réfléchit…`;
      else hint = `<b>${esc(v.currentTurnName)}</b> réfléchit…`;
    }
    hud.setHint(hint, myTurn);

    this.renderBar(v, app, myTurn);

    $("btn-liar").classList.add("hidden");
    $("btn-pass").classList.add("hidden");
    const chips = [];
    if (you.canRebuy) chips.push({ key: "rebuy", label: `💰 Me recaver (${fmt(v.options.startStack)})`, onClick: () => app.emit("game:rebuy", {}) });
    if (S.room.hostId === S.me.id && v.options.rebuy && v.phase !== "finished" && v.phase !== "betting") {
      chips.push({ key: "end", label: "🏁 Arrêter la partie", onClick: () => app.emit("game:endGame", {}) });
    }
    hud.setActionChips(chips);

    // etiquettes
    const status = (s) => {
      const d = s.isDealer ? "🔘 " : "";
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
      `🪙 ${fmt(you.stack)}${you.bet ? ` · mise ${fmt(you.bet)}` : ""}${meSeat && meSeat.isDealer ? " · 🔘 donneur" : ""}`,
      `🪙 ${fmt(you.stack)}${you.bet ? ` · ${fmt(you.bet)}` : ""}`
    );
    hud.syncPlates(v.opponents.map((o) => ({
      id: o.id,
      name: o.name,
      count: fmt(o.stack),
      countIcon: "chips",
      connected: o.connected,
      finished: o.folded || o.eliminated || !o.inHand,
      active: !dealing && v.phase === "betting" && o.id === v.currentTurn,
      statusText: !o.connected ? "hors ligne" : status(o) + (o.handName ? ` · ${o.handName}` : "")
    })));

    this.updateEnd(v, app);
  },

  // Barre d'actions : se coucher / parole / suivre / relancer / tapis.
  renderBar(v, app, myTurn) {
    const bar = $("action-bar");
    if (!myTurn || !v.you.legal) {
      bar.classList.add("hidden");
      bar.dataset.key = "";
      this.raiseOpen = false;
      return;
    }
    const L = v.you.legal;
    const key = `${v.uid}-${v.handNumber}-${v.street}-${v.currentBet}-${v.you.bet}-${this.raiseOpen ? 1 : 0}`;
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
      <div class="act-row">
        <button class="act fold" data-act="fold">Se coucher</button>
        ${L.canCheck ? `<button class="act check" data-act="check">Parole</button>` : `<button class="act call" data-act="call">Suivre ${fmt(L.toCall)}</button>`}
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

  hideOverlays() {
    const bar = $("action-bar");
    bar.classList.add("hidden");
    bar.dataset.key = "";
  },

  chips(v) {
    return {
      pile: v.pot && v.phase === "betting" ? `Pot : <b>${fmt(v.pot)}</b>` : "",
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
        case "street": return `<li>🂠 ${STREET[e.street]}</li>`;
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
      <p class="rule"><i>🗣️</i><span>Avant chaque étape, un tour de paroles : <b>se coucher</b>, <b>parole</b> (si personne n'a misé), <b>suivre</b>, <b>relancer</b> (au moins autant que la dernière relance) ou faire <b>tapis</b>.</span></p>
      <p class="rule"><i>🏆</i><span>À l'abattage, chacun forme la <b>meilleure main de cinq cartes</b> avec ses deux cartes et les cinq du centre. Du plus faible au plus fort : hauteur, paire, double paire, brelan, quinte, couleur, full, carré, quinte flush.</span></p>
      <p class="rule"><i>⚖️</i><span>Un joueur à tapis ne peut gagner que ce qu'il a misé face à chacun : le reste forme un <b>pot annexe</b>. En cas d'égalité, le pot est partagé.</span></p>
      <p class="rule"><i>💸</i><span>Plus de jetons ? Selon le réglage du salon, tu es <b>éliminé</b> (le dernier joueur avec des jetons gagne) ou tu peux <b>te recaver</b> (le patron arrête alors la partie quand il veut).</span></p>`;
  }
};
