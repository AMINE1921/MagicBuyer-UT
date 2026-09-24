import { getFutShortYear } from "../app.constants";
import { getSettings } from "../core/settings";
import { sendExternalRequest } from "../services/externalRequest";
import { fetchViaIframe } from "../ui/futbinBridge";
import {
  FUTBIN_ORIGIN,
  absoluteUrl,
  htmlToDocument,
  looksBlocked,
  parsePlayerDocument,
  parseSearchJson,
  parseSquadText,
} from "./futbinParse";

// Accès réseau à FUTBIN : requête directe (avec tes cookies FUTBIN), puis iframe cachée
// en secours si Cloudflare bloque. Chaque fonction renvoie { ok, … } et ne rejette jamais.

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
let directPausedUntil = 0;
export const futbinDirectPausedUntil = () => (directPausedUntil > Date.now() ? directPausedUntil : 0);

// Utilisé par les tests.
export const resetFutbinClientForTests = () => {
  lastRequestAt = 0;
  lastIframeAt = 0;
  directPausedUntil = 0;
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

const directGet = (url, accept) =>
  new Promise((resolve) => {
    requestCount += 1;
    sendExternalRequest({
      method: "GET",
      url,
      identifier: `futbin_${Date.now()}`,
      headers: { Accept: accept },
      timeout: 15000,
      onload: (res) =>
        resolve({
          status: Number(res && res.status) || 0,
          text: String((res && (res.responseText || res.response)) || ""),
        }),
    });
  });

const viaIframe = async (url, timeoutMs) => {
  if (!getSettings().prices.iframeFallback || Date.now() < iframePausedUntil) {
    return null;
  }
  const wait = lastIframeAt + IFRAME_GAP - Date.now();
  lastIframeAt = Date.now() + Math.max(0, wait);
  if (wait > 0) {
    await waitFor(wait);
  }
  requestCount += 1;
  const payload = await fetchViaIframe(url, timeoutMs);
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

// Lecture d'une page FUTBIN. Réponses : { ok, text, via } ou { ok: false, notFound | blocked | deferred, status }.
// options : json, allowIframe (secours par page cachée), forceDirect (retenter la requête directe tout de suite).
export const fetchFutbinText = async (url, { json = false, allowIframe = true, forceDirect = false } = {}) => {
  if (forceDirect || !futbinDirectPausedUntil()) {
    await pace();
    const res = await directGet(url, json ? JSON_ACCEPT : HTML_ACCEPT);
    if (res.status === 200 && !looksBlocked(res.text)) {
      directPausedUntil = 0;
      return { ok: true, text: res.text, via: "direct" };
    }
    if (res.status === 404) {
      return { ok: false, notFound: true, status: 404 };
    }
    const blocked = res.status === 403 || res.status === 429 || res.status === 503 || looksBlocked(res.text);
    if (!blocked) {
      // Erreur réseau ou serveur : simple échec, réessayé plus tard.
      return { ok: false, status: res.status };
    }
    directPausedUntil = Date.now() + DIRECT_PAUSE;
  }
  if (!allowIframe) {
    return { ok: false, blocked: true, deferred: true, status: 403 };
  }
  const payload = await viaIframe(url, 15000);
  if (payload) {
    return { ok: true, text: payload.text, via: "iframe" };
  }
  return { ok: false, blocked: true, status: 403 };
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
    .replace(/[̀-ͯ]/g, "")
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
    return { ok: false, blocked: true };
  }
  if (!parsed.price) {
    return { ok: false, noPrice: true };
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
