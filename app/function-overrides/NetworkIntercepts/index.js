import { isMarketAlertApp } from "../../app.constants";
import { getValue, setValue } from "../../services/repository";
import { installTransferMarketUrlGuard } from "../../utils/eaTransferMarket";

const personaUrlPattern = /\/ut\/game\/[^/]+\/usermassinfo/;
const squadMembersUrlPattern = /\/ut\/game\/[^/]+\/tradepile(?:\?|$)/;
const profileUrl = "https://gateway.ea.com/proxy/identity/pids/me";

export const xmlRequestOverride = () => {
  installTransferMarketUrlGuard();
  let defaultRequestOpen = window.XMLHttpRequest.prototype.open;

  window.XMLHttpRequest.prototype.open = function (method, url, async) {
    this.addEventListener(
      "readystatechange",
      function () {
        if (this.readyState === 4) {
          if (isMarketAlertApp && personaUrlPattern.test(this.responseURL)) {
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
            isMarketAlertApp && squadMembersUrlPattern.test(this.responseURL)
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
