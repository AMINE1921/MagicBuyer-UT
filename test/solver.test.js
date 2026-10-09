import { DOMParser } from "linkedom";
import { createMockEa } from "./mockEa";
import { setPageForTests } from "../app/core/page";
import * as settings from "../app/core/settings";
import { createCancelToken } from "../app/core/async";
import { startToolTask } from "../app/core/toolTask";
import { endTask } from "../app/core/tasks";
import { KEYS, SCOPE, normalizeRequirement, readChallengeRequirements } from "../app/core/sbcRequirements";
import {
  DEFAULT_CHEM_PARAMS,
  buildView,
  compileChecks,
  evaluateView,
  localChemistry,
  maxRatingForStars,
  minRatingForStars,
  squadRating,
  starRating,
  tierOf,
} from "../app/core/sbcEval";
import {
  buildPool,
  costOf,
  entryFromItem,
  estimatePrice,
  excludeReason,
  loadPoolItems,
  markConsumed,
  poolCacheInfo,
  resetPoolForTests,
  setPoolPauseForTests,
} from "../app/core/sbcPool";
import { arrangeByPosition, solveSbc } from "../app/core/sbcSolver";
import { eaChemistry, placeSolution, readChallengeSlots, readSolverContext, solveChallenge, verifyWithEa } from "../app/core/sbcSquad";
import { applySelection, findWorkAreaController, oneClickRules, planOneClick, planWorkArea, readWorkArea, selectBought, undoSelection } from "../app/core/sbcOneClick";
import {
  chooseOutcome,
  loadMarketLists,
  marketEntries,
  marketEntry,
  marketListUrl,
  marketPicksOf,
  marketQueries,
  rememberVerified,
  resetMarketForTests,
  rowDetails,
  setMarketPauseForTests,
} from "../app/core/sbcMarket";
import { buyMarketCards, ladderFor, referencePrice, verifyMarketCards } from "../app/core/sbcBuy";
import { placeWithConcepts, squadAfterPurchase, verifyPlan } from "../app/core/sbcSquad";
import { conceptSlots, conceptTargets, conceptTotal, rememberPlanned, plannedFor, replaceConcepts, resetConceptsForTests, slotForBought } from "../app/core/sbcConcepts";
import { resetFutbinClientForTests } from "../app/prices/futbinClient";
import { filteredPlayersUrl, futbinApiPausedUntil, resetFutbinApiForTests } from "../app/prices/futbinApi";

global.DOMParser = DOMParser;

let failures = 0;
let passes = 0;
const check = (cond, label, extra) => {
  if (cond) { passes++; console.log(`  ✓ ${label}`); }
  else { failures++; console.log(`  ✗ ${label}`, extra !== undefined ? JSON.stringify(extra, (key, value) => (key === "item" || key === "raw" || key === "check" ? undefined : value)) : ""); }
};

// ---------------------------------------------------------------- doublures EA

// Exigence EA simulée (UTSBCEligibilityDTO) : kvPairs avec keys / getValue / getFirstValue.
const fakeReq = (pairs, { scope = SCOPE.GREATER, count = -1, attribute = false, label = "" } = {}) => {
  const table = new Map(Object.keys(pairs).map((key) => [Number(key), [].concat(pairs[key])]));
  return {
    scope,
    count,
    isAttributeRequirement: attribute,
    get isCombinedRequirement() { return table.size > 1; },
    kvPairs: {
      keys: () => Array.from(table.keys()).map(String),
      getValue: (key) => table.get(Number(key)) || [-1],
      getFirstValue: (key) => (table.get(Number(key)) || [-1])[0],
    },
    buildString: label ? () => label : undefined,
  };
};

let reqIndex = 0;
const req = (pairs, opts) => normalizeRequirement(fakeReq(pairs, opts), reqIndex++);

// Observable EA simulé : réponse envoyée de façon asynchrone.
const fakeObservable = (response) => {
  const obs = { _o: [], observe(scope, cb) { this._o.push({ scope, cb }); return this; }, unobserve() { return this; } };
  setTimeout(() => obs._o.forEach((o) => o.cb.call(o.scope, obs, response)), 1);
  return obs;
};

// Postes EA (PlayerPosition) d'un 4-3-3 : GK, RB, CB, CB, LB, CM ×3, RW, ST, LW.
const F433 = [0, 3, 5, 5, 7, 14, 14, 14, 23, 25, 27];
const POSITION_NAMES = { 0: "GK", 3: "RB", 5: "CB", 7: "LB", 14: "CM", 23: "RW", 25: "ST", 27: "LW" };
const slotsFor = (positions = F433, bricks = {}, fixed = {}) =>
  positions.map((position, index) => ({ index, position, label: POSITION_NAMES[position] || "", brick: bricks[index] || false, fixed: fixed[index] || null }));

// Entrée de réserve (forme normalisée de sbcPool.entryFromItem).
let uid = 0;
const P = (rating, o = {}) => {
  uid += 1;
  const positions = o.positions || [F433[uid % 11]];
  const tradable = o.tradable !== false;
  const entry = {
    key: String(o.key || `k${uid}`),
    person: o.person || `p${uid}`,
    name: o.name || `J${uid}`,
    rating,
    tier: tierOf(rating),
    nationId: o.nation == null ? 18 : o.nation,
    leagueId: o.league == null ? 13 : o.league,
    teamId: o.club == null ? 1 : o.club,
    clubId: o.clubId == null ? (o.club == null ? 1 : o.club) : o.clubId,
    rareflag: o.rare == null ? 0 : o.rare,
    groups: o.groups || [],
    owners: o.firstOwner ? 1 : 3,
    firstOwner: !!o.firstOwner,
    tradable,
    untradeable: !tradable,
    legend: !!o.legend,
    hero: !!o.hero,
    superChem: false,
    positions,
    preferredPosition: positions[0],
    source: o.source || "club",
    duplicate: false,
    discardValue: 0,
    value: o.value || estimatePrice(rating),
    estimated: false,
    price: 0,
  };
  entry.cost = o.cost == null ? costOf(entry, { preferUntradeables: true, preferStorage: true }) : o.cost;
  return entry;
};

const run = (requirements, pool, extra = {}) =>
  solveSbc(Object.assign({ requirements, slots: slotsFor(), pool, options: { seed: 7, timeBudgetMs: 2500, chemMinMs: 300 } }, extra));

const personsUnique = (result) => {
  const persons = result.squad.filter((pick) => pick.entry).map((pick) => pick.entry.person);
  return new Set(persons).size === persons.length;
};

// Carte EA simulée (club / stockage).
const eaItem = (id, rating, o = {}) =>
  Object.assign(
    {
      id,
      definitionId: o.definitionId || 100000 + id,
      rating,
      teamId: o.teamId || 10,
      leagueId: o.leagueId || 13,
      nationId: o.nationId || 18,
      rareflag: o.rareflag == null ? 1 : o.rareflag,
      groups: [],
      owners: 2,
      tradable: o.tradable !== false,
      possiblePositions: o.positions || [F433[id % 11]],
      preferredPosition: (o.positions || [F433[id % 11]])[0],
      discardValue: 0,
      upgrades: o.evolved ? { positions: [] } : null,
      concept: !!o.concept,
      isFavorite: !!o.favorite,
      _staticData: { name: o.name || `Carte ${id}` },
      isPlayer() { return true; },
      isValid() { return true; },
      isLimitedUse() { return !!o.loan; },
      isEnrolledInAcademy() { return !!o.academy; },
      isDuplicate() { return !!o.duplicate; },
      isLegend() { return false; },
      isLeagueHeroItem() { return false; },
      isSuperChem() { return false; },
      isSpecial() { return false; },
    },
    o.fields || {}
  );

const sum = (list) => list.reduce((total, value) => total + value, 0);

const main = async () => {
  setPageForTests(createMockEa().page);
  settings.setSetting("ui.language", "fr");

  console.log("\n# exigences EA → forme normalisée");
  {
    const rating = req({ [KEYS.TEAM_RATING]: 84 }, { label: "Note d'équipe : min. 84" });
    check(rating.key === "TEAM_RATING" && rating.value === 84 && rating.scope === SCOPE.GREATER && rating.supported && !rating.combined, "note d'équipe min. 84", rating);
    check(rating.label === "Note d'équipe : min. 84", "libellé d'EA (buildString) gardé");
    const leagues = req({ [KEYS.LEAGUE_ID]: [13, 53] }, { count: 3 });
    check(leagues.key === "LEAGUE_ID" && leagues.values.join() === "13,53" && leagues.count === 3 && leagues.supported, "championnats 13 OU 53 : toutes les valeurs gardées, nombre de joueurs", leagues);
    check(/min\. 3 joueurs/.test(leagues.label), "libellé de repli en français", leagues.label);
    const combined = req({ [KEYS.LEAGUE_ID]: 13, [KEYS.PLAYER_MIN_OVR]: 80 }, { count: 2 });
    check(combined.combined && combined.supported && combined.terms.map((term) => term.key).join() === "LEAGUE_ID,PLAYER_MIN_OVR" && combined.count === 2, "exigence combinée championnat + note min", combined);
    const group = req({ [KEYS.PLAYER_RARITY_GROUP]: 4, [KEYS.LEAGUE_ID]: 13 }, { count: 1 });
    check(group.combined && !group.supported, "combinée avec un groupe de cartes : non gérée (EA ne sait pas la valider)");
    const attribute = req({ [KEYS.PLAYER_ATTRIBUTE]: 1, [KEYS.ACADEMY_PLAYER_SLOTTING]: 2 }, { attribute: true });
    check(attribute.attribute && !attribute.supported, "exigence d'attributs : non gérée");
    const unknown = req({ 99: 1 });
    check(unknown.key === "KEY_99" && !unknown.supported, "clé inconnue signalée", unknown);
    const noScope = req({ [KEYS.CHEMISTRY_POINTS]: 20 }, { scope: -1 });
    check(noScope.scope === SCOPE.EXACT, "portée absente (-1) : égalité, comme EA");
    // DTO EA réel : keys() / getValue() sur l'exigence ; clé de traduction manquante (« * »).
    const dto = { scope: 1, count: -1, keys: () => ["6"], getValue: (key) => (Number(key) === 6 ? [2] : [-1]), buildString: () => "*sbc.requirements.players.scope1" };
    const sameClub = normalizeRequirement(dto, 50);
    check(sameClub.key === "SAME_CLUB_COUNT" && sameClub.value === 2 && sameClub.scope === SCOPE.LOWER && sameClub.label[0] !== "*", "DTO EA (keys / getValue) et libellé EA manquant remplacé", sameClub);
    const mock = createMockEa();
    mock.page.SBCEligibilityKey = Object.assign({}, KEYS, { TEAM_RATING: 77 });
    setPageForTests(mock.page);
    const renumbered = req({ 77: 85 });
    check(renumbered.key === "TEAM_RATING" && renumbered.value === 85, "identifiants relus dans le web app (SBCEligibilityKey)");
    const challenge = readChallengeRequirements({ eligibilityOperation: "OR", eligibilityRequirements: [fakeReq({ 77: 80 }), fakeReq({ [KEYS.NATION_COUNT]: 3 }, { scope: SCOPE.LOWER })] });
    check(challenge.operation === "OR" && challenge.requirements.length === 2 && challenge.requirements[1].key === "NATION_COUNT" && challenge.requirements[1].index === 1, "défi : opération OU et liste d'exigences");
    setPageForTests(createMockEa().page);
  }

  console.log("\n# note d'équipe (UTSquadEntity._calculateRating)");
  {
    const r = (list, float = true) => squadRating(list, float);
    check(r(Array(11).fill(84)) === 84, "11 × 84 → 84");
    check(r([...Array(10).fill(84), 83]) === 84, "10 × 84 + 83 → 84 (calcul à virgule)");
    check(r([...Array(9).fill(84), 83, 83]) === 84, "9 × 84 + 2 × 83 → 84");
    check(r([...Array(8).fill(84), 83, 83, 83]) === 83, "8 × 84 + 3 × 83 → 83 (calcul à virgule)");
    check(r([...Array(8).fill(84), 83, 83, 83], false) === 84, "8 × 84 + 3 × 83 → 84 (ancien calcul entier)");
    check(r([86, 85, 85, 84, 84, 84, 84, 83, 83, 83, 83]) === 84, "86 85 85 84×4 83×4 → 84");
    check(r([0, ...Array(10).fill(84)]) === 83, "brique / poste vide : 0 sur 11 → 83");
    // 99 + 10 × 60 : somme 699, moyenne 63,55, écart 35,45 → 734,45 → 734 / 11 → 66.
    check(r([90, ...Array(10).fill(80)]) === 81 && r([99, ...Array(10).fill(60)]) === 66, "joueur au-dessus de la moyenne compté deux fois (écart)", [r([90, ...Array(10).fill(80)]), r([99, ...Array(10).fill(60)])]);
    check(starRating(59) === 0.5 && starRating(60) === 1 && starRating(78) === 4 && starRating(79) === 4.5 && starRating(83) === 5, "étoiles d'après STAR_RATING_THRESHOLDS");
    check(minRatingForStars(4.5) === 79 && minRatingForStars(5) === 83 && maxRatingForStars(4) === 78, "note min / max pour un nombre d'étoiles");
    check(tierOf(64) === 1 && tierOf(65) === 2 && tierOf(74) === 2 && tierOf(75) === 3, "paliers bronze ≤ 64, argent ≤ 74, or ≥ 75");
  }

  console.log("\n# évaluateur : nombres, valeurs distinctes, plus grand groupe, portées");
  {
    const linkedTeam = (id) => (id === 101 ? 100 : id);
    const squad = [
      P(85, { nation: 18, league: 13, club: 1, rare: 1, positions: [0] }),
      P(84, { nation: 18, league: 13, club: 1, positions: [3] }),
      P(84, { nation: 18, league: 13, club: 2, tradable: false, positions: [5] }),
      P(83, { nation: 18, league: 13, club: 2, firstOwner: true, positions: [5] }),
      P(83, { nation: 18, league: 13, club: 3, groups: [4], positions: [7] }),
      P(82, { nation: 52, league: 13, club: 3, positions: [14] }),
      P(82, { nation: 52, league: 53, club: 4, positions: [14] }),
      P(81, { nation: 52, league: 53, club: 5, tradable: false, positions: [14] }),
      P(80, { nation: 14, league: 53, club: 6, positions: [23] }),
      P(74, { nation: 14, league: 53, club: 7, positions: [25] }),
      P(64, { nation: 14, league: 53, club: 101, clubId: 100, positions: [27] }),
    ];
    const chem = [3, 3, 3, 3, 3, 2, 2, 2, 1, 1, 0];
    const fakeChem = () => ({ total: sum(chem), slots: chem.slice() });
    const evalOne = (requirement, options = {}) => {
      const [compiled] = compileChecks([requirement], { linkedTeam });
      const view = buildView(options.slots || slotsFor(), options.bySlot || squad, fakeChem);
      return Object.assign(compiled.evaluate(view), { kind: compiled.kind });
    };
    const nations3 = evalOne(req({ [KEYS.NATION_COUNT]: 3 }, { scope: SCOPE.LOWER }));
    const nations4 = evalOne(req({ [KEYS.NATION_COUNT]: 4 }));
    check(nations3.met && nations3.actual === 3 && !nations4.met && nations4.deficit === 1, "nationalités : max. 3 rempli, min. 4 manque 1", { nations3, nations4 });
    const same5 = evalOne(req({ [KEYS.SAME_NATION_COUNT]: 5 }));
    const same4 = evalOne(req({ [KEYS.SAME_NATION_COUNT]: 4 }, { scope: SCOPE.LOWER }));
    check(same5.met && same5.actual === 5 && !same4.met && same4.deficit === 1, "même nationalité : plus grand groupe 5 (min. 5 oui, max. 4 non)", { same5, same4 });
    const club2 = evalOne(req({ [KEYS.SAME_CLUB_COUNT]: 2 }, { scope: SCOPE.LOWER }));
    check(club2.met && club2.actual === 2, "même club : max. 2 rempli", club2);
    const clubs = evalOne(req({ [KEYS.CLUB_COUNT]: 8 }, { scope: SCOPE.EXACT }));
    check(clubs.met && clubs.actual === 8, "clubs distincts : exactement 8 (club lié compté une fois)", clubs);
    const league6 = evalOne(req({ [KEYS.LEAGUE_ID]: 13 }, { count: 6 }));
    const league5 = evalOne(req({ [KEYS.LEAGUE_ID]: 53 }, { count: 5, scope: SCOPE.EXACT }));
    const league4 = evalOne(req({ [KEYS.LEAGUE_ID]: 53 }, { count: 4, scope: SCOPE.EXACT }));
    const leagueOr = evalOne(req({ [KEYS.LEAGUE_ID]: [13, 53] }, { count: 11 }));
    check(league6.met && league5.met && !league4.met && league4.deficit === 1 && leagueOr.met && leagueOr.actual === 11, "championnat : min. / exactement, valeurs OU additionnées", { league6, league5, league4, leagueOr });
    const linked = evalOne(req({ [KEYS.CLUB_ID]: 101 }, { count: 1 }));
    check(linked.met && linked.actual === 1, "club demandé : club lié (TeamConfig.getLinkedTeam) reconnu", linked);
    const gold = evalOne(req({ [KEYS.PLAYER_QUALITY]: 3 }));
    const maxGold = evalOne(req({ [KEYS.PLAYER_QUALITY]: 3 }, { scope: SCOPE.LOWER }));
    const exactSilver = evalOne(req({ [KEYS.PLAYER_QUALITY]: 2 }, { scope: SCOPE.EXACT }));
    check(!gold.met && gold.actual === 1 && gold.deficit === 2 && maxGold.met && !exactSilver.met, "qualité : min. or (2 joueurs en dessous), max. or, exactement argent", { gold, maxGold, exactSilver });
    const level = evalOne(req({ [KEYS.PLAYER_LEVEL]: 3 }, { count: 9 }));
    const silver = evalOne(req({ [KEYS.PLAYER_LEVEL]: 2 }, { count: 1, scope: SCOPE.EXACT }));
    check(level.met && level.actual === 9 && silver.met, "joueurs or : 9, argent : exactement 1", { level, silver });
    const rare = evalOne(req({ [KEYS.PLAYER_RARITY]: 1 }, { count: 1 }));
    const groupCount = evalOne(req({ [KEYS.PLAYER_RARITY_GROUP]: 4 }, { count: 1 }));
    check(rare.met && groupCount.met, "rareté et groupe de cartes (belongsToGroup)", { rare, groupCount });
    const min84 = evalOne(req({ [KEYS.PLAYER_MIN_OVR]: 84 }, { count: 3 }));
    const max74 = evalOne(req({ [KEYS.PLAYER_MAX_OVR]: 74 }, { count: 1, scope: SCOPE.LOWER }));
    check(min84.met && min84.actual === 3 && !max74.met && max74.actual === 2, "notes min / max : nombres de joueurs", { min84, max74 });
    const untradeable = evalOne(req({ [KEYS.PLAYER_TRADABILITY]: 1 }, { count: 2 }));
    const firstOwner = evalOne(req({ [KEYS.FIRST_OWNER_PLAYERS_COUNT]: 1 }));
    check(untradeable.met && untradeable.actual === 2 && firstOwner.met, "non échangeables (valeur 1) et premier propriétaire", { untradeable, firstOwner });
    const combo = evalOne(req({ [KEYS.LEAGUE_ID]: 13, [KEYS.PLAYER_MIN_OVR]: 84 }, { count: 3 }));
    check(combo.met && combo.actual === 3, "combinée : championnat 13 ET note ≥ 84 → 3 joueurs", combo);
    const rating82 = evalOne(req({ [KEYS.TEAM_RATING]: 82 }));
    const rating83 = evalOne(req({ [KEYS.TEAM_RATING]: 83 }));
    check(rating82.met && rating82.actual === 82 && !rating83.met && Math.abs(rating83.deficit - (913 - 0.5 - 904.5454545) / 11) < 1e-3, "note d'équipe 82 : min. 82 oui, min. 83 non (écart continu)", { rating82, rating83 });
    const stars = evalOne(req({ [KEYS.TEAM_STAR_RATING]: 4.5 }));
    check(stars.met && stars.actual === 4.5, "note en étoiles (valeur EA déjà divisée par 2)", stars);
    const chem20 = evalOne(req({ [KEYS.CHEMISTRY_POINTS]: 20 }));
    const chem25 = evalOne(req({ [KEYS.CHEMISTRY_POINTS]: 25 }));
    check(chem20.met && chem20.actual === 23 && !chem25.met && chem25.deficit === 2, "collectifs d'équipe (fonction injectée) : 23", { chem20, chem25 });
    const all1 = evalOne(req({ [KEYS.ALL_PLAYERS_CHEMISTRY_POINTS]: 1 }));
    check(!all1.met && all1.actual === 10 && all1.deficit === 1, "collectifs par joueur min. 1 : un joueur à 0 → non rempli", all1);
    const withBrick = evalOne(req({ [KEYS.ALL_PLAYERS_CHEMISTRY_POINTS]: 1 }), {
      slots: slotsFor(F433, { 10: "simple" }),
      bySlot: squad.map((entry, index) => (index === 10 ? null : entry)),
    });
    check(withBrick.met && withBrick.total === 10, "brique simple : hors du compte des collectifs par joueur", withBrick);
    const chemCombo = evalOne(req({ [KEYS.ALL_PLAYERS_CHEMISTRY_POINTS]: 3, [KEYS.LEAGUE_ID]: 13 }, { count: 5 }));
    const chemCombo6 = evalOne(req({ [KEYS.ALL_PLAYERS_CHEMISTRY_POINTS]: 3, [KEYS.LEAGUE_ID]: 13 }, { count: 6 }));
    check(chemCombo.met && chemCombo.actual === 5 && !chemCombo6.met, "combinée avec collectifs (exactement 3, comme EA) + championnat", { chemCombo, chemCombo6 });
    const checks = compileChecks([req({ [KEYS.NATION_COUNT]: 4 }), req({ [KEYS.LEAGUE_ID]: 13 }, { count: 6 })], { linkedTeam });
    const view = buildView(slotsFor(), squad, fakeChem);
    check(evaluateView(checks, view, { operation: "OR" }).met && !evaluateView(checks, view).met, "opération OU : une exigence suffit ; ET : toutes");
    const partial = buildView(slotsFor(), squad.map((entry, index) => (index === 4 ? null : entry)), fakeChem);
    const partialEval = evaluateView(compileChecks([req({ [KEYS.LEAGUE_ID]: 13 }, { count: 3 })]), partial);
    check(!partialEval.met && !partialEval.full && partialEval.violation >= 5, "équipe incomplète : jamais validée", partialEval.violation);
  }

  console.log("\n# collectifs : modèle de base d'EA (UTSquadChemCalculatorUtils)");
  {
    const chemistry = localChemistry(DEFAULT_CHEM_PARAMS);
    const sameLeague = F433.map((position, index) => P(80, { league: 13, nation: 30 + index, club: 200 + index, positions: [position] }));
    const full = chemistry(slotsFor(), sameLeague);
    check(full.total === 33 && full.slots.every((value) => value === 3), "11 joueurs du même championnat à leur poste → 33", full);
    const outOfPosition = sameLeague.map((entry, index) => (index === 0 ? Object.assign({}, entry, { positions: [25] }) : entry));
    const out = chemistry(slotsFor(), outOfPosition);
    check(out.slots[0] === 0 && out.total === 30, "joueur hors poste : 0 et n'apporte rien aux autres", out);
    const mixed = F433.map((position, index) => P(80, { league: index < 4 ? 1 : index < 8 ? 2 : 3, nation: 40 + index, club: 300 + index, positions: [position] }));
    const mixedChem = chemistry(slotsFor(), mixed);
    check(mixedChem.total === 11, "4 + 4 + 3 joueurs par championnat → 1 point chacun", mixedChem);
    const pairs = mixed.map((entry, index) => (index < 2 ? Object.assign({}, entry, { nationId: 99 }) : entry));
    check(chemistry(slotsFor(), pairs).slots[0] === 2, "deux joueurs de même nationalité : +1 chacun");
    const icon = Object.assign(P(88, { league: 2118, club: 112658, nation: 5, positions: [F433[10]] }), { legend: true, teamId: 112658, clubId: 112658 });
    const withIcon = F433.map((position, index) => (index === 10 ? icon : P(80, { league: index < 2 ? 7 : 500 + index, nation: 60 + index, club: 400 + index, positions: [position] })));
    const iconChem = chemistry(slotsFor(), withIcon);
    check(iconChem.slots[10] === 3 && iconChem.slots[0] === 1 && iconChem.slots[2] === 0, "icône à son poste : 3 points, +1 à chaque championnat présent", iconChem);
  }

  console.log("\n# réserve : exclusions, coût, cache");
  {
    resetPoolForTests();
    const items = [
      { item: eaItem(1, 80), source: "club" },
      { item: eaItem(2, 88, { loan: true }), source: "club" },
      { item: eaItem(3, 88, { academy: true }), source: "club" },
      { item: eaItem(4, 88, { evolved: true }), source: "club" },
      { item: eaItem(5, 88), source: "club" },
      { item: eaItem(6, 88, { favorite: true }), source: "club" },
      { item: eaItem(7, 88, { concept: true }), source: "club" },
      { item: eaItem(8, 80, { tradable: false }), source: "club" },
      { item: eaItem(9, 80, { duplicate: true }), source: "storage" },
      { item: eaItem(10, 90), source: "club" },
      { item: eaItem(11, 88), source: "club" },
      { item: eaItem(12, 88), source: "club" },
    ];
    markConsumed(["11"], "999");
    markConsumed(["12"], "501");
    const squadIds = new Set(["5"]);
    const pool = buildPool(items, {}, { squadIds, linkedTeam: (id) => id, priceOf: () => 0, challengeId: "501" });
    const keys = pool.entries.map((entry) => entry.key).sort((a, b) => a - b).join();
    check(keys === "1,8,9,10,12", "prêt, évolution en cours, évolué, équipe active, favori, concept, placé ailleurs : écartés", { keys, excluded: pool.excluded });
    check(pool.excluded.loan === 1 && pool.excluded.academy === 1 && pool.excluded.evolved === 1 && pool.excluded.squad === 1 && pool.excluded.favorite === 1 && pool.excluded.concept === 1 && pool.excluded.placed === 1 && pool.total === 12, "motifs comptés", pool.excluded);
    const byKey = new Map(pool.entries.map((entry) => [entry.key, entry]));
    check(byKey.get("8").cost < byKey.get("9").cost && byKey.get("9").cost < byKey.get("1").cost, "coût : non échangeable < doublon du stockage < carte du club", [byKey.get("8").cost, byKey.get("9").cost, byKey.get("1").cost]);
    check(byKey.get("1").estimated && byKey.get("1").value === estimatePrice(80, { rare: true }), "prix FUTBIN inconnu : estimation d'après la note");
    const priced = buildPool([{ item: eaItem(20, 84), source: "club" }], {}, { priceOf: () => 3100, linkedTeam: (id) => id });
    check(priced.entries[0].value === 3100 && !priced.entries[0].estimated, "prix FUTBIN connu utilisé");
    const strict = buildPool(items, { maxRating: 89, onlyUntradeables: false, excludeEvolved: false }, { squadIds, priceOf: () => 0, linkedTeam: (id) => id, challengeId: "501" });
    check(strict.excluded.rating === 1 && strict.entries.some((entry) => entry.key === "4") && !strict.entries.some((entry) => entry.key === "10"), "note max 89 (le 90 écarté), évolués autorisés si décoché", strict.excluded);
    const onlyUt = buildPool(items, { onlyUntradeables: true }, { squadIds, priceOf: () => 0, linkedTeam: (id) => id });
    check(onlyUt.entries.length === 1 && onlyUt.entries[0].key === "8", "uniquement des non échangeables");
    const forbidden = buildPool(items, { untradeableForbidden: true }, { squadIds, priceOf: () => 0, linkedTeam: (id) => id });
    check(!forbidden.entries.some((entry) => entry.untradeable) && forbidden.excluded.untradeable === 1, "non échangeables refusés par le serveur EA : écartés");
    const noStorage = buildPool(items, { useStorage: false }, { squadIds, priceOf: () => 0, linkedTeam: (id) => id });
    check(!noStorage.entries.some((entry) => entry.source === "storage"), "stockage DCE désactivé");
    const maxPrice = buildPool(items, { maxPrice: 1000 }, { squadIds, priceOf: () => 0, linkedTeam: (id) => id });
    check(maxPrice.excluded.price >= 1 && maxPrice.entries.every((entry) => entry.value <= 1000), "prix max par joueur", maxPrice.excluded);
    const legend = entryFromItem(Object.assign(eaItem(30, 90), { iconId: 77, isLegend: () => true }), "club", { priceOf: () => 0 });
    const legend2 = entryFromItem(Object.assign(eaItem(31, 92, { definitionId: 500031 }), { iconId: 77, isLegend: () => true }), "club", { priceOf: () => 0 });
    const twin = entryFromItem(eaItem(32, 85, { definitionId: 50331648 + 100032 }), "club", { priceOf: () => 0 });
    const base = entryFromItem(eaItem(32, 80, { definitionId: 100032 }), "club", { priceOf: () => 0 });
    check(legend.person === legend2.person && twin.person === base.person, "même joueur reconnu (icône : iconId, sinon databaseId)", [legend.person, twin.person, base.person]);
    check(excludeReason({ concept: false, loan: false, academy: false, evolved: false, favorite: false, key: "x", tradable: true, rating: 80, value: 1 }, {}) === null, "carte normale utilisable");
  }

  console.log("\n# réserve : lecture du club (pages de 90), stockage, équipe active, arrêt EA");
  {
    resetPoolForTests();
    setPoolPauseForTests(1, 2);
    const mock = createMockEa();
    const club = Array.from({ length: 200 }, (_, index) => eaItem(index + 1, 70 + (index % 20)));
    const calls = { club: [], storage: 0, squad: 0 };
    mock.page.services.Club = {
      search(criteria) {
        calls.club.push(criteria.offset);
        const items = club.slice(criteria.offset, criteria.offset + criteria.count);
        return fakeObservable({ success: true, response: { items, retrievedAll: criteria.offset + criteria.count >= club.length } });
      },
    };
    mock.page.services.Item.searchStorageItems = () => {
      calls.storage += 1;
      return fakeObservable({ success: true, response: { items: [eaItem(500, 80, { duplicate: true })], endOfList: true } });
    };
    mock.page.services.Squad = {
      requestSquadByType() {
        calls.squad += 1;
        return fakeObservable({ success: true, data: { squad: { getPlayers: () => [{ item: club[0] }, { item: club[1] }] } } });
      },
    };
    setPageForTests(mock.page);
    const phases = [];
    const loaded = await loadPoolItems({ onProgress: (progress) => phases.push(progress.phase) });
    check(loaded.ok && loaded.items.length === 201 && calls.club.join() === "0,90,180" && calls.storage === 1 && calls.squad === 1, "3 pages de club (0, 90, 180) + stockage + équipe active", { n: loaded.items.length, calls });
    check(loaded.squadIds.has("1") && loaded.squadIds.has("2") && loaded.items.filter((entry) => entry.source === "storage").length === 1, "équipe active lue, doublon du stockage repéré");
    check(phases[0] === "squad" && phases.includes("club") && phases.includes("storage"), "progression : équipe, club, stockage", phases);
    const again = await loadPoolItems({});
    check(again.ok && again.cached && calls.club.length === 3 && !!poolCacheInfo(), "club gardé en mémoire (10 min) : aucune requête");
    const forced = await loadPoolItems({ force: true });
    check(forced.ok && !forced.cached && calls.club.length === 6, "« Relire le club » : nouvelle lecture");
    resetPoolForTests();
    setPoolPauseForTests(1, 2);
    let pages = 0;
    mock.page.services.Club.search = (criteria) => {
      pages += 1;
      return pages === 2
        ? fakeObservable({ success: false, status: 458, error: { code: 458 } })
        : fakeObservable({ success: true, response: { items: club.slice(criteria.offset, criteria.offset + 90), retrievedAll: false } });
    };
    const storageBefore = calls.storage;
    const captcha = await loadPoolItems({ excludeActiveSquad: false });
    check(!captcha.ok && captcha.stopped && captcha.error.code === 458 && pages === 2 && calls.storage === storageBefore && !poolCacheInfo(), "captcha (458) : arrêt immédiat, plus aucune requête", { captcha, pages });
    for (const code of [401, 426, 429, 512, 521]) {
      resetPoolForTests();
      setPoolPauseForTests(1, 2);
      mock.page.services.Club.search = () => fakeObservable({ success: false, status: code, error: { code } });
      const result = await loadPoolItems({ excludeActiveSquad: false, useStorage: false });
      check(!result.ok && result.stopped, `code ${code} : arrêt`, result);
    }
    resetPoolForTests();
    setPoolPauseForTests(1, 2);
    pages = 0;
    mock.page.services.Club.search = (criteria) => {
      pages += 1;
      return pages === 2
        ? fakeObservable({ success: false, status: 500, error: { code: 500 } })
        : fakeObservable({ success: true, response: { items: club.slice(criteria.offset, criteria.offset + 90), retrievedAll: false } });
    };
    const partial = await loadPoolItems({ excludeActiveSquad: false, useStorage: false });
    check(partial.ok && partial.partial && partial.items.length === 90 && /partie/.test(partial.warning) && !poolCacheInfo(), "erreur passagère après une page : lecture partielle signalée, pas gardée", partial.warning);
    resetPoolForTests();
    setPoolPauseForTests(30, 40);
    mock.page.services.Club.search = (criteria) => fakeObservable({ success: true, response: { items: club.slice(criteria.offset, criteria.offset + 90), retrievedAll: false } });
    const token = createCancelToken();
    setTimeout(() => token.cancel(), 10);
    const stopped = await loadPoolItems({ token, excludeActiveSquad: false });
    check(!stopped.ok && stopped.cancelled, "Stop pendant la lecture du club");
    mock.page.services.Squad.requestSquadByType = () => fakeObservable({ success: false, status: 500, error: { code: 500 } });
    resetPoolForTests();
    setPoolPauseForTests(1, 2);
    const noSquad = await loadPoolItems({ excludeActiveSquad: true });
    check(!noSquad.ok && /équipe active/.test(noSquad.error.label), "équipe active illisible : rien n'est proposé", noSquad);
    resetPoolForTests();
    setPageForTests(createMockEa().page);
  }

  console.log("\n# placement par poste (couplage maximum)");
  {
    const players = [P(80, { positions: [25] }), P(80, { positions: [0] }), P(80, { positions: [5, 14] })];
    const places = arrangeByPosition(players, [0, 5, 25]);
    check(places.join() === "2,0,1", "BU → BU, GB → GB, DC/MC → DC", places);
    const crowded = arrangeByPosition([P(80, { positions: [25] }), P(80, { positions: [25] })], [25, 0]);
    check(crowded.sort().join() === "0,1", "deux joueurs pour un poste : l'autre prend le poste restant", crowded);
  }

  console.log("\n# solveur : note d'équipe min. 84 (réserve mélangée)");
  {
    uid = 0;
    const pool = [];
    [[80, 20], [81, 20], [82, 20], [83, 20], [84, 15], [85, 8], [86, 5], [87, 3]].forEach(([rating, count]) => {
      for (let index = 0; index < count; index += 1) {
        pool.push(P(rating, { league: 10 + (index % 5), nation: 20 + (index % 7), club: 100 + index }));
      }
    });
    for (let index = 0; index < 4; index += 1) {
      pool.push(P(84, { tradable: false, name: `NE84-${index}` }));
    }
    pool.push(P(86, { tradable: false, name: "NE86-a" }), P(86, { tradable: false, name: "NE86-b" }));
    const started = Date.now();
    const result = await run([req({ [KEYS.TEAM_RATING]: 84 })], pool);
    const ratings = result.squad.map((pick) => pick.entry.rating);
    const untradeables = result.squad.filter((pick) => pick.entry.untradeable).length;
    const baseline = 11 * estimatePrice(84);
    check(result.ok && result.rating >= 84 && squadRating(ratings) === result.rating, "équipe valide, note recalculée identique", { rating: result.rating, ratings, reason: result.reason });
    check(untradeables === 6, "les 6 non échangeables (84 et 86) sont utilisés en premier", untradeables);
    check(result.cost < baseline * 0.7, "coût bien inférieur à 11 joueurs à 84", { cost: result.cost, baseline });
    check(personsUnique(result) && result.squad.length === 11, "11 joueurs différents");
    check(Date.now() - started < 6000 && result.stats.evaluations > 0, "budget de temps tenu", result.stats);
  }

  console.log("\n# solveur : min. 3 joueurs d'un championnat + max. 2 du même club");
  {
    uid = 0;
    const pool = [];
    for (let index = 0; index < 30; index += 1) {
      pool.push(P(70, { league: 13, club: 1 + (index % 4), nation: 30 + (index % 9), cost: 200 + index * 5 }));
    }
    [[50, 1000], [50, 1100], [50, 1200], [51, 1500], [51, 1600], [52, 3000], [52, 3100]].forEach(([club, cost]) => pool.push(P(78, { league: 61, club, cost })));
    const result = await run([req({ [KEYS.LEAGUE_ID]: 61 }, { count: 3 }), req({ [KEYS.SAME_CLUB_COUNT]: 2 }, { scope: SCOPE.LOWER })], pool);
    const picks = result.squad.map((pick) => pick.entry);
    const fromLeague = picks.filter((entry) => entry.leagueId === 61);
    const perClub = new Map();
    picks.forEach((entry) => perClub.set(entry.clubId, (perClub.get(entry.clubId) || 0) + 1));
    check(result.ok && fromLeague.length >= 3 && Math.max(...perClub.values()) <= 2, "3 joueurs du championnat 61, jamais plus de 2 par club", { reason: result.reason, failing: result.failing, perClub: Array.from(perClub) });
    check(fromLeague.map((entry) => entry.cost).sort((a, b) => a - b).join() === "1000,1100,1500", "les moins chers compatibles (1 000, 1 100 du club 50 + 1 500 du club 51)", fromLeague.map((entry) => entry.cost));
  }

  console.log("\n# solveur : collectifs exigés (fonction de collectifs injectée)");
  {
    uid = 0;
    const pool = [];
    // Championnat 13 : tous les postes, cher ; 53 : 8 postes seulement, bon marché ; 16 : tous les postes.
    F433.forEach((position, index) => {
      for (let copy = 0; copy < 3; copy += 1) {
        pool.push(P(78, { league: 13, nation: 40 + ((index + copy) % 6), club: 600 + index, positions: [position], cost: 2000 + copy * 100 + index }));
        pool.push(P(76, { league: 16, nation: 70 + ((index + copy) % 5), club: 700 + ((index + copy) % 4), positions: [position], cost: 900 + copy * 50 + index }));
        if (index < 8) {
          pool.push(P(75, { league: 53, nation: 50 + (copy % 3), club: 800 + copy, positions: [position], cost: 300 + copy * 20 + index }));
        }
      }
    });
    const chemistry = localChemistry(DEFAULT_CHEM_PARAMS);
    const requirements = [req({ [KEYS.CHEMISTRY_POINTS]: 28 }), req({ [KEYS.TEAM_RATING]: 70 })];
    const result = await run(requirements, pool, { chemistry, options: { seed: 11, timeBudgetMs: 4000, chemMinMs: 300 } });
    const bySlot = new Array(11).fill(null);
    result.squad.forEach((pick) => {
      bySlot[pick.slot] = pick.entry;
    });
    const recomputed = chemistry(slotsFor(), bySlot);
    check(result.ok && result.chemistry >= 28 && recomputed.total === result.chemistry, "collectifs ≥ 28 atteints (recalcul identique)", { reason: result.reason, chem: result.chemistry, recomputed: recomputed.total, failing: result.failing });
    check(
      result.squad.every((pick) => pick.inPosition === pick.entry.positions.includes(pick.position) && (pick.inPosition || pick.chemistry === 0)),
      "postes cohérents : un joueur hors poste n'a aucun collectif",
      result.squad.map((pick) => [pick.position, pick.entry.positions[0], pick.chemistry])
    );
    const perPlayer = await run([req({ [KEYS.ALL_PLAYERS_CHEMISTRY_POINTS]: 2 })], pool, { chemistry, options: { seed: 5, timeBudgetMs: 4000, chemMinMs: 300 } });
    check(perPlayer.ok && perPlayer.squad.every((pick) => pick.chemistry >= 2), "collectifs par joueur min. 2", { reason: perPlayer.reason, chem: perPlayer.squad.map((pick) => pick.chemistry) });
    // Fonction de collectifs simplifiée : 3 points par joueur du championnat 53, sinon 0.
    let calls = 0;
    const fake = (slots, entries) => {
      calls += 1;
      const points = entries.map((entry) => (entry && entry.leagueId === 53 ? 3 : 0));
      return { total: sum(points), slots: points };
    };
    const simple = await run([req({ [KEYS.CHEMISTRY_POINTS]: 15 })], pool, { chemistry: fake });
    check(simple.ok && simple.squad.filter((pick) => pick.entry.leagueId === 53).length >= 5 && calls > 0, "fonction injectée utilisée : 5 joueurs du championnat 53 au moins", { reason: simple.reason, calls });
  }

  console.log("\n# solveur : exigence impossible, réserve trop petite, exigence non gérée");
  {
    uid = 0;
    const pool = Array.from({ length: 30 }, (_, index) => P(78 + (index % 8)));
    const impossible = await run([req({ [KEYS.TEAM_RATING]: 90 }, { label: "Note d'équipe : min. 90" })], pool, { options: { seed: 3, timeBudgetMs: 800 } });
    check(!impossible.ok && impossible.reason === "infeasible" && impossible.failing.some((item) => item.label === "Note d'équipe : min. 90"), "note 90 impossible : exigence en échec signalée", { reason: impossible.reason, failing: impossible.failing });
    // Meilleure note possible avec cette réserve : 3 × 85, 3 × 84, 4 × 83, 82 → 84.
    check(impossible.squad.length === 11 && impossible.rating === 84, "meilleure tentative gardée (la note la plus haute possible)", impossible.rating);
    const small = await run([req({ [KEYS.TEAM_RATING]: 60 })], pool.slice(0, 8));
    check(!small.ok && small.reason === "pool", "8 joueurs pour 11 postes : réserve trop petite");
    const unsupported = await run([req({ [KEYS.PLAYER_ATTRIBUTE]: 1, [KEYS.ACADEMY_PLAYER_SLOTTING]: 2 }, { attribute: true }), req({ [KEYS.TEAM_RATING]: 70 })], pool);
    check(!unsupported.ok && unsupported.feasible && unsupported.reason === "unsupported" && unsupported.unsupported.length === 1, "exigence non gérée : signalée, le reste rempli", { reason: unsupported.reason });
    const gold = await run([req({ [KEYS.PLAYER_QUALITY]: 3 })], pool.concat([P(60), P(70), P(72)]).map((entry, index) => Object.assign(entry, { cost: index })));
    check(gold.ok && gold.squad.every((pick) => pick.entry.tier === 3), "qualité min. or : aucun bronze / argent même moins cher");
  }

  console.log("\n# solveur : préférences, exclusions, doublons, postes, briques, Stop");
  {
    uid = 0;
    const pool = [];
    F433.forEach((position) => {
      pool.push(P(75, { positions: [position], name: "Échangeable" }));
      pool.push(P(75, { positions: [position], tradable: false, name: "NE" }));
    });
    const prefer = await run([req({ [KEYS.TEAM_RATING]: 70 })], pool);
    check(prefer.ok && prefer.squad.every((pick) => pick.entry.untradeable), "non échangeables préférés à note égale", prefer.squad.map((pick) => pick.entry.name));
    const cheaper = await run([req({ [KEYS.TEAM_RATING]: 70 })], pool.map((entry, index) => Object.assign({}, entry, { cost: entry.untradeable ? 5000 : 100 + index })));
    check(cheaper.ok && cheaper.squad.every((pick) => !pick.entry.untradeable), "sinon la carte la moins chère");

    // Réserve construite depuis le club : les cartes protégées ne sont jamais proposées.
    resetPoolForTests();
    const raw = [];
    for (let index = 0; index < 22; index += 1) {
      raw.push({ item: eaItem(index + 1, 70, { positions: [F433[index % 11]] }), source: "club" });
    }
    const protectedItems = [
      eaItem(101, 90, { loan: true }),
      eaItem(102, 90, { academy: true }),
      eaItem(103, 90, { evolved: true }),
      eaItem(104, 90),
    ];
    protectedItems.forEach((item) => raw.push({ item, source: "club" }));
    const built = buildPool(raw, {}, { squadIds: new Set(["104"]), priceOf: () => 0, linkedTeam: (id) => id });
    const guarded = await run([req({ [KEYS.TEAM_RATING]: 70 })], built.entries);
    const usedIds = guarded.squad.map((pick) => pick.entry.key);
    check(guarded.ok && !usedIds.some((key) => ["101", "102", "103", "104"].includes(key)), "prêt, évolution, évolué, équipe active : jamais utilisés", usedIds);

    uid = 0;
    const twins = F433.map((position) => P(70, { positions: [position] }));
    const star = P(90, { person: "same", positions: [25], cost: 10 });
    const starTwin = P(91, { person: "same", positions: [25], cost: 11 });
    const dup = await run([req({ [KEYS.TEAM_RATING]: 72 })], twins.concat([star, starTwin]));
    check(personsUnique(dup) && dup.squad.filter((pick) => pick.entry.person === "same").length <= 1, "jamais deux versions du même joueur", dup.squad.map((pick) => pick.entry.person));

    uid = 0;
    const exact = [25, 27, 0, 3, 14, 5, 23, 7, 14, 5, 14].map((position) => P(70, { positions: [position] }));
    const positions = await run([req({ [KEYS.TEAM_RATING]: 60 })], exact);
    check(positions.ok && positions.squad.every((pick) => pick.inPosition && pick.entry.positions.includes(pick.position)), "sans exigence de collectifs : chaque joueur à un de ses postes possibles", positions.squad.map((pick) => [pick.position, pick.entry.positions[0]]));

    uid = 0;
    const brickFixed = Object.assign(P(80, { league: 13, nation: 18, club: 900, positions: [25] }), { key: "brick:9" });
    const bricks = slotsFor(F433, { 0: "simple", 9: "custom" }, { 9: brickFixed });
    const brickPool = F433.map((position, index) => P(76, { league: 13, nation: 30 + index, club: 500 + index, positions: [position] })).concat(
      F433.map((position, index) => P(76, { league: 40 + index, nation: 30 + index, club: 520 + index, positions: [position], cost: 50 }))
    );
    const brickResult = await solveSbc({
      requirements: [req({ [KEYS.ALL_PLAYERS_CHEMISTRY_POINTS]: 1 })],
      slots: bricks,
      pool: brickPool,
      chemistry: localChemistry(),
      options: { seed: 9, timeBudgetMs: 2500, chemMinMs: 300 },
    });
    check(brickResult.ok && brickResult.squad.length === 9 && !brickResult.squad.some((pick) => pick.slot === 0 || pick.slot === 9), "briques : 9 postes à remplir, briques intactes", { reason: brickResult.reason, slots: brickResult.squad.map((pick) => pick.slot) });
    const brickTwin = Object.assign(P(90, { positions: [25], cost: 1 }), { person: brickFixed.person });
    const twinResult = await solveSbc({ requirements: [req({ [KEYS.TEAM_RATING]: 60 })], slots: bricks, pool: brickPool.concat([brickTwin]), options: { seed: 4, timeBudgetMs: 1500 } });
    check(twinResult.ok && !twinResult.squad.some((pick) => pick.entry.person === brickFixed.person), "jamais une autre version du joueur imposé (brique personnalisée)");

    const combined = await run([req({ [KEYS.LEAGUE_ID]: 61, [KEYS.PLAYER_MIN_OVR]: 84 }, { count: 2 })], brickPool.concat([P(85, { league: 61, cost: 5000 }), P(84, { league: 61, cost: 4000 }), P(83, { league: 61, cost: 10 })]));
    check(combined.ok && combined.squad.filter((pick) => pick.entry.leagueId === 61 && pick.entry.rating >= 84).length >= 2, "combinée championnat ET note : 2 joueurs qui remplissent les deux");

    const orResult = await run([req({ [KEYS.TEAM_RATING]: 99 }), req({ [KEYS.NATION_COUNT]: 1 }, { scope: SCOPE.LOWER })], brickPool.map((entry, index) => Object.assign({}, entry, { nationId: index < 14 ? 7 : 8 + index })), { operation: "OR" });
    check(orResult.ok && new Set(orResult.squad.map((pick) => pick.entry.nationId)).size === 1, "opération OU : l'exigence possible est remplie (une seule nationalité)");

    const token = createCancelToken();
    token.cancel();
    const cancelled = await run([req({ [KEYS.TEAM_RATING]: 84 })], brickPool, { token });
    check(cancelled.stats.cancelled && cancelled.reason === "cancelled", "Stop : la recherche s'arrête tout de suite");
  }

  console.log("\n# web app : postes, collectifs EA, placement vérifié, enregistrement (jamais d'envoi)");
  {
    const empty = () => ({ id: 0, definitionId: 0, isValid: () => false, isPlayer: () => true });
    const makeSquad = ({ bricks = {}, formationId = 1 } = {}) => {
      const slots = Array.from({ length: 23 }, (_, index) => ({
        index,
        item: empty(),
        generalPosition: index < 11 ? F433[index] : -1,
        isBrick: () => !!bricks[index],
        isCustomBrick: () => bricks[index] === "custom",
        isValid() { return this.item.isValid(); },
      }));
      const formation = { id: formationId, getPosition: (index) => (index < 11 ? { typeId: F433[index], typeName: POSITION_NAMES[F433[index]] } : null) };
      const calls = { setPlayers: 0, clear: 0 };
      const squad = {
        getFormation: () => formation,
        getSlot: (index) => slots[index],
        removeAllItems() {
          calls.clear += 1;
          slots.forEach((slot) => {
            if (!slot.isBrick()) slot.item = empty();
          });
          return true;
        },
        // Comme EA : une autre version d'un joueur déjà présent n'est pas ajoutée.
        setPlayers(items) {
          calls.setPlayers += 1;
          items.forEach((item, index) => {
            if (item && !slots[index].isBrick()) slots[index].item = empty();
          });
          items.forEach((item, index) => {
            if (!item || slots[index].isBrick()) return;
            const db = item.definitionId & 0xffffff;
            if (db && slots.some((slot) => slot.item.isValid() && (slot.item.definitionId & 0xffffff) === db)) return;
            slots[index].item = item;
          });
        },
        isSquadFull: () => slots.slice(0, 11).every((slot) => slot.isBrick() || slot.item.isValid()),
        isSBCSquadEligible: () => true,
        getManager: () => ({ item: empty() }),
      };
      return { squad, slots, calls, formation };
    };
    const { squad, slots, calls } = makeSquad({ bricks: { 0: "simple", 9: "custom" } });
    slots[9].item = Object.assign(eaItem(900, 81, { positions: [25] }), { isValid: () => false });
    const read = readChallengeSlots(squad);
    check(read.slots.length === 11 && read.slots[0].brick === "simple" && read.slots[9].brick === "custom" && read.slots[9].fixed && read.slots[9].fixed.key === "brick:9" && read.slots[3].position === 5 && read.slots[3].label === "CB", "postes du défi : formation, briques simple / personnalisée", read.slots.map((slot) => [slot.position, slot.brick]));

    let calculations = 0;
    squad.chemCalculator = {
      calculate(formation, items) {
        calculations += 1;
        const points = Array.from(items).map((item) => (item && item.isValid() ? 2 : 0));
        return { chemistry: sum(points), getSlotChemistry: (index) => ({ points: points[index] }) };
      },
    };
    const adapter = eaChemistry(squad);
    const bySlot = new Array(11).fill(null);
    bySlot[1] = { item: eaItem(1, 80) };
    bySlot[2] = { item: eaItem(2, 80) };
    const chem = adapter ? adapter(read.slots, bySlot) : null;
    check(!!adapter && chem.total === 4 && chem.slots[1] === 2 && chem.slots[0] === 0 && calculations >= 2, "collectifs calculés par le calculateur du web app", chem);
    squad.chemCalculator = { calculate() { throw new Error("boom"); } };
    check(eaChemistry(squad) === null, "calculateur EA en erreur : repli sur le modèle local");

    const mock = createMockEa();
    const sbcCalls = { save: 0, submit: 0 };
    let saveResponse = { success: true };
    mock.page.services.SBC = {
      saveChallenge() { sbcCalls.save += 1; return fakeObservable(saveResponse); },
      submitChallenge() { sbcCalls.submit += 1; return fakeObservable({ success: true }); },
    };
    setPageForTests(mock.page);
    let verdict = true;
    const requirement = fakeReq({ [KEYS.TEAM_RATING]: 70 }, { label: "Note d'équipe : min. 70" });
    const challenge = {
      id: 501,
      name: "Défi test",
      eligibilityOperation: "AND",
      eligibilityRequirements: [requirement],
      meetsRequirements: () => verdict,
      isRequirementMet: () => verdict,
      hasExpired: () => false,
    };
    let updated = 0;
    const ctx = { ctrl: { getView: () => ({ updateChallenge() { updated += 1; } }) }, challenge, squad };
    const previous = eaItem(77, 60, { positions: [3] });
    slots[1].item = previous;
    const picks = [1, 2, 3, 4, 5, 6, 7, 8, 10].map((slot) => ({ slot, item: eaItem(1000 + slot, 75, { positions: [F433[slot]] }) }));
    const placed = await placeSolution(ctx, picks, { formationId: 1 });
    check(placed.ok && placed.verified && sbcCalls.save === 1 && sbcCalls.submit === 0 && updated === 1, "équipe placée, validée par EA, enregistrée ; jamais envoyée", { placed, sbcCalls });
    check(picks.every(({ slot, item }) => slots[slot].item === item) && slots[0].isBrick() && calls.clear >= 1, "chaque carte à son poste, briques intactes");

    verdict = false;
    slots.forEach((slot) => { if (!slot.isBrick()) slot.item = empty(); });
    slots[1].item = previous;
    const rejected = await placeSolution(ctx, picks, { formationId: 1 });
    check(!rejected.ok && rejected.rejected && rejected.failing.includes("Note d'équipe : min. 70") && sbcCalls.save === 1, "EA refuse : exigence citée, rien enregistré", rejected);
    check(slots[1].item === previous && !slots[2].item.isValid(), "équipe remise comme avant");
    verdict = true;

    const changed = await placeSolution(ctx, picks, { formationId: 2 });
    check(!changed.ok && /formation/.test(changed.message) && sbcCalls.save === 1, "formation changée depuis la recherche : refus", changed.message);

    const twinPicks = picks.map((pick, index) => (index === 1 ? { slot: pick.slot, item: eaItem(5000, 75, { definitionId: picks[0].item.definitionId + 50331648 }) } : pick));
    const twin = await placeSolution(ctx, twinPicks, { formationId: 1 });
    check(!twin.ok && /1 carte/.test(twin.message) && sbcCalls.save === 1, "même joueur en double refusé par EA : équipe remise, rien enregistré", twin.message);

    saveResponse = { success: false, status: 429, error: { code: 429 } };
    const notSaved = await placeSolution(ctx, picks, { formationId: 1 });
    check(!notSaved.ok && notSaved.saveFailed && notSaved.stopped && /429/.test(notSaved.message), "enregistrement refusé (429) : signalé comme arrêt", notSaved.message);
    saveResponse = { success: true };

    challenge.hasExpired = () => true;
    const expired = await placeSolution(ctx, picks, { formationId: 1 });
    check(!expired.ok && /expiré/.test(expired.message), "défi expiré : refus");
    challenge.hasExpired = () => false;

    const verification = verifyWithEa({ challenge: Object.assign({}, challenge, { meetsRequirements: () => false, isRequirementMet: () => false }), squad });
    check(!verification.ok && verification.failing[0] === "Note d'équipe : min. 70", "vérification EA : exigences non remplies listées");
  }

  console.log("\n# de bout en bout : club simulé → solveur → placement");
  {
    resetPoolForTests();
    setPoolPauseForTests(1, 2);
    const mock = createMockEa();
    const club = [];
    for (let index = 0; index < 120; index += 1) {
      club.push(eaItem(index + 1, 74 + (index % 12), { positions: [F433[index % 11]], tradable: index % 5 !== 0, leagueId: 13 + (index % 3), nationId: 18 + (index % 4), teamId: 10 + (index % 9) }));
    }
    mock.page.services.Club = {
      search: (criteria) => fakeObservable({ success: true, response: { items: club.slice(criteria.offset, criteria.offset + criteria.count), retrievedAll: criteria.offset + criteria.count >= club.length } }),
    };
    mock.page.services.Item.searchStorageItems = () => fakeObservable({ success: true, response: { items: [], endOfList: true } });
    mock.page.services.Squad = { requestSquadByType: () => fakeObservable({ success: true, data: { squad: { getPlayers: () => club.slice(0, 11).map((item) => ({ item })) } } }) };
    let saves = 0;
    mock.page.services.SBC = { saveChallenge: () => { saves += 1; return fakeObservable({ success: true }); } };
    setPageForTests(mock.page);
    const empty = () => ({ id: 0, definitionId: 0, isValid: () => false, isPlayer: () => true });
    const slots = Array.from({ length: 23 }, (_, index) => ({ index, item: empty(), generalPosition: F433[index], isBrick: () => false, isCustomBrick: () => false, isValid() { return this.item.isValid(); } }));
    const squad = {
      getFormation: () => ({ id: 7, getPosition: (index) => (index < 11 ? { typeId: F433[index], typeName: POSITION_NAMES[F433[index]] } : null) }),
      getSlot: (index) => slots[index],
      removeAllItems() { slots.forEach((slot) => { slot.item = empty(); }); return true; },
      setPlayers(items) { items.forEach((item, index) => { if (item) slots[index].item = item; }); },
      isSquadFull: () => slots.slice(0, 11).every((slot) => slot.item.isValid()),
      isSBCSquadEligible: () => true,
    };
    const challenge = {
      id: 42,
      name: "84 de bout en bout",
      eligibilityOperation: "AND",
      eligibilityRequirements: [fakeReq({ [KEYS.TEAM_RATING]: 82 }), fakeReq({ [KEYS.LEAGUE_ID]: 14 }, { count: 2 })],
      meetsRequirements: () => true,
      isRequirementMet: () => true,
      hasExpired: () => false,
    };
    const ctrl = { _challenge: challenge, _squad: squad, getView: () => ({ updateChallenge() {} }) };
    const ctx = readSolverContext(ctrl);
    check(!!ctx && ctx.requirements.length === 2 && ctx.slots.length === 11 && ctx.formationId === 7 && ctx.float === true, "contexte du défi lu (exigences, postes, formation)");
    const { task } = startToolTask("test solveur");
    const outcome = await solveChallenge(ctx, { rules: settings.getSettings().solver, token: task.token, solverOptions: { seed: 21, timeBudgetMs: 2000 } });
    endTask(task);
    const result = outcome.result;
    const activeIds = new Set(club.slice(0, 11).map((item) => String(item.id)));
    check(outcome.ok && result.ok && result.rating >= 82 && result.squad.filter((pick) => pick.entry.leagueId === 14).length >= 2, "solution trouvée (note ≥ 82, 2 joueurs du championnat 14)", { reason: result && result.reason, rating: result && result.rating });
    check(!result.squad.some((pick) => activeIds.has(pick.entry.key)) && outcome.pool.excluded.squad === 11, "équipe active écartée (réglage par défaut)", outcome.pool.excluded);
    check(outcome.chemistrySource === "local" && result.chemistry != null, "collectifs affichés (modèle local sans calculateur EA)");
    const placed = await placeSolution(ctx, result.squad.map((pick) => ({ slot: pick.slot, item: pick.entry.item })), { formationId: ctx.formationId });
    check(placed.ok && saves === 1 && slots.slice(0, 11).every((slot) => slot.item.isValid()), "placement + enregistrement", placed);
    resetPoolForTests();
  }

  console.log("\n# DCE en un clic : la sélection la moins chère qui atteint le score");
  {
    const C = (key, score, cost, o = {}) =>
      Object.assign({ key, score, cost, rating: 80, tier: 3, rareflag: 0, groups: [], tradable: true, untradeable: false }, o, o.tradable === false ? { untradeable: true } : {});
    const rareRule = (count) => ({ test: (entry) => entry.rareflag === 1, count, label: `Rares : min. ${count}` });
    const exact = planOneClick({ candidates: [C("A", 99, 50), C("B", 51, 26), C("C", 50, 25)], target: 100, limit: 5 });
    check(exact.reached && exact.cost === 51 && exact.picks.map((entry) => entry.key).sort().join() === "B,C", "couverture exacte : B + C (51) plutôt que C + A (75) du glouton", exact);
    const fodder = Array.from({ length: 20 }, (_, index) => C(`f${index}`, 10, 1));
    const free = planOneClick({ candidates: fodder.concat([C("X", 60, 100), C("Y", 50, 90)]), target: 100, limit: 30 });
    check(free.reached && free.cost === 10 && free.picks.length === 10, "sans limite gênante : 10 petites cartes (10)", { cost: free.cost, n: free.picks.length });
    const limited = planOneClick({ candidates: fodder.concat([C("X", 60, 100), C("Y", 50, 90)]), target: 100, limit: 3 });
    check(limited.reached && limited.picks.length <= 3 && limited.cost === 190, "limite de 3 cartes : X + Y (190)", { cost: limited.cost, picks: limited.picks.map((entry) => entry.key) });
    const partial = planOneClick({ candidates: [C("a", 300, 600), C("b", 300, 10, { tradable: false }), C("c", 200, 5)], target: 10000, limit: 2 });
    check(!partial.reached && partial.partial && partial.picks.map((entry) => entry.key).sort().join() === "b,c", "score hors d'atteinte : les 2 cartes les plus rentables (progression gardée)", partial);
    const rares = planOneClick({
      candidates: [C("n1", 100, 10), C("n2", 100, 10), C("r1", 100, 300, { rareflag: 1 }), C("r2", 100, 400, { rareflag: 1 }), C("r3", 100, 900, { rareflag: 1 })],
      target: 200,
      limit: 5,
      minCounts: [rareRule(2)],
    });
    check(rares.reached && rares.picks.map((entry) => entry.key).sort().join() === "r1,r2", "« au moins 2 rares » : les 2 rares les moins chères suffisent (score atteint)", rares.picks.map((entry) => entry.key));
    const oneRare = planOneClick({
      candidates: [C("n1", 100, 10), C("n2", 100, 10), C("n3", 100, 10), C("r1", 100, 300, { rareflag: 1 })],
      target: 300,
      limit: 5,
      minCounts: [rareRule(1)],
    });
    check(oneRare.reached && oneRare.picks.some((entry) => entry.key === "r1") && oneRare.cost === 320, "« au moins 1 rare » + score : 1 rare et 2 petites cartes (320)", { cost: oneRare.cost, picks: oneRare.picks.map((entry) => entry.key) });
    const unmet = planOneClick({ candidates: [C("n1", 100, 10), C("r1", 100, 300, { rareflag: 1 })], target: 100, limit: 5, minCounts: [rareRule(3)] });
    check(unmet.unmet.includes("Rares : min. 3") && unmet.reason === "rules", "exigence impossible signalée", unmet);
    const kept = planOneClick({ candidates: [C("n1", 100, 10), C("r1", 100, 300, { rareflag: 1 })], target: 100, limit: 2, minCounts: [rareRule(1)], preselected: [C("p", 50, 0, { rareflag: 1 })] });
    check(kept.reached && kept.picks.map((entry) => entry.key).join() === "n1", "carte déjà sélectionnée comptée dans l'exigence", kept.picks.map((entry) => entry.key));
    const capped = planOneClick({
      candidates: [C("t1", 100, 1), C("t2", 100, 1), C("u1", 100, 50, { tradable: false }), C("u2", 100, 60, { tradable: false })],
      target: 200,
      limit: 4,
      maxCounts: [{ test: (entry) => entry.tradable, count: 1, label: "max 1 échangeable" }],
    });
    check(capped.reached && capped.picks.filter((entry) => entry.tradable).length <= 1 && capped.cost === 51, "« au plus 1 échangeable » respecté (51)", { cost: capped.cost, picks: capped.picks.map((entry) => entry.key) });
    check(planOneClick({ candidates: fodder, target: 0, limit: 5 }).reason === "done" && planOneClick({ candidates: fodder, target: 50, limit: 0 }).reason === "limit", "rien à faire / limite atteinte");
    const bigPool = Array.from({ length: 400 }, (_, index) => C(`g${index}`, 150 + ((index * 37) % 400), 50 + ((index * 53) % 900)));
    const startedBig = Date.now();
    const big = planOneClick({ candidates: bigPool, target: 9000, limit: 30 });
    const greedyCost = (() => {
      let score = 0;
      let cost = 0;
      bigPool.slice().sort((a, b) => a.cost / a.score - b.cost / b.score).forEach((entry) => {
        if (score < 9000) {
          score += entry.score;
          cost += entry.cost;
        }
      });
      return cost;
    })();
    check(big.reached && big.picks.length <= 30 && big.cost <= greedyCost && Date.now() - startedBig < 2000, "400 cartes, score 9 000 : rapide, jamais plus cher que le glouton", { cost: big.cost, greedyCost, n: big.picks.length, ms: Date.now() - startedBig });
    // Réserve de 139 800 points : 120 000 se couvre (programmation dynamique par paliers), 150 000 non.
    const huge = planOneClick({ candidates: bigPool, target: 120000, limit: 400 });
    const tooBig = planOneClick({ candidates: bigPool, target: 150000, limit: 400 });
    check(huge.reached && huge.score >= 120000 && huge.cost < sum(bigPool.map((entry) => entry.cost)), "très gros score (paliers regroupés) : atteint sans tout prendre", { score: huge.score, n: huge.picks.length });
    check(!tooBig.reached && tooBig.partial && tooBig.picks.length === 400, "score supérieur à toute la réserve : progression partielle", { score: tooBig.score });

    const rules = oneClickRules([
      req({ [KEYS.PLAYER_QUALITY]: 3 }),
      req({ [KEYS.PLAYER_RARITY]: 1 }, { count: 2 }),
      req({ [KEYS.TEAM_RATING]: 80 }),
      req({ [KEYS.PLAYER_RARITY]: 1 }, { count: -1, scope: SCOPE.EXACT }),
      req({ [KEYS.PLAYER_TRADABILITY]: 0 }, { count: 3, scope: SCOPE.LOWER }),
    ]);
    check(rules.filters.length === 1 && rules.minCounts.length === 1 && rules.minCounts[0].count === 2 && rules.maxCounts.length === 1 && rules.notApplicable.length === 2 && rules.applied.length === 3, "exigences du défi : qualité (filtre), « au moins », « au plus », le reste non applicable", { filters: rules.filters.length, min: rules.minCounts.length, max: rules.maxCounts.length, na: rules.notApplicable });
  }

  console.log("\n# DCE en un clic : écran EA (cartes chargées, sélection, jamais d'envoi)");
  {
    const mock = createMockEa();
    const counts = { submit: 0, refresh: 0 };
    mock.page.services.SBC = {
      isItemInSquad: (id) => id === 5,
      submitOneClickChallenge() { counts.submit += 1; return fakeObservable({ success: true }); },
      submitChallenge() { counts.submit += 1; return fakeObservable({ success: true }); },
    };
    const items = [
      Object.assign(eaItem(1, 75, { tradable: false }), { sbsScore: 120 }),
      Object.assign(eaItem(2, 82), { sbsScore: 340 }),
      Object.assign(eaItem(3, 70), { sbsScore: 60 }),
      Object.assign(eaItem(4, 84, { evolved: true }), { sbsScore: 500 }),
      Object.assign(eaItem(5, 83), { sbsScore: 400 }),
      Object.assign(eaItem(6, 60), { sbsScore: 0 }),
      Object.assign(eaItem(7, 81, { duplicate: true }), { sbsScore: 300 }),
      Object.assign(eaItem(8, 85, { favorite: true }), { sbsScore: 450 }),
      Object.assign(eaItem(9, 79, { loan: true }), { sbsScore: 280 }),
    ];
    const selected = new Set();
    const scoreMap = new Map(items.map((item) => [item.id, item.sbsScore]));
    const vm = {
      _itemEntityMap: new Map(items.map((item) => [item.id, item])),
      _itemTabMap: new Map(items.map((item) => [item.id, item.id === 7 ? "storage" : "club"])),
      _itemScoreMap: scoreMap,
      getChallenge: () => ({ id: 77, name: "Défi en un clic", scoreRequirement: 700, submittedScore: 100, eligibilityOperation: "AND", eligibilityRequirements: [] }),
      getSelectionLimit: () => 3,
      getSelectedItemIds: () => Array.from(selected),
      getSelectedScore: () => Array.from(selected).reduce((total, id) => total + (scoreMap.get(id) || 0), 0),
      isItemSelectable: (item) => (scoreMap.get(item.id) || 0) > 0,
      isItemSelected: (item) => selected.has(item.id),
      selectItem(item) {
        if (selected.has(item.id)) return true;
        if (selected.size >= 3) return false;
        selected.add(item.id);
        return true;
      },
      deselectItem(item) { selected.delete(item.id); },
      getCurrentPageItems: () => items.slice(0, 5),
      getActiveTab: () => "club",
      hasNextPage: () => false,
      autoSelectCurrentPage() {},
    };
    const ctrl = { getViewModel: () => vm, isViewDisplayed: () => true, _refreshCurrentPage() { counts.refresh += 1; } };
    const hidden = { getViewModel: () => vm, isViewDisplayed: () => false };
    const split = { workAreaController: ctrl, childViewControllers: [] };
    const root = { childViewControllers: [{ currentController: hidden }, { childViewControllers: [{ currentController: split }] }] };
    mock.page.getAppMain = () => ({ getRootViewController: () => root });
    setPageForTests(mock.page);
    check(findWorkAreaController() === ctrl, "écran en un clic affiché trouvé dans l'arbre des contrôleurs EA (sans rien envelopper)");
    const area = readWorkArea(ctrl, settings.getSettings().solver, { priceOf: () => 0 });
    const candidateKeys = area.candidates.map((entry) => entry.key).sort().join();
    check(area.remaining === 600 && area.limit === 3 && candidateKeys === "1,2,3,7", "score restant 600 ; écartées : évoluée, équipe (isItemInSquad), sans score, favorite, prêt", { remaining: area.remaining, candidateKeys, excluded: area.excluded });
    check(area.excluded.squad === 1 && area.excluded.unselectable === 1 && area.excluded.evolved === 1 && area.excluded.favorite === 1 && area.excluded.loan === 1, "motifs d'exclusion comptés", area.excluded);
    const storageEntry = area.candidates.find((entry) => entry.key === "7");
    const untradeable = area.candidates.find((entry) => entry.key === "1");
    check(storageEntry.source === "storage" && untradeable.cost < area.candidates.find((entry) => entry.key === "3").cost, "doublon du stockage repéré, non échangeable moins cher");
    const plan = planWorkArea(area);
    check(plan.reached && plan.picks.map((entry) => entry.key).sort().join() === "2,7", "3 cartes max pour 600 : 340 + 300 (les seules combinaisons possibles)", plan.picks.map((entry) => entry.key));
    const applied = applySelection(area, plan.picks);
    check(applied.selected.length === 2 && !applied.skipped.length && applied.selectedScore === 640 && counts.refresh === 1 && counts.submit === 0, "cartes sélectionnées par le modèle de vue d'EA, écran rafraîchi, rien envoyé", { applied: applied.selectedScore, counts });
    const again = readWorkArea(ctrl, settings.getSettings().solver, { priceOf: () => 0 });
    check(again.remaining === 0 && again.selectedCount === 2 && again.preselected.length === 2, "score atteint : plus rien à ajouter", again.remaining);
    undoSelection(area, applied.selected);
    check(selected.size === 0 && counts.refresh === 2, "annuler : cartes désélectionnées");
    selected.add(3);
    selected.add(1);
    const full = readWorkArea(ctrl, settings.getSettings().solver, { priceOf: () => 0 });
    const fullPlan = planWorkArea(full);
    const fullApplied = applySelection(full, fullPlan.picks);
    check(full.remaining === 420 && fullPlan.picks.length === 1 && fullApplied.selected.length === 1 && selected.size === 3, "sélection existante gardée, 1 seule place restante utilisée", { remaining: full.remaining, picks: fullPlan.picks.map((entry) => entry.key) });
    const refused = applySelection(full, [area.candidates.find((entry) => entry.key === "2")]);
    check(refused.skipped.length === 1 && !refused.selected.length, "limite atteinte : carte refusée et signalée");
    check(counts.submit === 0, "jamais d'envoi du défi");
    setPageForTests(createMockEa().page);
  }

  // Ligne tr.player-row d'une liste FUTBIN FC 27 (structure relevée sur futbin.com, voir tools.test.js).
  const futbinRow = ({ eaId, futbinId = eaId, name, rating, ps, pc = ps, version = "Normal", pos = "ST", alt = "", club = 243, nation = 18, league = 53, rarity = 1, is = 0 }) => `
<tr class="player-row text-nowrap">
  <td class="table-name"><a href="/27/player/${futbinId}/p" class="player-row-playercard">
    <div class="player-hover-container-wrapper"><div class="playercard-27 playercard-s" title="${name}">
      <img alt="" src="https://cdn3.futbin.com/content/fifa27/img/cards/tiny/${rarity}_gold.png" class="playercard-s-27-bg" width="64">
      <img alt="${name}" src="https://cdn3.futbin.com/content/fifa27/img/players/${eaId}.png?fm=png" class="playercard-s-base-img" width="51">
      <div class="playercard-s-27-info-column"><div class="playercard-s-27-rating">${rating}</div></div>
    </div></div></a>
    <div class="table-player-info">
      <div class="player-hover-container-wrapper"><a href="/27/player/${futbinId}/p" class="table-player-name">${name}</a></div>
      <div class="table-player-sub-info row align-center">
        <a href="/27/players?club=${club}" class="table-player-club"><img alt="Club" src="https://cdn3.futbin.com/content/fifa27/img/clubs/dark/${club}.png" title="Club ${club}"></a>
        <a href="/27/players?nation=${nation}" class="table-player-nation"><img alt="Nation" src="https://cdn3.futbin.com/content/fifa27/img/nation/${nation}.png" class="nation" title="Nation ${nation}"></a>
        <a href="/27/players?league=${league}" class="table-player-league"><img alt="League" src="https://cdn3.futbin.com/content/fifa27/img/league/dark/${league}.png" title="League ${league}"></a>
      </div>
      <div class="table-player-revision">${version}</div>
    </div>
  </td>
  <td class="table-rating"><div class="rating-square">${rating}</div></td>
  <td class="table-item-score"><div class="xxs-row align-center centered">${is}<img alt="Item Score" src="/i.png"></div></td>
  <td class="table-pos"><div class="table-pos-main s-border-radius text-center bold"><span>${pos}</span></div><div class="xs-font text-faded bold">${alt}</div></td>
  <td class="table-price no-wrap platform-ps-only"><div class="price bold centered xxs-row align-center">${ps}<img alt="Coin" src="coins.png"></div></td>
  <td class="table-price no-wrap platform-pc-only"><div class="price bold centered xxs-row align-center">${pc}<img alt="Coin" src="coins.png"></div></td>
</tr>`;
  const futbinPage = (rows) => `<!DOCTYPE html><html><body><table class="futbin-table players-table"><tbody>${rows.map(futbinRow).join("")}</tbody></table></body></html>`;

  console.log("\n# marché : listes FUTBIN utiles d'après les exigences");
  {
    resetMarketForTests();
    const url = marketListUrl({ minRating: 86, maxRating: 86, platform: "console" });
    check(/\/players\?player_rating=86-86&ps_price=200-15000000&sort=ps_price&order=asc$/.test(url), "liste triée par prix (console : ps_price)", url);
    const pc = marketListUrl({ minRating: 84, maxRating: 84, league: 13, version: "gold", platform: "pc" });
    check(/version=gold&league=13&player_rating=84-84&pc_price=200-15000000&sort=pc_price&order=asc$/.test(pc), "PC : pc_price ; version et championnat en paramètres", pc);
    const totw = marketQueries([req({ [KEYS.TEAM_RATING]: 84 }), req({ [KEYS.PLAYER_MIN_OVR]: 86 }, { count: 1 })]);
    check(totw.map((query) => query.minRating).join() === "83,84,85,86,87" && totw.every((query) => query.minRating === query.maxRating), "« Renfort TOTW » (note 84, un 86+) : notes 83 à 87, une liste par note", totw.map((query) => query.key));
    const capped = marketQueries([req({ [KEYS.TEAM_RATING]: 84 })], { maxRating: 85 });
    check(capped.map((query) => query.minRating).join() === "83,84,85", "note max du réglage respectée", capped.map((query) => query.key));
    const silver = marketQueries([req({ [KEYS.TEAM_RATING]: 84 }), req({ [KEYS.PLAYER_QUALITY]: 2 }, { scope: SCOPE.LOWER })]);
    check(silver.length === 0, "qualité max. argent : aucune carte or proposée");
    const gold = marketQueries([req({ [KEYS.TEAM_RATING]: 80 }), req({ [KEYS.PLAYER_QUALITY]: 3 })]);
    check(gold.every((query) => query.version === "gold"), "qualité or exigée : version=gold");
    const league = marketQueries([req({ [KEYS.TEAM_RATING]: 80 }), req({ [KEYS.LEAGUE_ID]: [13, 53] }, { count: 3 })]);
    const leagueQueries = league.filter((query) => query.league);
    check(leagueQueries.length === 2 && leagueQueries[0].known.leagueId === 13 && leagueQueries[0].minRating === 79 && leagueQueries[0].maxRating === 83, "championnats demandés : une liste filtrée par championnat (notes 79 à 83)", leagueQueries);
    const pool = marketQueries([req({ [KEYS.PLAYER_QUALITY]: 3 })], { needPool: true });
    check(pool.length === 1 && pool[0].minRating === 75 && pool[0].maxRating === 99, "réserve trop petite sans note exigée : les moins chères de la plage permise", pool);
    const oneClickQueries = marketQueries([], { oneClick: true });
    check(oneClickQueries.map((query) => query.minRating).join() === "84,85,86,87,88", "en un clic : notes 84 à 88 (meilleur prix par point)", oneClickQueries.map((query) => query.key));
  }

  console.log("\n# marché : lignes FUTBIN → cartes à acheter");
  {
    resetMarketForTests();
    const html = futbinPage([
      { eaId: 67340611, name: "Mbappe", rating: 86, ps: "15250", pc: "14000", version: "Team of the Week", pos: "LM", alt: "RM, RW", club: 243, nation: 18, league: 53, rarity: 3, is: "5200" },
      { eaId: 231747, name: "Base", rating: 86, ps: "13000", pos: "ST", club: 21, nation: 21, league: 19, rarity: 1, is: "4100" },
    ]);
    const details = rowDetails(html);
    const first = details.get(67340611);
    check(first && first.clubId === 243 && first.nationId === 18 && first.leagueId === 53 && first.positions.join() === "LM,RM,RW" && first.rareflag === 3, "identifiants EA (club, nation, championnat), postes et rareté lus dans la ligne", first);
    const lists = [{ query: { known: {} }, cards: [{ eaId: 67340611, futbinId: 9, name: "Mbappe", rating: 86, prices: { console: 15250, pc: 14000 }, version: "Team of the Week", position: "LM", itemScore: 5200 }], details, at: Date.now() }];
    const entry = marketEntry(lists[0].cards[0], { platform: "console", margin: 5, details: first });
    check(entry.market && entry.price === 15250 && entry.cost === Math.round(15250 * 1.05) + 150 && entry.positions.join() === "16,12,23" && entry.leagueId === 53 && entry.rareflag === 3 && entry.special && entry.score === 5200 && entry.tradable, "carte à acheter : prix + 5 % + surcoût, postes EA, attributs, score FUTBIN", entry);
    const pcEntry = marketEntry(lists[0].cards[0], { platform: "pc", margin: 0, overhead: 0 });
    check(pcEntry.price === 14000 && pcEntry.cost === 14000 && pcEntry.leagueId < 0 && pcEntry.nationId < 0 && pcEntry.nationId !== pcEntry.leagueId, "prix PC ; attributs inconnus : valeurs négatives uniques", pcEntry);
    const icon = marketEntry({ eaId: 227002, name: "Miyama", rating: 90, prices: { console: 520000 }, version: "Icon", position: "LM" }, { platform: "console" });
    check(icon.legend && icon.rareflag === 12, "icône reconnue (version FUTBIN)");
    const unknownClub = [{ query: { known: { leagueId: 13 } }, cards: [{ eaId: 1001, name: "Inconnu", rating: 84, prices: { console: 5000 }, position: "CB" }], details: new Map(), at: Date.now() }];
    check(marketEntries(unknownClub, { platform: "console", seed: false })[0].leagueId === 13, "attribut connu par le filtre de la liste (championnat)");
    const risky = marketEntries(unknownClub, { platform: "console", seed: false, requirements: [req({ [KEYS.SAME_CLUB_COUNT]: 2 }, { scope: SCOPE.LOWER })] });
    check(risky.length === 0, "club inconnu écarté quand une exigence « au plus 2 du même club » en dépend");
    const ruled = marketEntries(lists, { platform: "console", seed: false, rules: { maxPrice: 10000 } });
    check(ruled.length === 0, "prix max par joueur appliqué aux cartes du marché");
    rememberVerified([Object.assign({}, entry, { verified: true, leagueId: 61, clubId: 999, teamId: 999, nationId: 7 })]);
    const overlaid = marketEntries(lists, { platform: "console", seed: false })[0];
    check(overlaid.verified && overlaid.leagueId === 61 && overlaid.nationId === 7, "carte vérifiée par EA : ses attributs exacts sont réutilisés");
    resetMarketForTests();
  }

  console.log("\n# marché : club seul ou club + marché");
  {
    const result = (feasible, cost, market = 0) => ({ feasible, cost, squad: Array.from({ length: 11 }, (_, index) => ({ slot: index, entry: { market: index < market } })) });
    check(chooseOutcome(result(true, 5000), result(true, 4900, 1)).market === false, "club valide, marché à peine moins cher : club gardé");
    const needed = chooseOutcome(result(false, 3000), result(true, 20000, 2));
    check(needed.market && needed.reason === "needed", "club impossible : club + marché");
    const cheaper = chooseOutcome(result(true, 30000), result(true, 14000, 1));
    check(cheaper.market && cheaper.reason === "cheaper" && cheaper.saving === 16000, "marché nettement moins cher : proposé avec l'économie", cheaper);
    check(chooseOutcome(result(true, 5000), result(false, 1000, 1)).market === false, "solution club + marché impossible : club gardé");
  }

  console.log("\n# solveur : club insuffisant (« Renfort TOTW ») → cartes du marché, seulement celles qu'il faut");
  {
    uid = 0;
    // Club : 69 cartes utilisables, meilleure note 82.
    const club = [];
    for (let index = 0; index < 69; index += 1) {
      const rating = index < 20 ? 64 + (index % 10) : index < 50 ? 75 + (index % 6) : 81 + (index % 2);
      club.push(P(rating, { tradable: index % 3 !== 0, league: 10 + (index % 8), nation: 20 + (index % 9), club: 300 + index }));
    }
    const requirements = [req({ [KEYS.TEAM_RATING]: 84 }), req({ [KEYS.PLAYER_MIN_OVR]: 86 }, { count: 1 })];
    const clubOnly = await run(requirements, club, { options: { seed: 13, timeBudgetMs: 1500 } });
    check(!clubOnly.feasible && clubOnly.reason === "infeasible" && clubOnly.rating <= 82, "club seul : impossible (meilleure note 82)", { reason: clubOnly.reason, rating: clubOnly.rating });
    const marketPool = [];
    [[83, 2600], [84, 5000], [85, 8500], [86, 13000], [87, 19000]].forEach(([rating, price]) => {
      for (let copy = 0; copy < 6; copy += 1) {
        const card = { eaId: 900000 + rating * 10 + copy, name: `M${rating}-${copy}`, rating, prices: { console: price + copy * 150 }, version: "Normal", position: F433[copy % 11] === 0 ? "GK" : "ST", itemScore: 0 };
        const entry = marketEntry(card, { platform: "console", margin: 5 });
        entry.positions = [F433[(copy + rating) % 11]];
        marketPool.push(entry);
      }
    });
    const mixed = await run(requirements, club.concat(marketPool), { options: { seed: 13, timeBudgetMs: 3000 } });
    const bought = marketPicksOf(mixed);
    check(mixed.ok && mixed.rating >= 84 && mixed.squad.some((pick) => pick.entry.rating >= 86), "club + marché : note 84 et un joueur 86+", { reason: mixed.reason, rating: mixed.rating, market: bought.length });
    check(bought.length > 0 && bought.length < 11 && mixed.squad.filter((pick) => !pick.entry.market).every((pick) => pick.entry.rating >= 75), "cartes du club gardées, quelques cartes à acheter", bought.map((pick) => pick.entry.rating));
    // Chaque carte achetée est indispensable : la remplacer par n'importe quelle carte du club rend l'équipe impossible.
    const checks = compileChecks(requirements);
    const used = new Set(mixed.squad.map((pick) => pick.entry.person));
    const minimal = bought.every((pick) =>
      club.every((entry) => {
        if (used.has(entry.person)) {
          return true;
        }
        const bySlot = new Array(11).fill(null);
        mixed.squad.forEach((other) => {
          bySlot[other.slot] = other === pick ? entry : other.entry;
        });
        return !evaluateView(checks, buildView(slotsFor(), bySlot, null)).met;
      })
    );
    check(minimal, "jamais plus de cartes du marché qu'il n'en faut (aucune remplaçable par le club)");
    const untradeables = club.filter((entry) => entry.untradeable && entry.rating >= 81).map((entry) => entry.key);
    check(untradeables.every((key) => mixed.squad.some((pick) => pick.entry.key === key)), "non échangeables 81-82 du club utilisés avant d'acheter", untradeables);

    // Club valide mais coûteux (un 88 échangeable pour « un 86+ ») : un 86 du marché revient moins cher.
    uid = 0;
    const rich = F433.map((position, index) => P(index === 0 ? 88 : 80, { positions: [position], tradable: index === 0, value: index === 0 ? 30000 : 800 }));
    const fodder = F433.map((position) => P(79, { positions: [position], tradable: false }));
    const cheap86 = marketEntry({ eaId: 777777, name: "M86", rating: 86, prices: { console: 13000 }, version: "Normal", position: "GK" }, { platform: "console", margin: 5 });
    const clubRich = await run([req({ [KEYS.PLAYER_MIN_OVR]: 86 }, { count: 1 })], rich.concat(fodder));
    const mixedRich = await run([req({ [KEYS.PLAYER_MIN_OVR]: 86 }, { count: 1 })], rich.concat(fodder, [cheap86]));
    const pick = chooseOutcome(clubRich, mixedRich);
    check(clubRich.ok && mixedRich.ok && pick.market && pick.reason === "cheaper" && marketPicksOf(pick.result).length === 1, "acheter un 86 (≈ 13 650) plutôt que d'utiliser son 88 (30 000)", { club: clubRich.cost, mixed: mixedRich.cost, reason: pick.reason });
    const noNeed = await run([req({ [KEYS.TEAM_RATING]: 70 })], fodder.concat(rich, [cheap86]));
    check(noNeed.ok && !marketPicksOf(noNeed).length, "club suffisant et moins cher : aucune carte à acheter");
  }

  // Ligne de getFilteredPlayers (API de l'appli FUTBIN, champs vus le 09/10/2026).
  const apiListRow = ({ eaId, futbinId = eaId, name, rating, ps, pc = ps, pos = "ST", alt = [], club = 243, nation = 18, league = 53, rareType = 0 }) => ({
    ID: futbinId,
    resource_id: eaId,
    playerid: eaId % 16777216,
    playername: name,
    common_name: name,
    rating,
    position: pos,
    alternativePositions: alt,
    nation,
    league,
    club,
    nation_name: `Nation ${nation}`,
    league_name: `League ${league}`,
    club_name: `Club ${club}`,
    raretype: rareType,
    rareTypeName: rareType ? "Team of the Week" : "Gold Non Rare",
    cardImage: `https://cdn3.futbin.com/content/fifa27/img/cards/hd/${rareType}_gold.png`,
    ps_LCPrice: ps,
    pc_LCPrice: pc,
    itemScore: rating * 40,
  });

  console.log("\n# marché : listes par l'API de l'appli FUTBIN (cache 10 min, pages en secours, blocage)");
  {
    resetMarketForTests();
    resetFutbinClientForTests();
    resetFutbinApiForTests();
    setMarketPauseForTests(1, 2);
    const url = filteredPlayersUrl({ minRating: 84, maxRating: 86, nation: 27, version: "gold", platform: "console" });
    check(
      /futbin\.org\/futbin\/api\/27\/getFilteredPlayers\?platform=PS&page=1&version=gold&nation=27&rating=84-86&ps4price=200-15000000&sort=ps_price&order=asc$/.test(url),
      "lien de l'API : filtres, prix console non nul, tri par prix croissant",
      url
    );
    check(/platform=PC&page=1&league=13&pcprice=200-15000000&sort=pc_price&order=asc$/.test(filteredPlayersUrl({ league: 13, platform: "pc" })), "PC : prix PC", filteredPlayersUrl({ league: 13, platform: "pc" }));
    const requests = [];
    let mode = "api";
    global.GM_xmlhttpRequest = (options) => {
      requests.push(options.url);
      const target = String(options.url);
      if (/futbin\.org\/futbin\/api\/27\/getFilteredPlayers/.test(target)) {
        if (mode === "api") {
          const rating = Number((target.match(/[?&]rating=(\d+)-/) || [])[1]);
          const rows = [1, 2, 3].map((copy) => apiListRow({ eaId: 800000 + rating * 10 + copy, name: `F${rating}-${copy}`, rating, ps: rating * 100 + copy, pos: "CM", alt: copy === 1 ? ["CDM", "CAM"] : [], nation: 27, league: 31, club: 45 + copy }));
          setTimeout(() => options.onload({ status: 200, responseText: JSON.stringify({ data: rows, errorcode: 0 }) }), 1);
        } else {
          setTimeout(() => options.onload({ status: mode === "blocked" ? 429 : 404, responseText: '{"error":"x"}' }), 1);
        }
        return;
      }
      const rating = Number((target.match(/player_rating=(\d+)-/) || [])[1]);
      const rows = [1, 2, 3].map((copy) => ({ eaId: 900000 + rating * 10 + copy, name: `P${rating}-${copy}`, rating, ps: String(rating * 100 + copy), is: String(rating * 40) }));
      const text = mode === "blocked" ? "<html><title>Just a moment...</title><body>cf-chl challenge-platform</body></html>" : futbinPage(rows);
      setTimeout(() => options.onload({ status: mode === "blocked" ? 403 : 200, responseText: text }), 1);
    };
    const queries = [{ key: "r84", minRating: 84, maxRating: 84, known: {} }, { key: "r85", minRating: 85, maxRating: 85, known: {} }];
    const phases = [];
    const first = await loadMarketLists(queries, { platform: "console", onProgress: (progress) => phases.push(progress.page) });
    check(
      first.ok && first.lists.length === 2 && first.lists[0].cards.length === 3 && requests.length === 2 && requests.every((u) => /futbin\.org/.test(u)) && phases.join() === "1,2",
      "2 listes lues par l'API (une requête chacune), aucune page futbin.com",
      { n: first.lists.length, requests }
    );
    const details = first.lists[0].details.get(800841);
    check(details && details.leagueId === 31 && details.nationId === 27 && details.clubId === 46 && details.positions.join() === "CM,CDM,CAM" && details.rareflag == null, "identifiants EA et postes de la ligne de l'API (rareté de base inconnue)", details);
    const again = await loadMarketLists(queries, { platform: "console" });
    check(again.ok && requests.length === 2, "listes gardées 10 min : aucune nouvelle requête");
    const entries = marketEntries(first.lists, { platform: "console", seed: false });
    check(entries.length === 6 && entries[0].price === 8401 && entries[0].nationId === 27 && entries[0].positions.length === 3 && entries.every((entry) => entry.listedAt > 0), "6 cartes à acheter, la moins chère d'abord, nation et postes connus", entries.map((entry) => entry.price));
    mode = "pages";
    const fallback = await loadMarketLists([{ key: "r86", minRating: 86, maxRating: 86, known: {} }], { platform: "console" });
    const pageCalls = requests.filter((u) => /futbin\.com\/27\/players/.test(u));
    check(fallback.ok && fallback.lists.length === 1 && fallback.lists[0].cards[0].eaId === 900861 && pageCalls.length === 1, "API sans réponse utile (404) : page futbin.com en secours", { requests: requests.slice(2) });
    mode = "blocked";
    const blocked = await loadMarketLists([{ key: "r87", minRating: 87, maxRating: 87, known: {} }], { platform: "console" });
    check(!blocked.ok && blocked.blocked && futbinApiPausedUntil() > Date.now(), "API refusée (429) et page bloquée (Cloudflare) : arrêt sans insister", blocked);
    delete global.GM_xmlhttpRequest;
    resetMarketForTests();
    resetFutbinClientForTests();
    resetFutbinApiForTests();
  }

  console.log("\n# solveur : défi « Como 1907 - AS Roma » (2 Italiens min.), club sans Italien → Italiens du marché par l'API");
  {
    uid = 0;
    resetMarketForTests();
    resetFutbinClientForTests();
    resetFutbinApiForTests();
    setMarketPauseForTests(1, 2);
    const requirements = [
      req({ [KEYS.NATION_ID]: 27 }, { count: 2 }),
      req({ [KEYS.LEAGUE_COUNT]: 4 }, { scope: SCOPE.LOWER }),
      req({ [KEYS.PLAYER_LEVEL]: 3 }, { count: 1 }),
      req({ [KEYS.PLAYER_QUALITY]: 2 }),
      req({ [KEYS.CHEMISTRY_POINTS]: 18 }),
    ];
    // Club : non échangeables de 4 championnats (NWSL, GPFBL, Serie A, Liga MX), aucun Italien ni gardien.
    const leagues = [2216, 2236, 31, 341];
    const nations = [95, 54, 45, 108, 47, 195, 83];
    const outfield = [3, 5, 5, 7, 14, 14, 14, 23, 25, 27];
    const club = [];
    for (let index = 0; index < 30; index += 1) {
      club.push(P(68 + (index % 16), { positions: [outfield[index % outfield.length]], tradable: false, league: leagues[index % 4], nation: nations[index % 7], club: 500 + (index % 12) }));
    }
    const clubOnly = await run(requirements, club, { options: { seed: 5, timeBudgetMs: 1500, chemMinMs: 300 } });
    check(!clubOnly.feasible && clubOnly.failing.some((fail) => fail.actual === 0 && fail.target === 2), "club seul : impossible, 0 Italien sur 2", clubOnly.failing);
    const queries = marketQueries(requirements);
    check(queries.some((query) => query.nation === 27), "liste du marché demandée : Italiens", queries);
    const requests = [];
    global.GM_xmlhttpRequest = (options) => {
      requests.push(options.url);
      const target = String(options.url);
      const italians = /[?&]nation=27(&|$)/.test(target);
      const gold = /[?&]version=gold(&|$)/.test(target);
      const rows = italians
        ? [
            { eaId: 50001, name: "Portiere", rating: 76, ps: 650, pos: "GK" },
            { eaId: 50002, name: "Difensore", rating: 77, ps: 700, pos: "CB", alt: ["RB"] },
            { eaId: 50003, name: "Centrocampista", rating: 78, ps: 700, pos: "CM", alt: ["CDM"] },
            { eaId: 50004, name: "Attaccante", rating: 80, ps: 750, pos: "ST" },
            { eaId: 50005, name: "Argento", rating: 70, ps: 250, pos: "CM" },
          ]
            .filter((row) => !gold || row.rating >= 75)
            .map((row) => apiListRow(Object.assign({ nation: 27, league: 31, club: 45 }, row)))
        : [];
      setTimeout(() => options.onload({ status: 200, responseText: JSON.stringify({ data: rows, errorcode: 0 }) }), 1);
    };
    const lists = await loadMarketLists(queries, { platform: "console" });
    const entries = marketEntries(lists.lists, { platform: "console", seed: false, requirements });
    check(lists.ok && !lists.blocked && entries.some((entry) => entry.nationId === 27) && requests.every((u) => /futbin\.org/.test(u)), "Italiens du marché lus par l'API, aucune page futbin.com", { entries: entries.length, requests });
    const mixed = await run(requirements, club.concat(entries), { options: { seed: 5, timeBudgetMs: 2500, chemMinMs: 300 } });
    const bought = marketPicksOf(mixed);
    const italiansIn = mixed.squad.filter((pick) => pick.entry && pick.entry.nationId === 27).length;
    check(mixed.ok && italiansIn >= 2 && bought.length >= 2 && bought.length <= 4, "équipe valide : 2 Italiens achetés au moins, le reste du club", { reason: mixed.reason, italians: italiansIn, bought: bought.map((pick) => pick.entry.name), failing: mixed.failing });
    const outcome = chooseOutcome(clubOnly, mixed);
    check(outcome.market && outcome.reason === "needed", "club + marché retenu (indispensable)", outcome.reason);
    delete global.GM_xmlhttpRequest;
    resetMarketForTests();
    resetFutbinClientForTests();
    resetFutbinApiForTests();
  }

  console.log("\n# achat des manquants : paliers, réserve, codes d'arrêt, vérification EA");
  {
    settings.setSetting("sbc.wait", "0.02-0.04");
    settings.setSetting("buy.coinsReserve", 0);
    const entryFor = (eaId, price) => Object.assign(marketEntry({ eaId, name: `C${eaId}`, rating: 86, prices: { console: price }, version: "Normal", position: "ST" }, { platform: "console" }), { listedAt: Date.now() });
    check(ladderFor(14000, 5).join() === "12500,13500,14500", "paliers : 90 % → prix + 5 % (arrondis EA)", ladderFor(14000, 5));
    check(referencePrice(entryFor(1, 9000)) === 9000 && referencePrice(Object.assign(entryFor(2, 9000), { listedAt: Date.now() - 11 * 60 * 1000 })) === 0, "prix de référence : liste FUTBIN de moins de 10 min");
    const searched = [];
    const mock = createMockEa({
      coins: 60000,
      market: (n, criteria, page, makeItem) => {
        searched.push(criteria.maxBuy);
        return { success: true, data: { items: criteria.maxBuy >= 13500 ? [makeItem({ definitionId: 4242, bin: 13400, rating: 86 })] : [] } };
      },
    });
    setPageForTests(mock.page);
    const target = entryFor(4242, 14000);
    const report = await buyMarketCards([target], { token: createCancelToken() });
    check(report.bought.length === 1 && report.spent === 13400 && searched.slice(0, 2).join() === "12500,13500" && mock.calls.bid.length === 1, "essai à 12 500 (rien), puis 13 500 : acheté 13 400", { report: { spent: report.spent, failed: report.failed.length, stopped: report.stopped }, searched });
    check(report.bought[0].pile === "club" && mock.calls.move.length === 1, "carte achetée envoyée au club");
    settings.setSetting("buy.coinsReserve", 50000);
    const before = mock.calls.search.length;
    const reserved = await buyMarketCards([entryFor(4243, 14000)], { token: createCancelToken() });
    check(!reserved.bought.length && /réserve/.test(reserved.stopped) && mock.calls.search.length === before, "réserve de pièces : arrêt avant toute recherche", reserved.stopped);
    settings.setSetting("buy.coinsReserve", 0);
    mock.setMarket(() => ({ success: false, status: 458, error: { code: 458 } }));
    const stopped = await buyMarketCards([entryFor(4244, 14000), entryFor(4245, 14000)], { token: createCancelToken() });
    check(!stopped.bought.length && stopped.fatal && stopped.fatal.code === 458 && mock.calls.bid.length === 1, "captcha (458) : achats arrêtés tout de suite", { stopped: stopped.stopped });
    mock.page.services.Item.searchConceptItems = (criteria) =>
      fakeObservable({
        success: true,
        response: {
          items: Array.from(criteria.defId).map((id) =>
            Object.assign(eaItem(id, 86, { definitionId: id, leagueId: 61, nationId: 7, teamId: 555, positions: [25, 21] }), { rareflag: 3, groups: [5] })
          ),
        },
      });
    const verified = await verifyMarketCards([entryFor(5001, 13000)]);
    check(verified.ok && verified.entries[0].verified && verified.entries[0].leagueId === 61 && verified.entries[0].rareflag === 3 && verified.entries[0].groups.includes(5) && verified.entries[0].price === 13000, "cartes à acheter relues par EA (cartes concept) : attributs exacts, prix gardé", verified.entries[0]);

    // Plan vérifié avant achat, puis équipe complétée avec les cartes achetées.
    uid = 0;
    const own = F433.slice(1).map((position) => P(84, { positions: [position], tradable: false }));
    const ctx = {
      squad: { getFormation: () => null, getSlot: () => null },
      challenge: {},
      slots: slotsFor(),
      requirements: [req({ [KEYS.TEAM_RATING]: 84 }), req({ [KEYS.PLAYER_RARITY_GROUP]: 5 }, { count: 1 })],
      operation: "AND",
      float: true,
    };
    const toBuy = Object.assign(entryFor(5001, 13000), { groups: [] });
    const plan = { feasible: true, squad: own.map((entry, index) => ({ slot: index + 1, entry })).concat([{ slot: 0, entry: toBuy }]) };
    const checked = await verifyPlan(ctx, plan);
    check(checked.ok && marketPicksOf(checked.result)[0].entry.verified, "plan vérifié par EA (le groupe exigé est confirmé par EA)", checked);
    mock.page.services.Item.searchConceptItems = (criteria) =>
      fakeObservable({ success: true, response: { items: Array.from(criteria.defId).map((id) => Object.assign(eaItem(id, 86, { definitionId: id }), { groups: [] })) } });
    const rejected = await verifyPlan(ctx, plan);
    check(!rejected.ok && rejected.invalid, "groupe absent d'après EA : rien n'est acheté", rejected.ok);
    const boughtItem = Object.assign(eaItem(9100, 86, { definitionId: 5001, positions: [0] }), { groups: [5] });
    const after = squadAfterPurchase(ctx, plan, [{ entry: toBuy, item: boughtItem, price: 12900, pile: "club" }]);
    check(after.ok && after.picks.length === 11 && after.picks.some((item) => item.item === boughtItem), "après achat : carte achetée à son poste, équipe valide", after.ok);
    const incomplete = squadAfterPurchase(ctx, plan, []);
    check(!incomplete.ok && incomplete.incomplete, "achat incomplet : rien n'est placé");
    settings.setSetting("sbc.wait", "3-5");
    setPageForTests(createMockEa().page);
  }

  console.log("\n# en un clic : club d'abord, puis le marché au meilleur prix par point");
  {
    const C = (key, score, cost, o = {}) => Object.assign({ key, score, cost, rating: 80, tier: 3, rareflag: 0, groups: [], tradable: true, untradeable: false }, o);
    const clubCards = Array.from({ length: 10 }, (_, index) => C(`c${index}`, 300, 40, { tradable: false, untradeable: true }));
    const market = [
      C("m85", 2900, 2950, { market: true }),
      C("m86", 3800, 3700, { market: true }),
      C("m87", 5200, 5150, { market: true }),
      C("m84", 1500, 2400, { market: true }),
    ];
    const plan = planOneClick({ candidates: clubCards.concat(market), target: 6500, limit: 30 });
    const marketKeys = plan.picks.filter((entry) => entry.market).map((entry) => entry.key);
    // 9 cartes du club (2 700) + le 86 (3 800) = 6 500 tout juste : la 10e carte du club serait de trop.
    check(plan.reached && plan.picks.filter((entry) => !entry.market).length === 9 && marketKeys.join() === "m86" && plan.cost === 4060, "cartes du club d'abord + une seule carte achetée (86, 3 800 pts)", { picks: plan.picks.map((entry) => entry.key), cost: plan.cost });
    const clubEnough = planOneClick({ candidates: clubCards.concat(market), target: 2400, limit: 30 });
    check(clubEnough.reached && !clubEnough.picks.some((entry) => entry.market), "score atteignable avec le club : rien à acheter");

    // Cartes achetées ajoutées au modèle de vue d'EA puis sélectionnées.
    const selected = new Set();
    const vm = {
      _itemEntityMap: new Map(),
      _itemScoreMap: new Map(),
      _itemTabMap: new Map(),
      isItemSelectable: (item) => Number(item.sbsScore) > 0,
      selectItem(item) { selected.add(item.id); return true; },
      isItemSelected: (item) => selected.has(item.id),
      getSelectedScore() { return Array.from(selected).reduce((total, id) => total + (vm._itemScoreMap.get(id) || 0), 0); },
      getCurrentPageItems: () => [],
    };
    const area = { vm, ctrl: { _refreshCurrentPage() {} } };
    const boughtCards = [
      { entry: market[1], item: { id: 71, sbsScore: 3810 }, pile: "club" },
      { entry: market[0], item: { id: 72, sbsScore: 0 }, pile: "storage" },
    ];
    const applied = selectBought(area, boughtCards);
    check(applied.selected.length === 1 && applied.skipped.length === 1 && vm._itemScoreMap.get(71) === 3810 && vm._itemTabMap.get(72) === "storage" && applied.selectedScore === 3810, "cartes achetées : score réel d'EA, onglet ; non sélectionnable selon EA → ignorée", applied);
  }

  console.log("\n# placement avec des cartes à acheter : joueurs concept d'EA, un enregistrement, jamais d'envoi");
  {
    const emptyItem = () => ({ id: 0, definitionId: 0, isValid: () => false, isPlayer: () => true });
    const slots = Array.from({ length: 23 }, (_, index) => ({ index, item: emptyItem(), generalPosition: F433[index], isBrick: () => false, isCustomBrick: () => false, isValid() { return this.item.isValid(); } }));
    const squad = {
      getFormation: () => ({ id: 1, getPosition: (index) => (index < 11 ? { typeId: F433[index], typeName: POSITION_NAMES[F433[index]] } : null) }),
      getSlot: (index) => slots[index],
      removeAllItems() { slots.forEach((slot) => { slot.item = emptyItem(); }); return true; },
      setPlayers(items) {
        items.forEach((item, index) => { if (item) slots[index].item = emptyItem(); });
        items.forEach((item, index) => {
          if (!item) return;
          const db = item.definitionId & 0xffffff;
          if (db && slots.some((slot) => slot.item.isValid() && (slot.item.definitionId & 0xffffff) === db)) return;
          slots[index].item = item;
        });
      },
      isSquadFull: () => slots.slice(0, 11).every((slot) => slot.item.isValid()),
      // Comme EA : un joueur concept rend l'équipe impossible à envoyer (pas à enregistrer).
      isSBCSquadEligible: () => slots.slice(0, 11).every((slot) => !slot.item.concept),
    };
    let saveResponses = [];
    const counts = { save: 0, submit: 0 };
    const mock = createMockEa();
    mock.page.services.SBC = {
      saveChallenge() { counts.save += 1; return fakeObservable(saveResponses.length ? saveResponses.shift() : { success: true }); },
      submitChallenge() { counts.submit += 1; return fakeObservable({ success: true }); },
    };
    let conceptSearches = 0;
    mock.page.services.Item.searchConceptItems = (criteria) => {
      conceptSearches += 1;
      return fakeObservable({ success: true, response: { items: Array.from(criteria.defId).map((id) => Object.assign(eaItem(id, 84, { definitionId: id, positions: [25] }), { id, concept: true })) } });
    };
    setPageForTests(mock.page);
    const ctx = {
      ctrl: { getView: () => ({ updateChallenge() {} }) },
      squad,
      challenge: { id: 77, meetsRequirements: () => squad.isSquadFull(), isRequirementMet: () => true, eligibilityRequirements: [], hasExpired: () => false },
      slots: slotsFor(),
      requirements: [req({ [KEYS.TEAM_RATING]: 80 })],
      operation: "AND",
      float: true,
    };
    uid = 0;
    const owned = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => Object.assign(P(82, { positions: [F433[slot]], tradable: false }), { item: eaItem(2000 + slot, 82, { positions: [F433[slot]] }) }));
    const buyA = Object.assign(marketEntry({ eaId: 6100, name: "A", rating: 84, prices: { console: 5000 }, version: "Normal", position: "GK" }, { platform: "console" }), { listedAt: Date.now() });
    const buyB = Object.assign(marketEntry({ eaId: 6200, name: "B", rating: 84, prices: { console: 5100 }, version: "Normal", position: "LW" }, { platform: "console" }), { listedAt: Date.now() });
    const conceptA = Object.assign(eaItem(6100, 84, { definitionId: 6100, positions: [0] }), { id: 6100, concept: true });
    const conceptB = Object.assign(eaItem(6200, 84, { definitionId: 6200, positions: [27] }), { id: 6200, concept: true });
    const plan = (withConcepts) => ({
      feasible: true,
      squad: owned
        .map((entry, index) => ({ slot: index + 1, entry }))
        .concat([
          { slot: 0, entry: Object.assign({}, buyA, withConcepts ? { conceptItem: conceptA } : {}) },
          { slot: 10, entry: Object.assign({}, buyB, withConcepts ? { conceptItem: conceptB } : {}) },
        ]),
    });

    const placed = await placeWithConcepts(ctx, plan(true), { formationId: 1 });
    check(placed.ok && placed.concept && placed.count === 2 && counts.save === 1 && counts.submit === 0, "cartes possédées + 2 joueurs concept placés, un seul enregistrement, aucun envoi", { placed: placed.ok, concept: placed.concept, counts });
    check(slots[0].item === conceptA && slots[10].item === conceptB && slots[3].item === owned[2].item && conceptSearches === 0, "chaque carte à son poste (concepts aux postes des cartes à acheter, déjà relus par EA)");
    check(!squad.isSBCSquadEligible(), "EA bloquera l'envoi tant qu'il reste des concepts (isSBCSquadEligible)");

    const fresh = await placeWithConcepts(ctx, plan(false), { formationId: 1 });
    check(fresh.ok && fresh.concept && conceptSearches === 1 && slots[0].item.concept === true && slots[0].item.definitionId === 6100 && counts.save === 2, "cartes à acheter sans concept : relues par EA (searchConceptItems, versions exactes) puis posées", { conceptSearches, saves: counts.save });

    saveResponses = [{ success: false, status: 400, error: { code: 400 } }, { success: true }];
    const fallback = await placeWithConcepts(ctx, plan(true), { formationId: 1 });
    check(fallback.ok && !fallback.concept && fallback.fallback && /400/.test(fallback.reason) && counts.save === 4, "EA refuse d'enregistrer les concepts (400) : repli sur les cartes possédées, raison donnée", { fallback, saves: counts.save });
    check(!slots[0].item.isValid() && !slots[10].item.isValid() && slots[1].item === owned[0].item && counts.submit === 0, "repli : postes des cartes à acheter vides, cartes possédées à leur poste, aucun envoi");

    saveResponses = [{ success: false, status: 429, error: { code: 429 } }];
    const stopped = await placeWithConcepts(ctx, plan(true), { formationId: 1 });
    check(!stopped.ok && stopped.stopped && counts.save === 5, "trop de requêtes (429) : pas de nouvel essai", { saves: counts.save });

    const loan = Object.assign({}, owned[4], { item: eaItem(9999, 82, { loan: true, positions: [14] }) });
    const withLoan = plan(true);
    withLoan.squad[4] = { slot: 5, entry: loan };
    const refusedLoan = await placeWithConcepts(ctx, withLoan, { formationId: 1 });
    check(!refusedLoan.ok && counts.save === 5, "prêt dans l'équipe : refusé même en repli (rien n'est enregistré)", refusedLoan.message);
    saveResponses = [];
    setPageForTests(createMockEa().page);
  }

  console.log("\n# joueurs concept de l'équipe du défi : achat, remplacement à leur poste, contrôle EA, un enregistrement");
  {
    resetConceptsForTests();
    const emptyItem = () => ({ id: 0, definitionId: 0, isValid: () => false, isPlayer: () => true });
    const concept = (id, rating) => Object.assign(eaItem(id, rating, { definitionId: id, name: `Concept ${id}` }), { id, concept: true });
    const owned = (id) => eaItem(id, 82, { positions: [14] });
    const makeSquad = () => {
      const slots = Array.from({ length: 23 }, (_, index) => ({ index, item: emptyItem(), isBrick: () => index === 7, isCustomBrick: () => false, isValid() { return this.item.isValid(); } }));
      for (let index = 0; index < 11; index += 1) {
        slots[index].item = owned(3000 + index);
      }
      slots[0].item = concept(6100, 84);
      slots[4].item = concept(6200, 86);
      slots[7].item = concept(6300, 80);
      slots[9].item = Object.assign(concept(6400, 80), { isValid: () => false });
      const squad = {
        slots,
        getSlot: (index) => slots[index],
        addItemToSlot(index, item) {
          const previous = slots[index].item;
          slots[index].item = item;
          return previous;
        },
        isSquadFull: () => slots.slice(0, 11).every((slot) => slot.isBrick() || slot.item.isValid() || slot.item.concept),
        isSBCSquadEligible: () => slots.slice(0, 11).every((slot) => !slot.item.concept),
      };
      return squad;
    };
    const squad = makeSquad();
    const found = conceptSlots(squad);
    check(found.map((entry) => entry.slot).join() === "0,4" && found[1].definitionId === 6200, "concepts trouvés aux postes 0 et 4 (brique et carte vide ignorées, quelle que soit leur origine)", found.map((entry) => entry.slot));
    rememberPlanned("77", [{ definitionId: 6200, price: 13000, listedAt: 123, version: "Normal" }]);
    const targets = conceptTargets(squad, { priceOf: (id) => (id === 6100 ? 5000 : 0), known: plannedFor("77") });
    check(
      targets.length === 2 && targets[0].key === "c:0:6100" && targets[0].price === 5000 && targets[0].listedAt === 0 && targets[1].price === 13000 && targets[1].listedAt === 123 && targets[1].version === "Normal" && targets[1].conceptItem === squad.slots[4].item && targets[0].market,
      "cartes à acheter : version exacte du concept, prix FUTBIN (sinon prévision du solveur)",
      targets.map((entry) => [entry.key, entry.price, entry.listedAt])
    );
    check(conceptTotal(targets).total === 18000 && conceptTotal(targets).unknown === 0 && conceptTotal([{ price: 0 }, { price: 900 }]).unknown === 1, "total des prix connus, cartes sans prix comptées à part");
    const boughtA = eaItem(9001, 84, { definitionId: 6100 });
    check(slotForBought(squad, { slot: 0 }, boughtA) === 0, "carte achetée → poste de son concept");
    const moved = makeSquad();
    moved.slots[2].item = moved.slots[0].item;
    moved.slots[0].item = owned(4000);
    check(slotForBought(moved, { slot: 0 }, boughtA) === 2 && slotForBought(moved, { slot: 0 }, eaItem(9002, 84, { definitionId: 7777 })) === -1, "concept déplacé par l'utilisateur : retrouvé (même joueur) ; joueur absent : aucun poste");

    const mock = createMockEa();
    const counts = { save: 0, submit: 0 };
    let saveResponse = { success: true };
    mock.page.services.SBC = {
      saveChallenge() { counts.save += 1; return fakeObservable(saveResponse); },
      submitChallenge() { counts.submit += 1; return fakeObservable({ success: true }); },
    };
    setPageForTests(mock.page);
    let met = true;
    const ctxFor = (target) => ({
      ctrl: { getView: () => ({ updateChallenge() {} }) },
      squad: target,
      challenge: { id: 77, meetsRequirements: () => met, isRequirementMet: () => met, eligibilityRequirements: [fakeReq({ [KEYS.TEAM_RATING]: 84 }, { label: "Note d'équipe : min. 84" })] },
    });
    const full = makeSquad();
    const boughtB = eaItem(9003, 86, { definitionId: 6200 });
    const done = await replaceConcepts(ctxFor(full), [{ entry: targets[0], item: boughtA }, { entry: targets[1], item: boughtB }]);
    check(done.ok && done.replaced.length === 2 && done.remaining === 0 && full.slots[0].item === boughtA && full.slots[4].item === boughtB && counts.save === 1 && counts.submit === 0, "concepts remplacés par les cartes achetées, contrôle EA, un enregistrement, aucun envoi", { done: done.ok, counts });

    const partial = makeSquad();
    const half = await replaceConcepts(ctxFor(partial), [{ entry: targets[0], item: boughtA }]);
    check(half.ok && half.remaining === 1 && partial.slots[4].item.concept === true && counts.save === 2, "un achat sur deux : la carte achetée remplace son concept, l'autre concept reste, équipe enregistrée");

    met = false;
    const refused = makeSquad();
    const before = refused.slots[0].item;
    const rejected = await replaceConcepts(ctxFor(refused), [{ entry: targets[0], item: boughtA }]);
    check(!rejected.ok && rejected.rejected && /min\. 84/.test(rejected.message) && refused.slots[0].item === before && counts.save === 2, "EA ne valide pas l'équipe : concept remis, rien n'est enregistré", rejected.message);
    met = true;

    saveResponse = { success: false, status: 500, error: { code: 500 } };
    const unsaved = await replaceConcepts(ctxFor(makeSquad()), [{ entry: targets[0], item: boughtA }]);
    check(!unsaved.ok && unsaved.saveFailed && /500/.test(unsaved.message) && counts.save === 3, "enregistrement refusé par EA : signalé", unsaved.message);
    saveResponse = { success: true };

    const nothing = await replaceConcepts(ctxFor(makeSquad()), [{ entry: { slot: 0 }, item: eaItem(9009, 84, { definitionId: 7777 }) }]);
    check(!nothing.ok && nothing.replaced.length === 0 && counts.save === 3, "aucun concept de ce joueur dans l'équipe : rien n'est enregistré");

    const loanSquad = makeSquad();
    loanSquad.slots[3].item = eaItem(5555, 82, { loan: true });
    const loanResult = await replaceConcepts(ctxFor(loanSquad), [{ entry: targets[0], item: boughtA }]);
    check(!loanResult.ok && loanSquad.slots[0].item.concept === true && counts.save === 3, "prêt dans l'équipe : refusé, concept remis");
    check(counts.submit === 0, "jamais d'envoi du défi");
    resetConceptsForTests();
    setPageForTests(createMockEa().page);
  }

  console.log("\n# réglages par défaut du solveur");
  {
    const defaults = settings.DEFAULT_SETTINGS.solver;
    check(
      defaults.excludeActiveSquad === true && defaults.excludeEvolved === true && defaults.onlyUntradeables === false && defaults.preferUntradeables === true && defaults.preferStorage === true && defaults.useStorage === true && defaults.maxRating === 0 && defaults.maxPrice === 0,
      "équipe active et évolués exclus, non échangeables et stockage d'abord, sans limites",
      defaults
    );
  }

  console.log(`\n${passes} OK, ${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
