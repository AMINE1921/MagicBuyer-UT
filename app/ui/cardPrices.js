import { pageGlobal } from "../core/page";
import { afterTax, formatCoins } from "../core/prices";
import { getSettings, onSettingsChange } from "../core/settings";
import { locale, t } from "../i18n";
import { isCollected, onCollectionChange } from "../core/galleryCollection";
import { decorateResultRow, setRowLookup, setRowRefresher } from "./searchResults";
import { getItemScore, onItemScore, setItemScore } from "../prices/itemScores";
import { currentPrice, getPriceRecord, onPriceUpdate, trackPrice } from "../prices/priceService";

// Étiquette de prix FUTBIN en haut de chaque carte joueur rendue par le web app (club, marché,
// transferts, équipe, DCE…). Seules les cartes visibles à l'écran sont suivies ; le prix se met
// à jour tout seul quand FUTBIN change. Clic sur l'étiquette = page FUTBIN de la carte.
// Dans l'étiquette : score d'objet (points de galerie, gemme) ; sur le marché, écart du prix
// « achat immédiat » avec FUTBIN quand c'est une bonne affaire ; sur tes cartes, prix d'achat payé
// et bénéfice estimé après taxe.

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

// Séparateur décimal de la langue de l'interface (1,25M en français, 1.25M en anglais).
const decimalSeparator = () => {
  try {
    return (1.5).toLocaleString(locale()).replace(/\d/g, "") || ".";
  } catch (e) {
    return ".";
  }
};

export const shortCoins = (value) => {
  const n = Number(value) || 0;
  const trim = (text) => text.replace(/[.,]?0+$/, "").replace(".", decimalSeparator());
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
    return t("misc.unitSeconds", { n: seconds });
  }
  if (seconds < 3600) {
    return t("misc.unitMinutes", { n: Math.round(seconds / 60) });
  }
  return t("misc.unitHours", { n: Math.round(seconds / 3600) });
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

const auctionOf = (item) => {
  try {
    return (item && typeof item.getAuctionData === "function" && item.getAuctionData()) || (item && item._auction) || null;
  } catch (e) {
    return null;
  }
};

// Annonce active d'un autre joueur (résultats du marché) : prix « achat immédiat ».
const marketBin = (item) => {
  const auction = auctionOf(item);
  if (!auction || auction.tradeOwner || !(Number(auction.tradeId) > 0)) {
    return 0;
  }
  try {
    if (typeof auction.isActiveTrade === "function" && !auction.isActiveTrade()) {
      return 0;
    }
  } catch (e) {}
  return Number(auction.buyNowPrice) || 0;
};

// Annonce d'un autre joueur, active ou expirée (résultats du marché, cartes suivies) : pas ta carte.
const othersListing = (item) => {
  const auction = auctionOf(item);
  return !!(auction && Number(auction.tradeId) > 0 && !auction.tradeOwner);
};

// Prix payé pour une de tes cartes (EA : lastSalePrice), jamais sur l'annonce d'un autre joueur.
const boughtFor = (item) => {
  if (!item || othersListing(item)) {
    return 0;
  }
  return Number(item.lastSalePrice) || 0;
};

const span = (badge, cls) => {
  let el = badge.querySelector(`:scope > .${cls}`);
  if (!el) {
    el = document.createElement("span");
    el.className = cls;
    badge.appendChild(el);
  }
  return el;
};

const setPart = (badge, cls, text) => {
  if (!text) {
    const el = badge.querySelector(`:scope > .${cls}`);
    if (el) {
      el.remove();
    }
    return;
  }
  const el = span(badge, cls);
  if (el.textContent !== text) {
    el.textContent = text;
  }
};

// Ligne de liste EA (marché, transferts) qui contient la carte : surlignée pour une bonne affaire.
const listRow = (root) => (root.closest ? root.closest(".listFUTItem") : null);

const EXTRA = "mb-card-extra";

// Pastille du bas : écart avec FUTBIN (annonce du marché) ou prix payé et bénéfice (tes cartes).
const paintExtra = (root, text, cls, title) => {
  let extra = root.querySelector(`:scope > .${EXTRA}`);
  if (!text) {
    if (extra) {
      extra.remove();
    }
    return;
  }
  if (!extra) {
    // Pastille d'information : les clics passent à la carte EA (sélection de la carte).
    extra = document.createElement("div");
    extra.className = EXTRA;
    root.appendChild(extra);
  }
  if (extra.textContent !== text) {
    extra.textContent = text;
  }
  extra.className = `${EXTRA} ${cls}`;
  extra.title = title;
};

const signed = (value) => `${value >= 0 ? "+" : "−"}${shortCoins(Math.abs(value))}`;

// Score de galerie donné par EA sur l'objet (gradingScore → sbsScore) : exact, partagé avec la galerie.
const eaScoreOf = (state) => {
  const value = Number(state.item && state.item.sbsScore) || 0;
  if (value > 0 && state.eaScore !== value) {
    state.eaScore = value;
    setItemScore(state.id, value, true);
  }
  return value;
};

const COLLECTED = "mb-card-collected";

// Pastille « déjà dans ta collection de galerie » sur l'annonce d'un autre joueur ou une carte concept
// (tes propres cartes sont toutes collectées).
const paintCollected = (root, state, settings) => {
  let mark = root.querySelector(`:scope > .${COLLECTED}`);
  const item = state.item;
  const show =
    (settings.gallery || {}).collectedBadge !== false &&
    !!item &&
    (othersListing(item) || !!item.concept) &&
    (item.isCollected === true || isCollected(state.id));
  if (!show) {
    if (mark) {
      mark.remove();
    }
    return;
  }
  if (!mark) {
    mark = document.createElement("div");
    mark.className = COLLECTED;
    mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 7v10M6 5v14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="10" y="3" width="12" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
    root.appendChild(mark);
  }
  mark.title = t("gallery.collectedBadge");
};

const paint = (root, state) => {
  ensurePositioned(root);
  decorateResultRow(root, state.item);
  let badge = root.querySelector(`:scope > .${BADGE}`);
  const settings = getSettings();
  const tools = settings.tools || {};
  const record = getPriceRecord(state.id);
  const price = currentPrice(state.id, DISPLAY_MAX_AGE);
  const eaScore = eaScoreOf(state);
  const score = settings.ui.itemScoreBadge !== false ? (eaScore ? { score: eaScore, exact: true } : getItemScore(state.id)) : null;
  paintCollected(root, state, settings);
  const row = listRow(root);
  const bin = marketBin(state.item);
  const threshold = Math.max(50, Math.min(100, Number(tools.bargainPercent) || 90));
  const isBargain = tools.bargain !== false && price > 0 && bin > 0 && (bin / price) * 100 <= threshold;
  if (row) {
    row.classList.toggle("mb-row-bargain", isBargain);
  }
  const paid = tools.boughtFor !== false ? boughtFor(state.item) : 0;
  if (isBargain) {
    const profit = afterTax(price) - bin;
    paintExtra(
      root,
      `−${Math.round((1 - bin / price) * 100)}% · ${signed(profit)}`,
      "is-deal",
      t("tools.badgeBargain", { bin: formatCoins(bin), percent: Math.round((1 - bin / price) * 100), profit: formatCoins(profit) })
    );
  } else if (paid) {
    const profit = price ? afterTax(price) - paid : null;
    paintExtra(
      root,
      profit != null ? `${shortCoins(paid)} ${signed(profit)}` : shortCoins(paid),
      profit != null && profit < 0 ? "is-bought is-neg" : "is-bought",
      profit != null
        ? t("tools.badgeBought", { paid: formatCoins(paid), profit: `${profit >= 0 ? "+" : "−"}${formatCoins(Math.abs(profit))}` })
        : t("tools.badgeBoughtOnly", { paid: formatCoins(paid) })
    );
  } else {
    paintExtra(root, "");
  }
  const missing = !!(record && record.status === "miss" && !price);
  if (missing && !score) {
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
  setPart(badge, "mb-cp-price", missing ? "" : price ? `${suspect ? "⚠ " : ""}${shortCoins(price)}` : "…");
  setPart(badge, "mb-cp-gem", score ? shortCoins(score.score) : "");
  badge.classList.toggle("is-ready", !!price);
  badge.classList.toggle("is-suspect", suspect);
  badge.classList.toggle("is-stale", !!(price && record && Date.now() - record.fetchedAt > 10 * 60 * 1000));
  const parts = [];
  if (price) {
    parts.push(
      t("misc.badgeRead", { price: formatCoins(price), age: ago(record.fetchedAt) }) +
        (record.updatedAgoSec ? ` ${t("misc.badgeUpdated", { age: ago(record.fetchedAt - record.updatedAgoSec * 1000) })}` : "") +
        (suspect ? ` · ${t("misc.badgeSuspect", { price: formatCoins(record.suspect.price) })}` : "")
    );
  } else if (!missing) {
    parts.push(t("misc.badgeLoading"));
  }
  if (score) {
    parts.push(t(score.exact ? "tools.badgeScore" : "tools.badgeScoreApprox", { score: formatCoins(score.score) }));
  }
  if (record && record.url) {
    parts.push(t("misc.badgeClick"));
  }
  badge.title = parts.join(" · ");
};

// ------------------------------------ panneau de détail : achat immédiat comparé au prix FUTBIN

const CHECK = "mb-buy-check";

// Carte affichée dans le panneau de détail d'une annonce : diapositive active du carrousel EA.
const detailCard = (view) => {
  const cards = Array.from(view.querySelectorAll(".detail-carousel .item"));
  return cards.find((el) => el.closest(".tns-slide-active")) || (cards.length === 1 ? cards[0] : null);
};

// Carte affichée dans le panneau de détail (annonce du marché) : { item, id } ou null.
export const detailItemFor = (view) => {
  const card = view ? detailCard(view) : null;
  const state = card ? states.get(card) : null;
  return state ? { item: state.item, id: state.id } : null;
};

// Achat immédiat de l'annonce affichée comparé à une revente au prix FUTBIN (taxe EA de 5 %
// déduite). null si rien à comparer : pas d'annonce active d'un autre joueur ou prix inconnu.
export const buyCheckFor = (view) => {
  const card = view ? detailCard(view) : null;
  const state = card ? states.get(card) : null;
  if (!state) {
    return null;
  }
  const bin = marketBin(state.item);
  const price = currentPrice(state.id, DISPLAY_MAX_AGE);
  if (!bin || !price) {
    return null;
  }
  return { bin, price, net: afterTax(price), profit: afterTax(price) - bin, percent: Math.round((bin / price) * 100) };
};

const signedFull = (value) => `${value >= 0 ? "+" : "−"}${formatCoins(Math.abs(value))}`;

// Ligne sous les boutons d'achat : « FUTBIN 25 000 · achat à 88 % · revente ≈ +2 750 ».
export const tickBuyCheck = () => {
  const settings = getSettings();
  const enabled = !!settings.ui.cardPrices && (settings.tools || {}).buyCheck !== false;
  document.querySelectorAll(".DetailView").forEach((view) => {
    const options = view.querySelector(".DetailPanel .bidOptions");
    let line = view.querySelector(`.${CHECK}`);
    const check = enabled && options && view.querySelector(".DetailPanel button.buyButton") ? buyCheckFor(view) : null;
    if (!check) {
      if (line) {
        line.remove();
      }
      return;
    }
    if (!line) {
      line = document.createElement("div");
      line.className = CHECK;
    }
    if (line.previousElementSibling !== options) {
      options.after(line);
    }
    const params = {
      price: formatCoins(check.price),
      percent: check.percent,
      profit: signedFull(check.profit),
      bin: formatCoins(check.bin),
      net: formatCoins(check.net),
    };
    const text = t("tools.buyCheck", params);
    if (line.textContent !== text) {
      line.textContent = text;
    }
    line.className = `${CHECK} ${check.profit >= 0 ? "is-profit" : "is-loss"}`;
    line.title = t("tools.buyCheckTitle", params);
  });
};

let checkBound = false;

// Changement de carte dans la liste (clic, flèches) : ligne mise à jour sans attendre le tick.
export const bindBuyCheck = () => {
  if (checkBound) {
    return;
  }
  checkBound = true;
  const soon = () => {
    setTimeout(tickBuyCheck, 60);
    setTimeout(tickBuyCheck, 400);
  };
  document.addEventListener("click", soon, true);
  document.addEventListener("keyup", soon, true);
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
  root.querySelectorAll(`:scope > .${BADGE}, :scope > .mb-card-extra, :scope > .mb-card-collected`).forEach((el) => el.remove());
  const row = root.closest ? root.closest(".listFUTItem") : null;
  if (row) {
    row.classList.remove("mb-row-bargain");
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
  // Résultats d'une recherche à la main : ligne masquée / marquée selon les filtres du marché.
  decorateResultRow(root, item);
  const id = getSettings().ui.cardPrices ? eligibleId(item) : 0;
  const previous = states.get(root);
  if (!id) {
    if (previous) {
      detach(root);
    }
    removeBadge(root);
    const row = listRow(root);
    if (row) {
      row.classList.remove("mb-row-bargain");
    }
    return;
  }
  if (previous && previous.id === id) {
    previous.item = item;
    paint(root, previous);
    return;
  }
  if (previous) {
    detach(root);
  }
  const state = { id, item, hint: itemHint(item), untrack: null };
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

// Cartes affichées (vues EA décorées) dans un conteneur : [{ root, item }].
export const decoratedWithin = (container) => {
  const found = [];
  if (!container) {
    return found;
  }
  byId.forEach((roots) => {
    roots.forEach((root) => {
      const state = states.get(root);
      if (state && root.isConnected && container.contains(root)) {
        found.push({ root, item: state.item });
      }
    });
  });
  return found;
};

export const hookCardPrices = () => {
  if (!listening) {
    listening = true;
    onPriceUpdate((id) => {
      repaintId(id);
      tickBuyCheck();
    });
    onItemScore((id) => repaintId(id));
    onSettingsChange((settings, path) => {
      if ((path === "ui.cardPrices" || path === "*") && !settings.ui.cardPrices) {
        clearAll();
      } else if (path === "ui.language" || path === "*" || /^(tools\.|ui\.itemScoreBadge|gallery\.collectedBadge)/.test(path)) {
        // Infobulles, format des nombres et pastilles selon les nouveaux réglages.
        Array.from(byId.keys()).forEach(repaintId);
      }
    });
    // Collection de galerie mise à jour : pastilles « collectée » des cartes affichées (groupé).
    let collectionTimer = null;
    onCollectionChange(() => {
      if (!collectionTimer) {
        collectionTimer = setTimeout(() => {
          collectionTimer = null;
          Array.from(byId.keys()).forEach(repaintId);
        }, 500);
      }
    });
    sweepTimer = sweepTimer || setInterval(sweep, 5000);
    bindBuyCheck();
    // Filtres du marché changés : lignes des résultats recalculées ; sélection auto : ligne d'une annonce.
    setRowRefresher(() => Array.from(byId.keys()).forEach(repaintId));
    setRowLookup((target) => {
      const roots = byId.get(Number(target && target.definitionId) || 0);
      const root = roots ? Array.from(roots).find((entry) => states.get(entry) && states.get(entry).item === target) : null;
      return root && root.closest ? root.closest(".listFUTItem") : null;
    });
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
