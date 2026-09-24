import { log } from "../../core/logger";
import { formatCoins } from "../../core/prices";
import { fetchFutbinPrice, futbinRequestCount, resolveFutbinLink } from "../../prices/futbinClient";
import { clearFutbinCache, getFutbinStatus, pricePlatform } from "../../prices/priceService";
import { escapeHtml, qs, setHtml } from "../dom";
import { grid, numberField, rangeField, section, selectField, toggleField } from "../fields";

// Onglet FUTBIN : accès (test), fréquence de rafraîchissement, étiquettes sur les cartes, DCE.

const TEST_CARD = { definitionId: 231747, name: "Mbappé", rating: 0 };

const STATE_TEXT = {
  idle: "prêt",
  fetching: "lecture en cours",
  queued: "file d'attente",
  blocked: "ralenti (FUTBIN bloque)",
};

const ago = (timestamp) => {
  if (!timestamp) {
    return "jamais";
  }
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return seconds < 60 ? `il y a ${seconds} s` : `il y a ${Math.round(seconds / 60)} min`;
};

const statusHtml = () => {
  const status = getFutbinStatus();
  const cell = (label, value) => `<div>${label}<b>${value}</b></div>`;
  const blocked = status.blockedUntil > Date.now();
  return `<div class="mb-stats-list">
      ${cell("État", escapeHtml(STATE_TEXT[status.state] || status.state))}
      ${cell("Plateforme", pricePlatform() === "pc" ? "PC" : "Console")}
      ${cell("Cartes suivies", status.tracked)}
      ${cell("En attente", status.queue)}
      ${cell("Dernier prix lu", ago(status.lastSuccessAt))}
      ${cell("Requêtes FUTBIN", futbinRequestCount())}
    </div>${
      status.lastError || blocked
        ? `<div class="mb-note is-warn" style="margin-top:8px">${escapeHtml(status.lastError || "FUTBIN ralenti")}${
            blocked ? ` · reprise dans ${Math.ceil((status.blockedUntil - Date.now()) / 1000)} s` : ""
          }</div>`
        : ""
    }`;
};

export const futbinPageHtml = () => `
  ${section(
    "Accès FUTBIN",
    `<div data-futbin-status>${statusHtml()}</div>
     <div class="mb-row" style="margin-top:8px">
       <button type="button" class="mb-btn mb-btn-primary mb-btn-sm" data-futbin-action="test">Tester FUTBIN</button>
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-futbin-action="open">Ouvrir futbin.com</button>
       <button type="button" class="mb-btn mb-btn-ghost mb-btn-sm" data-futbin-action="clear">Vider le cache des prix</button>
     </div>
     <div data-futbin-test></div>
     <p class="mb-hint">Les prix sont lus sur les pages FUTBIN (comme dans ton navigateur). Une seule requête à la fois, espacées, et ralentissement automatique si FUTBIN bloque.</p>`
  )}
  ${section(
    "Rafraîchissement des prix",
    grid(
      selectField({
        bind: "s:prices.platform",
        label: "Plateforme des prix",
        wide: true,
        options: [
          ["auto", "Automatique (plateforme de ton compte)"],
          ["console", "Console (PlayStation / Xbox)"],
          ["pc", "PC"],
        ],
      }),
      numberField({ bind: "s:prices.hotInterval", label: "Cibles du bot et achats DCE", min: 60, max: 120, hint: "relus toutes les N secondes (60 à 120)" }),
      numberField({ bind: "s:prices.visibleInterval", label: "Cartes affichées", min: 60, max: 600, hint: "secondes ; moins souvent si le prix ne bouge pas" }),
      numberField({ bind: "s:prices.jumpGuard", label: "Saut de prix suspect", min: 5, max: 90, hint: "% d'écart : revérifié avant que le bot l'utilise" }),
      numberField({ bind: "s:prices.minGap", label: "Écart entre requêtes", float: true, min: 0.8, max: 10, hint: "secondes entre deux pages FUTBIN" }),
      toggleField({
        bind: "s:prices.iframeFallback",
        label: "Secours : page FUTBIN cachée",
        wide: true,
        hint: "Si FUTBIN refuse la requête directe (Cloudflare), la page est chargée dans une iframe invisible.",
      })
    )
  )}
  ${section(
    "Affichage",
    grid(
      toggleField({
        bind: "s:ui.cardPrices",
        label: "Prix FUTBIN sur les cartes",
        wide: true,
        hint: "Petite étiquette en haut de chaque carte joueur (club, marché, transferts, équipes, DCE). Clic : page FUTBIN de la carte.",
      })
    )
  )}
  ${section(
    "DCE : solutions FUTBIN",
    grid(
      numberField({ bind: "s:sbc.margin", label: "Marge sur le prix FUTBIN", min: 0, max: 50, hint: "% ajoutés au prix FUTBIN pour le prix max des manquants" }),
      numberField({ bind: "s:sbc.triesPerPlayer", label: "Recherches par joueur", min: 1, max: 30 }),
      rangeField({ bind: "s:sbc.wait", label: "Pause entre recherches", unit: "S", placeholder: "3-5", wide: true })
    ) +
      `<p class="mb-hint">Dans l'équipe d'un défi, clique sur « ⚡ Solution FUTBIN » (en haut de l'écran) et colle le lien de la solution. Le défi n'est jamais envoyé automatiquement.</p>`
  )}
`;

export const refreshFutbinStatus = (body) => {
  const el = qs(body, "[data-futbin-status]");
  if (el) {
    setHtml(el, statusHtml());
  }
};

const runTest = async (out) => {
  const started = Date.now();
  out.innerHTML = `<div class="mb-note" style="margin-top:8px">Test en cours (recherche puis page joueur)…</div>`;
  // Test explicite : la requête directe est retentée même si FUTBIN l'a refusée il y a peu.
  const resolved = await resolveFutbinLink(TEST_CARD, { forceDirect: true });
  if (!resolved.ok) {
    const message = resolved.blocked
      ? "FUTBIN demande une vérification (Cloudflare). Clique sur « Ouvrir futbin.com », passe la vérification si elle s'affiche, puis reteste."
      : resolved.notFound
      ? "FUTBIN répond, mais la carte de test est introuvable : le format de la recherche FUTBIN a peut-être changé."
      : `FUTBIN ne répond pas${resolved.status ? ` (${resolved.status})` : ""}.`;
    out.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">✗ ${escapeHtml(message)}</div>`;
    log.warn(`Test FUTBIN : ${message}`);
    return;
  }
  const platform = pricePlatform();
  const price = await fetchFutbinPrice(resolved.link, platform, { forceDirect: true });
  const seconds = ((Date.now() - started) / 1000).toFixed(1).replace(".", ",");
  if (!price.ok) {
    const message = price.blocked
      ? "la page joueur est bloquée par Cloudflare"
      : price.noPrice
      ? "la page joueur est lue mais le prix est introuvable (format FUTBIN changé ?)"
      : `la page joueur ne répond pas${price.status ? ` (${price.status})` : ""}`;
    out.innerHTML = `<div class="mb-note is-warn" style="margin-top:8px">✗ Recherche OK, mais ${escapeHtml(message)}.</div>`;
    log.warn(`Test FUTBIN : ${message}.`);
    return;
  }
  const via = price.via === "iframe" ? "page cachée (secours)" : "requête directe";
  const age = price.updatedAgoSec ? ` · mis à jour par FUTBIN il y a ${Math.round(price.updatedAgoSec / 60)} min` : "";
  out.innerHTML = `<div class="mb-note" style="margin-top:8px">✓ FUTBIN accessible (${escapeHtml(via)}) : ${escapeHtml(
    resolved.link.name || TEST_CARD.name
  )} = <b>${formatCoins(price.price)}</b> (${platform === "pc" ? "PC" : "console"})${age} · ${seconds} s</div>`;
  log.success(`Test FUTBIN réussi (${via}) : ${resolved.link.name || TEST_CARD.name} = ${formatCoins(price.price)}.`);
};

export const bindFutbinPage = (page) => {
  page.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-futbin-action]");
    if (!action) {
      return;
    }
    if (action.dataset.futbinAction === "open") {
      window.open("https://www.futbin.com/", "_blank", "noopener");
      return;
    }
    if (action.dataset.futbinAction === "clear") {
      if (window.confirm("Vider le cache des prix et des liens FUTBIN ?")) {
        clearFutbinCache();
        log.info("Cache FUTBIN vidé.");
        refreshFutbinStatus(page);
      }
      return;
    }
    if (action.dataset.futbinAction === "test") {
      action.disabled = true;
      try {
        await runTest(qs(page, "[data-futbin-test]"));
      } finally {
        action.disabled = false;
        refreshFutbinStatus(page);
      }
    }
  });
};
