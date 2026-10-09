import { observe, sleep } from "./async";
import { KIND, isFatal } from "./errors";
import { buildCriteria, cacheBusterPrices, normalizeFilter } from "./filters";
import { errorMessage, log } from "./logger";
import * as market from "./market";
import { getCoins, pageArrayOf, pageGlobal, repositories, services } from "./page";
import { floorPrice, formatCoins, priceAbove, toInt } from "./prices";
import { pickSeconds } from "./ranges";
import { getSettings } from "./settings";
import { recordTransaction, updateState } from "./state";
import { usageLimitMessage } from "./usage";
import { t } from "../i18n";
import { fetchFutbinSquad } from "../prices/futbinClient";
import {
  currentPrice,
  getPriceRecord,
  pricePlatform,
  requestPrice,
  seedFutbinPrice,
  trackPrice,
} from "../prices/priceService";

// Défis de création d'équipe (DCE / SBC) : import d'une solution FUTBIN dans l'équipe du défi,
// puis achat des joueurs manquants au prix FUTBIN (modifiable). Le défi n'est jamais envoyé
// automatiquement : c'est toujours toi qui cliques sur « Envoyer ».

const FIELD_PLAYERS = 11;
const TOTAL_PLAYERS = 23;
const SBC_PRICE_MAX_AGE = 5 * 60 * 1000;

const call = (target, method, ...args) => {
  try {
    return target && typeof target[method] === "function" ? target[method](...args) : undefined;
  } catch (e) {
    return undefined;
  }
};

// ------------------------------------------------------------------ contexte

export const sbcContext = (ctrl) => {
  if (!ctrl) {
    return null;
  }
  const challenge = ctrl._challenge || null;
  const squad = ctrl._squad || (challenge && challenge.squad) || null;
  if (!challenge || !squad || typeof squad.getSlot !== "function") {
    return null;
  }
  return { ctrl, challenge, squad };
};

// Postes du défi (11 titulaires) pour la formation actuelle ou une autre formation.
export const readSlots = (squad, formationOverride) => {
  const formation = formationOverride || call(squad, "getFormation") || null;
  const slots = [];
  for (let index = 0; index < FIELD_PLAYERS; index += 1) {
    const slot = call(squad, "getSlot", index);
    if (!slot) {
      continue;
    }
    const position = formation ? call(formation, "getPosition", index) : null;
    const item = slot.item || null;
    const filled = !!call(slot, "isValid");
    const typeId = position && position.typeId != null ? Number(position.typeId) : Number(slot.generalPosition);
    slots.push({
      index,
      brick: !!call(slot, "isBrick"),
      generalPosition: Number.isFinite(typeId) ? typeId : -1,
      typeName: String((position && position.typeName) || slot.generalPositionName || positionName(typeId) || ""),
      filled,
      definitionId: filled && item ? Number(item.definitionId) || 0 : 0,
    });
  }
  return { formation, slots };
};

// Nom d'un poste EA à partir de son identifiant (énumération PlayerPosition du web app : 5 → "CB").
const positionName = (typeId) => {
  try {
    const names = pageGlobal("PlayerPosition");
    const name = names && names[typeId];
    return typeof name === "string" ? name : "";
  } catch (e) {
    return "";
  }
};

// ----------------------------------------------------------------- formation

const digits = (value) => String(value || "").replace(/\D+/g, "");

export const formationLabel = (formation) =>
  (formation && (formation.displayName || call(formation, "getDisplayName") || formation.name)) || "";

// Formation EA correspondant à la clé FUTBIN ("4-3-3(4)" → "4334").
export const findFormation = (key) => {
  if (!key) {
    return null;
  }
  try {
    const repo = repositories() && repositories().Squad;
    const list = repo && typeof repo.getFormations === "function" ? Array.from(repo.getFormations()) : [];
    return (
      list.find((formation) => digits(formationLabel(formation)) === key) ||
      list.find((formation) => digits(formation.name) === key) ||
      null
    );
  } catch (e) {
    return null;
  }
};

// ------------------------------------------------------------------ placement

const POSITION_ALIASES = {
  GB: "GK",
  G: "GK",
  DC: "CB",
  DD: "RB",
  DG: "LB",
  DLD: "RWB",
  DLG: "LWB",
  MDC: "CDM",
  MC: "CM",
  MOC: "CAM",
  MD: "RM",
  MG: "LM",
  AD: "RW",
  AG: "LW",
  BU: "ST",
  AT: "CF",
  RCB: "CB",
  LCB: "CB",
  RDM: "CDM",
  LDM: "CDM",
  RCM: "CM",
  LCM: "CM",
  RAM: "CAM",
  LAM: "CAM",
  RS: "ST",
  LS: "ST",
};

export const normalizePosition = (label) => {
  const up = String(label || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return POSITION_ALIASES[up] || up;
};

const possiblePositions = (item) => {
  try {
    const list = item && item.possiblePositions;
    if (list && typeof list.length === "number" && list.length) {
      return Array.from(list).map(Number);
    }
    const preferred = Number(item && item.preferredPosition);
    return Number.isFinite(preferred) && preferred >= 0 ? [preferred] : null;
  } catch (e) {
    return null;
  }
};

// Poste jouable : postes possibles de la carte EA, sinon ceux indiqués par FUTBIN.
const fits = (entry, slot) => {
  const positions = entry.item ? possiblePositions(entry.item) : null;
  if (positions) {
    return positions.includes(slot.generalPosition);
  }
  const slotName = normalizePosition(slot.typeName);
  const futbinPositions = (entry.player.positions || []).map(normalizePosition).filter(Boolean);
  if (futbinPositions.length && slotName) {
    return futbinPositions.includes(slotName);
  }
  const label = normalizePosition(entry.player.position);
  if (label && slotName) {
    return slotName === label;
  }
  return true;
};

// Postes possibles d'une entrée : d'abord le poste exact de la solution FUTBIN (même disposition,
// donc même collectif), sinon les postes où le joueur est jouable.
const eligibleSlots = (entry, open) => {
  const wanted = normalizePosition(entry.player.slotPosition);
  if (wanted) {
    const same = open.filter((slot) => normalizePosition(slot.typeName) === wanted);
    if (same.length) {
      return same.map((slot) => slot.index);
    }
  }
  return open.filter((slot) => fits(entry, slot)).map((slot) => slot.index);
};

// Affecte chaque joueur à un poste où il est jouable (couplage maximum) ; les autres
// prennent les postes restants. Renvoie l'index de poste de chaque entrée (-1 si aucun).
export const planPlacement = (slots, entries) => {
  const open = slots.filter((slot) => !slot.brick);
  const eligible = entries.map((entry) => eligibleSlots(entry, open));
  const owner = new Map();
  // Premier poste libre d'abord (garde l'ordre de la solution), sinon on déplace un joueur déjà placé.
  const assign = (entryIndex, seen) => {
    const options = eligible[entryIndex];
    const free = options.find((slotIndex) => !owner.has(slotIndex) && !seen.has(slotIndex));
    if (free !== undefined) {
      seen.add(free);
      owner.set(free, entryIndex);
      return true;
    }
    for (const slotIndex of options) {
      if (seen.has(slotIndex)) {
        continue;
      }
      seen.add(slotIndex);
      if (assign(owner.get(slotIndex), seen)) {
        owner.set(slotIndex, entryIndex);
        return true;
      }
    }
    return false;
  };
  entries.forEach((_, entryIndex) => assign(entryIndex, new Set()));
  const result = entries.map(() => -1);
  owner.forEach((entryIndex, slotIndex) => {
    result[entryIndex] = slotIndex;
  });
  const free = open.map((slot) => slot.index).filter((index) => !owner.has(index));
  result.forEach((slotIndex, entryIndex) => {
    if (slotIndex < 0 && free.length) {
      result[entryIndex] = free.shift();
    }
  });
  return result;
};

// ------------------------------------------------------------- cartes du club

const betterOwned = (candidate, current) => {
  if (!current) {
    return true;
  }
  // Non échangeable d'abord (aucune valeur au marché), puis stockage DCE (doublons) avant le club.
  const rank = (entry) => (entry.item.tradable ? 2 : 0) + (entry.source === "stockage" ? 0 : 1);
  return rank(candidate) < rank(current);
};

// Cartes possédées (club + stockage DCE) pour les versions exactes demandées. Les prêts sont exclus,
// ainsi qu'une carte de note inférieure à celle de la solution (autre version du joueur).
export const findOwnedItems = async (definitionIds, minRatings = new Map()) => {
  const wanted = Array.from(new Set(definitionIds.map(Number).filter(Boolean)));
  const found = new Map();
  const errors = [];
  const rules = getSettings().sbc || {};
  // Jamais dans un défi : joueurs de l'équipe active (réglage), inscrits à une évolution en cours,
  // joueurs évolués (réglage) — EA les retirerait du club à l'envoi.
  let squad = new Set();
  if (wanted.length && rules.excludeActiveSquad !== false) {
    const active = await market.activeSquadItemIds();
    if (active.ok) {
      squad = active.ids;
    } else {
      errors.push({ code: 0, kind: "other", label: t("sbc.squadUnread") });
    }
  }
  const consider = (item, source) => {
    const id = Number(item && item.definitionId) || 0;
    if (!id || !wanted.includes(id) || call(item, "isLimitedUse")) {
      return;
    }
    if (squad.has(String(item.id)) || call(item, "isEnrolledInAcademy") || (rules.excludeEvolved !== false && item.upgrades)) {
      return;
    }
    const minRating = minRatings.get(id) || 0;
    if (minRating && Number(item.rating) && Number(item.rating) < minRating) {
      return;
    }
    const entry = { item, source };
    if (betterOwned(entry, found.get(id))) {
      found.set(id, entry);
    }
  };
  if (!wanted.length) {
    return { found, errors };
  }
  const club = await market.searchClubItems(wanted);
  if (club.ok) {
    club.items.forEach((item) => consider(item, "club"));
  } else if (club.error) {
    errors.push(club.error);
  }
  const storage = await market.searchStorageItems(wanted);
  if (storage.ok) {
    storage.items.forEach((item) => consider(item, "stockage"));
  } else if (storage.error) {
    errors.push(storage.error);
  }
  return { found, errors };
};

// ------------------------------------------------------------------- session

// Prix FUTBIN lu en direct (plateforme du compte, moins de 5 min). Le prix affiché sur la page
// d'équipe FUTBIN n'est qu'indicatif (autre plateforme possible) : jamais utilisé pour acheter.
const livePrice = (entry, use = "display") => currentPrice(entry.player.eaId, SBC_PRICE_MAX_AGE, use);

// Prix max d'achat d'un manquant : saisi à la main, sinon prix FUTBIN en direct + marge (0 si inconnu).
export const maxPriceFor = (entry) => {
  if (entry.manual) {
    return floorPrice(entry.maxPrice);
  }
  const price = livePrice(entry, "buy");
  if (!price) {
    return 0;
  }
  const margin = Math.max(0, Math.min(50, Number(getSettings().sbc.margin) || 0));
  const computed = floorPrice((price * (100 + margin)) / 100);
  // Cartes bon marché : avec une marge, au moins un palier EA au-dessus du prix FUTBIN (650 → 700).
  return margin > 0 && computed <= price ? priceAbove(price) : computed;
};

// Prix affiché dans l'aperçu : FUTBIN en direct, sinon celui de la page d'équipe (indicatif).
export const entryPrice = (entry) => livePrice(entry) || toInt(entry.player.price) || 0;

// Charge une solution FUTBIN pour le défi ouvert : joueurs, formation, cartes déjà possédées.
export const loadSolution = async (ctrl, url) => {
  const ctx = sbcContext(ctrl);
  if (!ctx) {
    return { ok: false, message: t("sbc.errorOpenSquad") };
  }
  const res = await fetchFutbinSquad(url);
  if (!res.ok) {
    if (res.invalid) {
      return { ok: false, message: t("sbc.errorInvalidLink") };
    }
    if (res.blocked) {
      return { ok: false, message: t("sbc.errorBlocked") };
    }
    if (res.empty) {
      return { ok: false, message: t("sbc.errorNoPlayers") };
    }
    if (res.notFound) {
      return { ok: false, message: t("sbc.errorNotFound") };
    }
    return { ok: false, message: res.status ? t("sbc.errorNoResponseStatus", { status: res.status }) : t("sbc.errorNoResponse") };
  }
  const parsed = res.squad;
  const players = parsed.players.filter((player) => player.eaId).slice(0, FIELD_PLAYERS);
  if (!players.length) {
    return { ok: false, message: t("sbc.errorUnidentified") };
  }
  // Prix FUTBIN de la page d'équipe (plateforme du compte) : utilisés tout de suite, puis relus
  // sur la page de chaque joueur (le lien FUTBIN est déjà connu, sans recherche).
  const platform = pricePlatform();
  players.forEach((player) => {
    if (player.prices) {
      player.price = player.prices[platform] || 0;
    }
    seedFutbinPrice(player.eaId, {
      price: player.price,
      platform: player.prices ? platform : "",
      link: player.futbinId ? { futbinId: player.futbinId, url: player.url, name: player.name, rating: player.rating } : null,
    });
  });
  const minRatings = new Map(players.filter((player) => player.rating).map((player) => [player.eaId, player.rating]));
  const owned = await findOwnedItems(players.map((player) => player.eaId), minRatings);
  const formation = findFormation(parsed.formationKey);
  const session = {
    ctx,
    url,
    via: res.via,
    source: parsed.source || "",
    challengeName: parsed.challengeName || "",
    futbinFormation: parsed.formation || "",
    formation,
    entries: players.map((player) => {
      const hit = owned.found.get(player.eaId);
      return {
        player,
        item: hit ? hit.item : null,
        source: hit ? hit.source : null,
        state: hit ? "owned" : "missing",
        slot: -1,
        manual: false,
        maxPrice: 0,
        boughtPrice: 0,
        note: "",
      };
    }),
    ownedErrors: owned.errors,
    untrack: [],
  };
  session.entries.forEach((entry) => {
    const hint = { name: entry.player.name, rating: entry.player.rating };
    if (entry.state === "missing") {
      session.untrack.push(trackPrice(entry.player.eaId, hint, "hot"));
    } else if (!currentPrice(entry.player.eaId, SBC_PRICE_MAX_AGE)) {
      requestPrice(entry.player.eaId, hint);
    }
  });
  replan(session);
  return { ok: true, session };
};

export const releaseSession = (session) => {
  if (session && session.untrack) {
    session.untrack.forEach((untrack) => untrack());
    session.untrack = [];
  }
};

// Recalcule les postes avec la formation visée et les cartes connues.
export const replan = (session) => {
  const { slots } = readSlots(session.ctx.squad, session.formation);
  session.slots = slots;
  const plan = planPlacement(slots, session.entries);
  session.entries.forEach((entry, index) => {
    entry.slot = plan[index];
    const slot = slots.find((s) => s.index === entry.slot);
    entry.slotLabel = slot ? slot.typeName : "";
  });
  return session;
};

export const sessionSummary = (session) => {
  const missing = session.entries.filter((entry) => entry.state === "missing" || entry.state === "failed");
  const total = missing.reduce((sum, entry) => sum + (maxPriceFor(entry) || 0), 0);
  const unknown = missing.filter((entry) => !maxPriceFor(entry)).length;
  return {
    placed: session.entries.filter((entry) => entry.item).length,
    total: session.entries.length,
    missing: missing.length,
    budget: total,
    unknown,
    coins: getCoins(),
  };
};

const saveChallenge = async (ctx) => {
  const svc = services();
  if (!svc || !svc.SBC || typeof svc.SBC.saveChallenge !== "function") {
    return { success: false, status: -1 };
  }
  const response = await observe(svc.SBC.saveChallenge(ctx.challenge), 15000);
  if (response && response.success) {
    try {
      ctx.ctrl.getView().updateChallenge(ctx.challenge);
    } catch (e) {}
  }
  return response;
};

// Met la formation FUTBIN et place toutes les cartes connues, puis enregistre le défi.
export const applySession = async (session) => {
  const { squad } = session.ctx;
  try {
    const current = call(squad, "getFormation");
    if (session.formation && (!current || current.id !== session.formation.id)) {
      squad.setFormation(session.formation);
    }
    replan(session);
    const target = new Array(TOTAL_PLAYERS).fill(null);
    const keep = new Set();
    session.entries.forEach((entry) => {
      if (entry.item && entry.slot >= 0) {
        target[entry.slot] = entry.item;
        keep.add(entry.slot);
      }
    });
    // Les postes des manquants sont vidés : aucune ancienne carte ne bloque un futur placement.
    session.slots
      .filter((slot) => !slot.brick && slot.filled && !keep.has(slot.index))
      .forEach((slot) => call(squad, "removeItemFromSlot", slot.index));
    squad.setPlayers(pageArrayOf(target), true);
  } catch (e) {
    return { ok: false, message: t("sbc.errorPlacement", { error: errorMessage(e) }) };
  }
  const saved = await saveChallenge(session.ctx);
  if (!saved || !saved.success) {
    const code = (saved && ((saved.error && saved.error.code) || saved.status)) || "";
    return { ok: false, message: code ? t("sbc.errorNotSavedCode", { code }) : t("sbc.errorNotSaved") };
  }
  return { ok: true };
};

// --------------------------------------------------------- achat des manquants

const FATAL_KEYS = {
  [KIND.CAPTCHA]: "sbc.fatalCaptcha",
  [KIND.AUTH]: "sbc.fatalAuth",
  [KIND.BANNED]: "sbc.fatalBanned",
  [KIND.LOCKED]: "sbc.fatalLocked",
  [KIND.RATE]: "sbc.fatalRate",
  [KIND.BLOCKED]: "sbc.fatalBlocked",
  [KIND.FUNDS]: "sbc.fatalFunds",
};

const fatalMessage = (error) => (FATAL_KEYS[error.kind] ? t(FATAL_KEYS[error.kind]) : error.label);

// 426 (limitation EA) : arrêt aussi, comme 429 / 458 / 512 / 521.
const stopKind = (error) =>
  error &&
  (isFatal(error.kind) || error.kind === KIND.RATE || error.kind === KIND.BLOCKED || error.kind === KIND.FUNDS || Number(error.code) === 426);

const offersFor = (items, entry, maxPrice) =>
  items
    .map((item) => {
      const auction = market.auctionOf(item);
      const bin = auction ? toInt(auction.buyNowPrice) : 0;
      return { item, bin, auction };
    })
    .filter(
      (offer) =>
        offer.auction &&
        !offer.auction.tradeOwner &&
        Number(offer.item.definitionId) === entry.player.eaId &&
        offer.bin > 0 &&
        offer.bin <= maxPrice
    )
    .sort((a, b) => a.bin - b.bin || (Number(b.auction.expires) || 0) - (Number(a.auction.expires) || 0));

// Achète une carte manquante : recherche exacte (version précise) avec anti-cache, la moins chère d'abord.
const buyOne = async (entry, token, onUpdate) => {
  const settings = getSettings();
  // Paliers de prix (galerie) : un prix max par essai, du plus bas au plus haut, déjà plafonnés.
  const ladder = Array.isArray(entry.ladder) && entry.ladder.length ? entry.ladder : null;
  const tries = ladder ? ladder.length : Math.max(1, Math.min(30, toInt(settings.sbc.triesPerPlayer) || 6));
  const waitRange = entry.wait || settings.sbc.wait;
  for (let attempt = 0; attempt < tries && !token.cancelled; attempt += 1) {
    // Jamais au-dessus du prix max validé au lancement ; suit une baisse du prix FUTBIN.
    const live = ladder ? 0 : maxPriceFor(entry);
    const maxPrice = ladder
      ? ladder[attempt]
      : entry.frozenMax
      ? live
        ? Math.min(entry.frozenMax, live)
        : entry.frozenMax
      : live;
    if (!maxPrice) {
      entry.note = t("sbc.notePriceUnknown");
      return { ok: false, noPrice: true };
    }
    // Limite de recherches atteinte (pause auto du compteur Outils) : arrêt avant d'en envoyer d'autres.
    const stop = usageLimitMessage();
    if (stop) {
      return { ok: false, fatal: { kind: "usage", code: 0, label: stop } };
    }
    entry.note = t("sbc.noteSearching", { attempt: attempt + 1, tries, max: formatCoins(maxPrice) });
    onUpdate(entry);
    const filter = normalizeFilter({ name: entry.player.name, definitionId: entry.player.eaId, maxBuy: maxPrice });
    const bust = cacheBusterPrices(settings.timing.cacheBuster, attempt, {
      maxBuy: maxPrice,
      minBuy: 0,
      maxBid: 0,
      cap: settings.timing.cacheBusterMax,
    });
    const result = await market.searchMarket(
      buildCriteria(filter, { maxBuy: maxPrice, minBuy: bust.minBuy, maxBid: bust.maxBid, minBid: bust.minBid }),
      1
    );
    if (token.cancelled) {
      return { ok: false };
    }
    if (!result.ok) {
      if (stopKind(result.error)) {
        return { ok: false, fatal: result.error };
      }
      entry.note = t("sbc.noteSearchRefused", { error: result.error.label });
    } else {
      for (const offer of offersFor(result.items, entry, maxPrice).slice(0, 2)) {
        const coins = getCoins();
        if (coins && coins < offer.bin) {
          return { ok: false, fatal: { kind: KIND.FUNDS, code: 470, label: t("sbc.fatalFunds") } };
        }
        const buy = await market.bidOnItem(offer.item, offer.bin);
        if (buy.ok) {
          return { ok: true, item: offer.item, price: offer.bin };
        }
        if (stopKind(buy.error)) {
          return { ok: false, fatal: buy.error };
        }
        if (buy.error.kind !== KIND.GONE) {
          entry.note = t("sbc.noteBuyRefused", { error: buy.error.label });
          break;
        }
        entry.note = t("sbc.noteMissed");
        onUpdate(entry);
      }
    }
    if (attempt < tries - 1) {
      await sleep((pickSeconds(waitRange, "S") || 4) * 1000, token);
    }
  }
  return { ok: false };
};

// Achat d'une carte au prix FUTBIN (+ marge DCE), réutilisé par la galerie.
// entry : { player: { eaId, name, rating }, manual: false, frozenMax, note }
export const buyEntry = (entry, token, onUpdate = () => {}) => buyOne(entry, token, onUpdate);
export const describeFatal = (error) => fatalMessage(error);

// Achète les manquants un par un, les envoie au club et les place dans le défi.
export const buyMissing = async (session, { token, onUpdate = () => {} }) => {
  const report = { bought: 0, spent: 0, failed: 0, stopped: "" };
  const queue = session.entries.filter((entry) => entry.state === "missing" || entry.state === "failed");
  // Prix max figés au lancement : le budget affiché est un vrai plafond.
  queue.forEach((entry) => {
    entry.frozenMax = maxPriceFor(entry);
  });
  for (let index = 0; index < queue.length; index += 1) {
    const entry = queue[index];
    if (token.cancelled) {
      report.stopped = t("sbc.stopRequested");
      break;
    }
    entry.state = "searching";
    onUpdate(entry);
    let outcome;
    try {
      outcome = await buyOne(entry, token, onUpdate);
    } catch (e) {
      outcome = { ok: false };
      entry.note = errorMessage(e);
    }
    if (outcome.fatal) {
      entry.state = "failed";
      entry.note = fatalMessage(outcome.fatal);
      report.stopped = entry.note;
      onUpdate(entry);
      log.error(t("sbc.logBuyStopped", { reason: entry.note }));
      break;
    }
    if (!outcome.ok) {
      entry.state = token.cancelled ? "missing" : "failed";
      if (!token.cancelled) {
        // Note plus précise gardée : prix FUTBIN inconnu (toutes langues) ou « erreur inconnue » (texte français).
        const keepNote = outcome.noPrice || (entry.note && /inconnu/.test(entry.note));
        entry.note = keepNote ? entry.note : t("sbc.noteNoOffer");
        report.failed += 1;
      }
      onUpdate(entry);
      continue;
    }
    report.bought += 1;
    report.spent += outcome.price;
    entry.boughtPrice = outcome.price;
    log.buy(t("sbc.logBought", { name: entry.player.name, rating: entry.player.rating || "", price: formatCoins(outcome.price) }));
    recordTransaction({
      type: t("sbc.txBuy"),
      name: entry.player.name,
      rating: entry.player.rating,
      price: outcome.price,
      filter: t("sbc.txFilter"),
    });
    updateState({ coins: getCoins() });
    const moved = await market.moveItem(outcome.item, "CLUB");
    if (!moved.ok) {
      log.warn(t("sbc.logNotMoved", { name: entry.player.name, error: moved.error.label }));
    }
    entry.item = outcome.item;
    entry.source = "acheté";
    entry.state = "bought";
    entry.note = t("sbc.noteBought", { price: formatCoins(outcome.price) });
    onUpdate(entry);
    const placed = await applySession(session);
    if (!placed.ok) {
      entry.note += ` · ${placed.message}`;
      onUpdate(entry);
    }
    if (index < queue.length - 1 && !token.cancelled) {
      await sleep((pickSeconds(getSettings().sbc.wait, "S") || 4) * 1000, token);
    }
  }
  return report;
};

// Âge lisible du prix FUTBIN d'une carte (pour l'aperçu).
export const priceStatus = (entry) => {
  const record = getPriceRecord(entry.player.eaId);
  const fallback = entry.player.price ? t("sbc.priceSquadPage") : "";
  if (!record || !record.fetchedAt || !livePrice(entry)) {
    if (record && record.status === "miss") {
      return fallback ? `${fallback} · ${t("sbc.priceCardMissing")}` : t("sbc.priceCardMissingFutbin");
    }
    if (record && (record.status === "error" || record.status === "paused")) {
      return fallback ? `${fallback} · ${t("sbc.priceNoResponse")}` : t("sbc.priceNoResponse");
    }
    return fallback || t("sbc.priceLoading");
  }
  const seconds = Math.max(0, Math.round((Date.now() - record.fetchedAt) / 1000));
  return seconds < 60 ? t("sbc.priceAgeSeconds", { n: seconds }) : t("sbc.priceAgeMinutes", { n: Math.round(seconds / 60) });
};
