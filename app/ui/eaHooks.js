import {
  filterHasTarget,
  getActiveFilter,
  setLastEaSearch,
  snapshotFromEaCriteria,
} from "../core/filters";
import { log } from "../core/logger";
import { pageGlobal } from "../core/page";
import { afterTax, formatCoins, toInt } from "../core/prices";
import { qs, setText } from "./dom";
import { showTargetTab, togglePanel } from "./panel";
import { importSnapshot } from "./pages/target";

// Intégrations dans l'interface du web app EA (FC 27).

const TAB_CLASS = "mb-native-tab";
let delegatesBound = false;
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

export const ensureTabButton = () => {
  bindDelegates();
  const bar = document.querySelector("nav.ut-tab-bar");
  if (!bar || bar.querySelector(`.${TAB_CLASS}`)) {
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ut-tab-bar-item ${TAB_CLASS}`;
  button.setAttribute("aria-label", "MagicBuyer");
  button.innerHTML = "<span>MagicBuyer</span>";
  bar.appendChild(button);
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
      log.info("Recherche du marché EA capturée.");
    }
  }
  return snapshot;
};

const injectSearchBar = (ctrl) => {
  let rootEl = null;
  try {
    const view = typeof ctrl.getView === "function" ? ctrl.getView() : null;
    rootEl = view && typeof view.getRootElement === "function" ? view.getRootElement() : null;
  } catch (e) {
    rootEl = null;
  }
  if (!rootEl || rootEl.querySelector(".mb-ea-bar")) {
    return;
  }
  const host = rootEl.querySelector(".ut-content") || rootEl;
  const bar = document.createElement("div");
  bar.className = "mb-ea-bar";
  bar.innerHTML = `<strong>⚡ MagicBuyer</strong>
    <button type="button" data-mb-ea="snipe">Sniper cette recherche</button>
    <button type="button" class="is-ghost" data-mb-ea="open">Ouvrir</button>`;
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
      log.warn("Impossible de lire les critères de la recherche EA.");
      return;
    }
    // Un filtre déjà configuré n'est jamais écrasé : on en crée un nouveau.
    const active = getActiveFilter();
    importSnapshot(snapshot, { asNew: !!(active && filterHasTarget(active)) });
    const filter = getActiveFilter();
    log.success(
      `Recherche EA importée dans « ${filter ? filter.name : "le filtre"} »${
        filter && filter.maxBuy ? ` · achat max ${formatCoins(filter.maxBuy)}` : " · indique ton prix d'achat max"
      }.`
    );
    showTargetTab();
  });
  host.insertBefore(bar, host.firstChild);
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
      info.innerHTML = `<span>Net après taxe <b data-mb-net>—</b></span><span>Bénéfice <b data-mb-profit>—</b></span>`;
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

export const tickEaHooks = () => {
  try {
    ensureTabButton();
  } catch (e) {}
  try {
    hookMarketSearch();
  } catch (e) {}
  try {
    paintQuickList();
  } catch (e) {}
};
