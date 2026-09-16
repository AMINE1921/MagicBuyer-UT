import { searchPlayersByTerm } from "../services/datasource/futbin";
import { fetchPrices } from "../services/datasource";
import { getValue, setValue } from "../services/repository";
import { sanitizeEaSearchCriteria, summarizeCriteria } from "./buyerContext";

const debounce = (fn, wait) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

const numberOrZero = (value) => {
  const n = parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
  return n > 0 ? n : 0;
};

const selectedPlayer = () => getValue("lastSearchPlayer") || null;

const readPrices = (root) => ({
  maxBuy: numberOrZero(root.querySelector("#mb-max-buy") && root.querySelector("#mb-max-buy").value),
  minBuy: numberOrZero(root.querySelector("#mb-min-buy") && root.querySelector("#mb-min-buy").value),
  maxBid: numberOrZero(root.querySelector("#mb-max-bid") && root.querySelector("#mb-max-bid").value),
  minBid: numberOrZero(root.querySelector("#mb-min-bid") && root.querySelector("#mb-min-bid").value),
});

const buildCriteria = (player, prices) =>
  sanitizeEaSearchCriteria({
    type: "player",
    maskedDefId: player && player.eaId,
    minBuy: prices.minBuy || 0,
    maxBuy: prices.maxBuy || 0,
    minBid: prices.minBid || 0,
    maxBid: prices.maxBid || 0,
  });

const syncBuyPrice = (maxBuy) => {
  if (!maxBuy) {
    return;
  }
  const buyer = getValue("BuyerSettings") || {};
  if (!buyer.idAbBuyPrice) {
    buyer.idAbBuyPrice = maxBuy;
    setValue("BuyerSettings", buyer);
    const input = document.getElementById("idAbBuyPrice");
    if (input) {
      input.value = String(maxBuy);
    }
  }
};

const renderSelected = (root) => {
  const card = root.querySelector("#mb-target-selected");
  if (!card) {
    return;
  }
  const player = selectedPlayer();
  if (!player) {
    card.innerHTML = "<span>Aucun joueur sélectionné</span>";
    return;
  }
  card.innerHTML = `<strong>${player.name}</strong>
    <span>${[player.rating, player.position, player.club].filter(Boolean).join(" · ")}</span>`;
};

export const applyCurrentTarget = (root) => {
  const host = root || document.querySelector(".mb-page[data-page=target]");
  const player = selectedPlayer();
  const prices = host ? readPrices(host) : {};
  const criteria = buildCriteria(player, prices);
  setValue("lastSearchCriteria", criteria);
  const instance = getValue("AutoBuyerInstance");
  if (instance && instance.viewmodel) {
    instance.viewmodel.searchCriteria = criteria;
  }
  syncBuyPrice(prices.maxBuy);
  if (host) {
    renderSelected(host);
  }
  const banner = document.getElementById("mb-criteria-text");
  if (banner) {
    banner.textContent = summarizeCriteria(criteria);
  }
  return criteria;
};

const fillFutbinPrice = async (root, player) => {
  if (!player || !player.eaId) {
    return;
  }
  const maxBuy = root.querySelector("#mb-max-buy");
  if (!maxBuy || maxBuy.value) {
    return;
  }
  try {
    await fetchPrices([
      {
        definitionId: player.eaId,
        rating: player.rating,
        lastName: player.name,
        type: "player",
      },
    ]);
    const cached = getValue(`${player.eaId}_futbin_price`);
    if (cached && cached.price) {
      maxBuy.value = String(cached.price);
    }
  } catch (e) {}
};

const openTransferMarket = () => {
  const close = document.querySelector("#mb-root .mb-close");
  if (close) {
    close.click();
  }
  const transferTab = document.querySelector(
    ".ut-tab-bar-item.icon-transfer, nav.ut-tab-bar .icon-transfer"
  );
  if (transferTab) {
    transferTab.click();
  }
  setTimeout(() => {
    const tile = document.querySelector(
      ".ut-tile-transfer-market, .tile.col-1-1.transfer-market, .ut-tile-view.transfer-market"
    );
    if (tile) {
      tile.click();
    }
  }, 350);
};

const renderResults = (root, players) => {
  const list = root.querySelector("#mb-target-results");
  if (!list) {
    return;
  }
  list.innerHTML = "";
  if (!players.length) {
    list.hidden = true;
    return;
  }
  list.hidden = false;
  players.forEach((player) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "mb-target-hit";
    item.innerHTML = `<span class="mb-hit-rating">${player.rating || "—"}</span>
      <span class="mb-hit-meta"><strong>${player.name}</strong>
      <small>${[player.position, player.club].filter(Boolean).join(" · ")}</small></span>`;
    item.addEventListener("click", async () => {
      setValue("lastSearchPlayer", player);
      const query = root.querySelector("#mb-target-query");
      if (query) {
        query.value = player.name;
      }
      list.hidden = true;
      await fillFutbinPrice(root, player);
      applyCurrentTarget(root);
    });
    list.appendChild(item);
  });
};

export const targetSearchMarkup = () => `
  <div class="mb-target">
    <label class="mb-field">
      <span>Joueur</span>
      <div class="mb-target-search">
        <input id="mb-target-query" type="search" autocomplete="off" placeholder="Ex. Timber, Konsa…" />
        <div id="mb-target-results" class="mb-target-results" hidden></div>
      </div>
    </label>
    <div id="mb-target-selected" class="mb-target-selected">Aucun joueur sélectionné</div>
    <div class="mb-target-prices">
      <label class="mb-field">
        <span>Prix max (BIN)</span>
        <input id="mb-max-buy" type="number" min="0" step="50" placeholder="ex. 2400" />
      </label>
      <label class="mb-field">
        <span>BIN min (optionnel)</span>
        <input id="mb-min-buy" type="number" min="0" step="50" placeholder="ex. 200" />
      </label>
    </div>
    <details class="mb-advanced">
      <summary>Enchères (optionnel)</summary>
      <div class="mb-target-prices">
        <label class="mb-field">
          <span>Enchère max</span>
          <input id="mb-max-bid" type="number" min="0" step="50" />
        </label>
        <label class="mb-field">
          <span>Enchère min</span>
          <input id="mb-min-bid" type="number" min="0" step="50" />
        </label>
      </div>
    </details>
    <div class="mb-target-actions">
      <button type="button" id="mb-target-apply" class="mb-btn-start">Utiliser ce joueur</button>
      <button type="button" id="mb-target-market" class="mb-btn-ghost">Marché EA</button>
      <button type="button" id="mb-target-clear" class="mb-btn-ghost">Effacer</button>
    </div>
    <p id="mb-target-status" class="mb-target-status">La recherche EA utilisera maskedDefId, comme le marché officiel.</p>
  </div>
`;

export const bindTargetSearch = (root) => {
  if (!root || root.__mbTargetBound) {
    return;
  }
  root.__mbTargetBound = true;
  const query = root.querySelector("#mb-target-query");
  const runSearch = debounce(async () => {
    const term = query && query.value;
    if (!term || term.trim().length < 2) {
      renderResults(root, []);
      return;
    }
    try {
      renderResults(root, await searchPlayersByTerm(term.trim()));
    } catch (e) {
      console.warn("[MagicBuyer] recherche cible", e);
    }
  }, 280);
  if (query) {
    query.addEventListener("input", runSearch);
  }
  const applyBtn = root.querySelector("#mb-target-apply");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      applyCurrentTarget(root);
      const status = root.querySelector("#mb-target-status");
      const player = selectedPlayer();
      if (status) {
        status.textContent = player
          ? `${player.name} prêt — clique Démarrer`
          : "Choisis un joueur dans la liste";
      }
    });
  }
  const marketBtn = root.querySelector("#mb-target-market");
  if (marketBtn) {
    marketBtn.addEventListener("click", openTransferMarket);
  }
  const clearBtn = root.querySelector("#mb-target-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      setValue("lastSearchPlayer", null);
      setValue("lastSearchCriteria", sanitizeEaSearchCriteria({ type: "player" }));
      if (query) {
        query.value = "";
      }
      ["mb-max-buy", "mb-min-buy", "mb-max-bid", "mb-min-bid"].forEach((id) => {
        const input = root.querySelector(`#${id}`);
        if (input) {
          input.value = "";
        }
      });
      renderResults(root, []);
      renderSelected(root);
    });
  }
  ["mb-max-buy", "mb-min-buy", "mb-max-bid", "mb-min-bid"].forEach((id) => {
    const input = root.querySelector(`#${id}`);
    if (input) {
      input.addEventListener("change", () => applyCurrentTarget(root));
    }
  });
  const criteria = getValue("lastSearchCriteria") || {};
  [
    ["mb-max-buy", criteria.maxBuy],
    ["mb-min-buy", criteria.minBuy],
    ["mb-max-bid", criteria.maxBid],
    ["mb-min-bid", criteria.minBid],
  ].forEach(([id, value]) => {
    const input = root.querySelector(`#${id}`);
    if (input && value) {
      input.value = value;
    }
  });
  const player = selectedPlayer();
  if (player && query) {
    query.value = player.name || "";
  }
  renderSelected(root);
};
