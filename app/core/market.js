import { observe } from "./async";
import { classify } from "./errors";
import { itemService, pageGlobal, pile, repositories, services, toPageArray } from "./page";
import { bumpStat } from "./state";

// Enveloppes autour de services.Item (FC 27) : chaque appel renvoie une Promise
// { ok, response, error } et compte les requêtes envoyées à EA.

const now = () =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

const requireItemService = () => {
  const svc = itemService();
  if (!svc) {
    throw new Error("services.Item introuvable : le web app EA n'est pas prêt");
  }
  return svc;
};

const call = async (label, factory, timeoutMs = 15000) => {
  let observable;
  try {
    observable = factory();
  } catch (e) {
    return { ok: false, response: null, error: { code: -1, kind: "other", label: `${label} : ${e.message || e}` } };
  }
  bumpStat("requests");
  const response = await observe(observable, timeoutMs);
  const ok = !!(response && response.success);
  return { ok, response, error: ok ? null : classify(response) };
};

export const auctionOf = (item) => {
  if (!item) {
    return null;
  }
  try {
    if (typeof item.getAuctionData === "function") {
      return item.getAuctionData() || item._auction || null;
    }
  } catch (e) {}
  return item._auction || null;
};

export const baseIdOf = (item) => (Number(item && item.definitionId) || 0) & 0xffffff;

export const ratingOf = (item) => {
  try {
    return Number(item.rating) || 0;
  } catch (e) {
    return 0;
  }
};

export const nameOf = (item) => {
  try {
    const data =
      (typeof item.getStaticData === "function" && item.getStaticData()) ||
      item._staticData ||
      {};
    const known = data.knownAs && data.knownAs !== "---" ? data.knownAs : "";
    return String(known || data.name || data.lastName || "").trim() || "Carte";
  } catch (e) {
    return "Carte";
  }
};

export const isGoalkeeper = (item) => {
  try {
    if (typeof item.isGK === "function") {
      return !!item.isGK();
    }
  } catch (e) {}
  return item && item.preferredPosition === 0;
};

// Nombre de cartes par page du marché (config EA, 20 par défaut ; EA en demande 1 de plus).
export const marketPageSize = () => {
  try {
    const getAppMain = pageGlobal("getAppMain");
    const Config = pageGlobal("EAConfigurationRepository");
    if (typeof getAppMain === "function" && Config) {
      const perPage = getAppMain()
        .getConfigRepository()
        .getConfigObject(Config.KEY_ITEMS_PER_PAGE);
      const value = perPage && Number(perPage[Config.ITEMS_PER_PAGE.TRANSFER_MARKET]);
      if (value > 0) {
        return value;
      }
    }
  } catch (e) {}
  return 20;
};

// Recherche sur le marché. Le cache client d'EA est vidé à chaque fois,
// sinon services.Item renvoie la page précédente sans interroger le serveur.
export const searchMarket = async (criteria, page = 1) => {
  const svc = requireItemService();
  try {
    if (typeof svc.clearTransferMarketCache === "function") {
      svc.clearTransferMarketCache();
    }
  } catch (e) {}
  const started = now();
  const result = await call("recherche", () => svc.searchTransferMarket(criteria, page));
  const latency = now() - started;
  const items =
    (result.response && result.response.data && result.response.data.items) || [];
  return Object.assign(result, { items: Array.from(items), latency });
};

// Achat immédiat ou enchère : EA utilise le même appel bid(item, prix).
export const bidOnItem = async (item, price) => {
  const svc = requireItemService();
  const started = now();
  const result = await call("achat", () => svc.bid(item, price), 12000);
  return Object.assign(result, { latency: now() - started });
};

export const listOnMarket = async (item, startPrice, buyNowPrice, durationSeconds) => {
  const svc = requireItemService();
  return call(
    "mise en vente",
    () => svc.list(item, startPrice, buyNowPrice, durationSeconds),
    20000
  );
};

export const moveItem = async (item, pileName) => {
  const svc = requireItemService();
  return call("déplacement", () => svc.move(item, pile(pileName)), 15000);
};

// Limites de prix EA de la carte (min / max autorisés à la vente).
export const fetchPriceLimits = async (item) => {
  const read = () => {
    try {
      if (typeof item.hasPriceLimits === "function" && item.hasPriceLimits()) {
        const limits =
          (typeof item.getPriceLimits === "function" && item.getPriceLimits()) ||
          item._itemPriceLimits;
        if (limits && (limits.minimum || limits.maximum)) {
          return { min: Number(limits.minimum) || 0, max: Number(limits.maximum) || 0 };
        }
      }
    } catch (e) {}
    return null;
  };
  const cached = read();
  if (cached) {
    return cached;
  }
  const svc = itemService();
  if (!svc || typeof svc.requestMarketData !== "function") {
    return null;
  }
  await call("limites de prix", () => svc.requestMarketData(item), 10000);
  return read();
};

export const fetchTransferList = async () => {
  const svc = requireItemService();
  const result = await call("liste des transferts", () => svc.requestTransferItems());
  const items =
    (result.response && result.response.response && result.response.response.items) || [];
  return Object.assign(result, { items: Array.from(items) });
};

export const fetchWatchList = async () => {
  const svc = requireItemService();
  const result = await call("liste de suivi", () => svc.requestWatchedItems());
  const items =
    (result.response && result.response.response && result.response.response.items) || [];
  return Object.assign(result, { items: Array.from(items) });
};

export const refreshAuctions = async (items) => {
  const svc = requireItemService();
  if (!items || !items.length) {
    return { ok: true };
  }
  return call("actualisation enchères", () => svc.refreshAuctions(items));
};

export const untargetItems = async (items) => {
  const svc = requireItemService();
  if (!items || !items.length) {
    return { ok: true };
  }
  return call("retrait suivi", () => svc.untarget(items));
};

export const relistExpired = async () => {
  const svc = requireItemService();
  return call("relist", () => svc.relistExpiredAuctions(), 20000);
};

export const clearSold = async () => {
  const svc = requireItemService();
  return call("vider les vendus", () => svc.clearSoldItems(), 20000);
};

// Cartes possédées (club ou stockage SBC) pour une liste de versions exactes, comme le
// constructeur d'équipe d'EA (défId + recherche exacte).
const ownedSearch = async (label, run, definitionIds) => {
  const ids = Array.from(new Set((definitionIds || []).map(Number).filter(Boolean)));
  if (!ids.length) {
    return { ok: true, items: [] };
  }
  const Dto = pageGlobal("UTSearchCriteriaDTO");
  let criteria;
  try {
    criteria = typeof Dto === "function" ? new Dto() : { type: "player", defId: [] };
  } catch (e) {
    criteria = { type: "player", defId: [] };
  }
  criteria.type = "player";
  criteria.defId = toPageArray(ids);
  criteria.isExactSearch = true;
  criteria.count = Math.max(21, ids.length * 3);
  const result = await call(label, () => run(criteria), 15000);
  const items =
    (result.response && result.response.response && result.response.response.items) ||
    (result.response && result.response.data && result.response.data.items) ||
    [];
  return Object.assign(result, { items: Array.from(items) });
};

export const searchClubItems = (definitionIds) =>
  ownedSearch("club", (criteria) => services().Club.search(criteria), definitionIds);

export const searchStorageItems = (definitionIds) => {
  const svc = itemService();
  if (!svc || typeof svc.searchStorageItems !== "function") {
    return Promise.resolve({ ok: true, items: [] });
  }
  return ownedSearch("stockage", (criteria) => svc.searchStorageItems(criteria), definitionIds);
};

export const refreshCoins = async () => {
  const svc = services();
  if (!svc || !svc.User || typeof svc.User.requestCurrencies !== "function") {
    return { ok: false };
  }
  return call("coins", () => svc.User.requestCurrencies(), 10000);
};

const itemRepository = () => {
  const repos = repositories();
  return (repos && repos.Item) || null;
};

export const pileCapacity = (pileName) => {
  try {
    const repo = itemRepository();
    if (repo && typeof repo.getPileSize === "function") {
      return Number(repo.getPileSize(pile(pileName))) || 0;
    }
  } catch (e) {}
  return 0;
};

export const pileCount = (pileName) => {
  try {
    const repo = itemRepository();
    if (repo && typeof repo.numItemsInCache === "function") {
      return Number(repo.numItemsInCache(pile(pileName))) || 0;
    }
  } catch (e) {}
  return 0;
};

// isPileFull d'EA renvoie "plein" tant que la taille de pile n'est pas chargée : on l'ignore alors.
export const isPileFull = (pileName) => {
  try {
    const repo = itemRepository();
    if (repo && typeof repo.isPileFull === "function" && pileCapacity(pileName) > 0) {
      return !!repo.isPileFull(pile(pileName));
    }
  } catch (e) {}
  return false;
};

// Résumé de la liste des transferts pour les statistiques.
export const summarizeTransferList = (items) => {
  const summary = { total: items.length, sold: 0, unsold: 0, active: 0, available: 0, soldValue: 0 };
  items.forEach((item) => {
    const auction = auctionOf(item);
    if (!auction) {
      summary.available += 1;
      return;
    }
    const is = (fn) => {
      try {
        return typeof auction[fn] === "function" && auction[fn]();
      } catch (e) {
        return false;
      }
    };
    if (is("isSold")) {
      summary.sold += 1;
      summary.soldValue += Number(auction.currentBid) || 0;
    } else if (is("isExpired")) {
      summary.unsold += 1;
    } else if (is("isSelling")) {
      summary.active += 1;
    } else {
      summary.available += 1;
    }
  });
  return summary;
};
