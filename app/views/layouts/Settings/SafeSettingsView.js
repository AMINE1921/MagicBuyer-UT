import {
  idAbCycleAmount,
  idAbPauseFor,
  idAbStopAfter,
  idAbWaitTime,
  idAbAddBuyDelay,
  idAbDelayToAdd,
  idAbOverSearchWarning,
  idAbMaxPurchases,
} from "../../../elementIds.constants";
import { generateTextInput } from "../../../utils/uiUtils/generateTextInput";
import { generateToggleInput } from "../../../utils/uiUtils/generateToggleInput";

export const safeSettingsView = function () {
  return `<div style='display : none' class='buyer-settings-wrapper safety-settings-view'>
  ${generateTextInput(
    "Pause entre recherches",
    "8-12",
    { idAbWaitTime },
    "(Secondes aléatoires, ex. 8-12 — trop bas = risk 429)",
    "CommonSettings",
    "text",
    "\\d+-\\d+$"
  )}
  ${generateTextInput(
    "Achats max par recherche",
    1,
    { idAbMaxPurchases },
    "Garde 1 sauf si tu as un délai d'achat ≥ 3S",
    "CommonSettings"
  )}
  ${generateTextInput(
    "Cycle avant pause",
    "12-18",
    { idAbCycleAmount },
    "(Nombre de recherches avant une pause, ex. 12-18)",
    "CommonSettings",
    "text",
    "\\d+-\\d+$"
  )}
  ${generateTextInput(
    "Durée de pause",
    "20-40S",
    { idAbPauseFor },
    "(S / M / H — ex. 20-40S)",
    "CommonSettings",
    "text",
    "\\d+-\\d+[H|M|S|h|m|s]$"
  )}
  ${generateToggleInput(
    "Délai après achat",
    { idAbAddBuyDelay },
    "(Pause après une tentative d'achat / enchère)",
    "CommonSettings"
  )}
  ${generateTextInput(
    "Délai à ajouter",
    "3S",
    { idAbDelayToAdd },
    "(S / M / H)",
    "CommonSettings",
    "text",
    "\\d+[H|M|S|h|m|s]$"
  )}
  ${generateTextInput(
    "Arrêt automatique",
    "1-2H",
    { idAbStopAfter },
    "(S / M / H — ex. 1-2H)",
    "CommonSettings",
    "text",
    "\\d+-\\d+[H|M|S|h|m|s]$"
  )}
  ${generateToggleInput(
    "Alerte trop de recherches",
    { idAbOverSearchWarning },
    "(Log si plus de 15 recherches / minute)",
    "CommonSettings"
  )} 
  </div>`;
};
