import { buildView, compileChecks, evaluateView, localChemistry } from "./sbcEval";
import { SCOPE } from "./sbcRequirements";

// Solveur DCE local : à partir de la réserve de joueurs (sbcPool.js), cherche l'équipe la moins chère
// qui remplit toutes les exigences du défi, sans aucune requête EA.
// 1. Filtres stricts : qualité exigée pour tous, « 11 joueurs or », « au plus 0 rare »…
// 2. Construction gloutonne : exigences « au moins » d'abord, avec les cartes les moins chères qui en
//    remplissent plusieurs, puis réparation (note d'équipe : montées de note les moins chères par point).
//    Avec des collectifs exigés, d'autres départs sont essayés : une ligue ou une nation à chaque poste.
// 3. Recherche locale (recuit simulé) : remplacements ciblés sur les exigences non remplies (joueurs de
//    la même ligue / nation / club jouables au poste pour les collectifs), échanges de postes, échanges
//    de notes, baisse du coût une fois l'équipe valide. Budget de temps et d'évaluations ; la page garde
//    la main (pause toutes les quelques centaines d'évaluations), Stop pris en compte.
// 4. Finition : remplacements moins chers un par un, puis postes (couplage maximum joueur ↔ poste).
// Résultat : { ok, squad: [{ slot, position, entry, chemistry, inPosition }], evaluation, failing… }.

const DEFAULTS = {
  timeBudgetMs: 4000,
  maxEvaluations: 250000,
  // Travail continu maximal avant de rendre la main à la page (ms).
  sliceMs: 14,
  // Évaluations sans progrès avant un nouveau départ, et nouveaux départs sans progrès avant l'arrêt
  // (davantage avec des collectifs : beaucoup de bonnes équipes très différentes, mieux vaut en voir plus).
  stagnation: 3000,
  patience: 6,
  chemPatience: 16,
  // Avec des collectifs : durée minimale de recherche (ms) avant de s'arrêter faute de progrès.
  chemMinMs: 1500,
  seed: 0,
};

const EPSILON = 1e-9;

// Générateur pseudo-aléatoire reproductible (tests) : mulberry32.
export const randomGenerator = (seed) => {
  let state = (Number(seed) || Date.now()) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

// Pause réelle (tâche suivante de la page) : l'interface reste fluide pendant la recherche. Dans le
// navigateur, MessageChannel (setTimeout est ralenti à 4 ms quand les appels s'enchaînent).
let channel = null;
const waiting = [];
const yieldToPage = () => {
  if (typeof window !== "undefined" && typeof MessageChannel === "function") {
    if (!channel) {
      channel = new MessageChannel();
      channel.port1.onmessage = () => {
        const resolve = waiting.shift();
        if (resolve) {
          resolve();
        }
      };
    }
    return new Promise((resolve) => {
      waiting.push(resolve);
      channel.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
};

const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

const fitsPosition = (entry, position) => !!(entry && entry.positions && entry.positions.indexOf(position) >= 0);

// Couplage maximum joueurs ↔ postes (chemins augmentants) : chaque joueur à un poste où il est jouable
// quand c'est possible, poste préféré d'abord ; les autres prennent les postes restants.
// players : entrées (ou null), positions : poste de chaque emplacement. Renvoie l'emplacement de chaque joueur.
export const arrangeByPosition = (players, positions) => {
  const options = players.map((entry) => {
    if (!entry) {
      return [];
    }
    const fitting = positions.map((position, slot) => (fitsPosition(entry, position) ? slot : -1)).filter((slot) => slot >= 0);
    return fitting.sort((a, b) => (positions[b] === entry.preferredPosition) - (positions[a] === entry.preferredPosition));
  });
  const owner = new Array(positions.length).fill(-1);
  const assign = (player, seen) => {
    for (const slot of options[player]) {
      if (seen[slot]) {
        continue;
      }
      seen[slot] = true;
      if (owner[slot] < 0 || assign(owner[slot], seen)) {
        owner[slot] = player;
        return true;
      }
    }
    return false;
  };
  players.forEach((entry, player) => {
    if (entry) {
      assign(player, new Array(positions.length).fill(false));
    }
  });
  const result = players.map(() => -1);
  owner.forEach((player, slot) => {
    if (player >= 0) {
      result[player] = slot;
    }
  });
  const free = positions.map((_, slot) => slot).filter((slot) => owner[slot] < 0);
  result.forEach((slot, player) => {
    if (slot < 0 && players[player] && free.length) {
      result[player] = free.shift();
    }
  });
  return result;
};

const sortedInsertKey = (map, key, index) => {
  const list = map.get(key);
  if (list) {
    list.push(index);
  } else {
    map.set(key, [index]);
  }
};

// Premier élément d'une liste triée (indices croissants = coûts croissants) ≥ limit.
const lowerBound = (list, limit) => {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid] < limit) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
};

export const solveSbc = async ({
  requirements,
  operation = "AND",
  slots,
  pool,
  chemistry = null,
  float = true,
  linkedTeam = (id) => id,
  token = null,
  onProgress = () => {},
  options = {},
}) => {
  const opts = Object.assign({}, DEFAULTS, options);
  const rand = randomGenerator(opts.seed || Math.floor(Math.random() * 1e9));
  const started = now();
  const checks = compileChecks(requirements, { float, linkedTeam });
  const supportedChecks = checks.filter((check) => check.supported);
  const unsupported = checks.filter((check) => !check.supported);
  const needsChem = supportedChecks.some((check) => check.needsChem);
  const ratingCheck = supportedChecks.find((check) => check.kind === "rating") || null;
  const openSlots = slots.filter((slot) => !slot.brick).map((slot) => slot.index);
  const openCount = openSlots.length;
  const positions = openSlots.map((index) => slots[index].position);
  const cancelled = () => !!(token && token.cancelled);

  const baseResult = (extra) =>
    Object.assign(
      {
        ok: false,
        feasible: false,
        squad: [],
        evaluation: null,
        rating: 0,
        chemistry: null,
        cost: 0,
        failing: [],
        unsupported: unsupported.map((check) => ({ index: check.index, label: check.label })),
        stats: { evaluations: 0, ms: 0, pool: 0, restarts: 0 },
        reason: "",
      },
      extra
    );

  if (!openCount) {
    return baseResult({ reason: "noSlots" });
  }

  // ---------------------------------------------------------------- filtres stricts
  let candidates = Array.from(pool || []).filter((entry) => entry && entry.positions);
  const strict = [];
  if (operation !== "OR") {
    supportedChecks.forEach((check) => {
      if (check.kind === "quality") {
        strict.push((entry) => !check.bad(entry));
      } else if (check.kind === "count" && check.match) {
        const single = candidates.every((entry) => check.match(entry) <= 1);
        if (single && (check.scope === SCOPE.GREATER || check.scope === SCOPE.EXACT) && check.target >= openCount) {
          strict.push((entry) => check.match(entry) >= 1);
        } else if ((check.scope === SCOPE.LOWER || check.scope === SCOPE.EXACT) && check.target <= 0) {
          strict.push((entry) => check.match(entry) === 0);
        }
      }
    });
  }
  // Joueur imposé par EA (brique personnalisée) : aucune autre version de lui (EA la refuserait).
  const brickPersons = new Set(slots.filter((slot) => slot.brick && slot.fixed && slot.fixed.person).map((slot) => slot.fixed.person));
  candidates = candidates.filter((entry) => !brickPersons.has(entry.person) && strict.every((test) => test(entry)));
  const entries = candidates.slice().sort((a, b) => a.cost - b.cost || a.rating - b.rating);
  const total = entries.length;
  const persons = new Set(entries.map((entry) => entry.person));
  if (persons.size < openCount) {
    return baseResult({ reason: "pool", stats: { evaluations: 0, ms: Math.round(now() - started), pool: total, restarts: 0 } });
  }

  // ---------------------------------------------------------------- index
  const all = entries.map((_, index) => index);
  const byRating = new Map();
  const byAttr = { nationId: new Map(), leagueId: new Map(), clubId: new Map() };
  const byPosition = new Map();
  const byPositionAttr = new Map();
  const openPositions = new Set(positions);
  entries.forEach((entry, index) => {
    sortedInsertKey(byRating, entry.rating, index);
    Object.keys(byAttr).forEach((field) => sortedInsertKey(byAttr[field], entry[field], index));
    entry.positions.forEach((position) => {
      if (!openPositions.has(position)) {
        return;
      }
      sortedInsertKey(byPosition, position, index);
      if (needsChem) {
        Object.keys(byAttr).forEach((field) => sortedInsertKey(byPositionAttr, `${field}|${position}|${entry[field]}`, index));
      }
    });
  });
  const ratingKeys = Array.from(byRating.keys()).sort((a, b) => a - b);
  const matchLists = new Map();
  const missLists = new Map();
  supportedChecks.forEach((check) => {
    if (check.match) {
      matchLists.set(check, all.filter((index) => check.match(entries[index]) > 0));
      missLists.set(check, all.filter((index) => check.match(entries[index]) === 0));
    }
  });

  // ---------------------------------------------------------------- évaluation
  const chemBase = needsChem ? chemistry || localChemistry() : null;
  const chemMemo = new Map();
  const chemFn = chemBase
    ? (slotList, bySlot) => {
        const key = bySlot.map((entry) => (entry ? entry.key : "-")).join(",");
        let hit = chemMemo.get(key);
        if (!hit) {
          hit = chemBase(slotList, bySlot);
          if (chemMemo.size > 50000) {
            chemMemo.clear();
          }
          chemMemo.set(key, hit);
        }
        return hit;
      }
    : null;
  let evaluations = 0;
  const evaluate = (assign) => {
    evaluations += 1;
    const bySlot = new Array(slots.length).fill(null);
    let cost = 0;
    for (let k = 0; k < openCount; k += 1) {
      if (assign[k] >= 0) {
        const entry = entries[assign[k]];
        bySlot[openSlots[k]] = entry;
        cost += entry.cost;
      }
    }
    const view = buildView(slots, bySlot, chemFn);
    const ev = evaluateView(checks, view, { operation, float });
    return { assign, view, ev, violation: ev.violation, cost };
  };
  const better = (a, b) => !b || a.violation < b.violation - EPSILON || (Math.abs(a.violation - b.violation) <= EPSILON && a.cost < b.cost);
  const feasible = (state) => !!state && state.violation <= EPSILON;

  const usedPersons = (assign, skip = -1) => {
    const used = new Set();
    for (let k = 0; k < openCount; k += 1) {
      if (k !== skip && assign[k] >= 0) {
        used.add(entries[assign[k]].person);
      }
    }
    return used;
  };
  // Tirage dans une liste triée par coût, biaisé vers les moins chères ; personne déjà dans l'équipe exclue.
  const pickFrom = (list, used, bias = 2, limit = list ? list.length : 0) => {
    if (!list || !limit) {
      return -1;
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const index = list[Math.floor(Math.pow(rand(), bias) * limit)];
      if (!used.has(entries[index].person)) {
        return index;
      }
    }
    for (let position = 0; position < limit; position += 1) {
      if (!used.has(entries[list[position]].person)) {
        return list[position];
      }
    }
    return -1;
  };
  // La moins chère des cartes d'une liste dont le joueur n'est pas déjà dans l'équipe.
  const firstFree = (list, used) => {
    if (list) {
      for (let position = 0; position < list.length; position += 1) {
        if (!used.has(entries[list[position]].person)) {
          return list[position];
        }
      }
    }
    return -1;
  };
  // Tirage avec condition (échantillonnage par rejet dans toute la réserve).
  const pickWhere = (test, used, bias = 2) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const index = Math.floor(Math.pow(rand(), bias) * total);
      if (!used.has(entries[index].person) && test(entries[index])) {
        return index;
      }
    }
    for (let index = 0; index < total; index += 1) {
      if (!used.has(entries[index].person) && test(entries[index])) {
        return index;
      }
    }
    return -1;
  };
  const randomOf = (list) => (list.length ? list[Math.floor(rand() * list.length)] : -1);
  const weightedSlot = (weightOf) => {
    const weights = [];
    let sum = 0;
    for (let k = 0; k < openCount; k += 1) {
      const weight = Math.max(0, weightOf(k));
      weights.push(weight);
      sum += weight;
    }
    if (!(sum > 0)) {
      return Math.floor(rand() * openCount);
    }
    let roll = rand() * sum;
    for (let k = 0; k < openCount; k += 1) {
      roll -= weights[k];
      if (roll <= 0) {
        return k;
      }
    }
    return openCount - 1;
  };
  const entryAt = (state, k) => (state.assign[k] >= 0 ? entries[state.assign[k]] : null);
  const slotsWhere = (state, test) => {
    const list = [];
    for (let k = 0; k < openCount; k += 1) {
      if (test(entryAt(state, k), k)) {
        list.push(k);
      }
    }
    return list;
  };
  const replace = (assign, k, index) => {
    const next = Int32Array.from(assign);
    next[k] = index;
    return next;
  };

  // ---------------------------------------------------------------- propositions de mouvement
  const listForAttr = (field, value, k) => {
    if (needsChem && k >= 0) {
      const fitting = byPositionAttr.get(`${field}|${positions[k]}|${value}`);
      if (fitting && fitting.length && rand() < 0.85) {
        return fitting;
      }
    }
    return byAttr[field].get(value) || [];
  };

  const valueCounts = (state, field) => {
    const counts = new Map();
    for (let k = 0; k < openCount; k += 1) {
      const entry = entryAt(state, k);
      if (entry) {
        counts.set(entry[field], (counts.get(entry[field]) || 0) + 1);
      }
    }
    return counts;
  };

  const ratingMove = (state, up) => {
    const k = weightedSlot((slot) => {
      const entry = entryAt(state, slot);
      const rating = entry ? entry.rating : 0;
      return up ? Math.pow(100 - rating, 2) : Math.pow(rating, 2) / 100;
    });
    const current = entryAt(state, k);
    const rating = current ? current.rating : 0;
    const step = 1 + Math.floor(Math.pow(rand(), 2) * 4);
    const wanted = up ? rating + step : rating - step;
    const used = usedPersons(state.assign, k);
    const keys = up ? ratingKeys.filter((value) => value >= wanted) : ratingKeys.filter((value) => value <= wanted).reverse();
    for (let index = 0; index < Math.min(keys.length, 4); index += 1) {
      const pick = pickFrom(byRating.get(keys[index]), used);
      if (pick >= 0) {
        return { k, index: pick };
      }
    }
    return null;
  };

  const chemMove = (state) => {
    const chem = state.view.chem ? state.view.chem.slots : null;
    // Joueur hors poste qui serait à son poste ailleurs : échange de postes.
    if (rand() < 0.25) {
      const outOfPosition = slotsWhere(state, (entry, k) => entry && !fitsPosition(entry, positions[k]));
      const k1 = randomOf(outOfPosition);
      if (k1 >= 0) {
        const partners = slotsWhere(state, (entry, k) => k !== k1 && fitsPosition(entryAt(state, k1), positions[k]));
        const k2 = randomOf(partners);
        if (k2 >= 0) {
          return { swap: [k1, k2] };
        }
      }
    }
    const k = weightedSlot((slot) => (chem ? 3.15 - (chem[openSlots[slot]] || 0) : 1));
    const others = slotsWhere(state, (entry, slot) => entry && slot !== k);
    const reference = entryAt(state, randomOf(others));
    const roll = rand();
    const field = roll < 0.5 ? "leagueId" : roll < 0.85 ? "nationId" : "clubId";
    const used = usedPersons(state.assign, k);
    let pick = reference ? pickFrom(listForAttr(field, reference[field], k), used) : -1;
    if (pick < 0) {
      pick = pickFrom(byPosition.get(positions[k]), used);
    }
    return pick >= 0 ? { k, index: pick } : null;
  };

  const checkMove = (state, result) => {
    const check = result.check;
    const used = (k) => usedPersons(state.assign, k);
    switch (check.kind) {
      case "count":
      case "combined": {
        const tooFew = check.scope === SCOPE.GREATER || (check.scope === SCOPE.EXACT && result.actual < result.target);
        if (tooFew) {
          const k = randomOf(slotsWhere(state, (entry) => !entry || !check.match(entry)));
          const slot = k >= 0 ? k : Math.floor(rand() * openCount);
          const pick = pickFrom(matchLists.get(check), used(slot));
          return pick >= 0 ? { k: slot, index: pick } : null;
        }
        const k = randomOf(slotsWhere(state, (entry) => entry && check.match(entry) > 0));
        if (k < 0) {
          return null;
        }
        const pick = pickFrom(missLists.get(check), used(k));
        return pick >= 0 ? { k, index: pick } : null;
      }
      case "group": {
        const counts = valueCounts(state, check.field);
        const bigger = check.scope === SCOPE.GREATER || (check.scope === SCOPE.EXACT && result.actual < result.target);
        if (bigger) {
          let value = null;
          let best = -1;
          counts.forEach((count, key) => {
            if (count > best || (count === best && rand() < 0.5)) {
              best = count;
              value = key;
            }
          });
          if (rand() < 0.2) {
            const reference = entryAt(state, randomOf(slotsWhere(state, (entry) => !!entry)));
            value = reference ? reference[check.field] : value;
          }
          const k = randomOf(slotsWhere(state, (entry) => !entry || entry[check.field] !== value));
          if (k < 0) {
            return null;
          }
          const pick = pickFrom(listForAttr(check.field, value, k), used(k));
          return pick >= 0 ? { k, index: pick } : null;
        }
        const crowded = Array.from(counts.keys()).filter((key) => counts.get(key) > check.target);
        const value = crowded.length ? crowded[Math.floor(rand() * crowded.length)] : null;
        const k = randomOf(slotsWhere(state, (entry) => entry && entry[check.field] === value));
        if (k < 0) {
          return null;
        }
        const pick = pickWhere((entry) => (counts.get(entry[check.field]) || 0) < check.target, used(k));
        return pick >= 0 ? { k, index: pick } : null;
      }
      case "distinct": {
        const counts = valueCounts(state, check.field);
        const more = check.scope === SCOPE.GREATER || (check.scope === SCOPE.EXACT && result.actual < result.target);
        if (more) {
          const k = randomOf(slotsWhere(state, (entry) => !entry || counts.get(entry[check.field]) > 1));
          if (k < 0) {
            return null;
          }
          const pick = pickWhere((entry) => !counts.has(entry[check.field]), used(k));
          return pick >= 0 ? { k, index: pick } : null;
        }
        const smallest = Math.min(...Array.from(counts.values()));
        const k = randomOf(slotsWhere(state, (entry) => entry && counts.get(entry[check.field]) === smallest));
        if (k < 0) {
          return null;
        }
        const own = entryAt(state, k)[check.field];
        const kept = Array.from(counts.keys()).filter((key) => key !== own);
        const value = kept.length ? kept[Math.floor(rand() * kept.length)] : own;
        const pick = pickFrom(listForAttr(check.field, value, k), used(k));
        return pick >= 0 ? { k, index: pick } : null;
      }
      case "quality": {
        const k = randomOf(slotsWhere(state, (entry) => entry && check.bad(entry)));
        if (k < 0) {
          return null;
        }
        const pick = pickWhere((entry) => !check.bad(entry), used(k));
        return pick >= 0 ? { k, index: pick } : null;
      }
      case "rating":
        return ratingMove(state, check.minRating != null && result.rating < check.minRating);
      case "chemTotal":
      case "chemAll":
        return chemMove(state);
      default:
        return null;
    }
  };

  const cheaperMove = (state) => {
    const k = weightedSlot((slot) => {
      const entry = entryAt(state, slot);
      return entry ? entry.cost + 1 : 0;
    });
    const current = state.assign[k];
    if (current < 0) {
      return null;
    }
    const entry = entries[current];
    const used = usedPersons(state.assign, k);
    const roll = rand();
    let list;
    let cheaperOnly = true;
    if (roll < 0.4) {
      // Même note, moins chère.
      list = byRating.get(entry.rating);
    } else if (roll < 0.65 && needsChem) {
      // Même ligue et même poste, moins chère (collectifs gardés).
      list = byPositionAttr.get(`leagueId|${positions[k]}|${entry.leagueId}`) || byRating.get(entry.rating);
    } else if (roll < 0.85) {
      // Un point de note en moins (la recherche compense ailleurs si besoin).
      list = byRating.get(entry.rating - 1) || byRating.get(entry.rating);
      cheaperOnly = false;
    } else {
      list = all;
    }
    const limit = list ? (cheaperOnly ? lowerBound(list, current) : list.length) : 0;
    const pick = pickFrom(list, used, 1.5, limit);
    return pick >= 0 ? { k, index: pick } : null;
  };

  // Échange de notes : une carte monte, une autre descend (note d'équipe tenue, coût en baisse).
  const pairMove = (state) => {
    if (openCount < 2) {
      return null;
    }
    const k1 = Math.floor(rand() * openCount);
    let k2 = Math.floor(rand() * (openCount - 1));
    k2 = k2 >= k1 ? k2 + 1 : k2;
    const a = entryAt(state, k1);
    const b = entryAt(state, k2);
    if (!a || !b) {
      return null;
    }
    const step = rand() < 0.7 ? 1 : 2;
    // Personnes des autres postes (les deux postes changés sont libérés).
    const used = usedPersons(state.assign, k1);
    used.delete(b.person);
    const up = pickFrom(byRating.get(a.rating + step), used);
    if (up < 0) {
      return null;
    }
    used.add(entries[up].person);
    const down = pickFrom(byRating.get(b.rating - step), used, 1.5);
    if (down < 0) {
      return null;
    }
    return { pair: [[k1, up], [k2, down]] };
  };

  const randomMove = (state) => {
    const k = Math.floor(rand() * openCount);
    const used = usedPersons(state.assign, k);
    const list = needsChem && rand() < 0.6 ? byPosition.get(positions[k]) : all;
    const pick = pickFrom(list, used, 1.6);
    return pick >= 0 ? { k, index: pick } : null;
  };

  const swapMove = () => {
    if (openCount < 2) {
      return null;
    }
    const k1 = Math.floor(rand() * openCount);
    let k2 = Math.floor(rand() * (openCount - 1));
    k2 = k2 >= k1 ? k2 + 1 : k2;
    return { swap: [k1, k2] };
  };

  const applyMove = (assign, move) => {
    if (!move) {
      return null;
    }
    if (move.swap) {
      const next = Int32Array.from(assign);
      const [k1, k2] = move.swap;
      next[k1] = assign[k2];
      next[k2] = assign[k1];
      return next;
    }
    if (move.pair) {
      const next = Int32Array.from(assign);
      move.pair.forEach(([k, index]) => {
        next[k] = index;
      });
      return next;
    }
    if (move.k == null || move.index < 0 || assign[move.k] === move.index) {
      return null;
    }
    return replace(assign, move.k, move.index);
  };

  const violatedChecks = (state) => state.ev.checks.filter((result) => result.check.supported && !result.met);

  const proposeMove = (state) => {
    const roll = rand();
    if (!feasible(state)) {
      if (state.ev.full === false) {
        const k = slotsWhere(state, (entry) => !entry)[0];
        const pick = pickFrom(needsChem ? byPosition.get(positions[k]) || all : all, usedPersons(state.assign, k));
        return pick >= 0 ? { k, index: pick } : null;
      }
      if (roll < 0.62) {
        const violated = violatedChecks(state);
        if (violated.length) {
          const weights = violated.map((result) => result.check.weight * Math.max(result.deficit, 0.05));
          let pickRoll = rand() * weights.reduce((sum, value) => sum + value, 0);
          let chosen = violated[violated.length - 1];
          for (let index = 0; index < violated.length; index += 1) {
            pickRoll -= weights[index];
            if (pickRoll <= 0) {
              chosen = violated[index];
              break;
            }
          }
          return checkMove(state, chosen);
        }
      }
      if (roll < 0.72) {
        return randomMove(state);
      }
      if (roll < 0.82) {
        return needsChem ? chemMove(state) : randomMove(state);
      }
      if (roll < 0.92) {
        return cheaperMove(state);
      }
      return ratingCheck ? pairMove(state) : swapMove();
    }
    if (roll < 0.55) {
      return cheaperMove(state);
    }
    if (roll < 0.7) {
      return ratingCheck ? pairMove(state) : cheaperMove(state);
    }
    if (roll < 0.8) {
      return randomMove(state);
    }
    if (roll < 0.9) {
      return needsChem ? swapMove() : cheaperMove(state);
    }
    return needsChem ? chemMove(state) : randomMove(state);
  };

  // ---------------------------------------------------------------- départs
  const arranged = (assign) => {
    const players = Array.from(assign).map((index) => (index >= 0 ? entries[index] : null));
    const places = arrangeByPosition(players, positions);
    const next = new Int32Array(openCount).fill(-1);
    places.forEach((slot, player) => {
      if (slot >= 0) {
        next[slot] = assign[player];
      }
    });
    return next;
  };

  // Glouton : chaque poste reçoit la carte la moins chère au regard de ce qu'elle apporte aux
  // exigences « au moins » encore ouvertes, sans dépasser les exigences « au plus ».
  const greedy = (noise) => {
    const chosen = [];
    const used = new Set();
    const counts = { nationId: new Map(), leagueId: new Map(), clubId: new Map() };
    const tallies = new Map(supportedChecks.filter((check) => check.match).map((check) => [check, 0]));
    for (let step = 0; step < openCount; step += 1) {
      let bestIndex = -1;
      let bestScore = Infinity;
      for (let index = 0; index < total; index += 1) {
        const entry = entries[index];
        if (used.has(entry.person)) {
          continue;
        }
        let gain = 0;
        let blocked = false;
        supportedChecks.forEach((check) => {
          if (blocked) {
            return;
          }
          if (check.match) {
            const value = check.match(entry);
            const tally = tallies.get(check);
            if (check.scope !== SCOPE.LOWER && value > 0 && tally < check.target) {
              gain += Math.min(value, check.target - tally);
            }
            if (check.scope !== SCOPE.GREATER && value > 0 && tally + value > check.target) {
              blocked = true;
            }
          } else if (check.kind === "group") {
            const count = counts[check.field].get(entry[check.field]) || 0;
            if (check.scope !== SCOPE.GREATER && count + 1 > check.target) {
              blocked = true;
            } else if (check.scope !== SCOPE.LOWER && count > 0) {
              gain += 0.6;
            }
          } else if (check.kind === "distinct") {
            const present = counts[check.field].has(entry[check.field]);
            const size = counts[check.field].size;
            if (check.scope !== SCOPE.GREATER && !present && size >= check.target) {
              blocked = true;
            } else if (check.scope !== SCOPE.LOWER && !present && size < check.target) {
              gain += 0.8;
            }
          }
        });
        if (blocked) {
          continue;
        }
        const score = (entry.cost + 1) * (1 + noise * rand()) / (1 + 2 * gain);
        if (score < bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
      if (bestIndex < 0) {
        // Plus rien de compatible : la moins chère des cartes restantes (la recherche réparera).
        bestIndex = entries.findIndex((entry) => !used.has(entry.person));
        if (bestIndex < 0) {
          break;
        }
      }
      const entry = entries[bestIndex];
      chosen.push(bestIndex);
      used.add(entry.person);
      Object.keys(counts).forEach((field) => counts[field].set(entry[field], (counts[field].get(entry[field]) || 0) + 1));
      tallies.forEach((tally, check) => tallies.set(check, tally + check.match(entry)));
    }
    const assign = new Int32Array(openCount).fill(-1);
    chosen.forEach((index, k) => {
      assign[k] = index;
    });
    return arranged(assign);
  };

  // Départ « collectifs » : à chaque poste, la carte la moins chère d'une même ligue / nation jouable au poste.
  // minRating : avec une note d'équipe exigée, la moins chère des cartes assez bien notées d'abord.
  const clusterSeed = (field, value, minRating = 0) => {
    const assign = new Int32Array(openCount).fill(-1);
    const used = new Set();
    const order = positions
      .map((position, k) => ({ k, size: (byPositionAttr.get(`${field}|${position}|${value}`) || []).length }))
      .sort((a, b) => a.size - b.size);
    const rated = (list) => {
      if (!list || !minRating) {
        return -1;
      }
      for (let position = 0; position < list.length; position += 1) {
        const entry = entries[list[position]];
        if (entry.rating >= minRating && !used.has(entry.person)) {
          return list[position];
        }
      }
      return -1;
    };
    order.forEach(({ k }) => {
      const list = byPositionAttr.get(`${field}|${positions[k]}|${value}`);
      let pick = rated(list);
      if (pick < 0) {
        pick = firstFree(list, used);
      }
      if (pick < 0) {
        pick = firstFree(byPosition.get(positions[k]), used);
      }
      if (pick < 0) {
        pick = firstFree(all, used);
      }
      if (pick >= 0) {
        assign[k] = pick;
        used.add(entries[pick].person);
      }
    });
    return assign;
  };

  // Réparation gloutonne : le remplacement qui réduit le plus la violation par pièce dépensée
  // (note d'équipe : les montées de note les moins chères par point de note gagné).
  const repair = (state, rounds = 25) => {
    let current = state;
    for (let round = 0; round < rounds && !feasible(current); round += 1) {
      const options = [];
      const ratingNeed = ratingCheck && current.ev.checks.find((result) => result.check === ratingCheck && !result.met);
      if (ratingNeed) {
        const up = ratingCheck.minRating != null && ratingNeed.rating < ratingCheck.minRating;
        for (let k = 0; k < openCount; k += 1) {
          const used = usedPersons(current.assign, k);
          const entry = entryAt(current, k);
          const base = entry ? entry.rating : 0;
          for (let step = 1; step <= 7; step += 1) {
            const list = byRating.get(up ? base + step : base - step);
            let found = 0;
            for (let position = 0; list && position < list.length && found < 2; position += 1) {
              if (!used.has(entries[list[position]].person)) {
                options.push(replace(current.assign, k, list[position]));
                found += 1;
              }
            }
          }
        }
      }
      violatedChecks(current).forEach((result) => {
        if (result.check === ratingCheck) {
          return;
        }
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const next = applyMove(current.assign, checkMove(current, result));
          if (next) {
            options.push(next);
          }
        }
      });
      let best = null;
      let bestRatio = Infinity;
      options.forEach((assign) => {
        const next = evaluate(assign);
        const gain = current.violation - next.violation;
        if (gain <= EPSILON) {
          return;
        }
        const ratio = Math.max(next.cost - current.cost, 0) / gain - gain * 1e-6;
        if (ratio < bestRatio) {
          bestRatio = ratio;
          best = next;
        }
      });
      if (!best) {
        break;
      }
      current = best;
    }
    return current;
  };

  // ---------------------------------------------------------------- recherche
  let restarts = 0;
  let current = repair(evaluate(greedy(0)));
  let best = current;
  // Départs « même championnat / même nation » (les plus fournis aux postes du défi), gardés pour
  // diversifier les nouveaux départs de la recherche.
  const seeds = [];
  if (needsChem) {
    const seedRating = ratingCheck && ratingCheck.minRating != null ? ratingCheck.minRating - 1 : 0;
    ["leagueId", "nationId"].forEach((field) => {
      const coverage = new Map();
      byAttr[field].forEach((list, value) => {
        let covered = 0;
        positions.forEach((position) => {
          if ((byPositionAttr.get(`${field}|${position}|${value}`) || []).length) {
            covered += 1;
          }
        });
        coverage.set(value, covered * 1000 + Math.min(list.length, 999));
      });
      Array.from(coverage.keys())
        .sort((a, b) => coverage.get(b) - coverage.get(a))
        .slice(0, field === "leagueId" ? 6 : 4)
        .forEach((value) => {
          [0, seedRating].filter((rating, index) => index === 0 || rating > 0).forEach((rating) => {
            const assign = clusterSeed(field, value, rating);
            seeds.push(assign);
            const seeded = repair(evaluate(assign), 8);
            if (better(seeded, best)) {
              best = seeded;
            }
          });
        });
    });
    current = best;
  }

  const costScale = Math.max(
    50,
    (() => {
      const costs = Array.from(best.assign)
        .filter((index) => index >= 0)
        .map((index) => entries[index].cost)
        .sort((a, b) => a - b);
      return costs.length ? costs[Math.floor(costs.length / 2)] : 100;
    })()
  );

  // Nouveau départ : meilleure équipe secouée (les cartes les plus chères ou quelques postes au hasard
  // remplacés par des cartes bon marché), ou glouton bruité tant qu'aucune équipe n'est valide.
  const restartFrom = (state, round) => {
    if (!feasible(state) && round % 2) {
      return repair(evaluate(greedy(0.6)));
    }
    // Un départ sur trois repart d'un autre groupe (championnat / nation) : autre région de recherche.
    if (seeds.length && round % 3 === 0) {
      return repair(evaluate(seeds[Math.floor(round / 3) % seeds.length]), 8);
    }
    let assign = Int32Array.from(state.assign);
    const expensive = rand() < 0.5;
    const order = Array.from({ length: openCount }, (_, k) => k);
    if (expensive) {
      order.sort((a, b) => (assign[b] >= 0 ? entries[assign[b]].cost : 0) - (assign[a] >= 0 ? entries[assign[a]].cost : 0));
    }
    const changes = Math.min(openCount, (feasible(state) ? 2 : 3) + Math.floor(rand() * 3));
    for (let change = 0; change < changes; change += 1) {
      const k = expensive ? order[change] : Math.floor(rand() * openCount);
      const list = needsChem && rand() < 0.7 ? byPosition.get(positions[k]) || all : all;
      const pick = pickFrom(list, usedPersons(assign, k), 2.5);
      if (pick >= 0) {
        assign = replace(assign, k, pick);
      }
    }
    return evaluate(assign);
  };

  const startViolation = 1.2;
  const endViolation = 0.02;
  // Une descente (recuit) dure runLength évaluations ; la température repart à chaque nouveau départ.
  const runLength = Math.max(3000, opts.stagnation * 2);
  let runStart = evaluations;
  let lastImprovement = evaluations;
  let restartsSinceBest = 0;
  let timedOut = false;
  let lastYield = now();
  const budget = Math.max(200, opts.timeBudgetMs);
  while (evaluations < opts.maxEvaluations && !cancelled()) {
    const elapsed = now() - started;
    if (elapsed > budget) {
      timedOut = true;
      break;
    }
    const overall = Math.min(1, Math.max(evaluations / opts.maxEvaluations, elapsed / budget));
    const progress = Math.max(overall, Math.min(1, (evaluations - runStart) / runLength));
    const tempViolation = startViolation * Math.pow(endViolation / startViolation, progress);
    const tempCost = costScale * 0.3 * Math.pow(0.005, progress);
    const next = applyMove(current.assign, proposeMove(current));
    if (next) {
      const candidate = evaluate(next);
      const dv = candidate.violation - current.violation;
      let accept;
      if (dv < -EPSILON) {
        accept = true;
      } else if (dv > EPSILON) {
        accept = rand() < Math.exp(-dv / (feasible(current) ? tempViolation * 0.5 : tempViolation));
      } else {
        const dc = candidate.cost - current.cost;
        accept = dc <= 0 || rand() < Math.exp(-dc / Math.max(1, tempCost));
      }
      if (accept) {
        current = candidate;
        if (better(current, best)) {
          best = current;
          lastImprovement = evaluations;
          restartsSinceBest = 0;
        }
      }
    } else {
      evaluations += 1;
    }
    if (evaluations - lastImprovement > opts.stagnation) {
      restarts += 1;
      restartsSinceBest += 1;
      // Équipe valide et plus aucun progrès après plusieurs départs : on s'arrête là.
      const patience = needsChem ? opts.chemPatience : opts.patience;
      if (feasible(best) && restartsSinceBest > patience && (!needsChem || now() - started > Math.min(opts.chemMinMs, budget * 0.6))) {
        break;
      }
      current = restartFrom(best, restarts);
      runStart = evaluations;
      lastImprovement = evaluations;
      if (better(current, best)) {
        best = current;
        restartsSinceBest = 0;
      }
    }
    if (now() - lastYield > opts.sliceMs) {
      onProgress({ phase: "solve", fraction: overall, feasible: feasible(best), cost: best.cost });
      await yieldToPage();
      lastYield = now();
    }
  }

  // ---------------------------------------------------------------- finition
  // Remplaçants moins chers d'un poste : les moins chères de la réserve, même note (± 1), et avec des
  // collectifs, même championnat / nation / club jouables au poste (liens gardés).
  const polishCandidates = (state, k) => {
    const entry = entryAt(state, k);
    const limit = state.assign[k];
    const picked = new Set();
    const add = (list) => {
      if (!list) {
        return;
      }
      for (let position = 0; position < list.length && list[position] < limit; position += 1) {
        picked.add(list[position]);
      }
    };
    for (let index = 0; index < Math.min(limit, 150); index += 1) {
      picked.add(index);
    }
    add(byRating.get(entry.rating));
    add(byRating.get(entry.rating - 1));
    add(byRating.get(entry.rating + 1));
    if (needsChem) {
      ["leagueId", "nationId", "clubId"].forEach((field) => add(byPositionAttr.get(`${field}|${positions[k]}|${entry[field]}`)));
    }
    return Array.from(picked).sort((a, b) => a - b);
  };
  // Échange de notes : une carte descend d'un ou deux points, une autre monte (note tenue, coût en baisse).
  const pairPolish = () => {
    const order = Array.from({ length: openCount }, (_, k) => k).sort((a, b) => entryAt(best, b).cost - entryAt(best, a).cost);
    for (const k1 of order) {
      const a = entryAt(best, k1);
      for (const step of [1, 2]) {
        const down = firstFree(byRating.get(a.rating - step), usedPersons(best.assign, k1));
        if (down < 0 || entries[down].cost >= a.cost) {
          continue;
        }
        for (let k2 = 0; k2 < openCount; k2 += 1) {
          const b = entryAt(best, k2);
          if (k2 === k1 || !b) {
            continue;
          }
          const used = usedPersons(best.assign, k1);
          used.delete(b.person);
          used.add(entries[down].person);
          const up = firstFree(byRating.get(b.rating + step), used);
          if (up < 0 || entries[down].cost - a.cost + entries[up].cost - b.cost >= 0) {
            continue;
          }
          const next = evaluate(applyMove(best.assign, { pair: [[k1, down], [k2, up]] }));
          if (feasible(next) && next.cost < best.cost) {
            best = next;
            return true;
          }
        }
      }
    }
    return false;
  };
  if (feasible(best) && !cancelled()) {
    const polishUntil = now() + Math.min(2000, Math.max(400, budget * 0.35));
    for (let pass = 0; pass < 4; pass += 1) {
      let improved = false;
      const order = Array.from({ length: openCount }, (_, k) => k).sort((a, b) => entryAt(best, b).cost - entryAt(best, a).cost);
      for (const k of order) {
        const used = usedPersons(best.assign, k);
        for (const index of polishCandidates(best, k)) {
          if (used.has(entries[index].person)) {
            continue;
          }
          const next = evaluate(replace(best.assign, k, index));
          if (feasible(next) && next.cost < best.cost) {
            best = next;
            improved = true;
            break;
          }
        }
        if (now() > polishUntil || cancelled()) {
          break;
        }
      }
      if (ratingCheck && now() < polishUntil && !cancelled()) {
        improved = pairPolish() || improved;
      }
      await yieldToPage();
      if (!improved || now() > polishUntil || cancelled()) {
        break;
      }
    }
  }
  // Postes : couplage maximum ; avec des collectifs, gardé seulement s'il ne dégrade rien, puis
  // échanges deux à deux tant qu'ils améliorent l'équipe ou le nombre de joueurs à leur poste.
  const inPositionCount = (state) => slotsWhere(state, (entry, k) => entry && fitsPosition(entry, positions[k])).length;
  const placed = evaluate(arranged(best.assign));
  if (!needsChem || !better(best, placed)) {
    best = placed;
  }
  if (needsChem) {
    let improved = true;
    for (let pass = 0; pass < 3 && improved; pass += 1) {
      improved = false;
      for (let k1 = 0; k1 < openCount; k1 += 1) {
        for (let k2 = k1 + 1; k2 < openCount; k2 += 1) {
          const next = evaluate(applyMove(best.assign, { swap: [k1, k2] }));
          if (next.violation < best.violation - EPSILON || (Math.abs(next.violation - best.violation) <= EPSILON && inPositionCount(next) > inPositionCount(best))) {
            best = next;
            improved = true;
          }
        }
      }
    }
  }

  const ev = best.ev;
  const chem = best.view.chem;
  const okSupported = feasible(best);
  const squad = openSlots.map((slotIndex, k) => {
    const entry = entryAt(best, k);
    return {
      slot: slotIndex,
      position: positions[k],
      entry,
      chemistry: chem ? chem.slots[slotIndex] || 0 : null,
      inPosition: fitsPosition(entry, positions[k]),
    };
  });
  return baseResult({
    ok: okSupported && ev.met,
    feasible: okSupported,
    squad,
    evaluation: ev,
    rating: ev.rating,
    chemistry: chem ? chem.total : null,
    cost: best.cost,
    failing: ev.checks
      .filter((result) => !result.met)
      .map((result) => ({ index: result.check.index, label: result.check.label, actual: result.actual, target: result.target, supported: result.check.supported })),
    stats: { evaluations, ms: Math.round(now() - started), pool: total, restarts, timedOut, cancelled: cancelled() },
    reason: cancelled() ? "cancelled" : okSupported ? (ev.met ? "" : "unsupported") : "infeasible",
  });
};
