// Adaptateur client du President : pli face visible au centre, defausse dans
// le plateau en bois, echange de cartes, roles et scores entre les manches.
import { RANK_NAMES } from "../cards/cardArt.js";

const $ = (id) => document.getElementById(id);
const ORDER = ["3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R", "A", "2"];
const STRENGTH = Object.fromEntries(ORDER.map((r, i) => [r, i]));
const ROLE_EMOJI = { president: "👑", vice: "🎖️", neutre: "🙂", vicetrou: "🥄", trou: "🕳️" };
const ROLE_SHORT = { president: "Président", vice: "Vice-président", neutre: "Neutre", vicetrou: "Vice-trou", trou: "Trou du cul" };

function plural(rank) {
  return RANK_NAMES[rank] ? RANK_NAMES[rank][1] : rank;
}
function single(rank) {
  return RANK_NAMES[rank] ? RANK_NAMES[rank][0] : rank;
}
function de(rank) {
  const p = plural(rank);
  return /^[AEIOUÉ]/i.test(p) ? `d'${p}` : `de ${p}`;
}

// "Un 8", "Une Dame", "Paire de Rois", "Brelan d'As", "Carré de 7"
export function comboText(count, rank) {
  if (count === 1) return `${rank === "D" ? "Une" : "Un"} ${single(rank)}`;
  const word = ["", "", "Paire", "Brelan", "Carré"][count] || `${count} ×`;
  return `${word} ${de(rank)}`;
}

function countWord(n) {
  return ["", "une carte", "une paire", "un brelan", "un carré"][n] || `${n} cartes`;
}

export default {
  id: "president",
  name: "Le Président",
  emoji: "👑",
  tagline: "Deviens Président… ou finis Trou du cul.",
  players: "3 à 8 joueurs",
  maxSelect: 4,
  pendingFaceUp: true,
  defaultSorted: true,
  rankOrder: ORDER,

  dealKey: (v) => `${v.uid}-${v.round}`,
  isFreshDeal(v) {
    for (let i = v.history.length - 1; i >= 0; i -= 1) {
      const e = v.history[i];
      if (e.type === "play" || e.type === "pass") return false;
      if (e.type === "round_start" || e.type === "exchange_auto") return true;
    }
    return true;
  },

  desired(v, handOrder) {
    const byId = new Map(v.hand.map((c) => [c.id, c]));
    const me = handOrder.map((id) => byId.get(id)).filter(Boolean);
    const opp = new Map(v.opponents.map((o) => [o.id, o.cardCount]));
    const table = [];
    v.trick.forEach((play, p) => play.cards.forEach((card, j) => table.push({ card, play: p, j, size: play.cards.length, owner: play.playerId })));
    return { me, opp, table, discard: v.discardCount };
  },

  turnBanner: (v) => (v.trick.length === 0 ? "À toi d'ouvrir !" : "À toi de jouer !"),
  isPlaying: (v) => v.phase === "playing",

  // Cartes de ma main qui completent un carre au sommet du pli.
  magicCards(v) {
    if (v.phase !== "playing" || v.you.isFinished || !v.run || !v.run.rank || v.run.rank === "2") return null;
    const need = 4 - v.run.count;
    if (need < 2) return null; // un carre magique se ferme avec 2 ou 3 cartes
    const mine = v.hand.filter((c) => c.rank === v.run.rank);
    return mine.length === need ? mine : null;
  },

  legality(ids, v, app) {
    if (!v || app.S.dealing) return { ok: false, why: "" };
    if (v.phase !== "playing") return { ok: false, why: v.phase === "exchange" ? "Attends la fin de l'échange." : "" };
    if (v.you.isFinished) return { ok: false, why: "Tu as déjà fini cette manche." };
    const cards = ids.map((id) => v.hand.find((c) => c.id === id)).filter(Boolean);
    if (!cards.length || cards.length > 4) return { ok: false, why: "Pose 1 à 4 cartes." };
    const rank = cards[0].rank;
    if (!cards.every((c) => c.rank === rank)) return { ok: false, why: "Les cartes doivent avoir la même valeur." };
    if (cards.length === 1 && v.run && v.run.rank === rank && v.run.count >= 3) return { ok: false, why: "Un carré se ferme avec au moins 2 cartes : impossible de poser la 4e seule." };
    if (v.run && v.run.rank === rank && rank !== "2" && cards.length >= 2 && v.run.count + cards.length === 4) return { ok: true, magic: true };
    if (!v.you.isYourTurn) return { ok: false, why: `Pas si vite ! C'est au tour de ${v.currentTurnName}.` };
    if (v.you.passed) return { ok: false, why: "Tu as passé : attends le prochain pli." };
    if (v.top) {
      if (cards.length !== v.top.count) return { ok: false, why: `Il faut poser ${countWord(v.top.count)}.` };
      if (v.ouRien && rank !== v.ouRien) return { ok: false, why: `« ${single(v.ouRien)} ou rien » : pose ${single(v.ouRien) === "Dame" ? "une" : "un"} ${single(v.ouRien)} ou passe.` };
      if (STRENGTH[rank] < STRENGTH[v.top.rank]) return { ok: false, why: `Il faut au moins ${comboText(v.top.count, v.top.rank).toLowerCase()}.` };
    }
    return { ok: true };
  },

  canDrop(ids, v, app) {
    return this.legality(ids, v, app).ok;
  },

  commitPlay(ids, v, app) {
    if (v.phase === "exchange") return this.give(ids, v, app);
    const l = this.legality(ids, v, app);
    if (!l.ok) {
      if (l.why) app.hud.toast(l.why);
      app.sfx.play("error");
      return;
    }
    app.table.setPendingDrop(ids);
    app.emit("game:play", { cardIds: ids }, () => app.table.clearSelection(), () => app.table.clearPendingDrop());
  },

  give(ids, v, app) {
    const g = v.exchange && v.exchange.myGive;
    if (!g) return;
    if (ids.length !== g.count) {
      app.hud.toast(`Choisis exactement ${g.count} carte${g.count > 1 ? "s" : ""} à donner.`);
      return;
    }
    app.emit("game:give", { cardIds: ids }, () => app.table.clearSelection());
  },

  playButton(v, sel, app) {
    if (app.S.dealing) return { show: false };
    if (v.phase === "exchange" && v.exchange && v.exchange.myGive) {
      const g = v.exchange.myGive;
      return { show: sel.length === g.count, text: `Donner à ${g.toName}` };
    }
    if (!sel.length) return { show: false };
    const l = this.legality(sel, v, app);
    if (!l.ok) return { show: false };
    const cards = sel.map((id) => v.hand.find((c) => c.id === id));
    return { show: true, text: l.magic ? "✨ Carré magique !" : `Poser : ${comboText(cards.length, cards[0].rank)}` };
  },

  onEvent(ev, app) {
    const { hud, sfx } = app;
    const who = app.who;
    const me = app.S.me.id;
    switch (ev.type) {
      case "play": {
        let text = comboText(ev.count, ev.rank) + " !";
        if (ev.magic) {
          hud.bubble(who(ev.playerId), `✨ Carré magique !`, "gold");
          sfx.play("quad");
          app.shake();
        } else {
          if (ev.equal) text = `${comboText(ev.count, ev.rank)}… ${single(ev.rank)} ou rien !`;
          hud.bubble(who(ev.playerId), text);
        }
        break;
      }
      case "pass":
        hud.bubble(who(ev.playerId), "Je passe");
        break;
      case "trick_closed":
        if (ev.reason === "deux") {
          sfx.play("stamp");
          hud.bubble(who(ev.by), "Le 2 ferme ! 💥", "gold");
        } else if (ev.reason === "carre") {
          sfx.play("quad");
          hud.bubble(who(ev.by), "Carré ! Pli fermé", "gold");
        }
        break;
      case "finish":
        if (ev.onTwo) {
          hud.bubble(who(ev.playerId), "Fini sur un 2… 💀 Trou du cul !", "liar");
          sfx.play("bluff");
        } else {
          hud.bubble(who(ev.playerId), ev.place === 1 ? "Président ! 👑" : "Fini !", "gold");
          sfx.play(ev.place === 1 ? "win" : "truth");
        }
        break;
      case "round_start":
        if (ev.round === 1) hud.toast(`${ev.starterId === me ? "Tu as" : ev.starterName + " a"} la Dame de cœur : ${ev.starterId === me ? "à toi" : "à lui"} d'ouvrir !`, 3200);
        else hud.toast(`Manche ${ev.round} : ${ev.starterId === me ? "tu ouvres" : ev.starterName + " ouvre"} (Trou du cul).`, 3200);
        break;
      case "exchange_auto":
        if (ev.to === me) hud.toast(`🎁 ${ev.fromName} te donne ses ${ev.count > 1 ? `${ev.count} meilleures cartes` : "meilleure carte"}.`, 3200);
        else if (ev.from === me) hud.toast(`😬 Tu donnes ${ev.count > 1 ? `tes ${ev.count} meilleures cartes` : "ta meilleure carte"} à ${ev.toName}.`, 3200);
        break;
      case "exchange_give":
        if (ev.to === me) hud.toast(`${ev.fromName} te rend ${ev.count} carte${ev.count > 1 ? "s" : ""}.`);
        sfx.play("pickup", 2);
        break;
      default:
        break;
    }
  },

  refresh(v, app) {
    const { hud, S } = app;
    const you = v.you;
    const dealing = S.dealing;
    const myTurn = !dealing && v.phase === "playing" && you.isYourTurn;
    const roleOf = (id) => (v.roles ? v.roles[id] : null);

    // plaque
    if (dealing) {
      hud.setAnnounce({ label: `Manche ${v.round}`, value: "Distribution…", sub: "", rank: null, key: "deal" + v.round });
    } else if (v.phase === "exchange") {
      hud.setAnnounce({ label: `Manche ${v.round}`, value: "Échange des cartes", sub: "Président ↔ Trou du cul", rank: null, key: "ex" + v.round });
    } else if (v.phase === "round_end") {
      hud.setAnnounce({ label: `Manche ${v.round}`, value: "Terminée !", sub: "", rank: null, key: "end" + v.round });
    } else if (v.top) {
      hud.setAnnounce({
        label: "À battre",
        value: comboText(v.top.count, v.top.rank),
        sub: v.ouRien ? `${single(v.ouRien)} ou rien !` : `posé par ${v.top.playerId === S.me.id ? "toi" : v.top.playerName}`,
        rank: v.top.rank,
        key: "t" + v.lastEventId
      });
    } else {
      hud.setAnnounce({ label: "Pli libre", value: myTurn ? "À toi d'ouvrir !" : `${v.currentTurnName} ouvre…`, sub: `Manche ${v.round}`, rank: null, key: "free" + v.currentTurn + v.lastEventId });
    }

    // aide
    let hint = "";
    if (!dealing) {
      if (v.phase === "exchange") {
        hint = v.exchange && v.exchange.myGive
          ? `<b>Choisis ${v.exchange.myGive.count} carte${v.exchange.myGive.count > 1 ? "s" : ""}</b> à donner à ${v.exchange.myGive.toName}.`
          : "Échange des cartes en cours…";
      } else if (v.phase === "playing") {
        if (you.isFinished) hint = "Tu as fini la manche 🎉 Regarde les autres se battre.";
        else if (myTurn && !v.top) hint = "Ouvre le pli : <b>glisse 1 à 4 cartes de même valeur</b> sur le tapis.";
        else if (myTurn && v.ouRien) hint = `« <b>${single(v.ouRien)} ou rien</b> » : pose ${v.ouRien === "D" ? "une" : "un"} ${single(v.ouRien)}… ou passe.`;
        else if (myTurn) hint = `Pose <b>${countWord(v.top.count)}</b> de valeur ≥ ${single(v.top.rank)}… ou passe.`;
        else if (you.passed) hint = "Tu as passé : attends le prochain pli.";
        else hint = `Au tour de <b>${v.currentTurnName}</b>…`;
      }
    }
    hud.setHint(hint, myTurn || (v.phase === "exchange" && !!(v.exchange && v.exchange.myGive)));

    $("btn-liar").classList.add("hidden");
    $("btn-pass").classList.toggle("hidden", !(you.canPass && !dealing));

    // bandeau d'echange
    const ex = $("exchange");
    if (v.phase === "exchange" && !dealing && v.exchange) {
      ex.classList.remove("hidden");
      const my = v.exchange.myGive;
      $("exchange-title").textContent = my ? `${ROLE_EMOJI[you.role] || ""} Tu es ${ROLE_SHORT[you.role] || ""}` : "Échange des cartes";
      $("exchange-text").textContent = my
        ? `Touche ${my.count} carte${my.count > 1 ? "s" : ""} de ta main, puis « Donner à ${my.toName} ».`
        : v.exchange.waiting.map((w) => `${w.fromName} choisit ${w.count} carte${w.count > 1 ? "s" : ""} pour ${w.toName}…`).join(" ");
    } else {
      ex.classList.add("hidden");
    }

    // carre magique possible
    const magic = !dealing ? this.magicCards(v) : null;
    app.hud.setActionChips(magic ? [{
      key: "m" + magic.map((c) => c.id).join(""),
      label: `✨ Carré magique ! (${magic.length} × ${single(magic[0].rank)})`,
      onClick: () => {
        app.table.setPendingDrop(magic.map((c) => c.id));
        app.emit("game:play", { cardIds: magic.map((c) => c.id) }, () => app.table.clearSelection(), () => app.table.clearPendingDrop());
      }
    }] : []);

    // plaques
    const myRole = you.role;
    hud.setMyPlate(S.me.name, v.hand.length, you.isFinished ? "A fini la manche 🏁" : myRole ? `${ROLE_EMOJI[myRole]} ${ROLE_SHORT[myRole]} · ${v.hand.length} cartes` : null);
    hud.syncPlates(v.opponents.map((o) => {
      const role = roleOf(o.id);
      let status = "";
      if (o.finished) status = "🏁 a fini";
      else if (o.passed) status = "passe";
      else if (!o.connected) status = "hors ligne";
      else if (role && !(v.phase === "playing" && o.id === v.currentTurn)) status = `${ROLE_EMOJI[role]} ${ROLE_SHORT[role]}`;
      return {
        id: o.id,
        name: o.name,
        count: o.cardCount,
        connected: o.connected,
        finished: o.finished || o.passed,
        active: !dealing && v.phase === "playing" && o.id === v.currentTurn,
        statusText: status
      };
    }));

    this.updateRoundEnd(v, app);
  },

  updateRoundEnd(v, app) {
    const { S, hud } = app;
    if (v.phase !== "round_end" || !v.ranking) {
      if (S.roundEndShown && S.roundEndShown.startsWith(v.uid)) {
        S.roundEndShown = null;
        hud.hideEnd();
      }
      return;
    }
    const key = `${v.uid}-${v.round}`;
    if (S.roundEndShown === key) return;
    S.roundEndShown = key;
    setTimeout(() => {
      if (!S.game || S.game.phase !== "round_end" || `${S.game.uid}-${S.game.round}` !== key) return;
      const scores = new Map(v.scores.map((s) => [s.id, s.score]));
      const entries = v.ranking.map((r) => ({
        medal: ROLE_EMOJI[r.role],
        name: r.name,
        me: r.id === S.me.id,
        title: r.onTwo ? "Fini sur un 2 !" : ROLE_SHORT[r.role],
        sub: `${r.points > 0 ? "+" : ""}${r.points} pt · total ${scores.get(r.id)}`
      }));
      const isHost = S.room.hostId === S.me.id;
      const leader = v.scores.slice().sort((a, b) => b.score - a.score)[0];
      hud.showEnd({
        key,
        title: `Fin de la manche ${v.round}`,
        entries,
        primary: isHost ? { label: "▶ Manche suivante", onClick: () => app.emit("game:nextRound", {}) } : null,
        secondary: isHost ? { label: "🎲 Changer de jeu", onClick: () => app.emit("room:playAgain", {}) } : null,
        wait: isHost ? `En tête : ${leader.name} (${leader.score} pts)` : `En tête : ${leader.name} (${leader.score} pts). Le patron lance la manche suivante…`,
        onLeave: app.leaveTable
      });
    }, 1400);
  },

  hideOverlays() {
    $("exchange").classList.add("hidden");
  },

  chips(v) {
    const n = v.trick.reduce((s, p) => s + p.cards.length, 0);
    return {
      pile: v.phase === "playing" && n ? `Pli : <b>${n}</b> carte${n > 1 ? "s" : ""}` : "",
      tray: v.discardCount ? `🗑️ Défausse · ${v.discardCount}` : ""
    };
  },

  trayTitle: "La défausse",
  trayHtml: (v) => `<p>${v.discardCount} carte${v.discardCount > 1 ? "s" : ""} déjà jouée${v.discardCount > 1 ? "s" : ""} cette manche.</p>
    <p>Les plis ramassés finissent ici, face cachée.</p>`,

  historyHtml(history, esc) {
    if (!history.length) return "<p>Rien ne s'est encore passé.</p>";
    const items = history.slice().reverse().map((e) => {
      switch (e.type) {
        case "play": return `<li><b>${esc(e.playerName)}</b> pose ${comboText(e.count, e.rank).toLowerCase()}${e.magic ? " ✨ carré magique" : e.equal ? ` (${single(e.rank)} ou rien)` : ""}</li>`;
        case "pass": return `<li><b>${esc(e.playerName)}</b> passe</li>`;
        case "trick_closed": return `<li>🧹 Pli ramassé${e.reason === "deux" ? " (le 2 ferme)" : e.reason.startsWith("carre") ? " (carré)" : ""} — ${esc(e.byName || "")} rejoue</li>`;
        case "finish": return `<li>🏁 <b>${esc(e.playerName)}</b> ${e.onTwo ? "finit sur un 2… trou du cul !" : "a fini"}</li>`;
        case "round_start": return `<li>🃏 Manche ${e.round} : <b>${esc(e.starterName || "")}</b> ouvre</li>`;
        case "exchange_auto": return `<li>🎁 <b>${esc(e.fromName)}</b> donne ses ${e.count} meilleure${e.count > 1 ? "s" : ""} carte${e.count > 1 ? "s" : ""} à <b>${esc(e.toName)}</b></li>`;
        case "exchange_give": return `<li>↩️ <b>${esc(e.fromName)}</b> rend ${e.count} carte${e.count > 1 ? "s" : ""} à <b>${esc(e.toName)}</b></li>`;
        case "round_end": return `<li>🏆 Fin de la manche ${e.round}</li>`;
        default: return "";
      }
    });
    return `<ul>${items.join("")}</ul>`;
  },

  rulesHtml() {
    return `
      <p class="rule"><i>🃏</i><span>Tout le paquet est distribué. Ordre des valeurs : <b>3 &lt; 4 &lt; … &lt; Roi &lt; As &lt; 2</b>.</span></p>
      <p class="rule"><i>👸</i><span>Première manche : celui qui a la <b>Dame de cœur</b> ouvre. Ensuite, c'est le Trou du cul.</span></p>
      <p class="rule"><i>⬆️</i><span>On pose 1 à 4 cartes de même valeur. Pour suivre : <b>le même nombre</b>, de valeur égale ou supérieure. Sinon on passe… et on est hors du pli jusqu'à ce qu'il soit ramassé.</span></p>
      <p class="rule"><i>🎯</i><span><b>« Ou rien »</b> : si tu poses la même valeur que le joueur d'avant, le suivant doit poser cette valeur ou passer.</span></p>
      <p class="rule"><i>💥</i><span>Un <b>2</b> ferme le pli : tu rejoues ce que tu veux. Mais <b>interdit de finir sur un 2</b> : sinon tu finis Trou du cul !</span></p>
      <p class="rule"><i>✨</i><span><b>Carré magique</b> : si tu as 2 ou 3 cartes qui complètent un carré au sommet du pli, pose-les, même hors de ton tour. Le pli est fermé et tu rejoues.</span></p>
      <p class="rule"><i>✋</i><span><b>Jamais la 4e seule</b> : un carré se ferme toujours avec au moins 2 cartes. Si 3 cartes identiques sont au sommet, personne ne peut poser la 4e toute seule, même à son tour.</span></p>
      <p class="rule"><i>🔄</i><span>Nouvelle manche : le Trou du cul donne ses 2 meilleures cartes au Président qui lui en rend 2 au choix (1 carte entre Vice-trou et Vice-président).</span></p>
      <p class="rule"><i>📊</i><span>Points : Président +2, Vice +1, Neutre 0, Vice-trou −1, Trou du cul −2.</span></p>`;
  }
};
