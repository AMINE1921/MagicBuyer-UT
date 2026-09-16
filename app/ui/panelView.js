import {
  idAbActiveTransfers,
  idAbAvailableItems,
  idAbCoins,
  idAbCountDown,
  idAbProfit,
  idAbRequestCount,
  idAbSearchProgress,
  idAbSoldItems,
  idAbStatisticsProgress,
  idAbStatus,
  idAbUnsoldItems,
  idLog,
  idProgressAutobuyer,
  idWinCount,
} from "../elementIds.constants";
import * as ElementIds from "../elementIds.constants";
import { startAutoBuyer, stopAutoBuyer } from "../handlers/autobuyerProcessor";
import { statsProcessor } from "../handlers/statsProcessor";
import { getBuyerSettings, getValue, setValue } from "../services/repository";
import {
  defaultBuyerSetting,
  defaultCommonSetting,
  STATE_PAUSED,
} from "../app.constants";
import { updateSettingsView } from "../utils/commonUtil";
import { clearLogs } from "../utils/logUtil";
import { sendUINotification } from "../utils/notificationUtil";
import { updateCommonSettings } from "../views/layouts/MenuItemView";
import { buySettingsView } from "../views/layouts/Settings/BuySettingsView";
import { captchaSettingsView } from "../views/layouts/Settings/CaptchaSettingsView";
import { commonSettingsView } from "../views/layouts/Settings/CommonSettingsView";
import { filterSettingsView } from "../views/layouts/Settings/FilterSettingsView";
import { notificationSettingsView } from "../views/layouts/Settings/NotificationSettingsView";
import { safeSettingsView } from "../views/layouts/Settings/SafeSettingsView";
import { searchSettingsView } from "../views/layouts/Settings/SearchSettingsView";
import { sellSettingsView } from "../views/layouts/Settings/SellSettingsView";
import { initializeLog } from "../views/layouts/LogView";
import {
  getBuyerContext,
  onSearchCriteriaChange,
  summarizeCriteria,
} from "./buyerContext";
import { mountMarketSearch, syncMarketCriteria } from "./eaMarketSearch";
import $ from "../utils/jquery";

const PAGES = [
  { id: "market", label: "Recherche" },
  { id: "buy", label: "Achat" },
  { id: "sell", label: "Vente" },
  { id: "search", label: "Marché" },
  { id: "safety", label: "Sécurité" },
  { id: "filters", label: "Filtres" },
  { id: "more", label: "Plus" },
];

let mounted = false;
let criteriaUnsub;

const revealSettings = (content) => {
  if (content && content.jquery) {
    content.css("display", "");
    content.removeAttr("style");
    content.find(".buyer-settings-wrapper").css("display", "").removeAttr("style");
    return content;
  }
  if (typeof content === "string") {
    return content.replace(
      /style\s*=\s*(['"])[^'"]*display\s*:\s*none[^'"]*\1/gi,
      ""
    );
  }
  return content;
};

const appendPage = (container, id, content) => {
  const page = document.createElement("div");
  page.className = `mb-page${id === "market" ? " is-active" : ""}`;
  page.dataset.page = id;
  container.appendChild(page);
  const ready = revealSettings(content);
  if (ready && ready.jquery) {
    const node = ready.get(0);
    if (node) {
      page.appendChild(node);
    }
  } else if (ready && ready.nodeType === 1) {
    page.appendChild(ready);
  } else if (id === "market") {
    mountMarketSearch(page);
  } else {
    page.innerHTML = ready || "";
  }
};

const showPage = (root, pageId) => {
  root.querySelectorAll(".mb-tab").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.page === pageId);
  });
  root.querySelectorAll(".mb-page").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.page === pageId);
  });
};

const ensureDefaults = () => {
  if (!getValue("BuyerSettings")) {
    setValue("BuyerSettings", Object.assign({}, defaultBuyerSetting));
  }
  if (!getValue("CommonSettings")) {
    setValue("CommonSettings", Object.assign({}, defaultCommonSetting));
  }
};

const harvestSettingsFromPanel = (root) => {
  const buyer = Object.assign(
    {},
    defaultBuyerSetting,
    getValue("BuyerSettings") || {}
  );
  const common = Object.assign(
    {},
    defaultCommonSetting,
    getValue("CommonSettings") || {}
  );
  Object.keys(ElementIds).forEach((key) => {
    const el = root.querySelector(`#${ElementIds[key]}`);
    if (!el) {
      return;
    }
    let value;
    if (el.classList.contains("ut-toggle-control")) {
      value = el.classList.contains("toggled");
    } else if (el.type === "checkbox") {
      value = el.checked;
    } else if (el.multiple) {
      value = Array.from(el.selectedOptions || []).map((opt) => opt.value);
    } else {
      value = el.value;
    }
    if (value === "" || value == null) {
      if (
        key === "idAbBuyPrice" ||
        key === "idAbMaxBid" ||
        key === "idAbSellPrice"
      ) {
        buyer[key] = null;
      }
      return;
    }
    if (key in defaultBuyerSetting || key in buyer) {
      buyer[key] = value;
    } else if (key in defaultCommonSetting || key in common) {
      common[key] = value;
    } else {
      buyer[key] = value;
    }
  });
  const criteria = syncMarketCriteria();
  setValue("BuyerSettings", buyer);
  setValue("CommonSettings", common);
  return { buyer, common, criteria };
};

const refreshCriteriaBanner = () => {
  const el = document.getElementById("mb-criteria-text");
  if (!el) {
    return;
  }
  el.textContent = summarizeCriteria(getValue("lastSearchCriteria"));
};

const bindChrome = (root) => {
  root.querySelector(".mb-backdrop").addEventListener("click", closeMagicBuyerPanel);
  root.querySelector(".mb-close").addEventListener("click", closeMagicBuyerPanel);
  root.querySelector("[data-mb-action=start]").addEventListener("click", () => {
    const { criteria } = harvestSettingsFromPanel(root);
    const ctx = getBuyerContext();
    if (!criteria || (!criteria.maskedDefId && criteria.league === -1 && criteria.club === -1 && criteria.position === "any")) {
      sendUINotification("Renseigne au moins un filtre dans Recherche (joueur, ligue, club…).");
    }
    Promise.resolve(
      startAutoBuyer.call(ctx, getValue("autoBuyerState") === STATE_PAUSED)
    ).catch((e) => {
      sendUINotification("Impossible de démarrer MagicBuyer");
      console.error("[MagicBuyer] start", e);
    });
  });
  root.querySelector("[data-mb-action=pause]").addEventListener("click", () => {
    stopAutoBuyer(true);
  });
  root.querySelector("[data-mb-action=stop]").addEventListener("click", () => {
    stopAutoBuyer(false);
  });
  root.querySelector("[data-mb-action=clear]").addEventListener("click", () => {
    clearLogs();
  });
  root.addEventListener("click", (event) => {
    const tab = event.target.closest && event.target.closest(".mb-tab");
    if (!tab || !root.contains(tab)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    showPage(root, tab.dataset.page);
  });
};

const ensureShell = () => {
  let root = document.getElementById("mb-root");
  if (root) {
    return root;
  }
  ensureDefaults();
  root = document.createElement("div");
  root.id = "mb-root";
  root.innerHTML = `
    <div class="mb-backdrop"></div>
    <section class="mb-shell" role="dialog" aria-label="MagicBuyer">
      <header class="mb-header">
        <div class="mb-brand">
          <div class="mb-logo">MB</div>
          <div>
            <h1>MagicBuyer</h1>
            <p>Même filtres que le marché EA · tous les menus</p>
          </div>
        </div>
        <div class="mb-status">
          <span class="mb-pill">État <strong id="${idAbStatus}">IDLE</strong></span>
          <span class="mb-pill">Temps <strong id="${idAbCountDown}">00:00:00</strong></span>
          <button type="button" class="mb-close" aria-label="Fermer">×</button>
        </div>
      </header>
      <div class="mb-stats">
        <div class="mb-stat"><span>Requêtes</span><strong id="${idAbRequestCount}">0</strong></div>
        <div class="mb-stat"><span>Coins</span><strong id="${idAbCoins}">-</strong></div>
        <div class="mb-stat"><span>Profit</span><strong id="${idAbProfit}">0</strong></div>
        <div class="mb-stat"><span>Gagnés</span><strong id="${idWinCount}">0</strong></div>
        <div class="mb-stat"><span>Vendus</span><strong id="${idAbSoldItems}">-</strong></div>
        <div class="mb-stat"><span>Invendus</span><strong id="${idAbUnsoldItems}">-</strong></div>
        <div class="mb-stat"><span>Dispo</span><strong id="${idAbAvailableItems}">-</strong></div>
        <div class="mb-stat"><span>Actifs</span><strong id="${idAbActiveTransfers}">-</strong></div>
      </div>
      <div class="mb-progress"><div id="${idAbSearchProgress}"></div></div>
      <div class="mb-progress" style="display:none"><div id="${idAbStatisticsProgress}"></div></div>
      <div class="mb-criteria" id="mb-criteria-text"></div>
      <div class="mb-toolbar">
        <button type="button" class="mb-btn-start" data-mb-action="start">Démarrer</button>
        <button type="button" class="mb-btn-pause" data-mb-action="pause">Pause</button>
        <button type="button" class="mb-btn-stop" data-mb-action="stop">Stop</button>
        <button type="button" class="mb-btn-ghost" data-mb-action="clear">Vider les logs</button>
      </div>
      <div class="mb-layout">
        <div class="mb-main">
          <nav class="mb-tabs" role="tablist">
            ${PAGES.map(
              (page, idx) =>
                `<button type="button" class="mb-tab${idx === 0 ? " is-active" : ""}" data-page="${page.id}">${page.label}</button>`
            ).join("")}
          </nav>
          <div class="mb-pages" id="mb-pages"></div>
        </div>
        <aside class="mb-logs" id="${idLog}">
          <div class="mb-logs-head"><span>Journal</span></div>
          <ul class="autoBuyerLog" id="${idProgressAutobuyer}"></ul>
        </aside>
      </div>
    </section>
  `;
  document.body.appendChild(root);
  bindChrome(root);
  refreshCriteriaBanner();
  if (criteriaUnsub) {
    criteriaUnsub();
  }
  criteriaUnsub = onSearchCriteriaChange(refreshCriteriaBanner);
  return root;
};

let pagesLoading = false;

const mountPages = async (root) => {
  if (mounted || pagesLoading) {
    return;
  }
  pagesLoading = true;
  try {
    const pages = root.querySelector("#mb-pages");
    if (!pages) {
      return;
    }
    const safePage = async (id, loader) => {
      try {
        appendPage(pages, id, await loader());
      } catch (e) {
        console.warn("[MagicBuyer] onglet", id, e);
        appendPage(
          pages,
          id,
          `<div class="buyer-settings-wrapper">Impossible de charger cet onglet : ${e && e.message ? e.message : e}</div>`
        );
      }
    };
    await safePage("market", () => "");
    await safePage("buy", () => buySettingsView());
    await safePage("sell", () => sellSettingsView());
    await safePage("search", () => searchSettingsView());
    await safePage("safety", () => safeSettingsView());
    await safePage("filters", () => filterSettingsView());
    await safePage(
      "more",
      () =>
        `${notificationSettingsView()}${captchaSettingsView()}${commonSettingsView()}`
    );

    try {
      statsProcessor();
      initializeLog();
      await updateCommonSettings(true);
      updateSettingsView(getBuyerSettings());
    } catch (e) {
      console.warn("[MagicBuyer] pages", e);
    }
    mounted = true;
    showPage(root, "market");
  } catch (e) {
    console.warn("[MagicBuyer] pages", e);
  } finally {
    pagesLoading = false;
  }
};

export const mountMagicBuyerPanel = async () => {
  const root = ensureShell();
  await mountPages(root);
};

export const openMagicBuyerPanel = () => {
  const root = ensureShell();
  root.classList.add("mb-open");
  document.body.classList.add("mb-panel-open");
  refreshCriteriaBanner();
  mountPages(root).catch((e) => console.warn("[MagicBuyer] mount", e));
};

export const closeMagicBuyerPanel = () => {
  const root = document.getElementById("mb-root");
  if (root) {
    root.classList.remove("mb-open");
  }
  document.body.classList.remove("mb-panel-open");
};

export const toggleMagicBuyerPanel = () => {
  const root = document.getElementById("mb-root");
  if (root && root.classList.contains("mb-open")) {
    closeMagicBuyerPanel();
    return;
  }
  openMagicBuyerPanel();
};
