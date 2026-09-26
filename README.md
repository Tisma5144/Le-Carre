# Le Menteur — Site Carte (version 3D)

Jeu de cartes en ligne entre amis, façon Kahoot : un code de table à 4 lettres
(ou un QR code), pas d'inscription, tout se passe dans le navigateur — sur
téléphone comme sur ordinateur.

Depuis la v0.2, le jeu se joue autour d'une **table de bar en 3D** : plateau en
lattes de bois, tapis de feutre, lampe suspendue, pintes sur leurs sous-bocks,
jeton de laiton qui indique à qui c'est le tour, et des cartes entièrement
illustrées (figures dessinées, As ornés, dos au masque vénitien).

## Règles du Menteur (règles maison)

- Le paquet de 52 cartes est distribué en entier entre tous les joueurs (3 à 8).
- Le joueur qui ouvre la manche pose 1 à 3 cartes face cachée et annonce une
  valeur (« Deux Rois ! »).
- Tant que la manche continue, chacun à son tour pose 1 à 3 cartes en
  prétendant la **même valeur**. Le bluff est permis.
- Seul le joueur suivant, juste avant de jouer, peut crier **MENTEUR !** sur la
  pose précédente. Les cartes sont retournées : si c'était un bluff, le menteur
  ramasse tout le tapis, sinon c'est l'accusateur. Le perdant clique sur
  **Ramasser**.
- Le joueur après celui qui a ramassé ouvre la manche suivante.
- Un carré (4 cartes identiques) peut être sorti du jeu **à tout moment** ; ça
  ne compte jamais comme un tour.
- Le premier à vider sa main gagne ; le dernier avec des cartes… paie sa tournée.

## Ce que fait l'interface

- Distribution animée des cartes, pose avec vol des cartes une par une (on voit
  combien de cartes sont posées), révélation en grand avec halo vert (vraie
  carte) ou rouge (bluff) et tampon « MENTEUR ! » / « SINCÈRE ! ».
- Main en éventail : toucher une carte la soulève, glisser sur le tapis le fait
  briller en vert si le coup est permis, en rouge sinon. Bouton « Poser » en
  alternative, bouton de tri.
- Adversaires assis autour de la table (éventail de dos de cartes + étiquette
  avec nombre de cartes, bulle de dialogue « Deux Dames ! »).
- Plaque en laiton qui affiche la valeur annoncée, bandeau « À toi de jouer ! »,
  vibration du téléphone et petit carillon quand c'est ton tour.
- Salle d'attente sur ardoise avec QR code et bouton de partage du lien.
- Historique de la manche, cartes sorties, règles, son on/off, revanche.
- Reconnexion automatique si on recharge la page.

## Lancer en local

Prérequis : Node.js 18 ou plus récent.

```bash
npm install
npm start
```

Puis ouvre `http://localhost:3000`. Pour jouer avec d'autres appareils sur le
même Wi-Fi : `http://ADRESSE-IP-DU-PC:3000` (http, pas https).

Aperçu de toutes les cartes dessinées : `http://localhost:3000/dev/cards.html`.

Test automatique de la logique serveur (4 robots jouent une partie complète) :

```bash
npm run test:menteur
```

## Déploiement (Render)

Service web Node : build `npm install`, démarrage `npm start`, plan Free.
Toutes les bibliothèques (Three.js, polices, QR code) sont servies par le
serveur lui-même depuis `node_modules`, aucun CDN externe n'est nécessaire.

## Structure

```
server/
  index.js            serveur Express + Socket.io (+ fichiers /vendor)
  rooms.js            salons, codes à 4 lettres, reconnexion
  deck.js             paquet de 52 cartes générique
  games/menteur.js    moteur du Menteur (règles, tours, événements numérotés)
public/
  index.html          structure de la page
  css/main.css        thème bar : bois, laiton, ardoise
  js/main.js          chef d'orchestre : réseau, écrans, tours, révélation
  js/cards/cardArt.js dessin procédural des cartes (canvas)
  js/scene/world.js   scène 3D : table, lampe, pintes, caméra adaptative
  js/scene/textures.js textures procédurales (bois, feutre, sous-bocks…)
  js/scene/cardMeshes.js cartes 3D (géométrie, textures, halo)
  js/game/cardTable.js les 52 cartes 3D : zones, vols animés, glisser-déposer
  js/ui/hud.js        interface HTML par-dessus la 3D
  js/ui/audio.js      bruitages synthétisés (aucun fichier audio)
  dev/cards.html      planche d'aperçu des cartes
test/
  simulate-menteur.js simulation d'une partie complète
```

Le principe clé côté client : les 52 cartes existent en permanence dans la
scène. À chaque état reçu du serveur, `cardTable.applyState()` décide dans quelle
zone doit être chaque carte (ma main, main d'un adversaire, tapis, révélation,
cartes sorties) et fait voler celles qui changent de zone. Toutes les animations
découlent donc de l'état du jeu, ce qui les rend robustes aux reconnexions.

## Pistes

- Autres jeux prédéfinis (Président, Bataille…) en réutilisant la table 3D.
- Éditeur de jeux personnalisés.
- Remplacer automatiquement un joueur qui quitte en pleine partie.
