import { t } from "../i18n";
import { currentPrice } from "../prices/priceService";
import { observe, sleep } from "./async";
import { classify, isFatal, KIND } from "./errors";
import { activeSquadItemIds, fetchClubPage, nameOf } from "./market";
import { itemService, pageGlobal, repositories } from "./page";
import { bumpStat } from "./state";
import { asBot, usageLimitMessage } from "./usage";
import { HALL_OF_FUT_CLUB_ID, LEAGUE_HERO_CLUB_ID, LEGENDS_CLUB_ID, LEGENDS_LEAGUE_ID, tierOf } from "./sbcEval";

// Réserve de joueurs du solveur DCE : club (pages de 90, espacées de 0,6 à 1,2 s) + stockage DCE,
// lus une fois puis gardés 10 min. Chaque carte est normalisée (note, palier, nation, ligue, club lié,
// rareté, groupes, postes possibles, échangeable, coût) ; les cartes interdites dans un défi (prêts,
// inscrites à une évolution, concept) ou protégées par les réglages (équipe active, évoluées, favorites…)
// sont écartées avec leur motif. Arrêt immédiat sur captcha, session expirée ou blocage EA.

const PAGE = 90;
const MAX_PAGES = 120;
const STORAGE_PAGE = 100;
const CACHE_MS = 10 * 60 * 1000;
const PRICE_AGE = 60 * 60 * 1000;
// Codes EA qui arrêtent toute lecture : session (401), trop d'actions DCE (426), trop de requêtes (429),
// vérification captcha (458), blocage temporaire (512 / 521).
export const STOP_CODES = new Set([401, 426, 429, 458, 512, 521]);

let pause = { min: 600, max: 1200 };
let cache = null;
// Carte placée par le solveur → défi où elle a été placée.
const consumed = new Map();

const call = (target, method, ...args) => {
  try {
    return target && typeof target[method] === "function" ? target[method](...args) : undefined;
  } catch (e) {
    return undefined;
  }
};

const pauseMs = () => pause.min + Math.random() * Math.max(0, pause.max - pause.min);

// Erreur qui doit tout arrêter (captcha, session, blocage, trop de requêtes).
export const isStopError = (error) =>
  !!error && (STOP_CODES.has(Number(error.code)) || isFatal(error.kind) || error.kind === KIND.RATE || error.kind === KIND.BLOCKED);

// ------------------------------------------------------------------ prix

// Prix estimé d'une carte sans prix FUTBIN connu (ordre de grandeur du marché des DCE de FC 27).
export const estimatePrice = (rating, { rare = false, special = false } = {}) => {
  const value = Number(rating) || 0;
  let price;
  if (value <= 64) {
    price = 150 + (rare ? 100 : 0);
  } else if (value <= 74) {
    price = 200 + (value - 65) * 25 + (rare ? 150 : 0);
  } else if (value <= 79) {
    price = 450 + (value - 75) * 80 + (rare ? 150 : 0);
  } else {
    const table = { 80: 800, 81: 1000, 82: 1500, 83: 2600, 84: 5000, 85: 8500, 86: 13000, 87: 19000, 88: 27000, 89: 38000, 90: 52000 };
    price = table[value] || Math.round(52000 * Math.pow(1.35, value - 90));
  }
  return special ? Math.round(price * 1.6 + 500) : price;
};

// ------------------------------------------------------------------ normalisation

// Club lié (EA : repositories.TeamConfig.getLinkedTeam), mémorisé.
export const linkedTeamFn = () => {
  const memo = new Map();
  return (teamId) => {
    const id = Number(teamId);
    if (memo.has(id)) {
      return memo.get(id);
    }
    let linked = id;
    try {
      const repo = repositories() && repositories().TeamConfig;
      const value = repo && typeof repo.getLinkedTeam === "function" ? Number(repo.getLinkedTeam(id)) : id;
      linked = Number.isFinite(value) ? value : id;
    } catch (e) {}
    memo.set(id, linked);
    return linked;
  };
};

const flag = (item, method, fallback) => {
  const value = call(item, method);
  return value === undefined ? fallback : !!value;
};

const positionsOf = (item) => {
  try {
    const list = item.possiblePositions;
    if (list && typeof list.length === "number" && list.length) {
      return Array.from(list).map(Number).filter((n) => Number.isFinite(n));
    }
  } catch (e) {}
  const preferred = Number(item && item.preferredPosition);
  return Number.isFinite(preferred) && preferred >= 0 ? [preferred] : [];
};

// Carte EA → entrée de la réserve (sans coût : calculé avec les réglages par buildPool).
export const entryFromItem = (item, source = "club", { linkedTeam = (id) => id, priceOf = null } = {}) => {
  const definitionId = Number(item.definitionId) || 0;
  const rating = Number(item.rating) || 0;
  const teamId = Number(item.teamId);
  const leagueId = Number(item.leagueId);
  const rareflag = Number(item.rareflag) || 0;
  const legend = flag(item, "isLegend", teamId === LEGENDS_CLUB_ID || leagueId === LEGENDS_LEAGUE_ID);
  const iconId = Number(item.iconId) || 0;
  const databaseId = Number(item.databaseId) || definitionId & 0xffffff;
  const tradable = item.tradable === true;
  const owners = Number(item.owners) || 0;
  const special = flag(item, "isSpecial", rareflag > 1);
  const price = priceOf ? priceOf(definitionId) : currentPrice(definitionId, PRICE_AGE, "display");
  return {
    key: String(item.id),
    id: item.id,
    item,
    source,
    definitionId,
    // Même joueur (deux versions interdites dans une équipe) : comme UTItemEntity.compareResourceTo.
    person: legend && iconId > 0 ? `i${iconId}` : `d${databaseId}`,
    name: nameOf(item),
    rating,
    tier: tierOf(rating),
    nationId: Number(item.nationId),
    leagueId,
    teamId,
    clubId: linkedTeam(teamId),
    rareflag,
    groups: Array.from(item.groups || []).map(Number),
    owners,
    firstOwner: owners === 1,
    tradable,
    untradeable: !tradable,
    legend,
    hero: flag(item, "isLeagueHeroItem", teamId === LEAGUE_HERO_CLUB_ID),
    superChem: flag(item, "isSuperChem", false),
    special,
    restrictedClub: teamId === LEGENDS_CLUB_ID || teamId === LEAGUE_HERO_CLUB_ID || teamId === HALL_OF_FUT_CLUB_ID,
    positions: positionsOf(item),
    preferredPosition: Number(item.preferredPosition),
    duplicate: flag(item, "isDuplicate", false),
    evolved: !!item.upgrades,
    academy: flag(item, "isEnrolledInAcademy", false),
    loan: flag(item, "isLimitedUse", false),
    concept: !!item.concept,
    favorite: item.isFavorite === true,
    discardValue: Number(item.discardValue) || 0,
    price: price || 0,
    estimated: !price,
    value: price || estimatePrice(rating, { rare: rareflag === 1, special }),
    cost: 0,
  };
};

// Coût d'utilisation d'une carte dans le défi : valeur FUTBIN (ou estimée), fortement réduite pour une
// carte non échangeable (réglage), réduite pour un doublon du stockage DCE (réglage) ; jamais sous le
// prix de vente rapide. Un petit terme de note garde les meilleures cartes pour plus tard.
export const costOf = (entry, rules = {}) => {
  let cost = entry.value;
  if (entry.untradeable) {
    cost *= rules.preferUntradeables !== false ? 0.12 : 1;
  }
  if (entry.source === "storage" || entry.duplicate) {
    cost *= rules.preferStorage !== false ? 0.5 : 1;
  }
  return Math.round(Math.max(cost, entry.discardValue || 0) + entry.rating * 0.5);
};

// Motif d'exclusion d'une carte (null = utilisable). challengeId : défi en cours (une carte placée par
// le solveur dans ce même défi reste utilisable, pas une carte placée dans un autre défi).
export const excludeReason = (entry, rules = {}, { squadIds = null, consumedIds = consumed, challengeId = null } = {}) => {
  if (entry.concept) {
    return "concept";
  }
  if (entry.loan) {
    return "loan";
  }
  if (entry.academy) {
    return "academy";
  }
  if (rules.excludeActiveSquad !== false && squadIds && squadIds.has(entry.key)) {
    return "squad";
  }
  if (consumedIds && consumedIds.has(entry.key) && String(consumedIds.get(entry.key)) !== String(challengeId)) {
    return "placed";
  }
  if (rules.excludeEvolved !== false && entry.evolved) {
    return "evolved";
  }
  if (rules.excludeFavorites !== false && entry.favorite) {
    return "favorite";
  }
  if (rules.onlyUntradeables && entry.tradable) {
    return "tradable";
  }
  // Réglage serveur EA (SBC_ALLOW_UNTRADEABLE) : cartes non échangeables refusées dans les défis.
  if (rules.untradeableForbidden && entry.untradeable) {
    return "untradeable";
  }
  if (rules.maxRating > 0 && entry.rating > rules.maxRating) {
    return "rating";
  }
  if (rules.maxPrice > 0 && entry.value > rules.maxPrice) {
    return "price";
  }
  return null;
};

const isPlayer = (item) => {
  const value = call(item, "isPlayer");
  return value === undefined ? item && (item.type === "player" || item.type == null) : !!value;
};

// Cartes lues → réserve utilisable : { entries, excluded: { motif: nombre }, total }.
export const buildPool = (
  raw,
  rules = {},
  { squadIds = null, linkedTeam = linkedTeamFn(), priceOf = null, consumedIds = consumed, challengeId = null } = {}
) => {
  const excluded = {};
  const entries = [];
  const seen = new Set();
  let total = 0;
  raw.forEach(({ item, source }) => {
    if (!item || !isPlayer(item) || seen.has(String(item.id))) {
      return;
    }
    seen.add(String(item.id));
    total += 1;
    const entry = entryFromItem(item, source, { linkedTeam, priceOf });
    if (rules.useStorage === false && source === "storage") {
      excluded.storage = (excluded.storage || 0) + 1;
      return;
    }
    const reason = excludeReason(entry, rules, { squadIds, consumedIds, challengeId });
    if (reason) {
      excluded[reason] = (excluded[reason] || 0) + 1;
      return;
    }
    entry.cost = costOf(entry, rules);
    entries.push(entry);
  });
  return { entries, excluded, total };
};

// ------------------------------------------------------------------ lecture EA

// Une page du stockage DCE (services.Item.searchStorageItems), comptée comme requête MagicBuyer.
const storagePage = async (offset, count) => {
  const svc = itemService();
  if (!svc || typeof svc.searchStorageItems !== "function") {
    return { ok: true, items: [], endOfList: true, unavailable: true };
  }
  const Dto = pageGlobal("UTSearchCriteriaDTO");
  let criteria;
  try {
    criteria = typeof Dto === "function" ? new Dto() : {};
  } catch (e) {
    criteria = {};
  }
  criteria.type = "player";
  criteria.offset = offset;
  criteria.count = count;
  let observable;
  try {
    observable = asBot(() => svc.searchStorageItems(criteria));
  } catch (e) {
    return { ok: false, items: [], error: { code: -1, kind: "other", label: t("solver.errStorage") } };
  }
  bumpStat("requests");
  const response = await observe(observable, 20000);
  const ok = !!(response && response.success);
  const data = (response && (response.response || response.data)) || {};
  const items = Array.from(data.items || []);
  return { ok, items, endOfList: !!(data.endOfList || data.retrievedAll) || items.length < count, error: ok ? null : classify(response) };
};

const fresh = (entry) => entry && Date.now() - entry.at < CACHE_MS;

// Club + stockage DCE (+ équipe active) : { ok, items: [{ item, source }], squadIds, at, cached, partial,
// warning, error, stopped, cancelled }. onProgress({ phase, page, players }).
export const loadPoolItems = async ({ token = null, onProgress = () => {}, force = false, useStorage = true, excludeActiveSquad = true } = {}) => {
  if (!force && fresh(cache) && (cache.storage || !useStorage) && (cache.squadIds || !excludeActiveSquad)) {
    return Object.assign({ ok: true, cached: true }, cache);
  }
  const cancelled = () => !!(token && token.cancelled);
  const stopFor = (error) => ({ ok: false, stopped: isStopError(error), error });
  const items = [];
  const seen = new Set();
  let squadIds = null;
  let warning = "";
  // Équipe active d'abord : sans elle, aucune proposition (jamais un titulaire dans un défi).
  if (excludeActiveSquad) {
    onProgress({ phase: "squad", page: 0, players: 0 });
    const squad = await activeSquadItemIds();
    if (!squad.ok) {
      return { ok: false, error: { code: 0, kind: "other", label: t("solver.errSquadUnread") } };
    }
    squadIds = squad.ids;
    if (!(await sleep(pauseMs(), token))) {
      return { ok: false, cancelled: true };
    }
  }
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (cancelled()) {
      return { ok: false, cancelled: true };
    }
    const limit = usageLimitMessage();
    if (limit) {
      return { ok: false, error: { code: 0, kind: "usage", label: limit } };
    }
    const result = await fetchClubPage(page * PAGE, PAGE);
    if (!result.ok) {
      if (isStopError(result.error) || !items.length) {
        return stopFor(result.error);
      }
      // Erreur passagère après quelques pages : on garde ce qui a été lu (signalé à l'utilisateur).
      warning = t("solver.warnClubPartial", { error: result.error ? result.error.label : "?" });
      break;
    }
    let added = 0;
    result.items.forEach((item) => {
      const key = String(item.id);
      if (!seen.has(key)) {
        seen.add(key);
        items.push({ item, source: "club" });
        added += 1;
      }
    });
    onProgress({ phase: "club", page: page + 1, players: items.length });
    if (result.retrievedAll || result.items.length < PAGE || !added) {
      break;
    }
    if (!(await sleep(pauseMs(), token))) {
      return { ok: false, cancelled: true };
    }
  }
  let storage = false;
  if (useStorage) {
    for (let offset = 0; offset < 1000; offset += STORAGE_PAGE) {
      if (!(await sleep(pauseMs(), token))) {
        return { ok: false, cancelled: true };
      }
      onProgress({ phase: "storage", page: offset / STORAGE_PAGE + 1, players: items.length });
      const result = await storagePage(offset, STORAGE_PAGE);
      if (!result.ok) {
        if (isStopError(result.error)) {
          return stopFor(result.error);
        }
        warning = warning || t("solver.warnStorage", { error: result.error ? result.error.label : "?" });
        break;
      }
      result.items.forEach((item) => {
        const key = String(item.id);
        if (!seen.has(key)) {
          seen.add(key);
          items.push({ item, source: "storage" });
        }
      });
      storage = true;
      if (result.endOfList || !result.items.length) {
        break;
      }
    }
  }
  const loaded = { items, squadIds, storage, at: Date.now(), partial: !!warning, warning };
  // Lecture partielle : jamais gardée en mémoire (la prochaine recherche relit tout). Club relu :
  // l'état d'EA fait foi, les cartes placées auparavant ne sont plus écartées d'office.
  cache = warning ? null : loaded;
  consumed.clear();
  return Object.assign({ ok: true, cached: false }, loaded);
};

// ------------------------------------------------------------------ cache

export const poolCacheInfo = () =>
  fresh(cache) ? { at: cache.at, players: cache.items.length, storage: cache.storage, ageMs: Date.now() - cache.at } : null;

export const invalidatePool = () => {
  cache = null;
};

// Cartes placées dans un défi par le solveur : plus proposées pour un autre défi tant que la réserve
// en mémoire est utilisée (elles partiront du club à l'envoi du défi).
export const markConsumed = (keys, challengeId) => {
  (keys || []).forEach((key) => consumed.set(String(key), String(challengeId)));
};

export const consumedCount = () => consumed.size;

// Cartes achetées par le solveur : ajoutées à la réserve en mémoire (club ou stockage DCE), sans
// relire tout le club. bought : [{ item, pile: "club" | "storage" }].
export const addToPool = (bought) => {
  if (!cache) {
    return 0;
  }
  const seen = new Set(cache.items.map(({ item }) => String(item.id)));
  let added = 0;
  (bought || []).forEach(({ item, pile }) => {
    if (item && item.id != null && !seen.has(String(item.id))) {
      seen.add(String(item.id));
      cache.items.push({ item, source: pile === "storage" ? "storage" : "club" });
      added += 1;
    }
  });
  return added;
};

// Utilisé par les tests.
export const resetPoolForTests = () => {
  cache = null;
  consumed.clear();
  pause = { min: 600, max: 1200 };
};

export const setPoolPauseForTests = (min, max) => {
  pause = { min, max };
};
