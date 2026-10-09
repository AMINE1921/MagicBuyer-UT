import { t } from "../i18n";
import { log } from "./logger";
import { eaToast, itemService } from "./page";
import { getSettings } from "./settings";
import { loadJson, saveJson } from "./storage";

// Compteur des requêtes envoyées au marché des transferts EA : recherches (bot et recherches
// faites à la main dans le web app) et achats / enchères. Compté par minute sur 24 h glissantes,
// gardé au rechargement de la page. Au-delà des limites (réglables) : alerte, et pause du bot si
// la pause automatique est activée. EA sanctionne les comptes qui cherchent trop (recherches
// bloquées temporairement), d'où des limites prudentes par défaut.

const STORAGE_KEY = "usage";
const DAY_MINUTES = 24 * 60;

// minute (depuis l'époque) → [recherches bot, recherches manuelles, achats / enchères]
let buckets = {};
let botDepth = 0;
let saveTimer = null;
let hooked = null;
const warned = { hour: 0, day: 0 };
const listeners = new Set();

(() => {
  const stored = loadJson(STORAGE_KEY, {}) || {};
  const oldest = Math.floor(Date.now() / 60000) - DAY_MINUTES;
  Object.keys(stored).forEach((key) => {
    if (Number(key) > oldest && Array.isArray(stored[key])) {
      buckets[key] = stored[key].slice(0, 3).map((n) => Number(n) || 0);
    }
  });
})();

const currentMinute = () => Math.floor(Date.now() / 60000);

const prune = () => {
  const oldest = currentMinute() - DAY_MINUTES;
  Object.keys(buckets).forEach((key) => {
    if (Number(key) <= oldest) {
      delete buckets[key];
    }
  });
};

const persistSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    prune();
    saveJson(STORAGE_KEY, buckets);
  }, 5000);
};

const limits = () => {
  const usage = getSettings().usage || {};
  return {
    hour: Math.max(50, Number(usage.hourLimit) || 900),
    day: Math.max(200, Number(usage.dayLimit) || 4500),
    autoPause: !!usage.autoPause,
  };
};

// Totaux sur les N dernières minutes.
const totals = (minutes) => {
  const from = currentMinute() - minutes;
  const out = { bot: 0, manual: 0, searches: 0, bids: 0 };
  Object.keys(buckets).forEach((key) => {
    if (Number(key) > from) {
      const [bot, manual, bids] = buckets[key];
      out.bot += bot;
      out.manual += manual;
      out.bids += bids;
    }
  });
  out.searches = out.bot + out.manual;
  return out;
};

export const usageStats = () => {
  const limit = limits();
  const hour = totals(60);
  const day = totals(DAY_MINUTES);
  return {
    hour,
    day,
    minute: totals(1),
    limits: limit,
    hourRatio: hour.searches / limit.hour,
    dayRatio: day.searches / limit.day,
  };
};

// Pause automatique demandée : limite horaire ou journalière atteinte.
export const usageBlocked = () => {
  const stats = usageStats();
  if (!stats.limits.autoPause) {
    return null;
  }
  if (stats.day.searches >= stats.limits.day) {
    return { scope: "day", count: stats.day.searches, limit: stats.limits.day };
  }
  if (stats.hour.searches >= stats.limits.hour) {
    return { scope: "hour", count: stats.hour.searches, limit: stats.limits.hour };
  }
  return null;
};

// Texte d'arrêt pour les tâches (achats DCE / galerie, prix min EA…) quand la pause auto est demandée
// et la limite atteinte ; "" sinon.
export const usageLimitMessage = () => {
  const blocked = usageBlocked();
  return blocked ? t(blocked.scope === "day" ? "tools.usageStopDay" : "tools.usageStopHour", { count: blocked.count, limit: blocked.limit }) : "";
};

// Temps d'attente (ms) avant de repasser sous la limite horaire (recherches les plus anciennes sorties).
export const usageWaitMs = () => {
  const stats = usageStats();
  if (stats.hour.searches < stats.limits.hour && stats.day.searches < stats.limits.day) {
    return 0;
  }
  const scope = stats.day.searches >= stats.limits.day ? DAY_MINUTES : 60;
  const limit = scope === 60 ? stats.limits.hour : stats.limits.day;
  const from = currentMinute() - scope;
  let excess = (scope === 60 ? stats.hour.searches : stats.day.searches) - limit + 1;
  const keys = Object.keys(buckets)
    .map(Number)
    .filter((key) => key > from)
    .sort((a, b) => a - b);
  for (const key of keys) {
    excess -= buckets[key][0] + buckets[key][1];
    if (excess <= 0) {
      return Math.max(60000, (key + scope + 1) * 60000 - Date.now());
    }
  }
  return 60000;
};

export const onUsageChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const warnIfNeeded = () => {
  const stats = usageStats();
  const now = Date.now();
  const check = (scope, count, limit) => {
    if (count < limit * 0.9 || now - warned[scope] < 30 * 60 * 1000) {
      return;
    }
    warned[scope] = now;
    const key = count >= limit ? `tools.usageReached_${scope}` : `tools.usageNear_${scope}`;
    const text = t(key, { count, limit });
    log.warn(text);
    eaToast(`MagicBuyer : ${text}`, true);
  };
  check("hour", stats.hour.searches, stats.limits.hour);
  check("day", stats.day.searches, stats.limits.day);
};

// Recherches à la main enchaînées trop vite (3 en moins de 500 ms) : avertissement (10 s d'écart).
const recentManual = [];
let burstWarnedAt = 0;
export const BURST_COUNT = 3;
export const BURST_WINDOW = 500;

export const manualBurst = (now = Date.now()) => {
  while (recentManual.length && now - recentManual[0] > BURST_WINDOW) {
    recentManual.shift();
  }
  return recentManual.length >= BURST_COUNT;
};

const watchBurst = () => {
  const now = Date.now();
  recentManual.push(now);
  if (recentManual.length > 10) {
    recentManual.shift();
  }
  if (!manualBurst(now) || now - burstWarnedAt < 10000) {
    return;
  }
  burstWarnedAt = now;
  if ((getSettings().usage || {}).burstWarning !== false) {
    const text = t("tools.usageBurst", { count: BURST_COUNT, ms: BURST_WINDOW });
    log.warn(text);
    eaToast(`MagicBuyer : ${text}`, true);
  }
};

const bump = (index) => {
  const key = currentMinute();
  if (index === 1) {
    watchBurst();
  }
  if (!buckets[key]) {
    buckets[key] = [0, 0, 0];
  }
  buckets[key][index] += 1;
  persistSoon();
  if (index !== 2) {
    warnIfNeeded();
  }
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });
};

// Le bot passe ses appels EA par ici : les recherches faites pendant l'appel sont comptées « bot ».
export const asBot = (fn) => {
  botDepth += 1;
  try {
    return fn();
  } finally {
    botDepth -= 1;
  }
};

// Appel EA en cours lancé par le bot ou une tâche MagicBuyer (sinon : recherche faite à la main).
export const inBotCall = () => botDepth > 0;

export const recordSearch = () => bump(botDepth > 0 ? 0 : 1);
export const recordBid = () => bump(2);

// Enveloppe services.Item.searchTransferMarket et bid (une fois par instance du service EA).
export const hookUsage = () => {
  const svc = itemService();
  if (!svc || hooked === svc) {
    return !!svc;
  }
  const wrap = (name, record) => {
    const original = svc[name];
    if (typeof original !== "function" || original.__mbUsage) {
      return;
    }
    const wrapped = function () {
      try {
        record();
      } catch (e) {}
      return original.apply(this, arguments);
    };
    wrapped.__mbUsage = true;
    svc[name] = wrapped;
  };
  wrap("searchTransferMarket", recordSearch);
  wrap("bid", recordBid);
  hooked = svc;
  return true;
};

// Utilisé par les tests.
export const resetUsageForTests = () => {
  buckets = {};
  botDepth = 0;
  hooked = null;
  warned.hour = 0;
  warned.day = 0;
  clearTimeout(saveTimer);
};
