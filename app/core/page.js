// Accès au contexte de la page du web app EA (unsafeWindow sous Tampermonkey).
// Toutes les classes EA de FC 27 (UTSearchCriteriaDTO, ItemPile, UtasErrorCode…)
// sont des globales `var` de la page : on les lit ici, jamais via `window` du bac à sable.

let pageOverride = null;

export const getPage = () => {
  if (pageOverride) {
    return pageOverride;
  }
  try {
    if (typeof unsafeWindow !== "undefined" && unsafeWindow) {
      return unsafeWindow;
    }
  } catch (e) {}
  return typeof window !== "undefined" ? window : {};
};

// Utilisé par les tests pour simuler le web app.
export const setPageForTests = (page) => {
  pageOverride = page;
};

export const pageGlobal = (name) => {
  try {
    const value = getPage()[name];
    return value === undefined ? null : value;
  } catch (e) {
    return null;
  }
};

export const services = () => pageGlobal("services");
export const repositories = () => pageGlobal("repositories");

export const itemService = () => {
  const svc = services();
  return (svc && svc.Item) || null;
};

const PILE_FALLBACK = { TRANSFER: 5, PURCHASED: 6, CLUB: 7, INBOX: 8 };

export const pile = (name) => {
  const piles = pageGlobal("ItemPile");
  if (piles && typeof piles[name] === "number") {
    return piles[name];
  }
  return PILE_FALLBACK[name];
};

// Codes UTAS de FC 27 (lus dans le code du web app), avec repli si EA les renomme.
const ERROR_FALLBACK = {
  CAPTCHA_REQUIRED: 458,
  UT_BAD_REQUEST: 460,
  PERMISSION_DENIED: 461,
  STATE_INVALID: 462,
  NO_BID_TOKENS: 463,
  NOT_ENOUGH_CREDIT: 470,
  DESTINATION_FULL: 473,
  NO_TRADE_EXISTS: 478,
  LOCKED_TRANSFER_MARKET: 494,
  ACCOUNT_BANNED: 20000,
  UNRECOVERABLE: 20004,
};

export const errorCode = (name) => {
  const codes = pageGlobal("UtasErrorCode");
  if (codes && typeof codes[name] === "number") {
    return codes[name];
  }
  return ERROR_FALLBACK[name];
};

export const isAppReady = () =>
  !!(itemService() && typeof pageGlobal("UTSearchCriteriaDTO") === "function");

export const getUser = () => {
  try {
    const svc = services();
    return (svc && svc.User && svc.User.getUser && svc.User.getUser()) || null;
  } catch (e) {
    return null;
  }
};

export const getCoins = () => {
  try {
    const user = getUser();
    return Number(user && user.coins && user.coins.amount) || 0;
  } catch (e) {
    return 0;
  }
};

export const isPhone = () => {
  try {
    const fn = pageGlobal("isPhone");
    return typeof fn === "function" ? !!fn() : false;
  } catch (e) {
    return false;
  }
};

export const localize = (key, fallback) => {
  try {
    const svc = services();
    const text = svc && svc.Localization && svc.Localization.localize(key);
    return text && text !== key ? text : fallback;
  } catch (e) {
    return fallback;
  }
};

// Toast natif du web app (bandeau vert/rouge en haut).
export const eaToast = (message, negative) => {
  try {
    const svc = services();
    const types = pageGlobal("UINotificationType");
    if (svc && svc.Notification && typeof svc.Notification.queue === "function") {
      const type = types
        ? negative
          ? types.NEGATIVE
          : types.POSITIVE
        : undefined;
      svc.Notification.queue([message, type]);
      return true;
    }
  } catch (e) {}
  return false;
};

// Compatibilité Firefox (Xray) : rend une fonction / un tableau utilisable par la page.
export const toPageFunction = (fn) => {
  try {
    if (typeof exportFunction === "function") {
      return exportFunction(fn, getPage());
    }
  } catch (e) {}
  return fn;
};

export const toPageArray = (values) => {
  try {
    if (typeof cloneInto === "function") {
      return cloneInto(values, getPage());
    }
  } catch (e) {}
  return values.slice();
};

// Tableau de la page contenant des objets EA (références conservées, contrairement à cloneInto).
export const pageArrayOf = (values) => {
  try {
    const PageArray = getPage().Array;
    if (typeof PageArray === "function" && PageArray !== Array) {
      const out = new PageArray();
      values.forEach((value, index) => {
        out[index] = value;
      });
      return out;
    }
  } catch (e) {}
  return values.slice();
};

export const newPageObject = () => {
  try {
    if (typeof cloneInto === "function") {
      return cloneInto({}, getPage());
    }
  } catch (e) {}
  return {};
};
