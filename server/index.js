const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { RoomManager } = require("./rooms");
const menteur = require("./games/menteur");

const GAMES = { [menteur.id]: menteur };

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "..", "public")));

const rooms = new RoomManager();

function roomSummary(room) {
  return {
    code: room.code,
    status: room.status,
    gameType: room.gameType,
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
function broadcastRoom(room) {
  const game = room.game ? GAMES[room.gameType] : null;
  for (const playerId of room.order) {
    const player = room.players[playerId];
    if (!player || !player.connected || !player.socketId) continue;
    const payload = { room: roomSummary(room) };
    if (game && room.game) {
      payload.game = game.getViewForPlayer(room.game, playerId, room.players);
    } else {
      payload.game = null;
    }
    io.to(player.socketId).emit("state", payload);
  }
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name, gameType }, ack) => {
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
    const { room, error } = rooms.joinRoom(code, cleanName);
    if (error) return ack && ack({ ok: false, error });
    rooms.bindSocket(socket.id, room.code, room.order[room.order.length - 1]);
    const playerId = room.order[room.order.length - 1];
    socket.join(room.code);
    ack && ack({ ok: true, code: room.code, playerId });
    broadcastRoom(room);
  });

  socket.on("room:rejoin", ({ code, playerId }, ack) => {
    const { room, error } = rooms.rejoin(code, playerId);
    if (error) return ack && ack({ ok: false, error });
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
    room.game = game.createGame(room.order);
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
    room.game = null;
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
      const result = game.applyAction(room.game, playerId, action);
      if (!result.ok) return ack && ack({ ok: false, error: result.error });
      ack && ack({ ok: true });
      broadcastRoom(room);
    };
  }

  socket.on("game:play", handleGameAction("play", ["cardIds", "declaredRank"]));
  socket.on("game:quadDiscard", handleGameAction("quad_discard", ["rank"]));
  socket.on("game:accuse", handleGameAction("accuse", []));
  socket.on("game:pickup", handleGameAction("pickup", []));

  socket.on("disconnect", () => {
    const room = rooms.handleDisconnect(socket.id);
    if (room) broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Site carte en ecoute sur le port ${PORT}`);
});
