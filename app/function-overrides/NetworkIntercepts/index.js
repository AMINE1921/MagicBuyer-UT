import { isMarketAlertApp } from "../../app.constants";
import { getValue, setValue } from "../../services/repository";

const personaUrl = "/ut/game/fifa23/usermassinfo";
const squadMembersUrl = "/ut/game/fifa23/tradepile";
const profileUrl = "https://gateway.ea.com/proxy/identity/pids/me";

export const xmlRequestOverride = () => {
  let defaultRequestOpen = window.XMLHttpRequest.prototype.open;

  window.XMLHttpRequest.prototype.open = function (method, url, async) {
    this.addEventListener(
      "readystatechange",
      function () {
        if (this.readyState === 4) {
          if (isMarketAlertApp && this.responseURL.includes(personaUrl)) {
            let parsedResponse = JSON.parse(this.responseText);
            if (parsedResponse) {
              const { personaId, personaName } = parsedResponse.userInfo;
              const userEmail = getValue("useremail");
              window.ReactNativeWebView.postMessage(
                JSON.stringify({
                  payload: {
                    personaId,
                    personaName,
                    userEmail,
                    language: services.Localization.locale.language,
                  },
                  type: "initUser",
                })
              );
            }
          } else if (
            isMarketAlertApp &&
            this.responseURL.includes(squadMembersUrl)
          ) {
            let parsedResponse = JSON.parse(this.responseText);
            if (parsedResponse) {
              const payload = parsedResponse.auctionInfo
                .filter((item) => item.itemData.assetId)
                .map(({ itemData }) => {
                  const { id, assetId, definitionId, rareflag, rating } =
                    itemData;
                  return {
                    id,
                    assetId,
                    definitionId,
                    rareflag,
                    rating,
                  };
                });
              window.ReactNativeWebView.postMessage(
                JSON.stringify({ payload, type: "transferList" })
              );
            }
          } else if (this.responseURL.includes(profileUrl)) {
            let parsedRespose = JSON.parse(this.responseText);
            if (parsedRespose && parsedRespose.pid && !getValue("useremail"))
              setValue("useremail", parsedRespose.pid.email);
          }
        }
      },
      false
    );
    defaultRequestOpen.call(this, method, url, async);
  };
};
