import $ from "./jquery";
import { getPortraitUrl } from "../app.constants";
import { idProgressAutobuyer } from "../elementIds.constants";
import { getBuyerSettings } from "../services/repository";
import { initializeLog } from "../views/layouts/LogView";
import { sendNotificationToUser } from "./notificationUtil";

const escapeHtml = (value) =>
  String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const toPlainText = (message) =>
  String(message == null ? "" : message)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();

const labelFor = (type, text) => {
  if (type === "success") return "Succès";
  if (type === "error") return "Erreur";
  if (type === "warning") return "Attention";
  if (/recherche/i.test(text)) return "Recherche";
  if (/bot|démarr|reprise|stop/i.test(text)) return "Bot";
  if (/achat|ench[eè]r/i.test(text)) return "Achat";
  if (/vente|list/i.test(text)) return "Vente";
  return "Info";
};

export const writeToAbLog = (
  sym,
  ItemName,
  priceTxt,
  operation,
  result,
  comments
) => {
  writeToLog(
    [sym, ItemName, priceTxt, operation, result, comments]
      .filter((part) => part != null && part !== "")
      .join(" · "),
    idProgressAutobuyer
  );
};

export const showCaptchaLogs = function (captchaCloseTab) {
  sendNotificationToUser(
    "Captcha, please solve the problem so that the bot can work again.",
    false
  );

  if (captchaCloseTab) {
    window.location.href = "about:blank";
    return;
  }
  writeToLog(
    "Bot arrêté : captcha détecté.",
    idProgressAutobuyer,
    null,
    "error"
  );
};

export const writeToLog = function (message, log, player, type) {
  const plain = toPlainText(message);
  try {
    console.info("[MagicBuyer]", plain);
  } catch (e) {}
  try {
    const host = document.getElementById(log) || (log && document.getElementById(String(log)));
    if (!host) {
      return;
    }
    const kind = type || "info";
    const item = document.createElement("li");
    item.className = `mb-log mb-log-${kind}`;
    const time = new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const portrait =
      player && player._metaData && player._metaData.id
        ? `<img class="mb-log-portrait" alt="" src="${getPortraitUrl(
            player._metaData.id
          )}" />`
        : "";
    item.innerHTML = `
      <span class="mb-log-time">${time}</span>
      ${portrait}
      <div class="mb-log-body">
        <strong class="mb-log-label">${labelFor(kind, plain)}</strong>
        <p class="mb-log-text">${escapeHtml(plain).replace(/\n/g, "<br>")}</p>
      </div>
    `;
    host.appendChild(item);
    host.scrollTop = host.scrollHeight;
    while (host.children.length > 80) {
      host.removeChild(host.firstChild);
    }
  } catch (e) {
    console.warn("[MagicBuyer] log", e);
  }
};

export const clearLogs = () => {
  const log = document.getElementById(idProgressAutobuyer);
  if (log) {
    log.innerHTML = "";
  } else {
    $("#" + idProgressAutobuyer).empty();
  }
  initializeLog();
};

setInterval(() => {
  const settings = getBuyerSettings();
  let autoClearLog = settings && settings["idAutoClearLog"];
  autoClearLog && clearLogs();
}, 120000);
