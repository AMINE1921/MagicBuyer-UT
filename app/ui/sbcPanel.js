import { isRunning } from "../core/engine";
import { errorMessage, log } from "../core/logger";
import { pageGlobal } from "../core/page";
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
const lastUrls = new Map();

const STATE_LABEL = {
  owned: "Dans ton club",
  missing: "À acheter",
  searching: "Recherche…",
  bought: "Acheté",
  failed: "Échec",
};

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

const ensureFab = () => {
  if (fab && fab.isConnected) {
    return fab;
  }
  fab = document.createElement("button");
  fab.type = "button";
  fab.id = "mb-sbc-fab";
  fab.textContent = "⚡ Solution FUTBIN";
  fab.title = "Importer une solution FUTBIN dans ce défi (MagicBuyer)";
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
  button.hidden = !visible || !!modal;
};

// -------------------------------------------------------------------- fenêtre

const modalHtml = (title) => `
  <div class="mb-sbc-backdrop" data-sbc-close></div>
  <div class="mb-sbc-dialog" role="dialog" aria-modal="true" aria-label="Solution FUTBIN">
    <header class="mb-sbc-head">
      <div><strong>⚡ Solution FUTBIN</strong><small>${escapeHtml(title || "Défi")}</small></div>
      <button type="button" class="mb-sbc-x" data-sbc-close aria-label="Fermer">×</button>
    </header>
    <div class="mb-sbc-url">
      <input type="url" data-sbc-url placeholder="https://www.futbin.com/27/squad/…" autocomplete="off" spellcheck="false" aria-label="Lien FUTBIN" />
      <button type="button" class="mb-sbc-btn is-primary" data-sbc-load>Charger</button>
    </div>
    <p class="mb-sbc-status" data-sbc-status>Colle le lien FUTBIN d'une solution de ce défi (page de l'équipe), puis « Charger ».</p>
    <div class="mb-sbc-body" data-sbc-body></div>
    <footer class="mb-sbc-foot">
      <span class="mb-sbc-summary" data-sbc-summary></span>
      <button type="button" class="mb-sbc-btn" data-sbc-apply disabled>Placer dans l'équipe</button>
      <button type="button" class="mb-sbc-btn is-primary" data-sbc-buy disabled>Acheter les manquants</button>
      <button type="button" class="mb-sbc-btn is-danger" data-sbc-stop hidden>Stop</button>
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
  const link = player.url ? ` <a href="${escapeHtml(player.url)}" target="_blank" rel="noopener" title="Page FUTBIN">↗</a>` : "";
  return `<tr data-sbc-row="${index}" class="is-${entry.state}">
    <td class="mb-sbc-pos">${escapeHtml(entry.slotLabel || player.position || "—")}</td>
    <td><b>${escapeHtml(player.name || `#${player.eaId}`)}</b> <span class="mb-sbc-rating">${player.rating || ""}</span>${link}
      <small data-sbc-note>${escapeHtml(entry.note || (entry.source && entry.state === "owned" ? entry.source : ""))}</small></td>
    <td data-sbc-state>${STATE_LABEL[entry.state] || entry.state}</td>
    <td class="is-num"><span data-sbc-price>${price ? formatCoins(price) : "—"}</span><small data-sbc-age>${escapeHtml(priceStatus(entry))}</small></td>
    <td class="is-num">${
      editable
        ? `<input class="mb-sbc-max" data-sbc-max="${index}" inputmode="text" autocomplete="off" value="${entry.manual ? entry.maxPrice : ""}" placeholder="${auto ? auto : "à saisir"}" aria-label="Prix max pour ${escapeHtml(player.name)}" />`
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
    ? `Formation ${escapeHtml(session.futbinFormation || formationLabel(session.formation))} → ${escapeHtml(formationLabel(session.formation))}`
    : session.futbinFormation
    ? `Formation FUTBIN ${escapeHtml(session.futbinFormation)} introuvable : formation actuelle conservée`
    : "Formation actuelle conservée";
  const title = session.challengeName ? `Solution FUTBIN « ${escapeHtml(session.challengeName)} » · ` : "";
  body.innerHTML = `<p class="mb-sbc-meta">${title}${formation} · ${session.entries.length} joueur(s) · lu via ${session.via === "iframe" ? "page FUTBIN cachée" : "requête directe"}</p>
    <table class="mb-sbc-table">
      <thead><tr><th>Poste</th><th>Joueur</th><th>Statut</th><th class="is-num">FUTBIN</th><th class="is-num">Max</th></tr></thead>
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
  qs(row, "[data-sbc-state]").textContent = STATE_LABEL[entry.state] || entry.state;
  qs(row, "[data-sbc-note]").textContent = entry.note || (entry.source && entry.state === "owned" ? entry.source : "");
  const price = entryPrice(entry);
  qs(row, "[data-sbc-price]").textContent = price ? formatCoins(price) : "—";
  qs(row, "[data-sbc-age]").textContent = priceStatus(entry);
  if (input && document.activeElement !== input) {
    const auto = maxPriceFor(Object.assign({}, entry, { manual: false }));
    input.placeholder = auto ? String(auto) : "à saisir";
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
  summaryEl.innerHTML =
    `<b>${summary.placed}/${summary.total}</b> disponibles · <b>${summary.missing}</b> à acheter` +
    (summary.missing ? ` · budget max <b>${formatCoins(summary.budget)}</b>${summary.unknown ? ` (+${summary.unknown} sans prix)` : ""}` : "") +
    (summary.coins ? ` · tu as ${formatCoins(summary.coins)}` : "");
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
    setStatus("Achat en cours : clique sur Stop avant de fermer.", "warn");
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
};

// ---------------------------------------------------------------------- actions

const load = async () => {
  if (!modal || running || loading) {
    return;
  }
  const url = qs(modal, "[data-sbc-url]").value.trim();
  if (!url) {
    setStatus("Colle d'abord un lien FUTBIN.", "warn");
    return;
  }
  const ctrl = modal.__ctrl;
  lastUrls.set(challengeKey(ctrl), url);
  releaseSession(session);
  session = null;
  renderTable();
  setStatus("Lecture de la page FUTBIN et recherche dans ton club…");
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
      setStatus(`Recherche dans le club incomplète (${session.ownedErrors[0].label}) : vérifie la liste puis clique sur « Placer dans l'équipe ».`, "warn");
      return;
    }
    // Solution lue dans le JSON de FUTBIN : fiable, l'équipe est remplie tout de suite. Lecture du HTML
    // (secours) : seulement si toute l'équipe a été reconnue.
    const open = (session.slots || []).filter((slot) => !slot.brick).length;
    const complete = session.source === "json" || session.entries.length >= Math.min(11, open || 11);
    if (!complete) {
      setStatus(`Seulement ${session.entries.length} joueur(s) lus sur la page FUTBIN : vérifie la liste puis clique sur « Placer dans l'équipe ».`, "warn");
      return;
    }
    // Solution complète : l'équipe du défi est remplie tout de suite avec les joueurs du club.
    setStatus("Placement des joueurs de ton club dans l'équipe…");
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
          ? `Équipe remplie : ${summary.placed}/${summary.total} joueurs placés. Vérifie les prix max des ${summary.missing} manquant(s) puis « Acheter les manquants ».`
          : "Équipe remplie avec tes joueurs. Vérifie les exigences puis envoie le défi toi-même.",
        "ok"
      );
    }
  } catch (e) {
    setStatus(`Erreur : ${errorMessage(e)}`, "error");
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
  setStatus("Placement des joueurs et enregistrement du défi…");
  const result = await applySession(session);
  if (!modal) {
    return;
  }
  renderTable();
  setStatus(result.ok ? "Équipe enregistrée. Vérifie les exigences puis envoie le défi toi-même." : result.message, result.ok ? "ok" : "error");
};

const buy = async () => {
  if (!session || running) {
    return;
  }
  if (isRunning()) {
    setStatus("Arrête d'abord le bot (panneau MagicBuyer) : un seul automatisme à la fois.", "warn");
    return;
  }
  const summary = sessionSummary(session);
  if (summary.unknown) {
    setStatus("Certains manquants n'ont pas de prix FUTBIN en direct : indique un prix max pour chacun (champ « à saisir »).", "warn");
    return;
  }
  if (summary.coins && summary.budget > summary.coins) {
    setStatus(`Budget max ${formatCoins(summary.budget)} supérieur à tes coins (${formatCoins(summary.coins)}) : baisse des prix max ou libère des coins.`, "warn");
    return;
  }
  const task = beginTask("achat DCE");
  if (!task) {
    const other = currentTask();
    setStatus(`Une autre tâche est en cours (${other ? other.label : "?"}).`, "warn");
    return;
  }
  running = task;
  paintSummary();
  setStatus("Achat des joueurs manquants… (tu peux arrêter à tout moment)");
  log.info(`DCE : achat de ${summary.missing} joueur(s) manquant(s), budget max ${formatCoins(summary.budget)}.`);
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
    `${report.bought} acheté(s) pour ${formatCoins(report.spent)}` +
    (report.failed ? ` · ${report.failed} non trouvé(s) sous ton prix max` : "") +
    (report.stopped ? ` · arrêt : ${report.stopped}` : "") +
    ". Vérifie l'équipe puis envoie le défi toi-même.";
  setStatus(text, report.stopped || report.failed ? "warn" : "ok");
  log.info(`DCE terminé : ${text}`);
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
    setStatus("Arrêt demandé : fin de la requête en cours…", "warn");
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
