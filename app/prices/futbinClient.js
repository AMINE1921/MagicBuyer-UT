import { getFutShortYear } from "../app.constants";
import { getSettings } from "../core/settings";
import { sendExternalRequest } from "../services/externalRequest";
import { fetchViaIframe } from "../ui/futbinBridge";
import { relayAvailable, relayFetch } from "./futbinRelay";
import {
  FUTBIN_ORIGIN,
  absoluteUrl,
  htmlToDocument,
  looksBlocked,
  parseGalleryIndex,
  parseGalleryPool,
  parseGallerySet,
  parsePlayerDocument,
  parsePlayerListText,
  parseSearchJson,
  parseSquadText,
} from "./futbinParse";

// Accès réseau à FUTBIN : requête directe (avec tes cookies FUTBIN), puis, si FUTBIN la refuse,
// l'onglet relais futbin.com (futbinRelay.js) et en dernier l'iframe cachée. Chaque fonction renvoie
// { ok, … } et ne rejette jamais.

export const futbinYear = () => getFutShortYear() || "27";

const HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const JSON_ACCEPT = "application/json, text/plain, */*";

let requestCount = 0;
export const futbinRequestCount = () => requestCount;

const DIRECT_PAUSE = 3 * 60 * 1000;
const REQUEST_GAP = 700;
const IFRAME_GAP = 5000;

let lastRequestAt = 0;
let lastIframeAt = 0;
// Requête directe refusée (Cloudflare) : on ne la retente pas pendant 3 min (sauf demande explicite).
// La pause dépend du type de page : FUTBIN peut refuser la recherche et les listes (403) tout en
// servant encore les pages joueur, qui ne doivent pas attendre pour autant.
const pausedUntil = { page: 0, list: 0 };

// "page" = page d'un joueur ; "list" = tout le reste (recherche, listes, galerie, équipes).
export const futbinRequestKind = (url) => {
  let path = "";
  try {
    path = new URL(String(url)).pathname;
  } catch (e) {
    path = String(url || "");
  }
  return /\/\d{2}\/player\//.test(path) ? "page" : "list";
};

// Sans type (ou "all") : la pause la plus longue (affichage de l'état FUTBIN).
export const futbinDirectPausedUntil = (kind) => {
  const until = kind && kind !== "all" ? pausedUntil[kind] || 0 : Math.max(pausedUntil.page, pausedUntil.list);
  return until > Date.now() ? until : 0;
};

// Utilisé par les tests.
export const resetFutbinClientForTests = () => {
  lastRequestAt = 0;
  lastIframeAt = 0;
  pausedUntil.page = 0;
  pausedUntil.list = 0;
  iframeFailures = 0;
  iframePausedUntil = 0;
};

// Secours iframe : mis en pause 10 min après 3 échecs d'affilée (FUTBIN refuse souvent l'affichage en iframe).
let iframeFailures = 0;
let iframePausedUntil = 0;

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

// Espacement entre deux requêtes FUTBIN, y compris à l'intérieur d'une même lecture (recherche puis page).
const pace = async () => {
  const wait = lastRequestAt + REQUEST_GAP - Date.now();
  lastRequestAt = Date.now() + Math.max(0, wait);
  if (wait > 0) {
    await waitFor(wait);
  }
};

const directRequest = (url, accept, method = "GET", body = null) =>
  new Promise((resolve) => {
    requestCount += 1;
    const headers = { Accept: accept };
    if (body != null) {
      headers["Content-Type"] = "application/json";
    }
    sendExternalRequest({
      method,
      url,
      data: body != null ? body : undefined,
      identifier: `futbin_${Date.now()}`,
      headers,
      timeout: 15000,
      onload: (res) =>
        resolve({
          status: Number(res && res.status) || 0,
          text: String((res && (res.responseText || res.response)) || ""),
        }),
    });
  });

const viaIframe = async (url, timeoutMs, graceMs) => {
  if (!getSettings().prices.iframeFallback || Date.now() < iframePausedUntil) {
    return null;
  }
  const wait = lastIframeAt + IFRAME_GAP - Date.now();
  lastIframeAt = Date.now() + Math.max(0, wait);
  if (wait > 0) {
    await waitFor(wait);
  }
  requestCount += 1;
  const payload = await fetchViaIframe(url, timeoutMs, graceMs);
  if (payload && payload.text && !looksBlocked(payload.text)) {
    iframeFailures = 0;
    return payload;
  }
  iframeFailures += 1;
  if (iframeFailures >= 3) {
    iframeFailures = 0;
    iframePausedUntil = Date.now() + 10 * 60 * 1000;
  }
  return null;
};

// Requête POST en secours : une page FUTBIN (galerie) est ouverte dans l'iframe cachée et le script
// qui y tourne envoie la requête depuis futbin.com (voir futbinBridge, chemins autorisés seulement).
const postFrameUrl = (url, body) => {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch (e) {
    return "";
  }
  return `${FUTBIN_ORIGIN}/${futbinYear()}/gallery#mb-post=${encodeURIComponent(JSON.stringify({ path, body }))}`;
};

// Lecture d'une page FUTBIN. Réponses : { ok, text, via } ou { ok: false, notFound | blocked | deferred, status, kind }.
// options : json, allowIframe (secours par page cachée), forceDirect (retenter la requête directe tout de suite),
// method / body (requête POST JSON, ex. pages suivantes d'une collection de la galerie).
export const fetchFutbinText = async (url, { json = false, allowIframe = true, forceDirect = false, method = "GET", body = null } = {}) => {
  let kind = futbinRequestKind(url);
  if (forceDirect || !futbinDirectPausedUntil(kind)) {
    await pace();
    const res = await directRequest(url, json ? JSON_ACCEPT : HTML_ACCEPT, method, body);
    if (res.status === 200 && !looksBlocked(res.text)) {
      pausedUntil[kind] = 0;
      return { ok: true, text: res.text, via: "direct" };
    }
    if (res.status === 404) {
      return { ok: false, notFound: true, status: 404 };
    }
    const challenge = looksBlocked(res.text);
    const blocked = res.status === 403 || res.status === 429 || res.status === 503 || challenge;
    if (!blocked) {
      // Erreur réseau ou serveur : simple échec, réessayé plus tard.
      return { ok: false, status: res.status };
    }
    // Page de vérification Cloudflare : tout FUTBIN attend. Simple refus (403/429) : ce type de page seulement.
    const until = Date.now() + DIRECT_PAUSE;
    if (challenge) {
      pausedUntil.page = until;
      pausedUntil.list = until;
      kind = "all";
    } else {
      pausedUntil[kind] = until;
    }
  }
  if (!allowIframe) {
    return { ok: false, blocked: true, deferred: true, status: 403, kind };
  }
  // Onglet relais : la page futbin.com fait elle-même la requête (cookies et vérification du navigateur).
  if (getSettings().prices.iframeFallback && relayAvailable()) {
    const relayed = await relayFetch(url, { method, body, json });
    if (relayed && relayed.ok && !looksBlocked(relayed.text)) {
      requestCount += 1;
      return { ok: true, text: relayed.text, via: "relay" };
    }
    if (relayed && relayed.status === 404) {
      return { ok: false, notFound: true, status: 404 };
    }
  }
  const frameUrl = method === "POST" ? postFrameUrl(url, body) : url;
  const payload = frameUrl ? await viaIframe(frameUrl, 20000, method === "POST" ? 10000 : undefined) : null;
  if (payload) {
    return { ok: true, text: payload.text, via: "iframe" };
  }
  return { ok: false, blocked: true, status: 403, kind };
};

export const searchFutbin = async (query, options = {}) => {
  const url =
    `${FUTBIN_ORIGIN}/players/search?targetPage=PLAYER_PAGE&query=${encodeURIComponent(query)}` +
    `&year=${futbinYear()}&evolutions=false`;
  const res = await fetchFutbinText(url, Object.assign({}, options, { json: true }));
  if (!res.ok) {
    return res;
  }
  return { ok: true, rows: parseSearchJson(res.text), via: res.via };
};

const normalizeName = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const toLink = (row) => ({
  futbinId: row.futbinId,
  url: row.url || `${FUTBIN_ORIGIN}/${futbinYear()}/player/${row.futbinId}/player`,
  name: row.name,
  rating: row.rating,
});

// Trouve la page FUTBIN d'une carte EA (identifiant exact de la version).
// « notFound » seulement si FUTBIN a répondu sans la carte ; une erreur réseau est renvoyée telle quelle.
export const resolveFutbinLink = async ({ definitionId, name, rating }, options = {}) => {
  const id = Number(definitionId) || 0;
  if (!id) {
    return { ok: false, notFound: true };
  }
  const byId = await searchFutbin(String(id), options);
  if (byId.ok) {
    const hit = byId.rows.find((row) => row.eaId === id);
    if (hit) {
      return { ok: true, link: toLink(hit) };
    }
  } else if (!byId.notFound) {
    return byId;
  }
  if (!name) {
    return { ok: false, notFound: true };
  }
  const byName = await searchFutbin(name, options);
  if (!byName.ok) {
    return byName.notFound ? { ok: false, notFound: true } : byName;
  }
  const exact = byName.rows.find((row) => row.eaId === id);
  if (exact) {
    return { ok: true, link: toLink(exact) };
  }
  // Carte de base (identifiant de base = identifiant de la version) : nom + note.
  if ((id & 0xffffff) === id) {
    const wanted = normalizeName(name);
    const sameName = byName.rows.filter((row) => {
      const candidate = normalizeName(row.name);
      return candidate === wanted || candidate.endsWith(` ${wanted}`) || wanted.endsWith(` ${candidate}`);
    });
    const match = sameName.find((row) => rating && row.rating === Number(rating)) || (sameName.length === 1 ? sameName[0] : null);
    if (match) {
      return { ok: true, link: toLink(match) };
    }
  }
  return { ok: false, notFound: true };
};

// Prix actuel d'une carte FUTBIN pour la plateforme ("console" ou "pc").
export const fetchFutbinPrice = async (link, platform, options = {}) => {
  const url = absoluteUrl(link.url) || `${FUTBIN_ORIGIN}/${futbinYear()}/player/${link.futbinId}/player`;
  const res = await fetchFutbinText(url, options);
  if (!res.ok) {
    return res;
  }
  const doc = htmlToDocument(res.text);
  const parsed = parsePlayerDocument(doc, platform);
  if (parsed.blocked) {
    // Page de vérification servie à la place de la page joueur : tout FUTBIN est concerné.
    return { ok: false, blocked: true, kind: "all" };
  }
  if (!parsed.price) {
    // Carte sans prix (hors marché) : son score d'objet reste utile.
    return { ok: false, noPrice: true, itemScore: parsed.itemScore, itemScoreExact: parsed.itemScoreExact, pageEaId: parsed.pageEaId };
  }
  return Object.assign({ ok: true, via: res.via }, parsed);
};

export const isFutbinUrl = (url) => /^https:\/\/(?:www\.)?futbin\.com\//i.test(String(url || "").trim());

// Solution SBC / équipe FUTBIN : formation + 11 joueurs (identifiants EA exacts).
export const fetchFutbinSquad = async (url) => {
  if (!isFutbinUrl(url)) {
    return { ok: false, invalid: true };
  }
  const target = String(url).trim();
  // Action de l'utilisateur : la requête directe est retentée même après un refus récent.
  const res = await fetchFutbinText(target, { forceDirect: true });
  if (!res.ok) {
    return res;
  }
  let parsed = parseSquadText(res.text);
  let via = res.via;
  // Équipe affichée par JavaScript : la page complète est lue dans l'iframe cachée.
  if (!parsed.players.length && via === "direct") {
    const payload = await viaIframe(target, 20000);
    if (payload) {
      parsed = parseSquadText(payload.text);
      via = "iframe";
    }
  }
  if (parsed.blocked) {
    return { ok: false, blocked: true };
  }
  if (!parsed.players.length) {
    return { ok: false, empty: true };
  }
  return { ok: true, squad: parsed, via };
};

export const isFutbinListUrl = (url) => /^https:\/\/(?:www\.)?futbin\.com\/\d{2}\/players(?:[/?#]|$)/i.test(String(url || "").trim());

// Même liste FUTBIN, page N (paramètre "page").
export const withPage = (url, page) => {
  try {
    const parsed = new URL(String(url).trim());
    if (page > 1) {
      parsed.searchParams.set("page", String(page));
    } else {
      parsed.searchParams.delete("page");
    }
    return parsed.toString();
  } catch (e) {
    return String(url || "");
  }
};

// Une page d'une liste de joueurs FUTBIN : cartes (id EA, note, prix console / PC, lien FUTBIN).
export const fetchFutbinList = async (url, page = 1, options = {}) => {
  if (!isFutbinListUrl(url)) {
    return { ok: false, invalid: true };
  }
  const res = await fetchFutbinText(withPage(url, page), options);
  if (!res.ok) {
    return res;
  }
  const parsed = parsePlayerListText(res.text);
  if (parsed.blocked) {
    return { ok: false, blocked: true };
  }
  return { ok: true, cards: parsed.cards, lastPage: parsed.lastPage, source: parsed.source, via: res.via };
};

// ------------------------------------------------------------------ galerie FC 27

export const galleryUrl = () => `${FUTBIN_ORIGIN}/${futbinYear()}/gallery`;

export const isFutbinGalleryUrl = (url) => /^https:\/\/(?:www\.)?futbin\.com\/\d{2}\/gallery(?:[/?#]|$)/i.test(String(url || "").trim());

const playerUrl = (futbinId) => `${FUTBIN_ORIGIN}/${futbinYear()}/player/${futbinId}/player`;

const withUrls = (items) =>
  items.map((item) => Object.assign(item, { url: item.url || (item.futbinId ? playerUrl(item.futbinId) : "") }));

// Collections de la galerie (toutes, ou celles d'une catégorie) avec leurs paliers de récompenses.
export const fetchGalleryIndex = async (url) => {
  const target = url ? absoluteUrl(url) : galleryUrl();
  if (!isFutbinGalleryUrl(target)) {
    return { ok: false, invalid: true };
  }
  const res = await fetchFutbinText(target, { forceDirect: true });
  if (!res.ok) {
    return res;
  }
  const parsed = parseGalleryIndex(res.text);
  if (!parsed.sets.length) {
    return parsed.blocked ? { ok: false, blocked: true } : { ok: false, empty: true };
  }
  return { ok: true, categories: parsed.categories, sets: parsed.sets, via: res.via };
};

// Une collection : paliers, bonus, limite de joueurs et première page des joueurs éligibles.
export const fetchGallerySet = async (url) => {
  const target = absoluteUrl(url);
  if (!isFutbinGalleryUrl(target)) {
    return { ok: false, invalid: true };
  }
  const res = await fetchFutbinText(target, { forceDirect: true });
  if (!res.ok) {
    return res;
  }
  const set = parseGallerySet(res.text);
  if (!set) {
    return looksBlocked(res.text) ? { ok: false, blocked: true } : { ok: false, empty: true };
  }
  withUrls(set.items);
  return { ok: true, set, via: res.via };
};

// Page N des joueurs éligibles d'une collection, triés (ItemScoreDesc, PriceAscPs, ValueDescPc…).
export const fetchGalleryPool = async (searchUrl, { sort = "ItemScoreDesc", page = 1, searchTerm = "", minItemScore = 0 } = {}) => {
  const target = absoluteUrl(searchUrl);
  if (!/\/gallery\/set-player-search\/\d+$/.test(target)) {
    return { ok: false, invalid: true };
  }
  const request = { sort, page: Math.max(1, Number(page) || 1) };
  if (searchTerm) {
    request.searchTerm = String(searchTerm);
  }
  if (Number(minItemScore) > 0) {
    request.minItemScore = Number(minItemScore);
  }
  const res = await fetchFutbinText(target, { json: true, method: "POST", body: JSON.stringify(request), forceDirect: true });
  if (!res.ok) {
    return res;
  }
  const pool = parseGalleryPool(res.text);
  if (!pool) {
    return looksBlocked(res.text) ? { ok: false, blocked: true } : { ok: false, status: 0 };
  }
  withUrls(pool.items);
  return { ok: true, items: pool.items, totalItems: pool.totalItems, via: res.via };
};
