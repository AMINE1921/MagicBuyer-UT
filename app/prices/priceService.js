import { getSettings } from "../core/settings";
import { loadJson, saveJson } from "../core/storage";
import { getUserPlatform } from "../utils/userUtil";
import { absoluteUrl, isPlausiblePrice } from "./futbinParse";
import {
  fetchFutbinPrice,
  futbinDirectPausedUntil,
  resetFutbinClientForTests,
  resolveFutbinLink,
} from "./futbinClient";

// Prix FUTBIN tenus à jour intelligemment :
// - cibles du bot et achats SBC ("hot") : relus toutes les 60 à 120 s (réglable) ;
// - cartes affichées à l'écran ("visible") : relues si plus vieilles que ~2 min,
//   un peu moins souvent si le prix ne bouge pas (jamais au-delà de 6 min) ;
// - une seule requête FUTBIN à la fois, espacées, et ralentissement automatique si FUTBIN bloque ;
// - un saut de prix anormal est vérifié une seconde fois avant d'être utilisé par le bot.

const LINKS_KEY = "futbinLinks";
const PRICES_KEY = "futbinPrices";
const PRIORITY = { hot: 0, request: 1, visible: 2 };
const MISS_RETRY = 30 * 60 * 1000;
const ERROR_RETRY = 90 * 1000;
const NO_PRICE_RETRY = 10 * 60 * 1000;
const SUSPECT_RECHECK = 20 * 1000;
const MAX_VISIBLE_AGE = 6 * 60 * 1000;
const STALE_GUARD = 30 * 60 * 1000;

let links = loadJson(LINKS_KEY, {}) || {};
const records = new Map();
const interest = new Map();
const queue = new Map();
const inflight = new Set();
const waiters = new Map();
const listeners = new Set();
const status = {
  state: "idle",
  requests: 0,
  lastError: "",
  lastSuccessAt: 0,
  blockedUntil: 0,
  backoffMs: 0,
};
let busy = false;
let lastRequestAt = 0;
let pumpTimer = null;
let saveTimer = null;
let tickTimer = null;

// Prix mémorisés au dernier chargement (affichés avec leur âge).
(() => {
  const stored = loadJson(PRICES_KEY, {}) || {};
  Object.keys(stored).forEach((key) => {
    const value = stored[key];
    if (value && value.price && Date.now() - value.fetchedAt < 60 * 60 * 1000) {
      records.set(Number(key), Object.assign({ suspect: null, unchanged: 0, failures: 0 }, value));
    }
  });
})();

const settings = () => getSettings().prices;

export const pricePlatform = () => {
  const chosen = settings().platform;
  if (chosen === "pc" || chosen === "console") {
    return chosen;
  }
  return getUserPlatform() === "pc" ? "pc" : "console";
};

const emit = (definitionId) => {
  const record = records.get(definitionId) || null;
  listeners.forEach((fn) => {
    try {
      fn(definitionId, record);
    } catch (e) {}
  });
};

export const onPriceUpdate = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getFutbinStatus = () => Object.assign({ queue: queue.size, tracked: interest.size }, status);

const persistSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {};
    const cutoff = Date.now() - 60 * 60 * 1000;
    Array.from(records.entries())
      .filter(([, record]) => record.price && record.fetchedAt > cutoff)
      .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
      .slice(0, 800)
      .forEach(([id, record]) => {
        out[id] = {
          definitionId: id,
          price: record.price,
          prices: record.prices,
          updatedAgoSec: record.updatedAgoSec,
          fetchedAt: record.fetchedAt,
          changedAt: record.changedAt,
          url: record.url,
          platform: record.platform,
        };
      });
    saveJson(PRICES_KEY, out);
    // Liens FUTBIN : les 2 000 plus récents seulement.
    const keys = Object.keys(links);
    if (keys.length > 2000) {
      const kept = {};
      keys
        .sort((a, b) => (links[b].at || 0) - (links[a].at || 0))
        .slice(0, 2000)
        .forEach((key) => {
          kept[key] = links[key];
        });
      links = kept;
    }
    saveJson(LINKS_KEY, links);
  }, 3000);
};

export const getPriceRecord = (definitionId) => records.get(Number(definitionId)) || null;

// Prix utilisable : connu, pour la bonne plateforme, confirmé il y a moins de maxAgeMs.
// Pendant la vérification d'un saut de prix, on reste prudent : pour acheter, le plus bas des
// deux prix ; pour vendre, le plus haut (jamais d'achat trop cher ni de vente bradée sur un prix faux).
export const currentPrice = (definitionId, maxAgeMs = 5 * 60 * 1000, use = "display") => {
  const record = getPriceRecord(definitionId);
  if (!record || !record.price || record.platform !== pricePlatform()) {
    return 0;
  }
  if (Date.now() - record.fetchedAt > maxAgeMs) {
    return 0;
  }
  const suspect = record.suspect && record.suspect.price;
  if (suspect && use === "buy") {
    return Math.min(record.price, suspect);
  }
  if (suspect && use === "sell") {
    return Math.max(record.price, suspect);
  }
  return record.price;
};

export const priceAgeMs = (definitionId) => {
  const record = getPriceRecord(definitionId);
  return record && record.fetchedAt ? Date.now() - record.fetchedAt : Infinity;
};

// ------------------------------------------------------------- abonnement

// Déclare l'intérêt pour une carte. kind : "hot" (bot, achat SBC) ou "visible" (étiquette).
export const trackPrice = (definitionId, hint, kind = "visible") => {
  const id = Number(definitionId) || 0;
  if (!id) {
    return () => {};
  }
  const entry = interest.get(id) || { hot: 0, visible: 0, hint: {} };
  entry[kind === "hot" ? "hot" : "visible"] += 1;
  entry.hint = Object.assign({}, entry.hint, hint || {});
  interest.set(id, entry);
  ensureTicker();
  schedule(id);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const current = interest.get(id);
    if (!current) {
      return;
    }
    current[kind === "hot" ? "hot" : "visible"] = Math.max(0, current[kind === "hot" ? "hot" : "visible"] - 1);
    if (!current.hot && !current.visible) {
      interest.delete(id);
    }
  };
};

// Demande explicite (ex. mise en vente) : résout le record une fois la lecture faite.
export const requestPrice = (definitionId, hint) => {
  const id = Number(definitionId) || 0;
  if (!id) {
    return Promise.resolve(null);
  }
  const entry = interest.get(id);
  if (entry) {
    entry.hint = Object.assign({}, entry.hint, hint || {});
  }
  return new Promise((resolve) => {
    const list = waiters.get(id) || [];
    list.push(resolve);
    waiters.set(id, list);
    enqueue(id, PRIORITY.request, hint);
  });
};

const settle = (id) => {
  const list = waiters.get(id);
  if (!list) {
    return;
  }
  waiters.delete(id);
  const record = records.get(id) || null;
  list.forEach((resolve) => resolve(record));
};

// ------------------------------------------------------------- planification

const hotInterval = () => Math.min(120, Math.max(60, Number(settings().hotInterval) || 90)) * 1000;
const visibleInterval = () => Math.min(600, Math.max(60, Number(settings().visibleInterval) || 120)) * 1000;

const dueIn = (id, entry, now) => {
  const record = records.get(id);
  if (record && record.nextRetryAt && record.nextRetryAt > now) {
    return record.nextRetryAt - now;
  }
  if (!record || !record.fetchedAt || record.platform !== pricePlatform()) {
    return 0;
  }
  if (record.suspect) {
    // Saut de prix en attente de confirmation : revérifié très vite, quel que soit l'usage.
    return Math.max(0, SUSPECT_RECHECK - (now - record.suspect.at));
  }
  const age = now - record.fetchedAt;
  let maxAge;
  if (entry.hot) {
    maxAge = hotInterval();
  } else {
    const hidden = typeof document !== "undefined" && document.hidden;
    if (hidden) {
      return Infinity;
    }
    const factor = [1, 1, 1.5, 2, 3][Math.min(record.unchanged || 0, 4)];
    maxAge = Math.min(visibleInterval() * factor, MAX_VISIBLE_AGE);
  }
  return Math.max(0, maxAge - age);
};

const schedule = (id) => {
  const entry = interest.get(id);
  if (!entry) {
    return;
  }
  if (dueIn(id, entry, Date.now()) <= 0) {
    enqueue(id, entry.hot ? PRIORITY.hot : PRIORITY.visible, entry.hint);
  }
};

const ensureTicker = () => {
  if (tickTimer) {
    return;
  }
  tickTimer = setInterval(() => {
    interest.forEach((entry, id) => schedule(id));
  }, 1000);
};

const enqueue = (id, priority, hint) => {
  if (inflight.has(id)) {
    return;
  }
  const existing = queue.get(id);
  if (existing) {
    existing.priority = Math.min(existing.priority, priority);
    existing.hint = Object.assign({}, existing.hint, hint || {});
  } else {
    queue.set(id, { id, priority, hint: Object.assign({}, hint || {}), at: Date.now() });
  }
  pump();
};

const nextJob = () => {
  let best = null;
  queue.forEach((job) => {
    if (!best || job.priority < best.priority || (job.priority === best.priority && job.at < best.at)) {
      best = job;
    }
  });
  return best;
};

const gapMs = () => {
  const base = Math.max(0.8, Number(settings().minGap) || 1.5) * 1000;
  return base + Math.random() * 500 + status.backoffMs;
};

const pump = () => {
  if (busy || pumpTimer || !queue.size) {
    return;
  }
  const now = Date.now();
  const waitBlocked = status.blockedUntil > now ? status.blockedUntil - now : 0;
  const waitGap = Math.max(0, lastRequestAt + gapMs() - now);
  const wait = Math.max(waitBlocked, waitGap);
  if (wait > 0) {
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pump();
    }, wait);
    return;
  }
  const job = nextJob();
  if (!job) {
    return;
  }
  queue.delete(job.id);
  inflight.add(job.id);
  busy = true;
  status.state = "fetching";
  processJob(job)
    .catch(() => {})
    .finally(() => {
      inflight.delete(job.id);
      busy = false;
      lastRequestAt = Date.now();
      status.state = queue.size ? "queued" : status.blockedUntil > Date.now() ? "blocked" : "idle";
      settle(job.id);
      pump();
    });
};

const markBlocked = (message) => {
  status.backoffMs = Math.min(Math.max(status.backoffMs * 2, 5000), 60000);
  status.blockedUntil = Date.now() + Math.min(status.backoffMs * 4, 5 * 60 * 1000);
  status.lastError = message;
  status.state = "blocked";
};

const markSuccess = () => {
  status.backoffMs = Math.max(0, Math.floor(status.backoffMs / 2));
  status.lastError = "";
  status.lastSuccessAt = Date.now();
};

const baseRecord = (id) =>
  records.get(id) || { definitionId: id, price: 0, prices: [], fetchedAt: 0, unchanged: 0, failures: 0, suspect: null };

const BLOCKED_MESSAGE = "FUTBIN demande une vérification (Cloudflare) : onglet FUTBIN → « Ouvrir futbin.com »";

const setRecord = (id, record, patch) => {
  records.set(id, Object.assign(record, patch));
  emit(id);
};

// Échec d'une lecture : réessai adapté à la cause (jamais « introuvable » pour une simple erreur réseau).
const handleFailure = (id, record, result, now, link) => {
  if (result.deferred) {
    // Requête directe refusée récemment : les cartes affichées attendent sans rien envoyer.
    setRecord(id, record, { status: "paused", nextRetryAt: Math.max(futbinDirectPausedUntil(), now + ERROR_RETRY) });
  } else if (result.blocked) {
    markBlocked(BLOCKED_MESSAGE);
    setRecord(id, record, { status: "error", nextRetryAt: status.blockedUntil });
  } else if (result.noPrice) {
    setRecord(id, record, { status: "miss", url: link ? link.url : record.url, nextRetryAt: now + NO_PRICE_RETRY });
  } else {
    record.failures = (record.failures || 0) + 1;
    setRecord(id, record, { status: "error", nextRetryAt: now + ERROR_RETRY });
  }
};

const processJob = async (job) => {
  const id = job.id;
  const now = Date.now();
  const record = baseRecord(id);
  // La page FUTBIN cachée (secours) est réservée au bot, aux DCE et aux demandes explicites.
  const options = { allowIframe: job.priority !== PRIORITY.visible };
  let link = links[id];
  if (link && link.miss && link.until > now) {
    setRecord(id, record, { status: "miss", nextRetryAt: link.until });
    return;
  }
  if (!link || link.miss) {
    status.requests += 1;
    const resolved = await resolveFutbinLink(Object.assign({ definitionId: id }, job.hint), options);
    if (!resolved.ok) {
      if (resolved.notFound) {
        links[id] = { miss: true, until: now + MISS_RETRY, at: now };
        setRecord(id, record, { status: "miss", nextRetryAt: now + MISS_RETRY });
        persistSoon();
      } else {
        handleFailure(id, record, resolved, now, null);
      }
      return;
    }
    link = Object.assign({}, resolved.link, { at: now });
    links[id] = link;
    persistSoon();
  }
  status.requests += 1;
  const platform = pricePlatform();
  const result = await fetchFutbinPrice(link, platform, options);
  if (!result.ok) {
    if (result.notFound) {
      delete links[id];
      setRecord(id, record, { status: "error", nextRetryAt: now + ERROR_RETRY });
    } else {
      handleFailure(id, record, result, now, link);
    }
    return;
  }
  // La page lue doit être celle de la carte demandée (identifiant EA déclaré par FUTBIN, s'il existe).
  if (result.pageEaId && result.pageEaId !== id && (result.pageEaId & 0xffffff) !== (id & 0xffffff)) {
    delete links[id];
    persistSoon();
    setRecord(id, record, { status: "error", nextRetryAt: now + ERROR_RETRY });
    return;
  }
  markSuccess();
  applyPrice(id, record, result, link, platform);
};

const applyPrice = (id, record, result, link, platform) => {
  const now = Date.now();
  const guard = Math.max(5, Number(settings().jumpGuard) || 35);
  // Un prix vieux de plus de 30 min (ex. rechargé au démarrage) ne sert pas de référence au garde-fou.
  const previous = record.platform === platform && now - (record.fetchedAt || 0) < STALE_GUARD ? record.price : 0;
  const next = result.price;
  const jump = previous ? (Math.abs(next - previous) / previous) * 100 : 0;
  if (previous && jump > guard) {
    const suspect = record.suspect;
    const confirmed = suspect && Math.abs(next - suspect.price) / suspect.price <= 0.1;
    if (!confirmed) {
      // Saut anormal : le prix confirmé et son âge sont conservés (il vieillit normalement),
      // le nouveau prix est revérifié dans 20 s avant d'être adopté.
      setRecord(id, record, { status: "ok", failures: 0, nextRetryAt: 0, url: link.url, suspect: { price: next, at: now } });
      persistSoon();
      return;
    }
  }
  const changed = next !== previous;
  setRecord(id, record, {
    prices: result.prices,
    updatedAgoSec: result.updatedAgoSec,
    fetchedAt: now,
    url: link.url,
    name: link.name,
    platform,
    status: "ok",
    failures: 0,
    nextRetryAt: 0,
    price: next,
    previous: previous || record.previous || 0,
    changedAt: changed ? now : record.changedAt || now,
    unchanged: changed ? 0 : (record.unchanged || 0) + 1,
    suspect: null,
  });
  persistSoon();
};

// Prix lu ailleurs sur FUTBIN (ex. JSON d'une page d'équipe) : même traitement qu'une lecture de la
// page joueur (garde-fou compris). Le lien FUTBIN fourni évite une recherche au prochain rafraîchissement.
export const seedFutbinPrice = (definitionId, { price, platform, link }) => {
  const id = Number(definitionId) || 0;
  if (!id) {
    return;
  }
  if (link && link.futbinId && (!links[id] || links[id].miss)) {
    links[id] = { futbinId: link.futbinId, url: absoluteUrl(link.url), name: link.name || "", rating: link.rating || 0, at: Date.now() };
    persistSoon();
  }
  if (!isPlausiblePrice(Number(price)) || platform !== pricePlatform()) {
    return;
  }
  const record = baseRecord(id);
  if (record.fetchedAt && Date.now() - record.fetchedAt < 30 * 1000 && record.platform === platform) {
    return; // lecture plus récente de la page joueur
  }
  const target = links[id] && !links[id].miss ? links[id] : { url: record.url || "", name: record.name || "" };
  applyPrice(id, record, { price: Number(price), prices: [Number(price)], updatedAgoSec: null }, target, platform);
};

export const clearFutbinCache = () => {
  links = {};
  records.clear();
  const pending = Array.from(queue.keys());
  queue.clear();
  // Les demandes en attente sont résolues (sans prix) plutôt que laissées sans réponse.
  pending.forEach((id) => settle(id));
  saveJson(LINKS_KEY, links);
  saveJson(PRICES_KEY, {});
  interest.forEach((entry, id) => emit(id));
};

// Utilisé par les tests.
export const resetPriceServiceForTests = () => {
  resetFutbinClientForTests();
  links = {};
  records.clear();
  queue.clear();
  inflight.clear();
  interest.clear();
  waiters.clear();
  busy = false;
  lastRequestAt = 0;
  clearTimeout(pumpTimer);
  pumpTimer = null;
  clearInterval(tickTimer);
  tickTimer = null;
  Object.assign(status, { state: "idle", requests: 0, lastError: "", lastSuccessAt: 0, blockedUntil: 0, backoffMs: 0 });
};
