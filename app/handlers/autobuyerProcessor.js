import $ from "../utils/jquery";
import { idAbStatus, idProgressAutobuyer } from "../elementIds.constants";
import { STATE_PAUSED, STATE_STOPPED } from "../app.constants";
import { getBuyerSettings, getValue, setValue } from "../services/repository";
import { stopBotIfRequired } from "../utils/autoActionsUtil";
import { getRangeValue, playAudio } from "../utils/commonUtil";
import { writeToLog } from "../utils/logUtil";
import { sendPinEvents, sendUINotification } from "../utils/notificationUtil";
import { eaIsPhone, syncPageGlobals } from "../utils/pageWindow";

import { setRandomInterval } from "../utils/timeOutUtil";
import { addUserWatchItems } from "../utils/watchlistUtil";
import {
  getFunctionsWithContext,
  setInitialValues,
} from "../utils/processorUtil";
import { processSellQueue } from "../utils/sellUtil";

let interval = null;
let passInterval = null;

const safeRun = async (label, task) => {
  try {
    await task;
  } catch (e) {
    writeToLog(
      `${label} : ${e && e.message ? e.message : e}`,
      idProgressAutobuyer,
      null,
      "error"
    );
  }
};

const waitRange = (buyerSetting) => {
  const range = getRangeValue(
    (buyerSetting && buyerSetting["idAbWaitTime"]) || "8-12"
  );
  const start = range[0] > 0 ? range[0] : 8;
  const end = range[1] > 0 ? range[1] : start + 4;
  return [start, end];
};

export const startAutoBuyer = async function (isResume) {
  try {
    syncPageGlobals();
    $("#" + idAbStatus)
      .css("color", "#2cbe2d")
      .html("RUNNING");

    const isActive = getValue("autoBuyerActive");
    if (isActive) return;
    setInitialValues(isResume);
    writeToLog(
      isResume ? "Reprise du bot" : "Bot démarré — recherche en cours",
      idProgressAutobuyer
    );
    const {
      switchFilterWithContext,
      srchTmWithContext,
      watchListWithContext,
      transferListWithContext,
      pauseBotWithContext,
    } = getFunctionsWithContext.call(this);

    await safeRun("Filtres", switchFilterWithContext());
    let buyerSetting = getBuyerSettings() || {};
    if (!isResume) {
      await safeRun("Watchlist", addUserWatchItems());
    }
    sendPinEvents("Hub - Transfers");
    await safeRun("Recherche", srchTmWithContext(buyerSetting));
    sendPinEvents("Hub - Transfers");
    await safeRun(
      "Liste des transferts",
      transferListWithContext(
        buyerSetting["idAbSellToggle"],
        buyerSetting["idAbMinDeleteCount"],
        true
      )
    );
    let operationInProgress = false;
    if (getValue("autoBuyerActive")) {
      interval = setRandomInterval(async () => {
        try {
          passInterval = pauseBotWithContext(buyerSetting);
          stopBotIfRequired(buyerSetting);
          const isBuyerActive = getValue("autoBuyerActive");
          if (isBuyerActive && !operationInProgress) {
            operationInProgress = true;
            await safeRun("Vente", processSellQueue());
            await safeRun("Filtres", switchFilterWithContext());
            buyerSetting = getBuyerSettings() || {};
            sendPinEvents("Hub - Transfers");
            await safeRun("Recherche", srchTmWithContext(buyerSetting));
            sendPinEvents("Hub - Transfers");
            await safeRun("Objectifs", watchListWithContext(buyerSetting));
            sendPinEvents("Hub - Transfers");
            await safeRun(
              "Liste des transferts",
              transferListWithContext(
                buyerSetting["idAbSellToggle"],
                buyerSetting["idAbMinDeleteCount"]
              )
            );
          }
        } catch (e) {
          writeToLog(
            `Cycle bot : ${e && e.message ? e.message : e}`,
            idProgressAutobuyer,
            null,
            "error"
          );
        } finally {
          operationInProgress = false;
        }
      }, ...waitRange(buyerSetting));
    }
  } catch (e) {
    writeToLog(
      `Démarrage impossible : ${e && e.message ? e.message : e}`,
      idProgressAutobuyer,
      null,
      "error"
    );
    sendUINotification("MagicBuyer n'a pas pu démarrer");
  }
};

export const stopAutoBuyer = (isPaused) => {
  interval && interval.clear();
  if (!isPaused && passInterval) {
    clearTimeout(passInterval);
  }
  const state = getValue("autoBuyerState");
  if (
    (isPaused && state === STATE_PAUSED) ||
    (!isPaused && state === STATE_STOPPED)
  ) {
    return;
  }
  setValue("autoBuyerActive", false);
  const searchSavedInterval = getValue("searchInterval") || {};
  setValue("searchInterval", {
    start: searchSavedInterval.start,
    end: Date.now(),
  });
  if (!isPaused) {
    playAudio("finish");
  }
  eaIsPhone() && $(".ut-tab-bar-item").not(".mb-native-tab").removeAttr("disabled");
  setValue("autoBuyerState", isPaused ? STATE_PAUSED : STATE_STOPPED);
  sendUINotification(isPaused ? "Autobuyer Paused" : "Autobuyer Stopped");
  if (!isPaused) {
    processSellQueue();
  }
  $("#" + idAbStatus)
    .css("color", "red")
    .html(isPaused ? "PAUSED" : "IDLE");
};
