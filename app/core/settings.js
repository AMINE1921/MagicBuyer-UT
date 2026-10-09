import { loadJson, saveJson } from "./storage";

// Profils de timing. Libellés : clés de traduction (app/i18n/ui.js), lues au rendu par l'interface.
export const TIMING_PRESETS = {
  prudent: {
    labelKey: "ui.presetPrudent",
    hintKey: "ui.presetPrudentHint",
    values: {
      wait: "8-14",
      maxPerMinute: 6,
      pauseEvery: "12-18",
      pauseFor: "60-120S",
      stopAfter: "1-2H",
    },
  },
  normal: {
    labelKey: "ui.presetNormal",
    hintKey: "ui.presetNormalHint",
    values: {
      wait: "5-9",
      maxPerMinute: 10,
      pauseEvery: "15-25",
      pauseFor: "40-80S",
      stopAfter: "2-3H",
    },
  },
  rapide: {
    labelKey: "ui.presetRapide",
    hintKey: "ui.presetRapideHint",
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
    profitCheck: true,
    // Bénéfice minimum exigé à l'achat (anti-perte avant l'achat). 0 : celui de l'onglet Vente.
    minProfit: 0,
    fallingGuard: 5,
    // Filtres « prix marché EA » : prix relu toutes les N minutes (3 à 60) et après chaque achat.
    marketRefreshMinutes: 10,
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
    noLoss: true,
    noLossOwnCards: true,
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
    onStart: false,
    onSold: true,
    onListFail: true,
    summaryMinutes: 0,
  },
  prices: {
    // "api" : API de l'appli FUTBIN (futbin.org) puis pages futbin.com en secours ; "pages" : pages seules.
    source: "api",
    platform: "auto",
    hotInterval: 90,
    visibleInterval: 120,
    jumpGuard: 35,
    minGap: 1.5,
    iframeFallback: true,
    listInterval: 180,
    listPages: 3,
  },
  // Scanner de prime holo (onglet FUTBIN) : promo (rareté EA, 3 = TOTW) et tranche de prix des holo.
  holo: {
    rarity: 3,
    minPrice: 10000,
    maxPrice: 60000,
  },
  sbc: {
    margin: 5,
    triesPerPlayer: 6,
    wait: "3-5",
    hidden: [],
    squadValue: true,
    softBanAlert: true,
    excludeActiveSquad: true,
    excludeEvolved: true,
  },
  // Aides sur le marché et le club (onglet Outils).
  tools: {
    bargain: true,
    bargainPercent: 90,
    boughtFor: true,
    lowestBinSearches: 6,
    clubMinRating: 0,
    clubMaxRating: 0,
    clubMinPrice: 0,
    clubMaxPrice: 0,
    quickSellMaxRating: 0,
    exportPrices: false,
    buyCheck: true,
  },
  hotkeys: {
    enabled: true,
    hints: true,
    lossGuard: true,
    bindings: {},
  },
  // Compteur de requêtes envoyées au marché EA (bot + recherches à la main).
  usage: {
    hourLimit: 900,
    dayLimit: 4500,
    autoPause: false,
    burstWarning: true,
    sbcHourLimit: 90,
    sbcDayLimit: 300,
  },
  packs: {
    duplicatesToStorage: true,
    toTransferMin: 1000,
    quickSellMaxRating: 0,
    max: 10,
    redeemMisc: true,
    untradeableDuplicates: "quickSell",
    skipAnimation: false,
  },
  // Résultats du marché (recherches à la main) : cartes masquées, tri, affaires, sélection auto.
  results: {
    hideOwned: false,
    hideLeagues: [],
    hideNations: [],
    hideClubs: [],
    hidePositions: [],
    hideRarities: [],
    hideStyles: [],
    sort: "none",
    onlyBargains: false,
    bidBargains: false,
    autoSelect: "none",
  },
  // Listes EA (transferts, non attribués, objectifs) : mise en vente groupée, totaux, relist auto.
  lists: {
    totals: true,
    bulkMode: "percent",
    bulkPercent: "100",
    bulkSteps: 0,
    bulkFixed: 0,
    bulkDuration: "1H",
    bulkDelay: "3-5",
    relistInterval: 10,
  },
  // Choix de joueurs (packs « choix ») : meilleure carte mise en avant (le choix reste manuel).
  picks: {
    highlight: true,
    priority: "price",
  },
  // Solveur DCE à partir du club (module solveur).
  solver: {
    excludeActiveSquad: true,
    excludeEvolved: true,
    excludeFavorites: true,
    onlyUntradeables: false,
    preferUntradeables: true,
    preferStorage: true,
    useStorage: true,
    useMarket: true,
    maxRating: 0,
    maxPrice: 0,
  },
  // Galerie : achat des manquants (paliers de prix entre deux % du prix FUTBIN, essais, attente),
  // revente après achat (garder, même prix, % FUTBIN), tuiles et pastille « collectée ».
  gallery: {
    useStorage: true,
    buyRange: "85-100",
    retries: 3,
    wait: "2-4",
    sellMode: "keep",
    sellPercent: "100",
    homeTile: true,
    clubTile: true,
    collectedBadge: true,
  },
  meta: {
    migrations: [],
  },
  ui: {
    language: "auto",
    cardPrices: true,
    itemScoreBadge: true,
    panelOpen: false,
    dockPanel: true,
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
