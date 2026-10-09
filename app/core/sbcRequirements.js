import { plural, t } from "../i18n";
import { pageGlobal, services } from "./page";

// Exigences d'un défi (DCE) : lecture des objets EA (UTSBCEligibilityDTO de FC 27) et forme
// normalisée utilisée par l'évaluateur et le solveur. Les identifiants sont relus dans le web app
// (énumération SBCEligibilityKey), avec repli sur les valeurs relevées dans le code d'EA.
//
// Forme normalisée : { index, key, terms: [{ key, id, values }], values, value, scope, count,
// combined, attribute, supported, label, raw }. scope : 0 = au moins, 1 = au plus, 2 = exactement.

export const KEYS = {
  TEAM_STAR_RATING: 0,
  PLAYER_COUNT: 2,
  PLAYER_QUALITY: 3,
  SAME_NATION_COUNT: 4,
  SAME_LEAGUE_COUNT: 5,
  SAME_CLUB_COUNT: 6,
  NATION_COUNT: 7,
  LEAGUE_COUNT: 8,
  CLUB_COUNT: 9,
  NATION_ID: 10,
  LEAGUE_ID: 11,
  CLUB_ID: 12,
  SCOPE: 13,
  LEGEND_COUNT: 15,
  NUM_TROPHY_REQUIRED: 16,
  PLAYER_LEVEL: 17,
  PLAYER_RARITY: 18,
  TEAM_RATING: 19,
  PLAYER_COUNT_COMBINED: 21,
  PLAYER_RARITY_GROUP: 25,
  PLAYER_MIN_OVR: 26,
  PLAYER_EXACT_OVR: 27,
  PLAYER_MAX_OVR: 28,
  FIRST_OWNER_PLAYERS_COUNT: 30,
  PLAYER_TRADABILITY: 33,
  CHEMISTRY_POINTS: 35,
  ALL_PLAYERS_CHEMISTRY_POINTS: 36,
  ACADEMY_PLAYER_SLOTTING: 40,
  PLAYER_ATTRIBUTE: 41,
  ADDITIONAL_TARGET_VALUE: 42,
};

export const SCOPE = { GREATER: 0, LOWER: 1, EXACT: 2 };

// Paliers de qualité (SBCEligibilityQualityType = ItemRatingTier) : bronze ≤ 64, argent ≤ 74, or au-delà.
export const QUALITY = { BRONZE: 1, SILVER: 2, GOLD: 3 };

// Exigences qu'EA sait vérifier seules (UTSBCChallengeEntity.isRequirementMet) …
const SINGLE_KEYS = new Set([
  "TEAM_STAR_RATING",
  "PLAYER_QUALITY",
  "SAME_NATION_COUNT",
  "SAME_LEAGUE_COUNT",
  "SAME_CLUB_COUNT",
  "NATION_COUNT",
  "LEAGUE_COUNT",
  "CLUB_COUNT",
  "NATION_ID",
  "LEAGUE_ID",
  "CLUB_ID",
  "LEGEND_COUNT",
  "PLAYER_LEVEL",
  "PLAYER_RARITY",
  "TEAM_RATING",
  "PLAYER_RARITY_GROUP",
  "PLAYER_MIN_OVR",
  "PLAYER_EXACT_OVR",
  "PLAYER_MAX_OVR",
  "FIRST_OWNER_PLAYERS_COUNT",
  "PLAYER_TRADABILITY",
  "CHEMISTRY_POINTS",
  "ALL_PLAYERS_CHEMISTRY_POINTS",
]);

// … et termes acceptés dans une exigence combinée (getApplicableSlotsForCombinedReq).
const COMBINED_KEYS = new Set([
  "ALL_PLAYERS_CHEMISTRY_POINTS",
  "NATION_ID",
  "LEAGUE_ID",
  "CLUB_ID",
  "PLAYER_MIN_OVR",
  "PLAYER_MAX_OVR",
  "PLAYER_EXACT_OVR",
  "PLAYER_TRADABILITY",
]);

// Table nom → identifiant : celle du web app quand elle existe (au cas où EA renumérote).
export const keyTable = () => {
  const table = Object.assign({}, KEYS);
  const live = pageGlobal("SBCEligibilityKey");
  if (live && typeof live === "object") {
    Object.keys(KEYS).forEach((name) => {
      const id = live[name];
      if (typeof id === "number" && Number.isFinite(id)) {
        table[name] = id;
      }
    });
  }
  return table;
};

const namesById = (table) =>
  Object.keys(table).reduce((acc, name) => {
    acc[table[name]] = name;
    return acc;
  }, {});

const call = (target, method, ...args) => {
  try {
    return target && typeof target[method] === "function" ? target[method](...args) : undefined;
  } catch (e) {
    return undefined;
  }
};

const toNumbers = (value) => {
  const list = value == null ? [] : typeof value === "object" && typeof value.length === "number" ? Array.from(value) : [value];
  return list.map((entry) => (typeof entry === "boolean" ? (entry ? 1 : 0) : Number(entry))).filter((entry) => Number.isFinite(entry));
};

// Clés d'une exigence EA (UTSBCEligibilityDTO.keys() ou kvPairs.keys()), en nombres.
const readKeys = (req) => {
  let keys = call(req, "keys");
  if (!keys || typeof keys.length !== "number") {
    keys = call(req && req.kvPairs, "keys");
  }
  return Array.from(keys || [])
    .map((key) => parseInt(key, 10))
    .filter((key) => Number.isFinite(key));
};

// Valeurs d'une clé : getValue() de l'exigence (EA renvoie [-1] quand la clé manque), sinon kvPairs.
const readValues = (req, id) => {
  let values = call(req, "getValue", id);
  if (values == null) {
    values = call(req && req.kvPairs, "getValue", id);
  }
  if (values == null) {
    values = call(req && req.kvPairs, "get", id);
  }
  if (values == null) {
    const first = call(req, "getFirstValue", id);
    values = first == null ? call(req && req.kvPairs, "getFirstValue", id) : first;
  }
  return toNumbers(values);
};

// Libellé d'EA (dans la langue du web app) ; une clé de traduction manquante commence par « * ».
const eaLabel = (req) => {
  const text = call(req, "buildString");
  return typeof text === "string" && text.trim() && text.trim()[0] !== "*" ? text.trim() : "";
};

const toScope = (value) => {
  const scope = Number(value);
  return scope === SCOPE.GREATER || scope === SCOPE.LOWER || scope === SCOPE.EXACT ? scope : SCOPE.EXACT;
};

// Exigence EA → forme normalisée.
export const normalizeRequirement = (req, index = 0, table = keyTable()) => {
  const names = namesById(table);
  const terms = readKeys(req).map((id) => ({ id, key: names[id] || `KEY_${id}`, values: readValues(req, id) }));
  const count = Number(req && req.count);
  const combined = terms.length > 1;
  const attribute = !!(req && req.isAttributeRequirement);
  const first = terms[0] || { key: "", id: -1, values: [] };
  const supported =
    !attribute && terms.length > 0 && (combined ? terms.every((term) => COMBINED_KEYS.has(term.key)) : SINGLE_KEYS.has(first.key));
  const normalized = {
    index,
    key: first.key,
    terms,
    values: first.values,
    value: first.values.length ? first.values[0] : -1,
    scope: toScope(req && req.scope),
    count: Number.isFinite(count) ? count : -1,
    combined,
    attribute,
    supported,
    label: "",
    raw: req || null,
  };
  normalized.label = eaLabel(req) || describeRequirement(normalized);
  return normalized;
};

// Exigences du défi affiché : { operation: "AND" | "OR", requirements }.
export const readChallengeRequirements = (challenge) => {
  const table = keyTable();
  const list = Array.from((challenge && challenge.eligibilityRequirements) || []);
  return {
    operation: String((challenge && challenge.eligibilityOperation) || "AND").toUpperCase() === "OR" ? "OR" : "AND",
    requirements: list.map((req, index) => normalizeRequirement(req, index, table)),
  };
};

// ------------------------------------------------------------------ libellés

const localize = (key) => {
  try {
    const svc = services();
    const text = svc && svc.Localization && svc.Localization.localize(key);
    return text && text !== key && text[0] !== "*" ? text : "";
  } catch (e) {
    return "";
  }
};

// Nom d'une nation / ligue / club d'après le web app (UTLocalizationUtil), sinon son identifiant.
export const nameOfValue = (kind, id) => {
  const year = pageGlobal("APP_YEAR");
  const keys = {
    nation: [`search.nationName.nation${id}`],
    league: year ? [`global.leagueabbr15.${year}.league${id}`] : [],
    club: year ? [`global.teamabbr15.${year}.team${id}`] : [],
  };
  const found = (keys[kind] || []).map(localize).find(Boolean);
  return found || `#${id}`;
};

const opText = (scope) => t(scope === SCOPE.GREATER ? "solver.opMin" : scope === SCOPE.LOWER ? "solver.opMax" : "solver.opExact");

const tierName = (tier) => t(tier === QUALITY.BRONZE ? "solver.tierBronze" : tier === QUALITY.SILVER ? "solver.tierSilver" : "solver.tierGold");

const valueList = (term) => {
  switch (term.key) {
    case "NATION_ID":
      return term.values.map((id) => nameOfValue("nation", id)).join(` ${t("solver.or")} `);
    case "LEAGUE_ID":
      return term.values.map((id) => nameOfValue("league", id)).join(` ${t("solver.or")} `);
    case "CLUB_ID":
      return term.values.map((id) => nameOfValue("club", id)).join(` ${t("solver.or")} `);
    case "PLAYER_LEVEL":
      return term.values.map(tierName).join(` ${t("solver.or")} `);
    default:
      return term.values.join(` ${t("solver.or")} `);
  }
};

const termText = (term) => {
  const value = term.values.length ? term.values[0] : -1;
  switch (term.key) {
    case "NATION_ID":
    case "LEAGUE_ID":
    case "CLUB_ID":
      return valueList(term);
    case "PLAYER_MIN_OVR":
      return t("solver.termMinOvr", { value });
    case "PLAYER_MAX_OVR":
      return t("solver.termMaxOvr", { value });
    case "PLAYER_EXACT_OVR":
      return t("solver.termExactOvr", { value });
    case "PLAYER_TRADABILITY":
      return t(value === 1 ? "solver.termUntradeable" : "solver.termTradeable");
    case "ALL_PLAYERS_CHEMISTRY_POINTS":
      return t("solver.termChemistry", { value });
    default:
      return t("solver.termUnknown", { key: term.key });
  }
};

// Libellé de repli (tests, ou buildString d'EA indisponible), dans la langue de MagicBuyer.
export const describeRequirement = (req) => {
  const op = opText(req.scope);
  const value = req.value;
  const count = req.count;
  if (req.attribute) {
    return t("solver.reqAttribute");
  }
  if (req.combined) {
    return t("solver.reqCombined", { terms: req.terms.map(termText).join(" + "), op, count });
  }
  const term = req.terms[0] || { key: "", values: [] };
  switch (req.key) {
    case "TEAM_RATING":
      return t("solver.reqTeamRating", { op, value });
    case "TEAM_STAR_RATING":
      return t("solver.reqStars", { op, value });
    case "CHEMISTRY_POINTS":
      return t("solver.reqChemistry", { op, value });
    case "ALL_PLAYERS_CHEMISTRY_POINTS":
      return t("solver.reqPlayerChemistry", { op, value });
    case "PLAYER_QUALITY":
      return t("solver.reqQuality", { op, tier: tierName(value) });
    case "PLAYER_LEVEL":
      return t("solver.reqLevel", { tiers: valueList(term), op, count });
    case "SAME_NATION_COUNT":
      return t("solver.reqSameNation", { op, value });
    case "SAME_LEAGUE_COUNT":
      return t("solver.reqSameLeague", { op, value });
    case "SAME_CLUB_COUNT":
      return t("solver.reqSameClub", { op, value });
    case "NATION_COUNT":
      return t("solver.reqNations", { op, value });
    case "LEAGUE_COUNT":
      return t("solver.reqLeagues", { op, value });
    case "CLUB_COUNT":
      return t("solver.reqClubs", { op, value });
    case "NATION_ID":
    case "LEAGUE_ID":
    case "CLUB_ID":
      return t("solver.reqFrom", { names: valueList(term), op, count });
    case "LEGEND_COUNT":
      return t("solver.reqLegends", { op, value });
    case "PLAYER_RARITY":
      return t("solver.reqRarity", { values: valueList(term), op, count });
    case "PLAYER_RARITY_GROUP":
      return t("solver.reqGroup", { values: valueList(term), op, count });
    case "PLAYER_MIN_OVR":
    case "PLAYER_MAX_OVR":
    case "PLAYER_EXACT_OVR":
      return t("solver.reqOvr", { term: termText(term), op, count });
    case "FIRST_OWNER_PLAYERS_COUNT":
      return t("solver.reqFirstOwner", { op, value });
    case "PLAYER_TRADABILITY":
      return t("solver.reqTradability", { term: termText(term), op, count });
    default:
      return t("solver.reqUnknown", { key: req.key || "?" });
  }
};

// Résumé court d'une liste d'exigences non remplies (message d'erreur).
export const failingSummary = (labels, max = 2) => {
  const list = labels.filter(Boolean);
  if (!list.length) {
    return "";
  }
  const shown = list.slice(0, max).join(" · ");
  return list.length > max ? `${shown} ${plural(list.length - max, "solver.moreOne", "solver.moreMany")}` : shown;
};
