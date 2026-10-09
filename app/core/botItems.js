import { loadJson, saveJson } from "./storage";

// Cartes achetées par le bot (identifiants d'objet EA, gardés entre les sessions) : « Jamais à
// perte » s'applique toujours à elles ; pour les autres cartes de la liste des transferts (achetées
// à la main, packs…), l'utilisateur peut autoriser la vente rapide au prix du marché.

const KEY = "botItems";
const MAX = 3000;

let ids = null;

const load = () => {
  if (!ids) {
    const raw = loadJson(KEY, []);
    ids = new Map((Array.isArray(raw) ? raw : []).filter((entry) => Array.isArray(entry) && entry[0]).map((entry) => [String(entry[0]), Number(entry[1]) || 0]));
  }
  return ids;
};

export const rememberBotItem = (item, price = 0) => {
  const id = item && item.id != null ? String(item.id) : "";
  if (!id) {
    return;
  }
  const map = load();
  map.delete(id);
  map.set(id, Number(price) || 0);
  while (map.size > MAX) {
    map.delete(map.keys().next().value);
  }
  saveJson(KEY, Array.from(map.entries()));
};

export const isBotItem = (item) => {
  const id = item && item.id != null ? String(item.id) : "";
  return !!id && load().has(id);
};

// Utilisé par les tests.
export const resetBotItemsForTests = () => {
  ids = new Map();
  saveJson(KEY, []);
};
