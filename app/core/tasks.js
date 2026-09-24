import { createCancelToken } from "./async";

// Tâches manuelles (achat des manquants d'un DCE, mise en vente groupée) : une seule à la fois,
// et jamais en même temps que le bot, pour ne pas multiplier les requêtes envoyées à EA.

let current = null;
const listeners = new Set();

const emit = () =>
  listeners.forEach((fn) => {
    try {
      fn(current);
    } catch (e) {}
  });

export const currentTask = () => current;

export const onTaskChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Renvoie la tâche (avec son jeton d'annulation) ou null si une autre tâche est en cours.
export const beginTask = (label) => {
  if (current) {
    return null;
  }
  current = { label, token: createCancelToken(), startedAt: Date.now() };
  emit();
  return current;
};

export const endTask = (task) => {
  if (task && current === task) {
    current = null;
    emit();
  }
};

export const cancelTask = () => {
  if (current) {
    current.token.cancel();
  }
};
