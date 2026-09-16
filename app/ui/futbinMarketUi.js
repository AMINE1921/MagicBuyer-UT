import { fetchPrices } from "../services/datasource";
import { listItemOnMarket } from "../utils/eaAuction";
import { getValue } from "../services/repository";
import { getSellBidPrice, roundOffPrice } from "../utils/priceUtils";
import {
  getPageRepositories,
  getPageServices,
  getPageWindow,
  syncPageGlobals,
} from "../utils/pageWindow";

const PRICE_CLASS = "mb-futbin-price";
let itemCache = [];
let lastFetchAt = 0;
let fetching = false;
let lastListCall = 0;
let lastFilledId = null;
let listing = false;

const toast = (message) => {
  let el = document.getElementById("mb-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "mb-toast";
    (document.body || document.documentElement).appendChild(el);
  }
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(el.__mbHide);
  el.__mbHide = setTimeout(() => el.classList.remove("is-visible"), 2800);
};

const formatCoins = (value) => {
  const n = Number(value);
  if (!n) {
    return "—";
  }
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};

const parseCoinLabel = (text) => {
  if (!text) {
    return null;
  }
  const raw = String(text)
    .replace(/\u00a0|\u202f/g, " ")
    .trim();
  const match = raw.replace(/,/g, ".").match(/([\d.]+)\s*([KMB])?/i);
  if (!match) {
    const digits = raw.replace(/[^\d]/g, "");
    return digits ? parseInt(digits, 10) : null;
  }
  let n = parseFloat(match[1]);
  const unit = (match[2] || "").toUpperCase();
  if (unit === "K") {
    n *= 1000;
  } else if (unit === "M") {
    n *= 1000000;
  } else if (unit === "B") {
    n *= 1000000000;
  }
  return Math.round(n);
};

const itemName = (item) => {
  if (!item) {
    return "";
  }
  try {
    const data =
      (typeof item.getStaticData === "function" && item.getStaticData()) ||
      item._staticData ||
      item._metaData ||
      {};
    return String(
      data.name || data.lastName || data.knownAs || item.lastName || item.name || ""
    ).trim();
  } catch (e) {
    return String(item.lastName || item.name || "").trim();
  }
};

const itemRating = (item) => {
  try {
    if (typeof item.getRating === "function") {
      return item.getRating();
    }
  } catch (e) {}
  return item && item.rating;
};

const itemDefinitionId = (item) => {
  if (!item) {
    return null;
  }
  try {
    if (typeof item.getDefinitionID === "function") {
      const id = item.getDefinitionID();
      if (id) {
        return id;
      }
    }
  } catch (e) {}
  return item.definitionId || item.resourceId || null;
};

const itemKey = (item) =>
  `${itemName(item).toLowerCase()}|${itemRating(item) || ""}`;

const rowKey = (row) => {
  const nameEl =
    row.querySelector(".entityContainer > .name") || row.querySelector(".name");
  let name = "";
  if (nameEl) {
    const clone = nameEl.cloneNode(true);
    clone.querySelectorAll(`.${PRICE_CLASS}`).forEach((el) => el.remove());
    name = (clone.textContent || "").trim().toLowerCase();
  }
  const rating = (
    (row.querySelector(".rating") || {}).textContent || ""
  ).trim();
  return `${name}|${rating}`;
};

const eaMoyFromRow = (row) => {
  const coin = row.querySelector(".ut-item-view--stats .coin");
  return coin ? coin.textContent.trim() : "";
};

const collectFromRepo = () => {
  const items = [];
  const seen = new Set();
  const push = (item) => {
    if (!item) {
      return;
    }
    const defId = itemDefinitionId(item);
    if (!defId) {
      return;
    }
    if (!item.definitionId) {
      item.definitionId = defId;
    }
    const id = item.id || defId;
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    items.push(item);
  };
  const ingest = (pile) => {
    if (!pile) {
      return;
    }
    const list = pile.items || pile._items || pile._collection || pile;
    if (Array.isArray(list)) {
      list.forEach(push);
    } else if (list && typeof list === "object") {
      Object.values(list).forEach(push);
    }
  };
  try {
    const page = getPageWindow();
    (page.__mbTransferItems || []).forEach(push);
  } catch (e) {}
  try {
    const repo = getPageRepositories() && getPageRepositories().Item;
    if (repo) {
      [
        "transfer",
        "_transfer",
        "unassigned",
        "watched",
        "club",
        "_club",
      ].forEach((key) => ingest(repo[key]));
    }
  } catch (e) {}
  if (items.length) {
    itemCache = items;
  }
  return itemCache;
};

const installTransferHook = () => {
  const page = getPageWindow();
  const services = getPageServices();
  if (!page || !services || !services.Item) {
    return;
  }
  const itemSvc = services.Item;
  if (itemSvc.__mbTransferHooked) {
    return;
  }
  if (typeof itemSvc.requestTransferItems !== "function") {
    return;
  }
  const orig = itemSvc.requestTransferItems;
  itemSvc.requestTransferItems = function () {
    const result = orig.apply(this, arguments);
    try {
      if (result && typeof result.observe === "function") {
        result.observe(this, function (_t, response) {
          const items =
            (response && response.response && response.response.items) ||
            (response && response.items) ||
            [];
          if (items.length) {
            page.__mbTransferItems = items;
            itemCache = items;
          }
        });
      }
    } catch (e) {}
    return result;
  };
  itemSvc.__mbTransferHooked = true;
};

const requestTransferItems = () => {
  const services = getPageServices();
  if (!services || !services.Item || typeof services.Item.requestTransferItems !== "function") {
    return;
  }
  const now = Date.now();
  if (now - lastListCall < 12000) {
    return;
  }
  lastListCall = now;
  try {
    services.Item.requestTransferItems().observe(null, function (_t, response) {
      const items =
        (response && response.response && response.response.items) ||
        (response && response.items) ||
        [];
      if (items.length) {
        getPageWindow().__mbTransferItems = items;
        itemCache = items;
      }
    });
  } catch (e) {}
};

const cacheFor = (item) => {
  const defId = itemDefinitionId(item);
  if (!defId) {
    return null;
  }
  const cached = getValue(`${defId}_futbin_price`);
  if (cached) {
    return cached;
  }
  const dataSource = (getValue("CommonSettings") || {})["idAbUseFutWiz"]
    ? "futwiz"
    : "futbin";
  return getValue(`${defId}_${dataSource}_price`) || null;
};

const priceFor = (item) => {
  const cached = cacheFor(item);
  return cached && cached.price ? cached.price : null;
};

const listingPrices = (marketPrice) => {
  if (!marketPrice) {
    return null;
  }
  const bin = roundOffPrice(marketPrice);
  const start = Math.max(150, getSellBidPrice(bin));
  return { start, bin };
};

const ensurePrices = async (items) => {
  const now = Date.now();
  if (fetching || now - lastFetchAt < 4000) {
    return;
  }
  const missing = items.filter((item) => {
    if (!item || !itemDefinitionId(item)) {
      return false;
    }
    const cached = cacheFor(item);
    if (cached && (cached.price || cached.miss)) {
      return false;
    }
    return true;
  });
  if (!missing.length) {
    return;
  }
  fetching = true;
  lastFetchAt = now;
  try {
    await fetchPrices(missing.slice(0, 30));
  } catch (e) {
    console.warn("[MagicBuyer] FUTBIN", e);
  } finally {
    fetching = false;
  }
};

const paintBadge = (host, item, row) => {
  if (!host) {
    return;
  }
  host.classList.add("mb-name-with-price");
  let badge = host.querySelector(`.${PRICE_CLASS}`);
  if (!badge && host.parentNode) {
    badge = Array.from(host.parentNode.children).find((el) =>
      el.classList.contains(PRICE_CLASS)
    );
    if (badge) {
      host.appendChild(badge);
    }
  }
  if (badge && badge.tagName !== "A") {
    const link = document.createElement("a");
    link.className = PRICE_CLASS;
    badge.parentNode.replaceChild(link, badge);
    badge = link;
  }
  if (!badge) {
    badge = document.createElement("a");
    badge.className = PRICE_CLASS;
    host.appendChild(badge);
  } else if (badge.parentNode !== host) {
    host.appendChild(badge);
  }
  badge.rel = "noopener noreferrer";
  badge.target = "_blank";
  if (!badge.__mbClickBound) {
    badge.__mbClickBound = true;
    badge.addEventListener("click", (event) => event.stopPropagation());
  }
  const cached = item && cacheFor(item);
  const price = cached && cached.price;
  const moy = row ? eaMoyFromRow(row) : "";
  if (cached && cached.pageUrl) {
    badge.href = cached.pageUrl;
  } else {
    badge.removeAttribute("href");
  }
  if (price) {
    badge.textContent = `FUTBIN ${formatCoins(price)}`;
    badge.classList.add("is-ready");
  } else if (cached && cached.miss) {
    badge.textContent = "FUTBIN —";
    badge.classList.remove("is-ready");
  } else if (moy) {
    badge.textContent = `MOY ${moy}`;
    badge.classList.remove("is-ready");
  } else {
    badge.textContent = "FUTBIN …";
    badge.classList.remove("is-ready");
  }
};

const matchRows = (items) => {
  const buckets = new Map();
  items.forEach((item) => {
    const key = itemKey(item);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(item);
  });
  document.querySelectorAll("li.listFUTItem").forEach((row) => {
    const key = rowKey(row);
    const bucket = buckets.get(key);
    const item = bucket && bucket.length ? bucket.shift() : null;
    if (item) {
      row.__mbItem = item;
    }
    const nameEl =
      row.querySelector(".entityContainer > .name") || row.querySelector(".name");
    paintBadge(nameEl, row.__mbItem, row);
  });
};

const selectedItem = () => {
  const selected = document.querySelector("li.listFUTItem.selected");
  if (selected && selected.__mbItem) {
    return selected.__mbItem;
  }
  const detailName = (
    document.querySelector(".DetailView .tns-slide-active .name") ||
    document.querySelector(".DetailView .name.main-view") ||
    {}
  ).textContent;
  if (!detailName) {
    return (selected && selected.__mbItem) || itemCache[0] || null;
  }
  const needle = detailName.trim().toLowerCase();
  return (
    itemCache.find((item) => itemName(item).toLowerCase() === needle) ||
    (selected && selected.__mbItem) ||
    null
  );
};

const setNativeInputValue = (input, value) => {
  if (!input) {
    return;
  }
  const proto =
    (window.HTMLInputElement && window.HTMLInputElement.prototype) ||
    HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value");
  if (setter && setter.set) {
    setter.set.call(input, String(value));
  } else {
    input.value = String(value);
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
};

const fillListForm = (binPrice) => {
  const panel = document.querySelector(".ut-quick-list-panel-view");
  if (!panel || !binPrice) {
    return false;
  }
  const accordion = panel.querySelector("button.accordian, button.accordion");
  if (accordion && accordion.getAttribute("aria-expanded") !== "true") {
    const actions = panel.querySelector(".panelActions");
    const hidden = actions && window.getComputedStyle(actions).display === "none";
    if (hidden || !actions) {
      accordion.click();
    }
  }
  const prices = listingPrices(binPrice);
  if (!prices) {
    return false;
  }
  const inputs = panel.querySelectorAll("input.ut-number-input-control");
  if (inputs[0]) {
    setNativeInputValue(inputs[0], prices.start);
  }
  if (inputs[1]) {
    setNativeInputValue(inputs[1], prices.bin);
  }
  return true;
};

const clickPlaceOnTransferList = () => {
  const buttons = document.querySelectorAll(
    ".ut-quick-list-panel-view .panelActions button.btn-standard.primary"
  );
  const submit = Array.from(buttons).find((btn) =>
    /placer|list|transfer/i.test(btn.textContent || "")
  );
  if (submit) {
    submit.click();
    return true;
  }
  if (buttons[0]) {
    buttons[0].click();
    return true;
  }
  return false;
};

const listItemAtFutbin = async (item) => {
  if (listing) {
    return;
  }
  if (!item) {
    toast("Aucun joueur sélectionné");
    return;
  }
  listing = true;
  try {
    if (!priceFor(item)) {
      await fetchPrices([item]);
    }
    const raw = priceFor(item);
    if (!raw) {
      toast("Prix FUTBIN introuvable pour ce joueur");
      return;
    }
    const prices = listingPrices(raw);
    fillListForm(raw);
    try {
      const listed = await listItemOnMarket(item, prices.bin, 3600);
      toast(`Listé à ${formatCoins(listed.bin)} (FUTBIN)`);
      return;
    } catch (e) {
      console.warn("[MagicBuyer] list API", e);
    }
    if (clickPlaceOnTransferList()) {
      toast(`Prix FUTBIN appliqué · ${formatCoins(prices.bin)}`);
      return;
    }
    toast(`Prix remplis · ${formatCoins(prices.bin)} — clique Placer`);
  } finally {
    listing = false;
  }
};

const buttonText = (btn) => ((btn && btn.textContent) || "").replace(/\s+/g, " ").trim();

const hasBidUi = () => {
  const panel = document.querySelector(".DetailPanel");
  if (!panel) {
    return false;
  }
  return Array.from(panel.querySelectorAll("button")).some((btn) =>
    /faire offre|achat imm[eé]diat|make bid|buy now/i.test(buttonText(btn))
  );
};

const hasNativeListPanel = () => {
  const panel = document.querySelector(".ut-quick-list-panel-view");
  if (!panel) {
    return false;
  }
  const rect = panel.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) {
    return false;
  }
  return Array.from(panel.querySelectorAll("button")).some((btn) =>
    /placer|mettre en vente|list to transfer|place on transfer/i.test(
      buttonText(btn)
    )
  );
};

const selectedRowIsSold = () => {
  const row = document.querySelector("li.listFUTItem.selected");
  if (!row) {
    return false;
  }
  const nodes = document.querySelectorAll(
    "li.listFUTItem, h2, header, .ut-section-header, .section-header"
  );
  let inSold = false;
  for (const node of nodes) {
    if (node.tagName !== "LI") {
      const text = (node.textContent || "").toLowerCase();
      if (/non.?vendu|unsold|disponible|available/.test(text)) {
        inSold = false;
      } else if (/vendu|sold items|éléments vendus/.test(text)) {
        inSold = true;
      }
    } else if (node === row) {
      return inSold;
    }
  }
  return false;
};

const isSoldAuction = (item) => {
  if (!item) {
    return false;
  }
  try {
    const auction =
      (typeof item.getAuctionData === "function" && item.getAuctionData()) ||
      item._auction;
    if (auction && typeof auction.isSold === "function" && auction.isSold()) {
      return true;
    }
  } catch (e) {}
  return false;
};

const hasUnassignedListAction = () =>
  Array.from(document.querySelectorAll(".DetailPanel button")).some((btn) =>
    /lister sur|marché des transferts|list to transfer market/i.test(
      buttonText(btn)
    )
  );

const canListHere = (item) => {
  if (hasBidUi() || selectedRowIsSold() || isSoldAuction(item)) {
    return false;
  }
  return hasNativeListPanel() || hasUnassignedListAction();
};

const removeListButton = () => {
  const btn = document.getElementById("mb-list-futbin");
  if (btn) {
    btn.remove();
  }
};

export const listSelectedAtFutbin = () => {
  const item = selectedItem();
  if (!canListHere(item)) {
    toast("Ce joueur ne peut pas être listé ici");
    return;
  }
  listItemAtFutbin(item);
};

const ensureListButton = (item) => {
  if (!canListHere(item)) {
    removeListButton();
    return;
  }
  const panel =
    document.querySelector(".ut-quick-list-panel-view") ||
    document.querySelector(".DetailPanel");
  if (!panel) {
    removeListButton();
    return;
  }
  let btn = document.getElementById("mb-list-futbin");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "mb-list-futbin";
    btn.type = "button";
    btn.className = "mb-list-futbin";
    const actions = panel.querySelector(".panelActions") || panel;
    actions.appendChild(btn);
  }
  const price = item && priceFor(item);
  const listed = price && listingPrices(price);
  btn.textContent = listed
    ? `Lister FUTBIN · ${formatCoins(listed.bin)}`
    : "Lister au prix FUTBIN";
  btn.disabled = !item;
};

const paintDetail = (item) => {
  const detail =
    document.querySelector(".DetailPanel") ||
    document.querySelector(".ut-quick-list-panel-view");
  if (!detail) {
    return;
  }
  let banner = document.getElementById("mb-futbin-detail");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "mb-futbin-detail";
    banner.className = "mb-futbin-detail";
    detail.insertBefore(banner, detail.firstChild);
  }
  const cached = item && cacheFor(item);
  const price = cached && cached.price;
  const selected = document.querySelector("li.listFUTItem.selected");
  const moy = selected ? eaMoyFromRow(selected) : "";
  banner.textContent = "";
  const label = document.createElement("span");
  if (item && price) {
    const listed = listingPrices(price);
    label.textContent = `FUTBIN ${formatCoins(price)}${
      listed ? ` · lister à ${formatCoins(listed.bin)}` : ""
    }`;
  } else if (cached && cached.miss) {
    label.textContent = moy
      ? `Prix EA (MOY) ${moy} · FUTBIN introuvable`
      : "Prix FUTBIN introuvable";
  } else if (moy) {
    label.textContent = `Prix EA (MOY) ${moy} · FUTBIN en cours…`;
  } else {
    label.textContent = item ? "Prix FUTBIN en cours…" : "Prix FUTBIN";
  }
  banner.appendChild(label);
  if (cached && cached.pageUrl) {
    const link = document.createElement("a");
    link.href = cached.pageUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = " page FUTBIN";
    banner.appendChild(link);
  }
  const itemId = item && (item.id || itemDefinitionId(item));
  if (canListHere(item) && itemId && itemId !== lastFilledId && price) {
    lastFilledId = itemId;
    fillListForm(price);
  } else if (!canListHere(item)) {
    lastFilledId = null;
  }
  ensureListButton(item);
};

export const tickFutbinUi = () => {
  if (!document.querySelector("li.listFUTItem")) {
    return;
  }
  syncPageGlobals();
  installTransferHook();
  const items = collectFromRepo();
  if (!items.length) {
    requestTransferItems();
  }
  matchRows(items);
  const current = selectedItem();
  paintDetail(current);
  const pending = items.filter((item) => {
    const cached = cacheFor(item);
    return !cached || !(cached.price || cached.miss);
  });
  if (pending.length) {
    ensurePrices(pending);
  }
};
