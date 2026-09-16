try {
  const defaultFetch =
    typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  if (!defaultFetch) {
    throw new Error("fetch unavailable");
  }
  window.fetch = function (request, options) {
    options = options || {};
    const url = typeof request === "string" ? request : request && request.url;
    if (
      url &&
      (/discordapp/.test(url) || /exp.host/.test(url)) &&
      (options.method === "POST" || options.method === "DELETE")
    ) {
      return new Promise((resolve, reject) => {
        const headers = Object.assign({}, options.headers, {
          "User-Agent": "From Node",
        });
        GM_xmlhttpRequest({
          method: options.method,
          headers,
          url,
          data: options.body,
          onload: (res) => {
            if (res.status === 200 || res.status === 204) {
              res.text = () =>
                new Promise((resolveText) => resolveText(res.responseText));
              res.headers = (res.responseHeaders || "")
                .split("\r\n")
                .reduce(function (acc, current) {
                  var parts = current.split(": ");
                  acc.set(parts[0], parts[1]);
                  return acc;
                }, new Map());
              resolve(res);
            } else {
              reject(res);
            }
          },
        });
      });
    }
    return defaultFetch.call(this, request, options);
  };
} catch (e) {
  console.warn("[MagicBuyer] fetch hook", e);
}
