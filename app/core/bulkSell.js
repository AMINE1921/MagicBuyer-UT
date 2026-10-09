import { sleep, withTimeout } from "./async";
import { KIND, isFatal } from "./errors";
import { durationSeconds, futbinSellPrice, prepareListing } from "./listing";
import { log } from "./logger";
import * as market from "./market";
import { breakEvenPrice, formatCoins, toInt } from "./prices";
import { randomBetween } from "./ranges";
import { getSettings } from "./settings";
import { recordTransaction } from "./state";
import { t } from "../i18n";
import { currentPrice, requestPrice } from "../prices/priceService";

// Mise en vente groupée de la liste des transferts au prix FUTBIN du moment
// (% de l'onglet Vente) : cartes disponibles et, au choix, invendues.

const USABLE = 10 * 60 * 1000;

const safeCall = (target, method) => {
  try {
    return !!(target && typeof target[method] === "function" && target[method]());
  } catch (e) {
    return false;
  }
};

const isPlayer = (item) => safeCall(item, "isPlayer");

// Carte listable : pas en vente, pas vendue ; les invendues seulement si demandé.
const listable = (item, includeExpired) => {
  if (!isPlayer(item)) {
    return false;
  }
  const auction = market.auctionOf(item);
  if (!auction || !auction.tradeId || String(auction.tradeId) === "0") {
    return true;
  }
  if (safeCall(auction, "isSold") || safeCall(auction, "isSelling")) {
    return false;
  }
  if (safeCall(auction, "isExpired")) {
    return includeExpired;
  }
  return !safeCall(auction, "isActiveTrade");
};

const stopsTask = (error) =>
  error && (isFatal(error.kind) || error.kind === KIND.RATE || error.kind === KIND.BLOCKED || error.kind === KIND.FULL);

export const listTransferAtFutbin = async ({ token, includeExpired = true, onProgress = () => {} }) => {
  const report = { total: 0, listed: 0, skipped: 0, noPrice: 0, stopped: "" };
  const list = await market.fetchTransferList();
  if (!list.ok) {
    report.stopped = t("sbc.listUnavailable", { error: list.error.label });
    return report;
  }
  const items = list.items.filter((item) => listable(item, includeExpired));
  report.total = items.length;
  onProgress(report);
  const sell = getSettings().sell;
  const duration = durationSeconds(sell.duration);
  for (let index = 0; index < items.length; index += 1) {
    if (token.cancelled) {
      report.stopped = t("sbc.stopRequested");
      break;
    }
    const item = items[index];
    const name = market.nameOf(item);
    const id = Number(item.definitionId) || 0;
    report.current = name;
    onProgress(report);
    let reference = currentPrice(id, USABLE, "sell");
    if (!reference) {
      await withTimeout(requestPrice(id, { name, rating: market.ratingOf(item) }), 25000);
      reference = currentPrice(id, USABLE, "sell");
    }
    if (!reference) {
      report.noPrice += 1;
      report.skipped += 1;
      log.warn(t("sbc.listNoPrice", { name }));
      continue;
    }
    const { price } = futbinSellPrice(reference, sell.futbinPercent);
    // Jamais sous le prix payé (+ taxe EA) quand il est connu.
    const floor = sell.noLoss !== false ? breakEvenPrice(Number(item.lastSalePrice) || 0, toInt(sell.minProfit)) : 0;
    const listing = await prepareListing(item, floor && price < floor ? floor : price);
    const result = await market.listOnMarket(item, listing.start, listing.buyNow, duration);
    if (result.ok) {
      report.listed += 1;
      log.success(t("sbc.listListed", { name, price: formatCoins(listing.buyNow), futbin: formatCoins(reference) }));
      recordTransaction({ type: t("sbc.txFutbinListing"), name, rating: market.ratingOf(item), price: listing.buyNow });
    } else {
      report.skipped += 1;
      log.warn(t("sbc.listRefused", { name, error: result.error.label }));
      if (stopsTask(result.error)) {
        report.stopped = result.error.label;
        break;
      }
    }
    onProgress(report);
    if (index < items.length - 1) {
      await sleep(randomBetween(900, 1700), token);
    }
  }
  report.current = "";
  onProgress(report);
  return report;
};
