import { futbinKeyForFilter, getFilters, updateFilter } from "./filters";
import { getSettings, setSetting } from "./settings";

// Migrations des réglages entre versions (exécutées une seule fois au démarrage).
export const runMigrations = () => {
  const settings = getSettings();
  const done = new Set((settings.meta && settings.meta.migrations) || []);
  if (!done.has("futbin-modes")) {
    // v5.0 : "prix de référence" global → v5.1 : mode FUTBIN par filtre + revente FUTBIN.
    if (settings.buy && settings.buy.useReference) {
      const percent = Number(settings.buy.referencePercent) || 85;
      // Seulement les filtres qui visent une carte précise (le prix FUTBIN est celui de cette carte).
      getFilters()
        .filter((filter) => futbinKeyForFilter(filter))
        .forEach((filter) => updateFilter(filter.id, { priceMode: "futbin", futbinPercent: percent }));
    }
    if (settings.sell && settings.sell.useReference) {
      setSetting("sell.priceMode", "futbin");
      if (settings.sell.referencePercent) {
        setSetting("sell.futbinPercent", String(settings.sell.referencePercent));
      }
    }
    if (settings.ui && settings.ui.futbinBadges === false) {
      setSetting("ui.cardPrices", false);
    }
    done.add("futbin-modes");
    setSetting("meta.migrations", Array.from(done));
  }
};
