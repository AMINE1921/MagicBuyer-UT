import { isRunning } from "../core/engine";
import { errorMessage, log } from "../core/logger";
import { pageGlobal } from "../core/page";
import { loadJson, saveJson } from "../core/storage";
import { floorPrice, formatCoins, parseCoinsInput } from "../core/prices";
import {
  applySession,
  buyMissing,
  entryPrice,
  formationLabel,
  loadSolution,
  maxPriceFor,
  priceStatus,
  releaseSession,
  sessionSummary,
} from "../core/sbc";
import { beginTask, cancelTask, currentTask, endTask } from "../core/tasks";
import { plural, t } from "../i18n";
import { onPriceUpdate } from "../prices/priceService";
import { escapeHtml, qs } from "./dom";
import { injectStyles } from "./panel";

// Écran d'équipe d'un DCE : bouton « Solution FUTBIN » → coller le lien, aperçu des joueurs
// (club / stockage / à acheter), placement dans l'équipe, achat des manquants au prix FUTBIN.
// Seules deux méthodes EA sans appel à superclass() sont interceptées (initWithSBCSet et
// getNavigationTitle) : les autres méthodes de ce contrôleur ne supportent pas d'être enveloppées.

let activeCtrl = null;
let hooked = false;
let fab = null;
let modal = null;
let session = null;
let running = null;
let loading = false;
let unwatchPrices = null;
let repaintTimer = null;
// Dernière solution FUTBIN de chaque défi (gardée au rechargement) : un DCE répétable se refait
// en rouvrant le défi, la solution est rechargée et l'équipe remplie tout de suite.
const URLS_KEY = "sbcSolutions";
const lastUrls = new Map(Object.entries(loadJson(URLS_KEY, {}) || {}));
const rememberUrl = (key, url) => {
  if (!key) {
    return;
  }
  lastUrls.delete(key);
  lastUrls.set(key, url);
  while (lastUrls.size > 60) {
    lastUrls.delete(lastUrls.keys().next().value);
  }
  saveJson(URLS_KEY, Object.fromEntries(lastUrls));
};

const STATE_KEYS = {
  owned: "sbc.stateOwned",
  missing: "sbc.stateMissing",
  searching: "sbc.stateSearching",
  bought: "sbc.stateBought",
  failed: "sbc.stateFailed",
};

const stateLabel = (state) => (STATE_KEYS[state] ? t(STATE_KEYS[state]) : state);

// Provenance d'une carte (identifiants de app/core/sbc.js) : libellé affiché.
const SOURCE_KEYS = {
  club: "sbc.sourceClub",
  stockage: "sbc.sourceStorage",
  acheté: "sbc.sourceBought",
};

const sourceLabel = (source) => (SOURCE_KEYS[source] ? t(SOURCE_KEYS[source]) : source);

const noteText = (entry) => entry.note || (entry.source && entry.state === "owned" ? sourceLabel(entry.source) : "");

const ctrlAlive = (ctrl) => {
  try {
    if (!ctrl || !ctrl._challenge) {
      return false;
    }
    const root = ctrl.getView().getRootElement();
    return !!(root && root.isConnected);
  } catch (e) {
    return false;
  }
};

// Contrôleur du défi affiché (ou null) : utilisé par les outils DCE (valeur FUTBIN de l'équipe).
export const visibleSbcController = () => (ctrlAlive(activeCtrl) ? activeCtrl : null);

const challengeKey = (ctrl) => {
  try {
    return String(ctrl._challenge.id);
  } catch (e) {
    return "";
  }
};

// ------------------------------------------------------------------ interception

export const hookSbc = () => {
  if (hooked) {
    return true;
  }
  const Ctrl = pageGlobal("UTSBCSquadOverviewViewController");
  if (typeof Ctrl !== "function" || !Ctrl.prototype) {
    return false;
  }
  const proto = Ctrl.prototype;
  if (!proto.__mbSbc) {
    ["initWithSBCSet", "getNavigationTitle"].forEach((name) => {
      const original = proto[name];
      if (typeof original !== "function") {
        return;
      }
      proto[name] = function () {
        activeCtrl = this;
        return original.apply(this, arguments);
      };
    });
    proto.__mbSbc = true;
  }
  hooked = true;
  return true;
};

// --------------------------------------------------------------- bouton flottant

// Libellés du bouton relus à chaque passage : suivent un changement de langue.
const paintFab = (button) => {
  const label = t("sbc.solutionTitle");
  const title = t("sbc.fabTitle");
  if (button.textContent !== label) {
    button.textContent = label;
  }
  if (button.title !== title) {
    button.title = title;
  }
};

const ensureFab = () => {
  if (fab && fab.isConnected) {
    return fab;
  }
  fab = document.createElement("button");
  fab.type = "button";
  fab.id = "mb-sbc-fab";
  paintFab(fab);
  ["pointerdown", "mousedown", "touchstart", "touchend", "mouseup", "pointerup"].forEach((type) =>
    fab.addEventListener(type, (event) => event.stopPropagation())
  );
  fab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openModal();
  });
  document.body.appendChild(fab);
  return fab;
};

export const tickSbc = () => {
  hookSbc();
  const visible = ctrlAlive(activeCtrl);
  if (!visible && !modal) {
    if (fab) {
      fab.hidden = true;
    }
    return;
  }
  if (!document.body) {
    return;
  }
  injectStyles();
  const button = ensureFab();
  paintFab(button);
  button.hidden = !visible || !!modal;
};

// -------------------------------------------------------------------- fenêtre

const modalHtml = (title) => `
  <div class="mb-sbc-backdrop" data-sbc-close></div>
  <div class="mb-sbc-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(t("sbc.dialogLabel"))}">
    <header class="mb-sbc-head">
      <div><strong>${t("sbc.solutionTitle")}</strong><small>${escapeHtml(title || t("sbc.defaultChallenge"))}</small></div>
      <button type="button" class="mb-sbc-x" data-sbc-close aria-label="${escapeHtml(t("sbc.close"))}">×</button>
    </header>
    <div class="mb-sbc-url">
      <input type="url" data-sbc-url placeholder="https://www.futbin.com/27/squad/…" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(t("sbc.urlLabel"))}" />
      <button type="button" class="mb-sbc-btn is-primary" data-sbc-load>${t("sbc.load")}</button>
    </div>
    <p class="mb-sbc-status" data-sbc-status>${t("sbc.statusIntro")}</p>
    <div class="mb-sbc-body" data-sbc-body></div>
    <footer class="mb-sbc-foot">
      <span class="mb-sbc-summary" data-sbc-summary></span>
      <button type="button" class="mb-sbc-btn" data-sbc-apply disabled>${t("sbc.apply")}</button>
      <button type="button" class="mb-sbc-btn is-primary" data-sbc-buy disabled>${t("sbc.buy")}</button>
      <button type="button" class="mb-sbc-btn is-danger" data-sbc-stop hidden>${t("sbc.stop")}</button>
    </footer>
  </div>`;

const setStatus = (text, kind = "") => {
  if (!modal) {
    return;
  }
  const el = qs(modal, "[data-sbc-status]");
  el.textContent = text;
  el.dataset.kind = kind;
};

const rowHtml = (entry, index) => {
  const editable = entry.state === "missing" || entry.state === "failed";
  const price = entryPrice(entry);
  const auto = maxPriceFor(Object.assign({}, entry, { manual: false }));
  const player = entry.player;
  const link = player.url
    ? ` <a href="${escapeHtml(player.url)}" target="_blank" rel="noopener" title="${escapeHtml(t("sbc.futbinPage"))}">↗</a>`
    : "";
  return `<tr data-sbc-row="${index}" class="is-${entry.state}">
    <td class="mb-sbc-pos">${escapeHtml(entry.slotLabel || player.position || "—")}</td>
    <td><b>${escapeHtml(player.name || `#${player.eaId}`)}</b> <span class="mb-sbc-rating">${player.rating || ""}</span>${link}
      <small data-sbc-note>${escapeHtml(noteText(entry))}</small></td>
    <td data-sbc-state>${stateLabel(entry.state)}</td>
    <td class="is-num"><span data-sbc-price>${price ? formatCoins(price) : "—"}</span><small data-sbc-age>${escapeHtml(priceStatus(entry))}</small></td>
    <td class="is-num">${
      editable
        ? `<input class="mb-sbc-max" data-sbc-max="${index}" inputmode="text" autocomplete="off" value="${entry.manual ? entry.maxPrice : ""}" placeholder="${
            auto ? auto : escapeHtml(t("sbc.maxPlaceholder"))
          }" aria-label="${escapeHtml(t("sbc.maxAria", { name: player.name == null ? "" : player.name }))}" />`
        : entry.boughtPrice
        ? formatCoins(entry.boughtPrice)
        : ""
    }</td>
  </tr>`;
};

const renderTable = () => {
  if (!modal) {
    return;
  }
  const body = qs(modal, "[data-sbc-body]");
  if (!session) {
    body.innerHTML = "";
    return;
  }
  const formation = session.formation
    ? t("sbc.formationChange", {
        from: escapeHtml(session.futbinFormation || formationLabel(session.formation)),
        to: escapeHtml(formationLabel(session.formation)),
      })
    : session.futbinFormation
    ? t("sbc.formationMissing", { name: escapeHtml(session.futbinFormation) })
    : t("sbc.formationKept");
  const title = session.challengeName ? `${t("sbc.solutionName", { name: escapeHtml(session.challengeName) })} · ` : "";
  const count = plural(session.entries.length, "sbc.playerCountOne", "sbc.playerCountMany");
  const via = session.via === "iframe" ? t("sbc.viaIframe") : t("sbc.viaDirect");
  body.innerHTML = `<p class="mb-sbc-meta">${title}${formation} · ${count} · ${via}</p>
    <table class="mb-sbc-table">
      <thead><tr><th>${t("sbc.colPosition")}</th><th>${t("sbc.colPlayer")}</th><th>${t("sbc.colStatus")}</th><th class="is-num">FUTBIN</th><th class="is-num">${t("sbc.colMax")}</th></tr></thead>
      <tbody>${session.entries.map(rowHtml).join("")}</tbody>
    </table>`;
  paintSummary();
};

// Mise à jour d'une ligne sans toucher au champ en cours de saisie.
const paintRow = (index) => {
  if (!modal || !session) {
    return;
  }
  const row = qs(modal, `[data-sbc-row="${index}"]`);
  const entry = session.entries[index];
  if (!row || !entry) {
    return;
  }
  const input = qs(row, "[data-sbc-max]");
  const editable = entry.state === "missing" || entry.state === "failed";
  if (!!input !== editable) {
    const fresh = document.createElement("tbody");
    fresh.innerHTML = rowHtml(entry, index);
    row.replaceWith(fresh.firstElementChild);
    paintSummary();
    return;
  }
  row.className = `is-${entry.state}`;
  qs(row, "[data-sbc-state]").textContent = stateLabel(entry.state);
  qs(row, "[data-sbc-note]").textContent = noteText(entry);
  const price = entryPrice(entry);
  qs(row, "[data-sbc-price]").textContent = price ? formatCoins(price) : "—";
  qs(row, "[data-sbc-age]").textContent = priceStatus(entry);
  if (input && document.activeElement !== input) {
    const auto = maxPriceFor(Object.assign({}, entry, { manual: false }));
    input.placeholder = auto ? String(auto) : t("sbc.maxPlaceholder");
  }
  paintSummary();
};

const paintSummary = () => {
  if (!modal) {
    return;
  }
  const summaryEl = qs(modal, "[data-sbc-summary]");
  const applyBtn = qs(modal, "[data-sbc-apply]");
  const buyBtn = qs(modal, "[data-sbc-buy]");
  const stopBtn = qs(modal, "[data-sbc-stop]");
  if (!session) {
    summaryEl.textContent = "";
    applyBtn.disabled = true;
    buyBtn.disabled = true;
    return;
  }
  const summary = sessionSummary(session);
  const unknown = summary.unknown ? ` ${t("sbc.summaryUnknown", { n: summary.unknown })}` : "";
  summaryEl.innerHTML =
    t("sbc.summaryCounts", { placed: summary.placed, total: summary.total, missing: summary.missing }) +
    (summary.missing ? ` · ${t("sbc.summaryBudget", { budget: formatCoins(summary.budget) })}${unknown}` : "") +
    (summary.coins ? ` · ${t("sbc.summaryCoins", { coins: formatCoins(summary.coins) })}` : "");
  summaryEl.classList.toggle("is-short", !!(summary.coins && summary.budget > summary.coins));
  const busy = !!running;
  applyBtn.disabled = busy;
  buyBtn.disabled = busy || !summary.missing;
  stopBtn.hidden = !busy;
  qs(modal, "[data-sbc-load]").disabled = busy;
};

const schedulePaint = () => {
  if (repaintTimer) {
    return;
  }
  repaintTimer = setTimeout(() => {
    repaintTimer = null;
    if (session) {
      session.entries.forEach((_, index) => paintRow(index));
    }
  }, 250);
};

const closeModal = () => {
  if (running) {
    setStatus(t("sbc.statusBusyClose"), "warn");
    return;
  }
  if (modal) {
    modal.remove();
    modal = null;
  }
  releaseSession(session);
  session = null;
  if (unwatchPrices) {
    unwatchPrices();
    unwatchPrices = null;
  }
};

const openModal = () => {
  if (modal) {
    return;
  }
  const ctrl = activeCtrl;
  if (!ctrlAlive(ctrl)) {
    return;
  }
  injectStyles();
  modal = document.createElement("div");
  modal.id = "mb-sbc";
  modal.innerHTML = modalHtml(ctrl._challenge && ctrl._challenge.name);
  ["pointerdown", "mousedown", "touchstart", "touchend", "mouseup", "pointerup", "keydown", "keyup"].forEach((type) =>
    modal.addEventListener(type, (event) => event.stopPropagation())
  );
  modal.addEventListener("click", onClick);
  modal.addEventListener("change", onChange);
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    } else if (event.key === "Enter" && event.target.matches("[data-sbc-url]")) {
      load();
    } else if (event.key === "Enter" && event.target.matches("[data-sbc-max]")) {
      event.target.blur();
    }
  });
  document.body.appendChild(modal);
  modal.__ctrl = ctrl;
  const url = lastUrls.get(challengeKey(ctrl));
  const input = qs(modal, "[data-sbc-url]");
  if (url) {
    input.value = url;
  }
  input.focus();
  unwatchPrices = onPriceUpdate(() => schedulePaint());
  if (fab) {
    fab.hidden = true;
  }
  // Défi déjà fait avec une solution FUTBIN (DCE répétable) : la même solution est relue (sans rien
  // placer : l'équipe n'est remplie qu'avec « Placer dans l'équipe »). Jamais pendant le bot ou une tâche.
  if (url && !isRunning() && !currentTask()) {
    setStatus(t("sbc.statusReloadingLast"));
    load({ auto: true });
  }
};

// ---------------------------------------------------------------------- actions

const load = async ({ auto = false } = {}) => {
  if (!modal || running || loading) {
    return;
  }
  const url = qs(modal, "[data-sbc-url]").value.trim();
  if (!url) {
    setStatus(t("sbc.statusNoUrl"), "warn");
    return;
  }
  const ctrl = modal.__ctrl;
  rememberUrl(challengeKey(ctrl), url);
  releaseSession(session);
  session = null;
  renderTable();
  setStatus(t("sbc.statusLoading"));
  qs(modal, "[data-sbc-load]").disabled = true;
  loading = true;
  try {
    const result = await loadSolution(ctrl, url);
    if (!modal) {
      if (result.session) {
        releaseSession(result.session);
      }
      return;
    }
    if (!result.ok) {
      setStatus(result.message, "error");
      return;
    }
    session = result.session;
    renderTable();
    if (session.ownedErrors.length) {
      setStatus(t("sbc.statusClubIncomplete", { error: session.ownedErrors[0].label }), "warn");
      return;
    }
    // Solution lue dans le JSON de FUTBIN : fiable, l'équipe est remplie tout de suite. Lecture du HTML
    // (secours) : seulement si toute l'équipe a été reconnue.
    const open = (session.slots || []).filter((slot) => !slot.brick).length;
    const complete = session.source === "json" || session.entries.length >= Math.min(11, open || 11);
    if (!complete) {
      setStatus(plural(session.entries.length, "sbc.statusPartialOne", "sbc.statusPartialMany"), "warn");
      return;
    }
    // Rechargement automatique (défi répétable) : rien n'est placé sans l'accord de l'utilisateur.
    if (auto) {
      const summary = sessionSummary(session);
      setStatus(t("sbc.statusReloaded", { placed: summary.placed, total: summary.total }), "ok");
      return;
    }
    // Solution complète : l'équipe du défi est remplie tout de suite avec les joueurs du club.
    setStatus(t("sbc.statusPlacingClub"));
    const placed = await applySession(session);
    if (!modal) {
      return;
    }
    renderTable();
    const summary = sessionSummary(session);
    if (!placed.ok) {
      setStatus(placed.message, "error");
    } else {
      setStatus(
        summary.missing
          ? plural(summary.missing, "sbc.statusFilledOne", "sbc.statusFilledMany", { placed: summary.placed, total: summary.total })
          : t("sbc.statusFilledAll"),
        "ok"
      );
    }
  } catch (e) {
    setStatus(t("sbc.statusError", { error: errorMessage(e) }), "error");
  } finally {
    loading = false;
    if (modal) {
      qs(modal, "[data-sbc-load]").disabled = false;
      paintSummary();
    }
  }
};

const apply = async () => {
  if (!session || running) {
    return;
  }
  setStatus(t("sbc.statusSaving"));
  const result = await applySession(session);
  if (!modal) {
    return;
  }
  renderTable();
  setStatus(result.ok ? t("sbc.statusSaved") : result.message, result.ok ? "ok" : "error");
};

const buy = async () => {
  if (!session || running) {
    return;
  }
  if (isRunning()) {
    setStatus(t("sbc.statusBotRunning"), "warn");
    return;
  }
  const summary = sessionSummary(session);
  if (summary.unknown) {
    setStatus(t("sbc.statusUnknownPrices"), "warn");
    return;
  }
  if (summary.coins && summary.budget > summary.coins) {
    setStatus(t("sbc.statusOverBudget", { budget: formatCoins(summary.budget), coins: formatCoins(summary.coins) }), "warn");
    return;
  }
  const task = beginTask(t("sbc.taskLabel"));
  if (!task) {
    const other = currentTask();
    setStatus(t("sbc.statusOtherTask", { task: other ? other.label : "?" }), "warn");
    return;
  }
  running = task;
  paintSummary();
  setStatus(t("sbc.statusBuying"));
  log.info(plural(summary.missing, "sbc.logBuyStartOne", "sbc.logBuyStartMany", { budget: formatCoins(summary.budget) }));
  let report;
  try {
    // Le placement déjà possédé est fait d'abord : les achats complètent l'équipe.
    await applySession(session);
    renderTable();
    report = await buyMissing(session, {
      token: task.token,
      onUpdate: (entry) => paintRow(session.entries.indexOf(entry)),
    });
  } catch (e) {
    report = { bought: 0, spent: 0, failed: 0, stopped: errorMessage(e) };
  } finally {
    endTask(task);
    running = null;
  }
  if (!modal) {
    return;
  }
  renderTable();
  const text =
    t("sbc.reportBought", { n: report.bought, spent: formatCoins(report.spent) }) +
    (report.failed ? ` · ${t("sbc.reportFailed", { n: report.failed })}` : "") +
    (report.stopped ? ` · ${t("sbc.reportStopped", { reason: report.stopped })}` : "") +
    `. ${t("sbc.reportCheck")}`;
  setStatus(text, report.stopped || report.failed ? "warn" : "ok");
  log.info(t("sbc.logBuyDone", { text }));
};

function onClick(event) {
  const target = event.target;
  if (target.closest("[data-sbc-close]")) {
    closeModal();
  } else if (target.closest("[data-sbc-load]")) {
    load();
  } else if (target.closest("[data-sbc-apply]")) {
    apply();
  } else if (target.closest("[data-sbc-buy]")) {
    buy();
  } else if (target.closest("[data-sbc-stop]")) {
    cancelTask();
    setStatus(t("sbc.statusStopping"), "warn");
  }
}

function onChange(event) {
  const input = event.target.closest("[data-sbc-max]");
  if (!input || !session) {
    return;
  }
  const entry = session.entries[Number(input.dataset.sbcMax)];
  if (!entry) {
    return;
  }
  const value = floorPrice(parseCoinsInput(input.value));
  entry.manual = value > 0;
  entry.maxPrice = value;
  input.value = value ? String(value) : "";
  paintSummary();
}

export const closeSbcModal = () => closeModal();
