import { idProgressAutobuyer } from "../elementIds.constants";
import { getValue, setValue } from "../services/repository";
import { formatString, getRandNum, wait } from "./commonUtil";
import { getSellPriceFromFutBin } from "./futbinUtil";
import { writeToLog } from "./logUtil";
import { sendPinEvents } from "./notificationUtil";
import { getBuyBidPrice, getSellBidPrice } from "./priceUtils";
import { buyPlayer } from "./purchaseUtil";

const sellBids = new Set();

export const watchListUtil = function (buyerSetting) {
  sendPinEvents("Transfer Targets - List View");

  return new Promise((resolve) => {
    services.Item.clearTransferMarketCache();

    services.Item.requestWatchedItems().observe(this, function (t, response) {
      let bidPrice = buyerSetting["idAbMaxBid"];
      let sellPrice = buyerSetting["idAbSellPrice"];

      let activeItems = response.response.items.filter(function (item) {
        return !!item._auction;
      });

      if (!activeItems.length) {
        return resolve();
      }

      services.Item.refreshAuctions(activeItems).observe(
        this,
        function (t, refreshResponse) {
          services.Item.requestWatchedItems().observe(
            this,
            async function (t, watchResponse) {
              const isAutoBuyerActive = getValue("autoBuyerActive");
              const filterName = getValue("currentFilter") || "default";
              const bidItemsByFilter = getValue("filterBidItems") || new Map();
              const filterWatchList =
                bidItemsByFilter.get(filterName) || new Set();

              const userWatchItems = getValue("userWatchItems");

              if (isAutoBuyerActive && bidPrice) {
                let outBidItems = watchResponse.response.items.filter(function (
                  item
                ) {
                  return (
                    item._auction._bidState === "outbid" &&
                    (!filterName ||
                      filterWatchList.has(item._auction.tradeId)) &&
                    !userWatchItems.has(item._auction.tradeId) &&
                    item._auction._tradeState === "active"
                  );
                });

                if (outBidItems.length) {
                  const currentItem =
                    outBidItems[getRandNum(0, outBidItems.length - 1)];
                  await tryBidItems(
                    currentItem,
                    bidPrice,
                    sellPrice,
                    buyerSetting
                  );
                }
              }

              const useFutBinPrice = buyerSetting["idSellFutBinPrice"];

              if (
                isAutoBuyerActive &&
                !buyerSetting["idAbDontMoveWon"] &&
                ((sellPrice && !isNaN(sellPrice)) || useFutBinPrice)
              ) {
                let boughtItems = watchResponse.response.items.filter(function (
                  item
                ) {
                  return (
                    item.getAuctionData().isWon() &&
                    (!filterName ||
                      filterWatchList.has(item._auction.tradeId)) &&
                    !userWatchItems.has(item._auction.tradeId) &&
                    !sellBids.has(item._auction.tradeId)
                  );
                });

                for (var i = 0; i < boughtItems.length; i++) {
                  const player = boughtItems[i];
                  const ratingThreshold = buyerSetting["idSellRatingThreshold"];
                  let playerRating = parseInt(player.rating);
                  const isValidRating =
                    !ratingThreshold || playerRating <= ratingThreshold;
                  let playerName = formatString(player._staticData.name, 15);
                  let price = player._auction.currentBid;

                  if (isValidRating && useFutBinPrice) {
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

                  const shouldList =
                    sellPrice && !isNaN(sellPrice) && isValidRating;

                  if (shouldList) {
                    sellBids.add(player._auction.tradeId);
                  }
                  if (!buyerSetting["idAbDontMoveWon"]) {
                    const sellQueue = getValue("sellQueue") || [];
                    const profit = sellPrice * 0.95 - price;
                    sellQueue.push({
                      player,
                      sellPrice,
                      playerName,
                      shouldList,
                      profit,
                    });
                    setValue("sellQueue", sellQueue);
                  }
                }
              }

              let expiredItems = watchResponse.response.items.filter((item) => {
                var t = item.getAuctionData();
                return t.isExpired() || (t.isClosedTrade() && !t.isWon());
              });

              if (buyerSetting["idAutoClearExpired"] && expiredItems.length) {
                services.Item.untarget(expiredItems);
                writeToLog(
                  `${expiredItems.length} élément(s) expirés et supprimés de la liste d'objectifs`,
                  idProgressAutobuyer
                );
              }

              services.Item.clearTransferMarketCache();
              resolve();
            }
          );
        }
      );
    });
  });
};

export const addUserWatchItems = () => {
  return new Promise((resolve, reject) => {
    services.Item.requestWatchedItems().observe(this, function (t, response) {
      if (response.success) {
        const bidItemsByFilter = getValue("filterBidItems") || new Map();
        const botBiddedTrades = new Set(
          Array.from(bidItemsByFilter.values())
            .flat(1)
            .reduce((a, c) => a.concat([...c]), [])
        );
        const userWatchItems =
          response.response.items
            .filter(
              (item) =>
                item._auction && !botBiddedTrades.has(item._auction.tradeId)
            )
            .map((item) => item._auction.tradeId) || [];

        setValue("userWatchItems", new Set(userWatchItems));

        if (userWatchItems.length) {
          writeToLog(
            `${userWatchItems.length} élément(s) trouvé(s) dans la liste d'objectifs de transferts et ignoré(s)`,
            idProgressAutobuyer
          );
        }
      }
      resolve();
    });
  });
};

const tryBidItems = async (player, bidPrice, sellPrice, buyerSetting) => {
  let auction = player._auction;
  let isBid = auction.currentBid;
  let currentBid = auction.currentBid || auction.startingBid;
  let playerName = formatString(player._staticData.name, 15);
  const isAutoBuyerActive = getValue("autoBuyerActive");

  let priceToBid = buyerSetting["idAbBidExact"]
    ? bidPrice
    : isBid
    ? getSellBidPrice(bidPrice)
    : bidPrice;

  let checkPrice = buyerSetting["idAbBidExact"]
    ? bidPrice
    : isBid
    ? getBuyBidPrice(currentBid)
    : currentBid;

  if (isAutoBuyerActive && currentBid <= priceToBid) {
    writeToLog(
      "Enchèr sur un élement en surenchère -> Prix d'enchère :" + checkPrice,
      idProgressAutobuyer
    );
    await buyPlayer(player, playerName, checkPrice, sellPrice);
    buyerSetting["idAbAddBuyDelay"] && (await wait(1));
  }
};
