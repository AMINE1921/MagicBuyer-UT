import { pageGlobal } from "../core/page";
import { floorPrice, formatCoins, priceAbove, priceBelow, roundPrice, startPriceFor, toInt } from "../core/prices";
import { percentRange } from "../core/listing";
import { randomBetween } from "../core/ranges";
import { getSettings } from "../core/settings";
import { currentPrice, getPriceRecord, onPriceUpdate, requestPrice, trackPrice } from "../prices/priceService";

// Panneau « Mettre en vente » du web app : prix FUTBIN de la carte + bouton qui remplit les prix
// (achat immédiat = % FUTBIN de l'onglet Vente, départ = un palier en dessous). La mise en vente
// reste faite par le bouton EA : tu vois toujours le prix avant de valider.

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

const paintRow = (row) => {
  const state = row.__mb;
  if (!state) {
    return;
  }
  const record = getPriceRecord(state.id);
  const info = row.querySelector("[data-mb-ql-info]");
  const button = row.querySelector("[data-mb-ql-fill]");
  const offer = proposal(state);
  if (!offer) {
    info.textContent = record && record.status === "miss" ? "FUTBIN : carte introuvable" : "FUTBIN : lecture du prix…";
    button.disabled = true;
    button.textContent = "Prix FUTBIN";
    return;
  }
  const age = Math.round((Date.now() - record.fetchedAt) / 60000);
  info.textContent = `FUTBIN ${formatCoins(offer.reference)}${record.suspect ? " ⚠" : ""} · ${age < 1 ? "à l'instant" : `il y a ${age} min`}`;
  state.offer = offer;
  button.disabled = false;
  button.textContent = `Remplir : ${formatCoins(offer.buyNow)}`;
  button.title = `Achat immédiat ${formatCoins(offer.buyNow)} (${Math.round(offer.percent)} % FUTBIN), départ ${formatCoins(offer.start)}. Valide ensuite avec le bouton EA.`;
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

const buildRow = () => {
  const row = document.createElement("div");
  row.className = `panelActionRow ${ROW}`;
  row.innerHTML = `<span class="mb-ql-info" data-mb-ql-info>FUTBIN…</span><button type="button" class="mb-ql-fill" data-mb-ql-fill>Prix FUTBIN</button>`;
  const button = row.querySelector("[data-mb-ql-fill]");
  button.addEventListener("click", fill);
  ["pointerdown", "mousedown", "touchstart", "touchend", "mouseup", "pointerup"].forEach((type) =>
    button.addEventListener(type, swallow)
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
    row.__mb = { ctrl, item, id, untrack: trackPrice(id, hint, "visible"), offer: null, percent: 0 };
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
