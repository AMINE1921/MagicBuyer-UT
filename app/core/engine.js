import { startKeepAlive, stopKeepAlive, unlockAudio } from "./audio";
import { createCancelToken, sleep, withTimeout } from "./async";
import { KIND, classify, isFatal, parseCodeList } from "./errors";
import {
  buildCriteria,
  cacheBusterPrices,
  describeFilter,
  filterHasTarget,
  futbinKeyForFilter,
  getRotation,
  runnableFilters,
} from "./filters";
import { errorMessage, log } from "./logger";
import * as market from "./market";
import { notifyEvent, sound } from "./notify";
import { getCoins, getUser, isAppReady, itemService } from "./page";
import {
  durationSeconds,
  fixedSellPriceFor,
  futbinSellPrice,
  prepareListing,
  sellModeFor,
  sellPercentFor,
} from "./listing";
import { afterTax, floorPrice, formatCoins, priceAbove, profitFor, roundPrice, toInt } from "./prices";
import { formatDuration, parseRange, pickInt, pickSeconds, randomBetween } from "./ranges";
import { currentPrice, getPriceRecord, onPriceUpdate, requestPrice, trackPrice } from "../prices/priceService";
import { getSettings } from "./settings";
import { currentTask } from "./tasks";
import {
  STATUS,
  bumpStat,
  getState,
  recordSearch,
  recordTransaction,
  resetStats,
  updateState,
} from "./state";

const RELIST_MIN_GAP = 5 * 60 * 1000;
const CLEAR_MIN_GAP = 60 * 1000;
const REFERENCE_WAIT_MAX = 2 * 60 * 1000;
const MAX_SELL_DEFERRALS = 6;
// Attente maximale du prix FUTBIN d'une carte achetée avant de l'envoyer non listée en liste des transferts.
const SELL_PRICE_WAIT = 90 * 1000;
// Âge maximal d'un prix FUTBIN utilisable : achat 5 min (rafraîchi toutes les ≤ 2 min), vente 10 min.
const BUY_PRICE_MAX_AGE = 5 * 60 * 1000;
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

const futbinHint = (filter) => ({
  name: filter.player ? filter.player.name : "",
  rating: filter.player ? filter.player.rating : 0,
});

// Prix d'achat max effectif : fixe, ou X % du prix FUTBIN (plafonné par le prix fixe s'il existe).
// En mode FUTBIN, sans prix récent (< 5 min) le filtre attend : jamais d'achat sur un prix périmé.
const effectiveMaxBuy = (filter) => {
  const cap = toInt(filter.maxBuy);
  if (filter.priceMode !== "futbin") {
    return cap;
  }
  const key = futbinKeyForFilter(filter);
  const reference = key ? currentPrice(key, BUY_PRICE_MAX_AGE, "buy") : 0;
  if (!reference) {
    return 0;
  }
  const computed = floorPrice((reference * filter.futbinPercent) / 100);
  return cap ? Math.min(cap, computed) : computed;
};

const referencePending = (filter) =>
  filter.priceMode === "futbin" && !!futbinKeyForFilter(filter) && !effectiveMaxBuy(filter);

// Suivi "prioritaire" (≤ 2 min) des prix FUTBIN utilisés par le bot pendant qu'il tourne.
const trackHot = (ctx, key, hint) => {
  if (!key || ctx.tracked.has(key)) {
    return;
  }
  ctx.tracked.set(key, trackPrice(key, hint, "hot"));
};

const releaseTracking = (ctx) => {
  ctx.tracked.forEach((untrack) => untrack());
  ctx.tracked.clear();
  if (ctx.unwatchPrices) {
    ctx.unwatchPrices();
    ctx.unwatchPrices = null;
  }
};

// Journal des variations de prix FUTBIN des cibles du bot (achat max recalculé à chaque mise à jour).
const watchFutbinPrices = (ctx) => {
  const lastPrices = new Map();
  ctx.unwatchPrices = onPriceUpdate((definitionId, record) => {
    if (!record || !ctx.tracked.has(definitionId) || ctx.token.cancelled) {
      return;
    }
    const filter = runnableFilters().find(
      (entry) => entry.priceMode === "futbin" && futbinKeyForFilter(entry) === definitionId
    );
    if (!filter) {
      return;
    }
    if (record.suspect && !ctx.warned.has(`suspect:${definitionId}:${record.suspect.price}`)) {
      ctx.warned.add(`suspect:${definitionId}:${record.suspect.price}`);
      log.warn(
        `Prix FUTBIN ${filter.name} : saut anormal à ${formatCoins(record.suspect.price)}, ancien prix gardé en attendant une confirmation.`
      );
      return;
    }
    const previous = lastPrices.get(definitionId);
    lastPrices.set(definitionId, record.price);
    if (previous && previous !== record.price && record.price) {
      log.info(
        `Prix FUTBIN ${filter.name} : ${formatCoins(previous)} → ${formatCoins(record.price)} · achat max ${formatCoins(effectiveMaxBuy(filter))}.`
      );
    }
  });
};

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
    return "Le web app EA n'est pas encore prêt : attends la page d'accueil puis réessaie.";
  }
  if (!getUser()) {
    return "Connecte-toi au web app EA avant de démarrer.";
  }
  const task = currentTask();
  if (task) {
    return `Une tâche est en cours (${task.label}) : attends la fin ou arrête-la avant de démarrer le bot.`;
  }
  const settings = getSettings();
  const filters = runnableFilters().filter(filterHasTarget);
  if (!filters.length) {
    return "Choisis un joueur (ou au moins un critère : qualité, rareté, note…) dans l'onglet Cible.";
  }
  if (filters.some((filter) => filter.priceMode === "futbin" && !futbinKeyForFilter(filter))) {
    return "Mode « % du prix FUTBIN » : choisis un joueur ou un ID de version exacte (le prix FUTBIN est celui de cette carte).";
  }
  const usable = filters.filter(
    (filter) =>
      (filter.priceMode === "futbin" ? futbinKeyForFilter(filter) : filter.maxBuy) ||
      (settings.bid.enabled && filter.maxBid)
  );
  if (!usable.length) {
    return "Indique un « Prix d'achat max » ou choisis le mode « % du prix FUTBIN » (avec un joueur) pour ta cible.";
  }
  if (!parseRange(settings.timing.wait, "S")) {
    return "Le temps entre recherches est invalide (exemple : 5-9).";
  }
  return null;
};

export const startBot = () => {
  if (run) {
    if (run.stopping) {
      log.warn("Arrêt en cours (mises en vente des dernières cartes) : attends la fin ou clique sur Stop.");
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
    pauseAfter: pickInt(settings.timing.pauseEvery),
    stopAt: stopAfter > 0 ? Date.now() + stopAfter * 1000 : 0,
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
    tracked: new Map(),
    unwatchPrices: null,
    warned: new Set(),
  };
  run = ctx;
  watchFutbinPrices(ctx);
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
  log.info(
    `Bot démarré · ${filters.length > 1 ? `${filters.length} filtres en rotation` : describeFilter(filters[0])}` +
      ` · attente ${settings.timing.wait} s` +
      (ctx.pauseAfter ? ` · pause toutes les ~${ctx.pauseAfter} recherches` : "") +
      (ctx.stopAt ? ` · arrêt dans ${formatDuration(ctx.stopAt - Date.now())}` : "")
  );
  mainLoop(ctx)
    .catch((e) => {
      log.error(`Erreur inattendue du moteur : ${errorMessage(e)}`);
      ctx.stopReason = ctx.stopReason || "erreur interne";
      ctx.stopAlert = true;
    })
    .finally(() => finalize(ctx));
  return true;
};

export const stopBot = (reason = "arrêt manuel", { alert = false, manual = false } = {}) => {
  const ctx = run;
  if (!ctx) {
    return;
  }
  if (ctx.stopping) {
    // Stop pendant les mises en vente d'après-arrêt : on les interrompt.
    if (ctx.finalToken && !ctx.finalToken.cancelled) {
      ctx.finalToken.cancel();
      log.warn("Mises en vente d'après-arrêt interrompues.");
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
  log.info("Pause manuelle : clique sur Reprendre pour continuer.");
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
      ? `Reprise du bot (prochaine recherche dans ${Math.ceil((ctx.notBefore - Date.now()) / 1000)} s).`
      : "Reprise du bot."
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
    log.info(`Traitement de ${ctx.sellQueue.length} carte(s) achetée(s) en attente… (Stop pour interrompre)`);
    const detached = Object.assign({}, ctx, {
      token: createCancelToken(),
      notBefore: 0,
      waitKind: null,
      finalizing: true,
      halted: "",
    });
    ctx.finalToken = detached.token;
    updateState({ status: STATUS.STOPPING, detail: "mise en vente des cartes achetées" });
    await processSellQueue(detached).catch((e) => log.error(`Vente après arrêt : ${errorMessage(e)}`));
    if (detached.halted) {
      ctx.stopAlert = true;
      ctx.stopReason = `${ctx.stopReason || "arrêt"} puis ${detached.halted}`;
    }
  }
  if (ctx.sellQueue.length) {
    log.warn(`${ctx.sellQueue.length} carte(s) achetée(s) non mise(s) en vente : elles sont dans tes non attribués.`);
  }
  run = null;
  const reason = ctx.stopReason || "arrêt";
  const stats = getState().stats;
  updateState({
    status: STATUS.STOPPED,
    detail: reason,
    stoppedAt: Date.now(),
    nextSearchAt: 0,
    pauseUntil: 0,
  });
  const summary = `${stats.searches} recherche(s), ${stats.won} achat(s), ${formatCoins(stats.spent)} dépensés`;
  if (ctx.stopAlert) {
    log.error(`Bot arrêté : ${reason} · ${summary}`);
  } else {
    log.info(`Bot arrêté : ${reason} · ${summary}`);
  }
  if (ctx.manualStop && !ctx.stopAlert) {
    sound("stop");
  } else {
    notifyEvent(ctx.stopAlert ? "alert" : "stop", `⏹ MagicBuyer arrêté : ${reason} (${summary})`, {
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
      log.error(`Mises en vente d'après-arrêt interrompues : ${reason}.`);
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
    log.warn(`Synchronisation initiale incomplète : ${errorMessage(e)}`);
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
      log.error(`Erreur pendant le cycle (${ctx.unexpectedErrors}/3) : ${errorMessage(e)}`);
      if (ctx.unexpectedErrors >= 3) {
        stopBot("erreurs internes répétées", { alert: true });
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
    stopBot("session EA déconnectée", { alert: true });
    return false;
  }
  if (ctx.pauseAfter > 0 && ctx.searchesSincePause >= ctx.pauseAfter) {
    await startScheduledPause(ctx, settings);
    return false;
  }
  const pick = nextFilter(ctx, settings);
  if (!pick) {
    handleNoFilter(ctx, settings);
    return false;
  }
  ctx.referenceWaitSince = 0;
  const cycleStart = Date.now();
  await snipeCycle(ctx, pick.filter, pick.maxBuy, settings);
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
    log.warn(
      "Chrome a ralenti cet onglet (onglet en arrière-plan) : garde le web app visible ou active « Garder l'onglet actif » dans Timing."
    );
  }
  if (kind === "cooldown") {
    log.info("Fin de la pause de sécurité, reprise des recherches.");
  }
  ctx.waitKind = null;
  updateState({ status: STATUS.RUNNING, nextSearchAt: 0, pauseUntil: 0 });
};

const checkStopConditions = (ctx, settings) => {
  if (ctx.stopAt && Date.now() >= ctx.stopAt) {
    return "durée maximale atteinte";
  }
  const maxBuys = toInt(settings.buy.stopAfterPurchases);
  if (purchaseLimitReached(settings)) {
    return `objectif de ${maxBuys} achat(s) atteint`;
  }
  if (ctx.fullStop && settings.transfer.stopWhenFull) {
    return "liste des transferts ou non attribués pleine";
  }
  return null;
};

const startScheduledPause = async (ctx, settings) => {
  const seconds = pickSeconds(settings.timing.pauseFor, "S");
  const done = ctx.searchesSincePause;
  ctx.searchesSincePause = 0;
  ctx.pauseAfter = pickInt(settings.timing.pauseEvery);
  if (!(seconds > 0)) {
    return;
  }
  const until = Date.now() + seconds * 1000;
  setNotBefore(ctx, until, "auto-pause");
  if (!ctx.paused) {
    updateState({ status: STATUS.AUTO_PAUSE, pauseUntil: until, nextSearchAt: until, waitStartedAt: Date.now() });
  }
  log.info(`Pause automatique de ${Math.round(seconds)} s après ${done} recherches.`);
  // On profite de la pause pour la revente et la liste des transferts.
  await maintenance(ctx, { force: true });
};

// Filtres réellement exploitables (cible + prix), en rotation si activée.
const nextFilter = (ctx, settings) => {
  const usable = [];
  runnableFilters()
    .filter(filterHasTarget)
    .forEach((filter) => {
      if (filter.priceMode === "futbin") {
        trackHot(ctx, futbinKeyForFilter(filter), futbinHint(filter));
      }
      const maxBuy = effectiveMaxBuy(filter);
      const bidOn = settings.bid.enabled && toInt(filter.maxBid) > 0;
      if (maxBuy || bidOn) {
        usable.push({ filter, maxBuy });
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
      log.info(`Filtre suivant : ${pick.filter.name} (${describeFilter(pick.filter)})`);
    }
    ctx.currentFilterId = pick.filter.id;
    ctx.page = 1;
    updateState({ filterName: pick.filter.name });
  }
  return pick;
};

const handleNoFilter = (ctx, settings) => {
  const waiting = runnableFilters()
    .filter(filterHasTarget)
    .some((filter) => referencePending(filter));
  if (!waiting) {
    stopBot("aucun filtre exploitable (joueur/critère ou prix d'achat max manquant)");
    return;
  }
  const now = Date.now();
  if (!ctx.referenceWaitSince) {
    ctx.referenceWaitSince = now;
    log.info("En attente du prix FUTBIN pour calculer le prix d'achat max…");
  } else if (now - ctx.referenceWaitSince > REFERENCE_WAIT_MAX) {
    stopBot("prix FUTBIN indisponible depuis 2 min (onglet FUTBIN pour le diagnostic)", { alert: true });
    return;
  }
  setNotBefore(ctx, now + 5000, "wait");
};

const nextWait = (ctx, cycleStart) => {
  const timing = getSettings().timing;
  const base = (pickSeconds(timing.wait, "S") || 5) * 1000;
  const extra = ctx.extraDelay || 0;
  ctx.extraDelay = 0;
  let target = cycleStart + base + extra;
  const perMinute = toInt(timing.maxPerMinute);
  if (perMinute > 0) {
    target = Math.max(target, cycleStart + 60000 / perMinute);
  }
  return Math.max(100, target - Date.now());
};

// ------------------------------------------------------------------- snipe

const snipeCycle = async (ctx, filter, maxBuy, settings) => {
  const bidOn = settings.bid.enabled && toInt(filter.maxBid) > 0;
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
    minBuy: toInt(filter.minBuy),
    maxBid: bidSearch ? toInt(filter.maxBid) : 0,
    cap: settings.timing.cacheBusterMax,
  });
  const criteria = buildCriteria(filter, {
    minBuy: bust.minBuy,
    maxBuy: searchMaxBuy,
    maxBid: bidSearch ? toInt(filter.maxBid) : bust.maxBid,
    minBid: bust.minBid,
  });
  const page = bidSearch ? 1 : ctx.page || 1;
  const result = await market.searchMarket(criteria, page);
  ctx.searchCount += 1;
  ctx.searchesSincePause += 1;
  ctx.filterSearches += 1;
  recordSearch(result.latency);
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
  if (!bidSearch) {
    const maxPages = Math.max(1, Math.min(10, toInt(settings.timing.maxPages) || 1));
    ctx.page = items.length > market.marketPageSize() && page < maxPages ? page + 1 : 1;
  }

  const analysis = analyzeResults(ctx, items, filter, maxBuy, settings, bidOn);
  logSearch(filter, items.length, analysis, result.latency, page, maxBuy, bidSearch);
  bumpStat("deals", analysis.deals.length);

  const maxResults = toInt(settings.buy.maxResults);
  if (!bidSearch && maxResults && items.length > maxResults) {
    log.warn(
      `${items.length} résultats (seuil ${maxResults}) : achats ignorés, ton prix max est peut-être au-dessus du marché.`
    );
    return;
  }
  // Mode FUTBIN : une page entière d'annonces sous le prix max veut dire que ce prix est au-dessus du
  // marché (prix FUTBIN faux ou périmé, pourcentage trop haut) : aucun achat et relecture du prix.
  if (!bidSearch && filter.priceMode === "futbin" && items.length >= market.marketPageSize()) {
    const warnKey = `futbin-full:${filter.id}:${maxBuy}`;
    if (!ctx.warned.has(warnKey)) {
      ctx.warned.add(warnKey);
      log.warn(
        `${filter.name} : ${items.length} annonces sous ${formatCoins(maxBuy)} (page pleine) : prix FUTBIN au-dessus du marché (périmé ou % trop haut), aucun achat. Baisse le % ou fixe un plafond.`
      );
      requestPrice(futbinKeyForFilter(filter), futbinHint(filter));
    }
    return;
  }

  let attempts = 0;
  const perSearch = Math.max(1, toInt(settings.buy.maxPerSearch) || 1);
  for (const deal of analysis.deals) {
    if (attempts >= perSearch || blocked(ctx) || purchaseLimitReached(settings)) {
      break;
    }
    const coins = getCoins();
    const reserve = toInt(settings.buy.coinsReserve);
    if (coins && coins - reserve < deal.bin) {
      if (!ctx.warned.has(`coins:${deal.tradeId}`)) {
        ctx.warned.add(`coins:${deal.tradeId}`);
        log.warn(
          `${market.nameOf(deal.item)} à ${formatCoins(deal.bin)} : coins insuffisants (${formatCoins(coins)}${reserve ? `, réserve ${formatCoins(reserve)}` : ""}).`
        );
      }
      continue;
    }
    attempts += 1;
    const outcome = await attemptBuy(ctx, deal, filter);
    if (outcome === "fatal") {
      return;
    }
  }
  if (bidOn && analysis.auctions.length && !blocked(ctx) && !purchaseLimitReached(settings)) {
    attempts += await placeBids(ctx, analysis.auctions, filter, settings);
  }
  if (attempts) {
    ctx.extraDelay = pickSeconds(settings.timing.afterBuy, "S") * 1000;
  }
};

const analyzeResults = (ctx, items, filter, maxBuy, settings, bidOn) => {
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
    if (!matchesTarget(item, filter)) {
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
    if (bin && maxBuy && bin <= maxBuy) {
      if (ctx.attempted.has(tradeId)) {
        counts.seen += 1;
        return;
      }
      deals.push({ item, tradeId, bin, rating, expires: Number(auction.expires) || 0 });
      return;
    }
    counts.above += 1;
    if (bidOn) {
      auctions.push({ item, tradeId, auction, rating, bin });
    }
  });
  // Le moins cher d'abord ; à prix égal, l'annonce la plus récente (plus de chances d'être libre).
  deals.sort((a, b) => a.bin - b.bin || b.expires - a.expires);
  return { deals, auctions, counts };
};

const logSearch = (filter, total, analysis, latency, page, maxBuy, bidSearch) => {
  const { deals, counts } = analysis;
  const extras = [];
  if (counts.own) {
    extras.push(`${counts.own} à toi`);
  }
  if (counts.seen) {
    extras.push(`${counts.seen} déjà tentée(s)`);
  }
  if (counts.other) {
    extras.push(`${counts.other} autre(s) carte(s)`);
  }
  if (counts.rating) {
    extras.push(`${counts.rating} hors note`);
  }
  if (counts.gk) {
    extras.push(`${counts.gk} gardien(s)`);
  }
  const text =
    `${filter.name}${bidSearch ? " (enchères)" : ""} · ${total} résultat${total > 1 ? "s" : ""}` +
    (page > 1 ? ` (page ${page})` : "") +
    (deals.length ? ` · ${deals.length} affaire${deals.length > 1 ? "s" : ""} ≤ ${formatCoins(maxBuy)}` : "") +
    (extras.length ? ` · ${extras.join(", ")}` : "") +
    ` · ${Math.round(latency)} ms`;
  log.search(text);
};

const attemptBuy = async (ctx, deal, filter) => {
  const name = market.nameOf(deal.item);
  bumpStat("attempts");
  const result = await market.bidOnItem(deal.item, deal.bin);
  if (result.ok) {
    ctx.attempted.add(deal.tradeId);
    bumpStat("won");
    bumpStat("spent", deal.bin);
    updateState({ coins: getCoins() });
    log.buy(`Acheté : ${name} ${deal.rating} pour ${formatCoins(deal.bin)} (${Math.round(result.latency)} ms)`, {
      definitionId: deal.item.definitionId,
    });
    recordTransaction({ type: "achat", name, rating: deal.rating, price: deal.bin, filter: filter.name });
    notifyEvent("buy", `✅ Achat : ${name} ${deal.rating} pour ${formatCoins(deal.bin)} coins`);
    queueSale(ctx, { item: deal.item, buyPrice: deal.bin, filter, name, rating: deal.rating });
    return "won";
  }
  const error = result.error || classify(result.response);
  if (error.kind === KIND.GONE) {
    ctx.attempted.add(deal.tradeId);
    bumpStat("missed");
    log.warn(`Raté : ${name} à ${formatCoins(deal.bin)}, déjà acheté par quelqu'un d'autre (${error.code}).`);
    recordTransaction({ type: "raté", name, rating: deal.rating, price: deal.bin, filter: filter.name });
    notifyEvent("fail", `❌ Raté : ${name} ${deal.rating} à ${formatCoins(deal.bin)}`);
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

const placeBids = async (ctx, auctions, filter, settings) => {
  const maxBid = floorPrice(filter.maxBid);
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
    const current = toInt(auction.currentBid);
    const price = settings.bid.exact
      ? maxBid
      : current
      ? priceAbove(current)
      : Math.max(150, roundPrice(auction.startingBid));
    if (!price || price > maxBid || (entry.bin && price >= entry.bin) || (current && price <= current)) {
      continue;
    }
    const coins = getCoins();
    if (coins && coins - toInt(settings.buy.coinsReserve) < price) {
      continue;
    }
    placed += 1;
    const name = market.nameOf(entry.item);
    const result = await market.bidOnItem(entry.item, price);
    if (result.ok) {
      bumpStat("bids");
      ctx.bids.set(entry.tradeId, {
        item: entry.item,
        price,
        filter,
        name,
        rating: entry.rating,
        endsAt: Date.now() + (Number(auction.expires) || 0) * 1000,
      });
      log.info(`Enchère placée : ${name} ${entry.rating} à ${formatCoins(price)} (fin dans ${Math.round(Number(auction.expires) || 0)} s).`);
      continue;
    }
    const error = result.error || classify(result.response);
    if (error.kind === KIND.GONE) {
      log.warn(`Enchère refusée sur ${name} (surenchéri ou terminé).`);
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
      bumpStat("bidsWon");
      bumpStat("won");
      bumpStat("spent", price);
      log.buy(`Enchère gagnée : ${bid.name} ${bid.rating} pour ${formatCoins(price)}.`);
      recordTransaction({ type: "enchère gagnée", name: bid.name, rating: bid.rating, price, filter: bid.filter.name });
      notifyEvent("buy", `🏆 Enchère gagnée : ${bid.name} pour ${formatCoins(price)} coins`);
      queueSale(ctx, { item, buyPrice: price, filter: bid.filter, name: bid.name, rating: bid.rating });
    } else if (
      safeCall(auction, "isExpired") ||
      (safeCall(auction, "isClosedTrade") && !safeCall(auction, "isWon"))
    ) {
      ctx.bids.delete(tradeId);
      release.push(item);
      log.info(`Enchère perdue : ${bid.name}.`);
    } else if (safeCall(auction, "isOutbid")) {
      const next = priceAbove(toInt(auction.currentBid));
      const maxBid = floorPrice(bid.filter.maxBid);
      const coins = getCoins();
      const affordable = !coins || coins - toInt(settings.buy.coinsReserve) >= next;
      if (settings.bid.rebid && next <= maxBid && affordable) {
        const rebid = await market.bidOnItem(item, next);
        if (rebid.ok) {
          bid.price = next;
          bumpStat("bids");
          log.info(`Surenchère : ${bid.name} à ${formatCoins(next)}.`);
        } else if (rebid.error && rebid.error.kind !== KIND.GONE) {
          await handleFailure(ctx, rebid.error, "bid", bid.name);
        }
      } else {
        ctx.bids.delete(tradeId);
        release.push(item);
        log.info(`Surenchéri sur ${bid.name} au-delà de ton max (${formatCoins(maxBid)}) : abandon.`);
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
  // Le prix FUTBIN est demandé tout de suite, en arrière-plan, pendant la fin du cycle.
  const sell = getSettings().sell;
  if (sell.mode === "list" && sellModeFor(entry.filter, sell) === "futbin") {
    requestSellPrice(entry);
  }
};

const moveToTransferList = async (ctx, job) => {
  if (market.isPileFull("TRANSFER")) {
    log.warn(`${job.name} laissé dans les non attribués : liste des transferts pleine.`);
    ctx.fullStop = true;
    return;
  }
  const result = await market.moveItem(job.item, "TRANSFER");
  if (result.ok) {
    ctx.transferDirty = true;
    log.info(`${job.name} envoyé dans la liste des transferts.`);
    return;
  }
  log.warn(`${job.name} n'a pas pu être déplacé : ${result.error.label}.`);
  if (result.error.kind === KIND.FULL) {
    ctx.fullStop = true;
  } else {
    await handleFailure(ctx, result.error, "move", job.name);
  }
};

// Prix de revente : fixe (filtre ou onglet Vente) ou % du prix FUTBIN de la version achetée.
// Renvoie null tant que le prix FUTBIN n'est pas arrivé (la vente est reportée au cycle suivant).
const sellPriceFor = async (ctx, job, sell) => {
  if (sellModeFor(job.filter, sell) !== "futbin") {
    const price = fixedSellPriceFor(job.filter, sell);
    return { price, reason: price ? "" : "aucun prix de revente (filtre ou onglet Vente)" };
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
      `Prix FUTBIN ${job.name} : ${formatCoins(reference)} → vente à ${Math.round(percent)} % = ${formatCoins(price)}.`
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
  return { price: 0, reason: "prix FUTBIN indisponible" };
};

// Renvoie "deferred" si la vente doit être retentée au prochain cycle.
const sellJob = async (ctx, job) => {
  const sell = getSettings().sell;
  if (sell.mode === "none") {
    return "done";
  }
  if (sell.maxRating && job.rating > toInt(sell.maxRating)) {
    log.info(`${job.name} (${job.rating}) gardé : note au-dessus du seuil de vente.`);
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
    log.warn(`${job.name} : ${plan.reason}, envoyé dans la liste des transferts sans être listé.`);
    await moveToTransferList(ctx, job);
    return "done";
  }
  if (market.isPileFull("TRANSFER")) {
    log.warn(`${job.name} laissé dans les non attribués : liste des transferts pleine.`);
    ctx.fullStop = true;
    return "done";
  }
  const listing = await prepareListing(job.item, plan.price);
  const price = listing.buyNow;
  const profit = profitFor(job.buyPrice, price);
  const minProfit = toInt(sell.minProfit);
  if (minProfit && profit < minProfit) {
    log.warn(
      `${job.name} : bénéfice ${formatCoins(profit)} < minimum ${formatCoins(minProfit)}, pas mis en vente (envoyé en liste des transferts).`
    );
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
    log.success(
      `Mis en vente : ${job.name} à ${formatCoins(price)} (départ ${formatCoins(start)}) · bénéfice estimé ${formatCoins(profit)}.`
    );
    recordTransaction({ type: "mise en vente", name: job.name, rating: job.rating, price, profit, filter: job.filter.name });
    notifyEvent("list", `📤 ${job.name} mis en vente à ${formatCoins(price)} (bénéfice ${formatCoins(profit)})`);
    return "done";
  }
  const error = result.error || classify(result.response);
  log.error(`Mise en vente de ${job.name} échouée : ${error.label}.`);
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
      log.error(`Revente de ${job.name} : ${errorMessage(e)}`);
    }
    // Pause entre deux actions EA seulement (une vente reportée n'a envoyé aucune requête).
    if (outcome !== "deferred" && index < jobs.length - 1 && !ctx.token.cancelled) {
      await sleep(randomBetween(700, 1500), ctx.token);
    }
  }
  ctx.sellQueue.push(...later);
};

// ------------------------------------------------------- liste des transferts

const checkTransferList = async (ctx) => {
  const result = await market.fetchTransferList();
  if (!result.ok) {
    await handleFailure(ctx, result.error, "transfer", null, { quiet: true });
    return;
  }
  ctx.transferDirty = false;
  const summary = market.summarizeTransferList(result.items);
  const capacity = market.pileCapacity("TRANSFER");
  updateState({ transfer: Object.assign({ capacity }, summary), coins: getCoins() });
  const settings = getSettings().transfer;
  const now = Date.now();
  if (settings.relistExpired && summary.unsold > 0 && now - ctx.lastRelistAt > RELIST_MIN_GAP && !blocked(ctx)) {
    ctx.lastRelistAt = now;
    if (settings.relistMode === "futbin") {
      await relistAtFutbin(ctx, result.items);
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
      log.success(`${summary.sold} vente(s) encaissée(s) : +${formatCoins(earned)} coins.`);
      await market.refreshCoins();
      updateState({ coins: getCoins() });
    } else {
      await handleFailure(ctx, cleared.error, "transfer", null, { quiet: true });
    }
  }
  if (capacity && summary.total >= capacity && !ctx.warned.has("transfer-full")) {
    ctx.warned.add("transfer-full");
    log.warn(`Liste des transferts pleine (${summary.total}/${capacity}).`);
  }
};

const relistSamePrice = async (ctx, count) => {
  const relist = await market.relistExpired();
  if (relist.ok) {
    ctx.transferDirty = true;
    ctx.relistPending.clear();
    log.success(`${count} carte(s) invendue(s) relistée(s) au même prix.`);
  } else {
    log.warn(`Relist impossible : ${relist.error.label}.`);
    await handleFailure(ctx, relist.error, "transfer", null, { quiet: true });
  }
};

// Relist des invendus au prix FUTBIN du moment (% de l'onglet Vente), 5 cartes par passage.
// Une carte sans prix FUTBIN est retentée ; après 3 min sans prix, relist au même prix.
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
    const listing = await prepareListing(entry.item, price);
    const res = await market.listOnMarket(entry.item, listing.start, listing.buyNow, duration);
    if (res.ok) {
      listed += 1;
      ctx.relistPending.delete(String(entry.item.id));
      log.success(`Relisté : ${name} à ${formatCoins(listing.buyNow)} (FUTBIN ${formatCoins(entry.reference)}).`);
    } else {
      log.warn(`Relist de ${name} échoué : ${res.error.label}.`);
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
    log.warn(`${stale.length} invendu(s) sans prix FUTBIN depuis 3 min : relist au même prix.`);
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
        log.info(`${ctx.userWatched.size} carte(s) déjà dans ta liste de suivi : le bot n'y touchera pas.`);
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
    .filter((filter) => filter.priceMode === "futbin" && futbinKeyForFilter(filter));
  if (!futbinFilters.length || ctx.token.cancelled) {
    return;
  }
  await withTimeout(
    Promise.all(
      futbinFilters.map((filter) => {
        const key = futbinKeyForFilter(filter);
        trackHot(ctx, key, futbinHint(filter));
        const ready = currentPrice(key, BUY_PRICE_MAX_AGE)
          ? Promise.resolve()
          : requestPrice(key, futbinHint(filter));
        return ready.then(() => {
          const price = currentPrice(key, BUY_PRICE_MAX_AGE, "buy");
          if (price) {
            const record = getPriceRecord(key);
            const age = record && record.updatedAgoSec != null ? Math.round(record.updatedAgoSec / 60) : null;
            log.info(
              `Prix FUTBIN ${filter.name} : ${formatCoins(price)} → achat max ${formatCoins(effectiveMaxBuy(filter))} (${filter.futbinPercent} %${filter.maxBuy ? `, plafond ${formatCoins(filter.maxBuy)}` : ""})` +
                (age != null ? ` · prix mis à jour par FUTBIN il y a ${age} min.` : ".")
            );
          } else {
            const record = getPriceRecord(key);
            log.warn(
              `Prix FUTBIN de ${filter.name} indisponible${record && record.status === "miss" ? " (carte introuvable sur FUTBIN)" : ""} : le filtre attend.`
            );
          }
        });
      })
    ),
    25000
  );
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
    haltRun(ctx, `code d'erreur ${error.code} reçu ${count} fois`, { alert: true });
    return true;
  }
  return false;
};

const LABELS = {
  buy: "achat",
  bid: "enchère",
  list: "mise en vente",
  move: "déplacement",
  watch: "liste de suivi",
  transfer: "liste des transferts",
};

const handleFailure = async (ctx, error, where, subject, { quiet = false } = {}) => {
  if (!error || ctx.token.cancelled) {
    return;
  }
  bumpStat("errors");
  if (trackStopCode(ctx, error)) {
    return;
  }
  const prefix = subject ? `${subject} : ` : "";
  switch (error.kind) {
    case KIND.CAPTCHA:
      haltRun(ctx, "captcha EA : ouvre le web app, résous le captcha puis relance", { alert: true });
      return;
    case KIND.AUTH:
      haltRun(ctx, "session EA expirée : reconnecte-toi au web app", { alert: true });
      return;
    case KIND.BANNED:
      haltRun(ctx, "compte bloqué par EA", { alert: true });
      return;
    case KIND.LOCKED:
      haltRun(ctx, "marché des transferts verrouillé par EA (soft ban)", { alert: true });
      return;
    case KIND.RATE:
    case KIND.BLOCKED:
      if (ctx.finalizing) {
        haltRun(ctx, `${error.label} (${error.code})`, { alert: true });
      } else {
        startCooldown(ctx, error);
      }
      return;
    case KIND.FULL:
      ctx.fullStop = true;
      log.warn(`${prefix}${error.label}.`);
      return;
    case KIND.FUNDS:
      log.warn(`${prefix}coins insuffisants.`);
      return;
    default:
      break;
  }
  if (where === "search") {
    ctx.consecutiveFailures += 1;
    const limit = Math.max(1, toInt(getSettings().errors.maxConsecutiveFailures) || 3);
    if (ctx.consecutiveFailures >= limit) {
      stopBot(`${ctx.consecutiveFailures} recherches en échec d'affilée (${error.label})`, { alert: true });
    } else {
      log.warn(`Recherche en échec : ${error.label} (${ctx.consecutiveFailures}/${limit}).`);
    }
    return;
  }
  if (!quiet) {
    log.error(`${prefix}${LABELS[where] || where} en échec (${error.label}).`);
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
    stopBot(`EA limite les requêtes (${error.code}) de façon répétée`, { alert: true });
    return;
  }
  const seconds = pickSeconds(settings.cooldown, "M") || 300;
  const until = Date.now() + seconds * 1000;
  setNotBefore(ctx, until, "cooldown");
  log.warn(
    `${error.label} (${error.code}) : pause de sécurité de ${seconds >= 90 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)} s`} (${ctx.cooldowns}/${maxCooldowns}).`
  );
  notifyEvent("fail", `⚠️ ${error.label} (${error.code}) : pause de sécurité`);
  if (!ctx.paused) {
    updateState({ status: STATUS.COOLDOWN, pauseUntil: until, nextSearchAt: until, waitStartedAt: Date.now() });
  }
};

// --------------------------------------------------------- recherche de test

// Une recherche unique, sans achat, pour vérifier un filtre et voir les prix du marché.
export const previewSearch = async (filter) => {
  if (run) {
    return { ok: false, message: "Arrête le bot pour lancer une recherche de test." };
  }
  if (!isAppReady() || !getUser()) {
    return { ok: false, message: "Connecte-toi au web app EA d'abord." };
  }
  const key = filter.priceMode === "futbin" ? futbinKeyForFilter(filter) : 0;
  if (key && !effectiveMaxBuy(filter)) {
    await withTimeout(requestPrice(key, futbinHint(filter)), 20000);
    if (!effectiveMaxBuy(filter)) {
      return { ok: false, message: "Prix FUTBIN indisponible : vérifie l'accès dans l'onglet FUTBIN (bouton Tester)." };
    }
  }
  const maxBuy = effectiveMaxBuy(filter);
  const criteria = buildCriteria(filter, { maxBuy });
  const result = await market.searchMarket(criteria, 1);
  if (!result.ok) {
    return { ok: false, message: `Recherche refusée : ${result.error.label} (${result.error.code})` };
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
        match: matchesTarget(item, filter),
      };
    })
    .sort((a, b) => a.bin - b.bin);
  return { ok: true, rows, latency: result.latency, maxBuy, futbinPrice: key ? currentPrice(key, BUY_PRICE_MAX_AGE) : 0 };
};
