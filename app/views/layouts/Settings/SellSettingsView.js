import {
  idAbMinDeleteCount,
  idAbSellPrice,
  idAbSellToggle,
  idSellAfterTax,
  idSellRatingThreshold,
  idSellFutBinPrice,
  idSellFutBinPercent,
  idSellCheckBuyPrice,
  idFutBinDuration,
  idAbDontMoveWon,
} from "../../../elementIds.constants";
import { getDataSource } from "../../../services/repository";
import { generateTextInput } from "../../../utils/uiUtils/generateTextInput";
import { generateToggleInput } from "../../../utils/uiUtils/generateToggleInput";

import $ from "../../../utils/jquery";

try {
  $(document).on("keyup", "#" + idAbSellPrice, function ({ target: { value } }) {
    updateAfterTax(value);
  });
} catch (e) {}

const updateAfterTax = (salePrice) => {
  const parsedSalePrice = parseInt(salePrice);
  if (isNaN(parsedSalePrice)) {
    $("#" + idSellAfterTax).html(0);
    return;
  }
  const calculatedPrice = (salePrice - (salePrice / 100) * 5).toLocaleString();
  $("#" + idSellAfterTax).html(calculatedPrice);
};

export const sellSettingsView = function () {
  const dataSource = getDataSource();
  return `<div style='display : none' class='buyer-settings-wrapper sell-settings-view'>
  ${generateToggleInput(
    "Prix de vente auto",
    { idSellFutBinPrice },
    `(Utilise le prix ${dataSource} pour lister)`,
    "BuyerSettings"
  )}
  ${generateTextInput(
    "% du prix de vente",
    "108-112",
    { idSellFutBinPercent },
    `(Fourchette % du prix ${dataSource} — au-dessus de l'EA tax 5%)`,
    "BuyerSettings",
    "text",
    "\\d+-\\d+$"
  )}
  ${generateToggleInput(
    "Vérifier le prix d'achat",
    { idSellCheckBuyPrice },
    "(Liste seulement si achat < prix de vente)",
    "BuyerSettings"
  )}
  ${generateTextInput(
    "Prix de vente",
    "",
    { idAbSellPrice },
    `(-1 = transfert list) Après taxe: <span id=${idSellAfterTax}>0</span>`,
    "BuyerSettings"
  )} 
   ${generateTextInput(
     "Durée de l'annonce",
     "1H",
     { idFutBinDuration },
     "Durée d'une mise en vente",
     "BuyerSettings",
     "text",
     "\\d+[H|M|S|h|m|s]$"
   )}
  ${generateTextInput(
    "Vider les vendus à",
    10,
    { idAbMinDeleteCount },
    "(Nettoie les vendus après ce nombre)",
    "BuyerSettings"
  )}
  ${generateTextInput(
    "Note max à lister",
    100,
    { idSellRatingThreshold },
    "(Ne liste pas au-dessus de cette note)",
    "BuyerSettings"
  )}
  ${generateToggleInput(
    "Relister les invendus",
    { idAbSellToggle },
    "",
    "BuyerSettings"
  )}
  ${generateToggleInput(
    "Ne pas déplacer les cartes gagnées",
    { idAbDontMoveWon },
    "(Reste en non assigné / cibles)",
    "BuyerSettings"
  )}
  </div>`;
};
