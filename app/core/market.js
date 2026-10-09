import { t } from "../i18n";
import { observe } from "./async";
import { classify } from "./errors";
import { itemService, pageArrayOf, pageGlobal, pile, repositories, services, toPageArray } from "./page";
import { bumpStat } from "./state";
import { asBot } from "./usage";

// Enveloppes autour de services.Item (FC 27) : chaque appel renvoie une Promise
// { ok, response, error } et compte les requêtes envoyées à EA.

const now = () =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

const requireItemService = () => {
  const svc = itemService();
  if (!svc) {
    throw new Error(t("misc.itemServiceMissing"));
  }
  return svc;
};

// labelKey : clé de traduction du nom de l'appel (affiché seulement si l'appel échoue).
const call = async (labelKey, factory, timeoutMs = 15000) => {
  let observable;
  try {
    // Requêtes du bot (et des tâches MagicBuyer) : comptées à part des recherches faites à la main.
    observable = asBot(factory);
  } catch (e) {
    const label = t("misc.callFailed", { label: t(labelKey), error: e.message || e });
    return { ok: false, response: null, error: { code: -1, kind: "other", label } };
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
    return String(known || data.name || data.lastName || "").trim() || t("misc.cardFallback");
  } catch (e) {
    return t("misc.cardFallback");
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
  const result = await call("misc.callSearch", () => svc.searchTransferMarket(criteria, page));
  const latency = now() - started;
  const items =
    (result.response && result.response.data && result.response.data.items) || [];
  return Object.assign(result, { items: Array.from(items), latency });
};

// Achat immédiat ou enchère : EA utilise le même appel bid(item, prix).
export const bidOnItem = async (item, price) => {
  const svc = requireItemService();
  const started = now();
  const result = await call("misc.callBuy", () => svc.bid(item, price), 12000);
  return Object.assign(result, { latency: now() - started });
};

export const listOnMarket = async (item, startPrice, buyNowPrice, durationSeconds) => {
  const svc = requireItemService();
  return call(
    "misc.callList",
    () => svc.list(item, startPrice, buyNowPrice, durationSeconds),
    20000
  );
};

export const moveItem = async (item, pileName) => {
  const svc = requireItemService();
  return call("misc.callMove", () => svc.move(item, pile(pileName)), 15000);
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
  await call("misc.callPriceLimits", () => svc.requestMarketData(item), 10000);
  return read();
};

export const fetchTransferList = async () => {
  const svc = requireItemService();
  const result = await call("misc.callTransferList", () => svc.requestTransferItems());
  const items =
    (result.response && result.response.response && result.response.response.items) || [];
  return Object.assign(result, { items: Array.from(items) });
};

export const fetchWatchList = async () => {
  const svc = requireItemService();
  const result = await call("misc.callWatchList", () => svc.requestWatchedItems());
  const items =
    (result.response && result.response.response && result.response.response.items) || [];
  return Object.assign(result, { items: Array.from(items) });
};

export const refreshAuctions = async (items) => {
  const svc = requireItemService();
  if (!items || !items.length) {
    return { ok: true };
  }
  return call("misc.callRefreshAuctions", () => svc.refreshAuctions(items));
};

export const untargetItems = async (items) => {
  const svc = requireItemService();
  if (!items || !items.length) {
    return { ok: true };
  }
  return call("misc.callUntarget", () => svc.untarget(items));
};

export const relistExpired = async () => {
  const svc = requireItemService();
  return call("misc.callRelist", () => svc.relistExpiredAuctions(), 20000);
};

export const clearSold = async () => {
  const svc = requireItemService();
  return call("misc.callClearSold", () => svc.clearSoldItems(), 20000);
};

// Cartes « concept » d'EA (toutes les versions de joueurs, possédées ou non) : objets carte complets,
// affichables avec les vues de cartes du web app (galerie).
export const searchConceptItems = async (definitionIds) => {
  const svc = itemService();
  const ids = Array.from(new Set((definitionIds || []).map(Number).filter(Boolean)));
  if (!svc || typeof svc.searchConceptItems !== "function" || !ids.length) {
    return { ok: false, items: [] };
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
  criteria.offset = 0;
  criteria.count = Math.max(21, ids.length);
  const result = await call("tools.callConcept", () => svc.searchConceptItems(criteria), 15000);
  const items =
    (result.response && result.response.response && result.response.response.items) ||
    (result.response && result.response.data && result.response.data.items) ||
    [];
  return Object.assign(result, { items: Array.from(items) });
};

// Une page de cartes concept (toutes les versions des joueurs demandés ; versions exactes avec
// exact) : utilisée par la synchro de la galerie, qui lit au passage le champ isCollected d'EA.
export const searchConceptPage = async (definitionIds, { offset = 0, count = 250, exact = false } = {}) => {
  const svc = itemService();
  const ids = Array.from(new Set((definitionIds || []).map(Number).filter(Boolean)));
  if (!svc || typeof svc.searchConceptItems !== "function" || !ids.length) {
    return { ok: false, items: [], endOfList: true, error: null };
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
  criteria.offset = Math.max(0, offset);
  criteria.count = Math.max(1, count);
  if (exact) {
    criteria.isExactSearch = true;
  }
  const result = await call("tools.callConcept", () => svc.searchConceptItems(criteria), 20000);
  const response = result.response && result.response.response;
  const items = Array.from((response && response.items) || []);
  const endOfList = !!(response && (response.endOfList || response.retrievedAll)) || items.length < count;
  return Object.assign(result, { items, endOfList });
};

// Toutes les versions d'une rareté (promo), possédées ou non : cartes concept d'EA, par pages. Une
// requête légère, sans recherche sur le marché des transferts (TOTW 1 à 4 : 184 cartes en une page).
export const searchConceptRarity = async (rarity, { offset = 0, count = 250 } = {}) => {
  const svc = itemService();
  if (!svc || typeof svc.searchConceptItems !== "function" || !(Number(rarity) >= 0)) {
    return { ok: false, items: [], endOfList: true, error: null };
  }
  const Dto = pageGlobal("UTSearchCriteriaDTO");
  let criteria;
  try {
    criteria = typeof Dto === "function" ? new Dto() : { type: "player", rarities: [] };
  } catch (e) {
    criteria = { type: "player", rarities: [] };
  }
  criteria.type = "player";
  criteria.rarities = toPageArray([Number(rarity)]);
  criteria.offset = Math.max(0, offset);
  criteria.count = Math.max(1, count);
  const result = await call("tools.callConcept", () => svc.searchConceptItems(criteria), 20000);
  const response = result.response && result.response.response;
  const items = Array.from((response && response.items) || []);
  const endOfList = !!(response && (response.endOfList || response.retrievedAll)) || items.length < count;
  return Object.assign(result, { items, endOfList });
};

// Carte holographique (FC 27) : habillage holo d'EA (_hyperCosmeticDTOs non vide). Vu le 09/10/2026 sur
// les 184 TOTW 1 à 4 : 92 holo, mêmes versions que les holo de FUTBIN.
export const isHoloItem = (item) => {
  try {
    const cosmetics = item && item._hyperCosmeticDTOs;
    return !!(cosmetics && typeof cosmetics === "object" && Object.keys(cosmetics).length);
  } catch (e) {
    return false;
  }
};

// Cartes possédées (club ou stockage SBC) pour une liste de versions exactes, comme le
// constructeur d'équipe d'EA (défId + recherche exacte).
const ownedSearch = async (labelKey, run, definitionIds) => {
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
  const result = await call(labelKey, () => run(criteria), 15000);
  const items =
    (result.response && result.response.response && result.response.response.items) ||
    (result.response && result.response.data && result.response.data.items) ||
    [];
  return Object.assign(result, { items: Array.from(items) });
};

export const searchClubItems = (definitionIds) =>
  ownedSearch("misc.callClub", (criteria) => services().Club.search(criteria), definitionIds);

export const searchStorageItems = (definitionIds) => {
  const svc = itemService();
  if (!svc || typeof svc.searchStorageItems !== "function") {
    return Promise.resolve({ ok: true, items: [] });
  }
  return ownedSearch("misc.callStorage", (criteria) => svc.searchStorageItems(criteria), definitionIds);
};

// ------------------------------------------------ club, non attribués, packs (outils)

const itemsOf = (result) =>
  Array.from(
    (result.response && result.response.response && result.response.response.items) ||
      (result.response && result.response.data && result.response.data.items) ||
      []
  );

// Cartes « non attribuées » (achats, récompenses, contenu des packs).
export const fetchUnassigned = async () => {
  const svc = requireItemService();
  const result = await call("tools.callUnassigned", () => svc.requestUnassignedItems());
  return Object.assign(result, { items: itemsOf(result) });
};

// Cartes d'une liste dont l'identifiant figure dans data.itemIds (réponse EA : cartes réellement traitées).
const splitByIds = (items, result) => {
  const data = (result.response && result.response.data) || {};
  const ids = new Set(Array.from(data.itemIds || []).map(String));
  return {
    done: items.filter((item) => ids.has(String(item.id))),
    refused: items.filter((item) => !ids.has(String(item.id))),
  };
};

// Déplacement groupé (CLUB, TRANSFER, STORAGE = stockage DCE). EA ignore les cartes impossibles à
// déplacer (non échangeable vers les transferts, non stockable…) : seules celles de data.itemIds l'ont
// été. Vers le club, un doublon échange sa place avec la copie du club (data.clubDuplicates) : ne jamais
// envoyer de doublon au club sans le vouloir.
export const moveItems = async (items, pileName) => {
  const svc = requireItemService();
  if (!items || !items.length) {
    return { ok: true, moved: [], refused: [], swapped: [] };
  }
  const result = await call("misc.callMove", () => svc.move(pageArrayOf(items), pile(pileName)), 20000);
  const data = (result.response && result.response.data) || {};
  const { done, refused } = splitByIds(items, result);
  return Object.assign(result, { moved: done, refused, swapped: Array.from(data.clubDuplicates || []) });
};

// Vente rapide (irréversible : les pièces de vente rapide sont créditées). EA renvoie les cartes vendues.
export const discardItems = async (items) => {
  const svc = requireItemService();
  if (!items || !items.length) {
    return { ok: true, sold: [], refused: [] };
  }
  const result = await call("tools.callDiscard", () => svc.discard(pageArrayOf(items)), 20000);
  const { done, refused } = splitByIds(items, result);
  return Object.assign(result, { sold: done, refused });
};

// Une page de joueurs du club (offset / count), comme la liste du club du web app.
export const fetchClubPage = async (offset, count = 90, extra = {}) => {
  const Dto = pageGlobal("UTSearchCriteriaDTO");
  let criteria;
  try {
    criteria = typeof Dto === "function" ? new Dto() : { type: "player" };
  } catch (e) {
    criteria = { type: "player" };
  }
  criteria.type = extra.type || "player";
  criteria.offset = offset;
  criteria.count = count;
  const result = await call("misc.callClub", () => services().Club.search(criteria), 20000);
  const response = (result.response && (result.response.response || result.response.data)) || {};
  return Object.assign(result, {
    items: Array.from(response.items || []),
    retrievedAll: response.retrievedAll === true || response.endOfList === true,
  });
};

// Identifiants des cartes de l'équipe active (titulaires, remplaçants, réservistes).
export const activeSquadItemIds = async () => {
  const svc = services();
  if (!svc || !svc.Squad || typeof svc.Squad.requestSquadByType !== "function") {
    return { ok: false, ids: new Set() };
  }
  const result = await call("tools.callSquad", () => svc.Squad.requestSquadByType("active"), 15000);
  const squad = result.response && result.response.data && result.response.data.squad;
  const ids = new Set();
  try {
    const slots = (squad && typeof squad.getPlayers === "function" && squad.getPlayers()) || [];
    Array.from(slots).forEach((slot) => {
      const item = slot && (slot.item || slot);
      if (item && item.id) {
        ids.add(String(item.id));
      }
    });
  } catch (e) {}
  return { ok: result.ok, ids };
};

// Packs possédés (« Mes packs ») : services.Store.getPacks, entités marquées isMyPack.
export const fetchMyPacks = async () => {
  const svc = services();
  if (!svc || !svc.Store || typeof svc.Store.getPacks !== "function") {
    return { ok: false, packs: [], error: { code: -1, kind: "other", label: t("tools.errStore") } };
  }
  // Liste relue (récompenses de DCE, packs ouverts ailleurs) plutôt que le cache du magasin.
  markStoreDirty();
  const types = pageGlobal("PurchasePackType");
  const all = types && types.ALL != null ? types.ALL : "all";
  const result = await call("tools.callPacks", () => svc.Store.getPacks(all, true, true), 20000);
  const packs = Array.from((result.response && result.response.response && result.response.response.packs) || (result.response && result.response.packs) || []);
  return Object.assign(result, { packs: packs.filter((pack) => pack && pack.isMyPack) });
};

// Ouvre un pack possédé (même appel que le bouton « Ouvrir » du web app). Un pack du magasin (non
// possédé) est toujours refusé : MagicBuyer n'achète jamais de pack.
export const openOwnedPack = async (pack) => {
  if (!pack || pack.isMyPack !== true || typeof pack.open !== "function") {
    return { ok: false, items: [], error: { code: -1, kind: "other", label: t("tools.errPack") } };
  }
  const result = await call("tools.callOpenPack", () => pack.open(), 20000);
  const items = Array.from((result.response && result.response.response && result.response.response.items) || []);
  if (result.ok) {
    try {
      repositories().Item.setDirty(pile("PURCHASED"));
    } catch (e) {}
    try {
      const user = services().User.getUser();
      if (user && typeof user.decrementNumUnopenedPacks === "function") {
        user.decrementNumUnopenedPacks();
      }
    } catch (e) {}
  }
  return Object.assign(result, { items });
};

// Utilise un objet « divers » des non attribués (pièces gratuites, boost, pack gratuit, jetons) :
// même appel que le bouton « Utiliser » du web app.
export const redeemItem = async (item) => {
  const svc = requireItemService();
  if (typeof svc.redeem !== "function") {
    return { ok: false, response: null, error: { code: -1, kind: "other", label: t("tools.errRedeem") } };
  }
  return call("tools.callRedeem", () => svc.redeem(item), 15000);
};

// Magasin à recharger par le web app (liste des packs) après nos ouvertures.
export const markStoreDirty = () => {
  try {
    repositories().Store.setDirty();
  } catch (e) {}
};

export const refreshCoins = async () => {
  const svc = services();
  if (!svc || !svc.User || typeof svc.User.requestCurrencies !== "function") {
    return { ok: false };
  }
  return call("misc.callCoins", () => svc.User.requestCurrencies(), 10000);
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
