import { generateToggleInput } from "../../../utils/uiUtils/generateToggleInput";
import {
  idAbAddFilterGK,
  idAbMinRating,
  idAbMaxRating,
  idAbRandMinBidInput,
  idAbRandMinBidToggle,
  idAbRandMinBuyInput,
  idAbRandMinBuyToggle,
  idAbMaxSearchPage,
  idAddIgnorePlayers,
  idAddIgnorePlayersList,
  idRemoveIgnorePlayers,
  idAbIgnoreAllowToggle,
  idTooltip,
  idAbShouldSort,
  idAbSortBy,
  idAbSortOrder,
} from "../../../elementIds.constants";
import { generateTextInput } from "../../../utils/uiUtils/generateTextInput";
import { checkAndAppendOption } from "../../../utils/filterUtil";
import { getValue, setValue } from "../../../services/repository";
import { generateButton } from "../../../utils/uiUtils/generateButton";
import $ from "../../../utils/jquery";
import { getPageWindow } from "../../../utils/pageWindow";
let playerInput;

export const destoryPlayerInput = () => {
  if (playerInput && typeof playerInput.destroy === "function") {
    playerInput.destroy();
  }
  playerInput = null;
};

const updateAbSortBy = () => {
  const sortBy = $(`#${idAbSortBy}`).val() || "buy";
  const buyerSetting = getValue("BuyerSettings") || {};
  buyerSetting["idAbSortBy"] = sortBy;
  setValue("BuyerSettings", buyerSetting);
};

try {
  $(document).on({ change: updateAbSortBy }, `#${idAbSortBy}`);
} catch (e) {}

const playerIgnoreList = function () {
  const page = getPageWindow();
  const PlayerSearch =
    (page && page.UTPlayerSearchControl) || window.UTPlayerSearchControl;
  if (typeof PlayerSearch !== "function") {
    return $(`
      <div class="price-filter buyer-settings-field">
        <div class="info">
          <span class="secondary label">
            Liste joueurs EA indisponible.<br/>
            <small>Le bot utilise tes critères de recherche du marché des transferts.</small>
          </span>
        </div>
      </div>`);
  }
  playerInput = new PlayerSearch();
  const playerListId = `#${idAddIgnorePlayersList}`;
  const element = $(`
            <div class="price-filter buyer-settings-field">
              <div class="info">
               <span class="secondary label">
                  <button id=${idTooltip} style="font-size:16px" class="flat camel-case">Players List</button><br/>
                </span>
              </div>
              <div class="ignore-players displayCenterFlx">
                ${generateButton(
                  idAddIgnorePlayers,
                  "+",
                  () => {
                    const displayName = `${playerInput._playerNameInput.value}(${playerInput.selected.rating})`;
                    const exists = checkAndAppendOption(
                      playerListId,
                      displayName
                    );
                    $(`${playerListId} option[value="${displayName}"]`).attr(
                      "selected",
                      true
                    );
                    if (!exists) {
                      const buyerSetting = getValue("BuyerSettings") || {};
                      const existingPlayersList =
                        buyerSetting["idAddIgnorePlayersList"] || [];
                      existingPlayersList.push({
                        id: playerInput.selected.id,
                        displayName,
                      });
                      buyerSetting["idAddIgnorePlayersList"] =
                        existingPlayersList;
                      setValue("BuyerSettings", buyerSetting);
                    }
                  },
                  "btn-standard filterSync action-icons"
                )}                
                </div>
              </div>
              <div class="price-filter buyer-settings-field">
                <div class="info">
                <span class="secondary label">
                  <button id=${idTooltip} style="font-size:16px" class="flat camel-case">Remove from Players List</button><br/>
                </span>
                </div>
                <div class="displayCenterFlx">
                  <select style="width:90%;height: 3rem;font-size: 1.5rem;" class="filter-header-settings" id=${idAddIgnorePlayersList}>
                    <option selected="true" disabled>Players List</option>                            
                  </select>
                  ${generateButton(
                    idRemoveIgnorePlayers,
                    "❌",
                    () => {
                      const playerName = $(`${playerListId} option`)
                        .filter(":selected")
                        .val();
                      if (playerName != "Ignored Players List") {
                        $(
                          `${playerListId}` + ` option[value="${playerName}"]`
                        ).remove();
                        $(`${playerListId}`).prop("selectedIndex", 0);
                        const buyerSetting = getValue("BuyerSettings") || {};
                        let existingPlayersList =
                          buyerSetting["idAddIgnorePlayersList"] || [];
                        existingPlayersList = existingPlayersList.filter(
                          ({ displayName }) => displayName != playerName
                        );
                        buyerSetting["idAddIgnorePlayersList"] =
                          existingPlayersList;
                        setValue("BuyerSettings", buyerSetting);
                      }
                    },
                    "btn-standard filterSync font15 action-icons"
                  )}
                </div>
              </div>              
              `);

  $(playerInput.__root).insertBefore(element.find(`#${idAddIgnorePlayers}`));
  playerInput.init();
  playerInput._playerNameInput.setPlaceholder("Search Players");
  return element;
};

export const searchSettingsView = function () {
  const element =
    $(`<div style='display : none' class='buyer-settings-wrapper results-filter-view'>
    <div class="place-holder">
    </div>
    ${generateToggleInput(
      "Liste ignore / only-buy",
      { idAbIgnoreAllowToggle },
      "(ON = n'achète que ces joueurs, OFF = les ignore)",
      "BuyerSettings"
    )}
    ${generateTextInput(
      "Note min",
      10,
      { idAbMinRating },
      "Note minimale du joueur",
      "BuyerSettings"
    )}
    ${generateTextInput(
      "Note max",
      100,
      { idAbMaxRating },
      "Note maximale du joueur",
      "BuyerSettings"
    )}    
    ${generateTextInput(
      "Pages de recherche max",
      5,
      { idAbMaxSearchPage },
      "Nombre de pages avant de revenir à la page 1",
      "BuyerSettings"
    )}
    ${generateTextInput(
      "Min bid aléatoire max",
      300,
      { idAbRandMinBidInput },
      "Varie minBid pour éviter les caches EA",
      "BuyerSettings"
    )}
    ${generateToggleInput(
      "Min bid aléatoire",
      { idAbRandMinBidToggle },
      "Recommandé pour mixer les résultats",
      "BuyerSettings"
    )}
    ${generateTextInput(
      "Min buy aléatoire max",
      300,
      { idAbRandMinBuyInput },
      "Varie minBuy pour éviter les caches EA",
      "BuyerSettings"
    )}
    ${generateToggleInput(
      "Min buy aléatoire",
      { idAbRandMinBuyToggle },
      "Recommandé pour mixer les résultats",
      "BuyerSettings"
    )}
    ${generateToggleInput(
      "Ignorer les gardiens",
      { idAbAddFilterGK },
      "(Skip tous les GK)",
      "BuyerSettings"
    )}
    ${generateToggleInput(
      "Trier les joueurs",
      { idAbShouldSort },
      "",
      "BuyerSettings"
    )}
    <div class="price-filter buyer-settings-field">
      <div class="displayCenterFlx">
      <select style="width:95%;height: 3rem;font-size: 1.5rem;" class="select-sortBy filter-header-settings" id="${idAbSortBy}">
        <option disabled selected>--Select Sort Attribute--</option>
        <option value="expires">Expires on</option>          
        <option value="buy">Buy now price</option>
        <option value="bid">Bid now price</option>
        <option value="rating">Player rating</option>
      </select>
      </div>
    </div>
    ${generateToggleInput(
      "Order",
      { idAbSortOrder },
      "(Enabled = descending, Disabled = ascending)",
      "BuyerSettings"
    )}
  </div>`);

  const parentEl = element.find(".place-holder");
  try {
    playerIgnoreList().insertAfter(parentEl);
  } catch (e) {
    console.warn("[MagicBuyer] liste joueurs", e);
  }
  return element;
};
