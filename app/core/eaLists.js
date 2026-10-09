import { t } from "../i18n";
import { pageGlobal, repositories, services } from "./page";

// Listes du jeu pour les critères d'un filtre (nations, championnats, clubs, raretés, styles de
// chimie), lues dans le web app sans aucune requête, avec les noms traduits par EA. Vides tant que le
// web app n'a pas chargé ses données (le panneau peut être construit avant).

// Styles de chimie FC 27 (identifiants EA, 250 = Basique, 266 = Chasseur, 268 = Ombre, 273 = Basique GB).
export const CHEM_STYLE_IDS = [250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273];

const KINDS = ["nation", "league", "club", "rarity", "style"];

// Texte réel ("" pour une clé non traduite : EA renvoie alors la clé, ou « *clé » dans ses dépôts).
const realText = (value, key = "") => {
  const result = String(value || "").trim();
  return result && result !== key && result[0] !== "*" ? result : "";
};

// Texte EA d'une clé de traduction ("" si la clé manque).
const text = (key) => {
  try {
    const svc = services();
    return realText(svc && svc.Localization && svc.Localization.localize(key), key);
  } catch (e) {
    return "";
  }
};

// Clés des noms (UTLocalizationUtil) : nom complet d'abord, puis le nom court (15 caractères).
const nameKeys = (kind, id) => {
  const year = pageGlobal("APP_YEAR");
  if (kind === "nation") {
    return [`search.nationName.nation${id}`];
  }
  if (!year) {
    return [];
  }
  return kind === "league"
    ? [`global.leagueFull.${year}.league${id}`, `global.leagueabbr15.${year}.league${id}`]
    : [`global.teamFull.${year}.team${id}`, `global.teamabbr15.${year}.team${id}`];
};

const nameOf = (kind, id, fallback = "") => nameKeys(kind, id).map(text).find(Boolean) || fallback;

// Nations, championnats ou clubs du web app : { id, name, league } (league : championnat d'un club, si connu).
const teamConfigList = (kind) => {
  let raw = [];
  try {
    const repo = repositories().TeamConfig;
    raw = Array.from((kind === "nation" ? repo.getNations() : kind === "league" ? repo.getLeagues() : repo.getTeams()) || []);
  } catch (e) {
    return [];
  }
  return raw
    .map((entry) => {
      const id = Number(entry && entry.id);
      // Clubs sans nom dans le jeu (« *global.teamabbr15… », 105 sur 946 le 09/10/2026) : écartés.
      return { id, name: nameOf(kind, id, realText(entry && entry.name)), league: Number(entry && (entry.leagueId || entry.league)) || 0 };
    })
    .filter((entry) => Number.isFinite(entry.id) && entry.id > 0 && entry.name);
};

const byName = (a, b) => a.name.localeCompare(b.name) || a.id - b.id;

// Raretés : noms des identifiants (« item.raretype3 » = Équipe de la semaine), ceux du dépôt EA étant codés.
const rarityName = (id) => text(`item.raretype${id}`);

const styleName = (id) => text(`playstyles.playstyle${id}`) || (CHEM_STYLE_IDS.includes(id) ? t(`misc.chemStyle${id}`) : "");

// Entrées { id, name } d'une liste, triées par nom (raretés : commune et rare d'abord, puis les promos
// par nom ; styles : ordre du jeu). leagueId : clubs de ce championnat seulement, si le web app le précise.
export const eaOptions = (kind, { leagueId = 0 } = {}) => {
  if (kind === "nation" || kind === "league") {
    return teamConfigList(kind).sort(byName);
  }
  if (kind === "club") {
    const clubs = teamConfigList("club");
    // Même nom pour deux clubs (équipes masculine et féminine, ex. « 1. FC Köln ») : championnat précisé.
    const counts = new Map();
    clubs.forEach((club) => counts.set(club.name, (counts.get(club.name) || 0) + 1));
    clubs.forEach((club) => {
      if (counts.get(club.name) > 1) {
        club.name = `${club.name} (${(club.league && nameOf("league", club.league)) || `#${club.id}`})`;
      }
    });
    const inLeague = leagueId > 0 ? clubs.filter((club) => club.league === leagueId) : [];
    return (inLeague.length ? inLeague : clubs).sort(byName);
  }
  if (kind === "rarity") {
    let ids = [];
    try {
      ids = Array.from(repositories().Rarity.values(), (entry) => Number(entry.id)).filter((id) => Number.isFinite(id) && id >= 0);
    } catch (e) {}
    // Commune (0) et rare (1) d'abord, puis les promos par nom.
    return Array.from(new Set(ids))
      .map((id) => ({ id, name: rarityName(id) }))
      .filter((entry) => entry.name)
      .sort((a, b) => {
        const baseA = a.id <= 1;
        const baseB = b.id <= 1;
        if (baseA !== baseB) {
          return baseA ? -1 : 1;
        }
        return baseA ? a.id - b.id : a.name.localeCompare(b.name);
      });
  }
  if (kind === "style") {
    return CHEM_STYLE_IDS.map((id) => ({ id, name: styleName(id) }));
  }
  return [];
};

// Nom d'une valeur (liste des filtres, journal) : nom du jeu, "" s'il est inconnu (web app pas chargé).
export const eaName = (kind, id) => {
  const value = Number(id);
  if (!KINDS.includes(kind) || !Number.isFinite(value) || value < 0) {
    return "";
  }
  if (kind === "rarity") {
    return rarityName(value);
  }
  if (kind === "style") {
    return styleName(value);
  }
  return value > 0 ? nameOf(kind, value) : "";
};
