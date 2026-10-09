import { t } from "../i18n";
import { KIND } from "./errors";
import { isRunning } from "./engine";
import { log } from "./logger";
import { auctionOf, fetchTransferList, relistExpired } from "./market";
import { currentTask } from "./tasks";

// Relist auto pendant que le bot est à l'arrêt : toutes les N minutes (1, 5 ou 10), les cartes
// invendues de la liste des transferts sont remises en vente au même prix (bouton EA « Tout remettre
// en vente » : une requête). Deux requêtes par passage au plus (liste + relist). Tour sauté quand le
// bot tourne (il gère ses propres relists) ou qu'une tâche MagicBuyer est en cours. Arrêt sur
// captcha, session expirée ou blocage EA ; il s'arrête aussi quand l'onglet est fermé.

export const RELIST_INTERVALS = [1, 5, 10];

const state = { active: false, interval: 10, nextAt: 0, timer: null, runs: 0, relisted: 0, lastAt: 0, lastCount: 0, message: "" };
const listeners = new Set();

const emit = () =>
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });

export const onAutoRelistChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const autoRelistState = () => ({
  active: state.active,
  interval: state.interval,
  nextAt: state.nextAt,
  runs: state.runs,
  relisted: state.relisted,
  lastAt: state.lastAt,
  lastCount: state.lastCount,
  message: state.message,
});

const call = (target, method) => {
  try {
    return target && typeof target[method] === "function" ? target[method]() : undefined;
  } catch (e) {
    return undefined;
  }
};

const schedule = () => {
  clearTimeout(state.timer);
  if (!state.active) {
    return;
  }
  state.nextAt = Date.now() + state.interval * 60 * 1000;
  state.timer = setTimeout(run, state.interval * 60 * 1000);
  emit();
};

const stopsRelist = (error) => !!error && [KIND.CAPTCHA, KIND.AUTH, KIND.BANNED, KIND.LOCKED, KIND.RATE, KIND.BLOCKED].includes(error.kind);

// Un passage : invendues relistées au même prix ; refresh = rafraîchir la liste EA affichée.
export const runAutoRelistOnce = async ({ refresh = () => {} } = {}) => {
  if (isRunning() || currentTask()) {
    return { ok: true, skipped: true, count: 0 };
  }
  const list = await fetchTransferList();
  if (!list.ok) {
    return { ok: false, error: list.error, count: 0 };
  }
  const expired = list.items.filter((item) => call(auctionOf(item), "isExpired"));
  if (!expired.length) {
    return { ok: true, count: 0 };
  }
  const result = await relistExpired();
  if (!result.ok) {
    return { ok: false, error: result.error, count: 0 };
  }
  try {
    refresh();
  } catch (e) {}
  return { ok: true, count: expired.length };
};

let refresher = () => {};
export const setAutoRelistRefresher = (fn) => {
  refresher = fn;
};

const run = async () => {
  if (!state.active) {
    return;
  }
  const result = await runAutoRelistOnce({ refresh: refresher });
  if (!state.active) {
    return;
  }
  state.runs += 1;
  state.lastAt = Date.now();
  if (!result.ok) {
    state.message = t("lists.relistFailed", { error: (result.error && result.error.label) || "?" });
    log.warn(state.message);
    if (stopsRelist(result.error)) {
      stopAutoRelist(state.message);
      return;
    }
  } else if (result.skipped) {
    state.message = t("lists.relistSkipped");
  } else {
    state.lastCount = result.count;
    state.relisted += result.count;
    state.message = result.count ? t("lists.relistDone", { n: result.count }) : t("lists.relistNothing");
    if (result.count) {
      log.success(state.message);
    }
  }
  schedule();
};

export const startAutoRelist = (minutes = 10) => {
  const interval = RELIST_INTERVALS.includes(Number(minutes)) ? Number(minutes) : 10;
  state.active = true;
  state.interval = interval;
  state.message = "";
  log.info(t("lists.relistStarted", { n: interval }));
  // Premier passage tout de suite : les invendues du moment sont relistées.
  clearTimeout(state.timer);
  state.timer = setTimeout(run, 50);
  state.nextAt = Date.now();
  emit();
};

export const stopAutoRelist = (reason = "") => {
  if (!state.active) {
    return;
  }
  state.active = false;
  clearTimeout(state.timer);
  state.timer = null;
  state.nextAt = 0;
  state.message = reason;
  log.info(reason ? t("lists.relistStoppedWhy", { reason }) : t("lists.relistStopped"));
  emit();
};

// Utilisé par les tests.
export const resetAutoRelistForTests = () => {
  clearTimeout(state.timer);
  Object.assign(state, { active: false, interval: 10, nextAt: 0, timer: null, runs: 0, relisted: 0, lastAt: 0, lastCount: 0, message: "" });
};
