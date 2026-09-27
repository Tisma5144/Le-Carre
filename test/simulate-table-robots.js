// Table reelle (serveur + sockets) : un humain et trois robots jouent une
// partie de chaque jeu. Verifie que les robots ajoutes depuis le salon jouent
// tout seuls, ramassent, echangent, annoncent... jusqu'a la fin.
// Usage : node test/simulate-table-robots.js

const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert");
const { io } = require("socket.io-client");

const PORT = 4125;
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "index.js")], {
    env: { ...process.env, PORT: String(PORT), BOT_SPEED: "0.03" },
    stdio: ["ignore", "pipe", "inherit"]
  });
  await new Promise((r) => server.stdout.on("data", (d) => String(d).includes("ecoute") && r()));
  let ok = false;
  const s = io(URL, { transports: ["websocket"] });
  let last = null;
  s.on("state", (p) => { last = p; });
  const emit = (ev, d) => new Promise((r) => s.emit(ev, d || {}, r));
  try {
    await new Promise((r) => s.on("connect", r));
    await emit("room:create", { name: "Mathis" });
    for (let i = 0; i < 3; i += 1) assert.ok((await emit("room:addBot")).ok, "ajout d'un robot");
    await sleep(100);
    assert.strictEqual(last.room.players.filter((p) => p.isBot).length, 3);
    const report = {};
    for (const gameType of ["menteur", "president", "ascenseur"]) {
      await emit("room:setGame", { gameType });
      if (gameType === "ascenseur") await emit("room:setOptions", { options: { maxCards: 3, mode: "up-down", step: 1 } });
      assert.ok((await emit("room:start")).ok, "lancement " + gameType);
      const t0 = Date.now();
      let rounds = 0;
      while (Date.now() - t0 < 60000) {
        await sleep(30);
        const g = last.game;
        if (!g) continue;
        if (g.phase === "finished") break;
        if (g.phase === "round_end") {
          rounds += 1;
          if (gameType === "president" && rounds >= 2) break;
          await emit("game:nextRound");
          continue;
        }
        const you = g.you;
        if (gameType === "menteur") {
          if (g.phase === "reveal_pending" && g.pendingReveal && g.pendingReveal.loserId === you.id) await emit("game:pickup");
          else if (g.phase === "playing" && you.isYourTurn && g.hand.length) {
            await emit("game:play", { cardIds: [g.hand[0].id], declaredRank: g.lastPlay ? undefined : g.hand[0].rank });
          }
        } else if (gameType === "president") {
          if (g.phase === "exchange" && g.exchange && g.exchange.myGive) await emit("game:give", { cardIds: g.hand.slice(0, g.exchange.myGive.count).map((c) => c.id) });
          else if (g.phase === "playing" && you.isYourTurn) {
            const r = g.top ? { ok: false } : await emit("game:play", { cardIds: [g.hand[0].id] });
            if (!r.ok) await emit("game:pass");
          }
        } else if (gameType === "ascenseur") {
          if (you.mustBid) await emit("game:bid", { bid: you.forbiddenBid === 0 ? 1 : 0 });
          else if (g.phase === "playing" && you.isYourTurn) await emit("game:play", { cardIds: [you.legalIds[0]] });
        }
      }
      const g = last.game;
      assert.ok(g.phase === "finished" || (gameType === "president" && rounds >= 2), `${gameType} : la partie avec robots doit avancer jusqu'au bout (phase ${g.phase})`);
      report[gameType] = { phase: g.phase, secondes: Math.round((Date.now() - t0) / 1000) };
      await emit("room:playAgain");
      await sleep(100);
    }
    // retrait d'un robot
    const bot = last.room.players.find((p) => p.isBot);
    assert.ok((await emit("room:removeBot", { playerId: bot.id })).ok);
    await sleep(100);
    assert.strictEqual(last.room.players.filter((p) => p.isBot).length, 2);
    ok = true;
    console.log("SUCCES Table avec robots :", JSON.stringify(report));
  } catch (e) {
    console.error("ECHEC :", e.message);
  } finally {
    s.close();
    server.kill();
    process.exit(ok ? 0 : 1);
  }
})();
