export const getPageWindow = () => {
  try {
    if (typeof unsafeWindow !== "undefined" && unsafeWindow) {
      return unsafeWindow;
    }
  } catch (e) {}
  try {
    if (window.wrappedJSObject) {
      return window.wrappedJSObject;
    }
  } catch (e) {}
  return window;
};

export const getPageServices = () => {
  const page = getPageWindow();
  return (page && page.services) || window.services || null;
};

export const getPageRepositories = () => {
  const page = getPageWindow();
  return (page && page.repositories) || window.repositories || null;
};

export const syncPageGlobals = () => {
  const page = getPageWindow();
  if (!page) {
    return page;
  }
  const keys = [
    "services",
    "repositories",
    "UTTabBarView",
    "UTCurrencyInputControl",
    "JSUtils",
    "UINotificationType",
    "UTSearchCriteriaDTO",
    "ItemPile",
    "isPhone",
    "fut_year",
    "fut_guid",
    "fut_resourceRoot",
    "fut_resourceBase",
  ];
  keys.forEach((key) => {
    try {
      if (page[key] != null && window[key] == null) {
        window[key] = page[key];
      }
    } catch (e) {}
  });
  return page;
};

export const eaIsPhone = () => {
  try {
    const page = getPageWindow();
    const fn = (page && page.isPhone) || window.isPhone;
    return typeof fn === "function" ? !!fn() : false;
  } catch (e) {
    return false;
  }
};
