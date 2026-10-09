import {
  clampRating,
  clubCsv,
  downloadText,
  ensurePrices,
  futbinTotal,
  loadClubPlayers,
  quickSell,
  quickSellValue,
  selectPlayers,
  sendToTransferList,
  squadIds,
  storageToClub,
} from "../../core/clubTools";
import { analyzeClub } from "../../core/clubAnalysis";
import { log } from "../../core/logger";
import { nameOf } from "../../core/market";
import { listOwnedPacks, openPacks, routeUnassigned, routingSummary } from "../../core/packs";
import { formatCoins, toInt } from "../../core/prices";
import { currentPrice } from "../../prices/priceService";
import { getSettings, setSetting } from "../../core/settings";
import { cancelTask, currentTask, endTask } from "../../core/tasks";
import { startToolTask } from "../../core/toolTask";
import { onUsageChange, usageStats } from "../../core/usage";
import { locale, plural, t } from "../../i18n";
import { escapeHtml, qs, setHtml } from "../dom";
import { grid, numberField, priceField, rangeField, section, selectField, toggleField } from "../fields";
import {
  HOTKEY_ACTIONS,
  actionLabel,
  bindingConflicts,
  bindingFor,
  captureNextKey,
  keyLabel,
  resetBindings,
  setBinding,
} from "../hotkeys";

// Onglet Outils : compteur de requêtes EA, aides du marché, raccourcis clavier, outils du club,
// ouverture des packs, réglages DCE (collections masquées, valeur FUTBIN de l'équipe).

let page = null;
let unwatch = null;
let packGroups = [];
// Dernière analyse du club (rapport + cartes revendables avec bénéfice).
let analysis = null;
// Aperçu en attente de confirmation : { kind: "transfer" | "quicksell", items }
let pending = null;

// --------------------------------------------------------------------- compteur

const bar = (count, limit) => {
  const ratio = limit > 0 ? count / limit : 0;
  const cls = ratio >= 1 ? "is-over" : ratio >= 0.8 ? "is-near" : "";
  return `<div class="mb-meter ${cls}"><div style="width:${Math.min(100, Math.round(ratio * 100))}%"></div></div>`;
};

const usageHtml = () => {
  const stats = usageStats();
  const cell = (label, value) => `<div>${label}<b>${value}</b></div>`;
  return `<div class="mb-stats-list">
      ${cell(t("tools.usageHour"), `${stats.hour.searches} / ${stats.limits.hour}`)}
      ${cell(t("tools.usageDay"), `${stats.day.searches} / ${stats.limits.day}`)}
      ${cell(t("tools.usageBotManual"), `${stats.hour.bot} · ${stats.hour.manual}`)}
      ${cell(t("tools.usageBids"), `${stats.hour.bids} · ${stats.day.bids}`)}
    </div>
    <div class="mb-meter-label">${t("tools.usageHourBar")}</div>${bar(stats.hour.searches, stats.limits.hour)}
    <div class="mb-meter-label">${t("tools.usageDayBar")}</div>${bar(stats.day.searches, stats.limits.day)}`;
};

// ------------------------------------------------------------------- raccourcis

const hotkeysHtml = () => {
  const conflicts = bindingConflicts();
  const clashing = new Set([].concat(...Object.values(conflicts)));
  const warning = Object.keys(conflicts).length
    ? `<div class="mb-note is-warn">${escapeHtml(
        t("tools.hkConflicts", {
          list: Object.keys(conflicts)
            .map((key) => `${keyLabel(key)} : ${conflicts[key].map(actionLabel).join(" / ")}`)
            .join(" · "),
        })
      )}</div>`
    : "";
  return `${warning}<div class="mb-preview mb-hotkeys"><table>
    <thead><tr><th>${t("tools.hkAction")}</th><th>${t("tools.hkKey")}</th></tr></thead>
    <tbody>${HOTKEY_ACTIONS.map(
      (action) => `<tr${clashing.has(action.id) ? ' class="is-conflict"' : ""}><td>${escapeHtml(actionLabel(action.id))}</td>
        <td><button type="button" class="mb-btn mb-btn-ghost mb-btn-sm mb-key" data-hk="${action.id}">${escapeHtml(keyLabel(bindingFor(action)))}</button></td></tr>`
    ).join("")}</tbody></table></div>`;
};

// -------------------------------------------------------------------- club

const clubCriteria = () => {
  const tools = getSettings().tools;
  return {
    minRating: clampRating(tools.clubMinRating),
    maxRating: clampRating(tools.clubMaxRating),
    minPrice: toInt(tools.clubMinPrice),
    maxPrice: toInt(tools.clubMaxPrice),
  };
};

// Noms des cartes concernées (15 premières) : l'utilisateur voit ce qui sera déplacé ou vendu.
const namesHtml = (items) => {
  if (!items.length) {
    return "";
  }
  const shown = items
    .slice()
    .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
    .slice(0, 15)
    .map((item) => `${escapeHtml(nameOf(item))} ${Number(item.rating) || ""}`);
  return `<div class="mb-hint mb-names">${shown.join(" · ")}${items.length > shown.length ? ` · ${t("tools.andMore", { n: items.length - shown.length })}` : ""}</div>`;
};

const pendingHtml = () => {
  if (!pending) {
    return "";
  }
  const count = pending.items.length;
  if (pending.kind === "transfer") {
    return `<div class="mb-note">${plural(count, "tools.previewTransferOne", "tools.previewTransferMany", { futbin: formatCoins(futbinTotal(pending.items)) })}
      ${namesHtml(pending.items)}
      <div class="mb-row" style="margin-top:8px">
        <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-tool="confirm-transfer"${count ? "" : " disabled"}>${t("tools.confirmTransfer", { n: count })}</button>
        <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-tool="cancel-preview">${t("tools.cancel")}</button>
      </div></div>`;
  }
  return `<div class="mb-note is-warn">${plural(count, "tools.previewQuickSellOne", "tools.previewQuickSellMany", { coins: formatCoins(quickSellValue(pending.items)) })}
    ${namesHtml(pending.items)}
    <div class="mb-row" style="margin-top:8px">
      <button type="button" class="mb-btn mb-btn-danger mb-btn-sm" data-tool="confirm-quicksell"${count ? "" : " disabled"}>${t("tools.confirmQuickSell", { n: count })}</button>
      <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-tool="cancel-preview">${t("tools.cancel")}</button>
    </div></div>`;
};

// ---------------------------------------------------------- analyse du club

const signed = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatCoins(Math.abs(value))}`;

const linesHtml = (title, lines) =>
  lines.length
    ? `<div class="mb-preview mb-analysis-table"><table>
        <thead><tr><th>${escapeHtml(title)}</th><th class="is-num">${t("tools.anPaid")}</th><th class="is-num">${t("tools.anFutbin")}</th><th class="is-num">${t("tools.anGain")}</th></tr></thead>
        <tbody>${lines
          .map(
            (line) => `<tr><td>${escapeHtml(nameOf(line.item))} ${Number(line.item.rating) || ""}${line.inSquad ? ` <span class="mb-tag">${t("tools.anInSquad")}</span>` : ""}</td>
              <td class="is-num">${formatCoins(line.paid)}</td><td class="is-num">${formatCoins(line.price)}</td>
              <td class="is-num ${line.gain >= 0 ? "is-good" : "is-bad"}">${signed(line.gain)}</td></tr>`
          )
          .join("")}</tbody></table></div>`
    : "";

const analysisHtml = () => {
  if (!analysis) {
    return `<p class="mb-hint">${t("tools.analyzeHint")}</p>`;
  }
  const report = analysis.report;
  const cell = (label, value, cls = "") => `<div class="${cls}">${label}<b>${value}</b></div>`;
  const sellableGain = report.sellable.reduce((sum, line) => sum + line.gain, 0);
  return `<div class="mb-analysis">
    <div class="mb-stats-list">
      ${cell(t("tools.anPlayers"), `${report.count} · ${t("tools.anTradableN", { n: report.tradable })}`)}
      ${cell(t("tools.anValue"), `${formatCoins(report.value)}`)}
      ${cell(t("tools.anNetValue"), `${formatCoins(report.netValue)}`)}
      ${cell(t("tools.anInvested"), `${formatCoins(report.invested)} · ${report.paidCount}`)}
      ${cell(t("tools.anUnrealized"), signed(report.unrealized), report.unrealized >= 0 ? "is-good" : "is-bad")}
      ${cell(t("tools.anPriced"), `${report.priced} / ${report.tradable}`)}
    </div>
    <div class="mb-analysis-buckets">${report.buckets
      .filter((bucket) => bucket.count)
      .map(
        (bucket) => `<span class="mb-chip"><span>${bucket.min ? `${bucket.min}${bucket.max < 99 ? `–${bucket.max}` : "+"}` : `≤ ${bucket.max}`} : ${bucket.count}${bucket.value ? ` · ${formatCoins(bucket.value)}` : ""}</span></span>`
      )
      .join("")}</div>
    ${linesHtml(t("tools.anGainers"), report.gainers)}
    ${linesHtml(t("tools.anLosers"), report.losers)}
    ${
      report.sellable.length
        ? `<div class="mb-note">${plural(report.sellable.length, "tools.anSellableOne", "tools.anSellableMany", { gain: signed(sellableGain) })}
            <div class="mb-row" style="margin-top:8px"><button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-tool="analysis-transfer">${t("tools.anPrepareTransfer", { n: report.sellable.length })}</button></div></div>`
        : `<p class="mb-hint">${t("tools.anNoSellable")}</p>`
    }
    <p class="mb-hint">${t("tools.anFootnote", { time: new Date(analysis.at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) })}</p>
  </div>`;
};

const repaintAnalysis = () => setHtml(qs(page, "[data-tools-analysis]"), analysisHtml());

const ANALYSIS_PRICE_AGE = 10 * 60 * 1000;

const analyzeClubTool = () =>
  runTool(t("tools.taskAnalyze"), async (task) => {
    setStatus(t("tools.loadingClub"));
    const club = await loadClubPlayers({ token: task.token, onProgress: (n) => setStatus(t("tools.loadingClubN", { n })) });
    if (!club.ok && !club.items.length) {
      setStatus(club.error ? club.error.label : t("tools.stopRequested"), "warn");
      return;
    }
    const squad = await squadIds();
    const ids = squad.ok ? squad.ids : new Set();
    // Prix FUTBIN des cartes échangeables (300 au plus, d'abord celles payées puis les mieux notées).
    const tradable = club.items
      .filter((item) => item.tradable !== false)
      .sort((a, b) => (Number(b.lastSalePrice) > 0) - (Number(a.lastSalePrice) > 0) || (Number(b.rating) || 0) - (Number(a.rating) || 0))
      .slice(0, 300);
    await ensurePrices(tradable, {
      token: task.token,
      waitMs: Math.max(60000, tradable.length * 2500),
      onProgress: (done, total) => setStatus(t("tools.loadingPrices", { done, total })),
    });
    const report = analyzeClub(club.items, {
      squadIds: ids,
      priceOf: (item) => currentPrice(Number(item.definitionId) || 0, ANALYSIS_PRICE_AGE, "sell"),
      minSellProfit: toInt(getSettings().sell.minProfit),
    });
    analysis = { report, at: Date.now() };
    repaintAnalysis();
    setStatus(t("tools.analyzeDone", { n: report.count, value: formatCoins(report.value), gain: signed(report.unrealized) }), "ok");
  });

// Cartes revendables avec bénéfice : même aperçu / confirmation que l'envoi vers la liste des transferts.
const prepareAnalysisTransfer = () => {
  if (!analysis || !analysis.report.sellable.length) {
    return;
  }
  pending = { kind: "transfer", items: analysis.report.sellable.map((line) => line.item) };
  repaintPending();
};

// ------------------------------------------------------------------- packs

const packsHtml = () => {
  if (!packGroups.length) {
    return `<p class="mb-hint">${t("tools.packsHint")}</p>`;
  }
  return `<div class="mb-preview"><table>
      <thead><tr><th>${t("tools.packName")}</th><th class="is-num">${t("tools.packCount")}</th><th></th></tr></thead>
      <tbody>${packGroups
        .map(
          (group, index) => `<tr><td>${escapeHtml(group.name)}${group.tradable ? ` <span class="mb-tag">${t("tools.packTradable")}</span>` : ""}</td>
            <td class="is-num">${group.count}</td>
            <td><input class="mb-input mb-input-xs" data-pack-count="${index}" inputmode="numeric" value="${Math.min(group.count, 1)}" aria-label="${escapeHtml(t("tools.packHowMany"))}" />
              <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-tool="open-pack" data-pack="${index}">${t("tools.packOpen")}</button></td></tr>`
        )
        .join("")}</tbody></table></div>`;
};

// -------------------------------------------------------------------- DCE

const hiddenSetsHtml = () => {
  const hidden = getSettings().sbc.hidden || [];
  if (!hidden.length) {
    return `<p class="mb-hint">${t("tools.sbcNoHidden")}</p>`;
  }
  return `<div class="mb-row">${hidden
    .map(
      (entry) => `<span class="mb-chip"><span>${escapeHtml(entry.name || `#${entry.id}`)}</span><button type="button" data-tool="unhide-set" data-set="${escapeHtml(String(entry.id))}" aria-label="${escapeHtml(t("tools.sbcUnhide"))}" title="${escapeHtml(t("tools.sbcUnhide"))}">↺</button></span>`
    )
    .join("")}
    <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-tool="unhide-all">${t("tools.sbcUnhideAll")}</button></div>`;
};

// ------------------------------------------------------------------ page

export const toolsPageHtml = () => `
  ${section(
    t("tools.usageSection"),
    `<div data-tools-usage>${usageHtml()}</div>` +
      grid(
        numberField({ bind: "s:usage.hourLimit", label: t("tools.usageHourLimit"), min: 50, max: 5000, hint: t("tools.usageHourLimitHint") }),
        numberField({ bind: "s:usage.dayLimit", label: t("tools.usageDayLimit"), min: 200, max: 50000 }),
        toggleField({ bind: "s:usage.autoPause", label: t("tools.usageAutoPause"), wide: true, hint: t("tools.usageAutoPauseHint") }),
        toggleField({ bind: "s:usage.burstWarning", label: t("tools.usageBurstWarning"), wide: true })
      )
  )}
  ${section(
    t("tools.marketSection"),
    grid(
      toggleField({ bind: "s:tools.bargain", label: t("tools.bargain"), hint: t("tools.bargainHint") }),
      numberField({ bind: "s:tools.bargainPercent", label: t("tools.bargainPercent"), min: 50, max: 100 }),
      toggleField({ bind: "s:tools.boughtFor", label: t("tools.boughtFor"), wide: true, hint: t("tools.boughtForHint") }),
      toggleField({ bind: "s:tools.buyCheck", label: t("tools.buyCheckToggle"), wide: true, hint: t("tools.buyCheckToggleHint") }),
      toggleField({ bind: "s:ui.itemScoreBadge", label: t("tools.itemScoreBadge"), wide: true, hint: t("tools.itemScoreBadgeHint") }),
      numberField({ bind: "s:tools.lowestBinSearches", label: t("tools.lowestBinSearches"), min: 2, max: 12, hint: t("tools.lowestBinSearchesHint") })
    )
  )}
  ${section(
    t("tools.hotkeysSection"),
    grid(
      toggleField({ bind: "s:hotkeys.enabled", label: t("tools.hotkeysEnabled") }),
      toggleField({ bind: "s:hotkeys.hints", label: t("tools.hotkeysHints") }),
      toggleField({ bind: "s:hotkeys.lossGuard", label: t("tools.hotkeysLossGuard"), wide: true, hint: t("tools.hotkeysLossGuardHint") })
    ) +
      `<div data-tools-hotkeys>${hotkeysHtml()}</div>
       <div class="mb-row" style="margin-top:8px"><button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-tool="hk-reset">${t("tools.hkReset")}</button></div>
       <p class="mb-hint">${t("tools.hotkeysHint")}</p>`
  )}
  ${section(
    t("tools.clubSection"),
    grid(
      numberField({ bind: "s:tools.clubMinRating", label: t("tools.clubMinRating"), min: 0, max: 99, placeholder: "—" }),
      numberField({ bind: "s:tools.clubMaxRating", label: t("tools.clubMaxRating"), min: 0, max: 99, placeholder: "—" }),
      priceField({ bind: "s:tools.clubMinPrice", label: t("tools.clubMinPrice"), placeholder: "—" }),
      priceField({ bind: "s:tools.clubMaxPrice", label: t("tools.clubMaxPrice"), placeholder: "—" }),
      toggleField({ bind: "s:tools.exportPrices", label: t("tools.exportPrices"), wide: true, hint: t("tools.exportPricesHint") })
    ) +
      `<div class="mb-row" style="margin-top:8px">
        <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-tool="export-club">${t("tools.exportClub")}</button>
        <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-tool="preview-transfer">${t("tools.previewTransfer")}</button>
        <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-tool="storage-club">${t("tools.storageToClub")}</button>
        <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-tool="analyze-club">${t("tools.analyzeClub")}</button>
      </div>
      <div data-tools-analysis>${analysisHtml()}</div>` +
      grid(
        numberField({ bind: "s:tools.quickSellMaxRating", label: t("tools.quickSellMaxRating"), min: 0, max: 99, placeholder: "—", hint: t("tools.quickSellHint") })
      ) +
      `<div class="mb-row"><button type="button" class="mb-btn mb-btn-danger mb-btn-sm" data-tool="preview-quicksell">${t("tools.previewQuickSell")}</button></div>
       <div data-tools-pending></div>
       <p class="mb-hint">${t("tools.clubHint")}</p>`
  )}
  ${section(
    t("tools.packsSection"),
    grid(
      toggleField({ bind: "s:packs.duplicatesToStorage", label: t("tools.packsDuplicates"), wide: true }),
      toggleField({ bind: "s:packs.redeemMisc", label: t("tools.packsRedeemMisc"), wide: true, hint: t("tools.packsRedeemMiscHint") }),
      toggleField({ bind: "s:packs.skipAnimation", label: t("tools.packsSkipAnimation"), wide: true, hint: t("tools.packsSkipAnimationHint") }),
      toggleField({ bind: "s:picks.highlight", label: t("tools.picksHighlight"), wide: true, hint: t("tools.picksHighlightHint") }),
      selectField({
        bind: "s:picks.priority",
        label: t("tools.picksPriority"),
        options: [
          ["price", t("tools.picksPriorityPrice")],
          ["rating", t("tools.picksPriorityRating")],
        ],
      }),
      selectField({
        bind: "s:packs.untradeableDuplicates",
        label: t("tools.packsUntradeableDup"),
        wide: true,
        options: [
          ["quickSell", t("tools.packsUntradeableDupSell")],
          ["leave", t("tools.packsUntradeableDupLeave")],
        ],
        hint: t("tools.packsUntradeableDupHint"),
      }),
      priceField({ bind: "s:packs.toTransferMin", label: t("tools.packsToTransfer"), hint: t("tools.packsToTransferHint") }),
      numberField({ bind: "s:packs.quickSellMaxRating", label: t("tools.packsQuickSell"), min: 0, max: 99, placeholder: "—", hint: t("tools.packsQuickSellHint") }),
      numberField({ bind: "s:packs.max", label: t("tools.packsMax"), min: 1, max: 50 })
    ) +
      `<div class="mb-row" style="margin-top:8px">
        <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-tool="load-packs">${t("tools.packsLoad")}</button>
        <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-tool="route-unassigned">${t("tools.routeUnassigned")}</button>
      </div>
      <div data-tools-packs>${packsHtml()}</div>`
  )}
  ${section(
    t("tools.gallerySection"),
    grid(
      toggleField({ bind: "s:gallery.homeTile", label: t("tools.galleryHomeTile") }),
      toggleField({ bind: "s:gallery.clubTile", label: t("tools.galleryClubTile") }),
      toggleField({ bind: "s:gallery.collectedBadge", label: t("tools.galleryCollectedBadge"), wide: true, hint: t("tools.galleryCollectedBadgeHint") }),
      rangeField({ bind: "s:gallery.buyRange", label: t("tools.galleryBuyRange"), unit: null, placeholder: "85-100", hint: t("tools.galleryBuyRangeHint") }),
      numberField({ bind: "s:gallery.retries", label: t("tools.galleryRetries"), min: 1, max: 5 }),
      rangeField({ bind: "s:gallery.wait", label: t("tools.galleryWait"), unit: "S", placeholder: "2-4" }),
      selectField({
        bind: "s:gallery.sellMode",
        label: t("tools.gallerySellMode"),
        options: [
          ["keep", t("gallery.dlgKeep")],
          ["same", t("gallery.dlgSame")],
          ["percent", t("gallery.dlgPercent")],
        ],
      }),
      rangeField({ bind: "s:gallery.sellPercent", label: t("gallery.dlgSellPercent"), unit: null, placeholder: "100", showIf: "s:gallery.sellMode=percent" })
    )
  )}
  ${section(
    t("tools.sbcSection"),
    grid(
      toggleField({ bind: "s:sbc.squadValue", label: t("tools.sbcSquadValue"), wide: true, hint: t("tools.sbcSquadValueHint") }),
      toggleField({ bind: "s:sbc.softBanAlert", label: t("tools.sbcSoftBan"), wide: true, hint: t("tools.sbcSoftBanHint") }),
      toggleField({ bind: "s:sbc.excludeActiveSquad", label: t("tools.sbcExcludeSquad"), wide: true, hint: t("tools.sbcExcludeSquadHint") }),
      toggleField({ bind: "s:sbc.excludeEvolved", label: t("tools.sbcExcludeEvolved"), wide: true, hint: t("tools.sbcExcludeEvolvedHint") })
    ) +
      `<div class="mb-label" style="margin-top:8px"><span>${t("tools.sbcHidden")}</span></div>
       <div data-tools-hidden>${hiddenSetsHtml()}</div>`
  )}
  <div class="mb-task-bar" data-tools-task hidden>
    <span data-tools-task-label></span>
    <button type="button" class="mb-btn mb-btn-danger mb-btn-sm" data-tool="cancel-task">${t("tools.stop")}</button>
  </div>
  <p class="mb-tools-status" data-tools-status></p>
`;

const setStatus = (text, kind = "") => {
  const el = page && qs(page, "[data-tools-status]");
  if (el) {
    el.textContent = text || "";
    el.dataset.kind = kind;
  }
};

const paintTask = () => {
  if (!page) {
    return;
  }
  const bar = qs(page, "[data-tools-task]");
  const task = currentTask();
  bar.hidden = !task;
  if (task) {
    qs(page, "[data-tools-task-label]").textContent = task.label;
  }
};

export const refreshToolsPage = () => {
  if (!page || !page.classList.contains("is-active")) {
    return;
  }
  setHtml(qs(page, "[data-tools-usage]"), usageHtml());
  setHtml(qs(page, "[data-tools-hidden]"), hiddenSetsHtml());
  paintTask();
};

const repaintHotkeys = () => setHtml(qs(page, "[data-tools-hotkeys]"), hotkeysHtml());
const repaintPending = () => setHtml(qs(page, "[data-tools-pending]"), pendingHtml());
const repaintPacks = () => setHtml(qs(page, "[data-tools-packs]"), packsHtml());

// Tâche d'outil : verrou, barre « en cours », message final.
const runTool = async (label, fn) => {
  const { task, error } = startToolTask(label);
  if (!task) {
    setStatus(error, "warn");
    return;
  }
  paintTask();
  try {
    await fn(task);
  } catch (e) {
    setStatus(String((e && e.message) || e), "error");
  } finally {
    endTask(task);
    paintTask();
  }
};

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

const exportClub = () =>
  runTool(t("tools.taskExport"), async (task) => {
    setStatus(t("tools.loadingClub"));
    const club = await loadClubPlayers({ token: task.token, onProgress: (n) => setStatus(t("tools.loadingClubN", { n })) });
    if (!club.ok && !club.items.length) {
      setStatus(club.error ? club.error.label : t("tools.stopRequested"), "warn");
      return;
    }
    const squad = await squadIds();
    const ids = squad.ok ? squad.ids : new Set();
    if (getSettings().tools.exportPrices) {
      // Prix FUTBIN manquants des joueurs échangeables (300 au plus, les mieux notés d'abord).
      const tradable = club.items
        .filter((item) => item.tradable !== false)
        .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
        .slice(0, 300);
      await ensurePrices(tradable, {
        token: task.token,
        waitMs: Math.max(60000, tradable.length * 2500),
        onProgress: (done, total) => setStatus(t("tools.loadingPrices", { done, total })),
      });
    }
    const separator = /^fr|^de|^it|^es|^pt|^nl/.test(locale()) ? ";" : ",";
    downloadText(`magicbuyer-club-${stamp()}.csv`, clubCsv(club.items, { squadIds: ids, separator }));
    setStatus(plural(club.items.length, "tools.exportDoneOne", "tools.exportDoneMany"), "ok");
    log.success(plural(club.items.length, "tools.exportDoneOne", "tools.exportDoneMany"));
  });

const previewTransfer = () =>
  runTool(t("tools.taskPreview"), async (task) => {
    const criteria = Object.assign(clubCriteria(), { tradable: true });
    if (!criteria.minRating && !criteria.maxRating && !criteria.minPrice && !criteria.maxPrice) {
      setStatus(t("tools.needCriteria"), "warn");
      return;
    }
    setStatus(t("tools.loadingClub"));
    const club = await loadClubPlayers({ token: task.token, onProgress: (n) => setStatus(t("tools.loadingClubN", { n })) });
    if (!club.ok) {
      setStatus(club.error ? club.error.label : t("tools.stopRequested"), "warn");
      return;
    }
    const squad = await squadIds();
    if (!squad.ok) {
      setStatus(t("tools.errSquad"), "warn");
      return;
    }
    const ids = squad.ids;
    let chosen = selectPlayers(club.items, Object.assign({}, criteria, { minPrice: 0, maxPrice: 0 }), ids);
    if (criteria.minPrice || criteria.maxPrice) {
      await ensurePrices(chosen, { token: task.token, onProgress: (done, total) => setStatus(t("tools.loadingPrices", { done, total })) });
      chosen = selectPlayers(chosen, criteria, ids);
    }
    pending = { kind: "transfer", items: chosen };
    repaintPending();
    setStatus("");
  });

const confirmTransfer = () =>
  runTool(t("tools.taskTransfer"), async (task) => {
    const items = pending ? pending.items : [];
    pending = null;
    repaintPending();
    const report = await sendToTransferList(items, { token: task.token });
    const text = t("tools.transferDone", { n: report.moved }) + (report.left ? ` · ${t("tools.routeLeft", { n: report.left })}` : "") + (report.error ? ` · ${report.error}` : "");
    setStatus(text, report.error ? "warn" : "ok");
    log.info(text);
  });

const previewQuickSell = () =>
  runTool(t("tools.taskPreview"), async (task) => {
    const maxRating = clampRating(getSettings().tools.quickSellMaxRating);
    if (!maxRating) {
      setStatus(t("tools.needQuickSellRating"), "warn");
      return;
    }
    setStatus(t("tools.loadingClub"));
    const club = await loadClubPlayers({ token: task.token, onProgress: (n) => setStatus(t("tools.loadingClubN", { n })) });
    if (!club.ok) {
      setStatus(club.error ? club.error.label : t("tools.stopRequested"), "warn");
      return;
    }
    const squad = await squadIds();
    if (!squad.ok) {
      setStatus(t("tools.errSquad"), "warn");
      return;
    }
    const ids = squad.ids;
    // Plage de notes : note min du club (si renseignée) → note max de vente rapide.
    const chosen = selectPlayers(club.items, { minRating: clubCriteria().minRating, maxRating, tradable: false, excludeSpecial: true }, ids);
    pending = { kind: "quicksell", items: chosen };
    repaintPending();
    setStatus("");
  });

const confirmQuickSell = () =>
  runTool(t("tools.taskQuickSell"), async (task) => {
    const items = pending ? pending.items : [];
    pending = null;
    repaintPending();
    const report = await quickSell(items, { token: task.token });
    const text = t("tools.quickSellDone", { n: report.sold, coins: formatCoins(report.coins) }) + (report.error ? ` · ${report.error}` : "");
    setStatus(text, report.error ? "warn" : "ok");
    log.info(text);
  });

const moveStorage = () =>
  runTool(t("tools.taskStorage"), async (task) => {
    const report = await storageToClub({ token: task.token });
    const text = report.error ? report.error : t("tools.storageDone", { n: report.moved }) + (report.left ? ` · ${t("tools.storageLeft", { n: report.left })}` : "");
    setStatus(text, report.error ? "warn" : "ok");
    log.info(text);
  });

const loadPacks = () =>
  runTool(t("tools.taskPacks"), async () => {
    setStatus(t("tools.packsLoading"));
    const result = await listOwnedPacks();
    if (!result.ok) {
      setStatus(result.error ? result.error.label : "?", "warn");
      return;
    }
    packGroups = result.groups;
    repaintPacks();
    setStatus(result.groups.length ? plural(result.groups.reduce((n, group) => n + group.count, 0), "tools.packsFoundOne", "tools.packsFoundMany") : t("tools.packsNone"), "ok");
  });

const openPackGroup = (index) => {
  const group = packGroups[index];
  if (!group) {
    return;
  }
  const input = qs(page, `[data-pack-count="${index}"]`);
  const count = Math.max(1, Math.min(group.count, toInt(input && input.value) || 1));
  runTool(t("tools.taskOpenPacks"), async (task) => {
    const summary = await openPacks(group, count, {
      token: task.token,
      onProgress: ({ index: done, total }) => setStatus(t("tools.packsOpening", { n: done + 1, total })),
    });
    const text =
      plural(summary.opened, "tools.packsDoneOne", "tools.packsDoneMany", { value: formatCoins(summary.value) }) +
      (summary.stopped ? ` · ${summary.stopped}` : "");
    setStatus(text, summary.stopped ? "warn" : "ok");
    packGroups = [];
    repaintPacks();
  });
};

const routeAll = () =>
  runTool(t("tools.taskRoute"), async (task) => {
    const report = await routeUnassigned({ token: task.token });
    const text = report.error ? report.error : routingSummary(report);
    setStatus(text, report.error ? "warn" : "ok");
    log.info(t("tools.logRouted", { summary: text }));
  });

const unhideSet = (id) => {
  const hidden = (getSettings().sbc.hidden || []).filter((entry) => String(entry.id) !== String(id));
  setSetting("sbc.hidden", hidden);
  setHtml(qs(page, "[data-tools-hidden]"), hiddenSetsHtml());
};

export const bindToolsPage = (el) => {
  page = el;
  if (unwatch) {
    unwatch();
  }
  let usageTimer = null;
  unwatch = onUsageChange(() => {
    if (!usageTimer) {
      usageTimer = setTimeout(() => {
        usageTimer = null;
        refreshToolsPage();
      }, 1000);
    }
  });
  page.addEventListener("click", (event) => {
    const key = event.target.closest("[data-hk]");
    if (key) {
      const id = key.dataset.hk;
      key.textContent = t("tools.hkPress");
      key.classList.add("is-capturing");
      captureNextKey((value, cancelled) => {
        if (!cancelled) {
          setBinding(id, value);
        }
        repaintHotkeys();
      });
      return;
    }
    const button = event.target.closest("[data-tool]");
    if (!button) {
      return;
    }
    switch (button.dataset.tool) {
      case "hk-reset":
        resetBindings();
        repaintHotkeys();
        break;
      case "export-club":
        exportClub();
        break;
      case "preview-transfer":
        previewTransfer();
        break;
      case "confirm-transfer":
        confirmTransfer();
        break;
      case "preview-quicksell":
        previewQuickSell();
        break;
      case "confirm-quicksell":
        confirmQuickSell();
        break;
      case "cancel-preview":
        pending = null;
        repaintPending();
        break;
      case "storage-club":
        moveStorage();
        break;
      case "analyze-club":
        analyzeClubTool();
        break;
      case "analysis-transfer":
        prepareAnalysisTransfer();
        break;
      case "load-packs":
        loadPacks();
        break;
      case "open-pack":
        openPackGroup(Number(button.dataset.pack));
        break;
      case "route-unassigned":
        routeAll();
        break;
      case "unhide-set":
        unhideSet(button.dataset.set);
        break;
      case "unhide-all":
        setSetting("sbc.hidden", []);
        setHtml(qs(page, "[data-tools-hidden]"), hiddenSetsHtml());
        break;
      case "cancel-task":
        cancelTask();
        break;
      default:
        break;
    }
  });
};
