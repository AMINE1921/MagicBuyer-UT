const FORBIDDEN_QUERY = {
  authenticity: true,
  definitionid: true,
  acquireddate: true,
  untradeables: true,
  untradeable: true,
};

export const sanitizeTransferMarketUrl = (url) => {
  if (typeof url !== "string" || url.indexOf("transfermarket") === -1) {
    return url;
  }
  const qIndex = url.indexOf("?");
  if (qIndex === -1) {
    return url;
  }
  const base = url.slice(0, qIndex);
  let query = url.slice(qIndex + 1);
  let hash = "";
  const hashIndex = query.indexOf("#");
  if (hashIndex !== -1) {
    hash = query.slice(hashIndex);
    query = query.slice(0, hashIndex);
  }
  const kept = [];
  let hasMasked = false;
  let definitionId = "";
  query.split("&").forEach((part) => {
    if (!part) {
      return;
    }
    const eq = part.indexOf("=");
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawVal = eq === -1 ? "" : part.slice(eq + 1);
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey);
    } catch (e) {}
    const lower = key.toLowerCase();
    if (lower === "maskeddefid" && rawVal && rawVal !== "0") {
      hasMasked = true;
    }
    if (lower === "definitionid") {
      if (rawVal && rawVal !== "0") {
        definitionId = rawVal;
      }
      return;
    }
    if (FORBIDDEN_QUERY[lower]) {
      return;
    }
    kept.push(eq === -1 ? rawKey : `${rawKey}=${rawVal}`);
  });
  if (!hasMasked && definitionId) {
    kept.push(`maskedDefId=${definitionId}`);
  }
  return `${base}${kept.length ? `?${kept.join("&")}` : ""}${hash}`;
};

const patchXhr = (xhrCtor) => {
  if (!xhrCtor || !xhrCtor.prototype || xhrCtor.prototype.open.__mbTm) {
    return;
  }
  const original = xhrCtor.prototype.open;
  xhrCtor.prototype.open = function (method, url) {
    const args = Array.prototype.slice.call(arguments);
    if (typeof args[1] === "string") {
      args[1] = sanitizeTransferMarketUrl(args[1]);
    }
    return original.apply(this, args);
  };
  xhrCtor.prototype.open.__mbTm = true;
};

const patchFetch = (target) => {
  if (!target || typeof target.fetch !== "function" || target.fetch.__mbTm) {
    return;
  }
  const original = target.fetch.bind(target);
  const wrapped = function (input, init) {
    if (typeof input === "string") {
      input = sanitizeTransferMarketUrl(input);
    } else if (input && typeof input.url === "string") {
      const cleaned = sanitizeTransferMarketUrl(input.url);
      if (cleaned !== input.url) {
        try {
          input = new Request(cleaned, input);
        } catch (e) {
          input = cleaned;
        }
      }
    }
    return original(input, init);
  };
  wrapped.__mbTm = true;
  try {
    target.fetch = wrapped;
  } catch (e) {}
};

const PAGE_GUARD = `(function () {
  if (window.__mbTmUrlPatched) {
    return;
  }
  window.__mbTmUrlPatched = true;
  var drop = {
    authenticity: 1,
    definitionid: 1,
    acquireddate: 1,
    untradeables: 1,
    untradeable: 1,
  };
  function clean(url) {
    if (typeof url !== "string" || url.indexOf("transfermarket") === -1) {
      return url;
    }
    var q = url.indexOf("?");
    if (q === -1) {
      return url;
    }
    var base = url.slice(0, q);
    var query = url.slice(q + 1);
    var hash = "";
    var h = query.indexOf("#");
    if (h !== -1) {
      hash = query.slice(h);
      query = query.slice(0, h);
    }
    var kept = [];
    var hasMasked = false;
    var definitionId = "";
    query.split("&").forEach(function (part) {
      if (!part) {
        return;
      }
      var eq = part.indexOf("=");
      var rawKey = eq === -1 ? part : part.slice(0, eq);
      var rawVal = eq === -1 ? "" : part.slice(eq + 1);
      var key = rawKey;
      try {
        key = decodeURIComponent(rawKey);
      } catch (e) {}
      var lower = String(key).toLowerCase();
      if (lower === "maskeddefid" && rawVal && rawVal !== "0") {
        hasMasked = true;
      }
      if (lower === "definitionid") {
        if (rawVal && rawVal !== "0") {
          definitionId = rawVal;
        }
        return;
      }
      if (drop[lower]) {
        return;
      }
      kept.push(eq === -1 ? rawKey : rawKey + "=" + rawVal);
    });
    if (!hasMasked && definitionId) {
      kept.push("maskedDefId=" + definitionId);
    }
    return base + (kept.length ? "?" + kept.join("&") : "") + hash;
  }
  var xhr = XMLHttpRequest && XMLHttpRequest.prototype;
  if (xhr && xhr.open && !xhr.open.__mbTm) {
    var origOpen = xhr.open;
    xhr.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      if (typeof args[1] === "string") {
        args[1] = clean(args[1]);
      }
      return origOpen.apply(this, args);
    };
    xhr.open.__mbTm = true;
  }
  if (typeof fetch === "function" && !fetch.__mbTm) {
    var origFetch = fetch;
    window.fetch = function (input, init) {
      if (typeof input === "string") {
        input = clean(input);
      } else if (input && typeof input.url === "string") {
        var cleaned = clean(input.url);
        if (cleaned !== input.url) {
          try {
            input = new Request(cleaned, input);
          } catch (e) {
            input = cleaned;
          }
        }
      }
      return origFetch.call(this, input, init);
    };
    window.fetch.__mbTm = true;
  }
})();`;

export const installTransferMarketUrlGuard = () => {
  if (window.__mbTmUrlGuard) {
    return;
  }
  window.__mbTmUrlGuard = true;
  try {
    const script = document.createElement("script");
    script.textContent = PAGE_GUARD;
    (document.documentElement || document.head || document.body).appendChild(
      script
    );
    script.remove();
  } catch (e) {
    console.warn("[MagicBuyer] garde marché (page)", e);
  }
  try {
    patchXhr(window.XMLHttpRequest);
    patchFetch(window);
  } catch (e) {}
  try {
    const page =
      (typeof unsafeWindow !== "undefined" && unsafeWindow) || window;
    if (page && page !== window) {
      patchXhr(page.XMLHttpRequest);
      patchFetch(page);
    }
  } catch (e) {}
};
