import { classify, KIND } from "../core/errors";
import { log } from "../core/logger";
import { routeUnassigned, routingSummary } from "../core/packs";
import { eaToast, pageGlobal, services } from "../core/page";
import { formatCoins } from "../core/prices";
import { sbcContext } from "../core/sbc";
import { getSettings, onSettingsChange, setSetting } from "../core/settings";
import { cancelTask, currentTask, endTask } from "../core/tasks";
import { startToolTask } from "../core/toolTask";
import { t } from "../i18n";
import { currentPrice } from "../prices/priceService";
import { shortCoins } from "./cardPrices";
import { visibleSbcController } from "./sbcPanel";

// Outils DCE du web app :
// - collections masquables dans la liste des DCE (bouton × sous le bouton favori d'EA, « Annuler »
//   juste après, réaffichage dans Outils) ;
// - valeur FUTBIN de l'équipe du défi affiché ;
// - alerte quand EA refuse les DCE (trop de requêtes, vérification, blocage temporaire) ;
// - après un DCE validé : rangement des récompenses (non attribués) en un clic.
// Seule UTSBCSetTileView.setData est enveloppée (elle n'appelle pas superclass()).

// 426 : « trop d'actions » côté DCE (limite EA), comme 429 / 512 / 521 ; 458 : vérification.
const SOFT_BAN_CODES = new Set([426, 429, 458, 512, 521]);
let tileHooked = false;
let serviceHooked = null;
let valuePill = null;
let afterBox = null;
let afterTimer = null;
let lastAlertAt = 0;

// ------------------------------------------------------------ collections masquées

const hiddenIds = () => new Set((getSettings().sbc.hidden || []).map((entry) => String(entry.id)));

const applyHidden = (root) => {
  const id = root.dataset.mbSet;
  root.classList.toggle("mb-sbc-hidden", !!id && hiddenIds().has(id));
};

const hideSet = (id, name) => {
  const hidden = (getSettings().sbc.hidden || []).filter((entry) => String(entry.id) !== String(id));
  hidden.push({ id: String(id), name: String(name || "") });
  setSetting("sbc.hidden", hidden);
};

export const showSet = (id) => {
  const hidden = (getSettings().sbc.hidden || []).filter((entry) => String(entry.id) !== String(id));
  setSetting("sbc.hidden", hidden);
};

// EA (FC 27) a un bouton favori rond dans le coin haut droit des tuiles : le × du bot se place
// juste dessous, centré sur lui, pour ne jamais le recouvrir. Le bouton EA est repéré par sa
// position (petit élément cliquable collé au coin), ses classes changeant d'une version à l'autre.
// Renvoie { top, right } en px dans la tuile, ou null (pas de bouton EA : position du CSS).
const CORNER_PX = 48;
const HIDE_GAP_PX = 6;

export const hidePlacement = (box, controls, size = 22) => {
  if (!box || !box.width || !box.height) {
    return null;
  }
  const corner = (controls || []).find(
    (rect) =>
      rect.width >= 12 &&
      rect.width <= 64 &&
      rect.height >= 12 &&
      rect.height <= 64 &&
      box.right - rect.right <= CORNER_PX &&
      rect.top - box.top <= CORNER_PX
  );
  if (!corner) {
    return null;
  }
  return {
    top: Math.round(corner.bottom - box.top + HIDE_GAP_PX),
    right: Math.round(box.right - corner.right + (corner.width - size) / 2),
  };
};

const CONTROL_SELECTOR = "button, [role='button'], [class*='fav' i], [class*='star' i]";

const placeHideButton = (root, button) => {
  const controls = Array.from(root.querySelectorAll(CONTROL_SELECTOR))
    .filter((el) => el !== button && !button.contains(el))
    .map((el) => el.getBoundingClientRect());
  const spot = hidePlacement(root.getBoundingClientRect(), controls, button.offsetWidth || 22);
  if (spot) {
    button.style.top = `${spot.top}px`;
    button.style.right = `${spot.right}px`;
  }
};

// Collection masquée par erreur : « Annuler » pendant quelques secondes (sinon onglet Outils).
const UNDO_MS = 6000;
let undoBox = null;
let undoTimer = null;

const showUndo = (id, name) => {
  if (!undoBox) {
    undoBox = document.createElement("div");
    undoBox.id = "mb-toast";
    undoBox.innerHTML = `<span data-undo-text></span><button type="button" class="mb-toast-action" data-undo></button>`;
    undoBox.querySelector("[data-undo]").addEventListener("click", () => {
      showSet(undoBox.dataset.set);
      undoBox.classList.remove("is-visible");
    });
    document.body.appendChild(undoBox);
  }
  undoBox.dataset.set = String(id);
  undoBox.querySelector("[data-undo-text]").textContent = t("tools.sbcHiddenToast", { name: name || `#${id}` });
  undoBox.querySelector("[data-undo]").textContent = t("tools.sbcUndo");
  undoBox.classList.add("is-visible");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => undoBox.classList.remove("is-visible"), UNDO_MS);
};

const decorateTile = (view, set) => {
  const root = view && typeof view.getRootElement === "function" ? view.getRootElement() : null;
  if (!root || !set || set.id == null) {
    return;
  }
  root.dataset.mbSet = String(set.id);
  root.dataset.mbSetName = String(set.name || "");
  if (!root.querySelector(":scope > .mb-sbc-hide")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mb-sbc-hide";
    button.textContent = "×";
    ["pointerdown", "mousedown", "touchstart", "touchend", "mouseup", "pointerup"].forEach((type) =>
      button.addEventListener(type, (event) => event.stopPropagation())
    );
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideSet(root.dataset.mbSet, root.dataset.mbSetName);
      showUndo(root.dataset.mbSet, root.dataset.mbSetName);
    });
    root.appendChild(button);
    // Position recalculée quand la tuile est affichée, puis au survol (juste avant un clic).
    requestAnimationFrame(() => placeHideButton(root, button));
    root.addEventListener("pointerenter", () => placeHideButton(root, button));
  }
  const hide = root.querySelector(":scope > .mb-sbc-hide");
  hide.title = t("tools.sbcHide");
  hide.setAttribute("aria-label", t("tools.sbcHide"));
  applyHidden(root);
};

const hookTiles = () => {
  if (tileHooked) {
    return;
  }
  const Tile = pageGlobal("UTSBCSetTileView");
  if (typeof Tile !== "function" || !Tile.prototype || typeof Tile.prototype.setData !== "function") {
    return;
  }
  if (!Tile.prototype.__mbHide) {
    const original = Tile.prototype.setData;
    Tile.prototype.setData = function (set) {
      const result = original.apply(this, arguments);
      try {
        decorateTile(this, set);
      } catch (e) {}
      return result;
    };
    Tile.prototype.__mbHide = true;
  }
  tileHooked = true;
  onSettingsChange((settings, path) => {
    if (path === "sbc.hidden" || path === "*" || path === "ui.language") {
      document.querySelectorAll("[data-mb-set]").forEach((root) => {
        applyHidden(root);
        const hide = root.querySelector(":scope > .mb-sbc-hide");
        if (hide) {
          hide.title = t("tools.sbcHide");
        }
      });
    }
  });
};

// ---------------------------------------------------------- valeur de l'équipe

const squadValue = (ctrl) => {
  const context = sbcContext(ctrl);
  if (!context) {
    return null;
  }
  let total = 0;
  let known = 0;
  let players = 0;
  for (let index = 0; index < 11; index += 1) {
    let slot = null;
    try {
      slot = context.squad.getSlot(index);
    } catch (e) {
      slot = null;
    }
    const item = slot && slot.item;
    let valid = false;
    try {
      valid = !!(slot && typeof slot.isValid === "function" ? slot.isValid() : item);
    } catch (e) {}
    if (!valid || !item || item.concept) {
      continue;
    }
    players += 1;
    const price = currentPrice(Number(item.definitionId), 60 * 60 * 1000, "display");
    if (price) {
      total += price;
      known += 1;
    }
  }
  return { total, known, players };
};

const paintValue = () => {
  const ctrl = getSettings().sbc.squadValue !== false ? visibleSbcController() : null;
  const value = ctrl ? squadValue(ctrl) : null;
  if (!value || !value.players) {
    if (valuePill) {
      valuePill.hidden = true;
    }
    return;
  }
  if (!valuePill || !valuePill.isConnected) {
    valuePill = document.createElement("div");
    valuePill.id = "mb-sbc-value";
    document.body.appendChild(valuePill);
  }
  valuePill.hidden = false;
  const text = t("tools.sbcValue", { value: shortCoins(value.total), known: value.known, players: value.players });
  if (valuePill.textContent !== text) {
    valuePill.textContent = text;
  }
  valuePill.title = t("tools.sbcValueTitle", { value: formatCoins(value.total), known: value.known, players: value.players });
};

// ------------------------------------------------ refus EA et après validation

const alertSoftBan = (error, method) => {
  if (Date.now() - lastAlertAt < 60 * 1000) {
    return;
  }
  lastAlertAt = Date.now();
  const text = t("tools.sbcSoftBanAlert", { code: error.code || "?", error: error.label });
  log.error(text);
  eaToast(`MagicBuyer : ${text}`, true);
  // Une tâche DCE ou galerie en cours est arrêtée : elle enverrait d'autres requêtes refusées.
  if (currentTask() && method !== "loadChallenge") {
    cancelTask();
  }
};

const closeAfter = () => {
  clearTimeout(afterTimer);
  if (afterBox) {
    afterBox.remove();
    afterBox = null;
  }
};

const showAfterSubmit = () => {
  closeAfter();
  afterBox = document.createElement("div");
  afterBox.id = "mb-sbc-after";
  afterBox.innerHTML = `<span>${t("tools.sbcSubmitted")}</span>
    <button type="button" data-after="route">${t("tools.routeUnassigned")}</button>
    <button type="button" data-after="close" aria-label="${t("tools.close")}">×</button>`;
  ["pointerdown", "mousedown", "touchstart", "touchend", "mouseup", "pointerup"].forEach((type) =>
    afterBox.addEventListener(type, (event) => event.stopPropagation())
  );
  afterBox.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-after]");
    if (!button) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.after === "close") {
      closeAfter();
      return;
    }
    const { task, error } = startToolTask(t("tools.taskRoute"));
    const label = afterBox.querySelector("span");
    if (!task) {
      label.textContent = error;
      return;
    }
    button.disabled = true;
    label.textContent = t("tools.routing");
    try {
      const report = await routeUnassigned({ token: task.token });
      const text = report.error ? report.error : routingSummary(report);
      label.textContent = text;
      log.info(t("tools.logRouted", { summary: text }));
    } finally {
      endTask(task);
    }
    clearTimeout(afterTimer);
    afterTimer = setTimeout(closeAfter, 8000);
  });
  document.body.appendChild(afterBox);
  afterTimer = setTimeout(closeAfter, 30000);
};

// Observe la réponse d'un appel du service DCE sans modifier le traitement d'EA.
const watchResponse = (observable, method) => {
  if (!observable || typeof observable.observe !== "function") {
    return;
  }
  const scope = {};
  try {
    observable.observe(scope, (obs, response) => {
      try {
        obs.unobserve(scope);
      } catch (e) {}
      if (response && response.success) {
        if (method === "submitChallenge") {
          showAfterSubmit();
        }
        return;
      }
      if (getSettings().sbc.softBanAlert === false) {
        return;
      }
      const error = classify(response);
      if (SOFT_BAN_CODES.has(error.code) || error.kind === KIND.RATE || error.kind === KIND.BLOCKED || error.kind === KIND.CAPTCHA) {
        alertSoftBan(error, method);
      }
    });
  } catch (e) {}
};

const hookService = () => {
  const svc = services();
  const sbc = svc && svc.SBC;
  if (!sbc || serviceHooked === sbc) {
    return;
  }
  ["submitChallenge", "saveChallenge", "loadChallenge"].forEach((method) => {
    const original = sbc[method];
    if (typeof original !== "function" || original.__mbSbc) {
      return;
    }
    const wrapped = function () {
      const observable = original.apply(this, arguments);
      watchResponse(observable, method);
      return observable;
    };
    wrapped.__mbSbc = true;
    sbc[method] = wrapped;
  });
  serviceHooked = sbc;
};

export const tickSbcTools = () => {
  try {
    hookTiles();
  } catch (e) {}
  try {
    hookService();
  } catch (e) {}
  try {
    paintValue();
  } catch (e) {}
};
