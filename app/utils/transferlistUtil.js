import { idProgressAutobuyer } from "../elementIds.constants";
import { getStatsValue, updateStats } from "../handlers/statsProcessor";
import { writeToLog } from "./logUtil";
import { sendPinEvents } from "./notificationUtil";
import { getPageRepositories, getPageServices, syncPageGlobals } from "./pageWindow";
import { updateUserCredits } from "./userUtil";

export const transferListUtil = function (
  relistUnsold,
  minSoldCount,
  isInitialRun
) {
  sendPinEvents("Transfer List - List View");
  return new Promise((resolve) => {
    syncPageGlobals();
    const services = getPageServices();
    const repositories = getPageRepositories() || {};
    const pile =
      (typeof ItemPile !== "undefined" && ItemPile) ||
      (window.ItemPile) ||
      {};
    if (!services || !services.Item || typeof services.Item.requestTransferItems !== "function") {
      resolve();
      return;
    }
    if (
      !isInitialRun &&
      repositories.Item &&
      typeof repositories.Item.isDirty === "function" &&
      pile.TRANSFER != null &&
      !repositories.Item.isDirty(pile.TRANSFER)
    ) {
      resolve();
      return;
    }
    const watchdog = setTimeout(resolve, 8000);
    try {
    services.Item.requestTransferItems().observe(
      this,
      async function (t, response) {
        clearTimeout(watchdog);
        const items =
          (response && response.response && response.response.items) || [];
        let soldItems = items.filter(function (item) {
          return item.getAuctionData && item.getAuctionData().isSold();
        }).length;
        if (getStatsValue("soldItems") < soldItems) {
          await updateUserCredits();
        }
        updateStats("soldItems", soldItems);

        const unsoldItems = items.filter(function (item) {
          return (
            item.getAuctionData &&
            !item.getAuctionData().isSold() &&
            item.getAuctionData().isExpired()
          );
        }).length;
        updateStats("unsoldItems", unsoldItems);

        const shouldClearSold = soldItems >= minSoldCount;

        if (unsoldItems && relistUnsold && typeof services.Item.relistExpiredAuctions === "function") {
          services.Item.relistExpiredAuctions().observe(
            this,
            function () {
              !shouldClearSold &&
                window.UTTransferListViewController &&
                UTTransferListViewController.prototype.refreshList();
            }
          );
        }

        const activeTransfers = items.filter(function (item) {
          return item.getAuctionData && item.getAuctionData().isSelling();
        }).length;
        updateStats("activeTransfers", activeTransfers);

        const availableItems = items.filter(function (item) {
          return item.getAuctionData && item.getAuctionData().isInactive();
        }).length;

        updateStats("availableItems", availableItems);

        const user =
          services.User && services.User.getUser && services.User.getUser();
        const userCoins = (user && user.coins && user.coins.amount) || 0;
        updateStats("coinsNumber", userCoins);
        updateStats("coins", userCoins.toLocaleString());

        if (shouldClearSold) {
          writeToLog(
            "[TRANSFER-LIST] > " + soldItems + " item(s) sold\n",
            idProgressAutobuyer
          );
          if (
            window.UTTransferListViewController &&
            UTTransferListViewController.prototype._clearSold
          ) {
            UTTransferListViewController.prototype._clearSold();
          }
        }
        resolve();
      }
    );
    } catch (e) {
      clearTimeout(watchdog);
      resolve();
    }
  });
};
