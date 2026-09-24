// Lecture des pages FUTBIN FC 27. Format vérifié (septembre 2026) :
// - recherche JSON : /players/search?targetPage=PLAYER_PAGE&query=…&year=27&evolutions=false
//   → [{ id, name, position, ratingSquare: { rating }, location: { url },
//        playerImage: { fixed: { url: { image1x: ".../players/231747.png" } } } }]
// - page joueur : /27/player/<id>/<slug> → .price-box.platform-ps-only|platform-pc-only
//   contenant .lowest-price-1, .lowest-price-2… (secours : phrase « current price on FUT is … »)
// Les pages d'équipe (solutions SBC) sont lues de façon tolérante : liens joueur + images.

export const FUTBIN_ORIGIN = "https://www.futbin.com";

// Premier montant d'un texte : "227,000", "1.2M", "12.5K", "227 000" (espace insécable).
// Les groupes de milliers ne sont jamais joints à travers un espace normal : "15,000 15,250" = 15 000.
const NUMBER_RE = /(\d{1,3}(?:[.,\u00a0]\d{3})+|\d+(?:[.,]\d{1,2})?)\s?([KM])?(?![A-Z])/;
const GROUPED_RE = /^\d{1,3}(?:[.,\u00a0]\d{3})+$/;

export const parseCoins = (value) => {
  if (value == null) {
    return 0;
  }
  if (typeof value === "number") {
    return value > 0 ? Math.round(value) : 0;
  }
  const text = String(value).replace(/[\u00a0\u202f\u2009]/g, "\u00a0").trim().toUpperCase();
  if (!text || /^[-—–]+$/.test(text)) {
    return 0;
  }
  const match = text.match(NUMBER_RE);
  if (!match) {
    return 0;
  }
  let n = GROUPED_RE.test(match[1])
    ? parseInt(match[1].replace(/[^\d]/g, ""), 10)
    : parseFloat(match[1].replace(",", "."));
  if (match[2]) {
    n *= match[2] === "K" ? 1000 : 1000000;
  }
  return n > 0 ? Math.round(n) : 0;
};

// Prix plausible pour une carte du marché (limites EA : 150 à 15 millions).
export const isPlausiblePrice = (price) => price >= 150 && price <= 15000000;

// Identifiant EA dans une URL d'image FUTBIN : .../players/231747.png ou .../players/p50563123.png
export const eaIdFromImage = (url) => {
  const match = String(url || "").match(/\/players\/p?(\d{3,12})\.(?:png|webp|jpe?g)/i);
  return match ? Number(match[1]) : 0;
};

export const futbinIdFromUrl = (url) => {
  const match = String(url || "").match(/\/player\/(\d+)/);
  return match ? Number(match[1]) : 0;
};

export const absoluteUrl = (path) => {
  const text = String(path || "");
  if (!text) {
    return "";
  }
  if (/^https?:\/\//i.test(text)) {
    return text;
  }
  return `${FUTBIN_ORIGIN}${text.startsWith("/") ? "" : "/"}${text}`;
};

// Page de blocage Cloudflare (ou erreur 403 FUTBIN) plutôt qu'une vraie page.
export const looksBlocked = (text) => {
  const body = String(text || "");
  if (/price-box|"playerImage"/.test(body)) {
    return false;
  }
  return /cf-browser-verification|just a moment|challenge-platform|cf-chl-|Oops, there was an error - 403|Attention Required/i.test(
    body
  );
};

// ------------------------------------------------------------------ recherche

export const parseSearchJson = (raw) => {
  let data = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text || (text[0] !== "[" && text[0] !== "{")) {
      return [];
    }
    try {
      data = JSON.parse(text);
    } catch (e) {
      return [];
    }
  }
  const rows = Array.isArray(data) ? data : (data && (data.data || data.players)) || [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const image =
        (row.playerImage &&
          row.playerImage.fixed &&
          row.playerImage.fixed.url &&
          (row.playerImage.fixed.url.image1x || row.playerImage.fixed.url.image2x)) ||
        row.image ||
        "";
      const url = absoluteUrl((row.location && row.location.url) || row.url || "");
      const rating = parseInt(
        (row.ratingSquare && row.ratingSquare.rating) || row.rating || 0,
        10
      );
      return {
        futbinId: Number(row.id) || futbinIdFromUrl(url),
        eaId: eaIdFromImage(image),
        name: String(row.name || row.full_name || "").trim(),
        rating: Number.isFinite(rating) ? rating : 0,
        position: String(row.position || "").trim(),
        url,
      };
    })
    .filter((row) => row && row.futbinId);
};

// ------------------------------------------------------------- page joueur

// "5 mins ago", "1 hour ago", "a few seconds ago", "just now" → secondes (null si absent).
export const parseAgo = (text) => {
  const body = String(text || "");
  if (/just now|a few seconds ago|à l'instant/i.test(body)) {
    return 0;
  }
  const match = body.match(/(\d+|an?)\s*(sec|second|min|minute|hr|hour|day)s?\.?\s*ago/i);
  if (!match) {
    return null;
  }
  const n = /^an?$/i.test(match[1]) ? 1 : parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const factor = unit.startsWith("sec") ? 1 : unit.startsWith("min") ? 60 : unit.startsWith("day") ? 86400 : 3600;
  return n * factor;
};

// Espaces normaux fusionnés ; les espaces insécables (séparateurs de milliers) sont conservés.
const textOf = (el) => (el ? String(el.textContent || "").replace(/[ \t\n\r\f\v]+/g, " ").trim() : "");

// Page de vérification Cloudflare lue comme document (titre + marqueurs du défi).
const blockedDocument = (doc, bodyText) =>
  looksBlocked(`${doc.title || ""} ${bodyText}`) ||
  !!doc.querySelector("#challenge-platform, #challenge-form, #cf-wrapper, .cf-browser-verification");

const priceFromSentence = (text, platform) => {
  const match = String(text || "").match(
    /current price on FUT is ([\d.,\s]+?)\s+on PlayStation,\s*([\d.,\s]+?)\s+on Xbox,\s*(?:and\s*)?([\d.,\s]+?)\s+on PC/i
  );
  if (!match) {
    return 0;
  }
  return parseCoins(platform === "pc" ? match[3] : match[1]);
};

// platform : "console" (PlayStation + Xbox, marché commun) ou "pc".
export const parsePlayerDocument = (doc, platform = "console") => {
  const empty = { price: 0, prices: [], updatedAgoSec: null, pageEaId: 0, blocked: false };
  if (!doc || typeof doc.querySelector !== "function") {
    return empty;
  }
  const bodyText = textOf(doc.body || doc.documentElement);
  if (blockedDocument(doc, bodyText) && !doc.querySelector(".price-box")) {
    return Object.assign({}, empty, { blocked: true });
  }
  const platformClass = platform === "pc" ? "platform-pc-only" : "platform-ps-only";
  const box =
    doc.querySelector(`.price-box.${platformClass}.price-box-original-player`) ||
    doc.querySelector(`.price-box.${platformClass}`) ||
    null;
  let prices = [];
  let updatedAgoSec = null;
  if (box) {
    // Uniquement les éléments de classe exacte "lowest-price-N" (pas un conteneur "lowest-prices-…").
    prices = Array.from(box.querySelectorAll("[class*='lowest-price-']"))
      .filter((el) => Array.from(el.classList || []).some((name) => /^lowest-price-\d+$/.test(name)))
      .map((el) => parseCoins(textOf(el)))
      .filter(isPlausiblePrice);
    let scope = box;
    for (let depth = 0; depth < 3 && scope && updatedAgoSec === null; depth += 1) {
      updatedAgoSec = parseAgo(textOf(scope));
      scope = scope.parentElement;
    }
  }
  // Prix incohérents (le moins cher bien au-dessus du suivant) : lecture refusée plutôt qu'un prix faux.
  const consistent = !(prices.length >= 2 && prices[0] > prices[1] * 2);
  const sentence = priceFromSentence(bodyText, platform);
  const price = consistent && prices[0] ? prices[0] : !prices.length && isPlausiblePrice(sentence) ? sentence : 0;
  // Identifiant EA déclaré par la page (vérifié par l'appelant s'il est présent).
  let pageEaId = 0;
  const info = doc.getElementById ? doc.getElementById("page-info") : null;
  if (info) {
    pageEaId =
      Number(info.getAttribute("data-player-resource")) ||
      Number(info.getAttribute("data-resource-id")) ||
      0;
  }
  return { price, prices, updatedAgoSec, pageEaId, blocked: false };
};

// ------------------------------------------------------------ page d'équipe

const FORMATION_RE = /\b([3-5])\s*-\s*([1-5])\s*-\s*([1-5])(?:\s*-\s*([1-5]))?(?:\s*-\s*([1-5]))?(?:\s*\(\s*(\d)\s*\))?/;

// "4-3-3(4)" → "4334", "4-2-3-1" → "4231" (sert à retrouver la formation EA).
export const formationKey = (text) => {
  const match = String(text || "").match(FORMATION_RE);
  if (!match) {
    return "";
  }
  return match.slice(1).filter(Boolean).join("");
};

const POSITION_RE = /^(GK|RB|RWB|CB|LB|LWB|CDM|CM|CAM|RM|LM|RW|LW|RF|LF|CF|ST|RCB|LCB|RDM|LDM|RCM|LCM|RAM|LAM|RS|LS)$/;

const findPosition = (card) => {
  const candidates = card.querySelectorAll("[class*='position'], [class*='pos']");
  for (const el of candidates) {
    const value = textOf(el).toUpperCase();
    if (POSITION_RE.test(value)) {
      return value;
    }
  }
  const data =
    card.getAttribute("data-position") || card.getAttribute("data-pos") || card.getAttribute("data-formpos") || "";
  return POSITION_RE.test(String(data).toUpperCase()) ? String(data).toUpperCase() : "";
};

const findRating = (card) => {
  const candidates = card.querySelectorAll("[class*='rating']");
  for (const el of candidates) {
    const n = parseInt(textOf(el), 10);
    if (n >= 40 && n <= 99) {
      return n;
    }
  }
  return 0;
};

const findPrice = (card) => {
  const candidates = card.querySelectorAll("[class*='price']");
  for (const el of candidates) {
    const n = parseCoins(textOf(el));
    if (isPlausiblePrice(n)) {
      return n;
    }
  }
  return 0;
};

const findName = (card, link, image) => {
  const nameEl = card.querySelector("[class*='name']");
  const name = textOf(nameEl);
  if (name && !/^\d+$/.test(name)) {
    return name;
  }
  const alt = image && image.getAttribute("alt");
  if (alt && alt.length > 1) {
    return alt.trim();
  }
  const href = link && link.getAttribute("href");
  const slug = href ? href.replace(/\/$/, "").split("/").pop() : "";
  return slug && slug !== "player" ? slug.replace(/-/g, " ") : "";
};

// Remonte jusqu'au bloc "carte" qui contient une seule carte joueur.
const cardRoot = (el) => {
  let node = el;
  for (let depth = 0; depth < 6 && node && node.parentElement; depth += 1) {
    const parent = node.parentElement;
    const cards = parent.querySelectorAll("img[src*='/players/']").length;
    if (cards > 1) {
      return node;
    }
    node = parent;
  }
  return node || el;
};

const playerImages = (root) => Array.from(root.querySelectorAll("img[src*='/players/']")).filter((img) => eaIdFromImage(img.getAttribute("src")));

// Terrain de la solution : bloc "pitch" s'il contient les 11 cartes, sinon le plus petit bloc
// qui contient au moins 11 cartes (évite les joueurs des encarts "populaires" de la page).
const pitchScope = (doc) => {
  const named = ["[class*='pitch']", "[class*='squad-field']", "[id*='pitch']"]
    .map((selector) => doc.querySelector(selector))
    .find((el) => el && playerImages(el).length >= 11);
  if (named) {
    return named;
  }
  const images = playerImages(doc);
  if (images.length <= 11) {
    return doc;
  }
  const counts = new Map();
  let best = null;
  images.forEach((image) => {
    for (let node = image.parentElement; node; node = node.parentElement) {
      if (!counts.has(node)) {
        counts.set(node, playerImages(node).length);
      }
      const count = counts.get(node);
      if (count >= 11) {
        if (!best || count < best.count) {
          best = { node, count };
        }
        break;
      }
    }
  });
  return best ? best.node : doc;
};

export const parseSquadDocument = (doc) => {
  const result = { formation: "", formationKey: "", players: [], blocked: false };
  if (!doc || typeof doc.querySelector !== "function") {
    return result;
  }
  const bodyText = textOf(doc.body || doc.documentElement);
  if (blockedDocument(doc, bodyText) && !doc.querySelector("img[src*='/players/']")) {
    result.blocked = true;
    return result;
  }
  const formationEl =
    doc.querySelector("[class*='formation'] option[selected]") ||
    doc.querySelector("[id*='formation']") ||
    doc.querySelector("[class*='formation']");
  const candidates = [
    (formationEl && (formationEl.value || textOf(formationEl))) || "",
    (bodyText.match(/formation[^0-9]{0,20}([3-5][^a-z]{3,16})/i) || [])[1] || "",
  ];
  for (const candidate of candidates) {
    const match = String(candidate).match(FORMATION_RE);
    if (match) {
      result.formation = match[0].replace(/\s+/g, "");
      result.formationKey = formationKey(match[0]);
      break;
    }
  }

  const scope = pitchScope(doc);
  const seen = new Set();
  const images = Array.from(scope.querySelectorAll("img[src*='/players/']"));
  images.forEach((image) => {
    const eaId = eaIdFromImage(image.getAttribute("src"));
    if (!eaId) {
      return;
    }
    const card = cardRoot(image);
    const link =
      (card.matches && card.matches("a[href*='/player/']") ? card : null) ||
      card.querySelector("a[href*='/player/']") ||
      (image.closest ? image.closest("a[href*='/player/']") : null);
    const futbinId = link ? futbinIdFromUrl(link.getAttribute("href")) : 0;
    const key = `${eaId}:${futbinId}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.players.push({
      eaId,
      futbinId,
      name: findName(card, link, image),
      rating: findRating(card),
      position: findPosition(card),
      price: findPrice(card),
      url: link ? absoluteUrl(link.getAttribute("href")) : "",
    });
  });
  // Une solution SBC = 11 titulaires (les remplaçants éventuels viennent après).
  result.players = result.players.slice(0, 11);
  return result;
};

// ------------------------------------------- page d'équipe : données JSON (FC 27)
// Les pages d'équipe FUTBIN (solutions DCE, équipes) sont rendues par React à partir d'un JSON embarqué :
// <script type="application/json" data-react-data>{ squadData: { squad: [{ value: "cardlid1" }, {joueur}, …] },
//   formationData: { formationSelected: { displayName: "4-3-3(4)", positions: [{ value: "cardlid1" }, { value: "LW" }, …] } } }
// Chaque joueur : playerName, playerRating, playerImage (id EA dans l'URL), id.playerCardId (id FUTBIN),
// possiblePositions, price.ps / price.pc, playerLocation. Un poste absent (ex. poste bloqué du DCE) est omis.

export const extractReactData = (text) => {
  const body = String(text || "");
  const found = [];
  const opener = /<script[^>]*data-react-data[^>]*>/gi;
  let match = opener.exec(body);
  while (match) {
    const start = match.index + match[0].length;
    const end = body.indexOf("</script>", start);
    if (end < 0) {
      break;
    }
    try {
      found.push(JSON.parse(body.slice(start, end)));
    } catch (e) {}
    opener.lastIndex = end;
    match = opener.exec(body);
  }
  return found;
};

// [{ value: "cardlid1" }, X, { value: "cardlid2" }, Y…] → Map("cardlid1" → X)
const slotPairs = (list) => {
  const map = new Map();
  let key = "";
  (Array.isArray(list) ? list : []).forEach((entry) => {
    if (entry && typeof entry === "object" && typeof entry.value === "string" && /^cardlid\d+$/i.test(entry.value)) {
      key = entry.value.toLowerCase();
      return;
    }
    if (key) {
      map.set(key, entry);
      key = "";
    }
  });
  return map;
};

const jsonPrice = (block) => {
  const n = Number(block && block.price);
  return isPlausiblePrice(n) ? n : 0;
};

const squadPlayerFromJson = (entry, slotKey) => {
  const image =
    entry.playerImage && entry.playerImage.fixed && entry.playerImage.fixed.url
      ? entry.playerImage.fixed.url.image1x || entry.playerImage.fixed.url.image2x
      : "";
  const location = (entry.playerLocation && entry.playerLocation.url) || "";
  const cardId = entry.id && entry.id.playerCardId ? Number(entry.id.playerCardId.value) : 0;
  const price = entry.price || {};
  return {
    eaId: eaIdFromImage(image),
    futbinId: cardId || futbinIdFromUrl(location),
    name: String(entry.playerName || "").trim(),
    rating: Number(entry.playerRating) || 0,
    position: (entry.position && entry.position.value) || "",
    positions: (Array.isArray(entry.possiblePositions) ? entry.possiblePositions : [])
      .map((item) => item && item.position && item.position.value)
      .filter(Boolean),
    slotKey,
    slotPosition: "",
    prices: { console: jsonPrice(price.ps), pc: jsonPrice(price.pc) },
    price: jsonPrice(price.ps),
    untradeable: !!entry.untradeable,
    url: absoluteUrl(location),
  };
};

export const parseSquadJson = (data) => {
  const squadData = data && data.squadData;
  if (!squadData || !Array.isArray(squadData.squad)) {
    return null;
  }
  const selected =
    (data.formationData && data.formationData.formationSelected) ||
    (data.sbcChallengeRequirementData && data.sbcChallengeRequirementData.formation) ||
    null;
  const slotPositions = new Map();
  if (selected) {
    slotPairs(selected.positions).forEach((value, key) => slotPositions.set(key, value && value.value));
  }
  const players = [];
  slotPairs(squadData.squad).forEach((entry, key) => {
    if (!entry || typeof entry !== "object" || !(entry.playerName || entry.playerImage)) {
      return;
    }
    const slotNumber = Number(key.replace(/\D/g, ""));
    if (slotNumber > 11) {
      return; // remplaçants éventuels : seuls les 11 titulaires comptent
    }
    const player = squadPlayerFromJson(entry, key);
    player.slotPosition = slotPositions.get(key) || "";
    if (player.eaId) {
      players.push(player);
    }
  });
  const displayName = String((selected && selected.displayName) || "").replace(/\s+/g, "");
  const challenge = data.sbcChallengeRequirementData && data.sbcChallengeRequirementData.challengeName;
  return {
    formation: displayName,
    formationKey: formationKey(displayName) || String((selected && selected.formation && selected.formation.value) || "").replace(/\D/g, ""),
    players,
    challengeName: challenge ? String(challenge) : "",
    blocked: false,
    source: "json",
  };
};

// Page d'équipe complète : JSON embarqué d'abord, lecture du HTML rendu en secours.
export const parseSquadText = (text) => {
  for (const data of extractReactData(text)) {
    const parsed = parseSquadJson(data);
    if (parsed && parsed.players.length) {
      return parsed;
    }
  }
  const doc = htmlToDocument(text);
  return doc ? Object.assign(parseSquadDocument(doc), { source: "html" }) : { formation: "", formationKey: "", players: [], blocked: looksBlocked(text) };
};

// Transforme du HTML en document (DOMParser du navigateur, ou injecté par les tests).
export const htmlToDocument = (html) => {
  const Parser = typeof DOMParser !== "undefined" ? DOMParser : null;
  if (!Parser) {
    return null;
  }
  try {
    return new Parser().parseFromString(String(html || ""), "text/html");
  } catch (e) {
    return null;
  }
};
