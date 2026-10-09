import { getSettings } from "../core/settings";
import { t } from "../i18n";
import { searchFutbinPlayers } from "./futbinApi";
import { fetchFutbinList, futbinYear, isFutbinListUrl } from "./futbinClient";
import { FUTBIN_ORIGIN } from "./futbinParse";
import { currentPrice, getPriceRecord, pricePlatform, requestPrice, seedFutbinPrice, trackPrice } from "./priceService";

// Cartes dont le prix FUTBIN sert à un filtre en mode « % du prix FUTBIN » :
// - version exacte (ID de version) : cette carte ;
// - joueur, toutes versions : ses versions trouvées sur FUTBIN (même identifiant de base EA) ;
// - critères (nation, ligue, club, poste, plage de notes) : les joueurs de la liste FUTBIN
//   correspondante (lien construit d'après les critères, ou lien de liste collé dans le filtre).
// Chaque carte a son propre prix : le bot achète une carte à X % de SON prix FUTBIN.

const VERSIONS_REFRESH = 30 * 60 * 1000;
const MAX_VERSIONS = 8;
const PRICE_MAX_AGE = 5 * 60 * 1000;

// Zones EA (défense / milieu / attaque) → postes FUTBIN.
const ZONE_POSITIONS = { 130: "CB,LB,RB,LWB,RWB", 131: "CDM,CM,CAM,LM,RM", 132: "ST,CF,LW,RW" };

const sets = new Map();
const listeners = new Set();

const emit = (set) =>
  listeners.forEach((fn) => {
    try {
      fn(set.key);
    } catch (e) {}
  });

export const onCardSetUpdate = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Lien de la liste FUTBIN du filtre : lien collé, sinon construit d'après les critères EA.
export const futbinListUrl = (filter) => {
  const custom = String((filter && filter.futbinList) || "").trim();
  if (custom) {
    return isFutbinListUrl(custom) ? custom : "";
  }
  if (!filter) {
    return "";
  }
  const params = [];
  if (filter.nation > 0) {
    params.push(["nation", filter.nation]);
  }
  if (filter.league > 0) {
    params.push(["league", filter.league]);
  }
  if (filter.club > 0) {
    params.push(["club", filter.club]);
  }
  if (filter.zone > 0 && ZONE_POSITIONS[filter.zone]) {
    params.push(["position", ZONE_POSITIONS[filter.zone]]);
  } else if (filter.position && filter.position !== "any") {
    params.push(["position", filter.position], ["pos_type", "main"]);
  }
  // Plage de notes (ex. 85–85, fourrage DCE) : liste des cartes les moins chères de ces notes,
  // triée par prix croissant (cartes sans prix exclues), qualité EA reprise si elle est choisie.
  const minRating = Number(filter.minRating) || 0;
  const maxRating = Number(filter.maxRating) || 0;
  const rated = minRating > 0 || maxRating > 0;
  if (!params.length && !rated) {
    return "";
  }
  if (["gold", "silver", "bronze"].includes(filter.level)) {
    params.unshift(["version", filter.level]);
  }
  if (rated) {
    const priceKey = pricePlatform() === "pc" ? "pc_price" : "ps_price";
    params.push(["player_rating", `${minRating || 40}-${maxRating || 99}`], [priceKey, "200-15000000"], ["sort", priceKey], ["order", "asc"]);
  }
  return `${FUTBIN_ORIGIN}/${futbinYear()}/players?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
};

export const cardSetKey = (filter) => {
  if (!filter || filter.priceMode !== "futbin") {
    return "";
  }
  if (filter.definitionId) {
    return `exact:${filter.definitionId}`;
  }
  if (filter.player && filter.player.id) {
    return `versions:${filter.player.id}`;
  }
  const url = futbinListUrl(filter);
  return url ? `list:${url}` : "";
};

const hintOf = (filter) => ({
  name: filter.player ? filter.player.name : "",
  rating: filter.player ? filter.player.rating : 0,
});

const linkOf = (card) =>
  card.futbinId ? { futbinId: card.futbinId, url: card.url, name: card.name, rating: card.rating } : null;

const setCards = (set, cards) => {
  set.cards = new Map(cards.filter((card) => card.eaId).map((card) => [card.eaId, card]));
};

const track = (set, card, hint) => {
  if (!set.tracked.has(card.eaId)) {
    set.tracked.set(card.eaId, trackPrice(card.eaId, hint || { name: card.name, rating: card.rating }, "hot"));
  }
};

const untrackMissing = (set) => {
  set.tracked.forEach((untrack, eaId) => {
    if (!set.cards.has(eaId)) {
      untrack();
      set.tracked.delete(eaId);
    }
  });
};

// ------------------------------------------------------------ version exacte

const startExact = (set, filter) => {
  const card = {
    eaId: filter.definitionId,
    futbinId: filter.futbinId || 0,
    url: filter.futbinUrl || "",
    name: filter.player ? filter.player.name : "",
    rating: filter.player ? filter.player.rating : 0,
  };
  // Lien FUTBIN choisi dans la recherche : la page lue est celle de cette carte, sans ambiguïté.
  if (card.futbinId && card.url) {
    seedFutbinPrice(card.eaId, { link: linkOf(card) });
  }
  setCards(set, [card]);
  track(set, card, hintOf(filter));
  set.status = "ready";
  emit(set);
};

// ------------------------------------------------------------- toutes versions

const loadVersions = async (set) => {
  if (set.stopped) {
    return;
  }
  const baseId = set.baseId;
  const hint = set.hint;
  const result = hint.name ? await searchFutbinPlayers(hint.name) : { ok: false };
  if (set.stopped) {
    return;
  }
  let cards = [];
  if (result.ok) {
    cards = result.rows
      .filter((row) => row.eaId && (row.eaId & 0xffffff) === baseId)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, MAX_VERSIONS);
  }
  if (!cards.length) {
    // Recherche impossible : la carte de base seule (prix lu par son identifiant EA).
    cards = [{ eaId: baseId, name: hint.name, rating: hint.rating, futbinId: 0, url: "" }];
  }
  cards.forEach((card) => {
    if (card.futbinId) {
      seedFutbinPrice(card.eaId, { link: linkOf(card) });
    }
  });
  setCards(set, cards);
  cards.forEach((card) => track(set, card));
  untrackMissing(set);
  set.status = "ready";
  set.loadedAt = Date.now();
  set.message = result.ok ? "" : t("misc.setVersionsUnavailable");
  emit(set);
  set.timer = setTimeout(() => loadVersions(set), VERSIONS_REFRESH);
};

// ------------------------------------------------------------- liste FUTBIN

const listInterval = () => Math.min(900, Math.max(120, Number(getSettings().prices.listInterval) || 180)) * 1000;
const listPages = () => Math.min(10, Math.max(1, Number(getSettings().prices.listPages) || 3));

const refreshList = async (set) => {
  if (set.stopped || set.busy) {
    return;
  }
  set.busy = true;
  const platform = pricePlatform();
  const found = [];
  let error = "";
  let lastPage = 0;
  const maxPages = listPages();
  for (let page = 1; page <= maxPages && !set.stopped; page += 1) {
    const result = await fetchFutbinList(set.url, page);
    if (!result.ok) {
      error = result.blocked
        ? t("misc.setBlocked")
        : result.invalid
        ? t("misc.setInvalidLink")
        : result.status
        ? t("misc.setNoResponseStatus", { status: result.status })
        : t("misc.setNoResponse");
      break;
    }
    lastPage = Math.max(lastPage, result.lastPage || 0);
    found.push(...result.cards);
    if (!result.cards.length || (result.lastPage && page >= result.lastPage)) {
      break;
    }
  }
  set.busy = false;
  if (set.stopped) {
    return;
  }
  if (found.length) {
    // Prix de la liste (plateforme du compte) : mêmes règles qu'une lecture de page joueur.
    found.forEach((card) => {
      seedFutbinPrice(card.eaId, {
        price: card.prices ? card.prices[platform] : 0,
        platform,
        link: linkOf(card),
        itemScore: card.itemScore,
        itemScoreExact: card.itemScoreExact,
      });
    });
    setCards(set, found);
    set.status = "ready";
    set.loadedAt = Date.now();
    set.lastPage = lastPage;
    set.message = error ? t("misc.setPartial", { error }) : "";
  } else if (error) {
    set.status = set.cards.size ? "ready" : "error";
    set.message = error;
  } else {
    set.status = "empty";
    set.message = t("misc.setEmpty");
  }
  emit(set);
  set.timer = setTimeout(() => refreshList(set), listInterval());
};

// -------------------------------------------------------------- abonnements

const createSet = (key, filter) => ({
  key,
  kind: key.split(":")[0],
  url: key.startsWith("list:") ? key.slice(5) : "",
  baseId: filter.player ? filter.player.id : 0,
  hint: hintOf(filter),
  refs: 0,
  cards: new Map(),
  tracked: new Map(),
  status: "loading",
  message: "",
  loadedAt: 0,
  lastPage: 0,
  timer: null,
  busy: false,
  stopped: false,
});

const stopSet = (set) => {
  set.stopped = true;
  clearTimeout(set.timer);
  set.tracked.forEach((untrack) => untrack());
  set.tracked.clear();
  sets.delete(set.key);
};

// Prend un abonnement sur les cartes du filtre (suivi des prix tant qu'il n'est pas relâché).
export const acquireCardSet = (filter) => {
  const key = cardSetKey(filter);
  if (!key) {
    return null;
  }
  let set = sets.get(key);
  if (!set) {
    set = createSet(key, filter);
    sets.set(key, set);
    if (set.kind === "exact") {
      startExact(set, filter);
    } else if (set.kind === "versions") {
      loadVersions(set);
    } else {
      refreshList(set);
    }
  }
  set.refs += 1;
  let released = false;
  return {
    key,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      set.refs -= 1;
      if (set.refs <= 0) {
        stopSet(set);
      }
    },
  };
};

// État des cartes d'un abonnement, avec leur prix FUTBIN actuel (0 si inconnu ou trop vieux).
export const cardSetSnapshot = (key, use = "buy") => {
  const set = sets.get(key);
  if (!set) {
    return { key, kind: "", status: "missing", message: "", cards: [], loadedAt: 0, url: "", lastPage: 0, pending: 0 };
  }
  const cards = Array.from(set.cards.values());
  return {
    key,
    kind: set.kind,
    status: set.status,
    message: set.message,
    loadedAt: set.loadedAt,
    url: set.url,
    lastPage: set.lastPage,
    // Cartes dont le prix n'a encore jamais été lu (ni réussi ni en échec).
    pending: set.status === "loading" ? cards.length || 1 : cards.filter((card) => !getPriceRecord(card.eaId)).length,
    cards: cards.map((card) => ({
      eaId: card.eaId,
      name: card.name,
      rating: card.rating,
      version: card.version || "",
      club: card.club || "",
      url: card.url || "",
      price: currentPrice(card.eaId, PRICE_MAX_AGE, use),
    })),
  };
};

// Relecture immédiate (bouton « actualiser ») : liste FUTBIN, ou prix de chaque carte suivie.
export const refreshCardSet = (key) => {
  const set = sets.get(key);
  if (!set || set.stopped) {
    return;
  }
  if (set.kind === "list") {
    clearTimeout(set.timer);
    refreshList(set);
    return;
  }
  set.cards.forEach((card) => requestPrice(card.eaId, { name: card.name, rating: card.rating }));
};

// Utilisé par les tests.
export const resetCardSetsForTests = () => {
  Array.from(sets.values()).forEach(stopSet);
};
