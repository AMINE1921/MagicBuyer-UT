// Faux web app EA FC 27 : reproduit les comportements lus dans le code d'EA.
export const createMockEa = (opts = {}) => {
  const calls = { search: [], bid: [], list: [], move: [], transfer: 0, relist: 0, clearSold: 0, watch: 0, refresh: 0, untarget: 0, marketData: 0, clearCache: 0, currencies: 0 };
  const latency = opts.latency || 5;
  class EAObservable {
    constructor() { this._observers = []; }
    observe(scope, cb) { this._observers.push({ scope, cb }); return this; }
    unobserve(scope) { this._observers = this._observers.filter((o) => o.scope !== scope); return this; }
    notify(data) { setTimeout(() => this._observers.slice().forEach((o) => o.cb.call(o.scope, this, data)), 0); return this; }
  }
  const later = (data, ms = latency) => { const obs = new EAObservable(); setTimeout(() => obs.notify(data), ms); return obs; };
  // UTSearchCriteriaDTO : le setter "type" remet nation à -1 (comme FC 27)
  class UTSearchCriteriaDTO {
    constructor() {
      Object.assign(this, { _type: "any", category: "any", position: "any", zone: -1, level: "any", rarities: [], defId: [], maskedDefId: 0, nation: -1, league: -1, club: -1, playStyle: -1, minBid: 0, maxBid: 0, minBuy: 0, maxBuy: 0, offset: 0, count: 20, authenticity: "any" });
    }
    get type() { return this._type; }
    set type(v) { if (v === this._type) return; this._type = v; this.nation = -1; }
  }
  let coins = opts.coins == null ? 100000 : opts.coins;
  let nextTradeId = 1000;
  const auctionProto = {
    isSold() { return this._state === "sold"; },
    isExpired() { return this._state === "expired"; },
    isSelling() { return this._state === "selling"; },
    isWon() { return this._state === "won"; },
    isOutbid() { return this._bidState === "outbid"; },
    isActiveTrade() { return this._state === "active"; },
    isClosedTrade() { return this._state === "closed" || this._state === "won"; },
  };
  const makeItem = (spec) => {
    const auction = Object.assign(Object.create(auctionProto), { tradeId: String(spec.tradeId || nextTradeId++), buyNowPrice: spec.bin || 0, currentBid: spec.bid || 0, startingBid: spec.start || 150, expires: spec.expires == null ? 3500 : spec.expires, tradeOwner: !!spec.own, _state: spec.state || "active", _bidState: spec.bidState || "none" });
    return {
      id: spec.id || Math.floor(Math.random() * 1e9),
      definitionId: spec.definitionId || 231747,
      rating: spec.rating || 91,
      type: "player",
      _staticData: { name: spec.name || "Mbappé" },
      pile: spec.pile || 6,
      getAuctionData() { return auction; },
      isGK() { return !!spec.gk; },
      isPlayer() { return true; },
      hasPriceLimits() { return !!this._limits; },
      getPriceLimits() { return this._limits; },
      ...(spec.extra || {}),
    };
  };
  let marketQueue = opts.market || (() => ({ success: true, data: { items: [] } }));
  let bidHandler = opts.bid || ((item, price) => ({ success: true, response: { coins: coins - price } }));
  let listHandler = opts.list || (() => ({ success: true, response: { auctionIds: [1] } }));
  const transferItems = opts.transferItems || [];
  const services = {
    Item: {
      clearTransferMarketCache() { calls.clearCache++; },
      searchTransferMarket(criteria, page) {
        calls.search.push({ at: Date.now(), page, criteria: { type: criteria.type, maskedDefId: criteria.maskedDefId, defId: criteria.defId.slice(), maxBuy: criteria.maxBuy, minBuy: criteria.minBuy, maxBid: criteria.maxBid, minBid: criteria.minBid, nation: criteria.nation, level: criteria.level, position: criteria.position, zone: criteria.zone, playStyle: criteria.playStyle } });
        const res = marketQueue(calls.search.length, criteria, page, makeItem);
        return later(res);
      },
      bid(item, price) {
        calls.bid.push({ at: Date.now(), tradeId: item.getAuctionData().tradeId, price });
        const res = bidHandler(item, price, calls.bid.length);
        if (res.success && res.response && res.response.coins != null) coins = res.response.coins;
        return later(res, latency);
      },
      list(item, start, bin, duration) { calls.list.push({ start, bin, duration, name: item._staticData.name }); return later(listHandler(item, calls.list.length)); },
      move(item, pile) { calls.move.push({ pile }); return later({ success: true, data: { itemIds: [item.id] } }); },
      requestTransferItems() { calls.transfer++; return later({ success: true, response: { items: transferItems } }); },
      relistExpiredAuctions() { calls.relist++; return later({ success: true, response: {} }); },
      clearSoldItems() { calls.clearSold++; for (let i = transferItems.length - 1; i >= 0; i--) { if (transferItems[i].getAuctionData().isSold()) transferItems.splice(i, 1); } return later({ success: true }); },
      requestWatchedItems() { calls.watch++; return later({ success: true, response: { items: opts.watchItems ? opts.watchItems() : [] } }); },
      refreshAuctions() { calls.refresh++; return later({ success: true }); },
      untarget() { calls.untarget++; return later({ success: true }); },
      requestMarketData(item) { calls.marketData++; item._limits = opts.limits || { minimum: 10000, maximum: 200000 }; return later({ success: true }); },
    },
    User: {
      getUser() { return { coins: { get amount() { return coins; } }, getSelectedPersona() { return { isPC: false }; } }; },
      requestCurrencies() { calls.currencies++; return later({ success: true }); },
    },
    Notification: { queue() {} },
  };
  const repositories = { Item: { isPileFull: () => !!opts.transferFull, getPileSize: () => 100, numItemsInCache: () => 0 } };
  const page = {
    services, repositories, UTSearchCriteriaDTO,
    ItemPile: { TRANSFER: 5, PURCHASED: 6, CLUB: 7, INBOX: 8 },
    UtasErrorCode: { CAPTCHA_REQUIRED: 458, PERMISSION_DENIED: 461, NO_TRADE_EXISTS: 478, LOCKED_TRANSFER_MARKET: 494, NOT_ENOUGH_CREDIT: 470, DESTINATION_FULL: 473, ACCOUNT_BANNED: 20000, UNRECOVERABLE: 20004 },
    UTCurrencyInputControl: { PRICE_TIERS: [{ min: 1e5, inc: 1e3 }, { min: 5e4, inc: 500 }, { min: 1e4, inc: 250 }, { min: 1e3, inc: 100 }, { min: 150, inc: 50 }, { min: 0, inc: 150 }] },
    AUCTION_MAX_BID: 15000000,
  };
  return { page, calls, makeItem, setMarket: (fn) => { marketQueue = fn; }, setBid: (fn) => { bidHandler = fn; }, setList: (fn) => { listHandler = fn; }, getCoins: () => coins, setCoins: (v) => { coins = v; } };
};
