import { DOMParser } from "linkedom";
import { createMockEa } from "./mockEa";
import { setPageForTests } from "../app/core/page";
import * as parse from "../app/prices/futbinParse";
import * as service from "../app/prices/priceService";
import * as futbinApi from "../app/prices/futbinApi";
import * as holoScan from "../app/core/holoScan";
import * as relay from "../app/prices/futbinRelay";
import { fetchFutbinText } from "../app/prices/futbinClient";
import * as settings from "../app/core/settings";
import * as filters from "../app/core/filters";
import * as engine from "../app/core/engine";
import * as botItems from "../app/core/botItems";
import * as state from "../app/core/state";
import * as sbc from "../app/core/sbc";
import { createCancelToken } from "../app/core/async";
import { listTransferAtFutbin } from "../app/core/bulkSell";
import { runMigrations } from "../app/core/migrate";
import * as cardSets from "../app/prices/cardSets";
import * as usage from "../app/core/usage";

global.DOMParser = DOMParser;
const REAL_FIXTURE = require("path").join(process.cwd(), "test", "fixtures", "futbin-sbc-squad.html");

let failures = 0;
let passes = 0;
const check = (cond, label, extra) => {
  if (cond) { passes++; console.log(`  ✓ ${label}`); }
  else { failures++; console.log(`  ✗ ${label}`, extra !== undefined ? JSON.stringify(extra) : ""); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, timeout = 8000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > timeout) return false; await sleep(10); }
  return true;
};
const logs = () => state.getLogs().map((l) => `${l.type}: ${l.text}`);
const doc = (html) => new DOMParser().parseFromString(html, "text/html");

// Horloge simulée (Date.now) pour tester la planification sans attendre 2 minutes.
const realNow = Date.now.bind(Date);
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;

// ------------------------------------------------------------ FUTBIN simulé

const fmt = (n) => Number(n).toLocaleString("en-US");
const slug = (name) => String(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");
const searchRow = (card) => ({
  id: card.futbinId,
  name: card.name,
  position: card.position || "ST",
  ratingSquare: { rating: String(card.rating || 91) },
  location: { url: `/27/player/${card.futbinId}/${slug(card.name)}` },
  playerImage: { fixed: { url: { image1x: `https://cdn3.futbin.com/content/fifa27/img/players/${card.special ? "p" : ""}${card.eaId}.png?fm=png&w=40` } } },
  ...(card.version ? { version: card.version } : {}),
  ...(card.club ? { clubImage: { name: card.club } } : {}),
});
// Page de liste FUTBIN (JSON React embarqué, mêmes objets joueur que les pages d'équipe).
// Script Cloudflare présent sur TOUTES les vraies pages FUTBIN (ce n'est pas un blocage).
const CF_SCRIPT = `<script>window.__CF$cv$params={r:'a41622bf3f6b3d11',t:'MTc5MDQ2NjI1Nw=='};(function(){if(!document.body)return;var s=document.createElement('script');s.src='/cdn-cgi/challenge-platform/scripts/precursor/main.js';document.head.appendChild(s);})();</script>`;
// Page de liste FUTBIN : lignes tr.player-row (structure réelle FC 27), prix abrégés comme sur FUTBIN.
const abbr = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${+(n / 1000).toFixed(2)}K` : String(n));
const listRow = (card) => {
  const href = `/27/player/${card.futbinId}/${slug(card.name)}`;
  return `<tr class="player-row text-nowrap"><td class="table-name"><a href="${href}" class="player-row-playercard">
    <div class="playercard-27 playercard-s" title="${card.name}"><img alt="${card.name}" src="https://cdn3.futbin.com/content/fifa27/img/players/${card.special ? "p" : ""}${card.eaId}.png?fm=png" class="playercard-s-base-img">
    <div class="playercard-s-27-rating">${card.rating || 80}</div></div></a>
    <div class="table-player-info"><div><a href="${href}" class="table-player-name">${card.name}</a></div><div class="table-player-revision">${card.version || "Normal"}</div></div></td>
    <td class="table-rating"><div class="rating-square">${card.rating || 80}</div></td>
    <td class="table-item-score"><div>${card.itemScore || 100}</div></td>
    <td class="table-pos"><div class="table-pos-main"><span>LM</span></div></td>
    <td class="table-price no-wrap platform-ps-only"><div class="price bold">${abbr(card.ps)}<img alt="Coin"></div><div class="price-diff">2%</div></td>
    <td class="table-price no-wrap platform-pc-only"><div class="price bold">${abbr(card.pc || card.ps)}<img alt="Coin"></div></td></tr>`;
};
const listPage = (cards, lastPage = 1) => `<!DOCTYPE html><html><body><table class="futbin-table"><tbody>${cards.map(listRow).join("")}</tbody></table>
  <nav>${Array.from({ length: lastPage }, (_, i) => `<a href="/27/players?nation=163&amp;page=${i + 1}">${i + 1}</a>`).join("")}</nav>${CF_SCRIPT}</body></html>`;
const addListPage = (url, page, cards, lastPage) => {
  const target = new URL(url);
  if (page > 1) target.searchParams.set("page", String(page));
  futbin.pages.set(target.toString(), listPage(cards, lastPage));
};
const playerPage = (ps, pc) => `<!DOCTYPE html><html><head><title>FC 27</title></head><body>
  <div class="player-prices">
    <div class="price-box platform-ps-only price-box-original-player" data-id="1">
      <div class="price inline-with-icon lowest-price-1">${fmt(ps)}<img alt="Coin"></div>
      <div class="price inline-with-icon lowest-price-2">${fmt(ps + 1000)}<img alt="Coin"></div>
      <div class="prices-updated">Updated 5 mins ago</div>
    </div>
    <div class="price-box platform-pc-only price-box-original-player" data-id="1">
      <div class="price inline-with-icon lowest-price-1">${fmt(pc)}<img alt="Coin"></div>
    </div>
  </div>${CF_SCRIPT}</body></html>`;
const CLOUDFLARE = `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-platform">Checking your browser</div></body></html>`;

const futbin = {
  cards: new Map(), // eaId → { eaId, futbinId, name, rating, ps, pc }
  pages: new Map(), // url → html
  blocked: false,
  // Recherche et listes refusées (403), pages joueur servies : blocage partiel vu le 02/10.
  searchBlocked: false,
  requests: [],
  // API de l'appli FUTBIN (futbin.org) : lignes renvoyées par la recherche, statut HTTP forcé.
  api: [],
  apiStatus: 200,
};
const addCard = (card) => futbin.cards.set(card.eaId, Object.assign({ pc: card.ps }, card));
// Ligne de l'API de l'appli FUTBIN (mêmes champs que la vraie réponse, vus le 09/10/2026). Holo :
// animation holo renseignée ; signature : seulement les holo des têtes d'affiche.
const apiRow = ({ futbinId, eaId, baseId, name, common = "", rating = 85, rareType = 0, slug = "gold", holo = false, signature = false, ps = 0, pc = 0, closing = 0, min = 150, max = 10000, trend = null }) => ({
  ID: String(futbinId),
  playerid: String(baseId || eaId),
  resource_id: String(eaId),
  playername: name,
  common_name: common,
  rating: String(rating),
  raretype: String(rareType),
  rare: rareType ? "0" : "1",
  signature,
  holographicAnimation: holo ? "/design2/img/static/card-animations/27/animation.webp" : null,
  cardImage: `https://cdn3.futbin.com/content/fifa27/img/cards/hd/${rareType}_${slug}.png?fm=png&w=644`,
  ps_LCPrice: ps || null,
  pc_LCPrice: pc || null,
  ps_LCPClosing: closing || null,
  pc_LCPClosing: null,
  ps_MinPrice: min,
  ps_MaxPrice: max,
  pc_MinPrice: min,
  pc_MaxPrice: max,
  ps_PriceTrend: trend,
  pc_PriceTrend: null,
  ps_PRP: 10,
  pc_PRP: 10,
});
const plainText = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

global.GM_xmlhttpRequest = (options) => {
  const url = options.url;
  futbin.requests.push({ url, at: Date.now() });
  const reply = (status, text) => setTimeout(() => options.onload({ status, responseText: text }), 5);
  const api = url.match(/futbin\.org\/futbin\/api\/searchPlayersByName\?playername=([^&]+)/);
  if (api) {
    if (futbin.apiStatus !== 200) {
      reply(futbin.apiStatus, '{"error":"refused"}');
      return;
    }
    const query = plainText(decodeURIComponent(api[1]));
    reply(200, JSON.stringify({ data: futbin.api.filter((row) => plainText(row.playername).includes(query) || plainText(row.common_name).includes(query)) }));
    return;
  }
  if (futbin.blocked) {
    reply(403, CLOUDFLARE);
    return;
  }
  if (futbin.searchBlocked && /\/players\/search|\/27\/players(?:[?#]|$)/.test(url)) {
    reply(403, "<html><div>Error - 403. Your client does not have permission to access this page at this time.</div></html>");
    return;
  }
  const search = url.match(/\/players\/search\?.*query=([^&]+)/);
  if (search) {
    const query = decodeURIComponent(search[1]).toLowerCase();
    const rows = Array.from(futbin.cards.values()).filter((card) => String(card.eaId) === query || card.name.toLowerCase().includes(query));
    reply(200, JSON.stringify(rows.map(searchRow)));
    return;
  }
  const player = url.match(/\/27\/player\/(\d+)\//);
  if (player) {
    const card = Array.from(futbin.cards.values()).find((c) => c.futbinId === Number(player[1]));
    reply(card ? 200 : 404, card ? playerPage(card.ps, card.pc) : "Not found");
    return;
  }
  if (futbin.pages.has(url)) {
    reply(200, futbin.pages.get(url));
    return;
  }
  reply(404, "Not found");
};

const baseSettings = () => {
  settings.resetSettings();
  settings.setSetting("ui.language", "fr");
  settings.setSetting("timing.wait", "0.05-0.08");
  settings.setSetting("timing.maxPerMinute", 0);
  settings.setSetting("timing.pauseEvery", "");
  settings.setSetting("timing.pauseFor", "");
  settings.setSetting("timing.stopAfter", "");
  settings.setSetting("timing.afterBuy", "");
  settings.setSetting("timing.keepAlive", false);
  settings.setSetting("notify.sound", false);
  settings.setSetting("transfer.checkEvery", 1000);
  settings.setSetting("prices.minGap", 0.8);
  settings.setSetting("prices.iframeFallback", false);
  // Lecture par les pages FUTBIN (recherche puis page joueur) ; l'API de l'appli est testée à part.
  settings.setSetting("prices.source", "pages");
  settings.setSetting("sbc.wait", "0.05-0.1");
  // Anti-perte avant l'achat : testé à part (tests « anti-perte avant l'achat »).
  settings.setSetting("buy.profitCheck", false);
};
const setFilter = (patch) => {
  const f = filters.getActiveFilter();
  filters.updateFilter(f.id, Object.assign({ player: { id: 231747, name: "Mbappé", rating: 91 }, maxBuy: 0, sellPrice: 0, maxBid: 0, minBuy: 0, definitionId: 0, nation: -1, playStyle: -1, minRating: 0, maxRating: 0, priceMode: "fixed", futbinPercent: 90, bidPercent: 0, sellMode: "global", sellPercent: "" }, patch));
  filters.setRotation({ enabled: false });
};

// Mode « prix marché EA » : marché simulé d'une version. Les relevés du prix (recherches exactes,
// sans enchère max) voient les annonces filtrées comme par le serveur EA (version, style, prix max) ;
// chaque recherche du bot (enchère max anti-cache) reçoit le lot suivant de nouvelles annonces.
const SHADOW = 268;
const marketScenario = (mock, scenario) => {
  mock.setMarket((n, criteria, page, makeItem) => {
    const item = (l) => makeItem({ tradeId: l.tradeId, bin: l.bin, definitionId: 231747, extra: { playStyle: l.style } });
    if (!criteria.maxBid) {
      const items = scenario.listings
        .filter(() => criteria.defId.includes(231747))
        .filter((l) => !(criteria.playStyle > 0) || l.style === criteria.playStyle)
        .filter((l) => !criteria.maxBuy || l.bin <= criteria.maxBuy)
        .slice(0, 21)
        .map(item);
      return { success: true, data: { items } };
    }
    return { success: true, data: { items: (scenario.fresh.shift() || []).map(item) } };
  });
};
const marketFilter = (patch) => setFilter(Object.assign({ definitionId: 231747, playStyle: SHADOW, priceMode: "market", futbinPercent: 90 }, patch));
const stopAndWait = async () => { engine.stopBot("fin du test", { manual: true }); await until(() => !engine.isRunning()); await sleep(30); };
const resetFutbin = () => {
  cardSets.resetCardSetsForTests();
  service.resetPriceServiceForTests();
  futbin.cards.clear();
  futbin.pages.clear();
  futbin.blocked = false;
  futbin.searchBlocked = false;
  futbin.requests = [];
  futbin.api = [];
  futbin.apiStatus = 200;
  clockOffset = 0;
};

// ------------------------------------------------------------------ tests

const main = async () => {
  // Planchers de sécurité abaissés : les scénarios tournent en quelques secondes.
  engine.setSafetyForTests({ minWaitMs: 0, actionGapMs: [0, 0], minPauseSeconds: 0, autoPause: false });
  console.log("\n# lecture FUTBIN (format FC 27 vérifié)");
  {
    const rows = parse.parseSearchJson(JSON.stringify([searchRow({ futbinId: 8, eaId: 231747, name: "Kylian Mbappé", rating: 91 })]));
    check(rows.length === 1 && rows[0].futbinId === 8 && rows[0].eaId === 231747 && rows[0].rating === 91, "recherche JSON : id FUTBIN, id EA (image), note", rows[0]);
    check(rows[0].url === "https://www.futbin.com/27/player/8/kylian-mbappe", "URL absolue de la page joueur", rows[0].url);
    check(parse.eaIdFromImage("https://cdn3.futbin.com/content/fifa27/img/players/p50563992.png?fm=png") === 50563992, "carte spéciale : id EA « p50563992 »");
    const page = doc(playerPage(227000, 205000));
    const ps = parse.parsePlayerDocument(page, "console");
    check(ps.price === 227000 && ps.prices.length === 2 && ps.prices[1] === 228000, "prix console (lowest-price-1)", ps);
    check(ps.updatedAgoSec === 300, "âge « 5 mins ago »", ps.updatedAgoSec);
    check(parse.parsePlayerDocument(page, "pc").price === 205000, "prix PC");
    const sentence = doc("<html><body><p>His current price on FUT is 222,000 on PlayStation, 222,000 on Xbox, and 205,000 on PC.</p></body></html>");
    check(parse.parsePlayerDocument(sentence, "console").price === 222000 && parse.parsePlayerDocument(sentence, "pc").price === 205000, "secours : phrase « current price on FUT »");
    const blocked = parse.parsePlayerDocument(doc(CLOUDFLARE), "console");
    check(blocked.blocked && !blocked.price, "page Cloudflare détectée", blocked);
    check(parse.parseCoins("1.2M") === 1200000 && parse.parseCoins("12.5K") === 12500 && parse.parseCoins("227,000") === 227000 && parse.parseCoins("—") === 0, "montants 1.2M / 12.5K / 227,000 / —");
    check(parse.parseCoins("15,000 15,250") === 15000 && parse.parseCoins("15,000 2.5%") === 15000 && parse.parseCoins("15,000 5 mins ago") === 15000, "un seul montant lu (pas de chiffres collés)", [parse.parseCoins("15,000 15,250"), parse.parseCoins("15,000 2.5%")]);
    const tricky = doc(`<html><body><div class="price-box platform-ps-only price-box-original-player">
      <div class="lowest-prices-wrapper">Lowest 99 listings</div>
      <div class="price lowest-price-1">45,500 <span class="trend">+2.5%</span></div>
      <div class="price lowest-price-2">46,000</div></div></body></html>`);
    const trickyPrice = parse.parsePlayerDocument(tricky, "console");
    check(trickyPrice.price === 45500 && trickyPrice.prices.join() === "45500,46000", "conteneur « lowest-prices-… » ignoré, tendance ignorée", trickyPrice);
    const incoherent = doc(`<html><body><div class="price-box platform-ps-only"><div class="lowest-price-1">1,500,000</div><div class="lowest-price-2">46,000</div></div></body></html>`);
    check(parse.parsePlayerDocument(incoherent, "console").price === 0, "prix incohérents refusés (aucun prix plutôt qu'un faux)");
    check(parse.parseAgo("an hour ago") === 3600 && parse.parseAgo("just now") === 0 && parse.parseAgo("") === null, "âges « an hour ago », « just now »");
    check(parse.formationKey("4-3-3(4)") === "4334" && parse.formationKey("4-2-3-1") === "4231" && parse.formationKey("3-5-2") === "352", "clés de formation");
  }

  console.log("\n# page d'équipe FUTBIN (lecture tolérante)");
  {
    const positions = ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "CAM", "RW", "ST", "LW"];
    const cards = positions.map((pos, i) => `<div class="card-slot"><a href="/27/player/${500 + i}/joueur-${i}"><div class="card">
      <img class="player-img" src="https://cdn3.futbin.com/content/fifa27/img/players/${i === 9 ? "p" : ""}${1001 + i}.png" alt="Joueur ${i}">
      <div class="rating">${80 + i}</div><div class="position">${pos}</div><div class="name">Joueur ${i}</div><div class="price">${i + 1}.5K</div></div></a></div>`).join("");
    const sidebar = [239085, 209331, 188545].map((id, i) => `<a href="/27/player/${900 + i}/pop"><img src="https://cdn3.futbin.com/content/fifa27/img/players/${id}.png"></a>`).join("");
    const html = `<html><body><aside class="popular">${sidebar}</aside><div class="squad-wrapper">
      <div class="formation-select"><select class="formation"><option value="4-4-2">4-4-2</option><option value="4-3-3(4)" selected>4-3-3(4)</option></select></div>
      <div class="field">${cards}</div></div></body></html>`;
    const squad = parse.parseSquadDocument(doc(html));
    check(squad.players.length === 11, "11 joueurs du terrain (encart « populaires » ignoré)", squad.players.length);
    check(squad.players[0].eaId === 1001 && squad.players[9].eaId === 1010 && squad.players[10].eaId === 1011, "ids EA dans l'ordre (dont carte spéciale)", squad.players.map((p) => p.eaId));
    check(squad.formation === "4-3-3(4)" && squad.formationKey === "4334", "formation lue", [squad.formation, squad.formationKey]);
    const p = squad.players[7];
    check(p.position === "CAM" && p.rating === 87 && p.price === 8500 && p.futbinId === 507 && p.name === "Joueur 7", "poste, note, prix, lien et nom", p);
  }

  console.log("\n# vraie page FUTBIN d'une solution DCE (JSON embarqué)");
  const REAL_URL = "https://www.futbin.com/27/squad/100010123/sbc";
  const realHtml = require("fs").readFileSync(REAL_FIXTURE, "utf8");
  {
    const squad = parse.parseSquadText(realHtml);
    check(squad.source === "json" && squad.players.length === 10, "10 joueurs lus dans le JSON de la page (poste bloqué omis)", [squad.source, squad.players.length]);
    check(squad.formation === "4-3-3(4)" && squad.formationKey === "4334" && squad.challengeName === "Madrid Dreams", "formation 4-3-3(4) et nom du défi", [squad.formation, squad.formationKey, squad.challengeName]);
    const galeno = squad.players[0];
    check(galeno.name === "Galeno" && galeno.eaId === 239482 && galeno.futbinId === 587 && galeno.rating === 81 && galeno.slotKey === "cardlid1" && galeno.slotPosition === "LW", "Galeno : id EA 239482, id FUTBIN 587, note 81, poste LW", galeno);
    check(galeno.prices.console === 700 && galeno.prices.pc === 650 && galeno.url === "https://www.futbin.com/27/player/587/wenderson-nascimento-galeno", "prix console / PC et lien FUTBIN", [galeno.prices, galeno.url]);
    const kaku = squad.players.find((p) => p.name === "Kaku");
    check(kaku && kaku.position === "CAM" && kaku.slotPosition === "LB", "Kaku (carte MOC) placé en DG comme sur FUTBIN", kaku && [kaku.position, kaku.slotPosition]);
    check(squad.players.map((p) => p.slotPosition).join() === "LW,ST,CM,CAM,CM,LB,CB,CB,RB,GK", "postes de la solution dans l'ordre", squad.players.map((p) => p.slotPosition));
  }

  console.log("\n# service de prix : lecture, garde-fou, blocage");
  {
    baseSettings();
    resetFutbin();
    setPageForTests(createMockEa().page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", rating: 91, ps: 227000, pc: 205000 });
    const record = await service.requestPrice(231747, { name: "Mbappé", rating: 91 });
    check(record && record.price === 227000 && record.platform === "console", "prix console lu (recherche + page joueur)", record);
    check(service.currentPrice(231747) === 227000, "prix utilisable par le bot");
    check(futbin.requests.length === 2 && /query=231747/.test(futbin.requests[0].url), "2 requêtes : recherche par id EA puis page", futbin.requests.map((r) => r.url));
    // Saut de +76 % : gardé en suspens, l'ancien prix reste utilisé.
    futbin.cards.get(231747).ps = 400000;
    await service.requestPrice(231747, {});
    const suspect = service.getPriceRecord(231747);
    check(suspect.price === 227000 && suspect.suspect && suspect.suspect.price === 400000, "saut anormal : ancien prix gardé, saut en vérification", suspect);
    check(service.currentPrice(231747, 300000, "buy") === 227000 && service.currentPrice(231747, 300000, "sell") === 400000, "pendant la vérification : achat au plus bas, vente au plus haut");
    check(service.currentPrice(231747, 1) === 0, "le prix confirmé garde son âge (pas rajeuni par le saut)");
    check(futbin.requests.length === 3, "lien FUTBIN mémorisé (plus de recherche)", futbin.requests.length);
    await service.requestPrice(231747, {});
    const confirmed = service.getPriceRecord(231747);
    check(confirmed.price === 400000 && !confirmed.suspect, "saut confirmé à la 2e lecture → nouveau prix", confirmed);
    // Espacement minimum entre deux requêtes FUTBIN.
    // (la recherche et la page d'une même carte partent ensemble ; l'écart s'applique entre deux cartes)
    const gaps = futbin.requests.slice(2).map((r, i) => r.at - futbin.requests[i + 1].at);
    check(gaps.length >= 2 && gaps.every((g) => g >= 790), "requêtes espacées (≥ 0,8 s)", gaps);
    // Blocage Cloudflare → ralentissement automatique.
    futbin.blocked = true;
    addCard({ eaId: 1234, futbinId: 44, name: "Test", ps: 5000 });
    await service.requestPrice(1234, { name: "Test" });
    const status = service.getFutbinStatus();
    check(status.blockedUntil > Date.now() && /Cloudflare/.test(status.lastError), "blocage détecté → pause des requêtes FUTBIN", status);
    check(!service.currentPrice(1234), "aucun prix inventé quand FUTBIN bloque");
  }

  console.log("\n# service de prix : recherche refusée, pages joueur servies");
  {
    baseSettings();
    resetFutbin();
    setPageForTests(createMockEa().page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
    addCard({ eaId: 20801, futbinId: 9, name: "Cristiano Ronaldo", ps: 30000 });
    // Lien de Ronaldo déjà connu (page joueur), celui de Mbappé non (recherche nécessaire).
    service.seedFutbinPrice(20801, { price: 0, platform: "console", link: { futbinId: 9, url: "https://www.futbin.com/27/player/9/cristiano-ronaldo" } });
    futbin.searchBlocked = true;
    await service.requestPrice(231747, { name: "Mbappé" });
    const status = service.getFutbinStatus();
    check(!status.blockedUntil || status.blockedUntil <= Date.now(), "recherche refusée : la file FUTBIN n'est pas mise en pause", status);
    check(!service.currentPrice(231747), "recherche refusée : pas de prix pour la carte sans lien");
    await service.requestPrice(20801, {});
    check(service.currentPrice(20801) === 30000, "page joueur connue toujours lue malgré la recherche refusée", service.getPriceRecord(20801));
    check(
      futbin.requests.some((r) => /\/27\/player\/9\//.test(r.url)),
      "la page joueur est bien demandée à FUTBIN",
      futbin.requests.map((r) => r.url)
    );
  }

  console.log("\n# service de prix : rafraîchissement intelligent");
  {
    baseSettings();
    resetFutbin();
    setPageForTests(createMockEa().page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
    addCard({ eaId: 20801, futbinId: 9, name: "Cristiano Ronaldo", ps: 30000 });
    const untrackHot = service.trackPrice(231747, { name: "Mbappé" }, "hot");
    await until(() => service.currentPrice(231747) === 50000);
    const afterFirst = futbin.requests.length;
    clockOffset += 40 * 1000;
    await sleep(1300);
    check(futbin.requests.length === afterFirst, "cible du bot : pas de relecture avant l'intervalle (90 s)", futbin.requests.length - afterFirst);
    futbin.cards.get(231747).ps = 52000;
    clockOffset += 60 * 1000;
    await until(() => service.currentPrice(231747) === 52000, 4000);
    check(service.currentPrice(231747) === 52000, "cible du bot : relue après 90 s, nouveau prix suivi", service.getPriceRecord(231747));
    const untrackVisible = service.trackPrice(20801, { name: "Ronaldo" }, "visible");
    await until(() => service.currentPrice(20801) === 30000);
    const beforeVisible = futbin.requests.length;
    clockOffset += 100 * 1000;
    await sleep(1300);
    const hotRefreshes = futbin.requests.filter((r) => /player\/8\//.test(r.url)).length;
    check(futbin.requests.filter((r) => /player\/9\//.test(r.url)).length === 1, "carte affichée : pas relue avant 120 s", futbin.requests.length - beforeVisible);
    clockOffset += 30 * 1000;
    await until(() => futbin.requests.filter((r) => /player\/9\//.test(r.url)).length === 2, 4000);
    check(futbin.requests.filter((r) => /player\/9\//.test(r.url)).length === 2, "carte affichée : relue après 120 s");
    untrackHot();
    untrackVisible();
    const before = futbin.requests.length;
    clockOffset += 10 * 60 * 1000;
    await sleep(1300);
    check(futbin.requests.length === before, "plus suivie = plus aucune requête", futbin.requests.length - before);
    check(hotRefreshes >= 2, "relecture périodique de la cible", hotRefreshes);
  }

  console.log("\n# moteur : achat à % du prix FUTBIN");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
    setFilter({ priceMode: "futbin", futbinPercent: 90, sellMode: "futbin", sellPercent: "100" });
    mock.setMarket((n, c, p, makeItem) =>
      n === 2 ? { success: true, data: { items: [makeItem({ tradeId: "t2", bin: 46000 }), makeItem({ tradeId: "t1", bin: 44000 })] } } : { success: true, data: { items: [] } }
    );
    engine.startBot();
    await until(() => mock.calls.list.length >= 1, 8000);
    await stopAndWait();
    const first = mock.calls.search[0] && mock.calls.search[0].criteria;
    check(first && first.maxBuy === 45000, "prix d'achat max = 90 % de 50 000 = 45 000", first);
    check(mock.calls.bid.length === 1 && mock.calls.bid[0].tradeId === "t1" && mock.calls.bid[0].price === 44000, "achète à 44 000, ignore 46 000", mock.calls.bid);
    check(mock.calls.list[0] && mock.calls.list[0].bin === 50000, "revente à 100 % du prix FUTBIN (50 000)", mock.calls.list[0]);
    check(logs().some((l) => /Prix FUTBIN .*50\s000 → achat max 45\s000/.test(l)), "journal : prix FUTBIN et achat max", logs().slice(-12));
  }

  console.log("\n# moteur : enchère max à % du prix FUTBIN");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("bid.enabled", true);
    settings.setSetting("bid.expiresWithin", "5M");
    settings.setSetting("bid.searchEvery", 2);
    const mock = createMockEa();
    setPageForTests(mock.page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
    setFilter({ priceMode: "futbin", futbinPercent: 80, bidPercent: 70, maxBid: 0, sellMode: "futbin", sellPercent: "100" });
    // Enchère 70 % de 50 000 = 35 000 : « cheap » à 30 000 (palier suivant 30 250 accepté), « dear » à 35 000 refusée.
    mock.setMarket((n, c) =>
      c.maxBid && !c.maxBuy
        ? { success: true, data: { items: [mock.makeItem({ tradeId: "cheap", bin: 60000, bid: 30000, expires: 120 }), mock.makeItem({ tradeId: "dear", bin: 60000, bid: 35000, expires: 100 })] } }
        : { success: true, data: { items: [] } }
    );
    engine.startBot();
    await until(() => mock.calls.bid.length >= 1, 8000);
    await stopAndWait();
    const bidSearch = mock.calls.search.find((call) => call.criteria.maxBid && !call.criteria.maxBuy);
    check(bidSearch && bidSearch.criteria.maxBid === 35000, "recherche enchères plafonnée à 70 % du prix FUTBIN", bidSearch && bidSearch.criteria);
    check(mock.calls.bid.length === 1 && mock.calls.bid[0].tradeId === "cheap" && mock.calls.bid[0].price === 30250, "enchère sous 70 % seulement (palier suivant)", mock.calls.bid);
  }

  console.log("\n# moteur : le prix FUTBIN change pendant la session");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
    setFilter({ priceMode: "futbin", futbinPercent: 90, maxBuy: 0 });
    engine.startBot();
    await until(() => mock.calls.search.length >= 2);
    futbin.cards.get(231747).ps = 55000;
    await service.requestPrice(231747, {});
    const at = mock.calls.search.length;
    await until(() => mock.calls.search.length >= at + 2);
    await stopAndWait();
    const last = mock.calls.search[mock.calls.search.length - 1].criteria;
    check(last.maxBuy === 49500, "nouveau prix max 90 % de 55 000 = 49 500 sans redémarrer", last);
    check(logs().some((l) => /50\s000 → 55\s000/.test(l)), "variation annoncée dans le journal", logs().slice(-8));
  }

  console.log("\n# moteur : plafond absolu en mode FUTBIN");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
    setFilter({ priceMode: "futbin", futbinPercent: 95, maxBuy: 40000 });
    engine.startBot();
    await until(() => mock.calls.search.length >= 1);
    await stopAndWait();
    check(mock.calls.search[0].criteria.maxBuy === 40000, "min(95 % FUTBIN, plafond 40 000) = 40 000", mock.calls.search[0].criteria);
  }

  console.log("\n# moteur : sans prix FUTBIN, aucun achat");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    futbin.blocked = true;
    setFilter({ priceMode: "futbin", futbinPercent: 90 });
    engine.startBot();
    await sleep(1500);
    check(mock.calls.search.length === 0 && mock.calls.bid.length === 0, "aucune recherche ni achat sans prix récent", mock.calls.search.length);
    check(logs().some((l) => /En attente du prix FUTBIN/.test(l)), "attente expliquée dans le journal", logs().slice(-5));
    await stopAndWait();
  }

  console.log("\n# moteur : revente FUTBIN sans prix → liste des transferts");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({ priceMode: "fixed", maxBuy: 45000, sellMode: "futbin", sellPercent: "100" });
    futbin.blocked = true;
    mock.setMarket((n, c, p, makeItem) => (n === 1 ? { success: true, data: { items: [makeItem({ tradeId: "x1", bin: 44000 })] } } : { success: true, data: { items: [] } }));
    engine.startBot();
    await until(() => mock.calls.bid.length >= 1, 6000);
    await sleep(1500);
    const waitedMoves = mock.calls.move.length;
    clockOffset += 100 * 1000;
    await until(() => mock.calls.move.length >= 1, 8000);
    await stopAndWait();
    check(waitedMoves === 0, "le prix FUTBIN est attendu (jusqu'à 90 s) avant de renoncer", waitedMoves);
    check(mock.calls.list.length === 0 && mock.calls.move.length === 1, "jamais listée au hasard : envoyée dans la liste des transferts", [mock.calls.list, mock.calls.move]);
  }

  console.log("\n# moteur : jamais de revente à perte (prix FUTBIN en baisse après l'achat)");
  {
    baseSettings();
    resetFutbin();
    // Prix FUTBIN relu après l'achat : 25 500 → 99 % = 25 250, soit 23 987 net pour 24 000 payés.
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 25500 });
    const mock = createMockEa({ limits: { minimum: 10000, maximum: 200000 } });
    setPageForTests(mock.page);
    setFilter({ priceMode: "fixed", maxBuy: 24000, sellMode: "futbin", sellPercent: "99" });
    mock.setMarket((n, c, p, makeItem) => (n === 1 ? { success: true, data: { items: [makeItem({ tradeId: "loss1", bin: 24000 })] } } : { success: true, data: { items: [] } }));
    engine.startBot();
    await until(() => mock.calls.list.length >= 1, 12000);
    await stopAndWait();
    const listed = mock.calls.list[0];
    check(listed && listed.bin === 25500, "mise en vente au seuil de rentabilité 25 500 (et pas 25 250)", mock.calls.list);
    check(logs().some((line) => /seuil de rentabilité/.test(line)), "journal : prix relevé au seuil de rentabilité", logs().slice(-6));
  }

  console.log("\n# moteur : anti-perte avant l'achat (revente prévue trop basse)");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("buy.profitCheck", true);
    const mock = createMockEa();
    setPageForTests(mock.page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
    // Achat jusqu'à 96 % (48 000), revente à 99 % (49 500 → 47 025 net) : 47 500 ferait perdre 475.
    setFilter({ priceMode: "futbin", futbinPercent: 96, sellMode: "futbin", sellPercent: "99" });
    mock.setMarket((n, c, p, makeItem) => (n === 1 ? { success: true, data: { items: [makeItem({ tradeId: "g1", bin: 47500 })] } } : { success: true, data: { items: [] } }));
    engine.startBot();
    await until(() => mock.calls.search.length >= 3, 8000);
    await stopAndWait();
    check(mock.calls.bid.length === 0, "47 500 non acheté : revente 49 500 = 47 025 net", mock.calls.bid);
    check(logs().some((l) => /Achat évité : .*47\s500.*49\s500.*−475/.test(l)), "journal : achat évité, revente et perte chiffrées", logs().slice(-8));
    check(logs().some((l) => /96 % du prix FUTBIN et revente à 99 %.*94 % maximum/.test(l)), "réglage à perte signalé au départ (achat ≤ 94 %)", logs().slice(0, 12));
  }

  console.log("\n# moteur : anti-perte avant l'achat (annonce moins chère sur le marché)");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("buy.profitCheck", true);
    const mock = createMockEa();
    setPageForTests(mock.page);
    // Prix fixe 45 000, revente fixe 50 000, mais une annonce à 45 500 : revente ≈ 45 250 (42 987 net).
    setFilter({ priceMode: "fixed", maxBuy: 45000, sellMode: "fixed", sellPrice: 50000 });
    mock.setMarket((n, c, p, makeItem) =>
      n === 1 ? { success: true, data: { items: [makeItem({ tradeId: "m2", bin: 45500 }), makeItem({ tradeId: "m1", bin: 44000 })] } } : { success: true, data: { items: [] } }
    );
    engine.startBot();
    await until(() => mock.calls.search.length >= 3, 8000);
    await stopAndWait();
    check(mock.calls.bid.length === 0, "44 000 non acheté : une annonce à 45 500 existe", mock.calls.bid);
    check(logs().some((l) => /Achat évité : .*44\s000.*annonce à 45\s500.*45\s250.*−1\s013/.test(l)), "journal : annonce du marché et revente réaliste", logs().slice(-8));
  }

  console.log("\n# moteur : anti-perte avant l'achat (vraie affaire achetée)");
  {
    baseSettings();
    resetFutbin();
    state.clearLogs();
    settings.setSetting("buy.profitCheck", true);
    const mock = createMockEa();
    setPageForTests(mock.page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
    setFilter({ priceMode: "futbin", futbinPercent: 90, sellMode: "futbin", sellPercent: "99-100" });
    // Deux affaires sous le prix max (45 000) : ce sont des affaires, pas le prix du marché.
    mock.setMarket((n, c, p, makeItem) =>
      n === 1 ? { success: true, data: { items: [makeItem({ tradeId: "v2", bin: 41000 }), makeItem({ tradeId: "v1", bin: 40000 })] } } : { success: true, data: { items: [] } }
    );
    engine.startBot();
    await until(() => mock.calls.list.length >= 1, 8000);
    await stopAndWait();
    check(mock.calls.bid.length === 1 && mock.calls.bid[0].tradeId === "v1" && mock.calls.bid[0].price === 40000, "40 000 acheté (revente ≥ 49 500)", mock.calls.bid);
    check(!logs().some((l) => /Achat évité/.test(l)), "aucun achat évité à tort", logs().slice(-8));
  }

  console.log("\n# moteur : relist au prix FUTBIN");
  {
    baseSettings();
    resetFutbin();
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 60000 });
    const probe = createMockEa();
    const expired = probe.makeItem({ tradeId: "e1", state: "expired", bin: 70000 });
    const mock = createMockEa({ transferItems: [expired] });
    setPageForTests(mock.page);
    settings.setSetting("transfer.relistExpired", true);
    settings.setSetting("transfer.relistMode", "futbin");
    settings.setSetting("sell.futbinPercent", "100");
    setFilter({ maxBuy: 45000 });
    await service.requestPrice(231747, {});
    engine.startBot();
    await until(() => mock.calls.list.length >= 1, 6000);
    await stopAndWait();
    check(mock.calls.list.length === 1 && mock.calls.list[0].bin === 60000 && mock.calls.relist === 0, "invendu relisté à 60 000 (FUTBIN), pas au même prix", [mock.calls.list, mock.calls.relist]);
  }

  console.log("\n# moteur : relist au prix du marché (vente rapide)");
  {
    const run = async ({ ownCards, botItem }) => {
      baseSettings();
      resetFutbin();
      botItems.resetBotItemsForTests();
      addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
      const probe = createMockEa();
      const expired = probe.makeItem({ tradeId: "e1", state: "expired", bin: 60000, own: true, extra: { lastSalePrice: 52000 } });
      if (botItem) {
        botItems.rememberBotItem(expired, 52000);
      }
      const mock = createMockEa({ transferItems: [expired] });
      setPageForTests(mock.page);
      settings.setSetting("transfer.relistExpired", true);
      settings.setSetting("transfer.relistMode", "market");
      settings.setSetting("sell.noLossOwnCards", ownCards);
      setFilter({ maxBuy: 45000 });
      // Marché : annonces des autres joueurs à 49 000 et 51 000 (aucune sous le prix d'achat max du filtre).
      mock.setMarket((n, c, p, makeItem) => ({ success: true, data: { items: [makeItem({ tradeId: `m${n}a`, bin: 49000 }), makeItem({ tradeId: `m${n}b`, bin: 51000 })] } }));
      await service.requestPrice(231747, {});
      engine.startBot();
      await until(() => mock.calls.list.length >= 1, 8000);
      await stopAndWait();
      return mock;
    };
    const fast = await run({ ownCards: false, botItem: false });
    check(fast.calls.list.length === 1 && fast.calls.list[0].bin === 48750, "ma carte : remise en vente à 48 750 (moins chère 49 000 − 1 palier), même sous le prix payé", fast.calls.list);
    const guarded = await run({ ownCards: true, botItem: false });
    check(guarded.calls.list.length === 1 && guarded.calls.list[0].bin >= 54750, "« Jamais à perte » sur mes cartes : relevée au seuil de rentabilité", guarded.calls.list);
    const bot = await run({ ownCards: false, botItem: true });
    check(bot.calls.list.length === 1 && bot.calls.list[0].bin >= 54750, "carte achetée par le bot : toujours protégée", bot.calls.list);
    check(logs().some((l) => /au prix du marché : 48\s750/.test(l)), "journal : prix du marché", logs().slice(-10));
    settings.setSetting("sell.noLossOwnCards", true);
  }

  console.log("\n# moteur : remise en vente au prix du marché d'une carte stylée (même style, annonce bradée ignorée)");
  {
    baseSettings();
    resetFutbin();
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
    const probe = createMockEa();
    const expired = probe.makeItem({ tradeId: "e1", state: "expired", bin: 60000, own: true, extra: { lastSalePrice: 40000, playStyle: 268 } });
    const mock = createMockEa({ transferItems: [expired] });
    setPageForTests(mock.page);
    settings.setSetting("transfer.relistExpired", true);
    settings.setSetting("transfer.relistMode", "market");
    settings.setSetting("sell.noLossOwnCards", false);
    setFilter({ maxBuy: 30000 });
    // Variante Ombre : une annonce bradée à 40 000, puis 52 000 et 53 000 ; la carte nue (style de base) à 45 000.
    // Identifiants stables : une même annonce vue par deux recherches compte une fois.
    mock.setMarket((n, c, p, makeItem) => {
      const all = [
        { tradeId: "mx", bin: 40000, style: 268 },
        { tradeId: "ma", bin: 52000, style: 268 },
        { tradeId: "mb", bin: 53000, style: 268 },
        { tradeId: "mc", bin: 45000, style: 250 },
      ];
      const items = all
        .filter((l) => !(c.playStyle > 0) || l.style === c.playStyle)
        .filter((l) => !c.maxBuy || l.bin <= c.maxBuy)
        .map((l) => makeItem({ tradeId: l.tradeId, bin: l.bin, extra: { playStyle: l.style } }));
      return { success: true, data: { items } };
    });
    await service.requestPrice(231747, {});
    engine.startBot();
    await until(() => mock.calls.list.length >= 1, 8000);
    await stopAndWait();
    const relistSearch = mock.calls.search.find((s) => !s.criteria.maxBid);
    check(relistSearch && relistSearch.criteria.playStyle === 268, "recherche du prix limitée au style Ombre de la carte", relistSearch && relistSearch.criteria);
    check(mock.calls.list.length === 1 && mock.calls.list[0].bin === 51500, "remise en vente à 51 500 (52 000 − 1 palier) : annonce bradée à 40 000 et carte nue ignorées", mock.calls.list);
    settings.setSetting("sell.noLossOwnCards", true);
  }

  console.log("\n# moteur : pas d'achat sur une carte en chute (prix FUTBIN)");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("buy.fallingGuard", 5);
    const mock = createMockEa();
    setPageForTests(mock.page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
    setFilter({ priceMode: "futbin", futbinPercent: 90 });
    engine.startBot();
    await until(() => mock.calls.search.length >= 1, 8000);
    futbin.cards.get(231747).ps = 46000;
    await service.requestPrice(231747, {});
    await sleep(50);
    mock.setMarket((n, c, p, makeItem) => ({ success: true, data: { items: [makeItem({ tradeId: `fall${n}`, bin: 40000 })] } }));
    const at = mock.calls.search.length;
    await until(() => mock.calls.search.length >= at + 3, 8000);
    await stopAndWait();
    check(mock.calls.bid.length === 0, "prix FUTBIN −8 % en 20 min : aucun achat à 40 000", mock.calls.bid);
    check(logs().some((l) => /en chute \(−8 %/.test(l)), "journal : carte en chute", logs().slice(-8));
    settings.setSetting("buy.fallingGuard", 0);
  }

  console.log("\n# mise en vente groupée au prix FUTBIN");
  {
    baseSettings();
    resetFutbin();
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 60000 });
    const probe = createMockEa();
    const items = [
      probe.makeItem({ tradeId: "0", state: "none", definitionId: 231747 }),
      probe.makeItem({ tradeId: "s1", state: "selling", definitionId: 231747 }),
      probe.makeItem({ tradeId: "e2", state: "expired", definitionId: 231747 }),
    ];
    const mock = createMockEa({ transferItems: items });
    setPageForTests(mock.page);
    settings.setSetting("sell.futbinPercent", "95");
    const report = await listTransferAtFutbin({ token: createCancelToken() });
    check(report.total === 2 && report.listed === 2, "disponible + invendue listées, celle en vente ignorée", report);
    check(mock.calls.list.every((l) => l.bin === 57000), "prix = 95 % de 60 000 = 57 000", mock.calls.list);
  }

  console.log("\n# moteur : garde-fou page pleine en mode FUTBIN");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", ps: 50000 });
    setFilter({ priceMode: "futbin", futbinPercent: 90 });
    mock.setMarket((n, c, p, makeItem) => ({ success: true, data: { items: Array.from({ length: 21 }, (_, i) => makeItem({ tradeId: `f${n}-${i}`, bin: 30000 + i * 100 })) } }));
    engine.startBot();
    await until(() => mock.calls.search.length >= 2);
    await stopAndWait();
    check(mock.calls.bid.length === 0, "21 annonces sous le prix max : aucun achat (prix FUTBIN au-dessus du marché)", mock.calls.bid.length);
    check(logs().some((l) => /page pleine/.test(l)), "alerte claire dans le journal", logs().slice(-4));
  }

  console.log("\n# moteur : prix marché EA (version exacte + style de chimie)");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    marketFilter({});
    const scenario = {
      // Ombre à 20 000 ×2 et 21 000 ; la même carte avec un autre style, moins chère, ne compte pas.
      listings: [
        { tradeId: "s1", bin: 20000, style: SHADOW },
        { tradeId: "s2", bin: 20000, style: SHADOW },
        { tradeId: "s3", bin: 21000, style: SHADOW },
        { tradeId: "h1", bin: 15000, style: 250 },
      ],
      // 1re recherche du bot : une affaire (≤ 18 000), une annonce juste au-dessus, un autre style moins cher.
      fresh: [[{ tradeId: "deal", bin: 17500, style: SHADOW }, { tradeId: "above", bin: 18250, style: SHADOW }, { tradeId: "hunter", bin: 12000, style: 250 }]],
    };
    marketScenario(mock, scenario);
    // Pendant l'achat, les deux annonces à 20 000 partent : le prix marché relu passe à 21 000.
    mock.setBid((item, price) => {
      scenario.listings = scenario.listings.filter((l) => l.bin !== 20000);
      return { success: true, response: { coins: 100000 - price } };
    });
    engine.startBot();
    await until(() => mock.calls.list.length >= 1, 10000);
    await stopAndWait();
    const kinds = mock.calls.search.map((s) => (s.criteria.maxBid ? "bot" : "relevé"));
    const firstBot = kinds.indexOf("bot");
    const refresh = mock.calls.search[0].criteria;
    check(kinds[0] === "relevé" && firstBot > 0, "prix marché relevé avant la première recherche du bot", kinds);
    check(refresh.defId[0] === 231747 && refresh.playStyle === SHADOW && !refresh.maxBuy, "relevé : version exacte, style Ombre, sans prix max", refresh);
    const bot = firstBot > 0 ? mock.calls.search[firstBot].criteria : {};
    check(bot.maxBuy === 18000 && bot.playStyle === SHADOW && bot.defId[0] === 231747, "recherche du bot : achat max 90 % de 20 000 = 18 000, même style", bot);
    check(mock.calls.bid.length === 1 && mock.calls.bid[0].tradeId === "deal" && mock.calls.bid[0].price === 17500, "achète 17 500, ignore 18 250 (au-dessus) et l'autre style à 12 000", mock.calls.bid);
    check(kinds.slice(firstBot + 1).includes("relevé"), "prix relu juste après l'achat", kinds);
    check(mock.calls.list.length === 1 && mock.calls.list[0].bin === 20750, "revente un palier sous le prix relu (21 000 → 20 750)", mock.calls.list);
    check(logs().some((l) => /Prix marché .* : 20\s000 \(2 annonce\(s\) à ce prix\) → achat max 18\s000, revente 19\s750\./.test(l)), "journal : prix marché, achat max et revente", logs().slice(-15));
  }

  console.log("\n# moteur : prix marché EA, anti-perte avec la revente prévue");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("buy.profitCheck", true);
    const mock = createMockEa();
    setPageForTests(mock.page);
    // Achat jusqu'à 99 % de 20 000 (19 750) mais revente un palier dessous (19 750 → 18 762 net) :
    // 19 500 ferait perdre 738, 17 000 rapporte.
    marketFilter({ futbinPercent: 99 });
    marketScenario(mock, {
      listings: [{ tradeId: "s1", bin: 20000, style: SHADOW }],
      fresh: [[{ tradeId: "risky", bin: 19500, style: SHADOW }], [{ tradeId: "good", bin: 17000, style: SHADOW }]],
    });
    engine.startBot();
    await until(() => mock.calls.bid.length >= 1, 8000);
    await stopAndWait();
    check(mock.calls.bid.length === 1 && mock.calls.bid[0].tradeId === "good", "19 500 évité, 17 000 acheté", mock.calls.bid);
    check(logs().some((l) => /Achat évité : .*19\s500, revente prévue 19\s750 → −738/.test(l)), "journal : revente prévue un palier sous le prix marché", logs().slice(-12));
  }

  console.log("\n# moteur : bénéfice minimum à l'achat séparé du seuil de revente");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("buy.profitCheck", true);
    settings.setSetting("buy.minProfit", 1000);
    settings.setSetting("sell.minProfit", 100);
    const mock = createMockEa();
    setPageForTests(mock.page);
    // Revente prévue 19 750 (18 762 net) : 18 000 ne laisse que +762, 17 500 laisse +1 262.
    marketFilter({ futbinPercent: 99 });
    marketScenario(mock, {
      listings: [{ tradeId: "s1", bin: 20000, style: SHADOW }],
      fresh: [[{ tradeId: "thin", bin: 18000, style: SHADOW }], [{ tradeId: "good", bin: 17500, style: SHADOW }]],
    });
    engine.startBot();
    await until(() => mock.calls.list.length >= 1, 8000);
    await stopAndWait();
    check(mock.calls.bid.length === 1 && mock.calls.bid[0].tradeId === "good", "18 000 évité (+762 < 1 000), 17 500 acheté", mock.calls.bid);
    check(logs().some((l) => /Achat évité : .*18\s000, revente prévue 19\s750 → \+762 .*minimum 1\s000/.test(l)), "journal : minimum de l'onglet Achat", logs().slice(-12));
    check(mock.calls.list.length === 1 && mock.calls.list[0].bin === 19750, "mise en vente au prix du marché (plancher de la vente : 100)", mock.calls.list);
    settings.setSetting("buy.minProfit", 0);
    settings.setSetting("sell.minProfit", 0);
  }

  console.log("\n# moteur : prix marché EA, annonce bradée écartée du prix de référence (et achetée)");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    marketFilter({});
    // Une annonce isolée à 15 000 sous trois à 20 000–21 000 : c'est une affaire, pas le prix du marché.
    const scenario = {
      listings: [
        { tradeId: "cheap", bin: 15000, style: SHADOW },
        { tradeId: "s1", bin: 20000, style: SHADOW },
        { tradeId: "s2", bin: 20000, style: SHADOW },
        { tradeId: "s3", bin: 21000, style: SHADOW },
      ],
      fresh: [[{ tradeId: "cheap", bin: 15000, style: SHADOW }]],
    };
    marketScenario(mock, scenario);
    mock.setBid((item, price) => {
      scenario.listings = scenario.listings.filter((l) => l.tradeId !== "cheap");
      return { success: true, response: { coins: 100000 - price } };
    });
    engine.startBot();
    await until(() => mock.calls.list.length >= 1, 10000);
    await stopAndWait();
    const bot = mock.calls.search.find((s) => s.criteria.maxBid);
    check(bot && bot.criteria.maxBuy === 18000, "achat max calculé sur 20 000 (pas sur l'annonce bradée)", bot && bot.criteria);
    check(mock.calls.bid.length === 1 && mock.calls.bid[0].tradeId === "cheap" && mock.calls.bid[0].price === 15000, "l'annonce bradée à 15 000 est achetée", mock.calls.bid);
    check(mock.calls.list.length === 1 && mock.calls.list[0].bin === 19750, "revente un palier sous le prix de référence (20 000 → 19 750)", mock.calls.list);
    check(logs().some((l) => /bradée\(s\) à 15\s000 ignorée\(s\), prix de référence 20\s000/.test(l)), "journal : annonce bradée signalée", logs().slice(-15));
  }

  console.log("\n# moteur : prix marché EA, 3 affaires d'un coup = prix faux ou dépassé, aucun achat");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    marketFilter({});
    const scenario = {
      listings: [
        { tradeId: "s1", bin: 20000, style: SHADOW },
        { tradeId: "s2", bin: 20000, style: SHADOW },
        { tradeId: "s3", bin: 20500, style: SHADOW },
      ],
      fresh: [
        [
          { tradeId: "d1", bin: 17000, style: SHADOW },
          { tradeId: "d2", bin: 17000, style: SHADOW },
          { tradeId: "d3", bin: 17500, style: SHADOW },
        ],
      ],
    };
    marketScenario(mock, scenario);
    const reads = () => mock.calls.search.filter((s) => !s.criteria.maxBid).length;
    engine.startBot();
    await until(() => reads() >= 2, 8000);
    await stopAndWait();
    check(mock.calls.bid.length === 0, "aucun achat", mock.calls.bid);
    check(logs().some((l) => /3 affaires sous 18\s000 d'un coup/.test(l)), "journal : prix marché faux ou dépassé", logs().slice(-10));
    check(reads() >= 2, "prix marché relu avant la recherche suivante", reads());
  }

  console.log("\n# prix FUTBIN : API de l'appli (une requête, versions sœurs, promo, holo)");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("prices.source", "api");
    futbin.api = [
      apiRow({ futbinId: 8, eaId: 231747, name: "Kylian Mbappé", common: "Mbappé", rating: 91, ps: 3179000, pc: 4136000, closing: 3370000, min: 700, max: 6900000, trend: -5.67 }),
      apiRow({ futbinId: 22994, eaId: 50563395, baseId: 231747, name: "Kylian Mbappé", common: "Mbappé", rating: 91, rareType: 22, slug: "destined_for_glory", ps: 7800000, min: 4000000, max: 15000000 }),
      apiRow({ futbinId: 22995, eaId: 67340611, baseId: 231747, name: "Kylian Mbappé", common: "Mbappé", rating: 91, rareType: 22, slug: "destined_for_glory", holo: true, ps: 11250000, min: 4000000, max: 15000000 }),
      apiRow({ futbinId: 9579, eaId: 278172, name: "Ethan Mbappé", common: "Mbappé", rating: 74, slug: "silver", ps: 950 }),
    ];
    const record = await service.requestPrice(231747, { name: "Mbappé", rating: 91 });
    const apiCalls = () => futbin.requests.filter((r) => /futbin\.org/.test(r.url)).length;
    check(record && record.price === 3179000 && record.meta && record.meta.source === "api", "prix console lu par l'API", record);
    check(apiCalls() === 1 && futbin.requests.length === 1, "une seule requête (API), aucune page FUTBIN", futbin.requests.map((r) => r.url));
    check(record.meta.range.join("-") === "700-6900000" && record.meta.closing === 3370000 && record.meta.trend === -5.67, "plage de prix EA, prix précédent et tendance gardés", record.meta);
    check(/\/27\/player\/8\/kylian-mbappe$/.test(record.url), "lien FUTBIN reconstruit pour l'affichage", record.url);
    const holo = service.getPriceRecord(67340611);
    check(holo && holo.price === 11250000 && holo.meta.holo === true && holo.meta.promo === "destined_for_glory", "version holo du même joueur : prix, holo et promo sans requête de plus", holo);
    check(!service.getPriceRecord(278172), "homonyme (autre joueur, non suivi) ignoré", service.getPriceRecord(278172));
    check(futbinApi.promoName(22) === "destined_for_glory" && futbinApi.promoName(0) === "", "promo apprise de l'image FUTBIN (22 → destined_for_glory), type 0 = carte de base", [futbinApi.promoName(22), futbinApi.promoName(0)]);
    check(record.meta.promo === "gold" && record.meta.rareType === 0, "carte de base : niveau or gardé", record.meta);
    const special = await service.requestPrice(50563395, { name: "Mbappé" });
    check(special && special.price === 7800000 && apiCalls() === 1, "autre version relue depuis la réponse en cache (60 s) : aucune requête", { price: special && special.price, calls: apiCalls() });
  }

  console.log("\n# prix FUTBIN : carte absente de l'API → pages FUTBIN en secours");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("prices.source", "api");
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", rating: 91, ps: 227000 });
    const record = await service.requestPrice(231747, { name: "Mbappé", rating: 91 });
    const urls = futbin.requests.map((r) => r.url);
    check(record && record.price === 227000 && !record.meta, "prix lu sur la page FUTBIN", record);
    check(/futbin\.org/.test(urls[0]) && urls.slice(1).some((u) => /futbin\.com\/27\/player\//.test(u)), "API d'abord, puis recherche et page FUTBIN", urls);
  }

  console.log("\n# prix FUTBIN : API refusée (429) → API en pause, pages FUTBIN utilisées");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("prices.source", "api");
    futbin.apiStatus = 429;
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", rating: 91, ps: 227000 });
    addCard({ eaId: 158023, futbinId: 22, name: "Lionel Messi", rating: 89, ps: 21500 });
    const first = await service.requestPrice(231747, { name: "Mbappé" });
    check(first && first.price === 227000, "prix lu sur la page malgré le refus de l'API", first);
    check(futbinApi.futbinApiPausedUntil() > Date.now(), "API en pause après le 429");
    const before = futbin.requests.filter((r) => /futbin\.org/.test(r.url)).length;
    const second = await service.requestPrice(158023, { name: "Messi" });
    const after = futbin.requests.filter((r) => /futbin\.org/.test(r.url)).length;
    check(second && second.price === 21500 && after === before, "pendant la pause : aucune requête API, pages FUTBIN directement", { before, after });
    check(service.getFutbinStatus().apiPausedUntil > 0, "pause visible dans l'état FUTBIN");
  }

  console.log("\n# prix FUTBIN : recherches envoyées à l'API");
  {
    const queries = service.apiQueriesFor(245830, { name: "Hasegawa 88 FB" }, { futbinId: 24, url: "https://www.futbin.com/27/player/24/yui-hasegawa", name: "" });
    check(queries.join("|") === "yui hasegawa|hasegawa 88 fb", "nom tiré du lien FUTBIN d'abord, puis le nom donné", queries);
    check(service.apiQueriesFor(231747, { name: "Mbappé" }, { miss: true }).join("|") === "mbappe", "lien « introuvable » ignoré, accents retirés", service.apiQueriesFor(231747, { name: "Mbappé" }, { miss: true }));
  }

  console.log("\n# API FUTBIN : marque holo (animation holo, signature des têtes d'affiche)");
  {
    futbinApi.resetFutbinApiForTests();
    const parsed = futbinApi.parseApiCards(
      JSON.stringify({
        data: [
          apiRow({ futbinId: 22786, eaId: 50524996, baseId: 193348, name: "Xherdan Shaqiri", rating: 80, rareType: 3, slug: "team_of_the_week", holo: true, ps: 15000 }),
          apiRow({ futbinId: 22790, eaId: 67302212, baseId: 193348, name: "Xherdan Shaqiri", rating: 80, rareType: 3, slug: "team_of_the_week", ps: 12250 }),
          apiRow({ futbinId: 22953, eaId: 67318195, baseId: 209331, name: "Mohamed Salah", rating: 88, rareType: 3, slug: "team_of_the_week", holo: true, signature: true, ps: 294000 }),
          Object.assign(apiRow({ futbinId: 1, eaId: 99, name: "Signée sans animation", rareType: 3, slug: "team_of_the_week" }), { signature: true }),
        ],
      })
    );
    const byId = new Map(parsed.map((card) => [card.eaId, card]));
    check(byId.get(50524996).holo === true && byId.get(50524996).signature === false, "holo sans signature (TOTW ordinaire) reconnue", byId.get(50524996));
    check(byId.get(67302212).holo === false, "version normale : pas holo", byId.get(67302212));
    check(byId.get(67318195).holo === true && byId.get(67318195).signature === true, "holo signée (tête d'affiche)", byId.get(67318195));
    check(byId.get(99).holo === true, "signature seule : comptée comme holo", byId.get(99));
  }

  // Cartes concept d'EA (recherche par rareté) : holo = habillage holo (_hyperCosmeticDTOs non vide).
  const HOLO_COSMETIC = { 1: { type: 1, subtype: 0, staticAssetId: "1112" } };
  const conceptItem = (definitionId, rating, data, holo) => ({
    definitionId,
    rating,
    concept: true,
    _staticData: Object.assign({ knownAs: "---" }, data),
    _hyperCosmeticDTOs: holo ? HOLO_COSMETIC : {},
  });
  const observable = (data) => ({
    observe(scope, cb) {
      setTimeout(() => cb.call(scope, this, data), 1);
      return this;
    },
  });
  const conceptMock = (items, calls, reply = null) => {
    const mock = createMockEa();
    mock.page.services.Item.searchConceptItems = (criteria) => {
      calls.push({ rarities: Array.from(criteria.rarities || []), offset: criteria.offset, count: criteria.count, defId: Array.from(criteria.defId || []) });
      if (reply) {
        return observable(reply);
      }
      const page = items.slice(criteria.offset, criteria.offset + criteria.count);
      return observable({ success: true, status: 200, response: { items: page, endOfList: criteria.offset + criteria.count >= items.length } });
    };
    setPageForTests(mock.page);
    return mock;
  };

  console.log("\n# prime holo : paires EA holo / normale, recherches API");
  {
    const items = [
      conceptItem(50577550, 82, { name: "Parrott", firstName: "Troy", lastName: "Parrott" }, false),
      conceptItem(67354766, 82, { name: "Parrott", firstName: "Troy", lastName: "Parrott" }, true),
      conceptItem(84138242, 80, { name: "Ueda", firstName: "Ayase", lastName: "Ueda" }, true),
      conceptItem(67361026, 80, { name: "Ueda", firstName: "Ayase", lastName: "Ueda" }, false),
      conceptItem(67400000, 81, { name: "Solo" }, true),
      conceptItem(50600099, 79, { name: "Seul" }, false),
    ];
    const { pairs, alone } = holoScan.pairHoloItems(items);
    const ids = pairs.map((pair) => `${pair.holo.definitionId}/${pair.normal.definitionId}`).sort();
    check(ids.join(",") === "67354766/50577550,84138242/67361026" && alone === 1, "holo associée à la normale du même joueur et de même note (id dans les deux sens), holo seule comptée", { ids, alone });
    const doherty = holoScan.holoQueriesFor(conceptItem(50600001, 80, { name: "Koné-Doherty", firstName: "Trent", lastName: "Koné-Doherty" }, true));
    check(doherty.join("|") === "kone doherty|trent kone doherty|doherty", "recherches : nom EA, prénom + nom, puis le mot le plus long", doherty);
    const yamal = holoScan.holoQueriesFor(conceptItem(50609291, 91, { name: "Lamine Yamal", firstName: "Lamine Yamal", lastName: "Nasraoui Ebana", knownAs: "Lamine Yamal" }, true));
    check(yamal[0] === "lamine yamal" && yamal.length === 3, "surnom EA en premier", yamal);
  }

  console.log("\n# prime holo : promo lue chez EA, prix des deux versions par l'API FUTBIN");
  {
    baseSettings();
    resetFutbin();
    holoScan.resetHoloScanForTests();
    const totw = { rareType: 3, slug: "team_of_the_week" };
    futbin.api = [
      apiRow({ futbinId: 22802, eaId: 67354766, baseId: 245902, name: "Troy Parrott", common: "Parrott", rating: 82, holo: true, ps: 18000, ...totw }),
      apiRow({ futbinId: 22803, eaId: 50577550, baseId: 245902, name: "Troy Parrott", common: "Parrott", rating: 82, ps: 11000, ...totw }),
      apiRow({ futbinId: 900, eaId: 245902, name: "Troy Parrott", common: "Parrott", rating: 76, ps: 900 }),
      apiRow({ futbinId: 23180, eaId: 67297409, baseId: 188545, name: "Robert Lewandowski", common: "Lewandowski", rating: 85, holo: true, ps: 41250, ...totw }),
      apiRow({ futbinId: 23181, eaId: 50520193, baseId: 188545, name: "Robert Lewandowski", common: "Lewandowski", rating: 85, ps: 13750, ...totw }),
      apiRow({ futbinId: 22990, eaId: 67332574, baseId: 223956, name: "Vedat Muriqi", common: "Muriqi", rating: 83, holo: true, ps: 13750, ...totw }),
      apiRow({ futbinId: 22991, eaId: 50555358, baseId: 223956, name: "Vedat Muriqi", common: "Muriqi", rating: 83, ps: 11750, ...totw }),
      // Nom composé : introuvable par « kone doherty », trouvé par « doherty ».
      apiRow({ futbinId: 22791, eaId: 50600001, baseId: 268769, name: "Trent Koné-Doherty", rating: 80, holo: true, ps: 14250, ...totw }),
      apiRow({ futbinId: 22792, eaId: 67377217, baseId: 268769, name: "Trent Koné-Doherty", rating: 80, ps: 11000, ...totw }),
      // Hors tranche (plus de 60 000).
      apiRow({ futbinId: 23190, eaId: 67361235, baseId: 252371, name: "Jude Bellingham", common: "Bellingham", rating: 91, holo: true, signature: true, ps: 2555000, ...totw }),
      apiRow({ futbinId: 23191, eaId: 50584019, baseId: 252371, name: "Jude Bellingham", common: "Bellingham", rating: 91, ps: 1635000, ...totw }),
      // Version normale sans prix FUTBIN.
      apiRow({ futbinId: 23200, eaId: 67390000, baseId: 281136, name: "Sans Prix", rating: 81, holo: true, ps: 20000, ...totw }),
      apiRow({ futbinId: 23201, eaId: 50612784, baseId: 281136, name: "Sans Prix", rating: 81, ps: 0, ...totw }),
    ];
    const items = [
      conceptItem(67354766, 82, { name: "Parrott", firstName: "Troy", lastName: "Parrott" }, true),
      conceptItem(50577550, 82, { name: "Parrott", firstName: "Troy", lastName: "Parrott" }, false),
      conceptItem(67297409, 85, { name: "Lewandowski", firstName: "Robert", lastName: "Lewandowski" }, true),
      conceptItem(50520193, 85, { name: "Lewandowski", firstName: "Robert", lastName: "Lewandowski" }, false),
      conceptItem(67332574, 83, { name: "Muriqi", firstName: "Vedat", lastName: "Muriqi" }, true),
      conceptItem(50555358, 83, { name: "Muriqi", firstName: "Vedat", lastName: "Muriqi" }, false),
      conceptItem(50600001, 80, { name: "Koné-Doherty", firstName: "Trent", lastName: "Koné-Doherty" }, true),
      conceptItem(67377217, 80, { name: "Koné-Doherty", firstName: "Trent", lastName: "Koné-Doherty" }, false),
      conceptItem(67361235, 91, { name: "Bellingham", firstName: "Jude", lastName: "Bellingham" }, true),
      conceptItem(50584019, 91, { name: "Bellingham", firstName: "Jude", lastName: "Bellingham" }, false),
      conceptItem(67390000, 81, { name: "Sans Prix", firstName: "Sans", lastName: "Prix" }, true),
      conceptItem(50612784, 81, { name: "Sans Prix", firstName: "Sans", lastName: "Prix" }, false),
      conceptItem(67400000, 81, { name: "Solo", firstName: "Solo", lastName: "Holo" }, true),
    ];
    const calls = [];
    conceptMock(items, calls);
    const steps = [];
    const result = await holoScan.scanHoloPremiums({ rarity: 3, min: 10000, max: 60000, minProfit: 1000, gapMs: 0, onProgress: (p) => steps.push(p.step) });
    check(result.ok && calls.length === 1 && calls[0].rarities.join() === "3" && calls[0].count === 250 && calls[0].offset === 0 && !calls[0].defId.length, "une requête EA : cartes concept de la rareté 3, 250 par page", calls);
    check(!futbin.requests.some((r) => /futbin\.com/.test(r.url)), "aucune page futbin.com", futbin.requests.map((r) => r.url));
    check(result.items === 13 && result.pairs === 6 && result.alone === 1, "13 cartes EA : 6 paires, 1 holo seule", { items: result.items, pairs: result.pairs, alone: result.alone });
    check(result.rows.map((row) => row.name).join(",") === "Lewandowski,Parrott,Koné-Doherty,Muriqi", "4 holo dans la tranche, triées par gain décroissant", result.rows.map((row) => [row.name, row.edge]));
    check(result.outOfRange === 1 && result.missed.join() === "Sans Prix", "Bellingham hors tranche, holo sans prix normal à part", { outOfRange: result.outOfRange, missed: result.missed });
    const lewa = result.rows[0];
    check(lewa.normalPrice === 13750 && lewa.holoPrice === 41250 && lewa.premium === 27500 && lewa.edge === 25437 && lewa.cap === 38000 && lewa.normalId === 50520193, "Lewandowski : écart 27 500, gain 25 437 après taxe, achat max 38 000", lewa);
    const parrott = result.rows[1];
    check(parrott.edge === 6100 && parrott.cap === 16000 && parrott.baseId === 245902 && parrott.promo === "team_of_the_week" && parrott.rating === 82, "Parrott : gain 6 100, achat max 16 000, promo FUTBIN", parrott);
    check(result.rows[3].edge === 1312 && result.rows[3].cap === 12000, "Muriqi : petit écart (gain 1 312)", result.rows[3]);
    const apiCalls = futbin.requests.filter((r) => /futbin\.org/.test(r.url)).map((r) => decodeURIComponent(r.url.split("playername=")[1]));
    check(apiCalls.includes("doherty") && apiCalls.filter((q) => q === "lewandowski").length === 1, "une recherche API par joueur, repli sur « doherty »", apiCalls);
    check(steps[0] === "ea" && steps.filter((step) => step === "card").length === 6, "progression : EA puis une étape par paire", steps);
    check(holoScan.lastHoloScan() && holoScan.lastHoloScan().rows.length === 4 && holoScan.lastHoloScan().rarity === 3, "dernier scan gardé pour l'affichage");
    const filter = filters.normalizeFilter(holoScan.holoFilterFor(lewa, "Holo Lewandowski 85"));
    check(
      filter.definitionId === 67297409 && filter.priceMode === "market" && filter.futbinPercent === 90 && filter.maxBuy === 38000 && filter.enabled === false && filter.player.id === 188545 && filter.playStyle === -1,
      "filtre créé : holo exacte, prix marché EA à 90 %, plafond = achat max, désactivé",
      filter
    );
    const rarities = holoScan.holoRarities();
    check(rarities[0].id === 3 && rarities[1].id === 22, "promos : TOTW et Destin glorieux d'abord", rarities.slice(0, 3));
  }

  console.log("\n# prime holo : erreur EA, API en pause, scan arrêté");
  {
    baseSettings();
    resetFutbin();
    holoScan.resetHoloScanForTests();
    const calls = [];
    conceptMock([], calls, { success: false, status: 500, error: { code: 500 } });
    const failed = await holoScan.scanHoloPremiums({ rarity: 3, gapMs: 0 });
    check(!failed.ok && failed.eaError && !holoScan.lastHoloScan() && futbin.requests.length === 0, "EA refuse la promo : scan en échec, aucune requête FUTBIN", failed);
    const items = [
      conceptItem(67354766, 82, { name: "Parrott" }, true),
      conceptItem(50577550, 82, { name: "Parrott" }, false),
      conceptItem(67332574, 83, { name: "Muriqi" }, true),
      conceptItem(50555358, 83, { name: "Muriqi" }, false),
    ];
    conceptMock(items, calls);
    futbin.apiStatus = 429;
    const paused = await holoScan.scanHoloPremiums({ rarity: 3, gapMs: 0 });
    const apiCalls = futbin.requests.filter((r) => /futbin\.org/.test(r.url)).length;
    check(paused.ok && paused.apiBlocked && paused.rows.length === 0 && apiCalls === 1, "API refusée (429) : scan arrêté dès le premier refus", { apiBlocked: paused.apiBlocked, apiCalls });
    resetFutbin();
    const scan = holoScan.scanHoloPremiums({
      rarity: 3,
      gapMs: 0,
      onProgress: (p) => {
        if (p.step === "card") {
          holoScan.stopHoloScan();
        }
      },
    });
    check(holoScan.holoScanRunning(), "scan en cours visible");
    const busy = await holoScan.scanHoloPremiums({ gapMs: 0 });
    check(!busy.ok && busy.busy, "second scan refusé pendant le premier", busy);
    const stopped = await scan;
    check(stopped.ok && stopped.cancelled && !holoScan.holoScanRunning(), "Arrêter : scan interrompu proprement", { cancelled: stopped.cancelled });
  }

  console.log("\n# moteur : prix marché EA gardé 10 min puis relu");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    marketFilter({});
    // Trois annonces : le relevé voit assez de prix, une seule recherche par relevé (pas d'élargissement).
    const scenario = {
      listings: [
        { tradeId: "s1", bin: 20000, style: SHADOW },
        { tradeId: "s1b", bin: 20000, style: SHADOW },
        { tradeId: "s1c", bin: 20500, style: SHADOW },
      ],
      fresh: [],
    };
    marketScenario(mock, scenario);
    // Compteur de requêtes EA branché sur ce faux web app (comme au chargement du script).
    usage.resetUsageForTests();
    usage.hookUsage();
    const refreshes = () => mock.calls.search.filter((s) => !s.criteria.maxBid).length;
    const bots = () => mock.calls.search.filter((s) => s.criteria.maxBid);
    engine.startBot();
    await until(() => bots().length >= 3);
    check(refreshes() === 1 && bots().every((s) => s.criteria.maxBuy === 18000), "un seul relevé, prix gardé entre les recherches", { refreshes: refreshes(), bots: bots().length });
    clockOffset += 9 * 60 * 1000;
    let at = bots().length;
    await until(() => bots().length >= at + 2);
    check(refreshes() === 1, "9 min plus tard : même relevé (intervalle de 10 min)", refreshes());
    scenario.listings = [
      { tradeId: "s2", bin: 22000, style: SHADOW },
      { tradeId: "s2b", bin: 22000, style: SHADOW },
      { tradeId: "s2c", bin: 22500, style: SHADOW },
    ];
    clockOffset += 2 * 60 * 1000;
    at = bots().length;
    await until(() => bots().length >= at + 2);
    await stopAndWait();
    const last = bots()[bots().length - 1].criteria;
    check(refreshes() >= 2 && last.maxBuy === 19750, "11 min : prix relu (22 000), achat max 19 750 sans redémarrer", { refreshes: refreshes(), last });
    check(logs().some((l) => /Prix marché .* : 22\s000/.test(l)), "journal : nouveau prix marché", logs().slice(-10));
    const counted = usage.usageStats().day;
    check(counted.bot === mock.calls.search.length && counted.manual === 0, "relevés comptés avec les recherches du bot (compteur de requêtes)", { counted, searches: mock.calls.search.length });
    usage.resetUsageForTests();
    const active = filters.getActiveFilter();
    settings.setSetting("buy.marketRefreshMinutes", 1);
    const low = engine.marketInfoFor(active).minutes;
    settings.setSetting("buy.marketRefreshMinutes", 999);
    const high = engine.marketInfoFor(active).minutes;
    settings.setSetting("buy.marketRefreshMinutes", 0);
    const unset = engine.marketInfoFor(active).minutes;
    check(low === 3 && high === 60 && unset === 10, "intervalle borné à 3–60 min, 10 par défaut", { low, high, unset });
  }

  console.log("\n# moteur : prix marché EA sans annonce (filtre en pause, pas d'arrêt)");
  {
    baseSettings();
    resetFutbin();
    state.clearLogs();
    const mock = createMockEa();
    setPageForTests(mock.page);
    marketFilter({});
    const scenario = { listings: [], fresh: [] };
    marketScenario(mock, scenario);
    const bots = () => mock.calls.search.filter((s) => s.criteria.maxBid);
    const noListing = () => logs().filter((l) => /aucune annonce trouvée/.test(l)).length;
    engine.startBot();
    await until(() => noListing() >= 1);
    await sleep(1500);
    check(engine.isRunning() && state.getState().status !== "stopped", "bot toujours en marche", state.getState().status);
    check(mock.calls.search.length === 1 && bots().length === 0, "aucune recherche du bot sans prix marché", mock.calls.search.length);
    check(noListing() === 1 && logs().filter((l) => /prochain relevé du prix marché/.test(l)).length === 1, "un seul avertissement, attente expliquée une fois", logs().slice(-6));
    scenario.listings = [{ tradeId: "s1", bin: 20000, style: SHADOW }];
    clockOffset += 11 * 60 * 1000;
    await until(() => bots().length >= 1, 9000);
    await stopAndWait();
    check(bots().length >= 1 && bots()[0].criteria.maxBuy === 18000, "relevé suivant (10 min plus tard) : recherches reprises, achat max 18 000", bots()[0] && bots()[0].criteria);
    check(noListing() === 1, "pas de nouvel avertissement", noListing());
  }

  console.log("\n# moteur : captcha pendant les ventes d'après-arrêt");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    settings.setSetting("buy.maxPerSearch", 3);
    setFilter({ maxBuy: 45000, sellPrice: 52000, sellMode: "fixed" });
    mock.setMarket((n, c, p, makeItem) => (n === 1 ? { success: true, data: { items: [1, 2, 3].map((i) => makeItem({ tradeId: `c${i}`, bin: 40000 + i * 100 })) } } : { success: true, data: { items: [] } }));
    mock.setBid((item, price, count) => {
      if (count === 3) engine.stopBot("arrêt pendant les achats", { manual: true });
      return { success: true, response: { coins: 100000 - price } };
    });
    mock.setList(() => ({ success: false, status: 458, error: { code: 458 } }));
    engine.startBot();
    await until(() => !engine.isRunning(), 8000);
    await sleep(50);
    check(mock.calls.bid.length === 3 && mock.calls.list.length === 1, "captcha : plus aucune requête après la 1re mise en vente refusée", [mock.calls.bid.length, mock.calls.list.length]);
    check(logs().some((l) => /interrompues : captcha/.test(l)) && logs().some((l) => /2 carte\(s\) achetée\(s\) non mise\(s\) en vente/.test(l)), "arrêt expliqué, cartes restantes signalées", logs().slice(-5));
    check(state.getState().status === "stopped", "bot bien arrêté", state.getState().status);
  }

  console.log("\n# migration des réglages v5.0");
  {
    baseSettings();
    settings.setSetting("buy.useReference", true);
    settings.setSetting("buy.referencePercent", 80);
    settings.setSetting("sell.useReference", true);
    settings.setSetting("sell.referencePercent", "105-110");
    settings.setSetting("meta.migrations", []);
    runMigrations();
    const f = filters.getActiveFilter();
    check(f.priceMode === "futbin" && f.futbinPercent === 80, "achat au % de référence → mode FUTBIN du filtre", f);
    check(settings.getSettings().sell.priceMode === "futbin" && settings.getSettings().sell.futbinPercent === "105-110", "revente au % de référence → revente FUTBIN", settings.getSettings().sell);
    const once = JSON.stringify(settings.getSettings().meta.migrations);
    runMigrations();
    check(JSON.stringify(settings.getSettings().meta.migrations) === once && once.includes("futbin-modes"), "migration faite une seule fois");
    check(filters.normalizeFilter({ sellPrice: 52000 }).sellMode === "fixed", "ancien filtre avec prix de revente → mode « fixe »");
  }

  console.log("\n# DCE : placement");
  {
    const slots = [
      { index: 0, generalPosition: 0, typeName: "GK" },
      { index: 1, generalPosition: 5, typeName: "CB" },
      { index: 2, generalPosition: 5, typeName: "CB" },
      { index: 3, generalPosition: 25, typeName: "ST", brick: true },
      { index: 4, generalPosition: 14, typeName: "CM" },
    ];
    const entries = [
      { player: { position: "CM" }, item: { possiblePositions: [14, 10] } },
      { player: { position: "" }, item: { possiblePositions: [5] } },
      { player: { position: "GK" }, item: null },
      { player: { position: "CB" }, item: { possiblePositions: [5, 3] } },
    ];
    const plan = sbc.planPlacement(slots, entries);
    check(plan[0] === 4 && plan[2] === 0 && [plan[1], plan[3]].sort().join() === "1,2", "chaque joueur sur un poste jouable, poste bloqué évité", plan);
    const crowded = sbc.planPlacement(slots, [
      { player: {}, item: { possiblePositions: [5] } },
      { player: {}, item: { possiblePositions: [5] } },
      { player: {}, item: { possiblePositions: [5] } },
    ]);
    check(crowded.filter((s) => s === 1 || s === 2).length === 2 && crowded.every((s) => s !== 3), "trop de joueurs pour un poste : les autres complètent", crowded);
    check(sbc.normalizePosition("MOC") === "CAM" && sbc.normalizePosition("LCB") === "CB", "postes FR / FUTBIN normalisés");
  }

  console.log("\n# DCE : import d'une solution FUTBIN puis achat des manquants");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("sbc.margin", 10);
    const mock = createMockEa({ coins: 500000 });
    setPageForTests(mock.page);
    const TYPE = { GK: 0, RB: 3, CB: 5, LB: 7, CDM: 10, RM: 12, CM: 14, LM: 16, CAM: 18, RW: 23, ST: 25, LW: 27 };
    const formation = (name, displayName, names) => ({ id: name, name, displayName, positions: names.map((n) => ({ typeId: TYPE[n], typeName: n })), getPosition(i) { return this.positions[i] || null; } });
    const f442 = formation("f442", "4-4-2", ["GK", "RB", "CB", "CB", "LB", "RM", "CM", "CM", "LM", "ST", "ST"]);
    const f4334 = formation("f4334", "4-3-3 (4)", ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "CAM", "RW", "ST", "LW"]);
    const calls = { save: 0, setFormation: 0, club: [], storage: 0 };
    let current = f442;
    const slots = Array.from({ length: 23 }, (_, index) => ({
      index,
      _item: null,
      get item() { return this._item || { definitionId: 0 }; },
      isValid() { return !!this._item; },
      isBrick() { return false; },
      get generalPosition() { return index < 11 ? current.positions[index].typeId : -1; },
    }));
    const squad = {
      getSlot: (i) => slots[i],
      getFormation: () => current,
      setFormation: (f) => { current = f; calls.setFormation++; },
      removeItemFromSlot: (i) => { slots[i]._item = null; },
      setPlayers(arr, replace) {
        arr.length = 23;
        if (replace) arr.forEach((it, i) => { if (it) slots[i]._item = null; });
        arr.forEach((it, i) => { if (it && !slots.some((s) => s._item && s._item.databaseId === it.databaseId)) slots[i]._item = it; });
      },
    };
    const challenge = { id: 77, name: "Défi test", squad };
    const ctrl = { _challenge: challenge, _squad: squad, getView: () => ({ updateChallenge() {}, getRootElement() { return null; } }) };
    const positions = ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "CAM", "RW", "ST", "LW"];
    const ownedItem = (i) => ({ id: 9000 + i, definitionId: 1001 + i, databaseId: 1001 + i, tradable: false, possiblePositions: [TYPE[positions[i]]], isLimitedUse: () => false, isPlayer: () => true });
    const club = positions.slice(0, 8).map((_, i) => ownedItem(i));
    mock.page.repositories.Squad = { getFormations: () => [f442, f4334] };
    mock.page.services.Club = { search(criteria) { calls.club.push(criteria.defId.slice()); const obs = { observe(scope, cb) { setTimeout(() => cb.call(scope, obs, { success: true, response: { items: club.filter((it) => criteria.defId.includes(it.definitionId)) } }), 5); }, unobserve() {} }; return obs; } };
    mock.page.services.Item.searchStorageItems = () => { calls.storage++; const obs = { observe(scope, cb) { setTimeout(() => cb.call(scope, obs, { success: true, response: { items: [] } }), 5); }, unobserve() {} }; return obs; };
    mock.page.services.SBC = { saveChallenge() { calls.save++; const obs = { observe(scope, cb) { setTimeout(() => cb.call(scope, obs, { success: true }), 5); }, unobserve() {} }; return obs; } };
    const cards = positions.map((pos, i) => `<div class="card-slot"><a href="/27/player/${500 + i}/joueur-${i}"><div class="card"><img src="https://cdn3.futbin.com/content/fifa27/img/players/${1001 + i}.png"><div class="rating">${80 + i}</div><div class="position">${pos}</div><div class="name">Joueur ${i}</div><div class="price">${20 + i},000</div></div></a></div>`).join("");
    const url = "https://www.futbin.com/27/squad/123456/solution";
    futbin.pages.set(url, `<html><body><select class="formation"><option value="4-3-3(4)" selected>4-3-3(4)</option></select><div class="pitch">${cards}</div></body></html>`);
    // Prix FUTBIN en direct pour l'ailier droit (différent du prix affiché sur la page d'équipe).
    addCard({ eaId: 1009, futbinId: 508, name: "Joueur 8", ps: 30000 });
    const loaded = await sbc.loadSolution(ctrl, url);
    check(loaded.ok, "solution FUTBIN chargée", loaded.message);
    const session = loaded.session;
    const summary = sbc.sessionSummary(session);
    check(summary.placed === 8 && summary.missing === 3, "8 joueurs trouvés dans le club, 3 à acheter", summary);
    check(session.formation === f4334, "formation EA retrouvée (4-3-3 (4))");
    const applied = await sbc.applySession(session);
    check(applied.ok && calls.setFormation === 1 && calls.save === 1, "formation changée, équipe enregistrée", [applied, calls]);
    const okPlaces = slots.slice(0, 8).every((s, i) => s._item && s._item.definitionId === 1001 + i);
    check(okPlaces && slots.slice(8, 11).every((s) => !s._item), "joueurs du club à leur poste, postes des manquants vides", slots.slice(0, 11).map((s) => s._item && s._item.definitionId));
    await until(() => service.currentPrice(1009) === 30000, 6000);
    const rw = session.entries[8];
    check(sbc.maxPriceFor(rw) === 33000, "prix max = FUTBIN en direct + 10 % (30 000 → 33 000)", sbc.maxPriceFor(rw));
    const st = session.entries[9];
    check(sbc.maxPriceFor(st) === 0 && sbc.entryPrice(st) === 29000, "sans prix FUTBIN en direct : prix de la page affiché mais prix max à saisir", [sbc.maxPriceFor(st), sbc.entryPrice(st)]);
    st.manual = true;
    st.maxPrice = 31750;
    session.entries[10].manual = true;
    session.entries[10].maxPrice = 25000;
    mock.setMarket((n, criteria, p, makeItem) => {
      const id = criteria.defId[0];
      const pos = { 1009: "RW", 1010: "ST", 1011: "LW" }[id];
      return { success: true, data: { items: [makeItem({ tradeId: `m${n}`, definitionId: id, bin: 20000 + (id - 1000) * 100, extra: { databaseId: id, possiblePositions: [TYPE[pos]] } })] } };
    });
    const report = await sbc.buyMissing(session, { token: createCancelToken() });
    check(report.bought === 3 && mock.calls.bid.length === 3, "3 manquants achetés", report);
    check(mock.calls.search.every((s) => s.criteria.defId.length === 1 && s.criteria.maxBuy > 0), "recherche exacte (version précise) avec prix max", mock.calls.search.map((s) => s.criteria));
    check(mock.calls.search[2].criteria.maxBuy === 25000, "prix max modifié à la main respecté (25 000)", mock.calls.search[2].criteria);
    check(mock.calls.move.length === 3 && mock.calls.move.every((m) => m.pile === 7), "achats envoyés au club", mock.calls.move);
    check(slots.slice(0, 11).every((s) => s._item), "équipe complète (11/11) après les achats", slots.slice(0, 11).map((s) => s._item && s._item.definitionId));
    check(slots[9]._item.definitionId === 1010, "l'attaquant acheté placé au poste d'attaquant", slots[9]._item.definitionId);
    sbc.releaseSession(session);
  }

  console.log("\n# DCE : import de la vraie solution « Madrid Dreams » (poste bloqué)");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa({ coins: 120756 });
    setPageForTests(mock.page);
    const TYPE = { GK: 0, RB: 3, CB: 5, LB: 7, CDM: 10, RM: 12, CM: 14, LM: 16, CAM: 18, RW: 23, ST: 25, LW: 27 };
    mock.page.PlayerPosition = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k]));
    // Formation EA 4-3-3 (4), ordre EA (gardien d'abord), poste AD bloqué comme dans le défi.
    const names = ["GK", "RB", "CB", "CB", "LB", "CM", "CAM", "CM", "RW", "ST", "LW"];
    const f4334 = { id: "f4334", name: "f4334", displayName: "4-3-3 (4)", positions: names.map((n) => ({ typeId: TYPE[n] })), getPosition(i) { return this.positions[i] || null; } };
    const f442 = { id: "f442", name: "f442", displayName: "4-4-2", positions: ["GK", "RB", "CB", "CB", "LB", "RM", "CM", "CM", "LM", "ST", "ST"].map((n) => ({ typeId: TYPE[n] })), getPosition(i) { return this.positions[i] || null; } };
    let current = f442;
    const BRICK = 8;
    const slots = Array.from({ length: 23 }, (_, index) => ({
      index, _item: null,
      get item() { return this._item || { definitionId: 0 }; },
      isValid() { return !!this._item; },
      isBrick() { return index === BRICK; },
      get generalPosition() { return index < 11 ? current.positions[index].typeId : -1; },
    }));
    let saves = 0;
    const squad = {
      getSlot: (i) => slots[i], getFormation: () => current, setFormation: (f) => { current = f; },
      removeItemFromSlot: (i) => { slots[i]._item = null; },
      setPlayers(arr, replace) {
        arr.length = 23;
        if (replace) arr.forEach((it, i) => { if (it && !slots[i].isBrick()) slots[i]._item = null; });
        arr.forEach((it, i) => { if (it && !slots[i].isBrick() && !slots.some((sl) => sl._item && sl._item.databaseId === it.databaseId)) slots[i]._item = it; });
      },
    };
    mock.page.repositories.Squad = { getFormations: () => [f442, f4334] };
    const obs = (data) => ({ observe(scope, cb) { setTimeout(() => cb.call(scope, this, data), 5); }, unobserve() {} });
    // Club : 7 des 10 joueurs (dont une autre version de Soulé, de note plus basse, à ignorer).
    const owned = [
      [239482, 81, ["LM", "LW"]], [243586, 80, ["ST"]], [255971, 79, ["CDM", "CM"]], [202024, 81, ["CDM", "CM"]],
      [226376, 80, ["CAM", "CDM", "CM", "ST"]], [238160, 80, ["CB"]], [200159, 78, ["GK"]], [265695, 70, ["CAM"]],
    ].map(([id, rating, pos], i) => ({ id: 7000 + i, definitionId: id, databaseId: id, rating, tradable: true, possiblePositions: pos.map((p) => TYPE[p]), isLimitedUse: () => false, isPlayer: () => true }));
    mock.page.services.Club = { search: (criteria) => obs({ success: true, response: { items: owned.filter((it) => criteria.defId.includes(it.definitionId)) } }) };
    mock.page.services.Item.searchStorageItems = () => obs({ success: true, response: { items: [] } });
    mock.page.services.SBC = { saveChallenge: () => { saves++; return obs({ success: true }); } };
    futbin.pages.set(REAL_URL, realHtml);
    const ctrl = { _challenge: { id: 5, name: "Rêves de Madrid", squad }, _squad: squad, getView: () => ({ updateChallenge() {}, getRootElement() { return null; } }) };
    const t0 = Date.now();
    const loaded = await sbc.loadSolution(ctrl, REAL_URL);
    check(loaded.ok && loaded.session.entries.length === 10 && loaded.session.challengeName === "Madrid Dreams", "solution chargée : 10 joueurs, défi « Madrid Dreams »", loaded.message || [loaded.session && loaded.session.entries.length]);
    const session = loaded.session;
    const summary = sbc.sessionSummary(session);
    check(summary.placed === 7 && summary.missing === 3, "7 dans le club (Soulé 70 ≠ Soulé 80 de la solution), 3 à acheter", summary);
    check(sbc.maxPriceFor(session.entries.find((e) => e.player.name === "Koné")) === 700, "prix FUTBIN console de la page repris tout de suite (Koné 650 + marge → 700, un palier au-dessus)", sbc.maxPriceFor(session.entries.find((e) => e.player.name === "Koné")));
    const applied = await sbc.applySession(session);
    check(applied.ok && current === f4334 && saves === 1, "formation 4-3-3 (4) appliquée et équipe enregistrée", [applied, current.displayName, saves]);
    const typeAt = (index) => names[index];
    const placedAs = session.entries.filter((e) => e.item).map((e) => [e.player.name, typeAt(e.slot), e.player.slotPosition]);
    check(placedAs.every(([, ea, fb]) => ea === fb), "chaque joueur du club au poste exact de la solution FUTBIN (Kaku en DG…)", placedAs);
    check(!slots[BRICK]._item && session.entries.every((e) => e.slot !== BRICK), "poste bloqué du défi jamais utilisé");
    check(Date.now() - t0 < 4000, "import rapide (prix déjà dans la page, sans recherche FUTBIN)", Date.now() - t0);
    sbc.releaseSession(session);
  }

  console.log("\n# DCE : prix max figé au lancement");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("sbc.margin", 10);
    settings.setSetting("sbc.triesPerPlayer", 2);
    settings.setSetting("sbc.wait", "1.8-2");
    const mock = createMockEa({ coins: 500000 });
    setPageForTests(mock.page);
    addCard({ eaId: 4242, futbinId: 42, name: "Fodder", ps: 30000 });
    await service.requestPrice(4242, { name: "Fodder" });
    const entry = { player: { eaId: 4242, name: "Fodder", rating: 84, price: 0 }, item: null, state: "missing", manual: false, maxPrice: 0, note: "" };
    const squad = { getSlot: () => ({ isValid: () => false, isBrick: () => false, generalPosition: 0 }), getFormation: () => null, setPlayers() {}, removeItemFromSlot() {} };
    const session = { ctx: { ctrl: { getView: () => ({}) }, challenge: {}, squad }, entries: [entry] };
    mock.page.services.SBC = { saveChallenge() { return { observe(scope, cb) { setTimeout(() => cb.call(scope, this, { success: true }), 5); }, unobserve() {} }; } };
    mock.setMarket((n) => {
      if (n === 1) { futbin.cards.get(4242).ps = 39000; service.requestPrice(4242, {}); }
      return { success: true, data: { items: [] } };
    });
    await sbc.buyMissing(session, { token: createCancelToken() });
    const maxes = mock.calls.search.map((s) => s.criteria.maxBuy);
    check(service.currentPrice(4242) === 39000 && maxes.length === 2 && maxes.every((m) => m === 33000), "le prix FUTBIN monte à 39 000 : prix max gardé à 33 000 (budget validé)", [service.currentPrice(4242), maxes]);
  }

  console.log("\n# DCE : arrêt immédiat sur captcha");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa();
    setPageForTests(mock.page);
    const entry = { player: { eaId: 5555, name: "Test", rating: 80, price: 10000 }, item: null, state: "missing", manual: true, maxPrice: 12000, note: "" };
    const squad = { getSlot: () => ({ isValid: () => false, isBrick: () => false, generalPosition: 0 }), getFormation: () => null, setPlayers() {}, removeItemFromSlot() {} };
    const session = { ctx: { ctrl: { getView: () => ({}) }, challenge: {}, squad }, entries: [entry, Object.assign({}, entry, { player: { eaId: 5556, name: "Test 2" } })] };
    mock.page.services.SBC = { saveChallenge() { return { observe(scope, cb) { setTimeout(() => cb.call(scope, this, { success: true }), 5); }, unobserve() {} }; } };
    mock.setMarket(() => ({ success: false, status: 458, error: { code: 458 } }));
    const report = await sbc.buyMissing(session, { token: createCancelToken() });
    check(/captcha/.test(report.stopped) && mock.calls.search.length === 1, "captcha : arrêt sans autre requête", [report, mock.calls.search.length]);
  }

  console.log("\n# listes FUTBIN : lecture et liens");
  {
    const cards = [
      { eaId: 5001, futbinId: 901, name: "Mitoma", rating: 84, ps: 12500, pc: 11000 },
      { eaId: 50336683, futbinId: 902, name: "Kubo", rating: 88, ps: 45000, special: true },
    ];
    const parsed = parse.parsePlayerListText(listPage(cards, 4));
    check(parsed.source === "html" && parsed.cards.length === 2 && parsed.lastPage === 4, "liste lue dans les lignes tr.player-row (2 cartes, 4 pages)", [parsed.source, parsed.cards.length, parsed.lastPage]);
    const kubo = parsed.cards[1];
    check(kubo.eaId === 50336683 && kubo.futbinId === 902 && kubo.prices.console === 45000 && kubo.rating === 88, "carte spéciale : id EA, id FUTBIN, prix, note", kubo);
    const html = `<html><body><table><tr><td><a href="/27/player/903/doan"><img src="https://cdn3.futbin.com/content/fifa27/img/players/247519.png"> Doan</a></td><td class="rating">80</td><td class="platform-ps-only">1,200</td><td class="platform-pc-only">1,100</td></tr></table>
      <a href="/27/players?nation=163&page=2">2</a></body></html>`;
    const fromHtml = parse.parsePlayerListText(html);
    check(fromHtml.source === "html" && fromHtml.cards[0].eaId === 247519 && fromHtml.cards[0].prices.console === 1200 && fromHtml.cards[0].prices.pc === 1100 && fromHtml.lastPage === 2, "secours : autre tableau HTML (sans tr.player-row)", fromHtml);
    const json = `<html><body><script type="application/json" data-react-data="">${JSON.stringify({ rows: [{ id: { playerCardId: { value: 905 } }, playerName: "Ito", playerRating: 79, playerImage: { fixed: { url: { image1x: "https://cdn3.futbin.com/content/fifa27/img/players/241721.png" } } }, price: { ps: { price: 900 }, pc: { price: 850 } } }] })}</script></body></html>`;
    const fromJson = parse.parsePlayerListText(json);
    check(fromJson.source === "json" && fromJson.cards[0].eaId === 241721 && fromJson.cards[0].prices.console === 900, "secours : JSON React éventuel", fromJson);
    const rows = parse.parseSearchJson(JSON.stringify([searchRow({ futbinId: 11, eaId: 50563395, name: "Kylian Mbappé", rating: 94, special: true, version: "TOTW", club: "Real Madrid" })]));
    check(rows[0].version === "TOTW" && rows[0].club === "Real Madrid", "recherche : version et club affichés s'ils existent", rows[0]);
    const base = filters.normalizeFilter({ nation: 163, position: "LM", priceMode: "futbin" });
    check(cardSets.futbinListUrl(base) === "https://www.futbin.com/27/players?nation=163&position=LM&pos_type=main", "lien construit d'après les critères (nation + poste)", cardSets.futbinListUrl(base));
    check(cardSets.futbinListUrl(filters.normalizeFilter({ league: 13, zone: 132, priceMode: "futbin" })) === "https://www.futbin.com/27/players?league=13&position=ST%2CCF%2CLW%2CRW", "zone attaque → postes FUTBIN", cardSets.futbinListUrl(filters.normalizeFilter({ league: 13, zone: 132 })));
    check(cardSets.futbinListUrl(filters.normalizeFilter({ level: "gold" })) === "", "sans nation / ligue / club / poste : pas de liste");
    const fodder = filters.normalizeFilter({ level: "gold", minRating: 85, maxRating: 85, priceMode: "futbin" });
    check(cardSets.futbinListUrl(fodder) === "https://www.futbin.com/27/players?version=gold&player_rating=85-85&ps_price=200-15000000&sort=ps_price&order=asc", "plage de notes : liste des moins chères (fourrage)", cardSets.futbinListUrl(fodder));
    check(cardSets.cardSetKey(fodder).startsWith("list:"), "plage de notes : mode FUTBIN possible sans joueur");
    const custom = filters.normalizeFilter({ priceMode: "futbin", futbinList: "https://www.futbin.com/27/players?version=gold_rare&league=16" });
    check(cardSets.futbinListUrl(custom) === "https://www.futbin.com/27/players?version=gold_rare&league=16" && cardSets.cardSetKey(custom).startsWith("list:"), "lien de liste collé prioritaire");
    check(cardSets.cardSetKey(filters.normalizeFilter({ priceMode: "futbin", player: { id: 231747 } })) === "versions:231747" && cardSets.cardSetKey(filters.normalizeFilter({ priceMode: "futbin", definitionId: 50563395 })) === "exact:50563395", "joueur = toutes ses versions, ID = version exacte");
  }

  console.log("\n# tranches de prix");
  {
    const bands = engine.buildBands([600, 650, 1000, 5000, 5250, 45000].map((max, i) => ({ eaId: i + 1, max })));
    check(bands.length === 4 && bands.map((b) => b.cards.length).join() === "2,1,2,1", "cartes regroupées par prix proche (4 tranches)", bands.map((b) => [b.min, b.max, b.cards.length]));
    check(bands[0].min === 0 && bands[1].min === 0 && bands[2].min === 700 && bands[3].min === 0, "achat min : juste au-dessus de la tranche multi-cartes précédente", bands.map((b) => b.min));
    const many = engine.buildBands(Array.from({ length: 60 }, (_, i) => ({ eaId: i + 1, max: Math.round(1000 * Math.pow(1.5, i)) })));
    check(many.length <= 16, "au plus 16 tranches", many.length);
  }

  console.log("\n# moteur : filtre par critères (liste FUTBIN, prix de chaque carte)");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa({ coins: 500000 });
    setPageForTests(mock.page);
    settings.setSetting("buy.maxPerSearch", 3);
    const url = "https://www.futbin.com/27/players?nation=163&position=LM&pos_type=main";
    addListPage(url, 1, [
      { eaId: 5001, futbinId: 901, name: "Ito", rating: 80, ps: 1000 },
      { eaId: 5002, futbinId: 902, name: "Nakamura", rating: 81, ps: 1100 },
      { eaId: 5003, futbinId: 903, name: "Mitoma", rating: 85, ps: 20000 },
      { eaId: 5004, futbinId: 904, name: "Kubo", rating: 86, ps: 21000 },
    ], 1);
    setFilter({ player: null, nation: 163, position: "LM", priceMode: "futbin", futbinPercent: 90 });
    mock.setMarket((n, criteria, p, makeItem) => {
      // Max : Ito 900, Nakamura 950 (990 arrondi au palier), Mitoma 18 000, Kubo 18 750 (18 900 arrondi).
      if (criteria.maxBuy === 950) {
        return { success: true, data: { items: [makeItem({ tradeId: "ito950", definitionId: 5001, bin: 950 }), makeItem({ tradeId: "naka950", definitionId: 5002, bin: 950 })] } };
      }
      if (criteria.maxBuy === 18750) {
        return { success: true, data: { items: [makeItem({ tradeId: "other", definitionId: 9999, bin: 5000 }), makeItem({ tradeId: "mito17k", definitionId: 5003, bin: 17000 }), makeItem({ tradeId: "kubo18k", definitionId: 5004, bin: 18750 })] } };
      }
      return { success: true, data: { items: [] } };
    });
    engine.startBot();
    await until(() => mock.calls.search.length >= 4, 8000);
    await stopAndWait();
    const windows = mock.calls.search.slice(0, 2).map((c) => [c.criteria.minBuy, c.criteria.maxBuy, c.criteria.nation, c.criteria.position]);
    // Achat min d'une tranche : 40 % du plus petit prix max de ses cartes (cartes bon marché des autres joueurs exclues).
    check(JSON.stringify(windows) === JSON.stringify([[350, 950, 163, "LM"], [7200, 18750, 163, "LM"]]), "recherches par tranche : 350–950 puis 7 200–18 750, critères EA gardés", windows);
    const bought = mock.calls.bid.map((b) => b.tradeId).sort();
    check(JSON.stringify(bought) === JSON.stringify(["kubo18k", "mito17k", "naka950"]), "achète sous 90 % du prix de CHAQUE carte (Ito à 950 > 900 ignoré, autre joueur ignoré)", bought);
    check(futbin.requests.every((r) => /\/27\/players\?/.test(r.url)), "prix pris dans la liste (aucune page joueur lue)", futbin.requests.map((r) => r.url));
    check(logs().some((l) => /liste FUTBIN de 4 carte/.test(l)), "journal : liste FUTBIN lue", logs().slice(-12));
  }

  console.log("\n# moteur : joueur « toutes versions » (prix de chaque version)");
  {
    baseSettings();
    resetFutbin();
    const mock = createMockEa({ coins: 900000 });
    setPageForTests(mock.page);
    addCard({ eaId: 231747, futbinId: 8, name: "Kylian Mbappé", rating: 91, ps: 50000 });
    addCard({ eaId: 50563395, futbinId: 11, name: "Kylian Mbappé", rating: 94, ps: 300000, special: true });
    setFilter({ priceMode: "futbin", futbinPercent: 90 });
    mock.setMarket((n, criteria, p, makeItem) =>
      criteria.defId[0] === 50563395 ? { success: true, data: { items: [makeItem({ tradeId: "totw", definitionId: 50563395, bin: 250000 })] } } : { success: true, data: { items: [] } }
    );
    engine.startBot();
    await until(() => mock.calls.bid.length >= 1 && mock.calls.search.some((c) => c.criteria.defId[0] === 231747), 10000);
    await stopAndWait();
    const searched = mock.calls.search.map((c) => `${c.criteria.defId[0]}:${c.criteria.maxBuy}`);
    check(searched.includes("231747:45000") && searched.includes("50563395:270000"), "chaque version cherchée à 90 % de SON prix (45 000 / 270 000)", searched);
    check(mock.calls.bid.length === 1 && mock.calls.bid[0].tradeId === "totw", "version spéciale achetée à 250 000 (≤ 270 000)", mock.calls.bid);
  }

  console.log("\n# version choisie dans la recherche FUTBIN : bonne page, sans ambiguïté");
  {
    baseSettings();
    resetFutbin();
    setPageForTests(createMockEa().page);
    // Deux fiches FUTBIN pour la même carte EA (ex. ancien et nouveau club) : c'est celle choisie qui compte.
    addCard({ eaId: 239482, futbinId: 587, name: "Galeno", rating: 81, ps: 700 });
    futbin.cards.set("old", { eaId: 239482, futbinId: 111, name: "Galeno", rating: 81, ps: 0 });
    const f = filters.normalizeFilter({ priceMode: "futbin", definitionId: 239482, futbinId: 587, futbinUrl: "https://www.futbin.com/27/player/587/galeno", player: { id: 239482, name: "Galeno", rating: 81 } });
    const handle = cardSets.acquireCardSet(f);
    await until(() => service.currentPrice(239482) === 700, 5000);
    handle.release();
    check(service.currentPrice(239482) === 700, "prix lu sur la fiche choisie (700)", service.getPriceRecord(239482));
    check(!futbin.requests.some((r) => /players\/search/.test(r.url)) && futbin.requests.some((r) => /player\/587\//.test(r.url)), "aucune recherche FUTBIN : lien direct vers la fiche", futbin.requests.map((r) => r.url));
  }

  console.log("\n# recherche de joueur : API de l'appli FUTBIN d'abord, recherche futbin.com en secours");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("prices.source", "api");
    const endrick = { name: "Endrick Felipe Moreira de Sousa", common: "Endrick", baseId: 272505 };
    futbin.api = [
      apiRow(Object.assign({ futbinId: 1500, eaId: 272505, rating: 79, ps: 900 }, endrick)),
      apiRow(Object.assign({ futbinId: 23100, eaId: 50604153, rating: 84, rareType: 69, slug: "spiritual_home", ps: 9000 }, endrick)),
      apiRow(Object.assign({ futbinId: 23101, eaId: 67381369, rating: 84, rareType: 69, slug: "spiritual_home", holo: true, ps: 15000 }, endrick)),
    ];
    const found = await futbinApi.searchFutbinPlayers("endri");
    check(
      found.ok && found.via === "api" && found.rows.length === 3 && !futbin.requests.some((r) => /futbin\.com/.test(r.url)),
      "« endri » : 3 versions par l'API, aucune requête futbin.com",
      { via: found.via, rows: (found.rows || []).length, requests: futbin.requests.map((r) => r.url) }
    );
    const holo = found.rows.find((row) => row.eaId === 67381369);
    check(holo && holo.holo === true && holo.rareType === 69 && /\/27\/player\/23101\//.test(holo.url) && holo.name === "Endrick", "version holo et promo signalées, lien FUTBIN de la version", holo);
    addCard({ eaId: 158023, futbinId: 22, name: "Lionel Messi", rating: 89, ps: 21500 });
    const fallback = await futbinApi.searchFutbinPlayers("messi");
    check(fallback.ok && fallback.via !== "api" && fallback.rows.some((row) => row.eaId === 158023), "joueur absent de l'API : recherche futbin.com en secours", fallback);
    settings.setSetting("prices.source", "pages");
    const apiCalls = () => futbin.requests.filter((r) => /futbin\.org/.test(r.url)).length;
    const before = apiCalls();
    const pages = await futbinApi.searchFutbinPlayers("endri");
    check(pages.ok && apiCalls() === before, "source « pages seules » : aucune requête à l'API", { before, after: apiCalls() });
  }

  console.log("\n# joueur « toutes versions » : versions lues par l'API de l'appli");
  {
    baseSettings();
    resetFutbin();
    settings.setSetting("prices.source", "api");
    futbin.api = [
      apiRow({ futbinId: 8, eaId: 231747, name: "Kylian Mbappé", common: "Mbappé", rating: 91, ps: 3179000 }),
      apiRow({ futbinId: 22994, eaId: 50563395, baseId: 231747, name: "Kylian Mbappé", common: "Mbappé", rating: 91, rareType: 22, slug: "destined_for_glory", ps: 7800000 }),
      apiRow({ futbinId: 22995, eaId: 67340611, baseId: 231747, name: "Kylian Mbappé", common: "Mbappé", rating: 91, rareType: 22, slug: "destined_for_glory", holo: true, ps: 11250000 }),
      apiRow({ futbinId: 9579, eaId: 278172, name: "Ethan Mbappé", common: "Mbappé", rating: 74, slug: "silver", ps: 950 }),
    ];
    const f = filters.normalizeFilter({ priceMode: "futbin", player: { id: 231747, name: "Mbappé", rating: 91 } });
    const handle = cardSets.acquireCardSet(f);
    const key = cardSets.cardSetKey(f);
    await until(() => cardSets.cardSetSnapshot(key).status === "ready", 5000);
    const snapshot = cardSets.cardSetSnapshot(key);
    handle.release();
    const ids = snapshot.cards.map((card) => card.eaId).sort((a, b) => a - b);
    check(ids.join() === "231747,50563395,67340611" && !snapshot.message, "3 versions de Mbappé (base, Destin glorieux, holo), homonyme écarté", { ids, message: snapshot.message });
    check(!futbin.requests.some((r) => /players\/search/.test(r.url)), "aucune recherche futbin.com", futbin.requests.map((r) => r.url));
  }

  console.log("\n# FUTBIN refuse le script : onglet relais futbin.com (galerie, recherche de joueurs en POST)");
  {
    baseSettings();
    resetFutbin();
    relay.resetRelayForTests();
    settings.setSetting("prices.iframeFallback", true);
    // Stockage partagé de Tampermonkey simulé (valeurs + écouteurs entre onglets).
    const store = new Map();
    const listeners = [];
    global.GM_getValue = (key, fallback) => (store.has(key) ? store.get(key) : fallback);
    global.GM_setValue = (key, value) => {
      const old = store.get(key);
      store.set(key, value);
      listeners.filter((entry) => entry.key === key).forEach((entry) => setTimeout(() => entry.fn(key, old, value, true), 1));
    };
    global.GM_addValueChangeListener = (key, fn) => {
      listeners.push({ key, fn, id: listeners.length + 1 });
      return listeners.length;
    };
    global.GM_removeValueChangeListener = (id) => {
      const index = listeners.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    };
    // Onglet futbin.com simulé : vrai code du relais (bootFutbinRelay), pages servies par fetch.
    const opened = [];
    const relayed = [];
    global.GM_openInTab = (url) => {
      opened.push(url);
      const win = {};
      win.top = win;
      global.window = win;
      global.location = { hash: "#mb-relay" };
      const session = new Map();
      global.sessionStorage = { getItem: (key) => session.get(key) || null, setItem: (key, value) => session.set(key, value) };
      global.fetch = async (path, options) => {
        relayed.push({ path, method: options.method, body: options.body });
        const page = futbin.pages.get(`https://www.futbin.com${path}`);
        return { status: page ? 200 : 404, text: async () => page || "Not found" };
      };
      setTimeout(() => relay.bootFutbinRelay(), 5);
      return { closed: false, close() { this.closed = true; } };
    };
    futbin.blocked = true;
    futbin.pages.set("https://www.futbin.com/27/gallery", "<html><body>galerie servie par l'onglet</body></html>");
    futbin.pages.set("https://www.futbin.com/27/gallery/set-player-search/1", '{"items":[],"totalItems":0}');
    const index = await fetchFutbinText("https://www.futbin.com/27/gallery", { forceDirect: true });
    check(index.ok && index.via === "relay" && /galerie servie/.test(index.text), "requête directe refusée (Cloudflare) : page lue par l'onglet relais", { ok: index.ok, via: index.via, status: index.status });
    check(opened.length === 1 && /^https:\/\/www\.futbin\.com\/27\/gallery#mb-relay$/.test(opened[0]), "un onglet futbin.com ouvert en arrière-plan (marqué #mb-relay)", opened);
    const pool = await fetchFutbinText("https://www.futbin.com/27/gallery/set-player-search/1", { json: true, method: "POST", body: '{"sort":"ItemScoreDesc","page":2}', forceDirect: true });
    check(pool.ok && pool.text === '{"items":[],"totalItems":0}' && opened.length === 1, "recherche de joueurs (POST) par le même onglet, sans en rouvrir", { ok: pool.ok, opened: opened.length });
    check(relayed.some((call) => call.method === "POST" && /set-player-search\/1$/.test(call.path) && /page":2/.test(call.body)), "POST envoyé depuis futbin.com avec le corps demandé", relayed);
    const missing = await fetchFutbinText("https://www.futbin.com/27/gallery/set/999/nope", { forceDirect: true });
    check(!missing.ok && missing.notFound, "page absente de FUTBIN : introuvable, sans attente", missing);
    check(!relay.relayAllowed("/27/players", "POST") && relay.relayAllowed("/27/gallery/set-player-search/12", "POST") && relay.relayPath("https://evil.example/27/gallery") === null, "relais limité à futbin.com, POST seulement pour la galerie");
    const before = relayed.length;
    const searchOnly = await fetchFutbinText("https://www.futbin.com/players/search?query=x", { allowIframe: false, forceDirect: true });
    check(!searchOnly.ok && relayed.length === before, "recherche rapide (sans secours) : pas d'onglet relais", { relayed: relayed.length - before });
    ["GM_getValue", "GM_setValue", "GM_addValueChangeListener", "GM_removeValueChangeListener", "GM_openInTab", "window", "location", "sessionStorage", "fetch"].forEach((name) => delete global[name]);
    relay.resetRelayForTests();
  }

  console.log(`\n${passes} OK, ${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(2); });
