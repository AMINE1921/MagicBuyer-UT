import { previewSearch, isRunning } from "../../core/engine";
import {
  addFilter,
  describeFilter,
  duplicateFilter,
  filterHasTarget,
  getActiveFilter,
  getFilters,
  getLastEaSearch,
  getRotation,
  normalizeFilter,
  onFiltersChange,
  removeFilter,
  setActiveFilter,
  setRotation,
  futbinKeyForFilter,
  updateFilter,
} from "../../core/filters";
import { percentRange } from "../../core/listing";
import { afterTax, floorPrice, formatCoins, profitFor, roundPrice, toInt } from "../../core/prices";
import { getSettings } from "../../core/settings";
import { currentPrice, getPriceRecord, onPriceUpdate, requestPrice, trackPrice } from "../../prices/priceService";
import { loadEaPlayersCatalog, searchEaPlayersByTerm } from "../../services/datasource/eaPlayers";
import { debounce, escapeHtml, qs, setHtml } from "../dom";
import {
  grid,
  numberField,
  priceField,
  rangeField,
  registerVirtualFilterFields,
  section,
  selectField,
  textField,
  toggleField,
} from "../fields";

const LEVELS = [
  ["any", "Toutes"],
  ["bronze", "Bronze"],
  ["silver", "Argent"],
  ["gold", "Or"],
  ["SP", "Spéciale"],
];

const POSITIONS = [
  ["any", "Tous les postes"],
  ["130", "Zone : défense"],
  ["131", "Zone : milieu"],
  ["132", "Zone : attaque"],
  ["GK", "G (gardien)"],
  ["RB", "DD"],
  ["RWB", "DLD"],
  ["CB", "DC"],
  ["LB", "DG"],
  ["LWB", "DLG"],
  ["CDM", "MDC"],
  ["CM", "MC"],
  ["CAM", "MOC"],
  ["RM", "MD"],
  ["LM", "MG"],
  ["RW", "AD"],
  ["LW", "AG"],
  ["CF", "AT"],
  ["ST", "BU"],
];

let unsubscribeFilters = null;
let unsubscribePrices = null;
let liveTrack = { key: 0, untrack: null };
let liveTimer = null;

const LIVE_MAX_AGE = 5 * 60 * 1000;

const isDefaultName = (name) => /^(nouveau filtre|mon filtre|filtre)( \(copie\))?$/i.test(String(name || "").trim());

const filterPrices = (filter) => {
  const parts = [];
  if (filter.priceMode === "futbin") {
    parts.push(`≤ ${filter.futbinPercent} % FUTBIN`);
  } else if (filter.maxBuy) {
    parts.push(`≤ ${formatCoins(filter.maxBuy)}`);
  }
  if (filter.sellMode === "fixed" && filter.sellPrice) {
    parts.push(`→ ${formatCoins(filter.sellPrice)}`);
  } else if (filter.sellMode === "futbin") {
    parts.push(`→ ${filter.sellPercent || getSettings().sell.futbinPercent} %`);
  }
  return parts.join(" ");
};

// Ligne "prix FUTBIN en direct" du filtre actif (mode % FUTBIN).
const futbinLiveHtml = () => {
  const filter = getActiveFilter();
  if (!filter || filter.priceMode !== "futbin") {
    return "";
  }
  const key = futbinKeyForFilter(filter);
  if (!key) {
    return `<div class="mb-note is-warn">Choisis un joueur (ou un ID de version) : le prix FUTBIN est celui de cette carte.</div>`;
  }
  const record = getPriceRecord(key);
  const price = currentPrice(key, LIVE_MAX_AGE);
  if (!price) {
    const text =
      record && record.status === "miss"
        ? "Carte introuvable sur FUTBIN : indique un ID de version exacte ou passe en prix fixe."
        : record && record.status === "error"
        ? "FUTBIN ne répond pas pour l'instant (onglet FUTBIN pour tester l'accès)."
        : "Lecture du prix FUTBIN…";
    return `<div class="mb-note${record && record.status && record.status !== "ok" ? " is-warn" : ""}">${text}</div>`;
  }
  const computed = floorPrice((currentPrice(key, LIVE_MAX_AGE, "buy") * filter.futbinPercent) / 100);
  const max = filter.maxBuy ? Math.min(filter.maxBuy, computed) : computed;
  const seconds = Math.round((Date.now() - record.fetchedAt) / 1000);
  const age = seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
  return `<div class="mb-note mb-live">FUTBIN <b>${formatCoins(price)}</b>${record.suspect ? " ⚠" : ""} · lu il y a ${age}
    → achat max <b>${formatCoins(max)}</b>${filter.maxBuy && filter.maxBuy < computed ? " (plafond)" : ""}
    <button type="button" class="mb-link" data-target-action="futbin-refresh">actualiser</button></div>`;
};

// Le prix FUTBIN du filtre affiché est suivi tant que l'onglet Cible est ouvert.
const syncLiveTracking = () => {
  const filter = getActiveFilter();
  const key = filter && filter.priceMode === "futbin" ? futbinKeyForFilter(filter) : 0;
  if (key === liveTrack.key) {
    return;
  }
  if (liveTrack.untrack) {
    liveTrack.untrack();
  }
  liveTrack = {
    key,
    untrack: key
      ? trackPrice(key, { name: filter.player ? filter.player.name : "", rating: filter.player ? filter.player.rating : 0 }, "visible")
      : null,
  };
};

const listHtml = () => {
  const active = getActiveFilter();
  const rotation = getRotation();
  return getFilters()
    .map(
      (filter) => `
      <div class="mb-filter-item${active && active.id === filter.id ? " is-active" : ""}" data-filter-id="${filter.id}" role="button" tabindex="0">
        ${
          rotation.enabled
            ? `<button type="button" class="mb-check" role="checkbox" aria-checked="${filter.enabled}" data-filter-toggle="${filter.id}" aria-label="Inclure ${escapeHtml(filter.name)} dans la rotation">${filter.enabled ? "✓" : ""}</button>`
            : ""
        }
        <div class="mb-filter-main">
          <b>${escapeHtml(filter.name)}</b>
          <small>${escapeHtml(describeFilter(filter))}</small>
        </div>
        <span class="mb-price-tag">${escapeHtml(filterPrices(filter))}</span>
      </div>`
    )
    .join("");
};

const playerChipHtml = () => {
  const filter = getActiveFilter();
  const player = filter && filter.player;
  if (!player) {
    return `<span class="mb-empty">Aucun joueur : le filtre porte sur tous les joueurs correspondant aux critères.</span>`;
  }
  return `<span class="mb-chip"><span>${escapeHtml(player.name || "Joueur")}${player.rating ? ` · ${player.rating}` : ""} · id ${player.id}</span><button type="button" data-player-clear aria-label="Retirer le joueur">×</button></span>`;
};

const targetWarningHtml = () => {
  const filter = getActiveFilter();
  if (!filter || filterHasTarget(filter)) {
    return "";
  }
  return `<div class="mb-note is-warn" style="margin-top:8px">Ni joueur ni critère : ce filtre est ignoré par le bot (sécurité, sinon il achèterait n'importe quel joueur sous ton prix max). Choisis un joueur, ou une qualité / rareté / note.</div>`;
};

const lastEaHtml = () => {
  const snapshot = getLastEaSearch();
  if (!snapshot) {
    return "Lance une recherche dans le marché des transferts EA, puis importe-la ici (rareté, poste, style, nation…).";
  }
  const when = new Date(snapshot.capturedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const player = snapshot.player && snapshot.player.name ? snapshot.player.name : snapshot.player ? `joueur ${snapshot.player.id}` : "tous les joueurs";
  return `Dernière recherche EA capturée à ${when} : ${escapeHtml(player)}${snapshot.maxBuy ? ` · achat max ${formatCoins(snapshot.maxBuy)}` : ""}.`;
};

export const targetPageHtml = () => `
  ${section(
    "Filtres de snipe",
    `<div class="mb-filter-list" data-filter-list>${listHtml()}</div>
     <div class="mb-row" style="margin-top:8px">
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-filter-action="add">+ Nouveau</button>
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-filter-action="duplicate">Dupliquer</button>
       <button type="button" class="mb-btn mb-btn-danger mb-btn-sm" data-filter-action="delete">Supprimer</button>
     </div>
     <div style="margin-top:8px">${grid(
       toggleField({ bind: "r:enabled", label: "Rotation entre filtres", hint: "Alterne entre les filtres cochés." }),
       numberField({ bind: "r:every", label: "Changer toutes les", hint: "recherches", min: 1, max: 50 }),
       toggleField({ bind: "r:random", label: "Ordre aléatoire", wide: true })
     )}</div>`
  )}
  ${section(
    "Cible",
    grid(
      textField({ bind: "f:name", label: "Nom du filtre", wide: true }),
      `<div class="mb-field is-wide">
        <label class="mb-label" for="mb-player-input"><span>Joueur</span><em data-catalog-status></em></label>
        <div class="mb-player-search">
          <input id="mb-player-input" class="mb-input" type="search" autocomplete="off" spellcheck="false" placeholder="Nom du joueur (ex. Mbappé)" data-player-input aria-autocomplete="list" aria-controls="mb-player-results" />
          <div class="mb-results" id="mb-player-results" role="listbox" data-player-results hidden></div>
        </div>
        <div style="margin-top:8px" data-player-chip>${playerChipHtml()}</div>
        <div data-target-warning>${targetWarningHtml()}</div>
        <p class="mb-hint">Toutes les versions du joueur sont recherchées. Pour une carte précise (TOTW, promo…), indique son ID de version ou filtre par note / rareté.</p>
      </div>`,
      selectField({ bind: "f:level", label: "Qualité", options: LEVELS }),
      selectField({ bind: "f:positionChoice", label: "Poste", options: POSITIONS }),
      numberField({ bind: "f:minRating", label: "Note min", placeholder: "—", max: 99 }),
      numberField({ bind: "f:maxRating", label: "Note max", placeholder: "—", max: 99 })
    )
  )}
  ${section(
    "Prix d'achat",
    grid(
      selectField({
        bind: "f:priceMode",
        label: "Mode",
        wide: true,
        options: [
          ["fixed", "Prix fixe"],
          ["futbin", "% du prix FUTBIN (suivi en direct)"],
        ],
      }),
      numberField({
        bind: "f:futbinPercent",
        label: "% du prix FUTBIN",
        float: true,
        min: 10,
        max: 150,
        key: true,
        showIf: "f:priceMode=futbin",
        hint: "ex. 90 = achète jusqu'à 90 % du prix FUTBIN. Relu toutes les 60 à 120 s pendant le bot.",
      }),
      priceField({
        bind: "f:maxBuy",
        label: "Prix d'achat max (achat immédiat)",
        key: true,
        wide: true,
        hint: "Mode fixe : le bot achète toute carte à ce prix ou moins. Mode FUTBIN : plafond absolu optionnel (vide = aucun).",
      }),
      `<div class="mb-field is-wide" data-show-if="f:priceMode=futbin"><div data-futbin-live>${futbinLiveHtml()}</div></div>`,
      priceField({ bind: "f:maxBid", label: "Enchère max", hint: "Utilisé seulement si les enchères sont activées (onglet Achat)." }),
      priceField({ bind: "f:minBuy", label: "Achat min (filtre)", hint: "Optionnel." })
    )
  )}
  ${section(
    "Revente",
    grid(
      selectField({
        bind: "f:sellMode",
        label: "Prix de revente",
        wide: true,
        options: [
          ["global", "Comme l'onglet Vente"],
          ["fixed", "Prix fixe pour ce filtre"],
          ["futbin", "% du prix FUTBIN pour ce filtre"],
        ],
      }),
      priceField({ bind: "f:sellPrice", label: "Prix de revente", wide: true, showIf: "f:sellMode=fixed" }),
      rangeField({
        bind: "f:sellPercent",
        label: "% du prix FUTBIN",
        unit: null,
        optional: true,
        wide: true,
        placeholder: "ex. 98-100 (vide = onglet Vente)",
        showIf: "f:sellMode=futbin",
        hint: "Prix FUTBIN de la version achetée, relu juste après l'achat.",
      })
    )
  )}
  ${section(
    "Critères avancés (IDs EA)",
    grid(
      numberField({ bind: "f:definitionId", label: "ID de version exacte", placeholder: "ex. 50565123" }),
      textField({ bind: "f:raritiesText", label: "IDs de rareté", placeholder: "ex. 3" }),
      numberField({ bind: "f:nationField", label: "Nation (ID)", placeholder: "—" }),
      numberField({ bind: "f:leagueField", label: "Ligue (ID)", placeholder: "—" }),
      numberField({ bind: "f:clubField", label: "Club (ID)", placeholder: "—" }),
      numberField({ bind: "f:playStyleField", label: "Style de jeu (ID)", placeholder: "—" })
    ) +
      `<p class="mb-hint">Le plus simple : règle ta recherche dans le marché EA puis clique sur « Importer ».</p>`
  )}
  ${section(
    "Import & test",
    `<div class="mb-note" data-last-ea>${lastEaHtml()}</div>
     <div class="mb-row" style="margin-top:8px">
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-target-action="import">Importer la recherche EA</button>
       <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-target-action="preview">Tester la recherche (sans acheter)</button>
     </div>
     <div data-preview></div>`
  )}
`;

// Champs "virtuels" : convertis vers le modèle du filtre.
const VIRTUAL = {
  positionChoice: {
    read: (filter) => (filter.zone > 0 ? String(filter.zone) : filter.position || "any"),
    write: (value) =>
      /^13[0-2]$/.test(value) ? { zone: Number(value), position: "any" } : { zone: -1, position: value || "any" },
  },
  raritiesText: {
    read: (filter) => filter.rarities.join(", "),
    write: (value) => ({
      rarities: String(value || "")
        .split(/[\s,;]+/)
        .map((v) => parseInt(v, 10))
        .filter((v) => Number.isFinite(v) && v >= 0),
    }),
  },
  nationField: { read: (f) => (f.nation > 0 ? f.nation : 0), write: (v) => ({ nation: toInt(v) || -1 }) },
  leagueField: { read: (f) => (f.league > 0 ? f.league : 0), write: (v) => ({ league: toInt(v) || -1 }) },
  clubField: { read: (f) => (f.club > 0 ? f.club : 0), write: (v) => ({ club: toInt(v) || -1 }) },
  playStyleField: { read: (f) => (f.playStyle > 0 ? f.playStyle : 0), write: (v) => ({ playStyle: toInt(v) || -1 }) },
};

registerVirtualFilterFields(VIRTUAL);

const previewHtml = (result) => {
  if (!result.ok) {
    return `<div class="mb-note is-warn" style="margin-top:8px">${escapeHtml(result.message)}</div>`;
  }
  if (!result.rows.length) {
    return `<div class="mb-note" style="margin-top:8px">Aucune carte trouvée${result.maxBuy ? ` à ${formatCoins(result.maxBuy)} ou moins` : ""} (${Math.round(result.latency)} ms). C'est normal si ton prix max est sous le marché : le bot attend qu'une affaire apparaisse.</div>`;
  }
  const rows = result.rows
    .slice(0, 21)
    .map((row) => {
      const deal = result.maxBuy && row.bin && row.bin <= result.maxBuy && row.match && !row.own;
      const minutes = Math.floor(row.expires / 60);
      const time = row.expires >= 3600 ? `${Math.floor(row.expires / 3600)} h` : `${minutes} min`;
      return `<tr class="${deal ? "is-deal" : row.match ? "" : "is-muted"}">
        <td>${escapeHtml(row.name)} ${row.rating}${row.own ? " (toi)" : ""}</td>
        <td class="is-num">${row.bin ? formatCoins(row.bin) : "—"}</td>
        <td class="is-num">${row.bid ? formatCoins(row.bid) : "—"}</td>
        <td class="is-num">${time}</td>
      </tr>`;
    })
    .join("");
  const cheapest = result.rows.find((row) => row.bin && row.match && !row.own);
  const futbin = result.futbinPrice ? ` · FUTBIN ${formatCoins(result.futbinPrice)} → achat max ${formatCoins(result.maxBuy)}` : "";
  return `<div class="mb-preview">
      <table>
        <thead><tr><th>Carte</th><th class="is-num">Achat imm.</th><th class="is-num">Enchère</th><th class="is-num">Fin</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="mb-hint">${result.rows.length} résultat(s) · ${Math.round(result.latency)} ms${cheapest ? ` · moins cher : ${formatCoins(cheapest.bin)}` : ""}${futbin}. En vert : ce que le bot achèterait.</p>`;
};

export const bindTargetPage = (page, refreshAll) => {
  const listEl = qs(page, "[data-filter-list]");
  const chipEl = qs(page, "[data-player-chip]");
  const input = qs(page, "[data-player-input]");
  const results = qs(page, "[data-player-results]");
  const status = qs(page, "[data-catalog-status]");
  const lastEa = qs(page, "[data-last-ea]");
  const preview = qs(page, "[data-preview]");
  let hits = [];
  let focusIndex = -1;

  const warningEl = qs(page, "[data-target-warning]");
  const liveEl = qs(page, "[data-futbin-live]");
  const renderLive = () => setHtml(liveEl, futbinLiveHtml());
  const renderList = () => {
    setHtml(listEl, listHtml());
    setHtml(chipEl, playerChipHtml());
    setHtml(warningEl, targetWarningHtml());
    setHtml(lastEa, lastEaHtml());
    syncLiveTracking();
    renderLive();
  };

  if (unsubscribeFilters) {
    unsubscribeFilters();
  }
  unsubscribeFilters = onFiltersChange(() => {
    renderList();
    refreshAll();
  });
  if (unsubscribePrices) {
    unsubscribePrices();
  }
  unsubscribePrices = onPriceUpdate((id) => {
    if (id === liveTrack.key) {
      renderLive();
      refreshAll();
    }
  });
  syncLiveTracking();
  clearInterval(liveTimer);
  liveTimer = setInterval(renderLive, 15000);

  const closeResults = () => {
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    focusIndex = -1;
  };

  const choose = (player) => {
    const filter = getActiveFilter();
    if (!filter || !player) {
      return;
    }
    const patch = { player: { id: player.eaId, name: player.name, rating: player.rating }, definitionId: 0 };
    if (isDefaultName(filter.name)) {
      patch.name = `${player.name}${player.rating ? ` ${player.rating}` : ""}`;
    }
    updateFilter(filter.id, patch);
    input.value = "";
    closeResults();
  };

  const paintHits = () => {
    if (!hits.length) {
      results.innerHTML = `<div class="mb-hit"><small>Aucun joueur trouvé.</small></div>`;
      results.hidden = false;
      return;
    }
    results.innerHTML = hits
      .map(
        (player, index) => `<button type="button" class="mb-hit${index === focusIndex ? " is-focus" : ""}" role="option" data-hit="${index}">
          <span class="mb-hit-rating">${player.rating || "—"}</span>
          <span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(`${player.firstName || ""} ${player.lastName || ""}`.trim())} · id ${player.eaId}</small></span>
        </button>`
      )
      .join("");
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const search = debounce(async () => {
    const term = input.value.trim();
    if (term.length < 2) {
      closeResults();
      return;
    }
    status.textContent = "recherche…";
    hits = await searchEaPlayersByTerm(term, 12);
    status.textContent = hits.length ? "" : "catalogue EA indisponible ?";
    focusIndex = hits.length ? 0 : -1;
    paintHits();
  }, 180);

  input.addEventListener("input", search);
  input.addEventListener("focus", () => {
    loadEaPlayersCatalog().then((rows) => {
      status.textContent = rows && rows.length ? `${rows.length.toLocaleString("fr-FR")} joueurs` : "catalogue indisponible";
    });
  });
  input.addEventListener("keydown", (event) => {
    if (results.hidden || !hits.length) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusIndex = (focusIndex + (event.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      paintHits();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(hits[Math.max(0, focusIndex)]);
    } else if (event.key === "Escape") {
      closeResults();
    }
  });
  results.addEventListener("mousedown", (event) => event.preventDefault());
  results.addEventListener("click", (event) => {
    const hit = event.target.closest("[data-hit]");
    if (hit) {
      choose(hits[Number(hit.dataset.hit)]);
    }
  });
  input.addEventListener("blur", () => setTimeout(closeResults, 120));

  page.addEventListener("click", async (event) => {
    const target = event.target;
    const toggle = target.closest("[data-filter-toggle]");
    if (toggle) {
      event.stopPropagation();
      const filter = getFilters().find((f) => f.id === toggle.dataset.filterToggle);
      if (filter) {
        updateFilter(filter.id, { enabled: !filter.enabled });
      }
      return;
    }
    const item = target.closest("[data-filter-id]");
    if (item) {
      setActiveFilter(item.dataset.filterId);
      preview.innerHTML = "";
      return;
    }
    if (target.closest("[data-player-clear]")) {
      const filter = getActiveFilter();
      if (filter) {
        updateFilter(filter.id, { player: null });
      }
      return;
    }
    const action = target.closest("[data-filter-action]");
    if (action) {
      const active = getActiveFilter();
      if (action.dataset.filterAction === "add") {
        addFilter({ name: "Nouveau filtre" });
      } else if (action.dataset.filterAction === "duplicate" && active) {
        duplicateFilter(active.id);
      } else if (action.dataset.filterAction === "delete" && active) {
        if (window.confirm(`Supprimer le filtre « ${active.name} » ?`)) {
          removeFilter(active.id);
        }
      }
      preview.innerHTML = "";
      return;
    }
    const targetAction = target.closest("[data-target-action]");
    if (!targetAction) {
      return;
    }
    if (targetAction.dataset.targetAction === "futbin-refresh") {
      const filter = getActiveFilter();
      const key = filter ? futbinKeyForFilter(filter) : 0;
      if (key) {
        requestPrice(key, { name: filter.player ? filter.player.name : "", rating: filter.player ? filter.player.rating : 0 }).then(renderLive);
      }
      return;
    }
    if (targetAction.dataset.targetAction === "import") {
      const snapshot = getLastEaSearch();
      if (!snapshot) {
        preview.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">Aucune recherche EA capturée. Va dans Transferts → Marché des transferts, règle tes critères et clique sur Rechercher (ou sur « Sniper cette recherche »).</div>`;
        return;
      }
      importSnapshot(snapshot);
      preview.innerHTML = `<div class="mb-note" style="margin-top:8px">Recherche EA importée dans le filtre actif. Vérifie le prix d'achat max.</div>`;
      return;
    }
    if (targetAction.dataset.targetAction === "preview") {
      if (isRunning()) {
        preview.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">Le bot tourne déjà : regarde le journal.</div>`;
        return;
      }
      targetAction.disabled = true;
      preview.innerHTML = `<div class="mb-note" style="margin-top:8px">Recherche en cours…</div>`;
      try {
        const filter = getActiveFilter();
        const result = await previewSearch(filter);
        preview.innerHTML = previewHtml(result);
      } catch (e) {
        preview.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">${escapeHtml(e.message || e)}</div>`;
      } finally {
        targetAction.disabled = false;
      }
    }
  });
  page.addEventListener("keydown", (event) => {
    const item = event.target.closest && event.target.closest("[data-filter-id]");
    if (item && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setActiveFilter(item.dataset.filterId);
    }
  });
};

// Applique une recherche EA capturée au filtre actif (ou en crée un nouveau).
export const importSnapshot = (snapshot, { asNew = false } = {}) => {
  if (!snapshot) {
    return null;
  }
  const patch = {
    type: snapshot.type,
    category: snapshot.category,
    level: snapshot.level,
    rarities: snapshot.rarities,
    position: snapshot.position,
    zone: snapshot.zone,
    nation: snapshot.nation,
    league: snapshot.league,
    club: snapshot.club,
    playStyle: snapshot.playStyle,
    definitionId: snapshot.definitionId,
    player: snapshot.player,
  };
  if (snapshot.maxBuy) {
    patch.maxBuy = snapshot.maxBuy;
  }
  if (snapshot.minBuy) {
    patch.minBuy = snapshot.minBuy;
  }
  if (snapshot.maxBid) {
    patch.maxBid = snapshot.maxBid;
  }
  const name = snapshot.player && snapshot.player.name
    ? `${snapshot.player.name}${snapshot.player.rating ? ` ${snapshot.player.rating}` : ""}`
    : "Recherche EA";
  const active = getActiveFilter();
  if (asNew || !active) {
    return addFilter(Object.assign({ name }, patch));
  }
  if (isDefaultName(active.name) || /^Recherche EA/.test(active.name)) {
    patch.name = name;
  }
  updateFilter(active.id, patch);
  return normalizeFilter(Object.assign({}, active, patch));
};

// Achat max réellement utilisé (fixe, ou % FUTBIN plafonné) pour les aides de la page.
const effectiveBuy = (filter) => {
  if (filter.priceMode !== "futbin") {
    return toInt(filter.maxBuy);
  }
  const key = futbinKeyForFilter(filter);
  const price = key ? currentPrice(key, LIVE_MAX_AGE, "buy") : 0;
  if (!price) {
    return 0;
  }
  const computed = floorPrice((price * filter.futbinPercent) / 100);
  return filter.maxBuy ? Math.min(filter.maxBuy, computed) : computed;
};

// Texte d'aide sous le prix de revente : net après taxe + bénéfice par carte.
export const sellExtra = () => {
  const filter = getActiveFilter();
  if (!filter) {
    return "";
  }
  const settings = getSettings().sell;
  let sell = 0;
  let prefix = "";
  const futbinSell = filter.sellMode === "futbin" || (filter.sellMode === "global" && settings.priceMode === "futbin");
  if (futbinSell) {
    const key = futbinKeyForFilter(filter);
    const price = key ? currentPrice(key, LIVE_MAX_AGE, "sell") : 0;
    if (!price) {
      return "";
    }
    const range = percentRange(filter.sellMode === "futbin" && filter.sellPercent ? filter.sellPercent : settings.futbinPercent);
    sell = roundPrice((price * (range.min + range.max)) / 200);
    prefix = `≈ ${formatCoins(sell)} · `;
  } else {
    sell = filter.sellMode === "fixed" ? toInt(filter.sellPrice) || toInt(settings.defaultPrice) : toInt(settings.defaultPrice);
  }
  if (!sell) {
    return "";
  }
  const buy = effectiveBuy(filter);
  const net = afterTax(sell);
  const profit = buy ? profitFor(buy, sell) : 0;
  return `${prefix}net ${formatCoins(net)}${buy ? ` · bénéfice ${profit >= 0 ? "+" : ""}${formatCoins(profit)}` : ""}`;
};
