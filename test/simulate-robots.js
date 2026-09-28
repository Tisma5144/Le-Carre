// Parties jouees uniquement par des robots, pour chaque jeu : on verifie que
// les robots ne restent jamais bloques et que les parties se terminent.
// Usage : node test/simulate-robots.js

const assert = require("assert");
const { botActions } = require("../server/bots");
const GAMES = {
  menteur: require("../server/games/menteur"),
  president: require("../server/games/president"),
  ascenseur: require("../server/games/ascenseur"),
  pouilleux: require("../server/games/pouilleux"),
  poker: require("../server/games/poker"),
  tarot: require("../server/games/tarot")
};

const stats = {};
for (const [type, game] of Object.entries(GAMES)) {
  stats[type] = { games: 0, actions: 0, accuses: 0, magic: 0, nextHands: 0 };
  for (let g = 0; g < 30; g += 1) {
    const n = type === "tarot" ? 3 + (g % 3) : 3 + (g % 6);
    const ids = Array.from({ length: n }, (_, i) => "bot" + i);
    const opts = type === "ascenseur" ? { maxCards: 1 + (g % 6), mode: "up-down", step: 1 } : type === "poker" ? { startStack: 500, blindEvery: 5, rebuy: false } : undefined;
    const state = game.createGame(ids, opts);
    const level = ["facile", "normal", "fort"][g % 3]; // les trois niveaux de robots
    let rounds = 0;
    let safety = 0;
    while (safety < 20000) {
      safety += 1;
      if (state.phase === "finished") break;
      if (state.phase === "round_end") {
        rounds += 1;
        if ((type === "president" || type === "tarot") && rounds >= 3) break;
        assert.ok(game.applyAction(state, ids[0], { type: "next_round" }, { isHost: true }).ok);
        continue;
      }
      if (state.phase === "trick_done" || state.phase === "pairing" || state.phase === "runout" || state.phase === "chien" || (state.phase === "showdown" && !state.nextDealerId)) {
        assert.ok(game.tick(state).ok);
        continue;
      }
      let acted = false;
      for (const id of state.seatOrder) {
        const actions = botActions(type, state, id, level);
        for (const a of actions) {
          const r = game.applyAction(state, id, a, { isHost: false });
          if (r.ok) {
            acted = true;
            stats[type].actions += 1;
            if (a.type === "accuse") stats[type].accuses += 1;
            if (a.type === "next_hand") stats[type].nextHands += 1;
            if (type === "president" && a.type === "play" && state.history.some((e) => e.type === "play" && e.magic && !e.counted && (e.counted = true))) stats[type].magic += 1;
            break;
          }
        }
        if (acted) break;
      }
      assert.ok(acted, `${type} : aucun robot ne peut jouer (phase ${state.phase})`);
    }
    assert.ok(safety < 20000, `${type} : la partie doit se terminer`);
    stats[type].games += 1;
  }
}
console.log("SUCCES Robots :", JSON.stringify(stats));
