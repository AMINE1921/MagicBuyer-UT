// Pont FUTBIN : si une requête directe est bloquée (Cloudflare), la page FUTBIN est ouverte
// dans une iframe cachée. Le script tourne aussi sur futbin.com : dans l'iframe, il renvoie
// le HTML (ou le JSON) de la page au web app via postMessage. Aucune donnée n'est modifiée.

const MSG = "MB_FUTBIN";
const EA_ORIGIN = "https://www.ea.com";
const FUTBIN_ORIGINS = ["https://www.futbin.com", "https://futbin.com"];

export const isFutbinPage = () => {
  try {
    return /(^|\.)futbin\.com$/i.test(location.hostname);
  } catch (e) {
    return false;
  }
};

const isFramed = () => {
  try {
    return window.parent && window.parent !== window;
  } catch (e) {
    return true;
  }
};

// Le HTML n'est envoyé qu'au web app EA (jamais à un autre site qui afficherait FUTBIN en iframe).
const postToParent = (payload) => {
  try {
    window.parent.postMessage(Object.assign({ source: MSG }, payload), EA_ORIGIN);
  } catch (e) {}
};

const framedByEa = () => {
  try {
    const ancestors = location.ancestorOrigins;
    return !ancestors || !ancestors.length || ancestors[0] === EA_ORIGIN;
  } catch (e) {
    return false;
  }
};

const bodyText = () =>
  (document.body && (document.body.innerText || document.body.textContent)) || "";

// Attend que la page ait réellement chargé son contenu (prix, cartes de l'équipe).
const pageReady = () => {
  const path = location.pathname;
  if (/\/player\//.test(path)) {
    return !!document.querySelector(".price-box [class*='lowest-price']");
  }
  if (/squad|sbc/i.test(path)) {
    // Équipe fournie en JSON dans la page (rendu React) : prête dès que ce JSON est là.
    return (
      !!document.querySelector("script[data-react-data]") ||
      document.querySelectorAll("img[src*='/players/']").length >= 11
    );
  }
  return document.readyState === "complete";
};

// Requête POST demandée par le web app (#mb-post={ path, body }) : envoyée depuis futbin.com, avec
// les cookies du site. Seule la recherche de joueurs d'une collection de la galerie est autorisée.
const POST_PATHS = [/^\/\d{2}\/gallery\/set-player-search\/\d+$/];

const postRequest = () => {
  const match = String(location.hash || "").match(/^#mb-post=(.+)$/);
  if (!match) {
    return false;
  }
  let request = null;
  try {
    request = JSON.parse(decodeURIComponent(match[1]));
  } catch (e) {
    request = null;
  }
  const path = request && typeof request.path === "string" ? request.path : "";
  if (!POST_PATHS.some((re) => re.test(path)) || typeof request.body !== "string") {
    postToParent({ kind: "json", url: location.href, text: "" });
    return true;
  }
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: request.body, credentials: "same-origin" })
    .then((res) => res.text())
    .then((text) => postToParent({ kind: "json", url: path, text }))
    .catch(() => postToParent({ kind: "json", url: path, text: "" }));
  return true;
};

export const bootFutbinBridge = () => {
  if (!isFutbinPage() || !isFramed() || !framedByEa() || window.__mbFutbinBridge) {
    return;
  }
  window.__mbFutbinBridge = true;
  if (postRequest()) {
    return;
  }
  let sent = false;
  const send = () => {
    if (sent) {
      return;
    }
    sent = true;
    const text = bodyText().trim();
    if (text && (text[0] === "[" || text[0] === "{")) {
      postToParent({ kind: "json", url: location.href, text });
      return;
    }
    postToParent({
      kind: "html",
      url: location.href,
      text: document.documentElement ? document.documentElement.outerHTML : "",
    });
  };
  let tries = 0;
  const tick = () => {
    tries += 1;
    if (pageReady() || tries >= 40) {
      send();
      return true;
    }
    return false;
  };
  const start = () => {
    if (!tick()) {
      const timer = setInterval(() => {
        if (tick()) {
          clearInterval(timer);
        }
      }, 250);
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
};

let chain = Promise.resolve();

// Charge une URL FUTBIN dans une iframe cachée et renvoie { kind, url, text } ou null.
// graceMs : attente après le chargement de la page avant d'abandonner (réponse envoyée plus tard).
export const fetchViaIframe = (url, timeoutMs = 15000, graceMs = 4000) => {
  chain = chain
    .catch(() => {})
    .then(
      () =>
        new Promise((resolve) => {
          if (typeof document === "undefined" || !document.body) {
            resolve(null);
            return;
          }
          const iframe = document.createElement("iframe");
          iframe.setAttribute("data-mb-futbin", "1");
          iframe.setAttribute("aria-hidden", "true");
          iframe.style.cssText =
            "position:fixed;width:1px;height:1px;left:-9999px;bottom:0;opacity:0;pointer-events:none;border:0";
          let done = false;
          const finish = (payload) => {
            if (done) {
              return;
            }
            done = true;
            window.removeEventListener("message", onMessage);
            clearTimeout(timer);
            if (iframe.parentNode) {
              iframe.parentNode.removeChild(iframe);
            }
            resolve(payload);
          };
          const onMessage = (event) => {
            const data = event && event.data;
            if (
              data &&
              data.source === MSG &&
              event.source === iframe.contentWindow &&
              FUTBIN_ORIGINS.includes(event.origin)
            ) {
              finish({ kind: data.kind, url: data.url, text: String(data.text || "") });
            }
          };
          const timer = setTimeout(() => finish(null), timeoutMs);
          window.addEventListener("message", onMessage);
          // Page refusée dans une iframe (X-Frame-Options) : le chargement se termine sans message.
          iframe.addEventListener("load", () => setTimeout(() => finish(null), graceMs || 4000));
          iframe.src = url;
          document.body.appendChild(iframe);
        })
    );
  return chain;
};
