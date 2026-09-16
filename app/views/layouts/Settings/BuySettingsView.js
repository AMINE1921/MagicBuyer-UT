import {
  idAbBidExact,
  idAbBuyPrice,
  idAbCardCount,
  idAbItemExpiring,
  idAbMaxBid,
  idAbSearchResult,
  idBuyFutBinPrice,
  idAbBidFutBin,
  idBuyFutBinPercent,
} from "../../../elementIds.constants";
import { getDataSource } from "../../../services/repository";
import { generateTextInput } from "../../../utils/uiUtils/generateTextInput";
import { generateToggleInput } from "../../../utils/uiUtils/generateToggleInput";

export const buySettingsView = function () {
  const dataSource = getDataSource();
  return `<div class='buyer-settings-wrapper buy-settings-view'>
      ${generateToggleInput(
        "Prix d'achat auto",
        { idBuyFutBinPrice },
        `(Utilise le prix ${dataSource} pour l'achat immédiat)`,
        "BuyerSettings"
      )}
      ${generateTextInput(
        "% du prix marché",
        92,
        { idBuyFutBinPercent },
        `(Pourcentage du prix ${dataSource} — 92% = marge de sécu)`,
        "BuyerSettings"
      )}
      ${generateToggleInput(
        `Enchérir au prix ${dataSource}`,
        { idAbBidFutBin },
        `(Enchère si le bid actuel est sous le prix ${dataSource})`,
        "BuyerSettings"
      )}
      ${generateTextInput(
        "Prix d'achat max",
        "",
        { idAbBuyPrice },
        "Achat immédiat seulement si BIN ≤ ce montant",
        "BuyerSettings"
      )}
      ${generateTextInput(
        "Cartes max à acheter",
        1000,
        { idAbCardCount },
        "(Stoppe le bot une fois ce total atteint)",
        "BuyerSettings"
      )}
      ${generateTextInput(
        "Enchère max",
        "",
        { idAbMaxBid },
        "N'enchérit pas au-delà de ce montant",
        "BuyerSettings"
      )}
      ${generateTextInput(
        "Enchérir si expire dans",
        "1H",
        { idAbItemExpiring },
        "(S = sec, M = min, H = heures)",
        "BuyerSettings",
        "text",
        "\\d+[H|M|S|h|m|s]$"
      )} 
      ${generateTextInput(
        "Seuil de résultats",
        21,
        { idAbSearchResult },
        "(Ignore la page si trop de résultats — concurrence élevée)",
        "BuyerSettings"
      )}
      ${generateToggleInput(
        "Enchère au prix exact",
        { idAbBidExact },
        "Sans round EA des paliers d'enchère",
        "BuyerSettings"
      )}      
     </div>
    `;
};
