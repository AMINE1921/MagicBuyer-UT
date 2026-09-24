import { pageGlobal } from "../core/page";
import { formatCoins } from "../core/prices";
import { getSettings, onSettingsChange } from "../core/settings";
import { currentPrice, getPriceRecord, onPriceUpdate, trackPrice } from "../prices/priceService";

// Étiquette de prix FUTBIN en haut de chaque carte joueur rendue par le web app (club, marché,
// transferts, équipe, DCE…). Seules les cartes visibles à l'écran sont suivies ; le prix se met
// à jour tout seul quand FUTBIN change. Clic sur l'étiquette = page FUTBIN de la carte.

const BADGE = "mb-card-price";
const DISPLAY_MAX_AGE = 60 * 60 * 1000;
const states = new WeakMap();
const byId = new Map();
let observer = null;
let hooked = false;
let sweepTimer = null;
let listening = false;

const call = (target, method) => {
  try {
    return target && typeof target[method] === "function" ? target[method]() : undefined;
  } catch (e) {
    return undefined;
  }
};

// Carte joueur échangeable ou non, hors concepts et prêts.
const eligibleId = (item) => {
  if (!item || !call(item, "isValid") || !call(item, "isPlayer") || item.concept || call(item, "isLimitedUse")) {
    return 0;
  }
  return Number(item.definitionId) || 0;
};

const itemHint = (item) => {
  try {
    const data = (typeof item.getStaticData === "function" && item.getStaticData()) || item._staticData || {};
    const name = (data.knownAs && data.knownAs !== "---" ? data.knownAs : "") || data.name || data.lastName || "";
    return { name: String(name).trim(), rating: Number(item.rating) || 0 };
  } catch (e) {
    return { name: "", rating: 0 };
  }
};

export const shortCoins = (value) => {
  const n = Number(value) || 0;
  const trim = (text) => text.replace(/[.,]?0+$/, "").replace(".", ",");
  if (n >= 1000000) {
    return `${trim((n / 1000000).toFixed(n >= 10000000 ? 1 : 2))}M`;
  }
  if (n >= 100000) {
    return `${Math.round(n / 1000)}K`;
  }
  if (n >= 1000) {
    return `${trim((n / 1000).toFixed(2))}K`;
  }
  return String(n);
};

const ago = (timestamp) => {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds} s`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} min`;
  }
  return `${Math.round(seconds / 3600)} h`;
};

const openFutbin = (event) => {
  event.preventDefault();
  event.stopPropagation();
  const badge = event.currentTarget;
  const record = getPriceRecord(Number(badge.dataset.id));
  if (record && record.url) {
    window.open(record.url, "_blank", "noopener");
  }
};

const swallow = (event) => event.stopPropagation();

const createBadge = (root) => {
  const badge = document.createElement("div");
  badge.className = BADGE;
  badge.setAttribute("role", "link");
  badge.addEventListener("click", openFutbin);
  ["pointerdown", "mousedown", "touchstart", "touchend", "mouseup", "pointerup"].forEach((type) =>
    badge.addEventListener(type, swallow)
  );
  root.appendChild(badge);
  return badge;
};

// L'étiquette est positionnée par rapport à la carte : on ne touche au style EA que si besoin.
const ensurePositioned = (root) => {
  if (root.__mbPositioned || !root.isConnected) {
    return;
  }
  root.__mbPositioned = true;
  try {
    if (getComputedStyle(root).position === "static") {
      root.classList.add("mb-card-rel");
    }
  } catch (e) {}
};

const paint = (root, state) => {
  ensurePositioned(root);
  let badge = root.querySelector(`:scope > .${BADGE}`);
  const record = getPriceRecord(state.id);
  const price = currentPrice(state.id, DISPLAY_MAX_AGE);
  if (record && record.status === "miss" && !price) {
    if (badge) {
      badge.hidden = true;
    }
    return;
  }
  if (!badge) {
    badge = createBadge(root);
  }
  badge.hidden = false;
  badge.dataset.id = String(state.id);
  const suspect = !!(record && record.suspect);
  const text = price ? `${suspect ? "⚠ " : ""}${shortCoins(price)}` : "…";
  if (badge.textContent !== text) {
    badge.textContent = text;
  }
  badge.classList.toggle("is-ready", !!price);
  badge.classList.toggle("is-suspect", suspect);
  badge.classList.toggle("is-stale", !!(price && record && Date.now() - record.fetchedAt > 10 * 60 * 1000));
  badge.title = price
    ? `FUTBIN ${formatCoins(price)} · lu il y a ${ago(record.fetchedAt)}` +
      (record.updatedAgoSec ? ` (mis à jour par FUTBIN il y a ${ago(record.fetchedAt - record.updatedAgoSec * 1000)})` : "") +
      (suspect ? ` · saut à ${formatCoins(record.suspect.price)} en vérification` : "") +
      " · clic : page FUTBIN"
    : "Prix FUTBIN en cours de lecture…";
};

const index = (id, root, add) => {
  let set = byId.get(id);
  if (add) {
    if (!set) {
      set = new Set();
      byId.set(id, set);
    }
    set.add(root);
  } else if (set) {
    set.delete(root);
    if (!set.size) {
      byId.delete(id);
    }
  }
};

const detach = (root) => {
  const state = states.get(root);
  if (!state) {
    return;
  }
  if (state.untrack) {
    state.untrack();
  }
  index(state.id, root, false);
  states.delete(root);
  if (observer) {
    observer.unobserve(root);
  }
};

const removeBadge = (root) => {
  const badge = root.querySelector(`:scope > .${BADGE}`);
  if (badge) {
    badge.remove();
  }
};

const ensureObserver = () => {
  if (observer || typeof IntersectionObserver !== "function") {
    return observer;
  }
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const state = states.get(entry.target);
        if (!state) {
          observer.unobserve(entry.target);
          return;
        }
        if (entry.isIntersecting) {
          ensurePositioned(entry.target);
        }
        if (entry.isIntersecting && !state.untrack) {
          state.untrack = trackPrice(state.id, state.hint, "visible");
        } else if (!entry.isIntersecting && state.untrack) {
          state.untrack();
          state.untrack = null;
        }
      });
    },
    { rootMargin: "80px" }
  );
  return observer;
};

// Cartes retirées de la page : on arrête leur suivi.
const sweep = () => {
  byId.forEach((roots) => {
    Array.from(roots).forEach((root) => {
      if (!root.isConnected) {
        detach(root);
      }
    });
  });
};

const decorate = (view, item) => {
  const root = typeof view.getRootElement === "function" ? view.getRootElement() : null;
  if (!root || !root.querySelector) {
    return;
  }
  const id = getSettings().ui.cardPrices ? eligibleId(item) : 0;
  const previous = states.get(root);
  if (!id) {
    if (previous) {
      detach(root);
    }
    removeBadge(root);
    return;
  }
  if (previous && previous.id === id) {
    paint(root, previous);
    return;
  }
  if (previous) {
    detach(root);
  }
  const state = { id, hint: itemHint(item), untrack: null };
  states.set(root, state);
  index(id, root, true);
  const io = ensureObserver();
  if (io) {
    io.observe(root);
  } else {
    state.untrack = trackPrice(id, state.hint, "visible");
  }
  paint(root, state);
};

const repaintId = (id) => {
  const roots = byId.get(Number(id));
  if (!roots) {
    return;
  }
  roots.forEach((root) => {
    const state = states.get(root);
    if (state) {
      paint(root, state);
    }
  });
};

const clearAll = () => {
  byId.forEach((roots) => {
    Array.from(roots).forEach((root) => {
      detach(root);
      removeBadge(root);
    });
  });
};

export const hookCardPrices = () => {
  if (!listening) {
    listening = true;
    onPriceUpdate((id) => repaintId(id));
    onSettingsChange((settings, path) => {
      if ((path === "ui.cardPrices" || path === "*") && !settings.ui.cardPrices) {
        clearAll();
      }
    });
    sweepTimer = sweepTimer || setInterval(sweep, 5000);
  }
  if (hooked) {
    return true;
  }
  const View = pageGlobal("UTItemView");
  if (typeof View !== "function" || !View.prototype || typeof View.prototype.render !== "function") {
    return false;
  }
  if (!View.prototype.__mbCardPrice) {
    const original = View.prototype.render;
    View.prototype.render = function (item) {
      const result = original.apply(this, arguments);
      try {
        decorate(this, item);
      } catch (e) {}
      return result;
    };
    View.prototype.__mbCardPrice = true;
  }
  hooked = true;
  return true;
};
