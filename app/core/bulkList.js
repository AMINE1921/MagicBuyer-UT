import { t } from "../i18n";
import { currentPrice } from "../prices/priceService";
import { sleep } from "./async";
import { KIND, isFatal } from "./errors";
import { durationSeconds, percentRange, prepareListing } from "./listing";
import { log } from "./logger";
import * as market from "./market";
import { pile } from "./page";
import { afterTax, breakEvenPrice, formatCoins, priceAbove, priceBelow, roundPrice, toInt } from "./prices";
import { parseRange, randomBetween } from "./ranges";
import { getSettings } from "./settings";
import { recordTransaction } from "./state";

// Mise en vente groupée depuis les listes EA (liste des transferts, non attribués, objectifs gagnés) :
// prix par carte au choix (fixe, % du prix FUTBIN, N paliers EA au-dessus / en dessous du prix
// FUTBIN), modifiable ligne par ligne ; limites de prix EA respectées ; jamais sous le seuil de
// rentabilité quand « Jamais à perte » est actif (prix payé connu) ; attente au hasard entre deux
// mises en vente ; arrêt immédiat sur captcha, session expirée, limite EA ou liste pleine.

const USABLE = 10 * 60 * 1000;

const safeCall = (target, method) => {
  try {
    return target && typeof target[method] === "function" ? target[method]() : undefined;
  } catch (e) {
    return undefined;
  }
};

// Carte qu'on peut mettre en vente : échangeable, pas déjà en vente ni vendue.
export const isListable = (item) => {
  if (!item || item.tradable === false || safeCall(item, "isLimitedUse")) {
    return false;
  }
  const auction = market.auctionOf(item);
  if (auction && Number(auction.tradeId) > 0) {
    if (safeCall(auction, "isSold") || safeCall(auction, "isSelling") || safeCall(auction, "isActiveTrade")) {
      return false;
    }
    // Annonce d'un autre joueur (objectifs non gagnés) : pas à nous.
    if (!auction.tradeOwner && !safeCall(auction, "isWon") && !safeCall(auction, "isExpired")) {
      return false;
    }
  }
  return true;
};

// Prix payé (EA : lastSalePrice), 0 si inconnu (carte de pack, récompense).
export const paidFor = (item) => Math.max(0, Number(item && item.lastSalePrice) || 0);

// Dernier prix « achat immédiat » de la carte si elle a déjà été mise en vente (invendue).
export const previousListing = (item) => {
  const auction = market.auctionOf(item);
  if (!auction || !(Number(auction.tradeId) > 0) || Number(auction.currentBid) > 0) {
    return 0;
  }
  return Number(auction.buyNowPrice) || 0;
};

export const futbinReference = (item) => currentPrice(Number(item && item.definitionId) || 0, USABLE, "sell");

// N paliers EA au-dessus (N > 0) ou en dessous (N < 0) d'un prix.
export const stepFrom = (price, steps) => {
  let value = roundPrice(price);
  const count = Math.max(-20, Math.min(20, Math.trunc(Number(steps) || 0)));
  for (let index = 0; index < Math.abs(count) && value; index += 1) {
    value = count > 0 ? priceAbove(value) : priceBelow(value) || value;
  }
  return value;
};

// Prix proposé pour une carte d'après le mode : { price, reference, source } (0 = pas de prix).
export const proposedPrice = (item, options) => {
  const reference = futbinReference(item);
  if (options.mode === "fixed") {
    return { price: roundPrice(toInt(options.fixed)), reference, source: "fixed" };
  }
  if (!reference) {
    return { price: 0, reference: 0, source: "missing" };
  }
  if (options.mode === "steps") {
    return { price: stepFrom(reference, options.steps), reference, source: "steps" };
  }
  const range = percentRange(options.percent || "100");
  return { price: roundPrice((reference * randomBetween(range.min, range.max)) / 100), reference, source: "percent" };
};

export const bulkOptions = (overrides = {}) => {
  const lists = getSettings().lists || {};
  return Object.assign(
    {
      mode: ["fixed", "percent", "steps"].includes(lists.bulkMode) ? lists.bulkMode : "percent",
      percent: lists.bulkPercent || "100",
      steps: Math.trunc(Number(lists.bulkSteps) || 0),
      fixed: toInt(lists.bulkFixed),
      duration: lists.bulkDuration || "1H",
      delay: lists.bulkDelay || "3-5",
    },
    overrides
  );
};

// Bénéfice estimé après la taxe EA pour une carte vendue à `price` (null si prix payé inconnu).
export const estimatedProfit = (item, price) => {
  const paid = paidFor(item);
  return paid && price ? afterTax(price) - paid : null;
};

const stopsRun = (error) =>
  !!error && (isFatal(error.kind) || error.kind === KIND.RATE || error.kind === KIND.BLOCKED || error.kind === KIND.FULL);

// rows : [{ item, price }] (prix déjà choisis). Rapport : { listed, skipped, failed, raised, stopped }.
export const listRows = async (rows, { token = null, duration = "1H", delay = "3-5", onUpdate = () => {} } = {}) => {
  const report = { listed: 0, skipped: 0, failed: 0, raised: 0, stopped: "" };
  const sell = getSettings().sell || {};
  const seconds = durationSeconds(duration);
  const wait = parseRange(delay, "S") || { min: 3, max: 5 };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (token && token.cancelled) {
      report.stopped = t("tools.stopRequested");
      break;
    }
    if (!row.price || !isListable(row.item)) {
      report.skipped += 1;
      onUpdate(row, "skipped", !row.price ? t("lists.noPrice") : t("lists.notListable"));
      continue;
    }
    // Carte hors liste des transferts (non attribués, objectifs) : il faut de la place.
    const inTransfer = Number(row.item.pile) === pile("TRANSFER");
    if (!inTransfer && market.isPileFull("TRANSFER")) {
      report.stopped = t("lists.transferFull");
      onUpdate(row, "failed", report.stopped);
      break;
    }
    onUpdate(row, "listing", "");
    let listing = await prepareListing(row.item, row.price);
    // Jamais à perte : relevé au seuil de rentabilité si le prix payé est connu.
    const floor = sell.noLoss !== false ? breakEvenPrice(paidFor(row.item), toInt(sell.minProfit)) : 0;
    let note = "";
    if (floor && listing.buyNow < floor) {
      const raised = await prepareListing(row.item, floor);
      if (raised.buyNow < floor) {
        report.skipped += 1;
        onUpdate(row, "skipped", t("lists.floorTooHigh", { floor: formatCoins(floor) }));
        continue;
      }
      listing = raised;
      report.raised += 1;
      note = t("lists.raisedToFloor", { floor: formatCoins(raised.buyNow) });
    }
    const result = await market.listOnMarket(row.item, listing.start, listing.buyNow, seconds);
    if (result.ok) {
      report.listed += 1;
      onUpdate(row, "listed", note || t("lists.listedAt", { price: formatCoins(listing.buyNow) }));
      recordTransaction({ type: t("lists.txList"), name: market.nameOf(row.item), rating: Number(row.item.rating) || 0, price: listing.buyNow, filter: t("lists.txFilter") });
    } else {
      report.failed += 1;
      const error = result.error || { label: "?" };
      onUpdate(row, "failed", error.label);
      if (stopsRun(error)) {
        report.stopped = error.label;
        log.error(t("lists.logStopped", { error: error.label }));
        break;
      }
    }
    if (index < rows.length - 1 && !(token && token.cancelled)) {
      await sleep((wait.min + Math.random() * Math.max(0, wait.max - wait.min)) * 1000, token);
    }
  }
  log.info(t("lists.logDone", { listed: report.listed, total: rows.length }));
  return report;
};
