import { idProgressAutobuyer } from "../elementIds.constants";
import { getBuyerSettings } from "../services/repository";
import { initializeLog } from "../views/layouts/LogView";
import { sendNotificationToUser } from "./notificationUtil";

export const writeToAbLog = (
  sym,
  ItemName,
  priceTxt,
  operation,
  result,
  comments
) => {
  writeToLog(
    sym +
      " | " +
      ItemName +
      " | " +
      priceTxt +
      " | " +
      operation +
      " | " +
      result +
      " | " +
      comments,
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
    "[!!!] Autostopping bot since Captcha got triggered",
    idProgressAutobuyer
  );
};

export const writeToLog = function (message, log, player, type) {
  setTimeout(() => {
    var $log = $("#" + log);
    const logDiv = $(`
              <li class="cardPalyerLi">
              <div class="cardPalyer" style="${
                type === "success"
                  ? "border: solid #10AC84;"
                  : type === "error"
                  ? "border: solid #EE5253;"
                  : type === "warning"
                  ? "border: solid #FF9F43;"
                  : "border: solid #2E86DE;"
              }">
              ${
                player
                  ? `<img
                  style="width:30%; padding-left: 15px;"
                  src="https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/24B23FDE-7835-41C2-87A2-F453DFDB2E82/2024/fut/items/images/mobile/portraits/${player?._metaData?.id}.png"
                />`
                  : ""
              }
              
              <div class="container">
                <span class="contentContainer" >${message}</span>
                <div class="typeContent" style="${
                  type === "success"
                    ? "background: #10AC84;"
                    : type === "error"
                    ? "background: #EE5253;"
                    : type === "warning"
                    ? "background: #FF9F43;"
                    : "background: #2E86DE;"
                }">
                  <span class="typeContentText">${
                    type === "success"
                      ? "✓"
                      : type === "error"
                      ? "X"
                      : type === "warning"
                      ? "!"
                      : "↻"
                  }</span>
                </div>
              </div>
              </div>
              </li>
          `);
    $log.append(logDiv);
    if ($log[0]) $log.scrollTop($log[0].scrollHeight);
  }, 50);
};

export const clearLogs = () => {
  $("#" + idProgressAutobuyer).val("");
  initializeLog();
};

setInterval(() => {
  const settings = getBuyerSettings();
  let autoClearLog = settings && settings["idAutoClearLog"];
  autoClearLog && clearLogs();
}, 120000);
