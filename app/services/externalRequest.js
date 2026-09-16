import { isMarketAlertApp } from "../app.constants";
import { setValue } from "../services/repository";

export const sendExternalRequest = async (options) => {
  if (isMarketAlertApp) {
    sendPhoneRequest(options);
  } else {
    sendWebRequest(options);
  }
};

const sendPhoneRequest = (options) => {
  setValue(options.identifier, options.onload);
  delete options["onload"];
  window.ReactNativeWebView.postMessage(
    JSON.stringify({ type: "fetchFromExternalAB", payload: { options } })
  );
};

const sendWebRequest = (options) => {
  const headers = Object.assign({}, options.headers || {});
  if (!headers.Accept) {
    headers.Accept = "application/json, text/html;q=0.9, */*;q=0.8";
  }
  if (/futbin\.com/i.test(options.url) && !headers.Referer) {
    headers.Referer = "https://www.futbin.com/";
  }
  const fail = () => {
    if (typeof options.onload === "function") {
      options.onload({ status: 0, response: "", responseText: "" });
    }
  };
  const gm =
    typeof GM_xmlhttpRequest === "function"
      ? GM_xmlhttpRequest
      : typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function"
      ? GM.xmlHttpRequest
      : null;
  if (!gm) {
    fetch(options.url, { method: options.method || "GET", credentials: "include" })
      .then((res) =>
        res.text().then((text) =>
          options.onload({
            status: res.status,
            response: text,
            responseText: text,
          })
        )
      )
      .catch(fail);
    return;
  }
  gm({
    method: options.method || "GET",
    url: options.url,
    headers,
    anonymous: false,
    timeout: 15000,
    onload: options.onload,
    onerror: fail,
    ontimeout: fail,
  });
};
