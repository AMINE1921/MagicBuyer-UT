# MagicBuyer-UT — sniper pour le web app EA FC 27

Script Tampermonkey qui ajoute un sniper / autobuyer au web app **EA SPORTS FC 27 Ultimate Team** :
recherche en boucle sur le marché des transferts, achat immédiat des cartes sous ton prix max (fixe ou
au % du prix FUTBIN suivi en direct), mise en vente automatique au prix FUTBIN, prix FUTBIN sur chaque
carte, import des solutions FUTBIN dans les DCE avec achat des joueurs manquants, pauses et arrêts configurables.
Il ajoute aussi des outils (raccourcis clavier, compteur de requêtes EA, bonnes affaires, prix min EA, club, packs)
et un planificateur pour la **Galerie** FC 27 (collections, paliers, bonus, achat des joueurs manquants).

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
  est recalculé à chaque mise à jour du prix. Un prix fixe peut servir de plafond absolu. Fonctionne pour une version
  précise, pour toutes les versions d'un joueur, ou pour tous les joueurs d'un filtre (liste FUTBIN) : chaque carte
  a son propre prix max.
  Sans prix FUTBIN récent (moins de 5 min), le filtre attend : jamais d'achat sur un prix périmé.
- **Revente au % du prix FUTBIN** (onglet Vente, ou par filtre) : le prix de la version achetée est relu juste
  après l'achat. Sans prix FUTBIN, la carte va dans la liste des transferts sans être listée.
- **Relist au prix FUTBIN** et bouton **Lister au prix FUTBIN** (onglet Transferts) pour les cartes disponibles et invendues.
- **Jamais à perte** (onglet Vente, activé par défaut) : si le prix FUTBIN baisse juste après l'achat, la carte est mise
  en vente au seuil de rentabilité (prix payé + taxe EA de 5 % + bénéfice minimum), jamais en dessous.
- **Anti-perte avant l'achat** (onglet Achat, activé par défaut) : le bot n'achète pas (et n'enchérit pas) si la revente
  prévue ne laisse pas le bénéfice minimum après la taxe EA. Revente prévue = prix fixe, ou prix FUTBIN × bas de la plage
  de vente, ramenée juste sous une annonce moins chère de la même carte vue dans la recherche. Un réglage qui perd
  forcément (ex. achat 95 % et vente 99 % du prix FUTBIN) est signalé au démarrage.
- **Achat immédiat comparé à FUTBIN** : sous le bouton « Achat immédiat » d'une annonce, prix FUTBIN, % payé et
  bénéfice (vert) ou perte (rouge) d'une revente au prix FUTBIN après taxe. La touche d'achat immédiat (B) est bloquée
  quand l'achat ferait perdre des pièces (le clic à la souris reste possible).
- **Étiquette de prix** en haut de chaque carte joueur (club, marché, transferts, équipes, DCE) ; clic = page FUTBIN.
- **Panneau « Mettre en vente » d'EA** : prix FUTBIN de la carte et bouton **Remplir** (tu valides avec le bouton EA).
  Bouton **Prix min EA** : quelques recherches exactes trouvent l'annonce la moins chère du moment, puis **Remplir**
  propose un palier en dessous.
- **Score d'objet** (points de galerie, pastille gemme) à côté du prix FUTBIN sur chaque carte, lu sur FUTBIN avec le prix.
- **Bonnes affaires** : sur le marché, une annonce sous X % du prix FUTBIN (90 % par défaut) est surlignée en vert
  avec l'écart et le bénéfice estimé après taxe. Sur tes cartes seulement (club, transferts) : **prix payé** et
  bénéfice estimé.

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

- **DCE répétables** : la solution utilisée est mémorisée par défi. En rouvrant le défi, **⚡ Solution FUTBIN** la relit
  (cartes du club repérées) ; **Placer dans l'équipe**, **Acheter les manquants**, puis envoyer.
- **Valeur FUTBIN de l'équipe** du défi affichée sous le bouton (somme des prix des joueurs placés).
- **Collections masquées** : bouton × sur une collection de la liste des DCE ; réaffichage dans l'onglet Outils.
- **Après l'envoi** : bouton **Ranger les non attribués** (doublons non échangeables → stockage DCE, le reste au club).
- **Alerte** quand EA refuse les DCE (trop de requêtes, vérification, blocage temporaire) : la tâche en cours s'arrête.

## Galerie (FC 27)

Tuile **Galerie** sur l'accueil du web app, à côté de « FC Hub » et au même format : elle ouvre des écrans du web app
(titre et bouton retour EA). Données et prix : **FUTBIN**.

1. **Catégories** (logos des ligues, jetons de galerie à gagner) puis **collections** : barre de paliers D à S
   (points requis, récompenses au survol), tes cartes et ton score sur les collections déjà ouvertes.
   Les joueurs s'affichent avec les **vraies cartes du web app EA** (onglets Liste prête / Manquants / À toi).
2. En ouvrant une collection, tout se fait seul : joueurs éligibles lus sur FUTBIN, tes cartes repérées (club,
   stockage DCE, cartes déjà collectées), puis **liste prête** : les joueurs les moins chers au prix FUTBIN pour
   atteindre le palier suivant, tes cartes d'abord. Le score suit le calcul de FUTBIN (points + bonus : attaque,
   même club, nations différentes, premier propriétaire…).
3. **Acheter N joueurs** (après confirmation) : chaque manquant est acheté au prix FUTBIN + marge DCE puis envoyé au club.
   **Acheter + revendre au même prix** : après tous les achats, chaque carte est remise en vente à son prix d'achat
   (vente groupée ; taxe EA de 5 % à la vente). Bouton **+ Acheter** sur chaque joueur, **+ / −** pour modifier la liste,
   choix du palier visé.

Le web app n'affiche pas la galerie : une carte compte comme « collectée » quand elle est vue dans ton club / stockage
ou achetée par cet outil (historique local), et devient gratuite dans les plans suivants.

## Outils

Onglet **Outils** :

- **Compteur de requêtes EA** : recherches du bot et faites à la main sur la dernière heure et les dernières 24 h,
  achats / enchères. Alerte à 90 % et 100 % des limites (900/h et 4 500/24 h par défaut) ; **pause automatique** en option :
  le bot attend de repasser sous la limite, les achats DCE / galerie et le prix min EA s'arrêtent.
- **Raccourcis clavier** (touches modifiables, affichées sur les boutons EA) : Entrée = rechercher, B = achat immédiat
  (puis Entrée valide cet achat ; une confirmation ouverte à la souris, comme une vente rapide, n'est jamais validée
  au clavier), N = enchérir, L = mettre en vente, Retour arrière = retour, ↑ ↓ = carte précédente / suivante,
  ← → = page, + / − et Page haut / bas = prix min / max, Échap = annuler, M = ouvrir MagicBuyer.
  Inactifs pendant la saisie dans un champ.
- **Club** : export CSV (note, poste, échangeable, premier propriétaire, prix payé, prix FUTBIN, score d'objet, vente rapide ;
  prix FUTBIN manquants lus en option), envoi groupé vers la liste des transferts par note / prix FUTBIN, stockage DCE → club
  (cartes qui ne sont plus des doublons), vente rapide des non échangeables sur une plage de notes. Aperçu (avec les noms)
  et confirmation avant chaque action ; si l'équipe active ne peut pas être lue, rien n'est fait : ses joueurs ne sont jamais touchés.
- **Packs** : ouverture des packs déjà possédés (« Mes packs », aucun achat) avec rangement automatique après chaque pack :
  doublons non échangeables → stockage DCE, doublons échangeables et échangeables valant au moins X sur FUTBIN → liste
  des transferts, vente rapide optionnelle des non échangeables jusqu'à une note, le reste au club (jamais un doublon).
  S'il reste une carte dans les non attribués, l'ouverture s'arrête. Valeur FUTBIN de chaque pack dans le journal.

Ces outils ne tournent jamais en même temps que le bot ni qu'une autre tâche (une seule suite de requêtes EA à la fois).

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
| **Outils** | Compteur de requêtes EA et pause auto, bonnes affaires, prix payé, score d'objet, prix min EA, raccourcis clavier, club, packs, DCE (valeur, alerte, collections masquées). |
| **Alertes** | Langue de l'interface, sons, notifications du navigateur, webhook Discord, bot Telegram, choix des événements notifiés. |

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

## Nouveautés 5.4.4

- Solveur DCE : les cartes à acheter (joueurs qui manquent au club, ex. « Italie : 2 min. ») sont lues par l'API
  de l'appli FUTBIN (listes filtrées par nation, championnat, club, notes et qualité, triées par prix, avec les
  identifiants EA et les postes). Les listes futbin.com, que FUTBIN refuse aux requêtes du script (403), ne servent
  plus qu'en secours : le solveur ne s'arrête plus sur « FUTBIN bloque la lecture des prix ».

## Nouveautés 5.4.3

- Tableau « Prime holo » plus compact : la colonne « Achat max » tient dans le panneau (promo retirée des lignes,
  la promo scannée est celle du menu).

## Nouveautés 5.4.2

- Onglet FUTBIN, section « Prime holo » : chaque carte promo existe en version normale et en version holo, plus
  rare et plus chère (TOTW 1 à 4 au 09/10/2026 : holo 1,3 à 3 fois la normale ; TOTW 80 ~10 500 contre ~14 000,
  Lewandowski 85 13 750 contre ~44 000). Le scan demande à EA toutes les cartes de la promo choisie (recherche
  « concept » par rareté : une requête pour les 184 TOTW, aucune recherche sur le marché des transferts) ; la holo
  porte l'habillage holo d'EA. Puis il lit le prix FUTBIN de la holo et de sa version normale par l'API de l'appli
  FUTBIN (une recherche par joueur). Les listes futbin.com ne servent pas : FUTBIN les refuse aux requêtes du script.
  Le tableau donne, par holo de la tranche de prix : prix normal, prix holo, gain (holo payée au prix normal,
  revendue au prix holo, après taxe) et achat max (plus haut prix qui laisse le bénéfice minimum à l'achat, 1 000
  par défaut).
- « Créer les filtres cochés » : un filtre « prix marché EA » par holo (version exacte, achat à 90 % du prix relu,
  plafond = achat max), désactivé pour en faire tourner 3 à la fois. Une version déjà ciblée n'est pas recréée.

## Nouveautés 5.4.1

- Première version du scanner de prime holo, par les listes futbin.com : FUTBIN les refuse aux requêtes du script
  (403), d'où la 5.4.2.
- Correction : la marque holo de l'API FUTBIN venait du champ « signature », qui ne marque que les holo des têtes
  d'affiche (15 TOTW sur 92). Elle vient maintenant de l'animation holo de FUTBIN.

## Nouveautés 5.4.0

- Prix FUTBIN par l'API de l'appli FUTBIN (futbin.org) : une requête JSON légère par joueur renvoie toutes
  ses versions (prix console et PC, prix précédent, plage de prix EA, tendance, type de carte, marque holo),
  sans page de vérification Cloudflare. La carte est retrouvée par son identifiant EA exact ; les autres versions
  du même joueur reçoivent leur prix au passage, et une version lue il y a moins de 60 s est reprise sans requête.
- Les pages futbin.com restent le secours automatique : API refusée (pause de 3 min), muette ou carte introuvable
  par son nom. Les listes (balayages, DCE, galerie) passent toujours par les pages.
- Types de carte appris tout seuls des images FUTBIN (3 = Team of the Week, 22 = Destined for Glory…) : aucune
  liste à mettre à jour à chaque nouvelle promo. La marque holo vient de FUTBIN (plus fiable que l'identifiant).
- Onglet FUTBIN : « Source des prix FUTBIN » (API + pages en secours, ou pages seules), requêtes API dans l'état,
  et le bouton Tester essaie d'abord l'API. Tampermonkey demande d'autoriser futbin.org à la mise à jour.

## Nouveautés 5.3.17

- Onglet Achat : « Bénéfice minimum à l'achat ». L'anti-perte avant l'achat exige ce bénéfice (ex. 1 000), tandis
  que le prix plancher de remise en vente garde celui de l'onglet Vente (ex. 100) : une carte achetée avec +1 000
  prévu peut repartir plus bas si son marché baisse, au lieu de rester bloquée à prix payé + 1 000.

## Nouveautés 5.3.16

- Aucun changement de comportement. Essai abandonné : le marché des transferts du web app FC 27 n'envoie pas la
  note (ovrMin / ovrMax) à EA, une recherche « joueurs or note 88 » reste impossible ; la note des filtres reste
  appliquée par le bot sur les résultats.

## Nouveautés 5.3.15

- DCE : le bouton × qui masque une collection ne recouvre plus le bouton favori d'EA (coin haut droit des
  tuiles). Il se place juste dessous. Après un masquage, « Annuler » reste affiché 6 s ; ensuite la collection se
  réaffiche depuis l'onglet Outils (« Collections DCE masquées »).

## Nouveautés 5.3.14

- Prix marché EA : une annonce n'est écartée comme « bradée » qu'après vérification. EA trie les annonces par fin :
  la page 1 montre celles qui finissent (souvent invendues, trop chères), pas les dernières postées. Quand le relevé
  n'a pas vu toutes les annonces jusqu'à 11 % au-dessus du prix bas, une recherche plafonnée à ce niveau les montre
  toutes, récentes comprises. Plusieurs annonces au même prix forment le prix du marché, jamais une affaire.
- Filtre prix marché : 3 affaires ou plus d'un coup sous l'achat max = prix marché faux ou dépassé. Aucun achat,
  prix relu avant la recherche suivante (comme une page pleine).

## Nouveautés 5.3.13

- Remise en vente au prix du marché : une carte avec un style de chimie (Ombre, Chasseur…) est comparée aux
  annonces de la même variante, et une annonce bradée isolée ne sert plus de référence. Quand le relevé voit moins
  de 3 annonces, une recherche de plus (jusqu'à 1,6 × le prix le plus bas) montre les suivantes.

## Nouveautés 5.3.12

- Prix marché EA : une ou deux annonces bradées (plus de 10 % sous la 3e moins chère) ne font plus le prix de
  référence ; elles sont signalées dans le journal et restent des affaires que le bot achète.

## Nouveautés 5.3.11

- **Prix marché EA** (3e mode de prix d'un filtre, version exacte) : le bot relève lui-même le prix « achat
  immédiat » le plus bas de la carte sur le marché EA, style de chimie compris (ex. un joueur avec l'Ombre, que
  FUTBIN ne cote pas). Achat jusqu'à X % de ce prix, revente un palier en dessous. Prix relu au démarrage, toutes
  les N minutes (onglet Achat, 10 par défaut) et après chaque achat ; jusqu'à 4 recherches par relevé, comptées
  dans le compteur de requêtes.
- Page pleine d'annonces sous l'achat max d'un filtre prix marché : le prix relevé est dépassé, aucun achat, prix relu.

## Nouveautés 5.3.10

- **Supprimer les inactifs** (onglet Cible) : supprime d'un coup tous les filtres désactivés, une seule confirmation.
- **Bénéfice min** (onglet Vente) : montant libre en coins (10, 100…), plus arrondi à un prix EA (minimum 150 avant).
- FUTBIN : un refus sur la recherche ou les listes (403) ne met plus en pause les pages joueur, qui continuent
  d'être lues ; une page de vérification Cloudflare met toujours tout FUTBIN en pause.

## Nouveautés 5.3.0

- Bénéfice réel : chaque vente vue pendant la session est comptée (prix de vente après taxe − prix payé),
  dans le journal, l'historique, le bilan d'arrêt et sous le KPI « Profit estimé ».
- Notifications : démarrage, carte vendue (avec le bénéfice), mise en vente ratée, et bilan toutes les N minutes
  (recherches, achats, ventes, bénéfice réel, solde) en plus des événements existants.
- Limites de sécurité toujours actives : 2 s au moins entre deux recherches, pause au plus toutes les 50 recherches,
  arrêt au plus tard après 12 h, 1,5 à 2,5 s entre deux achats ou enchères d'une même recherche ; démarrage refusé
  si EA bloque le marché des transferts (compte, console seulement, maintenance).
- Filtres : export / import JSON (copier-coller), bilan de session par filtre (recherches, achats, dépensé, bénéfice)
  dans la liste, préréglage **Fourrage DCE** (or 85 / 86 / 87 en mode FUTBIN, rotation).
- Mode « % du prix FUTBIN » avec une plage de notes (ex. 85–85) : la liste FUTBIN des cartes les moins chères de ces
  notes est suivie, sans joueur ni nation. **Enchère max en % du prix FUTBIN** de chaque carte (l'enchère fixe sert de plafond).
- Outils → Club : **Analyser le club** (valeur FUTBIN des échangeables, coins investis, plus-value latente après taxe,
  plus gros gains / pertes, répartition par note, cartes revendables avec bénéfice à envoyer en liste des transferts).
- Packs : animation d'ouverture passée (option) ; choix de joueurs : la meilleure carte est encadrée (prix FUTBIN ou note).
- Raccourcis : 1 à 6 = accueil, équipe, transferts, club, DCE, évolutions ; alerte quand une touche sert à deux actions.
- Corrections : le menu ⋮ des listes EA s'affiche au-dessus des cartes ; l'onglet MagicBuyer du menu EA ne saute
  plus de place en changeant d'écran.

## Nouveautés 5.2.0

- Recherche de joueur par FUTBIN : chaque version apparaît (carte de base, cartes spéciales, autre club…),
  avec sa version et son club quand FUTBIN les donne. Un clic choisit la version exacte : plus besoin de copier d'ID.
  « Toutes les versions » garde toutes les cartes du joueur, chacune achetée à X % de son propre prix FUTBIN.
- Mode « % du prix FUTBIN » pour les filtres sans joueur (nation, ligue, club, poste) : le bot lit la liste FUTBIN
  correspondante (ou le lien de liste collé dans le filtre), la relit toutes les 3 min, et achète chaque carte à X % de SON prix.
- Recherche intelligente : jamais de recherche large sans prix max. Les cartes suivies sont réparties en tranches de prix
  serrées (une tranche d'une seule carte = recherche de cette version précise) : peu de résultats, donc les annonces
  les plus récentes sont toujours en première page. Si une tranche renvoie une page pleine, les tranches sont resserrées.
- Langue : l'interface suit la langue du compte FC (français ou anglais ; anglais pour les autres langues), réglable dans Alertes.
- Galerie FC 27 sur l'accueil du web app : collections FUTBIN, liste prête dès l'ouverture (palier suivant, tes cartes
  d'abord), achat des manquants ou achat + revente groupée au même prix.
- Onglet Outils : compteur de requêtes EA (pause auto), raccourcis clavier, outils du club (CSV, envoi groupé,
  stockage DCE → club, vente rapide), ouverture des packs possédés avec rangement automatique.
- Cartes : score d'objet (gemme), bonnes affaires surlignées sur le marché, prix payé et bénéfice sur tes cartes ;
  bouton « Prix min EA » dans le panneau de mise en vente.
- DCE : solution rechargée pour les défis répétables, valeur FUTBIN de l'équipe, collections masquables,
  rangement des récompenses après l'envoi, alerte quand EA refuse les DCE.
- Anti-perte : aucun achat ni enchère qui ne rapporte pas après la taxe EA (revente prévue plafonnée sous le marché
  visible), revente jamais sous le seuil de rentabilité, touche d'achat immédiat bloquée sur un achat à perte, et
  achat immédiat comparé au prix FUTBIN sous le bouton EA.
- Panneau ancré sur les écrans larges : le web app se décale au lieu d'être recouvert (Alertes → Interface).
- Bouton MagicBuyer toujours juste après Accueil dans le menu EA ; touches des raccourcis plus discrètes.
- Listes FUTBIN lues dans les vraies lignes du tableau (nom, version, club, score d'objet) ; le script Cloudflare
  présent sur toutes les pages FUTBIN n'est plus pris pour un blocage (listes des filtres et galerie).
- Tests automatiques : `npm test`.

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
