// Adaptateur client du Pouilleux : les paires sortent toutes seules dans le
// plateau ; a son tour, on touche une des cartes tendues par son voisin.
import { RANK_NAMES } from "../cards/cardArt.js";
import { miniCardUrl } from "../ui/hud.js";

const $ = (id) => document.getElementById(id);
const SYM = { pique: "♠", coeur: "♥", carreau: "♦", trefle: "♣" };
const POUILLEUX = { rank: "V", suit: "pique" };
const cardName = (c) => `${RANK_NAMES[c.rank] ? RANK_NAMES[c.rank][0] : c.rank} ${SYM[c.suit]}`;
const plural = (rank) => (RANK_NAMES[rank] ? RANK_NAMES[rank][1] : rank);
const de = (rank) => (/^[AEIOU]/i.test(plural(rank)) ? `d'${plural(rank)}` : `de ${plural(rank)}`);

export default {
  id: "pouilleux",
  name: "Le Pouilleux",
  emoji: "🐀",
  tagline: "Faites des paires… et refilez le valet de pique !",
  players: "2 à 8 joueurs",
  minPlayers: 2,
  maxSelect: 1,
  pendingFaceUp: true,
  defaultSorted: true,
  rankOrder: ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R"],

  dealKey: (v) => v.uid,
  isFreshDeal: (v) => v.history.every((e) => e.type === "deal" || e.type === "pair" || e.type === "safe"),

  desired(v, handOrder, app) {
    const byId = new Map(v.hand.map((c) => [c.id, c]));
    const me = handOrder.map((id) => byId.get(id)).filter(Boolean);
    const opp = new Map(v.opponents.map((o) => [o.id, o.cardCount]));
    const tray = [];
    v.pairs.forEach((p, qi) => p.cards.forEach((c, j) => tray.push({ card: c, quad: qi, j, owner: p.playerId })));
    // le valet de trefle retire du jeu reste dans la boite, face cachee
    const out = { me, opp, tray, talon: 1 };
    const dealing = app && app.S.dealing;
    // a mon tour, le voisin me tend ses cartes
    if (!dealing && v.you.isYourTurn && v.you.victimId && v.phase === "playing") {
      out.pick = v.victimCount;
      out.pickOwner = v.you.victimId;
      opp.set(v.you.victimId, 0);
    }
    return out;
  },

  turnBanner: () => "À toi de tirer !",
  isPlaying: (v) => v.phase === "playing",
  showRing: () => false,

  legality: () => ({ ok: false, why: "Touche une carte de ton voisin pour la tirer." }),
  canDrop: () => false,
  commitPlay(ids, v, app) {
    app.hud.toast(v.you.isYourTurn ? `Touche une des cartes de ${v.victimName} pour la tirer.` : "Tes paires sortent toutes seules : attends ton tour.");
  },
  playButton: () => ({ show: false }),

  onPick(slot, v, app) {
    if (!v.you.isYourTurn || app.S.dealing) return;
    app.table.setPickable(false);
    app.sfx.play("flick");
    app.emit("game:draw", { index: slot }, null, () => app.table.setPickable(true));
  },

  onEvent(ev, app) {
    const { hud, sfx, S } = app;
    const who = app.who;
    const me = S.me.id;
    switch (ev.type) {
      case "draw": {
        const g = S.game;
        const d = g && g.lastDraw;
        if (ev.playerId !== me) hud.bubble(who(ev.playerId), ev.from === me ? "Je pioche chez toi !" : `Je pioche chez ${ev.fromName}`);
        if (d && d.card && d.seq === ev.id) {
          if (ev.from === me) {
            hud.toast(d.pouilleux ? `😅 ${ev.playerName} t'a pris le Pouilleux !` : `${ev.playerName} t'a pris ton ${cardName(d.card)}.`, 2600);
          } else if (ev.playerId === me) {
            hud.toast(d.pouilleux ? "🐀 Aïe… tu as tiré le Pouilleux !" : `Tu tires le ${cardName(d.card)}.`, 2400);
            if (d.pouilleux) {
              sfx.play("bluff");
              app.shake();
            }
          }
        }
        break;
      }
      case "pair":
        if (ev.reason === "draw") {
          hud.bubble(who(ev.playerId), `Paire ${de(ev.rank)} !`, "gold");
          sfx.play("quad");
        }
        break;
      case "safe":
        hud.bubble(who(ev.playerId), "Tiré d'affaire ! 🎉", "gold");
        sfx.play(ev.playerId === me ? "win" : "truth");
        break;
      case "shuffle":
        if (ev.playerId !== me) hud.bubble(who(ev.playerId), "Je mélange… 🔀");
        break;
      default:
        break;
    }
  },

  refresh(v, app) {
    const { hud, S, table } = app;
    const you = v.you;
    const dealing = S.dealing;
    const myTurn = !dealing && you.isYourTurn;
    const left = v.hand.length + v.opponents.reduce((t, o) => t + o.cardCount, 0);

    if (dealing) {
      hud.setAnnounce({ label: "Le Pouilleux", value: "Distribution…", sub: "", img: miniCardUrl(POUILLEUX), key: "deal" });
    } else if (v.phase === "finished") {
      hud.setAnnounce({ label: "Partie terminée", value: `${v.loserId === S.me.id ? "Tu es" : v.loserName + " est"} le Pouilleux !`, sub: "", img: miniCardUrl(POUILLEUX), key: "end" });
    } else {
      hud.setAnnounce({
        label: "Évite le valet de pique",
        value: myTurn ? "À toi de tirer !" : `${v.currentTurnName} tire…`,
        sub: `${v.pairs.length} paire${v.pairs.length > 1 ? "s" : ""} sortie${v.pairs.length > 1 ? "s" : ""} · ${left} cartes en jeu`,
        img: miniCardUrl(POUILLEUX),
        key: "t" + v.currentTurn
      });
    }

    let hint = "";
    if (!dealing && v.phase !== "finished") {
      if (you.isFinished) hint = "Tu n'as plus de cartes : tu es tiré d'affaire 🎉";
      else if (myTurn) hint = `Touche une des cartes de <b>${v.victimName}</b> pour la tirer.`;
      else if (v.phase === "pairing") hint = "";
      else hint = `<b>${v.currentTurnName}</b> tire une carte chez <b>${v.victimName}</b>…`;
    }
    hud.setHint(hint, myTurn);
    table.setPickable(myTurn && v.phase === "playing");

    $("btn-liar").classList.add("hidden");
    $("btn-pass").classList.add("hidden");
    // melanger sa main : pour cacher ou l'on a range le valet de pique
    hud.setActionChips(!dealing && !myTurn && !you.isFinished && v.phase !== "finished" && v.hand.length > 1 ? [{
      key: "shuffle",
      label: "🔀 Mélanger ma main",
      onClick: () => app.emit("game:shuffle", {}, () => app.sfx.play("pickup", 3))
    }] : []);

    const hasP = v.hand.some((c) => c.rank === "V" && c.suit === "pique");
    hud.setMyPlate(S.me.name, v.hand.length, you.isFinished ? "Tiré d'affaire 🎉" : hasP ? `${v.hand.length} cartes · 🐀 tu as le Pouilleux !` : null, you.isFinished ? "🎉 sauvé" : hasP ? `🃏 ${v.hand.length} · 🐀` : `🃏 ${v.hand.length}`);
    hud.syncPlates(v.opponents.map((o) => ({
      id: o.id,
      name: o.name,
      count: o.cardCount,
      connected: o.connected,
      finished: o.safe,
      active: !dealing && v.phase !== "finished" && o.id === v.currentTurn,
      statusText: o.safe ? "🎉 tiré d'affaire" : !o.connected ? "hors ligne" : o.id === v.victimId && v.phase === "playing" ? "tend ses cartes" : ""
    })));
    this.updateEnd(v, app);
  },

  updateEnd(v, app) {
    const { S } = app;
    if (v.phase !== "finished") return;
    if (S.endShownFor === v.uid) return;
    S.endShownFor = v.uid;
    setTimeout(() => {
      if (!S.game || S.game.uid !== v.uid) return;
      const n = v.ranking.length;
      const entries = v.ranking.map((r, i) => ({
        medal: r.loser ? "🐀" : i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`,
        name: r.name,
        me: r.id === S.me.id,
        title: r.loser ? "Le Pouilleux !" : i === 0 ? "Premier sorti" : "Tiré d'affaire"
      }));
      if (v.loserId === S.me.id) app.sfx.play("bluff");
      else app.sfx.play("win");
      const isHost = S.room.hostId === S.me.id;
      app.hud.showEnd({
        key: "end-" + v.uid,
        title: n ? "Fin de la partie" : "Partie terminée",
        entries,
        primary: isHost ? { label: "🔁 Revanche !", onClick: () => app.emit("room:rematch", {}) } : null,
        secondary: isHost ? { label: "🎲 Changer de jeu", onClick: () => app.emit("room:playAgain", {}) } : null,
        wait: isHost ? "" : "Le patron peut lancer la revanche…",
        onLeave: app.leaveTable
      });
    }, 1400);
  },

  hideOverlays(app) {
    if (app && app.table) app.table.setPickable(false);
  },

  chips(v) {
    return { pile: "", tray: v.pairs.length ? `🗃️ ${v.pairs.length} paire${v.pairs.length > 1 ? "s" : ""}` : "" };
  },

  trayTitle: "Les paires sorties",
  trayHtml(v) {
    if (!v.pairs.length) return "<p>Aucune paire sortie pour l'instant.</p>";
    const names = new Map(v.opponents.map((o) => [o.id, o.name]));
    const by = new Map();
    for (const p of v.pairs) {
      const key = p.playerId;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(p);
    }
    const rows = [...by.entries()].map(([id, list]) => `<li><b>${id === v.you.id ? "Toi" : (names.get(id) || "?").replace(/[<>&]/g, "")}</b> : ${list.map((p) => p.cards.map(cardName).join(" + ")).join(" · ")}</li>`);
    return `<ul>${rows.join("")}</ul><p class="score-seq">Le valet de trèfle a été retiré du paquet : le valet de pique ne peut jamais faire de paire.</p>`;
  },

  historyHtml(history, esc) {
    if (!history.length) return "<p>Rien ne s'est encore passé.</p>";
    const items = history.slice().reverse().map((e) => {
      switch (e.type) {
        case "draw": return `<li><b>${esc(e.playerName)}</b> tire une carte chez <b>${esc(e.fromName)}</b></li>`;
        case "pair": return `<li>✨ <b>${esc(e.playerName)}</b> sort une paire ${de(e.rank)} (${e.color === "rouge" ? "rouges" : "noirs"})</li>`;
        case "safe": return `<li>🎉 <b>${esc(e.playerName)}</b> est tiré d'affaire</li>`;
        case "shuffle": return `<li>🔀 <b>${esc(e.playerName)}</b> mélange sa main</li>`;
        case "end": return `<li>🐀 <b>${esc(e.playerName || "")}</b> est le Pouilleux</li>`;
        case "deal": return "<li>🃏 Distribution (les paires sortent toutes seules)</li>";
        default: return "";
      }
    });
    return `<ul>${items.join("")}</ul>`;
  },

  rulesHtml() {
    return `
      <p class="rule"><i>🃏</i><span>On retire le <b>valet de trèfle</b> du paquet : le <b>valet de pique</b> reste seul, c'est le Pouilleux. Toutes les cartes sont distribuées.</span></p>
      <p class="rule"><i>✨</i><span>Une <b>paire</b> est formée de deux cartes de même valeur <b>et de même couleur</b> (deux 7 rouges, deux Rois noirs…). Les paires sortent automatiquement du jeu.</span></p>
      <p class="rule"><i>👉</i><span>À ton tour, tu <b>tires une carte au hasard</b> dans le jeu de ton voisin de gauche. Si elle forme une paire avec une de tes cartes, la paire sort. C'est ensuite à ce voisin de tirer.</span></p>
      <p class="rule"><i>🔀</i><span>Tu peux <b>mélanger ta main</b> à tout moment, pour que personne ne devine où se cache le valet de pique.</span></p>
      <p class="rule"><i>🎉</i><span>Dès que tu n'as plus de cartes, tu es <b>tiré d'affaire</b>.</span></p>
      <p class="rule"><i>🐀</i><span>Le dernier joueur à garder une carte, le valet de pique, est <b>le Pouilleux</b> !</span></p>`;
  }
};
