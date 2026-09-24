import { loadJson, saveJson } from "./storage";

export const TIMING_PRESETS = {
  prudent: {
    label: "Prudent",
    hint: "Rythme lent, pauses longues : le moins risqué pour le compte.",
    values: {
      wait: "8-14",
      maxPerMinute: 6,
      pauseEvery: "12-18",
      pauseFor: "60-120S",
      stopAfter: "1-2H",
    },
  },
  normal: {
    label: "Normal",
    hint: "Bon compromis entre réactivité et discrétion.",
    values: {
      wait: "5-9",
      maxPerMinute: 10,
      pauseEvery: "15-25",
      pauseFor: "40-80S",
      stopAfter: "2-3H",
    },
  },
  rapide: {
    label: "Rapide",
    hint: "Snipe très réactif, mais captchas et blocages EA plus fréquents.",
    values: {
      wait: "3-5",
      maxPerMinute: 15,
      pauseEvery: "20-30",
      pauseFor: "30-60S",
      stopAfter: "1-1.5H",
    },
  },
};

export const DEFAULT_SETTINGS = {
  buy: {
    maxPerSearch: 1,
    stopAfterPurchases: 0,
    coinsReserve: 0,
    maxResults: 0,
    skipGk: false,
  },
  bid: {
    enabled: false,
    exact: false,
    expiresWithin: "5M",
    maxPerSearch: 1,
    maxActive: 10,
    searchEvery: 3,
    rebid: true,
    clearLost: true,
  },
  sell: {
    mode: "list",
    priceMode: "fixed",
    defaultPrice: 0,
    futbinPercent: "99-100",
    duration: "1H",
    minProfit: 0,
    maxRating: 0,
  },
  timing: {
    preset: "normal",
    wait: "5-9",
    maxPerMinute: 10,
    pauseEvery: "15-25",
    pauseFor: "40-80S",
    stopAfter: "2-3H",
    afterBuy: "2-4S",
    cacheBuster: "auto",
    cacheBusterMax: 1000,
    maxPages: 1,
    keepAlive: true,
  },
  errors: {
    cooldown: "4-8M",
    maxCooldowns: 3,
    maxConsecutiveFailures: 3,
    stopCodes: "",
  },
  transfer: {
    checkEvery: 8,
    relistExpired: false,
    relistMode: "same",
    clearSoldAt: 10,
    stopWhenFull: true,
  },
  notify: {
    sound: true,
    volume: 0.6,
    desktop: false,
    discordWebhook: "",
    telegramToken: "",
    telegramChatId: "",
    onBuy: true,
    onFail: false,
    onList: false,
    onStop: true,
  },
  prices: {
    platform: "auto",
    hotInterval: 90,
    visibleInterval: 120,
    jumpGuard: 35,
    minGap: 1.5,
    iframeFallback: true,
  },
  sbc: {
    margin: 5,
    triesPerPlayer: 6,
    wait: "3-5",
  },
  meta: {
    migrations: [],
  },
  ui: {
    cardPrices: true,
    panelOpen: false,
    logHeight: 34,
    logFilter: "all",
    activeTab: "target",
  },
};

const STORAGE_KEY = "settings";

const isPlainObject = (value) =>
  value != null && typeof value === "object" && !Array.isArray(value);

const deepMerge = (base, patch) => {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (!isPlainObject(patch)) {
    return out;
  }
  Object.keys(patch).forEach((key) => {
    const baseValue = base ? base[key] : undefined;
    const patchValue = patch[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      out[key] = deepMerge(baseValue, patchValue);
    } else if (patchValue !== undefined) {
      out[key] = patchValue;
    }
  });
  return out;
};

let current = deepMerge(DEFAULT_SETTINGS, loadJson(STORAGE_KEY, {}));
const listeners = new Set();
let saveTimer = null;

const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveJson(STORAGE_KEY, current), 250);
};

export const getSettings = () => current;

export const getSetting = (path) =>
  String(path)
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), current);

export const setSetting = (path, value) => {
  const keys = String(path).split(".");
  const next = deepMerge(current, {});
  let cursor = next;
  keys.slice(0, -1).forEach((key) => {
    cursor[key] = isPlainObject(cursor[key]) ? Object.assign({}, cursor[key]) : {};
    cursor = cursor[key];
  });
  const last = keys[keys.length - 1];
  if (cursor[last] === value) {
    return;
  }
  cursor[last] = value;
  current = next;
  persist();
  listeners.forEach((fn) => {
    try {
      fn(current, path);
    } catch (e) {}
  });
};

export const applyTimingPreset = (name) => {
  const preset = TIMING_PRESETS[name];
  if (!preset) {
    return;
  }
  Object.keys(preset.values).forEach((key) =>
    setSetting(`timing.${key}`, preset.values[key])
  );
  setSetting("timing.preset", name);
};

export const onSettingsChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const resetSettings = () => {
  current = deepMerge(DEFAULT_SETTINGS, {});
  persist();
  listeners.forEach((fn) => {
    try {
      fn(current, "*");
    } catch (e) {}
  });
};

export const flushSettings = () => {
  clearTimeout(saveTimer);
  saveJson(STORAGE_KEY, current);
};
