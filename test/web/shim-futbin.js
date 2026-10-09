// Shim Tampermonkey (test local) + FUTBIN simulé (réponses au format FC 27 vérifié).
window.unsafeWindow = window;
window.GM_getValue = function (k, d) { var v = localStorage.getItem('gmtest.' + k); return v == null ? d : v; };
window.GM_setValue = function (k, v) { localStorage.setItem('gmtest.' + k, v); };
(function () {
  var cards = {
    231747: { futbinId: 8, name: "Kylian Mbappé", rating: 91, ps: 227000 },
    20801: { futbinId: 9, name: "Cristiano Ronaldo", rating: 86, ps: 31500 },
    209331: { futbinId: 10, name: "Mohamed Salah", rating: 89, ps: 48250 },
    50563992: { futbinId: 11, name: "Kylian Mbappé", rating: 93, ps: 1250000, special: true, version: "TOTW", club: "Real Madrid" },
    50563395: { futbinId: 12, name: "Kylian Mbappé", rating: 95, ps: 2400000, special: true, version: "TOTS", club: "Real Madrid" },
    239482: { futbinId: 587, name: "Galeno", rating: 81, ps: 700, club: "Al Ahli" },
    5001: { futbinId: 901, name: "Kaoru Mitoma", rating: 84, ps: 12500, jp: true },
    5002: { futbinId: 902, name: "Ritsu Doan", rating: 80, ps: 1100, jp: true },
    5003: { futbinId: 903, name: "Takefusa Kubo", rating: 86, ps: 21000, jp: true },
    5004: { futbinId: 904, name: "Junya Ito", rating: 79, ps: 900, jp: true },
    1009: { futbinId: 508, name: "Joueur 8", rating: 88, ps: 30000 },
    1001: { futbinId: 500, name: "Joueur 0", rating: 80, ps: 2000 },
  };
  window.__futbin = { cards: cards, requests: [], blocked: false };
  var fmt = function (n) { return Number(n).toLocaleString("en-US"); };
  var row = function (id, c) { var r = { id: c.futbinId, name: c.name, position: "ST", ratingSquare: { rating: String(c.rating) }, location: { url: "/27/player/" + c.futbinId + "/x" }, playerImage: { fixed: { url: { image1x: "https://cdn3.futbin.com/content/fifa27/img/players/" + (c.special ? "p" : "") + id + ".png" } } } }; if (c.version) r.version = c.version; if (c.club) r.clubImage = { name: c.club }; return r; };
  // Liste FUTBIN (lignes tr.player-row, format FC 27 réel) : joueurs japonais MG.
  var abbr = function (n) { if (n >= 1e6) return (Math.round(n / 1e4) / 100) + "M"; if (n >= 1000) return (Math.round(n / 10) / 100) + "K"; return String(n); };
  var listPage = function () {
    var rows = Object.keys(cards).filter(function (id) { return cards[id].jp; }).map(function (id) {
      var c = cards[id];
      var href = "/27/player/" + c.futbinId + "/x";
      return '<tr class="player-row text-nowrap"><td class="table-name"><a href="' + href + '" class="player-row-playercard"><div class="playercard-27 playercard-s" title="' + c.name + '"><img alt="" src="https://cdn3.futbin.com/content/fifa27/img/players/' + id + '.png" class="playercard-s-base-img"><div class="playercard-s-27-rating">' + c.rating + '</div></div></a>' +
        '<div class="table-player-info"><div><a href="' + href + '" class="table-player-name">' + c.name + '</a></div><div class="table-player-sub-info"><a class="table-player-club"><img alt="Club" src="c.png" title="Club ' + c.futbinId + '"></a><a class="table-player-nation"><img alt="Nation" src="n.png" title="Japan"></a></div><div class="table-player-revision">Normal</div></div></td>' +
        '<td class="table-rating"><div class="rating-square">' + c.rating + '</div></td><td class="table-item-score"><div>' + (c.rating * 3) + '</div></td><td class="table-pos"><div class="table-pos-main"><span>LM</span></div></td>' +
        '<td class="table-price no-wrap platform-ps-only"><div class="price">' + abbr(c.ps) + '</div></td><td class="table-price no-wrap platform-pc-only"><div class="price">' + abbr(Math.round(c.ps * 0.9 / 100) * 100) + '</div></td></tr>';
    }).join("");
    return '<html><body><table><tbody>' + rows + '</tbody></table></body></html>';
  };
  // Galerie FUTBIN : index, collection (JSON React), pages suivantes (POST).
  var galleryCard = function (id, c, points, tags, club) {
    return { id: String(c.futbinId), card: { cardname: c.name.split(" ").pop(), title: c.name, rating: String(c.rating), pos1: { position: "ST" }, itemScore: String(points), isHolographic: !!c.special,
      playerImages: Object.assign({ playerImage: { fixed: { url: { image1x: "https://cdn3.futbin.com/content/fifa27/img/players/" + (Number(id) & 0xffffff) + ".png" } } } }, c.special ? { playerSpecialImage: { fixed: { url: { image1x: "https://cdn3.futbin.com/content/fifa27/img/players/p" + id + ".png" } } } } : {}),
      clubImage: { image: { fixed: { name: "Real Madrid" } } }, nationImage: { fixed: { name: "France" } } },
      psPriceBox: { price: abbr(c.ps) }, pcPriceBox: { price: abbr(Math.round(c.ps * 0.9 / 100) * 100) }, points: points,
      tagFacts: { matchedTags: tags, league: 53, club: club || 243, nation: 18, player: Number(id) & 0xffffff } };
  };
  var galleryItems = [
    galleryCard(50563395, cards[50563395], 23750, ["23", "18"]),
    galleryCard(50563992, cards[50563992], 19000, ["23", "18"]),
    galleryCard(231747, cards[231747], 14000, ["23", "18"]),
    galleryCard(209331, cards[209331], 11000, ["23", "18"], 9),
    galleryCard(20801, cards[20801], 5500, ["23"], 45),
    galleryCard(239482, cards[239482], 830, ["18"]),
    galleryCard(5001, cards[5001], 1200, ["18"]),
    galleryCard(5003, cards[5003], 4100, ["23", "18"]),
    galleryCard(5002, cards[5002], 410, ["18"]),
    galleryCard(5004, cards[5004], 300, ["23", "18"]),
    galleryCard(1009, cards[1009], 2100, ["18"]),
    galleryCard(1001, cards[1001], 9000, ["23", "18"]),
  ];
  var galleryData = { eligible: { title: "Eligible", initialSort: "ItemScoreDesc", sortOptions: [{ sort: "ItemScoreDesc", label: "IS" }], searchLocation: { url: "/27/gallery/set-player-search/45" }, items: galleryItems.slice(0, 6), totalItems: galleryItems.length, itemsPerPage: 6 },
    goal: { tiers: [{ grade: "D", points: 10, rewards: [{ label: "Team Badge (Untradeable)" }] }, { grade: "C", points: 30000, rewards: [{ label: "Real Madrid Kit (Untradeable)" }] }, { grade: "B", points: 60000, rewards: [{ label: "50 Gallery Token" }] }] },
    limit: { maxItems: 5, requiresExactly: true },
    tagSpecs: [{ key: "23", name: "All out Attack", description: "Attacking positions", aggregation: "MatchCount", requiresFirstOwner: false, tiers: [{ requiredCount: 3, multiplier: 300, bonusText: "+3%" }] }, { key: "18", name: "Same Club", description: "Same club", aggregation: "LargestGroup", facet: "Club", requiresFirstOwner: false, tiers: [{ requiredCount: 4, multiplier: 500, bonusText: "+5%" }] }] };
  var gallerySet = '<html><body><h1 class="page-header-top">Real Madrid</h1><div data-react-type="futbin.frontenddata.components.collectionbuilder.CollectionBuilderData"><script type="application/json" data-react-data="">' + JSON.stringify(galleryData) + '</script></div></body></html>';
  var galleryIndex = function (onlyRarities) {
    var set = function (id, slug, name, players, tiers) {
      return '<div class="og-card-wrapper gallery-wrapper"><div class="og-card-wrapper-top"><a href="/27/gallery/set/' + id + '/' + slug + '">' + name + '</a></div><a href="/27/gallery/set/' + id + '/' + slug + '" class="gallery-set-body"><div class="gallery-set-logo"><img alt="Club" src="l.png"></div><div class="gallery-set-info-row"><span class="gallery-info-label">Players</span><span class="bold">' + players + '</span></div></a><details class="gallery-rewards"><div class="gallery-rewards-body">' +
        tiers.map(function (t) { return '<div class="gallery-rewards-grade"><div class="collection-grade-badge"><span>' + t[0] + '</span></div><div class="gallery-rewards-points"><span class="bold">' + t[1] + '</span></div><div class="gallery-reward-chip"><span>' + t[2] + '</span></div></div>'; }).join("") + '</div></details></div>';
    };
    var pills = '<a href="/27/gallery" class="og-pill ' + (onlyRarities ? 'og-pill-secondary' : 'og-pill-primary') + ' category-pill">All 3</a><a href="/27/gallery/7/laliga" class="og-pill og-pill-secondary category-pill">LALIGA EA SPORTS 2</a><a href="/27/gallery/6/rarities" class="og-pill ' + (onlyRarities ? 'og-pill-primary' : 'og-pill-secondary') + ' category-pill">Rarities 1</a>';
    var sets = onlyRarities ? set(123, "totw", "TOTW", 92, [["D", "10,000", "5 Gallery Token"], ["C", "125,000", "15 Gallery Token"]]) :
      set(45, "real-madrid", "Real Madrid", 11, [["D", "10", "Team Badge (Untradeable)"], ["C", "30,000", "Real Madrid Kit (Untradeable)"], ["B", "60,000", "50 Gallery Token"]]) + set(46, "fc-barcelona", "FC Barcelona", 70, [["D", "10", "Team Badge"], ["C", "80,000", "Kit"]]) + set(123, "totw", "TOTW", 92, [["D", "10,000", "5 Gallery Token"]]);
    return '<html><body><main class="gallerypage">' + pills + '<div class="gallery-grid">' + sets + '</div></main></body></html>';
  };
  var page = function (c) { return '<html><body><div class="player-card-item-score"><span class="item-score-segment">' + abbr(c.rating * 150) + '</span></div><div class="price-box platform-ps-only price-box-original-player"><div class="price lowest-price-1">' + fmt(c.ps) + '</div><div class="price lowest-price-2">' + fmt(c.ps + 500) + '</div><div>Updated 3 mins ago</div></div><div class="price-box platform-pc-only price-box-original-player"><div class="price lowest-price-1">' + fmt(Math.round(c.ps * 0.9)) + '</div></div></body></html>'; };
  var positions = ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "CAM", "RW", "ST", "LW"];
  var squadPage = '<html><body><select class="formation"><option value="4-3-3(4)" selected>4-3-3(4)</option></select><div class="pitch">' + positions.map(function (p, i) {
    return '<div class="card-slot"><a href="/27/player/' + (500 + i) + '/joueur-' + i + '"><div class="card"><img src="https://cdn3.futbin.com/content/fifa27/img/players/' + (1001 + i) + '.png"><div class="rating">' + (80 + i) + '</div><div class="position">' + p + '</div><div class="name">Joueur ' + i + '</div><div class="price">' + (20 + i) + ',000</div></div></a></div>';
  }).join("") + '</div></body></html>';
  window.GM_xmlhttpRequest = function (o) {
    var url = o.url;
    window.__futbin.requests.push(url);
    var reply = function (status, text) { setTimeout(function () { o.onload && o.onload({ status: status, responseText: text, response: text }); }, 150 + Math.random() * 150); };
    if (/futbin\.com/.test(url)) {
      if (window.__futbin.blocked) { reply(403, "<html><head><title>Just a moment...</title></head><body><div id='challenge-platform'></div></body></html>"); return; }
      var search = url.match(/\/players\/search\?.*query=([^&]+)/);
      if (search) {
        var q = decodeURIComponent(search[1]).toLowerCase();
        var rows = Object.keys(cards).filter(function (id) { return id === q || cards[id].name.toLowerCase().indexOf(q) >= 0; }).map(function (id) { return row(id, cards[id]); });
        reply(200, JSON.stringify(rows)); return;
      }
      var p = url.match(/\/27\/player\/(\d+)\//);
      if (p) { var id = Object.keys(cards).find(function (k) { return cards[k].futbinId === Number(p[1]); }); reply(id ? 200 : 404, id ? page(cards[id]) : "nf"); return; }
      if (/\/27\/squad\//.test(url)) { reply(200, squadPage); return; }
      if (/\/27\/players\?/.test(url)) { reply(200, /page=[2-9]/.test(url) ? "<html><body><table></table></body></html>" : listPage()); return; }
      if (/\/27\/gallery\/set-player-search\/45$/.test(url) && o.method === "POST") { var req = JSON.parse(o.data || "{}"); var from = ((req.page || 1) - 1) * 6; reply(200, JSON.stringify({ items: galleryItems.slice(from, from + 6), totalItems: galleryItems.length })); return; }
      if (/\/27\/gallery\/set\/45\//.test(url)) { reply(200, gallerySet); return; }
      if (/\/27\/gallery\/6\//.test(url)) { reply(200, galleryIndex(true)); return; }
      if (/\/27\/gallery(\/7\/[^/]+)?$/.test(url)) { reply(200, galleryIndex(false)); return; }
      reply(404, "nf"); return;
    }
    fetch(url, { method: o.method || 'GET', headers: o.headers, body: o.data })
      .then(function (r) { return r.text().then(function (t) { o.onload && o.onload({ status: r.status, responseText: t, response: t }); }); })
      .catch(function () { o.onload && o.onload({ status: 0, responseText: "" }); });
  };
})();

// Services EA en plus pour l'onglet Outils (packs, non attribués, équipe active) : faux, en mémoire.
(function () {
  var later = function (data, ms) { var o = new window.EAObservable(); setTimeout(function () { o.notify(data); }, ms == null ? 150 : ms); return o; };
  var unassigned = [];
  var mk = function (defId, name, rating, extra) { var it = window.__cardItem(defId, name, rating, extra); it.isDuplicate = function () { return !!(extra && extra.dup); }; it.discardValue = rating * 10; it.tradable = !(extra && extra.untradeable); it.isStorable = function () { return !it.tradable; }; it.owners = 1; it.lastSalePrice = extra && extra.paid || 0; return it; };
  var packs = [1, 2, 3].map(function (n) {
    return { id: 101, isMyPack: true, packName: "Pack Or premium", tradable: false, open: function () {
      var items = [mk(231747, "Mbappé", 91), mk(5002, "Doan", 80, { untradeable: true }), mk(5004, "Ito", 79, { untradeable: true, dup: true }), mk(209331, "Salah", 89)];
      unassigned = unassigned.concat(items);
      return later({ success: true, response: { items: items } });
    } };
  });
  window.services.Store = { getPacks: function () { return later({ success: true, response: { packs: packs.filter(function (p) { return !p.opened; }) } }); } };
  packs.forEach(function (p) { var open = p.open; p.open = function () { p.opened = true; return open(); }; });
  window.services.Item.requestUnassignedItems = function () { return later({ success: true, response: { items: unassigned.slice() } }); };
  var move = window.services.Item.move;
  window.services.Item.move = function (items, pile) { var list = Array.isArray(items) ? items : [items]; unassigned = unassigned.filter(function (it) { return list.indexOf(it) < 0; }); return later({ success: true, data: { itemIds: list.map(function (it) { return it.id; }) } }); };
  window.services.Item.discard = function (items) { var list = Array.isArray(items) ? items : [items]; unassigned = unassigned.filter(function (it) { return list.indexOf(it) < 0; }); return later({ success: true, data: { itemIds: list.map(function (it) { return it.id; }) } }); };
  window.services.Squad = { requestSquadByType: function () { return later({ success: true, data: { squad: { getPlayers: function () { return []; } } } }); } };
  window.PurchasePackType = { ALL: "all" };
  window.__unassigned = function () { return unassigned; };
})();

// Navigation EA simulée (EAView / EAViewController / pile d'écrans) et accueil avec la tuile Objectifs.
(function () {
  function EAView() { this.__root = null; }
  EAView.prototype.init = function () {};
  EAView.prototype.setEventDelegate = function () {};
  EAView.prototype.destroyGeneratedElements = function () {};
  EAView.prototype.dealloc = function () { this.destroyGeneratedElements(); };
  function EAViewController() { this.view = null; }
  EAViewController.prototype.init = function () { this.initialized = true; };
  EAViewController.prototype._getViewInstanceFromData = function () { return new EAView(); };
  EAViewController.prototype.getView = function () { if (!this.view) { this.view = this._getViewInstanceFromData(); this.view.setEventDelegate(this); this.view.init(); } return this.view; };
  EAViewController.prototype.getNavigationController = function () { return nav; };
  EAViewController.prototype.viewDidAppear = function () {};
  EAViewController.prototype.viewWillDisappear = function () {};
  window.EAView = EAView;
  window.EAViewController = EAViewController;
  var nav = {
    stack: [],
    setNavigationVisibility: function () {},
    pushViewController: function (c) { var top = this.stack[this.stack.length - 1]; if (top) top.viewWillDisappear(); this.stack.push(c); show(); },
    popViewController: function () { var c = this.stack.pop(); if (c) { c.viewWillDisappear(); var v = c.getView(); if (v && v.dealloc) v.dealloc(); } show(); },
  };
  window.__nav = nav;
  function show() {
    var host = document.querySelector(".fake-nav");
    if (!host) return;
    var top = nav.stack[nav.stack.length - 1];
    host.hidden = !top;
    document.querySelector(".fake-main").hidden = !!top;
    if (!top) return;
    host.querySelector(".fake-nav-title").textContent = top.getNavigationTitle ? top.getNavigationTitle() : "";
    var body = host.querySelector(".fake-nav-body");
    body.innerHTML = "";
    body.appendChild(top.getView().getRootElement());
    top.viewDidAppear();
  }
  var base = window.getAppMain;
  window.getAppMain = function () {
    var app = base ? base() : {};
    app.getRootViewController = function () { return { getPresentedViewController: function () { return { getCurrentViewController: function () { return { getCurrentController: function () { return { getNavigationController: function () { return nav; } }; } }; } }; } }; };
    return app;
  };
  window.UTHomeHubView = function () {};
  window.UTHomeHubView.prototype._generate = function () {};
  document.addEventListener("DOMContentLoaded", function () {
    var main = document.querySelector(".fake-main");
    var home = document.createElement("div");
    home.className = "fake-card";
    home.innerHTML = '<h2>Accueil (EA)</h2><div class="grid layout-hub fake-home"><div class="tile col-1-2 ut-tile-hub-objective"><header><h1 class="tileHeader">Objectifs</h1></header><div class="tileContent">…</div></div><div class="tile col-1-2 ut-tile-hub-sbc"><header><h1 class="tileHeader">DCE</h1></header><div class="tileContent">…</div></div></div>';
    main.insertBefore(home, main.firstChild);
    var navHost = document.createElement("section");
    navHost.className = "fake-nav";
    navHost.hidden = true;
    navHost.innerHTML = '<header class="fake-nav-head"><button type="button" class="fake-nav-back">‹ Retour</button><h1 class="fake-nav-title"></h1></header><div class="fake-nav-body"></div>';
    navHost.querySelector(".fake-nav-back").addEventListener("click", function () { nav.popViewController(); });
    main.parentNode.appendChild(navHost);
    var style = document.createElement("style");
    style.textContent = ".fake-home{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fake-home .tile,.mb-gallery-tile,.mb-gx .tile{background:rgba(255,255,255,.07);border-radius:8px;padding:10px;min-height:90px}.fake-nav{flex:1;display:flex;flex-direction:column;height:100vh}.fake-nav[hidden]{display:none}.fake-nav-head{display:flex;gap:12px;align-items:center;padding:12px 20px;background:#07111f}.fake-nav-head h1{font-size:18px;margin:0}.fake-nav-back{background:none;border:1px solid #fff4;color:#fff;border-radius:6px;padding:6px 10px}.fake-nav-body{flex:1;min-height:0;overflow:auto}.btn-standard{background:#1d2b3d;color:#fff;border:0;border-radius:6px;padding:8px 12px;cursor:pointer}.btn-standard.primary{background:#2fd6b0;color:#051b15}.btn-standard.mini{padding:4px 8px;font-size:12px}";
    document.head.appendChild(style);
  });
})();

// Cartes et logos EA simulés (aperçu local) : le vrai web app fournit UTItemViewFactory et AssetLocationUtils.
(function () {
  var later = function (data, ms) { var o = new window.EAObservable(); setTimeout(function () { o.notify(data); }, ms == null ? 200 : ms); return o; };
  window.UIThemeVariation = { DARK: "dark", LIGHT: "light" };
  window.AssetLocationUtils = {
    getBadgeImageUri: function (id) { return "https://cdn3.futbin.com/content/fifa27/img/clubs/dark/" + id + ".png"; },
    getLeagueImageUri: function (id) { return "https://cdn3.futbin.com/content/fifa27/img/league/dark/" + id + ".png"; },
    getFlagImageUri: function (id) { return "https://cdn3.futbin.com/content/fifa27/img/nation/" + id + ".png"; },
  };
  var names = window.__futbin.cards;
  // Objets EA créés par la fabrique du web app (champ isCollected du serveur) : quelques cartes déjà collectées.
  var collected = { 50563992: true, 209331: true, 5003: true, 1001: true };
  window.UTItemEntityFactory = function () {};
  window.UTItemEntityFactory.prototype.createItem = function (raw) {
    var c = names[raw.resourceId] || { name: "Joueur", rating: 80 };
    var it = window.__cardItem(raw.resourceId, c.name, c.rating);
    it.concept = true;
    it.sbsScore = raw.sbsScore || 0;
    return it;
  };
  var factory = new window.UTItemEntityFactory();
  window.services.Item.searchConceptItems = function (criteria) {
    var all = Array.from(criteria.defId).map(function (id) { return factory.createItem({ resourceId: id, isCollected: !!collected[id] }); });
    var from = criteria.offset || 0;
    var count = criteria.count || all.length;
    return later({ success: true, response: { items: all.slice(from, from + count), endOfList: from + count >= all.length } });
  };
  window.repositories.Item.getStaticData = function () {
    return Object.keys(names).map(function (id) { return { id: Number(id) & 0xffffff }; }).values();
  };
  window.services.EventToken = { repository: { _definitions: [] } };
  window.UTClubHubView = function () {};
  window.UTClubHubView.prototype._generate = function () {};
  window.UTItemViewFactory = {
    createSmallItem: function (item) {
      var root = document.createElement("div");
      root.className = "fake-ea-card";
      var special = item.definitionId > 16777215;
      root.style.cssText = "width:78px;height:108px;border-radius:9px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:6px;color:#1b1203;font-weight:800;box-shadow:0 6px 16px rgba(0,0,0,.45);background:" + (special ? "linear-gradient(160deg,#5a3fd6,#1d1147)" : "linear-gradient(160deg,#f0d77e,#9a7424)") + ";" + (special ? "color:#fff;" : "");
      root.innerHTML = '<img src="https://cdn3.futbin.com/content/fifa27/img/players/' + (item.definitionId & 0xffffff) + '.png" style="width:64px;height:64px;object-fit:contain" alt=""><div style="font-size:11px">' + item.rating + " · " + (item._staticData.name || "").split(" ").pop() + "</div>";
      return { init: function () {}, render: function () {}, dealloc: function () {}, getRootElement: function () { return root; } };
    },
  };
})();
