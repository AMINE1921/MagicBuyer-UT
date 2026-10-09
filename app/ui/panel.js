import { SOLVER_STYLES } from "./solverStyles";
import { VERSION } from "../config";
import { isFinalizing, isPaused, isRunning, isStopping, pauseBot, resumeBot, startBot, stopBot } from "../core/engine";
import { describeFilter, getActiveFilter, onFiltersChange, runnableFilters } from "../core/filters";
import { formatCoins } from "../core/prices";
import { formatDuration } from "../core/ranges";
import { getSettings, onSettingsChange, setSetting } from "../core/settings";
import {
  STATUS,
  clearLogs,
  getLogs,
  getState,
  getTransactions,
  onLog,
  onStateChange,
  searchesLastMinute,
  statusLabel,
} from "../core/state";
import { gameLanguage, language, locale, t } from "../i18n";
import { escapeHtml, formatTime, qs, qsa, setText, toggleClass } from "./dom";
import { bindFields, refreshFields } from "./fields";
import {
  alertsPageHtml,
  bindSettingsPages,
  buyPageHtml,
  refreshLanguageField,
  refreshTransferStats,
  sellPageHtml,
  timingPageHtml,
  transferPageHtml,
} from "./pages/settingsPages";
import { bindFutbinPage, futbinPageHtml, refreshFutbinStatus } from "./pages/futbinPage";
import { bindTargetPage, sellExtra, targetPageHtml } from "./pages/target";
import { bindToolsPage, refreshToolsPage, toolsPageHtml } from "./pages/toolsPage";
import { STYLES } from "./styles";

// Libellés lus au rendu : le panneau est reconstruit quand la langue de l'interface change.
const TABS = [
  { id: "target", label: () => t("ui.tabTarget"), html: targetPageHtml },
  { id: "buy", label: () => t("ui.tabBuy"), html: buyPageHtml },
  { id: "sell", label: () => t("ui.tabSell"), html: sellPageHtml },
  { id: "timing", label: () => t("ui.tabTiming"), html: timingPageHtml },
  { id: "transfer", label: () => t("ui.tabTransfer"), html: transferPageHtml },
  { id: "futbin", label: () => "FUTBIN", html: futbinPageHtml },
  { id: "tools", label: () => t("tools.tab"), html: toolsPageHtml },
  { id: "alerts", label: () => t("ui.tabAlerts"), html: alertsPageHtml },
];

const LOG_ICONS = { search: "🔎", buy: "✅", success: "✔️", warning: "⚠️", error: "⛔", info: "•" };
// [filtre, clé du libellé]
const LOG_FILTERS = [
  ["all", "ui.logAll"],
  ["quiet", "ui.logQuiet"],
  ["buys", "ui.logBuys"],
  ["alerts", "ui.logAlerts"],
];

let root = null;
let ticker = null;
// Abonnements globaux du panneau : remplacés (jamais cumulés) si le panneau est recréé.
let unsubscribers = [];
// Langue de l'interface (et langue du compte FC) utilisées pour construire le panneau.
let builtLanguage = "";
let builtGameLanguage = "";

export const injectStyles = () => {
  if (document.getElementById("mb-styles")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "mb-styles";
  style.textContent = STYLES + SOLVER_STYLES;
  (document.head || document.documentElement).appendChild(style);
};

const shellHtml = () => `
  <aside class="mb-panel" role="complementary" aria-label="MagicBuyer">
    <header class="mb-head">
      <div class="mb-logo">MB</div>
      <div class="mb-title"><strong>MagicBuyer</strong><small>${t("ui.subtitle", { version: VERSION })}</small></div>
      <button type="button" class="mb-icon-btn" data-action="close" aria-label="${escapeHtml(t("ui.closePanel"))}" title="${escapeHtml(t("ui.close"))}">×</button>
    </header>
    <div class="mb-bar">
      <div class="mb-state" data-state data-status="idle">
        <span class="mb-dot"></span>
        <span class="mb-state-text"><b data-state-label>${statusLabel(STATUS.IDLE)}</b><small data-state-detail></small></span>
      </div>
      <button type="button" class="mb-btn mb-btn-start" data-action="start">▶ ${t("ui.start")}</button>
      <button type="button" class="mb-btn mb-btn-pause" data-action="pause" hidden>❚❚ ${t("ui.pause")}</button>
      <button type="button" class="mb-btn mb-btn-stop" data-action="stop" hidden>■ ${t("ui.stop")}</button>
    </div>
    <div class="mb-kpis">
      <div class="mb-kpi"><span>${t("ui.kpiSearches")}</span><strong data-kpi="searches">0</strong></div>
      <div class="mb-kpi"><span>${t("ui.kpiRate")}</span><strong data-kpi="rate">0</strong></div>
      <div class="mb-kpi is-good"><span>${t("ui.kpiPurchases")}</span><strong data-kpi="won">0</strong></div>
      <div class="mb-kpi"><span>${t("ui.kpiMissed")}</span><strong data-kpi="missed">0</strong></div>
      <div class="mb-kpi"><span>${t("ui.kpiSpent")}</span><strong data-kpi="spent">0</strong></div>
      <div class="mb-kpi"><span>${t("ui.kpiProfit")}</span><strong data-kpi="profit">0</strong><small data-kpi="real" hidden></small></div>
      <div class="mb-kpi"><span>${t("ui.kpiCoins")}</span><strong data-kpi="coins">—</strong></div>
      <div class="mb-kpi"><span>${t("ui.kpiTime")}</span><strong data-kpi="time">00:00:00</strong></div>
    </div>
    <div class="mb-next" aria-hidden="true"><div class="mb-next-fill" data-next-fill></div><span class="mb-next-label" data-next-label>${t("ui.ready")}</span></div>
    <nav class="mb-tabs" role="tablist">
      ${TABS.map((tab) => `<button type="button" class="mb-tab" role="tab" data-tab="${tab.id}">${tab.label()}</button>`).join("")}
    </nav>
    <div class="mb-body" data-body>
      ${TABS.map((tab) => `<div class="mb-page" role="tabpanel" data-page="${tab.id}">${tab.html()}</div>`).join("")}
    </div>
    <section class="mb-log" data-log>
      <div class="mb-log-resize" data-log-resize title="${escapeHtml(t("ui.logResize"))}"></div>
      <div class="mb-log-head">
        <strong>${t("ui.log")}</strong>
        ${LOG_FILTERS.map(([id, key]) => `<button type="button" class="mb-log-filter" data-log-filter="${id}">${t(key)}</button>`).join("")}
        <button type="button" class="mb-icon-btn" data-action="export" title="${escapeHtml(t("ui.exportTitle"))}" aria-label="${escapeHtml(t("ui.export"))}">⇩</button>
        <button type="button" class="mb-icon-btn" data-action="clear-log" title="${escapeHtml(t("ui.clearLog"))}" aria-label="${escapeHtml(t("ui.clearLog"))}">⌫</button>
        <button type="button" class="mb-icon-btn" data-action="collapse-log" title="${escapeHtml(t("ui.collapseTitle"))}" aria-label="${escapeHtml(t("ui.collapseLog"))}">▾</button>
      </div>
      <ol class="mb-log-list" data-log-list aria-live="polite"></ol>
    </section>
  </aside>
`;

// ------------------------------------------------------------------ journal

const logMatches = (entry, filter) => {
  if (filter === "quiet") {
    return entry.type !== "search";
  }
  if (filter === "buys") {
    return entry.type === "buy" || entry.type === "success";
  }
  if (filter === "alerts") {
    return entry.type === "warning" || entry.type === "error";
  }
  return true;
};

const logEntryHtml = (entry) =>
  `<li class="mb-log-entry t-${entry.type}" data-log-id="${entry.id}"><time>${formatTime(entry.time)}</time><i>${LOG_ICONS[entry.type] || "•"}</i><p>${escapeHtml(entry.text)}</p></li>`;

const renderLogs = () => {
  const list = qs(root, "[data-log-list]");
  const filter = getSettings().ui.logFilter || "all";
  list.innerHTML = getLogs()
    .filter((entry) => logMatches(entry, filter))
    .slice(-250)
    .map(logEntryHtml)
    .join("");
  list.scrollTop = list.scrollHeight;
  qsa(root, "[data-log-filter]").forEach((btn) => toggleClass(btn, "is-active", btn.dataset.logFilter === filter));
};

// Rendu du journal regroupé à la prochaine image : écrire un log ne coûte rien au moteur
// (aucune mise en page forcée entre une recherche et l'achat qui suit).
let pendingLogs = [];
let logFrame = 0;

const flushLogs = () => {
  logFrame = 0;
  if (!root) {
    pendingLogs = [];
    return;
  }
  const entries = pendingLogs;
  pendingLogs = [];
  if (entries.includes(null)) {
    renderLogs();
    return;
  }
  const filter = getSettings().ui.logFilter || "all";
  const html = entries.filter((entry) => logMatches(entry, filter)).map(logEntryHtml).join("");
  if (!html) {
    return;
  }
  const list = qs(root, "[data-log-list]");
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  list.insertAdjacentHTML("beforeend", html);
  while (list.children.length > 250) {
    list.removeChild(list.firstChild);
  }
  if (nearBottom) {
    list.scrollTop = list.scrollHeight;
  }
};

const appendLog = (entry) => {
  pendingLogs.push(entry);
  if (!logFrame) {
    logFrame =
      typeof requestAnimationFrame === "function" && !document.hidden
        ? requestAnimationFrame(flushLogs)
        : setTimeout(flushLogs, 50);
  }
};

const exportCsv = () => {
  const rows = [
    [t("ui.csvTime"), t("ui.csvType"), t("ui.csvCard"), t("ui.csvRating"), t("ui.csvPrice"), t("ui.csvProfit"), t("ui.csvFilter")],
  ];
  getTransactions().forEach((tx) =>
    rows.push([
      new Date(tx.time).toLocaleString(locale()),
      tx.type,
      tx.name,
      tx.rating || "",
      tx.price || "",
      tx.profit || "",
      tx.filter || "",
    ])
  );
  const stats = getState().stats;
  rows.push([]);
  rows.push([
    t("ui.csvSearches"),
    stats.searches,
    t("ui.csvPurchases"),
    stats.won,
    t("ui.csvSpent"),
    stats.spent,
    t("ui.csvEstProfit"),
    stats.estProfit,
  ]);
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell == null ? "" : cell).replace(/"/g, '""')}"`).join(";"))
    .join("\n");
  const link = document.createElement("a");
  link.href = `data:text/csv;charset=utf-8,%EF%BB%BF${encodeURIComponent(csv)}`;
  link.download = `magicbuyer-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

// --------------------------------------------------------------- affichage

const stateDetail = (state) => {
  if (state.status === STATUS.IDLE || state.status === STATUS.STOPPED) {
    if (state.detail) {
      return state.detail;
    }
    const filters = runnableFilters();
    return filters.length > 1 ? t("ui.filtersReady", { n: filters.length }) : describeFilter(getActiveFilter());
  }
  if (state.status === STATUS.PAUSED) {
    return t("ui.pausedHint");
  }
  return state.filterName || describeFilter(getActiveFilter());
};

const nextLabel = (state, now) => {
  const remaining = Math.max(0, (state.nextSearchAt || 0) - now);
  if (state.status === STATUS.AUTO_PAUSE) {
    return t("ui.nextAutoPause", { duration: formatDuration(remaining) });
  }
  if (state.status === STATUS.COOLDOWN) {
    return t("ui.nextCooldown", { duration: formatDuration(remaining) });
  }
  if (state.status === STATUS.PAUSED) {
    return t("ui.nextPaused");
  }
  if (state.status === STATUS.STOPPING) {
    return isFinalizing() ? t("ui.nextFinalizing") : t("ui.nextStopping");
  }
  if (state.status === STATUS.RUNNING) {
    return state.nextSearchAt ? t("ui.nextSearchIn", { seconds: (remaining / 1000).toFixed(1) }) : t("ui.nextSearching");
  }
  if (state.status === STATUS.STARTING) {
    return t("ui.nextSyncing");
  }
  return t("ui.ready");
};

const paintState = () => {
  if (!root) {
    return;
  }
  const state = getState();
  const now = Date.now();
  const stats = state.stats;
  const stateEl = qs(root, "[data-state]");
  if (stateEl.dataset.status !== state.status) {
    stateEl.dataset.status = state.status;
  }
  setText(qs(root, "[data-state-label]"), statusLabel(state.status) || state.status);
  setText(qs(root, "[data-state-detail]"), stateDetail(state));
  const running = isRunning();
  const stopping = isStopping();
  const startBtn = qs(root, '[data-action="start"]');
  const pauseBtn = qs(root, '[data-action="pause"]');
  const stopBtn = qs(root, '[data-action="stop"]');
  startBtn.hidden = stopping || (running && !isPaused());
  setText(startBtn, `▶ ${isPaused() ? t("ui.resume") : t("ui.start")}`);
  pauseBtn.hidden = !running || isPaused() || stopping;
  stopBtn.hidden = !running;
  stopBtn.disabled = stopping && !isFinalizing();
  setText(qs(root, '[data-kpi="searches"]'), stats.searches);
  setText(qs(root, '[data-kpi="rate"]'), searchesLastMinute());
  setText(qs(root, '[data-kpi="won"]'), stats.won);
  setText(qs(root, '[data-kpi="missed"]'), stats.missed);
  setText(qs(root, '[data-kpi="spent"]'), formatCoins(stats.spent));
  setText(qs(root, '[data-kpi="profit"]'), `${stats.estProfit > 0 ? "+" : ""}${formatCoins(stats.estProfit)}`);
  const real = qs(root, '[data-kpi="real"]');
  if (real) {
    real.hidden = !stats.salesKnown;
    if (stats.salesKnown) {
      const coins = `${stats.realProfit >= 0 ? "+" : "−"}${formatCoins(Math.abs(stats.realProfit))}`;
      setText(real, t("ui.kpiRealProfit", { coins }));
      real.title = t("ui.kpiRealProfitTitle", { n: stats.salesKnown });
      real.classList.toggle("is-bad", stats.realProfit < 0);
    }
  }
  setText(qs(root, '[data-kpi="coins"]'), state.coins ? formatCoins(state.coins) : "—");
  const elapsed = state.startedAt ? (running ? now : state.stoppedAt || now) - state.startedAt : 0;
  setText(qs(root, '[data-kpi="time"]'), formatDuration(elapsed));
  const fill = qs(root, "[data-next-fill]");
  let ratio = 0;
  if (state.nextSearchAt && state.waitStartedAt && state.nextSearchAt > state.waitStartedAt) {
    ratio = Math.min(1, Math.max(0, (now - state.waitStartedAt) / (state.nextSearchAt - state.waitStartedAt)));
  }
  if (state.status === STATUS.AUTO_PAUSE || state.status === STATUS.COOLDOWN) {
    ratio = 1 - Math.min(1, Math.max(0, (state.nextSearchAt - now) / Math.max(1, state.nextSearchAt - (state.waitStartedAt || now))));
  }
  const width = `${Math.round(ratio * 100)}%`;
  if (fill.style.width !== width) {
    fill.style.width = width;
  }
  setText(qs(root, "[data-next-label]"), nextLabel(state, now));
};

const showTab = (id) => {
  const tab = TABS.some((entry) => entry.id === id) ? id : "target";
  qsa(root, "[data-tab]").forEach((btn) => {
    const active = btn.dataset.tab === tab;
    toggleClass(btn, "is-active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  qsa(root, "[data-page]").forEach((page) => toggleClass(page, "is-active", page.dataset.page === tab));
  if (getSettings().ui.activeTab !== tab) {
    setSetting("ui.activeTab", tab);
  }
  if (tab === "transfer") {
    refreshTransferStats(qs(root, "[data-body]"));
  }
  if (tab === "futbin") {
    refreshFutbinStatus(qs(root, "[data-body]"));
  }
  if (tab === "tools") {
    refreshToolsPage();
  }
};

const startTicker = () => {
  if (ticker) {
    return;
  }
  let beats = 0;
  ticker = setInterval(() => {
    beats += 1;
    // Langue du compte FC connue après le démarrage (EA charge sa langue tardivement) : toutes les 3 s.
    if (beats % 12 === 0) {
      try {
        refreshLanguage();
      } catch (e) {
        console.warn("[MagicBuyer] langue de l'interface", e);
      }
    }
    if (root && root.classList.contains("is-open")) {
      paintState();
      if (beats % 8 === 0 && getSettings().ui.activeTab === "futbin") {
        refreshFutbinStatus(qs(root, "[data-body]"));
      }
      if (beats % 8 === 0 && getSettings().ui.activeTab === "tools") {
        refreshToolsPage();
      }
    }
  }, 250);
};

// --------------------------------------------------------------- montage

const bindShell = () => {
  const body = qs(root, "[data-body]");
  const refreshAll = () => refreshFields(body);
  bindFields(body, {
    "f:maxBuy": (value) => (value ? formatCoins(value) : ""),
    "f:sellPrice": () => sellExtra(),
    "f:sellPercent": () => sellExtra(),
    "s:sell.defaultPrice": () => sellExtra(),
    "f:maxBid": (value) => (value ? formatCoins(value) : ""),
    "s:buy.coinsReserve": (value) => (value ? formatCoins(value) : ""),
  });
  bindTargetPage(qs(root, '[data-page="target"]'), refreshAll);
  bindSettingsPages(body, refreshAll);
  bindFutbinPage(qs(root, '[data-page="futbin"]'));
  bindToolsPage(qs(root, '[data-page="tools"]'));
  unsubscribers.forEach((off) => off());
  unsubscribers = [
    onSettingsChange((settings, path) => {
      refreshAll();
      if (path === "ui.dockPanel" || path === "*") {
        applyDock();
      }
      if (path === "ui.language" || path === "*") {
        // Après la fin du changement en cours : le sélecteur de langue fait partie du panneau reconstruit.
        setTimeout(() => refreshLanguage({ force: true }), 0);
      }
    }),
    onFiltersChange(() => paintState()),
  ];

  root.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (tab) {
      showTab(tab.dataset.tab);
      return;
    }
    const logFilter = event.target.closest("[data-log-filter]");
    if (logFilter) {
      setSetting("ui.logFilter", logFilter.dataset.logFilter);
      renderLogs();
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) {
      return;
    }
    switch (action.dataset.action) {
      case "close":
        closePanel();
        break;
      case "start":
        if (isPaused()) {
          resumeBot();
        } else {
          startBot();
        }
        break;
      case "pause":
        pauseBot();
        break;
      case "stop":
        stopBot(t("ui.manualStop"), { manual: true });
        break;
      case "clear-log":
        clearLogs();
        break;
      case "export":
        exportCsv();
        break;
      case "collapse-log": {
        const logEl = qs(root, "[data-log]");
        logEl.classList.toggle("is-collapsed");
        setText(action, logEl.classList.contains("is-collapsed") ? "▴" : "▾");
        break;
      }
      default:
        break;
    }
    paintState();
  });

  const logEl = qs(root, "[data-log]");
  const setLogHeight = (vh) => {
    const value = Math.max(12, Math.min(70, vh));
    root.style.setProperty("--mb-log-h", `${value}vh`);
    return value;
  };
  setLogHeight(Number(getSettings().ui.logHeight) || 34);
  qs(root, "[data-log-resize]").addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const onMove = (move) => {
      const vh = ((window.innerHeight - move.clientY) / window.innerHeight) * 100;
      logEl.dataset.height = String(setLogHeight(vh));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (logEl.dataset.height) {
        setSetting("ui.logHeight", Math.round(Number(logEl.dataset.height)));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  unsubscribers.push(
    onLog((entry) => appendLog(entry)),
    onStateChange(() => {
      paintState();
      if (qs(root, '[data-page="transfer"]').classList.contains("is-active")) {
        refreshTransferStats(body);
      }
    })
  );
};

export const ensurePanel = () => {
  if (root && document.body && document.body.contains(root)) {
    return root;
  }
  if (!document.body) {
    return null;
  }
  injectStyles();
  root = document.getElementById("mb-root");
  if (!root) {
    builtLanguage = language();
    builtGameLanguage = gameLanguage();
    root = document.createElement("div");
    root.id = "mb-root";
    root.innerHTML = shellHtml();
    document.body.appendChild(root);
    bindShell();
    showTab(getSettings().ui.activeTab);
    renderLogs();
    paintState();
    startTicker();
  }
  return root;
};

export const isPanelOpen = () => !!(root && root.classList.contains("is-open"));

// Panneau ancré (écrans larges, voir styles) : le web app EA rétrécit au lieu d'être recouvert.
const applyDock = () => {
  if (document.body) {
    document.body.classList.toggle("mb-dock", getSettings().ui.dockPanel !== false);
  }
};

export const openPanel = () => {
  const el = ensurePanel();
  if (!el) {
    return;
  }
  el.classList.add("is-open");
  applyDock();
  document.body.classList.add("mb-open");
  setSetting("ui.panelOpen", true);
  paintState();
};

export const closePanel = () => {
  if (root) {
    root.classList.remove("is-open");
  }
  if (document.body) {
    document.body.classList.remove("mb-open");
  }
  setSetting("ui.panelOpen", false);
};

export const togglePanel = () => (isPanelOpen() ? closePanel() : openPanel());

export const showTargetTab = () => {
  openPanel();
  showTab("target");
};

// ------------------------------------------------------ langue de l'interface

// Reconstruit tout le panneau dans la langue actuelle. Conservés : ouverture, journal réduit, et
// onglet actif (réglage ui.activeTab, rouvert par ensurePanel).
const rebuildPanel = () => {
  const wasOpen = isPanelOpen();
  const logCollapsed = !!(root && qs(root, "[data-log].is-collapsed"));
  const current = document.getElementById("mb-root");
  if (current) {
    current.remove();
  }
  if (root && root !== current) {
    root.remove();
  }
  root = null;
  // Entrées en attente : déjà affichées par le rendu complet du nouveau journal.
  pendingLogs = [];
  if (!ensurePanel()) {
    return;
  }
  if (logCollapsed) {
    qs(root, "[data-log]").classList.add("is-collapsed");
    setText(qs(root, '[data-action="collapse-log"]'), "▴");
  }
  if (wasOpen) {
    openPanel();
  }
};

const isEditingInPanel = () => {
  const el = document.activeElement;
  return !!(el && root && root.contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
};

// Langue effective changée (réglage, ou langue du compte FC connue après le démarrage) : le panneau
// est reconstruit, jamais pendant une saisie sauf si le changement vient du sélecteur de langue (force).
// Même langue mais langue du compte FC différente : seul le libellé « Automatique (…) » change.
export const refreshLanguage = ({ force = false } = {}) => {
  if (!root || !document.body || !document.body.contains(root)) {
    return;
  }
  if (language() !== builtLanguage) {
    if (force || !isEditingInPanel()) {
      rebuildPanel();
    }
    return;
  }
  const game = gameLanguage();
  if (game !== builtGameLanguage) {
    builtGameLanguage = game;
    refreshLanguageField(qs(root, "[data-body]"));
  }
};
