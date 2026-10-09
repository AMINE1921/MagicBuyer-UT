import { createMockEa } from "./mockEa";
import { setPageForTests } from "../app/core/page";
import * as prices from "../app/core/prices";
import * as ranges from "../app/core/ranges";
import * as filters from "../app/core/filters";
import * as settings from "../app/core/settings";
import * as engine from "../app/core/engine";
import * as state from "../app/core/state";

let failures = 0;
let passes = 0;
const check = (cond, label, extra) => {
  if (cond) { passes++; console.log(`  ✓ ${label}`); }
  else { failures++; console.log(`  ✗ ${label}`, extra !== undefined ? JSON.stringify(extra) : ""); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, timeout = 6000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > timeout) return false; await sleep(5); }
  return true;
};
const logs = () => state.getLogs().map((l) => `${l.type}: ${l.text}`);

const fastTiming = () => {
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
};
const setFilter = (patch) => {
  const f = filters.getActiveFilter();
  const sellMode = patch && patch.sellPrice ? "fixed" : "global";
  filters.updateFilter(f.id, Object.assign({ player: { id: 231747, name: "Mbappé", rating: 91 }, maxBuy: 45000, sellPrice: 0, maxBid: 0, minBuy: 0, definitionId: 0, nation: -1, minRating: 0, maxRating: 0, priceMode: "fixed", futbinPercent: 90, bidPercent: 0, sellMode, sellPercent: "" }, patch));
  filters.setRotation({ enabled: false });
};
const stopAndWait = async () => { engine.stopBot("fin du test", { manual: true }); await until(() => !engine.isRunning()); await sleep(30); };

const main = async () => {
  // Planchers de sécurité abaissés : les scénarios tournent en quelques secondes.
  engine.setSafetyForTests({ minWaitMs: 0, actionGapMs: [0, 0], minPauseSeconds: 0, autoPause: false });
  console.log("\n# prix");
  check(prices.roundPrice(44990) === 45000, "roundPrice 44990 → 45000", prices.roundPrice(44990));
  check(prices.priceAbove(1000) === 1100 && prices.priceBelow(1000) === 950, "paliers autour de 1000");
  check(prices.priceAbove(9900) === 10000 && prices.priceAbove(10000) === 10250, "paliers autour de 10 000");
  check(prices.priceBelow(52000) === 51500, "priceBelow(52000) = 51500", prices.priceBelow(52000));
  check(prices.priceBelow(150) === 0 && prices.priceAbove(0) === 150, "bornes 150");
  check(prices.afterTax(10000) === 9500 && prices.profitFor(41000, 52000) === 8400, "taxe 5 % et bénéfice", prices.profitFor(41000, 52000));
  check(prices.toInt("45 000") === 45000 && prices.toInt("") === 0, "toInt avec espaces");

  console.log("\n# plages");
  const r1 = ranges.parseRange("5-9", "S");
  check(r1 && r1.min === 5 && r1.max === 9, "5-9 s");
  const r2 = ranges.parseRange("4,5-7", "S");
  check(r2 && r2.min === 4.5 && r2.max === 7, "décimales 4,5-7");
  const r3 = ranges.parseRange("1-2H", "S");
  check(r3 && r3.min === 3600 && r3.max === 7200, "1-2H");
  check(ranges.parseRange("20-40S", "M").max === 40, "unité explicite prioritaire");
  check(ranges.parseRange("abc", "S") === null && ranges.parseRange("", "S") === null, "invalide → null");
  const r4 = ranges.parseRange("9-5", "S");
  check(r4.min === 5 && r4.max === 9, "plage inversée remise dans l'ordre");
  let okInt = true;
  for (let i = 0; i < 200; i++) { const v = ranges.pickInt("15-25"); if (v < 15 || v > 25 || !Number.isInteger(v)) okInt = false; }
  check(okInt, "pickInt dans [15,25]");

  console.log("\n# critères FC 27");
  const mock0 = createMockEa();
  setPageForTests(mock0.page);
  const base = filters.normalizeFilter({ player: { id: 231747, name: "Mbappé" }, nation: 18, level: "gold", maxBuy: 44990, position: "ST" });
  const c1 = filters.buildCriteria(base, { maxBuy: 44990 });
  check(c1 instanceof mock0.page.UTSearchCriteriaDTO, "vrai UTSearchCriteriaDTO utilisé");
  check(c1.type === "player" && c1.nation === 18, "nation conservée malgré le setter type", { type: c1.type, nation: c1.nation });
  check(c1.maskedDefId === 231747 && c1.defId.length === 0, "maskedDefId (toutes versions), defId vide");
  check(c1.maxBuy === 44750 && c1.level === "gold" && c1.position === "ST", "prix max arrondi vers le bas (44 990 → 44 750) + qualité + poste", c1.maxBuy);
  check(prices.floorPrice(44990) === 44750 && prices.ceilPrice(44990) === 45000 && prices.floorPrice(1049) === 1000 && prices.ceilPrice(120) === 150, "floor/ceil aux paliers EA");
  const c2 = filters.buildCriteria(filters.normalizeFilter({ definitionId: 50563123, zone: 132 }), {});
  check(c2.defId[0] === 50563123 && c2.maskedDefId === 0 && c2.zone === 132 && c2.position === "any", "version exacte via defId + zone attaque");
  const snap = filters.snapshotFromEaCriteria({ type: "player", maskedDefId: 231747, defId: [], nation: -1, league: 13, club: -1, playStyle: -1, zone: -1, level: "SP", rarities: [3], position: "any", maxBuy: 60000 }, { id: 231747, commonName: "", firstName: "Kylian", lastName: "Mbappé", rating: 91 });
  check(snap.player.id === 231747 && snap.player.name === "Kylian Mbappé" && snap.league === 13 && snap.nation === -1 && snap.zone === -1 && snap.rarities[0] === 3 && snap.maxBuy === 60000, "import d'une recherche EA", snap);

  console.log("\n# anti-cache");
  const seen = new Set();
  let lossless = true;
  for (let s = 0; s < 20; s++) {
    const p = filters.cacheBusterPrices("auto", s, { maxBuy: 45000, minBuy: 0, maxBid: 0, cap: 1000 });
    seen.add(p.maxBid);
    if (!(p.maxBid >= 45000) || p.minBuy || p.minBid) lossless = false;
  }
  check(lossless, "mode auto : enchère max ≥ prix d'achat max, rien d'autre (aucune annonce exclue)");
  check(seen.size === 20, "20 URL différentes sur 20 recherches", seen.size);
  const mb = filters.cacheBusterPrices("minBuy", 3, { maxBuy: 900, minBuy: 0, maxBid: 0, cap: 1000 });
  check(mb.minBuy > 0 && mb.minBuy <= 450, "mode achat min borné à 50 % du max", mb);
  const off = filters.cacheBusterPrices("off", 3, { maxBuy: 900, minBuy: 0, maxBid: 0, cap: 1000 });
  check(!off.minBuy && !off.minBid && !off.maxBid, "mode désactivé");

  console.log("\n# moteur : achats, ordre, revente");
  {
    fastTiming();
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({ sellPrice: 52000 });
    mock.setMarket((n, criteria, page, makeItem) => {
      if (n === 1) return { success: true, data: { items: [] } };
      if (n === 2 || n === 3) return { success: true, data: { items: [
        makeItem({ tradeId: "own", bin: 30000, own: true }),
        makeItem({ tradeId: "t44", bin: 44000, expires: 3500 }),
        makeItem({ tradeId: "t41", bin: 41000, expires: 3200 }),
        makeItem({ tradeId: "t47", bin: 47000 }),
        makeItem({ tradeId: "other", bin: 20000, definitionId: 999 }),
      ] } };
      return { success: true, data: { items: [] } };
    });
    check(engine.startBot() === true, "démarrage accepté");
    await until(() => mock.calls.bid.length >= 2, 4000);
    await sleep(200);
    const bids = mock.calls.bid.map((b) => `${b.tradeId}@${b.price}`);
    check(bids[0] === "t41@41000" && bids[1] === "t44@44000", "le moins cher d'abord, puis le suivant", bids);
    check(!bids.some((b) => b.startsWith("own") || b.startsWith("t47") || b.startsWith("other")), "ignore sa propre annonce, les cartes trop chères et les autres joueurs");
    check(mock.calls.list.length === 2 && mock.calls.list[0].bin === 52000 && mock.calls.list[0].start === 51500 && mock.calls.list[0].duration === 3600, "mise en vente à 52 000 (départ 51 500, 1 h)", mock.calls.list);
    const s = state.getState().stats;
    check(s.won === 2 && s.spent === 85000, "stats achats/dépensé", s);
    check(s.estProfit === prices.profitFor(41000, 52000) + prices.profitFor(44000, 52000), "profit estimé", s.estProfit);
    const fs = state.filterStatsFor(filters.getActiveFilter().id);
    check(fs && fs.won === 2 && fs.spent === 85000 && fs.searches === s.searches && fs.estProfit === s.estProfit, "bilan du filtre (recherches, achats, dépensé, bénéfice)", fs);
    const cr = mock.calls.search[1].criteria;
    check(cr.maskedDefId === 231747 && cr.maxBuy === 45000 && cr.maxBid >= 45000 && cr.defId.length === 0, "critères envoyés à EA", cr);
    const distinct = new Set(mock.calls.search.map((c) => c.criteria.maxBid));
    check(distinct.size === mock.calls.search.length || mock.calls.search.length > 20, "anti-cache : chaque recherche diffère", [distinct.size, mock.calls.search.length]);
    check(mock.calls.clearCache >= mock.calls.search.length, "cache EA vidé avant chaque recherche");
    await stopAndWait();
    check(!engine.isRunning(), "arrêt manuel");
  }

  console.log("\n# moteur : filtre « holo seulement » / « sans holo »");
  {
    fastTiming();
    const holo = { _hyperCosmeticDTOs: { 1: { type: 1, subtype: 0 } } };
    const market = (n, criteria, page, makeItem) =>
      n === 1
        ? { success: true, data: { items: [] } }
        : { success: true, data: { items: [makeItem({ tradeId: "normal", bin: 41000 }), makeItem({ tradeId: "holo", bin: 43000, extra: holo })] } };
    const mock = createMockEa();
    setPageForTests(mock.page);
    mock.setMarket(market);
    setFilter({ holo: "only" });
    engine.startBot();
    await until(() => mock.calls.bid.length >= 1, 4000);
    await stopAndWait();
    check(mock.calls.bid.length >= 1 && mock.calls.bid.every((b) => b.tradeId === "holo"), "holo seulement : la version normale (moins chère) est ignorée", mock.calls.bid);
    const mock2 = createMockEa();
    setPageForTests(mock2.page);
    mock2.setMarket(market);
    setFilter({ holo: "none" });
    engine.startBot();
    await until(() => mock2.calls.bid.length >= 1, 4000);
    await stopAndWait();
    check(mock2.calls.bid.length >= 1 && mock2.calls.bid.every((b) => b.tradeId === "normal"), "sans holo : la holo est ignorée", mock2.calls.bid);
    setFilter({ holo: "any" });
  }

  console.log("\n# moteur : cadence et limite par minute");
  {
    fastTiming();
    settings.setSetting("timing.wait", "0.2");
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    engine.startBot();
    await until(() => mock.calls.search.length >= 5, 4000);
    await stopAndWait();
    const gaps = mock.calls.search.slice(1).map((c, i) => c.at - mock.calls.search[i].at);
    check(gaps.every((g) => g >= 190 && g <= 290), "écart ≈ 200 ms entre recherches", gaps);
    fastTiming();
    settings.setSetting("timing.wait", "0.01");
    settings.setSetting("timing.maxPerMinute", 400);
    const mock2 = createMockEa();
    setPageForTests(mock2.page);
    engine.startBot();
    await until(() => mock2.calls.search.length >= 5, 4000);
    await stopAndWait();
    const gaps2 = mock2.calls.search.slice(1).map((c, i) => c.at - mock2.calls.search[i].at);
    check(gaps2.every((g) => g >= 145), "max 400/min → ≥ 150 ms entre recherches", gaps2);
  }

  console.log("\n# moteur : pause automatique");
  {
    fastTiming();
    settings.setSetting("timing.pauseEvery", "3");
    settings.setSetting("timing.pauseFor", "0.4S");
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    engine.startBot();
    await until(() => mock.calls.search.length >= 7, 5000);
    await stopAndWait();
    const gaps = mock.calls.search.slice(1).map((c, i) => c.at - mock.calls.search[i].at);
    check(gaps[2] >= 390 && gaps[5] >= 390 && gaps[0] < 200 && gaps[3] < 200, "pause ~400 ms toutes les 3 recherches", gaps);
  }

  console.log("\n# moteur : captcha = arrêt immédiat");
  {
    fastTiming();
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    mock.setMarket((n) => (n === 3 ? { success: false, status: 458, error: { code: 458 } } : { success: true, data: { items: [] } }));
    engine.startBot();
    await until(() => !engine.isRunning(), 4000);
    await sleep(300);
    check(!engine.isRunning(), "bot arrêté");
    check(mock.calls.search.length === 3, "plus aucune recherche après le captcha", mock.calls.search.length);
    check(logs().some((l) => /captcha/i.test(l) && l.startsWith("error")), "journal : alerte captcha");
  }

  console.log("\n# moteur : 429 → pause de sécurité puis arrêt si répété");
  {
    fastTiming();
    settings.setSetting("errors.cooldown", "0.3S");
    settings.setSetting("errors.maxCooldowns", 1);
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    mock.setMarket((n) => (n === 2 || n === 4 ? { success: false, status: 429 } : { success: true, data: { items: [] } }));
    engine.startBot();
    await until(() => !engine.isRunning(), 5000);
    const gaps = mock.calls.search.slice(1).map((c, i) => c.at - mock.calls.search[i].at);
    check(mock.calls.search.length === 4, "reprise après la 1re limitation, arrêt à la 2e", mock.calls.search.length);
    check(gaps[1] >= 290, "pause de sécurité ≈ 300 ms respectée", gaps);
    check(/limite/i.test(state.getState().detail), "raison d'arrêt claire", state.getState().detail);
  }

  console.log("\n# moteur : échecs consécutifs");
  {
    fastTiming();
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    mock.setMarket(() => ({ success: false, status: 500 }));
    engine.startBot();
    await until(() => !engine.isRunning(), 4000);
    check(mock.calls.search.length === 3, "arrêt après 3 échecs d'affilée", mock.calls.search.length);
  }

  console.log("\n# moteur : raté (461) puis objectif d'achats");
  {
    fastTiming();
    settings.setSetting("buy.stopAfterPurchases", 2);
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    let serial = 0;
    mock.setMarket((n, c, p, makeItem) => ({ success: true, data: { items: [makeItem({ tradeId: `x${serial++}`, bin: 40000 })] } }));
    mock.setBid((item, price, n) => (n === 1 ? { success: false, status: 461, error: { code: 461 } } : { success: true, response: { coins: 100000 - price } }));
    engine.startBot();
    await until(() => !engine.isRunning(), 5000);
    const s = state.getState().stats;
    check(s.missed === 1 && s.won === 2 && mock.calls.bid.length === 3, "1 raté puis 2 achats et arrêt", s);
    check(/objectif/.test(state.getState().detail), "arrêt sur objectif", state.getState().detail);
  }

  console.log("\n# moteur : coins insuffisants");
  {
    fastTiming();
    const mock = createMockEa({ coins: 10000 });
    setPageForTests(mock.page);
    setFilter({});
    mock.setMarket((n, c, p, makeItem) => ({ success: true, data: { items: [makeItem({ bin: 40000 })] } }));
    engine.startBot();
    await until(() => mock.calls.search.length >= 3, 3000);
    await stopAndWait();
    check(mock.calls.bid.length === 0, "aucune tentative d'achat sans les coins");
    check(logs().some((l) => /coins insuffisants/.test(l)), "journal : coins insuffisants");
  }

  console.log("\n# moteur : pause / reprise");
  {
    fastTiming();
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    engine.startBot();
    await until(() => mock.calls.search.length >= 2, 3000);
    engine.pauseBot();
    const n = mock.calls.search.length;
    await sleep(400);
    check(mock.calls.search.length <= n + 1, "aucune recherche pendant la pause", [n, mock.calls.search.length]);
    check(state.getState().status === "paused", "état : en pause");
    engine.resumeBot();
    await until(() => mock.calls.search.length >= n + 3, 3000);
    check(mock.calls.search.length >= n + 3, "reprise des recherches");
    await stopAndWait();
  }

  console.log("\n# moteur : arrêt automatique (durée)");
  {
    fastTiming();
    settings.setSetting("timing.stopAfter", "0.5S");
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    const t0 = Date.now();
    engine.startBot();
    await until(() => !engine.isRunning(), 4000);
    const elapsed = Date.now() - t0;
    check(elapsed >= 480 && elapsed < 1500, "arrêt après ~0,5 s", elapsed);
  }

  console.log("\n# moteur : liste des transferts (relist + vider les vendus)");
  {
    fastTiming();
    settings.setSetting("transfer.relistExpired", true);
    settings.setSetting("transfer.clearSoldAt", 2);
    const tmp = createMockEa();
    const transferItems = [
      tmp.makeItem({ state: "sold", bid: 10000 }),
      tmp.makeItem({ state: "sold", bid: 12000 }),
      tmp.makeItem({ state: "expired" }),
      tmp.makeItem({ state: "selling" }),
    ];
    const mock = createMockEa({ transferItems });
    setPageForTests(mock.page);
    setFilter({});
    engine.startBot();
    await until(() => mock.calls.search.length >= 2, 3000);
    await stopAndWait();
    check(mock.calls.relist >= 1 && mock.calls.clearSold >= 1, "relist et vider les vendus déclenchés", mock.calls);
    const tr = state.getState().transfer;
    check(tr && tr.sold === 0 && tr.unsold === 1 && tr.active === 1 && tr.capacity === 100, "résumé de la liste après encaissement", tr);
    check(state.getState().stats.soldValue === prices.afterTax(22000), "valeur encaissée après taxe", state.getState().stats.soldValue);
  }

  console.log("\n# moteur : ventes vues pendant la session (bénéfice réel)");
  {
    fastTiming();
    settings.setSetting("transfer.checkEvery", 1);
    settings.setSetting("notify.onSold", true);
    const tmp = createMockEa();
    const transferItems = [tmp.makeItem({ state: "sold", bid: 9000, extra: { lastSalePrice: 5000 } }), tmp.makeItem({ state: "selling", bin: 20000 })];
    const mock = createMockEa({ transferItems });
    setPageForTests(mock.page);
    setFilter({});
    engine.startBot();
    // Deuxième contrôle demandé : la réponse du premier (ventes d'avant le démarrage) est traitée.
    await until(() => mock.calls.transfer >= 2, 3000);
    // Deux ventes après le démarrage : une avec prix payé connu, une carte de pack (prix payé 0).
    transferItems.push(tmp.makeItem({ state: "sold", bid: 20000, extra: { lastSalePrice: 15000 } }));
    transferItems.push(tmp.makeItem({ state: "sold", bid: 3000 }));
    await until(() => state.getState().stats.salesSeen >= 2, 3000);
    await sleep(60);
    const stats = state.getState().stats;
    await stopAndWait();
    check(stats.salesSeen === 2 && stats.salesKnown === 1, "vente d'avant le démarrage ignorée, deux nouvelles vues", stats);
    check(stats.realProfit === prices.afterTax(20000) - 15000, "bénéfice réel = vente après taxe − prix payé", stats.realProfit);
    check(stats.salesValue === prices.afterTax(20000) + prices.afterTax(3000), "valeur des ventes après taxe", stats.salesValue);
    check(logs().some((l) => l.includes("Vendu :") && /payé 15\s000, bénéfice réel \+4\s000/.test(l)), "vente journalisée avec le bénéfice", logs().slice(-8));
    check(/2 ventes, bénéfice réel \+4\s000/.test(logs().slice(-1)[0]), "bilan d'arrêt avec ventes et bénéfice réel", logs().slice(-1));
  }

  console.log("\n# moteur : accès au marché refusé par EA");
  {
    fastTiming();
    const mock = createMockEa();
    mock.page.TradeAccessLevel = { ALLOWED: 0, BANNED: 1, CONSOLE_ONLY: 2, UNAVAILABLE: 3, MAINTENANCE: 4 };
    const realUser = mock.page.services.User.getUser;
    mock.page.services.User.getUser = () => Object.assign(realUser(), { tradeAccess: 2, hasTradeAccess: () => false });
    setPageForTests(mock.page);
    setFilter({});
    check(engine.startBot() === false && !engine.isRunning(), "démarrage refusé sans accès au marché");
    check(logs().slice(-1)[0].includes("console"), "raison claire (console seulement)", logs().slice(-1));
    check(mock.calls.search.length === 0, "aucune recherche envoyée");
  }

  console.log("\n# moteur : planchers de sécurité");
  {
    fastTiming();
    engine.setSafetyForTests({ minWaitMs: 400 });
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    engine.startBot();
    await until(() => mock.calls.search.length >= 3, 4000);
    await stopAndWait();
    engine.setSafetyForTests({ minWaitMs: 0 });
    const at = mock.calls.search.map((c) => c.at);
    const gaps = at.slice(1).map((v, i) => v - at[i]);
    check(gaps.length >= 2 && gaps.every((g) => g >= 380), "attente réglée à 0,05 s relevée au plancher", gaps);
  }

  console.log("\n# moteur : carte en chute (baisse depuis le plus haut)");
  {
    const now = Date.now();
    check(Math.round(engine.dropFromPeak([{ t: now - 600000, price: 50000 }, { t: now - 60000, price: 46000 }], 46000)) === 8, "baisse depuis le plus haut des 20 min : 8 %");
    check(engine.dropFromPeak([{ t: now - 25 * 60000, price: 60000 }, { t: now - 60000, price: 46000 }], 46000) === 0, "plus haut de plus de 20 min ignoré");
  }

  console.log("\n# moteur : enchères");
  {
    fastTiming();
    settings.setSetting("bid.enabled", true);
    settings.setSetting("bid.expiresWithin", "5M");
    const mock = createMockEa({ watchItems: () => wonItems });
    let wonItems = [];
    setPageForTests(mock.page);
    setFilter({ maxBuy: 0, maxBid: 20000, sellPrice: 25000 });
    let target;
    mock.setMarket((n, c, p, makeItem) => {
      if (n === 1) {
        target = makeItem({ tradeId: "auc1", bin: 50000, bid: 15000, expires: 100 });
        return { success: true, data: { items: [target, makeItem({ tradeId: "late", bin: 50000, bid: 1000, expires: 3000 })] } };
      }
      return { success: true, data: { items: [] } };
    });
    engine.startBot();
    await until(() => mock.calls.bid.length >= 1, 3000);
    const bid = mock.calls.bid[0];
    check(bid && bid.tradeId === "auc1" && bid.price === 15250, "enchère au palier suivant sur la carte qui finit bientôt", mock.calls.bid);
    check(mock.calls.search[0].criteria.maxBid === 20000 && !mock.calls.search[0].criteria.maxBuy, "recherche filtrée sur l'enchère max", mock.calls.search[0].criteria);
    target.getAuctionData()._state = "won";
    target.getAuctionData().currentBid = 15250;
    wonItems = [target];
    const auction = target.getAuctionData();
    auction.endsAt = 0;
    await until(() => mock.calls.list.length >= 1, 25000);
    check(mock.calls.list.length === 1 && mock.calls.list[0].bin === 25000, "enchère gagnée → mise en vente", mock.calls.list);
    check(state.getState().stats.bidsWon === 1, "compteur enchères gagnées");
    await stopAndWait();
  }

  console.log("\n# moteur : rotation entre filtres");
  {
    fastTiming();
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    const second = filters.addFilter({ name: "Salah", player: { id: 209331, name: "Salah", rating: 89 }, maxBuy: 30000 }, false);
    filters.setRotation({ enabled: true, every: 2, random: false });
    engine.startBot();
    await until(() => mock.calls.search.length >= 6, 4000);
    await stopAndWait();
    const ids = mock.calls.search.slice(0, 6).map((c) => c.criteria.maskedDefId);
    check(JSON.stringify(ids) === JSON.stringify([231747, 231747, 209331, 209331, 231747, 231747]), "alterne toutes les 2 recherches", ids);
    check(mock.calls.search[2].criteria.maxBuy === 30000, "prix max propre à chaque filtre", mock.calls.search[2].criteria.maxBuy);
    filters.removeFilter(second.id);
    filters.setRotation({ enabled: false });
  }

  console.log("\n# moteur : liste des transferts pleine");
  {
    fastTiming();
    const mock = createMockEa({ transferFull: true });
    setPageForTests(mock.page);
    setFilter({ sellPrice: 52000 });
    mock.setMarket((n, c, p, makeItem) => (n === 2 ? { success: true, data: { items: [makeItem({ bin: 40000 })] } } : { success: true, data: { items: [] } }));
    engine.startBot();
    await until(() => !engine.isRunning(), 4000);
    check(mock.calls.list.length === 0 && mock.calls.move.length === 0, "rien n'est listé ni déplacé");
    check(/pleine/.test(state.getState().detail), "arrêt : liste pleine", state.getState().detail);
  }

  console.log("\n# moteur : achat sans réponse (délai dépassé)");
  {
    fastTiming();
    const mock = createMockEa({ latency: 5 });
    setPageForTests(mock.page);
    setFilter({});
    mock.setMarket((n, c, p, makeItem) => (n === 1 ? { success: true, data: { items: [makeItem({ tradeId: "slow", bin: 40000 })] } } : { success: true, data: { items: [] } }));
    mock.page.services.Item.bid = function () { return { observe() { return this; }, unobserve() { return this; } }; };
    engine.startBot();
    await until(() => mock.calls.search.length >= 2, 16000);
    check(engine.isRunning(), "le bot continue après un achat sans réponse");
    check(logs().some((l) => /délai dépassé/.test(l)), "journal : délai dépassé", logs().slice(-3));
    await stopAndWait();
  }

  console.log("\n# non-régression (relecture)");
  {
    check(prices.parseCoinsInput("45k") === 45000 && prices.parseCoinsInput("1,2m") === 1200000 && prices.parseCoinsInput("45 000") === 45000, "saisie abrégée 45k / 1,2m / 45 000");
    const serverFilter = (criteria, items) => items.filter((it) => {
      const a = it.getAuctionData();
      if (criteria.maxBuy > 0 && a.buyNowPrice > criteria.maxBuy) return false;
      if (criteria.maxBid > 0 && (a.currentBid || a.startingBid) > criteria.maxBid) return false;
      return true;
    });
    // enchères + prix d'achat max : recherche d'enchères dédiée
    fastTiming();
    settings.setSetting("bid.enabled", true);
    settings.setSetting("bid.searchEvery", 2);
    let mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({ maxBuy: 10000, maxBid: 20000 });
    let auc;
    mock.setMarket((n, c, p, makeItem) => {
      auc = auc || makeItem({ tradeId: "auc1", bin: 50000, bid: 15000, expires: 100 });
      return { success: true, data: { items: serverFilter(c, [auc]) } };
    });
    engine.startBot();
    await until(() => mock.calls.bid.length >= 1, 3000);
    await stopAndWait();
    check(mock.calls.bid.length === 1 && mock.calls.bid[0].price === 15250, "enchère placée même avec un prix d'achat max", mock.calls.bid);
    check(mock.calls.search.some((s) => !s.criteria.maxBuy && s.criteria.maxBid === 20000) && mock.calls.search.some((s) => s.criteria.maxBuy === 10000), "alternance recherche achat / recherche enchères");

    // pause + reprise pendant une pause de sécurité
    fastTiming();
    settings.setSetting("errors.cooldown", "1S");
    settings.setSetting("errors.maxCooldowns", 3);
    mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    mock.setMarket((n) => (n === 2 ? { success: false, status: 429 } : { success: true, data: { items: [] } }));
    engine.startBot();
    await until(() => mock.calls.search.length >= 2, 3000);
    await sleep(100);
    check(state.getState().status === "cooldown", "état : pause de sécurité", state.getState().status);
    engine.pauseBot();
    await sleep(20);
    engine.resumeBot();
    await until(() => mock.calls.search.length >= 3, 3000);
    await stopAndWait();
    check(mock.calls.search[2].at - mock.calls.search[1].at >= 990, "Pause/Reprise ne raccourcit pas la pause de sécurité", mock.calls.search[2].at - mock.calls.search[1].at);

    // pause pendant le démarrage
    fastTiming();
    mock = createMockEa({ latency: 250 });
    setPageForTests(mock.page);
    setFilter({});
    engine.startBot();
    await sleep(20);
    engine.pauseBot();
    await sleep(500);
    check(state.getState().status === "paused" && mock.calls.search.length === 0, "pause pendant le démarrage respectée", [state.getState().status, mock.calls.search.length]);
    await stopAndWait();

    // prix non alignés
    fastTiming();
    mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({ sellPrice: 52030 });
    mock.setMarket((n, c, p, makeItem) => (n === 1 ? { success: true, data: { items: [makeItem({ tradeId: "d1", bin: 44000 })] } } : { success: true, data: { items: [] } }));
    engine.startBot();
    await until(() => mock.calls.list.length >= 1, 3000);
    await stopAndWait();
    check(mock.calls.list[0] && mock.calls.list[0].bin === 52000, "prix de revente arrondi au palier EA", mock.calls.list[0]);

    // limite d'achats avec plusieurs achats par recherche
    fastTiming();
    settings.setSetting("buy.stopAfterPurchases", 1);
    settings.setSetting("buy.maxPerSearch", 3);
    mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    mock.setMarket((n, c, p, makeItem) => ({ success: true, data: { items: [makeItem({ bin: 40000 }), makeItem({ bin: 41000 }), makeItem({ bin: 42000 })] } }));
    engine.startBot();
    await until(() => !engine.isRunning(), 3000);
    check(state.getState().stats.won === 1, "objectif d'achats jamais dépassé", state.getState().stats.won);

    // erreur passagère : un nouvel essai
    fastTiming();
    mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    mock.setMarket((n, c, p, makeItem) => ({ success: true, data: { items: [makeItem({ tradeId: "keep", bin: 40000 })] } }));
    mock.setBid((item, price, n) => (n === 1 ? { success: false, status: 500 } : { success: true, response: { coins: 100000 - price } }));
    engine.startBot();
    await until(() => state.getState().stats.won >= 1, 3000);
    await stopAndWait();
    check(mock.calls.bid.length === 2 && state.getState().stats.won === 1, "annonce retentée une fois après une erreur 500", mock.calls.bid.length);

    // 429 pendant un achat : pas d'achat sur une liste périmée
    fastTiming();
    settings.setSetting("errors.cooldown", "0.5S");
    settings.setSetting("buy.maxPerSearch", 2);
    mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    mock.setMarket((n, c, p, makeItem) => (n === 1 ? { success: true, data: { items: [makeItem({ tradeId: "y1", bin: 40000 }), makeItem({ tradeId: "y2", bin: 41000 })] } } : { success: true, data: { items: [] } }));
    mock.setBid((item, price, n) => (n === 1 ? { success: false, status: 429 } : { success: true, response: { coins: 100000 - price } }));
    engine.startBot();
    await until(() => mock.calls.search.length >= 2, 3000);
    await stopAndWait();
    check(mock.calls.bid.length === 1, "aucun achat sur l'ancienne liste après un 429", mock.calls.bid.map((b) => b.tradeId));

    // code d'arrêt personnalisé sur un code "déjà vendu"
    fastTiming();
    settings.setSetting("errors.stopCodes", "461");
    settings.setSetting("errors.maxConsecutiveFailures", 2);
    mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({});
    let serial = 0;
    mock.setMarket((n, c, p, makeItem) => ({ success: true, data: { items: [makeItem({ tradeId: `z${serial++}`, bin: 40000 })] } }));
    mock.setBid(() => ({ success: false, status: 461, error: { code: 461 } }));
    engine.startBot();
    await until(() => !engine.isRunning(), 3000);
    check(!engine.isRunning() && mock.calls.bid.length === 2, "code d'arrêt 461 respecté", mock.calls.bid.length);

    // relist : pas de boucle si la liste reste en cache
    fastTiming();
    settings.setSetting("transfer.relistExpired", true);
    const tmp = createMockEa();
    mock = createMockEa({ transferItems: [tmp.makeItem({ state: "expired" })] });
    setPageForTests(mock.page);
    setFilter({});
    engine.startBot();
    await until(() => mock.calls.search.length >= 8, 4000);
    await stopAndWait();
    check(mock.calls.relist === 1, "un seul relist (garde-fou de 5 min)", mock.calls.relist);

    // filtre sans joueur ni critère : jamais utilisé
    fastTiming();
    mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({ player: null, maxBuy: 45000 });
    check(engine.startBot() === false && mock.calls.search.length === 0, "filtre « tous les joueurs » sans critère refusé");
  }

  console.log("\n# recherche de test");
  {
    fastTiming();
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({ maxBuy: 45000 });
    mock.setMarket((n, c, p, makeItem) => ({ success: true, data: { items: [makeItem({ bin: 46000 }), makeItem({ bin: 44000 })] } }));
    const res = await engine.previewSearch(filters.getActiveFilter());
    check(res.ok && res.rows.length === 2 && res.rows[0].bin === 44000, "aperçu trié par prix, sans achat", res);
    check(mock.calls.bid.length === 0, "aucun achat pendant l'aperçu");
  }

  console.log("\n# démarrage refusé sans prix");
  {
    fastTiming();
    const mock = createMockEa();
    setPageForTests(mock.page);
    setFilter({ maxBuy: 0 });
    check(engine.startBot() === false && !engine.isRunning(), "refus explicite");
    check(logs().slice(-1)[0].includes("Prix d'achat max"), "message clair", logs().slice(-1));
  }

  console.log(`\n${passes} OK, ${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(2); });
