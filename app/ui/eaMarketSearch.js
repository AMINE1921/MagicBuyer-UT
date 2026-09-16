import { searchPlayersByTerm } from "../services/datasource/futbin";
import { getValue, setValue } from "../services/repository";
import { getMarketSearchFiltersViewController } from "../utils/eaCompat";
import { getPageWindow, syncPageGlobals } from "../utils/pageWindow";
import { sanitizeEaSearchCriteria } from "./buyerContext";

const POSITIONS = [
  ["any", "Tous"],
  ["GK", "GB"],
  ["LB", "DG"],
  ["CB", "DC"],
  ["RB", "DD"],
  ["LWB", "AG"],
  ["RWB", "AD"],
  ["CDM", "MDC"],
  ["CM", "MC"],
  ["CAM", "MOC"],
  ["LM", "MG"],
  ["RM", "MD"],
  ["LW", "AG (ailier)"],
  ["RW", "AD (ailier)"],
  ["CF", "AT"],
  ["ST", "BU"],
];

const RARITIES = [
  ["any", "Toutes"],
  ["bronze", "Bronze"],
  ["silver", "Argent"],
  ["gold", "Or"],
  ["special", "Spéciale"],
];

const debounce = (fn, wait) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

const num = (value) => {
  const n = parseInt(String(value || "").replace(/[^\d-]/g, ""), 10);
  return n > 0 ? n : 0;
};

const selectedPlayer = () => getValue("lastSearchPlayer") || null;

const readReplica = (root) => {
  const player = selectedPlayer();
  return sanitizeEaSearchCriteria({
    type: "player",
    maskedDefId: player && player.eaId,
    level: (root.querySelector("#mb-f-rarity") || {}).value || "any",
    position: (root.querySelector("#mb-f-position") || {}).value || "any",
    playStyle: Number((root.querySelector("#mb-f-style") || {}).value) || -1,
    minBid: num((root.querySelector("#mb-f-min-bid") || {}).value),
    maxBid: num((root.querySelector("#mb-f-max-bid") || {}).value),
    minBuy: num((root.querySelector("#mb-f-min-buy") || {}).value),
    maxBuy: num((root.querySelector("#mb-f-max-buy") || {}).value),
    nationality: num((root.querySelector("#mb-f-nation") || {}).value) || -1,
    league: num((root.querySelector("#mb-f-league") || {}).value) || -1,
    club: num((root.querySelector("#mb-f-club") || {}).value) || -1,
  });
};

const storeCriteria = (criteria) => {
  if (!criteria) {
    return criteria;
  }
  setValue("lastSearchCriteria", criteria);
  const instance = getValue("AutoBuyerInstance");
  if (instance && instance.viewmodel) {
    instance.viewmodel.searchCriteria = criteria;
  }
  return criteria;
};

export const syncMarketCriteria = () => {
  const instance = getValue("AutoBuyerInstance");
  const vm = instance && (instance.viewmodel || instance._viewmodel);
  if (vm && vm.searchCriteria && !getValue("mbUsingReplicaSearch")) {
    return storeCriteria(sanitizeEaSearchCriteria(vm.searchCriteria));
  }
  const replica = document.getElementById("mb-replica-search");
  if (replica) {
    return storeCriteria(readReplica(replica));
  }
  return getValue("lastSearchCriteria");
};

const tryMountNative = (host) => {
  syncPageGlobals();
  const page = getPageWindow();
  const Parent =
    getMarketSearchFiltersViewController() ||
    page.UTMarketSearchFiltersViewController ||
    window.UTMarketSearchFiltersViewController;
  if (typeof Parent !== "function") {
    return false;
  }
  let ctrl;
  try {
    ctrl = new Parent();
    if (typeof ctrl.init === "function") {
      ctrl.init();
    }
  } catch (e) {
    console.warn("[MagicBuyer] init recherche EA", e);
    return false;
  }
  const view = typeof ctrl.getView === "function" ? ctrl.getView() : ctrl.view;
  const node =
    (view && (view.__root || view._root)) ||
    (view && typeof view.getRootElement === "function" && view.getRootElement());
  if (!node || !node.querySelector) {
    return false;
  }
  if (
    !node.querySelector(
      ".ut-item-search-view, .search-prices, .ut-pinned-list, input"
    )
  ) {
    return false;
  }
  node.classList.add("mb-ea-native");
  host.innerHTML = "";
  host.appendChild(node);
  setValue("AutoBuyerInstance", ctrl);
  setValue("mbUsingReplicaSearch", false);
  return true;
};

const replicaMarkup = () => `
  <div id="mb-replica-search" class="mb-market-grid">
    <article class="mb-tile">
      <h3>Nom</h3>
      <div class="mb-target-search">
        <input id="mb-f-name" type="search" autocomplete="off" placeholder="Joueur…" />
        <div id="mb-f-results" class="mb-target-results" hidden></div>
      </div>
      <div id="mb-f-selected" class="mb-tile-value">Tous</div>
    </article>
    <article class="mb-tile">
      <h3>Rareté</h3>
      <select id="mb-f-rarity">${RARITIES.map(
        ([value, label]) => `<option value="${value}">${label}</option>`
      ).join("")}</select>
    </article>
    <article class="mb-tile">
      <h3>Poste</h3>
      <select id="mb-f-position">${POSITIONS.map(
        ([value, label]) => `<option value="${value}">${label}</option>`
      ).join("")}</select>
    </article>
    <article class="mb-tile">
      <h3>Styles de jeu</h3>
      <select id="mb-f-style">
        <option value="-1">Tous</option>
      </select>
    </article>
    <article class="mb-tile mb-tile-wide">
      <h3>Prix</h3>
      <div class="mb-price-grid">
        <label>Prix min.<input id="mb-f-min-bid" type="number" min="0" step="50" placeholder="Tous" /></label>
        <label>Prix max.<input id="mb-f-max-bid" type="number" min="0" step="50" placeholder="Tous" /></label>
        <label>Min. achat imm.<input id="mb-f-min-buy" type="number" min="0" step="50" placeholder="Tous" /></label>
        <label>Max. achat imm.<input id="mb-f-max-buy" type="number" min="0" step="50" placeholder="Tous" /></label>
      </div>
    </article>
    <article class="mb-tile">
      <h3>Pays / région</h3>
      <input id="mb-f-nation" type="number" min="0" placeholder="Tous (ID EA)" />
    </article>
    <article class="mb-tile">
      <h3>Championnat</h3>
      <input id="mb-f-league" type="number" min="0" placeholder="Tous (ID EA)" />
    </article>
    <article class="mb-tile">
      <h3>Club</h3>
      <input id="mb-f-club" type="number" min="0" placeholder="Tous (ID EA)" />
    </article>
  </div>
`;

const bindReplica = (root) => {
  setValue("mbUsingReplicaSearch", true);
  const nameInput = root.querySelector("#mb-f-name");
  const results = root.querySelector("#mb-f-results");
  const selected = root.querySelector("#mb-f-selected");
  const paintSelected = () => {
    const player = selectedPlayer();
    if (selected) {
      selected.textContent = player
        ? `${player.name} ${player.rating || ""}`.trim()
        : "Tous";
    }
  };
  const runSearch = debounce(async () => {
    const term = nameInput && nameInput.value;
    if (!results) {
      return;
    }
    if (!term || term.trim().length < 2) {
      results.hidden = true;
      results.innerHTML = "";
      return;
    }
    const players = await searchPlayersByTerm(term.trim());
    results.innerHTML = "";
    results.hidden = !players.length;
    players.forEach((player) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mb-target-hit";
      btn.innerHTML = `<span class="mb-hit-rating">${player.rating || "—"}</span>
        <span class="mb-hit-meta"><strong>${player.name}</strong>
        <small>${[player.position, player.club].filter(Boolean).join(" · ")}</small></span>`;
      btn.addEventListener("click", () => {
        setValue("lastSearchPlayer", player);
        if (nameInput) {
          nameInput.value = player.name;
        }
        results.hidden = true;
        paintSelected();
        syncMarketCriteria();
      });
      results.appendChild(btn);
    });
  }, 280);
  if (nameInput) {
    nameInput.addEventListener("input", runSearch);
  }
  root.querySelectorAll("input, select").forEach((el) => {
    if (el.id === "mb-f-name") {
      return;
    }
    el.addEventListener("change", syncMarketCriteria);
  });
  const player = selectedPlayer();
  if (player && nameInput) {
    nameInput.value = player.name || "";
  }
  paintSelected();
  const criteria = getValue("lastSearchCriteria") || {};
  const map = [
    ["mb-f-rarity", criteria.level],
    ["mb-f-position", criteria.position],
    ["mb-f-style", criteria.playStyle],
    ["mb-f-min-bid", criteria.minBid],
    ["mb-f-max-bid", criteria.maxBid],
    ["mb-f-min-buy", criteria.minBuy],
    ["mb-f-max-buy", criteria.maxBuy],
    ["mb-f-nation", criteria.nationality > 0 ? criteria.nationality : ""],
    ["mb-f-league", criteria.league > 0 ? criteria.league : ""],
    ["mb-f-club", criteria.club > 0 ? criteria.club : ""],
  ];
  map.forEach(([id, value]) => {
    const el = root.querySelector(`#${id}`);
    if (el && value != null && value !== "" && value !== "any" && value !== -1) {
      el.value = value;
    }
  });
};

export const mountMarketSearch = (host) => {
  if (!host) {
    return;
  }
  if (tryMountNative(host)) {
    return;
  }
  host.innerHTML = replicaMarkup();
  bindReplica(host);
};
