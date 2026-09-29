# Le Carré · bar à cartes — notes pour Claude

Projet de Mathis (on se parle en français, interface 100 % en français). App web
multijoueur pour jouer aux cartes entre amis au bar, sur téléphone : code de
table à 4 lettres + QR code (esprit Kahoot), table de bar en 3D.
Jeux : Menteur, Président, Ascenseur, Pouilleux, Poker Texas Hold'em, Tarot,
Coinche.
Les règles validées avec Mathis sont dans `README.md` (une section par jeu) et
en commentaire en tête de chaque moteur `server/games/*.js`.

## Mise en ligne (automatique)

- Dépôt GitHub `Tisma5144/Le-Carre`, hébergé sur Render (plan gratuit) qui
  redéploie à chaque push sur `main`.
- Pour publier : tests verts → bump de `version` dans `package.json` (affichée
  en bas de l'accueil via `/version.json`) → commit clair en français → push
  sur `main` (ou PR si Mathis le demande). Puis lui dire ce qui a changé.
- Nouvelle fonctionnalité = version mineure (0.10.0 → 0.11.0), correctif =
  version de patch.

## Pile technique

- Serveur : Node + Express + Socket.io, état en mémoire (`server/index.js`,
  `server/rooms.js`). Pas de base de données.
- Moteur de jeu : `createGame(ids, options)`, `applyAction(state, id, action,
  ctx)` → `{ ok, error?, schedule? }`, `getViewForPlayer(state, id, players)`
  (vue propre à chaque joueur, historique d'événements numérotés), `tick`
  optionnel (appelé après `schedule` ms × `BOT_SPEED`). `minPlayers`,
  `maxPlayers`, `normalizeOptions`, `fullHistory` optionnels.
- Options par jeu réglées dans le salon : `room:setOptions` →
  `room.options[jeu]`. Niveau des robots : `room.botLevel` (facile/normal/fort).
- Robots : `server/bots.js` → `botActions(jeu, state, id, niveau)` renvoie des
  actions candidates ; `scheduleBots` (index.js) en joue une à la fois avec un
  délai « humain ». Un joueur qui quitte en pleine partie est remplacé par un
  robot (`leftGame`).
- Client : modules ES sans build, Three.js. `public/js/main.js` (routage,
  catalogue des jeux), `public/js/game/cardTable.js` (78 entités de cartes 3D
  réconciliées par zones : me, opp, trick, won, board, shown, chien, center…),
  `public/js/ui/hud.js` (plaques, annonces, panneaux), un adaptateur par jeu
  dans `public/js/games/*.js` (desired, refresh, onEvent, legality,
  commitPlay, playButton, chips, trayHtml, historyHtml, rulesHtml,
  renderLobbyOptions…).
- Jetons de poker en 3D : `public/js/scene/chips.js` (`ChipLayer` : piles de
  mise, pot, vols mise → pile, piles → pot, pot → gagnant), piloté par
  `syncChips` dans `public/js/games/poker.js`. Tapis de chaque joueur en 3D
  près de sa bière : `stackSpots` essaie plusieurs places et garde celle qui
  ne recouvre ni étiquette, ni texte, ni cartes (pensé pour le téléphone).
- Cartes entièrement dessinées en canvas : `public/js/cards/cardArt.js`
  (figures, As, atouts et Excuse du Tarot, dos). Aperçus : `/dev/cards.html`,
  `/dev/tarot.html`.
- Boissons : chacun choisit la sienne (salon « Ta boisson » ou menu « Ma
  boisson », retenue dans le navigateur) → `room:setDrink` →
  `players[id].drink`. Verres 3D dans `public/js/scene/drinks.js`
  (`makeDrink`), posés par `world.setDrinks` ; les robots en tirent une au
  hasard.
- PWA plein écran (`manifest.webmanifest`, `sw.js` network-first).

## Ajouter un jeu

Moteur dans `server/games/`, enregistrement dans `GAMES` (index.js) + les
événements `socket.on("game:…")`, IA dans `bots.js` (trois niveaux), adaptateur
client dans `public/js/games/`, ajout à `ADAPTERS` et `CATALOG` (main.js),
test `test/simulate-<jeu>.js` + script npm, section règles dans le README.
Toujours poser des questions à Mathis sur les règles avant de coder un jeu.

## Tests

```
npm run test:menteur && npm run test:president && npm run test:ascenseur
npm run test:pouilleux && npm run test:poker && npm run test:tarot
npm run test:coinche
npm run test:reconnexion && npm run test:robots
```

Vérification visuelle : Playwright + Chromium (swiftshader, ~2 images/s : les
animations sont lentes en capture, attendre avant les screenshots), viewport
téléphone 390×844. Lancer le serveur avec `BOT_SPEED=0.3 PORT=3999 node
server/index.js` pour accélérer les robots. `window.__menteur` expose S, socket,
table, world, hud pour les scripts.

## Pièges connus

- Ne jamais écraser `transform` d'un élément centré par `translateX(-50%)` avec
  une animation : utiliser la propriété `translate`.
- Le jeton de tour se place via `table.freeSpot` (évite cartes, main, bandeaux).
- `cardTable.setDeckSize(78)` pour le Tarot, 32 pour la Coinche ; les autres
  jeux utilisent 52 cartes, les autres restent en zone `spare`.

## À faire / pistes

- Poker : minuteur de parole optionnel.
- Jeux personnalisés (tuile « bientôt » dans le menu).
- Si Render gratuit gêne (mise en veille, tables perdues) : plan payant ou
  sauvegarde des tables.
