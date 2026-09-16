import { idProgressAutobuyer } from "../elementIds.constants";
import { searchErrorHandler } from "../handlers/errorHandler";
import {
  getDataSource,
  getValue,
  increAndGetStoreValue,
  setValue,
} from "../services/repository";
import { convertToSeconds, getRandNum } from "./commonUtil";
import { checkRating } from "./futItemUtil";
import { writeToLog } from "./logUtil";
import { sendPinEvents } from "./notificationUtil";
import { getBuyBidPrice, getSellBidPrice, roundOffPrice } from "./priceUtils";
import { buyPlayer } from "./purchaseUtil";
import { updateRequestCount } from "./statsUtil";
import { sortPlayers } from "./playerUtil";
import { getStatsValue } from "../handlers/statsProcessor";
import { fetchPrices } from "../services/datasource";
import { sanitizeEaSearchCriteria, toEaSearchDto } from "../ui/buyerContext";
import { getPageServices, syncPageGlobals } from "./pageWindow";

const currentBids = new Set();

const toNumber = (value) => {
  const n = parseInt(String(value == null ? "" : value).replace(/[^\d]/g, ""), 10);
  return n > 0 ? n : 0;
};

export const searchTransferMarket = function (buyerSetting) {
  return new Promise((resolve) => {
    const finish = (message, type) => {
      if (message) {
        writeToLog(message, idProgressAutobuyer, null, type || "warning");
      }
      resolve();
    };
    let searchWatchdog;
    try {
    syncPageGlobals();
    const services = getPageServices() || {};
    buyerSetting = buyerSetting || {};
    const expiresIn = convertToSeconds(buyerSetting["idAbItemExpiring"] || "1H");
    const useRandMinBid = buyerSetting["idAbRandMinBidToggle"];
    const useRandMinBuy = buyerSetting["idAbRandMinBuyToggle"];
    const futBinBuyPercent = buyerSetting["idBuyFutBinPercent"] || 100;
    let currentPage = getValue("currentPage") || 1;
    const currentSearchPerMin = getStatsValue("searchPerMinuteCount");
    if (
      currentSearchPerMin > 15 &&
      (buyerSetting["idAbOverSearchWarning"] ||
        buyerSetting["idAbOverSearchWarning"] === undefined)
    ) {
      writeToLog(
        `<h2>Attention !</h2> <br>Plus de 15 recherches effectuées en une minute, vous devez augmenter votre temps d'attente entre les recherches !`,
        idProgressAutobuyer,
        null,
        "warning"
      );
    }
    const playersList = new Set(
      (buyerSetting["idAddIgnorePlayersList"] || []).map(({ id }) => id)
    );
    const dataSource = getDataSource();
    const criteriaSource =
      (this && this.viewmodel && this.viewmodel.searchCriteria) ||
      getValue("lastSearchCriteria") ||
      {};
    let bidPrice = toNumber(buyerSetting["idAbMaxBid"]);
    let userBuyNowPrice = toNumber(buyerSetting["idAbBuyPrice"]);
    const useFutBinPrice = !!buyerSetting["idBuyFutBinPrice"];
    const useFutBinBid = !!buyerSetting["idAbBidFutBin"];

    if (!userBuyNowPrice && !bidPrice && !useFutBinPrice && !useFutBinBid) {
      return finish(
        "Recherche ignorée : indique un Prix d'achat max ou une Enchère max dans Achat (les filtres Recherche ne comptent pas)."
      );
    }

    sendPinEvents("Transfer Market Search");
    updateRequestCount();
    let searchCriteria = sanitizeEaSearchCriteria(criteriaSource);
    if (!searchCriteria || (!searchCriteria.maskedDefId && !searchCriteria.type)) {
      return finish(
        "Aucun critère de recherche. Choisis un joueur dans Recherche.",
        "warning"
      );
    }
    const canRandomizeMins = !searchCriteria.maskedDefId;
    if (useRandMinBid && !searchCriteria.minBid && canRandomizeMins) {
      searchCriteria.minBid = roundOffPrice(
        getRandNum(0, buyerSetting["idAbRandMinBidInput"])
      );
    }
    if (useRandMinBuy && !searchCriteria.minBuy && canRandomizeMins) {
      searchCriteria.minBuy = roundOffPrice(
        getRandNum(0, buyerSetting["idAbRandMinBuyInput"])
      );
    }
    searchCriteria = sanitizeEaSearchCriteria(searchCriteria);
    const eaCriteria = toEaSearchDto(searchCriteria);
    if (this && this.viewmodel) {
      this.viewmodel.searchCriteria = eaCriteria;
    }
    setValue("lastSearchCriteria", searchCriteria);
    if (
      services.Item &&
      typeof services.Item.clearTransferMarketCache === "function"
    ) {
      services.Item.clearTransferMarketCache();
    }

    const handleSearchResponse = async function (sender, response) {
        response = response || {};
        if (!response.data && response.response) {
          response.data = response.response;
        }
        if (response.data && !Array.isArray(response.data.items) && Array.isArray(response.data.itemData)) {
          response.data.items = response.data.itemData;
        }
        if (response.success && response.data && Array.isArray(response.data.items)) {
          setValue("searchFailedCount", 0);
          let validSearchCount = true;
          writeToLog(
            response.data.items.length
              ? `${response.data.items.length} carte(s) · page ${currentPage}`
              : `Aucun élément · page ${currentPage}`,
            idProgressAutobuyer
          );

          if (response.data.items.length > 0) {
            currentPage === 1 &&
              sendPinEvents("Transfer Market Results - List View");
            if (useFutBinPrice && response.data.items[0].type === "player") {
              await fetchPrices(response.data.items);
            }
          }

          if (response.data.items.length > buyerSetting["idAbSearchResult"]) {
            validSearchCount = false;
          }

          let maxPurchases = buyerSetting["idAbMaxPurchases"] || 1;

          if (buyerSetting["idAbShouldSort"])
            response.data.items = sortPlayers(
              response.data.items,
              buyerSetting["idAbSortBy"] || "buy",
              buyerSetting["idAbSortOrder"]
            );
          for (
            let i = response.data.items.length - 1;
            i >= 0 && getValue("autoBuyerActive");
            i--
          ) {
            let player = response.data.items[i];
            let auction = player && player._auction;
            if (!auction) {
              continue;
            }
            let expires =
              window.services &&
              services.Localization &&
              typeof services.Localization.localizeAuctionTimeRemaining ===
                "function"
                ? services.Localization.localizeAuctionTimeRemaining(
                    auction.expires
                  )
                : auction.expires;
            let type = player.type;
            let { id } = player._metaData || {};
            let playerRating = parseInt(player.rating);

            if (useFutBinPrice && type === "player") {
              const existingValue = getValue(
                `${player.definitionId}_${dataSource.toLowerCase()}_price`
              );
              if (existingValue && existingValue.price) {
                const futBinBuyPrice = roundOffPrice(
                  (existingValue.price * futBinBuyPercent) / 100
                );
                userBuyNowPrice = futBinBuyPrice;
                if (useFutBinBid) {
                  bidPrice = futBinBuyPrice;
                }
              } else {
                writeToLog(
                  `Price unavailable for ${player._staticData.name}`,
                  idProgressAutobuyer
                );
                continue;
              }
            }

            let buyNowPrice = auction.buyNowPrice;
            let currentBid = auction.currentBid || auction.startingBid;
            let isBid = auction.currentBid;

            let priceToBid = buyerSetting["idAbBidExact"]
              ? bidPrice
              : isBid
              ? getSellBidPrice(bidPrice)
              : bidPrice;

            let checkPrice = buyerSetting["idAbBidExact"]
              ? priceToBid
              : isBid
              ? getBuyBidPrice(currentBid)
              : currentBid;

            let usersellPrice = toNumber(buyerSetting["idAbSellPrice"]) || null;
            let minRating = buyerSetting["idAbMinRating"];
            let maxRating = buyerSetting["idAbMaxRating"];
            let playerName =
              (player._staticData && player._staticData.name) ||
              "Joueur";

            const shouldCheckRating = minRating || maxRating;

            const isValidRating =
              !shouldCheckRating ||
              checkRating(playerRating, minRating, maxRating);

            const logWrite = writeToLogClosure(
              `${playerName}(${playerRating}) Prix: ${buyNowPrice} temps: ${expires}`
            );

            if (
              (!buyerSetting["idAbIgnoreAllowToggle"] && playersList.has(id)) ||
              (buyerSetting["idAbIgnoreAllowToggle"] && !playersList.has(id))
            ) {
              logWrite("(Joueur ignoré)");
              continue;
            }

            if (!validSearchCount) {
              logWrite("(Seuil de résultats de recherche dépassé)");
              continue;
            }

            if (maxPurchases < 1) {
              break;
            }

            if (!player.preferredPosition && buyerSetting["idAbAddFilterGK"]) {
              logWrite("(est un Gardien)");
              continue;
            }

            if (!isValidRating) {
              logWrite("(la note ne correspond pas aux critères)");
              continue;
            }

            if (currentBids.has(auction.tradeId)) {
              logWrite("(Cached Item)");
              continue;
            }

            const userCoins =
              (window.services &&
                services.User &&
                services.User.getUser &&
                services.User.getUser().coins &&
                services.User.getUser().coins.amount) ||
              0;
            if (
              (!bidPrice && userCoins < buyNowPrice) ||
              (bidPrice && userCoins < checkPrice)
            ) {
              logWrite("(Coins insuffisants pour acheter/enchérir)");
              continue;
            }

            if (userBuyNowPrice && buyNowPrice <= userBuyNowPrice) {
              logWrite("essaye d'achat à: " + buyNowPrice);
              maxPurchases--;
              currentBids.add(auction.tradeId);
              await buyPlayer(
                player,
                playerName,
                buyNowPrice,
                usersellPrice,
                true,
                auction.tradeId
              );
              continue;
            }

            if (bidPrice && currentBid <= priceToBid) {
              if (auction.expires > expiresIn) {
                logWrite("(Attente de l'heure d'expiration spécifiée)");
                continue;
              }
              logWrite("tentative d'enchère à: " + checkPrice);
              currentBids.add(auction.tradeId);
              maxPurchases--;
              await buyPlayer(
                player,
                playerName,
                checkPrice,
                usersellPrice,
                checkPrice === buyNowPrice,
                auction.tradeId
              );
              continue;
            }

            if (
              (userBuyNowPrice && buyNowPrice > userBuyNowPrice) ||
              (bidPrice && currentBid > priceToBid)
            ) {
              logWrite(
                `Prix d'achat: ${
                  userBuyNowPrice || priceToBid
                } (supérieur au prix d'achat/offre spécifié)`
              );
              continue;
            }
            logWrite("(Aucune action requise)");
          }
        } else {
          searchErrorHandler(
            response,
            buyerSetting["idAbSolveCaptcha"],
            buyerSetting["idAbCloseTabToggle"]
          );
        }
        sendPinEvents("Transfer Market Search");

        const itemCount =
          (response.data && response.data.items && response.data.items.length) ||
          0;
        if (
          currentPage < buyerSetting["idAbMaxSearchPage"] &&
          itemCount === 21
        ) {
          increAndGetStoreValue("currentPage");
        } else {
          setValue("currentPage", 1);
        }
        resolve();
      };

    const searchApi = services.Item && services.Item.searchTransferMarket;
    if (typeof searchApi !== "function") {
      return finish(
        "API marché introuvable (services.Item.searchTransferMarket).",
        "error"
      );
    }

    writeToLog(
      `Recherche marché${
        searchCriteria.maskedDefId ? ` · id ${searchCriteria.maskedDefId}` : ""
      }${userBuyNowPrice ? ` · achat ≤ ${userBuyNowPrice}` : ""}${
        bidPrice ? ` · enchère ≤ ${bidPrice}` : " · sans enchère"
      }${useFutBinPrice ? " · prix FUTBIN" : ""}`,
      idProgressAutobuyer
    );

    searchWatchdog = setTimeout(() => {
      finish("Recherche marché : pas de réponse (15s).", "error");
    }, 15000);

    const onResult = (sender, response) => {
      clearTimeout(searchWatchdog);
      Promise.resolve(handleSearchResponse(sender, response)).catch((e) => {
        writeToLog(
          `Erreur traitement marché : ${e && e.message ? e.message : e}`,
          idProgressAutobuyer,
          null,
          "error"
        );
        resolve();
      });
    };

    let searchResult;
    try {
      searchResult = searchApi.call(
        services.Item,
        eaCriteria,
        currentPage
      );
    } catch (firstError) {
      try {
        searchResult = searchApi.call(services.Item, eaCriteria);
      } catch (e) {
        clearTimeout(searchWatchdog);
        return finish(
          `Erreur API marché : ${e && e.message ? e.message : firstError && firstError.message}`,
          "error"
        );
      }
    }
    if (searchResult && typeof searchResult.observe === "function") {
      searchResult.observe(this || {}, onResult);
    } else if (searchResult && typeof searchResult.then === "function") {
      searchResult
        .then((response) => onResult(null, response))
        .catch((e) => {
          clearTimeout(searchWatchdog);
          finish(
            `Recherche marché rejetée : ${e && e.message ? e.message : e}`,
            "error"
          );
        });
    } else {
      clearTimeout(searchWatchdog);
      return finish("Réponse marché inattendue — recherche ignorée.", "error");
    }
    } catch (e) {
      if (searchWatchdog) {
        clearTimeout(searchWatchdog);
      }
      finish(
        `Erreur recherche : ${e && e.message ? e.message : e}`,
        "error"
      );
    }
  });
};

const writeToLogClosure = (playerName) => {
  return (actionTxt) => {
    writeToLog(playerName + " " + actionTxt, idProgressAutobuyer);
  };
};
