import { VERSION } from "./config";
import { runMigrations } from "./core/migrate";
import { getPage } from "./core/page";
import { flushSettings, getSettings } from "./core/settings";
import { hookCardPrices } from "./ui/cardPrices";
import { bootFutbinBridge, isFutbinPage } from "./ui/futbinBridge";
import { tickEaHooks } from "./ui/eaHooks";
import { ensureHud } from "./ui/hud";
import { ensurePanel, injectStyles, openPanel } from "./ui/panel";
import { hookQuickList } from "./ui/quickListFutbin";
import { tickSbc } from "./ui/sbcPanel";

const isTopFrame = () => {
  try {
    const page = getPage();
    return page.top === page;
  } catch (e) {
    return false;
  }
};

const boot = () => {
  let started = false;
  const tick = () => {
    try {
      ensurePanel();
      ensureHud();
    } catch (e) {
      console.warn("[MagicBuyer] interface", e);
    }
    tickEaHooks();
    // Intégrations FUTBIN dans le web app : installées dès que les classes EA existent.
    [hookCardPrices, hookQuickList, tickSbc].forEach((step) => {
      try {
        step();
      } catch (e) {}
    });
  };
  const start = () => {
    if (started || !document.body) {
      return;
    }
    started = true;
    try {
      runMigrations();
    } catch (e) {
      console.warn("[MagicBuyer] migration des réglages", e);
    }
    injectStyles();
    tick();
    if (getSettings().ui.panelOpen) {
      openPanel();
    }
    setInterval(tick, 1000);
  };
  if (document.body) {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start, { once: true });
    window.addEventListener("load", start, { once: true });
  }
  window.addEventListener("beforeunload", flushSettings);
  console.info(`[MagicBuyer] v${VERSION} chargé`);
};

if (isFutbinPage()) {
  bootFutbinBridge();
} else if (isTopFrame() && !window.__mbBooted) {
  window.__mbBooted = true;
  boot();
}
