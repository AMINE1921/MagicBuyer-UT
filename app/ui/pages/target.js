import { marketInfoFor, previewSearch, isRunning } from "../../core/engine";
import {
  addFilter,
  addFodderFilters,
  describeFilter,
  duplicateFilter,
  exportFilters,
  filterHasTarget,
  getActiveFilter,
  getFilters,
  getLastEaSearch,
  getRotation,
  importFilters,
  normalizeFilter,
  onFiltersChange,
  removeFilter,
  removeInactiveFilters,
  setActiveFilter,
  setRotation,
  futbinKeyForFilter,
  updateFilter,
} from "../../core/filters";
import { percentRange } from "../../core/listing";
import { afterTax, floorPrice, formatCoins, profitFor, roundPrice, toInt } from "../../core/prices";
import { getSettings } from "../../core/settings";
import { filterStatsFor, onStateChange } from "../../core/state";
import { locale, plural, t } from "../../i18n";
import {
  acquireCardSet,
  cardSetKey,
  cardSetSnapshot,
  futbinListUrl,
  onCardSetUpdate,
  refreshCardSet,
} from "../../prices/cardSets";
import { searchFutbin } from "../../prices/futbinClient";
import { currentPrice, getPriceRecord, onPriceUpdate, seedFutbinPrice } from "../../prices/priceService";
import { loadEaPlayersCatalog, searchEaPlayersByTerm } from "../../services/datasource/eaPlayers";
import { debounce, escapeHtml, qs, setHtml } from "../dom";
import {
  grid,
  numberField,
  priceField,
  rangeField,
  registerVirtualFilterFields,
  section,
  selectField,
  textField,
  toggleField,
} from "../fields";

const levels = () => [
  ["any", t("target.levelAny")],
  ["bronze", t("target.levelBronze")],
  ["silver", t("target.levelSilver")],
  ["gold", t("target.levelGold")],
  ["SP", t("target.levelSpecial")],
];

const positions = () => [
  ["any", t("target.positionAny")],
  ["130", t("target.zoneDefence")],
  ["131", t("target.zoneMidfield")],
  ["132", t("target.zoneAttack")],
  ["GK", t("target.positionGK")],
  ["RB", t("target.positionRB")],
  ["RWB", t("target.positionRWB")],
  ["CB", t("target.positionCB")],
  ["LB", t("target.positionLB")],
  ["LWB", t("target.positionLWB")],
  ["CDM", t("target.positionCDM")],
  ["CM", t("target.positionCM")],
  ["CAM", t("target.positionCAM")],
  ["RM", t("target.positionRM")],
  ["LM", t("target.positionLM")],
  ["RW", t("target.positionRW")],
  ["LW", t("target.positionLW")],
  ["CF", t("target.positionCF")],
  ["ST", t("target.positionST")],
];

let unsubscribeFilters = null;
let unsubscribePrices = null;
let liveSet = { key: "", handle: null };
let unsubscribeSets = null;
let searchSeq = 0;
let liveTimer = null;

const LIVE_MAX_AGE = 5 * 60 * 1000;

// Noms par défaut (français ou anglais) : remplacés par le nom du joueur ou de la recherche importée.
const isDefaultName = (name) =>
  /^(nouveau filtre|mon filtre|filtre|new filter|my filter|filter)( \((copie|copy)\))?$/i.test(String(name || "").trim());
const isEaSearchName = (name) => /^(Recherche EA|EA search)/.test(String(name || ""));

const filterPrices = (filter) => {
  const parts = [];
  if (filter.priceMode === "futbin") {
    parts.push(t("target.tagBuyPercent", { percent: filter.futbinPercent }));
    if (filter.bidPercent && getSettings().bid.enabled) {
      parts.push(t("target.tagBidPercent", { percent: filter.bidPercent }));
    }
  } else if (filter.priceMode === "market") {
    // Revente déduite du prix marché : pas d'étiquette de revente.
    parts.push(t("target.tagBuyMarket", { percent: filter.futbinPercent }));
    return parts.join(" ");
  } else if (filter.maxBuy) {
    parts.push(`≤ ${formatCoins(filter.maxBuy)}`);
  }
  if (filter.sellMode === "fixed" && filter.sellPrice) {
    parts.push(`→ ${formatCoins(filter.sellPrice)}`);
  } else if (filter.sellMode === "futbin") {
    parts.push(t("target.tagSellPercent", { percent: filter.sellPercent || getSettings().sell.futbinPercent }));
  }
  return parts.join(" ");
};

const ago = (timestamp) => {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
};

const maxFor = (filter, price) => {
  const computed = floorPrice((price * filter.futbinPercent) / 100);
  return filter.maxBuy ? Math.min(filter.maxBuy, computed) : computed;
};

// Bloc "prix FUTBIN en direct" du filtre actif (mode % FUTBIN) : une carte, ses versions ou une liste.
const futbinLiveHtml = () => {
  const filter = getActiveFilter();
  if (!filter || filter.priceMode !== "futbin") {
    return "";
  }
  const key = cardSetKey(filter);
  if (!key) {
    return `<div class="mb-note is-warn">${t("target.liveNeedTarget")}</div>`;
  }
  const snap = cardSetSnapshot(key, "display");
  const refresh = `<button type="button" class="mb-link" data-target-action="futbin-refresh">${t("target.liveRefresh")}</button>`;
  if (snap.status === "loading" || snap.status === "missing") {
    return `<div class="mb-note">${snap.kind === "list" ? t("target.liveReadingList") : t("target.liveReadingPrices")}</div>`;
  }
  if (snap.status === "error" || snap.status === "empty") {
    return `<div class="mb-note is-warn">${escapeHtml(snap.message || t("target.liveListUnreadable"))} ${refresh}</div>`;
  }
  const priced = snap.cards.filter((card) => card.price);
  if (snap.kind === "list") {
    const prices = priced.map((card) => card.price).sort((a, b) => a - b);
    const range = prices.length
      ? ` · ${t("target.liveListRange", { min: formatCoins(prices[0]), max: formatCoins(prices[prices.length - 1]) })}`
      : "";
    const pages = snap.lastPage > 1 ? ` ${t("target.liveListPages", { n: snap.lastPage })}` : "";
    return `<div class="mb-note mb-live">${plural(snap.cards.length, "target.liveListCardsOne", "target.liveListCardsMany")}${pages}${range}${
      snap.loadedAt ? ` · ${t("target.liveListReadAgo", { ago: ago(snap.loadedAt) })}` : ""
    } ${t("target.liveListBuyAt", { percent: filter.futbinPercent })}
      <a class="mb-link" href="${escapeHtml(snap.url)}" target="_blank" rel="noopener">${t("target.liveViewList")}</a> ${refresh}${
      snap.message ? `<br><small>${escapeHtml(snap.message)}</small>` : ""
    }</div>`;
  }
  if (snap.cards.length === 1) {
    const card = snap.cards[0];
    const record = getPriceRecord(card.eaId);
    if (!card.price) {
      const text =
        record && record.status === "miss"
          ? t("target.liveCardMissing")
          : record && (record.status === "error" || record.status === "paused")
          ? t("target.liveFutbinDown")
          : t("target.liveReadingPrice");
      return `<div class="mb-note${record && record.status && record.status !== "ok" ? " is-warn" : ""}">${text} ${refresh}</div>`;
    }
    const max = maxFor(filter, currentPrice(card.eaId, LIVE_MAX_AGE, "buy"));
    return `<div class="mb-note mb-live">FUTBIN <b>${formatCoins(card.price)}</b>${record && record.suspect ? " ⚠" : ""}${
      record && record.fetchedAt ? ` · ${t("target.liveCardReadAgo", { ago: ago(record.fetchedAt) })}` : ""
    } ${t("target.liveCardMaxBuy", { max: formatCoins(max) })}${filter.maxBuy && filter.maxBuy <= max ? ` ${t("target.liveCapped")}` : ""}
      ${card.url ? `<a class="mb-link" href="${escapeHtml(card.url)}" target="_blank" rel="noopener">${t("target.liveFutbinPage")}</a>` : ""} ${refresh}</div>`;
  }
  const lines = snap.cards
    .slice()
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 8)
    .map(
      (card) =>
        `<li>${t("target.liveVersionLine", {
          rating: card.rating || "—",
          version: escapeHtml(card.version || (card.eaId > 0xffffff ? t("target.specialVersion") : t("target.baseCard"))),
          price: card.price
            ? `${formatCoins(card.price)} → max <b>${formatCoins(maxFor(filter, card.price))}</b>`
            : t("target.livePriceLoading"),
        })}</li>`
    )
    .join("");
  return `<div class="mb-note mb-live">${t("target.liveVersionsTracked", { n: snap.cards.length, percent: filter.futbinPercent })} ${refresh}<ul class="mb-versions">${lines}</ul>${
    snap.message ? `<small>${escapeHtml(snap.message)}</small>` : ""
  }</div>`;
};

// Bloc "prix marché EA" du filtre actif : version exacte obligatoire, relevé fait par le bot.
const marketLiveHtml = () => {
  const filter = getActiveFilter();
  if (!filter || filter.priceMode !== "market") {
    return "";
  }
  if (!(filter.definitionId > 0)) {
    return `<div class="mb-note is-warn">${t("target.marketNeedVersion")}</div>`;
  }
  const info = marketInfoFor(filter);
  const style = filter.playStyle > 0 ? t("target.marketStyle", { id: filter.playStyle }) : "";
  const last = info.price
    ? `<br>${t("target.marketLast", {
        price: formatCoins(info.price),
        ago: info.at ? ` (${t("target.liveCardReadAgo", { ago: ago(info.at) })})` : "",
        max: formatCoins(info.max),
        resale: formatCoins(info.resale),
      })}`
    : "";
  return `<div class="mb-note mb-live">${t("target.marketHow", {
    style,
    minutes: info.minutes,
    percent: filter.futbinPercent,
  })}${last}</div>`;
};

// Les cartes FUTBIN du filtre affiché sont suivies tant que l'onglet Cible est ouvert.
const syncLiveTracking = () => {
  const filter = getActiveFilter();
  const key = filter ? cardSetKey(filter) : "";
  if (key === liveSet.key) {
    return;
  }
  if (liveSet.handle) {
    liveSet.handle.release();
  }
  liveSet = { key, handle: key ? acquireCardSet(filter) : null };
};

// Bilan de session du filtre : recherches, achats, coins dépensés, bénéfice estimé.
const filterStatsText = (filterId) => {
  const stats = filterStatsFor(filterId);
  if (!stats || !stats.searches) {
    return "";
  }
  const parts = [plural(stats.searches, "target.statsSearchesOne", "target.statsSearchesMany")];
  if (stats.won) {
    parts.push(plural(stats.won, "target.statsBuysOne", "target.statsBuysMany"));
    parts.push(t("target.statsSpent", { coins: formatCoins(stats.spent) }));
  }
  if (stats.missed) {
    parts.push(t("target.statsMissed", { n: stats.missed }));
  }
  if (stats.estProfit) {
    parts.push(t("target.statsProfit", { coins: `${stats.estProfit > 0 ? "+" : "−"}${formatCoins(Math.abs(stats.estProfit))}` }));
  }
  return parts.join(" · ");
};

let unsubscribeStats = null;

const listHtml = () => {
  const active = getActiveFilter();
  const rotation = getRotation();
  return getFilters()
    .map(
      (filter) => `
      <div class="mb-filter-item${active && active.id === filter.id ? " is-active" : ""}" data-filter-id="${filter.id}" role="button" tabindex="0">
        ${
          rotation.enabled
            ? `<button type="button" class="mb-check" role="checkbox" aria-checked="${filter.enabled}" data-filter-toggle="${filter.id}" aria-label="${escapeHtml(t("target.includeInRotation", { name: filter.name }))}">${filter.enabled ? "✓" : ""}</button>`
            : ""
        }
        <div class="mb-filter-main">
          <b>${escapeHtml(filter.name)}</b>
          <small>${escapeHtml(describeFilter(filter))}</small>
          <small class="mb-filter-stats" data-filter-stats="${filter.id}"${filterStatsText(filter.id) ? "" : " hidden"}>${escapeHtml(filterStatsText(filter.id))}</small>
        </div>
        <span class="mb-price-tag">${escapeHtml(filterPrices(filter))}</span>
      </div>`
    )
    .join("");
};

const playerChipHtml = () => {
  const filter = getActiveFilter();
  const player = filter && filter.player;
  if (!player) {
    return filter && filter.definitionId
      ? `<span class="mb-chip"><span>${t("target.chipExactCard", { id: filter.definitionId })}</span><button type="button" data-player-clear aria-label="${escapeHtml(t("target.removeCard"))}">×</button></span>`
      : `<span class="mb-empty">${t("target.noPlayer")}</span>`;
  }
  const exact = filter.definitionId > 0;
  const kind = exact
    ? filter.definitionId > 0xffffff
      ? t("target.specialVersion")
      : t("target.baseCard")
    : t("target.allVersions");
  return `<span class="mb-chip"><span>${escapeHtml(player.name || t("target.player"))}${player.rating ? ` · ${player.rating}` : ""} · ${kind} · id ${
    exact ? filter.definitionId : player.id
  }</span><button type="button" data-player-clear aria-label="${escapeHtml(t("target.removePlayer"))}">×</button></span>${
    exact
      ? ` <button type="button" class="mb-link" data-player-versions>${t("target.allVersions")}</button>`
      : ""
  }`;
};

const targetWarningHtml = () => {
  const filter = getActiveFilter();
  if (!filter || filterHasTarget(filter)) {
    return "";
  }
  return `<div class="mb-note is-warn" style="margin-top:8px">${t("target.noTargetWarning")}</div>`;
};

const lastEaHtml = () => {
  const snapshot = getLastEaSearch();
  if (!snapshot) {
    return t("target.lastEaNone");
  }
  const when = new Date(snapshot.capturedAt).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  const player =
    snapshot.player && snapshot.player.name
      ? snapshot.player.name
      : snapshot.player
      ? t("target.lastEaPlayerId", { id: snapshot.player.id })
      : t("target.lastEaAllPlayers");
  return t("target.lastEaCaptured", {
    time: when,
    player: escapeHtml(player),
    maxBuy: snapshot.maxBuy ? ` · ${t("target.lastEaMaxBuy", { coins: formatCoins(snapshot.maxBuy) })}` : "",
  });
};

export const targetPageHtml = () => `
  ${section(
    t("target.snipeFilters"),
    `<div class="mb-filter-list" data-filter-list>${listHtml()}</div>
     <div class="mb-row" style="margin-top:8px">
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-filter-action="add">${t("target.newFilter")}</button>
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-filter-action="duplicate">${t("target.duplicate")}</button>
       <button type="button" class="mb-btn mb-btn-danger mb-btn-sm" data-filter-action="delete">${t("target.delete")}</button>
       <button type="button" class="mb-btn mb-btn-danger mb-btn-sm" data-filter-action="prune" title="${escapeHtml(t("target.pruneHint"))}">${t("target.prune")}</button>
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-filter-action="export">${t("target.exportFilters")}</button>
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-filter-action="import">${t("target.importFilters")}</button>
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-filter-action="fodder" title="${escapeHtml(t("target.fodderPresetHint"))}">${t("target.fodderPreset")}</button>
     </div>
     <div class="mb-filter-io" data-filter-io hidden></div>
     <div style="margin-top:8px">${grid(
       toggleField({ bind: "r:enabled", label: t("target.rotation"), hint: t("target.rotationHint") }),
       numberField({ bind: "r:every", label: t("target.rotationEvery"), hint: t("target.rotationEveryHint"), min: 1, max: 50 }),
       toggleField({ bind: "r:random", label: t("target.rotationRandom"), wide: true })
     )}</div>`
  )}
  ${section(
    t("target.sectionTarget"),
    grid(
      textField({ bind: "f:name", label: t("target.filterName"), wide: true }),
      `<div class="mb-field is-wide">
        <label class="mb-label" for="mb-player-input"><span>${t("target.player")}</span><em data-catalog-status></em></label>
        <div class="mb-player-search">
          <input id="mb-player-input" class="mb-input" type="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t("target.playerPlaceholder"))}" data-player-input aria-autocomplete="list" aria-controls="mb-player-results" />
          <div class="mb-results" id="mb-player-results" role="listbox" data-player-results hidden></div>
        </div>
        <div style="margin-top:8px" data-player-chip>${playerChipHtml()}</div>
        <div data-target-warning>${targetWarningHtml()}</div>
        <p class="mb-hint">${t("target.playerSearchHint")}</p>
      </div>`,
      selectField({ bind: "f:level", label: t("target.quality"), options: levels() }),
      selectField({ bind: "f:positionChoice", label: t("target.position"), options: positions() }),
      numberField({ bind: "f:minRating", label: t("target.minRating"), placeholder: "—", max: 99 }),
      numberField({ bind: "f:maxRating", label: t("target.maxRating"), placeholder: "—", max: 99 })
    )
  )}
  ${section(
    t("target.sectionBuyPrice"),
    grid(
      selectField({
        bind: "f:priceMode",
        label: t("target.priceMode"),
        wide: true,
        options: [
          ["fixed", t("target.priceModeFixed")],
          ["futbin", t("target.priceModeFutbin")],
          ["market", t("target.priceModeMarket")],
        ],
      }),
      // Même réglage (futbinPercent) pour les deux modes à pourcentage, libellé propre à chacun.
      numberField({
        bind: "f:futbinPercent",
        label: t("target.futbinPercent"),
        float: true,
        min: 10,
        max: 150,
        key: true,
        showIf: "f:priceMode=futbin",
        hint: t("target.futbinPercentHint"),
      }),
      numberField({
        bind: "f:futbinPercent",
        label: t("target.marketPercent"),
        float: true,
        min: 10,
        max: 150,
        key: true,
        showIf: "f:priceMode=market",
        hint: t("target.marketPercentHint"),
      }),
      priceField({
        bind: "f:maxBuy",
        label: t("target.maxBuy"),
        key: true,
        wide: true,
        hint: t("target.maxBuyHint"),
      }),
      `<div class="mb-field is-wide" data-show-if="f:priceMode=futbin"><div data-futbin-live>${futbinLiveHtml()}</div></div>`,
      `<div class="mb-field is-wide" data-show-if="f:priceMode=market"><div data-market-live>${marketLiveHtml()}</div></div>`,
      textField({
        bind: "f:futbinList",
        label: t("target.futbinList"),
        wide: true,
        showIf: "f:priceMode=futbin",
        placeholder: t("target.futbinListPlaceholder"),
        hint: t("target.futbinListHint", { example: "https://www.futbin.com/27/players?nation=163&position=LM&pos_type=main" }),
      }),
      priceField({ bind: "f:maxBid", label: t("target.maxBid"), hint: t("target.maxBidHint") }),
      numberField({
        bind: "f:bidPercent",
        label: t("target.bidPercent"),
        min: 10,
        max: 150,
        showIf: "f:priceMode=futbin",
        placeholder: t("target.bidPercentPlaceholder"),
        hint: t("target.bidPercentHint"),
      }),
      priceField({ bind: "f:minBuy", label: t("target.minBuy"), hint: t("target.optional") })
    )
  )}
  ${section(
    t("target.sectionResale"),
    // Mode prix marché EA : revente déduite du prix relevé, les réglages de revente du filtre sont masqués.
    `<div data-show-if="f:priceMode!=market">${grid(
      selectField({
        bind: "f:sellMode",
        label: t("target.resalePrice"),
        wide: true,
        options: [
          ["global", t("target.sellModeGlobal")],
          ["fixed", t("target.sellModeFixed")],
          ["futbin", t("target.sellModeFutbin")],
        ],
      }),
      priceField({ bind: "f:sellPrice", label: t("target.resalePrice"), wide: true, showIf: "f:sellMode=fixed" }),
      rangeField({
        bind: "f:sellPercent",
        label: t("target.futbinPercent"),
        unit: null,
        optional: true,
        wide: true,
        placeholder: t("target.sellPercentPlaceholder"),
        showIf: "f:sellMode=futbin",
        hint: t("target.sellPercentHint"),
      })
    )}</div>
    <div class="mb-note" data-show-if="f:priceMode=market">${t("target.marketResaleNote")}</div>`
  )}
  ${section(
    t("target.sectionAdvanced"),
    grid(
      numberField({ bind: "f:definitionId", label: t("target.definitionId"), placeholder: t("target.definitionIdPlaceholder") }),
      textField({ bind: "f:raritiesText", label: t("target.rarityIds"), placeholder: t("target.rarityIdsPlaceholder") }),
      numberField({ bind: "f:nationField", label: t("target.nationId"), placeholder: "—" }),
      numberField({ bind: "f:leagueField", label: t("target.leagueId"), placeholder: "—" }),
      numberField({ bind: "f:clubField", label: t("target.clubId"), placeholder: "—" }),
      numberField({ bind: "f:playStyleField", label: t("target.playStyleId"), placeholder: "—" })
    ) +
      `<p class="mb-hint">${t("target.advancedHint")}</p>`
  )}
  ${section(
    t("target.sectionImport"),
    `<div class="mb-note" data-last-ea>${lastEaHtml()}</div>
     <div class="mb-row" style="margin-top:8px">
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-target-action="import">${t("target.importEaSearch")}</button>
       <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-target-action="preview">${t("target.testSearch")}</button>
     </div>
     <div data-preview></div>`
  )}
`;

// Champs "virtuels" : convertis vers le modèle du filtre.
const VIRTUAL = {
  positionChoice: {
    read: (filter) => (filter.zone > 0 ? String(filter.zone) : filter.position || "any"),
    write: (value) =>
      /^13[0-2]$/.test(value) ? { zone: Number(value), position: "any" } : { zone: -1, position: value || "any" },
  },
  raritiesText: {
    read: (filter) => filter.rarities.join(", "),
    write: (value) => ({
      rarities: String(value || "")
        .split(/[\s,;]+/)
        .map((v) => parseInt(v, 10))
        .filter((v) => Number.isFinite(v) && v >= 0),
    }),
  },
  nationField: { read: (f) => (f.nation > 0 ? f.nation : 0), write: (v) => ({ nation: toInt(v) || -1 }) },
  leagueField: { read: (f) => (f.league > 0 ? f.league : 0), write: (v) => ({ league: toInt(v) || -1 }) },
  clubField: { read: (f) => (f.club > 0 ? f.club : 0), write: (v) => ({ club: toInt(v) || -1 }) },
  playStyleField: { read: (f) => (f.playStyle > 0 ? f.playStyle : 0), write: (v) => ({ playStyle: toInt(v) || -1 }) },
};

registerVirtualFilterFields(VIRTUAL);

const previewHtml = (result) => {
  if (!result.ok) {
    return `<div class="mb-note is-warn" style="margin-top:8px">${escapeHtml(result.message)}</div>`;
  }
  if (!result.rows.length) {
    // Mode prix marché : recherche sous le prix le plus bas du moment, souvent vide ; le prix relevé est affiché.
    const market = result.marketPrice
      ? `${t("target.previewMarketNote", { price: formatCoins(result.marketPrice), max: formatCoins(result.maxBuy) })} `
      : "";
    return `<div class="mb-note" style="margin-top:8px">${market}${t("target.previewNoneFound", {
      atPrice: result.maxBuy ? ` ${t("target.previewAtOrBelow", { coins: formatCoins(result.maxBuy) })}` : "",
      ms: Math.round(result.latency),
    })}</div>`;
  }
  const futbinCols = result.cardCount > 0;
  const rows = result.rows
    .slice(0, 21)
    .map((row) => {
      const deal = row.max && row.bin && row.bin <= row.max && row.match && !row.own;
      const minutes = Math.floor(row.expires / 60);
      const time = row.expires >= 3600 ? `${Math.floor(row.expires / 3600)} h` : `${minutes} min`;
      return `<tr class="${deal ? "is-deal" : row.match ? "" : "is-muted"}">
        <td>${escapeHtml(row.name)} ${row.rating}${row.own ? ` ${t("target.previewYou")}` : ""}</td>
        <td class="is-num">${row.bin ? formatCoins(row.bin) : "—"}</td>
        <td class="is-num">${row.bid ? formatCoins(row.bid) : "—"}</td>
        ${futbinCols ? `<td class="is-num">${row.match && row.max ? formatCoins(row.max) : "—"}</td>` : ""}
        <td class="is-num">${time}</td>
      </tr>`;
    })
    .join("");
  const cheapest = result.rows.find((row) => row.bin && row.match && !row.own);
  const futbin = result.marketPrice
    ? ` · ${t("target.previewMarketMax", { price: formatCoins(result.marketPrice), max: formatCoins(result.maxBuy) })}`
    : result.futbinPrice
    ? ` · ${t("target.previewFutbinMax", { price: formatCoins(result.futbinPrice), max: formatCoins(result.maxBuy) })}`
    : result.cardCount > 1
    ? ` · ${t("target.previewCardsTracked", { n: result.cardCount, label: result.label ? `, ${result.label}` : "" })} (${
        result.minBuy
          ? t("target.previewRange", { min: formatCoins(result.minBuy), max: formatCoins(result.maxBuy) })
          : `≤ ${formatCoins(result.maxBuy)}`
      })`
    : "";
  return `<div class="mb-preview">
      <table>
        <thead><tr><th>${t("target.previewColCard")}</th><th class="is-num">${t("target.previewColBin")}</th><th class="is-num">${t("target.previewColBid")}</th>${futbinCols ? `<th class="is-num">${t("target.previewColMax")}</th>` : ""}<th class="is-num">${t("target.previewColEnds")}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="mb-hint">${plural(result.rows.length, "target.previewResultsOne", "target.previewResultsMany")} · ${Math.round(result.latency)} ms${
      cheapest ? ` · ${t("target.previewCheapest", { coins: formatCoins(cheapest.bin) })}` : ""
    }${futbin}. ${t("target.previewGreenHint")}</p>`;
};

// Export / import JSON des filtres (zone sous les boutons de la liste).
const filterIo = async (page, kind) => {
  const box = qs(page, "[data-filter-io]");
  if (!box) {
    return;
  }
  if (kind === "close") {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  if (kind === "export") {
    const json = exportFilters();
    const n = getFilters().length;
    let copied = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(json);
        copied = true;
      }
    } catch (e) {}
    box.innerHTML = `
      <p class="mb-hint">${escapeHtml(t(copied ? "target.exportCopied" : "target.exportManual", { n }))}</p>
      <textarea class="mb-input mb-filter-io-text" rows="6" readonly spellcheck="false" data-filter-io-text>${escapeHtml(json)}</textarea>
      <div class="mb-row"><button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-filter-io-action="close">${t("target.ioClose")}</button></div>`;
    box.hidden = false;
    const area = qs(box, "[data-filter-io-text]");
    if (area && !copied) {
      area.focus();
      area.select();
    }
    return;
  }
  if (kind === "import") {
    box.innerHTML = `
      <textarea class="mb-input mb-filter-io-text" rows="6" spellcheck="false" placeholder="${escapeHtml(t("target.importPlaceholder"))}" data-filter-io-text></textarea>
      <p class="mb-hint" data-filter-io-message></p>
      <div class="mb-row">
        <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-filter-io-action="run">${t("target.importRun")}</button>
        <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-filter-io-action="close">${t("target.ioClose")}</button>
      </div>`;
    box.hidden = false;
    const area = qs(box, "[data-filter-io-text]");
    if (area) {
      area.focus();
    }
    return;
  }
  if (kind === "run") {
    const area = qs(box, "[data-filter-io-text]");
    const message = qs(box, "[data-filter-io-message]");
    const result = importFilters(area ? area.value : "");
    if (result.error) {
      if (message) {
        message.textContent = t(result.error === "json" ? "target.importBadJson" : "target.importEmpty");
        message.classList.add("is-warn");
      }
      return;
    }
    box.innerHTML = `<p class="mb-hint">${escapeHtml(t("target.importAdded", { n: result.added }))}</p>
      <div class="mb-row"><button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-filter-io-action="close">${t("target.ioClose")}</button></div>`;
  }
};

export const bindTargetPage = (page, refreshAll) => {
  const listEl = qs(page, "[data-filter-list]");
  const chipEl = qs(page, "[data-player-chip]");
  const input = qs(page, "[data-player-input]");
  const results = qs(page, "[data-player-results]");
  const status = qs(page, "[data-catalog-status]");
  const lastEa = qs(page, "[data-last-ea]");
  const preview = qs(page, "[data-preview]");
  let hits = [];
  let focusIndex = -1;

  const warningEl = qs(page, "[data-target-warning]");
  const liveEl = qs(page, "[data-futbin-live]");
  const marketEl = qs(page, "[data-market-live]");
  const renderLive = () => {
    setHtml(liveEl, futbinLiveHtml());
    setHtml(marketEl, marketLiveHtml());
  };
  const listInput = qs(page, '[data-bind="f:futbinList"]');
  const renderList = () => {
    setHtml(listEl, listHtml());
    setHtml(chipEl, playerChipHtml());
    setHtml(warningEl, targetWarningHtml());
    setHtml(lastEa, lastEaHtml());
    syncLiveTracking();
    renderLive();
    const filter = getActiveFilter();
    const auto = filter ? futbinListUrl(Object.assign({}, filter, { futbinList: "" })) : "";
    if (listInput) {
      listInput.placeholder = auto || t("target.futbinListPlaceholder");
    }
  };

  if (unsubscribeFilters) {
    unsubscribeFilters();
  }
  unsubscribeFilters = onFiltersChange(() => {
    renderList();
    refreshAll();
  });
  if (unsubscribePrices) {
    unsubscribePrices();
  }
  let liveFrame = null;
  const scheduleLive = () => {
    if (!liveFrame) {
      liveFrame = setTimeout(() => {
        liveFrame = null;
        renderLive();
        refreshAll();
      }, 300);
    }
  };
  unsubscribePrices = onPriceUpdate((id) => {
    if (liveSet.key && cardSetSnapshot(liveSet.key).cards.some((card) => card.eaId === id)) {
      scheduleLive();
    }
  });
  if (unsubscribeSets) {
    unsubscribeSets();
  }
  unsubscribeSets = onCardSetUpdate((key) => {
    if (key === liveSet.key) {
      scheduleLive();
    }
  });
  syncLiveTracking();
  clearInterval(liveTimer);
  liveTimer = setInterval(renderLive, 15000);

  // Bilan par filtre mis à jour en place (au plus une fois par seconde), sans redessiner la liste.
  if (unsubscribeStats) {
    unsubscribeStats();
  }
  let statsFrame = null;
  unsubscribeStats = onStateChange(() => {
    if (statsFrame) {
      return;
    }
    statsFrame = setTimeout(() => {
      statsFrame = null;
      listEl.querySelectorAll("[data-filter-stats]").forEach((el) => {
        const text = filterStatsText(el.dataset.filterStats);
        el.hidden = !text;
        if (el.textContent !== text) {
          el.textContent = text;
        }
      });
    }, 1000);
  });

  const closeResults = () => {
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    focusIndex = -1;
  };

  // Version FUTBIN : cette carte précise (et sa page FUTBIN, sans ambiguïté sur le prix).
  // Catalogue EA (secours) : toutes les versions du joueur.
  const choose = (hit) => {
    const filter = getActiveFilter();
    if (!filter || !hit) {
      return;
    }
    const exact = hit.source === "futbin";
    const patch = {
      player: { id: hit.eaId & 0xffffff, name: hit.name, rating: hit.rating },
      definitionId: exact ? hit.eaId : 0,
      futbinUrl: exact ? hit.url : "",
      futbinId: exact ? hit.futbinId : 0,
    };
    if (exact && hit.futbinId) {
      seedFutbinPrice(hit.eaId, { link: { futbinId: hit.futbinId, url: hit.url, name: hit.name, rating: hit.rating } });
    }
    if (isDefaultName(filter.name) || isEaSearchName(filter.name) || filter.player) {
      const tag = exact && hit.eaId > 0xffffff ? ` ${hit.version || t("target.specialTag")}` : "";
      patch.name = `${hit.name}${hit.rating ? ` ${hit.rating}` : ""}${tag}`;
    }
    updateFilter(filter.id, patch);
    input.value = "";
    closeResults();
  };

  const paintHits = () => {
    if (!hits.length) {
      results.innerHTML = `<div class="mb-hit"><small>${t("target.noPlayerFound")}</small></div>`;
      results.hidden = false;
      return;
    }
    results.innerHTML = hits
      .map((hit, index) => {
        const details =
          hit.source === "futbin"
            ? [
                hit.version || (hit.eaId > 0xffffff ? t("target.hitSpecialVersion") : t("target.hitBaseCard")),
                hit.position,
                hit.club,
                `id ${hit.eaId}`,
              ]
            : [`${hit.firstName || ""} ${hit.lastName || ""}`.trim(), t("target.allVersions"), `id ${hit.eaId}`];
        return `<button type="button" class="mb-hit${index === focusIndex ? " is-focus" : ""}" role="option" data-hit="${index}">
          <span class="mb-hit-rating">${hit.rating || "—"}</span>
          <span><b>${escapeHtml(hit.name)}</b><small>${escapeHtml(details.filter(Boolean).join(" · "))}</small></span>
        </button>`;
      })
      .join("");
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  // Recherche FUTBIN (toutes les versions : base, spéciales, autre club…), catalogue EA en secours.
  const search = debounce(async () => {
    const term = input.value.trim();
    if (term.length < 2) {
      closeResults();
      return;
    }
    const seq = (searchSeq += 1);
    status.textContent = t("target.searchingFutbin");
    let found = [];
    let source = "futbin";
    if (term.length >= 3) {
      const res = await searchFutbin(term);
      if (res.ok) {
        found = res.rows.filter((row) => row.eaId).slice(0, 15).map((row) => Object.assign({ source: "futbin" }, row));
      }
    }
    if (!found.length) {
      source = "ea";
      found = (await searchEaPlayersByTerm(term, 12)).map((row) => Object.assign({ source: "ea" }, row));
    }
    if (seq !== searchSeq) {
      return;
    }
    hits = found;
    status.textContent = !hits.length ? t("target.noResults") : source === "ea" ? t("target.eaCatalogFallback") : "";
    focusIndex = hits.length ? 0 : -1;
    paintHits();
  }, 400);

  input.addEventListener("input", search);
  input.addEventListener("focus", () => {
    loadEaPlayersCatalog().then((rows) => {
      status.textContent =
        rows && rows.length
          ? plural(rows.length, "target.catalogPlayersOne", "target.catalogPlayersMany", { n: rows.length.toLocaleString(locale()) })
          : t("target.catalogUnavailable");
    });
  });
  input.addEventListener("keydown", (event) => {
    if (results.hidden || !hits.length) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusIndex = (focusIndex + (event.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      paintHits();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(hits[Math.max(0, focusIndex)]);
    } else if (event.key === "Escape") {
      closeResults();
    }
  });
  results.addEventListener("mousedown", (event) => event.preventDefault());
  results.addEventListener("click", (event) => {
    const hit = event.target.closest("[data-hit]");
    if (hit) {
      choose(hits[Number(hit.dataset.hit)]);
    }
  });
  input.addEventListener("blur", () => setTimeout(closeResults, 120));

  page.addEventListener("click", async (event) => {
    const target = event.target;
    const toggle = target.closest("[data-filter-toggle]");
    if (toggle) {
      event.stopPropagation();
      const filter = getFilters().find((f) => f.id === toggle.dataset.filterToggle);
      if (filter) {
        updateFilter(filter.id, { enabled: !filter.enabled });
      }
      return;
    }
    const item = target.closest("[data-filter-id]");
    if (item) {
      setActiveFilter(item.dataset.filterId);
      preview.innerHTML = "";
      return;
    }
    if (target.closest("[data-player-clear]")) {
      const filter = getActiveFilter();
      if (filter) {
        const patch = { player: null, definitionId: 0, futbinUrl: "", futbinId: 0 };
        // Nom tiré du joueur retiré : on repart d'un nom neutre.
        if (filter.player && filter.name.startsWith(filter.player.name)) {
          patch.name = t("target.newFilterName");
        }
        updateFilter(filter.id, patch);
      }
      return;
    }
    if (target.closest("[data-player-versions]")) {
      const filter = getActiveFilter();
      if (filter) {
        updateFilter(filter.id, { definitionId: 0, futbinUrl: "", futbinId: 0 });
      }
      return;
    }
    const io = target.closest("[data-filter-io-action]");
    if (io) {
      filterIo(page, io.dataset.filterIoAction);
      return;
    }
    const action = target.closest("[data-filter-action]");
    if (action && (action.dataset.filterAction === "export" || action.dataset.filterAction === "import")) {
      await filterIo(page, action.dataset.filterAction);
      return;
    }
    if (action) {
      const active = getActiveFilter();
      if (action.dataset.filterAction === "fodder") {
        const added = addFodderFilters();
        preview.innerHTML = `<div class="mb-note" style="margin-top:8px">${escapeHtml(t("target.fodderAdded", { n: added.length }))}</div>`;
        return;
      }
      if (action.dataset.filterAction === "add") {
        addFilter({ name: t("target.newFilterName") });
      } else if (action.dataset.filterAction === "duplicate" && active) {
        duplicateFilter(active.id);
      } else if (action.dataset.filterAction === "delete" && active) {
        if (window.confirm(t("target.confirmDelete", { name: active.name }))) {
          removeFilter(active.id);
        }
      } else if (action.dataset.filterAction === "prune") {
        // Une seule confirmation pour tous les filtres désactivés (pas une par filtre).
        const inactive = getFilters().filter((filter) => filter.enabled === false).length;
        if (inactive && window.confirm(t("target.confirmPrune", { n: inactive }))) {
          removeInactiveFilters();
        }
      }
      preview.innerHTML = "";
      return;
    }
    const targetAction = target.closest("[data-target-action]");
    if (!targetAction) {
      return;
    }
    if (targetAction.dataset.targetAction === "futbin-refresh") {
      if (liveSet.key) {
        refreshCardSet(liveSet.key);
      }
      return;
    }
    if (targetAction.dataset.targetAction === "import") {
      const snapshot = getLastEaSearch();
      if (!snapshot) {
        preview.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">${t("target.importNone")}</div>`;
        return;
      }
      importSnapshot(snapshot);
      preview.innerHTML = `<div class="mb-note" style="margin-top:8px">${t("target.importDone")}</div>`;
      return;
    }
    if (targetAction.dataset.targetAction === "preview") {
      if (isRunning()) {
        preview.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">${t("target.botRunning")}</div>`;
        return;
      }
      targetAction.disabled = true;
      preview.innerHTML = `<div class="mb-note" style="margin-top:8px">${t("target.searching")}</div>`;
      try {
        const filter = getActiveFilter();
        const result = await previewSearch(filter);
        preview.innerHTML = previewHtml(result);
      } catch (e) {
        preview.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">${escapeHtml(e.message || e)}</div>`;
      } finally {
        targetAction.disabled = false;
      }
    }
  });
  page.addEventListener("keydown", (event) => {
    const item = event.target.closest && event.target.closest("[data-filter-id]");
    if (item && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setActiveFilter(item.dataset.filterId);
    }
  });
};

// Applique une recherche EA capturée au filtre actif (ou en crée un nouveau).
export const importSnapshot = (snapshot, { asNew = false } = {}) => {
  if (!snapshot) {
    return null;
  }
  const patch = {
    type: snapshot.type,
    category: snapshot.category,
    level: snapshot.level,
    rarities: snapshot.rarities,
    position: snapshot.position,
    zone: snapshot.zone,
    nation: snapshot.nation,
    league: snapshot.league,
    club: snapshot.club,
    playStyle: snapshot.playStyle,
    definitionId: snapshot.definitionId,
    player: snapshot.player,
  };
  if (snapshot.maxBuy) {
    patch.maxBuy = snapshot.maxBuy;
  }
  if (snapshot.minBuy) {
    patch.minBuy = snapshot.minBuy;
  }
  if (snapshot.maxBid) {
    patch.maxBid = snapshot.maxBid;
  }
  const name = snapshot.player && snapshot.player.name
    ? `${snapshot.player.name}${snapshot.player.rating ? ` ${snapshot.player.rating}` : ""}`
    : t("target.eaSearchName");
  const active = getActiveFilter();
  if (asNew || !active) {
    return addFilter(Object.assign({ name }, patch));
  }
  if (isDefaultName(active.name) || isEaSearchName(active.name)) {
    patch.name = name;
  }
  updateFilter(active.id, patch);
  return normalizeFilter(Object.assign({}, active, patch));
};

// Achat max réellement utilisé (fixe, ou % FUTBIN / % prix marché plafonné) pour les aides de la page.
const effectiveBuy = (filter) => {
  if (filter.priceMode === "market") {
    return marketInfoFor(filter).max;
  }
  if (filter.priceMode !== "futbin") {
    return toInt(filter.maxBuy);
  }
  const key = futbinKeyForFilter(filter);
  const price = key ? currentPrice(key, LIVE_MAX_AGE, "buy") : 0;
  if (!price) {
    return 0;
  }
  const computed = floorPrice((price * filter.futbinPercent) / 100);
  return filter.maxBuy ? Math.min(filter.maxBuy, computed) : computed;
};

// Texte d'aide sous le prix de revente : net après taxe + bénéfice par carte.
export const sellExtra = () => {
  const filter = getActiveFilter();
  if (!filter) {
    return "";
  }
  const settings = getSettings().sell;
  let sell = 0;
  let prefix = "";
  const futbinSell = filter.sellMode === "futbin" || (filter.sellMode === "global" && settings.priceMode === "futbin");
  if (futbinSell) {
    const key = futbinKeyForFilter(filter);
    const price = key ? currentPrice(key, LIVE_MAX_AGE, "sell") : 0;
    if (!price) {
      return "";
    }
    const range = percentRange(filter.sellMode === "futbin" && filter.sellPercent ? filter.sellPercent : settings.futbinPercent);
    sell = roundPrice((price * (range.min + range.max)) / 200);
    prefix = `≈ ${formatCoins(sell)} · `;
  } else {
    sell = filter.sellMode === "fixed" ? toInt(filter.sellPrice) || toInt(settings.defaultPrice) : toInt(settings.defaultPrice);
  }
  if (!sell) {
    return "";
  }
  const buy = effectiveBuy(filter);
  const net = afterTax(sell);
  const profit = buy ? profitFor(buy, sell) : 0;
  return `${prefix}${t("target.sellNet", { coins: formatCoins(net) })}${
    buy ? ` · ${t("target.sellProfit", { profit: `${profit >= 0 ? "+" : ""}${formatCoins(profit)}` })}` : ""
  }`;
};
