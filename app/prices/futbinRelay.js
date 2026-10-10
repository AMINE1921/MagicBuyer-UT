import { getFutShortYear } from "../app.constants";
import { log } from "../core/logger";
import { t } from "../i18n";
import { FUTBIN_ORIGIN } from "./futbinParse";

// Relais FUTBIN par onglet. FUTBIN refuse ses pages (galerie, listes…) aux requêtes du script (403,
// vérification Cloudflare), et l'iframe cachée ne passe plus : Chrome n'y envoie pas les cookies du
// site. Une page futbin.com ouverte dans un vrai onglet, elle, est servie normalement. Le web app ouvre
// donc un onglet futbin.com en arrière-plan ; le script, qui tourne aussi sur futbin.com, y fait la
// requête (mêmes cookies, même vérification que ton navigateur) et renvoie la réponse par le stockage
// partagé de Tampermonkey. Une requête à la fois ; onglet fermé après 5 min sans usage.

const REQUEST_KEY = "mb5.relay.request";
const RESPONSE_KEY = "mb5.relay.response";
const BEAT_KEY = "mb5.relay.beat";
const RELAY_MARK = "mb-relay";
const IDLE_CLOSE = 5 * 60 * 1000;
// Premier envoi : ouverture de l'onglet et éventuelle vérification Cloudflare.
const FIRST_TIMEOUT = 30000;
const TIMEOUT = 20000;
const REQUEST_MAX_AGE = 60000;
const BEAT_EVERY = 2000;
const POLL_EVERY = 400;
// Seule la recherche de joueurs d'une collection de la galerie est envoyée en POST.
const POST_PATHS = [/^\/\d{2}\/gallery\/set-player-search\/\d+$/];

const gmGet = (key, fallback) => {
  try {
    return typeof GM_getValue === "function" ? GM_getValue(key, fallback) : fallback;
  } catch (e) {
    return fallback;
  }
};

const gmSet = (key, value) => {
  try {
    if (typeof GM_setValue === "function") {
      GM_setValue(key, value);
      return true;
    }
  } catch (e) {}
  return false;
};

const parse = (raw) => {
  if (!raw) {
    return null;
  }
  if (typeof raw === "object") {
    return raw;
  }
  try {
    return JSON.parse(String(raw));
  } catch (e) {
    return null;
  }
};

// Chemin futbin.com d'une adresse (null pour un autre site).
export const relayPath = (url) => {
  try {
    const parsed = new URL(String(url), FUTBIN_ORIGIN);
    return /(^|\.)futbin\.com$/i.test(parsed.hostname) ? `${parsed.pathname}${parsed.search}` : null;
  } catch (e) {
    return null;
  }
};

export const relayAllowed = (path, method = "GET") =>
  typeof path === "string" && path[0] === "/" && path[1] !== "/" && (method === "GET" || (method === "POST" && POST_PATHS.some((re) => re.test(path))));

// ------------------------------------------------------------------ côté web app

let tab = null;
let idleTimer = null;
let chain = Promise.resolve();
let announced = false;

export const relayAvailable = () => typeof GM_openInTab === "function" && typeof GM_setValue === "function" && typeof GM_getValue === "function";

const relayAlive = () => Date.now() - (Number(gmGet(BEAT_KEY, 0)) || 0) < BEAT_EVERY * 3;

const tabOpen = () => !!tab && !tab.closed;

const closeTab = () => {
  try {
    if (tabOpen()) {
      tab.close();
    }
  } catch (e) {}
  tab = null;
};

const scheduleClose = () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(closeTab, IDLE_CLOSE);
};

const openTab = () => {
  if (tabOpen()) {
    return;
  }
  try {
    tab = GM_openInTab(`${FUTBIN_ORIGIN}/${getFutShortYear() || "27"}/gallery#${RELAY_MARK}`, { active: false, insert: true, setParent: true });
  } catch (e) {
    tab = null;
  }
  if (tab && !announced) {
    announced = true;
    log.info(t("misc.futbinRelayOpened"));
  }
};

const waitForResponse = (id, timeoutMs) =>
  new Promise((resolve) => {
    let done = false;
    let listener = null;
    const finish = (value) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      try {
        if (listener != null && typeof GM_removeValueChangeListener === "function") {
          GM_removeValueChangeListener(listener);
        }
      } catch (e) {}
      resolve(value);
    };
    const check = (raw) => {
      const response = parse(raw);
      if (response && response.id === id) {
        finish(response);
      }
    };
    try {
      if (typeof GM_addValueChangeListener === "function") {
        listener = GM_addValueChangeListener(RESPONSE_KEY, (name, oldValue, value) => check(value));
      }
    } catch (e) {}
    const poll = setInterval(() => check(gmGet(RESPONSE_KEY, null)), POLL_EVERY);
    const timer = setTimeout(() => finish(null), timeoutMs);
  });

const sendOnce = async (path, method, body, json, timeoutMs) => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  if (!gmSet(REQUEST_KEY, JSON.stringify({ id, path, method, body: body == null ? null : String(body), json: !!json, at: Date.now() }))) {
    return null;
  }
  return waitForResponse(id, timeoutMs);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Page FUTBIN lue par l'onglet relais. Réponses : { ok, text, via: "relay" } | { ok: false, status } | null
// (relais indisponible ou muet).
export const relayFetch = (url, { method = "GET", body = null, json = false } = {}) => {
  const run = async () => {
    const path = relayPath(url);
    if (!relayAvailable() || !path || !relayAllowed(path, method)) {
      return null;
    }
    const first = !tabOpen() || !relayAlive();
    openTab();
    if (!tabOpen()) {
      return null;
    }
    let response = await sendOnce(path, method, body, json, first ? FIRST_TIMEOUT : TIMEOUT);
    // Vérification Cloudflare en cours dans l'onglet relais : un second essai après sa fin.
    if (response && (response.status === 403 || response.status === 503)) {
      await sleep(5000);
      response = (await sendOnce(path, method, body, json, TIMEOUT)) || response;
    }
    scheduleClose();
    if (!response) {
      return null;
    }
    return response.status === 200 ? { ok: true, text: String(response.text || ""), via: "relay" } : { ok: false, status: Number(response.status) || 0 };
  };
  chain = chain.catch(() => {}).then(run);
  return chain;
};

// ------------------------------------------------------------------ côté futbin.com

// Onglet ouvert par le web app (#mb-relay), gardé en mode relais après un rechargement (vérification
// Cloudflare). Jamais dans une iframe.
export const isRelayTab = () => {
  try {
    if (window.top !== window) {
      return false;
    }
    if (String(location.hash || "").includes(RELAY_MARK)) {
      sessionStorage.setItem(RELAY_MARK, "1");
      return true;
    }
    return sessionStorage.getItem(RELAY_MARK) === "1";
  } catch (e) {
    return false;
  }
};

export const bootFutbinRelay = () => {
  if (window.__mbFutbinRelay || !isRelayTab()) {
    return;
  }
  window.__mbFutbinRelay = true;
  const beat = () => gmSet(BEAT_KEY, Date.now());
  beat();
  setInterval(beat, BEAT_EVERY);
  let lastId = "";
  const handle = async (raw) => {
    const request = parse(raw);
    if (!request || !request.id || request.id === lastId || Date.now() - Number(request.at || 0) > REQUEST_MAX_AGE) {
      return;
    }
    lastId = request.id;
    const method = request.method === "POST" ? "POST" : "GET";
    if (!relayAllowed(request.path, method)) {
      gmSet(RESPONSE_KEY, JSON.stringify({ id: request.id, status: 400, text: "" }));
      return;
    }
    let status = 0;
    let text = "";
    try {
      const res = await fetch(request.path, {
        method,
        credentials: "include",
        headers:
          method === "POST"
            ? { "Content-Type": "application/json", Accept: "application/json" }
            : { Accept: request.json ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,*/*;q=0.8" },
        body: method === "POST" ? request.body || "" : undefined,
      });
      status = res.status;
      text = await res.text();
    } catch (e) {}
    gmSet(RESPONSE_KEY, JSON.stringify({ id: request.id, status, text }));
  };
  try {
    if (typeof GM_addValueChangeListener === "function") {
      GM_addValueChangeListener(REQUEST_KEY, (name, oldValue, value) => handle(value));
    }
  } catch (e) {}
  setInterval(() => handle(gmGet(REQUEST_KEY, null)), POLL_EVERY);
  handle(gmGet(REQUEST_KEY, null));
};

// Utilisé par les tests.
export const resetRelayForTests = () => {
  tab = null;
  clearTimeout(idleTimer);
  idleTimer = null;
  chain = Promise.resolve();
  announced = false;
};
