import { afterTax } from "./prices";

// Analyse du club : valeur FUTBIN des cartes échangeables, coins investis (prix payé EA :
// lastSalePrice), plus-value latente après la taxe EA de 5 %, meilleures et pires lignes,
// répartition par note et cartes revendables avec bénéfice (hors équipe active).
// Fonction pure : les prix sont fournis par `priceOf(item)` (0 = inconnu).

export const RATING_BUCKETS = [
  { id: "90", min: 90, max: 99 },
  { id: "85", min: 85, max: 89 },
  { id: "80", min: 80, max: 84 },
  { id: "75", min: 75, max: 79 },
  { id: "0", min: 0, max: 74 },
];

const TOP = 8;

const bucketOf = (rating) => RATING_BUCKETS.find((bucket) => rating >= bucket.min && rating <= bucket.max) || RATING_BUCKETS[RATING_BUCKETS.length - 1];

export const analyzeClub = (items, { squadIds = new Set(), priceOf = () => 0, minSellProfit = 0 } = {}) => {
  const report = {
    count: 0,
    tradable: 0,
    untradable: 0,
    priced: 0,
    value: 0,
    netValue: 0,
    paidCount: 0,
    invested: 0,
    tracked: 0,
    unrealized: 0,
    buckets: RATING_BUCKETS.map((bucket) => ({ id: bucket.id, min: bucket.min, max: bucket.max, count: 0, tradable: 0, value: 0 })),
    gainers: [],
    losers: [],
    sellable: [],
  };
  const lines = [];
  (items || []).forEach((item) => {
    if (!item) {
      return;
    }
    report.count += 1;
    const rating = Number(item.rating) || 0;
    const bucket = report.buckets.find((entry) => entry.id === bucketOf(rating).id);
    bucket.count += 1;
    if (item.tradable === false) {
      report.untradable += 1;
      return;
    }
    report.tradable += 1;
    bucket.tradable += 1;
    const price = Math.max(0, Number(priceOf(item)) || 0);
    const paid = Math.max(0, Number(item.lastSalePrice) || 0);
    if (price) {
      report.priced += 1;
      report.value += price;
      report.netValue += afterTax(price);
      bucket.value += price;
    }
    if (paid) {
      report.paidCount += 1;
      report.invested += paid;
    }
    if (price && paid) {
      const gain = afterTax(price) - paid;
      report.tracked += 1;
      report.unrealized += gain;
      lines.push({ item, price, paid, gain, inSquad: squadIds.has(String(item.id)) });
    }
  });
  const byGain = lines.slice().sort((a, b) => b.gain - a.gain);
  report.gainers = byGain.filter((line) => line.gain > 0).slice(0, TOP);
  report.losers = byGain
    .filter((line) => line.gain < 0)
    .reverse()
    .slice(0, TOP);
  // Revendables avec bénéfice : hors équipe active, bénéfice après taxe au moins `minSellProfit`.
  report.sellable = byGain.filter((line) => !line.inSquad && line.gain > Math.max(0, Number(minSellProfit) || 0));
  return report;
};
