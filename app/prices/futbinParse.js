// Lecture des pages FUTBIN FC 27. Format vérifié (septembre 2026) :
// - recherche JSON : /players/search?targetPage=PLAYER_PAGE&query=…&year=27&evolutions=false
//   → [{ id, name, position, ratingSquare: { rating }, location: { url },
//        playerImage: { fixed: { url: { image1x: ".../players/231747.png" } } } }]
// - page joueur : /27/player/<id>/<slug> → .price-box.platform-ps-only|platform-pc-only
//   contenant .lowest-price-1, .lowest-price-2… (secours : phrase « current price on FUT is … »)
// - listes de joueurs : /27/players?nation=…&position=… → lignes tr.player-row (nom, note, score
//   d'objet exact, poste, prix console / PC abrégés « 2.2K »)
// - galerie : /27/gallery (collections), /27/gallery/set/<id>/<slug> (JSON React des joueurs éligibles)
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

// Montant abrégé par FUTBIN : jusqu'à 2 décimales, zéros de fin retirés (« 2.2K », « 16.25K »,
// « 212K », « 12.05M »). Sous le million c'est exact (paliers EA de 100, 250, 500 et 1 000 pièces) ;
// en millions, FUTBIN arrondit à 10 000 près : on prend la borne basse (12.05M → 12 045 000) pour ne
// jamais surestimer un prix d'achat.
export const parseCoinsFloor = (value) => {
  const n = parseCoins(value);
  const text = String(value == null ? "" : value).trim().toUpperCase();
  return n && /\d\s?M(?![A-Z])/.test(text) ? Math.max(0, n - 5000) : n;
};

// Score d'objet (points de galerie) : « 280 » (exact) ou « 35.62K » (arrondi par FUTBIN).
export const parseItemScore = (value) => {
  const text = String(value == null ? "" : value).trim().toUpperCase();
  const score = parseCoins(text);
  return { score, exact: score > 0 && !/\d\s?[KM](?![A-Z])/.test(text) };
};

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

// Page de vérification Cloudflare (« Just a moment… », défi à résoudre) ou erreur 403 FUTBIN plutôt
// qu'une vraie page. Attention : toutes les pages FUTBIN normales contiennent aussi un script
// Cloudflare (/cdn-cgi/challenge-platform/scripts/precursor/…) : sa présence seule ne veut rien dire.
const CONTENT_RE = /price-box|"playerImage"|player-row|gallery-wrapper|data-react-data|"items"\s*:/;
const CHALLENGE_RE =
  /<title>\s*just a moment|cf-browser-verification|cf_chl_opt|cf-chl-|challenge-platform\/h\/|id=["']challenge-(?:form|running|body-text|stage)["']|Enable JavaScript and cookies to continue|Oops, there was an error - 403|Attention Required/i;

export const looksBlocked = (text) => {
  const body = String(text || "");
  if (CONTENT_RE.test(body)) {
    return false;
  }
  return CHALLENGE_RE.test(body);
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
        // Champs facultatifs (affichés s'ils existent dans la réponse FUTBIN).
        version: findText(row, /version|rarity|cardtype|promo|revision/i),
        club: findNamed(row, /club|team/i),
        nation: findNamed(row, /nation|country/i),
        prices: pricesFrom(row),
      };
    })
    .filter((row) => row && row.futbinId);
};

// --------------------------------------------------- champs facultatifs (JSON)

// Premier texte d'une clé qui correspond au motif (ex. version: "TOTW"), en profondeur limitée.
const findText = (node, pattern, depth = 0) => {
  if (!node || typeof node !== "object" || depth > 3) {
    return "";
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (pattern.test(key) && (typeof value === "string" || typeof value === "number") && String(value).trim()) {
      const text = String(value).trim();
      if (!/^https?:|\.(png|svg|webp|jpe?g)/i.test(text)) {
        return text;
      }
    }
  }
  for (const key of Object.keys(node)) {
    if (node[key] && typeof node[key] === "object" && !/image|icon/i.test(key)) {
      const found = findText(node[key], pattern, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return "";
};

// Nom porté par un objet dont la clé correspond (ex. clubImage: { name: "Al Ahli" }).
const findNamed = (node, pattern, depth = 0) => {
  if (!node || typeof node !== "object" || depth > 4) {
    return "";
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (pattern.test(key)) {
      if (typeof value === "string" && value.trim() && !/^https?:|\.(png|svg|webp)/i.test(value)) {
        return value.trim();
      }
      if (value && typeof value === "object") {
        const name = value.name || (value.fixed && value.fixed.name) || (value.image && findNamed(value.image, /name|fixed/i, depth + 1));
        if (typeof name === "string" && name.trim()) {
          return name.trim();
        }
      }
    }
  }
  for (const key of Object.keys(node)) {
    if (node[key] && typeof node[key] === "object") {
      const found = findNamed(node[key], pattern, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return "";
};

// Prix console / PC d'un objet FUTBIN : price.ps.price, price.pc.price ou ps_price / pc_price.
const pricesFrom = (node) => {
  const read = (value) => {
    if (value && typeof value === "object") {
      return read(value.price != null ? value.price : value.value);
    }
    const n = parseCoins(value);
    return isPlausiblePrice(n) ? n : 0;
  };
  const price = node && node.price && typeof node.price === "object" ? node.price : {};
  return {
    console: read(price.ps || price.console || node.ps_price || node.psPrice || node.price_ps),
    pc: read(price.pc || node.pc_price || node.pcPrice || node.price_pc),
  };
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

// Page de vérification Cloudflare lue comme document (titre + éléments du défi).
const blockedDocument = (doc) =>
  /just a moment|attention required/i.test(String(doc.title || "")) ||
  !!doc.querySelector("#challenge-form, #challenge-running, #challenge-stage, #cf-wrapper, .cf-browser-verification");

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
  const empty = { price: 0, prices: [], updatedAgoSec: null, pageEaId: 0, blocked: false, itemScore: 0, itemScoreExact: false };
  if (!doc || typeof doc.querySelector !== "function") {
    return empty;
  }
  const bodyText = textOf(doc.body || doc.documentElement);
  if (blockedDocument(doc) && !doc.querySelector(".price-box")) {
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
  // Score d'objet de la carte (premier bloc de la page = carte principale).
  const score = parseItemScore(
    textOf(doc.querySelector(".player-card-item-score .item-score-segment") || doc.querySelector(".item-score-segment"))
  );
  return { price, prices, updatedAgoSec, pageEaId, blocked: false, itemScore: score.score, itemScoreExact: score.exact };
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
  if (blockedDocument(doc) && !doc.querySelector("img[src*='/players/']")) {
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

// ------------------------------------------------ listes de joueurs FUTBIN (FC 27)
// Pages /27/players?nation=…&position=… : les joueurs sont lus dans le JSON React embarqué
// (objets joueur comme ceux des pages d'équipe), sinon dans les lignes du tableau HTML.

// Objets "joueur" d'un JSON FUTBIN : une image de joueur et une note. On ne descend pas dans
// un joueur (ses cartes internes répètent l'image).
export const collectPlayerObjects = (root, limit = 3000) => {
  const found = [];
  const stack = [root];
  const seen = new Set();
  while (stack.length && found.length < limit) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) {
      continue;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) {
        stack.push(node[index]);
      }
      continue;
    }
    if (node.playerImage && (node.playerRating != null || node.rating != null || node.ratingSquare)) {
      found.push(node);
      continue;
    }
    const keys = Object.keys(node);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      stack.push(node[keys[index]]);
    }
  }
  return found;
};

export const cardFromPlayerObject = (entry) => {
  const image =
    entry.playerImage && entry.playerImage.fixed && entry.playerImage.fixed.url
      ? entry.playerImage.fixed.url.image1x || entry.playerImage.fixed.url.image2x
      : typeof entry.playerImage === "string"
      ? entry.playerImage
      : entry.image || "";
  const location = (entry.playerLocation && entry.playerLocation.url) || (entry.location && entry.location.url) || entry.url || "";
  const cardId = entry.id && entry.id.playerCardId ? Number(entry.id.playerCardId.value) : Number(entry.id) || 0;
  const rating = parseInt(
    entry.playerRating != null ? entry.playerRating : entry.rating != null ? entry.rating : entry.ratingSquare && entry.ratingSquare.rating,
    10
  );
  return {
    eaId: eaIdFromImage(image),
    futbinId: cardId || futbinIdFromUrl(location),
    name: String(entry.playerName || entry.name || entry.cardname || entry.commonName || "").trim(),
    rating: Number.isFinite(rating) ? rating : 0,
    position: (entry.position && (entry.position.value || entry.position)) || "",
    prices: pricesFrom(entry),
    version: findText(entry, /version|rarity|cardtype|promo|revision/i),
    club: findNamed(entry, /club|team/i),
    nation: findNamed(entry, /nation|country/i),
    itemScore: parseItemScore(entry.itemScore).score,
    itemScoreExact: parseItemScore(entry.itemScore).exact,
    url: absoluteUrl(location),
  };
};

const titleOf = (el) => (el ? String(el.getAttribute("title") || "").trim() : "");

// Ligne tr.player-row d'une liste FUTBIN FC 27 (vérifiée sur /27/players?nation=163&position=LM).
const playerRowCard = (row) => {
  const nameCell = row.querySelector("td.table-name") || row;
  const image = nameCell.querySelector("img[src*='/players/']");
  const link = nameCell.querySelector("a.table-player-name[href*='/player/']") || nameCell.querySelector("a[href*='/player/']");
  const eaId = image ? eaIdFromImage(image.getAttribute("src")) : 0;
  if (!eaId || !link) {
    return null;
  }
  const priceIn = (selector) => {
    const cell = row.querySelector(selector);
    const n = cell ? parseCoinsFloor(textOf(cell.querySelector(".price") || cell)) : 0;
    return isPlausiblePrice(n) ? n : 0;
  };
  const rating = parseInt(textOf(row.querySelector("td.table-rating")), 10) || parseInt(textOf(nameCell.querySelector("[class*='rating']")), 10);
  const score = parseItemScore(textOf(row.querySelector("td.table-item-score")));
  const card = nameCell.querySelector("[class*='playercard'][title]");
  return {
    eaId,
    futbinId: futbinIdFromUrl(link.getAttribute("href")),
    name: textOf(link) || titleOf(card) || (image.getAttribute("alt") || "").trim(),
    rating: rating >= 40 && rating <= 99 ? rating : 0,
    position: textOf(row.querySelector("td.table-pos .table-pos-main span")),
    prices: { console: priceIn("td.platform-ps-only"), pc: priceIn("td.platform-pc-only") },
    itemScore: score.score,
    itemScoreExact: score.exact,
    version: textOf(nameCell.querySelector(".table-player-revision")),
    club: titleOf(nameCell.querySelector(".table-player-club img")),
    nation: titleOf(nameCell.querySelector(".table-player-nation img")),
    league: titleOf(nameCell.querySelector(".table-player-league img")),
    url: absoluteUrl(link.getAttribute("href")),
  };
};

const listFromHtml = (doc) => {
  const rows = Array.from(doc.querySelectorAll("tr.player-row"));
  if (rows.length) {
    return rows.map(playerRowCard).filter(Boolean);
  }
  // Autre mise en page : toute ligne de tableau avec une image de joueur et un lien FUTBIN.
  const cards = [];
  Array.from(doc.querySelectorAll("tr")).forEach((row) => {
    const image = row.querySelector("img[src*='/players/']");
    const link = row.querySelector("a[href*='/player/']");
    const eaId = image ? eaIdFromImage(image.getAttribute("src")) : 0;
    if (!eaId || !link) {
      return;
    }
    const cells = (selector) => Array.from(row.querySelectorAll(selector)).map((el) => parseCoinsFloor(textOf(el))).find(isPlausiblePrice) || 0;
    let consolePrice = cells(".platform-ps-only, [class*='ps-price'], [class*='price-ps']");
    const pcPrice = cells(".platform-pc-only, [class*='pc-price'], [class*='price-pc']");
    if (!consolePrice && !pcPrice) {
      consolePrice = cells("[class*='price']");
    }
    const ratingEl = Array.from(row.querySelectorAll("[class*='rating']")).map((el) => parseInt(textOf(el), 10)).find((n) => n >= 40 && n <= 99);
    cards.push({
      eaId,
      futbinId: futbinIdFromUrl(link.getAttribute("href")),
      name: textOf(link) || (image.getAttribute("alt") || "").trim(),
      rating: ratingEl || 0,
      position: "",
      prices: { console: consolePrice, pc: pcPrice },
      itemScore: 0,
      itemScoreExact: false,
      version: "",
      club: "",
      nation: "",
      league: "",
      url: absoluteUrl(link.getAttribute("href")),
    });
  });
  return cards;
};

// Numéro de la dernière page d'après les liens de pagination (…&page=N).
const lastPageOf = (text) => {
  let last = 0;
  const re = /[?&](?:amp;)?page=(\d+)/g;
  let match = re.exec(text);
  while (match) {
    last = Math.max(last, Number(match[1]) || 0);
    match = re.exec(text);
  }
  return last;
};

// Une carte par identifiant EA. Deux lignes peuvent partager la même image (icônes de même visage,
// ex. deux Miyama 90) : on garde alors le prix le plus bas par plateforme, pour ne jamais surpayer.
const lowest = (a, b) => (a && b ? Math.min(a, b) : a || b || 0);

const uniqueCards = (cards) => {
  const byId = new Map();
  cards.forEach((card) => {
    if (!card.eaId) {
      return;
    }
    const previous = byId.get(card.eaId);
    if (!previous) {
      byId.set(card.eaId, card);
      return;
    }
    previous.prices = {
      console: lowest(previous.prices && previous.prices.console, card.prices && card.prices.console),
      pc: lowest(previous.prices && previous.prices.pc, card.prices && card.prices.pc),
    };
    previous.duplicate = true;
    // Score d'objet ambigu : non retenu.
    if (card.itemScore !== previous.itemScore) {
      previous.itemScore = 0;
      previous.itemScoreExact = false;
    }
  });
  return Array.from(byId.values());
};

export const parsePlayerListText = (text) => {
  const body = String(text || "");
  for (const data of extractReactData(body)) {
    const cards = uniqueCards(collectPlayerObjects(data).map(cardFromPlayerObject));
    if (cards.length) {
      return { cards, lastPage: lastPageOf(body), source: "json", blocked: false };
    }
  }
  const doc = htmlToDocument(body);
  const cards = doc ? uniqueCards(listFromHtml(doc)) : [];
  return { cards, lastPage: lastPageOf(body), source: cards.length ? "html" : "", blocked: !cards.length && looksBlocked(body) };
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

// ------------------------------------------------------------------ galerie FC 27
// /27/gallery (toutes les collections) ou /27/gallery/<id>/<slug> (une catégorie) : pastilles de
// catégorie (a.category-pill) et cartes de collection (.gallery-wrapper) avec les paliers D→S.
// /27/gallery/set/<id>/<slug> : JSON React CollectionBuilderData (joueurs éligibles, 24 par page,
// paliers, bonus). Pages suivantes : POST JSON { sort, page, searchTerm?, minItemScore? } sur
// eligible.searchLocation.url → { items, totalItems }.

const GALLERY_CATEGORY_RE = /\/\d{2}\/gallery\/(\d+)\/([^/?#]+)/;
const GALLERY_SET_RE = /\/\d{2}\/gallery\/set\/(\d+)\/([^/?#]+)/;

// « Premier League / Barclays WSL 24 » → nom + nombre de collections.
const splitCount = (text) => {
  const match = String(text || "").match(/^(.*?)\s*(\d[\d,.\u00a0]*)$/);
  return match ? { name: match[1].trim(), count: parseCoins(match[2]) } : { name: String(text || "").trim(), count: 0 };
};

export const parseGalleryIndex = (html) => {
  const result = { categories: [], sets: [], blocked: false };
  const doc = htmlToDocument(html);
  if (!doc) {
    return result;
  }
  Array.from(doc.querySelectorAll("a.category-pill")).forEach((pill) => {
    const href = pill.getAttribute("href") || "";
    const match = href.match(GALLERY_CATEGORY_RE);
    const { name, count } = splitCount(textOf(pill));
    result.categories.push({
      id: match ? Number(match[1]) : 0,
      slug: match ? match[2] : "",
      name,
      count,
      url: absoluteUrl(href),
      active: /\bog-pill-primary\b|\bactive\b/.test(pill.className || ""),
    });
  });
  const seen = new Set();
  Array.from(doc.querySelectorAll(".gallery-wrapper")).forEach((card) => {
    const link = card.querySelector("a.gallery-set-body") || card.querySelector("a[href*='/gallery/set/']");
    const href = link ? link.getAttribute("href") || "" : "";
    const match = href.match(GALLERY_SET_RE);
    if (!match || seen.has(match[1])) {
      return;
    }
    seen.add(match[1]);
    const playersRow = Array.from(card.querySelectorAll(".gallery-set-info-row")).find((row) => /\d/.test(textOf(row)));
    const logo = card.querySelector(".gallery-set-logo img");
    result.sets.push({
      id: Number(match[1]),
      slug: match[2],
      name: textOf(card.querySelector(".og-card-wrapper-top a")) || textOf(link),
      url: absoluteUrl(href),
      players: playersRow ? parseCoins(textOf(playersRow.querySelector(".bold") || playersRow)) : 0,
      logo: logo ? absoluteUrl(logo.getAttribute("src")) : "",
      logoKind: logo ? String(logo.getAttribute("alt") || "") : "",
      tiers: Array.from(card.querySelectorAll(".gallery-rewards-grade")).map((grade) => ({
        grade: textOf(grade.querySelector(".collection-grade-badge")),
        points: parseCoins(textOf(grade.querySelector(".gallery-rewards-points .bold"))),
        rewards: Array.from(grade.querySelectorAll(".gallery-reward-chip span")).map(textOf).filter(Boolean),
      })),
    });
  });
  result.blocked = !result.sets.length && looksBlocked(html);
  return result;
};

const imageUrl = (node) => (node && node.fixed && node.fixed.url && (node.fixed.url.image1x || node.fixed.url.image2x)) || "";
const imageName = (node) =>
  (node && node.fixed && node.fixed.name) || (node && node.image && node.image.fixed && node.image.fixed.name) || "";

// Joueur éligible d'une collection : id FUTBIN, id EA de la version, points (score d'objet), bonus.
export const galleryItem = (raw) => {
  if (!raw || typeof raw !== "object" || !raw.card) {
    return null;
  }
  const card = raw.card;
  const images = card.playerImages || {};
  const special = imageUrl(images.playerSpecialImage);
  const eaId = eaIdFromImage(special) || eaIdFromImage(imageUrl(images.playerImage));
  const facts = raw.tagFacts || {};
  const priceOf = (box) => {
    const n = parseCoins(box && box.price);
    return isPlausiblePrice(n) ? n : 0;
  };
  const known = (box) => !!(box && box.price != null && String(box.price).trim() !== "");
  return {
    futbinId: Number(raw.id) || 0,
    eaId,
    baseId: Number(facts.player) || (eaId & 0xffffff),
    name: String(card.cardname || card.title || "").trim(),
    fullName: String(card.title || card.cardname || "").trim(),
    rating: parseInt(card.rating, 10) || 0,
    position: (card.pos1 && card.pos1.position) || "",
    points: Number(raw.points) || parseItemScore(card.itemScore).score,
    prices: { console: priceOf(raw.psPriceBox), pc: priceOf(raw.pcPriceBox) },
    // Prix « 0 » affiché par FUTBIN : carte absente du marché (DCE, objectif, non échangeable).
    offMarket: { console: known(raw.psPriceBox) && !priceOf(raw.psPriceBox), pc: known(raw.pcPriceBox) && !priceOf(raw.pcPriceBox) },
    tags: (Array.isArray(facts.matchedTags) ? facts.matchedTags : []).map(String),
    league: Number(facts.league) || 0,
    club: Number(facts.club) || 0,
    nation: Number(facts.nation) || 0,
    leagueName: imageName(card.leagueImage),
    clubName: imageName(card.clubImage),
    nationName: imageName(card.nationImage),
    holo: !!card.isHolographic,
    special: !!special,
    url: "",
  };
};

const galleryTitle = (html) => {
  const match = String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
};

const platformOf = (classes) => (/platform-pc-only/.test(classes || "") ? "pc" : /platform-ps-only/.test(classes || "") ? "console" : "");

export const normalizeGallerySet = (data, html = "") => {
  const eligible = data.eligible || {};
  return {
    title: galleryTitle(html),
    searchUrl: absoluteUrl(eligible.searchLocation && eligible.searchLocation.url),
    totalItems: Number(eligible.totalItems) || 0,
    perPage: Number(eligible.itemsPerPage) || 24,
    initialSort: String(eligible.initialSort || "ItemScoreDesc"),
    sortOptions: (eligible.sortOptions || []).map((option) => ({
      sort: String(option.sort || ""),
      label: String(option.label || ""),
      platform: platformOf(option.extraClasses),
    })),
    items: (eligible.items || []).map(galleryItem).filter(Boolean),
    tiers: ((data.goal && data.goal.tiers) || [])
      .map((tier) => ({
        grade: String(tier.grade || ""),
        points: Number(tier.points) || 0,
        rewards: (tier.rewards || []).map((reward) => String((reward && reward.label) || "")).filter(Boolean),
      }))
      .sort((a, b) => a.points - b.points),
    limit: {
      maxItems: Number(data.limit && data.limit.maxItems) || 0,
      exact: !!(data.limit && data.limit.requiresExactly),
    },
    tags: (data.tagSpecs || []).map((spec) => ({
      key: String(spec.key),
      name: String(spec.name || ""),
      description: String(spec.description || ""),
      color: String(spec.color || ""),
      aggregation: String(spec.aggregation || "MatchCount"),
      facet: spec.facet ? String(spec.facet) : "",
      firstOwner: !!spec.requiresFirstOwner,
      tiers: (spec.tiers || [])
        .map((tier) => ({ count: Number(tier.requiredCount) || 0, multiplier: Number(tier.multiplier) || 0, text: String(tier.bonusText || "") }))
        .sort((a, b) => a.count - b.count),
    })),
  };
};

export const parseGallerySet = (html) => {
  for (const data of extractReactData(html)) {
    if (data && typeof data === "object" && data.eligible && data.goal) {
      return normalizeGallerySet(data, html);
    }
  }
  return null;
};

export const parseGalleryPool = (raw) => {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = null;
    }
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.items)) {
    return null;
  }
  return { items: data.items.map(galleryItem).filter(Boolean), totalItems: Number(data.totalItems) || 0 };
};
