// Requêtes hors EA (FUTBIN, Discord, Telegram) via GM_xmlhttpRequest (pas de CORS).

const gmRequest = () => {
  if (typeof GM_xmlhttpRequest === "function") {
    return GM_xmlhttpRequest;
  }
  if (typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function") {
    return GM.xmlHttpRequest;
  }
  return null;
};

export const sendExternalRequest = (options) => {
  const headers = Object.assign({}, options.headers || {});
  if (!headers.Accept) {
    headers.Accept = "application/json, text/html;q=0.9, */*;q=0.8";
  }
  if (/futbin\.com/i.test(options.url) && !headers.Referer) {
    headers.Referer = "https://www.futbin.com/";
  }
  let done = false;
  const finish = (res) => {
    if (done) {
      return;
    }
    done = true;
    if (typeof options.onload === "function") {
      try {
        options.onload(res);
      } catch (e) {}
    }
  };
  const fail = () => finish({ status: 0, response: "", responseText: "" });
  const gm = gmRequest();
  if (!gm) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => {
      if (controller) {
        controller.abort();
      }
      fail();
    }, options.timeout || 15000);
    fetch(options.url, {
      method: options.method || "GET",
      headers,
      body: options.data,
      credentials: "omit",
      signal: controller ? controller.signal : undefined,
    })
      .finally(() => clearTimeout(timer))
      .then((res) =>
        res.text().then((text) =>
          finish({ status: res.status, response: text, responseText: text })
        )
      )
      .catch(fail);
    return;
  }
  try {
    gm({
      method: options.method || "GET",
      url: options.url,
      headers,
      data: options.data,
      anonymous: !!options.anonymous,
      timeout: options.timeout || 15000,
      onload: finish,
      onerror: fail,
      ontimeout: fail,
      onabort: fail,
    });
  } catch (e) {
    fail();
  }
};
