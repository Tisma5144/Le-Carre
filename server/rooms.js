// Gestion des salons (sessions) : creation avec un code a 4 lettres,
// ajout/retrait de joueurs, association socket <-> joueur persistant
// (pour permettre une reconnexion apres un refresh ou une coupure reseau).

const crypto = require("crypto");

const CODE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CODE_LENGTH = 4;

function generatePlayerId() {
  return crypto.randomBytes(8).toString("hex");
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> room
    this.socketToPlayer = new Map(); // socketId -> { code, playerId }
  }

  generateCode() {
    let code;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");
    } while (this.rooms.has(code));
    return code;
  }

  createRoom({ gameType, hostName }) {
    const code = this.generateCode();
    const playerId = generatePlayerId();
    const room = {
      code,
      gameType,
      status: "lobby", // lobby | playing | finished
      hostId: playerId,
      order: [playerId], // ordre d'arrivee, sert de base a l'ordre des sieges
      players: {
        [playerId]: { id: playerId, name: hostName, connected: false, isHost: true }
      },
      game: null,
      createdAt: Date.now()
    };
    this.rooms.set(code, room);
    return { room, playerId };
  }

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(code.toUpperCase()) || null;
  }

  joinRoom(code, name) {
    const room = this.getRoom(code);
    if (!room) return { error: "Ce salon n'existe pas." };
    if (room.status !== "lobby") return { error: "La partie a deja commence." };
    if (room.order.length >= 8) return { error: "Le salon est complet (8 joueurs max)." };

    const playerId = generatePlayerId();
    room.order.push(playerId);
    room.players[playerId] = { id: playerId, name, connected: false, isHost: false };
    return { room, playerId };
  }

  // Reassocie un joueur deja connu (apres refresh / coupure) a son nouveau socket.
  rejoin(code, playerId) {
    const room = this.getRoom(code);
    if (!room || !room.players[playerId]) return { error: "Impossible de te reconnecter a ce salon." };
    return { room };
  }

  bindSocket(socketId, code, playerId) {
    this.socketToPlayer.set(socketId, { code, playerId });
    const room = this.getRoom(code);
    if (room && room.players[playerId]) {
      room.players[playerId].connected = true;
      room.players[playerId].socketId = socketId;
    }
  }

  getBySocket(socketId) {
    const link = this.socketToPlayer.get(socketId);
    if (!link) return null;
    const room = this.getRoom(link.code);
    if (!room) return null;
    return { room, playerId: link.playerId };
  }

  handleDisconnect(socketId) {
    const link = this.socketToPlayer.get(socketId);
    this.socketToPlayer.delete(socketId);
    if (!link) return null;
    const room = this.getRoom(link.code);
    if (room && room.players[link.playerId]) {
      room.players[link.playerId].connected = false;
    }
    return room;
  }

  removePlayerFromLobby(code, playerId) {
    const room = this.getRoom(code);
    if (!room || room.status !== "lobby") return null;
    room.order = room.order.filter((id) => id !== playerId);
    delete room.players[playerId];
    if (room.order.length === 0) {
      this.rooms.delete(code);
      return null;
    }
    if (room.hostId === playerId) {
      room.hostId = room.order[0];
      room.players[room.hostId].isHost = true;
    }
    return room;
  }

  connectedCount(room) {
    return room.order.filter((id) => room.players[id] && room.players[id].connected).length;
  }
}

module.exports = { RoomManager, generatePlayerId };
