import { listTransferAtFutbin } from "../../core/bulkSell";
import { isRunning } from "../../core/engine";
import * as market from "../../core/market";
import { log } from "../../core/logger";
import { notifyEvent, requestDesktopPermission, sound } from "../../core/notify";
import { formatCoins } from "../../core/prices";
import { TIMING_PRESETS, applyTimingPreset, getSettings, setSetting } from "../../core/settings";
import { getState, updateState } from "../../core/state";
import { beginTask, cancelTask, currentTask, endTask } from "../../core/tasks";
import { qs, setHtml } from "../dom";
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
    "Achat immédiat",
    grid(
      numberField({ bind: "s:buy.maxPerSearch", label: "Achats max par recherche", min: 1, max: 5, hint: "1 conseillé : la carte la moins chère est prise en premier." }),
      numberField({ bind: "s:buy.stopAfterPurchases", label: "Arrêter après", placeholder: "illimité", hint: "achats (0 = illimité)" }),
      priceField({ bind: "s:buy.coinsReserve", label: "Réserve de coins", hint: "Le bot ne descend jamais sous ce solde." }),
      numberField({ bind: "s:buy.maxResults", label: "Seuil de résultats", placeholder: "désactivé", hint: "N'achète pas si la recherche renvoie plus de N cartes (prix max trop haut)." }),
      toggleField({ bind: "s:buy.skipGk", label: "Ignorer les gardiens", wide: true })
    )
  )}
  <div class="mb-note">Acheter à un pourcentage du prix FUTBIN (suivi en direct pendant le bot) : choisis « % du prix FUTBIN » dans le bloc Prix de l'onglet Cible, filtre par filtre.</div>
  ${section(
    "Enchères",
    grid(
      toggleField({ bind: "s:bid.enabled", label: "Enchérir aussi", wide: true, hint: "Enchérit sur les cartes qui expirent bientôt, jusqu'à l'« Enchère max » du filtre." }),
      rangeField({ bind: "s:bid.expiresWithin", label: "Si fin dans moins de", unit: "M", placeholder: "5M", hint: "S, M ou H (ex. 90S, 5M)" }),
      numberField({ bind: "s:bid.maxPerSearch", label: "Enchères par recherche", min: 1, max: 5 }),
      numberField({ bind: "s:bid.searchEvery", label: "Recherche d'enchères toutes les", min: 2, max: 20, hint: "recherches, quand le filtre a aussi un prix d'achat max" }),
      numberField({ bind: "s:bid.maxActive", label: "Enchères actives max", min: 1, max: 50 }),
      toggleField({ bind: "s:bid.exact", label: "Enchérir directement au max" }),
      toggleField({ bind: "s:bid.rebid", label: "Surenchérir si dépassé" }),
      toggleField({ bind: "s:bid.clearLost", label: "Retirer les enchères perdues du suivi", wide: true })
    )
  )}
`;

// ------------------------------------------------------------------- Vente

export const sellPageHtml = () => `
  ${section(
    "Après un achat",
    grid(
      selectField({
        bind: "s:sell.mode",
        label: "Que faire de la carte ?",
        wide: true,
        options: [
          ["list", "La mettre en vente automatiquement"],
          ["transfer", "L'envoyer dans la liste des transferts"],
          ["none", "La laisser dans les non attribués"],
        ],
      }),
      selectField({
        bind: "s:sell.duration",
        label: "Durée de l'annonce",
        options: [["1H", "1 heure"], ["3H", "3 heures"], ["6H", "6 heures"], ["12H", "12 heures"], ["1D", "1 jour"], ["3D", "3 jours"]],
      }),
      priceField({ bind: "s:sell.minProfit", label: "Bénéfice minimum", hint: "Après taxe EA de 5 %. Sinon la carte n'est pas mise en vente." }),
      numberField({ bind: "s:sell.maxRating", label: "Ne pas vendre au-dessus de la note", placeholder: "désactivé" })
    )
  )}
  ${section(
    "Prix de revente",
    grid(
      selectField({
        bind: "s:sell.priceMode",
        label: "Prix de revente",
        wide: true,
        options: [
          ["fixed", "Prix fixe"],
          ["futbin", "% du prix FUTBIN de la carte achetée"],
        ],
        hint: "Chaque filtre peut avoir son propre réglage (onglet Cible).",
      }),
      priceField({ bind: "s:sell.defaultPrice", label: "Prix de revente par défaut", wide: true, showIf: "s:sell.priceMode=fixed" }),
      rangeField({
        bind: "s:sell.futbinPercent",
        label: "% du prix FUTBIN",
        unit: null,
        placeholder: "99-100",
        wide: true,
        showIf: "s:sell.priceMode=futbin",
        hint: "Valeur tirée au hasard dans la plage. Le prix FUTBIN de la version achetée est relu juste après l'achat ; sans prix FUTBIN, la carte va dans la liste des transferts sans être listée.",
      })
    )
  )}
  <div class="mb-note">La mise en vente passe par le service EA (la carte est d'abord déplacée dans la liste des transferts). Les limites de prix EA sont respectées automatiquement.</div>
`;

// ------------------------------------------------------------------ Timing

const presetButtons = () =>
  Object.keys(TIMING_PRESETS)
    .map((key) => {
      const preset = TIMING_PRESETS[key];
      const active = getSettings().timing.preset === key;
      return `<button type="button" class="mb-preset${active ? " is-active" : ""}" data-preset="${key}">
        <b>${preset.label}</b><small>${preset.hint}</small>
      </button>`;
    })
    .join("");

export const timingPageHtml = () => `
  ${section("Profil", `<div class="mb-presets" data-presets>${presetButtons()}</div>`)}
  ${section(
    "Rythme des recherches",
    grid(
      rangeField({ bind: "s:timing.wait", label: "Temps entre deux recherches", unit: "S", placeholder: "5-9", key: true, wide: true, hint: "En secondes (décimales acceptées, ex. 4.5-7). Mesuré d'une recherche à la suivante." }),
      numberField({ bind: "s:timing.maxPerMinute", label: "Recherches max / minute", placeholder: "illimité", hint: "Garde-fou anti-blocage." }),
      rangeField({ bind: "s:timing.afterBuy", label: "Délai après un achat", unit: "S", optional: true, placeholder: "2-4S" })
    )
  )}
  ${section(
    "Pauses & arrêt",
    grid(
      rangeField({ bind: "s:timing.pauseEvery", label: "Pause toutes les", unit: null, optional: true, placeholder: "15-25", hint: "recherches (vide = jamais)" }),
      rangeField({ bind: "s:timing.pauseFor", label: "Durée de la pause", unit: "S", optional: true, placeholder: "40-80S" }),
      rangeField({ bind: "s:timing.stopAfter", label: "Arrêt automatique après", unit: "H", optional: true, placeholder: "2-3H", hint: "vide = jamais", wide: true })
    )
  )}
  ${section(
    "Fraîcheur des résultats",
    grid(
      selectField({
        bind: "s:timing.cacheBuster",
        label: "Anti-cache EA",
        wide: true,
        options: [
          ["auto", "Automatique (conseillé, ne rate aucune annonce)"],
          ["minBuy", "Achat min variable"],
          ["minBid", "Enchère min variable"],
          ["off", "Désactivé"],
        ],
        hint: "Chaque recherche est différente pour qu'EA renvoie des résultats frais et non une page en cache.",
      }),
      numberField({ bind: "s:timing.maxPages", label: "Pages parcourues", min: 1, max: 5, hint: "1 suffit avec un prix max serré." }),
      priceField({ bind: "s:timing.cacheBusterMax", label: "Plafond anti-cache", hint: "Modes achat/enchère min." }),
      toggleField({ bind: "s:timing.keepAlive", label: "Garder l'onglet actif en arrière-plan", wide: true, hint: "Signal audio inaudible pour que Chrome ne ralentisse pas le bot (icône haut-parleur sur l'onglet)." })
    )
  )}
  ${section(
    "Erreurs EA",
    grid(
      rangeField({ bind: "s:errors.cooldown", label: "Pause si EA limite (429/512/521)", unit: "M", placeholder: "4-8M", wide: true }),
      numberField({ bind: "s:errors.maxCooldowns", label: "Arrêt après N limitations", min: 0, max: 20 }),
      numberField({ bind: "s:errors.maxConsecutiveFailures", label: "Arrêt après N échecs", min: 1, max: 20 }),
      textField({ bind: "s:errors.stopCodes", label: "Codes d'arrêt personnalisés", placeholder: "ex. 470, 473", wide: true })
    ) +
      `<div class="mb-note is-warn" style="margin-top:8px">Captcha (458), session expirée (401) et marché verrouillé (494) arrêtent toujours le bot immédiatement.</div>`
  )}
`;

// ------------------------------------------------------ Liste des transferts

const transferStatsHtml = () => {
  const transfer = getState().transfer;
  if (!transfer) {
    return `<p class="mb-empty">Pas encore chargée : clique sur « Actualiser ».</p>`;
  }
  const cell = (label, value) => `<div>${label}<b>${value}</b></div>`;
  return `<div class="mb-stats-list">
    ${cell("En vente", transfer.active)}
    ${cell("Vendues", transfer.sold)}
    ${cell("Invendues", transfer.unsold)}
    ${cell("Disponibles", transfer.available)}
    ${cell("Occupation", `${transfer.total}${transfer.capacity ? ` / ${transfer.capacity}` : ""}`)}
    ${cell("Valeur vendue", formatCoins(transfer.soldValue))}
  </div>`;
};

export const transferPageHtml = () => `
  ${section("Liste des transferts", `<div data-transfer-stats>${transferStatsHtml()}</div>
    <div class="mb-row" style="margin-top:8px">
      <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-transfer-action="refresh">Actualiser</button>
      <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-transfer-action="relist">Relister les invendus (même prix)</button>
      <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-transfer-action="clear">Vider les vendus</button>
    </div>`)}
  ${section(
    "Mise en vente au prix FUTBIN",
    `<p class="mb-hint">Liste les cartes disponibles et invendues de ta liste des transferts au prix FUTBIN du moment (% réglé dans l'onglet Vente, durée de l'onglet Vente).</p>
     <div class="mb-row" style="margin-top:8px">
       <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-transfer-action="futbin">Lister au prix FUTBIN</button>
       <button type="button" class="mb-btn mb-btn-danger mb-btn-sm" data-transfer-action="futbin-stop" hidden>Arrêter</button>
     </div>
     <div data-transfer-futbin></div>`
  )}
  ${section(
    "Automatique pendant le bot",
    grid(
      toggleField({ bind: "s:transfer.relistExpired", label: "Relister les invendus", wide: true, hint: "Attention : concerne TOUTES les cartes expirées de la liste." }),
      selectField({
        bind: "s:transfer.relistMode",
        label: "Prix du relist",
        wide: true,
        showIf: "s:transfer.relistExpired=true",
        options: [
          ["same", "Au même prix"],
          ["futbin", "Au prix FUTBIN du moment (% de l'onglet Vente)"],
        ],
        hint: "Au prix FUTBIN : 5 cartes par passage ; sans prix FUTBIN après 3 min, relist au même prix.",
      }),
      numberField({ bind: "s:transfer.clearSoldAt", label: "Vider les vendus dès", placeholder: "jamais", hint: "cartes vendues (0 = jamais)" }),
      numberField({ bind: "s:transfer.checkEvery", label: "Vérifier toutes les", min: 1, max: 100, hint: "recherches" }),
      toggleField({ bind: "s:transfer.stopWhenFull", label: "Arrêter si la liste est pleine", wide: true })
    )
  )}
`;

// ------------------------------------------------------------------ Alertes

export const alertsPageHtml = () => `
  ${section(
    "Son & bureau",
    grid(
      toggleField({ bind: "s:notify.sound", label: "Sons", hint: "Achat, captcha, arrêt." }),
      numberField({ bind: "s:notify.volume", label: "Volume (0 à 1)", float: true, min: 0, max: 1 }),
      toggleField({ bind: "s:notify.desktop", label: "Notifications du navigateur", wide: true, hint: "Pratique quand l'onglet est en arrière-plan." })
    ) +
      `<div class="mb-row" style="margin-top:8px">
        <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-sound="buy">Tester : achat</button>
        <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-sound="alert">Tester : alerte</button>
      </div>`
  )}
  ${section(
    "Discord & Telegram",
    grid(
      textField({ bind: "s:notify.discordWebhook", label: "Webhook Discord", placeholder: "https://discord.com/api/webhooks/…", secret: true, wide: true }),
      textField({ bind: "s:notify.telegramToken", label: "Token du bot Telegram", placeholder: "123456:ABC…", secret: true, wide: true }),
      textField({ bind: "s:notify.telegramChatId", label: "Chat ID Telegram", placeholder: "ex. 123456789", wide: true })
    ) +
      `<div class="mb-row" style="margin-top:8px"><button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-notify-test>Envoyer un message de test</button><span class="mb-hint" data-notify-result></span></div>`
  )}
  ${section(
    "Quand prévenir ?",
    grid(
      toggleField({ bind: "s:notify.onBuy", label: "Achat réussi" }),
      toggleField({ bind: "s:notify.onFail", label: "Achat raté" }),
      toggleField({ bind: "s:notify.onList", label: "Mise en vente" }),
      toggleField({ bind: "s:notify.onStop", label: "Arrêt du bot" })
    ) + `<p class="mb-hint">Captcha et blocages EA sont toujours signalés.</p>`
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
      result.textContent = "envoi…";
      const sent = await notifyEvent("test", "🔔 Test MagicBuyer : les notifications fonctionnent.");
      const ok = sent.filter(Boolean).length;
      result.textContent = ok ? `${ok} canal(aux) OK` : "aucun canal configuré ou envoi refusé";
      return;
    }
    const action = target.closest("[data-transfer-action]");
    if (action) {
      if (action.dataset.transferAction === "futbin-stop") {
        cancelTask();
        return;
      }
      if (isRunning() && action.dataset.transferAction !== "refresh") {
        log.warn("Le bot gère déjà la liste des transferts : arrête-le pour agir manuellement.");
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
        log.warn("Notifications du navigateur refusées par Chrome.");
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
  const task = beginTask("mise en vente FUTBIN");
  if (!task) {
    const other = currentTask();
    out.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">Une autre tâche est en cours (${other ? other.label : "?"}).</div>`;
    return;
  }
  startBtn.disabled = true;
  stopBtn.hidden = false;
  const paint = (report) => {
    out.innerHTML = `<div class="mb-note" style="margin-top:8px">${report.listed} listée(s) sur ${report.total}${
      report.skipped ? ` · ${report.skipped} ignorée(s)` : ""
    }${report.current ? ` · en cours : ${report.current}` : ""}</div>`;
  };
  try {
    const report = await listTransferAtFutbin({ token: task.token, onProgress: paint });
    paint(report);
    const text = `${report.listed} carte(s) mise(s) en vente au prix FUTBIN sur ${report.total}` +
      (report.noPrice ? ` · ${report.noPrice} sans prix FUTBIN` : "") +
      (report.stopped ? ` · arrêt : ${report.stopped}` : "");
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
      log.warn(`Liste des transferts indisponible : ${result.error.label}.`);
    }
    return;
  }
  if (action === "relist") {
    const result = await market.relistExpired();
    if (result.ok) {
      log.success("Invendus relistés.");
    } else {
      log.warn(`Relist impossible : ${result.error.label}.`);
    }
  }
  if (action === "clear") {
    const result = await market.clearSold();
    if (result.ok) {
      log.success("Cartes vendues retirées de la liste.");
      await market.refreshCoins();
    } else {
      log.warn(`Impossible de vider les vendus : ${result.error.label}.`);
    }
  }
  await runTransferAction("refresh");
};

