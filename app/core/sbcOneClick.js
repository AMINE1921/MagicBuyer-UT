import { pricePlatform } from "../prices/priceService";
import { pageGlobal, services } from "./page";
import { buyMargin } from "./sbcBuy";
import { compileChecks } from "./sbcEval";
import { loadMarketLists, marketEntries, marketQueries } from "./sbcMarket";
import { costOf, entryFromItem, excludeReason, linkedTeamFn } from "./sbcPool";
import { readChallengeRequirements, SCOPE } from "./sbcRequirements";

// DCE « en un clic » de FC 27 (UTOneClickSBCWorkAreaViewController) : chaque carte a un score DCE
// (item.sbsScore) ; il faut atteindre le score du défi (scoreRequirement, la progression déjà envoyée
// est gardée dans submittedScore) avec au plus getSelectionLimit() cartes par envoi.
// - planOneClick (pur) : la sélection la moins chère qui atteint le score restant, dans la limite de
//   cartes, avec les exigences « au moins N cartes … » encore portées par le défi ;
// - adaptateur : cartes déjà chargées par l'écran d'EA (aucune requête MagicBuyer), sélection par
//   le modèle de vue d'EA (selectItem), rafraîchissement par le contrôleur d'EA. Jamais d'envoi :
//   c'est toujours l'utilisateur qui valide dans EA. Aucune méthode EA n'est enveloppée.

const MAX_STATES = 20000;
const MAX_TABLE = 12000000;
const EPSILON = 1e-9;

const call = (target, method, ...args) => {
  try {
    return target && typeof target[method] === "function" ? target[method](...args) : undefined;
  } catch (e) {
    return undefined;
  }
};

const gcd = (a, b) => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
};

const sum = (list, field) => list.reduce((total, entry) => total + entry[field], 0);

// Coût par point de score (puis le plus gros score) : l'ordre « rentable » des cartes.
const byRatio = (a, b) => a.cost / a.score - b.cost / b.score || b.score - a.score || a.cost - b.cost;

// Couverture au moindre coût (sac à dos 0/1 « au moins S ») : dp[s] = coût minimal pour un score ≥ s.
// penalty : coût ajouté par carte (Lagrangien, pour tenir la limite de cartes).
const coverOnce = (items, weights, states, penalty) => {
  const count = items.length;
  const dp = new Float64Array(states + 1).fill(Infinity);
  dp[0] = 0;
  const keep = new Uint8Array(count * (states + 1));
  for (let index = 0; index < count; index += 1) {
    const weight = weights[index];
    const cost = items[index].cost + penalty;
    const row = index * (states + 1);
    for (let s = states; s > 0; s -= 1) {
      const from = s > weight ? s - weight : 0;
      const value = dp[from] + cost;
      if (value < dp[s] - EPSILON) {
        dp[s] = value;
        keep[row + s] = 1;
      }
    }
  }
  if (!Number.isFinite(dp[states])) {
    return null;
  }
  const picks = [];
  let s = states;
  for (let index = count - 1; index >= 0 && s > 0; index -= 1) {
    if (keep[index * (states + 1) + s]) {
      picks.push(items[index]);
      s = s > weights[index] ? s - weights[index] : 0;
    }
  }
  return picks;
};

// Cartes les moins chères dont la somme des scores atteint target, au plus maxCount cartes.
const cover = (items, target, maxCount) => {
  if (target <= 0) {
    return [];
  }
  let list = items.slice();
  let step = list.reduce((value, entry) => gcd(value, entry.score), 0) || 1;
  let states = Math.ceil(target / step);
  let approximate = false;
  if (states > MAX_STATES) {
    // Objectif très grand : scores regroupés par paliers (arrondis vers le bas : jamais surestimés).
    step = Math.ceil(target / MAX_STATES);
    states = Math.ceil(target / step);
    approximate = true;
  }
  const cap = Math.max(maxCount, Math.floor(MAX_TABLE / (states + 1)));
  if (list.length > cap) {
    list = list.sort(byRatio).slice(0, cap);
  }
  const weights = list.map((entry) => Math.max(approximate ? 0 : 1, Math.floor(entry.score / step)));
  let picks = coverOnce(list, weights, states, 0);
  if (picks && picks.length > maxCount) {
    // Limite de cartes : pénalité par carte cherchée par dichotomie (moins de cartes, plus grosses).
    const maxCost = list.reduce((max, entry) => Math.max(max, entry.cost), 0);
    let low = 0;
    let high = maxCost * 4 + 100;
    let found = null;
    for (let round = 0; round < 22; round += 1) {
      const mid = (low + high) / 2;
      const attempt = coverOnce(list, weights, states, mid);
      if (attempt && attempt.length <= maxCount) {
        found = attempt;
        high = mid;
      } else {
        low = mid;
      }
    }
    picks = found;
  }
  if (!picks) {
    return null;
  }
  // Paliers arrondis : complète avec les cartes les plus rentables si le vrai score manque.
  const chosen = new Set(picks.map((entry) => entry.key));
  let score = sum(picks, "score");
  for (const entry of list.slice().sort(byRatio)) {
    if (score >= target || picks.length >= maxCount) {
      break;
    }
    if (!chosen.has(entry.key)) {
      picks.push(entry);
      chosen.add(entry.key);
      score += entry.score;
    }
  }
  return score >= target ? picks : null;
};

// Nettoyage : retire les cartes devenues inutiles, puis échange une carte contre une moins chère
// tant que le score reste atteint (et que les exigences « au moins » tiennent).
const improve = (picks, pool, target, rules) => {
  let current = picks.slice();
  const keyed = new Set(current.map((entry) => entry.key));
  const rulesHold = (list) => rules.every((rule) => list.filter(rule.test).length + rule.base >= rule.count);
  let changed = true;
  for (let round = 0; round < 50 && changed; round += 1) {
    changed = false;
    const score = sum(current, "score");
    const byCost = current.slice().sort((a, b) => b.cost - a.cost);
    for (const entry of byCost) {
      const without = current.filter((other) => other !== entry);
      if (score - entry.score >= target && rulesHold(without)) {
        current = without;
        keyed.delete(entry.key);
        changed = true;
        break;
      }
    }
    if (changed) {
      continue;
    }
    outer: for (const entry of byCost) {
      for (const other of pool) {
        if (other.cost >= entry.cost - EPSILON) {
          break;
        }
        if (keyed.has(other.key) || score - entry.score + other.score < target) {
          continue;
        }
        const next = current.map((item) => (item === entry ? other : item));
        if (rulesHold(next)) {
          current = next;
          keyed.delete(entry.key);
          keyed.add(other.key);
          changed = true;
          break outer;
        }
      }
    }
  }
  return current;
};

// Sélection la moins chère pour un DCE en un clic.
// candidates : entrées { key, score, cost, … } ; target : score restant ; limit : cartes encore
// sélectionnables ; minCounts / maxCounts : [{ test(entry), count, label }] ; preselected : cartes
// déjà sélectionnées (gardées, comptées dans les exigences).
// Résultat : { picks, score, cost, reached, partial, unmet: [labels], reason }.
export const planOneClick = ({ candidates = [], target = 0, limit = 0, minCounts = [], maxCounts = [], preselected = [] } = {}) => {
  const need = Math.max(0, Math.ceil(Number(target) || 0));
  const room = Math.max(0, Math.floor(Number(limit) || 0));
  const base = (extra) => Object.assign({ picks: [], score: 0, cost: 0, reached: need <= 0, partial: false, unmet: [], reason: "" }, extra);
  if (need <= 0) {
    return base({ reason: "done", reached: true });
  }
  if (!room) {
    return base({ reason: "limit" });
  }
  let pool = candidates.filter((entry) => entry && entry.score > 0 && Number.isFinite(entry.cost));
  // « Au plus N cartes … » : seules les N plus rentables de ces cartes restent candidates.
  maxCounts.forEach((rule) => {
    const already = preselected.filter(rule.test).length;
    const allowed = Math.max(0, rule.count - already);
    const keep = new Set(pool.filter(rule.test).sort(byRatio).slice(0, allowed).map((entry) => entry.key));
    pool = pool.filter((entry) => !rule.test(entry) || keep.has(entry.key));
  });
  pool.sort((a, b) => a.cost - b.cost || b.score - a.score);
  if (!pool.length) {
    return base({ reason: "empty" });
  }
  // « Au moins N cartes … » : les plus rentables qui remplissent chaque exigence sont prises d'abord.
  const locked = [];
  const lockedKeys = new Set();
  const unmet = [];
  const rules = minCounts.map((rule) => Object.assign({ base: preselected.filter(rule.test).length }, rule));
  rules.forEach((rule) => {
    let have = rule.base + locked.filter(rule.test).length;
    const options = pool.filter((entry) => !lockedKeys.has(entry.key) && rule.test(entry)).sort(byRatio);
    while (have < rule.count && options.length) {
      const entry = options.shift();
      locked.push(entry);
      lockedKeys.add(entry.key);
      have += 1;
    }
    if (have < rule.count) {
      unmet.push(rule.label || "");
    }
  });
  if (locked.length > room) {
    return base({ reason: "limit", unmet: unmet.concat(rules.map((rule) => rule.label || "")).filter(Boolean) });
  }
  const rest = pool.filter((entry) => !lockedKeys.has(entry.key));
  const freeRoom = room - locked.length;
  const remaining = need - sum(locked, "score");
  let picks;
  let partial = false;
  if (remaining <= 0) {
    picks = locked.slice();
  } else {
    const best = rest
      .map((entry) => entry.score)
      .sort((a, b) => b - a)
      .slice(0, freeRoom)
      .reduce((total, value) => total + value, 0);
    if (best < remaining) {
      // Score hors d'atteinte en un envoi (progression gardée par EA) : les cartes les plus rentables.
      picks = locked.concat(rest.slice().sort(byRatio).slice(0, freeRoom));
      partial = true;
    } else {
      const covered = cover(rest, remaining, freeRoom);
      picks = locked.concat(covered || rest.slice().sort((a, b) => b.score - a.score).slice(0, freeRoom));
    }
  }
  if (!partial) {
    picks = improve(picks, pool, need, rules);
  }
  const score = sum(picks, "score");
  return {
    picks,
    score,
    cost: sum(picks, "cost"),
    reached: score >= need,
    partial: partial || score < need,
    unmet: unmet.filter(Boolean),
    reason: unmet.length ? "rules" : partial || score < need ? "partial" : "",
  };
};

// Exigences du défi → règles de sélection : qualité (filtre), « au moins / au plus N cartes … ».
// Note d'équipe, collectifs, nombre de nations… n'ont pas de sens ici (liste notApplicable).
export const oneClickRules = (requirements, { linkedTeam = (id) => id } = {}) => {
  const filters = [];
  const minCounts = [];
  const maxCounts = [];
  const notApplicable = [];
  const applied = [];
  compileChecks(requirements, { linkedTeam }).forEach((check) => {
    if (check.kind === "quality") {
      filters.push((entry) => !check.bad(entry));
      applied.push(check.label);
    } else if (check.kind === "count" && check.match && check.target >= 0) {
      // Nombre absent (-1) : rien à imposer (EA filtre déjà les cartes admises dans le défi).
      const rule = { test: (entry) => check.match(entry) > 0, count: check.target, label: check.label };
      if ((check.scope === SCOPE.GREATER || check.scope === SCOPE.EXACT) && check.target > 0) {
        minCounts.push(rule);
      }
      if (check.scope === SCOPE.LOWER || check.scope === SCOPE.EXACT) {
        maxCounts.push(rule);
      }
      applied.push(check.label);
    } else {
      notApplicable.push(check.label);
    }
  });
  return { filters, minCounts, maxCounts, notApplicable, applied };
};

// ------------------------------------------------------------------ écran EA

const isWorkArea = (ctrl, Ctor) => {
  try {
    if (typeof Ctor === "function" && ctrl instanceof Ctor) {
      return true;
    }
  } catch (e) {}
  const vm = call(ctrl, "getViewModel");
  return !!(vm && typeof vm.selectItem === "function" && typeof vm.getSelectionLimit === "function" && typeof vm.autoSelectCurrentPage === "function");
};

// Contrôleur de l'écran « en un clic » affiché, trouvé en parcourant l'arbre des contrôleurs d'EA
// (enfants, contrôleur courant, fenêtre présentée) depuis la racine du web app.
export const findWorkAreaController = () => {
  let root = null;
  try {
    const getAppMain = pageGlobal("getAppMain");
    root = typeof getAppMain === "function" ? getAppMain().getRootViewController() : null;
  } catch (e) {
    root = null;
  }
  if (!root) {
    return null;
  }
  const Ctor = pageGlobal("UTOneClickSBCWorkAreaViewController");
  const stack = [root];
  const seen = new Set();
  for (let steps = 0; stack.length && steps < 600; steps += 1) {
    const ctrl = stack.pop();
    if (!ctrl || seen.has(ctrl)) {
      continue;
    }
    seen.add(ctrl);
    if (isWorkArea(ctrl, Ctor) && call(ctrl, "isViewDisplayed") !== false) {
      return ctrl;
    }
    try {
      Array.from(ctrl.childViewControllers || []).forEach((child) => stack.push(child));
    } catch (e) {}
    [ctrl.currentController, ctrl.workAreaController, call(ctrl, "getPresentedViewController")].forEach((next) => {
      if (next) {
        stack.push(next);
      }
    });
  }
  return null;
};

// Cartes déjà chargées par l'écran d'EA (tous onglets) : seules elles comptent dans le score sélectionné.
const loadedItems = (vm) => {
  const out = [];
  const seen = new Set();
  const tabOf = (id) => {
    try {
      return vm._itemTabMap && typeof vm._itemTabMap.get === "function" ? vm._itemTabMap.get(id) : null;
    } catch (e) {
      return null;
    }
  };
  const push = (item, tab) => {
    if (!item || item.id == null || seen.has(String(item.id))) {
      return;
    }
    seen.add(String(item.id));
    out.push({ item, tab: tab || tabOf(item.id) || "club" });
  };
  try {
    if (vm._itemEntityMap && typeof vm._itemEntityMap.forEach === "function") {
      vm._itemEntityMap.forEach((item, id) => push(item, tabOf(id)));
    }
  } catch (e) {}
  try {
    if (vm._tabStates && typeof vm._tabStates.forEach === "function") {
      vm._tabStates.forEach((state, tab) => Array.from((state && state.items) || []).forEach((item) => push(item, tab)));
    }
  } catch (e) {}
  Array.from(call(vm, "getCurrentPageItems") || []).forEach((item) => push(item, call(vm, "getActiveTab")));
  return out;
};

const scoreOf = (vm, item) => {
  try {
    if (vm._itemScoreMap && typeof vm._itemScoreMap.get === "function") {
      const value = vm._itemScoreMap.get(item.id);
      if (value != null) {
        return Number(value) || 0;
      }
    }
  } catch (e) {}
  return Number(item.sbsScore) || 0;
};

const inSquad = (item) => {
  try {
    const svc = services();
    return !!(svc && svc.SBC && typeof svc.SBC.isItemInSquad === "function" && svc.SBC.isItemInSquad(Number(item.id)));
  } catch (e) {
    return false;
  }
};

// État de l'écran « en un clic » et cartes candidates (avec motifs d'exclusion).
// rules : réglages du solveur (équipe active, évolués, favoris, non échangeables, stockage, note / prix max).
export const readWorkArea = (ctrl, rules = {}, { priceOf = null } = {}) => {
  const vm = call(ctrl, "getViewModel");
  const challenge = vm ? call(vm, "getChallenge") : null;
  if (!vm || !challenge) {
    return null;
  }
  const linkedTeam = linkedTeamFn();
  const selectedIds = new Set(Array.from(call(vm, "getSelectedItemIds") || []).map(String));
  const limit = Number(call(vm, "getSelectionLimit")) || 30;
  const required = Number(challenge.scoreRequirement) || 0;
  const submitted = Number(challenge.submittedScore) || 0;
  const selectedScore = Number(call(vm, "getSelectedScore")) || 0;
  const { requirements } = readChallengeRequirements(challenge);
  const derived = oneClickRules(requirements, { linkedTeam });
  const excluded = {};
  const candidates = [];
  const preselected = [];
  loadedItems(vm).forEach(({ item, tab }) => {
    const entry = entryFromItem(item, tab === "storage" ? "storage" : "club", { linkedTeam, priceOf });
    entry.score = scoreOf(vm, item);
    entry.tab = tab;
    entry.cost = costOf(entry, rules);
    if (selectedIds.has(entry.key)) {
      preselected.push(entry);
      return;
    }
    let reason = null;
    if (call(vm, "isItemSelectable", item) === false || !(entry.score > 0)) {
      reason = "unselectable";
    } else if (rules.excludeActiveSquad !== false && inSquad(item)) {
      reason = "squad";
    } else if (rules.useStorage === false && entry.source === "storage") {
      reason = "storage";
    } else if (!derived.filters.every((test) => test(entry))) {
      reason = "quality";
    } else {
      reason = excludeReason(entry, rules, { squadIds: null, consumedIds: null });
    }
    if (reason) {
      excluded[reason] = (excluded[reason] || 0) + 1;
      return;
    }
    candidates.push(entry);
  });
  return {
    ctrl,
    vm,
    challenge,
    requirements,
    name: String(challenge.name || ""),
    limit,
    selectedCount: selectedIds.size,
    selectedScore,
    required,
    submitted,
    remaining: Math.max(0, required - submitted - selectedScore),
    candidates,
    preselected,
    excluded,
    rules: derived,
    hasNextPage: call(vm, "hasNextPage") === true,
  };
};

// Plan pour l'écran lu par readWorkArea ; marketCandidates : cartes à acheter possibles (en plus).
export const planWorkArea = (area, marketCandidates = []) =>
  planOneClick({
    candidates: area.candidates.concat(marketCandidates),
    target: area.remaining,
    limit: Math.max(0, area.limit - area.selectedCount),
    minCounts: area.rules.minCounts,
    maxCounts: area.rules.maxCounts,
    preselected: area.preselected,
  });

// Cartes du marché pour atteindre le score quand le club ne suffit pas : listes FUTBIN des notes
// 84 à 88 (score FUTBIN de chaque carte, prix + marge DCE), mêmes filtres que les cartes du club.
export const oneClickMarket = async (area, rules = {}, { token = null, onProgress = () => {} } = {}) => {
  const queries = marketQueries(area.requirements || [], { maxRating: rules.maxRating, oneClick: true });
  if (!queries.length) {
    return { ok: false, entries: [] };
  }
  const lists = await loadMarketLists(queries, { token, onProgress });
  const entries = marketEntries(lists.lists, { platform: pricePlatform(), margin: buyMargin(), rules })
    .filter((entry) => entry.score > 0 && area.rules.filters.every((test) => test(entry)));
  return { ok: entries.length > 0, entries, blocked: !!lists.blocked, cancelled: !!lists.cancelled };
};

// Rafraîchit l'écran d'EA après un changement de sélection (page, compteurs, barre de score).
const refresh = (ctrl, vm) => {
  if (typeof ctrl._refreshCurrentPage === "function") {
    try {
      ctrl._refreshCurrentPage();
      return;
    } catch (e) {}
  }
  try {
    const view = ctrl.getView();
    Array.from(call(vm, "getCurrentPageItems") || []).forEach((item) => view.setItemSelected(item, !!call(vm, "isItemSelected", item)));
  } catch (e) {}
  call(ctrl, "_refreshSelectionControls");
};

// Sélectionne les cartes du plan dans l'écran d'EA (sélection seulement, rien n'est envoyé).
// Une carte refusée (non sélectionnable, limite atteinte) est ignorée et comptée.
export const applySelection = (area, picks) => {
  const { ctrl, vm } = area;
  const selected = [];
  const skipped = [];
  picks.forEach((entry) => {
    let ok = false;
    try {
      ok = vm.isItemSelectable(entry.item) !== false && vm.selectItem(entry.item) === true && vm.isItemSelected(entry.item) !== false;
    } catch (e) {
      ok = false;
    }
    (ok ? selected : skipped).push(entry);
  });
  refresh(ctrl, vm);
  return { selected, skipped, selectedScore: Number(call(vm, "getSelectedScore")) || 0 };
};

// Cartes achetées : ajoutées au modèle de vue d'EA comme ses propres lectures (carte, score, onglet),
// puis sélectionnées ; EA garde la main (isItemSelectable) sur ce qui est sélectionnable.
export const selectBought = (area, bought) => {
  const { vm } = area;
  const entries = bought.map(({ entry, item, pile }) => {
    try {
      if (vm._itemEntityMap && typeof vm._itemEntityMap.set === "function") {
        vm._itemEntityMap.set(item.id, item);
      }
      if (vm._itemScoreMap && typeof vm._itemScoreMap.set === "function") {
        vm._itemScoreMap.set(item.id, Number(item.sbsScore) || Number(entry.score) || 0);
      }
      if (vm._itemTabMap && typeof vm._itemTabMap.set === "function") {
        vm._itemTabMap.set(item.id, pile === "storage" ? "storage" : "club");
      }
    } catch (e) {}
    return Object.assign({}, entry, { item, key: String(item.id), market: false });
  });
  return applySelection(area, entries);
};

// Annule une sélection faite par MagicBuyer (cartes désélectionnées dans l'écran d'EA).
export const undoSelection = (area, entries) => {
  entries.forEach((entry) => call(area.vm, "deselectItem", entry.item));
  refresh(area.ctrl, area.vm);
};
