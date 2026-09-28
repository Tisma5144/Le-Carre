// Simulation automatisee d'une partie complete de Menteur avec 4 bots.
// Sert a valider la logique serveur (distribution, tours, accusations,
// ramassage, classement final) sans avoir besoin d'un navigateur.
//
// Usage: node test/simulate-menteur.js

const { spawn } = require("child_process");
const path = require("path");
const { io } = require("socket.io-client");

const PORT = 4123;
const URL = `http://localhost:${PORT}`;
const BOT_NAMES = ["Alice", "Bob", "Chloe", "Dan"];
const MAX_ACTIONS = 2000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("Demarrage du serveur de test sur le port", PORT, "...");
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "index.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let serverReady = false;
  server.stdout.on("data", (chunk) => {
    if (chunk.toString().includes("en ecoute")) serverReady = true;
  });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  for (let i = 0; i < 50 && !serverReady; i += 1) await wait(100);
  if (!serverReady) {
    console.error("Le serveur n'a pas demarre a temps.");
    server.kill();
    process.exit(1);
  }
  console.log("Serveur pret.\n");

  let actionsCount = 0;
  let finished = false;
  let finalReport = null;
  const bots = [];

  function makeBot(name, index) {
    const bot = {
      name,
      index,
      socket: io(URL, { transports: ["websocket"] }),
      playerId: null,
      code: null,
      room: null,
      game: null,
      busy: false
    };

    bot.socket.on("connect_error", (err) => {
      console.error(`[${name}] erreur de connexion:`, err.message);
    });

    bot.socket.on("state", (payload) => {
      bot.room = payload.room;
      bot.game = payload.game;
      onState(bot);
    });

    return bot;
  }

  function log(msg) {
    console.log(msg);
  }

  function onState(bot) {
    if (finished) return;
    const { room, game } = bot;
    if (!room) return;

    if (room.status === "playing" && game) {
      if (game.phase === "finished" && !finalReport) {
        finalReport = game.finishedOrder;
      }
      if (game.phase === "finished") return;

      if (bot.busy) return;

      if (game.phase === "reveal_pending" && game.you.canPickupNow) {
        bot.busy = true;
        actionsCount += 1;
        log(`  ${bot.name} ramasse la pile (${game.pendingReveal.pileCount} cartes)`);
        bot.socket.emit("game:pickup", {}, (res) => {
          bot.busy = false;
          if (!res.ok) log(`  !! erreur pickup pour ${bot.name}: ${res.error}`);
        });
        return;
      }

      if (game.phase === "playing" && game.you.isYourTurn) {
        bot.busy = true;
        actionsCount += 1;
        decideAndAct(bot, game);
      }
    }
  }

  function decideAndAct(bot, game) {
    const hand = game.hand;

    // Strategie: sortir un carre si possible, sinon jouer une carte vraie si
    // le round est deja lance et qu'on en a, sinon bluffer. On accuse de
    // temps en temps quand c'est possible, pour tester ce chemin de code.
    const rankCounts = {};
    hand.forEach((c) => { rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1; });
    const quadRank = Object.keys(rankCounts).find((r) => rankCounts[r] === 4);

    if (quadRank) {
      // les carres doivent sortir tout seuls : on ne doit jamais en avoir en main
      console.error(`ECHEC: ${bot.name} a un carre de ${quadRank} en main (sortie automatique attendue)`);
      process.exit(1);
    }

    if (game.you.canAccuseNow && Math.random() < 0.2) {
      log(`  ${bot.name} crie MENTEUR sur ${game.lastPlay.playerName}`);
      bot.socket.emit("game:accuse", {}, (res) => {
        bot.busy = false;
        if (!res.ok) log(`  !! erreur accuse pour ${bot.name}: ${res.error}`);
      });
      return;
    }

    if (game.lastPlay === null) {
      // Nouveau round: on annonce la valeur qu'on a le plus en main.
      let bestRank = hand[0].rank;
      let bestCount = 0;
      Object.entries(rankCounts).forEach(([rank, count]) => {
        if (count > bestCount) { bestRank = rank; bestCount = count; }
      });
      const toPlay = hand.filter((c) => c.rank === bestRank).slice(0, 3);
      const cardIds = toPlay.map((c) => c.id);
      log(`  ${bot.name} lance la manche: annonce ${bestRank}, pose ${cardIds.length} carte(s)`);
      bot.socket.emit("game:play", { cardIds, declaredRank: bestRank }, (res) => {
        bot.busy = false;
        if (!res.ok) log(`  !! erreur play(start) pour ${bot.name}: ${res.error}`);
      });
      return;
    }

    // Round en cours: joue une carte vraie si possible, sinon bluffe.
    const truthful = hand.filter((c) => c.rank === game.roundLeaderRank);
    const cardsToPlay = truthful.length > 0 ? truthful.slice(0, Math.min(3, truthful.length)) : [hand[0]];
    const cardIds = cardsToPlay.map((c) => c.id);
    log(`  ${bot.name} pose ${cardIds.length} carte(s) (${truthful.length > 0 ? "vraies" : "bluff"}), annonce toujours ${game.roundLeaderRank}`);
    bot.socket.emit("game:play", { cardIds }, (res) => {
      bot.busy = false;
      if (!res.ok) log(`  !! erreur play pour ${bot.name}: ${res.error}`);
    });
  }

  // ---------- mise en place du salon ----------

  for (let i = 0; i < BOT_NAMES.length; i += 1) bots.push(makeBot(BOT_NAMES[i], i));
  await Promise.all(bots.map((b) => new Promise((resolve) => b.socket.on("connect", resolve))));
  log("Tous les bots sont connectes.\n");

  const host = bots[0];
  const createRes = await new Promise((resolve) => {
    host.socket.emit("room:create", { name: host.name, gameType: "menteur" }, resolve);
  });
  if (!createRes.ok) throw new Error("Echec creation salon: " + createRes.error);
  host.playerId = createRes.playerId;
  host.code = createRes.code;
  log(`${host.name} cree le salon ${host.code}\n`);

  for (let i = 1; i < bots.length; i += 1) {
    const bot = bots[i];
    const res = await new Promise((resolve) => {
      bot.socket.emit("room:join", { name: bot.name, code: host.code }, resolve);
    });
    if (!res.ok) throw new Error(`Echec join pour ${bot.name}: ` + res.error);
    bot.playerId = res.playerId;
    log(`${bot.name} rejoint le salon ${host.code}`);
  }

  await wait(200);

  const startRes = await new Promise((resolve) => {
    host.socket.emit("room:start", {}, resolve);
  });
  if (!startRes.ok) throw new Error("Echec demarrage: " + startRes.error);
  log("\nPartie lancee !\n");

  const startTime = Date.now();
  while (!finalReport && actionsCount < MAX_ACTIONS && Date.now() - startTime < 30000) {
    await wait(30);
  }

  finished = true;
  await wait(200);

  console.log("\n================ RESULTAT ================");
  if (finalReport) {
    console.log(`Partie terminee en ${actionsCount} actions.`);
    finalReport.forEach((p, i) => console.log(`  ${i + 1}. ${p.label} - ${p.name}`));
    console.log("\nSUCCES: la partie s'est deroulee et terminee correctement.");
  } else {
    console.log(`ECHEC: la partie ne s'est pas terminee (actions=${actionsCount}).`);
  }
  console.log("============================================\n");

  bots.forEach((b) => b.socket.close());
  server.kill();
  process.exit(finalReport ? 0 : 1);
}

main().catch((err) => {
  console.error("Erreur de simulation:", err);
  process.exit(1);
});
