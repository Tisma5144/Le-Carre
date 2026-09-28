// Adaptateur client du Menteur : traduit l'etat serveur en zones de cartes 3D
// et en interface (annonce, aide, boutons, revelation, fin de partie).
import { claimText, rankPlural } from "../ui/hud.js";

const $ = (id) => document.getElementById(id);

export default {
  id: "menteur",
  name: "Le Menteur",
  emoji: "🎭",
  tagline: "Pose face cachée, annonce… et bluffe.",
  players: "3 à 8 joueurs",
  artCard: null,
  maxSelect: 3,
  pendingFaceUp: false,
  defaultSorted: false,
  rankOrder: ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R"],

  dealKey: (v) => v.uid,
  isFreshDeal: (v) => v.history.every((e) => e.type === "quad_discard"),

  desired(v, handOrder) {
    const byId = new Map(v.hand.map((c) => [c.id, c]));
    const me = handOrder.map((id) => byId.get(id)).filter(Boolean);
    const reveal = v.phase === "reveal_pending" && v.pendingReveal ? v.pendingReveal.cards : [];
    const opp = new Map(v.opponents.map((o) => [o.id, o.cardCount]));
    const tray = [];
    v.removedQuads.forEach((q, qi) => q.cards.forEach((c, j) => tray.push({ card: c, quad: qi, j, owner: q.playerId })));
    return { me, reveal, opp, pile: Math.max(0, v.pileCount - reveal.length), tray };
  },

  turnBanner: (v) => (v.lastPlay === null ? "À toi d'ouvrir !" : "À toi de jouer !"),
  isPlaying: (v) => v.phase === "playing",

  onEvent(ev, app) {
    const who = app.who;
    if (ev.type === "play") {
      app.hud.bubble(who(ev.playerId), claimText(ev.count, ev.claimedRank));
    } else if (ev.type === "quad_discard") {
      app.hud.bubble(who(ev.playerId), `Carré de ${rankPlural(ev.rank)} !`, "gold");
      app.sfx.play("quad");
    } else if (ev.type === "accuse") {
      // la table ne tremble qu'une fois pendant la revelation : au tampon
      app.hud.bubble(who(ev.accuserId), "MENTEUR !", "liar");
      app.sfx.play("liar");
    } else if (ev.type === "pickup") {
      app.hud.bubble(who(ev.playerId), ev.count >= 10 ? `Aïe… ${ev.count} cartes` : "Je ramasse…");
    }
  },

  refresh(v, app) {
    const { hud, S } = app;
    const you = v.you;
    const dealing = S.dealing;
    const myTurn = !dealing && v.phase === "playing" && you.isYourTurn;

    // plaque d'annonce
    if (dealing) {
      hud.setAnnounce({ label: "Le patron distribue", value: "Les cartes…", sub: "", rank: null, key: "deal" });
    } else if (v.phase === "finished") {
      hud.setAnnounce({ label: "C'est fini", value: "Partie terminée", sub: "", rank: null, key: "end" });
    } else if (v.phase === "reveal_pending") {
      hud.setAnnounce({ label: "Révélation", value: `Des ${rankPlural(v.pendingReveal.claimedRank)} ?`, sub: `${v.pileCount} cartes en jeu`, rank: v.pendingReveal.claimedRank, key: "rev" + v.lastEventId });
    } else if (v.roundLeaderRank) {
      hud.setAnnounce({
        label: "On annonce des",
        value: rankPlural(v.roundLeaderRank),
        sub: `${v.pileCount} carte${v.pileCount > 1 ? "s" : ""} sur le tapis`,
        rank: v.roundLeaderRank,
        key: "r" + v.roundLeaderRank + "-" + v.history.filter((e) => e.type === "pickup").length
      });
    } else {
      hud.setAnnounce({ label: "Nouvelle manche", value: myTurn ? "À toi d'annoncer !" : `${v.currentTurnName} choisit…`, sub: "Tapis vide", rank: null, key: "new" + v.currentTurn + v.lastEventId });
    }

    // aide
    let hint = "";
    if (dealing) hint = "";
    else if (you.isFinished && v.phase !== "finished") hint = "Tu as vidé ta main 🎉 Admire le spectacle, une bière à la main.";
    else if (v.phase === "playing") {
      if (myTurn) {
        if (v.lastPlay === null) hint = "Nouvelle manche : <b>glisse 1 à 3 cartes</b> sur le tapis, puis annonce leur valeur.";
        else if (you.canAccuseNow) hint = `Pose 1 à 3 <b>${rankPlural(v.roundLeaderRank)}</b>… ou crie <b>MENTEUR</b> si tu doutes de ${v.lastPlay.playerName} !`;
        else hint = `Glisse 1 à 3 <b>${rankPlural(v.roundLeaderRank)}</b> sur le tapis (vrais ou pas…).`;
      } else {
        hint = `Au tour de <b>${v.currentTurnName}</b>…`;
      }
    }
    hud.setHint(hint, myTurn);

    $("btn-liar").classList.toggle("hidden", !(v.phase === "playing" && you.canAccuseNow && !dealing));
    $("btn-pass").classList.add("hidden");

    // les carres sortent automatiquement (plus de bouton)
    hud.setActionChips([]);

    // plaques
    const finishedIdx = new Map(v.finishedOrder.map((f, i) => [f.id, i]));
    hud.setMyPlate(S.me.name, v.hand.length, you.isFinished ? `Terminé · ${finishedIdx.get(S.me.id) + 1}ᵉ` : null, you.isFinished ? `🏁 ${finishedIdx.get(S.me.id) + 1}ᵉ` : `🃏 ${v.hand.length}`);
    hud.syncPlates(v.opponents.map((o) => ({
      id: o.id,
      name: o.name,
      count: o.cardCount,
      connected: o.connected,
      finished: o.finished,
      active: !dealing && v.phase === "playing" && o.id === v.currentTurn,
      statusText: o.finished ? `🏁 ${finishedIdx.get(o.id) + 1}ᵉ` : !o.connected ? "hors ligne" : ""
    })));

    this.updateReveal(v, app);
    this.updateEnd(v, app);
  },

  playButton(v, sel, app) {
    const myTurn = v.phase === "playing" && v.you.isYourTurn && !app.S.dealing;
    const show = myTurn && sel.length >= 1 && sel.length <= 3;
    return { show, text: `Poser ${sel.length} carte${sel.length > 1 ? "s" : ""}` };
  },

  canDrop(ids, v, app) {
    return !!v && v.phase === "playing" && v.you.isYourTurn && !app.S.dealing && ids.length >= 1 && ids.length <= 3;
  },

  commitPlay(ids, v, app) {
    if (!this.canDrop(ids, v, app)) {
      if (!v.you.isYourTurn) app.hud.toast(`Pas si vite ! C'est au tour de ${v.currentTurnName}.`);
      else if (ids.length > 3) app.hud.toast("3 cartes maximum par pose.");
      app.sfx.play("error");
      return;
    }
    app.table.setPendingDrop(ids);
    const send = (declaredRank) => app.emit("game:play", { cardIds: ids, declaredRank }, () => app.table.clearSelection(), () => app.table.clearPendingDrop());
    if (v.lastPlay === null) app.hud.openRankPicker((rank) => send(rank), () => app.table.clearPendingDrop());
    else send(undefined);
  },

  updateReveal(v, app) {
    const { S, table, hud, sfx } = app;
    if (v.phase === "reveal_pending" && v.pendingReveal && !S.dealing) {
      const r = v.pendingReveal;
      const key = `${v.uid}-${v.lastEventId}`;
      document.body.classList.add("revealing");
      const me = S.me.id;
      const loserIsMe = r.loserId === me;
      const top = `${r.accuserId === me ? "Tu cries" : r.accuserName + " crie"} MENTEUR sur ${r.accusedId === me ? "toi" : r.accusedName} !`;
      const verdict = r.mismatch
        ? `${r.accusedId === me ? "Tu bluffais" : r.accusedName + " bluffait"} !`
        : `${r.accusedId === me ? "Tu disais" : r.accusedName + " disait"} la vérité…`;
      const who = loserIsMe ? "Tu ramasses" : `${r.loserName} ramasse`;
      const pileWords = r.pileCount > 1 ? `les ${r.pileCount} cartes` : "la carte";
      // les textes du verdict sont en place des le debut (caches jusqu'au
      // tampon) pour que rien ne bouge quand ils apparaissent
      const show = (withText) => hud.showReveal({
        top,
        text: `${verdict} ${who} ${pileWords}.`,
        canPickup: v.you.canPickupNow,
        pickupLabel: `🫳 Ramasser ${pileWords}`,
        wait: !loserIsMe ? `En attente que ${r.loserName} ramasse…` : "",
        pending: !withText
      });
      if (S.revealKey !== key) {
        S.revealKey = key;
        table.setRevealClaim(null);
        show(false);
        S.stampPending = {
          key,
          t0: performance.now(),
          fire: () => {
            table.setRevealClaim(r.claimedRank);
            hud.stamp(r.mismatch);
            sfx.play("stamp");
            setTimeout(() => sfx.play(r.mismatch ? "bluff" : "truth"), 180);
            app.shake();
            show(true);
          }
        };
      } else if (table.revealClaim) {
        show(true);
      }
    } else {
      this.hideOverlays(app);
    }
  },

  hideOverlays(app) {
    if (app.S.revealKey) {
      app.S.revealKey = null;
      app.table.setRevealClaim(null);
    }
    app.table.setRevealBand(null);
    app.hud.placeStamp(null);
    document.body.classList.remove("revealing");
    app.hud.hideReveal();
  },

  // le tampon tombe quand les cartes sont retournees devant tout le monde
  frame(app) {
    const { S, table } = app;
    if (S.revealKey) this.placeReveal(app);
    const sp = S.stampPending;
    if (!sp) return;
    if (sp.key !== S.revealKey) {
      S.stampPending = null;
      return;
    }
    if (performance.now() - sp.t0 > 700 && table.isSettled("reveal")) {
      if (!sp.landedAt) sp.landedAt = performance.now();
      if (performance.now() - sp.landedAt > 350) {
        S.stampPending = null;
        sp.fire();
      }
    }
  },

  // Cartes retournees et tampon dans la bande libre entre les etiquettes des
  // joueurs et les textes du bas : rien ne recouvre les noms ni les textes.
  placeReveal(app) {
    const H = window.innerHeight;
    const texts = document.querySelector("#reveal .reveal-bottom").getBoundingClientRect();
    const bottom = texts.height ? texts.top - 10 : H * 0.7;
    let top = $("announce").getBoundingClientRect().bottom + 8;
    for (const el of app.hud.plates.values()) {
      if (el.style.opacity === "0") continue;
      const r = el.getBoundingClientRect();
      if (r.height && r.bottom < bottom - H * 0.2) top = Math.max(top, r.bottom + 8);
    }
    // bande trop etroite (beaucoup de joueurs) : on empiete sur les etiquettes
    if (bottom - top < H * 0.2) top = bottom - H * 0.2;
    app.table.setRevealBand({ top, bottom });
    app.hud.placeStamp((top + bottom) / 2);
  },

  updateEnd(v, app) {
    const { S } = app;
    if (v.phase !== "finished") return;
    if (S.endShownFor === v.uid) return;
    S.endShownFor = v.uid;
    setTimeout(() => {
      if (!S.game || S.game.uid !== v.uid) return;
      const n = v.finishedOrder.length;
      const entries = v.finishedOrder.map((f, i) => ({
        medal: i === 0 ? "🥇" : i === 1 && n > 2 ? "🥈" : i === 2 && n > 3 ? "🥉" : i === n - 1 ? "🍺" : `${i + 1}`,
        name: f.name,
        me: f.id === S.me.id,
        title: i === 0 ? "Maître du bluff" : i === n - 1 ? "Paie sa tournée !" : "S'en sort bien"
      }));
      if (v.finishedOrder[0] && v.finishedOrder[0].id === S.me.id) app.sfx.play("win");
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

  chips(v) {
    const n = v.pileCount;
    const q = v.removedQuads.length;
    return {
      pile: v.phase !== "reveal_pending" && n ? `<b>${n}</b> carte${n > 1 ? "s" : ""} sur le tapis` : "",
      tray: v.phase !== "reveal_pending" && q ? `✨ ${q} carré${q > 1 ? "s" : ""} sorti${q > 1 ? "s" : ""}` : ""
    };
  },

  trayTitle: "Cartes sorties",
  trayHtml: (v, hud) => hud.quadsHtml(v.removedQuads),

  historyHtml(history, esc) {
    if (!history.length) return "<p>Rien ne s'est encore passé… le silence avant la tempête.</p>";
    const items = history.slice().reverse().map((e) => {
      switch (e.type) {
        case "play": return `<li><b>${esc(e.playerName)}</b> pose ${e.count} carte${e.count > 1 ? "s" : ""} : « ${claimText(e.count, e.claimedRank)} »</li>`;
        case "quad_discard": return `<li>✨ <b>${esc(e.playerName)}</b> sort le carré de ${rankPlural(e.rank)}</li>`;
        case "accuse": return `<li>🚨 <b>${esc(e.accuserName)}</b> crie MENTEUR sur <b>${esc(e.accusedName)}</b> → ${e.mismatch ? `${esc(e.accusedName)} bluffait !` : "c'était vrai !"}</li>`;
        case "pickup": return `<li>🫳 <b>${esc(e.playerName)}</b> ramasse ${e.count} carte${e.count > 1 ? "s" : ""}</li>`;
        default: return "";
      }
    });
    return `<ul>${items.join("")}</ul>`;
  },

  rulesHtml() {
    return `
      <p class="rule"><i>🃏</i><span>Tout le paquet est distribué entre les joueurs. Objectif : être le premier à <b>vider sa main</b>.</span></p>
      <p class="rule"><i>🗣️</i><span>Le joueur qui ouvre la manche pose 1 à 3 cartes face cachée et <b>annonce leur valeur</b>, par exemple « Deux Rois ! ».</span></p>
      <p class="rule"><i>🔁</i><span>Chacun son tour, dans le sens des aiguilles d'une montre, pose ensuite 1 à 3 cartes en annonçant <b>la même valeur</b>. Rien n'oblige à dire la vérité…</span></p>
      <p class="rule"><i>🚨</i><span>Avant de jouer, tu peux crier <b>« Menteur ! »</b> sur la pose du joueur précédent. Ses cartes sont retournées : s'il a bluffé, il ramasse tout le tapis ; s'il a dit vrai, c'est toi qui ramasses.</span></p>
      <p class="rule"><i>➡️</i><span>Le joueur assis après celui qui a ramassé ouvre la manche suivante, avec la valeur de son choix.</span></p>
      <p class="rule"><i>✨</i><span>Dès qu'un joueur a les quatre cartes d'une même valeur, ce <b>carré</b> sort automatiquement du jeu, à la distribution comme après un ramassage. Cela ne compte pas comme un tour.</span></p>
      <p class="rule"><i>🏁</i><span>Tu as vidé ta main ? La victoire n'est acquise que si ta dernière pose n'est pas contestée, ou si elle était sincère.</span></p>
      <p class="rule"><i>🍺</i><span>Le dernier joueur à avoir encore des cartes paie sa tournée.</span></p>
`;
  }
};
