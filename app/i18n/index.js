import { getPage, services } from "../core/page";
import { getSetting } from "../core/settings";
import engine from "./engine";
import gallery from "./gallery";
import misc from "./misc";
import sbc from "./sbc";
import solver from "./solver";
import results from "./results";
import target from "./target";
import tools from "./tools";
import ui from "./ui";

// Langue de l'interface MagicBuyer : celle du compte FC (langue du web app EA) par défaut,
// ou une langue choisie dans les réglages. Textes : t("zone.cle", { param }) ; une valeur
// de dictionnaire peut aussi être une fonction (params) => texte (pluriels, tournures).
// Langues absentes des dictionnaires : anglais.

const PARTS = [engine, misc, sbc, solver, results, target, ui, tools, gallery];

const merge = (lang) => Object.assign({}, ...PARTS.map((part) => (part && part[lang]) || {}));

const DICTIONARIES = {};
const dictionary = (lang) => {
  if (!DICTIONARIES[lang]) {
    DICTIONARIES[lang] = merge(lang);
  }
  return DICTIONARIES[lang];
};

// Langues proposées dans les réglages (libellés dans leur propre langue).
export const LANGUAGES = [
  ["fr", "Français"],
  ["en", "English"],
];

const AVAILABLE = new Set(LANGUAGES.map(([code]) => code));

const DEFAULT_LOCALES = { fr: "fr-FR", en: "en-GB" };

const readGameLocale = () => {
  try {
    const svc = services();
    const locale = svc && svc.Localization && svc.Localization.locale;
    if (!locale) {
      return null;
    }
    const language = String(locale.language || "").toLowerCase();
    const bcp = typeof locale.toBCPString === "function" ? locale.toBCPString() : "";
    return language ? { language, bcp: bcp || "" } : null;
  } catch (e) {
    return null;
  }
};

const readUrlLanguage = () => {
  try {
    const match = String(getPage().location.pathname || "").match(/^\/([a-z]{2})(?:-[a-z]{2})?\//i);
    return match ? match[1].toLowerCase() : "";
  } catch (e) {
    return "";
  }
};

const readBrowserLanguage = () => {
  try {
    return String((getPage().navigator && getPage().navigator.language) || "").slice(0, 2).toLowerCase();
  } catch (e) {
    return "";
  }
};

// Langue du compte FC : web app EA, sinon adresse de la page, sinon navigateur.
export const gameLanguage = () => {
  const game = readGameLocale();
  return (game && game.language) || readUrlLanguage() || readBrowserLanguage() || "";
};

export const languageSetting = () => getSetting("ui.language") || "auto";

// Langue réellement utilisée par l'interface.
export const language = () => {
  const chosen = languageSetting();
  const wanted = chosen === "auto" ? gameLanguage() : chosen;
  return AVAILABLE.has(wanted) ? wanted : "en";
};

// Format régional des nombres et des heures (celui du web app en mode automatique).
export const locale = () => {
  const lang = language();
  if (languageSetting() === "auto") {
    const game = readGameLocale();
    if (game && game.bcp && game.language === lang) {
      return game.bcp;
    }
  }
  return DEFAULT_LOCALES[lang] || "en-GB";
};

const fill = (text, params) =>
  params ? String(text).replace(/\{(\w+)\}/g, (match, key) => (params[key] != null ? String(params[key]) : match)) : String(text);

export const t = (key, params) => {
  const lang = language();
  const value = dictionary(lang)[key] != null ? dictionary(lang)[key] : dictionary("en")[key] != null ? dictionary("en")[key] : dictionary("fr")[key];
  if (value == null) {
    return key;
  }
  return typeof value === "function" ? value(params || {}) : fill(value, params);
};

// Pluriel : clé au singulier ou au pluriel selon la langue (français : singulier à 0 et 1 ;
// anglais : singulier seulement à 1). Le nombre est disponible dans le texte sous {n}.
export const plural = (count, one, many, params) => {
  const n = Math.abs(Number(count) || 0);
  const isPlural = language() === "fr" ? n > 1 : n !== 1;
  return t(isPlural ? many : one, Object.assign({ n: count }, params || {}));
};

// Utilisé par les tests (dictionnaires reconstruits).
export const resetI18nForTests = () => {
  Object.keys(DICTIONARIES).forEach((lang) => delete DICTIONARIES[lang]);
};
