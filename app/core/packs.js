import { plural, t } from "../i18n";
import { currentPrice, requestPrice } from "../prices/priceService";
import { sleep } from "./async";
import { log } from "./logger";
import {
  discardItems,
  fetchMyPacks,
  fetchUnassigned,
  isPileFull,
  markStoreDirty,
  moveItems,
  nameOf,
  openOwnedPack,
  pileCapacity,
  pileCount,
  redeemItem,
  refreshCoins,
} from "./market";
import { localize } from "./page";
import { formatCoins, toInt } from "./prices";
import { getSettings } from "./settings";

// Ouverture des packs possédés (« Mes packs ») et rangement des cartes non attribuées :
// - objets divers (pièces gratuites, boost, pack gratuit, jetons) → utilisés (bouton « Utiliser ») ;
// - doublons non échangeables → stockage DCE (si activé et s'il reste de la place) ;
// - doublons non échangeables qui ne vont pas en stockage (managers, objets de club…) → vente rapide
//   (réglable : laissés dans les non attribués) ;
// - joueurs échangeables valant au moins X pièces sur FUTBIN → liste des transferts ;
// - vente rapide des joueurs non échangeables jusqu'à une note (désactivée par défaut) ;
// - le reste → club (les doublons refusés par le club restent dans les non attribués).
// Les choix de joueurs restent dans les non attribués (à ouvrir soi-même). Aucun pack n'est acheté :
// seuls les packs déjà possédés sont ouverts.

const PRICE_WAIT = 20 * 1000;

const call = (target, method) => {
  try {
    return target && typeof target[method] === "function" ? target[method]() : undefined;
  } catch (e) {
    return undefined;
  }
};

export const packName = (pack) => {
  const key = pack && (pack.packName || pack.name);
  return (key && localize(key, "")) || (pack && pack.displayName) || t("tools.packFallback", { id: pack ? pack.id : "?" });
};

// Packs possédés regroupés par type : [{ id, name, count, tradable, packs }].
export const listOwnedPacks = async () => {
  const result = await fetchMyPacks();
  if (!result.ok) {
    return { ok: false, error: result.error, groups: [] };
  }
  const groups = new Map();
  result.packs.forEach((pack) => {
    if (pack.isPlayerPickPack) {
      return;
    }
    const key = String(pack.id);
    if (!groups.has(key)) {
      groups.set(key, { id: pack.id, name: packName(pack), count: 0, tradable: !!pack.tradable, packs: [] });
    }
    const group = groups.get(key);
    group.packs.push(pack);
    group.count += 1;
  });
  return { ok: true, groups: Array.from(groups.values()).sort((a, b) => b.count - a.count) };
};

const waitPrices = async (items, token, waitMs = PRICE_WAIT) => {
  const wanted = items.filter((item) => Number(item.definitionId));
  if (!wanted.length || !(waitMs > 0)) {
    return;
  }
  wanted.forEach((item) => requestPrice(Number(item.definitionId), { name: nameOf(item), rating: Number(item.rating) || 0 }));
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && !(token && token.cancelled)) {
    if (wanted.every((item) => currentPrice(Number(item.definitionId), 10 * 60 * 1000, "sell"))) {
      break;
    }
    await sleep(500, token);
  }
};

const isPlayer = (item) => !!call(item, "isPlayer");
const isDuplicate = (item) => !!call(item, "isDuplicate");
const isPlayerPick = (item) => !!call(item, "isPlayerPickItem");
const isMisc = (item) => !!call(item, "isMiscItem") && !isPlayerPick(item);
// EA (FC 27) : item.tradable ; la carte est non échangeable quand il vaut false.
const tradable = (item) => item.tradable !== false;
const storable = (item) => (typeof item.isStorable === "function" ? !!call(item, "isStorable") : !tradable(item));

// Destination de chaque carte d'après les règles : { redeem, storage, transfer, discard, club, left, picks }.
// Un doublon ne va jamais au club (EA l'échangerait avec la copie du club) : stockage DCE s'il est
// non échangeable, liste des transferts s'il est échangeable, vente rapide pour un doublon non
// échangeable qui n'est pas un joueur (règle untradeableDuplicates), sinon il reste dans les non attribués.
export const planRouting = (items, rules) => {
  const plan = { redeem: [], storage: [], transfer: [], discard: [], club: [], left: [], picks: [] };
  items.forEach((item) => {
    if (isPlayerPick(item)) {
      plan.picks.push(item);
      return;
    }
    if (isMisc(item)) {
      (rules.redeemMisc !== false ? plan.redeem : plan.left).push(item);
      return;
    }
    const player = isPlayer(item);
    const price = player ? currentPrice(Number(item.definitionId), 10 * 60 * 1000, "sell") : 0;
    const rating = Number(item.rating) || 0;
    const quickSell = player && !tradable(item) && rules.quickSellMaxRating > 0 && rating <= rules.quickSellMaxRating && !call(item, "isSpecial");
    if (isDuplicate(item)) {
      if (player && !tradable(item) && rules.duplicatesToStorage && storable(item)) {
        plan.storage.push(item);
      } else if (tradable(item)) {
        plan.transfer.push(item);
      } else if (quickSell || (!player && rules.untradeableDuplicates === "quickSell")) {
        plan.discard.push(item);
      } else {
        plan.left.push(item);
      }
      return;
    }
    if (player && tradable(item) && rules.toTransferMin > 0 && price >= rules.toTransferMin) {
      plan.transfer.push(item);
      return;
    }
    if (quickSell) {
      plan.discard.push(item);
      return;
    }
    plan.club.push(item);
  });
  return plan;
};

const packRules = () => {
  const packs = getSettings().packs || {};
  return {
    duplicatesToStorage: packs.duplicatesToStorage !== false,
    toTransferMin: Math.max(0, toInt(packs.toTransferMin)),
    quickSellMaxRating: Math.max(0, Math.min(99, toInt(packs.quickSellMaxRating))),
    redeemMisc: packs.redeemMisc !== false,
    untradeableDuplicates: packs.untradeableDuplicates === "leave" ? "leave" : "quickSell",
  };
};

// Place libre d'une pile (stockage DCE, liste des transferts) ; Infinity si la taille est inconnue.
const freeSpace = (pileName) => {
  const capacity = pileCapacity(pileName);
  return capacity > 0 ? Math.max(0, capacity - pileCount(pileName)) : Infinity;
};

// Range les cartes non attribuées (lues auprès d'EA : c'est cette lecture qui indique les doublons).
// Rapport : nombre de cartes réellement déplacées par destination, et cartes restées.
export const routeUnassigned = async ({ token = null, rules = packRules(), onLog = () => {}, priceWaitMs = PRICE_WAIT } = {}) => {
  const report = { redeemed: 0, storage: 0, transfer: 0, discard: 0, discardValue: 0, club: 0, left: 0, picks: 0, leftNames: [], error: "" };
  const result = await fetchUnassigned();
  if (!result.ok) {
    report.error = result.error.label;
    return report;
  }
  const list = result.items;
  if (!list.length) {
    return report;
  }
  // Prix FUTBIN utiles seulement pour la règle « échangeables → transferts dès X pièces ».
  if (rules.toTransferMin > 0) {
    await waitPrices(list.filter((item) => isPlayer(item) && tradable(item)), token, priceWaitMs);
  }
  const plan = planRouting(list, rules);
  const stay = (items) => {
    report.left += items.length;
    items.forEach((item) => {
      if (report.leftNames.length < 3) {
        report.leftNames.push(nameOf(item));
      }
    });
  };
  stay(plan.left);
  report.picks = plan.picks.length;
  // Objets divers utilisés un par un (1,5 s d'écart, comme à la main).
  for (const item of plan.redeem) {
    if (token && token.cancelled) {
      stay([item]);
      continue;
    }
    const used = await redeemItem(item);
    if (used.ok) {
      report.redeemed += 1;
    } else {
      stay([item]);
      report.error = used.error ? used.error.label : report.error;
    }
    await sleep(1500, token);
  }
  const move = async (bucket, pileName, key) => {
    if (!bucket.length || (token && token.cancelled)) {
      stay(bucket);
      return;
    }
    if (pileName !== "CLUB" && isPileFull(pileName)) {
      stay(bucket);
      return;
    }
    // Pas plus que la place libre de la pile : le reste reste dans les non attribués (nommé).
    const room = pileName === "CLUB" ? Infinity : freeSpace(pileName);
    const sent = bucket.slice(0, room === Infinity ? bucket.length : room);
    stay(bucket.slice(sent.length));
    if (!sent.length) {
      return;
    }
    const moved = await moveItems(sent, pileName);
    if (!moved.ok && !moved.moved.length) {
      stay(sent);
      report.error = moved.error ? moved.error.label : report.error;
      return;
    }
    report[key] += moved.moved.length;
    stay(moved.refused);
    await sleep(600, token);
  };
  await move(plan.storage, "STORAGE", "storage");
  await move(plan.transfer, "TRANSFER", "transfer");
  if (plan.discard.length && !(token && token.cancelled)) {
    const sold = await discardItems(plan.discard);
    if (sold.ok || sold.sold.length) {
      report.discard += sold.sold.length;
      report.discardValue += sold.sold.reduce((total, item) => total + (Number(item.discardValue) || 0), 0);
      stay(sold.refused);
    } else {
      stay(plan.discard);
      report.error = sold.error ? sold.error.label : report.error;
    }
    await sleep(600, token);
  } else {
    stay(plan.discard);
  }
  await move(plan.club, "CLUB", "club");
  onLog(report);
  return report;
};

export const routingSummary = (report) => {
  const parts = [];
  if (report.redeemed) {
    parts.push(t("tools.routeRedeemed", { n: report.redeemed }));
  }
  if (report.club) {
    parts.push(t("tools.routeClub", { n: report.club }));
  }
  if (report.transfer) {
    parts.push(t("tools.routeTransfer", { n: report.transfer }));
  }
  if (report.storage) {
    parts.push(t("tools.routeStorage", { n: report.storage }));
  }
  if (report.discard) {
    parts.push(t("tools.routeDiscard", { n: report.discard, coins: formatCoins(report.discardValue) }));
  }
  if (report.left) {
    parts.push(
      t("tools.routeLeft", { n: report.left }) + (report.leftNames && report.leftNames.length ? ` (${report.leftNames.join(", ")}${report.left > report.leftNames.length ? "…" : ""})` : "")
    );
  }
  if (report.picks) {
    parts.push(t("tools.routePicks", { n: report.picks }));
  }
  return parts.join(" · ") || t("tools.routeNothing");
};

// Message d'arrêt : cartes restées dans les non attribués (EA refuse d'ouvrir un pack sinon).
const leftMessage = (report) =>
  report.error ||
  t("tools.packsUnassignedFull", { n: report.left }) + (report.leftNames && report.leftNames.length ? ` : ${report.leftNames.join(", ")}${report.left > report.leftNames.length ? "…" : ""}` : "");

// Valeur d'un pack : prix FUTBIN des joueurs échangeables + vente rapide des autres cartes.
const packValue = (items) =>
  items.reduce((total, item) => {
    const price = isPlayer(item) && tradable(item) ? currentPrice(Number(item.definitionId), 10 * 60 * 1000, "sell") : 0;
    return total + (price || Number(item.discardValue) || 0);
  }, 0);

// Ouvre `count` packs d'un groupe, en rangeant les cartes après chaque pack.
export const openPacks = async (group, count, { token, onProgress = () => {}, priceWaitMs = PRICE_WAIT } = {}) => {
  const summary = { opened: 0, value: 0, best: null, stopped: "" };
  const wanted = Math.max(0, Math.min(toInt(count), group.packs.length, Math.max(1, toInt((getSettings().packs || {}).max) || 10)));
  // Les non attribués doivent être vides : EA refuse d'ouvrir un pack sinon.
  const before = await fetchUnassigned();
  if (before.ok && before.items.length) {
    const cleared = await routeUnassigned({ token, priceWaitMs });
    if (cleared.left || cleared.picks || cleared.error) {
      summary.stopped = cleared.picks && !cleared.left && !cleared.error ? t("tools.packsPicksPending", { n: cleared.picks }) : leftMessage(cleared);
      return summary;
    }
  }
  for (let index = 0; index < wanted; index += 1) {
    if (token && token.cancelled) {
      summary.stopped = t("tools.stopRequested");
      break;
    }
    const pack = group.packs[index];
    onProgress({ index, total: wanted, phase: "open" });
    const result = await openOwnedPack(pack);
    if (!result.ok) {
      summary.stopped = t("tools.packOpenFailed", { error: result.error.label });
      break;
    }
    summary.opened += 1;
    // Valeur du pack : prix FUTBIN des joueurs échangeables (attente limitée).
    await waitPrices(result.items.filter((item) => isPlayer(item) && tradable(item)), token, priceWaitMs);
    const value = packValue(result.items);
    summary.value += value;
    result.items
      .filter(isPlayer)
      .forEach((item) => {
        const price = tradable(item) ? currentPrice(Number(item.definitionId), 10 * 60 * 1000, "sell") : 0;
        if (!summary.best || price > summary.best.price || (!summary.best.price && Number(item.rating) > summary.best.rating)) {
          summary.best = { name: nameOf(item), rating: Number(item.rating) || 0, price };
        }
      });
    onProgress({ index, total: wanted, phase: "route", value });
    // Cartes relues dans les non attribués : la réponse de l'ouverture n'indique pas les doublons.
    const routed = await routeUnassigned({ token, priceWaitMs: 0 });
    log.info(
      t("tools.logPackOpened", {
        n: index + 1,
        total: wanted,
        name: group.name,
        value: formatCoins(value),
        route: routingSummary(routed),
      })
    );
    if (routed.left || routed.picks || routed.error) {
      summary.stopped = routed.picks && !routed.left && !routed.error ? t("tools.packsPicksPending", { n: routed.picks }) : leftMessage(routed);
      break;
    }
    if (index < wanted - 1) {
      await sleep(2500 + Math.random() * 1500, token);
    }
  }
  markStoreDirty();
  await refreshCoins();
  log.success(
    plural(summary.opened, "tools.logPacksDoneOne", "tools.logPacksDoneMany", {
      value: formatCoins(summary.value),
      best: summary.best ? `${summary.best.name} ${summary.best.rating}${summary.best.price ? ` (${formatCoins(summary.best.price)})` : ""}` : "—",
    })
  );
  return summary;
};
