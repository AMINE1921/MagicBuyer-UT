import { t } from "../i18n";
import { getItemScore } from "../prices/itemScores";
import { currentPrice, requestPrice } from "../prices/priceService";
import { observe, sleep } from "./async";
import { activeSquadItemIds, discardItems, fetchClubPage, fetchTransferList, moveItems, nameOf, pileCapacity } from "./market";
import { itemService, pageGlobal } from "./page";
import { toInt } from "./prices";

// Outils du club : export CSV avec prix FUTBIN, envoi groupé vers la liste des transferts,
// stockage DCE → club, vente rapide par note. Les joueurs de l'équipe active ne sont jamais
// déplacés ni vendus. Les actions irréversibles sont toujours précédées d'un aperçu.

const PAGE = 90;
const PRICE_AGE = 10 * 60 * 1000;

const call = (target, method) => {
  try {
    return target && typeof target[method] === "function" ? target[method]() : undefined;
  } catch (e) {
    return undefined;
  }
};

// Tous les joueurs du club (pages de 90, espacées).
export const loadClubPlayers = async ({ token = null, onProgress = () => {} } = {}) => {
  const items = [];
  const seen = new Set();
  for (let offset = 0; offset < 10000; offset += PAGE) {
    if (token && token.cancelled) {
      return { ok: false, cancelled: true, items };
    }
    const result = await fetchClubPage(offset, PAGE);
    if (!result.ok) {
      return { ok: false, error: result.error, items };
    }
    let added = 0;
    result.items.forEach((item) => {
      const key = String(item.id);
      if (!seen.has(key)) {
        seen.add(key);
        items.push(item);
        added += 1;
      }
    });
    onProgress(items.length);
    if (result.retrievedAll || result.items.length < PAGE || !added) {
      break;
    }
    await sleep(900 + Math.random() * 600, token);
  }
  return { ok: true, items: items.filter((item) => call(item, "isPlayer")) };
};

const staticName = (item) => nameOf(item);

const positionOf = (item) => {
  try {
    const names = pageGlobal("PlayerPosition");
    const value = item.preferredPosition;
    return (names && typeof names[value] === "string" && names[value]) || String(value == null ? "" : value);
  } catch (e) {
    return "";
  }
};

const csvCell = (value) => {
  const text = String(value == null ? "" : value);
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// Fichier CSV (séparateur « ; » pour Excel en français, « , » sinon).
export const clubCsv = (items, { squadIds = new Set(), separator = ";" } = {}) => {
  const header = [
    t("tools.csvName"),
    t("tools.csvRating"),
    t("tools.csvPosition"),
    t("tools.csvDefinitionId"),
    t("tools.csvTradable"),
    t("tools.csvFirstOwner"),
    t("tools.csvBoughtFor"),
    t("tools.csvFutbin"),
    t("tools.csvItemScore"),
    t("tools.csvQuickSell"),
    t("tools.csvInSquad"),
  ];
  const yes = t("tools.csvYes");
  const no = t("tools.csvNo");
  const rows = items.map((item) => {
    const id = Number(item.definitionId) || 0;
    const score = getItemScore(id);
    return [
      staticName(item),
      Number(item.rating) || "",
      positionOf(item),
      id,
      item.tradable === false ? no : yes,
      Number(item.owners) === 1 ? yes : no,
      Number(item.lastSalePrice) || "",
      currentPrice(id, 60 * 60 * 1000, "display") || "",
      score ? score.score : "",
      Number(item.discardValue) || "",
      squadIds.has(String(item.id)) ? yes : no,
    ]
      .map(csvCell)
      .join(separator);
  });
  return [header.map(csvCell).join(separator)].concat(rows).join("\n");
};

// Téléchargement d'un texte en fichier (dans le navigateur de l'utilisateur).
export const downloadText = (filename, text, type = "text/csv;charset=utf-8") => {
  const blob = new Blob(["﻿", text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1000);
};

// Demande les prix FUTBIN manquants et attend (au plus `waitMs`).
export const ensurePrices = async (items, { token = null, waitMs = 60000, onProgress = () => {} } = {}) => {
  const pending = items.filter((item) => !currentPrice(Number(item.definitionId), PRICE_AGE, "sell"));
  pending.forEach((item) => requestPrice(Number(item.definitionId), { name: staticName(item), rating: Number(item.rating) || 0 }));
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && !(token && token.cancelled)) {
    const missing = pending.filter((item) => !currentPrice(Number(item.definitionId), PRICE_AGE, "sell")).length;
    onProgress(pending.length - missing, pending.length);
    if (!missing) {
      break;
    }
    await sleep(1000, token);
  }
};

// Joueurs du club qui correspondent aux critères (hors équipe active).
// criteria : { minRating, maxRating, minPrice, maxPrice, tradable: true|false|null, excludeSpecial }
export const selectPlayers = (items, criteria, squadIds) =>
  items.filter((item) => {
    if (squadIds && squadIds.has(String(item.id))) {
      return false;
    }
    const rating = Number(item.rating) || 0;
    if (criteria.minRating && rating < criteria.minRating) {
      return false;
    }
    if (criteria.maxRating && rating > criteria.maxRating) {
      return false;
    }
    // EA (FC 27) : item.tradable (false = non échangeable).
    if (criteria.tradable === true && item.tradable === false) {
      return false;
    }
    if (criteria.tradable === false && item.tradable !== false) {
      return false;
    }
    if (criteria.excludeSpecial && call(item, "isSpecial")) {
      return false;
    }
    if (criteria.minPrice || criteria.maxPrice) {
      const price = currentPrice(Number(item.definitionId), PRICE_AGE, "sell");
      if (!price) {
        return false;
      }
      if (criteria.minPrice && price < criteria.minPrice) {
        return false;
      }
      if (criteria.maxPrice && price > criteria.maxPrice) {
        return false;
      }
    }
    return true;
  });

// Équipe active : { ok, ids }. Sans réponse d'EA, les outils s'arrêtent (jamais de vente d'un titulaire).
export const squadIds = () => activeSquadItemIds();

// Place libre dans la liste des transferts, d'après la liste relue auprès d'EA.
const transferRoom = async () => {
  const list = await fetchTransferList();
  if (!list.ok) {
    return { ok: false, error: list.error };
  }
  const capacity = pileCapacity("TRANSFER") || 100;
  return { ok: true, space: Math.max(0, capacity - list.items.length) };
};

// Envoi groupé vers la liste des transferts (dans la limite de la place restante).
export const sendToTransferList = async (items, { token = null } = {}) => {
  const report = { moved: 0, left: 0, error: "" };
  const eligible = items.filter((item) => item.tradable !== false);
  report.left = items.length - eligible.length;
  const room = await transferRoom();
  if (!room.ok) {
    report.left = items.length;
    report.error = room.error ? room.error.label : t("tools.errTransferFull");
    return report;
  }
  if (!room.space) {
    report.left = items.length;
    report.error = t("tools.errTransferFull");
    return report;
  }
  const chosen = eligible.slice(0, room.space);
  report.left += eligible.length - chosen.length;
  for (let index = 0; index < chosen.length; index += 30) {
    if (token && token.cancelled) {
      report.left += chosen.length - index;
      break;
    }
    const batch = chosen.slice(index, index + 30);
    const result = await moveItems(batch, "TRANSFER");
    report.moved += result.moved.length;
    report.left += result.refused.length;
    if (!result.ok && !result.moved.length) {
      report.left += chosen.length - index - batch.length;
      report.error = result.error ? result.error.label : "";
      break;
    }
    await sleep(800, token);
  }
  return report;
};

// Stockage DCE → club : seulement les cartes qui ne sont plus des doublons (sinon EA les échangerait
// avec la copie du club). Les doublons restent dans le stockage.
export const storageToClub = async ({ token = null } = {}) => {
  const svc = itemService();
  const report = { moved: 0, left: 0, error: "" };
  if (!svc || typeof svc.searchStorageItems !== "function") {
    report.error = t("tools.errStorage");
    return report;
  }
  const Dto = pageGlobal("UTSearchCriteriaDTO");
  let criteria;
  try {
    criteria = typeof Dto === "function" ? new Dto() : {};
  } catch (e) {
    criteria = {};
  }
  criteria.type = "player";
  criteria.count = 100;
  criteria.offset = 0;
  const response = await observe(svc.searchStorageItems(criteria), 15000);
  if (!response || !response.success) {
    report.error = t("tools.errStorage");
    return report;
  }
  const items = Array.from((response.response && response.response.items) || []);
  const free = items.filter((item) => !call(item, "isDuplicate"));
  report.left = items.length - free.length;
  if (!free.length || (token && token.cancelled)) {
    return report;
  }
  const result = await moveItems(free, "CLUB");
  report.moved = result.moved.length;
  report.left += result.refused.length;
  if (!result.ok && !result.moved.length) {
    report.error = result.error ? result.error.label : "";
  }
  return report;
};

// Vente rapide (irréversible) de la sélection, par lots. Seules les cartes confirmées par EA comptent.
export const quickSell = async (items, { token = null } = {}) => {
  const report = { sold: 0, coins: 0, left: 0, error: "" };
  for (let index = 0; index < items.length; index += 30) {
    if (token && token.cancelled) {
      report.left += items.length - index;
      break;
    }
    const batch = items.slice(index, index + 30);
    const result = await discardItems(batch);
    report.sold += result.sold.length;
    report.coins += result.sold.reduce((total, item) => total + (Number(item.discardValue) || 0), 0);
    report.left += result.refused.length;
    if (!result.ok && !result.sold.length) {
      report.left += items.length - index - batch.length;
      report.error = result.error ? result.error.label : "";
      break;
    }
    await sleep(900, token);
  }
  return report;
};

export const quickSellValue = (items) => items.reduce((total, item) => total + (Number(item.discardValue) || 0), 0);

export const futbinTotal = (items) =>
  items.reduce((total, item) => total + (currentPrice(Number(item.definitionId), PRICE_AGE, "sell") || 0), 0);

export const clampRating = (value) => Math.max(0, Math.min(99, toInt(value)));
