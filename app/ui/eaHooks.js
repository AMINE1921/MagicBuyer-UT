import { mountResultsBox } from "./searchResults";
import { detailItemFor } from "./cardPrices";
import {
  addFilter,
  filterHasTarget,
  getActiveFilter,
  setLastEaSearch,
  snapshotFromEaCriteria,
} from "../core/filters";
import { findLowestBin } from "../core/lowestBin";
import { log } from "../core/logger";
import { baseIdOf, nameOf } from "../core/market";
import { eaToast, pageGlobal } from "../core/page";
import { afterTax, formatCoins, roundPrice, toInt } from "../core/prices";
import { getSettings, onSettingsChange } from "../core/settings";
import { runToolTask } from "../core/toolTask";
import { usageStats } from "../core/usage";
import { t } from "../i18n";
import { currentPrice } from "../prices/priceService";
import { escapeHtml, qs, setText } from "./dom";
import { showTargetTab, togglePanel } from "./panel";
import { importSnapshot } from "./pages/target";

// Intégrations dans l'interface du web app EA (FC 27).

const TAB_CLASS = "mb-native-tab";
let delegatesBound = false;
let languageBound = false;
let currentSearchController = null;

// ------------------------------------------------ bouton dans la barre d'onglets

const bindDelegates = () => {
  if (delegatesBound) {
    return;
  }
  delegatesBound = true;
  // Capture au niveau document : EA ne voit jamais les clics sur nos boutons.
  ["pointerdown", "mousedown", "touchstart", "touchend", "mouseup", "pointerup"].forEach((type) =>
    document.addEventListener(
      type,
      (event) => {
        if (event.target && event.target.closest && event.target.closest(`.${TAB_CLASS}`)) {
          event.stopImmediatePropagation();
        }
      },
      true
    )
  );
  document.addEventListener(
    "click",
    (event) => {
      const tab = event.target && event.target.closest && event.target.closest(`.${TAB_CLASS}`);
      if (!tab) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      togglePanel();
    },
    true
  );
};

// EA ordonne ses onglets avec « order » (Accueil = 0) et réinsère l'onglet Accueil à chaque
// changement d'écran : le nôtre (order 0) doit rester juste après lui dans le DOM. Un observateur
// le remet en place dans la même tâche que la réinsertion d'EA, avant l'affichage : il ne saute plus.
let barObserver = null;
let observedBar = null;

const placeTabButton = (bar) => {
  const button = bar.querySelector(`:scope > .${TAB_CLASS}`);
  const home = bar.querySelector(":scope > .icon-home");
  if (button && home && home.nextElementSibling !== button) {
    home.after(button);
  }
};

export const ensureTabButton = () => {
  bindDelegates();
  const bar = document.querySelector("nav.ut-tab-bar");
  if (!bar) {
    return;
  }
  let button = bar.querySelector(`.${TAB_CLASS}`);
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = `ut-tab-bar-item ${TAB_CLASS}`;
    button.setAttribute("aria-label", "MagicBuyer");
    button.innerHTML = "<span>MagicBuyer</span>";
    bar.appendChild(button);
  }
  placeTabButton(bar);
  if (observedBar !== bar && typeof MutationObserver === "function") {
    if (barObserver) {
      barObserver.disconnect();
    }
    observedBar = bar;
    barObserver = new MutationObserver(() => placeTabButton(bar));
    barObserver.observe(bar, { childList: true });
  }
};

// ------------------------------------------------- marché des transferts EA

const readController = (ctrl) => {
  const viewmodel = ctrl && ctrl.viewmodel;
  if (!viewmodel || !viewmodel.searchCriteria) {
    return null;
  }
  return snapshotFromEaCriteria(viewmodel.searchCriteria, viewmodel.playerData);
};

const captureController = (ctrl, quiet) => {
  const snapshot = readController(ctrl);
  if (snapshot) {
    setLastEaSearch(snapshot);
    if (!quiet) {
      log.info(t("misc.eaSearchCaptured"));
    }
  }
  return snapshot;
};

const searchRoot = (ctrl) => {
  try {
    const view = ctrl && typeof ctrl.getView === "function" ? ctrl.getView() : null;
    return view && typeof view.getRootElement === "function" ? view.getRootElement() : null;
  } catch (e) {
    return null;
  }
};

const injectSearchBar = (ctrl) => {
  const rootEl = searchRoot(ctrl);
  if (!rootEl || rootEl.querySelector(".mb-ea-bar")) {
    return;
  }
  const host = rootEl.querySelector(".ut-content") || rootEl;
  const bar = document.createElement("div");
  bar.className = "mb-ea-bar";
  bar.innerHTML = `<strong>⚡ MagicBuyer</strong>
    <span class="mb-ea-usage" data-mb-usage title="${escapeHtml(t("misc.eaUsageTitle"))}"></span>
    <button type="button" data-mb-ea="snipe">${t("misc.eaSnipeSearch")}</button>
    <button type="button" class="is-ghost" data-mb-ea="open">${t("misc.eaOpen")}</button>`;
  bar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mb-ea]");
    if (!button) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.mbEa === "open") {
      togglePanel();
      return;
    }
    const snapshot = captureController(currentSearchController || ctrl, true);
    if (!snapshot) {
      log.warn(t("misc.eaSearchUnreadable"));
      return;
    }
    // Un filtre déjà configuré n'est jamais écrasé : on en crée un nouveau.
    const active = getActiveFilter();
    importSnapshot(snapshot, { asNew: !!(active && filterHasTarget(active)) });
    const filter = getActiveFilter();
    const extra =
      filter && filter.maxBuy ? t("misc.eaMaxBuy", { price: formatCoins(filter.maxBuy) }) : t("misc.eaNoMaxBuy");
    log.success(t("misc.eaImported", { name: filter ? filter.name : t("misc.eaTheFilter"), extra }));
    showTargetTab();
  });
  host.insertBefore(bar, host.firstChild);
  // Filtres et tri des résultats (recherches à la main), juste sous la barre MagicBuyer.
  mountResultsBox(bar.parentElement);
  const box = bar.parentElement.querySelector(".mb-results-box");
  if (box && box.previousElementSibling !== bar) {
    bar.after(box);
  }
};

const hookMarketSearch = () => {
  const Ctrl = pageGlobal("UTMarketSearchFiltersViewController");
  if (typeof Ctrl !== "function" || !Ctrl.prototype || Ctrl.prototype.__mbHooked) {
    return !!(Ctrl && Ctrl.prototype && Ctrl.prototype.__mbHooked);
  }
  const proto = Ctrl.prototype;
  const originalAppear = proto.viewDidAppear;
  if (typeof originalAppear === "function") {
    proto.viewDidAppear = function () {
      const result = originalAppear.apply(this, arguments);
      try {
        currentSearchController = this;
        injectSearchBar(this);
      } catch (e) {}
      return result;
    };
  }
  const originalSearch = proto.eSearchSelected;
  if (typeof originalSearch === "function") {
    proto.eSearchSelected = function () {
      try {
        currentSearchController = this;
        captureController(this, true);
      } catch (e) {}
      return originalSearch.apply(this, arguments);
    };
  }
  proto.__mbHooked = true;
  return true;
};

// --------------------------------------- panneau de mise en vente : net + bénéfice

const paintQuickList = () => {
  document.querySelectorAll(".ut-quick-list-panel-view").forEach((panel) => {
    const inputs = panel.querySelectorAll("input.ut-number-input-control");
    const binInput = inputs[1];
    if (!binInput) {
      return;
    }
    let info = panel.querySelector(".mb-tax-info");
    if (!info) {
      info = document.createElement("div");
      info.className = "mb-tax-info";
      info.innerHTML = `<span>${t("misc.eaNetAfterTax")} <b data-mb-net>—</b></span><span>${t("misc.eaProfit")} <b data-mb-profit>—</b></span>`;
      const row = binInput.closest(".panelActionRow") || binInput.parentElement;
      if (row && row.parentNode) {
        row.parentNode.insertBefore(info, row.nextSibling);
      } else {
        panel.appendChild(info);
      }
    }
    const bin = toInt(binInput.value);
    const boughtEl = panel.querySelector(".boughtPriceValue");
    const bought = toInt(boughtEl && boughtEl.textContent);
    const net = afterTax(bin);
    setText(qs(info, "[data-mb-net]"), bin ? formatCoins(net) : "—");
    const profitEl = qs(info, "[data-mb-profit]");
    const profit = bought ? net - bought : null;
    setText(profitEl, profit == null ? "—" : `${profit >= 0 ? "+" : ""}${formatCoins(profit)}`);
    profitEl.classList.toggle("is-neg", profit != null && profit < 0);
  });
};

// --------------------------------------------------- changement de langue

// Les éléments injectés sont retirés puis recréés tout de suite avec les nouveaux textes.
// Barre du marché : recréée si la recherche EA est affichée, sinon à sa prochaine apparition.
const refreshInjected = () => {
  document.querySelectorAll(`.mb-ea-bar, .mb-tax-info, .${TAB_CLASS}`).forEach((el) => el.remove());
  const root = searchRoot(currentSearchController);
  const stale = root && root.querySelector(".mb-ea-bar");
  if (stale) {
    stale.remove();
  }
  if (root && root.isConnected) {
    injectSearchBar(currentSearchController);
  }
  tickEaHooks();
};

const bindLanguageRefresh = () => {
  if (languageBound) {
    return;
  }
  languageBound = true;
  onSettingsChange((settings, path) => {
    if (path === "ui.language" || path === "*") {
      try {
        refreshInjected();
      } catch (e) {}
    }
  });
};

// ------------------------------------------------- panneau de détail d'une annonce du marché
// Sous les boutons d'achat : « Prix min EA » (quelques recherches exactes, aucun achat) et
// « Sniper cette carte » (filtre créé pour cette version précise, au % FUTBIN, le bot n'est pas lancé).

const ACTIONS = "mb-detail-actions";
const lowestByDefinition = new Map();

const othersActiveListing = (item) => {
  try {
    const auction = item && typeof item.getAuctionData === "function" ? item.getAuctionData() : item && item._auction;
    return !!(auction && Number(auction.tradeId) > 0 && !auction.tradeOwner);
  } catch (e) {
    return false;
  }
};

const lowestText = (entry) => {
  if (!entry) {
    return "";
  }
  if (entry.running) {
    return t("misc.detailLowestRunning");
  }
  if (entry.error) {
    return t("misc.detailLowestFailed", { error: entry.error });
  }
  if (!entry.price) {
    return t("misc.detailLowestNone", { n: entry.searches });
  }
  return t(entry.exact ? "misc.detailLowest" : "misc.detailLowestApprox", { price: formatCoins(entry.price), count: entry.count, n: entry.searches });
};

const paintDetailActions = (view) => {
  const options = view.querySelector(".DetailPanel .bidOptions");
  let row = view.querySelector(`.${ACTIONS}`);
  const detail = options ? detailItemFor(view) : null;
  if (!detail || !detail.id || !othersActiveListing(detail.item)) {
    if (row) {
      row.remove();
    }
    return;
  }
  if (!row) {
    row = document.createElement("div");
    row.className = ACTIONS;
    row.addEventListener("click", onDetailAction);
    ["pointerdown", "mousedown", "touchstart"].forEach((type) => row.addEventListener(type, (event) => event.stopPropagation()));
  }
  const anchor = view.querySelector(".mb-buy-check") || options;
  if (row.previousElementSibling !== anchor) {
    anchor.after(row);
  }
  row.dataset.id = String(detail.id);
  const html = `<div class="mb-detail-buttons">
      <button type="button" data-mb-detail="lowest"${(lowestByDefinition.get(detail.id) || {}).running ? " disabled" : ""}>${escapeHtml(t("misc.detailLowestButton"))}</button>
      <button type="button" data-mb-detail="snipe">${escapeHtml(t("misc.detailSnipeButton"))}</button>
    </div><div class="mb-detail-result">${escapeHtml(lowestText(lowestByDefinition.get(detail.id)))}</div>`;
  if (row.dataset.html !== html) {
    row.dataset.html = html;
    row.innerHTML = html;
  }
};

const onDetailAction = async (event) => {
  const button = event.target.closest("[data-mb-detail]");
  const row = event.currentTarget;
  if (!button || !row) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const view = row.closest(".DetailView");
  const detail = view ? detailItemFor(view) : null;
  if (!detail || !detail.id) {
    return;
  }
  if (button.dataset.mbDetail === "snipe") {
    const name = nameOf(detail.item);
    const rating = Number(detail.item.rating) || 0;
    const filter = addFilter({
      name: `${name}${rating ? ` ${rating}` : ""}`,
      definitionId: detail.id,
      player: { id: baseIdOf(detail.item), name, rating },
      priceMode: "futbin",
      futbinPercent: 90,
    });
    log.success(t("misc.detailSnipeCreated", { name: filter.name }));
    eaToast(t("misc.detailSnipeCreated", { name: filter.name }), false);
    showTargetTab();
    return;
  }
  const entry = { running: true, price: 0, count: 0, searches: 0, exact: false, error: "" };
  lowestByDefinition.set(detail.id, entry);
  paintDetailActions(view);
  const reference = currentPrice(detail.id, 10 * 60 * 1000, "sell");
  const result = await runToolTask(t("tools.taskLowestBin"), (task) =>
    findLowestBin(detail.id, {
      reference: reference ? roundPrice(reference * 1.1) : 0,
      maxSearches: getSettings().tools.lowestBinSearches,
      token: task.token,
    })
  );
  const message = !result.ok ? (result.error && typeof result.error === "object" ? result.error.label : result.error) || "?" : "";
  lowestByDefinition.set(detail.id, Object.assign({}, result, { running: false, error: message }));
  if (view.isConnected) {
    paintDetailActions(view);
  }
};

const tickDetailActions = () => {
  document.querySelectorAll(".DetailView").forEach((view) => paintDetailActions(view));
};

// Compteur de requêtes dans la barre MagicBuyer de la recherche EA (couleur selon la limite).
const paintUsageBadges = () => {
  const badges = document.querySelectorAll("[data-mb-usage]");
  if (!badges.length) {
    return;
  }
  const stats = usageStats();
  const ratio = Math.max(stats.hourRatio, stats.dayRatio);
  const level = ratio >= 1 ? "is-over" : ratio >= 0.85 ? "is-high" : ratio >= 0.5 ? "is-mid" : "";
  const text = t("misc.eaUsage", {
    hour: formatCoins(stats.hour.searches),
    hourLimit: formatCoins(stats.limits.hour),
    day: formatCoins(stats.day.searches),
    dayLimit: formatCoins(stats.limits.day),
  });
  badges.forEach((badge) => {
    if (badge.textContent !== text) {
      badge.textContent = text;
    }
    badge.className = `mb-ea-usage ${level}`;
  });
};

export const tickEaHooks = () => {
  try {
    bindLanguageRefresh();
  } catch (e) {}
  try {
    ensureTabButton();
  } catch (e) {}
  try {
    hookMarketSearch();
  } catch (e) {}
  try {
    paintQuickList();
  } catch (e) {}
  try {
    tickDetailActions();
  } catch (e) {}
  try {
    paintUsageBadges();
  } catch (e) {}
};
