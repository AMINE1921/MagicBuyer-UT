import { convertToSeconds, wait } from "./commonUtil";
import { getBuyerSettings, getValue } from "../services/repository";
import { idProgressAutobuyer } from "../elementIds.constants";
import { sendNotificationToUser } from "./notificationUtil";
import { listItemOnMarket } from "./eaAuction";
import { writeToLog } from "./logUtil";
import {
  getPageRepositories,
  getPageServices,
  getPageWindow,
  syncPageGlobals,
} from "./pageWindow";
import { updateProfit } from "./statsUtil";

const getItemPile = () => {
  const page = getPageWindow();
  return (page && page.ItemPile) || window.ItemPile || null;
};

const observeMove = (observable) =>
  new Promise((resolve) => {
    if (!observable || typeof observable.observe !== "function") {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, 8000);
    observable.observe(null, function () {
      clearTimeout(timer);
      resolve();
    });
  });

export const processSellQueue = async () => {
  const sellQueue = getValue("sellQueue") || [];
  const buyerSettings = getBuyerSettings();
  while (sellQueue.length) {
    const job = sellQueue.pop();
    try {
      await sellItems(job, buyerSettings);
    } catch (e) {
      writeToLog(
        `Mise en vente échouée${
          job && job.playerName ? ` · ${job.playerName}` : ""
        } : ${e && e.message ? e.message : e}`,
        idProgressAutobuyer,
        job && job.player,
        "error"
      );
    }
    if (sellQueue.length) {
      await wait(2);
    }
  }
};

const sellItems = async (job, buyerSetting) => {
  syncPageGlobals();
  const { player, sellPrice, shouldList, playerName, profit, buyPrice } = job;
  const services = getPageServices();
  const repositories = getPageRepositories();
  const piles = getItemPile();
  if (!player) {
    throw new Error("Carte introuvable");
  }

  if (sellPrice < 0) {
    if (!services || !services.Item || typeof services.Item.move !== "function") {
      throw new Error("API déplacement introuvable");
    }
    await observeMove(
      services.Item.move(player, piles && piles.TRANSFER != null ? piles.TRANSFER : 5)
    );
    writeToLog(
      `${playerName || "Carte"} envoyée sur la liste des transferts`,
      idProgressAutobuyer,
      player
    );
    return;
  }

  if (shouldList && sellPrice) {
    if (
      repositories &&
      repositories.Item &&
      typeof repositories.Item.isPileFull === "function" &&
      piles &&
      piles.TRANSFER != null &&
      repositories.Item.isPileFull(piles.TRANSFER)
    ) {
      writeToLog(
        `${playerName || "Carte"} : liste des transferts pleine, pas listée`,
        idProgressAutobuyer,
        player,
        "warning"
      );
      return;
    }
    const listed = await listItemOnMarket(
      player,
      sellPrice,
      convertToSeconds(buyerSetting["idFutBinDuration"] || "1H") || 3600
    );
    if (profit) {
      updateProfit(profit);
    }
    writeToLog(
      `${playerName || "Carte"} listée à ${listed.bin} (départ ${listed.start})${
        profit ? ` · bénéfice estimé ${Math.round(profit)} si vendue` : ""
      }`,
      idProgressAutobuyer,
      player,
      "success"
    );
    if (buyerSetting["idAbSendListingNotificationToggle"]) {
      sendNotificationToUser(
        `${playerName || "Carte"} listée à ${listed.bin}`,
        true
      );
    }
    return;
  }

  if (services && services.Item && typeof services.Item.move === "function") {
    await observeMove(
      services.Item.move(player, piles && piles.CLUB != null ? piles.CLUB : 7)
    );
    writeToLog(
      `${playerName || "Carte"} envoyée au club (pas de prix de vente)`,
      idProgressAutobuyer,
      player
    );
    return;
  }

  writeToLog(
    `${playerName || "Carte"} achetée à ${buyPrice || "?"} — pas listée (prix de vente vide)`,
    idProgressAutobuyer,
    player,
    "warning"
  );
};
