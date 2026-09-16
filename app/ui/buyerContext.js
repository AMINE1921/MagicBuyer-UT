import { getValue, setValue } from "../services/repository";
import { getPageServices, getPageWindow } from "../utils/pageWindow";

const FALLBACK_CRITERIA = {
  type: "player",
  defId: [],
};

const FORBIDDEN_KEYS = new Set([
  "definitionId",
  "authenticity",
  "acquiredDate",
  "untradeables",
  "untradeable",
]);

const KNOWN_FIELDS = [
  "type",
  "category",
  "position",
  "zone",
  "nationality",
  "league",
  "club",
  "playStyle",
  "minBid",
  "maxBid",
  "minBuy",
  "maxBuy",
  "level",
  "maskedDefId",
  "defId",
  "rarities",
];

const pickEaId = (criteria) => {
  if (!criteria) {
    return 0;
  }
  const masked = Number(criteria.maskedDefId);
  if (masked) {
    return masked;
  }
  const definition = Number(criteria.definitionId);
  if (definition) {
    return definition;
  }
  const defId = criteria.defId;
  if (Array.isArray(defId) && defId[0]) {
    return Number(defId[0]) || 0;
  }
  if (defId && !Array.isArray(defId)) {
    return Number(defId) || 0;
  }
  const player = getValue("lastSearchPlayer");
  return (player && Number(player.eaId)) || 0;
};

const isEmptyFilter = (key, value) => {
  if (value == null || value === "") {
    return true;
  }
  if (typeof value === "function") {
    return true;
  }
  if (key === "type") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (key === "minBid" || key === "maxBid" || key === "minBuy" || key === "maxBuy") {
    return !Number(value);
  }
  if (key === "maskedDefId") {
    return !Number(value);
  }
  if (
    value === "any" ||
    value === -1 ||
    value === "-1"
  ) {
    return true;
  }
  return false;
};

export const sanitizeEaSearchCriteria = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {};
  const out = { type: source.type || "player", defId: [] };

  Object.keys(source).forEach((key) => {
    if (
      FORBIDDEN_KEYS.has(key) ||
      key.charAt(0) === "_" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      return;
    }
    let value;
    try {
      value = source[key];
    } catch (e) {
      return;
    }
    if (isEmptyFilter(key, value)) {
      return;
    }
    out[key] = value;
  });

  KNOWN_FIELDS.forEach((key) => {
    if (out[key] != null || FORBIDDEN_KEYS.has(key)) {
      return;
    }
    const value = source[key];
    if (isEmptyFilter(key, value)) {
      return;
    }
    out[key] = value;
  });

  const eaId = pickEaId(source);
  if (eaId) {
    out.maskedDefId = eaId;
  }
  out.defId = [];
  out.type = out.type || "player";
  ["minBid", "maxBid", "minBuy", "maxBuy", "maskedDefId"].forEach((key) => {
    if (out[key] != null) {
      const n = Number(out[key]);
      if (n) {
        out[key] = n;
      } else {
        delete out[key];
      }
    }
  });
  FORBIDDEN_KEYS.forEach((key) => {
    delete out[key];
  });
  return out;
};

const ARRAY_KEYS = [
  "defId",
  "rarities",
  "types",
  "playStyles",
  "roles",
  "playerRoles",
  "traits",
  "chemistryStyles",
];

const ensureCriteriaArrays = (dto) => {
  ARRAY_KEYS.forEach((key) => {
    if (!Array.isArray(dto[key])) {
      try {
        dto[key] = [];
      } catch (e) {}
    }
  });
  return dto;
};

const findSearchCriteriaCtor = () => {
  const page = getPageWindow();
  const names = [
    "UTSearchCriteriaDTO",
    "SearchCriteria",
    "UTItemSearchCriteriaDTO",
    "UTMarketSearchCriteriaDTO",
  ];
  for (const name of names) {
    if (page && typeof page[name] === "function") {
      return page[name];
    }
    if (typeof window[name] === "function") {
      return window[name];
    }
  }
  const existing =
    (getValue("AutoBuyerInstance") &&
      getValue("AutoBuyerInstance").viewmodel &&
      getValue("AutoBuyerInstance").viewmodel.searchCriteria) ||
    getValue("lastSearchCriteria");
  if (
    existing &&
    existing.constructor &&
    existing.constructor !== Object &&
    typeof existing.constructor === "function"
  ) {
    return existing.constructor;
  }
  return null;
};

const applyCleanToDto = (dto, clean) => {
  const assign = [
    "type",
    "category",
    "position",
    "zone",
    "nationality",
    "league",
    "club",
    "playStyle",
    "minBid",
    "maxBid",
    "minBuy",
    "maxBuy",
    "level",
    "maskedDefId",
  ];
  assign.forEach((key) => {
    if (clean[key] == null) {
      return;
    }
    try {
      dto[key] = clean[key];
    } catch (e) {}
  });
  dto.type = clean.type || dto.type || "player";
  dto.defId = [];
  if (clean.maskedDefId) {
    dto.maskedDefId = clean.maskedDefId;
  }
  if (Array.isArray(clean.rarities) && clean.rarities.length) {
    dto.rarities = clean.rarities;
  }
  return ensureCriteriaArrays(dto);
};

export const toEaSearchDto = (raw) => {
  const clean = sanitizeEaSearchCriteria(raw);
  const Ctor = findSearchCriteriaCtor();
  if (typeof Ctor === "function") {
    try {
      return applyCleanToDto(new Ctor(), clean);
    } catch (e) {}
  }
  return ensureCriteriaArrays({
    type: clean.type || "player",
    category: clean.category || "any",
    position: clean.position || "any",
    zone: clean.zone != null ? clean.zone : -1,
    nationality: clean.nationality != null ? clean.nationality : -1,
    league: clean.league != null ? clean.league : -1,
    club: clean.club != null ? clean.club : -1,
    playStyle: clean.playStyle != null ? clean.playStyle : -1,
    playStylePlus: -1,
    minBid: clean.minBid || 0,
    maxBid: clean.maxBid || 0,
    minBuy: clean.minBuy || 0,
    maxBuy: clean.maxBuy || 0,
    level: clean.level || "any",
    maskedDefId: clean.maskedDefId || 0,
    defId: [],
    rarities: [],
    types: [],
    playStyles: [],
    roles: [],
    playerRoles: [],
    traits: [],
    chemistryStyles: [],
  });
};

const listeners = new Set();

export const onSearchCriteriaChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const notifyCriteria = (criteria) => {
  listeners.forEach((fn) => {
    try {
      fn(criteria);
    } catch (e) {}
  });
};

export const summarizeCriteria = (criteria) => {
  const player = getValue("lastSearchPlayer");
  if (!criteria && !player) {
    return "Aucune recherche capturée — cherche un joueur dans Cible, ou lance une recherche sur le marché.";
  }
  const parts = [];
  if (player && player.name) {
    parts.push(player.name + (player.rating ? ` ${player.rating}` : ""));
  }
  if (criteria && criteria.type) {
    parts.push(String(criteria.type));
  }
  if (criteria && (criteria.minBuy || criteria.maxBuy)) {
    parts.push(`BIN ${criteria.minBuy || 0}–${criteria.maxBuy || "∞"}`);
  }
  if (criteria && (criteria.minBid || criteria.maxBid)) {
    parts.push(`Bid ${criteria.minBid || 0}–${criteria.maxBid || "∞"}`);
  }
  if (criteria && criteria.maskedDefId) {
    parts.push("joueur ciblé");
  }
  if (criteria && criteria.league && criteria.league !== -1) {
    parts.push(`ligue ${criteria.league}`);
  }
  if (criteria && criteria.club && criteria.club !== -1) {
    parts.push(`club ${criteria.club}`);
  }
  return parts.length ? parts.join(" · ") : "Critères capturés";
};

export const captureSearchCriteria = (criteria) => {
  if (!criteria) {
    return;
  }
  const clean = sanitizeEaSearchCriteria(criteria);
  setValue("lastSearchCriteria", clean);
  setValue("lastSearchCriteriaAt", Date.now());
  const instance = getValue("AutoBuyerInstance");
  if (instance && instance.viewmodel) {
    instance.viewmodel.searchCriteria = clean;
  }
  notifyCriteria(clean);
};

export const createFallbackCriteria = () => {
  const last = getValue("lastSearchCriteria");
  if (last) {
    return sanitizeEaSearchCriteria(last);
  }
  return sanitizeEaSearchCriteria(FALLBACK_CRITERIA);
};

export const getBuyerContext = () => {
  let instance = getValue("AutoBuyerInstance");
  const criteria = getValue("lastSearchCriteria") || createFallbackCriteria();

  if (!instance || !instance.viewmodel) {
    const viewmodel = {
      searchCriteria: criteria,
      playerData: null,
      resetSearch: function () {},
    };
    instance = {
      viewmodel,
      _viewmodel: viewmodel,
    };
    setValue("AutoBuyerInstance", instance);
  } else if (criteria) {
    instance.viewmodel.searchCriteria = criteria;
    if (!instance._viewmodel) {
      instance._viewmodel = instance.viewmodel;
    }
  }
  return instance;
};

export const hookEaSearchCapture = () => {
  const services = getPageServices();
  if (!services || !services.Item) {
    return false;
  }
  const item = services.Item;
  if (item.__mbSearchHooked) {
    return true;
  }
  const orig = item.searchTransferMarket;
  if (typeof orig !== "function") {
    return false;
  }
  item.searchTransferMarket = function (criteria, page) {
    try {
      if (criteria && criteria.definitionId && !criteria.maskedDefId) {
        criteria.maskedDefId = Number(criteria.definitionId) || 0;
      }
      if (criteria) {
        ensureCriteriaArrays(criteria);
      }
      captureSearchCriteria(criteria);
    } catch (e) {}
    return orig.call(this, criteria, page);
  };
  item.__mbSearchHooked = true;
  return true;
};
