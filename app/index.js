import $ from "./utils/jquery";
import { isFutbinPage } from "./ui/futbinBridge";
import "./ui/chromeOnly";
import { isMarketAlertApp } from "./app.constants";
import { initListeners } from "./services/listeners";
import { bootMagicBuyer } from "./ui/magicBuyerShell";
import { ensureEaShims } from "./utils/eaCompat";

if (!isFutbinPage()) {
  window.$ = window.jQuery = $;

  try {
    ensureEaShims();
  } catch (e) {
    console.warn("[MagicBuyer] shims", e);
  }
  try {
    bootMagicBuyer();
  } catch (e) {
    console.error("[MagicBuyer] boot", e);
  }
  try {
    isMarketAlertApp && initListeners();
  } catch (e) {}
}
