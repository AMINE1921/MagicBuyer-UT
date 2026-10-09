// Score d'une sélection de joueurs dans une collection de la galerie FC 27, calculé comme le
// constructeur FUTBIN (/27/gallery/set/…) :
// - base = somme des points (score d'objet) des joueurs choisis ;
// - pour chaque bonus (tag), seuls les joueurs qui portent ce tag comptent (et, si le bonus l'exige,
//   ceux marqués « premier propriétaire ») :
//   · MatchCount : compte = nombre de joueurs, points = somme de leurs points ;
//   · LargestGroup (facette ligue, club, nation ou joueur) : groupes de même valeur ; compte = plus
//     grand groupe, points = ceux du meilleur groupe (palier le plus haut, puis le plus de points) ;
//   · DistinctCount (facette) : compte = nombre de valeurs différentes, points = somme du meilleur
//     joueur de chaque valeur ;
// - palier du bonus = le plus haut dont le compte requis est atteint ;
//   bonus = arrondi inférieur de points × multiplicateur / 10 000 (300 = +3 %).
// Total = base + somme des bonus. Paliers de la collection : D, C, B, A, S (points requis).

const facetValue = (item, facet) => {
  switch (String(facet || "").toLowerCase()) {
    case "league":
      return item.league;
    case "club":
      return item.club;
    case "nation":
      return item.nation;
    case "player":
      return item.baseId;
    default:
      return null;
  }
};

const sumPoints = (items) => items.reduce((total, item) => total + (Number(item.points) || 0), 0);

// Groupes { count, points } d'un bonus pour les joueurs qui portent son tag.
const groupsFor = (tag, items) => {
  const aggregation = String(tag.aggregation || "MatchCount");
  if (aggregation === "MatchCount") {
    return [{ count: items.length, points: sumPoints(items) }];
  }
  const byValue = new Map();
  items.forEach((item) => {
    const value = facetValue(item, tag.facet);
    if (value == null || value === 0 || value === "") {
      return;
    }
    if (!byValue.has(value)) {
      byValue.set(value, []);
    }
    byValue.get(value).push(item);
  });
  const groups = Array.from(byValue.values());
  if (aggregation === "DistinctCount") {
    const points = groups.reduce((total, group) => total + Math.max(...group.map((item) => Number(item.points) || 0)), 0);
    return [{ count: groups.length, points }];
  }
  // LargestGroup
  return groups.map((group) => ({ count: group.length, points: sumPoints(group) }));
};

// Index du palier atteint pour un compte (-1 si aucun).
export const tierIndex = (tiers, count) => {
  for (let index = (tiers || []).length - 1; index >= 0; index -= 1) {
    if (count >= tiers[index].count) {
      return index;
    }
  }
  return -1;
};

// Détail d'un bonus pour une sélection : compte, palier, points bonus, prochain palier.
export const tagState = (tag, selection, firstOwnerIds) => {
  const owners = firstOwnerIds || new Set();
  const items = selection.filter(
    (item) => (item.tags || []).includes(tag.key) && (!tag.firstOwner || owners.has(item.key != null ? item.key : item.futbinId))
  );
  const groups = groupsFor(tag, items);
  const count = groups.reduce((best, group) => Math.max(best, group.count), 0);
  let best = null;
  groups.forEach((group) => {
    if (!best) {
      best = group;
      return;
    }
    const a = tierIndex(tag.tiers, group.count);
    const b = tierIndex(tag.tiers, best.count);
    if (a > b || (a === b && group.points > best.points)) {
      best = group;
    }
  });
  const index = tierIndex(tag.tiers, count);
  const tier = index >= 0 ? tag.tiers[index] : null;
  const bonus = tier && best ? Math.floor((best.points * tier.multiplier) / 10000) : 0;
  const next = (tag.tiers || []).find((candidate) => count < candidate.count) || null;
  return { key: tag.key, name: tag.name, count, tier, bonus, next, userDriven: !!tag.firstOwner };
};

// Score complet : { base, bonus, total, tags: [détail par bonus] }.
export const scoreSelection = (set, selection, firstOwnerIds) => {
  const chosen = selection || [];
  const base = sumPoints(chosen);
  const tags = (set.tags || []).map((tag) => tagState(tag, chosen, firstOwnerIds));
  const bonus = tags.reduce((total, tag) => total + tag.bonus, 0);
  return { base, bonus, total: base + bonus, tags };
};

// Palier atteint et progression vers le suivant.
export const gradeProgress = (tiers, total) => {
  const sorted = (tiers || []).slice().sort((a, b) => a.points - b.points);
  let current = null;
  let next = null;
  sorted.forEach((tier) => {
    if (total >= tier.points) {
      current = tier;
    } else if (!next) {
      next = tier;
    }
  });
  const floor = current ? current.points : 0;
  const ceiling = next ? next.points : floor;
  const percent = next ? Math.max(0, Math.min(100, ((total - floor) / Math.max(1, ceiling - floor)) * 100)) : 100;
  return { current, next, remaining: next ? Math.max(0, next.points - total) : 0, percent };
};

// Coût d'un joueur pour le plan : 0 s'il est possédé, sinon son prix FUTBIN (Infinity si hors marché).
const costOf = (item) => (item.owned ? 0 : item.price > 0 ? item.price : Infinity);

const keyOf = (item) => (item.key != null ? item.key : item.futbinId);

// Plan « le moins cher » pour atteindre un nombre de points avec exactement `size` joueurs
// (ou au plus `size` si la collection n'exige pas un nombre exact) :
// 1. joueurs possédés (gratuits), les plus forts d'abord ;
// 2. complété par les moins chers du marché ;
// 3. échanges successifs : on remplace un joueur acheté par celui qui apporte le plus de points par
//    pièce dépensée, jusqu'à atteindre l'objectif (ou plus aucun échange utile).
// candidates : [{ key, futbinId, points, price, owned, tags, league, club, nation, baseId }]
export const planSelection = (set, candidates, { target = 0, size = 0, exact = true, firstOwnerIds, maxRounds = 60 } = {}) => {
  const limit = size || (set.limit && set.limit.maxItems) || 20;
  const pool = (candidates || []).filter((item) => Number.isFinite(costOf(item)) && item.points > 0);
  const byKey = new Map();
  pool.forEach((item) => {
    const key = keyOf(item);
    const previous = byKey.get(key);
    if (!previous || costOf(item) < costOf(previous)) {
      byKey.set(key, item);
    }
  });
  const unique = Array.from(byKey.values());
  const owned = unique.filter((item) => item.owned).sort((a, b) => b.points - a.points);
  const market = unique.filter((item) => !item.owned).sort((a, b) => a.price - b.price || b.points - a.points);
  let selection = owned.slice(0, limit);
  const fillers = exact ? market.slice(0, Math.max(0, limit - selection.length)) : [];
  selection = selection.concat(fillers);
  const score = (list) => scoreSelection(set, list, firstOwnerIds).total;
  let current = score(selection);
  const selected = () => new Set(selection.map(keyOf));
  // Sans nombre exact exigé : on ajoute d'abord des joueurs tant qu'il reste de la place.
  for (let round = 0; round < maxRounds && current < target; round += 1) {
    const taken = selected();
    const outside = unique.filter((item) => !taken.has(keyOf(item)));
    let best = null;
    if (selection.length < limit) {
      outside.forEach((item) => {
        const next = score(selection.concat([item]));
        const gain = next - current;
        const cost = costOf(item);
        if (gain > 0) {
          const ratio = cost > 0 ? gain / cost : Infinity;
          if (!best || ratio > best.ratio) {
            best = { ratio, apply: () => selection.concat([item]), total: next };
          }
        }
      });
    } else {
      selection.forEach((leaving, index) => {
        outside.forEach((item) => {
          const extra = costOf(item) - costOf(leaving);
          const list = selection.slice();
          list[index] = item;
          const next = score(list);
          const gain = next - current;
          if (gain <= 0) {
            return;
          }
          const ratio = extra > 0 ? gain / extra : Infinity;
          if (!best || ratio > best.ratio || (ratio === best.ratio && next > best.total)) {
            best = { ratio, apply: () => list, total: next };
          }
        });
      });
    }
    if (!best) {
      break;
    }
    selection = best.apply();
    current = best.total;
  }
  const result = scoreSelection(set, selection, firstOwnerIds);
  const toBuy = selection.filter((item) => !item.owned);
  return {
    selection,
    toBuy,
    cost: toBuy.reduce((total, item) => total + (item.price || 0), 0),
    score: result,
    reached: result.total >= target,
    complete: !exact || selection.length === limit,
  };
};
