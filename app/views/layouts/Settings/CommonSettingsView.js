import {
  idAbStopErrorCode,
  idAutoClearLog,
  idAbStopErrorCodeCount,
  idAutoClearExpired,
  idAbResumeAfterErrorOccured,
  idAbUseFutWiz,
} from "../../../elementIds.constants";
import { generateTextInput } from "../../../utils/uiUtils/generateTextInput";
import { generateToggleInput } from "../../../utils/uiUtils/generateToggleInput";

export const commonSettingsView = function () {
  return `<div style='display : none' class='buyer-settings-wrapper common-settings-view'>
  ${generateTextInput(
    "Codes erreur d'arrêt (csv)",
    "",
    { idAbStopErrorCode },
    "(Ex. 412,421,521)",
    "CommonSettings",
    "text",
    "^\\d+(,\\d+)*$"
  )}
  ${generateTextInput(
    "Occurrences avant arrêt",
    3,
    { idAbStopErrorCodeCount },
    "Nombre de fois où le code doit arriver",
    "CommonSettings"
  )}
  ${generateTextInput(
    "Reprise après erreur",
    "",
    { idAbResumeAfterErrorOccured },
    "(S / M / H — ex. 30-60S)",
    "CommonSettings",
    "text",
    "\\d+-\\d+[H|M|S|h|m|s]$"
  )}
  ${generateToggleInput(
    "Vider les logs auto",
    { idAutoClearLog },
    "(Toutes les 2 minutes)",
    "CommonSettings"
  )}
  ${generateToggleInput(
    "Vider les expirés auto",
    { idAutoClearExpired },
    "(Cibles de transfert expirées)",
    "CommonSettings"
  )}
  ${generateToggleInput(
    "Prix Futwiz",
    { idAbUseFutWiz },
    "(Sinon FUTBIN)",
    "CommonSettings"
  )}
  </div>`;
};
