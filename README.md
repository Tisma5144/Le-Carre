# Site Carte — Menteur

Une petite appli web pour jouer aux cartes en ligne entre amis, façon Kahoot :
un code de salon à 4 lettres, pas d'inscription, tout se passe dans le navigateur.

Premier jeu implémenté : **Menteur** (bluff aux cartes). L'architecture est
pensée pour accueillir d'autres jeux prédéfinis (et plus tard des jeux
personnalisés) sans tout réécrire.

## Règles du Menteur implémentées

- Le paquet de 52 cartes est distribué en entier entre tous les joueurs (3 à 8).
- Le joueur qui lance un round choisit librement une valeur (ex: "Rois") et
  pose 1, 2 ou 3 cartes face cachée en prétendant que ce sont des Rois.
- Tant que le round continue, chaque joueur doit à son tour poser 1 à 3
  cartes en prétendant *aussi* que ce sont des cartes de cette même valeur
  (bluff autorisé : les cartes réellement posées peuvent être différentes).
- Si un joueur a les 4 cartes d'une même valeur en main, il peut les sortir
  directement du jeu (pile "cartes sorties", visible par tous) **à tout
  moment**, même si ce n'est pas son tour. Cette action ne consomme jamais
  de tour : un joueur peut sortir un carré puis quand même jouer ou
  accuser normalement si c'est son tour.
- Seul le joueur suivant, juste avant de jouer, peut appuyer sur **MENTEUR !**
  pour contester la pose précédente (ça évite les clics simultanés). S'il
  joue ou sort un carré à la place, la pose précédente est définitivement
  validée.
- Une accusation retourne les dernières cartes posées : si elles ne
  correspondent pas à la valeur annoncée, le bluffeur a perdu ; sinon,
  l'accusateur a perdu. Le perdant doit cliquer sur **Ramasser** pour
  prendre toute la pile du round dans sa main.
- Le joueur juste après celui qui a ramassé commence le round suivant.
- Le premier joueur à vider sa main gagne. La partie continue jusqu'à ce
  qu'il ne reste plus qu'un seul joueur avec des cartes (classement complet).

C'est une version "maison" simplifiée du Menteur — voir la section
[Pistes d'évolution](#pistes-dévolution) pour les variantes possibles.

## Lancer le projet en local

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
npm install
npm start
```

Puis ouvre `http://localhost:3000` dans plusieurs onglets/navigateurs pour
simuler plusieurs joueurs (ou partage l'adresse de ton réseau local à des
amis sur le même Wi-Fi, ex: `http://192.168.1.X:3000`).

### Tester automatiquement la logique du jeu

Un script simule une partie complète avec 4 joueurs-robots (utile après
avoir modifié les règles, pour vérifier que tout tourne sans bug) :

```bash
npm run test:menteur
```

## Déployer en ligne

L'appli est un simple serveur Node (Express + Socket.io), déployable sur
n'importe quel hébergeur qui supporte les WebSockets et Node.js :

- **Railway** ou **Render** : le plus simple, connecte le dépôt Git, la
  commande de démarrage est `npm start`, le port est lu automatiquement
  depuis la variable d'environnement `PORT`.
- **Fly.io** : fonctionne aussi très bien avec un simple `Dockerfile` Node.
- ⚠️ Vercel/Netlify (sans plan spécifique) ne conviennent pas tels quels
  car ce sont des fonctions serverless, peu adaptées aux WebSockets
  persistants de Socket.io.

Aucune base de données n'est utilisée : tout l'état des parties est gardé
en mémoire sur le serveur. C'est volontairement simple pour ce premier jeu,
mais ça veut dire qu'un redémarrage du serveur efface les parties en cours.

## Structure du projet

```
server/
  index.js          serveur Express + Socket.io, gère les évènements réseau
  rooms.js           gestion des salons (codes à 4 lettres, joueurs, reconnexion)
  deck.js             utilitaires génériques de paquet de 52 cartes (réutilisables)
  games/
    menteur.js        moteur du jeu Menteur (règles, tours, validation)
public/
  index.html           structure de la page (accueil, salle d'attente, plateau)
  style.css             thème visuel façon Kahoot
  app.js                logique client, rendu, glisser-déposer, Socket.io
test/
  simulate-menteur.js  simulation automatisée d'une partie complète
```

L'architecture sépare bien le **moteur de jeu** (`server/games/menteur.js`)
du **reste du serveur** : pour ajouter un nouveau jeu prédéfini, il suffit
d'écrire un nouveau module dans `server/games/` avec les mêmes fonctions
(`createGame`, `applyAction`, `getViewForPlayer`) et de l'enregistrer dans
`server/index.js`. C'est aussi la base qui servira plus tard pour les jeux
personnalisés créés par les joueurs.

## Pistes d'évolution

- Permettre à **n'importe quel joueur** (pas seulement le suivant) de crier
  Menteur, avec gestion du "premier arrivé" côté serveur.
- Historique de partie persistant, avatars, sons, animations plus poussées
  pour le glisser-déposer.
- Système de comptes légers pour retrouver ses parties précédentes.
- Ajouter d'autres jeux prédéfinis (Président, Bataille, Uno-like...) en
  réutilisant `server/deck.js` et l'architecture de salons.
- Éditeur de jeux personnalisés (règles configurables par les joueurs), comme
  évoqué dans la description du projet.
- Persistance des salons (Redis) pour survivre à un redémarrage du serveur
  et permettre plusieurs instances du serveur en production.
