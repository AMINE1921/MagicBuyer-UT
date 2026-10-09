import { auctionOf } from "../core/market";
import { itemService, pageGlobal, repositories } from "../core/page";
import { priceAbove } from "../core/prices";
import { getSettings, onSettingsChange, setSetting } from "../core/settings";
import { inBotCall } from "../core/usage";
import { plural, t } from "../i18n";
import { currentPrice } from "../prices/priceService";
import { escapeHtml } from "./dom";
import { tapElement } from "./tap";

// Résultats des recherches faites à la main sur le marché (jamais celles du bot) :
// - tri des annonces (achat immédiat, enchère, note, temps restant) avant l'affichage EA ;
// - annonces masquées (tes joueurs du club, ligues, nations, clubs, postes, raretés, styles,
//   « affaires seulement ») : lignes cachées, pas retirées (la pagination EA reste juste) ;
// - affaires en enchère surlignées, carte que tu as déjà marquée ;
// - sélection automatique de l'annonce la moins chère ou de la meilleure affaire (aucun achat).
// Les annonces de la dernière recherche sont repérées par leur tradeId : la liste des objectifs
// de transfert, le club ou la liste des transferts ne sont jamais touchés.

const HIDDEN = "mb-row-hidden";
const OWNED = "mb-row-owned";
const BID_DEAL = "mb-row-bid-bargain";
const DISPLAY_MAX_AGE = 60 * 60 * 1000;

// Dernière recherche faite à la main : annonces affichées (tradeId → objet EA).
let lastSearch = { at: 0, trades: new Map(), autoDone: false };
let showAll = false;
let hooked = null;

const call = (target, method) => {
  try {
    return target && typeof target[method] === "function" ? target[method]() : undefined;
  } catch (e) {
    return undefined;
  }
};

const settings = () => getSettings().results || {};

const tradeIdOf = (item) => {
  const auction = auctionOf(item);
  return auction && Number(auction.tradeId) > 0 ? String(auction.tradeId) : "";
};

export const isSearchResult = (item) => {
  const id = tradeIdOf(item);
  return !!id && lastSearch.trades.has(id);
};

// ------------------------------------------------------------ tri

const binOf = (item) => Number((auctionOf(item) || {}).buyNowPrice) || 0;
const bidOf = (item) => {
  const auction = auctionOf(item) || {};
  return Number(auction.currentBid) || Number(auction.startingBid) || 0;
};
const expiresOf = (item) => Number((auctionOf(item) || {}).expires) || 0;
const ratingOf = (item) => Number(item && item.rating) || 0;

const SORTS = {
  "bin-asc": (a, b) => binOf(a) - binOf(b),
  "bin-desc": (a, b) => binOf(b) - binOf(a),
  "bid-asc": (a, b) => bidOf(a) - bidOf(b),
  "bid-desc": (a, b) => bidOf(b) - bidOf(a),
  "rating-desc": (a, b) => ratingOf(b) - ratingOf(a),
  "rating-asc": (a, b) => ratingOf(a) - ratingOf(b),
  "expires-desc": (a, b) => expiresOf(b) - expiresOf(a),
};

export const SORT_OPTIONS = ["none", "bin-asc", "bin-desc", "bid-asc", "bid-desc", "rating-desc", "rating-asc", "expires-desc"];

// Tri stable (à égalité, l'ordre EA : temps restant croissant).
export const sortItems = (items, mode) => {
  const compare = SORTS[mode];
  if (!compare || !Array.isArray(items) || items.length < 2) {
    return items;
  }
  const indexed = items.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => compare(a.item, b.item) || a.index - b.index);
  indexed.forEach((entry, index) => {
    items[index] = entry.item;
  });
  return items;
};

// ------------------------------------------------------------ cartes masquées

// Cartes du club déjà chargées par le web app (sans requête) : définitions possédées.
let ownedCache = { at: 0, ids: new Set() };
const ownedIds = () => {
  if (Date.now() - ownedCache.at < 5000) {
    return ownedCache.ids;
  }
  const ids = new Set();
  try {
    const club = repositories().Item.getClub();
    const values = club && club.items && typeof club.items.values === "function" ? club.items.values() : [];
    Array.from(values).forEach((item) => {
      const id = Number(item && item.definitionId) || 0;
      if (id && !call(item, "isLimitedUse")) {
        ids.add(id);
      }
    });
  } catch (e) {}
  ownedCache = { at: Date.now(), ids };
  return ids;
};

export const positionOf = (item) => {
  try {
    const names = pageGlobal("PlayerPosition");
    const value = item && item.preferredPosition;
    if (names && value != null && names[value] != null) {
      return String(names[value]);
    }
  } catch (e) {}
  return "";
};

const listOf = (value) => (Array.isArray(value) ? value.map(Number).filter((n) => !Number.isNaN(n)) : []);

const isBargain = (item, price) => {
  const threshold = Math.max(50, Math.min(100, Number((getSettings().tools || {}).bargainPercent) || 90));
  const bin = binOf(item);
  return price > 0 && bin > 0 && (bin / price) * 100 <= threshold;
};

// Enchère suivante (ou mise de départ) sous le seuil d'affaire du prix FUTBIN.
const isBidBargain = (item, price) => {
  const threshold = Math.max(50, Math.min(100, Number((getSettings().tools || {}).bargainPercent) || 90));
  const auction = auctionOf(item) || {};
  const next = Number(auction.currentBid) ? priceAbove(Number(auction.currentBid)) : Number(auction.startingBid) || 0;
  return price > 0 && next > 0 && (next / price) * 100 <= threshold;
};

// Raison de masquer une annonce (clé de traduction) ; "" = affichée.
export const hideReason = (item, rules = settings()) => {
  const id = Number(item && item.definitionId) || 0;
  if (rules.hideOwned && id && ownedIds().has(id)) {
    return "owned";
  }
  if (listOf(rules.hideLeagues).includes(Number(item.leagueId))) {
    return "league";
  }
  if (listOf(rules.hideNations).includes(Number(item.nationId))) {
    return "nation";
  }
  if (listOf(rules.hideClubs).includes(Number(item.teamId))) {
    return "club";
  }
  if (listOf(rules.hideRarities).includes(Number(item.rareflag))) {
    return "rarity";
  }
  if (listOf(rules.hideStyles).includes(Number(item.playStyle))) {
    return "style";
  }
  const positions = Array.isArray(rules.hidePositions) ? rules.hidePositions.map(String) : [];
  if (positions.length && positions.includes(positionOf(item))) {
    return "position";
  }
  if (rules.onlyBargains && id) {
    const price = currentPrice(id, DISPLAY_MAX_AGE);
    // Prix pas encore lu : l'annonce reste visible (elle sera masquée à l'arrivée du prix).
    if (price && !isBargain(item, price)) {
      return "bargain";
    }
  }
  return "";
};

// Appelé par l'étiquette de prix (cardPrices) à chaque rendu d'une carte et à l'arrivée de son prix.
export const decorateResultRow = (root, item) => {
  const row = root && root.closest ? root.closest(".listFUTItem") : null;
  if (!row) {
    return;
  }
  if (!item || !isSearchResult(item)) {
    row.classList.remove(HIDDEN, OWNED, BID_DEAL);
    return;
  }
  const rules = settings();
  const id = Number(item.definitionId) || 0;
  const reason = hideReason(item, rules);
  row.classList.toggle(HIDDEN, !!reason && !showAll);
  row.dataset.mbHidden = reason;
  row.classList.toggle(OWNED, !!id && ownedIds().has(id));
  const price = id ? currentPrice(id, DISPLAY_MAX_AGE) : 0;
  row.classList.toggle(BID_DEAL, !!rules.bidBargains && isBidBargain(item, price));
};

// ------------------------------------------------------------ bandeau des cartes masquées

const BAR = "mb-results-bar";

const visibleList = () =>
  Array.from(document.querySelectorAll(".paginated-item-list")).find((list) => list.isConnected && list.getBoundingClientRect().width > 0) || null;

const reasonsSummary = (rows) => {
  const counts = new Map();
  rows.forEach((row) => {
    const reason = row.dataset.mbHidden;
    if (reason) {
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
  });
  return Array.from(counts.entries())
    .map(([reason, n]) => `${t(`results.reason_${reason}`)} ${n}`)
    .join(" · ");
};

export const tickResults = () => {
  hookResults();
  const list = visibleList();
  const rows = list ? Array.from(list.querySelectorAll(".listFUTItem")).filter((row) => row.dataset.mbHidden) : [];
  let bar = list && list.parentElement ? list.parentElement.querySelector(`:scope > .${BAR}`) : null;
  if (!list || !rows.length) {
    if (bar) {
      bar.remove();
    }
    document.querySelectorAll(`.${BAR}`).forEach((el) => {
      if (!list || el.parentElement !== list.parentElement) {
        el.remove();
      }
    });
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.className = BAR;
    bar.addEventListener("click", (event) => {
      if (event.target.closest("[data-mb-results='toggle']")) {
        event.preventDefault();
        event.stopPropagation();
        showAll = !showAll;
        refreshRows();
        tickResults();
      }
    });
    list.parentElement.insertBefore(bar, list);
  }
  const html = `<span>${escapeHtml(plural(rows.length, showAll ? "results.shownOne" : "results.hiddenOne", showAll ? "results.shownMany" : "results.hiddenMany"))}</span>
    <span class="mb-results-why">${escapeHtml(reasonsSummary(rows))}</span>
    <button type="button" data-mb-results="toggle">${escapeHtml(t(showAll ? "results.hideAgain" : "results.showAll"))}</button>`;
  if (bar.dataset.html !== html) {
    bar.dataset.html = html;
    bar.innerHTML = html;
  }
};

// Règles changées : lignes affichées recalculées sans attendre un nouveau rendu EA.
let rowRefresher = () => {};
export const setRowRefresher = (fn) => {
  rowRefresher = fn;
};
const refreshRows = () => {
  try {
    rowRefresher();
  } catch (e) {}
};

// ------------------------------------------------------------ sélection automatique

// Annonce à sélectionner après une recherche : la moins chère (achat immédiat) ou la plus grosse
// remise par rapport au prix FUTBIN. Seulement une sélection (comme un clic sur la ligne).
const pickTarget = (items, mode) => {
  const visible = items.filter((item) => binOf(item) > 0 && !hideReason(item));
  if (!visible.length) {
    return null;
  }
  if (mode === "cheapest") {
    return visible.slice().sort((a, b) => binOf(a) - binOf(b))[0];
  }
  if (mode === "bargain") {
    const scored = visible
      .map((item) => {
        const price = currentPrice(Number(item.definitionId) || 0, DISPLAY_MAX_AGE);
        return { item, gain: price && isBargain(item, price) ? 1 - binOf(item) / price : -1 };
      })
      .filter((entry) => entry.gain > 0)
      .sort((a, b) => b.gain - a.gain);
    return scored.length ? scored[0].item : null;
  }
  return null;
};

let rowLookup = () => null;
export const setRowLookup = (fn) => {
  rowLookup = fn;
};

const autoSelect = (items) => {
  const mode = settings().autoSelect;
  if (!mode || mode === "none") {
    return;
  }
  const started = lastSearch.at;
  // Après le rendu EA (et l'arrivée éventuelle des prix pour « meilleure affaire »).
  [400, 1500].forEach((delay) =>
    setTimeout(() => {
      if (lastSearch.at !== started || lastSearch.autoDone) {
        return;
      }
      const target = pickTarget(items, mode);
      const row = target ? rowLookup(target) : null;
      const content = row && (row.querySelector(".rowContent") || row);
      if (content && tapElement(content)) {
        lastSearch.autoDone = true;
      }
    }, delay)
  );
};

// ------------------------------------------------------------ interception des recherches

// Réponse d'une recherche faite à la main : annonces mémorisées, triées avant l'affichage EA.
const onManualResponse = (response) => {
  const data = response && (response.data || response.response);
  const items = data && Array.isArray(data.items) ? data.items : null;
  if (!response || !response.success || !items) {
    return;
  }
  lastSearch = { at: Date.now(), trades: new Map(), autoDone: false };
  showAll = false;
  items.forEach((item) => {
    const id = tradeIdOf(item);
    if (id) {
      lastSearch.trades.set(id, item);
    }
  });
  sortItems(items, settings().sort);
  autoSelect(items);
};

// Enveloppe services.Item.searchTransferMarket (une fois par instance du service EA) : seules les
// recherches faites à la main sont modifiées (le bot et les outils passent par asBot).
export const hookResults = () => {
  const svc = itemService();
  if (!svc || hooked === svc) {
    return !!svc;
  }
  const original = svc.searchTransferMarket;
  if (typeof original !== "function" || original.__mbResults) {
    hooked = svc;
    return true;
  }
  const wrapped = function () {
    const observable = original.apply(this, arguments);
    if (inBotCall() || !observable || typeof observable.observe !== "function") {
      return observable;
    }
    const observe = observable.observe;
    observable.observe = function (scope, callback) {
      return observe.call(this, scope, function (observer, response) {
        try {
          onManualResponse(response);
        } catch (e) {}
        return callback.apply(this, arguments);
      });
    };
    return observable;
  };
  wrapped.__mbResults = true;
  wrapped.__mbUsage = original.__mbUsage;
  svc.searchTransferMarket = wrapped;
  hooked = svc;
  return true;
};

// ------------------------------------------------------------ réglages (page de recherche EA)

const BOX = "mb-results-box";

// Listes EA pour choisir ce qu'on masque (sans requête : données du web app).
const optionsFor = (kind) => {
  try {
    const repo = repositories().TeamConfig;
    if (kind === "league") {
      return Array.from(repo.getLeagues(), (entry) => ({ id: Number(entry.id), name: String(entry.name || entry.abbreviation || entry.id) }));
    }
    if (kind === "nation") {
      return Array.from(repo.getNations(), (entry) => ({ id: Number(entry.id), name: String(entry.name || entry.id) }));
    }
    if (kind === "club") {
      return Array.from(repo.getTeams(), (entry) => ({ id: Number(entry.id), name: String(entry.name || entry.id) }));
    }
    if (kind === "rarity") {
      const rarity = repositories().Rarity;
      return Array.from(rarity.values(), (entry) => ({ id: Number(entry.id), name: String(entry.name || entry.title || entry.id) })).filter((entry) => entry.id >= 0);
    }
  } catch (e) {}
  return [];
};

const POSITIONS = ["GK", "RB", "RWB", "CB", "LB", "LWB", "CDM", "CM", "CAM", "RM", "LM", "RW", "LW", "CF", "ST"];

const KINDS = [
  { kind: "league", key: "hideLeagues" },
  { kind: "nation", key: "hideNations" },
  { kind: "club", key: "hideClubs" },
  { kind: "rarity", key: "hideRarities" },
  { kind: "position", key: "hidePositions" },
];

const nameFor = (kind, value) => {
  if (kind === "position") {
    return String(value);
  }
  const found = optionsFor(kind).find((entry) => entry.id === Number(value));
  return found ? found.name : String(value);
};

const chipsHtml = (kind, key) => {
  const values = Array.isArray(settings()[key]) ? settings()[key] : [];
  return values
    .map((value) => `<span class="mb-chip">${escapeHtml(nameFor(kind, value))}<button type="button" data-mb-chip-remove="${key}" data-value="${escapeHtml(String(value))}" aria-label="×">×</button></span>`)
    .join("");
};

const boxHtml = () => {
  const rules = settings();
  const select = (name, options, value) =>
    `<select data-mb-results-set="${name}">${options.map(([v, label]) => `<option value="${v}"${String(value) === v ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
  const toggle = (name, label) => `<label class="mb-results-check"><input type="checkbox" data-mb-results-set="${name}"${rules[name] ? " checked" : ""}> ${escapeHtml(label)}</label>`;
  return `<summary>${escapeHtml(t("results.boxTitle"))}${activeCount(rules) ? ` <b>${activeCount(rules)}</b>` : ""}</summary>
    <div class="mb-results-grid">
      ${toggle("hideOwned", t("results.hideOwned"))}
      ${toggle("onlyBargains", t("results.onlyBargains"))}
      ${toggle("bidBargains", t("results.bidBargains"))}
      <label class="mb-results-field">${escapeHtml(t("results.sort"))}${select("sort", SORT_OPTIONS.map((mode) => [mode, t(`results.sort_${mode}`)]), rules.sort || "none")}</label>
      <label class="mb-results-field">${escapeHtml(t("results.autoSelect"))}${select("autoSelect", [["none", t("results.auto_none")], ["cheapest", t("results.auto_cheapest")], ["bargain", t("results.auto_bargain")]], rules.autoSelect || "none")}</label>
    </div>
    <div class="mb-results-hide">${KINDS.map(
      ({ kind, key }) => `<div class="mb-results-hide-row" data-kind="${kind}">
        <span class="mb-results-hide-label">${escapeHtml(t(`results.hide_${kind}`))}</span>
        <span class="mb-chips">${chipsHtml(kind, key)}</span>
        <input type="text" list="mb-results-list-${kind}" data-mb-chip-add="${key}" data-kind="${kind}" placeholder="${escapeHtml(t("results.addPlaceholder"))}">
      </div>`
    ).join("")}</div>
    ${KINDS.map(({ kind }) => `<datalist id="mb-results-list-${kind}"></datalist>`).join("")}
    <p class="mb-results-hint">${escapeHtml(t("results.hint"))}</p>`;
};

const activeCount = (rules) =>
  ["hideOwned", "onlyBargains", "bidBargains"].filter((key) => rules[key]).length +
  KINDS.reduce((total, { key }) => total + (Array.isArray(rules[key]) ? rules[key].length : 0), 0) +
  (rules.sort && rules.sort !== "none" ? 1 : 0) +
  (rules.autoSelect && rules.autoSelect !== "none" ? 1 : 0);

// Liste de choix remplie à la première saisie (milliers de clubs : pas à chaque rendu).
const fillDatalist = (box, kind) => {
  const list = box.querySelector(`#mb-results-list-${kind}`);
  if (!list || list.dataset.filled) {
    return;
  }
  list.dataset.filled = "1";
  const options = kind === "position" ? POSITIONS.map((name) => ({ id: name, name })) : optionsFor(kind);
  list.innerHTML = options
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `<option value="${escapeHtml(entry.name)}"></option>`)
    .join("");
};

const addChip = (key, kind, text) => {
  const name = String(text || "").trim().toLowerCase();
  if (!name) {
    return false;
  }
  let value = null;
  if (kind === "position") {
    value = POSITIONS.find((entry) => entry.toLowerCase() === name) || null;
  } else {
    const options = optionsFor(kind);
    const exact = options.find((entry) => entry.name.toLowerCase() === name);
    const found = exact || (/^\d+$/.test(name) ? { id: Number(name) } : null);
    value = found ? found.id : null;
  }
  if (value == null) {
    return false;
  }
  const current = Array.isArray(settings()[key]) ? settings()[key].slice() : [];
  if (!current.map(String).includes(String(value))) {
    current.push(value);
    setSetting(`results.${key}`, current);
  }
  return true;
};

export const mountResultsBox = (host) => {
  if (!host || host.querySelector(`.${BOX}`)) {
    return;
  }
  const box = document.createElement("details");
  box.className = BOX;
  box.innerHTML = boxHtml();
  const stop = (event) => event.stopPropagation();
  ["pointerdown", "mousedown", "touchstart", "keydown"].forEach((type) => box.addEventListener(type, stop));
  box.addEventListener("change", (event) => {
    const field = event.target.closest("[data-mb-results-set]");
    if (field) {
      const name = field.dataset.mbResultsSet;
      setSetting(`results.${name}`, field.type === "checkbox" ? field.checked : field.value);
      return;
    }
    const add = event.target.closest("[data-mb-chip-add]");
    if (add && addChip(add.dataset.mbChipAdd, add.dataset.kind, add.value)) {
      add.value = "";
    }
  });
  box.addEventListener("focusin", (event) => {
    const add = event.target.closest("[data-mb-chip-add]");
    if (add) {
      fillDatalist(box, add.dataset.kind);
    }
  });
  box.addEventListener("keydown", (event) => {
    const add = event.target.closest("[data-mb-chip-add]");
    if (add && event.key === "Enter") {
      event.preventDefault();
      if (addChip(add.dataset.mbChipAdd, add.dataset.kind, add.value)) {
        add.value = "";
      }
    }
  });
  box.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-mb-chip-remove]");
    if (remove) {
      event.preventDefault();
      const key = remove.dataset.mbChipRemove;
      const current = (Array.isArray(settings()[key]) ? settings()[key] : []).filter((value) => String(value) !== remove.dataset.value);
      setSetting(`results.${key}`, current);
    }
  });
  host.appendChild(box);
};

// Réglages changés (ici ou dans le panneau) : boîtes redessinées, lignes recalculées.
let listening = false;
export const bindResultsSettings = () => {
  if (listening) {
    return;
  }
  listening = true;
  onSettingsChange((all, path) => {
    if (path !== "*" && !/^(results\.|tools\.bargain|ui\.language)/.test(path)) {
      return;
    }
    document.querySelectorAll(`.${BOX}`).forEach((box) => {
      const open = box.open;
      const focused = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.mbChipAdd : "";
      box.innerHTML = boxHtml();
      box.open = open;
      if (focused) {
        const input = box.querySelector(`[data-mb-chip-add="${focused}"]`);
        if (input) {
          input.focus();
        }
      }
    });
    refreshRows();
  });
};

// Utilisé par les tests.
export const resetResultsForTests = () => {
  lastSearch = { at: 0, trades: new Map(), autoDone: false };
  showAll = false;
  hooked = null;
  ownedCache = { at: 0, ids: new Set() };
};

export const rememberSearchForTests = (items) => onManualResponse({ success: true, data: { items } });
