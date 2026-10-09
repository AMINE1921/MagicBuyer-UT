import { t } from "../i18n";
import { currentPrice, trackPrice } from "../prices/priceService";
import { sleep } from "./async";
import { buildLadder } from "./gallery";
import { errorMessage, log } from "./logger";
import { moveItem, moveItems, searchConceptItems } from "./market";
import { getCoins } from "./page";
import { formatCoins, toInt } from "./prices";
import { pickSeconds } from "./ranges";
import { buyEntry, describeFatal } from "./sbc";
import { MARKET_TTL } from "./sbcMarket";
import { entryFromItem } from "./sbcPool";
import { getSettings } from "./settings";
import { recordTransaction, updateState } from "./state";

// Achat des cartes « à acheter » proposées par le solveur, toujours après confirmation de
// l'utilisateur : même machinerie que les achats DCE (sbc.js : recherche exacte de la version,
// paliers de prix, compteur de requêtes, arrêt sur captcha / session / blocage), réserve de pièces
// respectée (réglage buy.coinsReserve), cartes envoyées au club (doublon : stockage DCE).

const PRICE_WAIT = 30 * 1000;
const LIVE_AGE = 5 * 60 * 1000;

// Marge d'achat des DCE (réglage sbc.margin, 0 à 50 %).
export const buyMargin = () => Math.max(0, Math.min(50, Number(getSettings().sbc.margin) || 0));

// Prix de référence : FUTBIN en direct (5 min), sinon le prix de la liste FUTBIN s'il a moins de 10 min.
export const referencePrice = (entry, now = Date.now()) =>
  currentPrice(entry.definitionId, LIVE_AGE, "buy") || (entry.listedAt && now - entry.listedAt < MARKET_TTL ? entry.price : 0);

// Paliers d'achat : de 90 % du prix de référence jusqu'au prix + marge DCE, en 3 essais.
export const ladderFor = (reference, margin = buyMargin()) => buildLadder(reference, { range: { min: 90, max: 100 + margin }, retries: 3 });

// Pièces disponibles pour acheter (réserve déduite) ; 0 si le solde est inconnu.
export const spendable = () => {
  const coins = getCoins();
  return coins ? Math.max(0, coins - toInt(getSettings().buy.coinsReserve)) : 0;
};

// Vérification par EA (cartes « concept », une requête) des cartes à acheter : attributs exacts
// (championnat, nation, club, postes, rareté, groupes) avant de dépenser quoi que ce soit.
// Résultat : { ok, entries } (entrées corrigées, mêmes clés et prix) ou { ok: false, error }.
export const verifyMarketCards = async (entries, { linkedTeam = (id) => id } = {}) => {
  if (!entries.length) {
    return { ok: true, entries: [], missing: [] };
  }
  const result = await searchConceptItems(entries.map((entry) => entry.definitionId));
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const byId = new Map();
  result.items.forEach((item) => {
    const id = Number(item && item.definitionId) || 0;
    if (id && !byId.has(id)) {
      byId.set(id, item);
    }
  });
  const missing = [];
  const verified = entries.map((entry) => {
    const item = byId.get(entry.definitionId);
    if (!item) {
      missing.push(entry);
      return entry;
    }
    const exact = entryFromItem(item, "market", { linkedTeam, priceOf: () => entry.price });
    return Object.assign({}, entry, {
      name: exact.name || entry.name,
      rating: exact.rating || entry.rating,
      tier: exact.tier || entry.tier,
      nationId: exact.nationId,
      leagueId: exact.leagueId,
      teamId: exact.teamId,
      clubId: exact.clubId,
      rareflag: exact.rareflag,
      groups: exact.groups,
      legend: exact.legend,
      hero: exact.hero,
      special: exact.special,
      positions: exact.positions.length ? exact.positions : entry.positions,
      preferredPosition: exact.positions.length ? exact.positions[0] : entry.preferredPosition,
      person: exact.person,
      verified: true,
      // Carte « concept » d'EA de cette version : posable dans l'équipe du défi avant l'achat.
      conceptItem: item.concept === true ? item : null,
    });
  });
  return { ok: true, entries: verified, missing };
};

const isDuplicate = (item) => {
  try {
    return typeof item.isDuplicate === "function" ? !!item.isDuplicate() : Number(item.duplicateId) > 0;
  } catch (e) {
    return false;
  }
};

// Carte achetée → club, ou stockage DCE si c'est un doublon (au club, EA l'échangerait avec la copie).
const keepForSbc = async (item) => {
  if (!isDuplicate(item)) {
    const moved = await moveItem(item, "CLUB");
    if (moved.ok) {
      return { pile: "club" };
    }
  }
  const stored = await moveItems([item], "STORAGE");
  if (stored.moved && stored.moved.length) {
    return { pile: "storage" };
  }
  return { pile: "", error: stored.error ? stored.error.label : t("solver.buyNotMoved") };
};

// Achète les cartes une par une. onUpdate(entry, state, note) : state = searching | bought | failed.
// Résultat : { bought: [{ entry, item, price, pile }], failed: [{ entry, reason }], spent, stopped, fatal }.
export const buyMarketCards = async (entries, { token, onUpdate = () => {} } = {}) => {
  const report = { bought: [], failed: [], spent: 0, stopped: "", fatal: null };
  const settings = getSettings();
  const margin = buyMargin();
  const reserve = toInt(settings.buy.coinsReserve);
  const untrack = entries.map((entry) => trackPrice(entry.definitionId, { name: entry.name, rating: entry.rating }, "hot"));
  try {
    // Prix FUTBIN récent pour chaque carte (au plus 30 s d'attente, la liste FUTBIN sert sinon).
    const deadline = Date.now() + PRICE_WAIT;
    while (entries.some((entry) => !referencePrice(entry)) && Date.now() < deadline && !token.cancelled) {
      await sleep(1000, token);
    }
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (token.cancelled) {
        report.stopped = t("solver.stopRequested");
        break;
      }
      const reference = referencePrice(entry);
      const ladder = reference ? ladderFor(reference, margin) : [];
      if (!ladder.length) {
        report.failed.push({ entry, reason: t("solver.buyNoPrice") });
        onUpdate(entry, "failed", t("solver.buyNoPrice"));
        continue;
      }
      const top = ladder[ladder.length - 1];
      const coins = getCoins();
      if (coins && coins - reserve < top) {
        report.stopped = reserve ? t("solver.buyReserve", { reserve: formatCoins(reserve) }) : t("solver.buyFunds");
        onUpdate(entry, "failed", report.stopped);
        break;
      }
      const job = {
        player: { eaId: entry.definitionId, name: entry.name, rating: entry.rating },
        manual: false,
        maxPrice: 0,
        frozenMax: top,
        ladder,
        wait: settings.sbc.wait,
        note: "",
      };
      onUpdate(entry, "searching", "");
      let outcome;
      try {
        outcome = await buyEntry(job, token, () => onUpdate(entry, "searching", job.note));
      } catch (e) {
        outcome = { ok: false };
        job.note = errorMessage(e);
      }
      if (outcome.fatal) {
        report.fatal = outcome.fatal;
        report.stopped = describeFatal(outcome.fatal);
        onUpdate(entry, "failed", report.stopped);
        log.error(t("solver.logBuyStopped", { reason: report.stopped }));
        break;
      }
      if (!outcome.ok) {
        const reason = token.cancelled ? t("solver.stopRequested") : job.note || t("solver.buyNoOffer");
        report.failed.push({ entry, reason });
        onUpdate(entry, "failed", reason);
        continue;
      }
      report.spent += outcome.price;
      log.buy(t("solver.logBought", { name: entry.name, rating: entry.rating, price: formatCoins(outcome.price) }));
      recordTransaction({ type: t("solver.txBuy"), name: entry.name, rating: entry.rating, price: outcome.price, filter: t("solver.txFilter") });
      updateState({ coins: getCoins() });
      const kept = await keepForSbc(outcome.item);
      report.bought.push({ entry, item: outcome.item, price: outcome.price, pile: kept.pile });
      onUpdate(entry, "bought", kept.pile ? t("solver.buyBought", { price: formatCoins(outcome.price) }) : `${t("solver.buyBought", { price: formatCoins(outcome.price) })} · ${kept.error}`);
      if (index < entries.length - 1 && !token.cancelled) {
        await sleep((pickSeconds(settings.sbc.wait, "S") || 4) * 1000, token);
      }
    }
  } finally {
    untrack.forEach((release) => release());
  }
  return report;
};
