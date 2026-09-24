import {
  getFutGuid,
  getFutResourceBase,
  getFutResourceRoot,
  getFutYear,
} from "../../app.constants";
import { sendRequest } from "../../utils/networkUtil";
import { getPage } from "../../core/page";

let catalogPromise = null;
let catalog = null;

const norm = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokens = (value) => norm(value).split(" ").filter(Boolean);

export const getEaPlayersJsonUrl = () => {
  const page = getPage();
  const root = (page && page.fut_resourceRoot) || getFutResourceRoot();
  const base = (page && page.fut_resourceBase) || getFutResourceBase();
  const guid = (page && page.fut_guid) || getFutGuid();
  const year = (page && page.fut_year) || getFutYear();
  return `${root}${base}${guid}/${year}/fut/items/web/players.json`;
};

const mapRow = (row) => {
  if (!row || row.id == null) {
    return null;
  }
  const firstName = row.f || row.firstName || "";
  const lastName = row.l || row.lastName || "";
  const common = row.c || row.commonName || "";
  const name = common || `${firstName} ${lastName}`.trim();
  return {
    eaId: Number(row.id) || 0,
    name,
    firstName,
    lastName,
    commonName: common,
    rating: Number(row.r || row.rating) || 0,
  };
};

const flattenCatalog = (json) => {
  const rows = [];
  if (!json || typeof json !== "object") {
    return rows;
  }
  Object.keys(json).forEach((key) => {
    const list = json[key];
    if (!Array.isArray(list)) {
      return;
    }
    list.forEach((row) => {
      const mapped = mapRow(row);
      if (mapped && mapped.eaId) {
        rows.push(mapped);
      }
    });
  });
  return rows;
};

const parseCatalog = (raw) => {
  if (!raw) {
    return [];
  }
  if (typeof raw === "object") {
    return flattenCatalog(raw);
  }
  const text = String(raw);
  const start = text.indexOf("{");
  if (start < 0) {
    return [];
  }
  try {
    return flattenCatalog(JSON.parse(text.slice(start)));
  } catch (e) {
    return [];
  }
};

const withTimeout = (task, ms) =>
  Promise.race([
    task,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);

const fetchViaPage = async (url) => {
  const page = getPage();
  const fetchFn = (page && page.fetch) || fetch;
  if (typeof fetchFn !== "function") {
    return null;
  }
  const res = await withTimeout(
    fetchFn.call(page || window, url, {
      credentials: "include",
      cache: "force-cache",
    }),
    10000
  );
  if (!res || !res.ok) {
    return null;
  }
  return withTimeout(res.json(), 10000);
};

export const loadEaPlayersCatalog = async (force) => {
  if (catalog && !force) {
    return catalog;
  }
  if (catalogPromise && !force) {
    return catalogPromise;
  }
  catalogPromise = (async () => {
    const url = getEaPlayersJsonUrl();
    let rows = [];
    try {
      rows = parseCatalog(await fetchViaPage(url));
    } catch (e) {}
    if (!rows.length) {
      try {
        rows = parseCatalog(
          await withTimeout(
            sendRequest(url, "GET", `eaPlayers_${Date.now()}`),
            12000
          )
        );
      } catch (e) {}
    }
    catalog = rows;
    return catalog;
  })();
  try {
    return await catalogPromise;
  } finally {
    if (!catalog || !catalog.length) {
      catalogPromise = null;
    }
  }
};

export const searchEaPlayersByTerm = async (term, limit = 12) => {
  const rows = await loadEaPlayersCatalog();
  const query = norm(term);
  if (!rows.length || !query || query.length < 2) {
    return [];
  }
  const queryTokens = tokens(term);
  return rows
    .map((row) => {
      const full = norm(row.name);
      const last = norm(row.lastName);
      const first = norm(row.firstName);
      const common = norm(row.commonName);
      let score = 0;
      if (full === query || common === query || last === query) {
        score += 16;
      } else if (full.startsWith(query) || last.startsWith(query) || common.startsWith(query)) {
        score += 10;
      } else if (full.includes(query) || last.includes(query) || common.includes(query)) {
        score += 6;
      }
      if (queryTokens.every((token) => full.includes(token) || last.includes(token) || first.includes(token))) {
        score += 4;
      }
      return { row, score };
    })
    .filter((entry) => entry.score >= 4)
    .sort((a, b) => b.score - a.score || b.row.rating - a.row.rating)
    .slice(0, limit)
    .map((entry) => entry.row);
};

export const getPlayersByRating = async (rating, limit = 20) => {
  const rows = await loadEaPlayersCatalog();
  const note = Number(rating) || 0;
  if (!note) {
    return [];
  }
  return rows.filter((row) => row.rating === note).slice(0, limit);
};

export const lookupEaPlayer = async ({ name, rating, eaId } = {}) => {
  const id = Number(eaId) || 0;
  const rows = await loadEaPlayersCatalog();
  if (!rows.length) {
    return null;
  }
  if (id) {
    const exact = rows.find((row) => row.eaId === id);
    if (exact) {
      return exact;
    }
  }
  const query = norm(name);
  if (!query) {
    return null;
  }
  const queryTokens = tokens(name);
  const last = queryTokens[queryTokens.length - 1];
  const first = queryTokens[0];
  const rated = Number(rating) || 0;
  let best = null;
  let bestScore = 0;
  rows.forEach((row) => {
    const full = norm(row.name);
    const lastName = norm(row.lastName);
    const firstName = norm(row.firstName);
    const common = norm(row.commonName);
    let score = 0;
    if (full === query || common === query) {
      score += 12;
    }
    if (last && lastName === last) {
      score += 8;
    }
    if (first && firstName === first) {
      score += 5;
    }
    if (first && firstName.startsWith(first)) {
      score += 2;
    }
    if (queryTokens.length === 1 && (lastName === query || common === query)) {
      score += 6;
    }
    if (rated && row.rating === rated) {
      score += 4;
    } else if (rated && Math.abs(row.rating - rated) <= 1) {
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  });
  return bestScore >= 8 ? best : null;
};

export const playerNameOf = (item) => {
  try {
    const data =
      (item && typeof item.getStaticData === "function" && item.getStaticData()) ||
      (item && item._staticData) ||
      {};
    const known = data.knownAs && data.knownAs !== "---" ? data.knownAs : "";
    return String(
      known || data.name || data.lastName || (item && item.lastName) || ""
    ).trim();
  } catch (e) {
    return String((item && item.lastName) || "").trim();
  }
};

export const sameEaPlayerId = (left, right) => {
  const a = Number(left) || 0;
  const b = Number(right) || 0;
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  return a % 16777216 === b % 16777216;
};

export const namesMatchPlayer = (itemName, selectedName) => {
  const item = tokens(itemName);
  const selected = tokens(selectedName);
  if (!item.length || !selected.length) {
    return false;
  }
  if (norm(itemName) === norm(selectedName)) {
    return true;
  }
  const itemLast = item[item.length - 1];
  const selectedLast = selected[selected.length - 1];
  if (itemLast !== selectedLast) {
    return false;
  }
  if (selected.length === 1 || item.length === 1) {
    return true;
  }
  return item[0] === selected[0] || item[0].startsWith(selected[0][0]);
};
