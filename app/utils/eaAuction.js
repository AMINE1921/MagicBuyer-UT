import { getValue, setValue } from "../services/repository";
import { getPageServices, getPageWindow, syncPageGlobals } from "./pageWindow";
import { getSellBidPrice } from "./priceUtils";

const AUTH_HEADER = /^(authorization|x-ut-sid|x-ut-phishingtoken|easw-session|nucleus|content-type|accept)$/i;

export const getOwnedItemId = (item) => {
  if (!item) {
    return 0;
  }
  const direct = Number(item.id || item.idStr);
  if (direct) {
    return direct;
  }
  try {
    if (typeof item.getId === "function") {
      const id = Number(item.getId());
      if (id) {
        return id;
      }
    }
  } catch (e) {}
  const nested = item._item || item.itemData || item.data;
  return Number((nested && (nested.id || nested.idStr)) || 0);
};

export const rememberUtasContext = (url, headers) => {
  if (typeof url !== "string" || url.indexOf("/ut/game/") === -1) {
    return;
  }
  const match = url.match(/^(https?:\/\/[^/]+\/ut\/game\/[^/?#]+)/i);
  if (match) {
    setValue("mbUtasBase", match[1]);
  }
  if (headers && typeof headers === "object") {
    const next = Object.assign({}, getValue("mbUtasHeaders") || {});
    Object.keys(headers).forEach((key) => {
      if (AUTH_HEADER.test(key) && headers[key]) {
        next[key] = headers[key];
      }
    });
    setValue("mbUtasHeaders", next);
  }
};

const auctionHouseUrl = () => {
  const base = getValue("mbUtasBase");
  if (base) {
    return `${base}/auctionhouse`;
  }
  const page = getPageWindow();
  const year = String((page && page.fut_year) || "2027").slice(-2);
  return `https://utas.mob.v1.prd.futc-ext.gcp.ea.com/ut/game/fc${year}/auctionhouse`;
};

const observeOnce = (observable, timeoutMs = 12000) =>
  new Promise((resolve, reject) => {
    if (!observable) {
      reject(new Error("Réponse listing vide"));
      return;
    }
    const timer = setTimeout(() => reject(new Error("Listing timeout")), timeoutMs);
    const finish = (err, data) => {
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    };
    if (typeof observable.observe === "function") {
      observable.observe(null, function (_sender, response) {
        if (response && response.success === false) {
          finish(
            new Error(
              `listing ${response.status || (response.error && response.error.code) || "échec"}`
            )
          );
          return;
        }
        finish(null, response);
      });
      return;
    }
    if (typeof observable.then === "function") {
      observable.then((response) => finish(null, response)).catch(finish);
      return;
    }
    finish(null, observable);
  });

const postAuctionHouse = async (itemId, startingBid, buyNowPrice, duration) => {
  const headers = Object.assign(
    {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    getValue("mbUtasHeaders") || {}
  );
  const body = JSON.stringify({
    buyNowPrice,
    duration,
    itemData: { id: itemId },
    startingBid,
  });
  const url = auctionHouseUrl();
  const page = getPageWindow();
  const fetchFn = (page && page.fetch) || window.fetch;
  const res = await fetchFn.call(page || window, url, {
    method: "POST",
    credentials: "include",
    headers,
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {}
  if (!res.ok) {
    throw new Error(`auctionhouse ${res.status}`);
  }
  if (!json || !json.id) {
    throw new Error("auctionhouse : réponse sans id");
  }
  return json;
};

export const listItemOnMarket = async (item, buyNowPrice, duration) => {
  syncPageGlobals();
  const itemId = getOwnedItemId(item);
  if (!itemId) {
    throw new Error("ID de carte introuvable pour la mise en vente");
  }
  const bin = Number(buyNowPrice);
  if (!bin) {
    throw new Error("Prix de vente manquant");
  }
  const start = Math.max(150, getSellBidPrice(bin));
  const dur = Number(duration) || 3600;
  const services = getPageServices();
  if (services && services.Item && typeof services.Item.list === "function") {
    try {
      const result = await observeOnce(
        services.Item.list(item, start, bin, dur)
      );
      if (result && result.success !== false) {
        return { start, bin, duration: dur, via: "service", result };
      }
    } catch (e) {
      console.warn("[MagicBuyer] Item.list", e);
    }
  }
  const result = await postAuctionHouse(itemId, start, bin, dur);
  return { start, bin, duration: dur, via: "auctionhouse", result };
};

export const purchasedItemFromBuyResponse = (response, fallback) => {
  const payload =
    (response && response.response) || (response && response.data) || response || {};
  return (
    payload.item ||
    payload.itemData ||
    (Array.isArray(payload.items) && payload.items[0]) ||
    fallback
  );
};

export const installUtasCapture = () => {
  if (window.__mbUtasCapture) {
    return;
  }
  window.__mbUtasCapture = true;
  const patch = (xhrCtor) => {
    if (!xhrCtor || !xhrCtor.prototype || xhrCtor.prototype.open.__mbUtas) {
      return;
    }
    const origOpen = xhrCtor.prototype.open;
    const origSet = xhrCtor.prototype.setRequestHeader;
    const origSend = xhrCtor.prototype.send;
    xhrCtor.prototype.open = function (method, url) {
      this.__mbUrl = url;
      this.__mbHeaders = {};
      return origOpen.apply(this, arguments);
    };
    xhrCtor.prototype.open.__mbUtas = true;
    if (origSet) {
      xhrCtor.prototype.setRequestHeader = function (key, value) {
        this.__mbHeaders = this.__mbHeaders || {};
        this.__mbHeaders[key] = value;
        return origSet.apply(this, arguments);
      };
    }
    xhrCtor.prototype.send = function () {
      try {
        rememberUtasContext(this.__mbUrl, this.__mbHeaders);
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
  };
  try {
    patch(window.XMLHttpRequest);
  } catch (e) {}
  try {
    const page = getPageWindow();
    if (page && page.XMLHttpRequest && page.XMLHttpRequest !== window.XMLHttpRequest) {
      patch(page.XMLHttpRequest);
    }
  } catch (e) {}
};
