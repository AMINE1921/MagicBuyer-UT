import {
  buildLadder,
  buyGalleryPlayers,
  candidatesFor,
  estimateSet,
  galleryBuySettings,
  galleryTargetPoints,
  isOffMarket,
  itemPrice,
  loadGalleryIndex,
  loadGallerySet,
  nextGrade,
  planFor,
  saveGallerySummary,
  scoreOf,
  summaryFor,
} from "../core/gallery";
import { collectionSize, isSyncing, onCollectionChange, setSyncedAt, syncCollection, syncInfo } from "../core/galleryCollection";
import { gradeProgress } from "../core/galleryScore";
import { isRunning } from "../core/engine";
import { buildCriteria, normalizeFilter } from "../core/filters";
import { log } from "../core/logger";
import { searchConceptItems } from "../core/market";
import { getCoins, isPhone, pageGlobal, services } from "../core/page";
import { afterTax, formatCoins, toInt } from "../core/prices";
import { percentRange } from "../core/listing";
import { getSettings, setSetting } from "../core/settings";
import { cancelTask, currentTask, endTask } from "../core/tasks";
import { startToolTask } from "../core/toolTask";
import { plural, t } from "../i18n";
import { onPriceUpdate } from "../prices/priceService";
import { shortCoins } from "./cardPrices";
import { escapeHtml } from "./dom";

// Galerie FC 27 intégrée au web app : tuiles « Galerie » sur l'accueil et dans Club, puis écrans EA
// (titre et bouton retour du web app) : catégories → collections → collection.
// Collection : paliers D→S, vraies cartes EA des joueurs, cartes collectées d'après EA (synchro),
// liste prête dès l'ouverture (le moins cher au prix FUTBIN pour le palier suivant, tes cartes
// d'abord), achat par paliers de prix avec revente en option. Données et prix : FUTBIN ; logos,
// jetons et cartes : EA.

const TILE = "mb-gallery-tile";
const PAGE_SIZE = 42;
// Couleurs des paliers (FUTBIN).
const GRADE_COLORS = { D: "#c27950", C: "#b0c7c9", B: "#e4cb81", A: "#03e0e1", S: "#915ade" };
// Catégories FUTBIN → ligues EA (logo) : Premier League / WSL, LALIGA / Liga F, Bundesliga /
// Frauen-Bundesliga, Ligue 1 / Arkema, Serie A.
const CATEGORY_LEAGUES = { 1: [13, 2216], 7: [53, 2222], 2: [19, 2215], 3: [16, 2218], 4: [31] };
// Une collection est resynchronisée à l'ouverture si sa dernière synchro date de plus de 30 min.
const SET_SYNC_AGE = 30 * 60 * 1000;

// ------------------------------------------------------------ icônes

const svg = (body, cls = "") => `<svg class="mb-gx-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON_GALLERY = svg('<path d="M2 7v10"/><path d="M6 5v14"/><rect width="12" height="18" x="10" y="3" rx="2"/>');
const ICON_GEM = `<svg class="mb-gx-ico is-gem" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 12L2 9z" fill="currentColor" opacity=".3"/><path d="M6 3h12l4 6-10 12L2 9zm0 0 6 18M18 3l-6 18M2 9h20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const ICON_TOKEN = `<svg class="mb-gx-ico is-token" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="currentColor" opacity=".25"/><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 6.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L12 15.1 8.6 16.9l.7-3.8-2.8-2.6 3.8-.5z" fill="currentColor"/></svg>`;
const ICON_COIN = `<svg class="mb-gx-ico is-coin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#e9c46a"/><circle cx="12" cy="12" r="6.2" fill="none" stroke="#a8791c" stroke-width="1.6"/></svg>`;
const ICON_SET = svg('<path d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6z"/>');
const ICON_SYNC = svg('<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>');
const ICON_MORE = svg('<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>');
const ICON_CHECK = svg('<path d="M20 6 9 17l-5-5"/>');
// Emblème de la tuile d'accueil (trait blanc comme les emblèmes EA) : trois cartes en éventail, gemme.
const CARD_PATH = "M6 8C6 4.7 8.7 2 12 2h8.5c1.6-1.3 4.6-2 7.5-2s5.9.7 7.5 2H44c3.3 0 6 2.7 6 6v56c0 3.6-2.4 6.2-6 7.2L28 78l-16-6.8C8.4 70.2 6 67.6 6 64z";
const TILE_ART = `<svg class="mb-gx-home-emblem" viewBox="24 10 92 90" aria-hidden="true" fill="none" stroke="#fcfcfc" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">
  <path d="${CARD_PATH}" transform="rotate(-15 70 96) translate(42 18)" opacity=".7"/>
  <path d="${CARD_PATH}" transform="rotate(15 70 96) translate(42 18)" opacity=".7"/>
  <path d="${CARD_PATH}" transform="translate(42 14)" fill="rgba(20,24,32,.92)"/>
  <g transform="translate(54.4 34.4) scale(1.3)" stroke-width="2"><path d="M6 3h12l4 6-10 12L2 9z" fill="rgba(158,255,198,.18)"/><path d="M6 3l6 18M18 3l-6 18M2 9h20"/></g>
</svg>`;

// ------------------------------------------------------------ navigation EA

const navigationController = () => {
  try {
    return pageGlobal("getAppMain")()
      .getRootViewController()
      .getPresentedViewController()
      .getCurrentViewController()
      .getCurrentController()
      .getNavigationController();
  } catch (e) {
    return null;
  }
};

let ScreenController = null;

// Contrôleur EA générique : vue vide dans laquelle l'écran (objet screen) dessine son contenu.
const screenControllerClass = () => {
  if (ScreenController) {
    return ScreenController;
  }
  const EAView = pageGlobal("EAView");
  const EAViewController = pageGlobal("EAViewController");
  if (typeof EAView !== "function" || typeof EAViewController !== "function") {
    return null;
  }
  class MbScreenView extends EAView {
    _generate() {
      if (!this.__root) {
        const root = document.createElement("div");
        root.className = "mb-gx";
        this.__root = root;
        this._generated = true;
      }
      return this.__root;
    }

    getRootElement() {
      return this.__root || this._generate();
    }

    destroyGeneratedElements() {
      if (this.__root && this.__root.parentNode) {
        this.__root.parentNode.removeChild(this.__root);
      }
      this.__root = null;
      this._generated = false;
    }
  }
  class MbScreenController extends EAViewController {
    constructor(screen) {
      super();
      this.mbScreen = screen;
    }

    _getViewInstanceFromData() {
      return new MbScreenView();
    }

    getNavigationTitle() {
      return this.mbScreen.title();
    }

    viewDidAppear() {
      try {
        this.getNavigationController().setNavigationVisibility(true, true);
      } catch (e) {}
      const view = this.getView();
      const root = view && view.getRootElement();
      if (root) {
        this.mbScreen.mount(root);
      }
    }

    viewWillDisappear() {
      this.mbScreen.unmount();
      super.viewWillDisappear();
    }
  }
  ScreenController = MbScreenController;
  return ScreenController;
};

const pushScreen = (screen) => {
  const Controller = screenControllerClass();
  const nav = navigationController();
  if (!Controller || !nav) {
    return false;
  }
  const controller = new Controller(screen);
  try {
    controller.init();
  } catch (e) {}
  nav.pushViewController(controller);
  return true;
};

// Résultats du marché EA pour une carte précise (comme la recherche du web app, une requête).
const openMarket = (definitionId) => {
  const nav = navigationController();
  const Split = pageGlobal("UTMarketSearchResultsSplitViewController");
  const Single = pageGlobal("UTMarketSearchResultsViewController");
  const Controller = !isPhone() && typeof Split === "function" ? Split : Single;
  if (!nav || typeof Controller !== "function" || !definitionId) {
    return false;
  }
  try {
    const criteria = buildCriteria(normalizeFilter({ name: "", definitionId }), {});
    const svc = services();
    if (svc && svc.Item && typeof svc.Item.clearTransferMarketCache === "function") {
      svc.Item.clearTransferMarketCache();
    }
    const controller = new Controller();
    controller.initWithSearchCriteria(criteria);
    nav.pushViewController(controller, true);
    return true;
  } catch (e) {
    return false;
  }
};

// Champ de saisie de l'écran qui a le focus : retrouvé après un nouveau rendu par son attribut data-gx-*.
const FOCUS_ATTRS = ["data-gx-filter", "data-gx-dlg", "data-gx-dlg-price", "data-gx-search"];

const focusOf = (root) => {
  const active = document.activeElement;
  if (!active || !root.contains(active) || active.tagName !== "INPUT") {
    return null;
  }
  const attr = FOCUS_ATTRS.find((name) => active.hasAttribute(name));
  if (!attr) {
    return null;
  }
  let start = null;
  let end = null;
  try {
    start = active.selectionStart;
    end = active.selectionEnd;
  } catch (e) {}
  return { attr, value: active.getAttribute(attr), start, end };
};

const restoreFocus = (root, focus) => {
  if (!focus) {
    return;
  }
  const target = Array.from(root.querySelectorAll(`[${focus.attr}]`)).find((el) => el.getAttribute(focus.attr) === focus.value);
  if (!target) {
    return;
  }
  target.focus();
  try {
    if (focus.start != null) {
      target.setSelectionRange(focus.start, focus.end);
    }
  } catch (e) {}
};

// Écran : { title(), render(screen), afterPaint(screen), onClick/onChange/onInput(event, screen) }.
const makeScreen = (spec) => {
  const screen = Object.assign({ root: null, mounted: false, timer: null, offs: [] }, spec);
  const click = (event) => screen.onClick && screen.onClick(event, screen);
  const change = (event) => screen.onChange && screen.onChange(event, screen);
  const input = (event) => screen.onInput && screen.onInput(event, screen);
  screen.mount = (root) => {
    if (screen.root !== root) {
      if (screen.root) {
        screen.root.removeEventListener("click", click);
        screen.root.removeEventListener("change", change);
        screen.root.removeEventListener("input", input);
      }
      screen.root = root;
      root.addEventListener("click", click);
      root.addEventListener("change", change);
      root.addEventListener("input", input);
    }
    screen.mounted = true;
    screen.paint();
    if (screen.onMount) {
      screen.onMount(screen);
    }
    if (!screen.offs.length) {
      // Prix, collection et synchro mis à jour : nouveau rendu groupé.
      if (screen.onPrices) {
        screen.offs.push(onPriceUpdate(() => screen.schedule()));
      }
      screen.offs.push(onCollectionChange(() => (screen.onCollection ? screen.onCollection(screen) : screen.schedule())));
      screen.offs.push(onSyncChange(() => (screen.onSync ? screen.onSync(screen) : screen.schedule())));
    }
  };
  screen.unmount = () => {
    screen.mounted = false;
    clearTimeout(screen.timer);
    screen.timer = null;
    screen.offs.splice(0).forEach((off) => off());
  };
  screen.paint = () => {
    if (!screen.mounted || !screen.root) {
      return;
    }
    // Position de défilement et champ en cours de saisie (focus, curseur) gardés pendant les mises à jour.
    const parent = screen.root.parentElement;
    const own = screen.root.scrollTop;
    const outer = parent ? parent.scrollTop : 0;
    const focus = focusOf(screen.root);
    screen.root.innerHTML = screen.render(screen);
    fixImages(screen.root);
    if (screen.afterPaint) {
      screen.afterPaint(screen);
    }
    screen.root.scrollTop = own;
    if (parent) {
      parent.scrollTop = outer;
    }
    restoreFocus(screen.root, focus);
  };
  // Nouveau rendu groupé (mises à jour de prix, progression).
  screen.schedule = () => {
    if (!screen.timer) {
      screen.timer = setTimeout(() => {
        screen.timer = null;
        screen.paint();
      }, 600);
    }
  };
  return screen;
};

// ------------------------------------------------------------ images EA (logos, jetons)

const eaImage = (kind, id) => {
  try {
    const Assets = pageGlobal("AssetLocationUtils");
    const Theme = pageGlobal("UIThemeVariation");
    const dark = Theme ? Theme.DARK : undefined;
    if (!Assets || !id) {
      return "";
    }
    if (kind === "club") {
      return Assets.getBadgeImageUri(id, dark) || "";
    }
    if (kind === "league") {
      return Assets.getLeagueImageUri(id, dark) || "";
    }
    if (kind === "nation") {
      return Assets.getFlagImageUri(id) || "";
    }
  } catch (e) {}
  return "";
};

// Logo d'une collection FUTBIN (…/clubs/dark/243.png, …/league/…/53.png) → image EA équivalente.
const logoFromFutbin = (url) => {
  const match = String(url || "").match(/\/(clubs|league|nation)\/(?:dark\/|light\/)?(\d+)\.(?:png|webp)/);
  return match ? { kind: match[1] === "clubs" ? "club" : match[1], id: Number(match[2]) } : null;
};

const logoHtml = (logo, cls = "") => {
  const src = logo ? eaImage(logo.kind, logo.id) : "";
  return src
    ? `<span class="mb-gx-logo ${cls}"><img src="${escapeHtml(src)}" alt="" loading="lazy" data-gx-img></span>`
    : `<span class="mb-gx-logo is-empty ${cls}">${ICON_SET}</span>`;
};

// Image introuvable : remplacée par l'icône (pas d'attribut onerror : politique de sécurité EA).
const fixImages = (root) => {
  root.querySelectorAll("img[data-gx-img]").forEach((img) => {
    img.removeAttribute("data-gx-img");
    img.addEventListener(
      "error",
      () => {
        const box = img.parentElement;
        if (box && box.classList.contains("mb-gx-logo")) {
          box.classList.add("is-empty");
          box.innerHTML = ICON_SET;
        } else {
          img.replaceWith(document.createRange().createContextualFragment(ICON_TOKEN));
        }
      },
      { once: true }
    );
  });
};

// Icône EA du jeton de galerie (définitions EventToken chargées par le web app), sinon icône simple.
let tokenUri = null;
const galleryTokenUri = () => {
  if (tokenUri) {
    return tokenUri;
  }
  try {
    const svc = services();
    const repo = svc && svc.EventToken && svc.EventToken.repository;
    const definitions = (repo && repo._definitions) || [];
    const def = definitions.find(
      (entry) => entry && (/galler/i.test(String(entry.currencyName || "")) || /galer|galler/i.test(String(entry.displayName || "")))
    );
    const Assets = pageGlobal("AssetLocationUtils");
    const Variant = pageGlobal("EventTokenIconVariant");
    if (def && Assets && typeof Assets.getEventTokenIconUri === "function") {
      tokenUri = Assets.getEventTokenIconUri(def.assetId, Variant ? Variant.RENDERED : undefined) || "";
    }
  } catch (e) {}
  return tokenUri || "";
};

const tokenIcon = () => {
  const uri = galleryTokenUri();
  return uri ? `<img class="mb-gx-ico is-token-img" src="${escapeHtml(uri)}" alt="" data-gx-img>` : ICON_TOKEN;
};

// Jetons de galerie d'une collection (récompenses « 50 Gallery Token »…).
const tokenCount = (reward) => {
  const match = String(reward || "").match(/(\d[\d,.]*)\s*Gallery\s*Token/i);
  return match ? Number(match[1].replace(/[,.]/g, "")) || 0 : 0;
};

const tokensOf = (set) =>
  (set.tiers || []).reduce((total, tier) => total + (tier.rewards || []).reduce((sum, reward) => sum + tokenCount(reward), 0), 0);

const tokensHtml = (count) => (count ? `<span class="mb-gx-tokens" title="${escapeHtml(t("gallery.tokens"))}">${tokenIcon()}${formatCoins(count)}</span>` : "");

// ------------------------------------------------------------ cartes EA des joueurs

const conceptItems = new Map();
const cardViews = new Map();
const pendingCards = new Set();
let cardTimer = null;
const cardListeners = new Set();

// Carte concept affichée comme une vraie carte (sans le voile « concept ») : copie de l'objet.
const displayCopy = (item) => {
  try {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(item)), item);
    copy.concept = false;
    return copy;
  } catch (e) {
    return item;
  }
};

const createCardView = (item) => {
  const Factory = pageGlobal("UTItemViewFactory");
  if (!Factory || typeof Factory.createSmallItem !== "function") {
    return null;
  }
  try {
    const shown = displayCopy(item);
    const view = Factory.createSmallItem(shown);
    view.init();
    view.supportSecondaryViews = false;
    view.render(shown);
    return view;
  } catch (e) {
    return null;
  }
};

const cardRoot = (defId) => {
  const cached = cardViews.get(defId);
  if (cached) {
    return cached.getRootElement();
  }
  const item = conceptItems.get(defId);
  if (!item) {
    return null;
  }
  const view = createCardView(item);
  if (!view) {
    return null;
  }
  cardViews.set(defId, view);
  // Au plus 500 vues gardées (les plus anciennes sont libérées).
  if (cardViews.size > 500) {
    const [oldId, oldView] = cardViews.entries().next().value;
    cardViews.delete(oldId);
    try {
      oldView.dealloc();
    } catch (e) {}
  }
  return view.getRootElement();
};

// Cartes concept demandées à EA par lots (une requête pour les cartes affichées). Elles passent par
// la collection (isCollected) : afficher une collection la met déjà à jour pour ces cartes.
const requestCards = (ids) => {
  ids.forEach((id) => {
    if (!conceptItems.has(id)) {
      pendingCards.add(id);
    }
  });
  if (!pendingCards.size || cardTimer) {
    return;
  }
  cardTimer = setTimeout(async () => {
    const batch = Array.from(pendingCards).slice(0, 100);
    batch.forEach((id) => pendingCards.delete(id));
    let result = { ok: false, items: [] };
    try {
      result = await searchConceptItems(batch);
    } catch (e) {}
    result.items.forEach((item) => conceptItems.set(Number(item.definitionId), item));
    // Carte introuvable côté EA : repli texte (null), sans la redemander.
    batch.forEach((id) => {
      if (!conceptItems.has(id)) {
        conceptItems.set(id, null);
      }
    });
    cardTimer = null;
    cardListeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {}
    });
    if (pendingCards.size) {
      requestCards([]);
    }
  }, 250);
};

// Emplacements de cartes du rendu : vue EA si la carte est connue, sinon demande à EA.
const mountCards = (root) => {
  const missing = [];
  root.querySelectorAll("[data-gx-card]").forEach((slot) => {
    const id = Number(slot.dataset.gxCard);
    const card = cardRoot(id);
    if (card) {
      slot.classList.add("is-ready");
      slot.replaceChildren(card);
    } else if (!conceptItems.has(id)) {
      missing.push(id);
    } else {
      slot.classList.add("is-fallback");
    }
  });
  if (missing.length) {
    requestCards(missing);
  }
};

// ------------------------------------------------------------ synchro de la collection

const sync = { running: false, scope: "", setId: "", done: 0, total: 0, added: 0, message: "", kind: "" };
const syncListeners = new Set();

const onSyncChange = (fn) => {
  syncListeners.add(fn);
  return () => syncListeners.delete(fn);
};

const notifySync = () =>
  syncListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });

// Synchro complète (ids absent) ou d'une collection, sous verrou (jamais pendant le bot).
const runSync = async ({ ids = null, setId = "", quiet = false } = {}) => {
  if (sync.running || isSyncing()) {
    return null;
  }
  const { task, error } = startToolTask(t("gallery.taskSync"));
  if (!task) {
    if (!quiet) {
      Object.assign(sync, { message: error, kind: "warn" });
      notifySync();
    }
    return null;
  }
  Object.assign(sync, { running: true, scope: setId ? "set" : "all", setId: String(setId || ""), done: 0, total: ids ? ids.length : 0, added: 0, message: "", kind: "" });
  notifySync();
  let report = null;
  try {
    report = await syncCollection({
      ids,
      setId,
      token: task.token,
      onProgress: (progress) => {
        Object.assign(sync, progress);
        notifySync();
      },
    });
  } finally {
    endTask(task);
    sync.running = false;
  }
  if (report.ok) {
    sync.message = quiet && !report.added ? "" : plural(report.added, "gallery.syncDoneOne", "gallery.syncDoneMany");
    sync.kind = "ok";
    if (!setId) {
      log.success(plural(report.added, "gallery.syncDoneOne", "gallery.syncDoneMany"));
    }
  } else {
    sync.message = report.stopped || t("gallery.syncFailed", { error: report.error });
    sync.kind = "warn";
  }
  notifySync();
  return report;
};

// Temps écoulé lisible : « à l'instant », « il y a 5 min », « il y a 3 h », « il y a 2 j ».
const since = (timestamp) => {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return t("gallery.agoNow");
  }
  if (seconds < 3600) {
    return t("gallery.agoMinutes", { n: Math.round(seconds / 60) });
  }
  if (seconds < 86400) {
    return t("gallery.agoHours", { n: Math.round(seconds / 3600) });
  }
  return t("gallery.agoDays", { n: Math.round(seconds / 86400) });
};

// Bandeau de synchro : date, nombre de cartes, boutons (collection ouverte ou toute la galerie).
const syncBar = (setId = "", hasSetIds = false) => {
  if (sync.running) {
    const percent = sync.total ? Math.min(100, Math.round((sync.done / sync.total) * 100)) : 0;
    const text = t(sync.scope === "set" ? "gallery.syncingSet" : "gallery.syncingAll", {
      done: formatCoins(sync.done),
      total: formatCoins(sync.total),
      added: formatCoins(sync.added),
    });
    return `<div class="mb-gx-sync is-running"><span class="mb-gx-spin"></span><span class="mb-gx-sync-text">${escapeHtml(text)}</span>
        <div class="mb-gx-progress"><div style="width:${percent}%"></div></div>
        <button type="button" class="mb-gx-button is-danger is-sm" data-gx="sync-stop">${t("gallery.stop")}</button></div>`;
  }
  const info = syncInfo();
  const at = setId ? setSyncedAt(setId) : info.syncedAt;
  const when = at ? t("gallery.lastSynced", { time: since(at) }) : t("gallery.neverSynced");
  return `<div class="mb-gx-sync"><span class="mb-gx-sync-text"><b>${formatCoins(collectionSize())}</b> ${escapeHtml(t("gallery.collectedCards"))} · <span class="mb-gx-muted">${escapeHtml(when)}</span></span>
      <span class="mb-gx-sync-actions">${
        setId && hasSetIds ? `<button type="button" class="mb-gx-button is-outline is-sm" data-gx="sync-set">${ICON_SYNC}${t("gallery.syncSet")}</button>` : ""
      }<button type="button" class="mb-gx-button is-ghost is-sm" data-gx="sync-all" title="${escapeHtml(t("gallery.syncAllHint"))}">${ICON_SYNC}${t("gallery.syncAll")}</button></span></div>
      ${!info.syncedAt && !setId ? `<p class="mb-gx-status" data-kind="info">${t("gallery.syncIntro")}</p>` : ""}
      ${sync.message ? `<p class="mb-gx-status" data-kind="${escapeHtml(sync.kind)}">${escapeHtml(sync.message)}</p>` : ""}`;
};

// Clic commun aux écrans : boutons de synchro.
const handleSyncClick = (event, ids, setId) => {
  const action = event.target.closest("[data-gx='sync-all'], [data-gx='sync-set'], [data-gx='sync-stop']");
  if (!action) {
    return false;
  }
  if (action.dataset.gx === "sync-stop") {
    cancelTask();
  } else if (action.dataset.gx === "sync-set") {
    runSync({ ids, setId });
  } else {
    runSync({});
  }
  return true;
};

// ------------------------------------------------------------ éléments communs

const statusLine = (state) =>
  state.message ? `<p class="mb-gx-status" data-kind="${escapeHtml(state.kind || "")}">${escapeHtml(state.message)}</p>` : "";

const skeletonGrid = (count, cls) => `<div class="mb-gx-grid ${cls}">${Array.from({ length: count }, () => '<div class="mb-gx-card is-skeleton"></div>').join("")}</div>`;

const loading = (text) => `<div class="mb-gx-loading"><span class="mb-gx-spin"></span>${escapeHtml(text)}</div>`;

// Barre de paliers D→S : un segment par palier (progression, losange avec la lettre, points requis).
const gradesBar = (tiers, score, big = false) => {
  const sorted = (tiers || []).slice().sort((a, b) => a.points - b.points);
  let previous = 0;
  let currentFound = false;
  const cells = sorted.map((tier) => {
    const span = Math.max(1, tier.points - previous);
    const progress = Math.max(0, Math.min(1, (score - previous) / span));
    const reached = score >= tier.points;
    const current = !reached && !currentFound;
    if (current) {
      currentFound = true;
    }
    previous = tier.points;
    const color = GRADE_COLORS[tier.grade] || "#9aa4ae";
    return `<div class="mb-gx-gb${reached ? " is-reached" : ""}${current ? " is-current" : ""}" style="--g:${color}" title="${escapeHtml((tier.rewards || []).join(" + "))}">
        <div class="mb-gx-gb-track"><div style="width:${Math.round(progress * 100)}%"></div></div>
        <span class="mb-gx-gb-badge"><i>${escapeHtml(tier.grade)}</i></span>
        <span class="mb-gx-gb-pts">${shortCoins(tier.points)}</span>
      </div>`;
  });
  return `<div class="mb-gx-grades${big ? " is-big" : ""}">${cells.join("")}</div>`;
};

// Pages numérotées : 1 … 4 5 6 … 12.
const pagerHtml = (page, pages) => {
  if (pages <= 1) {
    return "";
  }
  const shown = new Set([1, pages, page - 1, page, page + 1]);
  const parts = [];
  let last = 0;
  for (let n = 1; n <= pages; n += 1) {
    if (!shown.has(n)) {
      continue;
    }
    if (last && n - last > 1) {
      parts.push('<span class="mb-gx-ellipsis">…</span>');
    }
    parts.push(`<button type="button" class="mb-gx-page-btn${n === page ? " is-active" : ""}" data-gx-page="${n}">${n}</button>`);
    last = n;
  }
  return `<div class="mb-gx-pager"><button type="button" class="mb-gx-page-btn" data-gx-page="${page - 1}"${page <= 1 ? " disabled" : ""} aria-label="‹">‹</button>${parts.join("")}<button type="button" class="mb-gx-page-btn" data-gx-page="${page + 1}"${page >= pages ? " disabled" : ""} aria-label="›">›</button></div>`;
};

// ------------------------------------------------------------ écran 1 : catégories

const indexState = { data: null, loading: false, message: "", kind: "", details: new Map(), detailsLoading: false };

// Collections de chaque catégorie (jetons, logos) : lues une par une, en arrière-plan.
const loadDetails = async (screen) => {
  if (indexState.detailsLoading || !indexState.data) {
    return;
  }
  indexState.detailsLoading = true;
  for (const category of indexState.data.categories.filter((entry) => entry.id && !indexState.details.has(entry.id))) {
    if (!screen.mounted) {
      break;
    }
    const result = await loadGalleryIndex(category.url);
    if (result.ok) {
      indexState.details.set(category.id, result.sets);
      screen.schedule();
    }
  }
  indexState.detailsLoading = false;
};

const loadIndex = async (screen, force) => {
  if (indexState.loading || (indexState.data && !force)) {
    loadDetails(screen);
    return;
  }
  indexState.loading = true;
  indexState.message = "";
  screen.paint();
  const result = await loadGalleryIndex("");
  indexState.loading = false;
  if (result.ok) {
    indexState.data = { categories: result.categories, sets: result.sets };
  } else {
    indexState.message = result.blocked ? t("gallery.blocked") : t("gallery.loadFailed");
    indexState.kind = "warn";
  }
  screen.paint();
  loadDetails(screen);
};

// Progression d'une catégorie : collections déjà ouvertes, cartes collectées parmi leurs joueurs.
const categoryProgress = (sets) => {
  if (!sets) {
    return null;
  }
  let tracked = 0;
  let owned = 0;
  sets.forEach((set) => {
    const estimate = estimateSet(set.id);
    if (estimate) {
      tracked += 1;
      owned += estimate.owned;
    }
  });
  return tracked ? { tracked, owned } : null;
};

const categoryCard = (category, sets, all) => {
  const logos = all
    ? `<span class="mb-gx-logo is-icon">${ICON_GALLERY}</span>`
    : (CATEGORY_LEAGUES[category.id] || []).length
    ? CATEGORY_LEAGUES[category.id].map((id) => logoHtml({ kind: "league", id })).join("")
    : (sets || [])
        .slice(0, 3)
        .map((set) => logoHtml(logoFromFutbin(set.logo)))
        .join("") || `<span class="mb-gx-logo is-icon">${ICON_GALLERY}</span>`;
  const tokens = sets ? sets.reduce((total, set) => total + tokensOf(set), 0) : 0;
  const progress = categoryProgress(sets);
  return `<button type="button" class="mb-gx-card mb-gx-cat" data-gx-category="${escapeHtml(category.url)}" data-gx-name="${escapeHtml(category.name)}">
      <div class="mb-gx-cat-top"><span class="mb-gx-logos">${logos}</span>
        <span class="mb-gx-cat-meta">${tokensHtml(tokens)}<span class="mb-gx-pill">${plural(category.count, "gallery.setsOne", "gallery.setsMany")}</span></span></div>
      <div class="mb-gx-cat-name">${escapeHtml(category.name)}</div>
      ${progress ? `<div class="mb-gx-cat-progress mb-gx-muted">${t("gallery.categoryProgress", { owned: formatCoins(progress.owned), sets: progress.tracked })}</div>` : ""}
    </button>`;
};

const indexScreen = () =>
  makeScreen({
    title: () => t("gallery.tab"),
    render: () => {
      if (indexState.loading && !indexState.data) {
        return `<div class="mb-gx-page">${syncBar()}${skeletonGrid(6, "is-cats")}</div>`;
      }
      if (!indexState.data) {
        return `<div class="mb-gx-page"><div class="mb-gx-card mb-gx-empty">${ICON_GALLERY}<p>${t("gallery.intro")}</p>
          <button type="button" class="mb-gx-button" data-gx="reload">${t("gallery.load")}</button>${statusLine(indexState)}</div></div>`;
      }
      const data = indexState.data;
      const all = { id: 0, name: t("gallery.allCategories"), count: data.sets.length, url: "" };
      return `<div class="mb-gx-page">
          ${syncBar()}
          <div class="mb-gx-topbar"><span class="mb-gx-muted">${t("gallery.source")}</span>
            <button type="button" class="mb-gx-button is-ghost is-sm" data-gx="reload">${t("gallery.reload")}</button></div>
          ${statusLine(indexState)}
          <div class="mb-gx-grid is-cats">${categoryCard(all, data.sets, true)}${data.categories
            .filter((category) => category.id)
            .map((category) => categoryCard(category, indexState.details.get(category.id), false))
            .join("")}</div>
        </div>`;
    },
    onMount: (screen) => loadIndex(screen, false),
    onClick: (event, screen) => {
      if (handleSyncClick(event, null, "")) {
        return;
      }
      const card = event.target.closest("[data-gx-category]");
      if (card) {
        pushScreen(categoryScreen(card.dataset.gxCategory, card.dataset.gxName));
        return;
      }
      if (event.target.closest("[data-gx='reload']")) {
        indexState.details.clear();
        loadIndex(screen, true);
      }
    },
  });

// ------------------------------------------------------------ écran 2 : collections

const logoKey = (logo) => (logo ? `${logo.kind}:${logo.id}` : "");
const parseLogoKey = (key) => {
  const [kind, id] = String(key || "").split(":");
  return kind && Number(id) ? { kind, id: Number(id) } : null;
};

const setCard = (set) => {
  const estimate = estimateSet(set.id);
  const score = estimate ? estimate.total : 0;
  return `<div class="mb-gx-card mb-gx-set" data-gx-set="${escapeHtml(set.url)}" data-gx-name="${escapeHtml(set.name)}" data-gx-logo="${escapeHtml(logoKey(logoFromFutbin(set.logo)))}" role="button" tabindex="0">
      <div class="mb-gx-card-head">${logoHtml(logoFromFutbin(set.logo))}<span class="mb-gx-card-title">${escapeHtml(set.name)}</span>
        <span class="mb-gx-muted mb-gx-small">${t("gallery.players", { n: formatCoins(set.players) })}</span></div>
      <div class="mb-gx-card-body">
        ${gradesBar(set.tiers, score)}
        <div class="mb-gx-sep"></div>
        <div class="mb-gx-row">
          <span class="mb-gx-row-left">${
            estimate
              ? `<span class="mb-gx-pill is-collected">${ICON_CHECK}${t("gallery.collectedOf", { n: formatCoins(estimate.owned), total: formatCoins(set.players || estimate.players) })}</span><span class="mb-gx-muted" title="${escapeHtml(t("gallery.estimateHint"))}">${t("gallery.baseScore")} <b>${formatCoins(score)}</b></span>`
              : `<span class="mb-gx-muted">${t("gallery.openToTrack")}</span>`
          }</span>
          ${tokensHtml(tokensOf(set))}
        </div>
        <button type="button" class="mb-gx-button is-outline is-sm mb-gx-view">${t("gallery.viewPlayers")}</button>
      </div>
    </div>`;
};

const categoryScreen = (url, name) => {
  const state = { sets: null, loading: false, message: "", kind: "", search: "" };
  const load = async (screen) => {
    if (state.loading || state.sets) {
      return;
    }
    state.loading = true;
    screen.paint();
    const result = await loadGalleryIndex(url);
    state.loading = false;
    if (result.ok) {
      state.sets = result.sets;
    } else {
      state.message = result.blocked ? t("gallery.blocked") : t("gallery.loadFailed");
      state.kind = "warn";
    }
    screen.paint();
  };
  const applySearch = (screen) => {
    const needle = state.search.trim().toLowerCase();
    screen.root.querySelectorAll("[data-gx-set]").forEach((card) => {
      card.hidden = !!needle && !card.dataset.gxName.toLowerCase().includes(needle);
    });
  };
  return makeScreen({
    title: () => name,
    render: () => {
      if (!state.sets) {
        return `<div class="mb-gx-page">${state.loading ? skeletonGrid(6, "is-sets") : statusLine(state)}</div>`;
      }
      return `<div class="mb-gx-page">
          ${syncBar()}
          <div class="mb-gx-topbar"><label class="mb-gx-search">${svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}
            <input data-gx-search placeholder="${escapeHtml(t("gallery.searchSets"))}" value="${escapeHtml(state.search)}" aria-label="${escapeHtml(t("gallery.searchSets"))}"/></label>
            <span class="mb-gx-muted">${plural(state.sets.length, "gallery.setsOne", "gallery.setsMany")}</span></div>
          ${statusLine(state)}
          <div class="mb-gx-grid is-sets">${state.sets.map(setCard).join("")}</div>
        </div>`;
    },
    afterPaint: (screen) => applySearch(screen),
    onMount: (screen) => load(screen),
    onClick: (event) => {
      if (handleSyncClick(event, null, "")) {
        return;
      }
      const card = event.target.closest("[data-gx-set]");
      if (card) {
        pushScreen(setScreen(card.dataset.gxSet, card.dataset.gxName, parseLogoKey(card.dataset.gxLogo)));
      }
    },
    onInput: (event, screen) => {
      if (event.target.matches("[data-gx-search]")) {
        state.search = event.target.value;
        applySearch(screen);
      }
    },
  });
};

// ------------------------------------------------------------ écran 3 : collection

const setScreen = (url, name, logo) => {
  const state = {
    set: null,
    candidates: [],
    grade: "",
    selection: new Set(),
    buying: new Map(),
    phase: "loading",
    message: "",
    kind: "",
    tab: "list",
    page: 1,
    logo: logo || null,
    filters: { min: "", max: "", rewards: true },
    rewardConfirm: "",
    dialog: null,
  };

  const setId = () => (state.set && state.set.id) || (url.match(/\/set\/(\d+)\//) || [])[1] || url;
  const eligibleIds = () => (state.set ? state.set.items.map((item) => item.eaId).filter(Boolean) : []);
  const selection = () => state.candidates.filter((item) => state.selection.has(item.key));
  const toBuy = () => selection().filter((item) => !item.owned);
  const setStatus = (screen, message, kind = "") => {
    state.message = message || "";
    state.kind = kind;
    screen.paint();
  };

  // Liste prête : le moins cher pour le palier choisi (cartes à toi d'abord).
  const plan = () => {
    state.candidates.forEach((item) => {
      item.price = item.owned ? 0 : itemPrice(item);
    });
    const result = planFor(state.set, state.candidates, galleryTargetPoints(state.set, state.grade));
    state.selection = new Set(result.selection.map((item) => item.key));
    return result;
  };

  const planMessage = (result) =>
    result.reached
      ? plural(result.toBuy.length, "gallery.readyOne", "gallery.readyMany", { grade: state.grade, cost: formatCoins(result.cost) })
      : t("gallery.planShort", { grade: state.grade, total: formatCoins(result.score.total), target: formatCoins(galleryTargetPoints(state.set, state.grade)) });

  // Progression affichée sur la carte de la collection (estimation recalculée avec la collection).
  const summarize = () => {
    const mine = nextGrade(state.set, state.candidates);
    const progress = gradeProgress(state.set.tiers, mine.total);
    saveGallerySummary(setId(), summaryFor(state.set, { total: mine.total, grade: progress.current ? progress.current.grade : "" }));
  };

  // Cartes collectées (EA) appliquées au plan. keep : la liste choisie et le palier visé sont gardés
  // (retour sur l'écran, cartes collectées vues au passage) ; sinon nouvelle liste prête.
  const refreshOwned = (screen, keep) => {
    const before = state.candidates.filter((item) => item.owned).length;
    state.candidates = candidatesFor(state.set, null);
    const changed = state.candidates.filter((item) => item.owned).length !== before;
    const next = nextGrade(state.set, state.candidates);
    if (!keep || !state.grade) {
      state.grade = next.grade;
      const result = plan();
      if (!state.buying.size) {
        state.message = next.reachedAll ? t("gallery.allReached") : planMessage(result);
        state.kind = result.reached || next.reachedAll ? "ok" : "warn";
      }
    }
    if (changed || !keep) {
      summarize();
    }
    if (screen && changed) {
      screen.schedule();
    }
  };

  const open = async (screen) => {
    state.phase = "loading";
    screen.paint();
    const result = await loadGallerySet(url, { onProgress: (done, total) => setStatus(screen, t("gallery.loadingPages", { done, total })) });
    if (!result.ok) {
      state.phase = "error";
      setStatus(screen, result.blocked ? t("gallery.blocked") : t("gallery.loadFailed"), "warn");
      return;
    }
    state.set = Object.assign({ id: (url.match(/\/set\/(\d+)\//) || [])[1] }, result.set);
    state.phase = "ready";
    refreshOwned(null, false);
    screen.paint();
    // Collection pas synchronisée récemment : synchro rapide de ses joueurs (1 à 2 requêtes EA).
    if (Date.now() - setSyncedAt(setId()) > SET_SYNC_AGE && !isRunning() && !currentTask()) {
      const report = await runSync({ ids: eligibleIds(), setId: setId(), quiet: true });
      if (report && screen.mounted) {
        refreshOwned(screen, false);
        screen.paint();
      }
    }
  };

  // ---------------------------------------------- fenêtre d'achat

  const openDialog = (screen, items, mode) => {
    const settings = galleryBuySettings();
    state.dialog = {
      keys: items.map((item) => item.key),
      prices: new Map(items.map((item) => [item.key, item.price ? String(item.price) : ""])),
      range: `${settings.range.min}-${settings.range.max}`,
      retries: settings.retries,
      wait: settings.wait,
      mode: mode || settings.sellMode,
      sellPercent: (getSettings().gallery || {}).sellPercent || "100",
      error: "",
    };
    screen.paint();
  };

  const dialogItems = () => state.dialog.keys.map((key) => state.candidates.find((item) => item.key === key)).filter(Boolean);

  const dialogLadder = (item) => {
    const dialog = state.dialog;
    const typed = toInt(dialog.prices.get(item.key));
    const range = percentRange(dialog.range || "85-100");
    const retries = Math.max(1, Math.min(5, toInt(dialog.retries) || 1));
    const manual = typed && typed !== item.price;
    return manual || !item.price
      ? buildLadder(typed, { range: { min: range.min, max: 100 }, retries })
      : buildLadder(item.price, { range, retries });
  };

  const dialogBudget = () => dialogItems().reduce((total, item) => {
    const ladder = dialogLadder(item);
    return total + (ladder.length ? ladder[ladder.length - 1] : 0);
  }, 0);

  const dialogHtml = () => {
    const dialog = state.dialog;
    const items = dialogItems();
    const coins = getCoins();
    const budget = dialogBudget();
    const rows = items
      .map((item) => {
        const ladder = dialogLadder(item);
        return `<tr data-gx-row="${escapeHtml(String(item.key))}">
            <td><b>${escapeHtml(item.name || item.fullName)}</b> <span class="mb-gx-muted">${item.rating || ""}</span>${isOffMarket(item) ? ` <span class="mb-gx-badge is-reward">${t("gallery.reward")}</span>` : ""}</td>
            <td>${item.price ? formatCoins(item.price) : "—"}</td>
            <td><input class="mb-gx-input" inputmode="numeric" data-gx-dlg-price="${escapeHtml(String(item.key))}" value="${escapeHtml(dialog.prices.get(item.key) || "")}" placeholder="${escapeHtml(t("gallery.dlgPricePlaceholder"))}"></td>
            <td class="mb-gx-ladder" data-gx-ladder="${escapeHtml(String(item.key))}">${ladder.length ? ladder.map(formatCoins).join(" → ") : `<span class="mb-gx-warn">${t("gallery.noPrice")}</span>`}</td>
          </tr>`;
      })
      .join("");
    const option = (value, label) => `<option value="${value}"${dialog.mode === value ? " selected" : ""}>${escapeHtml(label)}</option>`;
    return `<div class="mb-gx-modal" data-gx-modal><div class="mb-gx-modal-card" role="dialog" aria-modal="true">
        <h3>${plural(items.length, "gallery.dlgTitleOne", "gallery.dlgTitleMany")}</h3>
        <div class="mb-gx-modal-grid">
          <label>${t("gallery.dlgRange")}<input class="mb-gx-input" data-gx-dlg="range" value="${escapeHtml(dialog.range)}" placeholder="85-100"></label>
          <label>${t("gallery.dlgRetries")}<input class="mb-gx-input" type="number" min="1" max="5" data-gx-dlg="retries" value="${escapeHtml(String(dialog.retries))}"></label>
          <label>${t("gallery.dlgWait")}<input class="mb-gx-input" data-gx-dlg="wait" value="${escapeHtml(dialog.wait)}" placeholder="2-4"></label>
          <label>${t("gallery.dlgAfter")}<select class="mb-gx-input" data-gx-dlg="mode">${option("keep", t("gallery.dlgKeep"))}${option("same", t("gallery.dlgSame"))}${option("percent", t("gallery.dlgPercent"))}</select></label>
          ${dialog.mode === "percent" ? `<label>${t("gallery.dlgSellPercent")}<input class="mb-gx-input" data-gx-dlg="sellPercent" value="${escapeHtml(dialog.sellPercent)}" placeholder="100"></label>` : ""}
        </div>
        <div class="mb-gx-table-wrap"><table class="mb-gx-table"><thead><tr><th>${t("gallery.dlgPlayer")}</th><th>FUTBIN</th><th>${t("gallery.dlgReference")}</th><th>${t("gallery.dlgLadder")}</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="mb-gx-modal-total" data-gx-budget>${t("gallery.dlgBudget", { cost: formatCoins(budget), coins: formatCoins(coins) })}</p>
        ${dialog.mode === "same" ? `<p class="mb-gx-muted mb-gx-small">${t("gallery.resellHint", { tax: formatCoins(Math.round(budget * 0.05)) })}</p>` : ""}
        <p class="mb-gx-risk">${t("gallery.dlgRisk")}</p>
        ${dialog.error ? `<p class="mb-gx-status" data-kind="warn">${escapeHtml(dialog.error)}</p>` : ""}
        <div class="mb-gx-modal-actions">
          <button type="button" class="mb-gx-button is-ghost" data-gx="dlg-cancel">${t("gallery.cancel")}</button>
          <button type="button" class="mb-gx-button" data-gx="dlg-confirm">${t("gallery.dlgConfirm")}</button>
        </div>
      </div></div>`;
  };

  // Champs de la fenêtre modifiés : paliers et budget recalculés sans redessiner (focus gardé).
  const refreshDialog = (screen) => {
    dialogItems().forEach((item) => {
      const cell = screen.root.querySelector(`[data-gx-ladder="${CSS.escape(String(item.key))}"]`);
      if (cell) {
        const ladder = dialogLadder(item);
        cell.innerHTML = ladder.length ? ladder.map(formatCoins).join(" → ") : `<span class="mb-gx-warn">${t("gallery.noPrice")}</span>`;
      }
    });
    const budget = screen.root.querySelector("[data-gx-budget]");
    if (budget) {
      budget.textContent = t("gallery.dlgBudget", { cost: formatCoins(dialogBudget()), coins: formatCoins(getCoins()) });
    }
  };

  const confirmDialog = (screen) => {
    const dialog = state.dialog;
    const items = dialogItems();
    if (!items.length) {
      state.dialog = null;
      screen.paint();
      return;
    }
    const range = percentRange(dialog.range || "85-100");
    setSetting("gallery.buyRange", `${range.min}-${range.max}`);
    setSetting("gallery.retries", Math.max(1, Math.min(5, toInt(dialog.retries) || 3)));
    setSetting("gallery.wait", String(dialog.wait || "2-4"));
    setSetting("gallery.sellMode", dialog.mode);
    setSetting("gallery.sellPercent", String(dialog.sellPercent || "100"));
    const prepared = items.map((item) => {
      const typed = toInt(dialog.prices.get(item.key));
      return Object.assign({}, item, { maxPrice: typed && (typed !== item.price || !item.price) ? typed : 0 });
    });
    const coins = getCoins();
    const budget = dialogBudget();
    if (coins && budget > coins) {
      dialog.error = t("gallery.notEnoughCoins", { cost: formatCoins(budget), coins: formatCoins(coins) });
      screen.paint();
      return;
    }
    state.dialog = null;
    buy(screen, prepared, {
      buy: { range, retries: Math.max(1, Math.min(5, toInt(dialog.retries) || 3)), wait: dialog.wait || "2-4" },
      sell: { mode: dialog.mode, percent: percentRange(dialog.sellPercent || "100") },
    });
  };

  const buy = async (screen, items, options) => {
    if (!items.length) {
      return;
    }
    const { task, error } = startToolTask(t("gallery.taskBuy"));
    if (!task) {
      setStatus(screen, error, "warn");
      return;
    }
    items.forEach((item) => state.buying.set(item.key, { state: "waiting", note: "" }));
    setStatus(screen, plural(items.length, "gallery.buyingOne", "gallery.buyingMany"));
    log.info(plural(items.length, "gallery.logBuyStartOne", "gallery.logBuyStartMany", { name: state.set.title || name }));
    let report = { bought: 0, spent: 0, failed: 0, listed: 0, stopped: "" };
    try {
      report = await buyGalleryPlayers(items, {
        token: task.token,
        buy: options.buy,
        sell: options.sell,
        onUpdate: (item, phase, note) => {
          state.buying.set(item.key, { state: phase, note });
          if (phase === "bought" || phase === "listed") {
            const candidate = state.candidates.find((entry) => entry.key === item.key);
            if (candidate) {
              candidate.owned = true;
              candidate.source = phase === "listed" ? "collection" : "club";
            }
          }
          screen.schedule();
        },
      });
    } catch (e) {
      report.stopped = String((e && e.message) || e);
    } finally {
      endTask(task);
    }
    summarize();
    const text =
      t("gallery.reportBought", { n: report.bought, spent: formatCoins(report.spent) }) +
      (report.listed ? ` · ${t("gallery.reportListed", { n: report.listed })}` : "") +
      (report.failed ? ` · ${t("gallery.reportFailed", { n: report.failed })}` : "") +
      (report.stopped ? ` · ${report.stopped}` : "");
    log.info(text);
    setStatus(screen, text, report.failed || report.stopped ? "warn" : "ok");
  };

  // ---------------------------------------------- rendu

  // Carte d'un joueur : vraie carte EA (clic = marché EA), nom, points, prix FUTBIN, état, actions.
  const playerCard = (item) => {
    const inList = state.selection.has(item.key);
    const buying = state.buying.get(item.key);
    const reward = !item.owned && isOffMarket(item);
    let footer;
    if (buying) {
      footer = `<span class="mb-gx-badge is-${escapeHtml(buying.state)}" title="${escapeHtml(buying.note || "")}">${escapeHtml(t(`gallery.state_${buying.state}`))}</span>`;
    } else if (item.owned) {
      footer = `<span class="mb-gx-badge is-owned" title="${escapeHtml(t("gallery.collectedBadge"))}">${ICON_CHECK}${escapeHtml(t(`gallery.owned_${item.source || "collection"}`))}</span>`;
    } else if (reward && state.rewardConfirm !== String(item.key) && !inList) {
      footer = `<button type="button" class="mb-gx-button is-sm is-reward" data-gx-reward="${escapeHtml(String(item.key))}" title="${escapeHtml(t("gallery.rewardHint"))}">${t("gallery.add")}</button>`;
    } else {
      footer = `<button type="button" class="mb-gx-button is-sm ${inList ? "" : "is-outline"}" data-gx-pick="${escapeHtml(String(item.key))}">${t(inList ? "gallery.added" : reward ? "gallery.rewardConfirm" : "gallery.add")}</button>
        ${reward ? "" : `<button type="button" class="mb-gx-icon-button" data-gx-buy="${escapeHtml(String(item.key))}" title="${escapeHtml(t("gallery.buyNowHint", { price: formatCoins(item.price) }))}" aria-label="${escapeHtml(t("gallery.buyOne"))}">${ICON_COIN}</button>`}`;
    }
    return `<div class="mb-gx-card mb-gx-player${inList ? " is-selected" : ""}${item.owned ? " is-owned" : ""}">
        <div class="mb-gx-cardslot" data-gx-card="${item.eaId}" data-gx-market="${item.eaId}" title="${escapeHtml(t("gallery.openMarket"))}"><div class="mb-gx-fallback"><b>${item.rating || ""}</b><span>${escapeHtml(item.position || "")}</span></div></div>
        <div class="mb-gx-player-name" title="${escapeHtml(item.fullName || item.name)}">${escapeHtml(item.name || item.fullName)}${item.holo ? ` <span class="mb-gx-holo" title="${escapeHtml(t("gallery.holo"))}">✦</span>` : ""}</div>
        <div class="mb-gx-player-meta"><span class="mb-gx-gemval">${ICON_GEM}${formatCoins(item.points)}</span>${
          item.owned ? "" : item.price ? `<span class="mb-gx-price">${ICON_COIN}${shortCoins(item.price)}</span>` : `<span class="mb-gx-muted mb-gx-small">${t("gallery.offMarket")}</span>`
        }</div>
        <div class="mb-gx-player-actions">${footer}</div>
      </div>`;
  };

  const tabItems = () => {
    const value = (item) => (item.owned ? Infinity : item.price ? item.points / item.price : 0);
    if (state.tab === "list") {
      return selection().sort((a, b) => b.points - a.points);
    }
    if (state.tab === "owned") {
      return state.candidates.filter((item) => item.owned).sort((a, b) => b.points - a.points);
    }
    const min = toInt(state.filters.min);
    const max = toInt(state.filters.max);
    return state.candidates
      .filter((item) => !item.owned)
      .filter((item) => (state.filters.rewards || !isOffMarket(item)) && (!min || item.price >= min) && (!max || !item.price || item.price <= max))
      .sort((a, b) => value(b) - value(a) || b.points - a.points);
  };

  const filtersHtml = () =>
    state.tab !== "missing"
      ? ""
      : `<div class="mb-gx-filters">
          <label>${t("gallery.filterMin")}<input class="mb-gx-input" inputmode="numeric" data-gx-filter="min" value="${escapeHtml(state.filters.min)}" placeholder="—"></label>
          <label>${t("gallery.filterMax")}<input class="mb-gx-input" inputmode="numeric" data-gx-filter="max" value="${escapeHtml(state.filters.max)}" placeholder="—"></label>
          <label class="mb-gx-check"><input type="checkbox" data-gx-filter="rewards"${state.filters.rewards ? " checked" : ""}> ${t("gallery.filterRewards")}</label>
        </div>`;

  const render = () => {
    if (!state.set) {
      return state.phase === "error"
        ? `<div class="mb-gx-page">${statusLine(state)}</div>`
        : `<div class="mb-gx-page">${loading(state.message || t("gallery.loadingSet"))}${skeletonGrid(14, "is-players")}</div>`;
    }
    const set = state.set;
    const chosen = selection();
    const score = scoreOf(set, chosen, state.candidates);
    const progress = gradeProgress(set.tiers, score.total);
    const owned = state.candidates.filter((item) => item.owned);
    const mine = nextGrade(set, state.candidates);
    const buyList = toBuy();
    const cost = buyList.reduce((total, item) => total + (item.price || 0), 0);
    const tax = buyList.reduce((total, item) => total + ((item.price || 0) - afterTax(item.price || 0)), 0);
    const coins = getCoins();
    const busy = !!currentTask();
    const limit = (set.limit && set.limit.maxItems) || 20;
    const missingCount = state.candidates.length - owned.length;
    const items = tabItems();
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const page = Math.min(state.page, pages);
    const shown = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const tab = (id, label, count) =>
      `<button type="button" class="mb-gx-tab${state.tab === id ? " is-active" : ""}" data-gx-tab="${id}">${escapeHtml(label)} <span>${formatCoins(count)}</span></button>`;
    const actions = !buyList.length
      ? ""
      : `<button type="button" class="mb-gx-button is-outline" data-gx="resell"${busy ? " disabled" : ""} title="${escapeHtml(t("gallery.resellHint", { tax: formatCoins(tax) }))}">${t("gallery.buyResell")}</button>
         <button type="button" class="mb-gx-button" data-gx="buy"${busy ? " disabled" : ""}>${plural(buyList.length, "gallery.buyPlayersOne", "gallery.buyPlayersMany", { cost: shortCoins(cost) })}</button>`;
    return `<div class="mb-gx-page has-dock">
        <div class="mb-gx-head">${logoHtml(state.logo, "is-big")}
          <div class="mb-gx-head-text"><h2>${escapeHtml(set.title || name)}</h2>
            <div class="mb-gx-head-meta"><span class="mb-gx-pill is-collected">${ICON_CHECK}${t("gallery.collectedOf", { n: formatCoins(owned.length), total: formatCoins(set.totalItems || state.candidates.length) })}</span>
              <span class="mb-gx-muted">${t("gallery.baseScore")} <b>${formatCoins(mine.total)}</b></span>
              ${tokensHtml(tokensOf(set))}
              <a class="mb-gx-link" href="${escapeHtml(set.url)}" target="_blank" rel="noopener">FUTBIN ↗</a></div></div></div>
        ${syncBar(setId(), eligibleIds().length > 0)}
        <div class="mb-gx-card mb-gx-grades-card">
          ${gradesBar(set.tiers, score.total, true)}
          <div class="mb-gx-grades-note"><span>${t("gallery.listScore", { total: formatCoins(score.total), base: formatCoins(score.base), bonus: formatCoins(score.bonus) })}</span>
            <span>${progress.next ? t("gallery.pointsForGrade", { points: formatCoins(progress.remaining), grade: escapeHtml(progress.next.grade) }) : t("gallery.topGrade")}</span></div>
          <div class="mb-gx-tags">${score.tags
            .filter((entry) => entry.count > 0)
            .map(
              (entry) =>
                `<span class="mb-gx-tag${entry.bonus ? " is-on" : ""}" title="${escapeHtml((set.tags.find((spec) => spec.key === entry.key) || {}).description || "")}">${escapeHtml(entry.name)} · ${entry.count}${
                  entry.tier ? ` · ${escapeHtml(entry.tier.text)}` : entry.next ? ` → ${entry.next.count} ${escapeHtml(entry.next.text)}` : ""
                }</span>`
            )
            .join("")}</div>
        </div>
        ${statusLine(state)}
        ${set.complete === false ? `<p class="mb-gx-status" data-kind="info">${t("gallery.partialSet", { n: formatCoins(state.candidates.length), total: formatCoins(set.totalItems || 0) })}</p>` : ""}
        ${coins && cost > coins ? `<p class="mb-gx-status" data-kind="warn">${t("gallery.notEnoughCoins", { cost: formatCoins(cost), coins: formatCoins(coins) })}</p>` : ""}
        <div class="mb-gx-toolbar">
          <div class="mb-gx-tabs">${tab("list", t("gallery.tabList"), chosen.length)}${tab("missing", t("gallery.missing"), missingCount)}${tab("owned", t("gallery.tabCollected"), owned.length)}</div>
          <label class="mb-gx-target"><span>${t("gallery.target")}</span>
            <select data-gx-grade>${set.tiers
              .slice()
              .sort((a, b) => a.points - b.points)
              .map((tier) => `<option value="${escapeHtml(tier.grade)}"${tier.grade === state.grade ? " selected" : ""}>${escapeHtml(tier.grade)} · ${formatCoins(tier.points)}</option>`)
              .join("")}</select></label>
        </div>
        ${filtersHtml()}
        ${shown.length ? `<div class="mb-gx-grid is-players">${shown.map(playerCard).join("")}</div>` : `<p class="mb-gx-muted mb-gx-empty-line">${t("gallery.noPlayers")}</p>`}
        ${pagerHtml(page, pages)}
        <div class="mb-gx-dock">
          <span class="mb-gx-dock-text">${t("gallery.dockLine", { n: chosen.length, limit, buy: buyList.length, cost: formatCoins(cost) })}</span>
          <span class="mb-gx-dock-actions">${actions}${busy ? `<button type="button" class="mb-gx-button is-danger" data-gx="stop">${t("gallery.stop")}</button>` : ""}</span>
        </div>
        ${state.dialog ? dialogHtml() : ""}
      </div>`;
  };

  let offCards = null;
  const screen = makeScreen({
    title: () => name,
    render,
    onPrices: true,
    onCollection: (self) => {
      if (state.set && !sync.running) {
        refreshOwned(self, true);
      } else {
        self.schedule();
      }
    },
    // Fin d'une synchro (bouton ou automatique) : cartes collectées appliquées, liste gardée.
    onSync: (self) => {
      if (state.set && !sync.running) {
        refreshOwned(self, true);
      }
      self.schedule();
    },
    afterPaint: (self) => mountCards(self.root),
    onMount: (self) => {
      if (!offCards) {
        const onCards = () => self.mounted && mountCards(self.root);
        cardListeners.add(onCards);
        offCards = () => cardListeners.delete(onCards);
      }
      if (!state.set && state.phase === "loading" && !state.started) {
        state.started = true;
        open(self);
      } else if (state.set) {
        refreshOwned(self, true);
      }
    },
    onChange: (event, self) => {
      if (event.target.matches("[data-gx-grade]")) {
        state.grade = event.target.value;
        const result = plan();
        state.message = planMessage(result);
        state.kind = result.reached ? "ok" : "warn";
        state.tab = "list";
        state.page = 1;
        self.paint();
        return;
      }
      if (event.target.matches("[data-gx-filter='rewards']")) {
        state.filters.rewards = event.target.checked;
        state.page = 1;
        self.paint();
        return;
      }
      if (event.target.matches("[data-gx-dlg='mode']") && state.dialog) {
        state.dialog.mode = event.target.value;
        event.target.blur();
        self.paint();
      }
    },
    onInput: (event, self) => {
      const filter = event.target.closest("[data-gx-filter]");
      if (filter && filter.dataset.gxFilter !== "rewards") {
        state.filters[filter.dataset.gxFilter] = event.target.value;
        state.page = 1;
        self.schedule();
        return;
      }
      if (!state.dialog) {
        return;
      }
      const field = event.target.closest("[data-gx-dlg]");
      if (field) {
        state.dialog[field.dataset.gxDlg] = event.target.value;
        refreshDialog(self);
        return;
      }
      const price = event.target.closest("[data-gx-dlg-price]");
      if (price) {
        const key = state.dialog.keys.find((entry) => String(entry) === price.dataset.gxDlgPrice);
        if (key !== undefined) {
          state.dialog.prices.set(key, event.target.value);
          refreshDialog(self);
        }
      }
    },
    onClick: (event, self) => {
      if (handleSyncClick(event, eligibleIds(), setId())) {
        return;
      }
      if (state.dialog) {
        if (event.target.closest("[data-gx='dlg-cancel']") || event.target.matches("[data-gx-modal]")) {
          state.dialog = null;
          self.paint();
        } else if (event.target.closest("[data-gx='dlg-confirm']")) {
          confirmDialog(self);
        }
        return;
      }
      const market = event.target.closest("[data-gx-market]");
      if (market) {
        openMarket(Number(market.dataset.gxMarket));
        return;
      }
      const tabButton = event.target.closest("[data-gx-tab]");
      if (tabButton) {
        state.tab = tabButton.dataset.gxTab;
        state.page = 1;
        self.paint();
        return;
      }
      const pageButton = event.target.closest("[data-gx-page]");
      if (pageButton) {
        state.page = Math.max(1, Number(pageButton.dataset.gxPage) || 1);
        self.paint();
        return;
      }
      const reward = event.target.closest("[data-gx-reward]");
      if (reward) {
        // Carte récompense : un premier clic affiche l'avertissement, le second l'ajoute.
        state.rewardConfirm = reward.dataset.gxReward;
        state.message = t("gallery.rewardHint");
        state.kind = "warn";
        self.paint();
        return;
      }
      const pick = event.target.closest("[data-gx-pick]");
      if (pick) {
        const item = state.candidates.find((entry) => String(entry.key) === pick.dataset.gxPick);
        const limit = (state.set.limit && state.set.limit.maxItems) || 20;
        if (item) {
          if (state.selection.has(item.key)) {
            state.selection.delete(item.key);
          } else if (state.selection.size < limit) {
            state.selection.add(item.key);
          } else {
            state.message = t("gallery.selectionFull", { n: limit });
            state.kind = "warn";
          }
          state.rewardConfirm = "";
          self.paint();
        }
        return;
      }
      const single = event.target.closest("[data-gx-buy]");
      if (single) {
        const item = state.candidates.find((entry) => String(entry.key) === single.dataset.gxBuy);
        if (item) {
          openDialog(self, [item], "keep");
        }
        return;
      }
      const action = event.target.closest("[data-gx]");
      if (!action) {
        return;
      }
      switch (action.dataset.gx) {
        case "buy":
          openDialog(self, toBuy(), "");
          break;
        case "resell":
          openDialog(self, toBuy(), "same");
          break;
        case "stop":
          cancelTask();
          break;
        default:
          break;
      }
    },
  });
  const baseUnmount = screen.unmount;
  screen.unmount = () => {
    baseUnmount();
    if (offCards) {
      offCards();
      offCards = null;
    }
  };
  return screen;
};

// ------------------------------------------------------------ tuiles (accueil, Club)

export const openGallery = () => pushScreen(indexScreen());

// Tuile masquée pour la session (menu ⋮) ; « ne plus afficher » = réglage galerie.homeTile.
let homeHiddenForSession = false;

// Même structure que les tuiles EA : titre, sous-titre et ligne verte à gauche, emblème à droite,
// description en bas ; menu ⋮ sur la tuile de l'accueil.
const tileHtml = (where) => {
  const data = indexState.data;
  const size = collectionSize();
  const stats = size
    ? t("gallery.tileCollected", { n: formatCoins(size) })
    : data
    ? plural(data.sets.length, "gallery.setsOne", "gallery.setsMany")
    : t("gallery.tileHint");
  const menu =
    where === "home"
      ? `<button type="button" class="mb-gx-tile-menu" data-gx-tile-menu aria-label="${escapeHtml(t("gallery.hideTile"))}">${ICON_MORE}</button>
        <div class="mb-gx-tile-pop" data-gx-tile-pop hidden>
          <button type="button" data-gx-tile-hide="session">${t("gallery.hideSession")}</button>
          <button type="button" data-gx-tile-hide="forever">${t("gallery.hideForever")}</button>
        </div>`
      : "";
  return `<header><h1 class="tileHeader">${t("gallery.tab")}</h1>${menu}</header>
    <div class="tileContent"><div class="mb-gx-home">
      <div class="mb-gx-home-art">${TILE_ART}</div>
      <div class="mb-gx-home-text"><h2 class="ut-tile-view--subtitle">${t("gallery.tileTitle")}</h2>
        <div class="ut-tile-view--expiry">${escapeHtml(stats)}</div></div>
      <p class="description">${t("gallery.tileText")}</p>
    </div></div>`;
};

// Tuile qui suit la nôtre dans la grille de l'accueil : élargie (col-1-1) pour garder des lignes pleines.
const WIDENED = "mb-gx-widened";

const restoreWidened = (hub) => {
  hub.querySelectorAll(`:scope > .${WIDENED}`).forEach((tile) => {
    tile.classList.remove(WIDENED, "col-1-1");
    tile.classList.add("col-1-2");
  });
};

const makeTile = (where) => {
  const tile = document.createElement("div");
  tile.className = `tile col-1-2 ${TILE}`;
  tile.dataset.where = where;
  tile.setAttribute("role", "button");
  tile.tabIndex = 0;
  tile.dataset.stamp = "";
  tile.innerHTML = tileHtml(where);
  tile.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const pop = tile.querySelector("[data-gx-tile-pop]");
    if (event.target.closest("[data-gx-tile-menu]")) {
      if (pop) {
        pop.hidden = !pop.hidden;
      }
      return;
    }
    const hide = event.target.closest("[data-gx-tile-hide]");
    if (hide) {
      if (hide.dataset.gxTileHide === "forever") {
        setSetting("gallery.homeTile", false);
      }
      homeHiddenForSession = true;
      const hub = tile.parentElement;
      tile.remove();
      if (hub) {
        restoreWidened(hub);
      }
      return;
    }
    if (pop && !pop.hidden) {
      pop.hidden = true;
      return;
    }
    openGallery();
  });
  tile.addEventListener("keydown", (event) => {
    if (event.target === tile && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openGallery();
    }
  });
  // Survol comme les tuiles EA (classe « hover » : bordure éclairée).
  tile.addEventListener("mouseenter", () => tile.classList.add("hover"));
  tile.addEventListener("mouseleave", () => tile.classList.remove("hover"));
  return tile;
};

const homeTileWanted = () => getSettings().gallery.homeTile !== false && !homeHiddenForSession;

const insertHomeTile = (hub) => {
  if (!hub || !hub.querySelector) {
    return;
  }
  const existing = hub.querySelector(`:scope > .${TILE}`);
  if (!homeTileWanted()) {
    if (existing) {
      existing.remove();
      restoreWidened(hub);
    }
    return;
  }
  if (existing) {
    return;
  }
  const anchor = hub.querySelector(":scope > .ut-tile-hub-objective") || hub.querySelector(":scope > .ut-tile-hub-sbc");
  if (!anchor) {
    return;
  }
  const tile = makeTile("home");
  anchor.after(tile);
  // La tuile demi-largeur suivante resterait seule sur sa ligne : elle passe en pleine largeur.
  const next = tile.nextElementSibling;
  if (next && next.classList.contains("col-1-2") && next.nextElementSibling && !next.nextElementSibling.classList.contains("col-1-2")) {
    next.classList.remove("col-1-2");
    next.classList.add("col-1-1", WIDENED);
  }
};

// Tuile dans Club : ajoutée à la fin de la grille du hub (lignes pleines gardées).
const insertClubTile = (grid) => {
  if (!grid || !grid.querySelector) {
    return;
  }
  const existing = grid.querySelector(`:scope > .${TILE}`);
  if (getSettings().gallery.clubTile === false) {
    if (existing) {
      existing.remove();
    }
    return;
  }
  if (!existing) {
    grid.appendChild(makeTile("club"));
  }
};

let homeHooked = false;
let clubHooked = false;

const hookHub = (name, insert, flag) => {
  const Hub = pageGlobal(name);
  if (typeof Hub !== "function" || !Hub.prototype || typeof Hub.prototype._generate !== "function") {
    return false;
  }
  if (!Hub.prototype[flag]) {
    const original = Hub.prototype._generate;
    Hub.prototype._generate = function () {
      const result = original.apply(this, arguments);
      try {
        const root = this.__root;
        insert(root && root.classList && root.classList.contains("layout-hub") ? root : root && root.querySelector && root.querySelector(".layout-hub"));
      } catch (e) {}
      return result;
    };
    Hub.prototype[flag] = true;
  }
  return true;
};

const refreshTileText = (tile) => {
  const stamp = `${getSettings().ui.language}|${indexState.data ? indexState.data.sets.length : 0}|${collectionSize()}`;
  if (tile && tile.dataset.stamp !== stamp && !tile.querySelector("[data-gx-tile-pop]:not([hidden])")) {
    tile.dataset.stamp = stamp;
    tile.innerHTML = tileHtml(tile.dataset.where || "home");
  }
};

// Tuiles ajoutées dès que l'accueil / le Club EA sont construits (et vérifiées à chaque passage).
export const tickGallery = () => {
  if (!homeHooked) {
    homeHooked = hookHub("UTHomeHubView", insertHomeTile, "__mbGallery");
  }
  if (!clubHooked) {
    clubHooked = hookHub("UTClubHubView", insertClubTile, "__mbGalleryClub");
  }
  const objective = document.querySelector(".layout-hub > .ut-tile-hub-objective, .layout-hub > .ut-tile-hub-sbc");
  if (objective) {
    insertHomeTile(objective.parentElement);
    refreshTileText(objective.parentElement.querySelector(`:scope > .${TILE}`));
  }
  const clubGrid = document.querySelector(".ut-club-hub-view .layout-hub");
  if (clubGrid) {
    insertClubTile(clubGrid);
    refreshTileText(clubGrid.querySelector(`:scope > .${TILE}`));
  }
};
