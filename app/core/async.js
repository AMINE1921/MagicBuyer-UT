import { newPageObject, toPageFunction } from "./page";

// Jeton d'annulation : Stop réveille immédiatement toutes les attentes en cours.
export const createCancelToken = () => {
  const listeners = new Set();
  const token = {
    cancelled: false,
    on(fn) {
      listeners.add(fn);
    },
    off(fn) {
      listeners.delete(fn);
    },
    cancel() {
      if (token.cancelled) {
        return;
      }
      token.cancelled = true;
      Array.from(listeners).forEach((fn) => {
        try {
          fn();
        } catch (e) {}
      });
      listeners.clear();
    },
  };
  return token;
};

// Résout `true` après `ms`, ou `false` si le jeton est annulé avant.
export const sleep = (ms, token) =>
  new Promise((resolve) => {
    if (token && token.cancelled) {
      resolve(false);
      return;
    }
    if (!(ms > 0)) {
      resolve(true);
      return;
    }
    let timer = null;
    const cancel = () => {
      clearTimeout(timer);
      resolve(false);
    };
    timer = setTimeout(() => {
      if (token) {
        token.off(cancel);
      }
      resolve(true);
    }, ms);
    if (token) {
      token.on(cancel);
    }
  });

// Transforme un EAObservable du web app en Promise, avec délai maximum.
// Ne rejette jamais : en cas d'échec on résout une réponse { success: false }.
export const observe = (observable, timeoutMs = 15000) =>
  new Promise((resolve) => {
    if (!observable || typeof observable.observe !== "function") {
      resolve({ success: false, status: -1, invalid: true });
      return;
    }
    const scope = newPageObject();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        observable.unobserve(scope);
      } catch (e) {}
      resolve({ success: false, status: -2, timeout: true });
    }, timeoutMs);
    const callback = toPageFunction((sender, response) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        (sender || observable).unobserve(scope);
      } catch (e) {}
      resolve(response || { success: false, status: -3 });
    });
    try {
      observable.observe(scope, callback);
    } catch (e) {
      settled = true;
      clearTimeout(timer);
      resolve({ success: false, status: -1, exception: e });
    }
  });

export const withTimeout = (promise, ms, fallback) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
