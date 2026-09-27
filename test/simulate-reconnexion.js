// Test des reconnexions : reproduit le bug "je perds le fil de la partie".
// Un telephone perd sa connexion, se reconnecte avec un NOUVEAU socket, puis
// le serveur detecte seulement ensuite la mort de l'ANCIEN socket. Le joueur
// doit continuer a recevoir l'etat de la partie sans actualiser.
// Usage : node test/simulate-reconnexion.js

const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert");
const { io } = require("socket.io-client");

const PORT = 4124;
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  const s = io(URL, { transports: ["websocket"], reconnection: false, forceNew: true });
  const c = { s, last: null, count: 0 };
  s.on("state", (p) => {
    c.last = p;
    c.count += 1;
  });
  return new Promise((r) => s.on("connect", () => r(c)));
}
const emit = (c, ev, data) => new Promise((r) => c.s.emit(ev, data || {}, r));

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "index.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"]
  });
  await new Promise((r) => server.stdout.on("data", (d) => String(d).includes("ecoute") && r()));
  let ok = false;
  try {
    const host = await client();
    const { code } = await emit(host, "room:create", { name: "Patron" });
    const bob = await client();
    const joined = await emit(bob, "room:join", { code, name: "Bob" });
    const chloe = await client();
    await emit(chloe, "room:join", { code, name: "Chloe" });
    await emit(host, "room:setGame", { gameType: "president" });
    await emit(host, "room:start", {});
    await sleep(200);
    assert.ok(bob.last && bob.last.game, "Bob recoit la partie");

    // 1. Bob se reconnecte avec un nouveau socket (l'ancien n'est pas encore mort)
    const bob2 = await client();
    const re = await emit(bob2, "room:rejoin", { code, playerId: joined.playerId });
    assert.ok(re.ok, "rejoin accepte");
    await sleep(100);
    // 2. le serveur detecte enfin la mort de l'ancien socket
    bob.s.disconnect();
    await sleep(300);
    // 3. la partie continue : Bob (nouveau socket) doit recevoir les etats
    const before = bob2.count;
    const bobPlayer = host.last.room.players.find((p) => p.id === joined.playerId);
    assert.ok(bobPlayer.connected, "Bob est toujours affiche en ligne chez les autres");
    // un vrai changement d'etat : le patron revient au salon
    await emit(host, "room:playAgain", {});
    await sleep(200);
    assert.ok(bob2.count > before, "Bob recoit encore l'etat apres la mort de son ancien socket");
    assert.strictEqual(bob2.last.room.status, "lobby");

    // 4. synchronisation a la demande (retour sur l'appli)
    const n = bob2.count;
    const sync = await emit(bob2, "room:sync", {});
    await sleep(100);
    assert.ok(sync.ok && bob2.count > n, "room:sync renvoie l'etat");

    // 5. table disparue (serveur redemarre) -> rejoin refuse proprement
    const ghost = await client();
    const bad = await emit(ghost, "room:rejoin", { code: "ZZZZ", playerId: "x" });
    assert.ok(!bad.ok && bad.gone, "table inconnue signalee");

    // 6. quitter la table en pleine partie : plus aucun etat recu, un robot le remplace
    await emit(host, "room:start", {});
    await sleep(200);
    const n2 = bob2.count;
    await emit(bob2, "room:leave", {});
    await sleep(100);
    const n3 = bob2.count;
    const bobNow = host.last.room.players.find((p) => p.id === joined.playerId);
    assert.ok(bobNow && bobNow.isBot, "un robot a pris sa place");
    await emit(host, "room:playAgain", {});
    await sleep(300);
    assert.strictEqual(bob2.count, n3, "le joueur parti ne recoit plus la partie");
    assert.ok(n3 >= n2);
    assert.ok(!host.last.room.players.some((p) => p.id === joined.playerId), "retour au salon : il a quitte la table");

    ok = true;
    console.log("SUCCES Reconnexion : le joueur reconnecte recoit toujours la partie.");
    [host, bob2, chloe, ghost].forEach((c) => c.s.close());
  } catch (e) {
    console.error("ECHEC :", e.message);
  } finally {
    server.kill();
    process.exit(ok ? 0 : 1);
  }
})();
