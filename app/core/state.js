import { t } from "../i18n";

// État d'exécution partagé entre le moteur et l'interface (non persistant).

export const STATUS = {
  IDLE: "idle",
  STARTING: "starting",
  RUNNING: "running",
  PAUSED: "paused",
  AUTO_PAUSE: "auto-pause",
  COOLDOWN: "cooldown",
  STOPPING: "stopping",
  STOPPED: "stopped",
};

const STATUS_KEYS = {
  idle: "ui.statusIdle",
  starting: "ui.statusStarting",
  running: "ui.statusRunning",
  paused: "ui.statusPaused",
  "auto-pause": "ui.statusAutoPause",
  cooldown: "ui.statusCooldown",
  stopping: "ui.statusStopping",
  stopped: "ui.statusStopped",
};

// Libellé affiché d'un état, dans la langue de l'interface ("" si l'état est inconnu).
export const statusLabel = (status) => (STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : "");

// Compatibilité : STATUS_LABEL[status] lit le libellé dans la langue du moment.
export const STATUS_LABEL = Object.keys(STATUS_KEYS).reduce(
  (labels, status) => Object.defineProperty(labels, status, { enumerable: true, get: () => statusLabel(status) }),
  {}
);

const emptyStats = () => ({
  searches: 0,
  requests: 0,
  results: 0,
  deals: 0,
  attempts: 0,
  won: 0,
  missed: 0,
  bids: 0,
  bidsWon: 0,
  spent: 0,
  listed: 0,
  estProfit: 0,
  soldCount: 0,
  soldValue: 0,
  salesSeen: 0,
  salesValue: 0,
  salesKnown: 0,
  realProfit: 0,
  errors: 0,
  lastLatency: 0,
  avgLatency: 0,
});

const state = {
  status: STATUS.IDLE,
  detail: "",
  startedAt: 0,
  stoppedAt: 0,
  nextSearchAt: 0,
  waitStartedAt: 0,
  pauseUntil: 0,
  filterName: "",
  coins: 0,
  transfer: null,
  stats: emptyStats(),
};

const listeners = new Set();
let scheduled = false;

const flush = () => {
  scheduled = false;
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch (e) {}
  });
};

const notify = () => {
  if (scheduled) {
    return;
  }
  scheduled = true;
  Promise.resolve().then(flush);
};

export const getState = () => state;

export const updateState = (patch) => {
  Object.assign(state, patch);
  notify();
};

export const bumpStat = (key, amount = 1) => {
  state.stats[key] = (state.stats[key] || 0) + amount;
  notify();
};

export const setStat = (key, value) => {
  state.stats[key] = value;
  notify();
};

// Bilan par filtre de la session en cours (remis à zéro au démarrage du bot, comme les KPI).
const filterStats = new Map();

export const bumpFilterStat = (filterId, key, amount = 1) => {
  if (!filterId) {
    return;
  }
  const entry = filterStats.get(filterId) || { searches: 0, won: 0, missed: 0, spent: 0, estProfit: 0 };
  entry[key] = (entry[key] || 0) + amount;
  filterStats.set(filterId, entry);
  notify();
};

export const filterStatsFor = (filterId) => filterStats.get(filterId) || null;

export const resetStats = () => {
  filterStats.clear();
  state.stats = emptyStats();
  searchTimes.length = 0;
  notify();
};

export const onStateChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Recherches sur la dernière minute (fenêtre glissante).
const searchTimes = [];

export const recordSearch = (latencyMs) => {
  const now = Date.now();
  searchTimes.push(now);
  while (searchTimes.length && now - searchTimes[0] > 60000) {
    searchTimes.shift();
  }
  const stats = state.stats;
  stats.searches += 1;
  stats.lastLatency = Math.round(latencyMs || 0);
  stats.avgLatency = stats.avgLatency
    ? Math.round(stats.avgLatency * 0.85 + stats.lastLatency * 0.15)
    : stats.lastLatency;
  notify();
};

export const searchesLastMinute = () => {
  const now = Date.now();
  return searchTimes.filter((t) => now - t <= 60000).length;
};

export const lastSearchAt = () =>
  searchTimes.length ? searchTimes[searchTimes.length - 1] : 0;

// ---------------------------------------------------------------- Journal

const MAX_LOGS = 400;
const logs = [];
const logListeners = new Set();
let logSeq = 0;

export const LOG_TYPES = ["info", "success", "warning", "error", "buy", "search"];

export const addLog = (type, text, meta) => {
  const entry = {
    id: (logSeq += 1),
    time: Date.now(),
    type: LOG_TYPES.includes(type) ? type : "info",
    text: String(text == null ? "" : text),
    meta: meta || null,
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  logListeners.forEach((fn) => {
    try {
      fn(entry, logs);
    } catch (e) {}
  });
  return entry;
};

export const getLogs = () => logs;

export const clearLogs = () => {
  logs.length = 0;
  logListeners.forEach((fn) => {
    try {
      fn(null, logs);
    } catch (e) {}
  });
};

export const onLog = (fn) => {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
};

// Historique des transactions (export CSV).
const transactions = [];

export const recordTransaction = (entry) => {
  transactions.push(Object.assign({ time: Date.now() }, entry));
  if (transactions.length > 2000) {
    transactions.shift();
  }
};

export const getTransactions = () => transactions;
