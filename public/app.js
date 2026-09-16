(() => {
  "use strict";

  // Ordre d'affichage cote client : de l'As au Roi (demande de Mathis).
  // Le serveur, lui, ne se sert jamais de cet ordre pour comparer des
  // valeurs (le Menteur n'a pas de notion de valeur "plus forte").
  const RANK_ORDER = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R"];
  const RANK_LABELS = {
    3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
    V: "Valet", D: "Dame", R: "Roi", A: "As", 2: "2"
  };
  const RANK_INDEX = Object.fromEntries(RANK_ORDER.map((r, i) => [r, i]));
  const SESSION_KEY = "siteCarteSession";
  const DRAG_THRESHOLD = 8;

  const el = (id) => document.getElementById(id);

  const dom = {
    screens: {
      home: el("screen-home"),
      lobby: el("screen-lobby"),
      game: el("screen-game")
    },
    inputName: el("input-name"),
    inputCode: el("input-code"),
    btnShowCreate: el("btn-show-create"),
    btnShowJoin: el("btn-show-join"),
    joinForm: el("join-form"),
    btnJoin: el("btn-join"),
    btnCancelJoin: el("btn-cancel-join"),
    homeError: el("home-error"),

    lobbyCode: el("lobby-code"),
    lobbyPlayers: el("lobby-players"),
    lobbyStatus: el("lobby-status"),
    btnStart: el("btn-start"),
    btnLeaveLobby: el("btn-leave-lobby"),

    opponentsRow: el("opponents-row"),
    pileStack: el("pile-stack"),
    pileInfo: el("pile-info"),
    pileCenterMat: document.querySelector(".center-pile-mat"),
    pileCenterBtn: el("pile-center"),
    pileSortiesBtn: el("pile-sorties"),
    sortiesCount: el("sorties-count"),
    turnBanner: el("turn-banner"),
    rankPicker: el("rank-picker"),
    actionBar: el("action-bar"),
    hand: el("hand"),
    btnSortHand: el("btn-sort-hand"),

    overlayReveal: el("overlay-reveal"),
    revealTitle: el("reveal-title"),
    revealCards: el("reveal-cards"),
    revealText: el("reveal-text"),
    btnPickup: el("btn-pickup"),
    revealWaiting: el("reveal-waiting"),

    overlayEnd: el("overlay-end"),
    endRanking: el("end-ranking"),
    btnPlayAgain: el("btn-play-again"),
    endWaiting: el("end-waiting"),

    modalHistory: el("modal-history"),
    historyList: el("history-list"),
    modalQuads: el("modal-quads"),
    quadsList: el("quads-list")
  };

  const state = {
    socket: null,
    me: { playerId: null, name: "" },
    room: null,
    game: null,
    selectedCardIds: [],
    chosenDeclaredRank: null,
    joining: false,
    sortHand: false
  };

  // ---------- session (permet de se reconnecter apres un refresh) ----------

  function saveSession(data) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- petit systeme de toast pour les erreurs ----------

  let toastTimer = null;
  function flashError(message) {
    let toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      toast.style.position = "fixed";
      toast.style.bottom = "18px";
      toast.style.left = "50%";
      toast.style.transform = "translateX(-50%)";
      toast.style.background = "#221a3a";
      toast.style.color = "white";
      toast.style.padding = "10px 18px";
      toast.style.borderRadius = "999px";
      toast.style.fontWeight = "600";
      toast.style.zIndex = "1000";
      toast.style.maxWidth = "90vw";
      toast.style.textAlign = "center";
      toast.style.boxShadow = "0 8px 20px rgba(0,0,0,0.4)";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = "none"; }, 2600);
  }

  // ---------- navigation entre ecrans ----------

  function showScreen(name) {
    Object.entries(dom.screens).forEach(([key, node]) => {
      node.classList.toggle("hidden", key !== name);
    });
  }

  function route() {
    if (!state.room) {
      showScreen("home");
      return;
    }
    if (state.room.status === "lobby") {
      showScreen("lobby");
      renderLobby();
    } else {
      showScreen("game");
      renderGame();
    }
  }

  // ---------- ecran accueil ----------

  dom.btnShowCreate.addEventListener("click", () => {
    const name = dom.inputName.value.trim();
    if (!name) return flashError("Entre un pseudo pour continuer.");
    state.me.name = name;
    state.socket.emit("room:create", { name, gameType: "menteur" }, onJoinAck);
  });

  dom.btnShowJoin.addEventListener("click", () => {
    dom.joinForm.classList.remove("hidden");
    dom.homeActionsHide();
  });
  dom.btnCancelJoin.addEventListener("click", () => {
    dom.joinForm.classList.add("hidden");
    dom.homeActionsShow();
  });
  dom.homeActionsHide = () => el("home-actions").classList.add("hidden");
  dom.homeActionsShow = () => el("home-actions").classList.remove("hidden");

  dom.btnJoin.addEventListener("click", () => {
    const name = dom.inputName.value.trim();
    const code = dom.inputCode.value.trim().toUpperCase();
    if (!name) return flashError("Entre un pseudo pour continuer.");
    if (code.length !== 4) return flashError("Le code fait 4 lettres.");
    state.me.name = name;
    state.socket.emit("room:join", { name, code }, onJoinAck);
  });

  dom.inputCode.addEventListener("input", () => {
    dom.inputCode.value = dom.inputCode.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  });

  function onJoinAck(res) {
    if (!res || !res.ok) {
      flashError((res && res.error) || "Impossible de rejoindre ce salon.");
      return;
    }
    state.me.playerId = res.playerId;
    saveSession({ code: res.code, playerId: res.playerId, name: state.me.name });
    dom.homeError.classList.add("hidden");
  }

  // ---------- salle d'attente ----------

  function renderLobby() {
    dom.lobbyCode.textContent = state.room.code;
    dom.lobbyPlayers.innerHTML = "";
    state.room.players.forEach((p) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = p.name + (p.id === state.me.playerId ? " (toi)" : "");
      li.appendChild(label);
      const right = document.createElement("span");
      if (p.isHost) {
        const crown = document.createElement("span");
        crown.className = "crown";
        crown.textContent = "👑";
        right.appendChild(crown);
      }
      if (!p.connected) {
        const off = document.createElement("span");
        off.className = "offline";
        off.textContent = " hors-ligne";
        right.appendChild(off);
      }
      li.appendChild(right);
      dom.lobbyPlayers.appendChild(li);
    });

    const isHost = state.room.hostId === state.me.playerId;
    const count = state.room.players.length;
    dom.btnStart.classList.toggle("hidden", !isHost);
    dom.btnStart.disabled = count < 3;

    if (isHost) {
      dom.lobbyStatus.textContent = count < 3
        ? `Il faut au moins 3 joueurs pour lancer (${count}/3).`
        : `Prêt à lancer avec ${count} joueurs !`;
    } else {
      dom.lobbyStatus.textContent = "En attente que l'hôte lance la partie...";
    }
  }

  dom.btnStart.addEventListener("click", () => {
    state.socket.emit("room:start", {}, (res) => {
      if (!res.ok) flashError(res.error);
    });
  });

  dom.btnLeaveLobby.addEventListener("click", () => {
    state.socket.emit("room:leave", {}, () => {
      clearSession();
      state.room = null;
      state.game = null;
      route();
    });
  });

  // ---------- ecran de jeu ----------

  function cardFace(card) {
    const div = document.createElement("div");
    div.className = "card " + card.color;
    div.dataset.cardId = card.id;
    div.innerHTML = `<div class="rank">${card.label}</div><div class="suit">${card.symbol}</div>`;
    return div;
  }

  function cardBack(small) {
    const div = document.createElement("div");
    div.className = "card-back";
    return div;
  }

  function renderGame() {
    const game = state.game;
    if (!game) return;

    // Nettoie la selection si les cartes ne sont plus dans la main (ex: apres une pose).
    const handIds = new Set(game.hand.map((c) => c.id));
    state.selectedCardIds = state.selectedCardIds.filter((id) => handIds.has(id));
    if (!(game.phase === "playing" && game.you.isYourTurn && game.lastPlay === null)) {
      // on garde chosenDeclaredRank uniquement pendant le choix de round
    }

    renderOpponents(game);
    renderPile(game);
    renderTurnBanner(game);
    renderRankPicker(game);
    renderActionBar(game);
    renderHand(game);
    renderRevealOverlay(game);
    renderEndOverlay(game);
  }

  function renderOpponents(game) {
    dom.opponentsRow.innerHTML = "";
    game.opponents.forEach((o) => {
      const div = document.createElement("div");
      div.className = "opponent" +
        (o.id === game.currentTurn && game.phase === "playing" ? " current-turn" : "") +
        (o.finished ? " finished" : "");

      const dot = document.createElement("div");
      dot.className = "offline-dot" + (o.connected ? " online" : "");
      div.appendChild(dot);

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = o.name + (o.finished ? " 🏁" : "");
      div.appendChild(name);

      if (!o.finished) {
        const back = document.createElement("div");
        back.className = "card-back-mini";
        back.appendChild(cardBack());
        div.appendChild(back);
      }

      const badge = document.createElement("span");
      badge.className = "count-badge";
      badge.textContent = o.cardCount;
      div.appendChild(badge);

      dom.opponentsRow.appendChild(div);
    });
  }

  function renderPile(game) {
    dom.pileStack.innerHTML = "";
    const shown = Math.min(game.pileCount, 6);
    for (let i = 0; i < shown; i += 1) {
      const c = document.createElement("div");
      c.className = "pile-card";
      c.style.top = `${-i * 3}px`;
      c.appendChild(cardBack());
      dom.pileStack.appendChild(c);
    }
    if (game.pileCount === 0) {
      dom.pileInfo.textContent = "Pile vide — annonce une valeur pour lancer la manche";
    } else {
      dom.pileInfo.textContent = `Valeur annoncée : ${RANK_LABELS[game.roundLeaderRank] || "?"} — ${game.pileCount} carte(s)`;
    }
    dom.sortiesCount.textContent = game.removedQuads.length;
  }

  function renderTurnBanner(game) {
    if (game.phase === "playing") {
      dom.turnBanner.textContent = game.you.isYourTurn ? "À toi de jouer !" : `Tour de ${game.currentTurnName}`;
    } else if (game.phase === "reveal_pending") {
      dom.turnBanner.textContent = "Révélation en cours...";
    } else {
      dom.turnBanner.textContent = "Partie terminée";
    }
  }

  function renderRankPicker(game) {
    const needsRankChoice = game.phase === "playing" && game.you.isYourTurn && game.lastPlay === null;
    dom.rankPicker.classList.toggle("hidden", !needsRankChoice);
    if (!needsRankChoice) return;
    dom.rankPicker.innerHTML = "";
    RANK_ORDER.forEach((rank) => {
      const btn = document.createElement("button");
      btn.className = "rank-btn" + (state.chosenDeclaredRank === rank ? " selected" : "");
      btn.textContent = RANK_LABELS[rank];
      btn.addEventListener("click", () => {
        state.chosenDeclaredRank = rank;
        renderRankPicker(game);
        renderActionBar(game);
      });
      dom.rankPicker.appendChild(btn);
    });
  }

  function quadEligibleRanks(hand) {
    const counts = {};
    hand.forEach((c) => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
    return Object.keys(counts).filter((r) => counts[r] === 4);
  }

  function renderActionBar(game) {
    dom.actionBar.innerHTML = "";

    // Sortir un carré est possible à tout moment, même hors de son tour :
    // ça ne consomme jamais le tour de personne, donc ce bouton n'est pas
    // limité au joueur dont c'est le tour.
    const canDiscardQuads = (game.phase === "playing" || game.phase === "reveal_pending") && !game.you.isFinished;
    if (canDiscardQuads) {
      quadEligibleRanks(game.hand).forEach((rank) => {
        const btn = document.createElement("button");
        btn.className = "btn btn-secondary";
        btn.textContent = `Sortir le carré de ${RANK_LABELS[rank]}`;
        btn.addEventListener("click", () => {
          state.socket.emit("game:quadDiscard", { rank }, (res) => { if (!res.ok) flashError(res.error); });
        });
        dom.actionBar.appendChild(btn);
      });
    }

    if (game.phase !== "playing" || !game.you.isYourTurn) return;

    if (game.you.canAccuseNow) {
      const btn = document.createElement("button");
      btn.className = "btn btn-danger";
      btn.textContent = "🚨 MENTEUR !";
      btn.addEventListener("click", () => {
        state.socket.emit("game:accuse", {}, (res) => { if (!res.ok) flashError(res.error); });
      });
      dom.actionBar.appendChild(btn);
    }

    const playBtn = document.createElement("button");
    playBtn.className = "btn btn-primary";
    const n = state.selectedCardIds.length;
    playBtn.textContent = n > 0 ? `Poser (${n})` : "Poser des cartes";
    const canPlay = n >= 1 && n <= 3 && (game.lastPlay !== null || state.chosenDeclaredRank);
    playBtn.disabled = !canPlay;
    playBtn.addEventListener("click", playSelectedCards);
    dom.actionBar.appendChild(playBtn);
  }

  function playSelectedCards() {
    const game = state.game;
    if (!game) return;
    const n = state.selectedCardIds.length;
    if (n < 1 || n > 3) return flashError("Sélectionne 1, 2 ou 3 cartes.");
    const payload = { cardIds: state.selectedCardIds.slice() };
    if (game.lastPlay === null) {
      if (!state.chosenDeclaredRank) return flashError("Choisis d'abord une valeur pour lancer la manche.");
      payload.declaredRank = state.chosenDeclaredRank;
    }
    state.socket.emit("game:play", payload, (res) => {
      if (!res.ok) return flashError(res.error);
      state.selectedCardIds = [];
      state.chosenDeclaredRank = null;
    });
  }

  dom.btnSortHand.addEventListener("click", () => {
    state.sortHand = !state.sortHand;
    dom.btnSortHand.textContent = state.sortHand ? "✅ Cartes triées" : "🔀 Trier mes cartes";
    dom.btnSortHand.classList.toggle("active", state.sortHand);
    if (state.game) renderHand(state.game);
  });

  function toggleCardSelection(cardId) {
    const idx = state.selectedCardIds.indexOf(cardId);
    if (idx >= 0) {
      state.selectedCardIds.splice(idx, 1);
    } else {
      if (state.selectedCardIds.length >= 3) return flashError("Maximum 3 cartes à la fois.");
      state.selectedCardIds.push(cardId);
    }
    renderHand(state.game);
    renderActionBar(state.game);
  }

  function renderHand(game) {
    dom.hand.innerHTML = "";
    const quadRanks = new Set(quadEligibleRanks(game.hand));
    const canAct = game.phase === "playing" && game.you.isYourTurn;

    const displayedHand = state.sortHand
      ? game.hand.slice().sort((a, b) => RANK_INDEX[a.rank] - RANK_INDEX[b.rank] || a.suit.localeCompare(b.suit))
      : game.hand;

    displayedHand.forEach((card) => {
      const div = cardFace(card);
      if (state.selectedCardIds.includes(card.id)) div.classList.add("selected");
      if (quadRanks.has(card.rank)) div.classList.add("quad-eligible");
      if (canAct) {
        div.addEventListener("pointerdown", (e) => onCardPointerDown(e, card, div));
      } else {
        div.style.cursor = "default";
      }
      dom.hand.appendChild(div);
    });
  }

  // ---------- glisser-deposer (tactile + souris) ----------

  let drag = null;

  function onCardPointerDown(e, card, cardEl) {
    e.preventDefault();
    drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      card,
      cardEl,
      started: false,
      ghost: null
    };
    document.addEventListener("pointermove", onCardPointerMove);
    document.addEventListener("pointerup", onCardPointerUp);
  }

  function onCardPointerMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.started) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.started = true;
      // Le toucher "detache" la carte vers le haut avant de suivre le doigt.
      if (!state.selectedCardIds.includes(drag.card.id)) {
        if (state.selectedCardIds.length < 3) state.selectedCardIds.push(drag.card.id);
      }
      renderHand(state.game);
      const ghost = cardFace(drag.card);
      ghost.classList.add("dragging", "selected");
      if (state.selectedCardIds.length > 1) {
        const badge = document.createElement("div");
        badge.textContent = "x" + state.selectedCardIds.length;
        badge.style.position = "absolute";
        badge.style.top = "-8px";
        badge.style.right = "-8px";
        badge.style.background = "#FFC93C";
        badge.style.color = "#4a3400";
        badge.style.borderRadius = "999px";
        badge.style.padding = "2px 7px";
        badge.style.fontSize = "0.7rem";
        badge.style.fontWeight = "800";
        ghost.appendChild(badge);
      }
      document.body.appendChild(ghost);
      drag.ghost = ghost;
    }

    if (drag.ghost) {
      drag.ghost.style.left = `${e.clientX - 31}px`;
      drag.ghost.style.top = `${e.clientY - 45}px`;
    }

    const mat = dom.pileCenterMat;
    if (mat) {
      const rect = mat.getBoundingClientRect();
      const over = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      mat.classList.remove("drop-ok", "drop-bad");
      if (over) {
        const legal = isCurrentSelectionLegal();
        mat.classList.add(legal ? "drop-ok" : "drop-bad");
      }
    }
  }

  function isCurrentSelectionLegal() {
    const game = state.game;
    if (!game || game.phase !== "playing" || !game.you.isYourTurn) return false;
    const n = state.selectedCardIds.length;
    if (n < 1 || n > 3) return false;
    if (game.lastPlay === null && !state.chosenDeclaredRank) return false;
    return true;
  }

  function onCardPointerUp(e) {
    if (!drag) return;
    document.removeEventListener("pointermove", onCardPointerMove);
    document.removeEventListener("pointerup", onCardPointerUp);

    const mat = dom.pileCenterMat;
    let droppedOnPile = false;
    if (drag.started && mat) {
      const rect = mat.getBoundingClientRect();
      droppedOnPile = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      mat.classList.remove("drop-ok", "drop-bad");
    }
    if (drag.ghost) drag.ghost.remove();

    const wasTap = !drag.started;
    const cardId = drag.card.id;
    drag = null;

    if (wasTap) {
      toggleCardSelection(cardId);
      return;
    }

    if (droppedOnPile) {
      if (isCurrentSelectionLegal()) {
        playSelectedCards();
      } else {
        flashError("Ce coup n'est pas possible pour le moment.");
        renderHand(state.game);
      }
    } else {
      renderHand(state.game);
    }
  }

  // ---------- revelation & fin de partie ----------

  function renderRevealOverlay(game) {
    const show = game.phase === "reveal_pending" && game.pendingReveal;
    dom.overlayReveal.classList.toggle("hidden", !show);
    if (!show) return;
    const r = game.pendingReveal;

    dom.revealCards.innerHTML = "";
    r.cards.forEach((c) => dom.revealCards.appendChild(cardFace(c)));

    const claimed = RANK_LABELS[r.claimedRank] || "?";
    let text = `${r.accuserName} crie Menteur sur ${r.accusedName}, qui annonçait "${claimed}". `;
    text += r.mismatch ? `${r.accusedName} avait menti !` : `Les cartes étaient vraies, ${r.accuserName} s'est trompé !`;
    dom.revealText.textContent = text;

    const canPickup = game.you.canPickupNow;
    dom.btnPickup.classList.toggle("hidden", !canPickup);
    dom.revealWaiting.classList.toggle("hidden", canPickup);
    if (!canPickup) dom.revealWaiting.textContent = `En attente que ${r.loserName} ramasse la pile (${r.pileCount} cartes)...`;
    dom.btnPickup.textContent = `Ramasser la pile (${r.pileCount} cartes)`;
  }

  dom.btnPickup.addEventListener("click", () => {
    state.socket.emit("game:pickup", {}, (res) => { if (!res.ok) flashError(res.error); });
  });

  function renderEndOverlay(game) {
    const show = game.phase === "finished";
    dom.overlayEnd.classList.toggle("hidden", !show);
    if (!show) return;
    dom.endRanking.innerHTML = "";
    game.finishedOrder.forEach((p) => {
      const li = document.createElement("li");
      li.textContent = `${p.label} — ${p.name}`;
      dom.endRanking.appendChild(li);
    });
    const isHost = state.room.hostId === state.me.playerId;
    dom.btnPlayAgain.classList.toggle("hidden", !isHost);
    dom.endWaiting.classList.toggle("hidden", isHost);
  }

  dom.btnPlayAgain.addEventListener("click", () => {
    state.socket.emit("room:playAgain", {}, (res) => { if (!res.ok) flashError(res.error); });
  });

  // ---------- modales (historique + cartes sorties) ----------

  dom.pileCenterBtn.addEventListener("click", () => {
    if (!state.game) return;
    dom.historyList.innerHTML = "";
    state.game.history.slice().reverse().forEach((entry) => {
      const li = document.createElement("li");
      li.textContent = describeHistoryEntry(entry);
      dom.historyList.appendChild(li);
    });
    if (!state.game.history.length) {
      const li = document.createElement("li");
      li.textContent = "Aucune action pour le moment.";
      dom.historyList.appendChild(li);
    }
    dom.modalHistory.classList.remove("hidden");
  });

  dom.pileSortiesBtn.addEventListener("click", () => {
    if (!state.game) return;
    dom.quadsList.innerHTML = "";
    state.game.removedQuads.slice().reverse().forEach((q) => {
      const li = document.createElement("li");
      li.textContent = `${q.playerName} a sorti le carré de ${RANK_LABELS[q.rank]}`;
      dom.quadsList.appendChild(li);
    });
    if (!state.game.removedQuads.length) {
      const li = document.createElement("li");
      li.textContent = "Aucun carré sorti pour le moment.";
      dom.quadsList.appendChild(li);
    }
    dom.modalQuads.classList.remove("hidden");
  });

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.close).classList.add("hidden");
    });
  });

  function describeHistoryEntry(entry) {
    switch (entry.type) {
      case "play":
        return `${entry.playerName} a posé ${entry.count} carte(s) en annonçant ${RANK_LABELS[entry.claimedRank]}`;
      case "quad_discard":
        return `${entry.playerName} a sorti le carré de ${RANK_LABELS[entry.rank]}`;
      case "accuse":
        return `${entry.accuserName} a crié Menteur sur ${entry.accusedName} → ${entry.mismatch ? entry.accusedName + " avait menti" : entry.accuserName + " s'est trompé"}`;
      case "pickup":
        return `${entry.playerName} a ramassé ${entry.count} carte(s)`;
      default:
        return "Action";
    }
  }

  // ---------- connexion socket.io ----------

  function init() {
    state.socket = io();

    state.socket.on("state", ({ room, game }) => {
      state.room = room;
      state.game = game;
      route();
    });

    const saved = loadSession();
    if (saved) {
      state.me.playerId = saved.playerId;
      state.me.name = saved.name;
      dom.inputName.value = saved.name || "";
      state.socket.emit("room:rejoin", { code: saved.code, playerId: saved.playerId }, (res) => {
        if (!res || !res.ok) {
          clearSession();
          route();
        }
      });
    } else {
      route();
    }
  }

  init();
})();
