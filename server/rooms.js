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

  // Ajoute un robot a la table (salon uniquement, 8 joueurs max).
  addBot(code, names) {
    const room = this.getRoom(code);
    if (!room) return { error: "Salon introuvable." };
    if (room.status !== "lobby") return { error: "La partie a déjà commencé." };
    if (room.order.length >= 8) return { error: "La table est complète (8 joueurs maximum)." };
    const taken = new Set(room.order.map((id) => room.players[id].name));
    const free = names.filter((n) => !taken.has(n));
    const name = free.length ? free[Math.floor(Math.random() * free.length)] : `Robot ${room.order.length + 1}`;
    const playerId = generatePlayerId();
    room.order.push(playerId);
    room.players[playerId] = { id: playerId, name, connected: true, isHost: false, isBot: true, socketId: null };
    return { room, playerId };
  }

  // Reassocie un joueur deja connu (apres refresh / coupure) a son nouveau socket.
  rejoin(code, playerId) {
    const room = this.getRoom(code);
    if (!room) return { error: "Cette table n'existe plus (le serveur a peut-être redémarré).", gone: true };
    if (!room.players[playerId]) return { error: "Tu ne fais plus partie de cette table.", gone: true };
    return { room };
  }

  bindSocket(socketId, code, playerId) {
    const room = this.getRoom(code);
    const player = room && room.players[playerId];
    // Le joueur revient avec un nouveau socket : on oublie l'ancien, pour que
    // sa "mort" (souvent detectee ~20 s plus tard sur mobile) ne deconnecte
    // plus personne.
    if (player && player.socketId && player.socketId !== socketId) {
      this.socketToPlayer.delete(player.socketId);
    }
    this.socketToPlayer.set(socketId, { code, playerId });
    if (player) {
      player.connected = true;
      player.socketId = socketId;
      player.lastSeen = Date.now();
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
    const player = room && room.players[link.playerId];
    // Correctif "je perds le fil" : on ne marque le joueur hors ligne que si
    // c'est bien SA connexion actuelle qui tombe (et pas un ancien socket).
    if (player && player.socketId === socketId) {
      player.connected = false;
      player.socketId = null;
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
