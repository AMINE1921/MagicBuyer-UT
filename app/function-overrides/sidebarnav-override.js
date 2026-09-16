import {
  AutoBuyerViewController,
  setupAutoBuyerViewController,
} from "../views/AutoBuyerViewController";
import {
  createMagicBuyerNav,
  generateAutoBuyerTab,
  getTabBarControllerClass,
  MAGICBUYER_TAB_TEXT,
  rememberTabBarController,
} from "../utils/eaCompat";

let patched = false;

export const sideBarNavOverride = () => {
  try {
    patchTabBarPrototype();
  } catch (e) {
    console.warn("[MagicBuyer] patch onglet EA", e);
  }
};

const patchTabBarPrototype = () => {
  const TabBarClass = getTabBarControllerClass();
  if (!TabBarClass || !TabBarClass.prototype || patched) {
    return !!TabBarClass;
  }

  const originalInit = TabBarClass.prototype.initWithViewControllers;
  if (typeof originalInit !== "function") {
    return false;
  }

  TabBarClass.prototype.initWithViewControllers = function (tabs) {
    rememberTabBarController(this);
    try {
      tabs = appendMagicBuyer(tabs);
    } catch (e) {
      console.error("[MagicBuyer] impossible d'ajouter l'onglet", e);
    }
    return originalInit.call(this, tabs);
  };
  patched = true;
  return true;
};

const hasMagicBuyer = (tabs = []) =>
  tabs.some((tab) => {
    try {
      const title =
        (tab.tabBarItem &&
          tab.tabBarItem.getRootElement &&
          tab.tabBarItem.getRootElement().textContent) ||
        (typeof tab.getNavigationTitle === "function"
          ? tab.getNavigationTitle()
          : "");
      return (title || "").includes(MAGICBUYER_TAB_TEXT);
    } catch (e) {
      return false;
    }
  });

const appendMagicBuyer = (tabs) => {
  tabs = getApplicableTabs(tabs || []);
  if (hasMagicBuyer(tabs)) {
    return tabs;
  }
  if (!setupAutoBuyerViewController()) {
    throw new Error("Contrôleur MagicBuyer non prêt");
  }
  const sample = tabs[0];
  const { nav, TabItemClass } = createMagicBuyerNav(sample);
  nav.initWithRootController(new AutoBuyerViewController());
  nav.tabBarItem = generateAutoBuyerTab(TabItemClass, MAGICBUYER_TAB_TEXT);
  tabs.push(nav);
  return tabs;
};

const getApplicableTabs = (tabs) => {
  if (typeof isPhone === "function" && isPhone()) {
    return [tabs[0], tabs[2], tabs[3], tabs[4]].filter(Boolean);
  }
  return tabs;
};
