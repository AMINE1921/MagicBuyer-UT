import { QUALITY, SCOPE } from "./sbcRequirements";

// Évaluation locale d'une équipe de défi, fidèle au code du web app EA (FC 27) :
// - note d'équipe : UTSquadEntity._calculateRating (11 titulaires, calcul « à virgule » ou entier) ;
// - collectifs : UTSquadChemCalculatorUtils.calculate (modèle de base, sans profils de rareté) ;
// - exigences : UTSBCChallengeEntity.isRequirementMet / meetsRequirements.
// Tout est pur (aucun appel EA) : utilisé par le solveur, l'aperçu et les tests. Les collectifs réels
// sont calculés par le calculateur d'EA (sbcSquad.js) et injectés sous forme de fonction.
//
// Une « vue » d'équipe : { kinds[11] ("open" | "simple" | "custom"), bySlot[11] (entrée ou null),
// players (entrées des postes ouverts), ratings[11], chem: { total, slots[11] } | null }.

export const FIELD_PLAYERS = 11;
export const SLOT_MAX_CHEMISTRY = 3;
export const MAX_SQUAD_CHEMISTRY = 33;
// STAR_RATING_THRESHOLDS du web app : note ≤ seuil[i] → i/2 étoiles.
export const STAR_RATING_THRESHOLDS = [0, 59, 62, 64, 66, 68, 70, 74, 78, 82, 99];

// UTItemEntity : LEGENDS_LEAGUE_ID, LEGENDS_CLUB_ID, LEAGUE_HERO_CLUB_ID, HALL_OF_FUT_CLUB_ID.
export const LEGENDS_LEAGUE_ID = 2118;
export const LEGENDS_CLUB_ID = 112658;
export const LEAGUE_HERO_CLUB_ID = 114605;
export const HALL_OF_FUT_CLUB_ID = 132794;

// Paliers de collectifs par défaut (FC 23 → FC 27) : remplacés au chargement par ceux du web app.
export const DEFAULT_CHEM_PARAMS = {
  club: { thresholds: [{ requirement: 2, points: 1 }, { requirement: 5, points: 1 }, { requirement: 8, points: 1 }] },
  league: { thresholds: [{ requirement: 3, points: 1 }, { requirement: 5, points: 1 }, { requirement: 8, points: 1 }] },
  nation: { thresholds: [{ requirement: 2, points: 1 }, { requirement: 5, points: 1 }, { requirement: 8, points: 1 }] },
};

export const tierOf = (rating) => {
  const value = Number(rating) || 0;
  if (value <= 0) {
    return 0;
  }
  return value <= 64 ? QUALITY.BRONZE : value <= 74 ? QUALITY.SILVER : QUALITY.GOLD;
};

// ------------------------------------------------------------------ note d'équipe

// Total avant division (note réelle = floor(total arrondi / 11)). ratings : notes des 11 postes dans
// l'ordre (0 = poste vide ou brique) ; même ordre de calcul qu'EA pour les mêmes arrondis.
export const ratingTotal = (ratings, float = true) => {
  const valid = ratings.filter((rating) => rating > 0);
  const sum = valid.reduce((total, rating) => total + rating, 0);
  if (float) {
    const average = Math.min(sum / FIELD_PLAYERS, 99);
    let total = sum;
    valid.forEach((rating) => {
      if (rating > average) {
        total += rating - average;
      }
    });
    return total;
  }
  const average = Math.min(Math.floor(sum / FIELD_PLAYERS), 99);
  let total = sum;
  valid.forEach((rating) => {
    if (rating > average) {
      total += rating - average;
    }
  });
  return total;
};

export const squadRating = (ratings, float = true) => {
  const total = ratingTotal(ratings, float);
  const rounded = float ? Math.round(total) : total;
  return Math.min(Math.max(Math.floor(rounded / FIELD_PLAYERS), 0), 99);
};

export const starRating = (rating) => {
  for (let index = 0; index < STAR_RATING_THRESHOLDS.length; index += 1) {
    if (rating <= STAR_RATING_THRESHOLDS[index]) {
      return index / 2;
    }
  }
  return 5;
};

// Note minimale pour au moins `stars` étoiles, note maximale pour au plus `stars` étoiles.
export const minRatingForStars = (stars) => {
  for (let rating = 0; rating <= 99; rating += 1) {
    if (starRating(rating) >= stars) {
      return rating;
    }
  }
  return 100;
};

export const maxRatingForStars = (stars) => {
  for (let rating = 99; rating >= 0; rating -= 1) {
    if (starRating(rating) <= stars) {
      return rating;
    }
  }
  return -1;
};

// Écart (en points de note, continu) entre le total et la borne exigée : 0 quand la note est bonne.
const ratingGap = (ratings, float, min, max) => {
  const total = ratingTotal(ratings, float);
  const rating = squadRating(ratings, float);
  let gap = 0;
  if (min != null && rating < min) {
    // Note ≥ min ⟺ total ≥ 11·min − 0,5 (arrondi) ou ≥ 11·min (calcul entier).
    gap += Math.max(0.01, (FIELD_PLAYERS * min - (float ? 0.5 : 0) - total) / FIELD_PLAYERS);
  }
  if (max != null && rating > max) {
    gap += Math.max(0.01, (total - (FIELD_PLAYERS * (max + 1) - (float ? 0.5 : 0)) + 0.01) / FIELD_PLAYERS);
  }
  return { rating, gap };
};

// ------------------------------------------------------------------ collectifs (modèle local)

const contributes = (entry) => !!entry;
const isRestrictedClub = (teamId) => teamId === LEGENDS_CLUB_ID || teamId === LEAGUE_HERO_CLUB_ID || teamId === HALL_OF_FUT_CLUB_ID;
const isRestrictedLeague = (leagueId) => leagueId === LEGENDS_LEAGUE_ID;
const fitsSlot = (entry, slot) => !!(entry && slot && entry.positions && entry.positions.indexOf(slot.position) >= 0);

const addContribution = (map, id, amount, inPosition) => {
  if (!(id > 0)) {
    return;
  }
  const entry = map.get(id) || { contributions: 0, missed: 0 };
  if (inPosition) {
    entry.contributions += amount;
  } else {
    entry.missed += amount;
  }
  map.set(id, entry);
};

const pointsFor = (entry, param) => {
  if (!entry || !(entry.contributions > 0) || !param) {
    return 0;
  }
  const thresholds = param.thresholds || [];
  const cap = thresholds.reduce((max, threshold) => Math.max(max, threshold.requirement), 0);
  const count = Math.min(entry.contributions, cap);
  return thresholds.reduce((points, threshold) => (count >= threshold.requirement ? points + threshold.points : points), 0);
};

// Fonction de collectifs (slots[11], bySlot[11]) → { total, slots[11] }, d'après le calculateur EA
// sans profils de rareté : un joueur hors de ses postes possibles n'a aucun point et n'apporte rien
// aux autres ; icônes et héros ont 3 points à leur poste (contribution nation ×2 pour une icône,
// ligue ×2 pour un héros, et chaque icône à son poste ajoute 1 à chaque ligue présente).
export const localChemistry = (params = DEFAULT_CHEM_PARAMS) => (slots, bySlot) => {
  const inPosition = bySlot.map((entry, index) => contributes(entry) && fitsSlot(entry, slots[index]));
  const legendsIn = bySlot.filter((entry, index) => entry && entry.legend && inPosition[index]).length;
  const legendsOut = bySlot.filter((entry, index) => entry && entry.legend && !inPosition[index]).length;
  const clubs = new Map();
  const leagues = new Map();
  const nations = new Map();
  bySlot.forEach((entry, index) => {
    if (!contributes(entry)) {
      return;
    }
    const inPos = inPosition[index];
    const clubShare = !entry.superChem && (entry.hero || entry.legend) ? 0 : 1;
    const leagueShare = entry.hero || entry.superChem ? 2 : 1;
    const nationShare = entry.legend ? 2 : 1;
    if (!isRestrictedClub(entry.teamId)) {
      addContribution(clubs, entry.clubId, clubShare, inPos);
    }
    if (!isRestrictedLeague(entry.leagueId) && entry.leagueId > 0) {
      const created = !leagues.has(entry.leagueId);
      addContribution(leagues, entry.leagueId, leagueShare, inPos);
      if (created) {
        // Icônes : +1 à chaque ligue où au moins un joueur est à son poste.
        const league = leagues.get(entry.leagueId);
        const someInPosition = bySlot.some((other, otherIndex) => other && other.leagueId === entry.leagueId && inPosition[otherIndex]);
        if (someInPosition) {
          league.contributions += legendsIn;
        } else {
          league.missed += legendsIn;
        }
        league.missed += legendsOut;
      }
    }
    addContribution(nations, entry.nationId, nationShare, inPos);
  });
  const points = bySlot.map((entry, index) => {
    if (!contributes(entry) || !inPosition[index]) {
      return 0;
    }
    let value = entry.legend || entry.hero || entry.superChem ? SLOT_MAX_CHEMISTRY : 0;
    value += pointsFor(clubs.get(entry.clubId), params.club);
    value += pointsFor(leagues.get(entry.leagueId), params.league);
    value += pointsFor(nations.get(entry.nationId), params.nation);
    return Math.min(value, SLOT_MAX_CHEMISTRY);
  });
  return { total: points.reduce((sum, value) => sum + value, 0), slots: points };
};

// ------------------------------------------------------------------ exigences

const compare = (actual, target, scope) =>
  scope === SCOPE.GREATER ? target <= actual : scope === SCOPE.LOWER ? actual <= target : actual === target;

const gapOf = (actual, target, scope) =>
  scope === SCOPE.GREATER
    ? Math.max(0, target - actual)
    : scope === SCOPE.LOWER
    ? Math.max(0, actual - target)
    : Math.abs(actual - target);

const ATTRS = {
  NATION: "nationId",
  LEAGUE: "leagueId",
  CLUB: "clubId",
};

const countValues = (players, field) => {
  const counts = new Map();
  players.forEach((entry) => counts.set(entry[field], (counts.get(entry[field]) || 0) + 1));
  return counts;
};

const sumOver = (values, fn) => (values.length ? values : [-1]).reduce((total, value) => total + fn(value), 0);

const hasGroup = (entry, group) => !!(entry.groups && entry.groups.indexOf(group) >= 0);

// Correspondance d'un joueur à un terme d'exigence combinée (première valeur seulement, comme EA).
const termMatcher = (term) => {
  const value = term.values.length ? term.values[0] : -1;
  switch (term.key) {
    case "NATION_ID":
      return { chem: null, test: (entry) => entry.nationId === value };
    case "LEAGUE_ID":
      return { chem: null, test: (entry) => entry.leagueId === value };
    case "CLUB_ID":
      return { chem: null, test: (entry) => entry.clubId === value };
    case "PLAYER_MIN_OVR":
      return { chem: null, test: (entry) => entry.rating >= value };
    case "PLAYER_MAX_OVR":
      return { chem: null, test: (entry) => entry.rating <= value };
    case "PLAYER_EXACT_OVR":
      return { chem: null, test: (entry) => entry.rating === value };
    case "PLAYER_TRADABILITY":
      return { chem: null, test: (entry) => entry.tradable === (value === 0) };
    case "ALL_PLAYERS_CHEMISTRY_POINTS":
      return { chem: value, test: () => true };
    default:
      return { chem: null, test: () => false };
  }
};

// Contribution d'un joueur aux exigences « nombre de joueurs » (somme sur les valeurs, comme EA).
const countMatcher = (req, linkedTeam) => {
  const values = req.values;
  const first = req.value;
  switch (req.key) {
    case "NATION_ID":
      return (entry) => sumOver(values, (value) => (entry.nationId === value ? 1 : 0));
    case "LEAGUE_ID":
      return (entry) => sumOver(values, (value) => (entry.leagueId === value ? 1 : 0));
    case "CLUB_ID": {
      // EA : clubs demandés + leurs clubs liés, comparés au club lié du joueur.
      const wanted = new Set();
      values.forEach((value) => {
        wanted.add(value);
        wanted.add(linkedTeam(value));
      });
      return (entry) => (wanted.has(entry.clubId) ? 1 : 0);
    }
    case "PLAYER_LEVEL":
      return (entry) => sumOver(values, (value) => (entry.tier === value ? 1 : 0));
    case "PLAYER_RARITY":
      return (entry) => sumOver(values, (value) => (entry.rareflag === value ? 1 : 0));
    case "PLAYER_RARITY_GROUP":
      return (entry) => sumOver(values, (value) => (hasGroup(entry, value) ? 1 : 0));
    case "PLAYER_MIN_OVR":
      return (entry) => (entry.rating >= first ? 1 : 0);
    case "PLAYER_MAX_OVR":
      return (entry) => (entry.rating <= first ? 1 : 0);
    case "PLAYER_EXACT_OVR":
      return (entry) => (entry.rating === first ? 1 : 0);
    case "PLAYER_TRADABILITY":
      return (entry) => (entry.tradable === (first === 0) ? 1 : 0);
    case "LEGEND_COUNT":
      return (entry) => (entry.legend ? 1 : 0);
    case "FIRST_OWNER_PLAYERS_COUNT":
      return (entry) => (entry.firstOwner ? Math.max(1, values.length) : 0);
    default:
      return () => 0;
  }
};

// Poids d'un écart dans la « violation » totale (unités comparables pour le solveur).
const WEIGHTS = { rating: 3, chemTotal: 0.5, chemAll: 0.6 };

// Exigence normalisée → contrôle { kind, scope, target, needsChem, weight, evaluate(view) }.
// evaluate renvoie { met, actual, target, deficit } (deficit > 0 seulement si non remplie).
export const compileCheck = (req, { float = true, linkedTeam = (id) => id } = {}) => {
  const scope = req.scope;
  const base = { req, index: req.index, label: req.label, key: req.key, scope, supported: req.supported, needsChem: false, weight: 1 };
  if (!req.supported) {
    return Object.assign(base, {
      kind: "unsupported",
      target: req.combined ? req.count : req.value,
      evaluate: () => ({ met: false, actual: null, target: null, deficit: 0 }),
    });
  }
  if (req.combined) {
    const matchers = req.terms.map(termMatcher);
    const chemTerms = matchers.filter((matcher) => matcher.chem != null);
    const staticMatch = (entry) => matchers.every((matcher) => matcher.test(entry));
    const target = req.count;
    return Object.assign(base, {
      kind: "combined",
      target,
      needsChem: chemTerms.length > 0,
      match: (entry) => (staticMatch(entry) ? 1 : 0),
      evaluate: (view) => {
        let actual = 0;
        view.bySlot.forEach((entry, index) => {
          if (!entry || view.kinds[index] !== "open" || !staticMatch(entry)) {
            return;
          }
          if (chemTerms.length && !(view.chem && chemTerms.every((matcher) => view.chem.slots[index] === matcher.chem))) {
            return;
          }
          actual += 1;
        });
        return { met: compare(actual, target, scope), actual, target, deficit: gapOf(actual, target, scope) };
      },
    });
  }
  switch (req.key) {
    case "TEAM_RATING":
    case "TEAM_STAR_RATING": {
      const stars = req.key === "TEAM_STAR_RATING";
      const target = req.value;
      const min =
        scope === SCOPE.GREATER || scope === SCOPE.EXACT ? (stars ? minRatingForStars(target) : target) : null;
      const max = scope === SCOPE.LOWER || scope === SCOPE.EXACT ? (stars ? maxRatingForStars(target) : target) : null;
      return Object.assign(base, {
        kind: "rating",
        target,
        weight: WEIGHTS.rating,
        minRating: min,
        maxRating: max,
        evaluate: (view) => {
          const { rating, gap } = ratingGap(view.ratings, float, min, max);
          const actual = stars ? starRating(rating) : rating;
          const met = compare(actual, target, scope);
          return { met, actual, rating, target, deficit: met ? 0 : Math.max(gap, 0.01) };
        },
      });
    }
    case "CHEMISTRY_POINTS": {
      const target = req.value;
      return Object.assign(base, {
        kind: "chemTotal",
        target,
        needsChem: true,
        weight: WEIGHTS.chemTotal,
        evaluate: (view) => {
          const actual = view.chem ? view.chem.total : 0;
          return { met: compare(actual, target, scope), actual, target, deficit: gapOf(actual, target, scope) };
        },
      });
    }
    case "ALL_PLAYERS_CHEMISTRY_POINTS": {
      const target = req.value;
      return Object.assign(base, {
        kind: "chemAll",
        target,
        needsChem: true,
        weight: WEIGHTS.chemAll,
        evaluate: (view) => {
          // EA : postes hors briques simples (briques personnalisées comprises), tous au niveau demandé.
          const counted = view.kinds.map((kind, index) => index).filter((index) => view.kinds[index] !== "simple");
          const chem = (index) => (view.chem ? view.chem.slots[index] || 0 : 0);
          const ok = counted.filter((index) =>
            scope === SCOPE.GREATER ? chem(index) >= target : scope === SCOPE.LOWER ? chem(index) <= target : chem(index) === target
          ).length;
          const met = scope === SCOPE.GREATER ? counted.length <= ok : scope === SCOPE.LOWER ? ok <= counted.length : ok === counted.length;
          const deficit = met
            ? 0
            : counted.reduce((total, index) => total + gapOf(chem(index), target, scope === SCOPE.EXACT ? SCOPE.EXACT : scope), 0);
          return { met, actual: ok, total: counted.length, target, deficit: met ? 0 : Math.max(deficit, 0.5) };
        },
      });
    }
    case "PLAYER_QUALITY": {
      const target = req.value;
      const bad = (entry) => (scope === SCOPE.GREATER ? entry.tier < target : scope === SCOPE.LOWER ? entry.tier > target : entry.tier !== target);
      return Object.assign(base, {
        kind: "quality",
        target,
        bad,
        evaluate: (view) => {
          const tiers = Array.from(new Set(view.players.map((entry) => entry.tier)));
          let actual = -1;
          if (tiers.length) {
            actual = scope === SCOPE.GREATER ? Math.min(...tiers) : scope === SCOPE.LOWER ? Math.max(...tiers) : tiers.length === 1 ? tiers[0] : -1;
          }
          const met = compare(actual, target, scope);
          const offenders = view.players.filter(bad).length;
          return { met, actual, target, deficit: met ? 0 : Math.max(1, offenders) };
        },
      });
    }
    case "SAME_NATION_COUNT":
    case "SAME_LEAGUE_COUNT":
    case "SAME_CLUB_COUNT": {
      const field = ATTRS[req.key.split("_")[1]];
      const target = req.value;
      return Object.assign(base, {
        kind: "group",
        field,
        target,
        evaluate: (view) => {
          const counts = Array.from(countValues(view.players, field).values());
          const actual = counts.length ? Math.max(...counts) : 0;
          // EA : groupe le plus grand (Math.max d'une liste vide = -Infinity : « au plus » rempli).
          const met = counts.length ? compare(actual, target, scope) : scope === SCOPE.LOWER;
          if (met) {
            return { met, actual, target, deficit: 0 };
          }
          const excess = counts.reduce((total, count) => total + Math.max(0, count - target), 0);
          const deficit = scope === SCOPE.LOWER || (scope === SCOPE.EXACT && actual > target) ? excess : target - actual;
          return { met, actual, target, deficit: Math.max(deficit, 1) };
        },
      });
    }
    case "NATION_COUNT":
    case "LEAGUE_COUNT":
    case "CLUB_COUNT": {
      const field = ATTRS[req.key.split("_")[0]];
      const target = req.value;
      return Object.assign(base, {
        kind: "distinct",
        field,
        target,
        evaluate: (view) => {
          const actual = countValues(view.players, field).size;
          return { met: compare(actual, target, scope), actual, target, deficit: gapOf(actual, target, scope) };
        },
      });
    }
    case "NATION_ID":
    case "LEAGUE_ID":
    case "CLUB_ID":
    case "PLAYER_LEVEL":
    case "PLAYER_RARITY":
    case "PLAYER_RARITY_GROUP":
    case "PLAYER_MIN_OVR":
    case "PLAYER_MAX_OVR":
    case "PLAYER_EXACT_OVR":
    case "PLAYER_TRADABILITY":
    case "LEGEND_COUNT":
    case "FIRST_OWNER_PLAYERS_COUNT": {
      const match = countMatcher(req, linkedTeam);
      // LEGEND_COUNT et FIRST_OWNER comparent à la valeur, les autres au nombre de joueurs demandé.
      const target = req.key === "LEGEND_COUNT" || req.key === "FIRST_OWNER_PLAYERS_COUNT" ? req.value : req.count;
      return Object.assign(base, {
        kind: "count",
        target,
        match,
        evaluate: (view) => {
          const actual = view.players.reduce((total, entry) => total + match(entry), 0);
          return { met: compare(actual, target, scope), actual, target, deficit: gapOf(actual, target, scope) };
        },
      });
    }
    default:
      return Object.assign(base, {
        kind: "unsupported",
        supported: false,
        target: req.value,
        evaluate: () => ({ met: false, actual: null, target: null, deficit: 0 }),
      });
  }
};

export const compileChecks = (requirements, options) => requirements.map((req) => compileCheck(req, options));

// ------------------------------------------------------------------ vue d'équipe

// slots : 11 postes { index, position, brick: false | "simple" | "custom", fixed } ; bySlot : entrée
// placée à chaque poste ouvert (null = vide). chemistry : fonction de collectifs ou null.
export const buildView = (slots, bySlot, chemistry = null) => {
  const kinds = slots.map((slot) => (slot.brick === "simple" ? "simple" : slot.brick ? "custom" : "open"));
  const full = slots.map((slot, index) => (kinds[index] === "custom" ? slot.fixed || null : kinds[index] === "open" ? bySlot[index] || null : null));
  const players = full.filter((entry, index) => entry && kinds[index] === "open");
  const ratings = full.map((entry, index) => (entry && kinds[index] === "open" ? Number(entry.rating) || 0 : 0));
  const chem = chemistry ? chemistry(slots, full) : null;
  const open = kinds.filter((kind) => kind === "open").length;
  return { kinds, bySlot: full, players, ratings, chem, open, filled: players.length };
};

// Évalue toutes les exigences : { met, full, checks: [...], rating, violation }.
export const evaluateView = (checks, view, { operation = "AND", float = true } = {}) => {
  const results = checks.map((check) => Object.assign({ check }, check.evaluate(view)));
  const full = view.filled >= view.open;
  const supported = results.filter((result) => result.check.supported);
  const deficits = supported.map((result) => (result.met ? 0 : result.check.weight * Math.max(result.deficit, 0.01)));
  let violation = operation === "OR" ? (deficits.length ? Math.min(...deficits) : 0) : deficits.reduce((total, value) => total + value, 0);
  violation += (view.open - view.filled) * 5;
  const allMet = operation === "OR" ? results.some((result) => result.met) : results.every((result) => result.met);
  return {
    met: full && (results.length ? allMet : operation !== "OR"),
    full,
    checks: results,
    rating: squadRating(view.ratings, float),
    chemistry: view.chem ? view.chem.total : null,
    violation,
  };
};
