import * as market from "./market";
import { floorPrice, priceAbove, priceBelow, roundPrice, startPriceFor, toInt } from "./prices";
import { parseRange, randomBetween } from "./ranges";

// Outils communs de mise en vente (bot, relist FUTBIN, actions groupées, liste rapide).

const LIST_DURATIONS = [3600, 10800, 21600, 43200, 86400, 259200];

// Durée EA la plus proche de la valeur saisie ("1H", "3H", "1D"…).
export const durationSeconds = (value) => {
  const range = parseRange(value, "H");
  const wanted = range ? range.min : 3600;
  return LIST_DURATIONS.reduce((best, d) => (Math.abs(d - wanted) < Math.abs(best - wanted) ? d : best));
};

// Plage de pourcentage ("95-100", "98") bornée à 10–150 %.
export const percentRange = (value, fallback = 100) => {
  const range = parseRange(value, null) || { min: fallback, max: fallback };
  const clamp = (n) => Math.min(150, Math.max(10, n));
  return { min: clamp(range.min), max: clamp(range.max) };
};

// Prix de revente à partir du prix FUTBIN : pourcentage tiré dans la plage, arrondi au palier EA.
export const futbinSellPrice = (reference, percentValue) => {
  const range = percentRange(percentValue);
  const percent = randomBetween(range.min, range.max);
  return { price: roundPrice((toInt(reference) * percent) / 100), percent };
};

// Mode de revente d'un filtre : "fixed" ou "futbin" (le filtre peut suivre l'onglet Vente).
export const sellModeFor = (filter, sell) => {
  if (filter && filter.sellMode === "fixed") {
    return "fixed";
  }
  if (filter && filter.sellMode === "futbin") {
    return "futbin";
  }
  return sell.priceMode === "futbin" ? "futbin" : "fixed";
};

export const sellPercentFor = (filter, sell) =>
  filter && filter.sellMode === "futbin" && filter.sellPercent ? filter.sellPercent : sell.futbinPercent;

export const fixedSellPriceFor = (filter, sell) =>
  roundPrice((filter && filter.sellMode === "fixed" && toInt(filter.sellPrice)) || toInt(sell.defaultPrice));

// Ajuste le prix "achat immédiat" aux limites EA de la carte et calcule le prix de départ.
export const prepareListing = async (item, price) => {
  let buyNow = roundPrice(price);
  const limits = await market.fetchPriceLimits(item);
  if (limits) {
    if (limits.max && buyNow > limits.max) {
      buyNow = floorPrice(limits.max);
    }
    if (limits.min && buyNow <= limits.min) {
      buyNow = priceAbove(limits.min);
    }
  }
  let start = startPriceFor(buyNow);
  if (limits && limits.min && start < limits.min) {
    start = limits.min;
  }
  if (start >= buyNow) {
    start = priceBelow(buyNow) || start;
  }
  return { buyNow, start, limits };
};
