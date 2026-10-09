import { DOMParser } from "linkedom";
import { createMockEa } from "./mockEa";
import { setPageForTests } from "../app/core/page";
import * as parse from "../app/prices/futbinParse";
import * as settings from "../app/core/settings";
import * as score from "../app/core/galleryScore";
import * as usage from "../app/core/usage";
import { findLowestBin, robustMarketPrice } from "../app/core/lowestBin";
import { breakEvenPrice } from "../app/core/prices";
import * as itemScores from "../app/prices/itemScores";
import { listOwnedPacks, openPacks, planRouting } from "../app/core/packs";
import { createCancelToken } from "../app/core/async";
import { buildLadder, buyGalleryPlayers, candidatesFor, clearGalleryCache, estimateSet, isCollected, loadGallerySet, markCollected, nextGrade, resetGalleryForTests, saveGallerySummary } from "../app/core/gallery";
import * as collection from "../app/core/galleryCollection";
import * as service from "../app/prices/priceService";
import { startToolTask } from "../app/core/toolTask";
import { endTask } from "../app/core/tasks";
import { moveItems, openOwnedPack } from "../app/core/market";
import { buildCriteria, normalizeFilter } from "../app/core/filters";
import * as filterStore from "../app/core/filters";
import { analyzeClub } from "../app/core/clubAnalysis";
import { cardSetKey, futbinListUrl } from "../app/prices/cardSets";
import * as results from "../app/ui/searchResults";
import { hidePlacement, showSet } from "../app/ui/sbcTools";
import * as bulkList from "../app/core/bulkList";
import * as autoRelist from "../app/core/autoRelist";
import { eaName, eaOptions } from "../app/core/eaLists";

global.DOMParser = DOMParser;

let failures = 0;
let passes = 0;
const check = (cond, label, extra) => {
  if (cond) { passes++; console.log(`  ✓ ${label}`); }
  else { failures++; console.log(`  ✗ ${label}`, extra !== undefined ? JSON.stringify(extra) : ""); }
};

// ------------------------------------------------------------- pages FUTBIN réelles (FC 27)

// Script Cloudflare présent sur TOUTES les vraies pages FUTBIN (ce n'est pas un blocage).
const CF_SCRIPT = `<script>window.__CF$cv$params={r:'a41622bf3f6b3d11',t:'MTc5MDQ2NjI1Nw=='};(function(){if(!document.body)return;var s=document.createElement('script');s.src='/cdn-cgi/challenge-platform/scripts/precursor/main.js';document.head.appendChild(s);})();</script>`;

// Ligne de /27/players?nation=163&position=LM&pos_type=main (structure relevée sur futbin.com).
const playerRow = ({ futbinId, eaId, special, name, fullName, rating, itemScore, pos, ps, pc, version, club, nation, league }) => `
<tr class="player-row text-nowrap">
  <td class="table-name"><a href="/27/player/${futbinId}/${name.toLowerCase().replace(/[^a-z]+/g, "-")}" class="player-row-playercard">
    <div class="player-hover-container-wrapper" title="" data-player-hover-location="/27/playerhover/${futbinId}">
      <div class="playercard-27 playercard-s pointer-events-none extra-small-card" title="${fullName}">
        <img alt="" src="https://cdn3.futbin.com/content/fifa27/img/cards/tiny/12_base_icon.png" class="playercard-s-27-bg" width="64">
        <img alt="${name}" src="https://cdn3.futbin.com/content/fifa27/img/players/${special ? "p" : ""}${eaId}.png?fm=png" class="${special ? "playercard-27-special-img" : "playercard-s-base-img"}" width="51">
        <div class="playercard-s-27-info-column"><div class="playercard-s-27-rating">${rating}</div></div>
      </div></div></a>
    <div class="table-player-info">
      <div class="player-hover-container-wrapper"><a href="/27/player/${futbinId}/${name.toLowerCase().replace(/[^a-z]+/g, "-")}" class="table-player-name">${name}</a></div>
      <div class="table-player-sub-info row align-center">
        <a href="/27/players?club=1" class="table-player-club"><img alt="Club" src="https://cdn3.futbin.com/content/fifa27/img/clubs/dark/1.png" title="${club}"></a>
        <a href="/27/players?nation=163" class="table-player-nation"><img alt="Nation" src="https://cdn3.futbin.com/content/fifa27/img/nation/163.png" class="nation" title="${nation}"></a>
        <a href="/27/players?league=10" class="table-player-league"><img alt="League" src="https://cdn3.futbin.com/content/fifa27/img/league/dark/10.png" title="${league}"></a>
      </div>
      <div class="table-player-revision">${version}</div>
    </div>
  </td>
  <td class="table-rating"><div class="rating-square">${rating}</div></td>
  <td class="table-item-score"><div class="xxs-row align-center centered">${itemScore}<img alt="Item Score" src="/design2/img/static/misc/itemScoreIcon.png"></div></td>
  <td class="table-pos"><div class="table-pos-main s-border-radius text-center bold"><span>${pos}</span><span class="positive-color">++</span></div><div class="xs-font text-faded bold">RM, RW</div></td>
  <td class="table-price no-wrap platform-ps-only"><div class="price bold centered xxs-row align-center">${ps}<img alt="Coin" src="coins.png"></div><div class="price-diff">31.25%</div></td>
  <td class="table-price no-wrap platform-pc-only"><div class="price bold centered xxs-row align-center">${pc}<img alt="Coin" src="coins.png"></div></td>
  <td class="table-popularity">40</td>
</tr>`;

const listHtml = (rows) => `<!DOCTYPE html><html><body><table class="futbin-table players-table"><thead><tr>
  <th class="table-name">Name</th><th class="table-rating">RAT</th><th class="table-item-score">IS</th></tr></thead>
  <tbody>${rows.map(playerRow).join("")}</tbody></table>${CF_SCRIPT}</body></html>`;

const galleryIndexHtml = `<!DOCTYPE html><html><body><main class="gallerypage m-column">
  <a href="/27/gallery" class="og-pill og-pill-normal og-pill-primary category-pill">All <span>127</span></a>
  <a href="/27/gallery/7/laliga-ea-sports--liga-f-moeve" class="og-pill og-pill-normal og-pill-secondary category-pill">LALIGA EA SPORTS / Liga F Moeve
    26</a>
  <a href="/27/gallery/6/rarities" class="og-pill og-pill-normal og-pill-secondary category-pill">Rarities 5</a>
  <div class="gallery-grid gallery-search-div">
    <div class="og-card-wrapper gallery-wrapper" data-filter-search-key="real madrid">
      <div class="og-card-wrapper-top flex space-between align-center"><a href="/27/gallery/set/45/real-madrid" class="text-ellipsis bold xs-font">Real Madrid</a></div>
      <a href="/27/gallery/set/45/real-madrid" class="gallery-set-body">
        <div class="gallery-set-logo centered"><img alt="Club" src="https://cdn3.futbin.com/content/fifa27/img/clubs/dark/243.png" class="gallery-set-logo-img"></div>
        <div class="gallery-set-info xs-column"><div class="gallery-set-info-row"><span class="gallery-info-label">Players</span><span class="bold">67</span></div></div>
      </a>
      <details class="gallery-rewards"><summary>Set Rewards</summary><div class="gallery-rewards-body">
        <div class="gallery-rewards-grade"><div class="collection-grade-badge"><span>D</span></div><div class="gallery-rewards-grade-body">
          <div class="gallery-rewards-points"><span class="gallery-info-label">Item Score Needed:</span><span class="bold">10</span></div>
          <div class="gallery-rewards-list"><div class="gallery-reward-chip"><img alt="Objectives Reward" src="x.png"><span>Team Badge (Untradeable)</span></div></div></div></div>
        <div class="gallery-rewards-grade"><div class="collection-grade-badge"><span>C</span></div><div class="gallery-rewards-grade-body">
          <div class="gallery-rewards-points"><span class="gallery-info-label">Item Score Needed:</span><span class="bold">70,000</span></div>
          <div class="gallery-rewards-list"><div class="gallery-reward-chip"><span>Real Madrid Kit (Untradeable)</span></div></div></div></div>
        <div class="gallery-rewards-grade"><div class="collection-grade-badge"><span>B</span></div><div class="gallery-rewards-grade-body">
          <div class="gallery-rewards-points"><span class="bold">1,000,000</span></div>
          <div class="gallery-rewards-list"><div class="gallery-reward-chip"><span>50 Gallery Token</span></div></div></div></div>
      </div></details>
    </div>
    <div class="og-card-wrapper gallery-wrapper" data-filter-search-key="starter set">
      <div class="og-card-wrapper-top"><a href="/27/gallery/set/127/starter-set">Starter Set</a></div>
      <a href="/27/gallery/set/127/starter-set" class="gallery-set-body"><div class="gallery-set-info-row"><span class="gallery-info-label">Players</span><span class="bold">22,780</span></div></a>
    </div>
  </div></main>${CF_SCRIPT}</body></html>`;

const galleryCard = ({ id, name, title, rating, points, ps, pc, eaId, special, tags, league = 53, club = 243, nation = 18, player }) => ({
  id: String(id),
  card: {
    type: "futbin.frontenddata.components.misc.PlayerCardSmall.Fut27",
    cardname: name,
    title,
    rating: String(rating),
    pos1: { position: "ST", plusplus: true },
    itemScore: String(points),
    isHolographic: !!special,
    playerImages: {
      playerImage: { fixed: { type: "playerImage", url: { image1x: `https://cdn3.futbin.com/content/fifa27/img/players/${player}.png?fm=png` } } },
      ...(special ? { playerSpecialImage: { fixed: { type: "playerImage", url: { image1x: `https://cdn3.futbin.com/content/fifa27/img/players/p${eaId}.png?fm=png` } } } } : {}),
    },
    nationImage: { fixed: { name: "France" } },
    leagueImage: { image: { fixed: { name: "LALIGA EA SPORTS" } } },
    clubImage: { image: { fixed: { name: "Real Madrid" } } },
  },
  psPriceBox: { price: ps, itemScore: "35.62K" },
  pcPriceBox: { price: pc, itemScore: "35.62K" },
  points,
  tagFacts: { matchedTags: tags, league, club, nation, player },
});

const gallerySetData = {
  eligible: {
    title: "Eligible Players",
    initialSort: "ItemScoreDesc",
    sortOptions: [
      { extraClasses: null, label: "IS: High to Low", sort: "ItemScoreDesc" },
      { extraClasses: "platform-ps-only", label: "Price: Low to High", sort: "PriceAscPs" },
      { extraClasses: "platform-pc-only", label: "Price: Low to High", sort: "PriceAscPc" },
    ],
    searchLocation: { type: "futbin.frontenddata.Location.LocationDontUseThisDirectly", url: "/27/gallery/set-player-search/45" },
    items: [
      galleryCard({ id: 22995, name: "Mbappé", title: "Kylian Mbappé", rating: 91, points: 35625, ps: "0", pc: "0", eaId: 67340611, special: true, tags: ["23", "20", "13"], player: 231747 }),
      galleryCard({ id: 23000, name: "Mbappé", title: "Kylian Mbappé", rating: 91, points: 23750, ps: "12.05M", pc: "15M", eaId: 50563123, special: true, tags: ["23", "13"], player: 231747 }),
      galleryCard({ id: 512, name: "Bellingham", title: "Jude Bellingham", rating: 90, points: 14000, ps: "212K", pc: "202K", eaId: 252371, tags: ["22", "13"], player: 252371 }),
    ],
    totalItems: 67,
    itemsPerPage: 24,
  },
  selected: { title: "Your Real Madrid Set", layout: "FixedSlots" },
  goal: {
    type: "futbin.frontenddata.components.collectionbuilder.CollectionBuilderData.Goal.MultiTier",
    tiers: [
      { grade: "C", points: 70000, pointsText: "70,000", rewards: [{ label: "Real Madrid Kit (Untradeable)" }] },
      { grade: "D", points: 10, pointsText: "10", rewards: [{ label: "Team Badge (Untradeable)" }] },
    ],
  },
  limit: { maxItems: 20, requiresExactly: true, counterLabel: "selected" },
  tagSpecs: [
    { key: "23", name: "All out Attack", description: "Requires players from attacking positions (ST,RW,LW)", color: "#3d8bfd", aggregation: "MatchCount", facet: null, requiresFirstOwner: false, tiers: [{ requiredCount: 5, multiplier: 300, bonusText: "+3%" }] },
    { key: "18", name: "Same Club", description: "Requires players from same club", aggregation: "LargestGroup", facet: "Club", requiresFirstOwner: false, tiers: [{ requiredCount: 5, multiplier: 100, bonusText: "+1%" }] },
  ],
  stats: { totalScoreTitle: "Total Score" },
  itemScoreIcon: {},
  initiallySelected: [],
};

const gallerySetHtml = `<!DOCTYPE html><html><body>
  <div class="page-header"><h1 class="page-header-top xxs-row align-center">Real Madrid</h1></div>
  <a href="/27/gallery/7/laliga-ea-sports--liga-f-moeve" class="gallerysetbuilder-back">Go back</a>
  <div data-react-type="futbin.frontenddata.components.collectionbuilder.CollectionBuilderData"><div class="collection-builder"></div>
  <script type="application/json" data-react-data="">${JSON.stringify(gallerySetData)}</script></div>${CF_SCRIPT}</body></html>`;

const main = async () => {
  settings.resetSettings();
  settings.setSetting("ui.language", "fr");

  console.log("\n# seuil de rentabilité (taxe EA 5 %)");
  {
    check(breakEvenPrice(24000) === 25500 && breakEvenPrice(24000, 500) === 26000 && breakEvenPrice(950) === 1000 && breakEvenPrice(0) === 0, "24 000 → 25 500 · +500 → 26 000 · 950 → 1 000 · inconnu → 0", [breakEvenPrice(24000), breakEvenPrice(24000, 500), breakEvenPrice(950)]);
  }

  console.log("\n# montants abrégés et score d'objet");
  {
    check(parse.parseCoinsFloor("2.2K") === 2200 && parse.parseCoinsFloor("16.25K") === 16250 && parse.parseCoinsFloor("520K") === 520000 && parse.parseCoinsFloor("2K") === 2000, "prix abrégé sous le million : exact (paliers EA)", [parse.parseCoinsFloor("2.2K"), parse.parseCoinsFloor("520K")]);
    check(parse.parseCoinsFloor("12.05M") === 12045000 && parse.parseCoinsFloor("15M") === 14995000, "en millions (arrondi à 10 000) : borne basse", [parse.parseCoinsFloor("12.05M"), parse.parseCoinsFloor("15M")]);
    check(parse.parseCoinsFloor("15,250") === 15250 && parse.parseCoinsFloor("0") === 0, "prix écrit en entier : inchangé");
    const exact = parse.parseItemScore("410");
    const rounded = parse.parseItemScore("35.62K");
    check(exact.score === 410 && exact.exact && rounded.score === 35620 && !rounded.exact, "score d'objet exact (410) / arrondi (35.62K)", [exact, rounded]);
  }

  console.log("\n# liste de joueurs FUTBIN (lignes tr.player-row réelles)");
  {
    const html = listHtml([
      { futbinId: 21778, eaId: 227002, name: "Miyama", fullName: "Aya Miyama", rating: 90, itemScore: "21000", pos: "LM", ps: "520K", pc: "680K", version: "Icon", club: "EA FC ICONS", nation: "Japan", league: "Icons" },
      { futbinId: 23026, eaId: 50611456, special: true, name: "Shunsuke Mito", fullName: "Shunsuke Mito", rating: 83, itemScore: "410", pos: "LM", ps: "0", pc: "0", version: "Squad Foundations", club: "Sparta Rotterdam", nation: "Japan", league: "Eredivisie" },
      { futbinId: 21001, eaId: 243780, name: "Mitoma", fullName: "Kaoru Mitoma", rating: 81, itemScore: "280", pos: "LM", ps: "2.2K", pc: "2K", version: "Normal", club: "Brighton", nation: "Japan", league: "Premier League" },
    ]);
    const parsed = parse.parsePlayerListText(html);
    check(parsed.source === "html" && parsed.cards.length === 3, "3 cartes lues dans le tableau HTML", parsed);
    const [icon, special, base] = parsed.cards;
    check(icon.name === "Miyama" && icon.rating === 90 && icon.futbinId === 21778 && icon.eaId === 227002, "nom affiché (pas « 90 Miyama Icon »), note, ids", icon);
    check(icon.itemScore === 21000 && icon.itemScoreExact && icon.version === "Icon" && icon.club === "EA FC ICONS" && icon.nation === "Japan" && icon.league === "Icons" && icon.position === "LM", "score d'objet exact, version, club, nation, ligue, poste", icon);
    check(icon.prices.console === 520000 && icon.prices.pc === 680000, "prix console / PC abrégés (520K / 680K)", icon.prices);
    check(special.eaId === 50611456 && special.prices.console === 0 && special.itemScore === 410, "carte spéciale (id « p… »), prix 0 = hors marché", special);
    check(base.prices.console === 2200 && base.prices.pc === 2000, "2.2K → 2 200, 2K → 2 000", base.prices);
  }

  console.log("\n# Cloudflare : script normal ≠ page de vérification");
  {
    check(!parse.looksBlocked(`<html><head><title>EA FC 27 Gallery | FUTBIN</title></head><body><div class="gallery-grid"></div>${CF_SCRIPT}</body></html>`), "page FUTBIN normale (script Cloudflare) : pas un blocage");
    check(!parse.looksBlocked(`<html><head><title>EA FC 27 Players | FUTBIN</title></head><body><p>No results</p>${CF_SCRIPT}</body></html>`), "même sans contenu reconnu : pas un blocage");
    check(parse.looksBlocked(`<html><head><title>Just a moment...</title></head><body><div id="challenge-running"></div><script>window._cf_chl_opt={cvId:'3'};</script></body></html>`), "vraie page « Just a moment… » : blocage");
    const list = parse.parsePlayerListText(listHtml([{ futbinId: 1, eaId: 243780, name: "Mitoma", fullName: "Kaoru Mitoma", rating: 81, itemScore: "280", pos: "LM", ps: "2.2K", pc: "2K", version: "Normal", club: "Brighton", nation: "Japan", league: "Premier League" }]));
    check(list.cards.length === 1 && !list.blocked, "liste FUTBIN réelle (avec script Cloudflare) lue", list);
  }

  console.log("\n# page joueur : score d'objet");
  {
    const html = `<html><body><div class="player-card-wrapper" data-version-id="22995">
      <div class="platform-price-wrapper-medium player-card-item-score"><span class="item-score-segment">35.62K<img alt="Item Score"></span></div></div>
      <div class="other-versions"><span class="item-score-segment">280</span></div>
      <div class="price-box platform-ps-only price-box-original-player"><div class="price lowest-price-1">4,060,000</div></div></body></html>`;
    const result = parse.parsePlayerDocument(new DOMParser().parseFromString(html, "text/html"), "console");
    check(result.price === 4060000 && result.itemScore === 35620 && !result.itemScoreExact, "score de la carte principale (35.62K), pas celui d'une autre version", result);
  }

  console.log("\n# galerie FUTBIN : collections, paliers");
  {
    const index = parse.parseGalleryIndex(galleryIndexHtml);
    check(index.categories.length === 3 && index.categories[0].active && index.categories[1].id === 7 && index.categories[1].count === 26 && index.categories[1].name === "LALIGA EA SPORTS / Liga F Moeve", "catégories : id, nom, nombre, active", index.categories);
    check(index.sets.length === 2 && index.sets[0].id === 45 && index.sets[0].name === "Real Madrid" && index.sets[0].players === 67 && index.sets[1].players === 22780, "collections : id, nom, nombre de joueurs (22,780)", index.sets);
    const tiers = index.sets[0].tiers;
    check(tiers.length === 3 && tiers[1].grade === "C" && tiers[1].points === 70000 && tiers[2].points === 1000000 && tiers[0].rewards[0] === "Team Badge (Untradeable)", "paliers D / C / B : points requis et récompenses", tiers);
    check(index.sets[0].url === "https://www.futbin.com/27/gallery/set/45/real-madrid" && index.sets[0].logoKind === "Club", "lien absolu et type de logo");
  }

  console.log("\n# galerie FUTBIN : collection (JSON React)");
  {
    const set = parse.parseGallerySet(gallerySetHtml);
    check(set && set.title === "Real Madrid" && set.searchUrl === "https://www.futbin.com/27/gallery/set-player-search/45", "titre et lien de recherche des joueurs", set && { title: set.title, url: set.searchUrl });
    check(set.totalItems === 67 && set.perPage === 24 && set.limit.maxItems === 20 && set.limit.exact, "67 joueurs, 24 par page, exactement 20 à choisir");
    check(set.tiers[0].grade === "D" && set.tiers[1].grade === "C", "paliers triés par points");
    check(set.sortOptions[1].platform === "console" && set.sortOptions[2].platform === "pc" && set.sortOptions[0].platform === "", "tris par plateforme");
    const [sbcCard, special, base] = set.items;
    check(sbcCard.eaId === 67340611 && sbcCard.baseId === 231747 && sbcCard.points === 35625 && sbcCard.prices.console === 0 && sbcCard.offMarket.console, "carte hors marché (prix « 0 ») : id EA de la version spéciale", sbcCard);
    check(special.prices.console === 12050000 && special.prices.pc === 15000000 && special.special && special.name === "Mbappé" && special.fullName === "Kylian Mbappé", "prix 12.05M / 15M, nom court et complet", special);
    check(base.eaId === 252371 && base.tags.join() === "22,13" && base.club === 243 && base.nation === 18 && base.clubName === "Real Madrid", "tags, club, nation", base);
    check(set.tags.length === 2 && set.tags[1].aggregation === "LargestGroup" && set.tags[1].facet === "Club" && set.tags[0].tiers[0].multiplier === 300, "bonus : agrégation, facette, multiplicateurs", set.tags);
    const pool = parse.parseGalleryPool(JSON.stringify({ items: gallerySetData.eligible.items.slice(1), totalItems: 67 }));
    check(pool && pool.items.length === 2 && pool.totalItems === 67 && pool.items[0].eaId === 50563123, "page suivante (réponse JSON du POST)", pool);
    check(parse.parseGalleryPool("<html>blocked</html>") === null, "réponse non JSON refusée");
  }

  console.log("\n# galerie : calcul du score (modèle FUTBIN)");
  {
    const set = {
      tags: [
        { key: "A", name: "Attaque", aggregation: "MatchCount", facet: "", firstOwner: false, tiers: [{ count: 2, multiplier: 1000, text: "+10%" }] },
        { key: "C", name: "Même club", aggregation: "LargestGroup", facet: "Club", firstOwner: false, tiers: [{ count: 2, multiplier: 500, text: "+5%" }, { count: 3, multiplier: 1000, text: "+10%" }] },
        { key: "N", name: "Nations différentes", aggregation: "DistinctCount", facet: "Nation", firstOwner: false, tiers: [{ count: 2, multiplier: 300, text: "+3%" }] },
        { key: "F", name: "Premier propriétaire", aggregation: "MatchCount", facet: "", firstOwner: true, tiers: [{ count: 1, multiplier: 1000, text: "+10%" }] },
      ],
      tiers: [{ grade: "D", points: 10 }, { grade: "C", points: 1000 }, { grade: "B", points: 5000 }],
      limit: { maxItems: 3, exact: true },
    };
    const items = [
      { key: 1, points: 1000, tags: ["A", "C", "N", "F"], club: 1, nation: 10, baseId: 101 },
      { key: 2, points: 500, tags: ["A", "C", "N"], club: 1, nation: 11, baseId: 102 },
      { key: 3, points: 200, tags: ["C", "N"], club: 2, nation: 10, baseId: 103 },
    ];
    const result = score.scoreSelection(set, items, new Set());
    const byKey = (key) => result.tags.find((tag) => tag.key === key);
    check(result.base === 1700, "base = somme des points", result.base);
    check(byKey("A").bonus === 150 && byKey("A").count === 2, "MatchCount : +10 % des points des joueurs du tag (150)", byKey("A"));
    check(byKey("C").bonus === 75 && byKey("C").count === 2, "LargestGroup : +5 % du plus grand club (75)", byKey("C"));
    check(byKey("N").bonus === 45 && byKey("N").count === 2, "DistinctCount : +3 % des meilleurs de chaque nation (45)", byKey("N"));
    check(byKey("F").bonus === 0 && result.total === 1970, "premier propriétaire non marqué : pas de bonus · total 1 970", result.total);
    const owner = score.scoreSelection(set, items, new Set([1]));
    check(owner.total === 2070, "premier propriétaire marqué : +100", owner.total);
    const progress = score.gradeProgress(set.tiers, 1970);
    check(progress.current.grade === "C" && progress.next.grade === "B" && progress.remaining === 3030 && Math.round(progress.percent) === 24, "palier atteint C, encore 3 030 pour B", progress);
  }

  console.log("\n# galerie : plan le moins cher");
  {
    const set = { tags: [], tiers: [], limit: { maxItems: 3, exact: true } };
    const candidates = [
      { key: "o1", points: 800, price: 0, owned: true },
      { key: "m1", points: 900, price: 1000 },
      { key: "m2", points: 100, price: 150 },
      { key: "m3", points: 2000, price: 50000 },
      { key: "m4", points: 1200, price: 3000 },
      { key: "x", points: 5000, price: 0 },
    ];
    const plan = score.planSelection(set, candidates, { target: 2500, size: 3, exact: true });
    const keys = plan.selection.map((item) => item.key).sort().join();
    check(plan.reached && keys === "m1,m4,o1" && plan.cost === 4000 && plan.toBuy.length === 2, "carte possédée gardée, échange le plus rentable (m2 → m4), coût 4 000", { keys, cost: plan.cost, total: plan.score.total });
    check(!plan.selection.some((item) => item.key === "x"), "carte hors marché (prix 0) jamais achetée");
    const easy = score.planSelection(set, candidates, { target: 100, size: 3, exact: true });
    check(easy.reached && easy.cost === 1150, "objectif bas : les moins chères suffisent", { cost: easy.cost });
  }

  console.log("\n# compteur de requêtes EA");
  {
    usage.resetUsageForTests();
    settings.setSetting("usage.hourLimit", 50);
    settings.setSetting("usage.autoPause", false);
    usage.recordSearch();
    usage.recordSearch();
    usage.asBot(() => usage.recordSearch());
    usage.recordBid();
    let stats = usage.usageStats();
    check(stats.hour.searches === 3 && stats.hour.manual === 2 && stats.hour.bot === 1 && stats.hour.bids === 1, "recherches à la main / bot, achats", stats.hour);
    for (let i = 0; i < 47; i += 1) usage.asBot(() => usage.recordSearch());
    check(usage.usageBlocked() === null, "limite atteinte sans pause auto : pas de blocage");
    settings.setSetting("usage.autoPause", true);
    const blocked = usage.usageBlocked();
    const wait = usage.usageWaitMs();
    check(blocked && blocked.scope === "hour" && blocked.count === 50 && wait >= 60000 && wait <= 61 * 60000, "pause auto : limite horaire, reprise quand les recherches sortent de l'heure", { blocked, wait });
    const mock = createMockEa();
    setPageForTests(mock.page);
    usage.resetUsageForTests();
    usage.hookUsage();
    mock.page.services.Item.searchTransferMarket(new mock.page.UTSearchCriteriaDTO(), 1);
    check(usage.usageStats().hour.manual === 1, "recherche faite dans le web app comptée « à la main »");
    settings.setSetting("usage.autoPause", false);
  }

  console.log("\n# prix min EA (recherches exactes)");
  {
    const mock = createMockEa();
    setPageForTests(mock.page);
    // Annonces triées par fin d'enchère : les 25 à 5 000 d'abord, puis 4 800 ×3 et 4 700 ×1.
    const listings = [...Array(25).fill(5000), 4800, 4800, 4800, 4700, ...Array(10).fill(6000)];
    mock.setMarket((n, criteria, page, makeItem) => {
      const max = criteria.maxBuy || Infinity;
      const items = listings.filter((bin) => bin <= max).slice(0, 21).map((bin, i) => makeItem({ bin, definitionId: 231747, tradeId: n * 100 + i }));
      return { success: true, data: { items } };
    });
    const result = await findLowestBin(231747, { reference: 5500, maxSearches: 6, gapMs: 0 });
    check(result.ok && result.price === 4700 && result.count === 1 && result.exact && result.searches === 2, "page pleine à 5 500 → recherche sous 5 000 → minimum 4 700", result);
    check(mock.calls.search[0].criteria.maxBuy === 5500 && mock.calls.search[1].criteria.maxBuy === 4900 && mock.calls.search[1].criteria.defId[0] === 231747, "prix max 5 500 puis 4 900, version exacte", mock.calls.search.map((s) => s.criteria.maxBuy));
    mock.setMarket(() => ({ success: true, data: { items: [] } }));
    const none = await findLowestBin(231747, { reference: 5500, maxSearches: 3, gapMs: 0 });
    check(none.ok && !none.price && none.searches === 3, "aucune annonce : prix max relevé puis sans limite", none);
  }

  console.log("\n# prix min EA : style de chimie");
  {
    const mock = createMockEa();
    setPageForTests(mock.page);
    // Même version : Ombre (268) à 5 000 ×2 et 4 800, autre style moins cher (3 000), sans style 3 500,
    // autre carte à 2 000. Le serveur simulé ne filtre pas le style : seul le code le fait.
    const listings = [
      { bin: 5000, style: 268 },
      { bin: 4800, style: 268 },
      { bin: 5000, style: 268 },
      { bin: 3000, style: 250 },
      { bin: 3500, style: 0 },
      { bin: 2000, style: 268, definitionId: 999 },
    ];
    mock.setMarket((n, criteria, page, makeItem) => ({
      success: true,
      data: {
        items: listings
          .filter((l) => !criteria.maxBuy || l.bin <= criteria.maxBuy)
          .map((l, i) => makeItem({ bin: l.bin, definitionId: l.definitionId || 231747, tradeId: n * 100 + i, extra: { playStyle: l.style } })),
      },
    }));
    const styled = await findLowestBin(231747, { playStyle: 268, gapMs: 0 });
    check(styled.ok && styled.price === 4800 && styled.count === 1 && styled.exact, "style 268 : autres styles ignorés, minimum 4 800", styled);
    const first = mock.calls.search[0].criteria;
    check(first.playStyle === 268 && first.defId[0] === 231747, "recherche limitée à la version et au style demandés", first);
    const any = await findLowestBin(231747, { gapMs: 0 });
    check(any.ok && any.price === 3000 && mock.calls.search[1].criteria.playStyle === -1, "sans style : toutes les annonces de la version, comme avant", { any, criteria: mock.calls.search[1].criteria });
    check(Array.isArray(styled.prices) && styled.prices[0] === 4800, "prix les plus bas vus renvoyés (triés)", styled.prices);
  }

  console.log("\n# prix marché de référence : annonces bradées écartées");
  {
    const isolated = robustMarketPrice({ price: 2500, count: 1, prices: [3300, 2500, 3300, 3300] });
    check(isolated.price === 3300 && isolated.count === 3 && isolated.skipped.join() === "2500", "annonce isolée à 2 500 sous 3 300 : prix de référence 3 300", isolated);
    const two = robustMarketPrice({ price: 2000, count: 1, prices: [2000, 2100, 3300, 3300] });
    check(two.price === 3300 && two.skipped.length === 2, "deux annonces bradées écartées", two);
    const normal = robustMarketPrice({ price: 2900, count: 1, prices: [2900, 3000, 3100] });
    check(normal.price === 2900 && normal.count === 1 && !normal.skipped.length, "écarts normaux (< 10 %) : prix le plus bas gardé", normal);
    const pair = robustMarketPrice({ price: 2500, count: 1, prices: [2500, 3300] });
    check(pair.price === 3300 && pair.skipped.join() === "2500", "deux annonces seulement : la bradée est écartée", pair);
    const single = robustMarketPrice({ price: 3000, count: 1, prices: [3000] });
    const none = robustMarketPrice({ price: 0, count: 0, prices: [] });
    check(single.price === 3000 && none.price === 0, "une annonce ou aucune : prix tel quel", { single, none });
    const level = robustMarketPrice({ price: 2000, count: 2, prices: [2000, 2000, 3300, 3300] });
    check(level.price === 2000 && level.count === 2 && !level.skipped.length, "deux annonces au même prix : un niveau du marché, gardé", level);
  }

  console.log("\n# prix min EA : annonce « bradée » vérifiée avant d'être écartée");
  {
    // Serveur simulé : annonces triées par fin d'enchère, identifiants stables (mêmes annonces d'une
    // recherche à l'autre), 21 résultats au plus.
    const serve = (mock, book) =>
      mock.setMarket((n, criteria, page, makeItem) => ({
        success: true,
        data: {
          items: book
            .filter((l) => !criteria.maxBuy || l.bin <= criteria.maxBuy)
            .slice(0, 21)
            .map((l) => makeItem({ bin: l.bin, definitionId: 231747, tradeId: l.tradeId })),
        },
      }));
    const maxBuys = (mock) => mock.calls.search.map((s) => s.criteria.maxBuy).join();
    // Page 1 : une annonce à 3 300 et vingt à 3 800 (finissent bientôt, invendues) ; les dernières
    // postées, plus loin : sept à 3 300 et deux à 3 400.
    const militao = createMockEa();
    setPageForTests(militao.page);
    serve(militao, [3300, ...Array(20).fill(3800), ...Array(7).fill(3300), 3400, 3400].map((bin, i) => ({ bin, tradeId: 7000 + i })));
    const crowded = await findLowestBin(231747, { reference: 3800, maxSearches: 4, gapMs: 0, spread: true });
    const market = robustMarketPrice(crowded);
    check(maxBuys(militao) === "3800,3200,3600", "page pleine à 3 800, rien sous 3 300, vérification jusqu'à 3 600", maxBuys(militao));
    check(market.price === 3300 && market.count === 8 && !market.skipped.length, "8 annonces à 3 300 : prix du marché, pas une affaire", market);
    // Vraie affaire : une seule annonce à 2 500, le marché est à 3 300.
    const bargain = createMockEa();
    setPageForTests(bargain.page);
    serve(bargain, [2500, ...Array(25).fill(3300)].map((bin, i) => ({ bin, tradeId: 8000 + i })));
    const isolated = robustMarketPrice(await findLowestBin(231747, { reference: 3300, maxSearches: 4, gapMs: 0, spread: true }));
    check(maxBuys(bargain) === "3300,2400,2700", "vérification jusqu'à 2 700 (2 500 + 11 %)", maxBuys(bargain));
    check(isolated.price === 3300 && isolated.skipped.join() === "2500", "seule à 2 500 : affaire écartée du prix de référence", isolated);
    // Bas du marché déjà vu en entier (page incomplète) : aucune recherche de plus.
    const known = createMockEa();
    setPageForTests(known.page);
    serve(known, [2500, 3300, 3300, 3300].map((bin, i) => ({ bin, tradeId: 9000 + i })));
    const full = await findLowestBin(231747, { reference: 3500, maxSearches: 4, gapMs: 0, spread: true });
    check(full.searches === 1 && robustMarketPrice(full).price === 3300, "toutes les annonces déjà vues : pas de vérification", { full, searches: maxBuys(known) });
  }

  console.log("\n# DCE : bouton × sous le bouton favori d'EA, réaffichage");
  {
    const box = { top: 100, right: 400, bottom: 300, left: 200, width: 200, height: 200 };
    // Bouton favori EA : rond de 32 px à 8 px du coin haut droit ; l'image couvre toute la tuile.
    const fav = { top: 108, right: 392, bottom: 140, left: 360, width: 32, height: 32 };
    const spot = hidePlacement(box, [box, fav], 22);
    check(spot && spot.top === 46 && spot.right === 13, "× centré sous le favori, 6 px plus bas", spot);
    check(spot && spot.top > fav.bottom - box.top, "aucun recouvrement avec le favori", spot);
    const far = { top: 250, right: 240, bottom: 280, left: 210, width: 30, height: 30 };
    check(hidePlacement(box, [far], 22) === null && hidePlacement({ width: 0, height: 0 }, [fav], 22) === null, "aucun bouton dans le coin, ou tuile pas encore affichée : position du CSS");
    settings.setSetting("sbc.hidden", [{ id: "12", name: "Ligue" }, { id: "34", name: "Icône" }]);
    showSet("12");
    check(settings.getSettings().sbc.hidden.map((entry) => entry.id).join() === "34", "Annuler : collection réaffichée, les autres restent masquées", settings.getSettings().sbc.hidden);
    settings.setSetting("sbc.hidden", []);
  }

  console.log("\n# score d'objet mémorisé");
  {
    itemScores.resetItemScoresForTests();
    itemScores.setItemScore(252371, 14000, true);
    itemScores.setItemScore(252371, 14010, false);
    check(itemScores.getItemScore(252371).score === 14000 && itemScores.getItemScore(252371).exact, "valeur exacte gardée face à un arrondi proche");
    itemScores.setItemScore(252371, 16000, false);
    check(itemScores.getItemScore(252371).score === 16000, "changement réel adopté");
  }

  console.log("\n# packs : rangement des cartes");
  {
    // Carte EA FC 27 : « tradable » (false = non échangeable), isDuplicate(), isStorable().
    const item = (spec) => Object.assign({ definitionId: spec.id, rating: spec.rating || 80, tradable: !spec.untradeable, discardValue: 100, isPlayer: () => spec.player !== false, isDuplicate: () => !!spec.duplicate, isSpecial: () => !!spec.special, isStorable: () => !!spec.untradeable && spec.player !== false }, spec);
    const plan = planRouting(
      [
        item({ id: 1, duplicate: true, untradeable: true }),
        item({ id: 2, duplicate: true }),
        item({ id: 3, untradeable: true, rating: 70 }),
        item({ id: 4, untradeable: true, rating: 70, special: true }),
        item({ id: 5, player: false }),
        item({ id: 6, player: false, untradeable: true, duplicate: true }),
      ],
      { duplicatesToStorage: true, toTransferMin: 0, quickSellMaxRating: 75 }
    );
    check(plan.storage.length === 1 && plan.storage[0].id === 1, "doublon non échangeable → stockage DCE");
    check(plan.transfer.length === 1 && plan.transfer[0].id === 2, "doublon échangeable → liste des transferts");
    check(plan.discard.length === 1 && plan.discard[0].id === 3, "non échangeable ≤ note → vente rapide (carte spéciale gardée)");
    check(plan.club.map((i) => i.id).join() === "4,5", "le reste → club (jamais un doublon)", plan.club.map((i) => i.id));
    check(plan.left.map((i) => i.id).join() === "6", "doublon non joueur non échangeable : reste dans les non attribués", plan.left.map((i) => i.id));
    const noStorage = planRouting([item({ id: 7, duplicate: true, untradeable: true, rating: 90 })], { duplicatesToStorage: false, toTransferMin: 0, quickSellMaxRating: 0 });
    check(noStorage.left.length === 1 && !noStorage.club.length, "doublon sans règle : compté comme resté, pas envoyé au club");
  }

  console.log("\n# packs : objets divers, choix de joueurs, doublons non échangeables");
  {
    const item = (spec) => Object.assign({ definitionId: spec.id, rating: 80, tradable: !spec.untradeable, discardValue: 100, isPlayer: () => !!spec.player, isDuplicate: () => !!spec.duplicate, isSpecial: () => false, isStorable: () => !!spec.untradeable && !!spec.player, isMiscItem: () => !!spec.misc, isPlayerPickItem: () => !!spec.pick }, spec);
    const rules = { duplicatesToStorage: true, toTransferMin: 0, quickSellMaxRating: 0, redeemMisc: true, untradeableDuplicates: "quickSell" };
    const plan = planRouting([item({ id: 1, misc: true }), item({ id: 2, misc: true, pick: true }), item({ id: 3, untradeable: true, duplicate: true }), item({ id: 4, player: true, untradeable: true, duplicate: true })], rules);
    check(plan.redeem.map((i) => i.id).join() === "1" && plan.picks.map((i) => i.id).join() === "2", "pièces / boosts / jetons → utilisés ; choix de joueurs → gardés à part", { redeem: plan.redeem.map((i) => i.id), picks: plan.picks.map((i) => i.id) });
    check(plan.discard.map((i) => i.id).join() === "3" && plan.storage.map((i) => i.id).join() === "4" && !plan.club.length, "doublon non échangeable hors joueur → vente rapide ; joueur → stockage DCE ; rien au club", { discard: plan.discard.map((i) => i.id), storage: plan.storage.map((i) => i.id) });
    const leave = planRouting([item({ id: 3, untradeable: true, duplicate: true }), item({ id: 5, misc: true })], Object.assign({}, rules, { untradeableDuplicates: "leave", redeemMisc: false }));
    check(leave.left.map((i) => i.id).join() === "3,5", "réglages « laisser » : restent dans les non attribués", leave.left.map((i) => i.id));
  }

  console.log("\n# marché : une seule rareté par requête (rotation)");
  {
    const mock = createMockEa();
    setPageForTests(mock.page);
    const filter = normalizeFilter({ name: "R", rarities: [3, 47, 52] });
    const picked = [0, 1, 2, 3].map((index) => Array.from(buildCriteria(filter, { rarityIndex: index }).rarities).join());
    check(picked.join("|") === "3|47|52|3", "3 raretés : 3, puis 47, puis 52, puis 3 (jamais plusieurs à la fois)", picked);
  }

  console.log("\n# marché : tri et filtres des résultats (recherches à la main)");
  {
    results.resetResultsForTests();
    settings.resetSettings();
    settings.setSetting("ui.language", "fr");
    const mock = createMockEa();
    mock.page.PlayerPosition = { 0: "GK", 5: "CB", 25: "ST" };
    const clubItems = [{ definitionId: 900, isLimitedUse: () => false }];
    mock.page.repositories = Object.assign(mock.page.repositories || {}, { Item: Object.assign((mock.page.repositories && mock.page.repositories.Item) || {}, { getClub: () => ({ items: { values: () => clubItems } }) }) });
    setPageForTests(mock.page);
    const listing = (spec) => mock.makeItem(Object.assign({ tradeId: spec.trade, definitionId: spec.def, rating: spec.rating || 80, bin: spec.bin, bid: spec.bid || 0, expires: spec.expires || 100 }, { extra: { leagueId: spec.league || 13, nationId: spec.nation || 18, teamId: spec.team || 1, rareflag: spec.rarity || 1, preferredPosition: spec.pos == null ? 5 : spec.pos } }));
    const items = [
      listing({ trade: 1, def: 900, bin: 5000, expires: 30, rating: 84 }),
      listing({ trade: 2, def: 901, bin: 1500, expires: 60, rating: 86, league: 53 }),
      listing({ trade: 3, def: 902, bin: 3000, expires: 90, rating: 82, pos: 0 }),
    ];
    const sorted = results.sortItems(items.slice(), "bin-asc").map((item) => item.definitionId);
    check(sorted.join() === "901,902,900", "tri achat immédiat croissant", sorted);
    const byRating = results.sortItems(items.slice(), "rating-desc").map((item) => item.definitionId);
    check(byRating.join() === "901,900,902", "tri note décroissante", byRating);
    check(results.sortItems(items.slice(), "none").map((item) => item.definitionId).join() === "900,901,902", "sans tri : ordre EA gardé");
    const rules = { hideOwned: true, hideLeagues: [53], hidePositions: ["GK"] };
    check(results.hideReason(items[0], rules) === "owned" && results.hideReason(items[1], rules) === "league" && results.hideReason(items[2], rules) === "position", "masquées : au club, ligue, poste", items.map((item) => results.hideReason(item, rules)));
    check(results.hideReason(items[1], {}) === "", "sans règle : rien de masqué");
    settings.setSetting("results.sort", "bin-asc");
    const response = { success: true, data: { items: items.slice() } };
    results.rememberSearchForTests(response.data.items);
    check(results.isSearchResult(items[0]) && response.data.items.map((item) => item.definitionId).join() === "901,902,900", "réponse d'une recherche à la main : annonces repérées puis triées", response.data.items.map((item) => item.definitionId));
    const watch = listing({ trade: 77, def: 903, bin: 900 });
    check(!results.isSearchResult(watch), "annonce hors dernière recherche (objectifs de transfert…) : jamais touchée");
    // Le bot (asBot) n'est jamais modifié : la réponse arrive telle quelle.
    let delivered = null;
    mock.page.services.Item.searchTransferMarket = () => ({ observe(scope, cb) { setTimeout(() => cb.call(scope, this, { success: true, data: { items: [items[0], items[1]] } }), 1); return this; } });
    results.hookResults();
    usage.asBot(() => mock.page.services.Item.searchTransferMarket({}, 1)).observe(null, (obs, res) => { delivered = res.data.items.map((item) => item.definitionId).join(); });
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(delivered === "900,901", "recherche du bot : ordre EA, pas de tri", delivered);
    settings.resetSettings();
    settings.setSetting("ui.language", "fr");
  }

  console.log("\n# listes : mise en vente groupée (prix, seuil de rentabilité, arrêt)");
  {
    settings.setSetting("sell.noLoss", true);
    settings.setSetting("sell.minProfit", 0);
    service.resetPriceServiceForTests();
    const mock = createMockEa({ limits: { minimum: 150, maximum: 1000000 } });
    setPageForTests(mock.page);
    service.seedFutbinPrice(401, { price: 20000, platform: "console" });
    service.seedFutbinPrice(402, { price: 10000, platform: "console" });
    const card = (spec) => mock.makeItem(Object.assign({ tradeId: "0", state: "none" }, spec, { extra: Object.assign({ tradable: true, lastSalePrice: spec.paid || 0, pile: 5 }, spec.extra || {}) }));
    const a = card({ definitionId: 401, name: "A" });
    const b = card({ definitionId: 402, name: "B", paid: 12000 });
    const c = card({ definitionId: 403, name: "C" });
    check(bulkList.proposedPrice(a, { mode: "percent", percent: "100" }).price === 20000 && bulkList.proposedPrice(a, { mode: "steps", steps: -2 }).price === 19500 && bulkList.proposedPrice(a, { mode: "fixed", fixed: 15100 }).price === 15000, "prix : 100 % FUTBIN, −2 paliers, fixe arrondi", [bulkList.proposedPrice(a, { mode: "steps", steps: -2 }).price, bulkList.proposedPrice(a, { mode: "fixed", fixed: 15100 }).price]);
    check(bulkList.proposedPrice(c, { mode: "percent", percent: "100" }).price === 0, "sans prix FUTBIN : rien proposé");
    check(bulkList.stepFrom(10000, 1) === 10250 && bulkList.stepFrom(1000, -1) === 950, "paliers EA : 10 000 → 10 250, 1 000 → 950");
    const report = await bulkList.listRows([{ key: 1, item: a, price: 20000 }, { key: 2, item: b, price: 10000 }, { key: 3, item: c, price: 0 }], { delay: "0.01-0.02", duration: "1H" });
    const prices = mock.calls.list.map((l) => l.bin);
    check(report.listed === 2 && report.skipped === 1 && prices.join() === "20000,12750", "2 en vente ; B payée 12 000 relevée au seuil 12 750 (pas 10 000)", { report, prices });
    check(report.raised === 1 && mock.calls.list.every((l) => l.start < l.bin), "départ un palier sous l'achat immédiat", mock.calls.list);
    mock.setList(() => ({ success: false, status: 458, error: { code: 458 } }));
    const stopped = await bulkList.listRows([{ key: 1, item: card({ definitionId: 401, name: "D" }), price: 20000 }, { key: 2, item: card({ definitionId: 401, name: "E" }), price: 20000 }], { delay: "0.01-0.02" });
    check(stopped.failed === 1 && stopped.stopped && mock.calls.list.length === 3, "captcha : arrêt après la première erreur (la 2e carte n'est pas tentée)", { stopped, calls: mock.calls.list.length });
    const selling = mock.makeItem({ definitionId: 401, state: "selling", own: true, extra: { tradable: true } });
    check(!bulkList.isListable(selling) && !bulkList.isListable(card({ definitionId: 401, extra: { tradable: false } })), "déjà en vente / non échangeable : jamais remise en vente");
  }

  console.log("\n# listes : relist auto (bot à l'arrêt)");
  {
    autoRelist.resetAutoRelistForTests();
    const probe = createMockEa();
    const expired = probe.makeItem({ tradeId: "e9", state: "expired", own: true });
    const mock = createMockEa({ transferItems: [expired] });
    setPageForTests(mock.page);
    let refreshed = 0;
    const once = await autoRelist.runAutoRelistOnce({ refresh: () => { refreshed += 1; } });
    check(once.ok && once.count === 1 && mock.calls.relist === 1 && refreshed === 1, "invendue présente : « tout remettre en vente » (1 requête) puis liste rafraîchie", { once, relist: mock.calls.relist });
    const empty = createMockEa({ transferItems: [] });
    setPageForTests(empty.page);
    const none = await autoRelist.runAutoRelistOnce({});
    check(none.ok && none.count === 0 && empty.calls.relist === 0, "aucune invendue : pas de relist");
    autoRelist.resetAutoRelistForTests();
  }

  console.log("\n# packs : jamais d'achat de pack");
  {
    const mock = createMockEa();
    setPageForTests(mock.page);
    let calls = 0;
    const storePack = { id: 9, isMyPack: false, open() { calls += 1; return null; }, purchase() { calls += 1; return null; } };
    const refused = await openOwnedPack(storePack);
    check(!refused.ok && calls === 0, "pack du magasin (non possédé) refusé sans appel EA", { ok: refused.ok, calls });
    const fs = require("fs");
    const path = require("path");
    const files = [];
    const walk = (dir) => fs.readdirSync(dir).forEach((name) => {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.js$/.test(name)) files.push(full);
    });
    walk(path.join(process.cwd(), "app"));
    const offenders = files.filter((file) => /\.purchase\s*\(|purchasePack|BUY_PACK|buyPack/.test(fs.readFileSync(file, "utf8")));
    check(files.length > 20 && offenders.length === 0, "aucun achat de pack dans le code (.purchase, BUY_PACK…)", offenders);
  }

  console.log("\n# packs : ouverture des packs possédés et rangement");
  {
    const mock = createMockEa();
    setPageForTests(mock.page);
    const svc = mock.page.services;
    let unassigned = [];
    const moves = [];
    const discards = [];
    const card = (id, spec) => mock.makeItem(Object.assign({ definitionId: id, name: `C${id}`, rating: spec.rating || 80, extra: Object.assign({ tradable: true, discardValue: 500, isDuplicate: () => false, isSpecial: () => false, isStorable: () => spec.tradable === false }, spec) }));
    const packContent = () => [card(1, { tradable: false, isDuplicate: () => true }), card(2, { tradable: false, rating: 70 }), card(3, {})];
    let opened = 0;
    const pack = () => ({
      id: 7,
      isMyPack: true,
      packName: "FUT_PACK_7",
      open() {
        opened += 1;
        const items = packContent();
        unassigned = unassigned.concat(items);
        const obs = { _o: [], observe(scope, cb) { this._o.push({ scope, cb }); return this; }, unobserve() { return this; } };
        setTimeout(() => obs._o.forEach((o) => o.cb.call(o.scope, obs, { success: true, response: { items } })), 5);
        return obs;
      },
    });
    const later = (data) => {
      const obs = { _o: [], observe(scope, cb) { this._o.push({ scope, cb }); return this; }, unobserve() { return this; } };
      setTimeout(() => obs._o.forEach((o) => o.cb.call(o.scope, obs, data)), 5);
      return obs;
    };
    svc.Store = { getPacks: () => later({ success: true, response: { packs: [pack(), pack(), { id: 9, isMyPack: false }] } }) };
    svc.Item.requestUnassignedItems = () => later({ success: true, response: { items: unassigned.slice() } });
    svc.Item.move = (items, pileId) => {
      const list = Array.from(items);
      moves.push({ pile: pileId, n: list.length });
      unassigned = unassigned.filter((item) => !list.includes(item));
      return later({ success: true, data: { itemIds: list.map((item) => item.id) } });
    };
    svc.Item.discard = (items) => {
      const list = Array.from(items);
      discards.push(list.length);
      unassigned = unassigned.filter((item) => !list.includes(item));
      return later({ success: true, data: { itemIds: list.map((item) => item.id) } });
    };
    mock.page.ItemPile.STORAGE = 11;
    settings.setSetting("packs.duplicatesToStorage", true);
    settings.setSetting("packs.toTransferMin", 0);
    settings.setSetting("packs.quickSellMaxRating", 75);
    const owned = await listOwnedPacks();
    check(owned.ok && owned.groups.length === 1 && owned.groups[0].count === 2, "packs possédés regroupés (pack du magasin ignoré)", owned.groups && owned.groups.map((g) => [g.id, g.count]));
    const summary = await openPacks(owned.groups[0], 2, { token: createCancelToken(), priceWaitMs: 0 });
    check(summary.opened === 2 && !summary.stopped && opened === 2, "2 packs ouverts", summary);
    check(unassigned.length === 0, "non attribués vides après chaque pack", unassigned.length);
    check(moves.filter((m) => m.pile === 11).length === 2 && moves.filter((m) => m.pile === 7).length === 2 && discards.join() === "1,1", "doublon → stockage DCE, non échangeable ≤ 75 → vente rapide, reste → club", { moves, discards });
    settings.setSetting("packs.quickSellMaxRating", 0);
  }

  console.log("\n# galerie : première page gardée si FUTBIN refuse les pages suivantes");
  {
    settings.setSetting("prices.iframeFallback", false);
    const posts = [];
    global.GM_xmlhttpRequest = (options) => {
      const reply = (status, text) => setTimeout(() => options.onload({ status, responseText: text }), 2);
      if (options.method === "POST") {
        posts.push(JSON.parse(options.data));
        reply(403, "<html><head><title>Just a moment...</title></head><body><div id='challenge-platform'></div></body></html>");
        return;
      }
      reply(/\/27\/gallery\/set\/45\//.test(options.url) ? 200 : 404, gallerySetHtml);
    };
    clearGalleryCache();
    const whole = await loadGallerySet("https://www.futbin.com/27/gallery/set/45/real-madrid", { sort: "ValueDescPs" });
    check(whole.ok && whole.set.items.length === 3 && whole.set.partial && posts[0].sort === "ItemScoreDesc" && posts[0].page === 2, "collection lue en entier : ordre de la page, page 2 refusée → joueurs de la page 1 gardés", { n: whole.set && whole.set.items.length, posts });
    clearGalleryCache();
    posts.length = 0;
    const big = await loadGallerySet("https://www.futbin.com/27/gallery/set/45/real-madrid", { sort: "ValueDescPs", pages: 1 });
    check(big.ok && big.set.items.length === 3 && posts[0].sort === "ValueDescPs" && posts[0].page === 1, "grande collection : tri FUTBIN demandé, refus → page HTML en secours", { n: big.set && big.set.items.length, posts });
  }

  console.log("\n# galerie : palier suivant et historique de collection");
  {
    resetGalleryForTests();
    const set = {
      items: [
        { futbinId: 1, eaId: 101, points: 5000, prices: { console: 1000, pc: 0 }, tags: [] },
        { futbinId: 2, eaId: 102, points: 4000, prices: { console: 800, pc: 0 }, tags: [] },
        { futbinId: 3, eaId: 103, points: 50000, prices: { console: 90000, pc: 0 }, tags: [] },
      ],
      tags: [],
      tiers: [{ grade: "D", points: 10 }, { grade: "C", points: 9000 }, { grade: "B", points: 50000 }],
      limit: { maxItems: 3, exact: true },
    };
    let candidates = candidatesFor(set, new Map([[101, { source: "club", firstOwner: false }]]));
    let next = nextGrade(set, candidates);
    check(next.total === 5000 && next.grade === "C" && !next.reachedAll, "tes cartes : 5 000 pts → palier suivant C", next);
    markCollected([102]);
    candidates = candidatesFor(set, new Map([[101, { source: "club", firstOwner: false }]]));
    next = nextGrade(set, candidates);
    const collected = candidates.find((item) => item.eaId === 102);
    check(isCollected(102) && collected.owned && collected.source === "collection" && collected.price === 0 && next.total === 9000 && next.grade === "B", "carte collectée (historique) : gratuite, palier suivant B", { next, collected: collected.source });
  }

  console.log("\n# galerie : acheter + revendre au même prix (vente groupée)");
  {
    resetGalleryForTests();
    service.resetPriceServiceForTests();
    settings.setSetting("sbc.wait", "0.05-0.1");
    settings.setSetting("gallery.wait", "0.05-0.1");
    settings.setSetting("sbc.triesPerPlayer", 2);
    settings.setSetting("sbc.margin", 5);
    settings.setSetting("usage.autoPause", false);
    const mock = createMockEa();
    setPageForTests(mock.page);
    mock.setMarket((n, criteria, page, makeItem) => ({ success: true, data: { items: [makeItem({ definitionId: criteria.defId[0], bin: criteria.defId[0] === 201 ? 20000 : 30000, tradeId: 700 + n })] } }));
    service.seedFutbinPrice(201, { price: 20000, platform: "console" });
    service.seedFutbinPrice(202, { price: 30000, platform: "console" });
    const states = [];
    const report = await buyGalleryPlayers(
      [
        { key: 1, eaId: 201, name: "A", rating: 85 },
        { key: 2, eaId: 202, name: "B", rating: 86 },
      ],
      { token: createCancelToken(), resell: true, onUpdate: (item, phase) => states.push(`${item.key}:${phase}`) }
    );
    check(report.bought === 2 && report.listed === 2 && report.spent === 50000, "2 achetées puis 2 remises en vente", report);
    check(mock.calls.list.map((l) => l.bin).join() === "20000,30000" && mock.calls.list.every((l) => l.start < l.bin), "revente au prix d'achat (départ un palier en dessous)", mock.calls.list);
    const lastBuy = states.lastIndexOf("2:bought");
    const firstList = states.indexOf("1:listed");
    check(lastBuy >= 0 && firstList > lastBuy, "mises en vente groupées après tous les achats", states);
    check(isCollected(201) && isCollected(202) && !mock.calls.move.length, "cartes collectées, pas envoyées au club", mock.calls.move);
  }

  // Observable EA simulé : observe(scope, cb) puis réponse envoyée de façon asynchrone.
  const fakeObservable = (response) => {
    const obs = { _o: [], observe(scope, cb) { this._o.push({ scope, cb }); return this; }, unobserve() { return this; } };
    setTimeout(() => obs._o.forEach((o) => o.cb.call(o.scope, obs, response)), 1);
    return obs;
  };

  console.log("\n# galerie : collection d'après EA (isCollected), premier propriétaire, un compte par persona");
  {
    resetGalleryForTests();
    const mock = createMockEa();
    let persona = "111";
    mock.page.services.User.getUser = () => ({ coins: { amount: 0 }, getSelectedPersona: () => ({ id: persona }) });
    function Factory() {}
    Factory.prototype.createItem = function (raw) {
      return { definitionId: raw.resourceId, owners: raw.owners, concept: !!raw.concept, isPlayer: () => true, _staticData: { name: raw.name || "" } };
    };
    mock.page.UTItemEntityFactory = Factory;
    setPageForTests(mock.page);
    check(collection.hookCollection(), "createItem du web app enveloppé");
    const factory = new Factory();
    const first = factory.createItem({ resourceId: 501, owners: 3, isCollected: true, name: "A" });
    factory.createItem({ resourceId: 502, owners: 1, isCollected: false });
    factory.createItem({ resourceId: 503, concept: true, owners: 1, isCollected: true });
    factory.createItem({ resourceId: 504, owners: 1 });
    collection.flushCollectionForTests();
    check(first.isCollected === true && collection.isCollected(501) && !collection.isCollected(502) && collection.isCollected(503) && !collection.isCollected(504), "isCollected lu sur chaque objet : 501 et 503 collectées, 502 et 504 non", { size: collection.collectionSize() });
    factory.createItem({ resourceId: 501, owners: 1, isCollected: true });
    factory.createItem({ resourceId: 501, owners: 4, isCollected: true });
    collection.flushCollectionForTests();
    check(collection.collectedOwners(501) === 1 && collection.collectedOwners(503) === 0, "premier propriétaire : plus petit nombre vu ; carte concept : inconnu", { a: collection.collectedOwners(501), c: collection.collectedOwners(503) });
    persona = "222";
    check(!collection.isCollected(501) && collection.collectionSize() === 0, "autre compte : collection séparée");
    persona = "111";
    check(collection.isCollected(501) && collection.collectionSize() === 2, "retour au premier compte : collection retrouvée");
    const set = { items: [{ futbinId: 9, eaId: 501, points: 100, prices: { console: 5000, pc: 0 }, tags: [] }], tags: [], tiers: [], limit: { maxItems: 3 } };
    const candidate = candidatesFor(set, null)[0];
    check(candidate.owned && candidate.source === "collection" && candidate.firstOwner && candidate.price === 0, "plan : carte collectée gratuite, premier propriétaire repris", candidate);
  }

  console.log("\n# galerie : synchro (pages de 250, blocage EA, erreur serveur)");
  {
    resetGalleryForTests();
    collection.setSyncPauseForTests(1, 0);
    const mock = createMockEa();
    mock.page.services.User.getUser = () => ({ coins: { amount: 0 }, getSelectedPersona: () => ({ id: "s1" }) });
    function Factory() {}
    Factory.prototype.createItem = function (raw) {
      return { definitionId: raw.resourceId, owners: 0, concept: true, isPlayer: () => true };
    };
    mock.page.UTItemEntityFactory = Factory;
    const factory = new Factory();
    const calls = [];
    let mode = "ok";
    mock.page.services.Item.searchConceptItems = (criteria) => {
      const ids = Array.from(criteria.defId);
      calls.push({ n: ids.length, offset: criteria.offset, count: criteria.count });
      if (mode === "rate") {
        return fakeObservable({ success: false, status: 429, error: { code: 429 } });
      }
      if (mode === "5xx" && ids.length > 1) {
        return fakeObservable({ success: false, status: 500, error: { code: 500 } });
      }
      // Deux versions par joueur ; les joueurs pairs sont collectés.
      const all = [];
      ids.forEach((id) => {
        all.push(factory.createItem({ resourceId: id, isCollected: id % 2 === 0 }));
        all.push(factory.createItem({ resourceId: id + 50000000, isCollected: false }));
      });
      const items = all.slice(criteria.offset, criteria.offset + criteria.count);
      return fakeObservable({ success: true, status: 200, response: { items, endOfList: criteria.offset + criteria.count >= all.length } });
    };
    setPageForTests(mock.page);
    collection.hookCollection();
    const ids = Array.from({ length: 300 }, (_, i) => i + 1);
    let report = await collection.syncCollection({ ids, setId: "45", token: createCancelToken() });
    check(report.ok && calls.length === 3 && calls.map((c) => c.offset).join() === "0,250,500" && calls.every((c) => c.count === 250), "300 joueurs = 600 cartes : 3 pages de 250", calls);
    check(collection.collectionSize() === 150 && report.added === 150, "150 cartes collectées enregistrées", { size: collection.collectionSize(), added: report.added });
    check(collection.setSyncedAt("45") > 0 && !collection.syncInfo().syncedAt, "synchro d'une collection : date de la collection, pas de la synchro complète");
    calls.length = 0;
    mode = "rate";
    report = await collection.syncCollection({ ids, token: createCancelToken() });
    check(!report.ok && report.code === 429 && calls.length === 1 && !collection.syncInfo().syncedAt, "trop de requêtes (429) : arrêt immédiat, synchro non datée", { report, calls: calls.length });
    calls.length = 0;
    mode = "5xx";
    report = await collection.syncCollection({ ids: [1, 2, 3, 4], token: createCancelToken() });
    check(report.ok && calls.filter((c) => c.n === 4).length === 1 && calls.filter((c) => c.n === 2).length === 2 && calls.filter((c) => c.n === 1).length === 4, "erreur serveur : lot coupé en deux jusqu'à un joueur", calls.map((c) => c.n));
    calls.length = 0;
    mode = "ok";
    const token = createCancelToken();
    token.cancel();
    report = await collection.syncCollection({ ids, token });
    check(!report.ok && report.stopped && !calls.length, "Stop avant de commencer : aucune requête");
    collection.setSyncPauseForTests(1000, 500);
  }

  console.log("\n# galerie : paliers de prix et progression estimée");
  {
    check(buildLadder(10000, { range: { min: 85, max: 100 }, retries: 3 }).join() === "8500,9200,10000", "10 000, 85–100 %, 3 essais → 8 500 / 9 200 / 10 000", buildLadder(10000, { range: { min: 85, max: 100 }, retries: 3 }));
    check(buildLadder(800, { range: { min: 95, max: 100 }, retries: 5 }).join() === "750,800", "petits prix : paliers EA sans doublon (750, 800)", buildLadder(800, { range: { min: 95, max: 100 }, retries: 5 }));
    check(buildLadder(0, { range: { min: 85, max: 100 }, retries: 3 }).length === 0 && buildLadder(20000, { range: { min: 90, max: 90 }, retries: 1 }).join() === "18000", "sans prix : aucun palier ; 1 essai = bas de la plage");
    resetGalleryForTests();
    const mock = createMockEa();
    mock.page.services.User.getUser = () => ({ coins: { amount: 0 }, getSelectedPersona: () => ({ id: "e1" }) });
    setPageForTests(mock.page);
    saveGallerySummary("77", { players: [[1, 100], [2, 200], [3, 300], [4, 50]], size: 2, total: 0 });
    markCollected([2, 3, 4]);
    const estimate = estimateSet("77");
    check(estimate && estimate.owned === 3 && estimate.base === 500 && estimate.players === 4, "collection ouverte : 3 cartes collectées, score de base = 2 meilleures (300 + 200)", estimate);
    check(estimateSet("78") === null, "collection jamais ouverte : pas d'estimation");
  }

  console.log("\n# galerie : achat par paliers (le moins cher d'abord)");
  {
    resetGalleryForTests();
    service.resetPriceServiceForTests();
    settings.setSetting("gallery.wait", "0.05-0.1");
    settings.setSetting("usage.autoPause", false);
    const mock = createMockEa();
    setPageForTests(mock.page);
    const searched = [];
    mock.setMarket((n, criteria, page, makeItem) => {
      searched.push(criteria.maxBuy);
      return { success: true, data: { items: criteria.maxBuy >= 9200 ? [makeItem({ definitionId: 301, bin: 9100, tradeId: 900 + n })] : [] } };
    });
    service.seedFutbinPrice(301, { price: 10000, platform: "console" });
    const report = await buyGalleryPlayers([{ key: 1, eaId: 301, name: "C", rating: 84 }], {
      token: createCancelToken(),
      buy: { range: { min: 85, max: 100 }, retries: 3, wait: "0.05-0.1" },
      sell: { mode: "keep", percent: { min: 100, max: 100 } },
    });
    check(report.bought === 1 && report.spent === 9100 && searched.slice(0, 2).join() === "8500,9200", "essai 1 à 8 500 (rien), essai 2 à 9 200 : acheté 9 100", { report, searched });
    check(mock.calls.move.length === 1, "garder : carte envoyée au club", mock.calls.move.length);
    const manual = await buyGalleryPlayers([{ key: 2, eaId: 302, name: "R", rating: 80, maxPrice: 5000 }], {
      token: createCancelToken(),
      buy: { range: { min: 90, max: 100 }, retries: 2, wait: "0.05-0.1" },
      sell: { mode: "keep", percent: { min: 100, max: 100 } },
    });
    check(searched.slice(-2).join() === "4500,5000" && manual.failed === 1, "carte récompense : prix saisi = plafond (4 500 puis 5 000)", { searched: searched.slice(-2), manual });
  }

  console.log("\n# déplacements EA : cartes réellement traitées (data.itemIds)");
  {
    const mock = createMockEa();
    setPageForTests(mock.page);
    const a = mock.makeItem({ id: 11 });
    const b = mock.makeItem({ id: 12 });
    mock.page.services.Item.move = (items) => {
      const obs = { _o: [], observe(scope, cb) { this._o.push({ scope, cb }); return this; }, unobserve() { return this; } };
      setTimeout(() => obs._o.forEach((o) => o.cb.call(o.scope, obs, { success: true, data: { itemIds: [11], clubDuplicates: [] } })), 2);
      return obs;
    };
    const moved = await moveItems([a, b], "TRANSFER");
    check(moved.ok && moved.moved.length === 1 && moved.refused.length === 1 && moved.refused[0].id === 12, "carte ignorée par EA comptée comme restée", { moved: moved.moved.length, refused: moved.refused.length });
  }

  console.log("\n# limite de requêtes : outils arrêtés");
  {
    usage.resetUsageForTests();
    settings.setSetting("usage.hourLimit", 50);
    settings.setSetting("usage.autoPause", true);
    for (let i = 0; i < 50; i += 1) usage.recordSearch();
    const blocked = startToolTask("test");
    check(!blocked.task && /limite/.test(blocked.error), "tâche refusée à la limite", blocked.error);
    const mock = createMockEa();
    setPageForTests(mock.page);
    const lowest = await findLowestBin(231747, { reference: 5500, gapMs: 0 });
    check(!lowest.ok && lowest.searches === 0 && mock.calls.search.length === 0, "prix min EA : aucune recherche envoyée", lowest);
    settings.setSetting("usage.autoPause", false);
    const free = startToolTask("test");
    check(!!free.task, "sans pause auto : tâche acceptée");
    endTask(free.task);
    usage.resetUsageForTests();
  }

  console.log("\n# filtres : export / import JSON");
  {
    settings.resetSettings();
    settings.setSetting("ui.language", "fr");
    const before = filterStore.getFilters().length;
    const source = filterStore.addFilter({ name: "Export test", player: { id: 231747, name: "Mbappé", rating: 91 }, maxBuy: 45000, priceMode: "futbin", futbinPercent: 88, rarities: [3] });
    const json = filterStore.exportFilters([source.id]);
    const parsed = JSON.parse(json);
    check(parsed.kind === "magicbuyer-filters" && parsed.filters.length === 1 && !("id" in parsed.filters[0]), "export : un filtre, sans identifiant interne", parsed.filters[0]);
    const imported = filterStore.importFilters(json);
    const list = filterStore.getFilters();
    const copy = list[list.length - 1];
    check(imported.added === 1 && list.length === before + 2, "import : filtre ajouté (rien remplacé)", { imported, n: list.length });
    check(copy.id !== source.id && copy.name === "Export test" && copy.maxBuy === 45000 && copy.futbinPercent === 88 && copy.player.id === 231747 && copy.rarities[0] === 3, "import : réglages conservés, nouvel identifiant", copy);
    check(filterStore.getActiveFilter().id === copy.id, "import : filtre importé sélectionné");
    check(filterStore.importFilters("pas du json").error === "json" && filterStore.importFilters('{"kind":"autre"}').error === "empty", "import : texte illisible ou vide refusé");
    const single = filterStore.importFilters(JSON.stringify({ name: "Seul", maxBuy: "12 000", futbinPercent: 999, evil: "x" }));
    const last = filterStore.getFilters()[filterStore.getFilters().length - 1];
    check(single.added === 1 && last.maxBuy === 12000 && last.futbinPercent === 150 && !("evil" in last), "import : filtre seul normalisé, clés inconnues ignorées", last);
  }

  console.log("\n# filtres : mode prix marché EA");
  {
    check(
      normalizeFilter({ priceMode: "market" }).priceMode === "market" && normalizeFilter({ priceMode: "futbin" }).priceMode === "futbin" && normalizeFilter({ priceMode: "autre" }).priceMode === "fixed",
      "mode « market » conservé, mode inconnu → prix fixe"
    );
    const source = filterStore.addFilter({ name: "Mbappé Ombre", definitionId: 50563123, playStyle: 268, priceMode: "market", futbinPercent: 88, maxBuy: 30000 });
    const json = filterStore.exportFilters([source.id]);
    const exported = JSON.parse(json).filters[0];
    check(exported.priceMode === "market" && exported.playStyle === 268 && exported.definitionId === 50563123, "export : mode prix marché, version et style", exported);
    const imported = filterStore.importFilters(json);
    const copy = filterStore.getFilters()[filterStore.getFilters().length - 1];
    check(
      imported.added === 1 && copy.id !== source.id && copy.priceMode === "market" && copy.definitionId === 50563123 && copy.playStyle === 268 && copy.futbinPercent === 88 && copy.maxBuy === 30000,
      "import : mode prix marché, version, style, % et plafond conservés",
      copy
    );
    const text = filterStore.describeFilter(copy);
    check(text.includes("achat ≤ 88 % du prix marché EA") && text.includes("style Ombre"), "description : achat ≤ 88 % du prix marché EA, style Ombre (nom, plus l'identifiant 268)", text);
  }

  console.log("\n# filtres : suppression des filtres désactivés en une fois");
  {
    const keepA = filterStore.addFilter({ name: "Actif A", maxBuy: 1000 });
    const keepB = filterStore.addFilter({ name: "Actif B", maxBuy: 2000 });
    filterStore.getFilters()
      .filter((filter) => filter.id !== keepA.id && filter.id !== keepB.id)
      .forEach((filter) => filterStore.updateFilter(filter.id, { enabled: false }));
    const inactive = filterStore.getFilters().filter((filter) => filter.enabled === false).length;
    const removed = filterStore.removeInactiveFilters();
    const names = filterStore.getFilters().map((filter) => filter.name);
    check(inactive > 0 && removed === inactive, "ménage : tous les filtres désactivés supprimés", { inactive, removed });
    check(names.length === 2 && names.includes("Actif A") && names.includes("Actif B"), "ménage : les filtres actifs sont gardés", names);
    check(filterStore.removeInactiveFilters() === 0, "ménage : rien à supprimer la 2e fois");
  }

  console.log("\n# analyse du club (valeur, investi, plus-value)");
  {
    const club = [
      { id: 1, rating: 91, definitionId: 11, lastSalePrice: 40000 },
      { id: 2, rating: 88, definitionId: 12, lastSalePrice: 20000 },
      { id: 3, rating: 86, definitionId: 13, lastSalePrice: 0 },
      { id: 4, rating: 84, definitionId: 14, lastSalePrice: 9000 },
      { id: 5, rating: 83, definitionId: 15, tradable: false, lastSalePrice: 0 },
      { id: 6, rating: 70, definitionId: 16, lastSalePrice: 500 },
    ];
    const prices = { 11: 50000, 12: 18000, 13: 30000, 14: 10000, 15: 99000 };
    const report = analyzeClub(club, { squadIds: new Set(["1"]), priceOf: (item) => prices[item.definitionId] || 0, minSellProfit: 100 });
    check(report.count === 6 && report.tradable === 5 && report.untradable === 1 && report.priced === 4, "comptes (échangeables, prix connus)", report);
    check(report.value === 108000 && report.invested === 69500 && report.paidCount === 4, "valeur FUTBIN et coins investis", { value: report.value, invested: report.invested });
    // Gains : 47 500 − 40 000 = 7 500 ; 17 100 − 20 000 = −2 900 ; 9 500 − 9 000 = 500.
    check(report.unrealized === 7500 - 2900 + 500 && report.tracked === 3, "plus-value latente après taxe", report.unrealized);
    check(report.gainers.length === 2 && report.gainers[0].gain === 7500 && report.losers.length === 1 && report.losers[0].gain === -2900, "meilleurs et pires", { g: report.gainers.map((l) => l.gain), l: report.losers.map((l) => l.gain) });
    check(report.sellable.length === 1 && report.sellable[0].item.id === 4, "revendable : hors équipe active, bénéfice > minimum", report.sellable.map((l) => l.item.id));
    const b90 = report.buckets.find((b) => b.id === "90");
    const b85 = report.buckets.find((b) => b.id === "85");
    check(b90.count === 1 && b85.count === 2 && b85.value === 48000, "répartition par note", report.buckets);
  }

  console.log("\n# préréglage fourrage DCE");
  {
    settings.resetSettings();
    settings.setSetting("ui.language", "fr");
    const other = filterStore.addFilter({ name: "Autre", player: { id: 1, name: "X", rating: 80 }, maxBuy: 1000 });
    const added = filterStore.addFodderFilters();
    const list = filterStore.getFilters();
    check(added.length === 3 && added.map((f) => f.minRating).join(",") === "85,86,87" && added.every((f) => f.maxRating === f.minRating), "3 filtres : or 85, 86, 87", added.map((f) => [f.name, f.minRating]));
    check(added.every((f) => f.priceMode === "futbin" && f.level === "gold" && f.sellMode === "futbin" && f.bidPercent > 0), "mode FUTBIN, revente FUTBIN, enchère en %", added[1]);
    check(filterStore.getRotation().enabled && !list.find((f) => f.id === other.id).enabled && added.every((f) => f.enabled), "rotation entre les seuls filtres fourrage", filterStore.getRotation());
    check(added.every((f) => cardSetKey(f).startsWith("list:") && /player_rating=8[567]-8[567]/.test(futbinListUrl(f))), "liste FUTBIN des moins chères de chaque note", added.map((f) => futbinListUrl(f)));
  }

  console.log("\n# filtres : listes du jeu (nations, championnats, clubs, types, styles) et noms");
  {
    settings.setSetting("ui.language", "fr");
    const texts = {
      "search.nationName.nation27": "Italie",
      "search.nationName.nation18": "France",
      "global.leagueFull.2027.league31": "Serie A Enilive",
      "global.leagueabbr15.2027.league13": "Premier League",
      "global.teamFull.2027.team45": "Juventus",
      "global.teamabbr15.2027.team48": "Napoli",
      "global.teamabbr15.2027.team1": "Arsenal",
      "item.raretype0": "Commune",
      "item.raretype1": "Rare",
      "item.raretype3": "Équipe de la semaine (TOTW)",
      "item.raretype22": "Destin glorieux",
      "playstyles.playstyle268": "Ombre",
    };
    const page = {
      APP_YEAR: 2027,
      services: { Localization: { localize: (key) => texts[key] || `**${key}**` } },
      repositories: {
        TeamConfig: {
          getNations: () => [{ id: 27, name: "ÂóS" }, { id: 18, name: "x" }],
          getLeagues: () => [{ id: 31 }, { id: 13 }],
          getTeams: () => [{ id: 45, leagueId: 31 }, { id: 48, leagueId: 31 }, { id: 1, leagueId: 13 }, { id: 131524, league: 31, name: "*global.teamabbr15.2027.team131524" }, { id: 7001, league: 13, name: "Köln" }, { id: 7002, league: 31, name: "Köln" }],
        },
        Rarity: new Map([[3, { id: 3, name: "codé" }], [0, { id: 0 }], [22, { id: 22 }], [1, { id: 1 }], [99, { id: 99 }]]),
      },
    };
    setPageForTests(page);
    check(eaOptions("nation").map((e) => e.name).join() === "France,Italie", "nations : noms traduits par EA, triés", eaOptions("nation"));
    check(eaOptions("league").map((e) => e.name).join() === "Premier League,Serie A Enilive", "championnats : nom complet, sinon nom court", eaOptions("league"));
    check(eaOptions("club", { leagueId: 31 }).map((e) => e.name).join() === "Juventus,Köln (Serie A Enilive),Napoli" && eaOptions("club").length === 5, "clubs du championnat choisi (tous sans championnat), club sans nom dans le jeu écarté", eaOptions("club", { leagueId: 31 }));
    check(eaOptions("club").filter((e) => /^Köln/.test(e.name)).map((e) => e.name).join() === "Köln (Premier League),Köln (Serie A Enilive)", "même nom pour deux clubs : championnat entre parenthèses", eaOptions("club").map((e) => e.name));
    check(eaOptions("rarity").map((e) => e.id).join() === "0,1,22,3", "types : commune, rare, puis les promos par nom (inconnus écartés)", eaOptions("rarity"));
    const styles = eaOptions("style");
    check(styles.length === 24 && styles.find((e) => e.id === 268).name === "Ombre" && styles.find((e) => e.id === 266).name === "Chasseur", "24 styles de chimie : nom EA, sinon nom du script", styles.slice(16, 19));
    const filter = normalizeFilter({ nation: 27, league: 31, club: 45, playStyle: 268, rarities: [3], holo: "only", level: "gold" });
    const text = filterStore.describeFilter(filter);
    check(/Équipe de la semaine \(TOTW\)/.test(text) && /holo seulement/.test(text) && /Italie/.test(text) && /Serie A Enilive/.test(text) && /Juventus/.test(text) && /style Ombre/.test(text) && !/\b(27|31|45|268)\b/.test(text), "liste des filtres : noms du jeu, plus d'identifiants", text);
    check(eaName("nation", 999) === "" && /nation 999/.test(filterStore.describeFilter(normalizeFilter({ nation: 999 }))), "valeur inconnue : ancien libellé avec l'identifiant", filterStore.describeFilter(normalizeFilter({ nation: 999 })));
    check(normalizeFilter({ holo: "only" }).holo === "only" && normalizeFilter({ holo: "x" }).holo === "any" && normalizeFilter({}).holo === "any", "choix holo : only / none / any par défaut");
    setPageForTests({});
    check(eaOptions("nation").length === 0 && eaOptions("style").find((e) => e.id === 268).name === "Ombre", "web app pas chargé : listes vides, styles avec les noms du script");
  }

  console.log(`\n${passes} OK, ${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
