const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { RoomManager } = require("./rooms");
const menteur = require("./games/menteur");
const president = require("./games/president");
const ascenseur = require("./games/ascenseur");

const GAMES = { [menteur.id]: menteur, [president.id]: president, [ascenseur.id]: ascenseur };

const PORT = process.env.PORT || 3000;
const EMOTES = ["😂", "😱", "🔥", "👏", "😡", "🤡", "🍺", "🤔", "😎", "💀", "😭", "🙏"];

const app = express();
const server = http.createServer(app);
// Detection plus rapide des connexions mortes (reseau du bar, telephone en
// veille) et reprise de session transparente pour les coupures courtes.
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 8000,
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000, skipMiddlewares: true }
});

app.use(express.static(path.join(__dirname, "..", "public")));

// Bibliotheques front servies depuis node_modules (pas de CDN : le jeu
// fonctionne meme si un CDN externe est bloque sur le reseau du bar).
const NODE_MODULES = path.join(__dirname, "..", "node_modules");
const vendorCache = { maxAge: "7d" };
app.use("/vendor/three", express.static(path.join(NODE_MODULES, "three", "build"), vendorCache));
app.use("/vendor/three-addons", express.static(path.join(NODE_MODULES, "three", "examples", "jsm"), vendorCache));
app.use("/vendor/fonts", express.static(path.join(NODE_MODULES, "@fontsource"), vendorCache));
app.get("/vendor/qrcode.mjs", (_req, res) => {
  res.sendFile(path.join(NODE_MODULES, "qrcode-generator", "dist", "qrcode.mjs"));
});

const rooms = new RoomManager();

function roomSummary(room) {
  return {
    code: room.code,
    status: room.status,
    gameType: room.gameType,
    options: room.options || {},
    hostId: room.hostId,
    players: room.order.map((id) => ({
      id,
      name: room.players[id].name,
      connected: !!room.players[id].connected,
      isHost: room.players[id].isHost
    }))
  };
}

// Envoie a chaque joueur du salon son propre point de vue de la partie
// (main cachee aux autres, etc). Si la partie n'a pas commence, tout le
// monde recoit juste le resume du salon (lobby).
// Certains jeux ont besoin d'une pause automatique (ex : laisser le pli
// visible avant de le ramasser). Le moteur renvoie { schedule: ms } et le
// serveur rappelle game.tick() apres ce delai.
function scheduleTick(room, ms) {
  clearTimeout(room.tickTimer);
  const uid = room.game && room.game.uid;
  room.tickTimer = setTimeout(() => {
    const game = GAMES[room.gameType];
    if (!room.game || room.game.uid !== uid || !game || !game.tick) return;
    const r = game.tick(room.game);
    if (r && r.ok) {
      broadcastRoom(room);
      if (r.schedule) scheduleTick(room, r.schedule);
    }
  }, ms);
}

function newGame(room) {
  const game = GAMES[room.gameType];
  clearTimeout(room.tickTimer);
  const opts = (room.options || {})[room.gameType];
  return game.createGame(room.order, opts);
}

function sendStateTo(room, playerId) {
  const player = room.players[playerId];
  if (!player || !player.socketId) return;
  const game = room.game ? GAMES[room.gameType] : null;
  const payload = { room: roomSummary(room), game: game && room.game ? game.getViewForPlayer(room.game, playerId, room.players) : null };
  io.to(player.socketId).emit("state", payload);
}

function broadcastRoom(room) {
  for (const playerId of room.order) sendStateTo(room, playerId);
}

io.on("connection", (socket) => {
  // Detache ce socket de la table ou il etait assis (salon seulement).
  function detachFromCurrentRoom() {
    const link = rooms.getBySocket(socket.id);
    if (!link) return;
    socket.leave(link.room.code);
    rooms.socketToPlayer.delete(socket.id);
    const updated = rooms.removePlayerFromLobby(link.room.code, link.playerId);
    if (updated) broadcastRoom(updated);
  }

  socket.on("room:create", ({ name, gameType }, ack) => {
    // Anti double-clic : si ce telephone vient deja d'ouvrir une table ou il
    // est seul, on lui renvoie la meme au lieu d'en creer une autre.
    const current = rooms.getBySocket(socket.id);
    if (current && current.room.status === "lobby" && current.room.hostId === current.playerId && current.room.order.length === 1) {
      ack && ack({ ok: true, code: current.room.code, playerId: current.playerId });
      return broadcastRoom(current.room);
    }
    detachFromCurrentRoom();
    const cleanName = (name || "").trim().slice(0, 20) || "Joueur";
    const type = GAMES[gameType] ? gameType : menteur.id;
    const { room, playerId } = rooms.createRoom({ gameType: type, hostName: cleanName });
    rooms.bindSocket(socket.id, room.code, playerId);
    socket.join(room.code);
    ack && ack({ ok: true, code: room.code, playerId });
    broadcastRoom(room);
  });

  socket.on("room:join", ({ code, name }, ack) => {
    const cleanName = (name || "").trim().slice(0, 20) || "Joueur";
    // Anti double-clic : ce telephone est deja assis a cette table -> on
    // renvoie sa place au lieu de l'asseoir une deuxieme fois.
    const current = rooms.getBySocket(socket.id);
    if (current && current.room.code === String(code || "").toUpperCase() && current.room.players[current.playerId]) {
      ack && ack({ ok: true, code: current.room.code, playerId: current.playerId });
      return broadcastRoom(current.room);
    }
    detachFromCurrentRoom();
    const { room, error } = rooms.joinRoom(code, cleanName);
    if (error) return ack && ack({ ok: false, error });
    rooms.bindSocket(socket.id, room.code, room.order[room.order.length - 1]);
    const playerId = room.order[room.order.length - 1];
    socket.join(room.code);
    ack && ack({ ok: true, code: room.code, playerId });
    broadcastRoom(room);
  });

  socket.on("room:rejoin", ({ code, playerId } = {}, ack) => {
    const { room, error, gone } = rooms.rejoin(code, playerId);
    if (error) return ack && ack({ ok: false, error, gone: !!gone });
    rooms.bindSocket(socket.id, room.code, playerId);
    socket.join(room.code);
    ack && ack({ ok: true, code: room.code, playerId });
    broadcastRoom(room);
  });

  socket.on("room:leave", (_payload, ack) => {
    const link = rooms.getBySocket(socket.id);
    if (link) {
      const { room, playerId } = link;
      socket.leave(room.code);
      rooms.socketToPlayer.delete(socket.id);
      const updated = rooms.removePlayerFromLobby(room.code, playerId);
      if (updated) broadcastRoom(updated);
    }
    ack && ack({ ok: true });
  });

  // Le telephone revient au premier plan (ou doute d'etre a jour) : on lui
  // renvoie l'etat complet. Si le serveur ne le connait plus sur ce socket,
  // il doit refaire un room:rejoin.
  socket.on("room:sync", (_payload, ack) => {
    const link = rooms.getBySocket(socket.id);
    if (!link) return ack && ack({ ok: false, needRejoin: true });
    const { room, playerId } = link;
    const player = room.players[playerId];
    if (!player || player.socketId !== socket.id) return ack && ack({ ok: false, needRejoin: true });
    sendStateTo(room, playerId);
    ack && ack({ ok: true });
  });

  // Le patron choisit le jeu dans le salon (menu de selection).
  socket.on("room:setGame", ({ gameType }, ack) => {
    const link = rooms.getBySocket(socket.id);
    if (!link) return ack && ack({ ok: false, error: "Salon introuvable." });
    const { room, playerId } = link;
    if (room.hostId !== playerId) return ack && ack({ ok: false, error: "Seul le patron choisit le jeu." });
    if (room.status !== "lobby") return ack && ack({ ok: false, error: "Une partie est en cours." });
    if (!GAMES[gameType]) return ack && ack({ ok: false, error: "Jeu inconnu." });
    room.gameType = gameType;
    ack && ack({ ok: true });
    broadcastRoom(room);
  });

  // Reglages du jeu choisis par le patron (ex : manches de l'Ascenseur).
  socket.on("room:setOptions", ({ options }, ack) => {
    const link = rooms.getBySocket(socket.id);
    if (!link) return ack && ack({ ok: false, error: "Salon introuvable." });
    const { room, playerId } = link;
    if (room.hostId !== playerId) return ack && ack({ ok: false, error: "Seul le patron règle la partie." });
    if (room.status !== "lobby") return ack && ack({ ok: false, error: "Une partie est en cours." });
    if (!options || typeof options !== "object") return ack && ack({ ok: false, error: "Réglages invalides." });
    const clean = {};
    for (const [k, v] of Object.entries(options).slice(0, 8)) {
      if (["number", "string", "boolean"].includes(typeof v)) clean[k] = typeof v === "string" ? v.slice(0, 20) : v;
    }
    room.options = room.options || {};
    room.options[room.gameType] = clean;
    ack && ack({ ok: true });
    broadcastRoom(room);
  });

  // Emotes : reaction instantanee envoyee a toute la table (hors etat de jeu).
  let lastEmoteAt = 0;
  socket.on("room:emote", ({ emoji } = {}, ack) => {
    const link = rooms.getBySocket(socket.id);
    if (!link || !EMOTES.includes(emoji)) return ack && ack({ ok: false });
    const now = Date.now();
    if (now - lastEmoteAt < 700) return ack && ack({ ok: false, error: "Doucement 😅" });
    lastEmoteAt = now;
    io.to(link.room.code).emit("emote", { playerId: link.playerId, emoji });
    ack && ack({ ok: true });
  });

  socket.on("room:start", (_payload, ack) => {
    const link = rooms.getBySocket(socket.id);
    if (!link) return ack && ack({ ok: false, error: "Salon introuvable." });
    const { room, playerId } = link;
    if (room.hostId !== playerId) return ack && ack({ ok: false, error: "Seul l'hote peut lancer la partie." });
    if (room.status !== "lobby") return ack && ack({ ok: false, error: "La partie a deja commence." });

    const game = GAMES[room.gameType];
    if (room.order.length < game.minPlayers) {
      return ack && ack({ ok: false, error: `Il faut au moins ${game.minPlayers} joueurs.` });
    }
    room.game = newGame(room);
    room.status = "playing";
    ack && ack({ ok: true });
    broadcastRoom(room);
  });

  socket.on("room:playAgain", (_payload, ack) => {
    const link = rooms.getBySocket(socket.id);
    if (!link) return ack && ack({ ok: false, error: "Salon introuvable." });
    const { room, playerId } = link;
    if (room.hostId !== playerId) return ack && ack({ ok: false, error: "Seul l'hote peut relancer une partie." });
    room.status = "lobby";
    clearTimeout(room.tickTimer);
    room.game = null;
    ack && ack({ ok: true });
    broadcastRoom(room);
  });

  // Revanche immediate avec les joueurs encore connectes.
  socket.on("room:rematch", (_payload, ack) => {
    const link = rooms.getBySocket(socket.id);
    if (!link) return ack && ack({ ok: false, error: "Salon introuvable." });
    const { room, playerId } = link;
    if (room.hostId !== playerId) return ack && ack({ ok: false, error: "Seul l'hote peut relancer une partie." });
    const game = GAMES[room.gameType];
    const connected = room.order.filter((id) => room.players[id] && room.players[id].connected);
    if (connected.length < game.minPlayers) {
      room.status = "lobby";
      room.game = null;
      broadcastRoom(room);
      return ack && ack({ ok: false, error: `Il faut au moins ${game.minPlayers} joueurs connectes.` });
    }
    for (const id of room.order) if (!connected.includes(id)) delete room.players[id];
    room.order = connected;
    room.game = newGame(room);
    room.status = "playing";
    ack && ack({ ok: true });
    broadcastRoom(room);
  });

  function handleGameAction(actionType, extraFields = {}) {
    return (payload = {}, ack) => {
      const link = rooms.getBySocket(socket.id);
      if (!link) return ack && ack({ ok: false, error: "Salon introuvable." });
      const { room, playerId } = link;
      if (!room.game || room.status !== "playing") {
        return ack && ack({ ok: false, error: "La partie n'a pas commence." });
      }
      const game = GAMES[room.gameType];
      const action = { type: actionType };
      for (const field of extraFields) action[field] = payload[field];
      const result = game.applyAction(room.game, playerId, action, { isHost: room.hostId === playerId });
      if (!result.ok) return ack && ack({ ok: false, error: result.error });
      ack && ack({ ok: true });
      broadcastRoom(room);
      if (result.schedule) scheduleTick(room, result.schedule);
    };
  }

  socket.on("game:play", handleGameAction("play", ["cardIds", "declaredRank"]));
  socket.on("game:quadDiscard", handleGameAction("quad_discard", ["rank"]));
  socket.on("game:accuse", handleGameAction("accuse", []));
  socket.on("game:pickup", handleGameAction("pickup", []));
  socket.on("game:pass", handleGameAction("pass", []));
  socket.on("game:give", handleGameAction("give", ["cardIds"]));
  socket.on("game:nextRound", handleGameAction("next_round", []));
  socket.on("game:bid", handleGameAction("bid", ["bid"]));

  socket.on("disconnect", () => {
    const room = rooms.handleDisconnect(socket.id);
    if (room) broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Le Carre en ecoute sur le port ${PORT}`);
});
