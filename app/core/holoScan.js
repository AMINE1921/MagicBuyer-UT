import { normalizeApiQuery, searchFutbinApi } from "../prices/futbinApi";
import { pricePlatform } from "../prices/priceService";
import { sleep } from "./async";
import { isHoloItem, nameOf, ratingOf, searchConceptRarity } from "./market";
import { localize, repositories } from "./page";
import { afterTax, floorPrice, profitFor, toInt } from "./prices";

// Scanner de prime holo (onglet FUTBIN). Chaque carte promo existe en version normale et en version
// holographique, plus rare et plus chère : sur les 92 TOTW 1 à 4 (relevé du 09/10/2026), la holo
// valait 1,3 à 3 fois la normale (TOTW 80 : ~10 500 contre ~14 000), avec des marchés EA profonds.
// 1. EA : toutes les versions de la promo choisie (recherche « concept » par rareté, 250 cartes par
//    requête, aucune recherche sur le marché des transferts). La holo porte l'habillage holo d'EA ; sa
//    version normale est la carte du même joueur, de même note, sans habillage.
// 2. FUTBIN : prix des deux versions par l'API de l'appli (une recherche par joueur).
// Les listes futbin.com ne servent pas : FUTBIN les refuse aux requêtes du script (403, 09/10/2026).
// Les filtres créés ensuite chassent la holo en mode « prix marché EA », avec un plafond qui garde le
// bénéfice minimum à l'achat si elle est revendue au prix holo.

// Pause entre deux joueurs, en plus de l'écart propre à l'API (une recherche par seconde environ).
const CARD_GAP = 700;
const CONCEPT_PAGE = 250;
const MAX_CONCEPT_PAGES = 4;
// Recherches essayées par joueur : nom EA affiché, prénom + nom, puis le mot le plus long. L'API
// cherche le texte tel quel : « kone doherty » ne trouve pas « Trent Koné-Doherty », « doherty » oui.
const NAMED_QUERIES = 2;

let lastScan = null;
let running = null;

export const lastHoloScan = () => lastScan;
export const holoScanRunning = () => !!running;
export const stopHoloScan = () => {
  if (running) {
    running.cancelled = true;
  }
};

// Promos proposées : raretés EA du web app (nom traduit par EA), sauf commune (0) et rare (1).
// TOTW (3) et Destin glorieux (22) d'abord, puis l'ordre alphabétique. Avant le chargement du web
// app : ces deux-là seulement.
const FIRST_RARITIES = [
  [3, "Team of the Week"],
  [22, "Destined for Glory"],
];
export const holoRarities = () => {
  let ids = [];
  try {
    ids = Array.from(repositories().Rarity.values(), (entry) => Number(entry.id)).filter((id) => id > 1);
  } catch (e) {}
  const first = FIRST_RARITIES.map(([id]) => id);
  const fallback = new Map(FIRST_RARITIES);
  return Array.from(new Set(first.concat(ids)))
    .map((id) => ({ id, name: localize(`item.raretype${id}`, fallback.get(id) || `#${id}`) }))
    .sort((a, b) => {
      const rank = (entry) => (first.includes(entry.id) ? first.indexOf(entry.id) : first.length);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
};

const baseOf = (id) => (Number(id) || 0) % 16777216;

// Paires holo / normale d'une liste de cartes EA : même joueur, même note. alone = holo sans normale.
export const pairHoloItems = (items) => {
  const groups = new Map();
  (items || []).forEach((item) => {
    const id = Number(item && item.definitionId) || 0;
    if (!id) {
      return;
    }
    const key = `${baseOf(id)}:${ratingOf(item)}`;
    const group = groups.get(key) || { holo: [], normal: [] };
    (isHoloItem(item) ? group.holo : group.normal).push(item);
    groups.set(key, group);
  });
  const pairs = [];
  let alone = 0;
  groups.forEach((group) => {
    group.holo.forEach((holo, index) => {
      const normal = group.normal[index] || group.normal[0];
      if (normal) {
        pairs.push({ holo, normal });
      } else {
        alone += 1;
      }
    });
  });
  return { pairs, alone };
};

const staticOf = (item) => {
  try {
    return (typeof item.getStaticData === "function" && item.getStaticData()) || item._staticData || {};
  } catch (e) {
    return {};
  }
};

export const holoQueriesFor = (item) => {
  const data = staticOf(item);
  const known = data.knownAs && data.knownAs !== "---" ? data.knownAs : "";
  const full = data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : "";
  const names = [known || data.name, full, data.name, data.lastName];
  const seen = new Set();
  const queries = names
    .map(normalizeApiQuery)
    .filter((query) => query.length >= 2 && !seen.has(query) && seen.add(query))
    .slice(0, NAMED_QUERIES);
  const longest = names
    .map(normalizeApiQuery)
    .join(" ")
    .split(" ")
    .reduce((best, word) => (word.length > best.length ? word : best), "");
  if (longest.length >= 4 && !queries.includes(longest)) {
    queries.push(longest);
  }
  return queries;
};

// Prix FUTBIN des deux versions : recherches dans l'API jusqu'à trouver la holo (identifiant EA exact).
const readPrices = async (pair) => {
  const holoId = Number(pair.holo.definitionId);
  const normalId = Number(pair.normal.definitionId);
  for (const query of holoQueriesFor(pair.holo)) {
    const res = await searchFutbinApi(query);
    if (!res.ok) {
      if (res.blocked) {
        return { blocked: true };
      }
      continue;
    }
    const holo = res.cards.find((card) => card.eaId === holoId);
    if (holo) {
      return { holo, normal: res.cards.find((card) => card.eaId === normalId) || null };
    }
  }
  return { missing: true };
};

// Ligne du tableau (cartes de l'API FUTBIN). edge = bénéfice (après la taxe EA) d'une holo payée au
// prix de la normale et revendue au prix holo ; cap = achat max qui garde minProfit à la revente.
export const holoRow = ({ holo, normal }, platform, minProfit, fallback = {}) => {
  const holoPrice = holo.prices[platform] || 0;
  const normalPrice = normal ? normal.prices[platform] || 0 : 0;
  return {
    eaId: holo.eaId,
    normalId: normal ? normal.eaId : toInt(fallback.normalId),
    baseId: baseOf(holo.eaId),
    futbinId: holo.futbinId,
    url: holo.url || "",
    name: fallback.name || holo.name || "",
    fullName: holo.fullName || holo.name || "",
    rating: holo.rating || toInt(fallback.rating),
    promo: holo.promo || "",
    signature: !!holo.signature,
    holoPrice,
    normalPrice,
    premium: holoPrice && normalPrice ? holoPrice - normalPrice : 0,
    edge: holoPrice && normalPrice ? profitFor(normalPrice, holoPrice) : 0,
    cap: holoPrice ? floorPrice(afterTax(holoPrice) - Math.max(0, toInt(minProfit))) : 0,
    trend: holo.trend ? holo.trend[platform] : null,
  };
};

// Scan complet. options : rarity (promo EA), min / max (prix holo FUTBIN, 0 = sans limite), minProfit,
// onProgress({ step: "ea" | "card", … }), gapMs (pause entre deux joueurs).
// Résultat : { ok, rows (triées par edge décroissant), missed (holo sans prix des deux versions),
// outOfRange, items, pairs, alone, cancelled, apiBlocked } ou { ok: false, busy | eaError, error }.
export const scanHoloPremiums = async ({ rarity = 3, min = 0, max = 0, minProfit = 1000, onProgress = () => {}, gapMs = CARD_GAP } = {}) => {
  if (running) {
    return { ok: false, busy: true };
  }
  const token = { cancelled: false };
  running = token;
  try {
    const platform = pricePlatform();
    const items = [];
    for (let page = 1; page <= MAX_CONCEPT_PAGES && !token.cancelled; page += 1) {
      onProgress({ step: "ea", page });
      const res = await searchConceptRarity(rarity, { offset: items.length, count: CONCEPT_PAGE });
      if (!res.ok) {
        return { ok: false, eaError: true, error: res.error };
      }
      items.push(...res.items);
      if (res.endOfList || !res.items.length) {
        break;
      }
    }
    const { pairs, alone } = pairHoloItems(items);
    const low = toInt(min);
    const high = toInt(max);
    const rows = [];
    const missed = [];
    let outOfRange = 0;
    let apiBlocked = false;
    for (let index = 0; index < pairs.length && !token.cancelled; index += 1) {
      const pair = pairs[index];
      const name = nameOf(pair.holo);
      onProgress({ step: "card", index: index + 1, total: pairs.length, name });
      const read = await readPrices(pair);
      if (read.blocked) {
        apiBlocked = true;
        break;
      }
      const row = read.holo ? holoRow(read, platform, minProfit, { name, rating: ratingOf(pair.holo), normalId: pair.normal.definitionId }) : null;
      if (!row || !row.holoPrice || !row.normalPrice) {
        missed.push(name);
      } else if ((low && row.holoPrice < low) || (high && row.holoPrice > high)) {
        outOfRange += 1;
      } else {
        rows.push(row);
      }
      if (index < pairs.length - 1) {
        await sleep(gapMs);
      }
    }
    rows.sort((a, b) => b.edge - a.edge || b.premium - a.premium);
    lastScan = {
      at: Date.now(),
      platform,
      rarity: Number(rarity),
      minProfit: Math.max(0, toInt(minProfit)),
      rows,
      missed,
      outOfRange,
      items: items.length,
      pairs: pairs.length,
      alone,
      cancelled: token.cancelled,
      apiBlocked,
    };
    return Object.assign({ ok: true }, lastScan);
  } finally {
    running = null;
  }
};

// Filtre « prix marché EA » sur la version holo (désactivé : le bot alterne quelques filtres à la fois).
export const holoFilterFor = (row, name, percent = 90) => ({
  name,
  enabled: false,
  player: { id: row.baseId, name: row.name, rating: row.rating },
  definitionId: row.eaId,
  futbinId: row.futbinId,
  futbinUrl: row.url,
  priceMode: "market",
  futbinPercent: percent,
  maxBuy: row.cap,
  sellMode: "global",
});

// Utilisé par les tests.
export const resetHoloScanForTests = () => {
  lastScan = null;
  running = null;
};
