import { t } from "../i18n";
import { observe } from "./async";
import { classify } from "./errors";
import { errorMessage } from "./logger";
import { pageArrayOf, pageGlobal, repositories, services } from "./page";
import { sbcContext } from "./sbc";
import { pricePlatform } from "../prices/priceService";
import { buyMargin, verifyMarketCards } from "./sbcBuy";
import { DEFAULT_CHEM_PARAMS, FIELD_PLAYERS, buildView, compileChecks, evaluateView, localChemistry } from "./sbcEval";
import { chooseOutcome, loadMarketLists, marketEntries, marketPicksOf, marketQueries, rememberVerified } from "./sbcMarket";
import { buildPool, entryFromItem, isStopError, linkedTeamFn, loadPoolItems } from "./sbcPool";
import { failingSummary, readChallengeRequirements } from "./sbcRequirements";
import { solveSbc } from "./sbcSolver";
import { bumpStat } from "./state";
import { asBot } from "./usage";

// Équipe du défi affiché (écran UTSBCSquadOverviewViewController) : postes de la formation, briques,
// collectifs calculés par le calculateur du web app (UTSquadChemCalculatorUtils), note « à virgule »
// ou entière selon le réglage serveur d'EA, puis placement vérifié par EA (meetsRequirements) et
// enregistrement (services.SBC.saveChallenge). Le défi n'est jamais envoyé : c'est toujours
// l'utilisateur qui clique sur « Envoyer » dans le web app. Aucun achat.

const TOTAL_PLAYERS = 23;

const call = (target, method, ...args) => {
  try {
    return target && typeof target[method] === "function" ? target[method](...args) : undefined;
  } catch (e) {
    return undefined;
  }
};

const serverKey = (name) => {
  const repo = pageGlobal("UTServerSettingsRepository");
  return repo && repo.KEY ? repo.KEY[name] : undefined;
};

// Note d'équipe « à virgule » (enableFloatPointSquadRating) : vrai par défaut si illisible.
export const ratingIsFloat = () => {
  try {
    const key = serverKey("SQUAD_RATING_FLOAT_CALCULATION_ENABLED");
    const config = services() && services().Configuration;
    if (key !== undefined && config && typeof config.checkFeatureEnabled === "function") {
      return !!config.checkFeatureEnabled(key);
    }
  } catch (e) {}
  return true;
};

// Cartes non échangeables acceptées dans les défis (SBC_ALLOW_UNTRADEABLE) : vrai si illisible.
export const untradeablesAllowed = () => {
  try {
    const key = serverKey("SBC_ALLOW_UNTRADEABLE");
    const config = services() && services().Configuration;
    if (key !== undefined && config && typeof config.getFeatureSetting === "function") {
      const value = config.getFeatureSetting(key);
      return value === undefined || value === null ? true : !!value;
    }
  } catch (e) {}
  return true;
};

// Paliers de collectifs du web app (services.Chemistry.getParameter : 1 nation, 2 ligue, 3 club).
export const chemistryParams = () => {
  const ids = Object.assign({ NATION: 1, LEAGUE: 2, CLUB: 3 }, pageGlobal("ChemistryParamId") || {});
  const read = (id, fallback) => {
    try {
      const param = services().Chemistry.getParameter(id);
      const thresholds = Array.from((param && param.thresholds) || [])
        .map((threshold) => ({ requirement: Number(threshold.requirement), points: Number(threshold.points) }))
        .filter((threshold) => threshold.requirement > 0 && Number.isFinite(threshold.points));
      return thresholds.length ? { thresholds } : fallback;
    } catch (e) {
      return fallback;
    }
  };
  return {
    club: read(ids.CLUB, DEFAULT_CHEM_PARAMS.club),
    league: read(ids.LEAGUE, DEFAULT_CHEM_PARAMS.league),
    nation: read(ids.NATION, DEFAULT_CHEM_PARAMS.nation),
  };
};

// 11 postes du défi : { index, position (typeId EA), label, brick: false | "simple" | "custom", fixed, item }.
// Une brique personnalisée (joueur imposé par EA) compte pour les collectifs, pas pour les exigences.
export const readChallengeSlots = (squad) => {
  const formation = call(squad, "getFormation") || null;
  const linkedTeam = linkedTeamFn();
  const slots = [];
  for (let index = 0; index < FIELD_PLAYERS; index += 1) {
    const slot = call(squad, "getSlot", index);
    const position = formation ? call(formation, "getPosition", index) : null;
    const typeId = position && position.typeId != null ? Number(position.typeId) : Number(slot && slot.generalPosition);
    const custom = !!call(slot, "isCustomBrick");
    const brick = custom ? "custom" : call(slot, "isBrick") ? "simple" : false;
    const item = (slot && slot.item) || null;
    let fixed = null;
    if (custom && item) {
      fixed = entryFromItem(item, "brick", { linkedTeam, priceOf: () => 0 });
      fixed.key = `brick:${index}`;
    }
    slots.push({
      index,
      position: Number.isFinite(typeId) ? typeId : -1,
      label: String((position && position.typeName) || (slot && slot.generalPositionName) || ""),
      brick,
      fixed,
      item,
    });
  }
  return { formation, formationId: formation ? formation.id : null, slots };
};

// Contexte complet du défi affiché pour le solveur (null si l'écran d'équipe n'est pas ouvert).
export const readSolverContext = (ctrl) => {
  const ctx = sbcContext(ctrl);
  if (!ctx) {
    return null;
  }
  const { operation, requirements } = readChallengeRequirements(ctx.challenge);
  const { slots, formationId } = readChallengeSlots(ctx.squad);
  return Object.assign(ctx, {
    operation,
    requirements,
    slots,
    formationId,
    float: ratingIsFloat(),
    challengeId: String(ctx.challenge.id),
    name: String(ctx.challenge.name || ""),
  });
};

// ------------------------------------------------------------------ collectifs EA

const emptyItemFor = (squad) => {
  const Null = pageGlobal("UTNullItemEntity") || pageGlobal("UTItemEntity");
  try {
    if (typeof Null === "function") {
      return new Null();
    }
  } catch (e) {}
  for (let index = FIELD_PLAYERS; index < TOTAL_PLAYERS; index += 1) {
    const slot = call(squad, "getSlot", index);
    if (slot && slot.item && !call(slot.item, "isValid")) {
      return slot.item;
    }
  }
  return null;
};

// Fonction de collectifs (slots, bySlot) → { total, slots[11] } calculée par le web app lui-même
// (profils de rareté compris), ou null si le calculateur est indisponible.
export const eaChemistry = (squad) => {
  const formation = call(squad, "getFormation");
  if (!formation) {
    return null;
  }
  let calculator = squad && squad.chemCalculator;
  if (!calculator || typeof calculator.calculate !== "function") {
    try {
      const Calculator = pageGlobal("UTSquadChemCalculatorUtils");
      calculator = typeof Calculator === "function" ? new Calculator(services().Chemistry, repositories().TeamConfig) : null;
    } catch (e) {
      calculator = null;
    }
  }
  if (!calculator || typeof calculator.calculate !== "function") {
    return null;
  }
  let manager = null;
  try {
    manager = squad.getManager().item;
  } catch (e) {}
  const empty = emptyItemFor(squad);
  const original = [];
  for (let index = 0; index < FIELD_PLAYERS; index += 1) {
    const slot = call(squad, "getSlot", index);
    original.push(slot ? slot.item : null);
  }
  const chemistry = (slots, bySlot) => {
    // Brique simple : la carte d'EA du poste (sans effet) ; poste ouvert vide : carte vide.
    const items = bySlot.map((entry, index) => (entry && entry.item) || (slots[index] && slots[index].brick ? original[index] : empty) || empty);
    const result = calculator.calculate(formation, pageArrayOf(items), manager);
    const points = [];
    for (let index = 0; index < FIELD_PLAYERS; index += 1) {
      const slot = result.getSlotChemistry(index);
      points.push(Number(slot && slot.points) || 0);
    }
    const total = Number(result.chemistry);
    return { total: Number.isFinite(total) ? total : points.reduce((sum, value) => sum + value, 0), slots: points };
  };
  try {
    // Essai sur l'équipe actuelle : le calculateur doit répondre sans erreur.
    const probe = chemistry(
      original.map(() => ({ brick: false })),
      original.map((item) => (item && call(item, "isValid") ? { item } : null))
    );
    if (!probe || !Array.isArray(probe.slots)) {
      return null;
    }
  } catch (e) {
    return null;
  }
  return chemistry;
};

// ------------------------------------------------------------------ recherche complète

// Collectifs de l'équipe proposée (affichés même sans exigence de collectifs).
const fillChemistry = (ctx, result, chemistry) => {
  if (!result.squad.length || result.chemistry != null) {
    return;
  }
  try {
    const bySlot = new Array(FIELD_PLAYERS).fill(null);
    result.squad.forEach((pick) => {
      bySlot[pick.slot] = pick.entry;
    });
    const view = buildView(ctx.slots, bySlot, chemistry);
    result.chemistry = view.chem ? view.chem.total : null;
    result.squad.forEach((pick) => {
      pick.chemistry = view.chem ? view.chem.slots[pick.slot] || 0 : null;
    });
  } catch (e) {}
};

// Le marché vaut-il d'être regardé ? Équipe impossible avec le club, ou équipe du club qui utilise une
// carte échangeable de valeur (un achat moins cher pourrait la remplacer) ; jamais pour une équipe
// faite de non échangeables et de fourrage, qu'aucun achat ne battra.
export const worthMarket = (result) =>
  !!result &&
  result.reason !== "cancelled" &&
  result.reason !== "unsupported" &&
  result.reason !== "noSlots" &&
  (!result.feasible || result.squad.some((pick) => pick.entry && pick.entry.tradable && pick.entry.value >= 2000));

// Réserve (club + stockage) puis solveur ; avec le marché (réglage), listes FUTBIN des cartes utiles
// puis nouvelle recherche club + marché, retenue seulement si elle rend l'équipe possible ou fait
// nettement économiser. { ok, result, clubResult, outcome, pool, loaded, market } ou { ok: false, stage, … }.
export const solveChallenge = async (ctx, { rules = {}, token = null, onProgress = () => {}, force = false, solverOptions = {}, market = null } = {}) => {
  const useMarket = market == null ? rules.useMarket !== false && !rules.onlyUntradeables : !!market;
  const loaded = await loadPoolItems({
    token,
    onProgress,
    force,
    useStorage: rules.useStorage !== false,
    excludeActiveSquad: rules.excludeActiveSquad !== false,
  });
  if (!loaded.ok) {
    return Object.assign({ stage: "pool" }, loaded, { ok: false });
  }
  const linkedTeam = linkedTeamFn();
  const pool = buildPool(loaded.items, Object.assign({}, rules, { untradeableForbidden: !untradeablesAllowed() }), {
    squadIds: loaded.squadIds,
    linkedTeam,
    challengeId: ctx.challengeId,
  });
  onProgress({ phase: "solve", fraction: 0 });
  const live = eaChemistry(ctx.squad);
  const chemistry = live || localChemistry(chemistryParams());
  const budget = Number(solverOptions.timeBudgetMs) || 4000;
  const solve = (entries, part, ratio) =>
    solveSbc({
      requirements: ctx.requirements,
      operation: ctx.operation,
      slots: ctx.slots,
      pool: entries,
      chemistry,
      float: ctx.float,
      linkedTeam,
      token,
      onProgress: (progress) => onProgress(Object.assign({}, progress, { part })),
      options: Object.assign({}, solverOptions, { timeBudgetMs: Math.max(800, Math.round(budget * ratio)) }),
    });
  const clubResult = await solve(pool.entries, "club", useMarket ? 0.6 : 1);
  let outcome = { result: clubResult, market: false, reason: "club" };
  let marketInfo = null;
  if (useMarket && worthMarket(clubResult) && !(token && token.cancelled)) {
    const queries = marketQueries(ctx.requirements, { maxRating: rules.maxRating, needPool: clubResult.reason === "pool" });
    if (queries.length) {
      const lists = await loadMarketLists(queries, { token, onProgress });
      const platform = pricePlatform();
      const entries = lists.lists.length
        ? marketEntries(lists.lists, { platform, margin: buyMargin(), linkedTeam, rules, requirements: ctx.requirements })
        : [];
      marketInfo = { queries: queries.length, lists: lists.lists.length, entries: entries.length, blocked: !!lists.blocked, cancelled: !!lists.cancelled };
      if (entries.length && !(token && token.cancelled)) {
        const mixed = await solve(pool.entries.concat(entries), "market", 1);
        outcome = chooseOutcome(clubResult, mixed);
      }
    }
  }
  const result = outcome.result;
  fillChemistry(ctx, result, chemistry);
  if (clubResult !== result) {
    fillChemistry(ctx, clubResult, chemistry);
  }
  return { ok: true, result, clubResult, outcome, pool, loaded, market: marketInfo, chemistrySource: live ? "ea" : "local" };
};

// Équipe vue par l'évaluateur (exigences prises en charge seulement) : { feasible, evaluation }.
const judge = (ctx, bySlot, linkedTeam) => {
  const chemistry = eaChemistry(ctx.squad) || localChemistry(chemistryParams());
  const checks = compileChecks(ctx.requirements, { float: ctx.float, linkedTeam });
  const evaluation = evaluateView(checks, buildView(ctx.slots, bySlot, chemistry), { operation: ctx.operation, float: ctx.float });
  return { feasible: evaluation.full && evaluation.violation <= 1e-9, evaluation };
};

// Avant l'achat : cartes à acheter relues par EA (attributs exacts) et équipe réévaluée.
// { ok, result } (même équipe, cartes vérifiées) ou { ok: false, invalid, evaluation, entries } ou { ok: false, error }.
export const verifyPlan = async (ctx, result) => {
  const linkedTeam = linkedTeamFn();
  const picks = marketPicksOf(result);
  const verified = await verifyMarketCards(picks.map((pick) => pick.entry), { linkedTeam });
  if (!verified.ok) {
    return { ok: false, error: verified.error };
  }
  rememberVerified(verified.entries);
  const byKey = new Map(verified.entries.map((entry) => [entry.key, entry]));
  const squad = result.squad.map((pick) => (pick.entry && pick.entry.market ? Object.assign({}, pick, { entry: byKey.get(pick.entry.key) || pick.entry }) : pick));
  const bySlot = new Array(FIELD_PLAYERS).fill(null);
  squad.forEach((pick) => {
    bySlot[pick.slot] = pick.entry;
  });
  const verdict = judge(ctx, bySlot, linkedTeam);
  if (!verdict.feasible) {
    return { ok: false, invalid: true, evaluation: verdict.evaluation, entries: verified.entries, missing: verified.missing };
  }
  return { ok: true, result: Object.assign({}, result, { squad }), missing: verified.missing };
};

// Après l'achat : cartes achetées mises à la place des cartes « à acheter », équipe réévaluée avec
// leurs attributs réels. { ok, picks } (prête à placer) ou { ok: false, incomplete | invalid }.
export const squadAfterPurchase = (ctx, result, bought) => {
  const linkedTeam = linkedTeamFn();
  const byDefinition = new Map(bought.map((entry) => [Number(entry.entry.definitionId), entry]));
  const bySlot = new Array(FIELD_PLAYERS).fill(null);
  const picks = [];
  const missing = [];
  result.squad.forEach((pick) => {
    if (!pick.entry) {
      return;
    }
    if (pick.entry.market) {
      const got = byDefinition.get(Number(pick.entry.definitionId));
      if (!got) {
        missing.push(pick.entry);
        return;
      }
      const entry = entryFromItem(got.item, got.pile === "storage" ? "storage" : "club", { linkedTeam, priceOf: () => got.price });
      bySlot[pick.slot] = entry;
      picks.push({ slot: pick.slot, item: got.item, entry });
      return;
    }
    bySlot[pick.slot] = pick.entry;
    picks.push({ slot: pick.slot, item: pick.entry.item, entry: pick.entry });
  });
  if (missing.length) {
    return { ok: false, incomplete: true, missing };
  }
  const verdict = judge(ctx, bySlot, linkedTeam);
  return verdict.feasible ? { ok: true, picks, evaluation: verdict.evaluation } : { ok: false, invalid: true, evaluation: verdict.evaluation };
};

// ------------------------------------------------------------------ placement

const snapshot = (squad) => {
  const items = [];
  for (let index = 0; index < TOTAL_PLAYERS; index += 1) {
    const slot = call(squad, "getSlot", index);
    items.push(slot ? slot.item : null);
  }
  return items;
};

const clearSquad = (squad) => {
  if (typeof squad.removeAllItems === "function") {
    // true : le manager reste (aucun dans une équipe de défi).
    squad.removeAllItems(true);
    return;
  }
  for (let index = 0; index < TOTAL_PLAYERS; index += 1) {
    const slot = call(squad, "getSlot", index);
    if (slot && !call(slot, "isBrick") && call(slot, "isValid")) {
      squad.removeItemFromSlot(index);
    }
  }
};

// Remet l'équipe telle qu'elle était (rien n'a été enregistré).
const restore = (squad, items) => {
  try {
    clearSquad(squad);
    squad.setPlayers(pageArrayOf(items.map((item) => (item && call(item, "isValid") ? item : null))), true);
  } catch (e) {}
};

const requirementLabel = (req) => {
  const text = call(req, "buildString");
  return typeof text === "string" && text.trim() ? text.trim() : "";
};

// Cartes interdites dans un défi (prêt, évolution en cours) ; les joueurs concept, eux, sont permis
// dans une équipe enregistrée (EA refuse seulement l'envoi tant qu'il en reste).
const eligibleWithConcepts = (squad) => {
  for (let index = 0; index < FIELD_PLAYERS; index += 1) {
    const slot = call(squad, "getSlot", index);
    if (!slot || call(slot, "isBrick") || !call(slot, "isValid")) {
      continue;
    }
    if (call(slot.item, "isLimitedUse") || call(slot.item, "isEnrolledInAcademy")) {
      return false;
    }
  }
  return true;
};

// Contrôle par le web app de l'équipe placée : exigences (isRequirementMet), équipe complète,
// cartes acceptées dans un défi (prêts, évolutions en cours, concept refusés sauf allowConcept).
// partial : équipe volontairement incomplète (seules les cartes posées sont contrôlées).
export const verifyWithEa = (ctx, { allowConcept = false, partial = false } = {}) => {
  const { challenge, squad } = ctx;
  const full = call(squad, "isSquadFull");
  // Contrôle d'EA (isSBCSquadEligible, qui refuse aussi les concepts) + contrôle explicite des prêts et
  // des évolutions en cours, qui ne dépend pas d'EA.
  const eligible = allowConcept
    ? eligibleWithConcepts(squad)
    : call(squad, "isSBCSquadEligible") !== false && eligibleWithConcepts(squad);
  let met = null;
  try {
    met = typeof challenge.meetsRequirements === "function" ? !!challenge.meetsRequirements() : null;
  } catch (e) {
    met = null;
  }
  const failing = [];
  if (typeof challenge.isRequirementMet === "function") {
    Array.from(challenge.eligibilityRequirements || []).forEach((req, index) => {
      try {
        if (!challenge.isRequirementMet(req)) {
          failing.push(requirementLabel(req) || t("solver.requirementN", { n: index + 1 }));
        }
      } catch (e) {}
    });
  }
  if (full === false && !partial) {
    failing.unshift(t("solver.reqFull"));
  }
  if (eligible === false) {
    failing.unshift(t("solver.errIneligible"));
  }
  const ok = partial ? eligible !== false : met !== false && full !== false && eligible !== false;
  return { ok, met, full, eligible, failing };
};

// Enregistrement du défi (une requête EA, comptée comme les autres requêtes MagicBuyer).
export const saveChallenge = async (ctx) => {
  const svc = services();
  if (!svc || !svc.SBC || typeof svc.SBC.saveChallenge !== "function") {
    return { ok: false, error: { code: -1, kind: "other", label: t("solver.errNoSave") } };
  }
  let observable;
  try {
    observable = asBot(() => svc.SBC.saveChallenge(ctx.challenge));
  } catch (e) {
    return { ok: false, error: { code: -1, kind: "other", label: errorMessage(e) } };
  }
  bumpStat("requests");
  const response = await observe(observable, 15000);
  if (response && response.success) {
    try {
      ctx.ctrl.getView().updateChallenge(ctx.challenge);
    } catch (e) {}
    return { ok: true };
  }
  return { ok: false, error: classify(response) };
};

// Place l'équipe proposée dans le défi, la fait vérifier par EA puis l'enregistre.
// picks : [{ slot, item }]. Si EA refuse l'équipe, elle est remise comme avant et rien n'est enregistré.
// allowConcept : joueurs concept permis ; partial : équipe incomplète voulue (exigences non contrôlées).
export const placeSolution = async (ctx, picks, { formationId = null, allowConcept = false, partial = false } = {}) => {
  const { squad, challenge } = ctx;
  if (call(challenge, "hasExpired")) {
    return { ok: false, expired: true, message: t("solver.errExpired") };
  }
  const formation = call(squad, "getFormation");
  if (formationId != null && formation && formation.id !== formationId) {
    return { ok: false, formationChanged: true, message: t("solver.errFormationChanged") };
  }
  const before = snapshot(squad);
  try {
    clearSquad(squad);
    const target = new Array(TOTAL_PLAYERS).fill(null);
    picks.forEach(({ slot, item }) => {
      target[slot] = item;
    });
    squad.setPlayers(pageArrayOf(target), true);
  } catch (e) {
    restore(squad, before);
    return { ok: false, message: t("solver.errPlacement", { error: errorMessage(e) }) };
  }
  // EA ignore une carte en double (même joueur) : chaque carte doit être à son poste.
  const refused = picks.filter(({ slot, item }) => {
    const placed = call(squad, "getSlot", slot);
    return !placed || !placed.item || String(placed.item.id) !== String(item.id);
  });
  if (refused.length) {
    restore(squad, before);
    return { ok: false, message: t("solver.errRefusedCards", { n: refused.length }) };
  }
  const check = verifyWithEa(ctx, { allowConcept, partial });
  if (!check.ok) {
    restore(squad, before);
    return {
      ok: false,
      rejected: true,
      failing: check.failing,
      message: t("solver.errEaRejected", { failing: failingSummary(check.failing, 3) || t("solver.unknownRequirement") }),
    };
  }
  const saved = await saveChallenge(ctx);
  if (!saved.ok) {
    const error = saved.error || {};
    return {
      ok: false,
      saveFailed: true,
      stopped: isStopError(error),
      error,
      message: error.code > 0 ? t("solver.errNotSavedCode", { code: error.code }) : t("solver.errNotSaved"),
    };
  }
  return { ok: true, verified: check.met === true };
};

// Équipe du solveur avec des cartes à acheter : cartes possédées à leur poste, cartes à acheter posées
// en joueurs « concept » d'EA (version exacte, lue par searchConceptItems), puis un seul enregistrement,
// jamais d'envoi. EA refuse les concepts (placement, contrôle ou enregistrement) : repli sur les seules
// cartes possédées (équipe incomplète enregistrée) avec la raison.
// { ok, concept, fallback, count, reason, result } ou { ok: false, verify?, message, … }.
export const placeWithConcepts = async (ctx, result, { formationId = null } = {}) => {
  let plan = result;
  const unchecked = marketPicksOf(plan).filter((pick) => !(pick.entry.conceptItem && pick.entry.conceptItem.concept === true));
  if (unchecked.length) {
    const verified = await verifyPlan(ctx, plan);
    if (!verified.ok) {
      return Object.assign({}, verified, { ok: false, verify: true });
    }
    plan = verified.result;
  }
  const picks = plan.squad.filter((pick) => pick.entry);
  const owned = picks.filter((pick) => !pick.entry.market).map((pick) => ({ slot: pick.slot, item: pick.entry.item }));
  const market = picks.filter((pick) => pick.entry.market);
  const concepts = market
    .filter((pick) => pick.entry.conceptItem && pick.entry.conceptItem.concept === true)
    .map((pick) => ({ slot: pick.slot, item: pick.entry.conceptItem }));
  let reason = t("solver.conceptUnavailable");
  if (concepts.length === market.length) {
    const placed = await placeSolution(ctx, owned.concat(concepts), { formationId, allowConcept: true });
    if (placed.ok) {
      return { ok: true, concept: true, fallback: false, count: concepts.length, result: plan, verified: placed.verified };
    }
    // Arrêt EA (captcha, trop de requêtes…) ou formation / défi changés : pas de nouvel essai.
    if (placed.stopped || placed.formationChanged || placed.expired) {
      return placed;
    }
    reason = placed.message || reason;
  }
  const partial = await placeSolution(ctx, owned, { formationId, partial: true });
  if (!partial.ok) {
    return partial;
  }
  return { ok: true, concept: false, fallback: true, count: market.length, reason, result: plan, verified: false };
};
