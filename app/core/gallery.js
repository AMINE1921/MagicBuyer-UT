import { t } from "../i18n";
import { fetchGalleryIndex, fetchGalleryPool, fetchGallerySet } from "../prices/futbinClient";
import { setItemScore } from "../prices/itemScores";
import { currentPrice, pricePlatform, seedFutbinPrice, trackPrice } from "../prices/priceService";
import { sleep } from "./async";
import { collectedOwners, isCollected as collectedByEa, markCollected as markCollectedByEa, resetCollectionForTests } from "./galleryCollection";
import { planSelection, scoreSelection } from "./galleryScore";
import { log } from "./logger";
import { durationSeconds, percentRange, prepareListing } from "./listing";
import { listOnMarket, moveItem, searchClubItems, searchStorageItems } from "./market";
import { floorPrice, formatCoins, roundPrice, toInt } from "./prices";
import { parseRange } from "./ranges";
import { loadJson, saveJson } from "./storage";
import { buyEntry, describeFatal } from "./sbc";
import { getSettings } from "./settings";
import { recordTransaction, updateState } from "./state";
import { getCoins } from "./page";

// Galerie FC 27 (données FUTBIN) : collections, joueurs éligibles avec leurs points, paliers et
// bonus. Cartes collectées : d'après EA (galleryCollection : champ isCollected lu sur les objets du
// web app et synchro), gratuites dans les plans. Plan le moins cher pour le prochain palier ; achat
// des manquants par paliers de prix (entre deux % du prix FUTBIN), revente en option.

const INDEX_TTL = 30 * 60 * 1000;
const SET_TTL = 10 * 60 * 1000;
const MAX_POOL_PAGES = 12;
const OWNED_CHUNK = 20;

const cache = new Map();

const cached = async (key, ttl, load) => {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.at < ttl) {
    return entry.value;
  }
  const value = await load();
  if (value && value.ok) {
    cache.set(key, { at: Date.now(), value });
  }
  return value;
};

export const clearGalleryCache = () => cache.clear();

// Carte collectée (EA) ; achat par un outil MagicBuyer : notée collectée tout de suite.
export const isCollected = (eaId) => collectedByEa(eaId);
export const markCollected = (eaIds) => markCollectedByEa(eaIds);

// ------------------------------------------------ résumés (progression sans ouvrir la collection)
// À chaque ouverture : joueurs éligibles (id, points), paliers et taille de liste. La progression
// des tuiles (cartes à toi, score de base) est ensuite recalculée avec la collection à jour.

const SUMMARY_KEY = "gallerySummaries2";
const SUMMARY_MAX = 200;
let summaries = loadJson(SUMMARY_KEY, {}) || {};
let summaryTimer = null;

export const gallerySummary = (setId) => summaries[String(setId)] || null;

export const saveGallerySummary = (setId, summary) => {
  summaries[String(setId)] = Object.assign({ at: Date.now() }, summary);
  const keys = Object.keys(summaries);
  if (keys.length > SUMMARY_MAX) {
    keys
      .sort((a, b) => summaries[a].at - summaries[b].at)
      .slice(0, keys.length - SUMMARY_MAX)
      .forEach((key) => delete summaries[key]);
  }
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => saveJson(SUMMARY_KEY, summaries), 1000);
};

// Résumé compact d'une collection ouverte : [eaId, points] des joueurs éligibles.
export const summaryFor = (set, extra = {}) =>
  Object.assign(
    {
      players: (set.items || []).filter((item) => item.eaId).map((item) => [item.eaId, Number(item.points) || 0]),
      size: (set.limit && set.limit.maxItems) || 20,
      tiers: (set.tiers || []).map((tier) => [tier.grade, tier.points]),
      complete: !!set.complete,
    },
    extra
  );

// Progression estimée d'une collection déjà ouverte : cartes collectées parmi ses joueurs et
// score de base (meilleurs points, sans les bonus) ; null si jamais ouverte.
export const estimateSet = (setId) => {
  const summary = gallerySummary(setId);
  if (!summary || !Array.isArray(summary.players)) {
    return null;
  }
  const owned = summary.players.filter(([id]) => collectedByEa(id));
  const base = owned
    .map(([, points]) => points)
    .sort((a, b) => b - a)
    .slice(0, summary.size || 20)
    .reduce((total, points) => total + points, 0);
  return {
    owned: owned.length,
    players: summary.players.length,
    base,
    // Score exact (avec bonus) calculé à la dernière ouverture, s'il est plus haut que l'estimation.
    total: Math.max(base, Number(summary.total) || 0),
    complete: summary.complete !== false,
    at: summary.at,
  };
};

// Utilisé par les tests.
export const resetGalleryForTests = () => {
  summaries = {};
  cache.clear();
  resetCollectionForTests();
};

export const loadGalleryIndex = (url) => cached(`index:${url || ""}`, INDEX_TTL, () => fetchGalleryIndex(url));

// Prix et scores d'objet des joueurs lus sur la galerie : mémorisés comme ceux d'une liste FUTBIN.
const remember = (items) => {
  const platform = pricePlatform();
  items.forEach((item) => {
    if (!item.eaId) {
      return;
    }
    if (item.points) {
      setItemScore(item.eaId, item.points, true);
    }
    seedFutbinPrice(item.eaId, {
      price: 0,
      platform,
      link: { futbinId: item.futbinId, url: item.url, name: item.name, rating: item.rating },
    });
  });
};

// Collection + tous ses joueurs éligibles (pages suivantes lues au besoin, au plus 12 pages).
export const loadGallerySet = async (url, { sort = "", pages = MAX_POOL_PAGES, onProgress = () => {} } = {}) => {
  const first = await cached(`set:${url}`, SET_TTL, () => fetchGallerySet(url));
  if (!first.ok) {
    return first;
  }
  const set = Object.assign({}, first.set, { url });
  const embedded = set.items.slice();
  const perPage = set.perPage || 24;
  const total = set.totalItems || embedded.length;
  const lastPage = Math.min(pages, Math.ceil(total / perPage));
  // Collection lue en entier : ordre de la page (la première page est déjà dans le HTML), le tri est
  // fait ensuite par l'onglet. Grande collection : les N premières pages dans l'ordre FUTBIN choisi.
  const whole = Math.ceil(total / perPage) <= pages;
  const wantedSort = whole ? set.initialSort : sort || set.initialSort;
  let items = wantedSort === set.initialSort ? embedded : [];
  const startPage = items.length ? 2 : 1;
  for (let page = startPage; page <= lastPage; page += 1) {
    onProgress(page, lastPage);
    const key = `pool:${set.searchUrl}:${wantedSort}:${page}`;
    const result = await cached(key, SET_TTL, () => fetchGalleryPool(set.searchUrl, { sort: wantedSort, page }));
    if (!result.ok) {
      set.partial = true;
      set.poolError = result;
      break;
    }
    items = items.concat(result.items);
    if (result.items.length < perPage) {
      break;
    }
  }
  // Pages suivantes refusées dès la première : on garde au moins les joueurs de la page HTML.
  if (!items.length && embedded.length) {
    items = embedded;
  }
  remember(items);
  set.items = items;
  set.sort = wantedSort;
  set.complete = !set.partial && items.length >= total;
  return { ok: true, set };
};

// Cartes possédées parmi les joueurs éligibles (club / stockage DCE) : { eaId → { item, source,
// firstOwner } }. Optionnel depuis la collection EA : sert à repérer le premier propriétaire.
export const findOwnedForGallery = async (items, { token = null, useStorage = true, onProgress = () => {} } = {}) => {
  const ids = Array.from(new Set(items.map((item) => item.eaId).filter(Boolean)));
  const owned = new Map();
  const errors = [];
  const consider = (item, source) => {
    const id = Number(item && item.definitionId) || 0;
    if (!id || !ids.includes(id)) {
      return;
    }
    try {
      if (typeof item.isLimitedUse === "function" && item.isLimitedUse()) {
        return;
      }
    } catch (e) {}
    const previous = owned.get(id);
    const firstOwner = Number(item.owners) === 1;
    if (!previous || (firstOwner && !previous.firstOwner) || (previous.source !== "club" && source === "club")) {
      owned.set(id, { item, source, firstOwner });
    }
  };
  for (let index = 0; index < ids.length; index += OWNED_CHUNK) {
    if (token && token.cancelled) {
      break;
    }
    const chunk = ids.slice(index, index + OWNED_CHUNK);
    onProgress(Math.min(ids.length, index + OWNED_CHUNK), ids.length);
    const club = await searchClubItems(chunk);
    if (club.ok) {
      club.items.forEach((item) => consider(item, "club"));
    } else if (club.error) {
      errors.push(club.error);
    }
    if (useStorage) {
      const storage = await searchStorageItems(chunk);
      if (storage.ok) {
        storage.items.forEach((item) => consider(item, "storage"));
      } else if (storage.error) {
        errors.push(storage.error);
      }
    }
    if (index + OWNED_CHUNK < ids.length) {
      await sleep(700, token);
    }
  }
  markCollected(Array.from(owned.keys()));
  return { owned, errors };
};

// Prix d'un joueur pour le plan : FUTBIN en direct si connu, sinon celui de la galerie (indicatif).
export const itemPrice = (item) => {
  const live = currentPrice(item.eaId, 10 * 60 * 1000, "buy");
  if (live) {
    return live;
  }
  const platform = pricePlatform();
  return (item.prices && item.prices[platform]) || 0;
};

// Carte absente du marché d'après FUTBIN (récompense DCE, objectif…) : prix 0 affiché.
export const isOffMarket = (item) => {
  const platform = pricePlatform();
  return !!(item.offMarket && item.offMarket[platform]) && !itemPrice(item);
};

// Joueurs du plan : collectés (EA) ou possédés (club / stockage) = gratuits. Premier propriétaire :
// d'après le club (recherche) ou le plus petit nombre de propriétaires vu par la collection.
export const candidatesFor = (set, owned) =>
  set.items.map((item) => {
    const mine = owned ? owned.get(item.eaId) : null;
    const collected = !mine && isCollected(item.eaId);
    return Object.assign({}, item, {
      key: item.futbinId,
      owned: !!mine || collected,
      source: mine ? mine.source : collected ? "collection" : "",
      firstOwner: !!(mine && mine.firstOwner) || collectedOwners(item.eaId) === 1,
      price: mine || collected ? 0 : itemPrice(item),
    });
  });

// Meilleur score avec les seules cartes à toi, puis le premier palier qu'il n'atteint pas
// (ou le dernier palier s'ils sont tous atteints).
export const nextGrade = (set, candidates) => {
  const size = (set.limit && set.limit.maxItems) || 20;
  const mine = candidates.filter((item) => item.owned);
  const best = planSelection(set, mine, { target: Infinity, size, exact: false, firstOwnerIds: firstOwnerKeys(candidates) });
  const total = best.score.total;
  const tiers = (set.tiers || []).slice().sort((a, b) => a.points - b.points);
  const next = tiers.find((tier) => tier.points > total) || tiers[tiers.length - 1] || null;
  return { total, grade: next ? next.grade : "", points: next ? next.points : 0, reachedAll: !tiers.some((tier) => tier.points > total) };
};

export const firstOwnerKeys = (candidates, selectionKeys) =>
  new Set(candidates.filter((item) => item.owned && item.firstOwner && (!selectionKeys || selectionKeys.has(item.key))).map((item) => item.key));

export const scoreOf = (set, selection, candidates) => scoreSelection(set, selection, firstOwnerKeys(candidates));

export const planFor = (set, candidates, target) =>
  planSelection(set, candidates, {
    target,
    size: (set.limit && set.limit.maxItems) || 20,
    exact: !set.limit || set.limit.exact !== false,
    firstOwnerIds: firstOwnerKeys(candidates),
  });

// ------------------------------------------------ achat des manquants

// Réglages d'achat de la galerie (onglet Outils ou fenêtre d'achat).
export const galleryBuySettings = () => {
  const gallery = getSettings().gallery || {};
  return {
    range: percentRange(gallery.buyRange || "85-100"),
    retries: Math.max(1, Math.min(5, toInt(gallery.retries) || 3)),
    wait: gallery.wait || "2-4",
    sellMode: ["keep", "same", "percent"].includes(gallery.sellMode) ? gallery.sellMode : "keep",
    sellPercent: percentRange(gallery.sellPercent || "100"),
  };
};

// Prix max de chaque essai : du bas au haut de la plage (% du prix de référence), arrondis au
// palier EA inférieur, croissants et sans doublon. Ex. 10 000, 85–100 %, 3 essais → 8 500 / 9 200 / 10 000.
export const buildLadder = (reference, { range = { min: 85, max: 100 }, retries = 3 } = {}) => {
  const base = toInt(reference);
  if (!base) {
    return [];
  }
  const count = Math.max(1, Math.min(5, toInt(retries) || 1));
  const low = Math.min(range.min, range.max);
  const high = Math.max(range.min, range.max);
  const prices = [];
  for (let index = 0; index < count; index += 1) {
    const percent = count === 1 ? low : low + ((high - low) * index) / (count - 1);
    const price = floorPrice((base * percent) / 100);
    if (price && !prices.includes(price) && (!prices.length || price > prices[prices.length - 1])) {
      prices.push(price);
    }
  }
  return prices;
};

// Prix de revente d'une carte achetée : même prix, % du prix FUTBIN, ou 0 (gardée au club).
const resalePrice = (job, sell) => {
  if (sell.mode === "same") {
    return job.price;
  }
  if (sell.mode === "percent") {
    const reference = currentPrice(job.entry.player.eaId, 10 * 60 * 1000, "sell") || job.reference;
    const percent = (sell.percent.min + sell.percent.max) / 2;
    return reference ? roundPrice((reference * percent) / 100) : 0;
  }
  return 0;
};

// Achat des joueurs choisis, un par un : paliers de prix (essai 1 au plus bas), attente entre deux
// recherches. item.maxPrice (fenêtre d'achat) remplace le prix FUTBIN de référence (obligatoire pour
// une carte hors marché). Sans revente : envoi au club. Avec revente : après tous les achats, chaque
// carte est mise en vente (vente groupée) ; si la mise en vente échoue, elle va au club.
// options.resell (ancien réglage) = revente au même prix.
export const buyGalleryPlayers = async (items, { token, onUpdate = () => {}, resell = false, sell = null, buy = null } = {}) => {
  const report = { bought: 0, spent: 0, failed: 0, listed: 0, stopped: "" };
  const options = Object.assign(galleryBuySettings(), buy || {});
  const sellOptions = sell || { mode: resell ? "same" : options.sellMode, percent: options.sellPercent };
  const untrack = items.map((item) => trackPrice(item.eaId, { name: item.name, rating: item.rating }, "hot"));
  const bought = [];
  try {
    // Prix FUTBIN en direct nécessaires avant d'acheter (au plus 60 s d'attente), sauf prix saisi.
    const deadline = Date.now() + 60000;
    const needsPrice = (item) => !toInt(item.maxPrice) && !currentPrice(item.eaId, 5 * 60 * 1000, "buy");
    while (Date.now() < deadline && !token.cancelled && items.some(needsPrice)) {
      await sleep(1000, token);
    }
    const entries = items.map((item) => {
      const manual = toInt(item.maxPrice);
      const reference = manual || currentPrice(item.eaId, 5 * 60 * 1000, "buy") || 0;
      // Prix saisi : plafond absolu (dernier palier) ; sinon plage de % du prix FUTBIN.
      const ladder = manual
        ? buildLadder(manual, { range: { min: options.range.min, max: 100 }, retries: options.retries })
        : buildLadder(reference, options);
      return {
        player: { eaId: item.eaId, name: item.name, rating: item.rating },
        manual: !!manual,
        maxPrice: manual,
        frozenMax: ladder.length ? ladder[ladder.length - 1] : 0,
        ladder,
        wait: options.wait,
        note: "",
        item,
        reference,
      };
    });
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (token.cancelled) {
        report.stopped = t("tools.stopRequested");
        break;
      }
      if (!entry.ladder.length) {
        report.failed += 1;
        onUpdate(entry.item, "failed", t("gallery.noPrice"));
        continue;
      }
      onUpdate(entry.item, "searching", "");
      const outcome = await buyEntry(entry, token, () => onUpdate(entry.item, "searching", entry.note));
      if (outcome.fatal) {
        report.stopped = describeFatal(outcome.fatal);
        onUpdate(entry.item, "failed", report.stopped);
        log.error(t("gallery.logBuyStopped", { reason: report.stopped }));
        break;
      }
      if (!outcome.ok) {
        report.failed += 1;
        onUpdate(entry.item, "failed", entry.note || t("gallery.noOffer"));
        continue;
      }
      report.bought += 1;
      report.spent += outcome.price;
      markCollected([entry.player.eaId]);
      log.buy(t("gallery.logBought", { name: entry.player.name, rating: entry.player.rating || "", price: formatCoins(outcome.price) }));
      recordTransaction({ type: t("gallery.txBuy"), name: entry.player.name, rating: entry.player.rating, price: outcome.price, filter: t("gallery.txFilter") });
      updateState({ coins: getCoins() });
      if (sellOptions.mode !== "keep") {
        bought.push({ entry, item: outcome.item, price: outcome.price, reference: entry.reference });
        onUpdate(entry.item, "bought", t("gallery.boughtFor", { price: formatCoins(outcome.price) }));
      } else {
        const moved = await moveItem(outcome.item, "CLUB");
        onUpdate(entry.item, "bought", moved.ok ? t("gallery.boughtFor", { price: formatCoins(outcome.price) }) : moved.error.label);
      }
      if (index < entries.length - 1 && !token.cancelled) {
        const range = parseRange(options.wait, "S") || { min: 2, max: 4 };
        await sleep((range.min + Math.random() * Math.max(0, range.max - range.min)) * 1000, token);
      }
    }
    // Revente groupée (même si les achats ont été arrêtés : les cartes achetées sont listées).
    if (bought.length) {
      const duration = durationSeconds(getSettings().sell.duration);
      for (const job of bought) {
        const price = resalePrice(job, sellOptions);
        const listing = price ? await prepareListing(job.item, price) : null;
        const result = listing ? await listOnMarket(job.item, listing.start, listing.buyNow, duration) : { ok: false, error: { label: t("gallery.noPrice") } };
        if (result.ok) {
          report.listed += 1;
          onUpdate(job.entry.item, "listed", t("gallery.listedAt", { price: formatCoins(listing.buyNow) }));
          recordTransaction({ type: t("gallery.txList"), name: job.entry.player.name, rating: job.entry.player.rating, price: listing.buyNow, filter: t("gallery.txFilter") });
        } else {
          const moved = await moveItem(job.item, "CLUB");
          onUpdate(job.entry.item, "bought", `${t("gallery.listFailed", { error: result.error.label })}${moved.ok ? ` · ${t("gallery.movedToClub")}` : ""}`);
        }
        await sleep(900 + Math.random() * 600);
      }
      log.info(t("gallery.logResold", { n: report.listed, total: bought.length }));
    }
  } finally {
    untrack.forEach((fn) => fn());
  }
  return report;
};

export const galleryTargetPoints = (set, grade) => {
  const tier = (set.tiers || []).find((candidate) => candidate.grade === grade);
  return tier ? tier.points : 0;
};
