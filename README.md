# MagicBuyer-UT — sniper pour le web app EA FC 27

Script Tampermonkey qui ajoute un sniper / autobuyer au web app **EA SPORTS FC 27 Ultimate Team** :
recherche en boucle sur le marché des transferts, achat immédiat des cartes sous ton prix max (fixe ou
au % du prix FUTBIN suivi en direct), mise en vente automatique au prix FUTBIN, prix FUTBIN sur chaque
carte, import des solutions FUTBIN dans les DCE avec achat des joueurs manquants, pauses et arrêts configurables.

> ⚠️ **À lire avant d'utiliser.** L'automatisation du web app est contraire aux conditions d'utilisation d'EA.
> EA peut restreindre l'accès au marché des transferts (soft ban), demander des captchas, voire bannir le compte.
> Utilise ce script à tes risques ; les auteurs ne sont pas responsables d'une sanction sur ton compte.

## Installation

1. Installe [Tampermonkey](https://www.tampermonkey.net/) sur Chrome, Edge ou Brave.
   Sur Chrome récent, active **« Autoriser les scripts utilisateur »** dans les détails de l'extension Tampermonkey.
2. Ouvre `fut-auto-buyer.user.js` depuis la [dernière release](https://github.com/AMINE1921/MagicBuyer-UT/releases/latest) et clique sur **Installer**.
3. Ouvre le [web app FC 27](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/) et connecte-toi.

Le marché des transferts doit être débloqué sur ton compte.

## Démarrage rapide

1. Clique sur l'onglet **MagicBuyer** (barre de navigation EA) ou sur la pastille **MB** en bas à droite.
2. Onglet **Cible** : tape le nom du joueur et choisis-le dans la liste.
3. Renseigne le **Prix d'achat max** (achat immédiat) et, si tu veux revendre, le **Prix de revente**
   (le panneau affiche le net après la taxe EA de 5 % et le bénéfice par carte).
4. Clique sur **Tester la recherche (sans acheter)** pour voir ce que le marché renvoie (en vert : ce que le bot achèterait).
5. Clique sur **▶ Démarrer**. Tu peux fermer le panneau : la pastille affiche l'état, les recherches et les achats.

Autre méthode : règle ta recherche dans **Transferts → Marché des transferts** d'EA (rareté, poste, style de jeu…)
puis clique sur **⚡ Sniper cette recherche** : un filtre est créé avec exactement ces critères.

## Prix FUTBIN

Toutes les fonctions de prix utilisent **FUTBIN** (pages lues comme dans ton navigateur, plateforme console ou PC
selon ton compte). Onglet **FUTBIN** : bouton **Tester FUTBIN** pour vérifier l'accès.

- **Achat au % du prix FUTBIN** (onglet Cible → Prix d'achat → Mode) : par exemple 90 % ; le prix d'achat max
  est recalculé à chaque mise à jour du prix. Un prix fixe peut servir de plafond absolu.
  Sans prix FUTBIN récent (moins de 5 min), le filtre attend : jamais d'achat sur un prix périmé.
- **Revente au % du prix FUTBIN** (onglet Vente, ou par filtre) : le prix de la version achetée est relu juste
  après l'achat. Sans prix FUTBIN, la carte va dans la liste des transferts sans être listée.
- **Relist au prix FUTBIN** et bouton **Lister au prix FUTBIN** (onglet Transferts) pour les cartes disponibles et invendues.
- **Étiquette de prix** en haut de chaque carte joueur (club, marché, transferts, équipes, DCE) ; clic = page FUTBIN.
- **Panneau « Mettre en vente » d'EA** : prix FUTBIN de la carte et bouton **Remplir** (tu valides avec le bouton EA).

Rafraîchissement intelligent : les cibles du bot et les achats DCE sont relus toutes les 60 à 120 s, les cartes
affichées toutes les ~2 min (moins souvent si le prix ne bouge pas), une seule requête FUTBIN à la fois, espacées,
ralentissement automatique si FUTBIN bloque, et un saut de prix anormal est vérifié une seconde fois avant d'être utilisé.
FUTBIN ne pousse pas ses prix : ils sont relus régulièrement tant que la carte est suivie.

Si FUTBIN renvoie une vérification Cloudflare, ouvre futbin.com dans un onglet et passe la vérification ;
le secours « page FUTBIN cachée » (iframe invisible) prend le relais quand la requête directe est refusée.

## DCE : solutions FUTBIN

1. Ouvre l'équipe d'un défi (écran avec le terrain) et clique sur **⚡ Solution FUTBIN** en haut de l'écran.
2. Colle le lien FUTBIN de la solution (page de l'équipe) puis **Charger** : formation, 11 joueurs, ceux de ton club
   (et du stockage DCE, prêts exclus, non échangeables en priorité) et ceux **à acheter** avec leur prix FUTBIN.
3. **Placer dans l'équipe** : la formation est appliquée et les joueurs sont placés à un poste où ils sont jouables.
4. Vérifie ou modifie le **prix max** de chaque manquant (prix FUTBIN + marge réglable), puis **Acheter les manquants** :
   recherche exacte de la version, la moins chère d'abord, achat, envoi au club et placement dans le défi.

Le défi n'est jamais envoyé automatiquement : c'est toi qui cliques sur « Envoyer ». Captcha, session expirée ou
limitation EA arrêtent l'achat immédiatement ; le bouton **Stop** l'arrête à tout moment.

## Comment le sniper évite de rater une affaire

- **Résultats frais à chaque recherche** : le cache du web app est vidé et chaque requête est différente
  (anti-cache « automatique » : l'enchère max varie *au-dessus* de ton prix d'achat max, donc aucune annonce achetable n'est exclue).
- **Achat immédiat** dès la réponse d'EA, sans attendre FUTBIN ni aucune autre requête.
- **La moins chère d'abord**, puis la plus récente à prix égal ; tes propres annonces sont ignorées.
- **Revente après l'achat**, jamais pendant : la recherche suivante n'est pas retardée.
- **Onglet actif en arrière-plan** : Chrome ralentit les onglets cachés ; l'option « Garder l'onglet actif » l'en empêche
  (une icône haut-parleur apparaît sur l'onglet, aucun son n'est émis).

## Réglages

| Onglet | Réglages principaux |
| --- | --- |
| **Cible** | Filtres enregistrés, rotation entre filtres, joueur, qualité, poste, note min/max, prix d'achat (fixe ou % FUTBIN en direct, plafond), revente (onglet Vente, fixe ou % FUTBIN), enchère max, IDs avancés (version exacte, rareté, nation, ligue, club, style). |
| **Achat** | Achats max par recherche, arrêt après N achats, réserve de coins, seuil de résultats, ignorer les gardiens, enchères (fenêtre de fin, surenchère, enchères actives max). |
| **Vente** | Mise en vente automatique / envoi en liste des transferts / rien, prix fixe ou % du prix FUTBIN, durée, bénéfice minimum. |
| **Timing** | Profils Prudent / Normal / Rapide, temps entre recherches, recherches max par minute, pause toutes les N recherches, durée de pause, arrêt automatique, délai après achat, anti-cache, pages parcourues, pause de sécurité sur limitation EA. |
| **Transferts** | État de la liste, relist des invendus (même prix ou prix FUTBIN), mise en vente groupée au prix FUTBIN, vider les vendus, arrêt si la liste est pleine. |
| **FUTBIN** | Test d'accès, plateforme des prix, fréquence de rafraîchissement, garde-fou sur les sauts de prix, étiquettes sur les cartes, réglages des achats DCE. |
| **Alertes** | Sons, notifications du navigateur, webhook Discord, bot Telegram, choix des événements notifiés. |

Formats acceptés pour les durées : `5-9` (secondes), `4.5-7`, `40-80S`, `5M`, `1-2H`, `1D`.
Toutes les valeurs sont enregistrées automatiquement (stockage Tampermonkey).

### Profils de timing

| Profil | Entre deux recherches | Max / minute | Pause | Arrêt auto |
| --- | --- | --- | --- | --- |
| Prudent | 8 à 14 s | 6 | 60–120 s toutes les 12–18 recherches | 1–2 h |
| Normal (défaut) | 5 à 9 s | 10 | 40–80 s toutes les 15–25 recherches | 2–3 h |
| Rapide | 3 à 5 s | 15 | 30–60 s toutes les 20–30 recherches | 1–1,5 h |

Plus le rythme est rapide, plus EA déclenche vite des captchas et des limitations.

### Sécurité

- **Captcha (458)**, **session expirée (401)**, **marché verrouillé (494)**, **compte bloqué** : arrêt immédiat + alerte.
- **Trop de requêtes (429) / blocage temporaire (512, 521)** : pause de sécurité (4 à 8 min par défaut), arrêt si ça se répète.
- **3 recherches en échec d'affilée** : arrêt.
- Codes d'erreur personnalisés : onglet Timing → Erreurs EA.

Le script ne résout jamais les captchas : résous-le toi-même dans le web app, puis relance.

## Compiler depuis les sources

```bash
npm install
npm run build:prod
```

Le script est généré dans `dist/fut-auto-buyer.user.js` (en-tête Tampermonkey dans `tampermonkey-header.js`).

## Nouveautés 5.1.1

- DCE : lecture des solutions FUTBIN corrigée (l'équipe est lue dans les données de la page, plus dans l'affichage) :
  formation, poste exact de chaque joueur comme sur FUTBIN, poste bloqué du défi respecté, prix de la page repris tout de suite.

## Nouveautés 5.1.0

- Achat au % du prix FUTBIN par filtre, avec prix suivi en direct pendant le bot (plafond optionnel).
- Revente et relist au % du prix FUTBIN, mise en vente groupée de la liste des transferts au prix FUTBIN.
- Étiquette de prix FUTBIN sur toutes les cartes joueur et bouton « Remplir » dans le panneau de mise en vente d'EA.
- DCE : import d'une solution FUTBIN (formation + joueurs du club), achat des manquants au prix FUTBIN modifiable.
- Nouvel onglet FUTBIN (test d'accès, rafraîchissement intelligent, garde-fou sur les sauts de prix).
- FUTWIZ retiré : FUTBIN sert de source unique. Les anciens réglages « prix de référence » sont convertis automatiquement.

## Nouveautés 5.0.0

Réécriture complète du moteur et de l'interface pour FC 27 :

- Moteur de snipe réécrit sur les vraies API du web app FC 27 (`UTSearchCriteriaDTO`, `services.Item`), sans réécriture d'URL ni hooks fragiles.
- Corrige le blocage du bot après le premier achat, l'absence d'arrêt sur captcha, le prix FUTBIN qui remplaçait le prix max,
  l'anti-cache désactivé sur les joueurs ciblés, les réglages jamais sauvegardés et la boucle de rendu qui chargeait le processeur.
- Nouveau panneau latéral (le web app reste utilisable), pastille flottante, journal filtrable, export CSV, test de recherche sans achat,
  import d'une recherche EA, rotation entre plusieurs filtres, profils de timing, enchères, notifications Discord/Telegram.
