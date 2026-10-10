import { addFilter, getFilters } from "../../core/filters";
import { holoFilterFor, holoRarities, holoScanRunning, lastHoloScan, scanHoloPremiums, stopHoloScan } from "../../core/holoScan";
import { log } from "../../core/logger";
import { formatCoins, toInt } from "../../core/prices";
import { getSettings } from "../../core/settings";
import { locale, t } from "../../i18n";
import { fetchFutbinPrice, futbinRequestCount, resolveFutbinLink } from "../../prices/futbinClient";
import { searchFutbinApi } from "../../prices/futbinApi";
import { clearFutbinCache, getFutbinStatus, priceSource, pricePlatform } from "../../prices/priceService";
import { escapeHtml, qs, setHtml } from "../dom";
import { grid, numberField, priceField, rangeField, section, selectField, toggleField } from "../fields";

// Onglet FUTBIN : accès (test), scanner de prime holo, fréquence de rafraîchissement, étiquettes sur
// les cartes, DCE.

const TEST_CARD = { definitionId: 231747, name: "Mbappé", rating: 0 };

// État du service de prix → clé du libellé.
const STATE_KEYS = {
  idle: "ui.futbinStateIdle",
  fetching: "ui.futbinStateFetching",
  queued: "ui.futbinStateQueued",
  blocked: "ui.futbinStateBlocked",
};

const stateText = (state) => (STATE_KEYS[state] ? t(STATE_KEYS[state]) : state);

const ago = (timestamp) => {
  if (!timestamp) {
    return t("ui.never");
  }
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return seconds < 60 ? t("ui.secondsAgo", { n: seconds }) : t("ui.minutesAgo", { n: Math.round(seconds / 60) });
};

const statusHtml = () => {
  const status = getFutbinStatus();
  const cell = (label, value) => `<div>${label}<b>${value}</b></div>`;
  const blocked = status.blockedUntil > Date.now();
  return `<div class="mb-stats-list">
      ${cell(t("ui.futbinStatus"), escapeHtml(stateText(status.state)))}
      ${cell(t("ui.futbinPlatform"), pricePlatform() === "pc" ? "PC" : t("ui.platformConsole"))}
      ${cell(t("ui.futbinTracked"), status.tracked)}
      ${cell(t("ui.futbinQueue"), status.queue)}
      ${cell(t("ui.futbinLastPrice"), ago(status.lastSuccessAt))}
      ${cell(t("ui.futbinRequests"), futbinRequestCount())}
      ${cell(t("ui.futbinApiRequests"), status.apiRequests)}
    </div>${
      status.source === "api" && status.apiPausedUntil
        ? `<div class="mb-note is-warn" style="margin-top:8px">${t("ui.futbinApiPaused", { n: Math.ceil((status.apiPausedUntil - Date.now()) / 1000) })}</div>`
        : ""
    }${
      status.lastError || blocked
        ? `<div class="mb-note is-warn" style="margin-top:8px">${escapeHtml(status.lastError || t("ui.futbinSlowed"))}${
            blocked ? ` · ${t("ui.resumeIn", { n: Math.ceil((status.blockedUntil - Date.now()) / 1000) })}` : ""
          }</div>`
        : ""
    }`;
};

// ------------------------------------------------------------- prime holo

const HOLO_ROWS_SHOWN = 40;

// Bénéfice exigé à l'achat (onglet Achat), 1 000 par défaut : la règle des flips holo et Ombre.
const holoMinProfit = () => toInt(getSettings().buy.minProfit) || 1000;

const signedCoins = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatCoins(Math.abs(value))}`;

const holoResultsHtml = () => {
  const scan = lastHoloScan();
  if (!scan) {
    return "";
  }
  if (!scan.rows.length) {
    return `<p class="mb-hint">${t(scan.pairs ? "ui.holoNoneInRange" : "ui.holoNone")}</p>`;
  }
  const rows = scan.rows.slice(0, HOLO_ROWS_SHOWN);
  return `<div class="mb-preview mb-holo-table"><table>
      <thead><tr><th><input type="checkbox" data-holo-all aria-label="${escapeHtml(t("ui.holoPickAll"))}" /></th>
        <th>${t("ui.holoColPlayer")}</th><th class="is-num">${t("ui.holoColNormal")}</th><th class="is-num">${t("ui.holoColHolo")}</th>
        <th class="is-num" title="${escapeHtml(t("ui.holoColEdgeHint"))}">${t("ui.holoColEdge")}</th>
        <th class="is-num" title="${escapeHtml(t("ui.holoColCapHint", { min: formatCoins(scan.minProfit) }))}">${t("ui.holoColCap")}</th></tr></thead>
      <tbody>${rows
        .map((row) => {
          const good = row.edge >= scan.minProfit;
          const name = row.url
            ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noopener" title="${escapeHtml(row.fullName)}">${escapeHtml(row.name)}</a>`
            : escapeHtml(row.name);
          return `<tr class="${good ? "" : "is-muted"}">
            <td><input type="checkbox" data-holo-pick="${row.eaId}"${good ? " checked" : ""} aria-label="${escapeHtml(row.name)}" /></td>
            <td>${name} ${row.rating}</td>
            <td class="is-num">${formatCoins(row.normalPrice)}</td>
            <td class="is-num">${formatCoins(row.holoPrice)}</td>
            <td class="is-num">${signedCoins(row.edge)}</td>
            <td class="is-num">${formatCoins(row.cap)}</td></tr>`;
        })
        .join("")}</tbody></table></div>
    <div class="mb-row" style="margin-top:8px">
      <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-futbin-action="holo-filters">${t("ui.holoCreateFilters")}</button>
    </div>`;
};

const holoSectionHtml = () =>
  section(
    t("ui.holoSection"),
    grid(
      selectField({
        bind: "s:holo.rarity",
        label: t("ui.holoPromo"),
        wide: true,
        numeric: true,
        options: holoRarities().map((entry) => [String(entry.id), entry.name]),
      }),
      priceField({ bind: "s:holo.minPrice", label: t("ui.holoMinPrice") }),
      priceField({ bind: "s:holo.maxPrice", label: t("ui.holoMaxPrice") })
    ) +
      `<div class="mb-row" style="margin-top:8px">
        <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-futbin-action="holo-scan"${holoScanRunning() ? " disabled" : ""}>${t("ui.holoScan")}</button>
        <button type="button" class="mb-btn mb-btn-danger mb-btn-sm" data-futbin-action="holo-stop"${holoScanRunning() ? "" : " hidden"}>${t("ui.holoStop")}</button>
      </div>
      <div data-holo-status></div>
      <div data-holo-results>${holoResultsHtml()}</div>
      <p class="mb-hint">${t("ui.holoHint")}</p>`
  );

export const futbinPageHtml = () => `
  ${section(
    t("ui.futbinAccessSection"),
    `<div data-futbin-status>${statusHtml()}</div>
     <div class="mb-row" style="margin-top:8px">
       <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-futbin-action="test">${t("ui.futbinTest")}</button>
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-futbin-action="open">${t("ui.futbinOpen")}</button>
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-futbin-action="clear">${t("ui.futbinClearCache")}</button>
     </div>
     <div data-futbin-test></div>
     <p class="mb-hint">${t("ui.futbinAccessHint")}</p>`
  )}
  ${holoSectionHtml()}
  ${section(
    t("ui.priceRefreshSection"),
    grid(
      selectField({
        bind: "s:prices.source",
        label: t("ui.priceSource"),
        wide: true,
        hint: t("ui.priceSourceHint"),
        options: [
          ["api", t("ui.priceSourceApi")],
          ["pages", t("ui.priceSourcePages")],
        ],
      }),
      selectField({
        bind: "s:prices.platform",
        label: t("ui.pricePlatform"),
        wide: true,
        options: [
          ["auto", t("ui.pricePlatformAuto")],
          ["console", t("ui.pricePlatformConsole")],
          ["pc", "PC"],
        ],
      }),
      numberField({ bind: "s:prices.hotInterval", label: t("ui.hotInterval"), min: 60, max: 120, hint: t("ui.hotIntervalHint") }),
      numberField({ bind: "s:prices.visibleInterval", label: t("ui.visibleInterval"), min: 60, max: 600, hint: t("ui.visibleIntervalHint") }),
      numberField({ bind: "s:prices.jumpGuard", label: t("ui.jumpGuard"), min: 5, max: 90, hint: t("ui.jumpGuardHint") }),
      numberField({ bind: "s:prices.minGap", label: t("ui.minGap"), float: true, min: 0.8, max: 10, hint: t("ui.minGapHint") }),
      numberField({ bind: "s:prices.listInterval", label: t("ui.listInterval"), min: 120, max: 900, hint: t("ui.listIntervalHint") }),
      numberField({ bind: "s:prices.listPages", label: t("ui.listPages"), min: 1, max: 10, hint: t("ui.listPagesHint") }),
      toggleField({
        bind: "s:prices.iframeFallback",
        label: t("ui.iframeFallback"),
        wide: true,
        hint: t("ui.iframeFallbackHint"),
      })
    )
  )}
  ${section(
    t("ui.displaySection"),
    grid(
      toggleField({
        bind: "s:ui.cardPrices",
        label: t("ui.cardPrices"),
        wide: true,
        hint: t("ui.cardPricesHint"),
      })
    )
  )}
  ${section(
    t("ui.sbcSection"),
    grid(
      numberField({ bind: "s:sbc.margin", label: t("ui.sbcMargin"), min: 0, max: 50, hint: t("ui.sbcMarginHint") }),
      numberField({ bind: "s:sbc.triesPerPlayer", label: t("ui.sbcTries"), min: 1, max: 30 }),
      rangeField({ bind: "s:sbc.wait", label: t("ui.sbcWait"), unit: "S", placeholder: "3-5", wide: true })
    ) +
      `<p class="mb-hint">${t("ui.sbcHint")}</p>`
  )}
`;

// Promos du web app, relues quand l'onglet s'affiche : le panneau peut être construit avant le web app.
const refreshHoloRarities = (body) => {
  const select = qs(body, '[data-bind="s:holo.rarity"]');
  const list = holoRarities();
  if (!select || select.options.length >= list.length) {
    return;
  }
  setHtml(select, list.map((entry) => `<option value="${entry.id}">${escapeHtml(entry.name)}</option>`).join(""));
  select.value = String(getSettings().holo.rarity);
};

export const refreshFutbinStatus = (body) => {
  const el = qs(body, "[data-futbin-status]");
  if (el) {
    setHtml(el, statusHtml());
  }
  refreshHoloRarities(body);
};

const seconds = (started) =>
  // Durée du test avec la décimale de la langue de l'interface (2,4 / 2.4).
  ((Date.now() - started) / 1000).toLocaleString(locale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  });

// Test de l'API de l'appli FUTBIN : true si elle a répondu avec le prix de la carte de test.
const runApiTest = async (out, started) => {
  const res = await searchFutbinApi(TEST_CARD.name);
  const card = res.ok ? res.cards.find((entry) => entry.eaId === TEST_CARD.definitionId) : null;
  const platform = pricePlatform();
  const price = card ? card.prices[platform] : 0;
  if (!price) {
    const reason = res.blocked ? t("ui.futbinApiTestBlocked") : t("ui.futbinApiTestFailed", { status: res.status ? ` (${res.status})` : "" });
    log.warn(t("ui.futbinTestLog", { message: reason }));
    out.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">✗ ${escapeHtml(reason)}</div>`;
    return false;
  }
  const via = t("ui.futbinViaApi");
  const name = card.name || TEST_CARD.name;
  out.innerHTML = `<div class="mb-note" style="margin-top:8px">✓ ${t("ui.futbinTestOk", {
    via: escapeHtml(via),
    name: escapeHtml(name),
    price: `<b>${formatCoins(price)}</b>`,
    platform: platform === "pc" ? "PC" : t("ui.platformConsoleLower"),
    age: "",
    seconds: seconds(started),
  })}</div>`;
  log.success(t("ui.futbinTestOkLog", { via, name, price: formatCoins(price) }));
  return true;
};

const runTest = async (out) => {
  const started = Date.now();
  out.innerHTML = `<div class="mb-note" style="margin-top:8px">${t("ui.futbinTesting")}</div>`;
  // Source API : l'API d'abord ; en cas d'échec, les pages FUTBIN (le secours du bot) sont testées.
  if (priceSource() === "api" && (await runApiTest(out, started))) {
    return;
  }
  const previous = out.innerHTML;
  // Test explicite : la requête directe est retentée même si FUTBIN l'a refusée il y a peu.
  const resolved = await resolveFutbinLink(TEST_CARD, { forceDirect: true });
  if (!resolved.ok) {
    const message = resolved.blocked
      ? t("ui.futbinTestBlocked")
      : resolved.notFound
      ? t("ui.futbinTestNotFound")
      : t("ui.futbinTestNoResponse", { status: resolved.status ? ` (${resolved.status})` : "" });
    out.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">✗ ${escapeHtml(message)}</div>`;
    log.warn(t("ui.futbinTestLog", { message }));
    return;
  }
  const platform = pricePlatform();
  const price = await fetchFutbinPrice(resolved.link, platform, { forceDirect: true });
  if (!price.ok) {
    const message = price.blocked
      ? t("ui.futbinPageBlocked")
      : price.noPrice
      ? t("ui.futbinPageNoPrice")
      : t("ui.futbinPageNoResponse", { status: price.status ? ` (${price.status})` : "" });
    out.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">✗ ${t("ui.futbinSearchOkBut", { message: escapeHtml(message) })}</div>`;
    log.warn(t("ui.futbinTestLog", { message: `${message}.` }));
    return;
  }
  const via = price.via === "iframe" ? t("ui.futbinViaIframe") : price.via === "relay" ? t("ui.futbinViaRelay") : t("ui.futbinViaDirect");
  const age = price.updatedAgoSec ? ` · ${t("ui.futbinUpdatedAgo", { n: Math.round(price.updatedAgoSec / 60) })}` : "";
  const name = resolved.link.name || TEST_CARD.name;
  out.innerHTML = `<div class="mb-note" style="margin-top:8px">✓ ${t("ui.futbinTestOk", {
    via: escapeHtml(via),
    name: escapeHtml(name),
    price: `<b>${formatCoins(price.price)}</b>`,
    platform: platform === "pc" ? "PC" : t("ui.platformConsoleLower"),
    age,
    seconds: seconds(started),
  })}</div>${previous && priceSource() === "api" ? previous : ""}`;
  log.success(t("ui.futbinTestOkLog", { via, name, price: formatCoins(price.price) }));
};

const holoNote = (page, text, kind = "") => {
  const el = qs(page, "[data-holo-status]");
  if (el) {
    setHtml(el, `<div class="mb-note${kind ? ` is-${kind}` : ""}" style="margin-top:8px">${escapeHtml(text)}</div>`);
  }
};

const setHoloButtons = (page, busy) => {
  const scan = qs(page, '[data-futbin-action="holo-scan"]');
  const stop = qs(page, '[data-futbin-action="holo-stop"]');
  if (scan) {
    scan.disabled = busy;
  }
  if (stop) {
    stop.hidden = !busy;
  }
};

const runHoloScan = async (page) => {
  const options = getSettings().holo;
  setHoloButtons(page, true);
  try {
    const result = await scanHoloPremiums({
      rarity: options.rarity,
      min: options.minPrice,
      max: options.maxPrice,
      minProfit: holoMinProfit(),
      onProgress: (progress) => holoNote(page, progress.step === "ea" ? t("ui.holoProgressEa", progress) : t("ui.holoProgressCard", progress)),
    });
    if (!result.ok) {
      const message = result.busy ? t("ui.holoBusy") : t("ui.holoEaError", { error: (result.error && result.error.label) || "?" });
      holoNote(page, message, "warn");
      log.warn(message);
      return;
    }
    setHtml(qs(page, "[data-holo-results]"), holoResultsHtml());
    const good = result.rows.filter((row) => row.edge >= result.minProfit).length;
    const parts = [t("ui.holoDone", { count: result.rows.length, good, min: formatCoins(result.minProfit) })];
    if (result.outOfRange) {
      parts.push(t("ui.holoOutOfRange", { n: result.outOfRange }));
    }
    if (result.missed.length) {
      parts.push(t("ui.holoMissed", { n: result.missed.length }));
    }
    if (result.apiBlocked) {
      parts.push(t("ui.holoApiBlocked"));
    } else if (result.cancelled) {
      parts.push(t("ui.holoCancelled"));
    }
    const text = parts.join(" · ");
    holoNote(page, text, result.apiBlocked ? "warn" : "");
    log.info(t("ui.holoLog", { text }));
  } finally {
    setHoloButtons(page, false);
  }
};

// Filtres « prix marché EA » des holo cochées, désactivés ; une version déjà ciblée n'est pas recréée.
const createHoloFilters = (page) => {
  const scan = lastHoloScan();
  const picked = new Set(Array.from(page.querySelectorAll("[data-holo-pick]:checked")).map((el) => Number(el.dataset.holoPick)));
  const rows = scan ? scan.rows.filter((row) => picked.has(row.eaId)) : [];
  if (!rows.length) {
    holoNote(page, t("ui.holoNoneChecked"), "warn");
    return;
  }
  const targeted = new Set(getFilters().map((filter) => filter.definitionId).filter(Boolean));
  let created = 0;
  rows.forEach((row) => {
    if (targeted.has(row.eaId)) {
      return;
    }
    addFilter(holoFilterFor(row, t("ui.holoFilterName", { name: row.name, rating: row.rating })), false);
    targeted.add(row.eaId);
    created += 1;
  });
  const text = t("ui.holoFiltersCreated", { n: created, skipped: rows.length - created });
  holoNote(page, text);
  log.success(text);
};

export const bindFutbinPage = (page) => {
  page.addEventListener("change", (event) => {
    const all = event.target.closest("[data-holo-all]");
    if (all) {
      page.querySelectorAll("[data-holo-pick]").forEach((box) => {
        box.checked = all.checked;
      });
    }
  });
  page.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-futbin-action]");
    if (!action) {
      return;
    }
    if (action.dataset.futbinAction === "holo-scan") {
      await runHoloScan(page);
      return;
    }
    if (action.dataset.futbinAction === "holo-stop") {
      stopHoloScan();
      return;
    }
    if (action.dataset.futbinAction === "holo-filters") {
      createHoloFilters(page);
      return;
    }
    if (action.dataset.futbinAction === "open") {
      window.open("https://www.futbin.com/", "_blank", "noopener");
      return;
    }
    if (action.dataset.futbinAction === "clear") {
      if (window.confirm(t("ui.futbinClearConfirm"))) {
        clearFutbinCache();
        log.info(t("ui.futbinCacheCleared"));
        refreshFutbinStatus(page);
      }
      return;
    }
    if (action.dataset.futbinAction === "test") {
      action.disabled = true;
      try {
        await runTest(qs(page, "[data-futbin-test]"));
      } finally {
        action.disabled = false;
        refreshFutbinStatus(page);
      }
    }
  });
};
