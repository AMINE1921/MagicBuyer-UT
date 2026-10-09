import { sendExternalRequest } from "../services/externalRequest";
import { FUTBIN_ORIGIN, isPlausiblePrice } from "./futbinParse";
import { futbinYear } from "./futbinClient";

// API JSON de l'appli FUTBIN (futbin.org). Une recherche par nom renvoie toutes les versions d'un
// joueur : identifiant EA exact (resource_id), prix console et PC, prix précédent, plage de prix EA,
// tendance, type de carte (promo) et marque holo (holographicAnimation). Quelques kilo-octets par
// réponse, sans page de vérification Cloudflare. Aucune route par identifiant : la carte est retrouvée
// par son identifiant EA dans les résultats. Les listes filtrées (getFilteredPlayers : nation,
// championnat, club, notes, qualité, triées par prix) remplacent les listes futbin.com, que FUTBIN
// refuse aux requêtes du script. Chaque fonction renvoie { ok, … } et ne rejette jamais.

export const FUTBIN_API_ORIGIN = "https://www.futbin.org";

// Réponse identique servie par le cache de FUTBIN pendant 60 s : inutile de la redemander avant.
const CACHE_MS = 60 * 1000;
const CACHE_MAX = 300;
// Refus (403, 429, 503) : l'API attend 3 min, les pages FUTBIN prennent le relais.
const API_PAUSE = 3 * 60 * 1000;
// Écart minimal entre deux requêtes de l'API (deux recherches pour une même carte, par exemple).
const API_GAP = 400;

let requestCount = 0;
let pausedUntil = 0;
let lastRequestAt = 0;
const cache = new Map();
// Cartes des réponses récentes, par identifiant EA : une version déjà lue (ex. la holo d'un joueur
// demandé juste avant) est reprise sans requête, quelle que soit la recherche qui l'a ramenée.
const cards = new Map();
const CARDS_MAX = 3000;
// Types de carte appris des images FUTBIN (3 → team_of_the_week, 22 → destined_for_glory…) :
// une nouvelle promo est reconnue dès sa première carte, sans liste à tenir à jour. Le type 0
// (cartes de base) recouvre or, argent et bronze : ce n'est pas une promo, il n'est pas appris.
const promoNames = new Map();

export const futbinApiRequestCount = () => requestCount;
export const futbinApiPausedUntil = () => (pausedUntil > Date.now() ? pausedUntil : 0);
export const promoName = (rareType) => promoNames.get(Number(rareType)) || "";

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const toPrice = (value) => (isPlausiblePrice(toNumber(value)) ? toNumber(value) : 0);
const toTrend = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

const slugify = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Recherche normalisée (clé du cache) : minuscules, sans accent ni ponctuation.
export const normalizeApiQuery = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Type de carte d'après l'image FUTBIN : ".../cards/hd/3_team_of_the_week.png" → { id: 3, slug }.
export const promoFromImage = (url) => {
  const match = String(url || "").match(/\/cards\/(?:hd\/)?(\d+)_([a-z0-9_]+)\.(?:png|webp|jpe?g)/i);
  return match ? { id: Number(match[1]), slug: match[2].toLowerCase() } : null;
};

const pricePair = (row, key) => ({ console: toPrice(row[`ps_${key}`]), pc: toPrice(row[`pc_${key}`]) });

// Postes FUTBIN d'une ligne : poste principal puis postes secondaires (tableau ou « RW,RM »).
const positionsOf = (row) => {
  const others = Array.isArray(row.alternativePositions) ? row.alternativePositions : String(row.alternativePositions || "").split(",");
  const names = [row.position].concat(others).map((name) => String(name || "").trim().toUpperCase()).filter(Boolean);
  return Array.from(new Set(names));
};

// Cartes d'une réponse de l'API (null si la réponse n'est pas celle attendue).
export const parseApiCards = (text) => {
  let json;
  try {
    json = JSON.parse(String(text || ""));
  } catch (e) {
    return null;
  }
  const rows = json && Array.isArray(json.data) ? json.data : null;
  if (!rows) {
    return null;
  }
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const rareType = toNumber(row.raretype);
      const promo = promoFromImage(row.cardImage);
      if (promo && promo.id === rareType && rareType > 0) {
        promoNames.set(rareType, promo.slug);
      }
      const futbinId = toNumber(row.ID);
      const fullName = String(row.playername || row.common_name || "");
      return {
        futbinId,
        eaId: toNumber(row.resource_id),
        baseId: toNumber(row.playerid),
        name: String(row.common_name || fullName),
        fullName,
        rating: toNumber(row.rating),
        rareType,
        rare: toNumber(row.rare),
        // Carte holographique : animation holo de FUTBIN. « signature » (carte signée) ne marque que
        // les holo des têtes d'affiche (vu le 09/10/2026 : 15 TOTW holo signées sur 92).
        holo: !!row.holographicAnimation || row.signature === true,
        signature: row.signature === true,
        promo: promo ? promo.slug : "",
        url: futbinId ? `${FUTBIN_ORIGIN}/${futbinYear()}/player/${futbinId}/${slugify(fullName) || "player"}` : "",
        prices: pricePair(row, "LCPrice"),
        closing: pricePair(row, "LCPClosing"),
        range: {
          console: [toNumber(row.ps_MinPrice), toNumber(row.ps_MaxPrice)],
          pc: [toNumber(row.pc_MinPrice), toNumber(row.pc_MaxPrice)],
        },
        trend: { console: toTrend(row.ps_PriceTrend), pc: toTrend(row.pc_PriceTrend) },
        position: String(row.position || "").toUpperCase(),
        positions: positionsOf(row),
        // Identifiants EA de la nation, du championnat et du club.
        nationId: toNumber(row.nation),
        leagueId: toNumber(row.league),
        clubId: toNumber(row.club),
        nationName: String(row.nation_name || row.country_name || ""),
        leagueName: String(row.league_name || ""),
        clubName: String(row.club_name || ""),
        version: String(row.rareTypeName || ""),
        itemScore: toNumber(row.itemScore),
      };
    })
    .filter((card) => card.eaId > 0);
};

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const pace = async () => {
  const wait = lastRequestAt + API_GAP - Date.now();
  lastRequestAt = Date.now() + Math.max(0, wait);
  if (wait > 0) {
    await waitFor(wait);
  }
};

const request = (url) =>
  new Promise((resolve) => {
    requestCount += 1;
    sendExternalRequest({
      method: "GET",
      url,
      headers: { Accept: "application/json" },
      // L'API n'a besoin d'aucun cookie.
      anonymous: true,
      timeout: 10000,
      onload: (res) =>
        resolve({
          status: Number(res && res.status) || 0,
          text: String((res && (res.responseText || res.response)) || ""),
        }),
    });
  });

const rememberCards = (list, at = Date.now()) => {
  list.forEach((card) => {
    cards.delete(card.eaId);
    cards.set(card.eaId, { at, card });
  });
  while (cards.size > CARDS_MAX) {
    cards.delete(cards.keys().next().value);
  }
};

const remember = (query, list) => {
  const at = Date.now();
  cache.delete(query);
  cache.set(query, { at, cards: list });
  while (cache.size > CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  rememberCards(list, at);
};

// Requête à l'API. Réponses : { ok, cards } ou { ok: false, blocked | deferred | invalid, status }.
// Refus (403, 429, 503) : l'API attend 3 min.
const fetchCards = async (url) => {
  if (futbinApiPausedUntil()) {
    return { ok: false, blocked: true, deferred: true, kind: "api" };
  }
  await pace();
  const res = await request(url);
  if (res.status === 200) {
    const list = parseApiCards(res.text);
    if (!list) {
      // Réponse inattendue (format changé, page d'erreur) : simple échec, les pages FUTBIN prennent le relais.
      return { ok: false, invalid: true, status: 200 };
    }
    pausedUntil = 0;
    return { ok: true, cards: list };
  }
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    pausedUntil = Date.now() + API_PAUSE;
    return { ok: false, blocked: true, kind: "api", status: res.status };
  }
  return { ok: false, status: res.status };
};

// Carte lue il y a moins de 60 s (null sinon).
export const cachedApiCard = (eaId) => {
  const entry = cards.get(Number(eaId) || 0);
  return entry && Date.now() - entry.at < CACHE_MS ? entry.card : null;
};

// Recherche par nom. Réponses : { ok, cards, cached } ou { ok: false, blocked | deferred | invalid, status }.
export const searchFutbinApi = async (query) => {
  const key = normalizeApiQuery(query);
  if (key.length < 2) {
    return { ok: false, notFound: true };
  }
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return { ok: true, cards: cached.cards, cached: true };
  }
  const res = await fetchCards(`${FUTBIN_API_ORIGIN}/futbin/api/searchPlayersByName?playername=${encodeURIComponent(key)}`);
  if (res.ok) {
    remember(key, res.cards);
  }
  return res;
};

// Liste filtrée (32 cartes par page), les moins chères d'abord pour la plateforme, cartes sans prix
// exclues : mêmes filtres que les listes futbin.com (identifiants EA de nation, championnat, club ;
// version « gold », « silver », « bronze » ou une promo ; notes min et max).
export const filteredPlayersUrl = ({ platform = "console", page = 1, version = "", league = 0, nation = 0, club = 0, minRating = 0, maxRating = 0 } = {}) => {
  const pc = platform === "pc";
  const params = [
    ["platform", pc ? "PC" : "PS"],
    ["page", Math.max(1, Number(page) || 1)],
  ];
  if (version) {
    params.push(["version", version]);
  }
  if (league > 0) {
    params.push(["league", league]);
  }
  if (nation > 0) {
    params.push(["nation", nation]);
  }
  if (club > 0) {
    params.push(["club", club]);
  }
  if (minRating > 0 || maxRating > 0) {
    params.push(["rating", `${minRating || 40}-${maxRating || 99}`]);
  }
  params.push([pc ? "pcprice" : "ps4price", "200-15000000"], ["sort", pc ? "pc_price" : "ps_price"], ["order", "asc"]);
  return `${FUTBIN_API_ORIGIN}/futbin/api/${futbinYear()}/getFilteredPlayers?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
};

// Réponses : { ok, cards, url } ou { ok: false, blocked | deferred | invalid, status, url }.
export const fetchFilteredPlayers = async (filters = {}) => {
  const url = filteredPlayersUrl(filters);
  const res = await fetchCards(url);
  if (res.ok) {
    rememberCards(res.cards);
  }
  return Object.assign(res, { url });
};

// Utilisé par les tests.
export const resetFutbinApiForTests = () => {
  requestCount = 0;
  pausedUntil = 0;
  lastRequestAt = 0;
  cache.clear();
  cards.clear();
  promoNames.clear();
};
