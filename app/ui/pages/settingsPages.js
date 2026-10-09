import { listTransferAtFutbin } from "../../core/bulkSell";
import { isRunning } from "../../core/engine";
import * as market from "../../core/market";
import { log } from "../../core/logger";
import { notifyEvent, requestDesktopPermission, sound } from "../../core/notify";
import { formatCoins } from "../../core/prices";
import { TIMING_PRESETS, applyTimingPreset, getSettings, setSetting } from "../../core/settings";
import { getState, updateState } from "../../core/state";
import { beginTask, cancelTask, currentTask, endTask } from "../../core/tasks";
import { LANGUAGES, gameLanguage, t } from "../../i18n";
import { qs, setHtml, setText } from "../dom";
import {
  grid,
  numberField,
  priceField,
  rangeField,
  section,
  selectField,
  textField,
  toggleField,
} from "../fields";

// ------------------------------------------------------------------- Achat

export const buyPageHtml = () => `
  ${section(
    t("ui.buyNowSection"),
    grid(
      numberField({ bind: "s:buy.maxPerSearch", label: t("ui.buyMaxPerSearch"), min: 1, max: 5, hint: t("ui.buyMaxPerSearchHint") }),
      numberField({ bind: "s:buy.stopAfterPurchases", label: t("ui.buyStopAfter"), placeholder: t("ui.unlimited"), hint: t("ui.buyStopAfterHint") }),
      priceField({ bind: "s:buy.coinsReserve", label: t("ui.buyCoinsReserve"), hint: t("ui.buyCoinsReserveHint") }),
      numberField({ bind: "s:buy.maxResults", label: t("ui.buyMaxResults"), placeholder: t("ui.disabledPlaceholder"), hint: t("ui.buyMaxResultsHint") }),
      toggleField({ bind: "s:buy.skipGk", label: t("ui.buySkipGk"), wide: true }),
      toggleField({ bind: "s:buy.profitCheck", label: t("ui.buyProfitCheck"), wide: true, hint: t("ui.buyProfitCheckHint") }),
      numberField({ bind: "s:buy.minProfit", label: t("ui.buyMinProfit"), min: 0, max: 1000000, placeholder: t("ui.buyMinProfitPlaceholder"), hint: t("ui.buyMinProfitHint") }),
      numberField({ bind: "s:buy.fallingGuard", label: t("ui.buyFallingGuard"), min: 0, max: 50, placeholder: t("ui.disabledPlaceholder"), hint: t("ui.buyFallingGuardHint") }),
      numberField({ bind: "s:buy.marketRefreshMinutes", label: t("ui.buyMarketRefresh"), min: 3, max: 60, placeholder: "10", hint: t("ui.buyMarketRefreshHint") })
    )
  )}
  <div class="mb-note">${t("ui.buyFutbinNote")}</div>
  ${section(
    t("ui.bidSection"),
    grid(
      toggleField({ bind: "s:bid.enabled", label: t("ui.bidEnabled"), wide: true, hint: t("ui.bidEnabledHint") }),
      rangeField({ bind: "s:bid.expiresWithin", label: t("ui.bidExpiresWithin"), unit: "M", placeholder: "5M", hint: t("ui.bidExpiresWithinHint") }),
      numberField({ bind: "s:bid.maxPerSearch", label: t("ui.bidMaxPerSearch"), min: 1, max: 5 }),
      numberField({ bind: "s:bid.searchEvery", label: t("ui.bidSearchEvery"), min: 2, max: 20, hint: t("ui.bidSearchEveryHint") }),
      numberField({ bind: "s:bid.maxActive", label: t("ui.bidMaxActive"), min: 1, max: 50 }),
      toggleField({ bind: "s:bid.exact", label: t("ui.bidExact") }),
      toggleField({ bind: "s:bid.rebid", label: t("ui.bidRebid") }),
      toggleField({ bind: "s:bid.clearLost", label: t("ui.bidClearLost"), wide: true })
    )
  )}
`;

// ------------------------------------------------------------------- Vente

export const sellPageHtml = () => `
  ${section(
    t("ui.afterBuySection"),
    grid(
      selectField({
        bind: "s:sell.mode",
        label: t("ui.sellMode"),
        wide: true,
        options: [
          ["list", t("ui.sellModeList")],
          ["transfer", t("ui.sellModeTransfer")],
          ["none", t("ui.sellModeNone")],
        ],
      }),
      selectField({
        bind: "s:sell.duration",
        label: t("ui.sellDuration"),
        options: [
          ["1H", t("ui.duration1H")],
          ["3H", t("ui.duration3H")],
          ["6H", t("ui.duration6H")],
          ["12H", t("ui.duration12H")],
          ["1D", t("ui.duration1D")],
          ["3D", t("ui.duration3D")],
        ],
      }),
      // Bénéfice en coins (10, 100…), pas un prix EA : un champ prix ramènerait tout montant < 150 à 0.
      numberField({ bind: "s:sell.minProfit", label: t("ui.sellMinProfit"), min: 0, max: 1000000, hint: t("ui.sellMinProfitHint") }),
      toggleField({ bind: "s:sell.noLoss", label: t("ui.sellNoLoss"), wide: true, hint: t("ui.sellNoLossHint") }),
      toggleField({ bind: "s:sell.noLossOwnCards", label: t("ui.sellNoLossOwnCards"), wide: true, showIf: "s:sell.noLoss=true", hint: t("ui.sellNoLossOwnCardsHint") }),
      numberField({ bind: "s:sell.maxRating", label: t("ui.sellMaxRating"), placeholder: t("ui.disabledPlaceholder") })
    )
  )}
  ${section(
    t("ui.resaleSection"),
    grid(
      selectField({
        bind: "s:sell.priceMode",
        label: t("ui.sellPriceMode"),
        wide: true,
        options: [
          ["fixed", t("ui.sellPriceFixed")],
          ["futbin", t("ui.sellPriceFutbin")],
        ],
        hint: t("ui.sellPriceModeHint"),
      }),
      priceField({ bind: "s:sell.defaultPrice", label: t("ui.sellDefaultPrice"), wide: true, showIf: "s:sell.priceMode=fixed" }),
      rangeField({
        bind: "s:sell.futbinPercent",
        label: t("ui.sellFutbinPercent"),
        unit: null,
        placeholder: "99-100",
        wide: true,
        showIf: "s:sell.priceMode=futbin",
        hint: t("ui.sellFutbinPercentHint"),
      })
    )
  )}
  <div class="mb-note">${t("ui.sellNote")}</div>
`;

// ------------------------------------------------------------------ Timing

const presetButtons = () =>
  Object.keys(TIMING_PRESETS)
    .map((key) => {
      const preset = TIMING_PRESETS[key];
      const active = getSettings().timing.preset === key;
      return `<button type="button" class="mb-preset${active ? " is-active" : ""}" data-preset="${key}">
        <b>${t(preset.labelKey)}</b><small>${t(preset.hintKey)}</small>
      </button>`;
    })
    .join("");

export const timingPageHtml = () => `
  ${section(t("ui.profileSection"), `<div class="mb-presets" data-presets>${presetButtons()}</div>`)}
  ${section(
    t("ui.searchPaceSection"),
    grid(
      rangeField({ bind: "s:timing.wait", label: t("ui.timingWait"), unit: "S", placeholder: "5-9", key: true, wide: true, hint: t("ui.timingWaitHint") }),
      numberField({ bind: "s:timing.maxPerMinute", label: t("ui.timingMaxPerMinute"), placeholder: t("ui.unlimited"), hint: t("ui.timingMaxPerMinuteHint") }),
      rangeField({ bind: "s:timing.afterBuy", label: t("ui.timingAfterBuy"), unit: "S", optional: true, placeholder: "2-4S" })
    )
  )}
  ${section(
    t("ui.pausesSection"),
    grid(
      rangeField({ bind: "s:timing.pauseEvery", label: t("ui.timingPauseEvery"), unit: null, optional: true, placeholder: "15-25", hint: t("ui.timingPauseEveryHint") }),
      rangeField({ bind: "s:timing.pauseFor", label: t("ui.timingPauseFor"), unit: "S", optional: true, placeholder: "40-80S" }),
      rangeField({ bind: "s:timing.stopAfter", label: t("ui.timingStopAfter"), unit: "H", optional: true, placeholder: "2-3H", hint: t("ui.timingStopAfterHint"), wide: true })
    )
  )}
  ${section(
    t("ui.freshnessSection"),
    grid(
      selectField({
        bind: "s:timing.cacheBuster",
        label: t("ui.cacheBuster"),
        wide: true,
        options: [
          ["auto", t("ui.cacheBusterAuto")],
          ["minBuy", t("ui.cacheBusterMinBuy")],
          ["minBid", t("ui.cacheBusterMinBid")],
          ["off", t("ui.cacheBusterOff")],
        ],
        hint: t("ui.cacheBusterHint"),
      }),
      numberField({ bind: "s:timing.maxPages", label: t("ui.timingMaxPages"), min: 1, max: 5, hint: t("ui.timingMaxPagesHint") }),
      priceField({ bind: "s:timing.cacheBusterMax", label: t("ui.cacheBusterMax"), hint: t("ui.cacheBusterMaxHint") }),
      toggleField({ bind: "s:timing.keepAlive", label: t("ui.keepAlive"), wide: true, hint: t("ui.keepAliveHint") })
    )
  )}
  ${section(
    t("ui.eaErrorsSection"),
    grid(
      rangeField({ bind: "s:errors.cooldown", label: t("ui.errorsCooldown"), unit: "M", placeholder: "4-8M", wide: true }),
      numberField({ bind: "s:errors.maxCooldowns", label: t("ui.errorsMaxCooldowns"), min: 0, max: 20 }),
      numberField({ bind: "s:errors.maxConsecutiveFailures", label: t("ui.errorsMaxFailures"), min: 1, max: 20 }),
      textField({ bind: "s:errors.stopCodes", label: t("ui.errorsStopCodes"), placeholder: t("ui.errorsStopCodesPlaceholder"), wide: true })
    ) +
      `<div class="mb-note is-warn" style="margin-top:8px">${t("ui.errorsNote")}</div>`
  )}
`;

// ------------------------------------------------------ Liste des transferts

const transferStatsHtml = () => {
  const transfer = getState().transfer;
  if (!transfer) {
    return `<p class="mb-empty">${t("ui.transferNotLoaded")}</p>`;
  }
  const cell = (label, value) => `<div>${label}<b>${value}</b></div>`;
  return `<div class="mb-stats-list">
    ${cell(t("ui.transferActive"), transfer.active)}
    ${cell(t("ui.transferSold"), transfer.sold)}
    ${cell(t("ui.transferUnsold"), transfer.unsold)}
    ${cell(t("ui.transferAvailable"), transfer.available)}
    ${cell(t("ui.transferOccupancy"), `${transfer.total}${transfer.capacity ? ` / ${transfer.capacity}` : ""}`)}
    ${cell(t("ui.transferSoldValue"), formatCoins(transfer.soldValue))}
  </div>`;
};

export const transferPageHtml = () => `
  ${section(t("ui.transferListSection"), `<div data-transfer-stats>${transferStatsHtml()}</div>
    <div class="mb-row" style="margin-top:8px">
      <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-transfer-action="refresh">${t("ui.refresh")}</button>
      <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-transfer-action="relist">${t("ui.relistUnsold")}</button>
      <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-transfer-action="clear">${t("ui.clearSold")}</button>
    </div>`)}
  ${section(
    t("ui.futbinListingSection"),
    `<p class="mb-hint">${t("ui.futbinListingHint")}</p>
     <div class="mb-row" style="margin-top:8px">
       <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-transfer-action="futbin">${t("ui.listAtFutbin")}</button>
       <button type="button" class="mb-btn mb-btn-danger mb-btn-sm" data-transfer-action="futbin-stop" hidden>${t("ui.stopVerb")}</button>
     </div>
     <div data-transfer-futbin></div>`
  )}
  ${section(
    t("ui.autoDuringBotSection"),
    grid(
      toggleField({ bind: "s:transfer.relistExpired", label: t("ui.relistExpired"), wide: true, hint: t("ui.relistExpiredHint") }),
      selectField({
        bind: "s:transfer.relistMode",
        label: t("ui.relistMode"),
        wide: true,
        showIf: "s:transfer.relistExpired=true",
        options: [
          ["same", t("ui.relistSame")],
          ["futbin", t("ui.relistFutbin")],
          ["market", t("ui.relistMarket")],
        ],
        hint: t("ui.relistModeHint"),
      }),
      numberField({ bind: "s:transfer.clearSoldAt", label: t("ui.clearSoldAt"), placeholder: t("ui.never"), hint: t("ui.clearSoldAtHint") }),
      numberField({ bind: "s:transfer.checkEvery", label: t("ui.checkEvery"), min: 1, max: 100, hint: t("ui.checkEveryHint") }),
      toggleField({ bind: "s:transfer.stopWhenFull", label: t("ui.stopWhenFull"), wide: true })
    )
  )}
`;

// ------------------------------------------------------------------ Alertes

// Option « Automatique » : suit la langue du compte FC (nom de la langue détectée, sinon son code).
const autoLanguageLabel = () => {
  const code = gameLanguage();
  const known = LANGUAGES.find(([id]) => id === code);
  return t("ui.languageAuto", { lang: known ? known[1] : code ? code.toUpperCase() : "?" });
};

// Langue du compte FC connue après la construction du panneau : met à jour l'option « Automatique ».
export const refreshLanguageField = (body) => {
  setText(qs(body, 'select[data-bind="s:ui.language"] option[value="auto"]'), autoLanguageLabel());
};

export const alertsPageHtml = () => `
  ${section(
    t("ui.interfaceSection"),
    grid(
      selectField({
        bind: "s:ui.language",
        label: t("ui.languageLabel"),
        wide: true,
        options: [["auto", autoLanguageLabel()], ...LANGUAGES],
        hint: t("ui.languageHint"),
      }),
      toggleField({ bind: "s:ui.dockPanel", label: t("ui.dockPanel"), wide: true, hint: t("ui.dockPanelHint") })
    )
  )}
  ${section(
    t("ui.soundSection"),
    grid(
      toggleField({ bind: "s:notify.sound", label: t("ui.sounds"), hint: t("ui.soundsHint") }),
      numberField({ bind: "s:notify.volume", label: t("ui.volume"), float: true, min: 0, max: 1 }),
      toggleField({ bind: "s:notify.desktop", label: t("ui.desktopNotify"), wide: true, hint: t("ui.desktopNotifyHint") })
    ) +
      `<div class="mb-row" style="margin-top:8px">
        <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-sound="buy">${t("ui.testBuySound")}</button>
        <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-sound="alert">${t("ui.testAlertSound")}</button>
      </div>`
  )}
  ${section(
    "Discord & Telegram",
    grid(
      textField({ bind: "s:notify.discordWebhook", label: t("ui.discordWebhook"), placeholder: "https://discord.com/api/webhooks/…", secret: true, wide: true }),
      textField({ bind: "s:notify.telegramToken", label: t("ui.telegramToken"), placeholder: "123456:ABC…", secret: true, wide: true }),
      textField({ bind: "s:notify.telegramChatId", label: t("ui.telegramChatId"), placeholder: t("ui.telegramChatIdPlaceholder"), wide: true })
    ) +
      `<div class="mb-row" style="margin-top:8px"><button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-notify-test>${t("ui.sendTest")}</button><span class="mb-hint" data-notify-result></span></div>`
  )}
  ${section(
    t("ui.whenSection"),
    grid(
      toggleField({ bind: "s:notify.onBuy", label: t("ui.onBuy") }),
      toggleField({ bind: "s:notify.onFail", label: t("ui.onFail") }),
      toggleField({ bind: "s:notify.onList", label: t("ui.onList") }),
      toggleField({ bind: "s:notify.onListFail", label: t("ui.onListFail") }),
      toggleField({ bind: "s:notify.onSold", label: t("ui.onSold") }),
      toggleField({ bind: "s:notify.onStart", label: t("ui.onStart") }),
      toggleField({ bind: "s:notify.onStop", label: t("ui.onStop") }),
      numberField({ bind: "s:notify.summaryMinutes", label: t("ui.summaryMinutes"), min: 0, max: 720, placeholder: t("ui.disabledPlaceholder"), hint: t("ui.summaryMinutesHint") })
    ) + `<p class="mb-hint">${t("ui.alwaysReported")}</p>`
  )}
`;

// ------------------------------------------------------------------ liaisons

export const bindSettingsPages = (body, refreshAll) => {
  body.addEventListener("click", async (event) => {
    const target = event.target;
    const preset = target.closest("[data-preset]");
    if (preset) {
      applyTimingPreset(preset.dataset.preset);
      setHtml(qs(body, "[data-presets]"), presetButtons());
      refreshAll();
      return;
    }
    const soundBtn = target.closest("[data-sound]");
    if (soundBtn) {
      const previous = getSettings().notify.sound;
      if (!previous) {
        setSetting("notify.sound", true);
      }
      sound(soundBtn.dataset.sound);
      if (!previous) {
        setSetting("notify.sound", false);
      }
      return;
    }
    if (target.closest("[data-notify-test]")) {
      const result = qs(body, "[data-notify-result]");
      result.textContent = t("ui.sending");
      const sent = await notifyEvent("test", t("ui.notifyTestMessage"));
      const ok = sent.filter(Boolean).length;
      result.textContent = ok ? t("ui.channelsOk", { n: ok }) : t("ui.noChannel");
      return;
    }
    const action = target.closest("[data-transfer-action]");
    if (action) {
      if (action.dataset.transferAction === "futbin-stop") {
        cancelTask();
        return;
      }
      if (isRunning() && action.dataset.transferAction !== "refresh") {
        log.warn(t("ui.botHandlesTransfers"));
        return;
      }
      if (action.dataset.transferAction === "futbin") {
        await runFutbinListing(body);
        return;
      }
      action.disabled = true;
      try {
        await runTransferAction(action.dataset.transferAction);
      } finally {
        action.disabled = false;
        setHtml(qs(body, "[data-transfer-stats]"), transferStatsHtml());
      }
    }
  });
  body.addEventListener("click", (event) => {
    const toggle = event.target.closest && event.target.closest('[data-bind="s:notify.desktop"]');
    if (!toggle) {
      return;
    }
    // Après le basculement fait par fields.js : on demande la permission si activé.
    setTimeout(async () => {
      if (!getSettings().notify.desktop) {
        return;
      }
      const permission = await requestDesktopPermission();
      if (permission !== "granted") {
        setSetting("notify.desktop", false);
        log.warn(t("ui.desktopRefused"));
        refreshAll();
      }
    }, 0);
  });
};

// Mise en vente groupée au prix FUTBIN, avec suivi de la progression et bouton Arrêter.
const runFutbinListing = async (body) => {
  const out = qs(body, "[data-transfer-futbin]");
  const startBtn = qs(body, '[data-transfer-action="futbin"]');
  const stopBtn = qs(body, '[data-transfer-action="futbin-stop"]');
  const task = beginTask(t("ui.taskFutbinListing"));
  if (!task) {
    const other = currentTask();
    out.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">${t("ui.otherTaskRunning", { label: other ? other.label : "?" })}</div>`;
    return;
  }
  startBtn.disabled = true;
  stopBtn.hidden = false;
  const paint = (report) => {
    const parts = [
      t("ui.listingProgress", { listed: report.listed, total: report.total }),
      report.skipped ? t("ui.listingSkipped", { n: report.skipped }) : "",
      report.current ? t("ui.listingCurrent", { name: report.current }) : "",
    ];
    out.innerHTML = `<div class="mb-note" style="margin-top:8px">${parts.filter(Boolean).join(" · ")}</div>`;
  };
  try {
    const report = await listTransferAtFutbin({ token: task.token, onProgress: paint });
    paint(report);
    const text = [
      t("ui.listingDone", { listed: report.listed, total: report.total }),
      report.noPrice ? t("ui.listingNoPrice", { n: report.noPrice }) : "",
      report.stopped ? t("ui.listingStopped", { reason: report.stopped }) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    out.innerHTML = `<div class="mb-note${report.stopped ? " is-warn" : ""}" style="margin-top:8px">${text}.</div>`;
    log.info(`${text}.`);
  } finally {
    endTask(task);
    startBtn.disabled = false;
    stopBtn.hidden = true;
    await runTransferAction("refresh");
    setHtml(qs(body, "[data-transfer-stats]"), transferStatsHtml());
  }
};

export const refreshTransferStats = (body) => {
  const el = qs(body, "[data-transfer-stats]");
  if (el) {
    setHtml(el, transferStatsHtml());
  }
};

const runTransferAction = async (action) => {
  if (action === "refresh") {
    const result = await market.fetchTransferList();
    if (result.ok) {
      const summary = market.summarizeTransferList(result.items);
      updateState({ transfer: Object.assign({ capacity: market.pileCapacity("TRANSFER") }, summary) });
    } else {
      log.warn(t("ui.transferUnavailable", { error: result.error.label }));
    }
    return;
  }
  if (action === "relist") {
    const result = await market.relistExpired();
    if (result.ok) {
      log.success(t("ui.relisted"));
    } else {
      log.warn(t("ui.relistFailed", { error: result.error.label }));
    }
  }
  if (action === "clear") {
    const result = await market.clearSold();
    if (result.ok) {
      log.success(t("ui.soldCleared"));
      await market.refreshCoins();
    } else {
      log.warn(t("ui.clearSoldFailed", { error: result.error.label }));
    }
  }
  await runTransferAction("refresh");
};
