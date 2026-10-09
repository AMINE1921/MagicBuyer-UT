import { plural, t } from "../i18n";
import { sleep } from "./async";
import { auctionOf, searchConceptPage } from "./market";
import { eaToast, getUser, pageGlobal, repositories } from "./page";
import { loadJson, saveJson } from "./storage";

// Collection de la galerie FC 27, telle qu'EA la connaît : chaque objet renvoyé par le serveur
// porte un champ isCollected (ignoré par le web app). Il est lu au passage sur tout ce que le web
// app charge (club, marché, packs, DCE…) et par la synchro (recherche concept par lots de 250).
// Une collection par compte (persona) ; une carte collectée le reste (EA ne la retire jamais).
// Pour chaque carte : le plus petit nombre de propriétaires vu (1 = premier propriétaire), 0 = inconnu.

const KEY = "galleryCollected";
const LEGACY_KEY = "galleryCollection";
// Codes EA de blocage temporaire (trop de requêtes) et d'arrêt : la synchro s'arrête aussitôt.
const STOP_CODES = new Set([401, 426, 429, 458, 512, 521]);
const CHUNK = 1000;
const PAGE = 250;

const stores = new Map();
const listeners = new Set();
let saveTimer = null;
let syncing = 0;
let hooked = false;

// Identifiant du compte (persona) du web app ; vide tant que personne n'est connecté.
export const personaId = () => {
  try {
    const user = getUser();
    if (!user) {
      return "";
    }
    const persona = typeof user.getSelectedPersona === "function" ? user.getSelectedPersona() : null;
    return String((persona && persona.id) || user.personaId || "default");
  } catch (e) {
    return "";
  }
};

const storeFor = (persona) => {
  if (!persona) {
    return null;
  }
  let store = stores.get(persona);
  if (!store) {
    const saved = loadJson(`${KEY}.${persona}`, null);
    store = {
      ids: (saved && saved.ids && typeof saved.ids === "object" && saved.ids) || {},
      syncedAt: (saved && Number(saved.syncedAt)) || 0,
      sets: (saved && saved.sets && typeof saved.sets === "object" && saved.sets) || {},
      migrated: !!(saved && saved.migrated),
    };
    // Ancien historique local (versions précédentes, sans compte) : repris une fois.
    if (!store.migrated) {
      (loadJson(LEGACY_KEY, []) || []).forEach((id) => {
        const n = Number(id) || 0;
        if (n && store.ids[n] === undefined) {
          store.ids[n] = 0;
        }
      });
      store.migrated = true;
      scheduleSave();
    }
    stores.set(persona, store);
  }
  return store;
};

const current = () => storeFor(personaId());

const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1500);
};

const saveNow = () => {
  clearTimeout(saveTimer);
  saveTimer = null;
  stores.forEach((store, persona) => {
    saveJson(`${KEY}.${persona}`, { ids: store.ids, syncedAt: store.syncedAt, sets: store.sets, migrated: store.migrated });
  });
};

const emit = () => {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });
};

export const onCollectionChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const isCollected = (definitionId) => {
  const store = current();
  return !!(store && store.ids[Number(definitionId) || 0] !== undefined);
};

// Plus petit nombre de propriétaires vu pour cette carte (1 = premier propriétaire), 0 = inconnu.
export const collectedOwners = (definitionId) => {
  const store = current();
  const value = store ? store.ids[Number(definitionId) || 0] : undefined;
  return value === undefined ? 0 : Number(value) || 0;
};

export const collectionSize = () => {
  const store = current();
  return store ? Object.keys(store.ids).length : 0;
};

export const syncInfo = () => {
  const store = current();
  return { syncedAt: store ? store.syncedAt : 0, sets: store ? store.sets : {}, size: collectionSize() };
};

export const setSyncedAt = (setId) => {
  const store = current();
  if (!store) {
    return 0;
  }
  return Math.max(store.syncedAt || 0, Number(store.sets[String(setId)]) || 0);
};

// Carte achetée par un outil MagicBuyer : collectée dès qu'elle arrive dans le club.
export const markCollected = (definitionIds, owners = 0) => {
  const store = current();
  if (!store) {
    return;
  }
  let changed = false;
  (definitionIds || []).forEach((id) => {
    const n = Number(id) || 0;
    if (n && store.ids[n] === undefined) {
      store.ids[n] = owners > 0 ? owners : 0;
      changed = true;
    }
  });
  if (changed) {
    scheduleSave();
    emit();
  }
};

const call = (target, method) => {
  try {
    return target && typeof target[method] === "function" ? target[method]() : undefined;
  } catch (e) {
    return undefined;
  }
};

// Propriétaires connus seulement pour tes propres cartes (pas une carte concept ni l'annonce d'un
// autre joueur, qui a ses propres propriétaires).
const ownersOf = (item) => {
  if (!item || item.concept) {
    return 0;
  }
  const auction = auctionOf(item);
  if (auction && Number(auction.tradeId) > 0 && !auction.tradeOwner) {
    return 0;
  }
  const owners = Number(item.owners) || 0;
  return owners > 0 ? owners : 0;
};

const nameOf = (item) => {
  try {
    const data = call(item, "getStaticData") || item._staticData || {};
    const known = data.knownAs && data.knownAs !== "---" ? data.knownAs : "";
    return String(known || data.name || data.lastName || "").trim();
  } catch (e) {
    return "";
  }
};

// Nouvelles cartes collectées vues hors synchro : au plus 3 noms, puis « N autres ».
const announce = (items) => {
  const names = items.map(nameOf).filter(Boolean);
  if (!names.length) {
    return;
  }
  names.slice(0, 3).forEach((name) => eaToast(t("gallery.toastAdded", { name }), false));
  if (names.length > 3) {
    eaToast(plural(names.length - 3, "gallery.toastAddedMoreOne", "gallery.toastAddedMoreMany"), false);
  }
};

const pending = [];
let flushTimer = null;

const flush = () => {
  clearTimeout(flushTimer);
  flushTimer = null;
  const items = pending.splice(0);
  const store = current();
  if (!store || !items.length) {
    return;
  }
  const added = [];
  let changed = false;
  items.forEach((item) => {
    if (!item.isCollected || !call(item, "isPlayer")) {
      return;
    }
    const id = Number(item.definitionId) || 0;
    if (!id) {
      return;
    }
    const owners = ownersOf(item);
    const previous = store.ids[id];
    if (previous === undefined) {
      store.ids[id] = owners;
      added.push(item);
      changed = true;
    } else if (owners && (!previous || owners < previous)) {
      store.ids[id] = owners;
      changed = true;
    }
  });
  if (!changed) {
    return;
  }
  scheduleSave();
  emit();
  // Pas de messages pendant une synchro ni avant la première (toute la collection serait annoncée).
  if (added.length && !syncing && store.syncedAt) {
    announce(added);
  }
};

const queue = (item) => {
  pending.push(item);
  if (!flushTimer) {
    flushTimer = setTimeout(flush, 250);
  }
};

// Lecture du champ isCollected sur chaque objet créé par le web app (EA ne s'en sert pas).
// createItem n'appelle pas this.superclass() : il peut être enveloppé sans risque.
export const hookCollection = () => {
  if (hooked) {
    return true;
  }
  const Factory = pageGlobal("UTItemEntityFactory");
  if (typeof Factory !== "function" || !Factory.prototype || typeof Factory.prototype.createItem !== "function") {
    return false;
  }
  if (!Factory.prototype.__mbCollected) {
    const original = Factory.prototype.createItem;
    Factory.prototype.createItem = function (raw) {
      const item = original.apply(this, arguments);
      try {
        if (raw && raw.isCollected !== undefined && item) {
          item.isCollected = !!raw.isCollected;
          queue(item);
        }
      } catch (e) {}
      return item;
    };
    Factory.prototype.__mbCollected = true;
  }
  hooked = true;
  return true;
};

// Tous les joueurs connus du web app (données statiques EA : une entrée par joueur).
export const allPlayerIds = () => {
  try {
    const repo = repositories();
    const values = repo && repo.Item && typeof repo.Item.getStaticData === "function" ? repo.Item.getStaticData() : null;
    return values ? Array.from(values, (entry) => Number(entry && entry.id) || 0).filter(Boolean) : [];
  } catch (e) {
    return [];
  }
};

const chunks = (list, size) => {
  const out = [];
  for (let index = 0; index < list.length; index += size) {
    out.push(list.slice(index, index + size));
  }
  return out;
};

// Attente entre deux pages : 1 à 1,5 s (réduite par les tests).
let pauseRange = [1000, 500];
const pause = (token) => sleep(pauseRange[0] + Math.random() * pauseRange[1], token);

export const setSyncPauseForTests = (min, spread = 0) => {
  pauseRange = [min, spread];
};

// Synchro : cartes concept des joueurs demandés (toutes leurs versions) par pages de 250, 1 à 1,5 s
// entre deux pages. ids absent = tous les joueurs (synchro complète) ; setId = synchro d'une
// collection (ids = ses joueurs éligibles). Arrêt immédiat sur blocage EA ; erreur serveur (5xx) :
// le lot est coupé en deux et réessayé, un joueur seul qui échoue encore est sauté.
export const syncCollection = async ({ ids = null, setId = "", token = null, onProgress = () => {} } = {}) => {
  const store = current();
  const report = { ok: false, pages: 0, scanned: 0, added: 0, skipped: 0, stopped: "", error: "", code: 0 };
  if (!store) {
    report.error = t("gallery.syncNoAccount");
    return report;
  }
  const wanted = Array.from(new Set((ids || allPlayerIds()).map(Number).filter(Boolean)));
  if (!wanted.length) {
    report.error = t("gallery.syncNoPlayers");
    return report;
  }
  const before = collectionSize();
  const todo = chunks(wanted, CHUNK);
  let done = 0;
  syncing += 1;
  try {
    while (todo.length) {
      if (token && token.cancelled) {
        report.stopped = t("tools.stopRequested");
        break;
      }
      const batch = todo.shift();
      let offset = 0;
      let complete = true;
      for (;;) {
        if (token && token.cancelled) {
          complete = false;
          break;
        }
        const page = await searchConceptPage(batch, { offset, count: PAGE });
        report.pages += 1;
        if (!page.ok) {
          const code = (page.error && page.error.code) || 0;
          if (STOP_CODES.has(code)) {
            report.error = (page.error && page.error.label) || t("misc.errUnknown");
            report.code = code;
            return report;
          }
          complete = false;
          if (code >= 500 && batch.length > 1 && offset === 0) {
            const half = Math.ceil(batch.length / 2);
            todo.unshift(batch.slice(0, half), batch.slice(half));
          } else {
            report.skipped += batch.length;
            done += batch.length;
          }
          break;
        }
        report.scanned += page.items.length;
        offset += page.items.length;
        // Les objets passent par createItem (isCollected lu) : on vide la file sans attendre.
        flush();
        onProgress({ done, total: wanted.length, pages: report.pages, added: collectionSize() - before });
        if (page.endOfList || !page.items.length) {
          break;
        }
        await pause(token);
      }
      if (complete) {
        done += batch.length;
      }
      onProgress({ done, total: wanted.length, pages: report.pages, added: collectionSize() - before });
      if (todo.length) {
        await pause(token);
      }
    }
    if (!report.stopped) {
      report.ok = true;
      if (setId) {
        store.sets[String(setId)] = Date.now();
      } else {
        store.syncedAt = Date.now();
      }
    }
  } finally {
    syncing -= 1;
    flush();
    report.added = collectionSize() - before;
    scheduleSave();
    emit();
  }
  return report;
};

export const isSyncing = () => syncing > 0;

// Utilisé par les tests.
export const resetCollectionForTests = () => {
  stores.clear();
  pending.splice(0);
  clearTimeout(flushTimer);
  flushTimer = null;
  syncing = 0;
  hooked = false;
};

export const flushCollectionForTests = () => {
  flush();
  saveNow();
};
