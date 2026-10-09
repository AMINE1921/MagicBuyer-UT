import { t } from "../i18n";
import { eaName } from "./eaLists";
import { pageGlobal, toPageArray } from "./page";
import { ceilPrice, floorPrice, priceAbove, toInt } from "./prices";
import { loadJson, loadLegacy, saveJson } from "./storage";

// Un filtre = une cible de snipe (joueur / critères) + ses prix d'achat et de vente.
export const DEFAULT_FILTER = {
  id: "",
  // Nom par défaut dans la langue de l'interface (lu à chaque création de filtre).
  get name() {
    return t("misc.filterDefaultName");
  },
  enabled: true,
  type: "player",
  player: null, // { id: baseId, name, rating }
  definitionId: 0, // version exacte d'une carte (optionnel)
  level: "any",
  rarities: [],
  position: "any",
  zone: -1,
  nation: -1,
  league: -1,
  club: -1,
  playStyle: -1,
  // Cartes holographiques : "any" (toutes), "only" (holo seulement), "none" (sans holo). Tri fait par le
  // bot sur les résultats (la recherche EA ne filtre pas les holo).
  holo: "any",
  category: "any",
  minRating: 0,
  maxRating: 0,
  minBuy: 0,
  maxBuy: 0, // prix d'achat max (BIN) ; en mode FUTBIN ou prix marché, plafond absolu optionnel
  // "fixed" | "futbin" (achat à X % du prix FUTBIN) | "market" (achat à X % du prix marché EA relu
  // par le bot : version exacte, avec ou sans style de chimie, revente un palier sous ce prix)
  priceMode: "fixed",
  futbinPercent: 90, // X % d'achat des modes "futbin" et "market"
  futbinList: "", // mode FUTBIN sans joueur : lien de liste FUTBIN (vide = construit d'après les critères)
  futbinUrl: "", // page FUTBIN de la version exacte choisie (évite toute ambiguïté)
  futbinId: 0,
  sellMode: "global", // "global" (onglet Vente) | "fixed" | "futbin"
  sellPrice: 0,
  sellPercent: "",
  maxBid: 0,
  bidPercent: 0, // mode FUTBIN : enchère max à X % du prix FUTBIN de chaque carte (0 = enchère max fixe)
};

const PRICE_MODES = ["fixed", "futbin", "market"];

const STORAGE_KEY = "filters";
const listeners = new Set();

const makeId = () =>
  `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const normalizeFilter = (raw) => {
  const filter = Object.assign({}, DEFAULT_FILTER, raw || {});
  filter.id = filter.id || makeId();
  filter.name = String(filter.name || "").trim() || t("misc.filterFallbackName");
  filter.enabled = filter.enabled !== false;
  filter.type = filter.type || "player";
  const player = filter.player;
  filter.player =
    player && toInt(player.id)
      ? {
          id: toInt(player.id) & 0xffffff,
          name: String(player.name || "").trim(),
          rating: toInt(player.rating),
        }
      : null;
  filter.definitionId = toInt(filter.definitionId);
  filter.rarities = (Array.isArray(filter.rarities) ? filter.rarities : [])
    .map((value) => parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value >= 0);
  // Zones EA FC 27 : 130 défense, 131 milieu, 132 attaque (-1 = aucune).
  ["nation", "league", "club", "playStyle", "zone"].forEach((key) => {
    const n = parseInt(filter[key], 10);
    filter[key] = Number.isFinite(n) && n > 0 ? n : -1;
  });
  ["minRating", "maxRating", "minBuy", "maxBuy", "sellPrice", "maxBid"].forEach(
    (key) => {
      filter[key] = toInt(filter[key]);
    }
  );
  ["level", "position", "category"].forEach((key) => {
    filter[key] = filter[key] ? String(filter[key]) : "any";
  });
  filter.holo = ["only", "none"].includes(filter.holo) ? filter.holo : "any";
  filter.priceMode = PRICE_MODES.includes(filter.priceMode) ? filter.priceMode : "fixed";
  const percent = parseFloat(filter.futbinPercent);
  filter.futbinPercent = Number.isFinite(percent) ? Math.min(150, Math.max(10, percent)) : 90;
  const bidPercent = parseFloat(filter.bidPercent);
  filter.bidPercent = Number.isFinite(bidPercent) && bidPercent > 0 ? Math.min(150, Math.max(10, bidPercent)) : 0;
  // Filtres enregistrés avant les modes de revente : un prix de revente saisi reste prioritaire.
  const wantedSell = raw && raw.sellMode;
  filter.sellMode = ["global", "fixed", "futbin"].includes(wantedSell)
    ? wantedSell
    : filter.sellPrice > 0
    ? "fixed"
    : "global";
  filter.sellPercent = String(filter.sellPercent || "").trim();
  filter.futbinList = String(filter.futbinList || "").trim();
  filter.futbinUrl = filter.definitionId ? String(filter.futbinUrl || "").trim() : "";
  filter.futbinId = filter.definitionId ? toInt(filter.futbinId) : 0;
  return filter;
};

// Carte dont le prix FUTBIN sert de référence au filtre (version exacte, sinon carte de base).
export const futbinKeyForFilter = (filter) =>
  (filter && (filter.definitionId || (filter.player && filter.player.id))) || 0;

// Migration des filtres de la v4 (localStorage "mbSavedFilters").
const migrateLegacy = () => {
  const legacy = loadLegacy("mbSavedFilters");
  if (!Array.isArray(legacy) || !legacy.length) {
    return [];
  }
  return legacy
    .map((entry) => {
      const criteria = (entry && entry.criteria) || {};
      const player = entry && entry.player;
      return normalizeFilter({
        name: entry && entry.name,
        player:
          player && (player.eaId || player.id)
            ? {
                id: player.eaId || player.id,
                name: player.name,
                rating: player.rating,
              }
            : null,
        level: criteria.level === "special" ? "SP" : criteria.level,
        position: criteria.position,
        nation: criteria.nation || criteria.nationality,
        league: criteria.league,
        club: criteria.club,
        minBuy: criteria.minBuy,
        maxBuy: criteria.maxBuy,
        maxBid: criteria.maxBid,
      });
    })
    .filter((filter) => filter.player || filter.maxBuy);
};

const load = () => {
  const stored = loadJson(STORAGE_KEY, null);
  if (stored && Array.isArray(stored.list)) {
    return {
      list: stored.list.map(normalizeFilter),
      activeId: stored.activeId || null,
      rotation: Object.assign(
        { enabled: false, every: 3, random: false },
        stored.rotation || {}
      ),
      lastEaSearch: stored.lastEaSearch || null,
    };
  }
  const migrated = migrateLegacy();
  const list = migrated.length ? migrated : [normalizeFilter({ name: t("misc.filterFirstName") })];
  return {
    list,
    activeId: list[0].id,
    rotation: { enabled: false, every: 3, random: false },
    lastEaSearch: null,
  };
};

let data = load();

const emit = () => {
  saveJson(STORAGE_KEY, data);
  listeners.forEach((fn) => {
    try {
      fn(data);
    } catch (e) {}
  });
};

export const onFiltersChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getFilters = () => data.list;
export const getRotation = () => data.rotation;

export const getActiveFilter = () =>
  data.list.find((filter) => filter.id === data.activeId) || data.list[0] || null;

export const setActiveFilter = (id) => {
  if (data.list.some((filter) => filter.id === id)) {
    data = Object.assign({}, data, { activeId: id });
    emit();
  }
};

export const updateFilter = (id, patch) => {
  data = Object.assign({}, data, {
    list: data.list.map((filter) =>
      filter.id === id ? normalizeFilter(Object.assign({}, filter, patch, { id })) : filter
    ),
  });
  emit();
};

export const addFilter = (raw, activate = true) => {
  const filter = normalizeFilter(Object.assign({}, raw, { id: "" }));
  data = Object.assign({}, data, {
    list: data.list.concat(filter),
    activeId: activate ? filter.id : data.activeId,
  });
  emit();
  return filter;
};

export const duplicateFilter = (id) => {
  const source = data.list.find((filter) => filter.id === id);
  if (!source) {
    return null;
  }
  return addFilter(Object.assign({}, source, { name: t("misc.filterCopyName", { name: source.name }) }));
};

// Ménage : supprime d'un coup tous les filtres désactivés (une seule sauvegarde). Renvoie le nombre supprimé.
export const removeInactiveFilters = () => {
  const kept = data.list.filter((filter) => filter.enabled !== false);
  const removed = data.list.length - kept.length;
  if (!removed) {
    return 0;
  }
  const list = kept.length ? kept : [normalizeFilter({ name: t("misc.filterFirstName") })];
  const activeId = list.some((filter) => filter.id === data.activeId) ? data.activeId : list[0].id;
  data = Object.assign({}, data, { list, activeId });
  emit();
  return removed;
};

export const removeFilter = (id) => {
  let list = data.list.filter((filter) => filter.id !== id);
  if (!list.length) {
    list = [normalizeFilter({ name: t("misc.filterFirstName") })];
  }
  const activeId = list.some((filter) => filter.id === data.activeId)
    ? data.activeId
    : list[0].id;
  data = Object.assign({}, data, { list, activeId });
  emit();
};

// Export JSON des filtres (sans identifiant interne, aucun secret dedans) : sauvegarde ou partage.
export const FILTER_EXPORT_KIND = "magicbuyer-filters";
const FILTER_KEYS = Object.keys(DEFAULT_FILTER).filter((key) => key !== "id");
const MAX_IMPORT = 100;

const portable = (filter) =>
  FILTER_KEYS.reduce((copy, key) => {
    copy[key] = filter[key];
    return copy;
  }, {});

export const exportFilters = (ids = null) =>
  JSON.stringify(
    {
      kind: FILTER_EXPORT_KIND,
      version: 1,
      exportedAt: new Date().toISOString(),
      filters: data.list.filter((filter) => !ids || ids.includes(filter.id)).map(portable),
    },
    null,
    2
  );

// Import : les filtres lus sont ajoutés (jamais de remplacement), le premier devient actif.
// Accepte l'export complet, une liste de filtres ou un filtre seul. { added, error: "" | "json" | "empty" }
export const importFilters = (text) => {
  let parsed;
  try {
    parsed = JSON.parse(String(text || "").trim());
  } catch (e) {
    return { added: 0, error: "json" };
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray(parsed.filters)
    ? parsed.filters
    : parsed && typeof parsed === "object" && !parsed.kind
    ? [parsed]
    : [];
  const entries = raw.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)).slice(0, MAX_IMPORT);
  if (!entries.length) {
    return { added: 0, error: "empty" };
  }
  const added = entries.map((entry) =>
    normalizeFilter(
      FILTER_KEYS.reduce(
        (copy, key) => {
          if (key !== "name" && entry[key] !== undefined) {
            copy[key] = entry[key];
          }
          return copy;
        },
        { name: typeof entry.name === "string" ? entry.name.slice(0, 60) : "" }
      )
    )
  );
  data = Object.assign({}, data, { list: data.list.concat(added), activeId: added[0].id });
  emit();
  return { added: added.length, error: "" };
};

// Préréglage « fourrage DCE » : une cible par note (or, mode FUTBIN), achat sous le prix FUTBIN
// de chaque carte, revente à son prix FUTBIN ; rotation activée entre ces filtres. Les cartes les
// moins chères de chaque note (liste FUTBIN triée par prix) sont suivies.
// 84 et moins : prix plancher (vente rapide) trop proche du prix FUTBIN pour une marge utile.
export const FODDER_PRESET = [
  { rating: 85, futbinPercent: 85, bidPercent: 72 },
  { rating: 86, futbinPercent: 85, bidPercent: 72 },
  { rating: 87, futbinPercent: 85, bidPercent: 72 },
];

export const addFodderFilters = () => {
  const added = FODDER_PRESET.map((preset) =>
    normalizeFilter({
      name: t("misc.fodderFilterName", { rating: preset.rating }),
      type: "player",
      level: "gold",
      minRating: preset.rating,
      maxRating: preset.rating,
      priceMode: "futbin",
      futbinPercent: preset.futbinPercent,
      bidPercent: preset.bidPercent,
      sellMode: "futbin",
      sellPercent: "100",
    })
  );
  data = Object.assign({}, data, {
    list: data.list.concat(added),
    activeId: added[0].id,
    rotation: Object.assign({}, data.rotation, { enabled: true }),
  });
  // Seuls les filtres fourrage tournent : les autres sont décochés de la rotation.
  const ids = new Set(added.map((filter) => filter.id));
  data = Object.assign({}, data, { list: data.list.map((filter) => (ids.has(filter.id) || !filter.enabled ? filter : Object.assign({}, filter, { enabled: false }))) });
  emit();
  return added;
};

export const setRotation = (patch) => {
  data = Object.assign({}, data, {
    rotation: Object.assign({}, data.rotation, patch),
  });
  emit();
};

export const setLastEaSearch = (snapshot) => {
  data = Object.assign({}, data, { lastEaSearch: snapshot });
  emit();
};

export const getLastEaSearch = () => data.lastEaSearch;

// Filtres utilisés par le bot : la rotation (filtres cochés) ou le filtre actif seul.
export const runnableFilters = () => {
  if (data.rotation.enabled) {
    const enabled = data.list.filter((filter) => filter.enabled);
    if (enabled.length) {
      return enabled;
    }
  }
  const active = getActiveFilter();
  return active ? [active] : [];
};

// Une cible = un joueur, une version exacte ou au moins un critère restrictif.
// Un prix seul ne suffit pas (sinon le bot achèterait n'importe quel joueur sous ce prix).
export const filterHasTarget = (filter) =>
  !!(
    filter &&
    ((filter.player && filter.player.id) ||
      filter.definitionId ||
      filter.rarities.length ||
      filter.level !== "any" ||
      filter.nation > 0 ||
      filter.league > 0 ||
      filter.club > 0 ||
      filter.playStyle > 0 ||
      filter.zone > 0 ||
      (filter.position && filter.position !== "any") ||
      filter.minRating ||
      filter.maxRating)
  );

export const describeFilter = (filter) => {
  if (!filter) {
    return t("misc.filterNone");
  }
  const parts = [];
  if (filter.player) {
    parts.push(
      `${filter.player.name || t("misc.filterPlayer")}${filter.player.rating ? ` ${filter.player.rating}` : ""}`
    );
  } else if (filter.definitionId) {
    parts.push(t("misc.filterCard", { id: filter.definitionId }));
  } else {
    parts.push(t("misc.filterAllPlayers"));
  }
  const levels = { bronze: "misc.levelBronze", silver: "misc.levelSilver", gold: "misc.levelGold", SP: "misc.levelSpecial" };
  if (levels[filter.level]) {
    parts.push(t(levels[filter.level]));
  }
  if (filter.rarities.length) {
    const named = filter.rarities.map((id) => eaName("rarity", id));
    parts.push(named.every(Boolean) ? named.join(" / ") : t("misc.filterRarity", { ids: filter.rarities.join("/") }));
  }
  if (filter.holo !== "any") {
    parts.push(t(filter.holo === "only" ? "misc.filterHoloOnly" : "misc.filterHoloNone"));
  }
  if (filter.position && filter.position !== "any") {
    parts.push(filter.position);
  }
  if (filter.nation > 0) {
    parts.push(eaName("nation", filter.nation) || t("misc.filterNation", { id: filter.nation }));
  }
  if (filter.league > 0) {
    parts.push(eaName("league", filter.league) || t("misc.filterLeague", { id: filter.league }));
  }
  if (filter.club > 0) {
    parts.push(eaName("club", filter.club) || t("misc.filterClub", { id: filter.club }));
  }
  if (filter.playStyle > 0) {
    parts.push(t("misc.filterStyle", { name: eaName("style", filter.playStyle) || filter.playStyle }));
  }
  if (filter.minRating || filter.maxRating) {
    parts.push(t("misc.filterRating", { min: filter.minRating || "…", max: filter.maxRating || "…" }));
  }
  if (filter.priceMode === "futbin") {
    parts.push(t("misc.filterFutbinBuy", { percent: filter.futbinPercent }));
  } else if (filter.priceMode === "market") {
    parts.push(t("misc.filterMarketBuy", { percent: filter.futbinPercent }));
  }
  return parts.join(" · ");
};

// Critères "vides" hors web app (tests) : mêmes valeurs par défaut que UTSearchCriteriaDTO.
const plainCriteria = () => ({
  type: "any",
  category: "any",
  position: "any",
  zone: -1,
  level: "any",
  rarities: [],
  defId: [],
  maskedDefId: 0,
  nation: -1,
  league: -1,
  club: -1,
  playStyle: -1,
  minBid: 0,
  maxBid: 0,
  minBuy: 0,
  maxBuy: 0,
  offset: 0,
  count: 21,
  authenticity: "any",
  primaryColor: -1,
  secondaryColor: -1,
  icontraits: "any",
});

// Construit un vrai UTSearchCriteriaDTO FC 27. Attention : le setter `type` remet
// nation/subtypes à zéro, il doit donc être assigné en premier.
export const buildCriteria = (filter, prices = {}) => {
  const Dto = pageGlobal("UTSearchCriteriaDTO");
  let criteria;
  try {
    criteria = typeof Dto === "function" ? new Dto() : plainCriteria();
  } catch (e) {
    criteria = plainCriteria();
  }
  criteria.type = filter.type || "player";
  if (filter.category && filter.category !== "any") {
    criteria.category = filter.category;
  }
  if (filter.level && filter.level !== "any") {
    criteria.level = filter.level;
  }
  // Une seule rareté par requête, comme le web app (plusieurs raretés à la fois = requête qu'aucun
  // client EA n'envoie) : avec plusieurs raretés, chaque recherche prend la suivante (rarityIndex).
  if (filter.rarities.length) {
    const index = Math.max(0, toInt(prices.rarityIndex)) % filter.rarities.length;
    criteria.rarities = toPageArray([filter.rarities[index]]);
  }
  if (filter.zone >= 0) {
    criteria.zone = filter.zone;
  } else if (filter.position && filter.position !== "any") {
    criteria.position = filter.position;
  }
  if (filter.nation > 0) {
    criteria.nation = filter.nation;
  }
  if (filter.league > 0) {
    criteria.league = filter.league;
  }
  if (filter.club > 0) {
    criteria.club = filter.club;
  }
  if (filter.playStyle > 0) {
    criteria.playStyle = filter.playStyle;
  }
  // defId (version exacte) est prioritaire côté EA sur maskedDefId (toutes versions).
  if (filter.definitionId > 0) {
    criteria.defId = toPageArray([filter.definitionId]);
  } else if (filter.player && filter.player.id > 0) {
    criteria.maskedDefId = filter.player.id;
  }
  const minBuy = toInt(prices.minBuy != null ? prices.minBuy : filter.minBuy);
  const maxBuy = toInt(prices.maxBuy != null ? prices.maxBuy : filter.maxBuy);
  const minBid = toInt(prices.minBid);
  const maxBid = toInt(prices.maxBid);
  // Max arrondis vers le bas, min vers le haut : jamais au-delà de ce qui a été saisi.
  if (minBuy) {
    criteria.minBuy = ceilPrice(minBuy);
  }
  if (maxBuy) {
    criteria.maxBuy = floorPrice(maxBuy);
  }
  if (minBid) {
    criteria.minBid = ceilPrice(minBid);
  }
  if (maxBid) {
    criteria.maxBid = floorPrice(maxBid);
  }
  return criteria;
};

// Anti-cache EA : chaque recherche doit avoir une URL différente pour obtenir des
// résultats frais. Le mode "auto" fait varier l'enchère max AU-DESSUS du prix d'achat
// max : aucune annonce achetable n'est jamais exclue (enchère < BIN ≤ prix max).
export const cacheBusterPrices = (mode, step, { maxBuy, minBuy, maxBid, cap }) => {
  const out = { minBuy, maxBuy, maxBid, minBid: 0 };
  const variants = 20;
  const index = step % variants;
  const capped = Math.max(150, toInt(cap) || 1000);
  const ladder = (from, count) => {
    let value = ceilPrice(from) || 150;
    for (let i = 0; i < count; i += 1) {
      value = priceAbove(value);
    }
    return value;
  };
  let effective = mode;
  if (effective === "auto") {
    effective = maxBuy && !maxBid ? "maxBid" : "minBuy";
  }
  // Achat min déjà fixé (tranche de prix) : la variation passe par l'enchère max.
  if (effective === "minBuy" && minBuy && maxBuy && !maxBid) {
    effective = "maxBid";
  }
  if (effective === "maxBid" && maxBuy) {
    out.maxBid = ladder(maxBuy, index);
    return out;
  }
  if (effective === "minBuy") {
    const ceiling = maxBuy ? Math.min(capped, Math.floor(maxBuy * 0.5)) : capped;
    if (ceiling >= 150 && !minBuy) {
      const choices = [];
      for (let v = 150; v <= ceiling && choices.length < 40; v = priceAbove(v)) {
        choices.push(v);
      }
      out.minBuy = choices.length ? choices[index % choices.length] : 0;
    }
    return out;
  }
  if (effective === "minBid") {
    const ceiling = Math.min(capped, maxBid ? Math.floor(maxBid * 0.5) : capped);
    const choices = [];
    for (let v = 150; v <= ceiling && choices.length < 40; v = priceAbove(v)) {
      choices.push(v);
    }
    out.minBid = choices.length ? choices[index % choices.length] : 0;
    return out;
  }
  return out;
};

// Snapshot sérialisable d'une recherche du marché EA (import depuis l'interface native).
export const snapshotFromEaCriteria = (criteria, playerData) => {
  if (!criteria) {
    return null;
  }
  const read = (key, fallback) => {
    try {
      const value = criteria[key];
      return value == null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  };
  const defIds = read("defId", []);
  const rarities = read("rarities", []);
  let player = null;
  try {
    if (playerData) {
      const data = Array.isArray(playerData) ? playerData[0] : playerData;
      const id = toInt(
        data && (data.id || data.databaseId || data.assetId || data.definitionId)
      );
      if (id) {
        const name =
          (data.commonName || data.knownAs || "").trim() ||
          `${data.firstName || ""} ${data.lastName || ""}`.trim() ||
          data.name ||
          "";
        player = { id: id & 0xffffff, name, rating: toInt(data.rating) };
      }
    }
  } catch (e) {}
  const masked = toInt(read("maskedDefId", 0));
  if (!player && masked) {
    player = { id: masked & 0xffffff, name: "", rating: 0 };
  }
  const signed = (key) => {
    const n = parseInt(read(key, -1), 10);
    return Number.isFinite(n) && n > 0 ? n : -1;
  };
  return {
    type: read("type", "player") === "any" ? "player" : read("type", "player"),
    category: read("category", "any"),
    level: read("level", "any"),
    rarities: Array.from(rarities || []).map(Number),
    position: read("position", "any"),
    zone: signed("zone"),
    nation: signed("nation"),
    league: signed("league"),
    club: signed("club"),
    playStyle: signed("playStyle"),
    definitionId: defIds && defIds.length ? toInt(defIds[0]) : 0,
    player,
    minBuy: toInt(read("minBuy", 0)),
    maxBuy: toInt(read("maxBuy", 0)),
    maxBid: toInt(read("maxBid", 0)),
    capturedAt: Date.now(),
  };
};
