export const MAX_CLUB_SEARCH = 90;
export const MAX_MARKET_SEARCH = 20;

export const DEFAULT_FUT_YEAR = "2027";
export const DEFAULT_FUT_GUID = "27A3C9F1-6B2E-4D7A-8C1F-2E9B5A4D6C7E";
export const DEFAULT_FUT_RESOURCE_ROOT = "https://www.ea.com";
export const DEFAULT_FUT_RESOURCE_BASE =
  "/ea-sports-fc/ultimate-team/web-app/content/";

const pageOrWindow = () => {
  try {
    if (typeof unsafeWindow !== "undefined" && unsafeWindow) {
      return unsafeWindow;
    }
  } catch (e) {}
  return typeof window !== "undefined" ? window : {};
};

export const getFutYear = () => pageOrWindow().fut_year || DEFAULT_FUT_YEAR;

export const getFutGuid = () => pageOrWindow().fut_guid || DEFAULT_FUT_GUID;

export const getFutResourceRoot = () =>
  pageOrWindow().fut_resourceRoot || DEFAULT_FUT_RESOURCE_ROOT;

export const getFutResourceBase = () =>
  pageOrWindow().fut_resourceBase || DEFAULT_FUT_RESOURCE_BASE;

export const getFutShortYear = () => String(getFutYear()).slice(-2);

export const getPortraitUrl = (playerId) =>
  `${getFutResourceRoot()}${getFutResourceBase()}${getFutGuid()}/${getFutYear()}/fut/items/images/mobile/portraits/${playerId}.png`;

export const STATE_ACTIVE = "Active";
export const STATE_PAUSED = "Paused";
export const STATE_STOPPED = "Stopped";

export const errorCodeLookUp = {
  521: "Request Rejected",
  512: "Request Rejected",
  429: "Too many request from this user",
  426: "Other user won the (card / bid)",
  461: "Other user won the (card / bid)",
};

export const defaultBuyerSetting = {
  idBuyFutBinPercent: 92,
  idAbCardCount: 1000,
  idAbCardCountisDefaultValue: true,
  idAbItemExpiring: "1H",
  idAbItemExpiringisDefaultValue: true,
  idAbSearchResult: 21,
  idAbSearchResultisDefaultValue: true,
  idSellFutBinPercent: "108-112",
  idFutBinDuration: "1H",
  idFutBinDurationisDefaultValue: true,
  idAbMinDeleteCount: 10,
  idSellRatingThreshold: 100,
  idSellRatingThresholdisDefaultValue: true,
  idAbMinRating: 10,
  idAbMinRatingisDefaultValue: true,
  idAbMaxRating: 100,
  idAbMaxRatingisDefaultValue: true,
  idAbMaxSearchPage: 5,
  idAbMaxSearchPageisDefaultValue: true,
  idAbRandMinBidInput: 300,
  idAbRandMinBidInputisDefaultValue: true,
  idAbRandMinBuyInput: 300,
  idAbRandMinBuyInputisDefaultValue: true,
  idBuyFutBinPrice: true,
  idSellFutBinPrice: true,
  idSellCheckBuyPrice: true,
  idAbSellToggle: false,
  idAbRandMinBidToggle: false,
  idAbRandMinBuyToggle: false,
};

export const defaultCommonSetting = {
  idAbAddBuyDelay: true,
  idAbCycleAmount: "12-18",
  idAbDelayToAdd: "3S",
  idAbMaxPurchases: 1,
  idAbNumberFilterSearch: 3,
  idAbNumberFilterSearchisDefaultValue: true,
  idAbPauseFor: "20-40S",
  idAbSoundToggle: true,
  idAbStopAfter: "1-2H",
  idAbStopErrorCodeCount: 3,
  idAbWaitTime: "8-12",
  idAbWaitTimeisDefaultValue: false,
  idAutoClearExpired: true,
  idAutoClearLog: true,
  idAbOverSearchWarning: true,
};

export const isMarketAlertApp = !!window.ReactNativeWebView;
