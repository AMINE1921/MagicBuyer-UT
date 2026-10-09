import { isFinalizing, isPaused, isRunning, isStopping, startBot, stopBot } from "../core/engine";
import { formatDuration } from "../core/ranges";
import { onSettingsChange } from "../core/settings";
import { getState, onStateChange, statusLabel } from "../core/state";
import { t } from "../i18n";
import { escapeHtml, qs, setText } from "./dom";
import { togglePanel } from "./panel";

// Pastille flottante : état du bot + ouverture du panneau + Démarrer/Stop rapide.
// Tous les textes sont repeints à chaque passage : un changement de langue est pris en compte.

let hud = null;
let timer = null;
let unsubscribeSettings = null;

const paint = () => {
  if (!hud) {
    return;
  }
  const state = getState();
  const status = isPaused() ? "paused" : state.status;
  if (hud.dataset.status !== status) {
    hud.dataset.status = status;
  }
  const running = isRunning();
  const stats = state.stats;
  const toggle = qs(hud, "[data-hud-toggle]");
  if (toggle && toggle.getAttribute("aria-label") !== t("ui.hudOpen")) {
    toggle.setAttribute("aria-label", t("ui.hudOpen"));
  }
  setText(qs(hud, "[data-hud-label]"), running ? statusLabel(status) || t("ui.statusRunning") : "MagicBuyer");
  const elapsed = state.startedAt && running ? formatDuration(Date.now() - state.startedAt) : "";
  setText(
    qs(hud, "[data-hud-detail]"),
    running || stats.searches
      ? `🔎 ${stats.searches} · ✅ ${stats.won}${elapsed ? ` · ${elapsed}` : ""}`
      : t("ui.hudOpenSniper")
  );
  const action = qs(hud, "[data-hud-action]");
  action.disabled = isStopping() && !isFinalizing();
  setText(action, running ? "■" : "▶");
  action.setAttribute("aria-label", running ? t("ui.hudStopBot") : t("ui.hudStartBot"));
  action.title = running ? t("ui.stopVerb") : t("ui.start");
};

export const ensureHud = () => {
  if (hud && document.body && document.body.contains(hud)) {
    return hud;
  }
  if (!document.body) {
    return null;
  }
  hud = document.getElementById("mb-hud");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "mb-hud";
    hud.dataset.status = "idle";
    hud.innerHTML = `
      <button type="button" class="mb-hud-main" data-hud-toggle aria-label="${escapeHtml(t("ui.hudOpen"))}">
        <span class="mb-hud-logo">MB</span>
        <span class="mb-dot"></span>
        <span class="mb-hud-text"><b data-hud-label>MagicBuyer</b><small data-hud-detail>${t("ui.hudOpenSniper")}</small></span>
      </button>
      <button type="button" class="mb-hud-action" data-hud-action aria-label="${escapeHtml(t("ui.hudStartBot"))}">▶</button>`;
    document.body.appendChild(hud);
    hud.addEventListener("click", (event) => {
      if (event.target.closest("[data-hud-action]")) {
        if (isRunning()) {
          stopBot(t("ui.manualStop"), { manual: true });
        } else if (!startBot()) {
          togglePanel();
        }
        paint();
        return;
      }
      if (event.target.closest("[data-hud-toggle]")) {
        togglePanel();
      }
    });
    onStateChange(paint);
    if (!timer) {
      timer = setInterval(paint, 1000);
    }
    // Langue choisie dans les réglages : repeinte tout de suite (sinon au prochain passage du minuteur).
    if (!unsubscribeSettings) {
      unsubscribeSettings = onSettingsChange((settings, path) => {
        if (path === "ui.language" || path === "*") {
          paint();
        }
      });
    }
  }
  paint();
  return hud;
};
