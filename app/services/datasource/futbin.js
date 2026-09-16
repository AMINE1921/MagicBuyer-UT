import { getFutShortYear } from "../../app.constants";
import { getCardName } from "../../utils/futItemUtil";
import { sendRequest } from "../../utils/networkUtil";
import { getUserPlatform } from "../../utils/userUtil";
import { getValue, setValue } from "../repository";
import {
  fetchFutbinViaIframe,
  looksLikeCloudflare,
  scrapePriceFromHtml,
} from "../../ui/futbinBridge";

const supportedConsumables = new Set(["Position", "Chemistry Style"]);
const HTML_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};
const JSON_HEADERS = {
  Accept: "application/json, text/plain, */*",
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isPlayerItem = (item) => {
  try {
    if (typeof item.isPlayer === "function") {
      return item.isPlayer();
    }
  } catch (e) {}
  if (item && (item.type === "player" || item.type === "Player")) {
    return true;
  }
  if (isTrainingItem(item)) {
    return false;
  }
  return !!(item && (item.definitionId || item.resourceId));
};

const isTrainingItem = (item) => {
  try {
    if (typeof item.isTraining === "function") {
      return item.isTraining();
    }
  } catch (e) {}
  return false;
};

const playerName = (item) => {
  try {
    const data =
      (typeof item.getStaticData === "function" && item.getStaticData()) ||
      item._staticData ||
      {};
    const name = data.knownAs && data.knownAs !== "---" ? data.knownAs : data.name;
    return String(name || item.lastName || "").trim();
  } catch (e) {
    return String((item && item.lastName) || "").trim();
  }
};

const playerRating = (item) => {
  try {
    if (typeof item.getRating === "function") {
      const rating = item.getRating();
      if (rating) {
        return rating;
      }
    }
  } catch (e) {}
  return item && item.rating;
};

const parseCoinText = (text) => {
  if (text == null || text === "") {
    return null;
  }
  if (typeof text === "number" && text > 0) {
    return Math.round(text);
  }
  const raw = String(text).replace(/\u00a0|\u202f/g, " ").trim();
  if (!raw || raw === "-" || raw === "---") {
    return null;
  }
  const withUnit = raw.replace(/,/g, ".").match(/^([\d.]+)\s*([KMB])$/i);
  if (withUnit) {
    let n = parseFloat(withUnit[1]);
    const unit = withUnit[2].toUpperCase();
    if (unit === "K") n *= 1000;
    if (unit === "M") n *= 1000000;
    if (unit === "B") n *= 1000000000;
    return n ? Math.round(n) : null;
  }
  const digits = parseInt(String(text).replace(/[^\d]/g, ""), 10);
  return digits || null;
};

const cachePrice = (definitionId, price, extra) => {
  if (!definitionId) {
    return;
  }
  const cacheValue = Object.assign(
    {
      expiryTimeStamp: Date.now() + (price ? 15 : 3) * 60 * 1000,
      price: price || 0,
      miss: !price,
    },
    extra || {}
  );
  setValue(`${definitionId}_futbin_price`, cacheValue);
};

const yearCandidates = () => Array.from(new Set([getFutShortYear(), "27", "26"]));

const gmGet = async (url, headers) => {
  try {
    return await sendRequest(
      url,
      "GET",
      `${Date.now()}_${url.slice(-48)}`,
      headers
    );
  } catch (e) {
    return null;
  }
};

const parseMaybeJson = (raw) => {
  if (!raw || looksLikeCloudflare(raw)) {
    return null;
  }
  if (typeof raw === "object") {
    return raw;
  }
  const text = String(raw).trim();
  if (!text || (text[0] !== "{" && text[0] !== "[")) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
};

const searchJsonToList = (json) => {
  if (!json) {
    return [];
  }
  if (Array.isArray(json)) {
    return json;
  }
  if (Array.isArray(json.data)) {
    return json.data;
  }
  if (Array.isArray(json.players)) {
    return json.players;
  }
  return [];
};

const rowRating = (row) =>
  parseInt(
    (row.ratingSquare && row.ratingSquare.rating) ||
      row.rating ||
      row.Player_Rating ||
      0,
    10
  );

const rowName = (row) =>
  String(row.full_name || row.name || row.text || row.playername || "").trim();

const rowClubId = (row) => {
  const url =
    row.clubImage &&
    row.clubImage.fixed &&
    row.clubImage.fixed.url &&
    (row.clubImage.fixed.url.day || row.clubImage.fixed.url);
  const src =
    (url && (url.image1x || url.image2x)) ||
    row.club ||
    row.club_id ||
    row.teamId ||
    "";
  const match = String(src).match(/clubs\/(?:light|dark)\/(\d+)/i);
  return match ? match[1] : String(src);
};

const rowFutbinId = (row) => row.id || row.page || row.player_id || row.ID;

const rowPrice = (row, platform) =>
  parseCoinText(
    row.ps_price ||
      row.pc_price ||
      row.xbox_price ||
      row.price ||
      (platform === "pc" ? row.pc : row.ps)
  );

const rowUrl = (row, year) => {
  const loc = row.location && row.location.url;
  if (loc) {
    return loc.startsWith("http") ? loc : `https://www.futbin.com${loc}`;
  }
  const id = rowFutbinId(row);
  if (!id) {
    return null;
  }
  const slug = encodeURIComponent(
    rowName(row)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "player"
  );
  return `https://www.futbin.com/${year}/player/${id}/${slug}`;
};

const matchSearchRow = (rows, item) => {
  const name = playerName(item).toLowerCase();
  if (!name) {
    return null;
  }
  const rating = Number(playerRating(item)) || 0;
  const teamId = item.teamId != null ? String(item.teamId) : "";
  const scored = rows
    .map((row) => {
      const n = rowName(row).toLowerCase();
      let score = 0;
      if (n === name || n.endsWith(" " + name) || n.split(" ").pop() === name) {
        score += 5;
      } else if (name.length > 3 && (n.includes(name) || name.includes(n))) {
        score += 2;
      }
      if (rating && rowRating(row) === rating) {
        score += 4;
      }
      if (teamId && rowClubId(row) === teamId) {
        score += 2;
      }
      return { row, score };
    })
    .filter((entry) => entry.score >= 5)
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].row : null;
};

const rowEaId = (row) => {
  const url =
    row.playerImage &&
    row.playerImage.fixed &&
    row.playerImage.fixed.url &&
    (row.playerImage.fixed.url.day || row.playerImage.fixed.url);
  const src = (url && (url.image1x || url.image2x)) || "";
  const match = String(src).match(/\/players\/(\d+)\./i);
  if (match) {
    return parseInt(match[1], 10);
  }
  const resource = row.resource_id || row.resourceId || row.base_id || row.baseId;
  return resource ? parseInt(resource, 10) : null;
};

export const searchPlayersByTerm = async (term) => {
  const name = String(term || "").trim();
  if (name.length < 2) {
    return [];
  }
  const query = encodeURIComponent(name);
  for (const year of yearCandidates()) {
    const url = `https://www.futbin.com/players/search?targetPage=PLAYER_PAGE&query=${query}&year=${year}&evolutions=false`;
    const json = parseMaybeJson(await gmGet(url, JSON_HEADERS));
    const rows = searchJsonToList(json);
    if (!rows.length) {
      continue;
    }
    return rows.slice(0, 12).map((row) => ({
      name: rowName(row),
      rating: rowRating(row),
      position: row.position || "",
      version: row.version || "",
      eaId: rowEaId(row),
      futbinId: rowFutbinId(row),
      url: rowUrl(row, year),
      club: (row.clubImage && row.clubImage.fixed && row.clubImage.fixed.name) || "",
    }));
  }
  return [];
};

const searchFutbinByName = async (item) => {
  const name = playerName(item);
  if (!name) {
    return null;
  }
  const query = encodeURIComponent(name);
  for (const year of yearCandidates()) {
    const url = `https://www.futbin.com/players/search?targetPage=PLAYER_PAGE&query=${query}&year=${year}&evolutions=false`;
    const json = parseMaybeJson(await gmGet(url, JSON_HEADERS));
    const rows = searchJsonToList(json);
    const match = matchSearchRow(rows, item);
    if (match) {
      return { year, match, url: rowUrl(match, year) };
    }
    await delay(200);
  }
  return null;
};

const priceFromBridgePayload = (payload, platform) => {
  if (!payload) {
    return null;
  }
  if (payload.kind === "page" && payload.price) {
    return payload.price;
  }
  if (payload.html) {
    return scrapePriceFromHtml(payload.html, platform).price;
  }
  return parseCoinText(payload.price);
};

const scrapePlayerPage = async (pageUrl, platform) => {
  if (!pageUrl) {
    return null;
  }
  const html = await gmGet(pageUrl, HTML_HEADERS);
  const scraped = scrapePriceFromHtml(html, platform);
  if (scraped && scraped.price) {
    return { price: scraped.price, pageUrl };
  }
  const bridged = await fetchFutbinViaIframe(pageUrl);
  const price = priceFromBridgePayload(bridged, platform);
  if (price) {
    return { price, pageUrl: (bridged && bridged.url) || pageUrl };
  }
  return null;
};

const resolveViaIframe = async (item, platform, pageUrl) => {
  const name = encodeURIComponent(playerName(item));
  const urls = [];
  if (pageUrl) {
    urls.push(pageUrl);
  }
  yearCandidates().forEach((year) => {
    if (name) {
      urls.push(
        `https://www.futbin.com/players/search?targetPage=PLAYER_PAGE&query=${name}&year=${year}&evolutions=false`
      );
    }
  });
  for (const url of urls) {
    const payload = await fetchFutbinViaIframe(url);
    const direct = priceFromBridgePayload(payload, platform);
    if (direct) {
      return { price: direct, pageUrl: (payload && payload.url) || url };
    }
    if (payload && payload.kind === "json") {
      const match = matchSearchRow(searchJsonToList(payload.json), item);
      if (match) {
        const next = rowUrl(match, getFutShortYear());
        const listed = rowPrice(match, platform);
        if (listed) {
          return { price: listed, pageUrl: next };
        }
        if (next && next !== url) {
          const page = await scrapePlayerPage(next, platform);
          if (page) {
            return page;
          }
        }
      }
    }
  }
  return null;
};

const fetchPrices = async (items) => {
  const result = new Map();
  const missingPlayers = [];
  const missingConsumables = new Map();

  for (const item of items) {
    if (!item.definitionId) {
      continue;
    }
    const priceDetail = getValue(`${item.definitionId}_futbin_price`);
    if (priceDetail && priceDetail.price) {
      result.set(`${item.definitionId}_futbin_price`, priceDetail.price);
    } else if (priceDetail && priceDetail.miss) {
      continue;
    } else if (isPlayerItem(item)) {
      missingPlayers.push(item);
    } else if (
      isTrainingItem(item) &&
      item._staticData &&
      supportedConsumables.has(item._staticData.name)
    ) {
      if (!missingConsumables.has(item._staticData.name)) {
        missingConsumables.set(item._staticData.name, []);
      }
      missingConsumables.get(item._staticData.name).push({
        definitionId: item.definitionId,
        subType: getCardName(item),
      });
    }
  }

  const pendingPromises = [];
  if (missingPlayers.length) {
    pendingPromises.push(fetchPlayerPrices(missingPlayers, result));
  }
  if (missingConsumables.size) {
    pendingPromises.push(fetchConsumablesPrices(missingConsumables, result));
  }
  await Promise.all(pendingPromises);
  return result;
};

const fetchPlayerPrices = async (players, result) => {
  const platform = getUserPlatform();
  const unique = [];
  const seen = new Set();
  players.forEach((item) => {
    const id = item.definitionId;
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    unique.push(item);
  });

  for (const item of unique) {
    try {
      const searched = await searchFutbinByName(item);
      let price = searched && rowPrice(searched.match, platform);
      let pageUrl = searched && searched.url;
      if (!price && pageUrl) {
        const scraped = await scrapePlayerPage(pageUrl, platform);
        if (scraped) {
          price = scraped.price;
          pageUrl = scraped.pageUrl;
        }
      }
      if (!price) {
        const bridged = await resolveViaIframe(item, platform, pageUrl);
        if (bridged) {
          price = bridged.price;
          pageUrl = bridged.pageUrl;
        }
      }
      cachePrice(item.definitionId, price, { pageUrl });
      if (price) {
        result.set(`${item.definitionId}_futbin_price`, price);
      } else {
        console.warn(
          "[MagicBuyer] FUTBIN introuvable",
          playerName(item),
          item.definitionId
        );
      }
    } catch (err) {
      console.warn("[MagicBuyer] FUTBIN joueur", playerName(item), err);
      cachePrice(item.definitionId, null);
    }
    await delay(350);
  }
};

const fetchConsumablesPrices = async (missingConsumables, result) => {
  const platform = getUserPlatform();
  const futBinPlatform =
    platform === "ps" ? "PS" : platform === "xbox" ? "XB" : "PC";
  const consumableTypes = Array.from(missingConsumables.keys());
  for (const consumableType of consumableTypes) {
    try {
      const category = consumableType.split(" ")[0];
      const futBinResponse = await sendRequest(
        `https://www.futbin.org/futbin/api/fetchConsumables?category=${category}&platformtype=${futBinPlatform}`,
        "GET",
        `${Math.floor(+new Date())}_fetchConsumablesPrices`
      );
      const priceResponse = JSON.parse(futBinResponse);
      const consumablesPriceLookUp = priceResponse.data.reduce((acc, curr) => {
        acc.set(curr.SubType.toUpperCase(), curr.LCPrice);
        return acc;
      }, new Map());
      const consumableCards = missingConsumables.get(consumableType) || [];
      for (const { definitionId, subType } of consumableCards) {
        const cardPrice = consumablesPriceLookUp.get(subType);
        const cacheKey = `${definitionId}_futbin_price`;
        if (cardPrice) {
          const cacheValue = {
            expiryTimeStamp: Date.now() + 15 * 60 * 1000,
            price: cardPrice,
          };
          setValue(cacheKey, cacheValue);
          result.set(cacheKey, cardPrice);
        }
      }
    } catch (err) {
      console.log(err);
    }
  }
};

export default {
  fetchPrices,
};
