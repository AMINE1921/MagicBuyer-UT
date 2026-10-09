import { loadJson, saveJson } from "../core/storage";

// Score d'objet FUTBIN (points de galerie, icône gemme) de chaque carte, par identifiant EA.
// Il ne dépend pas du marché : gardé 7 jours. Sources : page joueur (« 35.62K », arrondi),
// listes de joueurs et collections de la galerie (valeur exacte, prioritaire).

const STORAGE_KEY = "itemScores";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;

// id → [score, exact (1/0), date]
let scores = {};
const listeners = new Set();
let saveTimer = null;

(() => {
  const stored = loadJson(STORAGE_KEY, {}) || {};
  const cutoff = Date.now() - MAX_AGE;
  Object.keys(stored).forEach((key) => {
    const entry = stored[key];
    if (Array.isArray(entry) && entry[0] > 0 && entry[2] > cutoff) {
      scores[key] = entry;
    }
  });
})();

const persistSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keys = Object.keys(scores);
    if (keys.length > MAX_ENTRIES) {
      const kept = {};
      keys
        .sort((a, b) => scores[b][2] - scores[a][2])
        .slice(0, MAX_ENTRIES)
        .forEach((key) => {
          kept[key] = scores[key];
        });
      scores = kept;
    }
    saveJson(STORAGE_KEY, scores);
  }, 3000);
};

export const onItemScore = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getItemScore = (definitionId) => {
  const entry = scores[Number(definitionId)];
  return entry ? { score: entry[0], exact: !!entry[1], at: entry[2] } : null;
};

// Une valeur arrondie ne remplace jamais une valeur exacte récente.
export const setItemScore = (definitionId, score, exact) => {
  const id = Number(definitionId) || 0;
  const value = Math.round(Number(score) || 0);
  if (!id || value <= 0) {
    return;
  }
  const previous = scores[id];
  const now = Date.now();
  if (previous && previous[1] && !exact && now - previous[2] < MAX_AGE && Math.abs(previous[0] - value) <= value * 0.01) {
    return;
  }
  const changed = !previous || previous[0] !== value;
  scores[id] = [value, exact ? 1 : 0, now];
  persistSoon();
  if (changed) {
    listeners.forEach((fn) => {
      try {
        fn(id, value);
      } catch (e) {}
    });
  }
};

// Utilisé par les tests.
export const resetItemScoresForTests = () => {
  scores = {};
  clearTimeout(saveTimer);
};
