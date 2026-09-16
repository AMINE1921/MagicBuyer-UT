import { getPageWindow } from "./pageWindow";

const MAGICBUYER_TAB_TEXT = "MagicBuyer";
const MAGICBUYER_TAB_TAG = 42;

let classFactory;
let tabBarControllerClass;
let searchFiltersControllerClass;
let capturedTabBarController;

export const ensureEaShims = () => {
  if (typeof window.isPhone !== "function") {
    window.isPhone = () =>
      !!(document.body && document.body.classList.contains("phone")) ||
      (window.innerWidth || 0) < 768;
  }

  if (!window.JSUtils) {
    window.JSUtils = {};
  }
  if (typeof window.JSUtils.inherits !== "function") {
    window.JSUtils.inherits = inherits;
  }
  if (typeof window.JSUtils.find !== "function") {
    window.JSUtils.find = (list, predicate) =>
      Array.isArray(list) ? list.find(predicate) : undefined;
  }
  if (typeof window.JSUtils.isValid !== "function") {
    window.JSUtils.isValid = (value) => value != null;
  }
};

export const inherits = (ctor, superCtor) => {
  if (!ctor || !superCtor) {
    return;
  }
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  ctor.prototype.constructor = ctor;
};

const considerClass = (fn, predicate) => {
  if (typeof fn !== "function" || !fn.prototype) {
    return null;
  }
  try {
    return predicate(fn.prototype, fn) ? fn : null;
  } catch (e) {
    return null;
  }
};

export const getClassFactory = () => {
  if (classFactory) {
    return classFactory;
  }
  const roots = [];
  try {
    roots.push(getPageWindow());
  } catch (e) {}
  roots.push(window);
  const seen = new Set();
  for (const root of roots) {
    if (!root || seen.has(root)) {
      continue;
    }
    seen.add(root);
    let names = [];
    try {
      names = Object.getOwnPropertyNames(root);
    } catch (e) {
      continue;
    }
    for (const key of names) {
      let namespace;
      try {
        namespace = root[key];
      } catch (e) {
        continue;
      }
      if (!namespace || typeof namespace.ds !== "function") {
        continue;
      }
      try {
        const maybeClass = namespace.ds();
        if (typeof maybeClass === "function" && maybeClass.TabTag) {
          classFactory = namespace;
          return classFactory;
        }
      } catch (e) {}
    }
  }
  return null;
};

const scanFactoryForClass = (predicate) => {
  const factory = getClassFactory();
  if (!factory) {
    return null;
  }
  let names = [];
  try {
    names = Object.getOwnPropertyNames(factory);
  } catch (e) {
    return null;
  }
  for (const name of names) {
    let value;
    try {
      value = factory[name];
    } catch (e) {
      continue;
    }
    const direct = considerClass(value, predicate);
    if (direct) {
      return direct;
    }
    if (typeof value === "function" && value.length === 0) {
      try {
        const produced = value();
        const match = considerClass(produced, predicate);
        if (match) {
          return match;
        }
      } catch (e) {}
    }
  }
  return null;
};

export const getTabBarControllerClass = () => {
  if (window.UTGameTabBarController) {
    return window.UTGameTabBarController;
  }
  if (tabBarControllerClass) {
    return tabBarControllerClass;
  }
  const factory = getClassFactory();
  if (factory) {
    try {
      const cls = factory.ds();
      if (cls && cls.TabTag && cls.prototype.initWithViewControllers) {
        tabBarControllerClass = cls;
        return cls;
      }
    } catch (e) {}
  }
  tabBarControllerClass = scanFactoryForClass(
    (proto, cls) =>
      typeof proto.initWithViewControllers === "function" && !!cls.TabTag
  );
  return tabBarControllerClass;
};

export const getMarketSearchFiltersViewController = () => {
  if (window.UTMarketSearchFiltersViewController) {
    return window.UTMarketSearchFiltersViewController;
  }
  if (searchFiltersControllerClass) {
    return searchFiltersControllerClass;
  }
  searchFiltersControllerClass = scanFactoryForClass(
    (proto) =>
      typeof proto._eResetSelected === "function" &&
      typeof proto._eSearchSelected === "function"
  );
  return searchFiltersControllerClass;
};

export const getFilterBarViewClass = () => {
  if (window.EAFilterBarView) {
    return window.EAFilterBarView;
  }
  return scanFactoryForClass(
    (proto) =>
      typeof proto.addTab === "function" &&
      typeof proto.setActiveTab === "function"
  );
};

export const getTapEvent = () => {
  if (window.EventType && EventType.TAP != null) {
    return EventType.TAP;
  }
  const factory = getClassFactory();
  if (factory) {
    let names = [];
    try {
      names = Object.getOwnPropertyNames(factory);
    } catch (e) {
      names = [];
    }
    for (const name of names) {
      let value;
      try {
        value = factory[name];
      } catch (e) {
        continue;
      }
      if (typeof value !== "function" || value.length !== 0) {
        continue;
      }
      try {
        const produced = value();
        if (produced && produced.TAP != null) {
          return produced.TAP;
        }
      } catch (e) {}
    }
  }
  return "tap";
};

export const isMagicBuyerVisible = () =>
  Array.from(document.querySelectorAll(".ut-tab-bar-item")).some((el) =>
    (el.textContent || "").includes(MAGICBUYER_TAB_TEXT)
  );

const controllerFromTabBarView = (view) => {
  if (!view) {
    return null;
  }
  if (view._targets && typeof view._targets.forEach === "function") {
    let found = null;
    view._targets.forEach((entries) => {
      (entries || []).forEach((entry) => {
        if (
          !found &&
          entry &&
          entry.target &&
          Array.isArray(entry.target.childViewControllers)
        ) {
          found = entry.target;
        }
      });
    });
    if (found) {
      return found;
    }
  }
  if (
    view._eventDelegate &&
    Array.isArray(view._eventDelegate.childViewControllers)
  ) {
    return view._eventDelegate;
  }
  return null;
};

export const captureTabBarController = () => {
  if (
    capturedTabBarController &&
    Array.isArray(capturedTabBarController.childViewControllers)
  ) {
    return Promise.resolve(capturedTabBarController);
  }
  if (
    window.__mbTabBarController &&
    Array.isArray(window.__mbTabBarController.childViewControllers)
  ) {
    capturedTabBarController = window.__mbTabBarController;
    return Promise.resolve(capturedTabBarController);
  }

  const fromView = controllerFromTabBarView(window.__mbTabBarView);
  if (fromView) {
    rememberTabBarController(fromView);
    return Promise.resolve(fromView);
  }

  if (typeof UTTabBarView === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const proto = UTTabBarView.prototype;
    const finish = (view) => {
      if (view) {
        window.__mbTabBarView = view;
      }
      const controller = controllerFromTabBarView(
        view || window.__mbTabBarView
      );
      if (controller) {
        rememberTabBarController(controller);
      }
      resolve(controller || null);
    };

    ["_eTabSelected", "setSelectedIndex", "layoutSubviews"].forEach(
      (method) => {
        const original = proto[method];
        if (typeof original !== "function" || original.__mbHooked) {
          return;
        }
        const wrapped = function (...args) {
          window.__mbTabBarView = this;
          const controller = controllerFromTabBarView(this);
          if (controller) {
            rememberTabBarController(controller);
          }
          return original.apply(this, args);
        };
        wrapped.__mbHooked = true;
        proto[method] = wrapped;
      }
    );

    setTimeout(() => finish(window.__mbTabBarView || null), 350);
  });
};

export const rememberTabBarController = (controller) => {
  if (controller) {
    capturedTabBarController = controller;
    window.__mbTabBarController = controller;
  }
};

export const createMagicBuyerNav = (sampleNav) => {
  const NavClass = sampleNav
    ? sampleNav.constructor
    : window.UTGameFlowNavigationController;
  if (typeof NavClass !== "function") {
    throw new Error("Navigation controller class introuvable");
  }

  const TabItemClass =
    sampleNav && sampleNav.tabBarItem
      ? sampleNav.tabBarItem.constructor
      : window.UTTabBarItemView;
  if (typeof TabItemClass !== "function") {
    throw new Error("Tab item class introuvable");
  }

  const nav = new NavClass(null);
  return { nav, TabItemClass };
};

export const generateAutoBuyerTab = (TabItemClass, title = MAGICBUYER_TAB_TEXT) => {
  const autoBuyerTab = new TabItemClass();
  autoBuyerTab.init();
  autoBuyerTab.setTag(MAGICBUYER_TAB_TAG);
  autoBuyerTab.setText(title);
  autoBuyerTab.addClass("icon-transfer");
  autoBuyerTab.addClass("icon-magicbuyer");
  return autoBuyerTab;
};

export { MAGICBUYER_TAB_TEXT, MAGICBUYER_TAB_TAG };
