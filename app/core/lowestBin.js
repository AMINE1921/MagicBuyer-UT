import { sleep } from "./async";
import { buildCriteria, normalizeFilter } from "./filters";
import { auctionOf, marketPageSize, searchMarket } from "./market";
import { floorPrice, priceAbove, priceBelow, roundPrice } from "./prices";
import { usageLimitMessage } from "./usage";

// Prix « achat immédiat » le plus bas du moment sur le marché EA pour une version exacte (défId).
// EA trie les résultats par fin d'enchère, pas par prix : une page pleine ne dit pas où est le
// minimum. On cherche donc avec un prix max, qu'on baisse tant que la page est pleine (le moins
// cher trouvé moins un palier), et qu'on remonte si rien n'est trouvé. Chaque recherche a un prix
// max différent (pas de réponse en cache). Nombre de recherches limité (réglage Outils).
// Style de chimie (playStyle > 0, ex. 268 = Ombre) : recherche limitée à ce style et seules les
// annonces de ce style comptent (le prix d'une variante n'est pas celui de la carte nue).

const offersOf = (items, definitionId, playStyle) =>
  items
    .map((item) => ({ item, auction: auctionOf(item) }))
    .filter(
      ({ item, auction }) =>
        auction &&
        !auction.tradeOwner &&
        Number(item.definitionId) === definitionId &&
        (!playStyle || Number(item.playStyle) === playStyle) &&
        Number(auction.buyNowPrice) > 0
    )
    .map(({ auction }) => ({ price: Number(auction.buyNowPrice), tradeId: String(auction.tradeId || "") }));

const LOWEST_PRICES_KEPT = 10;

// Résultat : { ok, price, count (annonces au prix le plus bas), prices (les annonces les moins chères
// vues, triées, sans doublon d'annonce), searches, exact (minimum certain) }.
// spread : minimum trouvé avec moins de 3 annonces vues → une recherche de plus jusqu'à 1,6 × ce prix,
// pour voir les annonces suivantes (et reconnaître une annonce bradée isolée, voir robustMarketPrice).
// Puis, si des annonces passent pour bradées sur un échantillon incomplet (page pleine : EA trie par
// fin d'enchère, la page 1 montre les annonces qui finissent, souvent invendues car trop chères, pas
// les dernières postées), une recherche plafonnée à leur prix + 11 % renvoie toutes les annonces
// jusque-là, récentes comprises : plusieurs annonces à ce niveau, c'est le marché, pas une affaire.
const SPREAD_RATIO = 1.6;
const SPREAD_MIN_PRICES = 3;

export const findLowestBin = async (
  definitionId,
  { reference = 0, maxSearches = 6, token = null, gapMs = 1200, playStyle = 0, spread = false } = {}
) => {
  const id = Number(definitionId) || 0;
  if (!id) {
    return { ok: false, error: { label: "?" }, searches: 0 };
  }
  const style = Number(playStyle) > 0 ? Number(playStyle) : 0;
  const pageSize = marketPageSize();
  const limit = Math.max(2, Math.min(12, Number(maxSearches) || 6));
  let max = reference > 0 ? floorPrice(reference) : 0;
  // Plus haut prix max sans aucun résultat (le minimum est au-dessus).
  let emptyBelow = 0;
  let best = 0;
  let count = 0;
  let exact = false;
  let searches = 0;
  const tried = new Set();
  // Annonces vues (identifiant → prix), pour donner la répartition des prix les plus bas.
  const seen = new Map();
  // Prix max le plus haut dont la page n'était pas pleine : toutes les annonces jusqu'à ce prix ont
  // été vues (Infinity : recherche sans prix max, page incomplète).
  let complete = 0;
  const lowestPrices = () =>
    Array.from(seen.values())
      .sort((a, b) => a - b)
      .slice(0, LOWEST_PRICES_KEPT);
  // Recherche annexe (spread, vérification) : annonces ajoutées à l'échantillon.
  const sample = async (maxBuy, key) => {
    if (gapMs > 0) {
      await sleep(gapMs, token);
    }
    tried.add(maxBuy);
    const filter = normalizeFilter({ definitionId: id, maxBuy, playStyle: style || -1 });
    const result = await searchMarket(buildCriteria(filter, { maxBuy }), 1);
    searches += 1;
    if (!result.ok) {
      return;
    }
    offersOf(result.items, id, style).forEach((offer, index) => seen.set(offer.tradeId || `${key}:${index}`, offer.price));
    if (result.items.length < pageSize) {
      complete = Math.max(complete, maxBuy);
    }
  };
  while (searches < limit && !(token && token.cancelled)) {
    if (tried.has(max)) {
      break;
    }
    const stop = usageLimitMessage();
    if (stop) {
      return { ok: false, error: { label: stop }, price: best, count, prices: lowestPrices(), searches, exact: false };
    }
    tried.add(max);
    const filter = normalizeFilter({ definitionId: id, maxBuy: max, playStyle: style || -1 });
    const result = await searchMarket(buildCriteria(filter, { maxBuy: max }), 1);
    searches += 1;
    if (!result.ok) {
      return { ok: false, error: result.error, price: best, count, prices: lowestPrices(), searches, exact: false };
    }
    const offers = offersOf(result.items, id, style);
    offers.forEach((offer, index) => seen.set(offer.tradeId || `${searches}:${index}`, offer.price));
    const bins = offers.map((offer) => offer.price);
    const full = result.items.length >= pageSize;
    if (!full) {
      complete = Math.max(complete, max || Infinity);
    }
    if (bins.length) {
      const lowest = Math.min(...bins);
      if (!best || lowest < best) {
        best = lowest;
        count = bins.filter((bin) => bin === lowest).length;
      } else if (lowest === best) {
        count = Math.max(count, bins.filter((bin) => bin === lowest).length);
      }
    }
    if (full && bins.length) {
      // D'autres annonces peuvent être moins chères : on cherche sous le moins cher vu.
      const next = priceBelow(best);
      if (!next || next <= emptyBelow) {
        exact = true;
        break;
      }
      max = next;
    } else if (!bins.length) {
      if (best) {
        // Rien sous ce max alors qu'on a déjà vu `best` : c'est le minimum.
        exact = true;
        break;
      }
      if (!max) {
        // Aucune annonce du tout.
        exact = true;
        break;
      }
      emptyBelow = max;
      // Rien à ce prix : on remonte (x1,5), puis sans prix max.
      max = searches >= limit - 1 ? 0 : roundPrice(Math.max(priceAbove(max), max * 1.5));
    } else {
      // Page incomplète avec des résultats : toutes les annonces ≤ max sont là, minimum trouvé.
      exact = true;
      break;
    }
    if (gapMs > 0 && searches < limit) {
      await sleep(gapMs, token);
    }
  }
  const canSearch = () => !(token && token.cancelled) && !usageLimitMessage();
  if (spread && best && seen.size < SPREAD_MIN_PRICES && canSearch()) {
    const wide = roundPrice(best * SPREAD_RATIO);
    if (wide > best && !tried.has(wide)) {
      await sample(wide, "wide");
    }
  }
  if (spread && best && canSearch()) {
    const { skipped } = robustMarketPrice({ price: best, count, prices: lowestPrices() });
    // Plus haut prix où une 3e annonce suffit à garder l'annonce écartée la plus chère.
    const cap = skipped.length ? floorPrice(skipped[skipped.length - 1] / OUTLIER_RATIO) : 0;
    if (cap && complete < cap && !tried.has(cap)) {
      await sample(cap, "check");
    }
  }
  return { ok: true, price: best, count, prices: lowestPrices(), searches, exact };
};

// Prix de référence d'un marché : une ou deux annonces bradées (plus de 10 % sous la 3e moins chère)
// sont des affaires, pas le prix du marché. Plusieurs annonces au même prix forment un niveau de prix
// (le marché), jamais écarté. Renvoie { price, count, skipped } ; skipped = annonces écartées (prix
// croissants). Sans répartition connue : le prix le plus bas tel quel.
const OUTLIER_RATIO = 0.9;

export const robustMarketPrice = ({ price = 0, count = 0, prices = [] } = {}) => {
  const sorted = (prices || []).filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length < 2) {
    return { price, count, skipped: [] };
  }
  const reference = sorted[Math.min(2, sorted.length - 1)];
  const skipped = [];
  while (sorted.length > 1 && sorted[0] < reference * OUTLIER_RATIO && sorted[0] !== sorted[1]) {
    skipped.push(sorted.shift());
  }
  const market = sorted[0];
  return { price: market, count: sorted.filter((value) => value === market).length, skipped };
};
