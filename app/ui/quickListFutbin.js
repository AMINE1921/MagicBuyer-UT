import { log } from "../core/logger";
import { findLowestBin } from "../core/lowestBin";
import { pageGlobal } from "../core/page";
import { breakEvenPrice, floorPrice, formatCoins, priceAbove, priceBelow, roundPrice, startPriceFor, toInt } from "../core/prices";
import { percentRange } from "../core/listing";
import { randomBetween } from "../core/ranges";
import { getSettings, onSettingsChange } from "../core/settings";
import { runToolTask } from "../core/toolTask";
import { t } from "../i18n";
import { currentPrice, getPriceRecord, onPriceUpdate, requestPrice, trackPrice } from "../prices/priceService";

// Panneau « Mettre en vente » du web app : prix FUTBIN de la carte + bouton qui remplit les prix
// (achat immédiat = % FUTBIN de l'onglet Vente, départ = un palier en dessous). La mise en vente
// reste faite par le bouton EA : tu vois toujours le prix avant de valider.
// Bouton « Prix min EA » : quelques recherches exactes pour trouver l'annonce la moins chère du
// moment, puis remplissage un palier en dessous.

const ROW = "mb-ql-futbin";
const FRESH = 60 * 1000;
const USABLE = 10 * 60 * 1000;
const rows = new Set();
let hooked = false;
let listening = false;

const call = (target, method) => {
  try {
    return target && typeof target[method] === "function" ? target[method]() : undefined;
  } catch (e) {
    return undefined;
  }
};

const hintOf = (item) => {
  try {
    const data = (typeof item.getStaticData === "function" && item.getStaticData()) || item._staticData || {};
    const name = (data.knownAs && data.knownAs !== "---" ? data.knownAs : "") || data.name || data.lastName || "";
    return { name: String(name).trim(), rating: Number(item.rating) || 0 };
  } catch (e) {
    return { name: "", rating: 0 };
  }
};

// Prix proposé (achat immédiat + départ), ajusté aux limites EA de la carte. Le pourcentage
// (plage de l'onglet Vente) est tiré une fois par carte pour que le bouton reste stable.
const proposal = (state) => {
  const reference = currentPrice(state.id, USABLE, "sell");
  if (!reference) {
    return null;
  }
  if (!state.percent) {
    const range = percentRange(getSettings().sell.futbinPercent);
    state.percent = randomBetween(range.min, range.max);
  }
  const percent = state.percent;
  let buyNow = roundPrice((reference * percent) / 100);
  // Jamais sous le prix payé (+ taxe EA) : relevé au seuil de rentabilité.
  const sell = getSettings().sell;
  const floor = sell.noLoss !== false ? breakEvenPrice(Number(state.item.lastSalePrice) || 0, toInt(sell.minProfit)) : 0;
  if (floor && buyNow < floor) {
    buyNow = floor;
  }
  const limits = call(state.item, "getPriceLimits") || state.item._itemPriceLimits || null;
  const min = limits ? toInt(limits.minimum) : 0;
  const max = limits ? toInt(limits.maximum) : 0;
  if (max && buyNow > max) {
    buyNow = floorPrice(max);
  }
  if (min && buyNow <= min) {
    buyNow = priceAbove(min);
  }
  let start = startPriceFor(buyNow);
  if (min && start < min) {
    start = min;
  }
  if (start >= buyNow) {
    start = priceBelow(buyNow) || start;
  }
  return { reference, buyNow, start, percent };
};

const LOWEST_FRESH = 90 * 1000;

// Remplissage proposé d'après le prix min EA : un palier sous l'annonce la moins chère.
const lowestOffer = (state) => {
  const lowest = state.lowest;
  if (!lowest || !lowest.price || Date.now() - lowest.at > LOWEST_FRESH) {
    return null;
  }
  const limits = call(state.item, "getPriceLimits") || state.item._itemPriceLimits || null;
  const min = limits ? toInt(limits.minimum) : 0;
  let buyNow = priceBelow(lowest.price) || lowest.price;
  if (min && buyNow <= min) {
    buyNow = priceAbove(min);
  }
  let start = startPriceFor(buyNow);
  if (min && start < min) {
    start = min;
  }
  if (start >= buyNow) {
    start = priceBelow(buyNow) || start;
  }
  return { buyNow, start };
};

const paintLowest = (row) => {
  const state = row.__mb;
  const button = row.querySelector("[data-mb-ql-lowest]");
  const info = row.querySelector("[data-mb-ql-ea]");
  if (!state || !button || !info) {
    return;
  }
  const lowest = state.lowest;
  const offer = lowestOffer(state);
  button.disabled = !!state.scanning;
  if (state.scanning) {
    button.textContent = t("tools.qlScanning");
    info.textContent = "";
    return;
  }
  if (offer) {
    button.textContent = t("tools.qlFillLowest", { price: formatCoins(offer.buyNow) });
    button.title = t("tools.qlFillLowestTitle", { buyNow: formatCoins(offer.buyNow), start: formatCoins(offer.start) });
  } else {
    button.textContent = t("tools.qlLowest");
    button.title = t("tools.qlLowestTitle");
  }
  if (lowest && lowest.error) {
    info.textContent = lowest.error;
  } else if (lowest && Date.now() - lowest.at <= LOWEST_FRESH) {
    info.textContent = lowest.price
      ? t(lowest.exact ? "tools.qlLowestResult" : "tools.qlLowestResultApprox", {
          price: formatCoins(lowest.price),
          count: lowest.count,
          searches: lowest.searches,
        })
      : t("tools.qlLowestNone", { searches: lowest.searches });
  } else {
    info.textContent = "";
  }
};

const scanLowest = async (row) => {
  const state = row.__mb;
  if (!state || state.scanning) {
    return;
  }
  const offer = lowestOffer(state);
  if (offer) {
    try {
      const view = state.ctrl.getView();
      view.setBidValue(offer.start);
      view.setBuyNowValue(offer.buyNow);
    } catch (e) {}
    return;
  }
  state.scanning = true;
  paintLowest(row);
  const reference = currentPrice(state.id, USABLE, "sell");
  const result = await runToolTask(t("tools.taskLowestBin"), (task) =>
    findLowestBin(state.id, {
      reference: reference ? roundPrice(reference * 1.1) : 0,
      maxSearches: getSettings().tools.lowestBinSearches,
      token: task.token,
    })
  );
  state.scanning = false;
  if (!result.ok) {
    const message = result.error && typeof result.error === "object" ? result.error.label : result.error;
    state.lowest = { price: 0, count: 0, searches: result.searches || 0, exact: false, at: Date.now(), error: message || "?" };
    log.warn(t("tools.logLowestFailed", { error: message || "?" }));
  } else {
    state.lowest = Object.assign({ at: Date.now(), error: "" }, result);
  }
  if (row.isConnected) {
    paintLowest(row);
  }
};

const paintRow = (row) => {
  const state = row.__mb;
  if (!state) {
    return;
  }
  paintLowest(row);
  const record = getPriceRecord(state.id);
  const info = row.querySelector("[data-mb-ql-info]");
  const button = row.querySelector("[data-mb-ql-fill]");
  const offer = proposal(state);
  if (!offer) {
    info.textContent = record && record.status === "miss" ? t("misc.qlNotFound") : t("misc.qlLoading");
    button.disabled = true;
    button.textContent = t("misc.qlButton");
    button.title = "";
    return;
  }
  const age = Math.round((Date.now() - record.fetchedAt) / 60000);
  const when = age < 1 ? t("misc.qlJustNow") : t("misc.qlMinutesAgo", { n: age });
  info.textContent = `FUTBIN ${formatCoins(offer.reference)}${record.suspect ? " ⚠" : ""} · ${when}`;
  state.offer = offer;
  button.disabled = false;
  button.textContent = t("misc.qlFill", { price: formatCoins(offer.buyNow) });
  button.title = t("misc.qlFillTitle", {
    buyNow: formatCoins(offer.buyNow),
    percent: Math.round(offer.percent),
    start: formatCoins(offer.start),
  });
};

const fill = (event) => {
  event.preventDefault();
  event.stopPropagation();
  const row = event.currentTarget.closest(`.${ROW}`);
  const state = row && row.__mb;
  if (!state || !state.offer) {
    return;
  }
  try {
    const view = state.ctrl.getView();
    view.setBidValue(state.offer.start);
    view.setBuyNowValue(state.offer.buyNow);
  } catch (e) {}
};

const swallow = (event) => event.stopPropagation();

const lowestClick = (event) => {
  event.preventDefault();
  event.stopPropagation();
  const row = event.currentTarget.closest(`.${ROW}`);
  if (row) {
    scanLowest(row);
  }
};

const buildRow = () => {
  const row = document.createElement("div");
  row.className = `panelActionRow ${ROW}`;
  row.innerHTML = `<span class="mb-ql-info" data-mb-ql-info>FUTBIN…</span><button type="button" class="mb-ql-fill" data-mb-ql-fill>${t("misc.qlButton")}</button>
    <span class="mb-ql-info mb-ql-ea" data-mb-ql-ea></span><button type="button" class="mb-ql-fill mb-ql-lowest" data-mb-ql-lowest>${t("tools.qlLowest")}</button>`;
  const button = row.querySelector("[data-mb-ql-fill]");
  button.addEventListener("click", fill);
  const lowest = row.querySelector("[data-mb-ql-lowest]");
  lowest.addEventListener("click", lowestClick);
  [button, lowest].forEach((el) =>
    ["pointerdown", "mousedown", "touchstart", "touchend", "mouseup", "pointerup"].forEach((type) => el.addEventListener(type, swallow))
  );
  return row;
};

const release = (row) => {
  const state = row.__mb;
  if (state && state.untrack) {
    state.untrack();
  }
  row.__mb = null;
  rows.delete(row);
};

const decorate = (ctrl) => {
  const view = call(ctrl, "getView");
  const root = view && call(view, "getRootElement");
  if (!root) {
    return;
  }
  const item = ctrl.item;
  let row = root.querySelector(`.${ROW}`);
  const id = item && call(item, "isPlayer") && !item.concept ? Number(item.definitionId) || 0 : 0;
  if (!id) {
    if (row) {
      release(row);
      row.remove();
    }
    return;
  }
  if (!row) {
    row = buildRow();
    const actions = root.querySelector(".panelActions") || root;
    actions.insertBefore(row, actions.firstChild);
  }
  if (!row.__mb || row.__mb.id !== id || row.__mb.item !== item) {
    if (row.__mb) {
      release(row);
    }
    const hint = hintOf(item);
    row.__mb = { ctrl, item, id, untrack: trackPrice(id, hint, "visible"), offer: null, percent: 0, lowest: null, scanning: false };
    rows.add(row);
    if (!currentPrice(id, FRESH)) {
      requestPrice(id, hint);
    }
  }
  row.__mb.ctrl = ctrl;
  paintRow(row);
};

export const hookQuickList = () => {
  if (!listening) {
    listening = true;
    onPriceUpdate((id) => {
      rows.forEach((row) => {
        if (!row.isConnected) {
          release(row);
        } else if (row.__mb && row.__mb.id === Number(id)) {
          paintRow(row);
        }
      });
    });
    setInterval(() => rows.forEach((row) => (row.isConnected ? paintRow(row) : release(row))), 15000);
    // Changement de langue : tous les textes de la ligne sont réécrits par paintRow.
    onSettingsChange((settings, path) => {
      if (path === "ui.language" || path === "*") {
        rows.forEach((row) => (row.isConnected ? paintRow(row) : release(row)));
      }
    });
  }
  if (hooked) {
    return true;
  }
  const Ctrl = pageGlobal("UTQuickListPanelViewController");
  if (typeof Ctrl !== "function" || !Ctrl.prototype || typeof Ctrl.prototype.renderView !== "function") {
    return false;
  }
  if (!Ctrl.prototype.__mbFutbin) {
    const original = Ctrl.prototype.renderView;
    Ctrl.prototype.renderView = function () {
      const result = original.apply(this, arguments);
      try {
        decorate(this);
      } catch (e) {}
      return result;
    };
    Ctrl.prototype.__mbFutbin = true;
  }
  hooked = true;
  return true;
};
