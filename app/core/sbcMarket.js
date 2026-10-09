import { fetchFutbinText, futbinYear } from "../prices/futbinClient";
import { FUTBIN_ORIGIN, eaIdFromImage, htmlToDocument, parsePlayerListText } from "../prices/futbinParse";
import { pricePlatform, seedFutbinPrice } from "../prices/priceService";
import { sleep } from "./async";
import { pageGlobal } from "./page";
import { normalizePosition } from "./sbc";
import { compileChecks, tierOf } from "./sbcEval";
import { QUALITY, SCOPE } from "./sbcRequirements";

// Cartes du marché proposées par le solveur quand le club ne suffit pas (ou qu'acheter coûte moins
// cher) : listes FUTBIN triées par prix croissant (les 30 moins chères d'une note, d'un championnat,
// d'une nation ou d'un club), lues seulement pour les notes et filtres utiles aux exigences, espacées
// et gardées 10 min. Aucune recherche sur le marché EA pour planifier : l'achat (sbcBuy.js) ne se fait
// qu'après confirmation.
// Une carte du marché coûte son prix FUTBIN + la marge DCE + un petit surcoût fixe : à valeur égale,
// les cartes du club (non échangeables, doublons, fourrage) restent toujours préférées.

export const MARKET_TTL = 10 * 60 * 1000;
export const MARKET_OVERHEAD = 150;
const MAX_QUERIES = 8;

const listCache = new Map();
// Cartes relues par EA avant un achat (attributs exacts), réutilisées par les recherches suivantes.
const verifiedCards = new Map();
const VERIFIED_FIELDS = ["name", "rating", "tier", "nationId", "leagueId", "teamId", "clubId", "rareflag", "groups", "legend", "hero", "special", "positions", "preferredPosition", "person"];
let pause = { min: 400, max: 900 };
let unknownSeed = 0;

// Postes EA (PlayerPosition) d'après le nom FUTBIN (« ST », « LW »…), relus dans le web app.
const POSITION_IDS = { GK: 0, SW: 1, RWB: 2, RB: 3, CB: 5, LB: 7, LWB: 8, CDM: 10, RM: 12, CM: 14, LM: 16, CAM: 18, RF: 20, CF: 21, LF: 22, RW: 23, ST: 25, LW: 27 };

export const positionId = (name) => {
  const key = normalizePosition(name);
  if (!key) {
    return -1;
  }
  const live = pageGlobal("PlayerPosition");
  if (live && typeof live[key] === "number") {
    return live[key];
  }
  return POSITION_IDS[key] == null ? -1 : POSITION_IDS[key];
};

// ------------------------------------------------------------------ listes FUTBIN

// Liste FUTBIN triée par prix croissant pour la plateforme du compte (ps_price / pc_price).
export const marketListUrl = ({ minRating = 40, maxRating = 99, league = 0, nation = 0, club = 0, version = "", platform = pricePlatform() } = {}) => {
  const priceKey = platform === "pc" ? "pc_price" : "ps_price";
  const params = [];
  if (version) {
    params.push(["version", version]);
  }
  if (league > 0) {
    params.push(["league", league]);
  }
  if (nation > 0) {
    params.push(["nation", nation]);
  }
  if (club > 0) {
    params.push(["club", club]);
  }
  params.push(["player_rating", `${minRating}-${maxRating}`], [priceKey, "200-15000000"], ["sort", priceKey], ["order", "asc"]);
  return `${FUTBIN_ORIGIN}/${futbinYear()}/players?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
};

const tierBounds = (tier) => (tier === QUALITY.BRONZE ? [40, 64] : tier === QUALITY.SILVER ? [65, 74] : [75, 99]);

// Listes à lire d'après les exigences (pur) : [{ key, minRating, maxRating, league?, nation?, club?, version?, known }].
// - note d'équipe min. R : une liste par note de R − 1 à R + 3 ;
// - « au moins N joueurs note ≥ X » : X et X + 1 ; note exacte X : X ;
// - championnat / nation / club demandés : une liste filtrée par valeur (3 au plus) ;
// - réserve trop petite sans exigence de note : les moins chères de la plage de notes permise.
// options : { maxRating (réglage), needPool, oneClick (cartes au point de score : notes 84 à 88) }.
export const marketQueries = (requirements, { maxRating = 0, needPool = false, oneClick = false } = {}) => {
  const checks = compileChecks(requirements || []).filter((check) => check.supported);
  let low = 40;
  let high = maxRating > 0 ? Math.min(99, maxRating) : 99;
  let gold = false;
  checks.forEach((check) => {
    if (check.kind === "quality") {
      const [min, max] = tierBounds(check.target);
      if (check.scope === SCOPE.GREATER || check.scope === SCOPE.EXACT) {
        low = Math.max(low, min);
      }
      if (check.scope === SCOPE.LOWER || check.scope === SCOPE.EXACT) {
        high = Math.min(high, max);
      }
      gold = gold || (check.target === QUALITY.GOLD && check.scope !== SCOPE.LOWER);
    } else if (check.key === "PLAYER_LEVEL" && check.scope !== SCOPE.LOWER && check.req.values.includes(QUALITY.GOLD)) {
      gold = true;
    }
  });
  if (low > high) {
    return [];
  }
  const inRange = (rating) => rating >= low && rating <= high;
  const ratings = new Set();
  const rating = checks.find((check) => check.kind === "rating" && check.minRating != null);
  if (oneClick) {
    // Score DCE par pièce : les 84 à 88 or sont en général les moins chers au point.
    for (let value = 84; value <= 88; value += 1) {
      ratings.add(value);
    }
  }
  if (rating) {
    for (let value = rating.minRating - 1; value <= rating.minRating + 3; value += 1) {
      ratings.add(value);
    }
  }
  checks.forEach((check) => {
    if (check.kind !== "count" || check.scope === SCOPE.LOWER || !(check.target > 0)) {
      return;
    }
    if (check.key === "PLAYER_MIN_OVR") {
      ratings.add(check.req.value);
      ratings.add(check.req.value + 1);
    } else if (check.key === "PLAYER_EXACT_OVR") {
      ratings.add(check.req.value);
    }
  });
  const version = gold ? "gold" : "";
  const queries = Array.from(ratings)
    .filter(inRange)
    .sort((a, b) => a - b)
    .map((value) => ({ key: `r${value}`, minRating: value, maxRating: value, version, known: {} }));
  // Championnat / nation / club demandés : les moins chers de la plage utile.
  const band = rating ? [Math.max(low, rating.minRating - 1), Math.min(high, rating.minRating + 3)] : [low, high];
  checks.forEach((check) => {
    if (check.kind !== "count" || check.scope === SCOPE.LOWER || !(check.target > 0)) {
      return;
    }
    const field = check.key === "LEAGUE_ID" ? "league" : check.key === "NATION_ID" ? "nation" : check.key === "CLUB_ID" ? "club" : "";
    if (!field) {
      return;
    }
    check.req.values.slice(0, 3).forEach((value) => {
      if (value > 0 && band[0] <= band[1]) {
        queries.push({
          key: `${field}${value}`,
          minRating: band[0],
          maxRating: band[1],
          [field]: value,
          version,
          known: { [`${field}Id`]: value },
        });
      }
    });
  });
  if (!queries.length && needPool) {
    queries.push({ key: `band${low}-${high}`, minRating: low, maxRating: high, version, known: {} });
  }
  return queries.slice(0, MAX_QUERIES);
};

// Identifiants EA (club, nation, championnat), postes et rareté lus dans les lignes tr.player-row
// de la même page (liens « ?club=… » et images de FUTBIN, qui reprennent les identifiants d'EA).
const numberIn = (text, re) => {
  const match = String(text || "").match(re);
  return match ? Number(match[1]) : 0;
};

const idOf = (row, kind, folder) => {
  const link = row.querySelector(`a.table-player-${kind}`) || row.querySelector(`a[href*='${kind}=']`);
  const fromLink = link ? numberIn(link.getAttribute("href"), new RegExp(`[?&]${kind}=(\\d+)`)) : 0;
  if (fromLink) {
    return fromLink;
  }
  const image = (link && link.querySelector("img")) || row.querySelector(`img[src*='/${folder}/']`);
  return image ? numberIn(image.getAttribute("src"), new RegExp(`/${folder}/(?:[a-z]+/)?(\\d+)\\.png`)) : 0;
};

export const rowDetails = (html) => {
  const details = new Map();
  const doc = htmlToDocument(html);
  if (!doc) {
    return details;
  }
  Array.from(doc.querySelectorAll("tr.player-row")).forEach((row) => {
    const image = row.querySelector("img[src*='/players/']");
    const eaId = image ? eaIdFromImage(image.getAttribute("src")) : 0;
    if (!eaId || details.has(eaId)) {
      return;
    }
    const positionCell = row.querySelector("td.table-pos");
    const main = positionCell ? String((positionCell.querySelector(".table-pos-main span") || {}).textContent || "").trim() : "";
    const others = positionCell ? String((positionCell.querySelector(".xs-font") || {}).textContent || "") : "";
    const background = row.querySelector("img[src*='/cards/']");
    const rarity = background ? String(background.getAttribute("src") || "").match(/\/cards\/[a-z]+\/(\d+)_/) : null;
    details.set(eaId, {
      clubId: idOf(row, "club", "clubs"),
      nationId: idOf(row, "nation", "nation"),
      leagueId: idOf(row, "league", "league"),
      positions: [main]
        .concat(others.split(/[,/]/))
        .map((name) => name.trim())
        .filter(Boolean),
      rareflag: rarity ? Number(rarity[1]) : null,
    });
  });
  return details;
};

const pauseMs = () => pause.min + Math.random() * Math.max(0, pause.max - pause.min);

// Lit les listes demandées (cache 10 min par lien). onProgress({ phase: "market", page, pages }).
// Résultat : { ok, lists: [{ query, cards, details, at }], errors, blocked, cancelled }.
export const loadMarketLists = async (queries, { token = null, onProgress = () => {}, platform = pricePlatform() } = {}) => {
  const lists = [];
  const errors = [];
  let fetched = 0;
  for (let index = 0; index < queries.length; index += 1) {
    if (token && token.cancelled) {
      return { ok: false, cancelled: true, lists, errors };
    }
    const query = queries[index];
    const url = marketListUrl(Object.assign({}, query, { platform }));
    const cached = listCache.get(url);
    if (cached && Date.now() - cached.at < MARKET_TTL) {
      lists.push({ query, cards: cached.cards, details: cached.details, at: cached.at });
      continue;
    }
    onProgress({ phase: "market", page: index + 1, pages: queries.length });
    if (fetched && !(await sleep(pauseMs(), token))) {
      return { ok: false, cancelled: true, lists, errors };
    }
    fetched += 1;
    const res = await fetchFutbinText(url, { allowIframe: true });
    if (!res.ok) {
      errors.push({ query, status: res.status || 0, blocked: !!res.blocked });
      if (res.blocked) {
        // FUTBIN bloque (Cloudflare) : on n'insiste pas, les listes déjà lues servent.
        return { ok: lists.length > 0, blocked: true, lists, errors };
      }
      continue;
    }
    const parsed = parsePlayerListText(res.text);
    const entry = { at: Date.now(), cards: parsed.cards || [], details: rowDetails(res.text) };
    listCache.set(url, entry);
    lists.push({ query, cards: entry.cards, details: entry.details, at: entry.at });
  }
  return { ok: true, lists, errors };
};

// ------------------------------------------------------------------ cartes du marché

const unknownId = () => {
  unknownSeed += 1;
  return -(1000000 + unknownSeed);
};

// Rareté d'après la version FUTBIN : « Normal » (rare ou non : inconnu), icône, héros, promo.
const versionFlags = (version) => {
  const text = String(version || "").toLowerCase();
  return {
    legend: /\bicon/.test(text),
    hero: /\bhero/.test(text),
    special: !!text && !/^(normal|common|rare|non[- ]?rare|gold|silver|bronze)/.test(text),
  };
};

// Carte d'une liste FUTBIN → entrée de réserve « à acheter ». Attributs inconnus (pas d'identifiant
// lu) : valeurs négatives uniques, qui ne comptent pour aucune exigence ni aucun lien de collectifs.
export const marketEntry = (card, { platform = pricePlatform(), margin = 5, overhead = MARKET_OVERHEAD, known = {}, details = null, linkedTeam = (id) => id } = {}) => {
  const price = Number(card && card.prices && card.prices[platform]) || 0;
  const eaId = Number(card && card.eaId) || 0;
  const rating = Number(card && card.rating) || 0;
  if (!price || !eaId || !rating) {
    return null;
  }
  const flags = versionFlags(card.version);
  const info = details || {};
  const leagueId = info.leagueId || known.leagueId || unknownId();
  const nationId = info.nationId || known.nationId || unknownId();
  const teamId = info.clubId || known.clubId || unknownId();
  const names = (info.positions && info.positions.length ? info.positions : [card.position]).filter(Boolean);
  const positions = Array.from(new Set(names.map(positionId).filter((id) => id >= 0)));
  const rareflag = info.rareflag != null ? info.rareflag : flags.legend ? 12 : -1;
  return {
    key: `m:${eaId}`,
    id: null,
    item: null,
    market: true,
    source: "market",
    definitionId: eaId,
    person: `d${eaId & 0xffffff}`,
    name: String(card.name || `#${eaId}`),
    rating,
    tier: tierOf(rating),
    nationId,
    leagueId,
    teamId,
    clubId: teamId > 0 ? linkedTeam(teamId) : teamId,
    rareflag,
    groups: [],
    owners: 0,
    firstOwner: false,
    tradable: true,
    untradeable: false,
    legend: flags.legend || rareflag === 12,
    hero: flags.hero,
    superChem: false,
    special: flags.special || rareflag > 1,
    positions,
    preferredPosition: positions.length ? positions[0] : -1,
    duplicate: false,
    evolved: false,
    academy: false,
    loan: false,
    concept: false,
    favorite: false,
    discardValue: 0,
    price,
    estimated: false,
    value: price,
    cost: Math.round(price * (1 + Math.max(0, margin) / 100)) + overhead,
    score: Number(card.itemScore) || 0,
    version: String(card.version || ""),
    futbinId: card.futbinId || 0,
    url: card.url || "",
    leagueName: card.league || "",
    nationName: card.nation || "",
    clubName: card.club || "",
    listedAt: 0,
  };
};

// Listes lues → entrées « à acheter » (une par carte ; attributs connus préférés), avec les règles du
// solveur (note max, prix max) et sans les champs inconnus qui fausseraient une exigence « au plus ».
// Les prix lus sont transmis au service de prix (achat sans nouvelle lecture pendant 5 min).
export const marketEntries = (lists, { platform = pricePlatform(), margin = 5, linkedTeam = (id) => id, rules = {}, requirements = [], seed = true } = {}) => {
  const checks = compileChecks(requirements || []).filter((check) => check.supported);
  // Champ inconnu interdit quand une exigence « au plus / exactement N du même… » ou « au moins N
  // nations / championnats / clubs » en dépend (une valeur inconnue pourrait la fausser).
  const risky = new Set();
  checks.forEach((check) => {
    if (check.kind === "group" || (check.kind === "distinct" && check.scope !== SCOPE.LOWER)) {
      risky.add(check.field);
    }
  });
  const byId = new Map();
  lists.forEach(({ query, cards, details, at }) => {
    (cards || []).forEach((card) => {
      const entry = marketEntry(card, { platform, margin, known: query.known || {}, details: details ? details.get(card.eaId) : null, linkedTeam });
      if (!entry) {
        return;
      }
      entry.listedAt = at || Date.now();
      const exact = verifiedCards.get(entry.definitionId);
      if (exact && Date.now() - exact.at < MARKET_TTL) {
        VERIFIED_FIELDS.forEach((field) => {
          entry[field] = exact.entry[field];
        });
        entry.verified = true;
      }
      if (Array.from(risky).some((field) => !(entry[field] > 0))) {
        return;
      }
      if (rules.maxRating > 0 && entry.rating > rules.maxRating) {
        return;
      }
      if (rules.maxPrice > 0 && entry.price > rules.maxPrice) {
        return;
      }
      const known = (value) => (value > 0 ? 1 : 0);
      const previous = byId.get(entry.definitionId);
      const quality = known(entry.leagueId) + known(entry.nationId) + known(entry.clubId);
      if (!previous || quality > previous.quality || (quality === previous.quality && entry.price < previous.entry.price)) {
        byId.set(entry.definitionId, { entry, quality, card });
      }
    });
  });
  const entries = Array.from(byId.values()).map(({ entry, card }) => {
    if (seed) {
      seedFutbinPrice(entry.definitionId, {
        price: entry.price,
        platform,
        link: card.futbinId ? { futbinId: card.futbinId, url: card.url, name: card.name, rating: card.rating } : null,
      });
    }
    return entry;
  });
  return entries.sort((a, b) => a.cost - b.cost);
};

// Club seul ou club + marché : le marché n'est retenu que s'il rend l'équipe possible, ou s'il fait
// économiser nettement (au moins 500 pièces et 5 % du coût de l'équipe du club).
export const chooseOutcome = (clubResult, mixedResult) => {
  const marketPicks = (result) => (result && result.squad ? result.squad.filter((pick) => pick.entry && pick.entry.market) : []);
  if (!mixedResult || !mixedResult.feasible) {
    return { result: clubResult, market: false, reason: "club" };
  }
  if (!marketPicks(mixedResult).length) {
    const mixedBetter = !clubResult || !clubResult.feasible || mixedResult.cost < clubResult.cost;
    return { result: mixedBetter ? mixedResult : clubResult, market: false, reason: "club" };
  }
  if (!clubResult || !clubResult.feasible) {
    return { result: mixedResult, market: true, reason: "needed" };
  }
  const saving = clubResult.cost - mixedResult.cost;
  if (saving >= Math.max(500, clubResult.cost * 0.05)) {
    return { result: mixedResult, market: true, reason: "cheaper", saving };
  }
  return { result: clubResult, market: false, reason: "club" };
};

// Mémorise les cartes relues par EA (sbcBuy.verifyMarketCards) pour les recherches suivantes.
export const rememberVerified = (entries) => {
  (entries || []).forEach((entry) => {
    if (entry && entry.verified && entry.definitionId) {
      verifiedCards.set(entry.definitionId, { at: Date.now(), entry });
    }
  });
};

// Cartes à acheter d'un résultat du solveur et total prévu (prix FUTBIN).
export const marketPicksOf = (result) => (result && result.squad ? result.squad.filter((pick) => pick.entry && pick.entry.market) : []);

export const marketTotal = (entries) => entries.reduce((total, entry) => total + (Number(entry.price) || 0), 0);

// Utilisé par les tests.
export const resetMarketForTests = () => {
  listCache.clear();
  verifiedCards.clear();
  unknownSeed = 0;
  pause = { min: 400, max: 900 };
};

export const setMarketPauseForTests = (min, max) => {
  pause = { min, max };
};
