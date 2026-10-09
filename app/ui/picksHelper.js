import { getSettings } from "../core/settings";
import { t } from "../i18n";
import { currentPrice } from "../prices/priceService";
import { decoratedWithin } from "./cardPrices";

// Choix de joueurs (packs « choix ») : la meilleure carte est mise en avant d'après le prix FUTBIN
// (ou la note). Le choix et la confirmation restent faits à la main dans le web app EA.

const BEST = "mb-pick-best";
const PRICE_AGE = 60 * 60 * 1000;

const score = (item, priority) => {
  const rating = Number(item && item.rating) || 0;
  const price = currentPrice(Number(item && item.definitionId) || 0, PRICE_AGE, "display") || 0;
  return priority === "rating" ? rating * 1e9 + price : price * 100 + rating;
};

export const bestPick = (entries, priority = "price") => {
  let best = null;
  let bestScore = -1;
  entries.forEach((entry) => {
    const value = score(entry.item, priority);
    if (value > bestScore) {
      best = entry;
      bestScore = value;
    }
  });
  return best;
};

export const tickPicks = () => {
  const settings = getSettings().picks || {};
  const view = document.querySelector(".ut-player-picks-view");
  const previous = document.querySelectorAll(`.${BEST}`);
  if (!view || settings.highlight === false) {
    previous.forEach((el) => el.classList.remove(BEST));
    return;
  }
  const entries = decoratedWithin(view);
  const best = entries.length > 1 ? bestPick(entries, settings.priority) : null;
  previous.forEach((el) => {
    if (!best || el !== best.root) {
      el.classList.remove(BEST);
    }
  });
  if (best && !best.root.classList.contains(BEST)) {
    best.root.classList.add(BEST);
    best.root.setAttribute("data-mb-pick-label", t(settings.priority === "rating" ? "tools.picksBestRating" : "tools.picksBestPrice"));
  }
};
