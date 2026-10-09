import { currentPrice } from "../prices/priceService";
import { t } from "../i18n";
import { errorMessage } from "./logger";
import { nameOf } from "./market";
import { FIELD_PLAYERS } from "./sbcEval";
import { failingSummary } from "./sbcRequirements";
import { isStopError } from "./sbcPool";
import { saveChallenge, verifyWithEa } from "./sbcSquad";

// Joueurs « concept » de l'équipe du défi affiché, posés par le solveur ou ajoutés à la main dans EA :
// cartes à acheter (même version exacte), puis chaque carte achetée remplace son concept à son poste
// (UTSquadEntity.addItemToSlot, appelée sans rien envelopper), l'équipe est contrôlée par EA
// (meetsRequirements) et enregistrée une fois. Le défi n'est jamais envoyé.

const PRICE_AGE = 60 * 60 * 1000;

// Cartes « à acheter » prévues par le solveur pour chaque défi (version, prix FUTBIN de la liste).
const planned = new Map();

const call = (target, method, ...args) => {
  try {
    return target && typeof target[method] === "function" ? target[method](...args) : undefined;
  } catch (e) {
    return undefined;
  }
};

const databaseIdOf = (item) => Number(item && item.databaseId) || (Number(item && item.definitionId) || 0) & 0xffffff;

// Le solveur a posé ces cartes en concept : leurs prix et versions FUTBIN servent au bouton d'achat.
export const rememberPlanned = (challengeId, entries) => {
  const byDefinition = new Map();
  (entries || []).forEach((entry) => {
    if (entry && entry.definitionId) {
      byDefinition.set(Number(entry.definitionId), {
        price: Number(entry.price) || 0,
        listedAt: Number(entry.listedAt) || 0,
        version: entry.version || "",
        futbinId: entry.futbinId || 0,
      });
    }
  });
  planned.set(String(challengeId), byDefinition);
};

export const plannedFor = (challengeId) => planned.get(String(challengeId)) || new Map();

// Joueurs concept des postes du défi (titulaires hors briques) : [{ slot, item, definitionId }].
export const conceptSlots = (squad) => {
  const list = [];
  for (let index = 0; index < FIELD_PLAYERS; index += 1) {
    const slot = call(squad, "getSlot", index);
    if (!slot || call(slot, "isBrick")) {
      continue;
    }
    const item = slot.item;
    const definitionId = Number(item && item.definitionId) || 0;
    if (item && item.concept === true && definitionId && call(item, "isValid") !== false) {
      list.push({ slot: index, item, definitionId });
    }
  }
  return list;
};

// Concepts → entrées « à acheter » (même forme que les cartes du marché : confirmation et sbcBuy).
// priceOf(definitionId) : prix FUTBIN connu (0 sinon) ; known : prévisions du solveur pour ce défi.
export const conceptTargets = (squad, { priceOf = (id) => currentPrice(id, PRICE_AGE, "buy"), known = new Map() } = {}) =>
  conceptSlots(squad).map(({ slot, item, definitionId }) => {
    const plan = known.get(definitionId) || null;
    const live = Number(priceOf(definitionId)) || 0;
    return {
      key: `c:${slot}:${definitionId}`,
      slot,
      conceptItem: item,
      market: true,
      definitionId,
      person: `d${definitionId & 0xffffff}`,
      name: nameOf(item),
      rating: Number(item.rating) || 0,
      version: plan ? plan.version : "",
      price: live || (plan ? plan.price : 0),
      listedAt: live ? 0 : plan ? plan.listedAt : 0,
      futbinId: plan ? plan.futbinId : 0,
    };
  });

// Total des prix connus et nombre de cartes sans prix FUTBIN (libellé du bouton).
export const conceptTotal = (targets) => ({
  total: targets.reduce((sum, entry) => sum + (Number(entry.price) || 0), 0),
  unknown: targets.filter((entry) => !(Number(entry.price) > 0)).length,
});

// Poste du concept que remplace une carte achetée : celui prévu s'il porte encore le concept du même
// joueur, sinon tout poste dont le concept est ce joueur (EA : compareDream, même databaseId).
export const slotForBought = (squad, entry, item) => {
  const wanted = databaseIdOf(item);
  const holds = (index) => {
    const slot = call(squad, "getSlot", index);
    return !!(slot && !call(slot, "isBrick") && slot.item && slot.item.concept === true && databaseIdOf(slot.item) === wanted);
  };
  if (entry && entry.slot != null && holds(entry.slot)) {
    return entry.slot;
  }
  for (let index = 0; index < FIELD_PLAYERS; index += 1) {
    if (holds(index)) {
      return index;
    }
  }
  return -1;
};

// Cartes achetées à la place de leurs concepts, contrôle EA (meetsRequirements, concepts restants
// permis), puis un enregistrement. Si EA ne valide pas l'équipe, les concepts sont remis et rien n'est
// enregistré. bought : [{ entry, item }]. Résultat : { ok, replaced, missing, failing?, message?, stopped? }.
export const replaceConcepts = async (ctx, bought) => {
  const { squad } = ctx;
  const replaced = [];
  const missing = [];
  try {
    bought.forEach(({ entry, item }) => {
      const index = slotForBought(squad, entry, item);
      if (index < 0) {
        missing.push(entry);
        return;
      }
      const previous = squad.addItemToSlot(index, item);
      replaced.push({ index, item, previous: previous || null, entry });
    });
  } catch (e) {
    revert(squad, replaced);
    return { ok: false, replaced: [], missing, message: t("solver.errPlacement", { error: errorMessage(e) }) };
  }
  if (!replaced.length) {
    return { ok: false, replaced, missing, message: t("solver.conceptNoSlot") };
  }
  const check = verifyWithEa(ctx, { allowConcept: true });
  if (!check.ok) {
    revert(squad, replaced);
    return {
      ok: false,
      rejected: true,
      replaced: [],
      missing,
      failing: check.failing,
      message: t("solver.conceptRejected", { failing: failingSummary(check.failing, 3) || t("solver.unknownRequirement") }),
    };
  }
  const saved = await saveChallenge(ctx);
  if (!saved.ok) {
    const error = saved.error || {};
    return {
      ok: false,
      saveFailed: true,
      stopped: isStopError(error),
      replaced,
      missing,
      message: error.code > 0 ? t("solver.errNotSavedCode", { code: error.code }) : t("solver.errNotSaved"),
    };
  }
  return { ok: true, replaced, missing, verified: check.met === true, remaining: conceptSlots(squad).length };
};

// Remet les concepts à la place des cartes posées (rien n'a été enregistré).
const revert = (squad, replaced) => {
  replaced
    .slice()
    .reverse()
    .forEach(({ index, previous }) => {
      if (previous) {
        try {
          squad.addItemToSlot(index, previous);
        } catch (e) {}
      }
    });
};

// Utilisé par les tests.
export const resetConceptsForTests = () => {
  planned.clear();
};
