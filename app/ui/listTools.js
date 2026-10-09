import { RELIST_INTERVALS, autoRelistState, onAutoRelistChange, setAutoRelistRefresher, startAutoRelist, stopAutoRelist } from "../core/autoRelist";
import { bulkOptions, estimatedProfit, isListable, listRows, paidFor, previousListing, proposedPrice } from "../core/bulkList";
import { isRunning } from "../core/engine";
import { log } from "../core/logger";
import { auctionOf, moveItems, nameOf } from "../core/market";
import { routeUnassigned, routingSummary } from "../core/packs";
import { pageGlobal, pile, repositories } from "../core/page";
import { afterTax, formatCoins, roundPrice, toInt } from "../core/prices";
import { getSettings, onSettingsChange, setSetting } from "../core/settings";
import { cancelTask, endTask } from "../core/tasks";
import { startToolTask } from "../core/toolTask";
import { plural, t } from "../i18n";
import { currentPrice } from "../prices/priceService";
import { shortCoins } from "./cardPrices";
import { escapeHtml } from "./dom";

// Listes EA (liste des transferts, non attribués, objectifs de transfert) : sous l'en-tête de chaque
// section, les totaux (achat immédiat, enchères, valeur FUTBIN ; ventes et bénéfice pour « Vendus »)
// et un menu ⋮ : mise en vente groupée (fenêtre avec prix par carte), relist auto, envoi au club,
// rangement des non attribués. Les sections EA sont lues dans renderSection(objets, n°), enveloppé
// pour les trois vues (méthodes sans appel à superclass()).

const TOOLS = "mb-list-tools";
const VIEWS = [
  { name: "UTTransferListView", kind: "transfer" },
  { name: "UTUnassignedItemsView", kind: "unassigned" },
  { name: "UTWatchListView", kind: "watch" },
];
// Numéros de section EA (UTTransferSectionListViewModel / UTWatchSectionListViewModel).
const TRANSFER = { SOLD: 0, UNSOLD: 1, AVAILABLE: 2, ACTIVE: 3 };
const WATCH = { ACTIVE: 0, WATCHED: 1, WON: 2, EXPIRED: 3 };
const USABLE = 10 * 60 * 1000;

const call = (target, method) => {
  try {
    return target && typeof target[method] === "function" ? target[method]() : undefined;
  } catch (e) {
    return undefined;
  }
};

const isPlayer = (item) => !!call(item, "isPlayer");

// ------------------------------------------------------------ totaux

const totalsOf = (kind, index, items) => {
  const out = { count: items.length, bin: 0, bid: 0, futbin: 0, priced: 0, players: 0, sold: 0, net: 0, profit: 0, profitKnown: 0 };
  items.forEach((item) => {
    const auction = auctionOf(item) || {};
    out.bin += Number(auction.buyNowPrice) || 0;
    out.bid += Number(auction.currentBid) || Number(auction.startingBid) || 0;
    if (isPlayer(item)) {
      out.players += 1;
      const price = currentPrice(Number(item.definitionId) || 0, USABLE, "sell");
      if (price) {
        out.futbin += price;
        out.priced += 1;
      }
    }
    if (kind === "transfer" && index === TRANSFER.SOLD) {
      const sold = Number(auction.currentBid) || Number(auction.buyNowPrice) || 0;
      out.sold += sold;
      out.net += afterTax(sold);
      const paid = paidFor(item);
      if (paid) {
        out.profit += afterTax(sold) - paid;
        out.profitKnown += 1;
      }
    }
  });
  return out;
};

const totalsText = (kind, index, items) => {
  if (!items.length) {
    return "";
  }
  const totals = totalsOf(kind, index, items);
  if (kind === "transfer" && index === TRANSFER.SOLD) {
    return t("lists.totalsSold", {
      sold: formatCoins(totals.sold),
      net: formatCoins(totals.net),
      profit: totals.profitKnown ? `${totals.profit >= 0 ? "+" : "−"}${formatCoins(Math.abs(totals.profit))}` : "—",
    });
  }
  const parts = [];
  if (totals.bin) {
    parts.push(t("lists.totalsBin", { value: shortCoins(totals.bin) }));
  }
  if (totals.bid && kind !== "unassigned") {
    parts.push(t("lists.totalsBid", { value: shortCoins(totals.bid) }));
  }
  if (totals.priced) {
    parts.push(t("lists.totalsFutbin", { value: shortCoins(totals.futbin), n: totals.priced, total: totals.players }));
  }
  return parts.join(" · ");
};

// ------------------------------------------------------------ actions du menu

const actionsFor = (kind, index) => {
  const actions = [];
  if ((kind === "transfer" && (index === TRANSFER.UNSOLD || index === TRANSFER.AVAILABLE)) || kind === "unassigned" || (kind === "watch" && index === WATCH.WON)) {
    actions.push("bulk");
  }
  if (kind === "transfer" && (index === TRANSFER.ACTIVE || index === TRANSFER.UNSOLD)) {
    actions.push("relist");
  }
  if (kind === "transfer" && index === TRANSFER.AVAILABLE) {
    actions.push("club");
  }
  if (kind === "unassigned") {
    actions.push("route");
  }
  return actions;
};

// Contrôleur EA affiché (liste) : rechargé après nos mises en vente / déplacements.
const currentController = () => {
  try {
    return pageGlobal("getAppMain")().getRootViewController().getPresentedViewController().getCurrentViewController().getCurrentController();
  } catch (e) {
    return null;
  }
};

const refreshList = (pileName) => {
  try {
    if (pileName) {
      repositories().Item.setDirty(pile(pileName));
    }
  } catch (e) {}
  const ctrl = currentController();
  const target = ctrl && (typeof ctrl.refreshList === "function" ? ctrl : ctrl.getCurrentController && ctrl.getCurrentController());
  try {
    if (target && typeof target.refreshList === "function") {
      target.refreshList();
    } else if (target && typeof target._requestItems === "function") {
      target._requestItems();
    }
  } catch (e) {}
};

setAutoRelistRefresher(() => refreshList("TRANSFER"));

const sendToClub = async (items) => {
  const wanted = items.filter((item) => !call(item, "isDuplicate") && !call(item, "isLimitedUse"));
  if (!wanted.length) {
    log.info(t("lists.clubNothing"));
    return;
  }
  const { task, error } = startToolTask(t("lists.taskClub"));
  if (!task) {
    log.warn(error);
    return;
  }
  try {
    const moved = await moveItems(wanted, "CLUB");
    log.info(t("lists.clubDone", { n: moved.moved ? moved.moved.length : 0, total: wanted.length }));
  } finally {
    endTask(task);
    refreshList("TRANSFER");
  }
};

const routeAll = async () => {
  const { task, error } = startToolTask(t("lists.taskRoute"));
  if (!task) {
    log.warn(error);
    return;
  }
  try {
    const report = await routeUnassigned({ token: task.token });
    log.info(`${t("lists.routeDone")} ${routingSummary(report)}`);
  } finally {
    endTask(task);
    refreshList("PURCHASED");
  }
};

// ------------------------------------------------------------ en-têtes de section

const sections = new Set();

const toolsHtml = (entry) => {
  const text = totalsText(entry.kind, entry.index, entry.items);
  const actions = actionsFor(entry.kind, entry.index);
  const relist = autoRelistState();
  const relistLine =
    entry.kind === "transfer" && entry.index === TRANSFER.ACTIVE && relist.active
      ? `<span class="mb-list-relist">${escapeHtml(t("lists.relistActive", { n: relist.interval, next: Math.max(0, Math.round((relist.nextAt - Date.now()) / 60000)) }))}</span>`
      : "";
  if (!text && !actions.length && !relistLine) {
    return "";
  }
  const showTotals = (getSettings().lists || {}).totals !== false;
  return `<span class="mb-list-totals">${showTotals ? escapeHtml(text) : ""}</span>${relistLine}
    ${actions.length ? `<button type="button" class="mb-list-more" data-mb-list-menu aria-label="${escapeHtml(t("lists.menu"))}" title="${escapeHtml(t("lists.menu"))}">⋮</button>` : ""}
    <div class="mb-list-pop" data-mb-list-pop hidden>${actions
      .map((action) => {
        if (action === "relist") {
          return relist.active
            ? `<button type="button" data-mb-list-action="relist-stop">${escapeHtml(t("lists.relistStop"))}</button>`
            : RELIST_INTERVALS.map((n) => `<button type="button" data-mb-list-action="relist" data-n="${n}">${escapeHtml(t("lists.relistEvery", { n }))}</button>`).join("");
        }
        return `<button type="button" data-mb-list-action="${action}">${escapeHtml(t(`lists.action_${action}`))}</button>`;
      })
      .join("")}</div>`;
};

const paintSection = (entry) => {
  if (!entry.header || !entry.header.isConnected) {
    sections.delete(entry);
    return;
  }
  let tools = entry.header.querySelector(`:scope > .${TOOLS}`);
  const html = toolsHtml(entry);
  if (!html) {
    if (tools) {
      tools.remove();
    }
    return;
  }
  if (!tools) {
    tools = document.createElement("div");
    tools.className = TOOLS;
    ["pointerdown", "mousedown", "touchstart", "touchend", "mouseup", "pointerup"].forEach((type) => tools.addEventListener(type, (event) => event.stopPropagation()));
    tools.addEventListener("click", (event) => onToolsClick(event, entry));
    entry.header.appendChild(tools);
  }
  // Menu ⋮ ouvert sur cette section : pas redessinée (le menu resterait sans son bouton).
  if (portal && portal.entry === entry) {
    return;
  }
  if (tools.dataset.html !== html) {
    tools.dataset.html = html;
    tools.innerHTML = html;
  }
};

// Menu ⋮ affiché dans le document (position fixe) : jamais recouvert par les cartes de la liste
// EA ni coupé par son défilement. Fermé au clic à côté, au défilement et au changement d'écran.
let portal = null;

const closePortal = () => {
  if (!portal) {
    return;
  }
  const current = portal;
  portal = null;
  current.el.remove();
  document.removeEventListener("pointerdown", current.outside, true);
  window.removeEventListener("resize", closePortal);
  window.removeEventListener("scroll", current.onScroll, true);
};

const openPortal = (entry, button, html) => {
  closePortal();
  const el = document.createElement("div");
  el.className = "mb-list-pop mb-list-pop-portal";
  el.innerHTML = html;
  document.body.appendChild(el);
  const rect = button.getBoundingClientRect();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const below = rect.bottom + 4;
  const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : below;
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width)))}px`;
  ["pointerdown", "mousedown", "touchstart", "touchend", "mouseup", "pointerup"].forEach((type) => el.addEventListener(type, (event) => event.stopPropagation()));
  el.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const choice = event.target.closest("[data-mb-list-action]");
    if (choice) {
      closePortal();
      runListAction(entry, choice.dataset.mbListAction, Number(choice.dataset.n));
    }
  });
  const outside = (event) => {
    if (!el.contains(event.target) && !button.contains(event.target)) {
      closePortal();
    }
  };
  // Défilement de la page ou de la liste : le menu ne suivrait pas son bouton.
  const onScroll = (event) => {
    if (!el.contains(event.target)) {
      closePortal();
    }
  };
  portal = { el, entry, button, outside, onScroll };
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", closePortal);
  window.addEventListener("scroll", onScroll, true);
};

const onToolsClick = (event, entry) => {
  event.preventDefault();
  event.stopPropagation();
  const tools = event.currentTarget;
  const menu = event.target.closest("[data-mb-list-menu]");
  if (menu) {
    if (portal && portal.entry === entry) {
      closePortal();
      return;
    }
    const pop = tools.querySelector("[data-mb-list-pop]");
    if (pop) {
      openPortal(entry, menu, pop.innerHTML);
    }
  }
};

const runListAction = (entry, action, n) => {
  if (action === "bulk") {
    openBulk(entry);
  } else if (action === "relist") {
    if (isRunning()) {
      log.warn(t("lists.relistBotRunning"));
    } else {
      startAutoRelist(n);
    }
  } else if (action === "relist-stop") {
    stopAutoRelist();
  } else if (action === "club") {
    sendToClub(entry.items);
  } else if (action === "route") {
    routeAll();
  }
  const tools = entry.header && entry.header.querySelector(`:scope > .${TOOLS}`);
  if (tools) {
    tools.dataset.html = "";
  }
  paintSection(entry);
};

const hookViews = () => {
  VIEWS.forEach(({ name, kind }) => {
    const View = pageGlobal(name);
    if (typeof View !== "function" || !View.prototype || typeof View.prototype.renderSection !== "function" || View.prototype.__mbLists) {
      return;
    }
    const original = View.prototype.renderSection;
    View.prototype.renderSection = function (items, index) {
      const result = original.apply(this, arguments);
      try {
        const section = (this.sections && this.sections[index]) || result;
        const header = section && section._header && typeof section._header.getRootElement === "function" ? section._header.getRootElement() : null;
        if (header) {
          // Une seule entrée par en-tête (la section est réutilisée par EA à chaque rendu).
          sections.forEach((entry) => {
            if (entry.header === header) {
              sections.delete(entry);
            }
          });
          const entry = { kind, index: Number(index), items: Array.from(items || []), header };
          sections.add(entry);
          paintSection(entry);
        }
      } catch (e) {}
      return result;
    };
    View.prototype.__mbLists = true;
  });
};

let bound = false;

export const tickListTools = () => {
  hookViews();
  if (!bound) {
    bound = true;
    onAutoRelistChange(() => sections.forEach((entry) => paintSection(entry)));
    onSettingsChange((all, path) => {
      if (path === "*" || /^(lists\.|ui\.language)/.test(path)) {
        sections.forEach((entry) => paintSection(entry));
      }
    });
  }
  // Totaux FUTBIN mis à jour à l'arrivée des prix (rendu léger, une fois par seconde).
  sections.forEach((entry) => paintSection(entry));
  // Écran changé : le menu ⋮ de la section disparue est fermé.
  if (portal && !(portal.entry.header && portal.entry.header.isConnected && portal.button.isConnected)) {
    closePortal();
  }
};

// ------------------------------------------------------------ fenêtre de mise en vente groupée

let bulk = null;

const rowState = (row) => (bulk && bulk.states.get(row.key)) || null;

const bulkRowsFor = (items, options) =>
  items.filter(isListable).map((item, index) => {
    const proposal = proposedPrice(item, options);
    return { key: index, item, price: proposal.price ? String(proposal.price) : "", reference: proposal.reference, selected: !!proposal.price };
  });

const bulkHtml = () => {
  const options = bulk.options;
  const rows = bulk.rows;
  const selected = rows.filter((row) => row.selected);
  const total = selected.reduce((sum, row) => sum + toInt(row.price), 0);
  const known = selected.filter((row) => estimatedProfit(row.item, toInt(row.price)) != null);
  const profit = known.reduce((sum, row) => sum + estimatedProfit(row.item, toInt(row.price)), 0);
  const option = (name, value, label, current) => `<option value="${value}"${String(current) === String(value) ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const durations = ["1H", "3H", "6H", "12H", "1D", "3D"];
  const body = rows
    .map((row) => {
      const state = rowState(row);
      const price = toInt(row.price);
      const result = estimatedProfit(row.item, price);
      const previous = previousListing(row.item);
      return `<tr class="${state ? `is-${escapeHtml(state.state)}` : ""}">
          <td><input type="checkbox" data-mb-bulk-pick="${row.key}"${row.selected ? " checked" : ""}${bulk.running ? " disabled" : ""}></td>
          <td><b>${escapeHtml(nameOf(row.item))}</b> <span class="mb-gx-muted">${Number(row.item.rating) || ""}</span></td>
          <td>${row.reference ? formatCoins(row.reference) : "—"}</td>
          <td>${paidFor(row.item) ? formatCoins(paidFor(row.item)) : "—"}</td>
          <td>${previous ? formatCoins(previous) : "—"}</td>
          <td><input class="mb-gx-input" inputmode="numeric" data-mb-bulk-price="${row.key}" value="${escapeHtml(row.price)}"${bulk.running ? " disabled" : ""}></td>
          <td class="${result != null && result < 0 ? "mb-gx-warn" : ""}">${result == null ? "—" : `${result >= 0 ? "+" : "−"}${formatCoins(Math.abs(result))}`}</td>
          <td class="mb-gx-muted mb-gx-small">${state ? escapeHtml(state.note || t(`lists.state_${state.state}`)) : ""}</td>
        </tr>`;
    })
    .join("");
  return `<div class="mb-gx-modal" data-mb-bulk-backdrop><div class="mb-gx-modal-card" role="dialog" aria-modal="true">
      <h3>${escapeHtml(t("lists.bulkTitle"))}</h3>
      <div class="mb-gx-modal-grid">
        <label>${escapeHtml(t("lists.bulkMode"))}<select class="mb-gx-input" data-mb-bulk-opt="mode"${bulk.running ? " disabled" : ""}>
          ${option("mode", "percent", t("lists.modePercent"), options.mode)}${option("mode", "steps", t("lists.modeSteps"), options.mode)}${option("mode", "fixed", t("lists.modeFixed"), options.mode)}</select></label>
        ${options.mode === "percent" ? `<label>${escapeHtml(t("lists.bulkPercent"))}<input class="mb-gx-input" data-mb-bulk-opt="percent" value="${escapeHtml(options.percent)}" placeholder="95-100"></label>` : ""}
        ${options.mode === "steps" ? `<label>${escapeHtml(t("lists.bulkSteps"))}<input class="mb-gx-input" type="number" min="-20" max="20" data-mb-bulk-opt="steps" value="${escapeHtml(String(options.steps))}"></label>` : ""}
        ${options.mode === "fixed" ? `<label>${escapeHtml(t("lists.bulkFixed"))}<input class="mb-gx-input" inputmode="numeric" data-mb-bulk-opt="fixed" value="${escapeHtml(String(options.fixed || ""))}"></label>` : ""}
        <label>${escapeHtml(t("lists.bulkDuration"))}<select class="mb-gx-input" data-mb-bulk-opt="duration"${bulk.running ? " disabled" : ""}>${durations.map((value) => option("duration", value, t(`ui.duration${value}`), options.duration)).join("")}</select></label>
        <label>${escapeHtml(t("lists.bulkDelay"))}<input class="mb-gx-input" data-mb-bulk-opt="delay" value="${escapeHtml(options.delay)}" placeholder="3-5"></label>
      </div>
      <div class="mb-gx-row"><button type="button" class="mb-gx-button is-outline is-sm" data-mb-bulk="apply"${bulk.running ? " disabled" : ""}>${escapeHtml(t("lists.bulkApply"))}</button>
        <span class="mb-gx-muted mb-gx-small">${escapeHtml(t("lists.bulkHint"))}</span></div>
      <div class="mb-gx-table-wrap"><table class="mb-gx-table"><thead><tr><th></th><th>${escapeHtml(t("lists.colPlayer"))}</th><th>FUTBIN</th><th>${escapeHtml(t("lists.colPaid"))}</th><th>${escapeHtml(t("lists.colPrevious"))}</th><th>${escapeHtml(t("lists.colPrice"))}</th><th>${escapeHtml(t("lists.colProfit"))}</th><th></th></tr></thead><tbody>${body || `<tr><td colspan="8">${escapeHtml(t("lists.bulkEmpty"))}</td></tr>`}</tbody></table></div>
      <p class="mb-gx-modal-total">${escapeHtml(t("lists.bulkTotal", { n: selected.length, total: formatCoins(total), net: formatCoins(afterTax(total)), profit: known.length ? `${profit >= 0 ? "+" : "−"}${formatCoins(Math.abs(profit))}` : "—" }))}</p>
      ${bulk.message ? `<p class="mb-gx-status" data-kind="${escapeHtml(bulk.messageKind || "")}">${escapeHtml(bulk.message)}</p>` : ""}
      <div class="mb-gx-modal-actions">
        ${bulk.running ? `<button type="button" class="mb-gx-button is-danger" data-mb-bulk="stop">${escapeHtml(t("lists.stop"))}</button>` : `<button type="button" class="mb-gx-button is-ghost" data-mb-bulk="close">${escapeHtml(t("lists.close"))}</button>
        <button type="button" class="mb-gx-button" data-mb-bulk="list"${selected.length ? "" : " disabled"}>${escapeHtml(plural(selected.length, "lists.bulkGoOne", "lists.bulkGoMany"))}</button>`}
      </div>
    </div></div>`;
};

const paintBulk = () => {
  if (!bulk) {
    return;
  }
  const active = document.activeElement;
  const focus = active && bulk.host.contains(active) && active.tagName === "INPUT" ? { key: active.dataset.mbBulkPrice || active.dataset.mbBulkOpt, attr: active.dataset.mbBulkPrice ? "data-mb-bulk-price" : "data-mb-bulk-opt", start: active.selectionStart } : null;
  bulk.host.innerHTML = bulkHtml();
  if (focus && focus.key != null) {
    const target = bulk.host.querySelector(`[${focus.attr}="${focus.key}"]`);
    if (target) {
      target.focus();
      try {
        target.setSelectionRange(focus.start, focus.start);
      } catch (e) {}
    }
  }
};

const closeBulk = () => {
  if (bulk && !bulk.running) {
    bulk.host.remove();
    bulk = null;
  }
};

const runBulk = async () => {
  const rows = bulk.rows.filter((row) => row.selected).map((row) => ({ key: row.key, item: row.item, price: roundPrice(toInt(row.price)) }));
  if (!rows.length) {
    return;
  }
  const { task, error } = startToolTask(t("lists.taskBulk"));
  if (!task) {
    bulk.message = error;
    bulk.messageKind = "warn";
    paintBulk();
    return;
  }
  // Réglages gardés pour la prochaine fois.
  const options = bulk.options;
  setSetting("lists.bulkMode", options.mode);
  setSetting("lists.bulkPercent", String(options.percent || "100"));
  setSetting("lists.bulkSteps", Math.trunc(Number(options.steps) || 0));
  setSetting("lists.bulkFixed", toInt(options.fixed));
  setSetting("lists.bulkDuration", options.duration);
  setSetting("lists.bulkDelay", String(options.delay || "3-5"));
  bulk.running = true;
  bulk.message = t("lists.bulkRunning", { n: rows.length });
  bulk.messageKind = "";
  paintBulk();
  let report = { listed: 0, skipped: 0, failed: 0, raised: 0, stopped: "" };
  try {
    report = await listRows(rows, {
      token: task.token,
      duration: options.duration,
      delay: options.delay,
      onUpdate: (row, state, note) => {
        if (bulk) {
          bulk.states.set(row.key, { state, note });
          paintBulk();
        }
      },
    });
  } finally {
    endTask(task);
    if (bulk) {
      bulk.running = false;
    }
    refreshList(bulk && bulk.listKind === "unassigned" ? "PURCHASED" : "TRANSFER");
  }
  if (bulk) {
    bulk.message =
      t("lists.bulkReport", { listed: report.listed, total: rows.length }) +
      (report.raised ? ` · ${t("lists.bulkRaised", { n: report.raised })}` : "") +
      (report.skipped ? ` · ${t("lists.bulkSkipped", { n: report.skipped })}` : "") +
      (report.stopped ? ` · ${report.stopped}` : "");
    bulk.messageKind = report.failed || report.stopped ? "warn" : "ok";
    paintBulk();
  }
};

const openBulk = (entry) => {
  if (bulk) {
    closeBulk();
  }
  const options = bulkOptions();
  const host = document.createElement("div");
  host.className = "mb-gx-vars mb-bulk-host";
  document.body.appendChild(host);
  bulk = { host, options, rows: bulkRowsFor(entry.items, options), states: new Map(), running: false, message: "", messageKind: "", listKind: entry.kind };
  ["pointerdown", "mousedown", "touchstart", "keydown"].forEach((type) => host.addEventListener(type, (event) => event.stopPropagation()));
  host.addEventListener("click", (event) => {
    if (!bulk) {
      return;
    }
    if (event.target.matches("[data-mb-bulk-backdrop]")) {
      closeBulk();
      return;
    }
    const action = event.target.closest("[data-mb-bulk]");
    if (!action) {
      return;
    }
    switch (action.dataset.mbBulk) {
      case "close":
        closeBulk();
        break;
      case "stop":
        cancelTask();
        break;
      case "apply":
        bulk.rows.forEach((row) => {
          const proposal = proposedPrice(row.item, bulk.options);
          row.price = proposal.price ? String(proposal.price) : "";
          row.reference = proposal.reference;
          row.selected = !!proposal.price;
        });
        bulk.states.clear();
        paintBulk();
        break;
      case "list":
        runBulk();
        break;
      default:
        break;
    }
  });
  host.addEventListener("change", (event) => {
    if (!bulk) {
      return;
    }
    const pick = event.target.closest("[data-mb-bulk-pick]");
    if (pick) {
      const row = bulk.rows.find((entry) => String(entry.key) === pick.dataset.mbBulkPick);
      if (row) {
        row.selected = pick.checked;
        paintBulk();
      }
      return;
    }
    const opt = event.target.closest("[data-mb-bulk-opt]");
    if (opt && opt.tagName === "SELECT") {
      bulk.options[opt.dataset.mbBulkOpt] = opt.value;
      paintBulk();
    }
  });
  host.addEventListener("input", (event) => {
    if (!bulk) {
      return;
    }
    const price = event.target.closest("[data-mb-bulk-price]");
    if (price) {
      const row = bulk.rows.find((entry) => String(entry.key) === price.dataset.mbBulkPrice);
      if (row) {
        row.price = event.target.value;
        row.selected = !!toInt(row.price);
      }
      return;
    }
    const opt = event.target.closest("[data-mb-bulk-opt]");
    if (opt && opt.tagName === "INPUT") {
      bulk.options[opt.dataset.mbBulkOpt] = event.target.value;
    }
  });
  host.addEventListener("focusout", () => {
    // Fin de saisie d'un prix : totaux et bénéfice recalculés.
    setTimeout(() => {
      if (bulk && !(document.activeElement && bulk.host.contains(document.activeElement))) {
        paintBulk();
      }
    }, 0);
  });
  paintBulk();
};

// Utilisé par les tests.
export const listTotalsForTests = (kind, index, items) => totalsOf(kind, index, items);
export const listActionsForTests = (kind, index) => actionsFor(kind, index);
