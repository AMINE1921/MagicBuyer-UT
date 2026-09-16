import {
  idAbCloseTabToggle,
  idAbSolveCaptcha,
  idAntiCaptchKey,
  idProxyAddress,
  idProxyLogin,
  idProxyPassword,
  idProxyPort,
} from "../../../elementIds.constants";
import { generateTextInput } from "../../../utils/uiUtils/generateTextInput";
import { generateToggleInput } from "../../../utils/uiUtils/generateToggleInput";

export const captchaSettingsView = function () {
  return `<div style='display : none' class='buyer-settings-wrapper captcha-settings-view'>
    ${generateToggleInput(
      "Fermer la Web App si captcha",
      { idAbCloseTabToggle },
      "",
      "CommonSettings"
    )}         
    ${generateToggleInput(
      "Résoudre le captcha auto",
      { idAbSolveCaptcha },
      "",
      "CommonSettings"
    )}
    ${generateTextInput(
      "Clé Anti-Captcha",
      "",
      { idAntiCaptchKey },
      "",
      "CommonSettings",
      "text"
    )}
    ${generateTextInput(
      "Adresse proxy",
      "",
      { idProxyAddress },
      "",
      "CommonSettings",
      "text"
    )}
    ${generateTextInput(
      "Port proxy",
      "",
      { idProxyPort },
      "",
      "CommonSettings"
    )}
    ${generateTextInput(
      "User proxy (optionnel)",
      "",
      { idProxyLogin },
      "",
      "CommonSettings",
      "text"
    )}
    ${generateTextInput(
      "Mot de passe proxy (optionnel)",
      "",
      { idProxyPassword },
      "",
      "CommonSettings",
      "text"
    )}
    </div> 
    `;
};
