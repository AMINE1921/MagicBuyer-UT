import {
  convertRangeToSeconds,
  convertToSeconds,
  formatString,
  playAudio,
  wait,
} from "./commonUtil";
import {
  getBuyerSettings,
  getValue,
  increAndGetStoreValue,
  setValue,
} from "../services/repository";
import { updateStats } from "../handlers/statsProcessor";
import { startAutoBuyer, stopAutoBuyer } from "../handlers/autobuyerProcessor";

import { appendTransactions } from "./statsUtil";
import { errorCodeLookUp } from "../app.constants";
import { getSellPriceFromFutBin } from "./futbinUtil";
import { idProgressAutobuyer } from "../elementIds.constants";
import { sendNotificationToUser } from "./notificationUtil";
import { writeToLog } from "./logUtil";

const errorCodeCountMap = new Map();

export const buyPlayer = (
  player,
  playerName,
  price,
  sellPrice,
  isBin,
  tradeId
) => {
  const buyerSetting = getBuyerSettings();
  return new Promise((resolve) => {
    services.Item.bid(player, price).observe(
      this,
      async function (sender, data) {
        let priceTxt = formatString(price.toString(), 6);
        const notificationType = buyerSetting["idNotificationType"];

        if (data.success) {
          if (isBin) {
            increAndGetStoreValue("purchasedCardCount");
            playAudio("cardWon");
          }
          const ratingThreshold = buyerSetting["idSellRatingThreshold"];
          let playerRating = parseInt(player.rating);
          const isValidRating =
            !ratingThreshold || playerRating <= ratingThreshold;

          const useFutBinPrice = buyerSetting["idSellFutBinPrice"];
          if (isValidRating && useFutBinPrice && isBin) {
            sellPrice = await getSellPriceFromFutBin(
              buyerSetting,
              playerName,
              player
            );
          }

          const checkBuyPrice = buyerSetting["idSellCheckBuyPrice"];
          if (checkBuyPrice && price > (sellPrice * 95) / 100) {
            sellPrice = -1;
          }

          const shouldList = sellPrice && !isNaN(sellPrice) && isValidRating;
          const profit = sellPrice * 0.95 - price;

          if (isBin) {
            const winCount = increAndGetStoreValue("winCount");
            appendTransactions(
              `[${new Date().toLocaleTimeString()}] ${playerName.trim()} achat avec succès - Prix : ${price}`
            );
            updateStats("winCount", winCount);
            writeToLog(
              `<h2>${playerName}</h2> <br>Acheté à ${price} <br>Vendu à ${sellPrice} <br>Bénéfice de ${profit}`,
              idProgressAutobuyer,
              player,
              "success"
            );

            if (!buyerSetting["idAbDontMoveWon"]) {
              const sellQueue = getValue("sellQueue") || [];
              sellQueue.push({
                player,
                playerName,
                sellPrice,
                shouldList,
                profit,
              });
              setValue("sellQueue", sellQueue);
            }
          } else {
            const bidCount = increAndGetStoreValue("bidCount");
            appendTransactions(
              `${playerName.trim()} succès de l'enchère - Prix : ${price}`
            );
            writeToLog(
              `B:${bidCount} ${playerName} succès de l'enchère`,
              idProgressAutobuyer,
              player,
              "success"
            );
            const filterName = getValue("currentFilter") || "default";
            if (filterName) {
              const bidItemsByFilter = getValue("filterBidItems") || new Map();
              if (bidItemsByFilter.has(filterName)) {
                bidItemsByFilter.get(filterName).add(tradeId);
              } else {
                bidItemsByFilter.set(filterName, new Set([tradeId]));
              }
              setValue("filterBidItems", bidItemsByFilter);
            }
          }

          if (notificationType === "B" || notificationType === "A") {
            sendNotificationToUser(
              "| " +
                playerName.trim() +
                " | " +
                priceTxt.trim() +
                ` | ${isBin ? "buy" : "bid"} |`,
              true
            );
          }
        } else {
          let lossCount = increAndGetStoreValue("lossCount");
          appendTransactions(
            `[${new Date().toLocaleTimeString()}] ${playerName.trim()} buy failed - Price : ${price}`
          );
          let status = ((data.error && data.error.code) || data.status) + "";
          writeToLog(
            `${playerName} - échec de l'${
              isBin ? "achat" : "enchère"
            } - ERR: (${
              errorCodeLookUp[status] + "(" + status + ")" || status
            })`,
            idProgressAutobuyer,
            player,
            "error"
          );
          if (notificationType === "L" || notificationType === "A") {
            sendNotificationToUser(
              "| " +
                playerName.trim() +
                " | " +
                priceTxt.trim() +
                " | failure |",
              false
            );
          }

          if (buyerSetting["idAbStopErrorCode"]) {
            const errorCodes = new Set(
              buyerSetting["idAbStopErrorCode"].split(",")
            );

            if (!errorCodeCountMap.has(status))
              errorCodeCountMap.set(status, { currentVal: 0 });

            errorCodeCountMap.get(status).currentVal++;

            if (
              errorCodes.has(status) &&
              errorCodeCountMap.get(status).currentVal >=
                buyerSetting["idAbStopErrorCodeCount"]
            ) {
              writeToLog(
                `[!!!] Autostopping bot since error code ${status} has occured ${
                  errorCodeCountMap.get(status).currentVal
                } times\n`,
                idProgressAutobuyer,
                player,
                "error"
              );
              errorCodeCountMap.clear();
              stopAutoBuyer();

              if (buyerSetting["idAbResumeAfterErrorOccured"]) {
                const pauseFor = convertRangeToSeconds(
                  buyerSetting["idAbResumeAfterErrorOccured"]
                );

                writeToLog(
                  `Le bot reprendra dans ${pauseFor}(s)`,
                  idProgressAutobuyer,
                  player,
                  "error"
                );
                setTimeout(() => {
                  startAutoBuyer.call(getValue("AutoBuyerInstance"));
                }, pauseFor * 1000);
              }
            }
          }
        }
        buyerSetting["idAbAddBuyDelay"] &&
          (await wait(convertToSeconds(buyerSetting["idAbDelayToAdd"])));
        resolve();
      }
    );
  });
};
