# Le Carré — bar à cartes en 3D

Jeu de cartes en ligne entre amis, façon Kahoot : un code de table à 4 lettres
(ou un QR code), pas d'inscription, tout se passe dans le navigateur — sur
téléphone comme sur ordinateur.

Cinq jeux sont disponibles, choisis par le patron de la table dans le salon :
**Le Menteur**, **Le Président**, **L'Ascenseur**, **Le Pouilleux** et le
**Poker Texas Hold'em**.

Le jeu se joue autour d'une **table de bar en 3D** : plateau en
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
- Un carré (4 cartes identiques) sort **automatiquement** du jeu dès qu'un
  joueur l'a en main (à la distribution ou après avoir ramassé) ; ça ne
  compte jamais comme un tour.
- Le premier à vider sa main gagne ; le dernier avec des cartes… paie sa tournée.

## Règles du Président (règles maison)

- 52 cartes distribuées en entier (3 à 8 joueurs). Ordre : 3 < 4 < … < Roi < As < 2.
- On pose 1 à 4 cartes de même valeur ; pour suivre, même nombre de cartes,
  valeur égale ou supérieure. Sinon on passe, et on est hors du pli jusqu'à ce
  qu'il soit ramassé.
- « Ou rien » : poser la même valeur que le joueur précédent oblige le suivant
  à poser cette valeur ou à passer.
- Le 2 ferme le pli. Un carré (4 cartes identiques qui se suivent) ferme le pli.
- Carré magique : n'importe qui peut compléter un carré au sommet du pli avec
  1, 2 ou 3 cartes, même hors de son tour ; il rejoue ensuite.
- Sauf en triple : quand on joue des brelans, personne ne peut fermer le carré
  avec la 4e carte seule.
- Interdit de finir sur un 2 : on finit Trou du cul.
- Première manche : la Dame de cœur ouvre. Ensuite, le Trou du cul ouvre.
- Échange : le Trou du cul donne ses 2 meilleures cartes au Président qui en
  rend 2 au choix ; 1 carte entre Vice-trou et Vice-président (dès 4 joueurs).
- Points : Président +2, Vice +1, Neutre 0, Vice-trou −1, Trou du cul −2.

## Règles de l'Ascenseur (règles maison)

- 3 à 8 joueurs. Le nombre de cartes change à chaque manche : par défaut on
  monte de 1 jusqu'au maximum (52 ÷ nombre de joueurs) puis on redescend
  jusqu'à 1. Dans le salon, le patron règle le maximum, le sens (monte puis
  descend, descend puis monte, monte seulement, descend seulement) et le pas
  (de 1 en 1 ou de 2 en 2).
- On retourne la carte du dessus du talon : sa couleur est l'atout. S'il ne
  reste aucune carte, la manche est sans atout.
- Chacun annonce à son tour le nombre de plis qu'il pense faire, en commençant
  à gauche du donneur. Le donneur, dernier à annoncer, ne peut pas faire tomber
  le total juste.
- Il faut fournir la couleur demandée si on l'a ; sinon on joue ce qu'on veut.
- Le plus gros atout gagne le pli, sinon la plus forte carte de la couleur
  demandée (2 < … < Roi < As). Le gagnant entame le pli suivant.
- Points : pari réussi = 40 points par pli (20 points pour une annonce de 0
  réussie) ; pari raté = −40 points par pli d'écart.

## Règles du Pouilleux (le Puant)

- 2 à 8 joueurs. On retire le valet de trèfle : le valet de pique reste seul,
  c'est le Pouilleux. Toutes les cartes sont distribuées.
- Une paire = même valeur et même couleur (rouge/noir) ; les paires sortent
  automatiquement.
- À son tour, on touche une des cartes tendues par son voisin de gauche pour
  la tirer ; puis c'est à ce voisin de tirer. On peut mélanger sa main.
- Plus de cartes = tiré d'affaire. Le dernier, avec le valet de pique, est le
  Pouilleux.

## Règles du Poker Texas Hold'em

- 2 à 8 joueurs, no limit. Tapis de départ et rythme des blindes réglables
  dans le salon (par défaut 1 000 jetons, blindes 10/20 doublées toutes les
  10 mains).
- Deux cartes cachées chacun, puis flop, turn et river, avec un tour de
  paroles à chaque étape (se coucher, parole, suivre, relancer, tapis).
- Meilleure main de 5 cartes parmi 7 ; pots annexes et partages gérés.
- Plus de jetons : éliminé, ou recave possible (réglage du patron, qui
  arrête alors la partie quand il veut).

## Ce que fait l'interface

- On joue dans le sens des aiguilles d'une montre : le joueur suivant est
  assis à ta gauche.
- Emotes : bouton 😀 en haut à droite, l'emoji s'envole au-dessus de ton nom
  chez tout le monde.
- Robots : dans le salon, le patron peut ajouter des robots (« 🤖 Ajouter un
  robot ») pour compléter la table, et les renvoyer (✕). Ils savent jouer aux
  trois jeux (`server/bots.js`).
- Règles consultables depuis le salon (« 📜 Lire les règles »).
- Ascenseur : pendant une manche, l'historique ne montre que le dernier pli ;
  l'onglet Scores affiche un graphique de l'évolution des scores et le
  détail des points manche par manche.

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

## Plein écran sur téléphone

- Android : le jeu passe en plein écran dès le premier bouton touché (bouton
  « Plein écran » sur l'accueil et dans le menu ☰ pour sortir / revenir). On
  peut aussi l'installer (« Ajouter à l'écran d'accueil ») : il s'ouvre alors
  comme une appli, sans barre d'adresse.
- iPhone : Safari ne permet pas le plein écran d'une page. Le bouton explique
  comment ajouter Le Carré à l'écran d'accueil (Partager → « Sur l'écran
  d'accueil ») : ouvert depuis l'icône, le jeu est en plein écran.
- Fichiers : `public/manifest.webmanifest`, `public/sw.js`, `public/icons/`,
  `public/js/ui/fullscreen.js`.

## Connexion instable (téléphones, Wi-Fi du bar)

- Reconnexion automatique, et un bandeau « Connexion perdue… reconnexion »
  pendant les coupures.
- Quand l'appli revient au premier plan (écran rallumé, retour depuis une
  autre appli) et toutes les 15 s, le téléphone vérifie qu'il est à jour et
  se resynchronise tout seul, sans actualiser la page.
- Côté serveur, un joueur n'est plus marqué hors ligne par la mort tardive
  de son ancienne connexion (cause du bug « je perds le fil de la partie »).
- Test : `npm run test:reconnexion`.

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
npm run test:president
npm run test:ascenseur
npm run test:pouilleux
npm run test:poker
npm run test:reconnexion
npm run test:robots
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
  games/president.js  moteur du Président (plis, ou rien, carré magique, manches)
  games/ascenseur.js  moteur de l'Ascenseur (annonces, atout, plis, scores)
  games/pouilleux.js  moteur du Pouilleux
  games/poker.js      moteur du poker Texas Hold'em (+ pokerEval.js : mains)
  bots.js             robots joueurs (les 5 jeux)
public/
  index.html          structure de la page
  css/main.css        thème bar : bois, laiton, ardoise
  js/main.js          chef d'orchestre : réseau, écrans, salon, tours
  js/games/menteur.js   interface propre au Menteur (annonce, révélation…)
  js/games/president.js interface propre au Président (pli, échange, scores)
  js/games/ascenseur.js interface propre à l'Ascenseur (annonces, pli, réglages)
  js/cards/cardArt.js dessin procédural des cartes (canvas)
  js/scene/world.js   scène 3D : table, lampe, pintes, caméra adaptative
  js/scene/textures.js textures procédurales (bois, feutre, sous-bocks…)
  js/scene/cardMeshes.js cartes 3D (géométrie, textures, halo)
  js/game/cardTable.js les 52 cartes 3D : zones, vols animés, glisser-déposer
  js/ui/hud.js        interface HTML par-dessus la 3D
  js/ui/audio.js      bruitages synthétisés (aucun fichier audio)
  dev/cards.html      planche d'aperçu des cartes
test/
  simulate-menteur.js   simulation d'une partie complète de Menteur
  simulate-president.js 60 parties de Président avec vérification des règles
  simulate-ascenseur.js 40 parties d'Ascenseur avec vérification des règles
```

Le principe clé côté client : les 52 cartes existent en permanence dans la
scène. À chaque état reçu du serveur, `cardTable.applyState()` décide dans quelle
zone doit être chaque carte (ma main, main d'un adversaire, tapis, révélation,
cartes sorties) et fait voler celles qui changent de zone. Toutes les animations
découlent donc de l'état du jeu, ce qui les rend robustes aux reconnexions.

## Pistes

- Ajouter un jeu : un moteur dans `server/games/`, un adaptateur dans
  `public/js/games/`, et une ligne dans le catalogue de `main.js`.
- Éditeur de jeux personnalisés.
- Remplacer automatiquement un joueur qui quitte en pleine partie.
