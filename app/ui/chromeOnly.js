import { MAGICBUYER_STYLES } from "./shellStyles";
import { getPageWindow, syncPageGlobals } from "../utils/pageWindow";
import { installUtasCapture } from "../utils/eaAuction";
import { installTransferMarketUrlGuard } from "../utils/eaTransferMarket";
import { bootFutbinBridge, isFutbinPage } from "./futbinBridge";
import { tickFutbinUi, listSelectedAtFutbin } from "./futbinMarketUi";

const TAB_CLASS = "mb-native-tab";
const TAB_TEXT = "MagicBuyer";
const VERSION = "4.0.0";

let delegatesBound = false;
let toggling = false;

const toggleFallbackPanel = () => {
  let root = document.getElementById("mb-root");
  if (!root) {
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
              <p>Panneau de secours · le module complet n'a pas pu se charger</p>
            </div>
          </div>
          <button type="button" class="mb-close" aria-label="Fermer">×</button>
        </header>
        <div class="mb-criteria">Les prix FUTBIN s'affichent sur la liste des transferts. Utilise le bouton « Lister FUTBIN » dans le panneau du joueur.</div>
      </section>
    `;
    (document.body || document.documentElement).appendChild(root);
    const close = () => {
      root.classList.remove("mb-open");
      document.body.classList.remove("mb-panel-open");
    };
    root.querySelector(".mb-backdrop").addEventListener("click", close);
    root.querySelector(".mb-close").addEventListener("click", close);
  }
  const open = !root.classList.contains("mb-open");
  root.classList.toggle("mb-open", open);
  document.body.classList.toggle("mb-panel-open", open);
};

const togglePanel = () => {
  if (toggling) {
    return;
  }
  toggling = true;
  try {
    require("./panelView").toggleMagicBuyerPanel();
  } catch (e) {
    console.error("[MagicBuyer] panneau", e);
    toggleFallbackPanel();
  }
  setTimeout(() => {
    toggling = false;
  }, 250);
};

const bindDelegates = () => {
  if (delegatesBound) {
    return;
  }
  delegatesBound = true;
  const triggerSelector = `#mb-fab, .${TAB_CLASS}, #mb-list-futbin`;
  document.addEventListener(
    "pointerdown",
    (event) => {
      const trigger =
        event.target &&
        event.target.closest &&
        event.target.closest(triggerSelector);
      if (!trigger) {
        return;
      }
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    },
    true
  );
  document.addEventListener(
    "click",
    (event) => {
      const trigger =
        event.target &&
        event.target.closest &&
        event.target.closest(triggerSelector);
      if (!trigger) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      if (trigger.id === "mb-list-futbin") {
        listSelectedAtFutbin();
        return;
      }
      togglePanel();
    },
    true
  );
};

export const injectNativeTab = (bar) => {
  bar =
    bar ||
    document.querySelector(
      "nav.ut-tab-bar, .ut-tab-bar, .fc-header-view .ut-tab-bar"
    );
  if (!bar) {
    return false;
  }
  if (bar.querySelector(`.${TAB_CLASS}`)) {
    return true;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `ut-tab-bar-item icon-magicbuyer ${TAB_CLASS}`;
  btn.setAttribute("aria-label", TAB_TEXT);
  btn.innerHTML = `<span>${TAB_TEXT}</span>`;
  bar.appendChild(btn);
  return true;
};

const hookTabBarView = () => {
  const page = getPageWindow();
  const TabView = (page && page.UTTabBarView) || window.UTTabBarView;
  if (typeof TabView !== "function" || !TabView.prototype) {
    return;
  }
  const proto = TabView.prototype;
  ["setTabItems", "layoutSubviews"].forEach((method) => {
    const original = proto[method];
    if (typeof original !== "function" || original.__mbHooked) {
      return;
    }
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      try {
        injectNativeTab(this.__navTabBar || this._navTabBar);
      } catch (e) {}
      return result;
    };
    wrapped.__mbHooked = true;
    proto[method] = wrapped;
  });
};

const injectStyles = () => {
  if (document.getElementById("mb-shell-styles")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "mb-shell-styles";
  style.textContent = MAGICBUYER_STYLES;
  (document.head || document.documentElement).appendChild(style);
};

const injectFab = () => {
  const host = document.body || document.documentElement;
  if (!host) {
    return false;
  }
  let fab = document.getElementById("mb-fab");
  if (fab && fab.parentNode !== host) {
    host.appendChild(fab);
    return true;
  }
  if (fab) {
    return true;
  }
  fab = document.createElement("button");
  fab.id = "mb-fab";
  fab.type = "button";
  fab.setAttribute("aria-label", TAB_TEXT);
  fab.innerHTML = `<span class="mb-fab-mark">MB</span><span>MagicBuyer</span>`;
  host.appendChild(fab);
  return true;
};

export const ensureMagicBuyerChrome = () => {
  try {
    installTransferMarketUrlGuard();
    installUtasCapture();
    syncPageGlobals();
    injectStyles();
    injectFab();
    bindDelegates();
    hookTabBarView();
    injectNativeTab();
    tickFutbinUi();
    try {
      require("./buyerContext").hookEaSearchCapture();
    } catch (e) {}
  } catch (e) {
    console.warn("[MagicBuyer] chrome", e);
  }
};

if (isFutbinPage()) {
  bootFutbinBridge();
} else if (!window.__mbChromeBooted) {
  window.__mbChromeBooted = true;
  console.info(`[MagicBuyer] chrome ${VERSION}`);
  ensureMagicBuyerChrome();
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", ensureMagicBuyerChrome, {
      once: true,
    });
  }
  const schedule = () => {
    if (window.__mbChromeScheduled) {
      return;
    }
    window.__mbChromeScheduled = true;
    requestAnimationFrame(() => {
      window.__mbChromeScheduled = false;
      ensureMagicBuyerChrome();
    });
  };
  try {
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  } catch (e) {}
  setInterval(ensureMagicBuyerChrome, 1500);
}
