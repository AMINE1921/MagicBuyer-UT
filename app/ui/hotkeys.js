import { eaToast } from "../core/page";
import { tapElement } from "./tap";
import { manualBurst } from "../core/usage";
import { formatCoins } from "../core/prices";
import { getSettings, onSettingsChange, setSetting } from "../core/settings";
import { t } from "../i18n";
import { buyCheckFor } from "./cardPrices";
import { togglePanel } from "./panel";

// Raccourcis clavier pour le web app EA (recherche, achat immédiat, enchère, mise en vente,
// navigation dans les résultats, prix min / max). Chaque raccourci « tape » le vrai bouton EA
// visible (même suite d'évènements qu'un clic de souris) : rien n'est fait sans bouton à l'écran.
// Touches configurables (onglet Outils) ; ignorés pendant la saisie dans un champ.

// Boîte de dialogue EA ouverte (confirmation d'achat, etc.).
const DIALOG = ".ea-dialog-view";

// Contrôles à pas (enchère min / max, achat immédiat min / max) de la recherche du marché.
const SPINNERS = ".ut-market-search-filters-view .search-prices .ut-numeric-input-spinner-control";

const visible = (el) => {
  if (!el || !el.isConnected) {
    return false;
  }
  if (el.disabled || (el.classList && el.classList.contains("disabled"))) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return false;
  }
  try {
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none";
  } catch (e) {
    return true;
  }
};

const firstVisible = (selector) => Array.from(document.querySelectorAll(selector)).find(visible) || null;

// Même suite d'évènements qu'un vrai clic (module tap.js, partagé avec les résultats du marché).
export { tapElement };

const tapFirst = (selector) => tapElement(firstVisible(selector));

const dialogOpen = () => !!firstVisible(DIALOG);

// Sélection de la carte suivante / précédente dans la liste de résultats affichée.
const moveSelection = (step) => {
  const rows = Array.from(document.querySelectorAll(".paginated-item-list li.listFUTItem, .ut-pinned-list li.listFUTItem")).filter(visible);
  if (!rows.length) {
    return false;
  }
  const index = rows.findIndex((row) => row.classList.contains("selected"));
  const next = rows[Math.max(0, Math.min(rows.length - 1, index < 0 ? 0 : index + step))];
  if (!next || (index >= 0 && next === rows[index])) {
    return false;
  }
  tapElement(next.querySelector(".rowContent") || next);
  try {
    next.scrollIntoView({ block: "nearest" });
  } catch (e) {}
  return true;
};

// Prix de la recherche : 0 = enchère min, 1 = enchère max, 2 = achat immédiat min, 3 = achat immédiat max.
const stepSpinner = (index, direction) => {
  const spinners = Array.from(document.querySelectorAll(SPINNERS)).filter((el) => el.isConnected && el.getBoundingClientRect().width);
  const spinner = spinners[index];
  if (!spinner) {
    return false;
  }
  return tapElement(spinner.querySelector(direction > 0 ? "button.increment-value" : "button.decrement-value"));
};

// Mise en vente : ouvre le panneau « Mettre en vente » s'il est fermé, sinon valide la mise en vente.
const listItem = () => {
  const panel = firstVisible(".ut-quick-list-panel-view");
  if (!panel) {
    return false;
  }
  const actions = panel.querySelector(".panelActions");
  if (actions && !actions.classList.contains("open")) {
    return tapElement(panel.querySelector(".accordian"));
  }
  return tapElement(Array.from(panel.querySelectorAll(".panelActions button.primary")).find(visible));
};

// Validation d'une boîte de dialogue : seulement celle ouverte par le raccourci « achat immédiat »
// (dans les 8 s). Une confirmation ouverte à la souris (vente rapide, etc.) n'est jamais validée au clavier.
let confirmArmedUntil = 0;
const confirmArmed = () => dialogOpen() && Date.now() < confirmArmedUntil;

// Anti-perte : pas d'achat immédiat au clavier quand la revente au prix FUTBIN (taxe EA déduite)
// rapporterait moins que le prix payé. Le clic à la souris reste possible.
const buyNow = () => {
  const button = firstVisible("button.buyButton");
  if (!button) {
    return false;
  }
  const guard = (getSettings().hotkeys || {}).lossGuard !== false;
  const check = guard ? buyCheckFor(button.closest(".DetailView")) : null;
  if (check && check.profit < 0) {
    eaToast(
      t("tools.buyNowBlocked", {
        bin: formatCoins(check.bin),
        price: formatCoins(check.price),
        profit: `−${formatCoins(Math.abs(check.profit))}`,
      }),
      true
    );
    return true;
  }
  const done = tapElement(button);
  if (done) {
    confirmArmedUntil = Date.now() + 8000;
  }
  return done;
};

// Recherche au clavier refusée quand les recherches à la main s'enchaînent trop vite (comme EA le
// repère) : la touche ne fait rien, un message l'explique.
const searchNow = () => {
  if (manualBurst()) {
    eaToast(t("tools.usageBurstKey"), true);
    return true;
  }
  return tapFirst(".ut-market-search-filters-view .button-container button.primary");
};

const confirmDialog = () => {
  confirmArmedUntil = 0;
  return tapFirst(`${DIALOG} .ut-st-button-group .btn-standard.primary`);
};

// Actions (ordre = priorité quand deux actions partagent une touche, ex. Entrée).
export const HOTKEY_ACTIONS = [
  { id: "confirm", key: "Enter", when: confirmArmed, run: confirmDialog },
  { id: "cancel", key: "Escape", when: dialogOpen, run: () => tapFirst(`${DIALOG} .ut-st-button-group .btn-standard.text`) },
  { id: "search", key: "Enter", run: searchNow, hint: ".ut-market-search-filters-view .button-container button.primary" },
  { id: "buyNow", key: "b", run: buyNow, hint: "button.buyButton" },
  { id: "bid", key: "n", run: () => tapFirst("button.bidButton"), hint: "button.bidButton" },
  { id: "list", key: "l", run: listItem, hint: ".ut-quick-list-panel-view .panelActions button.primary" },
  { id: "back", key: "Backspace", run: () => tapFirst(".ut-navigation-bar-view button.ut-navigation-button-control"), hint: ".ut-navigation-bar-view button.ut-navigation-button-control" },
  { id: "nextItem", key: "ArrowDown", run: () => moveSelection(1) },
  { id: "prevItem", key: "ArrowUp", run: () => moveSelection(-1) },
  { id: "nextPage", key: "ArrowRight", run: () => tapFirst(".paginated-item-list .pagination.next"), hint: ".paginated-item-list .pagination.next" },
  { id: "prevPage", key: "ArrowLeft", run: () => tapFirst(".paginated-item-list .pagination.prev"), hint: ".paginated-item-list .pagination.prev" },
  { id: "minBinUp", key: "+", run: () => stepSpinner(2, 1) },
  { id: "minBinDown", key: "-", run: () => stepSpinner(2, -1) },
  { id: "maxBinUp", key: "PageUp", run: () => stepSpinner(3, 1) },
  { id: "maxBinDown", key: "PageDown", run: () => stepSpinner(3, -1) },
  { id: "minBidUp", key: "", run: () => stepSpinner(0, 1) },
  { id: "minBidDown", key: "", run: () => stepSpinner(0, -1) },
  { id: "maxBidUp", key: "", run: () => stepSpinner(1, 1) },
  { id: "maxBidDown", key: "", run: () => stepSpinner(1, -1) },
  { id: "panel", key: "m", run: () => (togglePanel(), true) },
  // Navigation : onglets de la barre EA (accueil, équipe, transferts, club, DCE, évolutions).
  { id: "goHome", key: "1", run: () => tapFirst(".ut-tab-bar-item.icon-home"), hint: ".ut-tab-bar-item.icon-home" },
  { id: "goSquad", key: "2", run: () => tapFirst(".ut-tab-bar-item.icon-squad"), hint: ".ut-tab-bar-item.icon-squad" },
  { id: "goTransfers", key: "3", run: () => tapFirst(".ut-tab-bar-item.icon-transfer"), hint: ".ut-tab-bar-item.icon-transfer" },
  { id: "goClub", key: "4", run: () => tapFirst(".ut-tab-bar-item.icon-club"), hint: ".ut-tab-bar-item.icon-club" },
  { id: "goSbc", key: "5", run: () => tapFirst(".ut-tab-bar-item.icon-sbc"), hint: ".ut-tab-bar-item.icon-sbc" },
  { id: "goEvolutions", key: "6", run: () => tapFirst(".ut-tab-bar-item.icon-evolution"), hint: ".ut-tab-bar-item.icon-evolution" },
];

// Touches données à plusieurs actions : { key: [ids] } (seules les touches en double).
export const bindingConflicts = () => {
  const byKey = new Map();
  HOTKEY_ACTIONS.forEach((action) => {
    const key = bindingFor(action);
    if (!key) {
      return;
    }
    // Entrée / Échap servent à la fois aux boîtes de dialogue et au marché : pas un conflit.
    if (action.when) {
      return;
    }
    byKey.set(key, (byKey.get(key) || []).concat(action.id));
  });
  const conflicts = {};
  byKey.forEach((ids, key) => {
    if (ids.length > 1) {
      conflicts[key] = ids;
    }
  });
  return conflicts;
};

// Nom d'une touche : "b", "Enter", "Shift+ArrowUp"… (lettres en minuscules).
export const keyName = (event) => {
  let key = String(event.key || "");
  if (!key || key === "Unidentified" || ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"].includes(key)) {
    return "";
  }
  if (key === " ") {
    key = "Space";
  }
  if (key.length === 1) {
    key = key.toLowerCase();
  }
  // Maj ne compte que pour les touches spéciales (« + » s'obtient avec Maj sur certains claviers).
  return event.shiftKey && key.length > 1 ? `Shift+${key}` : key;
};

const LABELS = {
  Enter: "⏎",
  Backspace: "⌫",
  ArrowDown: "↓",
  ArrowUp: "↑",
  ArrowRight: "→",
  ArrowLeft: "←",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Space: "␣",
};

export const keyLabel = (key) => {
  if (!key) {
    return "—";
  }
  const parts = String(key).split("+").filter(Boolean);
  const last = parts.pop() || String(key);
  const label = key === "+" ? "+" : last === "Escape" ? t("tools.keyEscape") : LABELS[last] || (last.length === 1 ? last.toUpperCase() : last);
  return parts.length ? `${parts.join("+")}+${label}` : label;
};

export const bindingFor = (action) => {
  const custom = (getSettings().hotkeys || {}).bindings || {};
  return Object.prototype.hasOwnProperty.call(custom, action.id) ? String(custom[action.id] || "") : action.key;
};

export const setBinding = (id, key) => {
  const bindings = Object.assign({}, (getSettings().hotkeys || {}).bindings || {});
  bindings[id] = key;
  setSetting("hotkeys.bindings", bindings);
};

export const resetBindings = () => setSetting("hotkeys.bindings", {});

export const actionLabel = (id) => t(`tools.hk_${id}`);

const typing = (target) => {
  if (!target) {
    return false;
  }
  const tag = String(target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || !!target.isContentEditable;
};

// Touche tapée dans une fenêtre MagicBuyer (panneau, DCE…) : laissée à cette fenêtre.
const inOwnUi = (target) =>
  !!(target && target.closest && target.closest("#mb-root, #mb-sbc, #mb-sbc-after, #mb-hud, #mb-toast"));

// Capture d'une nouvelle touche (réglages) : la prochaine touche est renvoyée au lieu d'agir.
// Annulée par un clic ailleurs, une saisie dans un champ ou au bout de 10 s.
let capture = null;
let captureTimer = null;

const stopCapture = (cancelled) => {
  const fn = capture;
  capture = null;
  clearTimeout(captureTimer);
  document.removeEventListener("mousedown", onCaptureClick, true);
  if (fn && cancelled) {
    fn("", true);
  }
  return fn;
};

const onCaptureClick = (event) => {
  if (!(event.target && event.target.closest && event.target.closest("[data-hk]"))) {
    stopCapture(true);
  }
};

export const captureNextKey = (fn) => {
  stopCapture(true);
  capture = fn;
  captureTimer = setTimeout(() => stopCapture(true), 10000);
  document.addEventListener("mousedown", onCaptureClick, true);
};

const onKeyDown = (event) => {
  if (capture) {
    // Saisie dans un champ pendant la capture : la capture est abandonnée, la touche va au champ.
    if (typing(event.target)) {
      stopCapture(true);
      return;
    }
    const key = event.key === "Escape" ? "" : keyName(event);
    if (key || event.key === "Escape" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      const fn = stopCapture(false);
      if (fn) {
        fn(event.key === "Delete" ? "" : key, event.key === "Escape");
      }
    }
    return;
  }
  const settings = getSettings().hotkeys || {};
  if (settings.enabled === false || event.ctrlKey || event.metaKey || event.altKey || event.repeat || typing(event.target) || inOwnUi(event.target)) {
    return;
  }
  const key = keyName(event);
  if (!key) {
    return;
  }
  for (const action of HOTKEY_ACTIONS) {
    if (bindingFor(action) !== key || (action.when && !action.when())) {
      continue;
    }
    // Une boîte de dialogue ouverte bloque les autres actions (sauf ses propres boutons).
    if (!action.when && dialogOpen()) {
      return;
    }
    let done = false;
    try {
      done = !!action.run();
    } catch (e) {
      done = false;
    }
    if (done) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }
};

// ------------------------------------------------------------ pastilles d'aide

const HINT = "mb-kbd";

const paintHints = () => {
  const settings = getSettings().hotkeys || {};
  const show = settings.enabled !== false && settings.hints !== false;
  if (!show) {
    document.querySelectorAll(`.${HINT}`).forEach((el) => el.remove());
    return;
  }
  HOTKEY_ACTIONS.forEach((action) => {
    if (!action.hint) {
      return;
    }
    const key = bindingFor(action);
    document.querySelectorAll(action.hint).forEach((button) => {
      let hint = button.querySelector(`:scope > .${HINT}`);
      if (!key || !button.isConnected) {
        if (hint) {
          hint.remove();
        }
        return;
      }
      if (!hint) {
        hint = document.createElement("kbd");
        hint.className = HINT;
        hint.setAttribute("aria-hidden", "true");
        button.appendChild(hint);
      }
      const label = keyLabel(key);
      if (hint.textContent !== label) {
        hint.textContent = label;
      }
    });
  });
};

let bound = false;

export const tickHotkeys = () => {
  if (!bound) {
    bound = true;
    document.addEventListener("keydown", onKeyDown, true);
    onSettingsChange((settings, path) => {
      if (/^hotkeys\./.test(path) || path === "*") {
        paintHints();
      }
    });
  }
  paintHints();
};
