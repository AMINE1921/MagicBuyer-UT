import { startKeepAlive, stopKeepAlive, unlockAudio } from "./audio";
import { createCancelToken, sleep, withTimeout } from "./async";
import { KIND, classify, isFatal, parseCodeList } from "./errors";
import {
  buildCriteria,
  cacheBusterPrices,
  describeFilter,
  filterHasTarget,
  getRotation,
  runnableFilters,
} from "./filters";
import { errorMessage, log } from "./logger";
import * as market from "./market";
import { notifyEvent, sound } from "./notify";
import { getCoins, getUser, isAppReady, itemService, pageGlobal } from "./page";
import {
  durationSeconds,
  fixedSellPriceFor,
  futbinSellPrice,
  percentRange,
  prepareListing,
  sellModeFor,
  sellPercentFor,
} from "./listing";
import {
  EA_TAX,
  afterTax,
  breakEvenPrice,
  floorPrice,
  formatCoins,
  priceAbove,
  priceBelow,
  profitFor,
  roundPrice,
  toInt,
} from "./prices";
import { formatDuration, parseRange, pickInt, pickSeconds, randomBetween } from "./ranges";
import { acquireCardSet, cardSetKey, cardSetSnapshot } from "../prices/cardSets";
import { currentPrice, getPriceRecord, onPriceUpdate, requestPrice } from "../prices/priceService";
import { plural, t } from "../i18n";
import { getSettings } from "./settings";
import { currentTask } from "./tasks";
import { usageBlocked, usageWaitMs } from "./usage";
import { isBotItem, rememberBotItem } from "./botItems";
import { findLowestBin, robustMarketPrice } from "./lowestBin";
import {
  STATUS,
  bumpFilterStat,
  bumpStat,
  getState,
  recordSearch,
  recordTransaction,
  resetStats,
  updateState,
} from "./state";

// Limites de sécurité, sans interrupteur : 2 s au moins entre deux recherches, pause au plus
// toutes les 50 recherches (20–30 si non réglée, 10 s au moins), arrêt au plus tard après 12 h
// (3 h si non réglé), 1,5 à 2,5 s entre deux achats ou enchères d'une même recherche.
const SAFETY = {
  minWaitMs: 2000,
  maxPauseEvery: 50,
  maxSessionMs: 12 * 60 * 60 * 1000,
  defaultSessionMs: 3 * 60 * 60 * 1000,
  minPauseSeconds: 10,
  actionGapMs: [1500, 2500],
  autoPause: true,
};

// Tests uniquement : planchers abaissés pour que les scénarios tournent en quelques secondes.
export const setSafetyForTests = (patch) => Object.assign(SAFETY, patch);

const safePauseEvery = (value) => {
  const n = pickInt(value);
  if (n > 0) {
    return Math.min(SAFETY.maxPauseEvery, n);
  }
  return SAFETY.autoPause ? 20 + Math.floor(Math.random() * 11) : 0;
};

const safeSessionMs = (seconds) => Math.min(SAFETY.maxSessionMs, seconds > 0 ? seconds * 1000 : SAFETY.defaultSessionMs);

const actionGap = (token) => {
  const [min, max] = SAFETY.actionGapMs;
  return max > 0 ? sleep(min + Math.random() * Math.max(0, max - min), token) : Promise.resolve();
};

const RELIST_MIN_GAP = 5 * 60 * 1000;
const CLEAR_MIN_GAP = 60 * 1000;
const REFERENCE_WAIT_MAX = 2 * 60 * 1000;
const MAX_SELL_DEFERRALS = 6;
// Attente maximale du prix FUTBIN d'une carte achetée avant de l'envoyer non listée en liste des transferts.
const SELL_PRICE_WAIT = 90 * 1000;
// Âge maximal d'un prix FUTBIN utilisable pour vendre (l'achat utilise des prix de moins de 5 min).
const SELL_PRICE_MAX_AGE = 10 * 60 * 1000;
const RELIST_RETRY = 90 * 1000;
const RELIST_BATCH = 5;
const RELIST_FALLBACK_AFTER = 3 * 60 * 1000;

let run = null;

export const isRunning = () => !!run;
export const isPaused = () => !!(run && run.paused);
export const isStopping = () => !!(run && run.stopping);
// Mises en vente des cartes achetées juste avant l'arrêt (Stop les interrompt).
export const isFinalizing = () => !!(run && run.finalToken && !run.finalToken.cancelled);

// ------------------------------------------------------------ utilitaires

const safeCall = (target, method) => {
  try {
    return !!(target && typeof target[method] === "function" && target[method]());
  } catch (e) {
    return false;
  }
};

// Attente interrompue par Stop (jeton du run) ou par Pause/Reprise (jeton ponctuel).
const idle = async (ctx, ms) => {
  if (ctx.token.cancelled) {
    return false;
  }
  const interrupt = createCancelToken();
  ctx.interrupt = interrupt;
  const onStop = () => interrupt.cancel();
  ctx.token.on(onStop);
  const completed = await sleep(ms, interrupt);
  ctx.token.off(onStop);
  if (ctx.interrupt === interrupt) {
    ctx.interrupt = null;
  }
  return completed && !ctx.token.cancelled;
};

// "Pas avant" : prochaine recherche autorisée. Une pause manuelle ne raccourcit jamais
// une attente (temps entre recherches, pause automatique ou pause de sécurité).
const setNotBefore = (ctx, at, kind) => {
  const now = Date.now();
  if (at >= ctx.notBefore || ctx.notBefore <= now) {
    ctx.notBefore = at;
    ctx.waitKind = kind;
    ctx.waitStartedAt = now;
  }
};

const inCooldown = (ctx) => ctx.waitKind === "cooldown" && ctx.notBefore > Date.now();
const blocked = (ctx) => ctx.token.cancelled || inCooldown(ctx);

const sessionAlive = () => !!(itemService() && getUser());

// ------------------------------------------------ prix FUTBIN : cartes et tranches
// Mode « % du prix FUTBIN » : chaque carte suivie (version exacte, versions du joueur ou joueurs
// d'une liste FUTBIN) a son propre prix d'achat max = X % de SON prix FUTBIN (plafonné).
// Les recherches se font par tranche de prix serrée : peu de résultats, donc les annonces les plus
// récentes sont toujours sur la première page (EA trie les résultats du plus ancien au plus récent).
// Une tranche d'une seule carte = recherche de cette version précise.

const DEFAULT_BAND_RATIO = 1.3;
const MIN_BAND_RATIO = 1.05;
const MAX_BANDS = 16;

// Abonnement aux cartes FUTBIN d'un filtre (prix suivis tant que le run tourne).
const ensureCardSet = (ctx, filter) => {
  const key = cardSetKey(filter);
  const current = ctx.sets.get(filter.id);
  if (current && current.key === key) {
    return current;
  }
  if (current) {
    current.release();
    ctx.sets.delete(filter.id);
  }
  const handle = key ? acquireCardSet(filter) : null;
  if (handle) {
    ctx.sets.set(filter.id, handle);
  }
  return handle;
};

const releaseSets = (ctx) => {
  ctx.sets.forEach((handle) => handle.release());
  ctx.sets.clear();
};

// Cartes utilisables du filtre : prix FUTBIN récent (< 5 min) et prix d'achat max calculé.
const futbinCards = (ctx, filter) => {
  const handle = ensureCardSet(ctx, filter);
  if (!handle) {
    return { snap: null, cards: [] };
  }
  const snap = cardSetSnapshot(handle.key, "buy");
  const cap = toInt(filter.maxBuy);
  const cards = snap.cards
    .map((card) => {
      let max = card.price ? floorPrice((card.price * filter.futbinPercent) / 100) : 0;
      if (cap && max > cap) {
        max = floorPrice(cap);
      }
      return Object.assign({}, card, { max });
    })
    .filter((card) => card.max >= 150);
  return { snap, cards };
};

// Tranches de prix : cartes triées par prix max, regroupées tant que l'écart reste sous `ratio`.
export const buildBands = (cards, ratio = DEFAULT_BAND_RATIO) => {
  const bands = [];
  cards
    .slice()
    .sort((a, b) => a.max - b.max)
    .forEach((card) => {
      const last = bands[bands.length - 1];
      if (last && card.max <= last.start * ratio) {
        last.max = card.max;
        last.cards.push(card);
      } else {
        bands.push({ start: card.max, max: card.max, cards: [card] });
      }
    });
  while (bands.length > MAX_BANDS) {
    let best = 0;
    let bestGap = Infinity;
    for (let index = 0; index < bands.length - 1; index += 1) {
      const gap = bands[index + 1].max / bands[index].start;
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
    }
    const merged = {
      start: bands[best].start,
      max: bands[best + 1].max,
      cards: bands[best].cards.concat(bands[best + 1].cards),
    };
    bands.splice(best, 2, merged);
  }
  // Achat min d'une tranche = juste au-dessus de la tranche multi-cartes précédente : les annonces
  // moins chères sont déjà couvertes par elle (une tranche d'une carte ne couvre que sa carte).
  let covered = 0;
  bands.forEach((band) => {
    band.min = band.cards.length > 1 && covered ? priceAbove(covered) : 0;
    if (band.cards.length > 1) {
      covered = band.max;
    }
  });
  return bands;
};

// Achat min d'une tranche de plusieurs cartes : 40 % du plus petit prix max de ses cartes (aucune
// carte suivie n'est vendue en dessous, sauf erreur de prix énorme) et le prix min du filtre s'il est
// plus haut : les cartes bon marché des autres joueurs ne remplissent plus la page de résultats.
// Une tranche d'une seule carte (recherche de cette version exacte) garde son achat min.
const bandFloor = (band, filter) => {
  // Jamais au-dessus du prix max de la tranche (le prix min du filtre peut dépasser une tranche basse).
  const ceiling = priceBelow(band.max) || 0;
  const fromFilter = floorPrice(toInt(filter.minBuy));
  if (band.cards.length === 1) {
    return Math.min(ceiling, Math.max(band.min || 0, fromFilter));
  }
  const lowest = band.cards.reduce((min, card) => Math.min(min, card.max), Infinity);
  const auto = Number.isFinite(lowest) ? floorPrice(Math.floor(lowest * 0.4)) : 0;
  return Math.min(ceiling, Math.max(band.min || 0, auto >= 150 ? auto : 0, fromFilter));
};

// ------------------------------------------------ prix marché EA (une version exacte)
// Mode « prix marché EA » : filtre sur une version exacte (défId), avec ou sans style de chimie.
// FUTBIN ne donne pas le prix des variantes par style : le bot relit lui-même le prix « achat
// immédiat » le plus bas de cette version (et de ce style) sur le marché EA, par recherches exactes
// (comme « Prix min EA ») : avant la première recherche du filtre, quand ce prix a plus de N minutes
// (onglet Achat) et juste après chaque achat du filtre (le marché a bougé). Achat max = X % de ce
// prix (plafonné par le prix d'achat max du filtre), revente un palier sous ce prix. Relevé en échec
// ou sans annonce : filtre ignoré jusqu'au relevé suivant (N minutes plus tard).

const MARKET_SEARCHES = 4;

const marketRefreshMs = () =>
  Math.min(60, Math.max(3, Number(getSettings().buy.marketRefreshMinutes) || 10)) * 60 * 1000;

// Version et style suivis : un filtre modifié pendant le run (autre version, autre style) est relu.
const marketKeyOf = (filter) => `${toInt(filter.definitionId)}:${filter.playStyle > 0 ? filter.playStyle : 0}`;

// Dernier relevé du filtre { price, count, at, key } (null : aucun, ou fait pour une autre version).
const marketEntry = (ctx, filter) => {
  const entry = ctx.marketPrices ? ctx.marketPrices.get(filter.id) : null;
  return entry && entry.key === marketKeyOf(filter) ? entry : null;
};

// Relevé à faire : aucun, ou plus vieux que l'intervalle (qu'il ait réussi ou non).
const marketDue = (ctx, filter) => {
  const entry = marketEntry(ctx, filter);
  return !entry || Date.now() - entry.at >= marketRefreshMs();
};

// Prix marché récent avec au moins une annonce (0 sinon).
const marketPriceOf = (ctx, filter) => {
  const entry = marketEntry(ctx, filter);
  return entry && entry.price > 0 && Date.now() - entry.at < marketRefreshMs() ? entry.price : 0;
};

// Achat d'un filtre prix marché (enchère gagnée, page pleine) : prix relu avant sa prochaine recherche.
const expireMarketPrice = (ctx, filter) => {
  const entry = filter && filter.priceMode === "market" ? marketEntry(ctx, filter) : null;
  if (entry) {
    entry.at = 0;
  }
};

// Revente : un palier sous le prix marché, pour passer avant les autres annonces.
const marketResale = (price) => priceBelow(price) || price;

// Version exacte et, si le filtre en a un, même style de chimie (le prix relevé est celui de ce style).
const matchesMarketTarget = (item, filter) =>
  Number(item && item.definitionId) === filter.definitionId &&
  (!(filter.playStyle > 0) || Number(item.playStyle) === filter.playStyle);

// Plan d'une carte unique : achat max = X % du prix marché (plafonné), revente prévue un palier dessous.
const marketPlan = (filter, price) => {
  const max = percentMaxFor(filter, price);
  return {
    futbin: false,
    market: true,
    marketPrice: price,
    resale: marketResale(price),
    single: null,
    criteriaFilter: filter,
    minBuy: toInt(filter.minBuy),
    maxBuy: max,
    maxFor: () => max,
    valueOf: () => 0,
    member: (item) => matchesMarketTarget(item, filter),
    label: "",
    cardCount: 0,
  };
};

// Filtre utilisable : version exacte, et relevé à faire ou prix récent donnant un achat max valide.
const marketUsable = (ctx, filter) => {
  if (marketDue(ctx, filter)) {
    return true;
  }
  const price = marketPriceOf(ctx, filter);
  return !!price && percentMaxFor(filter, price) >= 150;
};

// Heure du prochain relevé des filtres prix marché en pause (0 : aucun).
const nextMarketRefreshAt = (ctx) =>
  runnableFilters()
    .filter((filter) => filter.priceMode === "market" && filter.definitionId > 0)
    .reduce((next, filter) => {
      const entry = marketEntry(ctx, filter);
      const at = entry ? entry.at + marketRefreshMs() : Date.now();
      return next ? Math.min(next, at) : at;
    }, 0);

// Relevé du prix marché d'un filtre : recherches du marché EA comme celles du bot (compteur de
// requêtes, Stop). Le résultat remplace le précédent, même en échec (filtre en pause jusqu'au relevé
// suivant : un seul avertissement par échec).
const refreshMarketPrice = async (ctx, filter) => {
  const previous = marketEntry(ctx, filter);
  const result = await findLowestBin(filter.definitionId, {
    playStyle: filter.playStyle,
    reference: (previous && previous.price) || toInt(filter.maxBuy) || 0,
    maxSearches: MARKET_SEARCHES,
    token: ctx.token,
    spread: true,
  });
  // Recherches envoyées à EA : comptées aussi pour la pause automatique (toutes les N recherches).
  ctx.searchesSincePause += result.searches || 0;
  // Stop, ou limite de requêtes atteinte (pause automatique de la boucle) : relevé refait ensuite.
  if (ctx.token.cancelled || (!result.ok && usageBlocked())) {
    return;
  }
  const entry = { price: 0, count: 0, at: Date.now(), key: marketKeyOf(filter) };
  ctx.marketPrices.set(filter.id, entry);
  const minutes = Math.round(marketRefreshMs() / 60000);
  if (!result.ok) {
    const error = result.error || {};
    log.warn(t("engine.marketFailed", { name: filter.name, error: error.label || "?", minutes }));
    // Captcha, session expirée, limitation EA… : même traitement qu'une recherche du bot en échec.
    if (error.kind) {
      await handleFailure(ctx, error, "search");
    }
    return;
  }
  ctx.consecutiveFailures = 0;
  // Une ou deux annonces bradées ne font pas le prix du marché (ce sont les affaires à acheter).
  const market = robustMarketPrice(result);
  entry.price = market.price;
  entry.count = market.count;
  if (!market.price) {
    log.warn(t("engine.marketNoListing", { name: filter.name, minutes }));
    return;
  }
  if (market.skipped.length) {
    log.info(
      t("engine.marketOutliers", {
        name: filter.name,
        prices: market.skipped.map((value) => formatCoins(value)).join(", "),
        price: formatCoins(market.price),
      })
    );
  }
  log.info(
    t(result.exact ? "engine.marketPrice" : "engine.marketPriceApprox", {
      name: filter.name,
      price: formatCoins(market.price),
      count: market.count,
      max: formatCoins(percentMaxFor(filter, market.price)),
      resale: formatCoins(marketResale(market.price)),
    })
  );
};

// Onglet Cible : intervalle de relevé et dernier prix marché relevé pendant le run (prix 0 sinon).
export const marketInfoFor = (filter) => {
  const entry = run && filter ? marketEntry(run, filter) : null;
  const price = entry ? entry.price : 0;
  return {
    minutes: Math.round(marketRefreshMs() / 60000),
    price,
    at: entry ? entry.at : 0,
    max: price ? percentMaxFor(filter, price) : 0,
    resale: price ? marketResale(price) : 0,
  };
};

// Page pleine sous l'achat max, ou au moins 3 affaires d'un coup : le prix marché relevé est dépassé
// (marché en baisse) ou faux (annonces au vrai prix prises pour des affaires), aucun achat ; prix
// relu avant la prochaine recherche du filtre.
const MARKET_CROWD = 3;

const marketFullPage = (ctx, filter, plan, count, full) => {
  expireMarketPrice(ctx, filter);
  log.warn(t(full ? "engine.marketFullPage" : "engine.marketCrowded", { filter: filter.name, count, max: formatCoins(plan.maxBuy) }));
};

const planForBand = (filter, cards, bands, index) => {
  const band = bands[index];
  const byId = new Map(cards.map((card) => [card.eaId, card]));
  const single = band.cards.length === 1 ? band.cards[0] : null;
  const lookup = (item) => byId.get(Number(item && item.definitionId)) || null;
  return {
    futbin: true,
    single,
    criteriaFilter: single ? Object.assign({}, filter, { definitionId: single.eaId }) : filter,
    minBuy: bandFloor(band, filter),
    maxBuy: band.max,
    maxFor: (item) => (lookup(item) ? lookup(item).max : 0),
    valueOf: (item) => (lookup(item) ? lookup(item).price : 0),
    member: (item) => !!lookup(item),
    cards,
    label:
      bands.length > 1
        ? single && single.name
          ? t("engine.bandCard", { index: index + 1, total: bands.length, name: single.name })
          : t("engine.band", { index: index + 1, total: bands.length })
        : "",
    cardCount: cards.length,
  };
};

// Plan de la prochaine recherche d'un filtre (null si aucun prix FUTBIN ou marché utilisable).
const planFor = (ctx, filter) => {
  if (filter.priceMode === "market") {
    const price = marketPriceOf(ctx, filter);
    const plan = price ? marketPlan(filter, price) : null;
    return plan && plan.maxBuy >= 150 ? plan : null;
  }
  if (filter.priceMode !== "futbin") {
    const cap = toInt(filter.maxBuy);
    return {
      futbin: false,
      single: null,
      criteriaFilter: filter,
      minBuy: toInt(filter.minBuy),
      maxBuy: cap,
      maxFor: () => cap,
      valueOf: () => 0,
      member: (item) => matchesTarget(item, filter),
      label: "",
      cardCount: 0,
    };
  }
  const { cards } = futbinCards(ctx, filter);
  if (!cards.length) {
    return null;
  }
  const state = ctx.bands.get(filter.id) || { index: -1, ratio: DEFAULT_BAND_RATIO, calm: 0 };
  ctx.bands.set(filter.id, state);
  const bands = buildBands(cards, state.ratio);
  state.index = (state.index + 1) % bands.length;
  return planForBand(filter, cards, bands, state.index);
};

// Enchères possibles pour ce filtre : enchère max fixe, ou % du prix FUTBIN (mode FUTBIN).
const bidsEnabledFor = (filter, settings) =>
  !!settings.bid.enabled && (toInt(filter.maxBid) > 0 || (filter.priceMode === "futbin" && toInt(filter.bidPercent) > 0));

// Enchère max pour une carte : % de son prix FUTBIN (plafonné par l'enchère max fixe si elle est
// renseignée), sinon l'enchère max fixe du filtre. 0 = pas d'enchère sur cette carte.
const bidMaxFor = (filter, plan, item) => {
  const cap = floorPrice(toInt(filter.maxBid));
  if (filter.priceMode === "futbin" && toInt(filter.bidPercent) > 0) {
    const value = plan && typeof plan.valueOf === "function" ? plan.valueOf(item) : 0;
    if (!value) {
      return 0;
    }
    const max = floorPrice((value * filter.bidPercent) / 100);
    return cap ? Math.min(cap, max) : max;
  }
  return cap;
};

// Enchère max envoyée dans la recherche « enchères » : la plus haute des cartes suivies.
const bidSearchCap = (filter, plan) => {
  if (filter.priceMode === "futbin" && toInt(filter.bidPercent) > 0) {
    const cards = (plan && plan.cards) || [];
    const cap = floorPrice(toInt(filter.maxBid));
    const top = cards.reduce((max, card) => Math.max(max, card.price ? floorPrice((card.price * filter.bidPercent) / 100) : 0), 0);
    return cap ? Math.min(cap, top) : top;
  }
  return toInt(filter.maxBid);
};

// Plan « enchères seulement » (pas de prix d'achat immédiat utilisable).
const bidOnlyPlan = (filter) => ({
  futbin: false,
  single: null,
  criteriaFilter: filter,
  minBuy: toInt(filter.minBuy),
  maxBuy: 0,
  maxFor: () => 0,
  valueOf: () => 0,
  member: (item) => (filter.priceMode === "market" ? matchesMarketTarget(item, filter) : matchesTarget(item, filter)),
  label: "",
  cardCount: 0,
});

const releaseTracking = (ctx) => {
  releaseSets(ctx);
  ctx.bands.clear();
  if (ctx.unwatchPrices) {
    ctx.unwatchPrices();
    ctx.unwatchPrices = null;
  }
  if (ctx.unwatchTrail) {
    ctx.unwatchTrail();
    ctx.unwatchTrail = null;
  }
};

// Historique court des prix FUTBIN vus pendant la session : garde-fou « carte en chute » (le prix
// FUTBIN suit le marché avec quelques minutes de retard ; une carte qui baisse vite n'est pas achetée).
const TRAIL_MS = 20 * 60 * 1000;

const pushTrail = (ctx, definitionId, price, now = Date.now()) => {
  const key = Number(definitionId) || 0;
  if (!key || !(price > 0)) {
    return;
  }
  const points = (ctx.trail.get(key) || []).filter((point) => now - point.t <= TRAIL_MS);
  const last = points[points.length - 1];
  if (!last || last.price !== price) {
    points.push({ t: now, price });
  }
  ctx.trail.set(key, points.slice(-40));
};

const watchPriceTrail = (ctx) => {
  ctx.unwatchTrail = onPriceUpdate((definitionId, record) => {
    if (record && record.price && !record.suspect && !ctx.token.cancelled) {
      pushTrail(ctx, definitionId, record.price);
    }
  });
};

// Baisse (en %) du prix courant depuis le plus haut des 20 dernières minutes (0 = pas de baisse).
export const dropFromPeak = (points, current, now = Date.now()) => {
  const peak = (points || []).filter((point) => now - point.t <= TRAIL_MS).reduce((max, point) => Math.max(max, point.price), 0);
  return peak && current > 0 && current < peak ? ((peak - current) / peak) * 100 : 0;
};

const fallingDrop = (ctx, item, value, settings) => {
  const guard = Number(settings.buy.fallingGuard);
  if (!(guard > 0) || !(value > 0)) {
    return 0;
  }
  const drop = dropFromPeak(ctx.trail.get(Number(item && item.definitionId) || 0), value);
  return drop >= guard ? drop : 0;
};

const logFalling = (ctx, item, drop, value) => {
  const key = `falling:${Number(item.definitionId) || 0}:${Math.floor(Date.now() / (5 * 60 * 1000))}`;
  if (!ctx.warned.has(key)) {
    ctx.warned.add(key);
    log.warn(t("engine.fallingSkip", { name: market.nameOf(item), drop: Math.round(drop), price: formatCoins(value) }));
  }
};

// Achat max à X % d'un prix de référence (FUTBIN ou marché EA), plafonné par le prix d'achat max du filtre.
const percentMaxFor = (filter, price) => {
  const cap = toInt(filter.maxBuy);
  const computed = floorPrice((price * filter.futbinPercent) / 100);
  return cap ? Math.min(floorPrice(cap), computed) : computed;
};

// Journal des variations de prix FUTBIN des filtres qui suivent peu de cartes (version, versions).
const watchFutbinPrices = (ctx) => {
  const lastPrices = new Map();
  ctx.unwatchPrices = onPriceUpdate((definitionId, record) => {
    if (!record || ctx.token.cancelled) {
      return;
    }
    const filter = runnableFilters().find((entry) => {
      const handle = entry.priceMode === "futbin" ? ctx.sets.get(entry.id) : null;
      if (!handle || handle.key.startsWith("list:")) {
        return false;
      }
      return cardSetSnapshot(handle.key).cards.some((card) => card.eaId === definitionId);
    });
    if (!filter) {
      return;
    }
    const label =
      filter.definitionId === definitionId
        ? filter.name
        : t("engine.versionLabel", { name: filter.name, id: definitionId });
    if (record.suspect && !ctx.warned.has(`suspect:${definitionId}:${record.suspect.price}`)) {
      ctx.warned.add(`suspect:${definitionId}:${record.suspect.price}`);
      log.warn(t("engine.priceSuspect", { label, price: formatCoins(record.suspect.price) }));
      return;
    }
    const previous = lastPrices.get(definitionId);
    lastPrices.set(definitionId, record.price);
    if (previous && previous !== record.price && record.price) {
      log.info(
        t("engine.priceChanged", {
          label,
          from: formatCoins(previous),
          to: formatCoins(record.price),
          max: formatCoins(percentMaxFor(filter, record.price)),
        })
      );
    }
  });
};

// Choix « holo » du filtre (holo seulement / sans holo), vérifié sur chaque annonce : la recherche EA
// ne trie pas les holo.
const holoAllowed = (item, filter) => !filter.holo || filter.holo === "any" || market.isHoloItem(item) === (filter.holo === "only");

const matchesTarget = (item, filter) => {
  if (filter.definitionId) {
    return Number(item.definitionId) === filter.definitionId;
  }
  if (filter.player && filter.player.id) {
    return market.baseIdOf(item) === filter.player.id;
  }
  return true;
};

const purchaseLimitReached = (settings) => {
  const maxBuys = toInt(settings.buy.stopAfterPurchases);
  return !!(maxBuys && getState().stats.won >= maxBuys);
};

// --------------------------------------------------------------- démarrage

const preflight = () => {
  if (!isAppReady()) {
    return t("engine.preflightNotReady");
  }
  const user = getUser();
  if (!user) {
    return t("engine.preflightLogin");
  }
  // Accès au marché des transferts refusé par EA (compte, console seulement, maintenance).
  const access = tradeAccessProblem(user);
  if (access) {
    return access;
  }
  const task = currentTask();
  if (task) {
    return t("engine.preflightTask", { task: task.label });
  }
  const settings = getSettings();
  const filters = runnableFilters().filter(filterHasTarget);
  if (!filters.length) {
    return t("engine.preflightNoTarget");
  }
  if (filters.some((filter) => filter.priceMode === "futbin" && !cardSetKey(filter))) {
    return t("engine.preflightFutbinTarget");
  }
  // Prix marché EA : relevé pour une version exacte seulement (défId).
  if (filters.some((filter) => filter.priceMode === "market" && !(filter.definitionId > 0))) {
    return t("engine.preflightMarketTarget");
  }
  const usable = filters.filter(
    (filter) =>
      (filter.priceMode === "futbin" ? cardSetKey(filter) : filter.priceMode === "market" || filter.maxBuy) ||
      bidsEnabledFor(filter, settings)
  );
  if (!usable.length) {
    return t("engine.preflightNoPrice");
  }
  if (!parseRange(settings.timing.wait, "S")) {
    return t("engine.preflightWait");
  }
  return null;
};

const tradeAccessProblem = (user) => {
  try {
    if (typeof user.hasTradeAccess !== "function" || user.hasTradeAccess()) {
      return "";
    }
    const levels = pageGlobal("TradeAccessLevel") || {};
    const level = user.tradeAccess;
    if (level === levels.BANNED) {
      return t("engine.tradeBanned");
    }
    if (level === levels.CONSOLE_ONLY) {
      return t("engine.tradeConsoleOnly");
    }
    if (level === levels.MAINTENANCE) {
      return t("engine.tradeMaintenance");
    }
    return t("engine.tradeUnavailable");
  } catch (e) {
    return "";
  }
};

export const startBot = () => {
  if (run) {
    if (run.stopping) {
      log.warn(t("engine.stoppingWait"));
      return false;
    }
    if (run.paused) {
      resumeBot();
    }
    return true;
  }
  unlockAudio();
  const problem = preflight();
  if (problem) {
    log.error(problem);
    updateState({ detail: problem });
    return false;
  }
  const settings = getSettings();
  const stopAfter = pickSeconds(settings.timing.stopAfter, "H");
  const ctx = {
    token: createCancelToken(),
    interrupt: null,
    paused: false,
    stopping: false,
    stopReason: "",
    stopAlert: false,
    manualStop: false,
    attempted: new Set(),
    retries: new Map(),
    bids: new Map(),
    userWatched: new Set(),
    sellQueue: [],
    errorCounts: new Map(),
    searchCount: 0,
    searchesSincePause: 0,
    pauseAfter: safePauseEvery(settings.timing.pauseEvery),
    stopAt: Date.now() + safeSessionMs(stopAfter),
    soldSeen: new Set(),
    soldReady: false,
    lastSummaryAt: Date.now(),
    cycles: 0,
    consecutiveFailures: 0,
    unexpectedErrors: 0,
    cooldowns: 0,
    filterIndex: 0,
    filterSearches: 0,
    currentFilterId: null,
    bidSearchCounter: 0,
    page: 1,
    extraDelay: 0,
    notBefore: 0,
    waitKind: null,
    waitStartedAt: 0,
    transferDirty: true,
    fullStop: false,
    nextWatchCheck: 0,
    lastRelistAt: 0,
    lastClearAt: 0,
    referenceWaitSince: 0,
    relistPending: new Map(),
    sets: new Map(),
    bands: new Map(),
    // Filtres « prix marché EA » : dernier relevé par filtre { price, count, at, key }.
    marketPrices: new Map(),
    unwatchPrices: null,
    unwatchTrail: null,
    trail: new Map(),
    bidsSuspended: false,
    lastRebidAt: 0,
    warned: new Set(),
  };
  run = ctx;
  watchFutbinPrices(ctx);
  watchPriceTrail(ctx);
  resetStats();
  updateState({
    status: STATUS.STARTING,
    detail: "",
    startedAt: Date.now(),
    stoppedAt: 0,
    nextSearchAt: 0,
    pauseUntil: 0,
    coins: getCoins(),
  });
  if (settings.timing.keepAlive) {
    startKeepAlive();
  }
  const filters = runnableFilters().filter(filterHasTarget);
  const target = filters.length > 1 ? t("engine.startedRotation", { n: filters.length }) : describeFilter(filters[0]);
  log.info(
    [
      t("engine.started", { target, wait: settings.timing.wait }),
      ctx.pauseAfter ? t("engine.startedPause", { n: ctx.pauseAfter }) : "",
      ctx.stopAt ? t("engine.startedStop", { duration: formatDuration(ctx.stopAt - Date.now()) }) : "",
    ]
      .filter(Boolean)
      .join(" · ")
  );
  notifyEvent("start", t("engine.notifyStarted", { target }));
  mainLoop(ctx)
    .catch((e) => {
      log.error(t("engine.unexpectedError", { error: errorMessage(e) }));
      ctx.stopReason = ctx.stopReason || t("engine.reasonInternalError");
      ctx.stopAlert = true;
    })
    .finally(() => finalize(ctx));
  return true;
};

export const stopBot = (reason = t("engine.reasonManual"), { alert = false, manual = false } = {}) => {
  const ctx = run;
  if (!ctx) {
    return;
  }
  if (ctx.stopping) {
    // Stop pendant les mises en vente d'après-arrêt : on les interrompt.
    if (ctx.finalToken && !ctx.finalToken.cancelled) {
      ctx.finalToken.cancel();
      log.warn(t("engine.finalListingsInterrupted"));
    }
    return;
  }
  ctx.stopping = true;
  ctx.stopReason = reason;
  ctx.stopAlert = alert;
  ctx.manualStop = manual;
  ctx.token.cancel();
  updateState({ status: STATUS.STOPPING, detail: reason, nextSearchAt: 0, pauseUntil: 0 });
};

export const pauseBot = () => {
  const ctx = run;
  if (!ctx || ctx.paused || ctx.stopping) {
    return;
  }
  ctx.paused = true;
  if (ctx.interrupt) {
    ctx.interrupt.cancel();
  }
  updateState({ status: STATUS.PAUSED, nextSearchAt: 0, pauseUntil: 0 });
  log.info(t("engine.pausedManual"));
};

export const resumeBot = () => {
  const ctx = run;
  if (!ctx || !ctx.paused || ctx.stopping) {
    return;
  }
  ctx.paused = false;
  if (ctx.interrupt) {
    ctx.interrupt.cancel();
  }
  updateState({ status: STATUS.RUNNING });
  log.info(
    ctx.notBefore > Date.now()
      ? t("engine.resumedNext", { seconds: Math.ceil((ctx.notBefore - Date.now()) / 1000) })
      : t("engine.resumed")
  );
};

const finalize = async (ctx) => {
  if (run !== ctx) {
    return;
  }
  stopKeepAlive();
  releaseTracking(ctx);
  // Les cartes achetées juste avant l'arrêt sont quand même traitées (sauf erreur bloquante). Le bot
  // reste « en cours d'arrêt » pendant ce temps : aucun nouveau run ne peut démarrer en parallèle.
  if (ctx.sellQueue.length && !ctx.stopAlert && sessionAlive()) {
    log.info(plural(ctx.sellQueue.length, "engine.finalizeQueueOne", "engine.finalizeQueueMany"));
    const detached = Object.assign({}, ctx, {
      token: createCancelToken(),
      notBefore: 0,
      waitKind: null,
      finalizing: true,
      halted: "",
    });
    ctx.finalToken = detached.token;
    updateState({ status: STATUS.STOPPING, detail: t("engine.detailListingBought") });
    await processSellQueue(detached).catch((e) => log.error(t("engine.finalSaleError", { error: errorMessage(e) })));
    if (detached.halted) {
      ctx.stopAlert = true;
      ctx.stopReason = t("engine.reasonThen", {
        reason: ctx.stopReason || t("engine.reasonStop"),
        then: detached.halted,
      });
    }
  }
  if (ctx.sellQueue.length) {
    log.warn(plural(ctx.sellQueue.length, "engine.unsoldLeftOne", "engine.unsoldLeftMany"));
  }
  run = null;
  const reason = ctx.stopReason || t("engine.reasonStop");
  updateState({
    status: STATUS.STOPPED,
    detail: reason,
    stoppedAt: Date.now(),
    nextSearchAt: 0,
    pauseUntil: 0,
  });
  const summary = sessionSummary();
  if (ctx.stopAlert) {
    log.error(t("engine.stopped", { reason, summary }));
  } else {
    log.info(t("engine.stopped", { reason, summary }));
  }
  if (ctx.manualStop && !ctx.stopAlert) {
    sound("stop");
  } else {
    notifyEvent(ctx.stopAlert ? "alert" : "stop", t("engine.notifyStopped", { reason, summary }), {
      toast: true,
      negative: ctx.stopAlert,
    });
  }
};

// Arrêt demandé par une erreur : pendant les ventes d'après-arrêt, on interrompt seulement ces ventes.
const haltRun = (ctx, reason, options = {}) => {
  if (ctx.finalizing) {
    if (!ctx.halted) {
      ctx.halted = reason;
      log.error(t("engine.finalListingsHalted", { reason }));
    }
    ctx.token.cancel();
    return;
  }
  stopBot(reason, options);
};

// ----------------------------------------------------------- boucle principale

const mainLoop = async (ctx) => {
  try {
    await initialSync(ctx);
  } catch (e) {
    log.warn(t("engine.initialSyncIncomplete", { error: errorMessage(e) }));
  }
  if (ctx.token.cancelled) {
    return;
  }
  if (!ctx.paused) {
    updateState({ status: STATUS.RUNNING });
  }
  while (!ctx.token.cancelled) {
    // Une erreur inattendue ne tue pas le bot : 3 d'affilée provoquent l'arrêt.
    try {
      const searched = await loopStep(ctx);
      if (searched) {
        ctx.unexpectedErrors = 0;
      }
    } catch (e) {
      ctx.unexpectedErrors += 1;
      log.error(t("engine.cycleError", { count: ctx.unexpectedErrors, error: errorMessage(e) }));
      if (ctx.unexpectedErrors >= 3) {
        stopBot(t("engine.reasonRepeatedErrors"), { alert: true });
      } else {
        setNotBefore(ctx, Date.now() + 3000, "wait");
      }
    }
  }
};

// Une étape de la boucle. Renvoie true si une recherche a eu lieu.
const loopStep = async (ctx) => {
  if (ctx.paused) {
    await idle(ctx, 1000);
    return false;
  }
  if (ctx.notBefore > Date.now()) {
    await waitForNextSlot(ctx);
    return false;
  }
  const settings = getSettings();
  const stopReason = checkStopConditions(ctx, settings);
  if (stopReason) {
    stopBot(stopReason);
    return false;
  }
  if (!sessionAlive()) {
    stopBot(t("engine.reasonSessionLost"), { alert: true });
    return false;
  }
  if (ctx.pauseAfter > 0 && ctx.searchesSincePause >= ctx.pauseAfter) {
    await startScheduledPause(ctx, settings);
    return false;
  }
  if (await usagePause(ctx)) {
    return false;
  }
  const pick = nextFilter(ctx, settings);
  if (!pick) {
    handleNoFilter(ctx, settings);
    return false;
  }
  ctx.referenceWaitSince = 0;
  const cycleStart = Date.now();
  await snipeCycle(ctx, pick.filter, settings);
  if (!ctx.token.cancelled) {
    await maintenance(ctx);
  }
  if (!ctx.token.cancelled) {
    setNotBefore(ctx, Date.now() + nextWait(ctx, cycleStart), "wait");
  }
  return true;
};

const waitForNextSlot = async (ctx) => {
  const kind = ctx.waitKind || "wait";
  const status =
    kind === "cooldown" ? STATUS.COOLDOWN : kind === "auto-pause" ? STATUS.AUTO_PAUSE : STATUS.RUNNING;
  const target = ctx.notBefore;
  updateState({
    status,
    nextSearchAt: target,
    waitStartedAt: ctx.waitStartedAt || Date.now(),
    pauseUntil: kind === "wait" ? 0 : target,
  });
  const planned = target - Date.now();
  const from = Date.now();
  const completed = await idle(ctx, planned);
  if (!completed) {
    return;
  }
  const overshoot = Date.now() - from - planned;
  if (kind === "wait" && overshoot > 20000 && !ctx.warned.has("throttle")) {
    ctx.warned.add("throttle");
    log.warn(t("engine.throttled"));
  }
  if (kind === "cooldown") {
    log.info(t("engine.cooldownOver"));
  }
  ctx.waitKind = null;
  updateState({ status: STATUS.RUNNING, nextSearchAt: 0, pauseUntil: 0 });
};

const checkStopConditions = (ctx, settings) => {
  if (ctx.stopAt && Date.now() >= ctx.stopAt) {
    return t("engine.reasonMaxDuration");
  }
  const maxBuys = toInt(settings.buy.stopAfterPurchases);
  if (purchaseLimitReached(settings)) {
    return plural(maxBuys, "engine.reasonPurchaseGoalOne", "engine.reasonPurchaseGoalMany");
  }
  if (ctx.fullStop && settings.transfer.stopWhenFull) {
    return t("engine.reasonPileFull");
  }
  return null;
};

const startScheduledPause = async (ctx, settings) => {
  const seconds = pickSeconds(settings.timing.pauseFor, "S");
  const done = ctx.searchesSincePause;
  ctx.searchesSincePause = 0;
  ctx.pauseAfter = safePauseEvery(settings.timing.pauseEvery);
  // Pause toujours faite (au moins 10 s ; 30–60 s si non réglée).
  const pause = seconds > 0 ? Math.max(SAFETY.minPauseSeconds, seconds) : 30 + Math.random() * 30;
  const until = Date.now() + pause * 1000;
  setNotBefore(ctx, until, "auto-pause");
  if (!ctx.paused) {
    updateState({ status: STATUS.AUTO_PAUSE, pauseUntil: until, nextSearchAt: until, waitStartedAt: Date.now() });
  }
  log.info(t("engine.autoPause", { seconds: Math.round(pause), n: done }));
  // On profite de la pause pour la revente et la liste des transferts.
  await maintenance(ctx, { force: true });
};

// Limite de recherches (compteur Outils) atteinte avec la pause automatique : attente jusqu'à
// repasser sous la limite (les recherches faites à la main comptent aussi).
const usagePause = async (ctx) => {
  const limit = usageBlocked();
  if (!limit) {
    return false;
  }
  const until = Date.now() + usageWaitMs();
  setNotBefore(ctx, until, "auto-pause");
  if (!ctx.paused) {
    updateState({ status: STATUS.AUTO_PAUSE, pauseUntil: until, nextSearchAt: until, waitStartedAt: Date.now() });
  }
  log.warn(
    t(limit.scope === "day" ? "tools.usagePauseDay" : "tools.usagePauseHour", {
      count: limit.count,
      limit: limit.limit,
      minutes: Math.max(1, Math.round((until - Date.now()) / 60000)),
    })
  );
  await maintenance(ctx, { force: true });
  return true;
};

// Filtres réellement exploitables (cible + prix), en rotation si activée.
const nextFilter = (ctx, settings) => {
  const usable = [];
  runnableFilters()
    .filter(filterHasTarget)
    .forEach((filter) => {
      // Prix marché sans version exacte : rien à relever, filtre jamais utilisé (signalé dans Cible).
      if (filter.priceMode === "market" && !(filter.definitionId > 0)) {
        return;
      }
      const bidOn = bidsEnabledFor(filter, settings);
      const priced =
        filter.priceMode === "futbin"
          ? futbinCards(ctx, filter).cards.length > 0
          : filter.priceMode === "market"
          ? marketUsable(ctx, filter)
          : toInt(filter.maxBuy) > 0;
      if (priced || bidOn) {
        usable.push({ filter });
      }
    });
  if (!usable.length) {
    return null;
  }
  const rotation = getRotation();
  if (usable.length > 1 && rotation.enabled) {
    const every = Math.max(1, toInt(rotation.every) || 1);
    if (ctx.filterSearches >= every) {
      ctx.filterSearches = 0;
      if (rotation.random) {
        const choices = usable.map((_, index) => index).filter((i) => i !== ctx.filterIndex % usable.length);
        ctx.filterIndex = choices[Math.floor(Math.random() * choices.length)] || 0;
      } else {
        ctx.filterIndex += 1;
      }
    }
  } else {
    ctx.filterIndex = 0;
  }
  const pick = usable[ctx.filterIndex % usable.length];
  if (pick.filter.id !== ctx.currentFilterId) {
    if (ctx.currentFilterId) {
      log.info(t("engine.nextFilter", { name: pick.filter.name, description: describeFilter(pick.filter) }));
    }
    ctx.currentFilterId = pick.filter.id;
    ctx.page = 1;
    updateState({ filterName: pick.filter.name });
  }
  return pick;
};

const handleNoFilter = (ctx, settings) => {
  // Filtres prix marché en pause (relevé en échec, aucune annonce) : le bot attend leur prochain
  // relevé au lieu de s'arrêter (filtres relus toutes les 5 s, comme l'attente des prix FUTBIN :
  // une modification des filtres est prise en compte tout de suite).
  const marketAt = nextMarketRefreshAt(ctx);
  if (marketAt) {
    const now = Date.now();
    if (!ctx.warned.has(`market-wait:${marketAt}`)) {
      ctx.warned.add(`market-wait:${marketAt}`);
      log.info(t("engine.marketWaiting", { minutes: Math.max(1, Math.ceil((marketAt - now) / 60000)) }));
    }
    setNotBefore(ctx, Math.min(marketAt, now + 5000), "wait");
    return;
  }
  const futbinFilters = runnableFilters()
    .filter(filterHasTarget)
    .filter((filter) => filter.priceMode === "futbin");
  const states = futbinFilters.map((filter) => ({ filter, snap: futbinCards(ctx, filter).snap }));
  const waiting = states.filter(({ snap }) => snap && snap.status !== "empty" && snap.status !== "error");
  if (!waiting.length) {
    const failed = states.find(({ snap }) => snap && snap.message);
    stopBot(
      failed
        ? t("engine.labeled", { name: failed.filter.name, message: failed.snap.message })
        : t("engine.reasonNoFilter"),
      { alert: !!failed }
    );
    return;
  }
  const now = Date.now();
  if (!ctx.referenceWaitSince) {
    ctx.referenceWaitSince = now;
    const list = waiting.find(({ snap }) => snap.kind === "list");
    log.info(list ? t("engine.readingFutbinList", { name: list.filter.name }) : t("engine.waitingFutbinPrice"));
  } else if (now - ctx.referenceWaitSince > REFERENCE_WAIT_MAX) {
    const detail = waiting.map(({ snap }) => snap.message).find(Boolean);
    stopBot(
      detail ? t("engine.reasonFutbinUnavailableDetail", { detail }) : t("engine.reasonFutbinUnavailable"),
      { alert: true }
    );
    return;
  }
  setNotBefore(ctx, now + 5000, "wait");
};

const nextWait = (ctx, cycleStart) => {
  const timing = getSettings().timing;
  const base = Math.max(SAFETY.minWaitMs, (pickSeconds(timing.wait, "S") || 5) * 1000);
  const extra = ctx.extraDelay || 0;
  ctx.extraDelay = 0;
  let target = cycleStart + base + extra;
  const perMinute = toInt(timing.maxPerMinute);
  if (perMinute > 0) {
    target = Math.max(target, cycleStart + 60000 / perMinute);
  }
  return Math.max(SAFETY.minWaitMs / 2, target - Date.now());
};

// ------------------------------------------------------------------- snipe

const snipeCycle = async (ctx, filter, settings) => {
  // Prix marché EA : relu avant la recherche s'il manque ou a plus de N minutes.
  if (filter.priceMode === "market" && filter.definitionId > 0 && marketDue(ctx, filter)) {
    await refreshMarketPrice(ctx, filter);
    // Stop, pause de sécurité (429…) ou limite de requêtes atteinte pendant le relevé : pas de recherche.
    if (blocked(ctx) || usageBlocked()) {
      return;
    }
  }
  const plan = planFor(ctx, filter) || bidOnlyPlan(filter);
  const bidCap = bidSearchCap(filter, plan);
  const bidOn = !ctx.bidsSuspended && bidsEnabledFor(filter, settings) && bidCap >= 150;
  const maxBuy = plan.maxBuy;
  // Prix marché indisponible (relevé en échec, aucune annonce) et pas d'enchère : aucune recherche.
  if (filter.priceMode === "market" && !maxBuy && !bidOn) {
    return;
  }
  // Avec un prix d'achat max, EA ne renvoie que des annonces sous ce prix : les enchères
  // passent donc par une recherche dédiée (toutes les N recherches).
  let bidSearch = false;
  if (bidOn && !maxBuy) {
    bidSearch = true;
  } else if (bidOn) {
    ctx.bidSearchCounter += 1;
    bidSearch = ctx.bidSearchCounter % Math.max(2, toInt(settings.bid.searchEvery) || 3) === 0;
  }
  const searchMaxBuy = bidSearch ? 0 : maxBuy;
  const bust = cacheBusterPrices(settings.timing.cacheBuster, ctx.searchCount, {
    maxBuy: searchMaxBuy,
    minBuy: bidSearch ? toInt(filter.minBuy) : plan.minBuy,
    maxBid: bidSearch ? bidCap : 0,
    cap: settings.timing.cacheBusterMax,
  });
  // Recherche « enchères » en mode FUTBIN : toutes les cartes suivies, pas seulement la tranche.
  const criteria = buildCriteria(bidSearch && plan.futbin ? filter : plan.criteriaFilter, {
    minBuy: bust.minBuy,
    maxBuy: searchMaxBuy,
    maxBid: bidSearch ? bidCap : bust.maxBid,
    minBid: bust.minBid,
    rarityIndex: ctx.searchCount,
  });
  // Mode FUTBIN : toujours la première page d'une tranche serrée (annonces les plus récentes incluses).
  const page = bidSearch || plan.futbin ? 1 : ctx.page || 1;
  const result = await market.searchMarket(criteria, page);
  ctx.searchCount += 1;
  ctx.searchesSincePause += 1;
  ctx.filterSearches += 1;
  recordSearch(result.latency);
  bumpFilterStat(filter.id, "searches");
  if (ctx.token.cancelled) {
    return;
  }
  if (!result.ok) {
    await handleFailure(ctx, result.error || classify(result.response), "search");
    return;
  }
  ctx.consecutiveFailures = 0;
  const items = result.items;
  bumpStat("results", items.length);
  const full = items.length >= market.marketPageSize();
  if (!bidSearch && !plan.futbin) {
    const maxPages = Math.max(1, Math.min(10, toInt(settings.timing.maxPages) || 1));
    ctx.page = items.length > market.marketPageSize() && page < maxPages ? page + 1 : 1;
  }

  const analysis = analyzeResults(ctx, items, filter, plan, settings, bidOn);
  logSearch(filter, items.length, analysis, result.latency, page, plan, bidSearch);
  bumpStat("deals", analysis.deals.length);

  const maxResults = toInt(settings.buy.maxResults);
  if (!bidSearch && maxResults && items.length > maxResults) {
    log.warn(t("engine.tooManyResults", { count: items.length, max: maxResults }));
    return;
  }
  if (!bidSearch && plan.futbin && !adaptBands(ctx, filter, plan, full, items.length)) {
    return;
  }
  if (!bidSearch && plan.market && (full || analysis.deals.length >= MARKET_CROWD)) {
    marketFullPage(ctx, filter, plan, full ? items.length : analysis.deals.length, full);
    return;
  }

  let attempts = 0;
  let bought = 0;
  const perSearch = Math.max(1, toInt(settings.buy.maxPerSearch) || 1);
  for (const deal of analysis.deals) {
    if (attempts >= perSearch || blocked(ctx) || purchaseLimitReached(settings)) {
      break;
    }
    const drop = plan.futbin ? fallingDrop(ctx, deal.item, deal.value, settings) : 0;
    if (drop) {
      ctx.attempted.add(deal.tradeId);
      logFalling(ctx, deal.item, drop, deal.value);
      continue;
    }
    const risk = resaleCheck(deal, filter, plan, analysis.listings, settings);
    if (risk) {
      ctx.attempted.add(deal.tradeId);
      logLossGuard(deal, risk);
      continue;
    }
    // Deuxième achat d'une même recherche : jamais enchaîné (1,5 à 4 s).
    if (attempts > 0) {
      await actionGap(ctx.token);
      if (ctx.token.cancelled) {
        return;
      }
    }
    const coins = getCoins();
    const reserve = toInt(settings.buy.coinsReserve);
    if (coins && coins - reserve < deal.bin) {
      if (!ctx.warned.has(`coins:${deal.tradeId}`)) {
        ctx.warned.add(`coins:${deal.tradeId}`);
        const params = { name: market.nameOf(deal.item), price: formatCoins(deal.bin), coins: formatCoins(coins) };
        log.warn(
          reserve
            ? t("engine.notEnoughCoinsReserve", Object.assign(params, { reserve: formatCoins(reserve) }))
            : t("engine.notEnoughCoins", params)
        );
      }
      continue;
    }
    attempts += 1;
    const outcome = await attemptBuy(ctx, deal, filter, plan);
    if (outcome === "won") {
      bought += 1;
    }
    if (outcome === "fatal") {
      return;
    }
  }
  if (bidOn && analysis.auctions.length && !blocked(ctx) && !purchaseLimitReached(settings)) {
    attempts += await placeBids(ctx, analysis, filter, settings, plan);
  }
  // Achat d'un filtre prix marché : le marché a bougé, prix relu tout de suite (la mise en vente de
  // la carte achetée, juste après ce cycle, l'utilise).
  if (bought && plan.market && !blocked(ctx) && !purchaseLimitReached(settings)) {
    await refreshMarketPrice(ctx, filter);
  }
  if (attempts) {
    ctx.extraDelay = pickSeconds(settings.timing.afterBuy, "S") * 1000;
  }
};

// Page pleine en mode FUTBIN. Recherche d'une carte précise : son prix FUTBIN est au-dessus du
// marché (faux, périmé ou % trop haut) : aucun achat, prix relu. Tranche de plusieurs cartes : les
// annonces récentes peuvent être en page 2, les tranches sont resserrées. Renvoie false = pas d'achat.
const adaptBands = (ctx, filter, plan, full, count) => {
  const state = ctx.bands.get(filter.id);
  if (!full) {
    if (state && state.ratio < DEFAULT_BAND_RATIO && (state.calm += 1) >= 30) {
      state.ratio = Math.min(DEFAULT_BAND_RATIO, state.ratio * 1.1);
      state.calm = 0;
    }
    return true;
  }
  if (plan.single) {
    const warnKey = `futbin-full:${plan.single.eaId}:${plan.maxBuy}`;
    if (!ctx.warned.has(warnKey)) {
      ctx.warned.add(warnKey);
      log.warn(
        t("engine.fullPageSingle", {
          filter: filter.name,
          count,
          card: plan.single.name || t("engine.theCard"),
          max: formatCoins(plan.maxBuy),
        })
      );
      requestPrice(plan.single.eaId, { name: plan.single.name, rating: plan.single.rating });
    }
    return false;
  }
  if (state) {
    const before = state.ratio;
    state.ratio = Math.max(MIN_BAND_RATIO, state.ratio * 0.8);
    state.calm = 0;
    if (state.ratio < before && !ctx.warned.has(`bands:${filter.id}:${state.ratio.toFixed(2)}`)) {
      ctx.warned.add(`bands:${filter.id}:${state.ratio.toFixed(2)}`);
      log.info(
        t("engine.bandsNarrowed", {
          name: filter.name,
          count,
          band: plan.label || t("engine.bandDefault"),
          max: formatCoins(plan.maxBuy),
        })
      );
    }
  }
  return true;
};

const analyzeResults = (ctx, items, filter, plan, settings, bidOn) => {
  const deals = [];
  const auctions = [];
  const counts = { own: 0, seen: 0, other: 0, rating: 0, gk: 0, above: 0 };
  items.forEach((item) => {
    const auction = market.auctionOf(item);
    const tradeId = auction ? String(auction.tradeId || "") : "";
    if (!auction || !tradeId || tradeId === "0") {
      return;
    }
    if (auction.tradeOwner) {
      counts.own += 1;
      return;
    }
    if (!plan.member(item) || !holoAllowed(item, filter)) {
      counts.other += 1;
      return;
    }
    const rating = market.ratingOf(item);
    if ((filter.minRating && rating < filter.minRating) || (filter.maxRating && rating > filter.maxRating)) {
      counts.rating += 1;
      return;
    }
    if (settings.buy.skipGk && market.isGoalkeeper(item)) {
      counts.gk += 1;
      return;
    }
    const bin = toInt(auction.buyNowPrice);
    const max = plan.maxFor(item);
    if (bin && max && bin <= max) {
      if (ctx.attempted.has(tradeId)) {
        counts.seen += 1;
        return;
      }
      deals.push({ item, tradeId, bin, rating, expires: Number(auction.expires) || 0, value: plan.valueOf(item) });
      return;
    }
    counts.above += 1;
    if (bidOn) {
      auctions.push({ item, tradeId, auction, rating, bin });
    }
  });
  // Mode FUTBIN : la plus grosse marge d'abord (prix FUTBIN − prix affiché). Sinon la moins chère ;
  // à égalité, l'annonce la plus récente (plus de chances d'être encore libre).
  deals.sort((a, b) => (plan.futbin ? b.value - b.bin - (a.value - a.bin) : 0) || a.bin - b.bin || b.expires - a.expires);
  return { deals, auctions, counts, listings: listingsByCard(ctx, items) };
};

// Annonces des autres joueurs par version, prix « achat immédiat » croissants : le marché visible
// dans la recherche, pour la vérification anti-perte avant l'achat.
const listingsByCard = (ctx, items) => {
  const byCard = new Map();
  items.forEach((item) => {
    const auction = market.auctionOf(item);
    const tradeId = auction ? String(auction.tradeId || "") : "";
    const bin = auction ? toInt(auction.buyNowPrice) : 0;
    const id = Number(item && item.definitionId) || 0;
    if (!id || !bin || !tradeId || tradeId === "0" || auction.tradeOwner || ctx.attempted.has(tradeId)) {
      return;
    }
    if (!byCard.has(id)) {
      byCard.set(id, []);
    }
    byCard.get(id).push({ tradeId, bin });
  });
  byCard.forEach((list) => list.sort((a, b) => a.bin - b.bin));
  return byCard;
};

// Anti-perte avant l'achat (ou l'enchère) : revente prévue (prix fixe, prix FUTBIN × bas de la plage
// de vente, ou un palier sous le prix marché EA), ramenée juste sous l'annonce la moins chère de la
// même version au-dessus du prix max (les annonces sous le prix max sont des affaires, pas le prix du
// marché). L'achat doit laisser au moins le bénéfice minimum (1 pièce sinon) après la taxe EA.
// null = achat autorisé.
// Seulement quand le bot remet lui-même la carte en vente.
const resaleCheck = (deal, filter, plan, listings, settings) => {
  const sell = settings.sell;
  if (settings.buy.profitCheck === false || sell.mode !== "list") {
    return null;
  }
  if (toInt(sell.maxRating) && deal.rating > toInt(sell.maxRating)) {
    return null;
  }
  const id = Number(deal.item && deal.item.definitionId) || 0;
  let planned = 0;
  if (plan.market) {
    // Prix marché EA : revente un palier sous le prix relevé (le prix de la mise en vente).
    planned = plan.resale;
  } else if (sellModeFor(filter, sell) === "futbin") {
    const reference = plan.valueOf(deal.item) || (id ? currentPrice(id, SELL_PRICE_MAX_AGE, "buy") : 0);
    planned = reference ? roundPrice((reference * percentRange(sellPercentFor(filter, sell)).min) / 100) : 0;
  } else {
    planned = fixedSellPriceFor(filter, sell);
  }
  if (!planned) {
    return null;
  }
  const max = plan.maxFor(deal.item);
  const next = ((listings && listings.get(id)) || []).find(
    (entry) => entry.tradeId !== deal.tradeId && (!max || entry.bin > max)
  );
  let resale = planned;
  if (next) {
    resale = Math.min(planned, priceBelow(next.bin) || next.bin);
  }
  // Bénéfice exigé à l'achat (onglet Achat), sinon celui de la revente : un seuil élevé à l'achat
  // (ex. 1 000) n'empêche pas de revendre plus bas si le marché baisse.
  const need = Math.max(1, toInt(settings.buy.minProfit) || toInt(sell.minProfit));
  const profit = afterTax(resale) - deal.bin;
  if (profit >= need) {
    return null;
  }
  return { resale, profit, need, next: next && resale < planned ? next.bin : 0 };
};

const signedCoins = (value) => `${value >= 0 ? "+" : "−"}${formatCoins(Math.abs(value))}`;

const logLossGuard = (deal, risk, key = "engine.lossGuard") => {
  const params = {
    name: market.nameOf(deal.item),
    rating: deal.rating,
    price: formatCoins(deal.bin),
    resale: formatCoins(risk.resale),
    profit: signedCoins(risk.profit),
    need: formatCoins(risk.need),
    next: formatCoins(risk.next),
  };
  log.warn(t(risk.next ? `${key}Next` : key, params));
  // Annonce du marché sous la revente prévue : prix FUTBIN peut-être dépassé, il est relu.
  if (risk.next && deal.item && deal.item.definitionId) {
    requestPrice(Number(deal.item.definitionId), { name: params.name, rating: deal.rating });
  }
};

// Réglage qui ne peut pas rapporter : achat jusqu'à X % du prix FUTBIN et revente à Y % (bas de la
// plage) = perte après la taxe EA. L'anti-perte bloquera ces achats : on le dit dès le départ.
const warnLosingSetup = (filter) => {
  const settings = getSettings();
  if (settings.buy.profitCheck === false || settings.sell.mode !== "list" || filter.priceMode !== "futbin") {
    return;
  }
  if (sellModeFor(filter, settings.sell) !== "futbin") {
    return;
  }
  const sellMin = percentRange(sellPercentFor(filter, settings.sell)).min;
  const limit = sellMin * (1 - EA_TAX);
  if (filter.futbinPercent < limit) {
    return;
  }
  log.warn(
    t("engine.losingSetup", {
      name: filter.name,
      buy: filter.futbinPercent,
      sell: Math.round(sellMin),
      max: Math.floor(limit),
    })
  );
};

const logSearch = (filter, total, analysis, latency, page, plan, bidSearch) => {
  const { deals, counts } = analysis;
  const extras = [];
  if (counts.own) {
    extras.push(t("engine.searchOwn", { n: counts.own }));
  }
  if (counts.seen) {
    extras.push(t("engine.searchSeen", { n: counts.seen }));
  }
  if (counts.other) {
    extras.push(plural(counts.other, "engine.searchOtherOne", "engine.searchOtherMany"));
  }
  if (counts.rating) {
    extras.push(t("engine.searchRating", { n: counts.rating }));
  }
  if (counts.gk) {
    extras.push(plural(counts.gk, "engine.searchGkOne", "engine.searchGkMany"));
  }
  // Morceaux séparés par « · » (un nom de filtre vide garde son séparateur, comme avant).
  const parts = [];
  if (bidSearch) {
    parts.push(t("engine.searchBids", { name: filter.name }));
  } else if (plan.label) {
    const range = `${plan.minBuy ? `${formatCoins(plan.minBuy)}–` : "≤ "}${formatCoins(plan.maxBuy)}`;
    parts.push(filter.name, `${plan.label} ${range}`);
  } else {
    parts.push(filter.name);
  }
  parts.push(
    plural(total, "engine.searchResultOne", "engine.searchResultMany") +
      (page > 1 ? ` ${t("engine.searchPage", { page })}` : "")
  );
  if (deals.length) {
    parts.push(
      plural(deals.length, "engine.searchDealOne", "engine.searchDealMany") +
        (plan.futbin && plan.cardCount > 1 ? ` ${t("engine.searchDealsFutbin")}` : ` ≤ ${formatCoins(plan.maxBuy)}`)
    );
  }
  if (extras.length) {
    parts.push(extras.join(", "));
  }
  parts.push(`${Math.round(latency)} ms`);
  log.search(parts.join(" · "));
};

const attemptBuy = async (ctx, deal, filter, plan) => {
  const name = market.nameOf(deal.item);
  bumpStat("attempts");
  const result = await market.bidOnItem(deal.item, deal.bin);
  if (result.ok) {
    ctx.attempted.add(deal.tradeId);
    rememberBotItem(deal.item, deal.bin);
    bumpStat("won");
    bumpStat("spent", deal.bin);
    bumpFilterStat(filter.id, "won");
    bumpFilterStat(filter.id, "spent", deal.bin);
    updateState({ coins: getCoins() });
    log.buy(
      t("engine.bought", { name, rating: deal.rating, price: formatCoins(deal.bin), ms: Math.round(result.latency) }),
      { definitionId: deal.item.definitionId }
    );
    recordTransaction({ type: t("engine.txBuy"), name, rating: deal.rating, price: deal.bin, filter: filter.name });
    notifyEvent("buy", t("engine.notifyBought", { name, rating: deal.rating, price: formatCoins(deal.bin) }));
    queueSale(ctx, {
      item: deal.item,
      buyPrice: deal.bin,
      filter,
      name,
      rating: deal.rating,
      marketPrice: plan && plan.market ? plan.marketPrice : 0,
    });
    return "won";
  }
  const error = result.error || classify(result.response);
  if (error.kind === KIND.GONE) {
    ctx.attempted.add(deal.tradeId);
    bumpStat("missed");
    bumpFilterStat(filter.id, "missed");
    log.warn(t("engine.missed", { name, price: formatCoins(deal.bin), code: error.code }));
    recordTransaction({ type: t("engine.txMissed"), name, rating: deal.rating, price: deal.bin, filter: filter.name });
    notifyEvent("fail", t("engine.notifyMissed", { name, rating: deal.rating, price: formatCoins(deal.bin) }));
    return trackStopCode(ctx, error) ? "fatal" : "missed";
  }
  // Erreur passagère : un seul nouvel essai autorisé sur cette annonce.
  const tries = (ctx.retries.get(deal.tradeId) || 0) + 1;
  ctx.retries.set(deal.tradeId, tries);
  if (tries >= 2 || isFatal(error.kind)) {
    ctx.attempted.add(deal.tradeId);
  }
  await handleFailure(ctx, error, "buy", name);
  return ctx.token.cancelled ? "fatal" : "error";
};

// ---------------------------------------------------------------- enchères

const placeBids = async (ctx, analysis, filter, settings, plan) => {
  const auctions = analysis.auctions;
  const window = parseRange(settings.bid.expiresWithin, "M");
  const windowSeconds = window ? window.max : 300;
  const perSearch = Math.max(1, toInt(settings.bid.maxPerSearch) || 1);
  const maxActive = Math.max(1, toInt(settings.bid.maxActive) || 10);
  let placed = 0;
  const sorted = auctions
    .filter((entry) => {
      const expires = Number(entry.auction.expires) || 0;
      return expires > 0 && expires <= windowSeconds;
    })
    .sort((a, b) => (Number(a.auction.expires) || 0) - (Number(b.auction.expires) || 0));
  for (const entry of sorted) {
    if (placed >= perSearch || ctx.bids.size >= maxActive || blocked(ctx)) {
      break;
    }
    if (ctx.userWatched.has(entry.tradeId) || ctx.bids.has(entry.tradeId)) {
      continue;
    }
    const auction = entry.auction;
    const maxBid = bidMaxFor(filter, plan, entry.item);
    if (maxBid < 150) {
      continue;
    }
    const bidDrop = plan.futbin ? fallingDrop(ctx, entry.item, plan.valueOf(entry.item), settings) : 0;
    if (bidDrop) {
      logFalling(ctx, entry.item, bidDrop, plan.valueOf(entry.item));
      continue;
    }
    const current = toInt(auction.currentBid);
    const price = settings.bid.exact
      ? maxBid
      : current
      ? priceAbove(current)
      : Math.max(150, roundPrice(auction.startingBid));
    // Enchère directe au max : jamais sous le prix de départ ni sous le palier suivant (EA : 460).
    const minimum = current ? priceAbove(current) : Math.max(150, roundPrice(auction.startingBid));
    if (!price || price > maxBid || price < minimum || (entry.bin && price >= entry.bin) || (current && price <= current)) {
      continue;
    }
    const bidDeal = { item: entry.item, tradeId: entry.tradeId, bin: price, rating: entry.rating };
    const risk = resaleCheck(bidDeal, filter, plan, analysis.listings, settings);
    if (risk) {
      if (!ctx.warned.has(`bid-guard:${entry.tradeId}`)) {
        ctx.warned.add(`bid-guard:${entry.tradeId}`);
        logLossGuard(bidDeal, risk, "engine.lossGuardBid");
      }
      continue;
    }
    const coins = getCoins();
    if (coins && coins - toInt(settings.buy.coinsReserve) < price) {
      continue;
    }
    if (placed > 0) {
      await actionGap(ctx.token);
      if (ctx.token.cancelled) {
        break;
      }
    }
    placed += 1;
    const name = market.nameOf(entry.item);
    const result = await market.bidOnItem(entry.item, price);
    if (result.ok) {
      bumpStat("bids");
      ctx.bids.set(entry.tradeId, {
        item: entry.item,
        price,
        maxBid,
        filter,
        name,
        rating: entry.rating,
        endsAt: Date.now() + (Number(auction.expires) || 0) * 1000,
        marketPrice: plan.market ? plan.marketPrice : 0,
      });
      log.info(
        t("engine.bidPlaced", {
          name,
          rating: entry.rating,
          price: formatCoins(price),
          seconds: Math.round(Number(auction.expires) || 0),
        })
      );
      continue;
    }
    const error = result.error || classify(result.response);
    if (error.kind === KIND.GONE) {
      log.warn(t("engine.bidRejected", { name }));
      if (trackStopCode(ctx, error)) {
        break;
      }
    } else {
      await handleFailure(ctx, error, "bid", name);
    }
  }
  return placed;
};

const checkBids = async (ctx, force) => {
  if (!ctx.bids.size) {
    return;
  }
  const now = Date.now();
  const dueEnd = Array.from(ctx.bids.values()).some((bid) => bid.endsAt && bid.endsAt <= now);
  if (!force && !dueEnd && now < ctx.nextWatchCheck) {
    return;
  }
  ctx.nextWatchCheck = now + 20000;
  const settings = getSettings();
  const result = await market.fetchWatchList();
  if (!result.ok) {
    await handleFailure(ctx, result.error, "watch");
    return;
  }
  const tracked = [];
  const seen = new Set();
  result.items.forEach((item) => {
    const auction = market.auctionOf(item);
    const tradeId = auction ? String(auction.tradeId) : "";
    if (tradeId && ctx.bids.has(tradeId) && !seen.has(tradeId)) {
      seen.add(tradeId);
      tracked.push(item);
    }
  });
  const active = tracked.filter((item) => safeCall(market.auctionOf(item), "isActiveTrade"));
  if (active.length) {
    const refreshed = await market.refreshAuctions(active);
    if (!refreshed.ok) {
      await handleFailure(ctx, refreshed.error, "watch");
      if (blocked(ctx)) {
        return;
      }
    }
  }
  const release = [];
  for (const item of tracked) {
    if (blocked(ctx)) {
      break;
    }
    const auction = market.auctionOf(item);
    const tradeId = String(auction.tradeId);
    const bid = ctx.bids.get(tradeId);
    if (!bid) {
      continue;
    }
    if (safeCall(auction, "isWon")) {
      ctx.bids.delete(tradeId);
      const price = toInt(auction.currentBid) || bid.price;
      rememberBotItem(item, price);
      bumpStat("bidsWon");
      bumpStat("won");
      bumpStat("spent", price);
      bumpFilterStat(bid.filter.id, "won");
      bumpFilterStat(bid.filter.id, "spent", price);
      log.buy(t("engine.bidWon", { name: bid.name, rating: bid.rating, price: formatCoins(price) }));
      recordTransaction({ type: t("engine.txBidWon"), name: bid.name, rating: bid.rating, price, filter: bid.filter.name });
      notifyEvent("buy", t("engine.notifyBidWon", { name: bid.name, price: formatCoins(price) }));
      queueSale(ctx, { item, buyPrice: price, filter: bid.filter, name: bid.name, rating: bid.rating, marketPrice: bid.marketPrice || 0 });
      // Filtre prix marché : le marché a bougé, prix relu avant la prochaine recherche du filtre.
      expireMarketPrice(ctx, bid.filter);
    } else if (
      safeCall(auction, "isExpired") ||
      (safeCall(auction, "isClosedTrade") && !safeCall(auction, "isWon"))
    ) {
      ctx.bids.delete(tradeId);
      release.push(item);
      log.info(t("engine.bidLost", { name: bid.name }));
    } else if (safeCall(auction, "isOutbid")) {
      const next = priceAbove(toInt(auction.currentBid));
      const maxBid = bid.maxBid || floorPrice(bid.filter.maxBid);
      const coins = getCoins();
      const affordable = !coins || coins - toInt(settings.buy.coinsReserve) >= next;
      if (settings.bid.rebid && !ctx.bidsSuspended && next <= maxBid && affordable) {
        // Deux surenchères ne partent jamais à la suite (1,5 à 2,5 s entre deux).
        if (ctx.lastRebidAt && Date.now() - ctx.lastRebidAt < SAFETY.actionGapMs[0]) {
          await actionGap(ctx.token);
        }
        ctx.lastRebidAt = Date.now();
        const rebid = await market.bidOnItem(item, next);
        if (rebid.ok) {
          bid.price = next;
          bumpStat("bids");
          log.info(t("engine.rebid", { name: bid.name, price: formatCoins(next) }));
        } else if (rebid.error && rebid.error.kind !== KIND.GONE) {
          await handleFailure(ctx, rebid.error, "bid", bid.name);
        }
      } else {
        ctx.bids.delete(tradeId);
        release.push(item);
        log.info(t("engine.outbidGiveUp", { name: bid.name, max: formatCoins(maxBid) }));
      }
    }
  }
  Array.from(ctx.bids.keys()).forEach((tradeId) => {
    const bid = ctx.bids.get(tradeId);
    if (!seen.has(tradeId) && bid && bid.endsAt < now - 60000) {
      ctx.bids.delete(tradeId);
    }
  });
  if (release.length && settings.bid.clearLost && !blocked(ctx)) {
    const cleared = await market.untargetItems(release);
    if (!cleared.ok) {
      await handleFailure(ctx, cleared.error, "watch");
    }
  }
};

// ----------------------------------------------------------------- revente

const sellKey = (job) => Number(job.item && job.item.definitionId) || 0;

// Demande le prix FUTBIN de la version achetée (sauf s'il a moins d'une minute).
const requestSellPrice = (job) => {
  const key = sellKey(job);
  if (!key || currentPrice(key, 60 * 1000, "sell")) {
    return Promise.resolve(null);
  }
  job.requestedAt = Date.now();
  return requestPrice(key, { name: job.name, rating: job.rating });
};

const queueSale = (ctx, job) => {
  const entry = Object.assign({ deferrals: 0, requestedAt: 0, queuedAt: Date.now() }, job);
  ctx.sellQueue.push(entry);
  // Le prix FUTBIN est demandé tout de suite, en arrière-plan, pendant la fin du cycle (sauf carte
  // revendue au prix marché EA).
  const sell = getSettings().sell;
  if (sell.mode === "list" && !entry.marketPrice && sellModeFor(entry.filter, sell) === "futbin") {
    requestSellPrice(entry);
  }
};

const moveToTransferList = async (ctx, job) => {
  if (market.isPileFull("TRANSFER")) {
    log.warn(t("engine.leftUnassigned", { name: job.name }));
    ctx.fullStop = true;
    return;
  }
  const result = await market.moveItem(job.item, "TRANSFER");
  if (result.ok) {
    ctx.transferDirty = true;
    log.info(t("engine.movedToTransfer", { name: job.name }));
    return;
  }
  log.warn(t("engine.moveFailed", { name: job.name, error: result.error.label }));
  if (result.error.kind === KIND.FULL) {
    ctx.fullStop = true;
  } else {
    await handleFailure(ctx, result.error, "move", job.name);
  }
};

// Carte achetée par un filtre prix marché EA : un palier sous le dernier prix marché relevé pour
// cette version (relu juste après l'achat), sinon sous celui du moment de l'achat. null : pas de
// prix marché connu (enchère placée sans prix marché), revente normale.
const marketSellPrice = (ctx, job) => {
  if (!job.filter || job.filter.priceMode !== "market") {
    return null;
  }
  const entry = marketEntry(ctx, job.filter);
  const reference = (entry && entry.price) || toInt(job.marketPrice);
  if (!reference) {
    return null;
  }
  const price = marketResale(reference);
  log.info(t("engine.sellPriceMarket", { name: job.name, reference: formatCoins(reference), price: formatCoins(price) }));
  return { price, reason: "" };
};

// Prix de revente : fixe (filtre ou onglet Vente), % du prix FUTBIN de la version achetée, ou un
// palier sous le prix marché EA (filtres prix marché). Renvoie null tant que le prix FUTBIN n'est
// pas arrivé (la vente est reportée au cycle suivant).
const sellPriceFor = async (ctx, job, sell) => {
  const marketSale = marketSellPrice(ctx, job);
  if (marketSale) {
    return marketSale;
  }
  if (sellModeFor(job.filter, sell) !== "futbin") {
    const price = fixedSellPriceFor(job.filter, sell);
    return { price, reason: price ? "" : t("engine.reasonNoSellPrice") };
  }
  const key = sellKey(job);
  let reference = key ? currentPrice(key, SELL_PRICE_MAX_AGE, "sell") : 0;
  if (!reference && key && ctx.finalizing) {
    // Après l'arrêt il n'y a plus de cycle suivant : on attend la réponse FUTBIN (20 s max).
    await withTimeout(requestSellPrice(job), 20000);
    reference = currentPrice(key, SELL_PRICE_MAX_AGE, "sell");
  }
  if (reference) {
    const { price, percent } = futbinSellPrice(reference, sellPercentFor(job.filter, sell));
    log.info(
      t("engine.sellPriceFutbin", {
        name: job.name,
        reference: formatCoins(reference),
        percent: Math.round(percent),
        price: formatCoins(price),
      })
    );
    return { price, reason: "" };
  }
  const waiting = job.deferrals < MAX_SELL_DEFERRALS || Date.now() - (job.queuedAt || 0) < SELL_PRICE_WAIT;
  if (key && !ctx.finalizing && waiting) {
    if (!job.requestedAt || Date.now() - job.requestedAt > 30000) {
      requestSellPrice(job);
    }
    return null;
  }
  return { price: 0, reason: t("engine.reasonFutbinPrice") };
};

// Renvoie "deferred" si la vente doit être retentée au prochain cycle.
const sellJob = async (ctx, job) => {
  const sell = getSettings().sell;
  if (sell.mode === "none") {
    return "done";
  }
  if (sell.maxRating && job.rating > toInt(sell.maxRating)) {
    log.info(t("engine.keptRating", { name: job.name, rating: job.rating }));
    return "done";
  }
  if (sell.mode === "transfer") {
    await moveToTransferList(ctx, job);
    return "done";
  }
  const plan = await sellPriceFor(ctx, job, sell);
  if (plan === null) {
    return "deferred";
  }
  if (!plan.price) {
    log.warn(t("engine.sentUnlisted", { name: job.name, reason: plan.reason }));
    await moveToTransferList(ctx, job);
    return "done";
  }
  if (market.isPileFull("TRANSFER")) {
    log.warn(t("engine.leftUnassigned", { name: job.name }));
    ctx.fullStop = true;
    return "done";
  }
  let listing = await prepareListing(job.item, plan.price);
  const minProfit = toInt(sell.minProfit);
  // Jamais à perte : le prix FUTBIN relu après l'achat peut avoir baissé. Prix relevé au seuil de
  // rentabilité (prix d'achat + taxe EA + bénéfice min), dans la limite de prix EA de la carte.
  const floor = sell.noLoss !== false ? breakEvenPrice(job.buyPrice, minProfit) : 0;
  if (floor && listing.buyNow < floor) {
    const raised = await prepareListing(job.item, floor);
    if (raised.buyNow < floor) {
      log.warn(t("engine.noLossTooHigh", { name: job.name, floor: formatCoins(floor) }));
      await moveToTransferList(ctx, job);
      return "done";
    }
    log.info(t("engine.noLossRaised", { name: job.name, price: formatCoins(listing.buyNow), floor: formatCoins(raised.buyNow), paid: formatCoins(job.buyPrice) }));
    listing = raised;
  }
  const price = listing.buyNow;
  const profit = profitFor(job.buyPrice, price);
  if (minProfit && profit < minProfit) {
    log.warn(t("engine.profitTooLow", { name: job.name, profit: formatCoins(profit), min: formatCoins(minProfit) }));
    await moveToTransferList(ctx, job);
    return "done";
  }
  const start = listing.start;
  const duration = durationSeconds(sell.duration);
  const result = await market.listOnMarket(job.item, start, price, duration);
  if (result.ok) {
    ctx.transferDirty = true;
    bumpStat("listed");
    bumpStat("estProfit", profit);
    bumpFilterStat(job.filter && job.filter.id, "estProfit", profit);
    log.success(
      t("engine.listed", {
        name: job.name,
        price: formatCoins(price),
        start: formatCoins(start),
        profit: formatCoins(profit),
      })
    );
    recordTransaction({ type: t("engine.txListed"), name: job.name, rating: job.rating, price, profit, filter: job.filter.name });
    notifyEvent(
      "list",
      t("engine.notifyListed", { name: job.name, price: formatCoins(price), profit: formatCoins(profit) })
    );
    return "done";
  }
  const error = result.error || classify(result.response);
  log.error(t("engine.listFailed", { name: job.name, error: error.label }));
  notifyEvent("listfail", t("engine.notifyListFailed", { name: job.name, error: error.label }));
  if (error.kind === KIND.FULL) {
    ctx.fullStop = true;
  } else {
    await handleFailure(ctx, error, "list", job.name, { quiet: true });
  }
  return "done";
};

const processSellQueue = async (ctx) => {
  const jobs = ctx.sellQueue.splice(0);
  const later = [];
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (ctx.token.cancelled || inCooldown(ctx)) {
      later.push(job);
      continue;
    }
    let outcome = "done";
    try {
      outcome = await sellJob(ctx, job);
      if (outcome === "deferred") {
        job.deferrals += 1;
        later.push(job);
      }
    } catch (e) {
      log.error(t("engine.resaleError", { name: job.name, error: errorMessage(e) }));
    }
    // Pause entre deux actions EA seulement (une vente reportée n'a envoyé aucune requête).
    if (outcome !== "deferred" && index < jobs.length - 1 && !ctx.token.cancelled) {
      await sleep(randomBetween(700, 1500), ctx.token);
    }
  }
  ctx.sellQueue.push(...later);
};

// ------------------------------------------------------- liste des transferts

// Ventes repérées pendant la session : bénéfice réel = prix de vente après taxe EA − prix payé
// (lastSalePrice EA, inconnu pour une carte de pack ou une récompense). Les ventes déjà présentes
// au premier contrôle sont mémorisées sans être comptées.
const trackSales = (ctx, items) => {
  const fresh = [];
  items.forEach((item) => {
    const auction = market.auctionOf(item);
    if (!auction || !safeCall(auction, "isSold")) {
      return;
    }
    const key = String(auction.tradeId || item.id || "");
    if (!key || ctx.soldSeen.has(key)) {
      return;
    }
    ctx.soldSeen.add(key);
    if (ctx.soldReady) {
      fresh.push({ item, auction });
    }
  });
  ctx.soldReady = true;
  fresh.forEach(({ item, auction }) => {
    const price = Number(auction.currentBid) || 0;
    const net = afterTax(price);
    const paid = Math.max(0, Number(item.lastSalePrice) || 0);
    const name = market.nameOf(item);
    const rating = Number(item.rating) || 0;
    bumpStat("salesSeen");
    bumpStat("salesValue", net);
    if (paid) {
      const profit = net - paid;
      bumpStat("realProfit", profit);
      bumpStat("salesKnown");
      log.success(t("engine.soldProfit", { name, price: formatCoins(price), paid: formatCoins(paid), profit: signedCoins(profit) }));
      recordTransaction({ type: t("engine.txSold"), name, rating, price, profit, filter: "" });
      notifyEvent("sold", t("engine.notifySoldProfit", { name, price: formatCoins(price), profit: signedCoins(profit) }));
    } else {
      log.success(t("engine.soldUnknown", { name, price: formatCoins(price), net: formatCoins(net) }));
      recordTransaction({ type: t("engine.txSold"), name, rating, price, filter: "" });
      notifyEvent("sold", t("engine.notifySold", { name, price: formatCoins(price) }));
    }
  });
};

// Bilan envoyé toutes les N minutes (Notifications) : recherches, achats, ventes, bénéfice réel.
const sessionSummary = () => {
  const stats = getState().stats;
  const parts = [
    plural(stats.searches, "engine.summarySearchesOne", "engine.summarySearchesMany"),
    plural(stats.won, "engine.summaryBuysOne", "engine.summaryBuysMany"),
    t("engine.summarySpent", { coins: formatCoins(stats.spent) }),
  ];
  if (stats.salesSeen) {
    parts.push(plural(stats.salesSeen, "engine.summarySalesOne", "engine.summarySalesMany"));
  }
  if (stats.salesKnown) {
    parts.push(t("engine.summaryRealProfit", { coins: signedCoins(stats.realProfit) }));
  }
  return parts.join(", ");
};

const periodicSummary = (ctx) => {
  const minutes = toInt(getSettings().notify.summaryMinutes);
  if (!minutes || Date.now() - ctx.lastSummaryAt < minutes * 60 * 1000) {
    return;
  }
  ctx.lastSummaryAt = Date.now();
  const coins = getCoins();
  notifyEvent("summary", t("engine.notifySummary", { summary: sessionSummary(), coins: coins ? formatCoins(coins) : "—" }));
};

const checkTransferList = async (ctx) => {
  const result = await market.fetchTransferList();
  if (!result.ok) {
    await handleFailure(ctx, result.error, "transfer", null, { quiet: true });
    return;
  }
  ctx.transferDirty = false;
  trackSales(ctx, result.items);
  const summary = market.summarizeTransferList(result.items);
  const capacity = market.pileCapacity("TRANSFER");
  updateState({ transfer: Object.assign({ capacity }, summary), coins: getCoins() });
  const settings = getSettings().transfer;
  const now = Date.now();
  if (settings.relistExpired && summary.unsold > 0 && now - ctx.lastRelistAt > RELIST_MIN_GAP && !blocked(ctx)) {
    ctx.lastRelistAt = now;
    if (settings.relistMode === "futbin") {
      await relistAtFutbin(ctx, result.items);
    } else if (settings.relistMode === "market") {
      await relistAtMarket(ctx, result.items);
    } else {
      await relistSamePrice(ctx, summary.unsold);
    }
  }
  const clearAt = toInt(settings.clearSoldAt);
  if (clearAt > 0 && summary.sold >= clearAt && now - ctx.lastClearAt > CLEAR_MIN_GAP && !blocked(ctx)) {
    ctx.lastClearAt = now;
    const cleared = await market.clearSold();
    if (cleared.ok) {
      const earned = afterTax(summary.soldValue);
      bumpStat("soldCount", summary.sold);
      bumpStat("soldValue", earned);
      ctx.transferDirty = true;
      log.success(
        plural(summary.sold, "engine.soldClearedOne", "engine.soldClearedMany", { coins: formatCoins(earned) })
      );
      await market.refreshCoins();
      updateState({ coins: getCoins() });
    } else {
      await handleFailure(ctx, cleared.error, "transfer", null, { quiet: true });
    }
  }
  if (capacity && summary.total >= capacity && !ctx.warned.has("transfer-full")) {
    ctx.warned.add("transfer-full");
    log.warn(t("engine.transferFull", { total: summary.total, capacity }));
  }
};

const relistSamePrice = async (ctx, count) => {
  const relist = await market.relistExpired();
  if (relist.ok) {
    ctx.transferDirty = true;
    ctx.relistPending.clear();
    log.success(plural(count, "engine.relistedSameOne", "engine.relistedSameMany"));
  } else {
    log.warn(t("engine.relistFailed", { error: relist.error.label }));
    await handleFailure(ctx, relist.error, "transfer", null, { quiet: true });
  }
};

// Relist des invendus au prix FUTBIN du moment (% de l'onglet Vente), 5 cartes par passage.
// Une carte sans prix FUTBIN est retentée ; après 3 min sans prix, relist au même prix.
// Seuil de rentabilité d'une remise en vente : toujours pour les cartes achetées par le bot ; pour
// les autres (achetées à la main, packs), seulement si « Jamais à perte » couvre aussi tes cartes.
const relistFloor = (item, sell) => {
  if (sell.noLoss === false || (sell.noLossOwnCards === false && !isBotItem(item))) {
    return 0;
  }
  return breakEvenPrice(Number(item.lastSalePrice) || 0, toInt(sell.minProfit));
};

const stopsMarketRead = (error) =>
  !!error && (isFatal(error.kind) || error.kind === KIND.RATE || error.kind === KIND.BLOCKED);

// Styles de chimie « de base » (joueur, gardien) : sans effet sur le prix, la carte se compare à toutes
// les annonces de sa version. Tout autre style (Ombre, Chasseur…) a son propre prix.
const BASIC_STYLES = [250, 273];
const appliedStyleOf = (item) => {
  const style = Number(item && item.playStyle) || 0;
  return style > 0 && !BASIC_STYLES.includes(style) ? style : 0;
};

// Remise en vente au prix du marché : annonce la moins chère du moment (recherches exactes EA, même
// style de chimie) moins un palier, pour vendre vite ; prix FUTBIN si le marché ne peut pas être lu.
const relistAtMarket = async (ctx, items) => {
  const sell = getSettings().sell;
  const expired = items.filter((item) => safeCall(market.auctionOf(item), "isExpired"));
  const duration = durationSeconds(sell.duration);
  let listed = 0;
  for (const item of expired.slice(0, RELIST_BATCH)) {
    if (blocked(ctx)) {
      break;
    }
    const name = market.nameOf(item);
    const id = Number(item.definitionId) || 0;
    const reference = id ? currentPrice(id, SELL_PRICE_MAX_AGE, "sell") : 0;
    // Carte avec un style de chimie (hors styles de base) : comparée aux annonces de la même variante.
    const style = appliedStyleOf(item);
    const lowest = id ? await findLowestBin(id, { reference, maxSearches: 4, token: ctx.token, playStyle: style, spread: true }) : { ok: false };
    if (ctx.token.cancelled) {
      break;
    }
    if (!lowest.ok && stopsMarketRead(lowest.error)) {
      await handleFailure(ctx, lowest.error, "transfer", name, { quiet: true });
      break;
    }
    let target = 0;
    let shown = 0;
    let key = "engine.relistedMarket";
    if (lowest.ok && lowest.price) {
      // Une ou deux annonces bradées ne font pas le prix : on se place sous le prix de référence.
      const reached = robustMarketPrice(lowest).price || lowest.price;
      target = priceBelow(reached) || reached;
      shown = reached;
    } else if (reference) {
      target = futbinSellPrice(reference, sell.futbinPercent).price;
      shown = reference;
      key = "engine.relisted";
    } else {
      continue;
    }
    const floor = relistFloor(item, sell);
    const listing = await prepareListing(item, floor && target < floor ? floor : target);
    const res = await market.listOnMarket(item, listing.start, listing.buyNow, duration);
    if (!res.ok) {
      log.warn(t("engine.relistItemFailed", { name, error: res.error.label }));
      await handleFailure(ctx, res.error, "list", name, { quiet: true });
      break;
    }
    listed += 1;
    log.success(t(key, { name, price: formatCoins(listing.buyNow), reference: formatCoins(shown) }));
    await sleep(randomBetween(700, 1500), ctx.token);
  }
  if (listed) {
    ctx.transferDirty = true;
  }
  if (expired.length > RELIST_BATCH) {
    ctx.lastRelistAt = Date.now() - RELIST_MIN_GAP + RELIST_RETRY;
  }
};

const relistAtFutbin = async (ctx, items) => {
  const sell = getSettings().sell;
  const now = Date.now();
  const ready = [];
  const pending = [];
  items
    .filter((item) => safeCall(market.auctionOf(item), "isExpired"))
    .forEach((item) => {
      const key = Number(item.definitionId) || 0;
      const reference = key ? currentPrice(key, SELL_PRICE_MAX_AGE, "sell") : 0;
      if (reference) {
        ready.push({ item, reference });
      } else {
        pending.push(item);
      }
    });
  pending.forEach((item) => {
    const id = String(item.id);
    if (!ctx.relistPending.has(id)) {
      ctx.relistPending.set(id, now);
    }
    requestPrice(Number(item.definitionId), { name: market.nameOf(item), rating: market.ratingOf(item) });
  });
  const duration = durationSeconds(sell.duration);
  let listed = 0;
  for (const entry of ready.slice(0, RELIST_BATCH)) {
    if (blocked(ctx)) {
      break;
    }
    const name = market.nameOf(entry.item);
    const { price } = futbinSellPrice(entry.reference, sell.futbinPercent);
    // Jamais sous le prix payé (+ taxe) : prix relevé au seuil de rentabilité.
    const floor = relistFloor(entry.item, sell);
    const listing = await prepareListing(entry.item, floor && price < floor ? floor : price);
    const res = await market.listOnMarket(entry.item, listing.start, listing.buyNow, duration);
    if (res.ok) {
      listed += 1;
      ctx.relistPending.delete(String(entry.item.id));
      log.success(
        t("engine.relisted", { name, price: formatCoins(listing.buyNow), reference: formatCoins(entry.reference) })
      );
    } else {
      log.warn(t("engine.relistItemFailed", { name, error: res.error.label }));
      await handleFailure(ctx, res.error, "list", name, { quiet: true });
      break;
    }
    await sleep(randomBetween(700, 1500), ctx.token);
  }
  if (listed) {
    ctx.transferDirty = true;
  }
  const stale = pending.filter((item) => now - (ctx.relistPending.get(String(item.id)) || now) > RELIST_FALLBACK_AFTER);
  if (stale.length && ready.length <= RELIST_BATCH && !blocked(ctx)) {
    log.warn(plural(stale.length, "engine.relistStaleOne", "engine.relistStaleMany"));
    await relistSamePrice(ctx, pending.length);
    return;
  }
  if (pending.length || ready.length > RELIST_BATCH) {
    // Nouveau passage dans ~90 s (au prochain contrôle de la liste des transferts).
    ctx.lastRelistAt = Date.now() - RELIST_MIN_GAP + RELIST_RETRY;
  }
};

const maintenance = async (ctx, { force = false } = {}) => {
  ctx.cycles += 1;
  if (ctx.sellQueue.length) {
    await processSellQueue(ctx);
  }
  if (blocked(ctx)) {
    return;
  }
  await checkBids(ctx, force);
  if (blocked(ctx)) {
    return;
  }
  const every = Math.max(1, toInt(getSettings().transfer.checkEvery) || 8);
  if (force || ctx.transferDirty || ctx.cycles % every === 0) {
    await checkTransferList(ctx);
  }
  updateState({ coins: getCoins() });
  periodicSummary(ctx);
};

const initialSync = async (ctx) => {
  const settings = getSettings();
  if (settings.bid.enabled) {
    const watched = await market.fetchWatchList();
    if (watched.ok) {
      watched.items.forEach((item) => {
        const auction = market.auctionOf(item);
        if (auction && auction.tradeId) {
          ctx.userWatched.add(String(auction.tradeId));
        }
      });
      if (ctx.userWatched.size) {
        log.info(plural(ctx.userWatched.size, "engine.alreadyWatchedOne", "engine.alreadyWatchedMany"));
      }
    } else {
      await handleFailure(ctx, watched.error, "watch", null, { quiet: true });
    }
  }
  if (ctx.token.cancelled) {
    return;
  }
  await checkTransferList(ctx);
  const futbinFilters = runnableFilters()
    .filter(filterHasTarget)
    .filter((filter) => filter.priceMode === "futbin" && cardSetKey(filter));
  if (!futbinFilters.length || ctx.token.cancelled) {
    return;
  }
  futbinFilters.forEach((filter) => ensureCardSet(ctx, filter));
  // Premiers prix FUTBIN (25 s max) : liste lue, prix des versions suivies.
  const settled = () =>
    futbinFilters.every((filter) => {
      const { snap, cards } = futbinCards(ctx, filter);
      return !snap || snap.status === "error" || snap.status === "empty" || (snap.status === "ready" && !snap.pending);
    });
  const deadline = Date.now() + 25000;
  while (!settled() && Date.now() < deadline && !ctx.token.cancelled) {
    await sleep(300, ctx.token);
  }
  futbinFilters.forEach((filter) => logFutbinCards(ctx, filter));
};

const logFutbinCards = (ctx, filter) => {
  const { snap, cards } = futbinCards(ctx, filter);
  if (!snap) {
    return;
  }
  warnLosingSetup(filter);
  if (!cards.length) {
    log.warn(
      snap.message
        ? t("engine.futbinUnavailableDetail", { name: filter.name, detail: snap.message })
        : t("engine.futbinUnavailable", { name: filter.name })
    );
    return;
  }
  // Plafond (prix d'achat max du filtre) : clés « …Cap » quand il est renseigné.
  const cap = filter.maxBuy ? formatCoins(filter.maxBuy) : "";
  if (cards.length === 1 && snap.kind !== "list") {
    const card = cards[0];
    const record = getPriceRecord(card.eaId);
    const age = record && record.updatedAgoSec != null ? Math.round(record.updatedAgoSec / 60) : null;
    log.info(
      t(filter.maxBuy ? "engine.futbinCardPriceCap" : "engine.futbinCardPrice", {
        name: filter.name,
        price: formatCoins(card.price),
        max: formatCoins(card.max),
        percent: filter.futbinPercent,
        cap,
      }) + (age != null ? ` · ${t("engine.futbinUpdatedAgo", { age })}` : ".")
    );
    return;
  }
  const prices = cards.map((card) => card.price).sort((a, b) => a - b);
  const what =
    snap.kind === "list"
      ? plural(cards.length, "engine.futbinListOne", "engine.futbinListMany") +
        (snap.lastPage > 1 ? ` ${t("engine.futbinListPages", { pages: snap.lastPage })}` : "")
      : t("engine.trackedVersions", { n: cards.length });
  log.info(
    t(filter.maxBuy ? "engine.futbinRangeCap" : "engine.futbinRange", {
      name: filter.name,
      what,
      min: formatCoins(prices[0]),
      max: formatCoins(prices[prices.length - 1]),
      percent: filter.futbinPercent,
      cap,
    })
  );
  if (snap.message) {
    log.warn(`${t("engine.labeled", { name: filter.name, message: snap.message })}.`);
  }
};

// ------------------------------------------------------------------ erreurs

// Codes d'arrêt personnalisés (onglet Timing). Renvoie true si le bot a été arrêté.
const trackStopCode = (ctx, error) => {
  const custom = parseCodeList(getSettings().errors.stopCodes);
  if (!error || !error.code || !custom.has(error.code)) {
    return false;
  }
  const count = (ctx.errorCounts.get(error.code) || 0) + 1;
  ctx.errorCounts.set(error.code, count);
  const limit = Math.max(1, toInt(getSettings().errors.maxConsecutiveFailures) || 3);
  if (count >= limit) {
    haltRun(ctx, plural(count, "engine.reasonStopCodeOne", "engine.reasonStopCodeMany", { code: error.code }), {
      alert: true,
    });
    return true;
  }
  return false;
};

// Libellés des actions en échec (clés de traduction, lues au moment du message).
const LABELS = {
  buy: "engine.whereBuy",
  bid: "engine.whereBid",
  list: "engine.whereList",
  move: "engine.whereMove",
  watch: "engine.whereWatch",
  transfer: "engine.whereTransfer",
};

const handleFailure = async (ctx, error, where, subject, { quiet = false } = {}) => {
  if (!error || ctx.token.cancelled) {
    return;
  }
  bumpStat("errors");
  if (trackStopCode(ctx, error)) {
    return;
  }
  // « Carte : message » quand l'erreur concerne une carte précise.
  const withSubject = (text) => (subject ? t("engine.labeled", { name: subject, message: text }) : text);
  switch (error.kind) {
    case KIND.CAPTCHA:
      haltRun(ctx, t("engine.reasonCaptcha"), { alert: true });
      return;
    case KIND.AUTH:
      haltRun(ctx, t("engine.reasonSessionExpired"), { alert: true });
      return;
    case KIND.BANNED:
      haltRun(ctx, t("engine.reasonBanned"), { alert: true });
      return;
    case KIND.LOCKED:
      haltRun(ctx, t("engine.reasonMarketLocked"), { alert: true });
      return;
    case KIND.RATE:
    case KIND.BLOCKED:
      // Limitation EA pendant une enchère : les enchères (et surenchères) s'arrêtent pour la session,
      // elles multiplient les requêtes ; la recherche « achat immédiat » continue après la pause.
      if ((where === "bid" || where === "watch") && !ctx.bidsSuspended) {
        ctx.bidsSuspended = true;
        log.warn(t("engine.bidsSuspended"));
      }
      if (ctx.finalizing) {
        haltRun(ctx, `${error.label} (${error.code})`, { alert: true });
      } else {
        startCooldown(ctx, error);
      }
      return;
    case KIND.FULL:
      ctx.fullStop = true;
      log.warn(withSubject(`${error.label}.`));
      return;
    case KIND.FUNDS:
      log.warn(withSubject(t("engine.notEnoughCoinsShort")));
      return;
    default:
      break;
  }
  if (where === "search") {
    ctx.consecutiveFailures += 1;
    const limit = Math.max(1, toInt(getSettings().errors.maxConsecutiveFailures) || 3);
    if (ctx.consecutiveFailures >= limit) {
      stopBot(t("engine.reasonSearchFailures", { n: ctx.consecutiveFailures, error: error.label }), { alert: true });
    } else {
      log.warn(t("engine.searchFailed", { error: error.label, count: ctx.consecutiveFailures, limit }));
    }
    return;
  }
  if (!quiet) {
    const what = LABELS[where] ? t(LABELS[where]) : where;
    log.error(withSubject(t("engine.actionFailed", { what, error: error.label })));
  }
};

// Pause de sécurité sur 429 / 512 / 521 : aucune requête avant la fin (même après Pause/Reprise).
const startCooldown = (ctx, error) => {
  if (inCooldown(ctx)) {
    return;
  }
  ctx.cooldowns += 1;
  const settings = getSettings().errors;
  const maxCooldowns = Math.max(0, toInt(settings.maxCooldowns));
  if (ctx.cooldowns > maxCooldowns) {
    stopBot(t("engine.reasonRateLimited", { code: error.code }), { alert: true });
    return;
  }
  const seconds = pickSeconds(settings.cooldown, "M") || 300;
  const until = Date.now() + seconds * 1000;
  setNotBefore(ctx, until, "cooldown");
  log.warn(
    t("engine.cooldownStarted", {
      error: error.label,
      code: error.code,
      duration: seconds >= 90 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)} s`,
      count: ctx.cooldowns,
      max: maxCooldowns,
    })
  );
  notifyEvent("fail", t("engine.notifyCooldown", { error: error.label, code: error.code }));
  if (!ctx.paused) {
    updateState({ status: STATUS.COOLDOWN, pauseUntil: until, nextSearchAt: until, waitStartedAt: Date.now() });
  }
};

// --------------------------------------------------------- recherche de test

// Une recherche unique, sans achat, pour vérifier un filtre et voir les prix du marché.
export const previewSearch = async (filter) => {
  if (run) {
    return { ok: false, message: t("engine.previewStopBot") };
  }
  if (!isAppReady() || !getUser()) {
    return { ok: false, message: t("engine.previewLogin") };
  }
  const temp = { sets: new Map(), bands: new Map() };
  try {
    let plan;
    if (filter.priceMode === "futbin") {
      if (!cardSetKey(filter)) {
        return { ok: false, message: t("engine.previewFutbinTarget") };
      }
      const deadline = Date.now() + 20000;
      let info = futbinCards(temp, filter);
      while (!info.cards.length && Date.now() < deadline && !(info.snap && /error|empty/.test(info.snap.status))) {
        await sleep(300);
        info = futbinCards(temp, filter);
      }
      if (!info.cards.length) {
        const detail = info.snap && info.snap.message;
        return {
          ok: false,
          message: detail
            ? t("engine.previewFutbinUnavailableDetail", { detail })
            : t("engine.previewFutbinUnavailable"),
        };
      }
      // Tranche la plus fournie : aperçu représentatif du filtre.
      const bands = buildBands(info.cards);
      const index = bands.reduce((best, band, i) => (band.cards.length > bands[best].cards.length ? i : best), 0);
      plan = planForBand(filter, info.cards, bands, index);
    } else if (filter.priceMode === "market") {
      // Prix marché relevé comme pendant le bot, puis recherche sous l'achat max qui en découle.
      if (!(filter.definitionId > 0)) {
        return { ok: false, message: t("engine.previewMarketTarget") };
      }
      const lowest = await findLowestBin(filter.definitionId, {
        playStyle: filter.playStyle,
        reference: toInt(filter.maxBuy),
        maxSearches: MARKET_SEARCHES,
      });
      if (!lowest.ok) {
        const error = lowest.error || {};
        return { ok: false, message: t("engine.previewRejected", { error: error.label || "?", code: error.code || "?" }) };
      }
      if (!lowest.price) {
        return { ok: false, message: t("engine.previewMarketNone") };
      }
      plan = marketPlan(filter, lowest.price);
    } else {
      plan = planFor(temp, filter);
    }
    const criteria = buildCriteria(plan.criteriaFilter, { minBuy: plan.minBuy, maxBuy: plan.maxBuy });
    const result = await market.searchMarket(criteria, 1);
    if (!result.ok) {
      return {
        ok: false,
        message: t("engine.previewRejected", { error: result.error.label, code: result.error.code }),
      };
    }
    const rows = result.items
      .map((item) => {
        const auction = market.auctionOf(item) || {};
        return {
          name: market.nameOf(item),
          rating: market.ratingOf(item),
          definitionId: Number(item.definitionId) || 0,
          bin: toInt(auction.buyNowPrice),
          bid: toInt(auction.currentBid) || toInt(auction.startingBid),
          expires: Number(auction.expires) || 0,
          own: !!auction.tradeOwner,
          match: plan.member(item) && holoAllowed(item, filter),
          max: plan.maxFor(item),
          futbin: plan.valueOf(item),
        };
      })
      .sort((a, b) => a.bin - b.bin);
    return {
      ok: true,
      rows,
      latency: result.latency,
      maxBuy: plan.maxBuy,
      minBuy: plan.minBuy,
      label: plan.label,
      cardCount: plan.cardCount,
      futbinPrice: plan.single ? plan.single.price : 0,
      marketPrice: plan.market ? plan.marketPrice : 0,
    };
  } finally {
    releaseSets(temp);
  }
};
