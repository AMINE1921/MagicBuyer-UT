const MSG = "MB_FUTBIN";

export const isFutbinPage = () => {
  try {
    return /(^|\.)futbin\.com$/i.test(location.hostname);
  } catch (e) {
    return false;
  }
};

export const parseCoinText = (text) => {
  if (text == null || text === "") {
    return null;
  }
  if (typeof text === "number" && text > 0) {
    return Math.round(text);
  }
  const raw = String(text).replace(/\u00a0|\u202f/g, " ").trim();
  if (!raw || raw === "-" || raw === "---") {
    return null;
  }
  const withUnit = raw.replace(/,/g, ".").match(/^([\d.]+)\s*([KMB])$/i);
  if (withUnit) {
    let n = parseFloat(withUnit[1]);
    const unit = withUnit[2].toUpperCase();
    if (unit === "K") n *= 1000;
    if (unit === "M") n *= 1000000;
    if (unit === "B") n *= 1000000000;
    return n ? Math.round(n) : null;
  }
  const digits = parseInt(String(text).replace(/[^\d]/g, ""), 10);
  return digits || null;
};

export const looksLikeCloudflare = (html) =>
  /cf-browser-verification|just a moment|Oops, there was an error - 403|challenge-platform/i.test(
    String(html || "")
  );

const platformBox = (root, platform) => {
  const preferPc = platform === "pc";
  const boxes = Array.from(
    root.querySelectorAll(".price-box-original-player, .price-box")
  );
  const match = boxes.find((box) => {
    const cls = box.className || "";
    return preferPc
      ? /platform-pc|pc-only/i.test(cls)
      : /platform-ps|ps-only/i.test(cls);
  });
  return match || boxes[0] || null;
};

const priceFromBox = (box) => {
  if (!box) {
    return null;
  }
  const el =
    box.querySelector(".lowest-price-1") ||
    box.querySelector("#ps-lowest-1") ||
    box.querySelector("#pc-lowest-1") ||
    box.querySelector("[data-price]");
  if (!el) {
    return null;
  }
  return (
    parseCoinText(el.getAttribute("data-price")) ||
    parseCoinText(el.getAttribute("data-price-raw")) ||
    parseCoinText(el.textContent)
  );
};

const pricesFromBio = (text, platform) => {
  const blob = String(text || "");
  const en = blob.match(
    /current price on FUT is ([\d.,\s]+)\s+on PlayStation,\s*([\d.,\s]+)\s+on Xbox,\s*(?:and\s*)?([\d.,\s]+)\s+on PC/i
  );
  if (en) {
    const ps = parseCoinText(en[1]);
    const xbox = parseCoinText(en[2]);
    const pc = parseCoinText(en[3]);
    if (platform === "pc") {
      return pc || xbox || ps;
    }
    return ps || xbox || pc;
  }
  const fr = blob.match(
    /prix(?: actuel)?(?: sur FUT)?(?: est)?\s+([\d.,\s]+)\s+sur PlayStation/i
  );
  if (fr) {
    return parseCoinText(fr[1]);
  }
  return null;
};

export const scrapeFutbinPlayerDocument = (root, platform) => {
  const doc = root && root.querySelector ? root : null;
  if (!doc) {
    return { price: null, resourceId: null, futbinId: null, url: "" };
  }
  const box = platformBox(doc, platform);
  const pageInfo = doc.getElementById && doc.getElementById("page-info");
  const resourceId =
    (pageInfo &&
      (pageInfo.getAttribute("data-player-resource") ||
        pageInfo.getAttribute("data-resource-id") ||
        pageInfo.getAttribute("data-base-id"))) ||
    null;
  const futbinId =
    (pageInfo &&
      (pageInfo.getAttribute("data-id") ||
        pageInfo.getAttribute("data-player-id"))) ||
    null;
  const attrPrice =
    pageInfo &&
    parseCoinText(
      (platform === "pc"
        ? pageInfo.getAttribute("data-price-pc") ||
          pageInfo.getAttribute("data-pc-price")
        : pageInfo.getAttribute("data-price-ps") ||
          pageInfo.getAttribute("data-ps-price")) ||
        pageInfo.getAttribute("data-price")
    );
  const price =
    priceFromBox(box) ||
    priceFromBox(doc) ||
    attrPrice ||
    pricesFromBio(
      (doc.body && doc.body.textContent) || doc.textContent || "",
      platform
    );
  return {
    price,
    resourceId,
    futbinId,
    url: typeof location !== "undefined" ? location.href : "",
  };
};

export const scrapePriceFromHtml = (html, platform) => {
  if (!html || looksLikeCloudflare(html)) {
    return { price: null, resourceId: null, futbinId: null };
  }
  let parsed = { price: null, resourceId: null, futbinId: null };
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    parsed = scrapeFutbinPlayerDocument(doc, platform);
  } catch (e) {}
  if (!parsed.price) {
    parsed.price = pricesFromBio(html, platform);
  }
  if (!parsed.price) {
    const attr =
      html.match(/lowest-price-1[^>]*data-price="([^"]+)"/i) ||
      html.match(/id="ps-lowest-1"[^>]*data-price="([^"]+)"/i) ||
      html.match(/data-price="([\d,.\s]+)"/i);
    parsed.price = attr ? parseCoinText(attr[1]) : null;
  }
  return parsed;
};

const postToParent = (payload) => {
  const message = Object.assign({ source: MSG }, payload);
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, "*");
    }
  } catch (e) {}
};

const tryParseJsonBody = () => {
  const text =
    (document.body && (document.body.innerText || document.body.textContent)) ||
    "";
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    return null;
  }
};

export const bootFutbinBridge = () => {
  if (!isFutbinPage() || window.__mbFutbinBridge) {
    return;
  }
  window.__mbFutbinBridge = true;
  let posted = false;
  const finish = (payload) => {
    if (posted) {
      return true;
    }
    posted = true;
    postToParent(payload);
    return true;
  };
  const run = () => {
    const json = tryParseJsonBody();
    if (json) {
      return finish({ kind: "json", url: location.href, json });
    }
    if (/\/player\//.test(location.pathname)) {
      let tries = 0;
      const tick = () => {
        tries += 1;
        const data = scrapeFutbinPlayerDocument(document);
        if (data.price || tries >= 30) {
          return finish(Object.assign({ kind: "page" }, data));
        }
        return false;
      };
      if (!tick()) {
        const timer = setInterval(() => {
          if (tick()) {
            clearInterval(timer);
          }
        }, 250);
      }
      return;
    }
    if (document.documentElement) {
      finish({
        kind: "html",
        url: location.href,
        html: document.documentElement.innerHTML,
      });
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
    window.addEventListener("load", run, { once: true });
  } else {
    run();
  }
};

let iframeChain = Promise.resolve();

export const fetchFutbinViaIframe = (url, timeoutMs = 12000) => {
  iframeChain = iframeChain
    .catch(() => {})
    .then(
      () =>
        new Promise((resolve) => {
          if (!document.body) {
            resolve(null);
            return;
          }
          const iframe = document.createElement("iframe");
          iframe.setAttribute("data-mb-futbin", "1");
          iframe.style.cssText =
            "position:fixed;width:1px;height:1px;left:-9999px;bottom:0;opacity:0;pointer-events:none;border:0";
          let done = false;
          const finish = (payload) => {
            if (done) {
              return;
            }
            done = true;
            window.removeEventListener("message", onMsg);
            clearTimeout(timer);
            if (iframe.parentNode) {
              iframe.parentNode.removeChild(iframe);
            }
            resolve(payload);
          };
          const onMsg = (event) => {
            const data = event && event.data;
            if (!data || data.source !== MSG) {
              return;
            }
            finish(data);
          };
          const timer = setTimeout(() => finish(null), timeoutMs);
          window.addEventListener("message", onMsg);
          iframe.src = url;
          document.body.appendChild(iframe);
        })
    )
    .then((result) => {
      return new Promise((resolve) => {
        setTimeout(() => resolve(result), 400);
      });
    });
  return iframeChain;
};
