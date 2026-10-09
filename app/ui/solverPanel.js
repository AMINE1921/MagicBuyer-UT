import { errorMessage, log } from "../core/logger";
import { formatCoins, parseCoinsInput, toInt } from "../core/prices";
import { sbcContext } from "../core/sbc";
import { sleep } from "../core/async";
import { getCoins } from "../core/page";
import { conceptTargets, conceptTotal, plannedFor, rememberPlanned, replaceConcepts } from "../core/sbcConcepts";
import { requestPrice, trackPrice } from "../prices/priceService";
import { buyMarketCards, ladderFor, referencePrice, spendable } from "../core/sbcBuy";
import { marketPicksOf, marketTotal } from "../core/sbcMarket";
import { addToPool, consumedCount, invalidatePool, markConsumed, poolCacheInfo } from "../core/sbcPool";
import { applySelection, findWorkAreaController, oneClickMarket, planWorkArea, readWorkArea, selectBought, undoSelection } from "../core/sbcOneClick";
import { failingSummary, nameOfValue } from "../core/sbcRequirements";
import { placeSolution, placeWithConcepts, readSolverContext, solveChallenge, squadAfterPurchase, verifyPlan } from "../core/sbcSquad";
import { getSettings, setSetting } from "../core/settings";
import { endTask } from "../core/tasks";
import { startToolTask } from "../core/toolTask";
import { plural, t } from "../i18n";
import { escapeHtml, qs, qsa } from "./dom";
import { injectStyles } from "./panel";
import { visibleSbcController } from "./sbcPanel";

// Solveur DCE à partir du club : bouton « ⚡ Solveur club » sur l'écran d'équipe d'un défi (à côté de
// « ⚡ Solution FUTBIN »), fenêtre avec les exigences, les options, la recherche (lecture du club puis
// calcul local) et l'aperçu de l'équipe proposée. « Placer dans l'équipe » place les joueurs, fait
// vérifier l'équipe par EA puis l'enregistre : le défi n'est jamais envoyé (c'est toi qui cliques sur
// « Envoyer » dans EA) et rien n'est acheté.
// DCE « en un clic » (score à atteindre) : bouton « ⚡ Remplir au moins cher » sur l'écran de sélection
// d'EA, qui sélectionne les cartes les moins chères déjà chargées par EA (aucune requête, aucun envoi).
// Club insuffisant (ou marché moins cher) : cartes « à acheter » d'après les listes FUTBIN ; l'achat ne
// se fait qu'avec « Acheter les N manquants » puis la confirmation (prix, total, pièces restantes).

const STOP_EVENTS = ["pointerdown", "mousedown", "touchstart", "touchend", "mouseup", "pointerup"];
const OPTIONS = ["excludeActiveSquad", "excludeEvolved", "excludeFavorites", "useStorage", "preferStorage", "preferUntradeables", "onlyUntradeables", "useMarket"];
const SOLVE_BUDGET_MS = 5000;

let fab = null;
let modal = null;
let busy = null;
let session = null;
let lastStatusAt = 0;
let ocFab = null;
let ocBox = null;
let ocCtrl = null;
let ocLast = null;
let ocBusy = null;
let confirmBox = null;
let conceptFab = null;
let conceptBusy = null;
let noteBox = null;
const conceptTracked = new Map();

const solverSettings = () => getSettings().solver || {};

// Réglages du solveur → règles de la réserve (sbcPool.buildPool).
const solverRules = () => {
  const s = solverSettings();
  return {
    excludeActiveSquad: s.excludeActiveSquad !== false,
    excludeEvolved: s.excludeEvolved !== false,
    excludeFavorites: s.excludeFavorites !== false,
    onlyUntradeables: !!s.onlyUntradeables,
    preferUntradeables: s.preferUntradeables !== false,
    preferStorage: s.preferStorage !== false,
    useStorage: s.useStorage !== false,
    useMarket: s.useMarket !== false,
    maxRating: Math.max(0, Math.min(99, toInt(s.maxRating))),
    maxPrice: toInt(s.maxPrice),
  };
};

// --------------------------------------------------------------- bouton flottant

const paintFab = (button) => {
  const label = t("solver.fab");
  const title = t("solver.fabTitle");
  if (button.textContent !== label) {
    button.textContent = label;
  }
  if (button.title !== title) {
    button.title = title;
  }
};

const ensureFab = () => {
  if (fab && fab.isConnected) {
    return fab;
  }
  fab = document.createElement("button");
  fab.type = "button";
  fab.id = "mb-solver-fab";
  paintFab(fab);
  STOP_EVENTS.forEach((type) => fab.addEventListener(type, (event) => event.stopPropagation()));
  fab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openModal();
  });
  document.body.appendChild(fab);
  return fab;
};

const setStyle = (el, name, value) => {
  if (el.style[name] !== value) {
    el.style[name] = value;
  }
};

// À droite du bouton « Solution FUTBIN » (sinon à sa gauche, sinon sous la pastille de valeur).
const placeFab = (button) => {
  const other = document.getElementById("mb-sbc-fab");
  let left = "";
  let top = "";
  let transform = "";
  if (other && other.isConnected && !other.hidden) {
    const rect = other.getBoundingClientRect();
    if (rect.width > 0) {
      const width = button.offsetWidth || 140;
      const viewport = window.innerWidth || document.documentElement.clientWidth || 0;
      transform = "none";
      if (viewport - rect.right >= width + 16) {
        left = `${Math.round(rect.right + 8)}px`;
        top = `${Math.round(rect.top)}px`;
      } else if (rect.left >= width + 16) {
        left = `${Math.round(rect.left - 8 - width)}px`;
        top = `${Math.round(rect.top)}px`;
      } else {
        left = `${Math.round(Math.max(8, rect.left + rect.width / 2 - width / 2))}px`;
        top = `${Math.round(rect.bottom + 46)}px`;
      }
    }
  }
  setStyle(button, "left", left);
  setStyle(button, "top", top);
  setStyle(button, "transform", transform);
};

export const tickSolver = () => {
  tickOneClick();
  const ctrl = visibleSbcController();
  const visible = !!(ctrl && sbcContext(ctrl));
  if (!visible && !modal) {
    if (fab) {
      fab.hidden = true;
    }
    tickConcept(ctrl, false);
    return;
  }
  if (!document.body) {
    return;
  }
  injectStyles();
  const button = ensureFab();
  paintFab(button);
  button.hidden = !visible || !!modal || !!document.getElementById("mb-sbc");
  if (!button.hidden) {
    placeFab(button);
  }
  tickConcept(ctrl, visible);
};

// --------------------------------------------------------------- fenêtre

const optionLabel = (name) => t(`solver.opt_${name}`);

const optionsHtml = () => {
  const s = solverSettings();
  const checks = OPTIONS.map((name) => {
    const checked = name === "onlyUntradeables" ? !!s[name] : s[name] !== false;
    return `<label class="mb-sv-check" title="${escapeHtml(t(`solver.opt_${name}Hint`))}">
      <input type="checkbox" data-sv-opt="${name}" ${checked ? "checked" : ""} /><span>${escapeHtml(optionLabel(name))}</span></label>`;
  }).join("");
  const maxRating = toInt(s.maxRating);
  const maxPrice = toInt(s.maxPrice);
  return `<details class="mb-sv-options" data-sv-options>
    <summary>${escapeHtml(t("solver.options"))}</summary>
    <div class="mb-sv-grid">${checks}
      <label class="mb-sv-field"><span>${escapeHtml(t("solver.opt_maxRating"))}</span>
        <input data-sv-num="maxRating" inputmode="numeric" autocomplete="off" value="${maxRating || ""}" placeholder="${escapeHtml(t("solver.noLimit"))}" /></label>
      <label class="mb-sv-field"><span>${escapeHtml(t("solver.opt_maxPrice"))}</span>
        <input data-sv-num="maxPrice" inputmode="text" autocomplete="off" value="${maxPrice || ""}" placeholder="${escapeHtml(t("solver.noLimit"))}" /></label>
    </div>
  </details>`;
};

const modalHtml = (ctx) => `
  <div class="mb-sv-backdrop" data-sv-close></div>
  <div class="mb-sv-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(t("solver.dialogLabel"))}">
    <header class="mb-sv-head">
      <div><strong>${escapeHtml(t("solver.fab"))}</strong><small data-sv-name>${escapeHtml(ctx.name || t("solver.defaultChallenge"))}</small></div>
      <button type="button" class="mb-sv-x" data-sv-close aria-label="${escapeHtml(t("solver.close"))}">×</button>
    </header>
    <section class="mb-sv-top">
      <ul class="mb-sv-reqs" data-sv-reqs></ul>
      ${optionsHtml()}
      <div class="mb-sv-actions">
        <button type="button" class="mb-sv-btn is-primary" data-sv-solve>${escapeHtml(t("solver.solve"))}</button>
        <button type="button" class="mb-sv-btn" data-sv-reload title="${escapeHtml(t("solver.reloadHint"))}">${escapeHtml(t("solver.reload"))}</button>
        <button type="button" class="mb-sv-btn is-danger" data-sv-stop hidden>${escapeHtml(t("solver.stop"))}</button>
        <span class="mb-sv-cache" data-sv-cache></span>
      </div>
      <div class="mb-sv-progress" data-sv-progress hidden><span data-sv-bar></span></div>
      <p class="mb-sv-status" data-sv-status></p>
    </section>
    <div class="mb-sv-body" data-sv-body></div>
    <footer class="mb-sv-foot">
      <span class="mb-sv-summary" data-sv-summary></span>
      <button type="button" class="mb-sv-btn" data-sv-clubonly hidden title="${escapeHtml(t("solver.clubOnlyHint"))}">${escapeHtml(t("solver.clubOnly"))}</button>
      <button type="button" class="mb-sv-btn is-buy" data-sv-buy hidden></button>
      <button type="button" class="mb-sv-btn is-primary" data-sv-apply disabled>${escapeHtml(t("solver.apply"))}</button>
    </footer>
  </div>`;

const setStatus = (text, kind = "") => {
  if (!modal) {
    return;
  }
  const el = qs(modal, "[data-sv-status]");
  if (el.textContent !== text) {
    el.textContent = text;
  }
  el.dataset.kind = kind;
};

// Barre de progression : fraction 0..1, ou null pour une attente sans durée connue (lecture du club).
const setProgress = (fraction) => {
  if (!modal) {
    return;
  }
  const box = qs(modal, "[data-sv-progress]");
  const bar = qs(modal, "[data-sv-bar]");
  if (fraction === false) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.classList.toggle("is-busy", fraction == null);
  bar.style.width = fraction == null ? "" : `${Math.round(Math.max(0.03, Math.min(1, fraction)) * 100)}%`;
};

const renderCacheInfo = () => {
  if (!modal) {
    return;
  }
  const info = poolCacheInfo();
  const el = qs(modal, "[data-sv-cache]");
  el.textContent = info
    ? t("solver.cacheInfo", { players: formatCoins(info.players), minutes: Math.max(0, Math.floor(info.ageMs / 60000)) })
    : "";
};

const paintButtons = () => {
  if (!modal) {
    return;
  }
  const result = session && session.outcome ? session.outcome.result : null;
  // placed : true (équipe complète enregistrée) ou "concept" (cartes à acheter posées en concept).
  const placed = !!(session && session.placed === true);
  const toBuy = marketPicksOf(result);
  qs(modal, "[data-sv-solve]").disabled = !!busy;
  qs(modal, "[data-sv-reload]").disabled = !!busy;
  qs(modal, "[data-sv-stop]").hidden = !(busy && (busy.kind === "solve" || busy.kind === "buy"));
  // Cartes à acheter : placées en joueurs concept d'EA (achat ensuite, puis envoi par l'utilisateur).
  const applyButton = qs(modal, "[data-sv-apply]");
  applyButton.disabled = !!busy || !(result && result.feasible) || !!(session && session.placed);
  const applyLabel = toBuy.length ? plural(toBuy.length, "solver.applyConceptOne", "solver.applyConceptMany") : t("solver.apply");
  if (applyButton.textContent !== applyLabel) {
    applyButton.textContent = applyLabel;
  }
  // Marché proposé seulement parce qu'il est moins cher : l'équipe du club seul reste possible.
  const clubOnly = qs(modal, "[data-sv-clubonly]");
  const choice = session && session.outcome && session.outcome.outcome;
  clubOnly.hidden = !(choice && choice.reason === "cheaper" && toBuy.length && session.outcome.clubResult && session.outcome.clubResult.feasible) || placed;
  clubOnly.disabled = !!busy;
  const buy = qs(modal, "[data-sv-buy]");
  buy.hidden = !toBuy.length || placed;
  buy.disabled = !!busy || !(result && result.feasible);
  const label = toBuy.length
    ? plural(toBuy.length, "solver.buyButtonOne", "solver.buyButtonMany", { total: formatCoins(marketTotal(toBuy.map((pick) => pick.entry))) })
    : "";
  if (buy.textContent !== label) {
    buy.textContent = label;
  }
  qsa(modal, "[data-sv-opt], [data-sv-num]").forEach((input) => {
    input.disabled = !!busy;
  });
};

// Valeur affichée d'une exigence (note, collectifs, nombre de joueurs…).
const shownValue = (result) => {
  if (result.actual == null) {
    return "";
  }
  if (result.check.kind === "chemAll") {
    return `${result.actual}/${result.total}`;
  }
  if (result.check.kind === "quality") {
    return result.actual > 0 ? t(result.actual === 1 ? "solver.tierBronze" : result.actual === 2 ? "solver.tierSilver" : "solver.tierGold") : "—";
  }
  return String(result.actual);
};

const renderRequirements = () => {
  if (!modal || !session) {
    return;
  }
  const ctx = session.ctx;
  const evaluation = session.outcome && session.outcome.result ? session.outcome.result.evaluation : null;
  const results = evaluation ? evaluation.checks : null;
  const rows = ctx.requirements.map((req, index) => {
    const result = results ? results[index] : null;
    const state = !req.supported ? "is-na" : !result ? "" : result.met ? "is-ok" : "is-ko";
    const mark = !req.supported ? "?" : !result ? "•" : result.met ? "✓" : "✗";
    const title = !req.supported ? t("solver.unsupportedHint") : "";
    const value = result && req.supported ? `<b>${escapeHtml(shownValue(result))}</b>` : "";
    return `<li class="${state}" title="${escapeHtml(title)}"><span class="mb-sv-mark">${mark}</span><span>${escapeHtml(req.label)}</span>${value}</li>`;
  });
  const operation = ctx.operation === "OR" ? `<li class="mb-sv-or">${escapeHtml(t("solver.operationOr"))}</li>` : "";
  qs(modal, "[data-sv-reqs]").innerHTML = rows.length ? operation + rows.join("") : `<li>${escapeHtml(t("solver.noRequirements"))}</li>`;
};

const EXCLUDED_ORDER = ["squad", "placed", "loan", "academy", "evolved", "favorite", "tradable", "untradeable", "rating", "price", "storage", "concept"];

const poolSummary = (pool) => {
  const parts = EXCLUDED_ORDER.filter((reason) => pool.excluded[reason]).map((reason) =>
    t(`solver.excluded_${reason}`, { n: formatCoins(pool.excluded[reason]) })
  );
  const base = t("solver.poolSummary", { usable: formatCoins(pool.entries.length), total: formatCoins(pool.total) });
  return parts.length ? `${base} (${t("solver.excludedPrefix")} ${parts.join(", ")})` : base;
};

const chemDots = (points) => {
  if (points == null) {
    return "";
  }
  const value = Math.max(0, Math.min(3, points));
  return `<span class="mb-sv-chem" data-chem="${value}" title="${escapeHtml(t("solver.chemTitle", { n: value }))}">${"◆".repeat(value)}${"◇".repeat(3 - value)}</span>`;
};

const sourceText = (entry) => {
  if (entry.market) {
    return [t("solver.toBuy"), entry.version].filter(Boolean).join(" · ");
  }
  const parts = [t(entry.source === "storage" ? "solver.sourceStorage" : "solver.sourceClub")];
  if (entry.untradeable) {
    parts.push(t("solver.untradeable"));
  }
  return parts.join(" · ");
};

const valueText = (entry) => {
  if (entry.market) {
    return `<span class="mb-sv-price" title="${escapeHtml(t("solver.marketPriceHint"))}">≈ ${formatCoins(entry.price)}</span>`;
  }
  if (entry.untradeable) {
    return `<span class="mb-sv-dim" title="${escapeHtml(t("solver.untradeableValueHint"))}">${escapeHtml(t("solver.untradeableShort"))}</span>`;
  }
  return entry.estimated
    ? `<span title="${escapeHtml(t("solver.estimateHint"))}">≈ ${formatCoins(entry.value)}</span>`
    : formatCoins(entry.value);
};

const detailText = (entry) => {
  const known = (name) => (name && name[0] !== "#" ? name : "");
  const league = (entry.leagueId > 0 && known(nameOfValue("league", entry.leagueId))) || entry.leagueName || "";
  const nation = (entry.nationId > 0 && known(nameOfValue("nation", entry.nationId))) || entry.nationName || "";
  return [league, nation].filter(Boolean).join(" · ");
};

const playerRow = (pick, slot) => {
  const entry = pick.entry;
  const position = escapeHtml((slot && slot.label) || "—");
  if (!entry) {
    return `<tr class="is-empty"><td class="mb-sv-pos">${position}</td><td colspan="4">${escapeHtml(t("solver.emptySlot"))}</td></tr>`;
  }
  const off = pick.inPosition ? "" : ` <span class="mb-sv-off" title="${escapeHtml(t("solver.offPositionHint"))}">${escapeHtml(t("solver.offPosition"))}</span>`;
  const detail = detailText(entry);
  const classes = [pick.inPosition ? "" : "is-off", entry.market ? "is-market" : ""].filter(Boolean).join(" ");
  const source = entry.market
    ? `<span class="mb-sv-buy">${escapeHtml(sourceText(entry))}</span><small data-sv-note></small>`
    : escapeHtml(sourceText(entry));
  return `<tr class="${classes}" data-sv-key="${escapeHtml(entry.key)}">
    <td class="mb-sv-pos">${position}</td>
    <td><b>${escapeHtml(entry.name || `#${entry.definitionId}`)}</b> <span class="mb-sv-rating">${entry.rating}</span>${off}${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</td>
    <td class="mb-sv-src">${source}</td>
    <td class="is-num">${chemDots(pick.chemistry)}</td>
    <td class="is-num">${valueText(entry)}</td>
  </tr>`;
};

const brickRow = (slot) => {
  const name = slot.fixed ? `${slot.fixed.name} ${slot.fixed.rating || ""}`.trim() : "";
  return `<tr class="is-brick"><td class="mb-sv-pos">${escapeHtml(slot.label || "—")}</td><td colspan="4">${escapeHtml(
    name ? t("solver.customBrick", { name }) : t("solver.brick")
  )}</td></tr>`;
};

const renderResult = () => {
  if (!modal) {
    return;
  }
  const body = qs(modal, "[data-sv-body]");
  const summary = qs(modal, "[data-sv-summary]");
  const outcome = session && session.outcome;
  if (!outcome || !outcome.result || !outcome.result.squad.length) {
    body.innerHTML = outcome && outcome.pool ? `<p class="mb-sv-meta">${escapeHtml(poolSummary(outcome.pool))}</p>` : "";
    summary.textContent = "";
    paintButtons();
    return;
  }
  const { result, pool } = outcome;
  const slots = session.ctx.slots;
  const byIndex = new Map(result.squad.map((pick) => [pick.slot, pick]));
  const rows = slots.map((slot) => (slot.brick ? brickRow(slot) : playerRow(byIndex.get(slot.index) || { entry: null }, slot))).join("");
  const notes = [poolSummary(pool)];
  if (outcome.market && outcome.market.entries) {
    notes.push(t("solver.marketSummary", { n: formatCoins(outcome.market.entries) }));
  }
  if (outcome.market && outcome.market.blocked) {
    notes.push(t("solver.marketBlocked"));
  }
  if (outcome.chemistrySource === "local") {
    notes.push(t("solver.chemLocal"));
  }
  if (outcome.loaded && outcome.loaded.warning) {
    notes.push(outcome.loaded.warning);
  }
  body.innerHTML = `<p class="mb-sv-meta">${notes.map(escapeHtml).join(" · ")}</p>
    <table class="mb-sv-table">
      <thead><tr><th>${escapeHtml(t("solver.colPosition"))}</th><th>${escapeHtml(t("solver.colPlayer"))}</th><th class="mb-sv-src">${escapeHtml(
        t("solver.colSource")
      )}</th><th class="is-num">${escapeHtml(t("solver.colChem"))}</th><th class="is-num">${escapeHtml(t("solver.colValue"))}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  const players = result.squad.filter((pick) => pick.entry).map((pick) => pick.entry);
  const owned = players.filter((entry) => !entry.market);
  const toBuy = players.filter((entry) => entry.market);
  const untradeables = owned.filter((entry) => entry.untradeable).length;
  const tradeValue = owned.filter((entry) => !entry.untradeable).reduce((sum, entry) => sum + entry.value, 0);
  const estimated = owned.some((entry) => !entry.untradeable && entry.estimated);
  const parts = [t("solver.sumRating", { rating: result.rating })];
  if (result.chemistry != null) {
    parts.push(t("solver.sumChem", { chem: result.chemistry }));
  }
  parts.push(plural(untradeables, "solver.sumUntradeableOne", "solver.sumUntradeableMany"));
  if (owned.length > untradeables) {
    parts.push(t(estimated ? "solver.sumValueApprox" : "solver.sumValue", { value: formatCoins(tradeValue) }));
  }
  if (toBuy.length) {
    parts.push(plural(toBuy.length, "solver.sumToBuyOne", "solver.sumToBuyMany", { total: formatCoins(marketTotal(toBuy)) }));
  }
  summary.textContent = parts.join(" · ");
  paintButtons();
};

// --------------------------------------------------------------- recherche

const stopMessage = (error) => {
  const code = Number(error && error.code);
  if (code === 458 || (error && error.kind === "captcha")) {
    return t("solver.fatalCaptcha");
  }
  if (code === 401 || (error && error.kind === "auth")) {
    return t("solver.fatalAuth");
  }
  if (code === 429 || code === 426 || (error && error.kind === "rate")) {
    return t("solver.fatalRate");
  }
  if (code === 512 || code === 521 || (error && error.kind === "blocked")) {
    return t("solver.fatalBlocked");
  }
  return (error && error.label) || t("solver.errUnknown");
};

const onProgress = (progress) => {
  if (!modal) {
    return;
  }
  if (progress.phase === "squad") {
    setStatus(t("solver.statusSquad"));
    setProgress(null);
  } else if (progress.phase === "club") {
    setStatus(t("solver.statusClub", { page: progress.page, players: formatCoins(progress.players) }));
    setProgress(null);
  } else if (progress.phase === "storage") {
    setStatus(t("solver.statusStorage"));
    setProgress(null);
  } else if (progress.phase === "market") {
    setStatus(t("solver.statusMarket", { page: progress.page, pages: progress.pages }));
    setProgress(null);
  } else if (progress.phase === "solve") {
    const now = Date.now();
    if (now - lastStatusAt > 150 || !progress.fraction) {
      lastStatusAt = now;
      const key = progress.part === "market" ? "solver.statusSolvingMarket" : progress.feasible ? "solver.statusImproving" : "solver.statusSolving";
      setStatus(t(key, { pct: Math.round((progress.fraction || 0) * 100) }));
      setProgress(progress.fraction || 0);
    }
  }
};

const resultMessage = (outcome) => {
  const result = outcome.result;
  const slots = session.ctx.slots.filter((slot) => !slot.brick).length;
  const toBuy = marketPicksOf(result);
  if (toBuy.length && result.feasible) {
    const total = formatCoins(marketTotal(toBuy.map((pick) => pick.entry)));
    const choice = outcome.outcome || {};
    const text =
      choice.reason === "cheaper"
        ? plural(toBuy.length, "solver.statusMarketCheaperOne", "solver.statusMarketCheaperMany", { total, saving: formatCoins(choice.saving || 0) })
        : plural(toBuy.length, "solver.statusMarketNeededOne", "solver.statusMarketNeededMany", { total });
    return { text, kind: result.reason === "unsupported" ? "warn" : "ok" };
  }
  switch (result.reason) {
    case "":
      return { text: t("solver.statusFound"), kind: "ok" };
    case "unsupported":
      return {
        text: t("solver.statusUnsupported", { labels: failingSummary(result.unsupported.map((check) => check.label), 2) }),
        kind: "warn",
      };
    case "pool":
      return { text: t("solver.statusPoolSmall", { n: formatCoins(result.stats.pool), slots }), kind: "error" };
    case "noSlots":
      return { text: t("solver.statusNoSlots"), kind: "error" };
    case "cancelled":
      return result.feasible ? { text: t("solver.statusStoppedFound"), kind: "warn" } : { text: t("solver.statusStopped"), kind: "warn" };
    default:
      return {
        text: t("solver.statusNotFound", {
          failing: failingSummary(result.failing.filter((item) => item.supported).map((item) => item.label), 2) || t("solver.unknownRequirement"),
        }),
        kind: "error",
      };
  }
};

const solve = async (force = false) => {
  if (!modal || busy) {
    return;
  }
  const ctrl = visibleSbcController();
  const ctx = ctrl ? readSolverContext(ctrl) : null;
  if (!ctx) {
    setStatus(t("solver.errOpenSquad"), "error");
    return;
  }
  const { task, error } = startToolTask(t("solver.taskLabel"));
  if (!task) {
    setStatus(error, "warn");
    return;
  }
  busy = { task, kind: "solve" };
  session = { ctx, outcome: null, placed: false };
  qs(modal, "[data-sv-name]").textContent = ctx.name || t("solver.defaultChallenge");
  renderRequirements();
  renderResult();
  if (force) {
    invalidatePool();
  }
  setStatus(poolCacheInfo() ? t("solver.statusCached") : t("solver.statusLoading"));
  setProgress(null);
  try {
    const outcome = await solveChallenge(ctx, {
      rules: solverRules(),
      token: task.token,
      force,
      onProgress,
      solverOptions: { timeBudgetMs: SOLVE_BUDGET_MS },
    });
    if (!modal || !session || session.ctx !== ctx) {
      return;
    }
    if (!outcome.ok) {
      if (outcome.cancelled) {
        setStatus(t("solver.statusStopped"), "warn");
      } else if (outcome.stopped) {
        const text = stopMessage(outcome.error);
        setStatus(text, "error");
        log.error(t("solver.logStopped", { reason: text }));
      } else {
        setStatus(t("solver.errPool", { error: outcome.error ? outcome.error.label : t("solver.errUnknown") }), "error");
      }
      return;
    }
    session.outcome = outcome;
    renderRequirements();
    renderResult();
    const message = resultMessage(outcome);
    setStatus(message.text, message.kind);
  } catch (e) {
    setStatus(t("solver.statusError", { error: errorMessage(e) }), "error");
  } finally {
    endTask(task);
    busy = null;
    setProgress(false);
    renderCacheInfo();
    paintButtons();
  }
};

const apply = async () => {
  const result = session && session.outcome ? session.outcome.result : null;
  if (!modal || busy || !result || !result.feasible || session.placed) {
    return;
  }
  const ctrl = visibleSbcController();
  const ctx = ctrl ? readSolverContext(ctrl) : null;
  if (!ctx || ctx.challengeId !== session.ctx.challengeId) {
    setStatus(t("solver.errChallengeChanged"), "error");
    return;
  }
  const { task, error } = startToolTask(t("solver.taskPlace"));
  if (!task) {
    setStatus(error, "warn");
    return;
  }
  busy = { task, kind: "place" };
  paintButtons();
  setStatus(t("solver.statusPlacing"));
  try {
    if (marketPicksOf(result).length) {
      await applyWithConcepts(ctx, result);
      return;
    }
    const picks = result.squad.filter((pick) => pick.entry && pick.entry.item).map((pick) => ({ slot: pick.slot, item: pick.entry.item }));
    const placed = await placeSolution(ctx, picks, { formationId: session.ctx.formationId });
    if (!modal) {
      return;
    }
    if (placed.ok) {
      session.placed = true;
      markConsumed(
        result.squad.filter((pick) => pick.entry).map((pick) => pick.entry.key),
        ctx.challengeId
      );
      setStatus(t(placed.verified ? "solver.statusPlaced" : "solver.statusPlacedUnverified"), "ok");
      log.success(t("solver.logPlaced", { name: ctx.name || t("solver.defaultChallenge"), rating: result.rating }));
    } else {
      setStatus(placed.message, "error");
      if (placed.stopped) {
        log.error(t("solver.logStopped", { reason: stopMessage(placed.error) }));
      } else {
        log.warn(t("solver.logNotPlaced", { reason: placed.message }));
      }
    }
  } catch (e) {
    setStatus(t("solver.statusError", { error: errorMessage(e) }), "error");
  } finally {
    endTask(task);
    busy = null;
    paintButtons();
    renderCacheInfo();
  }
};

// Placement avec des cartes à acheter : cartes possédées à leur poste, cartes manquantes en joueurs
// concept d'EA, un enregistrement ; EA refuse les concepts : cartes possédées seules, raison affichée.
const applyWithConcepts = async (ctx, result) => {
  setStatus(t("solver.statusPlacingConcept"));
  const placed = await placeWithConcepts(ctx, result, { formationId: session.ctx.formationId });
  if (!modal || !session) {
    return;
  }
  if (!placed.ok) {
    if (placed.verify && placed.invalid) {
      const failing = placed.evaluation.checks.filter((item) => item.check.supported && !item.met).map((item) => item.check.label);
      setStatus(t("solver.statusVerifyInvalid", { failing: failingSummary(failing, 2) || t("solver.unknownRequirement") }), "error");
    } else if (placed.verify) {
      setStatus(t("solver.statusVerifyError", { error: (placed.error && placed.error.label) || t("solver.errUnknown") }), "error");
    } else {
      setStatus(placed.message, "error");
      log.warn(t("solver.logNotPlaced", { reason: placed.message }));
    }
    return;
  }
  session.outcome.result = placed.result;
  session.placed = "concept";
  renderResult();
  markConsumed(
    placed.result.squad.filter((pick) => pick.entry && !pick.entry.market).map((pick) => pick.entry.key),
    ctx.challengeId
  );
  if (placed.concept) {
    rememberPlanned(ctx.challengeId, marketPicksOf(placed.result).map((pick) => pick.entry));
    setStatus(plural(placed.count, "solver.statusPlacedConceptOne", "solver.statusPlacedConceptMany"), "ok");
    log.success(t("solver.logPlacedConcept", { name: ctx.name || t("solver.defaultChallenge"), n: placed.count }));
  } else {
    setStatus(plural(placed.count, "solver.statusPlacedFallbackOne", "solver.statusPlacedFallbackMany", { reason: placed.reason }), "warn");
    log.warn(t("solver.logPlacedFallback", { name: ctx.name || t("solver.defaultChallenge"), reason: placed.reason }));
  }
};

// --------------------------------------------------------------- achat des cartes manquantes

const closeBuyConfirm = () => {
  if (confirmBox) {
    confirmBox.remove();
    confirmBox = null;
  }
};

// Confirmation d'achat (DCE classique et en un clic) : chaque carte, prix FUTBIN, prix max d'achat
// (paliers jusqu'à la marge DCE), total, pièces avant / après, réserve. Rien n'est acheté sans « Confirmer ».
const openBuyConfirm = ({ entries, onConfirm, onCancel = () => {}, warning = "" }) => {
  closeBuyConfirm();
  injectStyles();
  const rows = entries.map((entry) => {
    const reference = referencePrice(entry) || entry.price || 0;
    const ladder = reference ? ladderFor(reference) : [];
    return { entry, reference, top: ladder.length ? ladder[ladder.length - 1] : reference };
  });
  const unknown = rows.filter((row) => !row.reference).length;
  const total = rows.reduce((sum, row) => sum + row.reference, 0);
  const max = rows.reduce((sum, row) => sum + row.top, 0);
  const coins = getCoins();
  const free = spendable();
  const reserve = toInt(getSettings().buy.coinsReserve);
  const tooPoor = !!coins && free < total;
  const tight = !!coins && !tooPoor && free < max;
  confirmBox = document.createElement("div");
  confirmBox.id = "mb-solver-buy";
  confirmBox.innerHTML = `
    <div class="mb-sv-backdrop" data-buy-no></div>
    <div class="mb-sv-dialog is-small" role="dialog" aria-modal="true" aria-label="${escapeHtml(t("solver.confirmTitle"))}">
      <header class="mb-sv-head">
        <div><strong>${escapeHtml(plural(entries.length, "solver.confirmHeadOne", "solver.confirmHeadMany"))}</strong><small>${escapeHtml(t("solver.confirmHint"))}</small></div>
        <button type="button" class="mb-sv-x" data-buy-no aria-label="${escapeHtml(t("solver.close"))}">×</button>
      </header>
      <div class="mb-sv-body">
        <table class="mb-sv-table">
          <thead><tr><th>${escapeHtml(t("solver.colPlayer"))}</th><th>${escapeHtml(t("solver.colVersion"))}</th><th class="is-num">${escapeHtml(t("solver.colFutbin"))}</th><th class="is-num">${escapeHtml(t("solver.colMax"))}</th></tr></thead>
          <tbody>${rows
            .map(
              (row) => `<tr><td><b>${escapeHtml(row.entry.name)}</b> <span class="mb-sv-rating">${row.entry.rating}</span></td><td>${escapeHtml(row.entry.version || "—")}</td><td class="is-num">${row.reference ? formatCoins(row.reference) : "—"}</td><td class="is-num">${row.top ? formatCoins(row.top) : "—"}</td></tr>`
            )
            .join("")}</tbody>
        </table>
        <p class="mb-sv-meta">${escapeHtml(
          [
            t("solver.confirmTotal", { total: formatCoins(total), max: formatCoins(max) }),
            coins ? t("solver.confirmCoins", { coins: formatCoins(coins), after: formatCoins(Math.max(0, coins - total)) }) : "",
            reserve ? t("solver.confirmReserve", { reserve: formatCoins(reserve) }) : "",
          ]
            .filter(Boolean)
            .join(" · ")
        )}</p>
        ${warning ? `<p class="mb-sv-status" data-kind="warn">${escapeHtml(warning)}</p>` : ""}
        ${unknown ? `<p class="mb-sv-status" data-kind="warn">${escapeHtml(plural(unknown, "solver.confirmUnknownOne", "solver.confirmUnknownMany"))}</p>` : ""}
        ${tooPoor ? `<p class="mb-sv-status" data-kind="error">${escapeHtml(t("solver.confirmTooPoor", { free: formatCoins(free) }))}</p>` : ""}
        ${tight ? `<p class="mb-sv-status" data-kind="warn">${escapeHtml(t("solver.confirmTight", { free: formatCoins(free) }))}</p>` : ""}
      </div>
      <footer class="mb-sv-foot">
        <span class="mb-sv-summary">${escapeHtml(t("solver.confirmSafety"))}</span>
        <button type="button" class="mb-sv-btn" data-buy-no>${escapeHtml(t("solver.cancel"))}</button>
        <button type="button" class="mb-sv-btn is-buy" data-buy-yes ${tooPoor ? "disabled" : ""}>${escapeHtml(t("solver.confirmBuy", { total: formatCoins(total) }))}</button>
      </footer>
    </div>`;
  STOP_EVENTS.concat(["keydown", "keyup"]).forEach((type) => confirmBox.addEventListener(type, (event) => event.stopPropagation()));
  confirmBox.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeBuyConfirm();
      onCancel();
    }
  });
  confirmBox.addEventListener("click", (event) => {
    if (event.target.closest("[data-buy-yes]")) {
      closeBuyConfirm();
      onConfirm();
    } else if (event.target.closest("[data-buy-no]")) {
      closeBuyConfirm();
      onCancel();
    }
  });
  document.body.appendChild(confirmBox);
  const cancel = qs(confirmBox, ".mb-sv-foot [data-buy-no]");
  if (cancel) {
    cancel.focus();
  }
};

const paintMarketRow = (entry, state, note) => {
  if (!modal) {
    return;
  }
  const row = qsa(modal, "[data-sv-key]").find((el) => el.dataset.svKey === entry.key);
  if (!row) {
    return;
  }
  row.dataset.state = state;
  const small = qs(row, "[data-sv-note]");
  if (small) {
    small.textContent = state === "searching" ? note || t("solver.buySearching") : note || "";
  }
};

const buySummary = (report, total) => {
  const parts = [t("solver.buyReport", { bought: report.bought.length, total, spent: formatCoins(report.spent) })];
  if (report.failed.length) {
    parts.push(plural(report.failed.length, "solver.buyFailedOne", "solver.buyFailedMany"));
  }
  if (report.stopped) {
    parts.push(t("solver.buyStopped", { reason: report.stopped }));
  }
  return `${parts.join(" · ")}.`;
};

// Achat puis placement (DCE classique) : cartes achetées mises à leur poste, équipe vérifiée par EA
// puis enregistrée. Le défi n'est jamais envoyé.
const runPurchase = async (entries) => {
  if (!modal || busy || !session || !session.outcome) {
    return;
  }
  const ctrl = visibleSbcController();
  const ctx = ctrl ? readSolverContext(ctrl) : null;
  if (!ctx || ctx.challengeId !== session.ctx.challengeId) {
    setStatus(t("solver.errChallengeChanged"), "error");
    return;
  }
  const { task, error } = startToolTask(t("solver.taskBuy"));
  if (!task) {
    setStatus(error, "warn");
    return;
  }
  busy = { task, kind: "buy" };
  paintButtons();
  setStatus(plural(entries.length, "solver.statusBuyingOne", "solver.statusBuyingMany"));
  const plan = session.outcome.result;
  let report;
  try {
    try {
      report = await buyMarketCards(entries, { token: task.token, onUpdate: paintMarketRow });
    } catch (e) {
      report = { bought: [], failed: [], spent: 0, stopped: errorMessage(e) };
    }
    addToPool(report.bought.map(({ item, pile }) => ({ item, pile })));
    const summary = buySummary(report, entries.length);
    log.info(t("solver.logBuyDone", { summary }));
    if (!modal || !session) {
      return;
    }
    if (report.bought.length !== entries.length) {
      setStatus(`${summary} ${t("solver.statusBuyIncomplete")}`, report.stopped ? "error" : "warn");
      return;
    }
    setStatus(`${summary} ${t("solver.statusPlacingBought")}`);
    const after = squadAfterPurchase(ctx, plan, report.bought);
    let picks = after.ok ? after.picks.map(({ slot, item }) => ({ slot, item })) : null;
    let rating = plan.rating;
    if (!picks) {
      // Attributs réels différents de ceux de FUTBIN : nouvelle recherche avec le club à jour
      // (cartes achetées comprises), sans marché, puis placement si l'équipe est valide.
      setStatus(`${summary} ${t("solver.statusResolving")}`);
      const again = await solveChallenge(ctx, { rules: solverRules(), token: task.token, market: false, solverOptions: { timeBudgetMs: SOLVE_BUDGET_MS } });
      if (!modal || !session) {
        return;
      }
      if (!again.ok || !again.result.feasible) {
        setStatus(`${summary} ${t("solver.statusAfterInvalid")}`, "warn");
        return;
      }
      session.outcome = again;
      renderRequirements();
      renderResult();
      picks = again.result.squad.filter((pick) => pick.entry && pick.entry.item).map((pick) => ({ slot: pick.slot, item: pick.entry.item }));
      rating = again.result.rating;
    }
    const placed = await placeSolution(ctx, picks, { formationId: session.ctx.formationId });
    if (!modal || !session) {
      return;
    }
    if (placed.ok) {
      session.placed = true;
      markConsumed(picks.map((pick) => String(pick.item.id)), ctx.challengeId);
      setStatus(`${summary} ${t(placed.verified ? "solver.statusPlaced" : "solver.statusPlacedUnverified")}`, "ok");
      log.success(t("solver.logPlaced", { name: ctx.name || t("solver.defaultChallenge"), rating }));
    } else {
      setStatus(`${summary} ${placed.message}`, "error");
    }
  } finally {
    endTask(task);
    busy = null;
    paintButtons();
    renderCacheInfo();
  }
};

// « Acheter les N manquants » : cartes relues par EA (attributs exacts, une requête), équipe
// réévaluée, puis confirmation. Une carte qui ne convient plus d'après EA arrête tout.
const buyMissing = async () => {
  const result = session && session.outcome ? session.outcome.result : null;
  if (!modal || busy || !result || !result.feasible || session.placed === true || !marketPicksOf(result).length) {
    return;
  }
  const ctrl = visibleSbcController();
  const ctx = ctrl ? readSolverContext(ctrl) : null;
  if (!ctx || ctx.challengeId !== session.ctx.challengeId) {
    setStatus(t("solver.errChallengeChanged"), "error");
    return;
  }
  const { task, error } = startToolTask(t("solver.taskVerify"));
  if (!task) {
    setStatus(error, "warn");
    return;
  }
  busy = { task, kind: "verify" };
  paintButtons();
  setStatus(t("solver.statusVerifying"));
  setProgress(null);
  let verified;
  try {
    verified = await verifyPlan(ctx, result);
  } catch (e) {
    verified = { ok: false, error: { label: errorMessage(e) } };
  } finally {
    endTask(task);
    busy = null;
    setProgress(false);
    paintButtons();
  }
  if (!modal || !session) {
    return;
  }
  if (!verified.ok) {
    if (verified.invalid) {
      const failing = verified.evaluation.checks.filter((item) => item.check.supported && !item.met).map((item) => item.check.label);
      setStatus(t("solver.statusVerifyInvalid", { failing: failingSummary(failing, 2) || t("solver.unknownRequirement") }), "error");
    } else {
      setStatus(t("solver.statusVerifyError", { error: (verified.error && verified.error.label) || t("solver.errUnknown") }), "error");
    }
    return;
  }
  if (verified.missing && verified.missing.length) {
    setStatus(t("solver.statusVerifyMissing", { names: failingSummary(verified.missing.map((entry) => `${entry.name} ${entry.rating}`), 3) }), "error");
    return;
  }
  session.outcome.result = verified.result;
  renderResult();
  const entries = marketPicksOf(verified.result).map((pick) => pick.entry);
  setStatus(t("solver.statusConfirm"));
  openBuyConfirm({ entries, onConfirm: () => runPurchase(entries), onCancel: () => setStatus(t("solver.statusBuyCancelled")) });
};

// --------------------------------------------------------------- ouverture / fermeture

const closeModal = () => {
  if (busy && (busy.kind === "place" || busy.kind === "buy" || busy.kind === "verify")) {
    setStatus(t(busy.kind === "buy" ? "solver.statusBusyBuy" : "solver.statusBusyPlace"), "warn");
    return;
  }
  closeBuyConfirm();
  if (busy) {
    // Recherche en cours : arrêtée (la lecture du club s'interrompt à la page suivante).
    busy.task.token.cancel();
  }
  if (modal) {
    modal.remove();
    modal = null;
  }
  session = null;
};

function onClick(event) {
  const target = event.target;
  if (target.closest("[data-sv-close]")) {
    closeModal();
  } else if (target.closest("[data-sv-solve]")) {
    solve(false);
  } else if (target.closest("[data-sv-reload]")) {
    solve(true);
  } else if (target.closest("[data-sv-stop]")) {
    if (busy) {
      busy.task.token.cancel();
      setStatus(t("solver.statusStopping"), "warn");
    }
  } else if (target.closest("[data-sv-apply]")) {
    apply();
  } else if (target.closest("[data-sv-buy]")) {
    buyMissing();
  } else if (target.closest("[data-sv-clubonly]")) {
    useClubOnly();
  }
}

// Revient à l'équipe faite uniquement avec le club (valide, sans achat).
const useClubOnly = () => {
  const outcome = session && session.outcome;
  if (!modal || busy || !outcome || !outcome.clubResult || !outcome.clubResult.feasible) {
    return;
  }
  outcome.result = outcome.clubResult;
  outcome.outcome = { result: outcome.clubResult, market: false, reason: "club" };
  renderRequirements();
  renderResult();
  setStatus(t("solver.statusClubOnly"), "ok");
};

function onChange(event) {
  const option = event.target.closest("[data-sv-opt]");
  if (option) {
    setSetting(`solver.${option.dataset.svOpt}`, !!option.checked);
    return;
  }
  const number = event.target.closest("[data-sv-num]");
  if (number) {
    const name = number.dataset.svNum;
    const value = name === "maxPrice" ? parseCoinsInput(number.value) : Math.max(0, Math.min(99, toInt(number.value)));
    setSetting(`solver.${name}`, value);
    number.value = value ? String(value) : "";
  }
}

const openModal = () => {
  if (modal) {
    return;
  }
  const ctrl = visibleSbcController();
  const ctx = ctrl ? readSolverContext(ctrl) : null;
  if (!ctx) {
    return;
  }
  injectStyles();
  modal = document.createElement("div");
  modal.id = "mb-solver";
  modal.innerHTML = modalHtml(ctx);
  STOP_EVENTS.concat(["keydown", "keyup"]).forEach((type) => modal.addEventListener(type, (event) => event.stopPropagation()));
  modal.addEventListener("click", onClick);
  modal.addEventListener("change", onChange);
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    } else if (event.key === "Enter" && event.target.matches("[data-sv-num]")) {
      event.target.blur();
    }
  });
  document.body.appendChild(modal);
  session = { ctx, outcome: null, placed: false };
  renderRequirements();
  renderResult();
  renderCacheInfo();
  const placedElsewhere = consumedCount();
  setStatus(placedElsewhere ? t("solver.statusIntroPlaced", { n: placedElsewhere }) : t("solver.statusIntro"));
  if (fab) {
    fab.hidden = true;
  }
  qs(modal, "[data-sv-solve]").focus();
};

export const closeSolverModal = () => closeModal();

// --------------------------------------------------------------- joueurs concept de l'équipe du défi

const closeNote = () => {
  if (noteBox && !conceptBusy) {
    noteBox.remove();
    noteBox = null;
  }
};

// Message sous les boutons de l'écran d'équipe (achat des joueurs concept), avec Stop pendant l'achat.
const showNote = (text, kind = "", { stop = false } = {}) => {
  if (!noteBox || !noteBox.isConnected) {
    noteBox = document.createElement("div");
    noteBox.id = "mb-solver-note";
    STOP_EVENTS.forEach((type) => noteBox.addEventListener(type, (event) => event.stopPropagation()));
    noteBox.addEventListener("click", (event) => {
      const button = event.target.closest("[data-note]");
      if (!button) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.note === "stop" && conceptBusy) {
        conceptBusy.token.cancel();
      } else if (button.dataset.note === "close") {
        closeNote();
      }
    });
    document.body.appendChild(noteBox);
  }
  noteBox.dataset.kind = kind;
  noteBox.innerHTML = `<span>${escapeHtml(text)}</span>${
    stop
      ? `<button type="button" class="is-danger" data-note="stop">${escapeHtml(t("solver.stop"))}</button>`
      : `<button type="button" data-note="close" aria-label="${escapeHtml(t("solver.close"))}">×</button>`
  }`;
};

// Prix FUTBIN suivis pour les joueurs concept affichés (libellé du bouton tenu à jour).
const trackConceptPrices = (targets) => {
  const wanted = new Set(targets.map((entry) => entry.definitionId));
  conceptTracked.forEach((release, id) => {
    if (!wanted.has(id)) {
      release();
      conceptTracked.delete(id);
    }
  });
  targets.forEach((entry) => {
    if (!conceptTracked.has(entry.definitionId)) {
      conceptTracked.set(entry.definitionId, trackPrice(entry.definitionId, { name: entry.name, rating: entry.rating }, "visible"));
    }
  });
};

const releaseConceptPrices = () => {
  conceptTracked.forEach((release) => release());
  conceptTracked.clear();
};

const conceptLabel = (targets) => {
  const { total, unknown } = conceptTotal(targets);
  return plural(targets.length, "solver.conceptBuyOne", "solver.conceptBuyMany", { total: `${formatCoins(total)}${unknown ? "+" : ""}` });
};

// À droite du bouton « Solveur club », sinon dessous.
const placeNextTo = (button, anchor) => {
  let left = "";
  let top = "";
  let transform = "";
  if (anchor && anchor.isConnected && !anchor.hidden) {
    const rect = anchor.getBoundingClientRect();
    if (rect.width > 0) {
      const width = button.offsetWidth || 220;
      const viewport = window.innerWidth || document.documentElement.clientWidth || 0;
      transform = "none";
      if (viewport - rect.right >= width + 16) {
        left = `${Math.round(rect.right + 8)}px`;
        top = `${Math.round(rect.top)}px`;
      } else {
        left = `${Math.round(Math.max(8, Math.min(viewport - width - 8, rect.left)))}px`;
        top = `${Math.round(rect.bottom + 8)}px`;
      }
    }
  }
  setStyle(button, "left", left);
  setStyle(button, "top", top);
  setStyle(button, "transform", transform);
};

const ensureConceptFab = () => {
  if (conceptFab && conceptFab.isConnected) {
    return conceptFab;
  }
  conceptFab = document.createElement("button");
  conceptFab.type = "button";
  conceptFab.id = "mb-solver-concept";
  STOP_EVENTS.forEach((type) => conceptFab.addEventListener(type, (event) => event.stopPropagation()));
  conceptFab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    buyConceptPlayers().catch((e) => showNote(t("solver.statusError", { error: errorMessage(e) }), "error"));
  });
  document.body.appendChild(conceptFab);
  return conceptFab;
};

// Bouton « Acheter les N joueurs concept » : visible quand l'équipe du défi affiché contient des
// joueurs concept (posés par le solveur ou à la main), jamais pendant une fenêtre ou un achat.
const tickConcept = (ctrl, visible) => {
  const blocked = !visible || !!modal || !!document.getElementById("mb-sbc") || !!confirmBox || !!conceptBusy;
  const ctx = blocked ? null : sbcContext(ctrl);
  const targets = ctx ? conceptTargets(ctx.squad, { known: plannedFor(String(ctx.challenge.id)) }) : [];
  if (!targets.length) {
    if (conceptFab) {
      conceptFab.hidden = true;
    }
    if (!conceptBusy) {
      releaseConceptPrices();
    }
    return;
  }
  trackConceptPrices(targets);
  const button = ensureConceptFab();
  const label = conceptLabel(targets);
  if (button.textContent !== label) {
    button.textContent = label;
  }
  const title = t("solver.conceptBuyTitle");
  if (button.title !== title) {
    button.title = title;
  }
  button.hidden = false;
  placeNextTo(button, document.getElementById("mb-solver-fab"));
};

// Achat puis remplacement des concepts : même machinerie que les autres achats (paliers, réserve,
// codes d'arrêt), contrôle EA (meetsRequirements) et un enregistrement. Jamais d'envoi.
const runConceptPurchase = async (targets) => {
  const ctrl = visibleSbcController();
  const ctx = ctrl ? readSolverContext(ctrl) : null;
  if (!ctx) {
    showNote(t("solver.errOpenSquad"), "error");
    return;
  }
  const { task, error } = startToolTask(t("solver.taskBuy"));
  if (!task) {
    showNote(error, "warn");
    return;
  }
  conceptBusy = task;
  if (conceptFab) {
    conceptFab.hidden = true;
  }
  showNote(plural(targets.length, "solver.statusBuyingOne", "solver.statusBuyingMany"), "", { stop: true });
  try {
    let report;
    try {
      report = await buyMarketCards(targets, {
        token: task.token,
        onUpdate: (entry, state, note) =>
          showNote(`${entry.name} ${entry.rating} · ${state === "searching" ? note || t("solver.buySearching") : note}`, "", { stop: true }),
      });
    } catch (e) {
      report = { bought: [], failed: [], spent: 0, stopped: errorMessage(e) };
    }
    addToPool(report.bought.map(({ item, pile }) => ({ item, pile })));
    const summary = buySummary(report, targets.length);
    log.info(t("solver.logBuyDone", { summary }));
    if (!report.bought.length) {
      showNote(summary, report.stopped ? "error" : "warn");
      return;
    }
    const fresh = visibleSbcController();
    const now = fresh ? readSolverContext(fresh) : null;
    if (!now || now.challengeId !== ctx.challengeId) {
      showNote(`${summary} ${t("solver.conceptReopen")}`, "warn");
      return;
    }
    const placed = await replaceConcepts(now, report.bought);
    if (placed.ok) {
      markConsumed(placed.replaced.map(({ item }) => String(item.id)), now.challengeId);
      const text = placed.remaining
        ? plural(placed.remaining, "solver.conceptSavedLeftOne", "solver.conceptSavedLeftMany")
        : t(placed.verified ? "solver.conceptSaved" : "solver.conceptSavedUnverified");
      showNote(`${summary} ${text}`, placed.remaining || report.failed.length || report.stopped ? "warn" : "ok");
      log.success(t("solver.logConceptDone", { n: placed.replaced.length, name: now.name || t("solver.defaultChallenge") }));
    } else {
      showNote(`${summary} ${placed.message}`, "error");
      log.warn(t("solver.logNotPlaced", { reason: placed.message }));
    }
  } finally {
    conceptBusy = null;
    endTask(task);
  }
};

const buyConceptPlayers = async () => {
  if (conceptBusy || busy || confirmBox) {
    return;
  }
  const ctrl = visibleSbcController();
  const ctx = ctrl ? readSolverContext(ctrl) : null;
  if (!ctx) {
    return;
  }
  const read = () => conceptTargets(ctx.squad, { known: plannedFor(ctx.challengeId) });
  let targets = read();
  if (!targets.length) {
    return;
  }
  // Prix FUTBIN manquants (joueurs ajoutés à la main) : lus avant la confirmation, 15 s au plus.
  const unknown = targets.filter((entry) => !(entry.price > 0));
  if (unknown.length) {
    showNote(plural(unknown.length, "solver.conceptPricingOne", "solver.conceptPricingMany"), "");
    await Promise.race([Promise.all(unknown.map((entry) => requestPrice(entry.definitionId, { name: entry.name, rating: entry.rating }))), sleep(15000)]);
    closeNote();
    targets = read();
    if (!targets.length) {
      return;
    }
  }
  let met = null;
  try {
    met = typeof ctx.challenge.meetsRequirements === "function" ? !!ctx.challenge.meetsRequirements() : null;
  } catch (e) {
    met = null;
  }
  openBuyConfirm({
    entries: targets,
    warning: met === false ? t("solver.conceptWarnRequirements") : "",
    onConfirm: () => runConceptPurchase(targets),
  });
};

// --------------------------------------------------------------- DCE en un clic

const workAreaShown = () => !!document.querySelector(".ut-one-click-sbc-work-area-view");

// Contrôleur EA de l'écran en un clic (gardé tant que sa vue est affichée).
const currentWorkArea = () => {
  try {
    if (ocCtrl && ocCtrl.isViewDisplayed() && ocCtrl.getViewModel()) {
      return ocCtrl;
    }
  } catch (e) {}
  ocCtrl = workAreaShown() ? findWorkAreaController() : null;
  return ocCtrl;
};

const closeOcBox = () => {
  if (ocBusy) {
    // Achat en cours : la boîte reste affichée (bouton Stop).
    return;
  }
  closeBuyConfirm();
  if (ocBox) {
    ocBox.remove();
    ocBox = null;
  }
  ocLast = null;
};

// actions : { undo, buy (libellé du bouton d'achat), stop }.
const showOcBox = (text, kind = "", actions = {}) => {
  if (!ocBox || !ocBox.isConnected) {
    ocBox = document.createElement("div");
    ocBox.id = "mb-solver-oc-box";
    STOP_EVENTS.forEach((type) => ocBox.addEventListener(type, (event) => event.stopPropagation()));
    ocBox.addEventListener("click", (event) => {
      const button = event.target.closest("[data-oc]");
      if (!button) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const action = button.dataset.oc;
      if (action === "undo" && ocLast && !ocBusy) {
        undoSelection(ocLast.area, ocLast.selected);
        log.info(t("solver.ocUndone"));
        ocLast = null;
        showOcBox(t("solver.ocUndone"), "");
      } else if (action === "buy") {
        buyOneClick();
      } else if (action === "stop") {
        if (ocBusy && ocBusy.token) {
          ocBusy.token.cancel();
        }
      } else if (action === "close") {
        closeOcBox();
      }
    });
    document.body.appendChild(ocBox);
  }
  ocBox.dataset.kind = kind;
  const buttons = [];
  if (actions.buy) {
    buttons.push(`<button type="button" class="is-buy" data-oc="buy">${escapeHtml(actions.buy)}</button>`);
  }
  if (actions.stop) {
    buttons.push(`<button type="button" class="is-danger" data-oc="stop">${escapeHtml(t("solver.stop"))}</button>`);
  }
  if (actions.undo) {
    buttons.push(`<button type="button" data-oc="undo">${escapeHtml(t("solver.ocUndo"))}</button>`);
  }
  if (!actions.stop) {
    buttons.push(`<button type="button" data-oc="close" aria-label="${escapeHtml(t("solver.close"))}">×</button>`);
  }
  ocBox.innerHTML = `<span>${escapeHtml(text)}</span>${buttons.join("")}`;
};

const excludedText = (excluded) => {
  const parts = ["squad", "unselectable", "quality", "loan", "academy", "evolved", "favorite", "tradable", "untradeable", "rating", "price", "storage", "concept"]
    .filter((reason) => excluded[reason])
    .map((reason) => t(`solver.excluded_${reason}`, { n: formatCoins(excluded[reason]) }));
  return parts.length ? ` (${t("solver.excludedPrefix")} ${parts.join(", ")})` : "";
};

const buyLabel = (entries) =>
  entries.length ? plural(entries.length, "solver.buyButtonOne", "solver.buyButtonMany", { total: formatCoins(marketTotal(entries)) }) : "";

// Texte du résultat : cartes du club sélectionnées, cartes à acheter, remarques.
const ocResultText = (area, plan, applied, marketPicks, extraNotes = []) => {
  const players = applied.selected;
  const untradeables = players.filter((entry) => entry.untradeable).length;
  const value = players.filter((entry) => !entry.untradeable).reduce((total, entry) => total + entry.value, 0);
  const score = area.submitted + applied.selectedScore;
  const projected = score + marketPicks.reduce((total, entry) => total + entry.score, 0);
  const reached = score >= area.required;
  const parts = [plural(players.length, "solver.ocDoneOne", "solver.ocDoneMany", { score: formatCoins(score), target: formatCoins(area.required) })];
  if (players.length) {
    parts.push(plural(untradeables, "solver.sumUntradeableOne", "solver.sumUntradeableMany"));
    if (players.length > untradeables) {
      parts.push(t("solver.sumValueApprox", { value: formatCoins(value) }));
    }
  }
  const notes = extraNotes.slice();
  if (marketPicks.length) {
    notes.push(
      plural(marketPicks.length, "solver.ocToBuyOne", "solver.ocToBuyMany", {
        total: formatCoins(marketTotal(marketPicks)),
        score: formatCoins(projected),
        target: formatCoins(area.required),
      })
    );
  } else if (!reached) {
    notes.push(plan.partial && !area.hasNextPage ? t("solver.ocPartial", { limit: area.limit }) : t("solver.ocMorePages"));
  }
  if (applied.skipped.length) {
    notes.push(plural(applied.skipped.length, "solver.ocSkippedOne", "solver.ocSkippedMany"));
  }
  if (plan.unmet.length) {
    notes.push(t("solver.ocUnmet", { labels: failingSummary(plan.unmet, 2) }));
  }
  if (area.rules.applied.length) {
    notes.push(t("solver.ocRules", { labels: failingSummary(area.rules.applied, 3) }));
  }
  notes.push(t("solver.ocCheck"));
  return { text: `${parts.join(" · ")}. ${notes.join(" ")}`, kind: (reached || marketPicks.length) && !plan.unmet.length ? "ok" : "warn" };
};

// « Remplir au moins cher » : cartes chargées par EA d'abord ; score hors d'atteinte avec le club :
// cartes du marché (listes FUTBIN, meilleur prix par point de score) proposées à l'achat.
const fillOneClick = async () => {
  if (ocBusy) {
    return;
  }
  const rules = solverRules();
  let ctrl = currentWorkArea();
  let area = ctrl ? readWorkArea(ctrl, rules) : null;
  if (!area) {
    showOcBox(t("solver.ocUnavailable"), "error");
    return;
  }
  if (area.remaining <= 0) {
    showOcBox(t("solver.ocAlreadyReached"), "ok");
    return;
  }
  if (area.selectedCount >= area.limit) {
    showOcBox(t("solver.ocLimit", { limit: area.limit }), "warn");
    return;
  }
  let plan = planWorkArea(area);
  const notes = [];
  if (!plan.reached && rules.useMarket && !rules.onlyUntradeables) {
    ocBusy = { kind: "market" };
    showOcBox(t("solver.ocMarketLoading"), "");
    let market = null;
    try {
      market = await oneClickMarket(area, rules);
    } catch (e) {
      market = null;
    } finally {
      ocBusy = null;
    }
    // L'écran a pu changer pendant la lecture FUTBIN : relu avant de sélectionner.
    ctrl = currentWorkArea();
    area = ctrl ? readWorkArea(ctrl, rules) : null;
    if (!area) {
      showOcBox(t("solver.ocUnavailable"), "error");
      return;
    }
    plan = planWorkArea(area);
    if (market && market.entries.length) {
      const mixed = planWorkArea(area, market.entries);
      if (mixed.picks.length && (mixed.reached || mixed.score > plan.score)) {
        plan = mixed;
      }
    } else {
      notes.push(t(market && market.blocked ? "solver.marketBlocked" : "solver.ocMarketNone"));
    }
  }
  if (!plan.picks.length) {
    const text = plan.reason === "limit" ? t("solver.ocLimit", { limit: area.limit }) : t("solver.ocEmpty", { excluded: excludedText(area.excluded) });
    showOcBox(text, "warn");
    return;
  }
  const marketPicks = plan.picks.filter((entry) => entry.market);
  const applied = applySelection(area, plan.picks.filter((entry) => !entry.market));
  ocLast = { area, selected: applied.selected, marketPicks, plan };
  const result = ocResultText(area, plan, applied, marketPicks, notes);
  showOcBox(result.text, result.kind, { undo: applied.selected.length > 0, buy: buyLabel(marketPicks) });
  log.info(
    t("solver.logOneClick", { n: applied.selected.length, score: formatCoins(area.submitted + applied.selectedScore), target: formatCoins(area.required) })
  );
};

// Achat des cartes manquantes du DCE en un clic, puis sélection dans l'écran d'EA.
const runOneClickPurchase = async (last) => {
  const { task, error } = startToolTask(t("solver.taskBuy"));
  if (!task) {
    showOcBox(error, "warn", { buy: buyLabel(last.marketPicks), undo: last.selected.length > 0 });
    return;
  }
  ocBusy = task;
  showOcBox(plural(last.marketPicks.length, "solver.statusBuyingOne", "solver.statusBuyingMany"), "", { stop: true });
  let report;
  try {
    report = await buyMarketCards(last.marketPicks, {
      token: task.token,
      onUpdate: (entry, state, note) =>
        showOcBox(`${entry.name} ${entry.rating} · ${state === "searching" ? note || t("solver.buySearching") : note}`, "", { stop: true }),
    });
  } catch (e) {
    report = { bought: [], failed: [], spent: 0, stopped: errorMessage(e) };
  } finally {
    endTask(task);
    ocBusy = null;
  }
  addToPool(report.bought.map(({ item, pile }) => ({ item, pile })));
  const summary = buySummary(report, last.marketPicks.length);
  log.info(t("solver.logBuyDone", { summary }));
  const ctrl = currentWorkArea();
  const area = ctrl ? readWorkArea(ctrl, solverRules()) : null;
  if (!area) {
    showOcBox(`${summary} ${t("solver.ocBoughtReopen")}`, "warn");
    return;
  }
  const applied = report.bought.length ? selectBought(area, report.bought) : { selected: [], skipped: [], selectedScore: area.selectedScore };
  ocLast = { area, selected: (last.selected || []).concat(applied.selected), marketPicks: [], plan: null };
  const score = area.submitted + applied.selectedScore;
  const notes = [summary, t("solver.ocBoughtSelected", { n: applied.selected.length, score: formatCoins(score), target: formatCoins(area.required) })];
  if (applied.skipped.length) {
    notes.push(plural(applied.skipped.length, "solver.ocBoughtSkippedOne", "solver.ocBoughtSkippedMany"));
  }
  notes.push(t("solver.ocCheck"));
  showOcBox(notes.join(" "), score >= area.required && !report.failed.length && !report.stopped ? "ok" : "warn", { undo: ocLast.selected.length > 0 });
};

const buyOneClick = () => {
  const last = ocLast;
  if (!last || !last.marketPicks.length || ocBusy) {
    return;
  }
  openBuyConfirm({ entries: last.marketPicks, onConfirm: () => runOneClickPurchase(last) });
};

const ensureOcFab = () => {
  if (ocFab && ocFab.isConnected) {
    return ocFab;
  }
  ocFab = document.createElement("button");
  ocFab.type = "button";
  ocFab.id = "mb-solver-oc";
  STOP_EVENTS.forEach((type) => ocFab.addEventListener(type, (event) => event.stopPropagation()));
  ocFab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    fillOneClick().catch((e) => showOcBox(t("solver.statusError", { error: errorMessage(e) }), "error"));
  });
  document.body.appendChild(ocFab);
  return ocFab;
};

const tickOneClick = () => {
  const shown = workAreaShown() && !!currentWorkArea();
  if (!shown) {
    if (ocFab) {
      ocFab.hidden = true;
    }
    if (ocBox) {
      closeOcBox();
    }
    ocCtrl = null;
    return;
  }
  if (!document.body) {
    return;
  }
  injectStyles();
  const button = ensureOcFab();
  const label = t("solver.ocFab");
  if (button.textContent !== label) {
    button.textContent = label;
  }
  const title = t("solver.ocFabTitle");
  if (button.title !== title) {
    button.title = title;
  }
  button.hidden = false;
};
